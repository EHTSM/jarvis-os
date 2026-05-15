"use strict";
/**
 * successPredictor — forecast workflow success before execution.
 *
 * predict(workflowId, context?)
 *   → { score, confidence, predictedSuccess, repairProbability, factors[] }
 *
 * forecastExecution(workflowId, n?)
 *   → { expectedSuccess, confidence, trend, sampleSize }
 *
 * Reads execution history + failure memory. Stateless (no reset needed).
 */

const history = require("../executionHistory.cjs");
const fm      = require("../failureMemory.cjs");
const qs      = require("../qualityScorer.cjs");

const MIN_SAMPLES       = 2;
const CONFIDENCE_SCALE  = 0.80;   // max confidence from history alone

function predict(workflowId, context = {}) {
    const recs = history.byType(`workflow:${workflowId}`);
    const factors = [];

    if (recs.length < MIN_SAMPLES) {
        return {
            score:            50,
            confidence:       0,
            predictedSuccess: null,
            repairProbability: _repairProb(workflowId),
            factors:          ["insufficient_history"],
        };
    }

    // Recent success rate (last 20 runs)
    const recent = recs.slice(0, 20);
    const successRate = recent.filter(r => r.success).length / recent.length;

    // Trend boost/penalty
    const trend   = qs.executionConfidenceTrend(workflowId, 10);
    let   trendAdj = 0;
    if (trend.direction === "improving") { trendAdj = +5;  factors.push("improving_trend"); }
    if (trend.direction === "degrading") { trendAdj = -10; factors.push("degrading_trend"); }

    // Recency weight: last 5 runs count double
    const last5    = recent.slice(0, 5);
    const last5Rate = last5.length > 0
        ? last5.filter(r => r.success).length / last5.length
        : successRate;

    const blended = successRate * 0.55 + last5Rate * 0.45;
    const rawScore = Math.round(Math.min(100, Math.max(0, blended * 100 + trendAdj)));

    if (successRate < 0.40) factors.push("low_success_rate");
    if (successRate > 0.80) factors.push("high_success_rate");
    if (recs.length >= 10)  factors.push("sufficient_history");

    const confidence = Math.min(
        CONFIDENCE_SCALE,
        parseFloat(((recs.length / 20) * CONFIDENCE_SCALE).toFixed(3))
    );

    return {
        score:            rawScore,
        confidence,
        predictedSuccess: rawScore >= 50,
        repairProbability: _repairProb(workflowId),
        factors,
        sampleSize:        recs.length,
    };
}

function forecastExecution(workflowId, n = 10) {
    const recs = history.byType(`workflow:${workflowId}`).slice(0, n);

    if (recs.length < MIN_SAMPLES) {
        return {
            expectedSuccess: null,
            confidence:      0,
            trend:           "unknown",
            sampleSize:      recs.length,
        };
    }

    const successRate = recs.filter(r => r.success).length / recs.length;
    const trend       = qs.executionConfidenceTrend(workflowId, n);
    const confidence  = Math.min(0.90, parseFloat((recs.length / n).toFixed(3)));

    return {
        expectedSuccess: successRate >= 0.5,
        successRate:     parseFloat(successRate.toFixed(3)),
        confidence,
        trend:           trend.direction,
        delta:           trend.delta,
        sampleSize:      recs.length,
    };
}

function _repairProb(workflowId) {
    const snap = fm.snapshot();
    // Look for any strategies linked to this workflow name
    const key  = Object.keys(snap).find(k => k.includes(workflowId));
    if (!key) return null;
    const s = snap[key];
    return s.attempts > 0 ? parseFloat((s.successes / s.attempts).toFixed(3)) : null;
}

module.exports = { predict, forecastExecution };
