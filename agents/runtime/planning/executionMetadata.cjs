"use strict";
/**
 * executionMetadata — persist execution-level metadata per execution ID.
 *
 * record(executionId, meta)   — create/overwrite record
 * get(executionId)            → metadata or null
 * update(executionId, patch)  — merge patch into existing record
 * list()                      → all records
 * reset()
 */

const _records = new Map();

function record(executionId, meta = {}) {
    _records.set(executionId, {
        executionId,
        strategy:            meta.strategy            ?? null,
        feasibilityScore:    meta.feasibilityScore    ?? null,
        simBlockers:         meta.simBlockers         ?? [],
        repairProbability:   meta.repairProbability   ?? null,
        rollbackProbability: meta.rollbackProbability ?? null,
        confidence:          meta.confidence          ?? null,
        ...meta,
        executionId,   // ensure not overwritten by spread
        recordedAt: new Date().toISOString(),
    });
}

function get(executionId) {
    return _records.get(executionId) ?? null;
}

function update(executionId, patch = {}) {
    const existing = _records.get(executionId) ?? { executionId };
    _records.set(executionId, { ...existing, ...patch, updatedAt: new Date().toISOString() });
}

function list() { return [..._records.values()]; }

function reset() { _records.clear(); }

module.exports = { record, get, update, list, reset };
