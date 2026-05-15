"use strict";
/**
 * qualityScorer — execution quality metrics for workflow reliability.
 *
 * Scores are derived from execution history and pattern cluster data:
 *
 *   determinismScore(name)           — 0–100: how consistently the workflow succeeds
 *   recoveryStabilityScore(name)     — 0–100: how predictable recovery behaviour is
 *   workflowReliabilityScore(name)   — 0–100: composite success+determinism+stability
 *   executionConfidenceTrend(name,n) — sliding window trend with direction
 *
 * Workflow records are stored in executionHistory under taskType "workflow:<name>".
 * autonomousWorkflow emits one such record per completed/failed run.
 */

const history = require("./executionHistory.cjs");
const pcl     = require("./patternCluster.cjs");

// ── Helpers ───────────────────────────────────────────────────────────

/** All history records for a workflow name (newest first). */
function _wfRecords(workflowName) {
    if (!workflowName) return history.recent(500);
    return history.byType(`workflow:${workflowName}`);
}

// ── Scores ────────────────────────────────────────────────────────────

/**
 * Determinism score: 100 = always same outcome (all pass or all fail).
 * 0 = perfectly random 50/50.
 *
 * Formula: |successRate − 0.5| × 200  → 0–100
 */
function determinismScore(workflowName) {
    const recs = _wfRecords(workflowName);
    if (recs.length < 2) return 100;
    const rate = recs.filter(r => r.success).length / recs.length;
    return Math.round(Math.abs(rate - 0.5) * 200);
}

/**
 * Recovery stability score: 100 = recovery always works or always fails.
 * 0 = completely unpredictable recovery.
 *
 * Uses Bernoulli variance of per-cluster success rates.
 * avgVariance → 0–0.25;  score = (1 − avgVariance / 0.25) × 100
 */
function recoveryStabilityScore(workflowName) {
    let clusters = pcl.getClusters();

    // If a workflow name is provided, restrict to clusters that name-match
    if (workflowName) {
        const norm = workflowName.toLowerCase().replace(/[^a-z0-9]/g, "");
        clusters = clusters.filter(c => {
            const cn = (c.stepName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            return cn.includes(norm) || norm.includes(cn);
        });
    }

    if (clusters.length === 0) return 100;

    const avgVariance =
        clusters.reduce((s, c) => s + c.successRate * (1 - c.successRate), 0) / clusters.length;

    return Math.max(0, Math.round((1 - avgVariance / 0.25) * 100));
}

/**
 * Composite reliability score.
 * Weighted: successRate 50%, determinism 25%, recovery stability 25%.
 */
function workflowReliabilityScore(workflowName) {
    const recs = _wfRecords(workflowName);
    if (recs.length === 0) return 0;

    const successRate  = recs.filter(r => r.success).length / recs.length;
    const det          = determinismScore(workflowName)        / 100;
    const recStability = recoveryStabilityScore(workflowName)  / 100;

    return Math.round((successRate * 0.50 + det * 0.25 + recStability * 0.25) * 100);
}

/**
 * Execution confidence trend over the last n runs.
 *
 * Returns:
 *   trend     — array of 0/100 per run (100=success)
 *   direction — "improving" | "degrading" | "stable"
 *   delta     — regression slope (positive = improving)
 *   samples   — actual sample count
 */
function executionConfidenceTrend(workflowName, n = 10) {
    const recs   = _wfRecords(workflowName).slice(0, n).reverse();  // oldest→newest
    if (recs.length === 0) return { trend: [], direction: "stable", delta: 0, samples: 0 };

    const scores  = recs.map(r => r.success ? 100 : 0);
    const len     = scores.length;
    const xMean   = (len - 1) / 2;
    const yMean   = scores.reduce((s, v) => s + v, 0) / len;

    let num = 0, den = 0;
    scores.forEach((y, x) => {
        num += (x - xMean) * (y - yMean);
        den += (x - xMean) ** 2;
    });

    const slope     = den > 0 ? num / den : 0;
    const direction = slope > 5 ? "improving" : slope < -5 ? "degrading" : "stable";

    return { trend: scores, direction, delta: parseFloat(slope.toFixed(2)), samples: len };
}

module.exports = {
    determinismScore,
    recoveryStabilityScore,
    workflowReliabilityScore,
    executionConfidenceTrend,
};
