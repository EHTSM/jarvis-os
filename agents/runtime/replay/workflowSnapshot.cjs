"use strict";
/**
 * workflowSnapshot — capture full execution state for replay.
 *
 * capture(workflowId, name, steps[], ctx, result) → snapshot
 * store(snapshot)    — add to in-memory store
 * get(snapshotId)    → snapshot or null
 * list(workflowId?)  → all snapshots (optionally filtered)
 * latest(workflowId) → most recent snapshot for a workflow
 * remove(snapshotId) → boolean
 * reset()
 */

let _store = new Map();   // snapshotId → snapshot
let _seq   = 0;

function capture(workflowId, name, steps, ctx, result) {
    const snapshotId = `snap-${workflowId}-${++_seq}`;

    // Serialize ctx (strip non-serializable values)
    let ctxSnap;
    try { ctxSnap = JSON.parse(JSON.stringify(ctx || {})); }
    catch { ctxSnap = {}; }

    const stepMeta = (steps || []).map(s => ({
        name:      s.name,
        hasExecute:  typeof s.execute  === "function",
        hasRollback: typeof s.rollback === "function",
        hasDryRun:   typeof s.dryRun   === "function",
    }));

    return {
        snapshotId,
        workflowId,
        name,
        capturedAt:  new Date().toISOString(),
        capturedSeq: _seq,
        stepCount:   steps?.length ?? 0,
        stepMeta,
        ctx:         ctxSnap,
        result: result ? {
            success:     result.success,
            healthScore: result.healthScore,
            stepDetails: result.stepDetails?.map(d => ({
                name:       d.name,
                status:     d.status,
                attempts:   d.attempts,
                recoveries: d.recoveries,
                durationMs: d.durationMs,
            })),
        } : null,
        // Keep a reference to original steps for replay (in-memory only)
        _steps: steps,
    };
}

function store(snapshot) {
    _store.set(snapshot.snapshotId, snapshot);
    return snapshot.snapshotId;
}

function get(snapshotId) {
    return _store.get(snapshotId) || null;
}

function list(workflowId) {
    const all = [..._store.values()];
    return workflowId
        ? all.filter(s => s.workflowId === workflowId)
        : all;
}

function latest(workflowId) {
    const wfSnaps = list(workflowId);
    if (wfSnaps.length === 0) return null;
    return wfSnaps.sort((a, b) => {
        const tsDiff = new Date(b.capturedAt) - new Date(a.capturedAt);
        return tsDiff !== 0 ? tsDiff : (b.capturedSeq || 0) - (a.capturedSeq || 0);
    })[0];
}

function remove(snapshotId) {
    return _store.delete(snapshotId);
}

function reset() { _store = new Map(); _seq = 0; }

module.exports = { capture, store, get, list, latest, remove, reset };
