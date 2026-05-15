"use strict";
/**
 * opBenchmark — operational task benchmarking and success-rate tracking.
 *
 * trackTask(id, type, success, durationMs, meta?)  — record a task outcome
 * getTaskStats(type)       → { attempts, successes, successRate, avgMs, p50Ms, p95Ms }
 * getAllStats()             → { [type]: stats }
 * getRetryEfficiency()     → { totalTasks, retriedTasks, retryRate, avgRetriesPerTask }
 * getRepairStats()         → stats for tasks of type "repair"
 * fullReport()             → comprehensive benchmark report
 * reset()
 */

let _tasks = [];    // { id, type, success, durationMs, ts, meta }
let _seq   = 0;

function trackTask(id, type, success, durationMs, meta = {}) {
    _tasks.push({
        seq:        ++_seq,
        id:         id || `task-${_seq}`,
        type:       type || "generic",
        success:    !!success,
        durationMs: durationMs || 0,
        ts:         new Date().toISOString(),
        retries:    meta.retries    || 0,
        recovered:  meta.recovered  || false,
    });
}

function _statsForTasks(tasks) {
    if (tasks.length === 0) return null;
    const successes = tasks.filter(t => t.success).length;
    const durations = tasks.map(t => t.durationMs).sort((a, b) => a - b);
    const sum       = durations.reduce((s, d) => s + d, 0);

    return {
        attempts:    tasks.length,
        successes,
        successRate: parseFloat((successes / tasks.length).toFixed(3)),
        avgMs:       Math.round(sum / durations.length),
        p50Ms:       durations[Math.floor(durations.length * 0.50)] || 0,
        p95Ms:       durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)] || 0,
    };
}

function getTaskStats(type) {
    return _statsForTasks(_tasks.filter(t => t.type === type));
}

function getAllStats() {
    const types = [...new Set(_tasks.map(t => t.type))];
    const result = {};
    for (const type of types) result[type] = getTaskStats(type);
    return result;
}

function getRetryEfficiency() {
    const total   = _tasks.length;
    const retried = _tasks.filter(t => t.retries > 0).length;
    const totalRetries = _tasks.reduce((s, t) => s + t.retries, 0);

    return {
        totalTasks:        total,
        retriedTasks:      retried,
        retryRate:         total > 0 ? parseFloat((retried / total).toFixed(3)) : 0,
        avgRetriesPerTask: total > 0 ? parseFloat((totalRetries / total).toFixed(3)) : 0,
    };
}

function getRepairStats() {
    return _statsForTasks(_tasks.filter(t =>
        t.type === "repair" || t.type.startsWith("repair:") || t.recovered
    ));
}

function fullReport() {
    return {
        generatedAt:     new Date().toISOString(),
        totalTasks:      _tasks.length,
        allStats:        getAllStats(),
        retryEfficiency: getRetryEfficiency(),
        repairStats:     getRepairStats(),
        overallSuccess:  _tasks.length > 0
            ? parseFloat((_tasks.filter(t => t.success).length / _tasks.length).toFixed(3))
            : null,
    };
}

function reset() { _tasks = []; _seq = 0; }

module.exports = { trackTask, getTaskStats, getAllStats, getRetryEfficiency, getRepairStats, fullReport, reset };
