"use strict";
/**
 * executionPersistence — persist live execution state per execution ID.
 *
 * save(executionId, state)
 * get(executionId)              → state or null
 * update(executionId, patch)    — merge patch
 * getAll()                      → all records
 * reset()
 *
 * state shape:
 *   { currentStep, exitCodes{}, stdoutSummaries{}, stderrSummaries{},
 *     runtimeMs, retryCounts{}, rollbackState }
 */

const _records = new Map();

function _defaults() {
    return {
        currentStep:      null,
        exitCodes:        {},
        stdoutSummaries:  {},
        stderrSummaries:  {},
        runtimeMs:        0,
        retryCounts:      {},
        rollbackState:    { triggered: false },
    };
}

function save(executionId, state = {}) {
    _records.set(executionId, {
        ..._defaults(),
        ...state,
        executionId,
        savedAt: new Date().toISOString(),
    });
}

function get(executionId) { return _records.get(executionId) ?? null; }

function update(executionId, patch = {}) {
    const base = _records.get(executionId) ?? { ..._defaults(), executionId };
    _records.set(executionId, { ...base, ...patch, updatedAt: new Date().toISOString() });
}

function getAll() { return [..._records.values()]; }
function reset()  { _records.clear(); }

module.exports = { save, get, update, getAll, reset };
