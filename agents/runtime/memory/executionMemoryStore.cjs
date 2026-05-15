"use strict";
/**
 * executionMemoryStore — append-only store for execution history.
 *
 * record(entry)               → stored entry (with id + ts stamped)
 * getSuccessful(limit?)       → successful entries
 * getFailed(limit?)           → failed entries
 * getRecoveryPatterns()       → entries where rollbackTriggered
 * getRetryPatterns()          → entries where retryCount > 0
 * getDependencyFailures()     → entries whose failureReason mentions dep/install/package
 * getDurationHistory(taskId?) → [{taskId, durationMs, ts}]
 * getAll()                    → all entries
 * reset()
 *
 * Entry shape (all fields optional except where noted):
 *   executionId, taskId, strategy, success (required), durationMs,
 *   steps[], retryCount, rollbackTriggered, failureReason, fingerprint, state
 */

const _store = [];
let   _seq   = 0;

const DEP_RE = /dep(endenc)?|install|package/i;

function record(entry) {
    const e = {
        retryCount:        0,
        rollbackTriggered: false,
        ...entry,
        id: `mem-${++_seq}`,
        ts: new Date().toISOString(),
    };
    _store.push(e);
    return e;
}

function getSuccessful(limit = null) {
    const r = _store.filter(e => e.success);
    return limit ? r.slice(-limit) : [...r];
}

function getFailed(limit = null) {
    const r = _store.filter(e => !e.success);
    return limit ? r.slice(-limit) : [...r];
}

function getRecoveryPatterns()  { return _store.filter(e => e.rollbackTriggered); }
function getRetryPatterns()     { return _store.filter(e => e.retryCount > 0); }

function getDependencyFailures() {
    return _store.filter(e => !e.success && DEP_RE.test(e.failureReason ?? ""));
}

function getDurationHistory(taskId = null) {
    const src = taskId ? _store.filter(e => e.taskId === taskId) : _store;
    return src
        .filter(e => e.durationMs != null)
        .map(e => ({ taskId: e.taskId ?? null, durationMs: e.durationMs, ts: e.ts }));
}

function getAll()  { return [..._store]; }
function reset()   { _store.length = 0; _seq = 0; }

module.exports = { record, getSuccessful, getFailed, getRecoveryPatterns, getRetryPatterns, getDependencyFailures, getDurationHistory, getAll, reset };
