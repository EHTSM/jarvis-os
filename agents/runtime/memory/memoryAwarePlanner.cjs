"use strict";
/**
 * memoryAwarePlanner — memory-guided planning decisions.
 *
 * lookupPlan(fingerprint, entries)            → { found, record?, recommendation, strategy? }
 * shouldReject(fingerprint, entries, n?)      → { reject, reason? }
 *   reject when ≥n failures with 0 successes (default n=3)
 * boostConfidence(confidence, fingerprint, entries) → number
 *   +10 per proven success, capped at +25
 * worstCaseStrategy(fingerprint, entries)     → strategy string
 *   most conservative strategy seen for failures of this fingerprint
 */

function lookupPlan(fingerprint, entries = []) {
    const hits = entries.filter(e => e.fingerprint === fingerprint && e.success);
    if (hits.length === 0) {
        const anyHits = entries.filter(e => e.fingerprint === fingerprint);
        return {
            found: false,
            recommendation: anyHits.length > 0 ? "proceed_with_caution" : "no_history",
        };
    }
    const latest = hits[hits.length - 1];
    return { found: true, record: latest, recommendation: "reuse_strategy", strategy: latest.strategy ?? null };
}

function shouldReject(fingerprint, entries = [], threshold = 3) {
    const matching  = entries.filter(e => e.fingerprint === fingerprint);
    if (matching.length === 0) return { reject: false };

    const failures  = matching.filter(e => !e.success).length;
    const successes = matching.filter(e => e.success).length;

    if (failures >= threshold && successes === 0) {
        return { reject: true, reason: `${failures} failures, 0 successes for fingerprint ${fingerprint}` };
    }
    return { reject: false };
}

function boostConfidence(confidence, fingerprint, entries = []) {
    const successes = entries.filter(e => e.fingerprint === fingerprint && e.success).length;
    const boost     = Math.min(25, successes * 10);
    return Math.min(100, Math.round(confidence + boost));
}

function worstCaseStrategy(fingerprint, entries = []) {
    const failures = entries.filter(e => e.fingerprint === fingerprint && !e.success);
    if (failures.length === 0) return "safe";
    // Among failure strategies, pick the most "dangerous" one seen — avoid repeating it
    // Return "recovery_first" as conservative fallback when failures exist
    return "recovery_first";
}

module.exports = { lookupPlan, shouldReject, boostConfidence, worstCaseStrategy };
