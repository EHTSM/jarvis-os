"use strict";
/**
 * learningBenchmark — scoring for the adaptive learning infrastructure.
 *
 * scorePredictionAccuracy(predictions, actuals)    → AccuracyScore
 * scoreRecoveryEffectiveness(outcomes)             → EffectivenessScore
 * scoreRetryOptimization(retryHistory)             → OptimizationScore
 * scoreAnomalyForecastPrecision(forecasts, events) → PrecisionScore
 * scoreStabilizationEfficiency(stabilizations)     → EfficiencyScore
 * gradeLearningMaturity(scores)                    → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "autonomous_learning",
    B: "adaptive_learning",
    C: "basic_learning",
    D: "reactive_only",
    F: "no_learning",
};

let _benchmarkHistory = [];

// ── scorePredictionAccuracy ───────────────────────────────────────────

function scorePredictionAccuracy(predictions = [], actuals = []) {
    if (predictions.length === 0) return { score: 0, grade: "F", reason: "no_predictions" };

    // Align predictions to actuals by index or id
    const matched = Math.min(predictions.length, actuals.length);
    if (matched === 0) return { score: 0, grade: "F", reason: "no_actuals" };

    let correct = 0;
    let totalError = 0;

    for (let i = 0; i < matched; i++) {
        const pred   = predictions[i];
        const actual = actuals[i];

        // Binary accuracy: did we correctly predict anomaly / no anomaly?
        const predAnomaly   = pred.anomalyLikely   ?? pred.anomaly ?? false;
        const actualAnomaly = actual.anomalyOccurred ?? actual.anomaly ?? false;
        if (predAnomaly === actualAnomaly) correct++;

        // Continuous value error (if projected value provided)
        if (pred.projectedValue != null && actual.actualValue != null) {
            totalError += Math.abs(pred.projectedValue - actual.actualValue);
        }
    }

    const binaryAccuracy = correct / matched;
    const avgError       = matched > 0 ? totalError / matched : 0;
    const errorPenalty   = Math.min(1, avgError);  // error in [0,1] range assumed

    const raw   = binaryAccuracy * 70 + (1 - errorPenalty) * 30;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "prediction_accuracy", score, ts: new Date().toISOString() });
    return { score, grade, binaryAccuracy: +binaryAccuracy.toFixed(3), avgError: +avgError.toFixed(3), matched };
}

// ── scoreRecoveryEffectiveness ────────────────────────────────────────

function scoreRecoveryEffectiveness(outcomes = []) {
    if (outcomes.length === 0) return { score: 0, grade: "F", reason: "no_outcomes" };

    const resolved    = outcomes.filter(o => o.outcome === "resolved" || o.success === true).length;
    const resolveRate = resolved / outcomes.length;

    const withDuration = outcomes.filter(o => o.durationMs != null && o.durationMs > 0);
    const avgDurationMs = withDuration.length > 0
        ? withDuration.reduce((s, o) => s + o.durationMs, 0) / withDuration.length
        : 0;

    // Speed score: <1s=1.0, <5s=0.8, <30s=0.6, <120s=0.4, else=0.2
    const speedScore = avgDurationMs === 0 ? 1
                     : avgDurationMs <  1000  ? 1.0
                     : avgDurationMs <  5000  ? 0.8
                     : avgDurationMs < 30000  ? 0.6
                     : avgDurationMs < 120000 ? 0.4
                     :                          0.2;

    const raw   = resolveRate * 70 + speedScore * 30;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "recovery_effectiveness", score, ts: new Date().toISOString() });
    return { score, grade, resolveRate: +resolveRate.toFixed(3), speedScore: +speedScore.toFixed(3), avgDurationMs: Math.round(avgDurationMs), total: outcomes.length };
}

// ── scoreRetryOptimization ────────────────────────────────────────────

function scoreRetryOptimization(retryHistory = []) {
    if (retryHistory.length === 0) return { score: 0, grade: "F", reason: "no_retry_history" };

    const withRecommendation = retryHistory.filter(r => r.recommended != null);
    if (withRecommendation.length === 0) {
        return { score: 0, grade: "F", reason: "no_recommendations" };
    }

    // Adoption rate: fraction that used the recommended strategy
    const adopted = withRecommendation.filter(r => r.usedStrategy === r.recommended).length;
    const adoptionRate = adopted / withRecommendation.length;

    // Outcome improvement: compare outcomes when following vs ignoring recommendation
    const followedSuccess = withRecommendation
        .filter(r => r.usedStrategy === r.recommended)
        .filter(r => r.success === true).length;
    const followedTotal = withRecommendation.filter(r => r.usedStrategy === r.recommended).length;
    const followSuccessRate = followedTotal > 0 ? followedSuccess / followedTotal : 0;

    const raw   = adoptionRate * 40 + followSuccessRate * 60;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "retry_optimization", score, ts: new Date().toISOString() });
    return { score, grade, adoptionRate: +adoptionRate.toFixed(3), followSuccessRate: +followSuccessRate.toFixed(3), total: retryHistory.length };
}

// ── scoreAnomalyForecastPrecision ─────────────────────────────────────

function scoreAnomalyForecastPrecision(forecasts = [], events = []) {
    if (forecasts.length === 0) return { score: 0, grade: "F", reason: "no_forecasts" };

    // true positive: forecast predicted anomaly AND anomaly occurred
    // false positive: forecast predicted anomaly but no anomaly occurred
    // false negative: forecast did NOT predict anomaly but anomaly occurred
    let tp = 0, fp = 0, fn = 0, tn = 0;

    const matched = Math.min(forecasts.length, events.length);
    for (let i = 0; i < matched; i++) {
        const predicted = forecasts[i].willBreach ?? forecasts[i].anomalyLikely ?? false;
        const occurred  = events[i].occurred      ?? events[i].anomaly          ?? false;

        if (predicted && occurred)  tp++;
        else if (predicted && !occurred) fp++;
        else if (!predicted && occurred) fn++;
        else tn++;
    }

    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 1;
    const recall    = (tp + fn) > 0 ? tp / (tp + fn) : 1;
    const f1        = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;

    const score = +Math.min(100, f1 * 100).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "anomaly_forecast_precision", score, ts: new Date().toISOString() });
    return { score, grade, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3), tp, fp, fn, tn };
}

// ── scoreStabilizationEfficiency ──────────────────────────────────────

function scoreStabilizationEfficiency(stabilizations = []) {
    if (stabilizations.length === 0) return { score: 0, grade: "F", reason: "no_stabilizations" };

    const effective    = stabilizations.filter(s => s.effective === true || s.success === true).length;
    const effectRate   = effective / stabilizations.length;

    // Convergence speed: fraction that stabilized within target time
    const TARGET_MS    = 5000;
    const fastCount    = stabilizations.filter(s => (s.durationMs ?? Infinity) <= TARGET_MS).length;
    const fastRate     = fastCount / stabilizations.length;

    // Waste: fraction that used more retries/steps than necessary (> 3 steps = inefficient)
    const wasteful     = stabilizations.filter(s => (s.steps ?? 0) > 3).length;
    const wasteRate    = wasteful / stabilizations.length;

    const raw   = effectRate * 50 + fastRate * 30 + (1 - wasteRate) * 20;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "stabilization_efficiency", score, ts: new Date().toISOString() });
    return { score, grade, effectRate: +effectRate.toFixed(3), fastRate: +fastRate.toFixed(3), wasteRate: +wasteRate.toFixed(3), total: stabilizations.length };
}

// ── gradeLearningMaturity ─────────────────────────────────────────────

function gradeLearningMaturity(scores = {}) {
    const values = Object.values(scores).filter(v => typeof v === "number");
    if (values.length === 0) return { grade: "F", score: 0, maturity: MATURITY_LEVELS.F };

    const avg   = values.reduce((s, v) => s + v, 0) / values.length;
    const grade = avg >= 90 ? "A" : avg >= 75 ? "B" : avg >= 60 ? "C" : avg >= 40 ? "D" : "F";
    return { score: +avg.toFixed(1), grade, maturity: MATURITY_LEVELS[grade], inputs: values.length };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _benchmarkHistory = []; }

module.exports = {
    MATURITY_LEVELS,
    scorePredictionAccuracy, scoreRecoveryEffectiveness,
    scoreRetryOptimization, scoreAnomalyForecastPrecision,
    scoreStabilizationEfficiency, gradeLearningMaturity, reset,
};
