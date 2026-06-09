"use strict";
/**
 * Phase 413 — Execution Chain Validation Scorer
 *
 * Per-step validation scoring. After each step, assigns a confidence score
 * based on: step success, probe results, approval level, and historical data.
 *
 * Chain confidence accumulates across steps.
 * When confidence drops below ROLLBACK_THRESHOLD, recommends rollback.
 *
 * Score per step: 0–100
 *   90–100: step verified by probes, high confidence
 *   70–89:  step succeeded, no probes (assumed OK)
 *   50–69:  step succeeded but with warnings
 *   30–49:  step failed but is recoverable
 *   0–29:   step failed critically
 *
 * Chain score: weighted average (recent steps weighted higher).
 * Rollback is recommended when chain score < 40 after a CRITICAL step fails.
 */

const ROLLBACK_THRESHOLD = 40;

/**
 * Score a single step outcome.
 * @param {object} opts
 * @param {boolean} opts.success       — did the step complete without error?
 * @param {object|null} opts.probe     — { verified, checks[], falsePositive } from verifier
 * @param {string} opts.approvalLevel  — "SAFE" | "CAUTION" | "CRITICAL"
 * @param {boolean} opts.hasRetried    — was this step already retried once?
 * @returns {{ score: number, label: string, details: object }}
 */
function scoreStep({ success, probe, approvalLevel, hasRetried }) {
    if (!success) {
        // Critical approval level that failed → worst outcome
        if (approvalLevel === "CRITICAL") return { score: 10, label: "critical_failure", details: { success, approvalLevel } };
        if (hasRetried)                   return { score: 20, label: "retry_exhausted",  details: { success, hasRetried } };
        return { score: 30, label: "step_failed", details: { success } };
    }

    if (probe?.falsePositive) {
        return { score: 55, label: "false_positive_detected", details: { probe } };
    }

    if (probe?.verified) {
        const checksPassed = probe.checks?.filter(c => c.ok !== false).length || 0;
        const total        = probe.checks?.length || 1;
        const ratio        = checksPassed / total;
        const score        = Math.round(70 + ratio * 30); // 70–100
        return { score, label: "probe_verified", details: { checksPassed, total, probe } };
    }

    if (probe && !probe.verified) {
        return { score: 55, label: "probe_failed", details: { probe } };
    }

    // No probe — step succeeded, assume OK
    if (approvalLevel === "CRITICAL") return { score: 72, label: "critical_unverified", details: {} };
    if (hasRetried)                   return { score: 70, label: "succeeded_after_retry", details: {} };
    return { score: 80, label: "success_no_probe", details: {} };
}

/**
 * Compute chain confidence from an array of step scores.
 * More recent steps carry higher weight.
 *
 * @param {number[]} stepScores — array of per-step scores (oldest first)
 * @returns {number} 0–100
 */
function computeChainConfidence(stepScores) {
    if (!stepScores.length) return 100;
    // Weights: most recent step gets weight N, oldest gets weight 1
    let weightedSum = 0;
    let totalWeight = 0;
    stepScores.forEach((score, i) => {
        const w = i + 1;
        weightedSum += score * w;
        totalWeight += w;
    });
    return Math.round(weightedSum / totalWeight);
}

/**
 * Determine if rollback should be recommended.
 * @param {number[]} stepScores
 * @param {string} lastApprovalLevel
 * @param {boolean} lastSuccess
 * @returns {{ recommend: boolean, reason: string }}
 */
function rollbackRecommendation(stepScores, lastApprovalLevel, lastSuccess) {
    const chainScore = computeChainConfidence(stepScores);
    if (!lastSuccess && lastApprovalLevel === "CRITICAL" && chainScore < ROLLBACK_THRESHOLD) {
        return { recommend: true, reason: `chain_score=${chainScore} after CRITICAL step failure` };
    }
    if (chainScore < ROLLBACK_THRESHOLD) {
        return { recommend: true, reason: `chain_score=${chainScore} below rollback threshold` };
    }
    return { recommend: false, reason: "" };
}

/**
 * Full chain scoring: given an array of completed steps, return full scoring report.
 * @param {Array<{ success, probe, approvalLevel, hasRetried }>} steps
 * @returns {{ stepScores: Array, chainConfidence: number, rollback: object, label: string }}
 */
function scoreChain(steps) {
    const stepResults = steps.map(s => scoreStep(s));
    const stepScores  = stepResults.map(r => r.score);
    const chainConfidence = computeChainConfidence(stepScores);
    const last = steps[steps.length - 1] || {};
    const rollback = rollbackRecommendation(stepScores, last.approvalLevel, last.success ?? true);

    const label =
        chainConfidence >= 80 ? "confident" :
        chainConfidence >= 60 ? "acceptable" :
        chainConfidence >= 40 ? "marginal"   : "poor";

    return { stepScores: stepResults, chainConfidence, rollback, label };
}

module.exports = { scoreStep, computeChainConfidence, rollbackRecommendation, scoreChain, ROLLBACK_THRESHOLD };
