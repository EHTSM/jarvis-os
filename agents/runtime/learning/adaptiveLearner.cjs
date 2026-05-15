"use strict";
/**
 * adaptiveLearner — retry intelligence, stabilization learning, recovery ranking.
 *
 * recordRetryOutcome(context, outcome)           → void
 * getRetryRecommendation(context)                → Recommendation
 * recordStabilizationOutcome(strategy, cond, r)  → void
 * getBestStabilizationStrategy(conditions)       → StrategyResult
 * rankRecoveryStrategies(context)                → RankedStrategy[]
 * getLearningStats()                             → Stats
 * reset()
 */

const MIN_SAMPLES_FOR_RECOMMENDATION = 2;
const DECAY_FACTOR                   = 0.9;   // weight older outcomes less

// retry outcomes keyed by `${errorType}:${strategy}`
let _retryOutcomes     = new Map();
// stabilization outcomes keyed by `${strategy}:${conditionKey}`
let _stabilOutcomes    = new Map();
// recovery strategy effectiveness keyed by strategy name
let _recoveryScores    = new Map();
let _counter           = 0;

// ── _makeConditionKey ─────────────────────────────────────────────────

function _makeConditionKey(conditions = {}) {
    // Bucket continuous values into discrete bands
    const health  = _band(conditions.healthScore, [0.8, 0.6, 0.4], ["h", "w", "d", "c"]);
    const latency = _band(conditions.latencyScore, [0.3, 0.6, 0.8], ["ok", "s", "d", "c"]);
    const memory  = _band(conditions.memoryScore,  [0.3, 0.6, 0.8], ["ok", "s", "d", "c"]);
    return `${health}|${latency}|${memory}`;
}

function _band(val, thresholds, labels) {
    if (val == null) return labels[0];
    for (let i = 0; i < thresholds.length; i++) {
        if (val >= thresholds[i]) return labels[i];
    }
    return labels[labels.length - 1];
}

// ── recordRetryOutcome ────────────────────────────────────────────────

function recordRetryOutcome(context = {}, outcome = {}) {
    const errorType = context.errorType ?? "unknown";
    const strategy  = context.strategy  ?? "default";
    const success   = outcome.success   ?? false;
    const key       = `${errorType}:${strategy}`;

    if (!_retryOutcomes.has(key)) {
        _retryOutcomes.set(key, { successes: 0, failures: 0, weight: 0, samples: 0 });
    }
    const rec = _retryOutcomes.get(key);

    // Apply exponential decay to existing weight so newer outcomes matter more
    rec.weight    = rec.weight * DECAY_FACTOR;
    rec.weight   += success ? 1 : 0;
    rec.samples++;
    if (success) rec.successes++; else rec.failures++;
}

// ── getRetryRecommendation ────────────────────────────────────────────

function getRetryRecommendation(context = {}) {
    const errorType = context.errorType ?? "unknown";

    // Collect all strategies we have data for this error type
    const candidates = [];
    for (const [key, rec] of _retryOutcomes) {
        const [eType, strat] = key.split(":");
        if (eType !== errorType) continue;
        if (rec.samples < MIN_SAMPLES_FOR_RECOMMENDATION) continue;
        const successRate = rec.successes / rec.samples;
        candidates.push({ strategy: strat, successRate, samples: rec.samples, weight: rec.weight });
    }

    if (candidates.length === 0) {
        return { recommended: null, reason: "insufficient_data", errorType };
    }

    // Sort by decayed weight (recency-biased), then successRate as tiebreaker
    candidates.sort((a, b) => b.weight - a.weight || b.successRate - a.successRate);
    const best = candidates[0];
    return {
        recommended: best.strategy,
        successRate: +best.successRate.toFixed(3),
        samples:     best.samples,
        errorType,
        confidence:  best.samples >= 5 ? "high" : "moderate",
    };
}

// ── recordStabilizationOutcome ────────────────────────────────────────

function recordStabilizationOutcome(strategy, conditions = {}, result = {}) {
    const condKey   = _makeConditionKey(conditions);
    const key       = `${strategy}:${condKey}`;
    const effective = result.effective ?? false;
    const speedMs   = result.recoveryMs ?? null;

    if (!_stabilOutcomes.has(key)) {
        _stabilOutcomes.set(key, { strategy, condKey, effective: 0, total: 0, totalSpeedMs: 0 });
    }
    const rec = _stabilOutcomes.get(key);
    rec.total++;
    if (effective) { rec.effective++; if (speedMs) rec.totalSpeedMs += speedMs; }
}

// ── getBestStabilizationStrategy ─────────────────────────────────────

function getBestStabilizationStrategy(conditions = {}) {
    const condKey = _makeConditionKey(conditions);

    const candidates = [];
    for (const [key, rec] of _stabilOutcomes) {
        if (rec.condKey !== condKey) continue;
        if (rec.total === 0) continue;
        const rate = rec.effective / rec.total;
        const avgSpeed = rec.effective > 0 ? rec.totalSpeedMs / rec.effective : Infinity;
        candidates.push({ strategy: rec.strategy, effectivenessRate: rate, avgRecoveryMs: avgSpeed, samples: rec.total });
    }

    if (candidates.length === 0) {
        return { strategy: null, reason: "no_data_for_conditions", condKey };
    }

    candidates.sort((a, b) => b.effectivenessRate - a.effectivenessRate || a.avgRecoveryMs - b.avgRecoveryMs);
    const best = candidates[0];
    return {
        strategy:          best.strategy,
        effectivenessRate: +best.effectivenessRate.toFixed(3),
        avgRecoveryMs:     best.avgRecoveryMs === Infinity ? null : Math.round(best.avgRecoveryMs),
        samples:           best.samples,
        condKey,
    };
}

// ── rankRecoveryStrategies ────────────────────────────────────────────

function rankRecoveryStrategies(context = {}) {
    // Aggregate recovery scores across all conditions
    const aggregated = new Map();

    for (const [, rec] of _stabilOutcomes) {
        const s = rec.strategy;
        if (!aggregated.has(s)) aggregated.set(s, { effective: 0, total: 0 });
        const agg = aggregated.get(s);
        agg.effective += rec.effective;
        agg.total     += rec.total;
    }

    // Also pull in retry outcomes as proxy for recovery
    for (const [key, rec] of _retryOutcomes) {
        const strat = key.split(":")[1];
        if (!aggregated.has(strat)) aggregated.set(strat, { effective: 0, total: 0 });
        const agg = aggregated.get(strat);
        agg.effective += rec.successes;
        agg.total     += rec.samples;
    }

    if (aggregated.size === 0) return [];

    const ranked = [];
    for (const [strategy, agg] of aggregated) {
        const rate = agg.total > 0 ? agg.effective / agg.total : 0;
        ranked.push({ strategy, effectivenessRate: +rate.toFixed(3), samples: agg.total });
    }

    return ranked.sort((a, b) => b.effectivenessRate - a.effectivenessRate || b.samples - a.samples);
}

// ── getLearningStats ──────────────────────────────────────────────────

function getLearningStats() {
    return {
        retryContexts:    _retryOutcomes.size,
        stabilContexts:   _stabilOutcomes.size,
        totalRetries:     [..._retryOutcomes.values()].reduce((s, r) => s + r.samples, 0),
        totalStabilizations: [..._stabilOutcomes.values()].reduce((s, r) => s + r.total, 0),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _retryOutcomes  = new Map();
    _stabilOutcomes = new Map();
    _recoveryScores = new Map();
    _counter        = 0;
}

module.exports = {
    MIN_SAMPLES_FOR_RECOMMENDATION, DECAY_FACTOR,
    recordRetryOutcome, getRetryRecommendation,
    recordStabilizationOutcome, getBestStabilizationStrategy,
    rankRecoveryStrategies, getLearningStats, reset,
};
