"use strict";
/**
 * executionHistory — ring buffer of the last 500 task executions.
 * Indexed by agentId and taskType for O(1) filtered queries.
 * No persistence — rebuilt from live executions each process lifetime.
 */

const RING_SIZE = 500;

const _ring    = new Array(RING_SIZE);
let   _head    = 0;   // next write position
let   _count   = 0;   // total entries ever written (not capped)
let   _seq     = 0;   // monotonic insertion counter — tiebreaker for stable sort

// Sparse indexes — entry positions keyed by agentId / taskType
const _byAgent = new Map();  // agentId → Set of ring positions
const _byType  = new Map();  // taskType → Set of ring positions

function _addToIndex(map, key, pos) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(pos);
}

function _trimIndex(map, key, evictedPos) {
    const s = map.get(key);
    if (!s) return;
    s.delete(evictedPos);
    if (s.size === 0) map.delete(key);
}

/**
 * Record one task execution.
 * @param {object} entry
 *   agentId   {string}
 *   taskType  {string}
 *   taskId    {string}
 *   success   {boolean}
 *   durationMs {number}
 *   error     {string|null}
 *   input     {string}  — first 120 chars
 *   output    {string}  — first 120 chars
 */
function record(entry) {
    const pos = _head;

    // Evict old entry from indexes if ring wraps around
    const old = _ring[pos];
    if (old) {
        _trimIndex(_byAgent, old.agentId,  pos);
        _trimIndex(_byType,  old.taskType, pos);
    }

    _ring[pos] = {
        agentId:    entry.agentId   || "unknown",
        taskType:   entry.taskType  || "unknown",
        taskId:     entry.taskId    || "",
        success:    entry.success   !== false,
        durationMs: entry.durationMs || 0,
        error:      entry.error     || null,
        input:      (entry.input    || "").slice(0, 120),
        output:     (entry.output   || "").slice(0, 120),
        ts:         Date.now(),
        seq:        ++_seq,
    };

    _addToIndex(_byAgent, _ring[pos].agentId,  pos);
    _addToIndex(_byType,  _ring[pos].taskType, pos);

    _head = (_head + 1) % RING_SIZE;
    _count++;

    // Emit to realtime event bus (additive — bus may not be running in all contexts)
    try { require("./runtimeEventBus.cjs").emit("execution", { ..._ring[pos] }); } catch { /* non-critical */ }
    // Persist to disk log (additive — failure never affects execution)
    try { require("../../backend/utils/execLog.cjs").append(_ring[pos]); } catch { /* non-critical */ }
}

function _collect(posSet) {
    if (!posSet) return [];
    return [...posSet]
        .map(p => _ring[p])
        .filter(Boolean)
        .sort((a, b) => b.ts - a.ts || b.seq - a.seq);  // newest first; seq tiebreaks equal ts
}

/** @returns {object[]} last N entries (newest first) */
function recent(n = 20) {
    const result = [];
    let   pos    = (_head - 1 + RING_SIZE) % RING_SIZE;
    const limit  = Math.min(n, Math.min(_count, RING_SIZE));
    for (let i = 0; i < limit; i++) {
        if (_ring[pos]) result.push(_ring[pos]);
        pos = (pos - 1 + RING_SIZE) % RING_SIZE;
    }
    return result;
}

/** @returns {object[]} executions for a specific agentId (newest first) */
function byAgent(agentId) { return _collect(_byAgent.get(agentId)); }

/** @returns {object[]} executions for a specific taskType (newest first) */
function byType(taskType) { return _collect(_byType.get(taskType)); }

/** @returns {{total,succeeded,failed,successRate,avgDurationMs,uniqueAgents,uniqueTypes}} */
function stats() {
    const entries = recent(RING_SIZE);
    if (!entries.length) return { total: 0, succeeded: 0, failed: 0, successRate: 1, avgDurationMs: 0, uniqueAgents: 0, uniqueTypes: 0 };
    const succeeded = entries.filter(e => e.success).length;
    const totalMs   = entries.reduce((s, e) => s + e.durationMs, 0);
    return {
        total:        entries.length,
        succeeded,
        failed:       entries.length - succeeded,
        successRate:  succeeded / entries.length,
        avgDurationMs: Math.round(totalMs / entries.length),
        uniqueAgents: _byAgent.size,
        uniqueTypes:  _byType.size,
    };
}

/** @returns {object[]} all entries in the ring buffer (newest first) */
function getAll() { return recent(RING_SIZE); }

module.exports = { record, recent, byAgent, byType, stats, getAll };
