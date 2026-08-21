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
 *                                build_run, test_run, rollback, git_commit,
 *                                open_pr, security_scan, self_document,
 *                                frontend_heal
 *   selfHealingFrontend        — real Playwright-based frontend error
 *                                detection + confidence-gated auto-patch
 *                                (bridged via the frontend_heal capability)
 *   engineeringBenchmark       — I7-7 end-to-end validation (10 real scenarios)
 *   engineeringRuleRegistry    — patch/build/test rule consulting
 *   rootCauseAnalysisEngine    — failure root cause
 *   graphReasoningEngine       — affected component risk
 *   codeReviewEngine           — real static security analysis (detectSecurity)
 *   gitHubEngineeringAgent     — real GitHub PR creation (createPR)
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
 *   8  frontend_heal     — opt-in (opts.healUrl), non-blocking: bridges the
 *                          real selfHealingFrontend.heal() (Playwright error
 *                          detection + confidence-gated auto-patch) into the
 *                          pipeline instead of leaving it as a standalone
 *                          HTTP-only flow
 *   9  security_gate     — real static analysis (codeReviewEngine.detectSecurity)
 *                          on the target file; blocks on any CRITICAL finding
 *   10 review_gate       — I7-5: review status + confidence check
 *   11 commit_gate       — I7-5: require approval + review + verification
 *   12 open_pr           — opt-in (opts.openPR), non-blocking: real GitHub PR
 *                          via gitHubEngineeringAgent.createPR if the commit's
 *                          branch is already pushed; never pushes itself
 *   13 self_document     — non-blocking: real markdown doc generated from the
 *                          target file's actual exported functions + comments
 *   14 observe           — git status + diff post-commit
 *   15 learn             — lesson registration
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
function _agentReg() { try { return require("../../agents/runtime/agentRegistry.cjs");        } catch { return null; } }

// Maps a PIPELINE_STAGES agentHint (a descriptive role label — see stage
// defs above) to a real agentRegistry id, ONLY if that id is genuinely
// registered right now. agentHint values were never real registry ids
// (confirmed: agentRegistry has no "agent_developer" etc. — bootstrapRuntime
// registers real ids like "dev", "browser", "terminal"), so a direct
// pass-through would let learn-stage suggestions reference agents that
// don't exist. "dev" is the one real registered agent whose capabilities
// (["dev"]) match what agent_developer/agent_tester/agent_reviewer stages
// actually do in this pipeline (patch generation/apply, build, test).
const _AGENT_HINT_MAP = { agent_developer: "dev", agent_tester: "dev", agent_reviewer: "dev" };
function _resolveRealAgentId(agentHint) {
    const candidate = _AGENT_HINT_MAP[agentHint] || agentHint;
    const reg = _agentReg();
    return reg?.get?.(candidate) ? candidate : null;
}

// ── Persistence ────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, "../../data");
const PIPE_FILE = path.join(DATA_DIR, "engineering-pipelines.json");

let _store   = null;
let _writing = false;
let _dirty   = false;

function _load() {
    if (_store) return _store;
    try { _store = JSON.parse(fs.readFileSync(PIPE_FILE, "utf8")); }
    catch { _store = { pipelines: {} }; }
    if (!_store.pipelines) _store.pipelines = {};
    return _store;
}

// Real bug found while live-verifying the Software Engineering pipeline
// (FINAL-JARVIS-DREAM-CERTIFICATION.md P1): _persist() previously dropped
// any call that arrived while a write was already in flight — no queuing,
// just `if (_writing) return`. runPipeline() calls _persist() multiple
// times in quick succession (once per stage, plus once more on the
// terminal status transition), so the FINAL, most important call — the
// one recording "completed"/"failed" — could be silently dropped if an
// earlier per-stage write was still in flight, leaving the persisted file
// permanently stuck showing the second-to-last state. Confirmed live:
// data/engineering-pipelines.json showed status:"running" on a pipeline
// whose in-memory result (and console/log output) had already reached
// status:"failed" — the write that would have recorded that never landed.
function _persist() {
    _dirty = true;
    if (_writing) return;
    _writing = true;
    const _flush = () => {
        _dirty = false;
        const tmp = PIPE_FILE + ".tmp";
        fs.writeFile(tmp, JSON.stringify({ ..._store, savedAt: new Date().toISOString() }, null, 2), "utf8", err => {
            if (err) logger.warn(`[PipelineCoord] save error: ${err.message}`);
            fs.rename(tmp, PIPE_FILE, () => {
                if (_dirty) { setImmediate(_flush); }  // state changed again mid-write — flush the latest, don't drop it
                else { _writing = false; }
            });
        });
    };
    setImmediate(_flush);
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
    buildGateBlocked: 0, testGateBlocked: 0, commitGateBlocked: 0, securityGateBlocked: 0,
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
    { id: "frontend_heal",   label: "Frontend Self-Heal",  agentHint: "agent_tester",      capability: "frontend_heal",  gate: null },      // opt-in (opts.healUrl), non-blocking — bridges selfHealingFrontend.cjs into the pipeline
    { id: "security_gate",   label: "Security Gate",       agentHint: "agent_reviewer",    capability: "security_scan",  gate: "security" },
    { id: "review_gate",     label: "Review Gate",         agentHint: "agent_reviewer",    capability: null,             gate: "review" }, // I7-5
    { id: "commit_gate",     label: "Commit Gate",         agentHint: "agent_reviewer",    capability: "git_commit",     gate: "commit" }, // I7-5
    { id: "open_pr",         label: "Open Pull Request",   agentHint: "agent_reviewer",    capability: "open_pr",        gate: null },      // opt-in, non-blocking — see _executeStage's "open_pr" case
    { id: "self_document",   label: "Self-Document",       agentHint: "agent_developer",   capability: "self_document",  gate: null },      // non-blocking — real doc from the patched file's actual exports
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
        preCommitHash:   null,  // real rollback target — HEAD captured at repo_read, before any patch in this run
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
        openPR:          opts.openPR === true,   // opt-in — the open_pr stage no-ops unless explicitly requested
        prBase:          opts.prBase || "main",
        prUrl:           null,
        prNumber:        null,
        healUrl:         opts.healUrl || null,    // opt-in — the frontend_heal stage no-ops without a live URL to check
        healAutoApply:   opts.healAutoApply === true,
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
        // Residual Filesystem Path & Sensitive Error Leakage Deep Sweep
        // (2026-08-21): spec.targetFile is fully caller-controlled
        // (POST /pipeline/run, requireAuth-only) with no containment check
        // here — path.join resolves "../" segments normally, so a
        // targetFile like "../../../tmp/x" escapes ROOT entirely. A real
        // read failure on the resolved path (EACCES/EISDIR — existsSync
        // itself never throws) then leaked the absolute resolved path via
        // e.message below, live-reproduced with a safe scratch fixture.
        // Contained the same way exportFileService.cjs's resolveLocal()
        // already does — reused pattern, not a new mechanism.
        if (!absPath.startsWith(ROOT)) {
            result.checks.push({ name: "target_file_exists", ok: false });
            result.issues.push("Target file not found");
            result.ok = false;
            return result;
        }
        if (!fs_.existsSync(absPath)) {
            result.checks.push({ name: "target_file_exists", ok: false });
            result.issues.push(`Target file not found: ${spec.targetFile}`);
            result.ok = false;
            return result;
        }
        result.checks.push({ name: "target_file_exists", ok: true });

        // 3. Conflict check — patchTarget must appear exactly once.
        // Full-content specs (e.g. from /coding/refactor's apply mode —
        // see codingAssistant.js's _applyPatchSpecs "unify patch
        // generation" note) replace the whole file rather than a string
        // target, so there is no patchTarget to check for uniqueness; the
        // file-existence check above is this spec type's real validation.
        if (typeof spec.fullContent === "string") {
            result.checks.push({ name: "full_content_patch", ok: true });
        } else {
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
        }
    } catch (e) {
        // Full detail logged server-side; the caller-facing issue text
        // uses the already-safe, caller-relative spec.targetFile instead
        // of the raw fs error, which always embeds the absolute path.
        logger.warn(`[PipelineCoordinator] target file read failed: ${e.message}`);
        result.checks.push({ name: "file_read", ok: false });
        result.issues.push(`Could not read target file: ${spec.targetFile}`);
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
        // Real rollback via capability. At test_gate, commit_gate has not
        // run yet (it's a later stage), so nothing is committed — the
        // correct real rollback target is the specific patched file
        // (restore from HEAD), not a generic no-op. Falls back to the
        // legacy unstage-only behavior if no patchSpec.targetFile is known
        // (free-form goals with no tracked target file).
        try {
            const aer = _aer();
            if (aer) {
                const targetFile = run.patchSpec?.targetFile;
                const rbInput = targetFile ? `rollback:file=${targetFile}` : "";
                const rbRec = await aer.executeStage({ stageId: `rollback_${run.pipelineId}`, capability: "rollback", input: rbInput, missionId: run.missionId, maxAttempts: 1 });
                run.rollbackExecuted = rbRec.status === "completed";
                if (run.rollbackExecuted) _stats.rollbacks++;
                _emit("pipeline:rollback_executed", { pipelineId: run.pipelineId, reason: "test_gate_failed", verified: run.rollbackExecuted, target: targetFile || "(unstage_only)" });
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

// Security gate — real static analysis via codeReviewEngine.detectSecurity,
// blocks on any CRITICAL finding (eval, SQL injection, hardcoded secrets),
// same real-rollback response as the build/test gates on failure. High/
// medium/low findings do not block — they're recorded (via the
// security_scan capability's own remember() call) for human review but
// don't stop an otherwise-good patch, matching this pipeline's existing
// design of hard-blocking only on unambiguous failure (build/test) and
// soft-gating on judgment calls (review_gate's confidence threshold).
async function _securityGate(run, stageState) {
    const result = stageState.output ? (() => {
        try { return JSON.parse(stageState.output); } catch { return null; }
    })() : null;

    // No target file scanned (free-form goal) is not a failure — nothing
    // to block on.
    const passed = !result?.scanned || (result?.critical ?? 0) === 0;
    if (!passed) {
        _stats.securityGateBlocked++;
        try {
            const aer = _aer();
            if (aer) {
                const targetFile = run.patchSpec?.targetFile;
                const rbInput = targetFile ? `rollback:file=${targetFile}` : "";
                const rbRec = await aer.executeStage({ stageId: `rollback_${run.pipelineId}`, capability: "rollback", input: rbInput, missionId: run.missionId, maxAttempts: 1 });
                run.rollbackExecuted = rbRec.status === "completed";
                if (run.rollbackExecuted) _stats.rollbacks++;
                _emit("pipeline:rollback_executed", { pipelineId: run.pipelineId, reason: "security_gate_failed", verified: run.rollbackExecuted, target: targetFile || "(unstage_only)" });
            }
        } catch {}
        const recoveryMission = _createRecoveryMission(run, "security_gate", `${result?.critical || "?"} critical security finding(s) in ${result?.file || "target file"}`);
        if (recoveryMission) {
            run.recoveryMissionId = recoveryMission.missionId || recoveryMission.id;
            _stats.recoveryMissionsCreated++;
        }
    }
    return { ok: passed, securityResult: result };
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
        case "open_pr": {
            // Opt-in, non-blocking: only attempts a PR if the caller asked
            // for one (opts.openPR) AND a commit actually happened this
            // run. A declined/skipped/failed PR attempt never fails the
            // pipeline — the engineering change is already safely committed
            // regardless of whether a PR could be opened (e.g. branch not
            // yet pushed, no GITHUB_TOKEN configured). This mission's "no
            // push" constraint means this stage will routinely report a
            // clean, expected skip rather than a real PR in most runs.
            if (!run.openPR || !run.commitHash) {
                result = { success: true, output: JSON.stringify({ skipped: true, reason: !run.openPR ? "not requested (opts.openPR not set)" : "no commit was made this run" }) };
                break;
            }
            const aer = _aer();
            if (!aer) { result = { success: true, output: JSON.stringify({ skipped: true, reason: "autonomousExecutionRuntime unavailable" }) }; break; }
            const spec = run.patchSpec;
            const prTitle = spec?.commitMsg || `feat: ${run.goal.slice(0, 80)} [pipeline]`;
            const rec = await aer.executeStage({
                stageId:    stage.stageId,
                capability: "open_pr",
                input:      `title:"${prTitle}" base:${run.prBase || "main"}`,
                missionId:  run.missionId,
                maxAttempts: 1,
            });
            const out = rec.output ? (() => { try { return JSON.parse(rec.output); } catch { return null; } })() : null;
            if (out?.opened) {
                run.prUrl = out.url;
                run.prNumber = out.number;
            }
            // Never blocks the pipeline — always reports success at the
            // stage level, with the real outcome (opened vs. declined)
            // recorded in the output for visibility.
            result = { success: true, output: rec.output || JSON.stringify({ skipped: true, reason: rec.error || "PR not opened" }) };
            break;
        }
        case "learn": {
            // Autonomous Learning Engine V2 — this stage already recorded a
            // lesson and (nominally) consulted RCA; it never actually fed
            // the result back into anything that changes future behavior.
            // Three additive fixes, all reusing existing systems as-is:
            //  1. `_rca()?.analyzePattern?.()` was a dead call — that method
            //     does not exist on rootCauseAnalysisEngine's real export
            //     surface (verified: module.exports lists runAnalysis,
            //     getAnalysis, listAnalyses, recordFixSuccess, listPlaybooks,
            //     getStats, invalidate — no analyzePattern). Silently no-op'd
            //     via optional chaining, so RCA was never actually invoked on
            //     pipeline failure. Fixed to call the real runAnalysis({force})
            //     — RCA's actual designed entry point for a fresh corpus scan.
            //  2. engineeringRuleRegistry.extractFromMission(missionId) was
            //     never called from here — the pipeline's own missionId is
            //     already available (run.missionId), so on success this now
            //     promotes real rule candidates from this mission's decisions,
            //     exactly like extractFromMission is used elsewhere.
            //  3. continuousLearningEngine.applyLearningRecord() existed but
            //     had zero real callers anywhere in the codebase — a fully
            //     built, human-approval-gated write-back with no path to
            //     reach it. It still cannot self-apply (approvedBy is
            //     required by design — "no self-applied learning"), so this
            //     does not call it directly. Instead it attaches a structured
            //     `suggestedAction` to the lesson so a human/operator can
            //     approve it via the new POST /p19/learn/lessons/:id/apply
            //     route, closing the loop without weakening the safety gate.
            let lessonId = null;
            try {
                const success = run.status !== "failed";
                const created = _le()?.createLesson?.({
                    type:     success ? "success" : "failure",
                    severity: success ? "info" : "warning",
                    source:   "pipeline_coordinator",
                    title:    `Pipeline ${success ? "succeeded" : "failed"}: ${run.goal.slice(0, 80)}`,
                    detail:   `${run.stagesCompleted}/${run.stagesTotal} stages, ${run.durationMs}ms${run.commitHash ? `, commit ${run.commitHash}` : ""}${run.rollbackExecuted ? ", rolled back" : ""}`,
                    tags:     ["pipeline", "engineering", success ? "success" : "failure"],
                    missionId: run.missionId,
                    agentId:  run.agentHint || null,
                });
                lessonId = created?.lessonId || null;

                // Suggested action: nudge the preferenceWeight of the agent
                // that actually did the work (patch_apply's agentHint), in
                // the direction of the real outcome. Small, bounded, and
                // only ever applied after human approval. PIPELINE_STAGES'
                // agentHint values (agent_developer, agent_tester, ...) are
                // descriptive role labels, NOT real agentRegistry ids — a
                // real registry lookup (via agentRegistry.get, the same
                // check applyLearningRecord itself performs) confirms
                // whether one exists before attaching anything, so this
                // never proposes an action against a non-existent agent.
                const applyStage = run.stages?.find(s => s.id === "patch_apply");
                if (lessonId && applyStage?.agentHint) {
                    const realAgentId = _resolveRealAgentId(applyStage.agentHint);
                    if (realAgentId) {
                        _le()?.attachSuggestedAction?.(lessonId, {
                            agentId: realAgentId,
                            weightDelta: success ? 0.05 : -0.05,
                        });
                    }
                }

                let ruleExtraction = null;
                let rcaTriggered = false;
                if (success && run.missionId) {
                    ruleExtraction = _rules()?.extractFromMission?.(run.missionId) || null;
                } else if (!success && run.failedStage) {
                    _rca()?.runAnalysis?.({ force: true });
                    rcaTriggered = true;
                }

                result = { success: true, output: JSON.stringify({ lessonRegistered: true, lessonId, rulesExtracted: ruleExtraction?.extracted || 0, rcaTriggered }) };
            } catch (e) {
                result = { success: true, output: JSON.stringify({ error: e.message, lessonId }) };
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
                if ((stage.id === "security_gate" || stage.id === "self_document") && run.patchSpec?.targetFile) {
                    input = `file:${run.patchSpec.targetFile}`;
                }
                if (stage.id === "frontend_heal" && run.healUrl) {
                    input = `url:${run.healUrl}${run.healAutoApply ? " autoApply:true" : ""}`;
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
                // Capture the pre-patch HEAD from repo_read — this is the
                // real rollback target used later if a commit needs
                // reverting (see _rollback:commit= in engineeringCapabilities.cjs).
                if (stage.id === "repo_read" && result.success && result.output) {
                    try { run.preCommitHash = JSON.parse(result.output).headCommit || null; } catch {}
                }
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
                // Security gate check after security_scan
                if (stage.id === "security_gate") {
                    stage.output = rec.output;
                    stage.error  = rec.error;
                    const gateResult = await _securityGate(run, stage);
                    stage.gateResult = gateResult;
                    if (!gateResult.ok) {
                        result.success = false;
                        result.error   = `Security gate blocked: ${gateResult.securityResult?.critical || "?"} critical finding(s)`;
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
                completionCriteria: [{ type: "all_stages_done", description: `All ${PIPELINE_STAGES.length} pipeline stages completed` }],
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
