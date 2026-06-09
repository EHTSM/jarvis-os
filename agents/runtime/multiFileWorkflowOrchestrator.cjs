"use strict";
/**
 * V2 Phase 2 — Multi-File Engineering Workflow Orchestrator
 *
 * Chains: Planner → Code Stage → Patch Proposal → Apply → Verify → Review
 *
 * Single entry point for multi-file tasks. Handles:
 * - File selection and context collection
 * - Atomic patch set creation
 * - Dependency-aware validation
 * - Single verification pass
 * - Rollback on failure
 *
 * State: data/workflow-execution-log.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const LOG_PATH = path.join(__dirname, "../../data/workflow-execution-log.json");

function _loadLog() {
    try { return JSON.parse(fs.readFileSync(LOG_PATH, "utf8")); }
    catch { return { executions: [] }; }
}

function _saveLog(db) {
    try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); fs.writeFileSync(LOG_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Multi-file task execution ─────────────────────────────────────────────────

/**
 * Execute a multi-file engineering workflow.
 *
 * @param {object} task
 * @param {string} task.description - overall goal
 * @param {Array<string>} task.targetFiles - absolute paths to modify
 * @param {object} opts
 * @param {string} [opts.sessionId]
 * @param {string} [opts.operatorId]
 * @param {string} [opts.verifyCommand] - test command to run
 * @returns {Promise<{executionId, status, phases[], result}>}
 */
async function executeMultiFileTask(task, opts = {}) {
    if (!task.description || !Array.isArray(task.targetFiles)) {
        return { ok: false, error: "description and targetFiles required" };
    }

    const { sessionId = null, operatorId = null, verifyCommand = "node --test tests/runtime/01-taskRouter.test.cjs" } = opts;
    const executionId = crypto.randomUUID();
    const phases = [];
    const log = _loadLog();

    try {
        // Phase 1: Collect file context
        phases.push(await _phase1_CollectContext(task.targetFiles, executionId));

        // Phase 2: Plan (already done via planner.cjs, this confirms target files)
        phases.push({
            phase: "plan",
            status: "completed",
            targetFiles: task.targetFiles,
            fileCount: task.targetFiles.length,
        });

        // Phase 3: Code stage generates patches (simulated — real code comes from Claude)
        phases.push({
            phase: "code",
            status: "pending",
            description: task.description,
            contextReady: true,
        });

        // Phase 4: Propose patch set
        const patchAssistant = _tryRequire("./patchAssistant.cjs");
        if (!patchAssistant) throw new Error("patchAssistant unavailable");

        // This would be populated by the Code stage in real use
        const patchProposal = {
            phase: "patch_propose",
            status: "pending",
            message: "Awaiting patch proposals from code stage",
        };
        phases.push(patchProposal);

        // Phase 5: Validate patch set
        phases.push({
            phase: "validate",
            status: "pending",
            message: "Awaiting patch validation",
        });

        // Phase 6: Apply patch set
        phases.push({
            phase: "apply",
            status: "pending",
            requiresApproval: true,
        });

        // Phase 7: Verify against entire change set
        phases.push({
            phase: "verify",
            status: "pending",
            verifyCommand,
            atomicVerification: true,
        });

        // Phase 8: Review change set
        phases.push({
            phase: "review",
            status: "pending",
            changeSetSize: task.targetFiles.length,
        });

        // Record execution
        const execution = {
            executionId,
            taskDescription: task.description,
            targetFiles: task.targetFiles,
            fileCount: task.targetFiles.length,
            sessionId,
            operatorId,
            phases,
            startedAt: Date.now(),
            completedAt: null,
            status: "in_progress",
        };

        log.executions.unshift(execution);
        if (log.executions.length > 50) log.executions = log.executions.slice(0, 50);
        _saveLog(log);

        return {
            ok: true,
            executionId,
            status: "initialized",
            phases,
            nextAction: "Code stage: generate patches for target files",
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function _phase1_CollectContext(targetFiles, executionId) {
    const contexts = [];
    const errors = [];

    for (const filePath of targetFiles) {
        try {
            const content = fs.readFileSync(filePath, "utf8");
            contexts.push({
                filePath,
                size: content.length,
                lines: content.split("\n").length,
                hash: require("crypto").createHash("sha256").update(content).digest("hex").slice(0, 16),
            });
        } catch (e) {
            errors.push({ filePath, error: e.message });
        }
    }

    return {
        phase: "context_collection",
        status: errors.length === 0 ? "completed" : "partial",
        collected: contexts.length,
        failed: errors.length,
        contexts,
        errors: errors.length > 0 ? errors : undefined,
    };
}

/**
 * Propose patches for a multi-file task.
 * Called after Code stage generates patches.
 *
 * @param {string} executionId
 * @param {Array<{filePath, patchedContent, reason}>} patches
 * @param {object} opts
 * @returns {Promise<{ok, setId, fileCount, diffs}>}
 */
async function proposePatchesForExecution(executionId, patches, opts = {}) {
    const patchAssistant = _tryRequire("./patchAssistant.cjs");
    if (!patchAssistant) return { ok: false, error: "patchAssistant unavailable" };

    const { operatorId = null, reason = "" } = opts;

    const result = patchAssistant.proposeSet(patches, {
        reason: reason || `Execution ${executionId}`,
        operatorId,
    });

    if (!result.ok) return result;

    // Update execution record
    const log = _loadLog();
    const exec = log.executions.find(e => e.executionId === executionId);
    if (exec) {
        const patchPhase = exec.phases.find(p => p.phase === "patch_propose");
        if (patchPhase) {
            patchPhase.status = "completed";
            patchPhase.setId = result.setId;
            patchPhase.patchIds = result.patchIds;
            patchPhase.fileCount = result.fileCount;
        }
        _saveLog(log);
    }

    return result;
}

/**
 * Apply all patches for an execution (atomic).
 *
 * @param {string} executionId
 * @param {string} setId
 * @param {{ approved, operatorId }} opts
 * @returns {Promise<{ok, setId, applied}>}
 */
async function applyPatchesForExecution(executionId, setId, opts = {}) {
    const patchAssistant = _tryRequire("./patchAssistant.cjs");
    if (!patchAssistant) return { ok: false, error: "patchAssistant unavailable" };

    const result = patchAssistant.applySet(setId, opts);

    if (result.ok) {
        const log = _loadLog();
        const exec = log.executions.find(e => e.executionId === executionId);
        if (exec) {
            const applyPhase = exec.phases.find(p => p.phase === "apply");
            if (applyPhase) {
                applyPhase.status = "completed";
                applyPhase.setId = setId;
                applyPhase.applied = result.fileCount;
            }
        }
        _saveLog(log);
    }

    return result;
}

/**
 * Verify patch set atomically (once against all files).
 *
 * @param {string} executionId
 * @param {string} setId
 * @param {{ command, autoRollback }} opts
 * @returns {Promise<{ok, verified, pass, fail, summary}>}
 */
async function verifyPatchSetForExecution(executionId, setId, opts = {}) {
    const patchAssistant = _tryRequire("./patchAssistant.cjs");
    if (!patchAssistant) return { ok: false, error: "patchAssistant unavailable" };

    const result = await patchAssistant.verifySet(setId, opts);

    if (result.verified) {
        const log = _loadLog();
        const exec = log.executions.find(e => e.executionId === executionId);
        if (exec) {
            const verifyPhase = exec.phases.find(p => p.phase === "verify");
            if (verifyPhase) {
                verifyPhase.status = "completed";
                verifyPhase.verdict = result.testsPassed ? "PASS" : "FAIL";
                verifyPhase.pass = result.pass;
                verifyPhase.fail = result.fail;
                verifyPhase.summary = result.summary;
            }
        }
        _saveLog(log);
    }

    return result;
}

/**
 * Get full execution state.
 */
function getExecution(executionId) {
    const log = _loadLog();
    return log.executions.find(e => e.executionId === executionId) ?? null;
}

/**
 * List recent executions.
 */
function listExecutions({ limit = 20 } = {}) {
    const log = _loadLog();
    return log.executions.slice(0, limit);
}

module.exports = {
    executeMultiFileTask,
    proposePatchesForExecution,
    applyPatchesForExecution,
    verifyPatchSetForExecution,
    getExecution,
    listExecutions,
};
