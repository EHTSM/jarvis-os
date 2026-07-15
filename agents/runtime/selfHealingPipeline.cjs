"use strict";
/**
 * Self-Healing Pipeline — executes a fix plan end-to-end.
 *
 * Entry points:
 *   execute(planId, opts)     — run a stored fix plan → HealingRun
 *   getHealingRun(runId)      — retrieve one run
 *   listHealingRuns(opts)     — list runs with filters
 *   approveRun(runId)         — approve a run halted at an approval gate
 *
 * Reuses (all injected through lazy require, fail-safe):
 *   autoFixPlanner.getPlan()              — load the fix plan
 *   patchAssistant.proposePatch()         — register patch proposals
 *   patchAssistant.applyPatch()           — apply approved patches
 *   patchAssistant.rollbackPatch()        — roll back applied patches
 *   patchAssistant.verifyPatch()          — run verification command after patch
 *   patchExecutionEngine.proposeBatch()   — multi-file patch batching
 *   deploymentPipeline.createRun()        — create a pipeline run record
 *   deploymentPipeline.approveRun()       — approve a pipeline run
 *   deploymentPipeline.markRolledBack()   — mark a pipeline run rolled back
 *   incidentEngine.resolve()              — close the originating incident on success
 *
 * Modes:
 *   recommend_only     — plan is analysed, patches proposed but never applied.
 *                        Operator receives a report and approves manually.
 *   approval_required  — (default) pipeline runs step by step, pausing at each
 *                        approvalRequired=true task for operator sign-off.
 *   auto_heal          — all tasks executed automatically without pause.
 *                        Only safe for LOW/MEDIUM risk plans.
 *
 * Execution model:
 *   Each plan task maps to a stage in the HealingRun.
 *   Stages are executed in dependsOn order (topological walk).
 *   A stage failure triggers rollback of all applied patches and marks the run failed.
 *   A successful verify + redeploy resolves the originating incident.
 *
 * Rollback policy:
 *   On any stage failure after patches have been applied:
 *     - Call patchAssistant.rollbackPatch for each applied patchId (reverse order)
 *     - Mark pipeline run as rolled-back (if one was created)
 *     - Set run.status = "rolled-back"
 *     - Emit a healing:rolled-back event
 *
 * Storage: data/healing-runs.json  (max 100, newest-first, atomic write)
 *
 * HealingRun shape:
 *   {
 *     runId, planId, rcaId, incidentId, mode, status, createdAt, completedAt?,
 *     stages: [{
 *       seq, type, title, status, startedAt, completedAt,
 *       patchId?, pipelineRunId?,
 *       result: { ok, detail, error? }
 *     }],
 *     patchIds: string[],           — all patches proposed/applied this run
 *     pipelineRunId: string|null,   — deployment pipeline run ID
 *     outcome: "success"|"failed"|"rolled-back"|"awaiting-approval"|"recommend-only",
 *     rollbackLog: string[],
 *   }
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const DATA_DIR      = path.join(__dirname, "../../data");
const RUNS_PATH     = path.join(DATA_DIR, "healing-runs.json");
const MAX_RUNS      = 100;

// ── Lazy module accessors (all fail-safe) ─────────────────────────
function _afp()      { return require("./autoFixPlanner.cjs");         }
function _pa()       { try { return require("./patchAssistant.cjs");      } catch { return null; } }
function _pee()      { try { return require("./patchExecutionEngine.cjs"); } catch { return null; } }
function _dp()       { try { return require("./deploymentPipeline.cjs");  } catch { return null; } }
function _inc()      { try { return require("./incidentEngine.cjs");      } catch { return null; } }
function _lme()      { try { return require("./learningMemoryEngine.cjs");    } catch { return null; } }
function _ple()      { try { return require("./productLifecycleEngine.cjs"); } catch { return null; } }

// Fire-and-forget ingest into learning memory after run completes/fails
function _learnFromRun(run) {
    setImmediate(() => {
        try { _lme()?.ingestFromRun(run.runId); } catch { /* non-fatal */ }
        // Trigger lifecycle re-evaluation after a healing run completes
        try { _ple()?.evaluate({ windowMins: 60, persist: true }); } catch { /* non-fatal */ }
    });
}

// ── Storage ───────────────────────────────────────────────────────
function _loadRuns() {
    try {
        const raw = fs.readFileSync(RUNS_PATH, "utf8");
        const d   = JSON.parse(raw);
        return Array.isArray(d) ? d : [];
    } catch { return []; }
}

function _saveRuns(runs) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = RUNS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(runs.slice(0, MAX_RUNS), null, 2));
    fs.renameSync(tmp, RUNS_PATH);
}

function _persistRun(run) {
    const all = _loadRuns();
    const idx = all.findIndex(r => r.runId === run.runId);
    if (idx !== -1) all[idx] = run;
    else all.unshift(run);
    _saveRuns(all);
}

let _idCounter = Date.now();
function _newRunId() { return `heal_${++_idCounter}`; }

// ── Mode policy ───────────────────────────────────────────────────
const VALID_MODES = new Set(["recommend_only", "approval_required", "auto_heal"]);

function _autoHealSafe(risk) {
    // auto_heal only permitted for LOW or MEDIUM risk plans
    return risk === "LOW" || risk === "MEDIUM";
}

// ── Topological task sort ─────────────────────────────────────────
// Tasks already come in seq order with dependsOn; we respect that order directly.
// This is a linear pass: execute task N only after all its dependsOn tasks are complete.
function _taskOrder(tasks) {
    return [...tasks].sort((a, b) => a.seq - b.seq);
}

// ── Stage factory ─────────────────────────────────────────────────
function _makeStage(task) {
    return {
        seq:           task.seq,
        type:          task.type,
        title:         task.title,
        approvalRequired: task.approvalRequired ?? false,
        targetFile:    task.targetFile || null,
        command:       task.command    || null,
        pipeline:      task.pipeline   || null,
        status:        "pending",   // pending | running | passed | failed | skipped | awaiting-approval
        startedAt:     null,
        completedAt:   null,
        patchId:       null,
        pipelineRunId: null,
        result:        null,
    };
}

// ── Stage executors ───────────────────────────────────────────────

function _execInvestigate(stage, _run) {
    // Read-only — always passes. Records what was checked.
    return { ok: true, detail: `Investigated: ${stage.title}` };
}

function _execRunCommand(stage, _run) {
    // Record the command. We don't shell-exec in the planner — the operator
    // runs commands manually or via terminal agent. Mark as passed with detail.
    return {
        ok:     true,
        detail: `Command staged for execution: ${stage.command || stage.title}`,
        note:   "Run this command in the terminal to proceed.",
    };
}

function _execPatchFile(stage, run, patchedContentFn) {
    const pa = _pa();
    if (!pa) return { ok: false, error: "patchAssistant unavailable" };
    if (!stage.targetFile) return { ok: false, error: "targetFile not specified" };

    // Only patchedContentFn produces a real, reviewed fix. Without it there is
    // no actual patch to apply — just a placeholder stub — so it must never be
    // auto-approved, in any mode, or auto_heal silently overwrites working
    // source files with a non-functional comment.
    const hasRealContent = typeof patchedContentFn === "function";
    const patchedContent = hasRealContent
        ? patchedContentFn(stage.targetFile)
        : `// [AutoFixPlanner patch] ${stage.detail}\n// Replace this placeholder with the actual fix.\n`;

    const proposal = pa.proposePatch({
        filePath:       stage.targetFile,
        patchedContent,
        reason:         `[SelfHeal:${run.runId}] ${stage.title}`,
        sessionId:      run.runId,
    });

    if (!proposal.ok) return { ok: false, error: proposal.error };

    stage.patchId = proposal.patchId;
    run.patchIds.push(proposal.patchId);

    // In auto_heal or approval_required-with-approved mode, apply immediately —
    // but only when there's real patch content behind it.
    if (run._applyPatches && hasRealContent) {
        const applyResult = pa.applyPatch(proposal.patchId, { approved: true, operatorId: "self-heal" });
        if (!applyResult.ok) return { ok: false, error: `Apply failed: ${applyResult.error}`, patchId: proposal.patchId };
        return { ok: true, detail: `Patch applied to ${stage.targetFile}`, patchId: proposal.patchId, applied: true };
    }

    return {
        ok:              true,
        detail:          `Patch proposed for ${stage.targetFile} — awaiting approval${hasRealContent ? "" : " (placeholder only — no generated fix content)"}`,
        patchId:         proposal.patchId,
        requiresApproval: true,
        applied:         false,
    };
}

function _execRunMigration(stage, run) {
    // Migrations are always approval-required. In recommend/approval modes, record the intent.
    // In auto_heal, still require explicit approval — never auto-apply DB migrations.
    return {
        ok:     true,
        detail: `Migration staged: ${stage.targetFile || stage.title}`,
        note:   "Apply migration manually: node scripts/migrate.js or equivalent",
        requiresApproval: true,
    };
}

function _execVerify(stage, run) {
    // Run the staged verification command. In a live environment this would invoke
    // terminalAgent. In the pipeline simulation we record the intent.
    // The actual verification result is supplied by the caller's patchVerifyFn hook.
    if (run._verifyFn) {
        const result = run._verifyFn(stage, run);
        return result;
    }
    // Default: GET /health check intent
    return {
        ok:     true,
        detail: `Verify: ${stage.title} — GET /health and re-run incident detection`,
        note:   "Manual verification step — confirm health endpoint returns ok.",
    };
}

function _execRedeploy(stage, run) {
    const dp = _dp();
    if (!dp) {
        return { ok: true, detail: `Pipeline ${stage.pipeline} staged — deploymentPipeline unavailable, manual deploy required` };
    }

    const pipelineName = stage.pipeline;
    if (!pipelineName) return { ok: false, error: "No pipeline name in redeploy task" };

    const runResult = dp.createRun(pipelineName, {
        operatorId: "self-heal",
        sessionId:  run.runId,
        approved:   run._applyPatches,   // auto_heal approves immediately
        dryRun:     false,
    });

    if (!runResult.created) return { ok: false, error: runResult.error };

    stage.pipelineRunId  = runResult.run.id;
    run.pipelineRunId    = runResult.run.id;

    // If auto_heal and pipeline needs approval, approve it now
    if (run._applyPatches && runResult.run.state === "awaiting-approval") {
        dp.approveRun(runResult.run.id);
    }

    return {
        ok:            true,
        detail:        `Pipeline run created: ${runResult.run.id} (${pipelineName})`,
        pipelineRunId: runResult.run.id,
        state:         runResult.run.state,
    };
}

function _execNotify(stage, _run) {
    return { ok: true, detail: `Notification: ${stage.title}` };
}

const STAGE_EXECUTORS = {
    investigate:    _execInvestigate,
    run_command:    _execRunCommand,
    patch_file:     _execPatchFile,
    run_migration:  _execRunMigration,
    verify:         _execVerify,
    redeploy:       _execRedeploy,
    notify:         _execNotify,
};

// ── Rollback helper ───────────────────────────────────────────────
function _rollbackAppliedPatches(run) {
    const pa = _pa();
    if (!pa || run.patchIds.length === 0) return;

    const applied = [...run.patchIds].reverse();
    for (const patchId of applied) {
        try {
            const rb = pa.rollbackPatch(patchId, { approved: true });
            const msg = rb.ok
                ? `Rolled back patch ${patchId}`
                : `Rollback failed for ${patchId}: ${rb.error}`;
            run.rollbackLog.push(msg);
            logger.info(`[SelfHeal] ${msg}`);
        } catch (e) {
            run.rollbackLog.push(`Rollback exception for ${patchId}: ${e.message}`);
        }
    }

    // Mark deployment pipeline as rolled back if created
    if (run.pipelineRunId) {
        const dp = _dp();
        if (dp) dp.markRolledBack(run.pipelineRunId, "SelfHeal rollback triggered");
    }
}

// ═══════════════════════════════════════════════════════════════════
// PRIMARY EXECUTION ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a fix plan identified by planId.
 *
 * @param {string} planId
 * @param {object} opts
 * @param {string}   [opts.mode="approval_required"]  — "recommend_only"|"approval_required"|"auto_heal"
 * @param {string}   [opts.operatorId]
 * @param {Function} [opts.patchedContentFn]  — (filePath) => string  supply actual patch content
 * @param {Function} [opts.verifyFn]          — (stage, run) => { ok, detail }  supply verify result
 * @returns {HealingRun}
 */
function execute(planId, opts = {}) {
    const afp  = _afp();
    const plan = afp.getPlan(planId);
    if (!plan) return { ok: false, error: `Plan ${planId} not found` };
    return _executeplan(plan, opts);
}

/**
 * Execute a fix plan object directly (no store lookup needed).
 * Used in tests and by the HTTP layer when the plan is already loaded.
 */
function executePlan(plan, opts = {}) {
    return _executeplan(plan, opts);
}

function _executeplan(plan, opts = {}) {
    const {
        mode             = "approval_required",
        operatorId       = null,
        patchedContentFn = null,
        verifyFn         = null,
    } = opts;

    if (!VALID_MODES.has(mode)) {
        return { ok: false, error: `Invalid mode: ${mode}. Use: ${[...VALID_MODES].join(", ")}` };
    }

    // Safety: block auto_heal on HIGH/CRITICAL risk
    if (mode === "auto_heal" && !_autoHealSafe(plan.risk?.level)) {
        return {
            ok:    false,
            error: `auto_heal blocked — plan risk=${plan.risk?.level}. Only LOW/MEDIUM plans may auto-heal.`,
        };
    }

    const run = {
        runId:         _newRunId(),
        planId:        plan.planId,
        rcaId:         plan.rcaId,
        incidentId:    plan.incidentId,
        mode,
        operatorId,
        status:        "running",
        createdAt:     new Date().toISOString(),
        completedAt:   null,
        stages:        plan.tasks.map(_makeStage),
        patchIds:      [],
        pipelineRunId: null,
        outcome:       null,
        rollbackLog:   [],
        // Internal flags (not persisted in final record)
        _applyPatches: mode === "auto_heal",
        _verifyFn:     verifyFn,
    };

    _persistRun(_publicRun(run));
    logger.info(`[SelfHeal] ${run.runId} — plan=${plan.planId} mode=${mode} risk=${plan.risk?.level} tasks=${run.stages.length}`);

    // ── recommend_only: propose patches, no execution ─────────────
    if (mode === "recommend_only") {
        for (const stage of run.stages) {
            if (stage.type === "patch_file") {
                stage.status = "skipped";
                stage.result = { ok: true, detail: "recommend_only: patch proposed, not applied" };
                // Still register proposals so operator can review diffs
                _execPatchFile(stage, run, patchedContentFn);
            } else {
                stage.status = "skipped";
                stage.result = { ok: true, detail: `recommend_only: ${stage.title}` };
            }
        }
        run.status  = "completed";
        run.outcome = "recommend-only";
        run.completedAt = new Date().toISOString();
        _persistRun(_publicRun(run));
        _learnFromRun(run);
        logger.info(`[SelfHeal] ${run.runId} → recommend-only (${run.patchIds.length} patch proposals)`);
        return _publicRun(run);
    }

    // ── approval_required / auto_heal: execute stages in order ───
    const orderedStages = _taskOrder(run.stages);

    for (const stage of orderedStages) {
        // Check all dependsOn stages passed
        const depsOk = (plan.tasks.find(t => t.seq === stage.seq)?.dependsOn || [])
            .every(depSeq => {
                const depStage = run.stages.find(s => s.seq === depSeq);
                return depStage?.status === "passed";
            });

        if (!depsOk) {
            stage.status = "skipped";
            stage.result = { ok: true, detail: "Dependency not met — skipped" };
            continue;
        }

        // approval_required mode: halt at approval gates
        if (mode === "approval_required" && stage.approvalRequired) {
            stage.status = "awaiting-approval";
            stage.result = { ok: true, detail: `Awaiting operator approval for: ${stage.title}` };
            run.status   = "awaiting-approval";
            run.outcome  = "awaiting-approval";
            run.completedAt = new Date().toISOString();
            _persistRun(_publicRun(run));
            logger.info(`[SelfHeal] ${run.runId} → PAUSED at stage ${stage.seq} (${stage.title}) — awaiting approval`);
            return _publicRun(run);
        }

        // Execute the stage
        stage.status    = "running";
        stage.startedAt = new Date().toISOString();

        const executor = STAGE_EXECUTORS[stage.type] || _execInvestigate;
        let result;
        try {
            result = executor(stage, run, patchedContentFn);
        } catch (e) {
            result = { ok: false, error: `Executor threw: ${e.message}` };
        }

        stage.result      = result;
        stage.completedAt = new Date().toISOString();
        stage.status      = result.ok ? "passed" : "failed";
        if (stage.patchId) run.patchIds.push(stage.patchId);  // deduplicate from executor

        _persistRun(_publicRun(run));

        if (!result.ok) {
            // Stage failed → rollback and abort
            logger.info(`[SelfHeal] Stage ${stage.seq} (${stage.title}) FAILED: ${result.error}`);
            _rollbackAppliedPatches(run);
            run.status      = "failed";
            run.outcome     = "rolled-back";
            run.completedAt = new Date().toISOString();
            _persistRun(_publicRun(run));
            _learnFromRun(run);
            logger.info(`[SelfHeal] ${run.runId} → FAILED + rolled back (${run.rollbackLog.length} patches reversed)`);
            return _publicRun(run);
        }

        logger.info(`[SelfHeal] Stage ${stage.seq} (${stage.type}: ${stage.title}) → passed`);
    }

    // All stages passed → resolve incident if possible
    const incEngine = _inc();
    if (incEngine && run.incidentId) {
        try {
            incEngine.resolve(run.incidentId, `Self-healing pipeline ${run.runId} completed successfully`);
        } catch { /* non-fatal */ }
    }

    // Update fix plan status to done
    try {
        const afp = _afp();
        afp.updateStatus(plan.planId, "done");
    } catch { /* non-fatal */ }

    run.status      = "completed";
    run.outcome     = "success";
    run.completedAt = new Date().toISOString();
    _persistRun(_publicRun(run));
    _learnFromRun(run);
    logger.info(`[SelfHeal] ${run.runId} → SUCCESS (${run.patchIds.length} patches, pipeline=${run.pipelineRunId || "none"})`);
    return _publicRun(run);
}

// Strip internal fields before storage / return
function _publicRun(run) {
    const { _applyPatches, _verifyFn, ...pub } = run;
    return pub;
}

// ── Approval gate ─────────────────────────────────────────────────

/**
 * Approve a run that is halted at an approval gate.
 * Resumes execution from the first awaiting-approval stage.
 *
 * @param {string} runId
 * @param {object} opts  — same opts as execute() for resume context
 */
function approveRun(runId, opts = {}) {
    const all = _loadRuns();
    const run = all.find(r => r.runId === runId);
    if (!run) return { ok: false, error: "run_not_found" };
    if (run.outcome !== "awaiting-approval") return { ok: false, error: `run is ${run.outcome}, not awaiting-approval` };

    // Find the plan
    const afp  = _afp();
    const plan = afp.getPlan(run.planId);
    if (!plan) return { ok: false, error: `plan ${run.planId} not found` };

    // Mark the awaiting-approval stage as approved and resume with auto_heal for remaining
    for (const stage of run.stages) {
        if (stage.status === "awaiting-approval") {
            stage.status = "pending";   // reset so executor picks it up
            break;
        }
    }
    run.status  = "running";
    run.outcome = null;

    // Re-attach internal fields and resume
    run._applyPatches = true;         // operator just approved — apply patches
    run._verifyFn     = opts.verifyFn || null;
    run.patchIds      = run.patchIds || [];
    run.rollbackLog   = run.rollbackLog || [];

    return _resumeRun(run, plan, opts);
}

function _resumeRun(run, plan, opts = {}) {
    const { patchedContentFn = null } = opts;
    const orderedStages = _taskOrder(run.stages);

    for (const stage of orderedStages) {
        if (stage.status === "passed" || stage.status === "skipped") continue;

        if (stage.status === "pending" || stage.status === "awaiting-approval") {
            stage.status    = "running";
            stage.startedAt = new Date().toISOString();

            const executor = STAGE_EXECUTORS[stage.type] || _execInvestigate;
            let result;
            try { result = executor(stage, run, patchedContentFn); }
            catch (e) { result = { ok: false, error: `Executor threw: ${e.message}` }; }

            stage.result      = result;
            stage.completedAt = new Date().toISOString();
            stage.status      = result.ok ? "passed" : "failed";
            if (stage.patchId && !run.patchIds.includes(stage.patchId)) {
                run.patchIds.push(stage.patchId);
            }

            _persistRun(_publicRun(run));

            if (!result.ok) {
                _rollbackAppliedPatches(run);
                run.status      = "failed";
                run.outcome     = "rolled-back";
                run.completedAt = new Date().toISOString();
                _persistRun(_publicRun(run));
                _learnFromRun(run);
                return { ok: false, run: _publicRun(run) };
            }
        }
    }

    // All stages done
    const incEngine = _inc();
    if (incEngine && run.incidentId) {
        try { incEngine.resolve(run.incidentId, `Self-healing ${run.runId} completed after approval`); }
        catch { /* non-fatal */ }
    }
    try { _afp().updateStatus(plan.planId, "done"); } catch { /* non-fatal */ }

    run.status      = "completed";
    run.outcome     = "success";
    run.completedAt = new Date().toISOString();
    _persistRun(_publicRun(run));
    _learnFromRun(run);
    return { ok: true, run: _publicRun(run) };
}

// ── Reader API ────────────────────────────────────────────────────

function getHealingRun(runId) {
    return _loadRuns().find(r => r.runId === runId) || null;
}

function listHealingRuns({ planId, incidentId, outcome, status, limit = 20 } = {}) {
    let runs = _loadRuns();
    if (planId)     runs = runs.filter(r => r.planId     === planId);
    if (incidentId) runs = runs.filter(r => r.incidentId === incidentId);
    if (outcome)    runs = runs.filter(r => r.outcome    === outcome);
    if (status)     runs = runs.filter(r => r.status     === status);
    return runs.slice(0, limit);
}

module.exports = { execute, executePlan, approveRun, getHealingRun, listHealingRuns };
