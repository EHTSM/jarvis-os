"use strict";
/**
 * reproducibilityScorer — score how reproducible/deterministic a workflow is.
 *
 * score(workflowId, n?)
 *   → { score, verdict, factors[], successRateVariance, durationVariance }
 *   n = number of recent history records to evaluate (default 10)
 *
 * Verdict: "deterministic" (≥85) | "reliable" (≥65) | "flaky" (≥40) | "non-deterministic" (<40)
 */

const history = require("../executionHistory.cjs");

const DEFAULT_N = 10;

function score(workflowId, n = DEFAULT_N) {
    const recs = history.getAll()
        .filter(r => r.taskType === `workflow:${workflowId}`)
        .slice(-n);

    if (recs.length < 2) {
        return {
            score:               null,
            verdict:             "insufficient_data",
            factors:             [],
            successRateVariance: null,
            durationVariance:    null,
            sampleSize:          recs.length,
        };
    }

    const factors = [];
    let   points  = 100;

    // 1. Success rate consistency
    const successes  = recs.filter(r => r.success).length;
    const successRate = successes / recs.length;

    // Run-to-run success consistency: how often does the outcome flip?
    let flips = 0;
    for (let i = 1; i < recs.length; i++) {
        if (recs[i].success !== recs[i - 1].success) flips++;
    }
    const flipRate = flips / (recs.length - 1);
    if (flipRate > 0.5)       { points -= 40; factors.push("high_outcome_variance"); }
    else if (flipRate > 0.25) { points -= 20; factors.push("moderate_outcome_variance"); }

    // 2. Duration variance
    const durations = recs.filter(r => r.durationMs > 0).map(r => r.durationMs);
    let durationVariance = null;
    if (durations.length >= 2) {
        const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
        const variance = durations.reduce((s, d) => s + (d - mean) ** 2, 0) / durations.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;  // coefficient of variation
        durationVariance = parseFloat(cv.toFixed(3));
        if (cv > 1.0)  { points -= 20; factors.push("high_duration_variance"); }
        else if (cv > 0.5) { points -= 10; factors.push("moderate_duration_variance"); }
    }

    // 3. Low sample penalty
    if (recs.length < 5) { points -= 10; factors.push("small_sample"); }

    // 4. Always-failing is predictable (not flaky, just broken)
    if (successRate === 0 && flipRate === 0) {
        points = Math.max(points, 60);
        factors.push("consistently_failing");
    }

    points = Math.max(0, Math.min(100, Math.round(points)));

    return {
        score:               points,
        verdict:             _verdict(points),
        factors,
        successRate:         parseFloat(successRate.toFixed(3)),
        flipRate:            parseFloat(flipRate.toFixed(3)),
        successRateVariance: parseFloat((successRate * (1 - successRate)).toFixed(3)),
        durationVariance,
        sampleSize:          recs.length,
    };
}

function _verdict(points) {
    if (points >= 85) return "deterministic";
    if (points >= 65) return "reliable";
    if (points >= 40) return "flaky";
    return "non-deterministic";
}

module.exports = { score, DEFAULT_N };
