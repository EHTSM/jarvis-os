"use strict";
/**
 * deterministicRecoveryBoundary — recovery checkpoints and deterministic rollback
 * boundaries with replay-safety validation and corruption prevention.
 *
 * createRecoveryBoundary(spec)           → { created, boundaryId, executionChainId, replaySafe }
 * validateRecoveryBoundary(id, opts)     → { valid, boundaryId, hashMatches, corruptionDetected, reason }
 * rollbackToBoundary(id, opts)           → { rolledBack, boundaryId, executionChainId, rollbackDepth }
 * listBoundaries(filter)                 → BoundaryRecord[]
 * getBoundaryState(boundaryId)           → BoundaryRecord | null
 * reset()
 */

let _boundaries = new Map();
let _counter    = 0;

function createRecoveryBoundary(spec = {}) {
    const {
        executionChainId = null,
        snapshotHash     = null,
        replaySafe       = true,
        rollbackDepth    = 0,
        metadata         = {},
    } = spec;

    if (!executionChainId)
        return { created: false, reason: "executionChainId_required" };

    const boundaryId = `bnd-${++_counter}`;
    const record = {
        boundaryId,
        executionChainId,
        snapshotHash,
        replaySafe,
        rollbackDepth,
        metadata:           { ...metadata },
        corruptionDetected: false,
        rollbackCount:      0,
        status:             "active",
        createdAt:          new Date().toISOString(),
        validatedAt:        null,
        rolledBackAt:       null,
    };

    _boundaries.set(boundaryId, record);
    return { created: true, boundaryId, executionChainId, replaySafe };
}

function validateRecoveryBoundary(boundaryId, opts = {}) {
    const record = _boundaries.get(boundaryId);
    if (!record) return { valid: false, reason: "boundary_not_found" };

    const hashMatches  = opts.currentHash == null || opts.currentHash === record.snapshotHash;
    const notCorrupted = !record.corruptionDetected;
    const replaySafe   = record.replaySafe;

    if (!hashMatches) record.corruptionDetected = true;

    record.validatedAt = new Date().toISOString();

    const valid = hashMatches && notCorrupted && replaySafe;
    return {
        valid,
        boundaryId,
        hashMatches,
        corruptionDetected: record.corruptionDetected,
        replaySafe,
        reason: !hashMatches  ? "hash_mismatch"
              : !notCorrupted ? "corruption_detected"
              : !replaySafe   ? "not_replay_safe"
              :                 null,
    };
}

function rollbackToBoundary(boundaryId, opts = {}) {
    const record = _boundaries.get(boundaryId);
    if (!record)                     return { rolledBack: false, reason: "boundary_not_found" };
    if (record.corruptionDetected)   return { rolledBack: false, reason: "boundary_corrupted" };
    if (!record.replaySafe && !opts.forceUnsafe)
                                     return { rolledBack: false, reason: "not_replay_safe" };
    if (record.status === "consumed") return { rolledBack: false, reason: "boundary_consumed" };

    record.rollbackCount++;
    record.rolledBackAt = new Date().toISOString();
    if (!opts.keepActive) record.status = "consumed";

    return {
        rolledBack:       true,
        boundaryId,
        executionChainId: record.executionChainId,
        rollbackDepth:    record.rollbackDepth,
        rollbackCount:    record.rollbackCount,
    };
}

function listBoundaries(filter = {}) {
    let boundaries = [..._boundaries.values()];
    if (filter.executionChainId)   boundaries = boundaries.filter(b => b.executionChainId === filter.executionChainId);
    if (filter.status)             boundaries = boundaries.filter(b => b.status           === filter.status);
    if (filter.replaySafe != null) boundaries = boundaries.filter(b => b.replaySafe       === filter.replaySafe);
    return boundaries.map(b => ({ ...b }));
}

function getBoundaryState(boundaryId) {
    const record = _boundaries.get(boundaryId);
    return record ? { ...record } : null;
}

function reset() {
    _boundaries = new Map();
    _counter    = 0;
}

module.exports = {
    createRecoveryBoundary, validateRecoveryBoundary, rollbackToBoundary,
    listBoundaries, getBoundaryState, reset,
};
