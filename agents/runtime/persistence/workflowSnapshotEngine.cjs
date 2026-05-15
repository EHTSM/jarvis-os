"use strict";
/**
 * workflowSnapshotEngine — durable workflow snapshots, point-in-time state
 * recovery, replay acceleration, snapshot compaction, and state checkpointing.
 *
 * createSnapshot(spec)             → { created, snapshotId, workflowId }
 * loadSnapshot(snapshotId)         → Snapshot | { found: false }
 * validateSnapshot(snapshotId)     → { valid, snapshotId, issues }
 * restoreWorkflowState(snapshotId) → { restored, workflowId, workflowState }
 * compactSnapshots(workflowId)     → { compacted, retained, removed }
 * getSnapshotMetrics()             → SnapshotMetrics
 * reset()
 */

const VALID_WORKFLOW_STATES = [
    "created", "scheduled", "admitted", "running",
    "blocked", "recovering", "stabilized",
    "completed", "failed", "quarantined", "cancelled",
];

let _snapshots = new Map();   // workflowId → Snapshot[]
let _counter   = 0;

// ── createSnapshot ────────────────────────────────────────────────────

function createSnapshot(spec = {}) {
    const {
        workflowId        = null,
        workflowState     = null,
        executionGraph    = null,
        schedulerState    = null,
        recoveryState     = null,
        verificationState = null,
    } = spec;

    if (!workflowId)    return { created: false, reason: "workflowId_required" };
    if (!workflowState) return { created: false, reason: "workflowState_required" };
    if (!VALID_WORKFLOW_STATES.includes(workflowState))
        return { created: false, reason: `invalid_workflow_state: ${workflowState}` };

    const snapId = `snap-${++_counter}`;
    const entry  = {
        snapshotId:        snapId,
        workflowId,
        workflowState,
        executionGraph:    executionGraph    ?? null,
        schedulerState:    schedulerState    ?? null,
        recoveryState:     recoveryState     ?? null,
        verificationState: verificationState ?? null,
        createdAt:         new Date().toISOString(),
    };

    if (!_snapshots.has(workflowId)) _snapshots.set(workflowId, []);
    _snapshots.get(workflowId).push(entry);

    return { created: true, snapshotId: snapId, workflowId, workflowState };
}

// ── loadSnapshot ──────────────────────────────────────────────────────

function loadSnapshot(snapshotId) {
    for (const snaps of _snapshots.values()) {
        const s = snaps.find(x => x.snapshotId === snapshotId);
        if (s) return { found: true, ...s };
    }
    return { found: false, snapshotId };
}

// ── validateSnapshot ──────────────────────────────────────────────────

function validateSnapshot(snapshotId) {
    const snap = loadSnapshot(snapshotId);
    if (!snap.found) return { valid: false, reason: "snapshot_not_found", snapshotId };

    const issues = [];
    if (!snap.workflowId)    issues.push("missing_workflowId");
    if (!snap.workflowState) issues.push("missing_workflowState");
    if (snap.workflowState && !VALID_WORKFLOW_STATES.includes(snap.workflowState))
        issues.push(`invalid_state: ${snap.workflowState}`);

    return { valid: issues.length === 0, snapshotId, workflowId: snap.workflowId, issues };
}

// ── restoreWorkflowState ──────────────────────────────────────────────

function restoreWorkflowState(snapshotId) {
    const snap = loadSnapshot(snapshotId);
    if (!snap.found) return { restored: false, reason: "snapshot_not_found" };

    const validation = validateSnapshot(snapshotId);
    if (!validation.valid)
        return { restored: false, reason: "snapshot_invalid", issues: validation.issues };

    return {
        restored:          true,
        snapshotId,
        workflowId:        snap.workflowId,
        workflowState:     snap.workflowState,
        executionGraph:    snap.executionGraph,
        schedulerState:    snap.schedulerState,
        recoveryState:     snap.recoveryState,
        verificationState: snap.verificationState,
        restoredAt:        new Date().toISOString(),
    };
}

// ── compactSnapshots ──────────────────────────────────────────────────

function compactSnapshots(workflowId) {
    const snaps = _snapshots.get(workflowId);
    if (!snaps || snaps.length === 0) return { compacted: false, reason: "no_snapshots_found" };

    const before = snaps.length;
    const latest = snaps[snaps.length - 1];
    _snapshots.set(workflowId, [latest]);

    return { compacted: true, workflowId, retained: 1, removed: before - 1 };
}

// ── getSnapshotMetrics ────────────────────────────────────────────────

function getSnapshotMetrics() {
    let total  = 0;
    const byState = {};
    for (const snaps of _snapshots.values()) {
        total += snaps.length;
        for (const s of snaps)
            byState[s.workflowState] = (byState[s.workflowState] ?? 0) + 1;
    }
    return { totalSnapshots: total, uniqueWorkflows: _snapshots.size, byState };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _snapshots = new Map();
    _counter   = 0;
}

module.exports = {
    VALID_WORKFLOW_STATES,
    createSnapshot, loadSnapshot, validateSnapshot,
    restoreWorkflowState, compactSnapshots, getSnapshotMetrics, reset,
};
