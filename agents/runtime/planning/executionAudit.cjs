"use strict";
/**
 * executionAudit — immutable audit trail for every planning+execution run.
 *
 * record(executionId, entry)    — append audit entry
 * get(executionId)              → entries[] for that execution
 * getAll()                      → all entries, ordered by seq
 * findByTaskId(taskId)          → entries matching a task id
 * summarize(executionId)        → condensed summary or null
 * reset()
 */

// executionId → [{seq, executionId, taskId, ...}]
const _records = new Map();
let   _seq     = 0;

function record(executionId, entry = {}) {
    if (!_records.has(executionId)) _records.set(executionId, []);
    _records.get(executionId).push({
        seq:                 ++_seq,
        executionId,
        taskId:              entry.taskId              ?? "unknown",
        executionPath:       entry.executionPath       ?? [],
        strategyChosen:      entry.strategyChosen      ?? "unknown",
        blockingReasons:     entry.blockingReasons     ?? [],
        verificationResults: entry.verificationResults ?? null,
        ts:                  entry.ts                  ?? new Date().toISOString(),
    });
}

function get(executionId) {
    return [...(_records.get(executionId) ?? [])];
}

function getAll() {
    const all = [];
    for (const entries of _records.values()) all.push(...entries);
    return all.sort((a, b) => a.seq - b.seq);
}

function findByTaskId(taskId) {
    return getAll().filter(e => e.taskId === taskId);
}

function summarize(executionId) {
    const entries = get(executionId);
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    return {
        executionId,
        taskId:        last.taskId,
        strategyChosen: last.strategyChosen,
        blocked:       last.blockingReasons.length > 0,
        blockingCount: last.blockingReasons.length,
        stagesReached: last.executionPath.length,
        ts:            last.ts,
    };
}

function reset() { _records.clear(); _seq = 0; }

module.exports = { record, get, getAll, findByTaskId, summarize, reset };
