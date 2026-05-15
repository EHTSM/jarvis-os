"use strict";
/**
 * optimizationMemory — persists optimization intelligence across executions.
 *
 * Stores:
 *   - best-performing strategies per fingerprint
 *   - high-risk workflow fingerprints
 *   - recovery effectiveness history
 *   - dependency degradation trends
 */

let _strategyPerf   = new Map();  // fingerprint → [{ strategy, success, durationMs, ts }]
let _highRisk       = new Map();  // fingerprint → { reason, flaggedAt }
let _recoveryHist   = new Map();  // fingerprint → [{ recovered, ts }]
let _depDegradation = new Map();  // depId → [{ stability, ts }]

// ── strategy performance ──────────────────────────────────────────────

function recordStrategyPerformance(fingerprint, strategy, success, durationMs = 0) {
    if (!_strategyPerf.has(fingerprint)) _strategyPerf.set(fingerprint, []);
    _strategyPerf.get(fingerprint).push({
        strategy, success, durationMs, ts: new Date().toISOString()
    });
}

function getBestStrategy(fingerprint) {
    const records = _strategyPerf.get(fingerprint) ?? [];
    if (records.length === 0) return null;

    // Group by strategy, pick highest success rate then lowest avg duration
    const byStrat = {};
    for (const r of records) {
        if (!byStrat[r.strategy]) byStrat[r.strategy] = { successes: 0, total: 0, totalDuration: 0 };
        byStrat[r.strategy].total++;
        byStrat[r.strategy].totalDuration += r.durationMs;
        if (r.success) byStrat[r.strategy].successes++;
    }
    let best = null, bestScore = -1;
    for (const [strat, stats] of Object.entries(byStrat)) {
        const rate = stats.successes / stats.total;
        const avgDur = stats.totalDuration / stats.total;
        const score = rate * 100 - avgDur / 1000;
        if (score > bestScore) { bestScore = score; best = strat; }
    }
    return best;
}

// ── high-risk flagging ────────────────────────────────────────────────

function flagHighRisk(fingerprint, reason) {
    _highRisk.set(fingerprint, { reason, flaggedAt: new Date().toISOString() });
}

function unflagHighRisk(fingerprint) {
    _highRisk.delete(fingerprint);
}

function isHighRisk(fingerprint) {
    return _highRisk.has(fingerprint);
}

function getHighRiskFingerprints() {
    return [..._highRisk.entries()].map(([fp, meta]) => ({ fingerprint: fp, ...meta }));
}

// ── recovery effectiveness ────────────────────────────────────────────

function recordRecoveryEffectiveness(fingerprint, recovered) {
    if (!_recoveryHist.has(fingerprint)) _recoveryHist.set(fingerprint, []);
    _recoveryHist.get(fingerprint).push({ recovered, ts: new Date().toISOString() });
}

function getRecoveryRate(fingerprint) {
    const records = _recoveryHist.get(fingerprint) ?? [];
    if (records.length === 0) return null;
    return records.filter(r => r.recovered).length / records.length;
}

// ── dependency degradation ────────────────────────────────────────────

function recordDepDegradation(depId, stability) {
    if (!_depDegradation.has(depId)) _depDegradation.set(depId, []);
    _depDegradation.get(depId).push({ stability, ts: new Date().toISOString() });
}

function getDepTrend(depId) {
    const records = _depDegradation.get(depId) ?? [];
    if (records.length < 2) return { trend: "stable", records };
    const first = records[0].stability;
    const last  = records[records.length - 1].stability;
    const delta = last - first;
    return {
        trend:   delta < -0.1 ? "degrading" : delta > 0.1 ? "improving" : "stable",
        delta,
        first,
        last,
        records,
    };
}

function getAllDepTrends() {
    const result = {};
    for (const depId of _depDegradation.keys()) {
        result[depId] = getDepTrend(depId);
    }
    return result;
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _strategyPerf   = new Map();
    _highRisk       = new Map();
    _recoveryHist   = new Map();
    _depDegradation = new Map();
}

module.exports = {
    recordStrategyPerformance, getBestStrategy,
    flagHighRisk, unflagHighRisk, isHighRisk, getHighRiskFingerprints,
    recordRecoveryEffectiveness, getRecoveryRate,
    recordDepDegradation, getDepTrend, getAllDepTrends,
    reset,
};
