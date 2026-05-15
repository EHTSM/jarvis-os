"use strict";
/**
 * adaptiveConcurrencyIntelligence — dynamically learns optimal concurrency levels.
 *
 * recordExecution(durationMs, success, concurrencyLevel)
 * getOptimalConcurrency()   → number
 * shouldScaleUp(status)     → boolean
 * shouldScaleDown(status)   → boolean
 * learnDrainRate(queueDepth, processingTimeMs)
 * getOptimalDrainRate()     → number  (items/sec)
 * getParallelismLimit()     → number
 * reset()
 */

let _executions  = [];  // { durationMs, success, concurrencyLevel, ts }
let _drainSamples = []; // { queueDepth, processingTimeMs, ts }

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 16;
const DEFAULT_CONCURRENCY = 4;

// ── recordExecution ───────────────────────────────────────────────────

function recordExecution(durationMs, success, concurrencyLevel = DEFAULT_CONCURRENCY) {
    _executions.push({ durationMs, success, concurrencyLevel, ts: new Date().toISOString() });
    if (_executions.length > 200) _executions.shift();
}

// ── getOptimalConcurrency ─────────────────────────────────────────────

function getOptimalConcurrency() {
    if (_executions.length < 3) return DEFAULT_CONCURRENCY;

    // Group outcomes by concurrency level and find best success/duration tradeoff
    const byLevel = {};
    for (const e of _executions) {
        const lvl = e.concurrencyLevel;
        if (!byLevel[lvl]) byLevel[lvl] = { successes: 0, total: 0, durationSum: 0 };
        byLevel[lvl].total++;
        byLevel[lvl].durationSum += e.durationMs;
        if (e.success) byLevel[lvl].successes++;
    }

    let bestLevel = DEFAULT_CONCURRENCY;
    let bestScore = -Infinity;

    for (const [lvl, stats] of Object.entries(byLevel)) {
        if (stats.total < 2) continue;
        const successRate = stats.successes / stats.total;
        const avgDuration = stats.durationSum / stats.total;
        // Score: success contributes positively, duration and very high concurrency penalised
        const score = successRate * 100 - avgDuration / 100 - Math.max(0, Number(lvl) - 6) * 5;
        if (score > bestScore) { bestScore = score; bestLevel = Number(lvl); }
    }

    return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, bestLevel));
}

// ── shouldScaleUp / shouldScaleDown ───────────────────────────────────

function shouldScaleUp(status = {}) {
    const { pressure = "none", avgQueueDepth = 0 } = status;
    if (pressure === "high" || pressure === "critical") return false;
    if (avgQueueDepth > 5 && pressure === "none") return true;
    return false;
}

function shouldScaleDown(status = {}) {
    const { pressure = "none" } = status;
    return pressure === "high" || pressure === "critical";
}

// ── learnDrainRate ────────────────────────────────────────────────────

function learnDrainRate(queueDepth, processingTimeMs) {
    if (queueDepth <= 0 || processingTimeMs <= 0) return;
    _drainSamples.push({ queueDepth, processingTimeMs, ts: new Date().toISOString() });
    if (_drainSamples.length > 100) _drainSamples.shift();
}

function getOptimalDrainRate() {
    if (_drainSamples.length === 0) return 1.0;
    const rates = _drainSamples.map(s => s.queueDepth / (s.processingTimeMs / 1000));
    return +(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2);
}

// ── getParallelismLimit ───────────────────────────────────────────────

function getParallelismLimit() {
    const optimal    = getOptimalConcurrency();
    const recentSucc = _executions.slice(-10).filter(e => e.success).length;
    const total      = Math.min(10, _executions.length);
    if (total === 0) return optimal;
    // If recent success rate < 60%, cap at optimal - 1
    const recentRate = recentSucc / total;
    return recentRate < 0.6 ? Math.max(MIN_CONCURRENCY, optimal - 1) : optimal;
}

function reset() {
    _executions   = [];
    _drainSamples = [];
}

module.exports = {
    recordExecution, getOptimalConcurrency,
    shouldScaleUp, shouldScaleDown,
    learnDrainRate, getOptimalDrainRate,
    getParallelismLimit, reset,
};
