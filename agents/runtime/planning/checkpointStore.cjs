"use strict";
/**
 * checkpointStore — persist execution stage checkpoints.
 *
 * store(executionId, stage, data)
 * get(executionId, stage?)   → checkpoint(s)
 * list(executionId)          → all checkpoints for an execution
 * clear(executionId)
 * getAll()                   → { executionId: checkpoints[] }
 * reset()
 */

const STAGES = ["decompose", "simulate", "score", "select_strategy", "verify", "approve", "execute"];

// executionId → [{stage, data, ts}]
const _store = new Map();

function store(executionId, stage, data = {}) {
    if (!_store.has(executionId)) _store.set(executionId, []);
    _store.get(executionId).push({ stage, data, ts: new Date().toISOString() });
}

function get(executionId, stage = null) {
    const all = _store.get(executionId) ?? [];
    return stage ? all.filter(c => c.stage === stage) : [...all];
}

function list(executionId) { return get(executionId); }

function clear(executionId) { _store.delete(executionId); }

function getAll() {
    const out = {};
    for (const [id, cps] of _store.entries()) out[id] = cps;
    return out;
}

function reset() { _store.clear(); }

module.exports = { store, get, list, clear, getAll, reset, STAGES };
