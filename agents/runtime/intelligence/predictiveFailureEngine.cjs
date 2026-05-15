"use strict";
/**
 * predictiveFailureEngine — pre-failure risk scoring and trend-based failure prediction.
 *
 * scoreFailureRisk(metrics)                      → RiskScore
 * detectAnomalyTrend(history)                    → TrendResult
 * predictRetryEscalation(retryHistory)           → EscalationPrediction
 * predictDegradationProbability(degradations)    → DegradationPrediction
 * predictCascadeProbability(topology, incident)  → CascadePrediction
 * forecastSaturation(utilizationHistory)         → SaturationForecast
 * scoreInstabilityRisk(executions)               → InstabilityScore
 * reset()
 */

const RISK_THRESHOLDS = {
    critical: 80,
    high:     60,
    medium:   40,
    low:      20,
    none:     0,
};

let _riskHistory = [];

// ── scoreFailureRisk ──────────────────────────────────────────────────

function scoreFailureRisk(metrics = {}) {
    const {
        errorRate     = 0,
        avgRetries    = 0,
        rollbackRate  = 0,
        latencySpike  = 0,   // ratio above baseline
        memoryPressure = 0,  // 0..1
    } = metrics;

    const raw = Math.min(100,
        errorRate      * 40 +
        avgRetries     * 10 +
        rollbackRate   * 20 +
        latencySpike   * 20 +
        memoryPressure * 10
    );
    const score = +raw.toFixed(1);
    const level = score >= 80 ? "critical" :
                  score >= 60 ? "high"     :
                  score >= 40 ? "medium"   :
                  score >= 20 ? "low"      : "none";

    const record = { score, level, metrics: { ...metrics }, ts: new Date().toISOString() };
    _riskHistory.push(record);
    return { score, level, riskThresholds: RISK_THRESHOLDS };
}

// ── detectAnomalyTrend ────────────────────────────────────────────────

function detectAnomalyTrend(history = []) {
    if (history.length < 2) return { trending: false, direction: "flat", reason: "insufficient_data" };

    const scores = history.map(h => h.score ?? h.value ?? 0);
    let rising = 0, falling = 0;
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] > scores[i - 1]) rising++;
        else if (scores[i] < scores[i - 1]) falling++;
    }

    const total     = scores.length - 1;
    const riseRatio = rising  / total;
    const fallRatio = falling / total;

    const direction = riseRatio  >= 0.6 ? "rising"  :
                      fallRatio  >= 0.6 ? "falling" : "flat";
    const trending  = direction !== "flat";
    const severity  = trending && riseRatio >= 0.8 ? "critical" :
                      trending && riseRatio >= 0.6 ? "high"     : "low";

    return { trending, direction, riseRatio: +riseRatio.toFixed(3), fallRatio: +fallRatio.toFixed(3), severity, dataPoints: history.length };
}

// ── predictRetryEscalation ────────────────────────────────────────────

function predictRetryEscalation(retryHistory = []) {
    if (retryHistory.length === 0) return { escalating: false, reason: "no_history" };

    const recentWindow = retryHistory.slice(-10);
    const avgRecent    = recentWindow.reduce((s, r) => s + (r.retryCount ?? r), 0) / recentWindow.length;
    const avgAll       = retryHistory.reduce((s, r) => s + (r.retryCount ?? r), 0) / retryHistory.length;
    const trend        = avgRecent - avgAll;
    const escalating   = trend > 0.5 || avgRecent > 3;

    return {
        escalating,
        avgRecentRetries: +avgRecent.toFixed(2),
        avgOverallRetries: +avgAll.toFixed(2),
        trendDelta:       +trend.toFixed(2),
        predictedNextAvg: +Math.max(0, avgRecent + trend * 0.5).toFixed(2),
    };
}

// ── predictDegradationProbability ────────────────────────────────────

function predictDegradationProbability(degradations = []) {
    if (degradations.length === 0) return { probability: 0, level: "none" };

    const recentCount  = degradations.filter(d => {
        if (!d.ts) return true;
        return Date.now() - new Date(d.ts).getTime() < 300000; // last 5 min
    }).length;

    const criticalCount = degradations.filter(d => d.severity === "critical" || d.severity === "high").length;
    const baseProb      = Math.min(1, recentCount / 10 + criticalCount / (degradations.length + 1) * 0.5);
    const probability   = +baseProb.toFixed(3);
    const level         = probability >= 0.8 ? "critical" :
                          probability >= 0.6 ? "high"     :
                          probability >= 0.4 ? "medium"   :
                          probability >= 0.2 ? "low"      : "none";

    return { probability, level, recentEvents: recentCount, criticalEvents: criticalCount, totalEvents: degradations.length };
}

// ── predictCascadeProbability ─────────────────────────────────────────

function predictCascadeProbability(topology = {}, incident = {}) {
    const { services = [], dependencies = [] } = topology;
    const affectedServices = incident.affectedServices ?? [];
    const criticality      = incident.severity === "P1" ? 1.0 :
                             incident.severity === "P2" ? 0.6 : 0.3;

    // How many downstream services could be affected?
    const downstreamSet = new Set();
    for (const dep of dependencies) {
        if (affectedServices.includes(dep.from)) downstreamSet.add(dep.to);
    }

    const totalServices    = services.length || 1;
    const downstreamRatio  = downstreamSet.size / totalServices;
    const probability      = +Math.min(1, criticality * 0.5 + downstreamRatio * 0.5).toFixed(3);
    const level            = probability >= 0.7 ? "critical" :
                             probability >= 0.5 ? "high"     :
                             probability >= 0.3 ? "medium"   : "low";

    return {
        probability,
        level,
        affectedCount:  affectedServices.length,
        downstreamCount: downstreamSet.size,
        totalServices,
    };
}

// ── forecastSaturation ────────────────────────────────────────────────

function forecastSaturation(utilizationHistory = []) {
    if (utilizationHistory.length < 2) return { saturated: false, reason: "insufficient_data" };

    const values   = utilizationHistory.map(u => u.utilization ?? u);
    const current  = values[values.length - 1];
    const prev     = values[values.length - 2];
    const slope    = current - prev;
    const avgSlope = values.length > 2
        ? (current - values[0]) / (values.length - 1)
        : slope;

    const projectedIn5 = current + avgSlope * 5;
    const saturated    = current >= 0.9;
    const willSaturate = !saturated && projectedIn5 >= 0.9;
    const stepsToSat   = avgSlope > 0 ? Math.ceil((0.9 - current) / avgSlope) : null;

    return {
        saturated,
        willSaturate,
        currentUtilization: +current.toFixed(3),
        projectedIn5Steps:  +Math.min(1, projectedIn5).toFixed(3),
        stepsToSaturation:  stepsToSat,
        slope:              +avgSlope.toFixed(4),
    };
}

// ── scoreInstabilityRisk ──────────────────────────────────────────────

function scoreInstabilityRisk(executions = []) {
    if (executions.length === 0) return { score: 0, level: "none", reason: "no_executions" };

    const failRate    = executions.filter(e => !e.success).length / executions.length;
    const avgRetries  = executions.reduce((s, e) => s + (e.retryCount ?? 0), 0) / executions.length;
    const rollbackRate = executions.filter(e => e.rollbackTriggered).length / executions.length;

    const raw   = Math.min(100, failRate * 50 + avgRetries * 10 + rollbackRate * 30);
    const score = +raw.toFixed(1);
    const level = score >= 80 ? "critical" :
                  score >= 60 ? "high"     :
                  score >= 40 ? "medium"   :
                  score >= 20 ? "low"      : "none";

    return { score, level, failRate: +failRate.toFixed(3), avgRetries: +avgRetries.toFixed(2), rollbackRate: +rollbackRate.toFixed(3) };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _riskHistory = []; }

module.exports = {
    RISK_THRESHOLDS,
    scoreFailureRisk, detectAnomalyTrend, predictRetryEscalation,
    predictDegradationProbability, predictCascadeProbability,
    forecastSaturation, scoreInstabilityRisk, reset,
};
