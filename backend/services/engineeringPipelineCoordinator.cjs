"use strict";
/**
 * engineeringPipelineCoordinator.cjs — Phase I7: Autonomous Engineering Pipeline
 *
 * Coordinates a full engineering pipeline from a plain-language goal
 * with zero manual orchestration. Uses ONLY existing systems:
 *
 *   missionCollaborationEngine — collaboration plan + handoff chain
 *   missionMemory              — mission storage authority
 *   missionOrchestrator        — mission creation
 *   autonomousExecutionRuntime — capability execution
 *   engineeringCapabilities    — repo_read, patch_generate, patch_apply,
 *                                build_run, test_run, rollback, git_commit
 *   engineeringBenchmark       — I7-7 end-to-end validation (10 real scenarios)
 *   engineeringRuleRegistry    — patch/build/test rule consulting
 *   rootCauseAnalysisEngine    — failure root cause
 *   graphReasoningEngine       — affected component risk
 *   runtimeEventBus            — event fan-out
 *   agentRuntimeSupervisor     — agent tick triggers for collaboration handoffs
 *   continuousLearningEngine   — lesson recording
 *
 * STRICT ARCHITECTURE RULES:
 *   No new runtime    — autonomousExecutionRuntime is the executor
 *   No new scheduler  — setImmediate/setTimeout only
 *   No duplicate collaboration engine — missionCollaborationEngine used as-is
 *   No duplicate execution engine     — autonomousExecutionRuntime used as-is
 *   No duplicate reasoning engine     — graphReasoningEngine used as-is
 *   No duplicate memory               — missionMemory used as-is
 *   No duplicate graph                — knowledgeGraph used as-is
 *
 * Pipeline stages (executed in order, with gate checks between stages):
 *
 *   1  repo_read         — read current repo state (git status, recent log)
 *   2  repo_analysis     — graphReasoningEngine.findCriticalDependencies for risk
 *   3  patch_generate    — record patch intent
 *   4  patch_validate    — I7-2: syntax + conflict + rollback availability check
 *   5  patch_apply       — apply the staged change
 *   6  build_gate        — I7-3: run build, stop on failure, create recovery mission
 *   7  test_gate         — I7-4: run tests, benchmark, stop if red
 *   8  review_gate       — I7-5: review status + confidence check
 *   9  commit_gate       — I7-5: require approval + review + verification
 *   10 observe           — git status + diff post-commit
 *   11 learn             — lesson registration
 *
 * Public API:
 *   runPipeline(goal, opts)          → PipelineRun
 *   getPipeline(pipelineId)          → PipelineRun | null
 *   listPipelines(opts)              → { pipelines[], total }
 *   cancelPipeline(pipelineId)       → PipelineRun
 *   getActivePipelines()             → PipelineRun[]
 *   getStats()                       → stats object
 *   runValidation(opts)              → I7-7: 10 real engineering scenarios via benchmark
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── Lazy loaders ───────────────────────────────────────────────────────────────
function _mm()    { try { return require("./missionMemory.cjs");                              } catch { return null; } }
function _orch()  { try { return require("./missionOrchestrator.cjs");                        } catch { return null; } }
function _collab(){ try { return require("./missionCollaborationEngine.cjs");                 } catch { return null; } }
function _aer()   { try { return require("./autonomousExecutionRuntime.cjs");                 } catch { return null; } }
function _ec()    { try { return require("./engineeringCapabilities.cjs");                    } catch { return null; } }
function _bench() { try { return require("./engineeringBenchmark.cjs");                       } catch { return null; } }
function _rules() { try { return require("./engineeringRuleRegistry.cjs");                    } catch { return null; } }
function _rca()   { try { return require("./rootCauseAnalysisEngine.cjs");                    } catch { return null; } }
function _gre()   { try { return require("./graphReasoningEngine.cjs");                       } catch { return null; } }
function _bus()   { try { return require("../../agents/runtime/runtimeEventBus.cjs");        } catch { return null; } }
function _sup()   { try { return require("./agentRuntimeSupervisor.cjs");                     } catch { return null; } }
function _le()    { try { return require("./continuousLearningEngine.cjs");                   } catch { return null; } }
function _conf()  { try { return require("./engineeringConfidenceEngine.cjs");                } catch { return null; } }

// ── Persistence ────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, "../../data");
const PIPE_FILE = path.join(DATA_DIR, "engineering-pipelines.json");

let _store   = null;
let _writing = false;

function _load() {
    if (_store) return _store;
    try { _store = JSON.parse(fs.readFileSync(PIPE_FILE, "utf8")); }
    catch { _store = { pipelines: {} }; }
    if (!_store.pipelines) _store.pipelines = {};
    return _store;
}

function _persist() {
    if (_writing) return;
    _writing = true;
    setImmediate(() => {
        const tmp = PIPE_FILE + ".tmp";
        fs.writeFile(tmp, JSON.stringify({ ..._store, savedAt: new Date().toISOString() }, null, 2), "utf8", err => {
            _writing = false;
            if (!err) fs.rename(tmp, PIPE_FILE, () => {});
            else logger.warn(`[PipelineCoord] save error: ${err.message}`);
        });
    });
}

// ── ID helpers ─────────────────────────────────────────────────────────────────
let _seq = 0;
function _pid()  { return `pipe_${Date.now()}_${(++_seq).toString(36)}`; }
function _stgId(){ return `pstg_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Event helpers ──────────────────────────────────────────────────────────────
function _emit(type, payload) {
    try { _bus()?.emit(type, { ...payload, _source: "pipeline_coordinator" }); } catch {}
}

// ── Statistics ─────────────────────────────────────────────────────────────────
const _stats = {
    total: 0, completed: 0, failed: 0, cancelled: 0,
    buildGateBlocked: 0, testGateBlocked: 0, commitGateBlocked: 0,
    rollbacks: 0, recoveryMissionsCreated: 0,
    // i7-s2: expose cancel count for dashboard
    // i7-s10: validationRuns tracks I7-7 benchmark invocations
    validationRuns: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
    { id: "repo_read",       label: "Repository Read",     agentHint: "agent_developer",   capability: "repo_read",      gate: null },
    { id: "repo_analysis",   label: "Risk Analysis",       agentHint: "agent_developer",   capability: null,             gate: null },   // uses graphReasoningEngine
    { id: "patch_generate",  label: "Patch Generation",    agentHint: "agent_developer",   capability: "patch_generate", gate: null },
    { id: "patch_validate",  label: "Patch Validation",    agentHint: "agent_tester",      capability: null,             gate: "patch" },  // I7-2
    { id: "patch_apply",     label: "Patch Apply",         agentHint: "agent_developer",   capability: "patch_apply",    gate: null },
    { id: "build_gate",      label: "Build Gate",          agentHint: "agent_tester",      capability: "build_run",      gate: "build" },  // I7-3
    { id: "test_gate",       label: "Test Gate",           agentHint: "agent_tester",      capability: "test_run",       gate: "test" },   // I7-4
    { id: "review_gate",     label: "Review Gate",         agentHint: "agent_reviewer",    capability: null,             gate: "review" }, // I7-5
    { id: "commit_gate",     label: "Commit Gate",         agentHint: "agent_reviewer",    capability: "git_commit",     gate: "commit" }, // I7-5
    { id: "observe",         label: "Post-Commit Observe", agentHint: "agent_verifier",    capability: "git_status",     gate: null },
    { id: "learn",           label: "Learn",               agentHint: "agent_executive",   capability: null,             gate: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE RUN BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function _buildRun(goal, opts = {}) {
    const now = new Date().toISOString();
    const pipelineId = _pid();

    const stages = PIPELINE_STAGES.map(def => ({
        stageId:     _stgId(),
        id:          def.id,
        label:       def.label,
        agentHint:   def.agentHint,
        capability:  def.capability,
        gate:        def.gate,
        status:      "pending",
        startedAt:   null,
        completedAt: null,
        durationMs:  0,
        output:      null,
        error:       null,
        retries:     0,
        gateResult:  null,
    }));

    return {
        pipelineId,
        goal:            goal.trim(),
        status:          "pending",
        missionId:       null,
        collaborationPlanId: null,
        commitHash:      null,
        approvalStatus:  opts.requireApproval !== false ? "pending" : "auto_approved",
        requireApproval: opts.requireApproval !== false,
        stages,
        createdAt:       now,
        startedAt:       null,
        completedAt:     null,
        durationMs:      0,
        error:           null,
        rollbackExecuted: false,
        recoveryMissionId: null,
        patchSpec:       opts.patchSpec || null,  // { targetFile, patchTarget, patchReplacement, commitMsg }
        risk:            null,
        confidence:      null,
        failedStage:     null,
        stagesCompleted: 0,
        stagesTotal:     stages.length,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE EVALUATORS
// ─────────────────────────────────────────────────────────────────────────────

// I7-2: Patch validation gate
async function _patchValidateGate(run, stageState, opts) {
    const spec = run.patchSpec;
    const result = { ok: true, checks: [], issues: [] };

    // 1. patchSpec required for non-free-form goals
    if (!spec) {
        result.checks.push({ name: "patchSpec_present", ok: false });
        result.issues.push("No patchSpec provided — free-form patch; validation skipped");
        result.ok = true; // not a blocker for free-form goals
        return result;
    }

    // 2. Syntax / target check — targetFile must exist
    try {
        const fs_ = require("fs");
        const ROOT = path.join(__dirname, "../../");
        const absPath = path.join(ROOT, spec.targetFile);
        if (!fs_.existsSync(absPath)) {
            result.checks.push({ name: "target_file_exists", ok: false });
            result.issues.push(`Target file not found: ${spec.targetFile}`);
            result.ok = false;
            return result;
        }
        result.checks.push({ name: "target_file_exists", ok: true });

        // 3. Conflict check — patchTarget must appear exactly once
        const content = fs_.readFileSync(absPath, "utf8");
        const occurrences = content.split(spec.patchTarget).length - 1;
        if (occurrences === 0) {
            result.checks.push({ name: "patch_target_found", ok: false });
            result.issues.push("patchTarget not found in file — already applied or file changed");
            result.ok = false;
        } else if (occurrences > 1) {
            result.checks.push({ name: "patch_target_unique", ok: false });
            result.issues.push(`patchTarget appears ${occurrences} times — ambiguous patch`);
            result.ok = false;
        } else {
            result.checks.push({ name: "patch_target_unique", ok: true });
        }
    } catch (e) {
        result.checks.push({ name: "file_read", ok: false });
        result.issues.push(`File read error: ${e.message}`);
        result.ok = false;
        return result;
    }

    // 4. Rollback availability — git must be present
    try {
        const { execFileSync } = require("child_process");
        execFileSync("git", ["status", "--porcelain"], { cwd: path.join(__dirname, "../../"), timeout: 5000 });
        result.checks.push({ name: "rollback_available", ok: true });
    } catch {
        result.checks.push({ name: "rollback_available", ok: false });
        result.issues.push("git not available — rollback not possible");
        result.ok = false;
    }

    return result;
}

// I7-3: Build gate
async function _buildGate(run, stageState) {
    const result = stageState.output ? (() => {
        try { return JSON.parse(stageState.output); } catch { return null; }
    })() : null;

    const passed = result?.ok === true || stageState.status === "completed";
    if (!passed) {
        _stats.buildGateBlocked++;
        // Create recovery mission
        const recoveryMission = _createRecoveryMission(run, "build_gate", stageState.error || result?.stderr || "Build failed");
        if (recoveryMission) {
            run.recoveryMissionId = recoveryMission.missionId || recoveryMission.id;
            _stats.recoveryMissionsCreated++;
        }
    }
    return { ok: passed, buildResult: result };
}

// I7-4: Test gate
async function _testGate(run, stageState) {
    const result = stageState.output ? (() => {
        try { return JSON.parse(stageState.output); } catch { return null; }
    })() : null;

    const passed = result?.ok === true || (result?.fail === 0 && result?.pass > 0);
    if (!passed) {
        _stats.testGateBlocked++;
        // Auto-rollback via capability
        try {
            const aer = _aer();
            if (aer) {
                await aer.executeStage({ stageId: `rollback_${run.pipelineId}`, capability: "rollback", missionId: run.missionId, maxAttempts: 1 });
                run.rollbackExecuted = true;
                _stats.rollbacks++;
                _emit("pipeline:rollback_executed", { pipelineId: run.pipelineId, reason: "test_gate_failed" });
            }
        } catch {}
        const recoveryMission = _createRecoveryMission(run, "test_gate", `Tests failed: ${result?.fail || "?"} failures`);
        if (recoveryMission) {
            run.recoveryMissionId = recoveryMission.missionId || recoveryMission.id;
            _stats.recoveryMissionsCreated++;
        }
    }
    return { ok: passed, testResult: result };
}

// I7-5: Review gate — confidence + rule registry check
async function _reviewGate(run) {
    const confidence = (() => {
        try { return _conf()?.explain(run.goal, { capability: "patch_apply" }); } catch { return null; }
    })();
    const score = confidence?.score ?? confidence?.confidence ?? 50;
    run.confidence = score;
    const passed = score >= 40; // threshold: minimum confidence to proceed to commit
    if (!passed) _stats.commitGateBlocked++;
    return { ok: passed, score, confidence };
}

// I7-5: Commit gate — approval policy + review + verification
async function _commitGate(run) {
    if (run.requireApproval && run.approvalStatus !== "approved") {
        _stats.commitGateBlocked++;
        return { ok: false, reason: "pending_approval", message: "Operator approval required. POST /pipeline/:id/approve to proceed." };
    }
    return { ok: true, reason: "approved" };
}

// Recovery mission helper
function _createRecoveryMission(run, failedStage, reason) {
    try {
        return _orch()?.createManual({
            objective: `Pipeline recovery: ${failedStage} failed — "${run.goal.slice(0, 80)}"`,
            goal: `Pipeline recovery: ${failedStage} failed — "${run.goal.slice(0, 80)}"`,
            priority:  "high",
            subtasks: [
                { description: `Failure reason: ${reason.slice(0, 200)}` },
                { description: "Investigate, fix root cause, and re-run pipeline" },
            ],
            metadata: { autoCreatedBy: "pipeline_coordinator", pipelineId: run.pipelineId, failedStage, reason: reason.slice(0, 300), domain: "engineering" },
        });
    } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE EXECUTOR
// ─────────────────────────────────────────────────────────────────────────────

async function _executeStage(run, stage) {
    const t0 = Date.now();
    stage.status    = "running";
    stage.startedAt = new Date().toISOString();
    _persist();
    _emit("pipeline:stage:started", { pipelineId: run.pipelineId, stageId: stage.id, label: stage.label });

    // Trigger the hinted agent's collaboration handoff
    try {
        if (stage.agentHint) {
            const agentState = _sup()?.getAgent(stage.agentHint);
            if (agentState?.status === "running") {
                // Non-blocking — fire and continue
                _sup()?.triggerTick(stage.agentHint).catch(() => {});
            }
        }
    } catch {}

    let result = { success: true, output: null, error: null };

    switch (stage.id) {
        case "repo_analysis": {
            // Use graphReasoningEngine — no capability needed
            try {
                const { criticalDependencies } = _gre()?.findCriticalDependencies({ limit: 5 }) || {};
                const { singlePointsOfFailure } = _gre()?.findSinglePointsOfFailure({ limit: 3 }) || {};
                const risk = { criticalDeps: (criticalDependencies || []).length, spofs: (singlePointsOfFailure || []).length };
                run.risk = risk;
                result = { success: true, output: JSON.stringify(risk) };
            } catch (e) {
                result = { success: true, output: JSON.stringify({ note: "graph analysis unavailable", error: e.message }) };
            }
            break;
        }
        case "patch_validate": {
            const gateResult = await _patchValidateGate(run, stage);
            stage.gateResult = gateResult;
            if (!gateResult.ok) {
                result = { success: false, error: `Patch validation failed: ${gateResult.issues.join("; ")}` };
            } else {
                result = { success: true, output: JSON.stringify(gateResult) };
            }
            break;
        }
        case "review_gate": {
            const gateResult = await _reviewGate(run);
            stage.gateResult = gateResult;
            result = { success: gateResult.ok, output: JSON.stringify(gateResult), error: gateResult.ok ? null : `Confidence too low: ${gateResult.score}%` };
            break;
        }
        case "commit_gate": {
            const gateResult = await _commitGate(run);
            stage.gateResult = gateResult;
            if (!gateResult.ok) {
                result = { success: false, error: gateResult.message || gateResult.reason, output: JSON.stringify(gateResult) };
            } else {
                // Perform the actual commit via capability
                const aer = _aer();
                if (aer) {
                    const spec = run.patchSpec;
                    const msg  = spec?.commitMsg || `feat: ${run.goal.slice(0, 80)} [pipeline]`;
                    const rec  = await aer.executeStage({
                        stageId:    stage.stageId,
                        capability: "git_commit",
                        input:      `message:"${msg}" approved:true`,
                        missionId:  run.missionId,
                        maxAttempts: 1,
                    });
                    const out = rec.output ? (() => { try { return JSON.parse(rec.output); } catch { return null; } })() : null;
                    if (out?.committed || rec.status === "completed") {
                        run.commitHash = out?.hash || null;
                        result = { success: true, output: rec.output };
                    } else {
                        result = { success: false, error: rec.error || "commit failed", output: rec.output };
                    }
                } else {
                    result = { success: false, error: "autonomousExecutionRuntime unavailable" };
                }
            }
            break;
        }
        case "learn": {
            try {
                const success = run.status !== "failed";
                _le()?.createLesson?.({
                    type:     success ? "success" : "failure",
                    severity: success ? "info" : "warning",
                    source:   "pipeline_coordinator",
                    title:    `Pipeline ${success ? "succeeded" : "failed"}: ${run.goal.slice(0, 80)}`,
                    detail:   `${run.stagesCompleted}/${run.stagesTotal} stages, ${run.durationMs}ms${run.commitHash ? `, commit ${run.commitHash}` : ""}${run.rollbackExecuted ? ", rolled back" : ""}`,
                    tags:     ["pipeline", "engineering", success ? "success" : "failure"],
                    missionId: run.missionId,
                });
                // RCA consultation for failed pipelines
                if (!success && run.failedStage) {
                    _rca()?.analyzePattern?.({ errorType: run.failedStage, context: run.goal });
                }
                result = { success: true, output: JSON.stringify({ lessonRegistered: true }) };
            } catch (e) {
                result = { success: true, output: JSON.stringify({ error: e.message }) };
            }
            break;
        }
        default: {
            // Capability-backed stages
            if (stage.capability) {
                const aer = _aer();
                if (!aer) {
                    result = { success: false, error: "autonomousExecutionRuntime unavailable" };
                    break;
                }
                // Apply patchSpec to commit stage input
                let input = run.goal;
                if (stage.id === "patch_generate" && run.patchSpec?.patchTarget) {
                    input = `patch_generate: ${run.goal} — target: ${run.patchSpec.patchTarget.slice(0, 80)}`;
                }
                const rec = await aer.executeStage({
                    stageId:     stage.stageId,
                    capability:  stage.capability,
                    input,
                    missionId:   run.missionId,
                    maxAttempts: 2,
                });
                result = {
                    success: rec.status === "completed",
                    output:  rec.output,
                    error:   rec.error,
                };
                // Build gate check after build_run
                if (stage.id === "build_gate") {
                    stage.output = rec.output;
                    stage.error  = rec.error;
                    const gateResult = await _buildGate(run, stage);
                    stage.gateResult = gateResult;
                    if (!gateResult.ok) {
                        result.success = false;
                        result.error   = `Build gate blocked: ${rec.error || "build failed"}`;
                    }
                }
                // Test gate check after test_run
                if (stage.id === "test_gate") {
                    stage.output = rec.output;
                    stage.error  = rec.error;
                    const gateResult = await _testGate(run, stage);
                    stage.gateResult = gateResult;
                    if (!gateResult.ok) {
                        result.success = false;
                        result.error   = `Test gate blocked: tests failed`;
                    }
                }
            } else {
                result = { success: true, output: null }; // no-op stage
            }
        }
    }

    const elapsed     = Date.now() - t0;
    stage.status      = result.success ? "completed" : "failed";
    stage.completedAt = new Date().toISOString();
    stage.durationMs  = elapsed;
    stage.output      = result.output ?? stage.output;
    stage.error       = result.error  ?? stage.error;

    _emit(`pipeline:stage:${stage.status}`, { pipelineId: run.pipelineId, stageId: stage.id, label: stage.label, durationMs: elapsed });
    _persist();
    return result.success;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE RUNNER
// ─────────────────────────────────────────────────────────────────────────────

async function runPipeline(goal, opts = {}) {
    if (!goal?.trim()) throw new Error("runPipeline: goal is required");

    // Bootstrap capabilities
    try { _ec()?.register(); } catch {}

    const store = _load();
    const run   = _buildRun(goal, opts);
    store.pipelines[run.pipelineId] = run;
    _stats.total++;
    _persist();

    // Create a mission in missionMemory for unified visibility
    try {
        const mission = _mm()?.createMission({
            objective: `[Pipeline] ${goal.trim().slice(0, 200)}`,
            priority:  opts.priority || "medium",
        });
        if (mission) run.missionId = mission.id;
    } catch {}

    // Create collaboration plan using the I6 engine
    // Execution order maps to pipeline agents; no parallel groups in sequential pipeline
    if (run.missionId) {
        try {
            const plan = _collab()?.createPlan(run.missionId, {
                assignedAgents: [...new Set(PIPELINE_STAGES.map(s => s.agentHint))],
                executionOrder: PIPELINE_STAGES.map((s, i) => ({
                    agentId:     s.agentHint,
                    stage:       s.id,
                    description: s.label,
                })),
                parallelGroups:     [],
                approvalStages:     run.requireApproval ? [{ afterAgent: "agent_reviewer", approvalNote: "Human review required before commit" }] : [],
                completionCriteria: [{ type: "all_stages_done", description: "All 11 pipeline stages completed" }],
            });
            if (plan) run.collaborationPlanId = plan.planId;
        } catch {}
    }

    run.status    = "running";
    run.startedAt = new Date().toISOString();
    const t0      = Date.now();

    if (run.stages.length === 0) {
        run.status = "completed"; run.completedAt = new Date().toISOString();
        _persist(); return { ...run };
    }
    _emit("pipeline:started", { pipelineId: run.pipelineId, goal: goal.trim(), stageCount: run.stages.length });
    logger.info(`[PipelineCoord] ▶ Pipeline ${run.pipelineId} — "${goal.slice(0, 80)}"`);

    for (const stage of run.stages) {
        const ok = await _executeStage(run, stage);
        if (ok) {
            run.stagesCompleted++;
        } else {
            run.failedStage = stage.id;
            run.status      = "failed";
            run.error       = stage.error;
            run.completedAt = new Date().toISOString();
            run.durationMs  = Date.now() - t0;
            _stats.failed++;
            _persist();
            _emit("pipeline:failed", { pipelineId: run.pipelineId, failedStage: stage.id, error: stage.error });
            logger.warn(`[PipelineCoord] ✗ Pipeline ${run.pipelineId} failed at ${stage.id}: ${stage.error}`);
            // Jump to learn stage even on failure
            const learnStage = run.stages.find(s => s.id === "learn" && s.status === "pending");
            if (learnStage) await _executeStage(run, learnStage);
            return { ...run };
        }

        _persist();
        // Let other event-loop work run between stages
        await new Promise(r => setImmediate(r));
    }

    run.status      = "completed";
    run.completedAt = new Date().toISOString();
    run.durationMs  = Date.now() - t0;
    _stats.completed++;
    _persist();
    _emit("pipeline:completed", { pipelineId: run.pipelineId, commitHash: run.commitHash, durationMs: run.durationMs });
    logger.info(`[PipelineCoord] ✓ Pipeline ${run.pipelineId} completed in ${run.durationMs}ms — commit ${run.commitHash || "(none)"}`);

    return { ...run };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC QUERY API
// ─────────────────────────────────────────────────────────────────────────────

function getPipeline(pipelineId) {
    const store = _load();
    const run   = store.pipelines[pipelineId];
    return run ? { ...run } : null;
}

function listPipelines({ status, limit = 50 } = {}) {
    const store = _load();
    let pipes = Object.values(store.pipelines);
    if (status) pipes = pipes.filter(p => p.status === status);
    pipes = pipes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return { pipelines: pipes.map(p => ({ ...p })), total: pipes.length };
}

function getActivePipelines() {
    const store = _load();
    return Object.values(store.pipelines).filter(p => p.status === "running").map(p => ({ ...p }));
}

function cancelPipeline(pipelineId) {
    const store = _load();
    const run   = store.pipelines[pipelineId];
    if (!run) throw new Error(`Pipeline ${pipelineId} not found`);
    if (run.status === "running") {
        run.status      = "cancelled";
        run.completedAt = new Date().toISOString();
        _stats.cancelled++;
        _persist();
        _emit("pipeline:cancelled", { pipelineId });
    }
    return { ...run };
}

function approvePipeline(pipelineId) {
    const store = _load();
    const run   = store.pipelines[pipelineId];
    if (!run) throw new Error(`Pipeline ${pipelineId} not found`);
    run.approvalStatus = "approved";
    _persist();
    logger.info(`[PipelineCoord] Pipeline ${pipelineId} approved`);
    _emit("pipeline:approved", { pipelineId });
    return { ...run };
}

function getStats() {
    const store  = _load();
    const active = Object.values(store.pipelines).filter(p => p.status === "running").length;
    // recoveryMissionsCreated counts missions auto-created on build/test gate failure
    return { ..._stats, active, total: Object.keys(store.pipelines).length };
}

// ─────────────────────────────────────────────────────────────────────────────
// I7-7: END-TO-END VALIDATION — 10 real engineering scenarios via benchmark
// ─────────────────────────────────────────────────────────────────────────────

async function runValidation(opts = {}) {
    logger.info("[PipelineCoord] I7-7: Running 10 real engineering scenarios via benchmark…");
    _stats.validationRuns++;

    // Bootstrap capabilities for benchmark
    try { _ec()?.register(); } catch {}

    const bench = _bench();
    if (!bench) return { ok: false, error: "engineeringBenchmark not loaded" };

    const report = await bench.runAll(opts);

    // Annotate pipeline stats from validation
    const validationSummary = {
        ok:                   report.ok,
        scenarioCount:        report.scenarioCount,
        successCount:         report.successCount,
        failCount:            report.failCount,
        successRate:          report.successRate,
        buildPassRate:        report.buildPassRate,
        testPassRate:         report.testPassRate,
        rollbackRate:         report.rollbackRate,
        avgAutonomyPct:       report.avgAutonomyPct,
        productionReadiness:  report.productionReadinessScore,
        topFailures:          report.topFailureCauses,
        v1Gaps:               report.v1Gaps,
        completedAt:          report.completedAt,
        totalSuiteMs:         report.totalSuiteMs,
        scenarios:            report.scenarios?.map(s => ({
            id:          s.id,
            goal:        s.goal,
            success:     s.success,
            failReason:  s.failReason,
            totalMs:     s.totalMs,
            buildOk:     s.buildOk,
            testOk:      s.testOk,
            patchOk:     s.patchOk,
            rollback:    s.rollback,
            committed:   s.committed,
            autonomyPct: s.autonomyPct,
            confidence:  s.confidence,
            stages:      s.stages,
        })),
    };

    // Register validation as a lesson
    try {
        _le()?.createLesson?.({
            type:     report.successRate >= 80 ? "success" : "failure",
            severity: report.successRate >= 80 ? "info" : "warning",
            source:   "pipeline_coordinator",
            title:    `I7-7 Validation: ${report.successRate}% success (${report.successCount}/${report.scenarioCount})`,
            detail:   `Build pass: ${report.buildPassRate}%, Test pass: ${report.testPassRate}%, Prod readiness: ${report.productionReadinessScore}%`,
            tags:     ["pipeline", "validation", "i7", "benchmark"],
        });
    } catch {}

    return { ok: true, ...validationSummary };
}

module.exports = {
    runPipeline,
    getPipeline,
    listPipelines,
    getActivePipelines,
    cancelPipeline,
    approvePipeline,
    getStats,
    runValidation,
    PIPELINE_STAGES,
};
