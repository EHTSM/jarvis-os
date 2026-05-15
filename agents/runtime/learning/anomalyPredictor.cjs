"use strict";
/**
 * anomalyPredictor — probabilistic anomaly forecasting and execution confidence scoring.
 *
 * addObservation(metric, value, ts)            → void
 * predictAnomaly(metric, opts)                 → Prediction
 * forecastThresholdBreach(metric, threshold)   → ForecastResult
 * scoreExecutionConfidence(context)            → ConfidenceScore
 * getActivePredictions()                       → Prediction[]
 * getPredictorStats()                          → Stats
 * reset()
 */

const WINDOW_SIZE          = 30;    // observations kept per metric
const ANOMALY_THRESHOLD    = 0.8;   // predicted value fraction to trigger anomaly
const FORECAST_STEPS       = 5;
const CONFIDENCE_WEIGHTS   = { successRate: 0.35, errorRate: 0.25, latencyScore: 0.20, memoryScore: 0.20 };

let _observations  = new Map();   // metric → number[]
let _predictions   = new Map();   // metric → latest prediction
let _counter       = 0;

// ── addObservation ────────────────────────────────────────────────────

function addObservation(metric, value, ts = null) {
    if (!_observations.has(metric)) _observations.set(metric, []);
    const obs = _observations.get(metric);
    obs.push({ value: +value, ts: ts ?? new Date().toISOString() });
    if (obs.length > WINDOW_SIZE) obs.shift();
}

// ── _linearSlope ─────────────────────────────────────────────────────

function _linearSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    const meanX = (n - 1) / 2;
    const meanY = values.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - meanX) * (values[i] - meanY);
        den += (i - meanX) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

function _mean(values) {
    return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function _stddev(values) {
    if (values.length < 2) return 0;
    const m = _mean(values);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

// ── predictAnomaly ────────────────────────────────────────────────────

function predictAnomaly(metric, opts = {}) {
    const obs = _observations.get(metric);
    if (!obs || obs.length < 3) {
        return { predicted: false, reason: "insufficient_data", metric };
    }

    const values   = obs.map(o => o.value);
    const slope    = _linearSlope(values);
    const last     = values[values.length - 1];
    const projected = last + slope * FORECAST_STEPS;
    const threshold = opts.threshold ?? ANOMALY_THRESHOLD;

    const willBreach = projected >= threshold;
    const stepsToThreshold = slope > 0
        ? Math.max(1, Math.ceil((threshold - last) / slope))
        : null;

    const prediction = {
        predicted:         true,
        metric,
        currentValue:      +last.toFixed(4),
        projectedValue:    +Math.min(1, Math.max(0, projected)).toFixed(4),
        slope:             +slope.toFixed(6),
        anomalyLikely:     willBreach,
        stepsToThreshold:  stepsToThreshold,
        confidence:        obs.length >= 10 ? "high" : obs.length >= 5 ? "moderate" : "low",
        ts:                new Date().toISOString(),
    };

    _predictions.set(metric, prediction);
    return prediction;
}

// ── forecastThresholdBreach ───────────────────────────────────────────

function forecastThresholdBreach(metric, threshold = ANOMALY_THRESHOLD) {
    const obs = _observations.get(metric);
    if (!obs || obs.length < 2) {
        return { willBreach: false, reason: "insufficient_data", metric };
    }

    const values = obs.map(o => o.value);
    const slope  = _linearSlope(values);
    const last   = values[values.length - 1];
    const std    = _stddev(values);

    if (last >= threshold) {
        return { willBreach: true, alreadyBreached: true, metric, currentValue: +last.toFixed(4) };
    }

    if (slope <= 0) {
        return { willBreach: false, metric, slope: +slope.toFixed(6), currentValue: +last.toFixed(4) };
    }

    const steps = Math.ceil((threshold - last) / slope);
    // Uncertainty band — 1 stddev on projected value
    const projAtSteps = last + slope * steps;
    const lowerBound  = projAtSteps - std;
    const upperBound  = projAtSteps + std;

    return {
        willBreach:  true,
        metric,
        stepsAway:   steps,
        currentValue: +last.toFixed(4),
        projectedAt: +projAtSteps.toFixed(4),
        lowerBound:  +lowerBound.toFixed(4),
        upperBound:  +upperBound.toFixed(4),
        slope:       +slope.toFixed(6),
    };
}

// ── scoreExecutionConfidence ──────────────────────────────────────────

function scoreExecutionConfidence(context = {}) {
    // Normalize each dimension to a 0–1 "health" score (1 = good)
    const successHealth = context.successRate   ?? 1;              // already 0–1
    const errorHealth   = 1 - (context.errorRate ?? 0);           // low error = good
    const latencyHealth = 1 - (context.latencyScore ?? 0);        // low latency norm = good
    const memoryHealth  = 1 - (context.memoryScore  ?? 0);        // low memory pressure = good

    const raw =
        successHealth * CONFIDENCE_WEIGHTS.successRate  +
        errorHealth   * CONFIDENCE_WEIGHTS.errorRate    +
        latencyHealth * CONFIDENCE_WEIGHTS.latencyScore +
        memoryHealth  * CONFIDENCE_WEIGHTS.memoryScore;

    const score = +Math.min(1, Math.max(0, raw)).toFixed(3);
    const level = score >= 0.85 ? "high"
                : score >= 0.65 ? "moderate"
                : score >= 0.40 ? "low"
                :                 "critical";

    // Pull in any active anomaly predictions to lower confidence further
    let anomalyPenalty = 0;
    for (const pred of _predictions.values()) {
        if (pred.anomalyLikely) anomalyPenalty += 0.05;
    }
    const adjusted = +Math.max(0, score - anomalyPenalty).toFixed(3);
    const adjustedLevel = adjusted >= 0.85 ? "high"
                        : adjusted >= 0.65 ? "moderate"
                        : adjusted >= 0.40 ? "low"
                        :                    "critical";

    return {
        score:         adjusted,
        rawScore:      score,
        level:         adjustedLevel,
        anomalyPenalty: +anomalyPenalty.toFixed(3),
        components: {
            successHealth:  +successHealth.toFixed(3),
            errorHealth:    +errorHealth.toFixed(3),
            latencyHealth:  +latencyHealth.toFixed(3),
            memoryHealth:   +memoryHealth.toFixed(3),
        },
    };
}

// ── getActivePredictions ──────────────────────────────────────────────

function getActivePredictions() {
    return [..._predictions.values()].filter(p => p.anomalyLikely);
}

// ── getPredictorStats ─────────────────────────────────────────────────

function getPredictorStats() {
    return {
        trackedMetrics:    _observations.size,
        activePredictions: getActivePredictions().length,
        totalPredictions:  _predictions.size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _observations = new Map();
    _predictions  = new Map();
    _counter      = 0;
}

module.exports = {
    WINDOW_SIZE, ANOMALY_THRESHOLD, FORECAST_STEPS, CONFIDENCE_WEIGHTS,
    addObservation, predictAnomaly, forecastThresholdBreach,
    scoreExecutionConfidence, getActivePredictions, getPredictorStats, reset,
};
