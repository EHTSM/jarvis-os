"use strict";
/**
 * rollbackManager — snapshot execution state and restore on failure.
 *
 * snapshot(executionId, stepId, state)   → snapshotId
 * restore(executionId, snapshotId?)      → { restored, snapshotId, stepId, state, ts } | { restored:false, reason }
 * rollback(executionId, steps?)          → { success, restoredTo, stepId, state, steps }
 * getHistory(executionId)                → rollback history entries
 * getSnapshots(executionId)              → all snapshots
 * canRollback(executionId)               → boolean
 * reset()
 */

const _snapshots = new Map();   // executionId → [{snapshotId, stepId, state, ts}]
const _history   = new Map();   // executionId → [{rollbackAt, restoredTo, steps}]
let   _seq       = 0;

// ── snapshot ──────────────────────────────────────────────────────────

function snapshot(executionId, stepId, state = {}) {
    const snapshotId = `snap-${executionId}-${++_seq}`;
    if (!_snapshots.has(executionId)) _snapshots.set(executionId, []);
    _snapshots.get(executionId).push({
        snapshotId,
        stepId,
        state:     JSON.parse(JSON.stringify(state)),   // deep clone
        ts:        new Date().toISOString(),
    });
    return snapshotId;
}

// ── restore ───────────────────────────────────────────────────────────

function restore(executionId, snapshotId = null) {
    const snaps = _snapshots.get(executionId) ?? [];
    if (snaps.length === 0) return { restored: false, reason: "no_snapshots" };

    const snap = snapshotId
        ? snaps.find(s => s.snapshotId === snapshotId)
        : snaps[snaps.length - 1];   // latest

    if (!snap) return { restored: false, reason: "snapshot_not_found" };

    return {
        restored:   true,
        snapshotId: snap.snapshotId,
        stepId:     snap.stepId,
        state:      JSON.parse(JSON.stringify(snap.state)),
        ts:         snap.ts,
    };
}

// ── rollback ──────────────────────────────────────────────────────────

function rollback(executionId, steps = null) {
    const result = restore(executionId);
    if (!result.restored) return { success: false, reason: result.reason };

    if (!_history.has(executionId)) _history.set(executionId, []);
    _history.get(executionId).push({
        rollbackAt:      new Date().toISOString(),
        restoredTo:      result.snapshotId,
        stepsRolledBack: steps ?? "all",
    });

    return {
        success:    true,
        restoredTo: result.snapshotId,
        stepId:     result.stepId,
        state:      result.state,
        steps:      steps ?? "all",
    };
}

// ── getters ────────────────────────────────────────────────────────────

function getHistory(executionId)  { return [...(_history.get(executionId)   ?? [])]; }
function getSnapshots(executionId){ return [...(_snapshots.get(executionId) ?? [])]; }
function canRollback(executionId) { return (_snapshots.get(executionId) ?? []).length > 0; }

function reset() { _snapshots.clear(); _history.clear(); _seq = 0; }

module.exports = { snapshot, restore, rollback, getHistory, getSnapshots, canRollback, reset };
