"use strict";
/**
 * durableRecoveryCoordinator — crash-safe workflow recovery, reboot-safe replay
 * orchestration, partial execution continuation, recovery checkpoint validation,
 * and interrupted workflow stabilization.
 *
 * registerRecoveryCheckpoint(spec)              → { registered, checkpointId }
 * recoverInterruptedWorkflow(checkpointId)      → { recovered, checkpointId }
 * validateRecoveryIntegrity(checkpointId)       → { valid, checkpointId, issues }
 * reconstructInterruptedExecution(checkpointId) → ReconstructionResult
 * getRecoveryState()                            → RecoveryState
 * reset()
 */

const CHECKPOINT_STATUSES = ["pending", "recovering", "recovered", "failed", "quarantined"];

let _checkpoints = new Map();
let _counter     = 0;

// ── registerRecoveryCheckpoint ────────────────────────────────────────

function registerRecoveryCheckpoint(spec = {}) {
    const {
        workflowId       = null,
        executionId      = null,
        checkpointState  = null,
        replayConsistent = false,
        corrupted        = false,
        quarantined      = false,
        partialEvents    = [],
        lastKnownState   = null,
    } = spec;

    if (!workflowId)      return { registered: false, reason: "workflowId_required" };
    if (!checkpointState) return { registered: false, reason: "checkpointState_required" };

    const checkpointId = `chk-${++_counter}`;
    _checkpoints.set(checkpointId, {
        checkpointId,
        workflowId,
        executionId,
        checkpointState,
        replayConsistent,
        corrupted,
        quarantined,
        partialEvents:  [...partialEvents],
        lastKnownState,
        status:         "pending",
        registeredAt:   new Date().toISOString(),
        recoveredAt:    null,
    });

    return { registered: true, checkpointId, workflowId };
}

// ── validateRecoveryIntegrity ─────────────────────────────────────────

function validateRecoveryIntegrity(checkpointId) {
    const cp = _checkpoints.get(checkpointId);
    if (!cp) return { valid: false, reason: "checkpoint_not_found", checkpointId };

    const issues = [];
    if (cp.corrupted)         issues.push("checkpoint_corrupted");
    if (cp.quarantined)       issues.push("workflow_quarantined");
    if (!cp.replayConsistent) issues.push("replay_inconsistency_detected");

    return { valid: issues.length === 0, checkpointId, workflowId: cp.workflowId, issues };
}

// ── recoverInterruptedWorkflow ────────────────────────────────────────

function recoverInterruptedWorkflow(checkpointId) {
    const cp = _checkpoints.get(checkpointId);
    if (!cp) return { recovered: false, reason: "checkpoint_not_found" };

    const integrity = validateRecoveryIntegrity(checkpointId);
    if (!integrity.valid)
        return { recovered: false, checkpointId, reason: "integrity_failed", issues: integrity.issues };

    cp.status      = "recovered";
    cp.recoveredAt = new Date().toISOString();

    return {
        recovered:       true,
        checkpointId,
        workflowId:      cp.workflowId,
        executionId:     cp.executionId,
        checkpointState: cp.checkpointState,
        partialEvents:   cp.partialEvents.length,
        recoveredAt:     cp.recoveredAt,
    };
}

// ── reconstructInterruptedExecution ──────────────────────────────────

function reconstructInterruptedExecution(checkpointId) {
    const cp = _checkpoints.get(checkpointId);
    if (!cp) return { found: false, checkpointId };

    const integrity = validateRecoveryIntegrity(checkpointId);

    return {
        found:             true,
        checkpointId,
        workflowId:        cp.workflowId,
        executionId:       cp.executionId,
        checkpointState:   cp.checkpointState,
        lastKnownState:    cp.lastKnownState,
        partialEventCount: cp.partialEvents.length,
        replayConsistent:  cp.replayConsistent,
        integrityValid:    integrity.valid,
        integrityIssues:   integrity.issues,
        canResume:         integrity.valid,
    };
}

// ── getRecoveryState ──────────────────────────────────────────────────

function getRecoveryState() {
    const all = [..._checkpoints.values()];
    return {
        totalCheckpoints: all.length,
        pending:          all.filter(c => c.status      === "pending").length,
        recovered:        all.filter(c => c.status      === "recovered").length,
        failed:           all.filter(c => c.status      === "failed").length,
        quarantined:      all.filter(c => c.quarantined === true).length,
        corrupted:        all.filter(c => c.corrupted   === true).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _checkpoints = new Map();
    _counter     = 0;
}

module.exports = {
    CHECKPOINT_STATUSES,
    registerRecoveryCheckpoint, recoverInterruptedWorkflow,
    validateRecoveryIntegrity, reconstructInterruptedExecution,
    getRecoveryState, reset,
};
