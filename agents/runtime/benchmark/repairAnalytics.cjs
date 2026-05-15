"use strict";
/**
 * repairAnalytics — repair efficiency tracking and scoring.
 *
 * record(workflowId, repairAttempts, success, latencyMs, rolledBack?)
 *   — log one repair event
 *
 * getStats(workflowId)
 *   → { events, successRate, avgAttempts, avgLatencyMs, rollbackRate, efficiencyScore }
 *
 * rollbackFrequency()   → overall rollback rate across all workflows
 * recoveryEfficiencyScore(workflowId) → 0–100
 * repairVsRetry()       → { totalRepairs, avgAttempts, successOnFirst, successOnRetry }
 * fullReport()          → all stats
 * reset()
 */

// workflowId → [{seq, ts, attempts, success, latencyMs, rolledBack}]
const _events = new Map();
let   _seq    = 0;

// ── record ────────────────────────────────────────────────────────────

function record(workflowId, repairAttempts, success, latencyMs = 0, rolledBack = false) {
    if (!_events.has(workflowId)) _events.set(workflowId, []);
    _events.get(workflowId).push({
        seq:      ++_seq,
        ts:       new Date().toISOString(),
        attempts: repairAttempts || 1,
        success:  !!success,
        latencyMs,
        rolledBack: !!rolledBack,
    });
}

// ── getStats ──────────────────────────────────────────────────────────

function getStats(workflowId) {
    const evs = _events.get(workflowId) || [];
    if (evs.length === 0) return null;

    const successes     = evs.filter(e => e.success).length;
    const successRate   = parseFloat((successes / evs.length).toFixed(3));
    const avgAttempts   = parseFloat((evs.reduce((s, e) => s + e.attempts, 0) / evs.length).toFixed(2));
    const avgLatencyMs  = Math.round(evs.reduce((s, e) => s + e.latencyMs, 0) / evs.length);
    const rollbacks     = evs.filter(e => e.rolledBack).length;
    const rollbackRate  = parseFloat((rollbacks / evs.length).toFixed(3));
    const efficiencyScore = recoveryEfficiencyScore(workflowId, evs);

    return { events: evs.length, successRate, avgAttempts, avgLatencyMs, rollbackRate, efficiencyScore };
}

// ── rollbackFrequency ─────────────────────────────────────────────────

function rollbackFrequency() {
    let total    = 0;
    let rollbacks = 0;
    for (const evs of _events.values()) {
        total    += evs.length;
        rollbacks += evs.filter(e => e.rolledBack).length;
    }
    return {
        totalRepairs:   total,
        rollbacks,
        rollbackRate:   total > 0 ? parseFloat((rollbacks / total).toFixed(3)) : 0,
    };
}

// ── recoveryEfficiencyScore ───────────────────────────────────────────

function recoveryEfficiencyScore(workflowId, evs = null) {
    const events = evs ?? (_events.get(workflowId) || []);
    if (events.length === 0) return 50;

    const successes    = events.filter(e => e.success).length;
    const successRate  = successes / events.length;
    const avgAttempts  = events.reduce((s, e) => s + e.attempts, 0) / events.length;
    const rollbackRate = events.filter(e => e.rolledBack).length / events.length;

    // Score: high success, low attempts, low rollbacks = efficient
    let score = successRate * 60;                    // up to 60
    score    += Math.max(0, 20 - avgAttempts * 5);  // up to 20 (penalise high retries)
    score    += (1 - rollbackRate) * 20;             // up to 20

    return Math.max(0, Math.min(100, Math.round(score)));
}

// ── repairVsRetry ─────────────────────────────────────────────────────

function repairVsRetry() {
    const all           = [..._events.values()].flat();
    const totalRepairs  = all.length;
    const firstAttempt  = all.filter(e => e.attempts <= 1);
    const retried       = all.filter(e => e.attempts > 1);

    return {
        totalRepairs,
        successOnFirst: firstAttempt.filter(e => e.success).length,
        successOnRetry: retried.filter(e => e.success).length,
        avgAttempts:    totalRepairs > 0
            ? parseFloat((all.reduce((s, e) => s + e.attempts, 0) / totalRepairs).toFixed(2))
            : 0,
        retryRate: totalRepairs > 0
            ? parseFloat((retried.length / totalRepairs).toFixed(3))
            : 0,
    };
}

// ── fullReport ────────────────────────────────────────────────────────

function fullReport() {
    const workflowStats = {};
    for (const id of _events.keys()) {
        workflowStats[id] = getStats(id);
    }

    return {
        generatedAt:    new Date().toISOString(),
        workflowCount:  _events.size,
        workflowStats,
        rollbackFrequency: rollbackFrequency(),
        repairVsRetry:     repairVsRetry(),
    };
}

function reset() { _events.clear(); _seq = 0; }

module.exports = {
    record,
    getStats,
    rollbackFrequency,
    recoveryEfficiencyScore,
    repairVsRetry,
    fullReport,
    reset,
};
