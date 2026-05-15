"use strict";
/**
 * runtimeHealthScorer — real-time runtime health scoring with adaptive weighting.
 *
 * Critical signals receive amplified weight; weights are re-normalized after amplification.
 *
 * computeHealthScore(normalizedMetrics)     → HealthScore
 * adaptWeights(metrics)                     → WeightMap
 * scoreSignal(metric)                       → SignalScore
 * getWeights()                              → WeightMap
 * getScoreHistory()                         → HealthScore[]
 * reset()
 */

// Base weights — must sum to 1.0
const BASE_WEIGHTS = {
    cpu:       0.12,
    memory:    0.18,
    queue:     0.10,
    latency:   0.20,
    failure:   0.25,
    retry:     0.08,
    disk:      0.04,
    websocket: 0.02,
    api:       0.01,
};

// When a signal is "critical", its weight is multiplied by this amplifier
const CRITICAL_AMPLIFIER = 2.5;
const DEGRADED_AMPLIFIER = 1.5;

let _scoreHistory = [];

// ── scoreSignal ───────────────────────────────────────────────────────

function scoreSignal(metric = {}) {
    const inverted = 1 - (metric.value ?? 0);   // 0=bad → 1=good
    const score    = +Math.min(100, Math.max(0, inverted * 100)).toFixed(1);
    const grade    = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
    return { metric: metric.metric, score, grade, severity: metric.severity };
}

// ── adaptWeights ──────────────────────────────────────────────────────

function adaptWeights(metrics = []) {
    const weights = { ...BASE_WEIGHTS };

    // Amplify weights for critical/degraded metrics
    for (const m of metrics) {
        if (!weights[m.metric]) continue;
        if (m.severity === "critical") {
            weights[m.metric] *= CRITICAL_AMPLIFIER;
        } else if (m.severity === "degraded") {
            weights[m.metric] *= DEGRADED_AMPLIFIER;
        }
    }

    // Renormalize so weights sum to 1
    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    const normalized = {};
    for (const [k, v] of Object.entries(weights)) {
        normalized[k] = +(v / total).toFixed(4);
    }
    return normalized;
}

// ── computeHealthScore ────────────────────────────────────────────────

function computeHealthScore(normalizedMetrics = []) {
    if (normalizedMetrics.length === 0) {
        return { score: 100, grade: "A", level: "healthy", reason: "no_signals", breakdown: {} };
    }

    const weights  = adaptWeights(normalizedMetrics);
    const metricMap = new Map(normalizedMetrics.map(m => [m.metric, m]));

    let weightedSum  = 0;
    let coveredWeight = 0;
    const breakdown  = {};

    for (const [name, weight] of Object.entries(weights)) {
        const m = metricMap.get(name);
        if (!m) continue;
        const inverted = 1 - m.value;
        weightedSum   += inverted * weight;
        coveredWeight += weight;
        breakdown[name] = { value: m.value, severity: m.severity, weight: +(weight).toFixed(4), contribution: +(inverted * weight).toFixed(4) };
    }

    const raw   = coveredWeight > 0 ? (weightedSum / coveredWeight) * 100 : 100;
    const score = +Math.min(100, Math.max(0, raw)).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
    const level = score >= 80 ? "healthy"  :
                  score >= 60 ? "warning"  :
                  score >= 40 ? "degraded" : "critical";

    const hasCritical  = normalizedMetrics.some(m => m.severity === "critical");
    const hasDegraded  = normalizedMetrics.some(m => m.severity === "degraded");
    const criticalCount = normalizedMetrics.filter(m => m.severity === "critical").length;

    const result = { score, grade, level, hasCritical, hasDegraded, criticalCount, metricCount: normalizedMetrics.length, breakdown };
    _scoreHistory.push({ ...result, ts: new Date().toISOString() });
    return result;
}

// ── getWeights ────────────────────────────────────────────────────────

function getWeights() { return { ...BASE_WEIGHTS }; }

// ── getScoreHistory / reset ───────────────────────────────────────────

function getScoreHistory() { return [..._scoreHistory]; }

function reset() { _scoreHistory = []; }

module.exports = {
    BASE_WEIGHTS, CRITICAL_AMPLIFIER, DEGRADED_AMPLIFIER,
    scoreSignal, adaptWeights, computeHealthScore, getWeights, getScoreHistory, reset,
};
