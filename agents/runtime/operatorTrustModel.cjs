"use strict";
/**
 * Phase 416 — Operator Trust Refinement
 *
 * Tracks execution certainty to prevent false confidence.
 * Trust score (0–100) reflects how reliable the runtime's outputs have been.
 *
 * Trust degrades when:
 *   - Verification reports false positives
 *   - Steps succeed but probes fail
 *   - Consecutive recoveries are needed
 *
 * Trust recovers when:
 *   - Probes verify steps as truly successful
 *   - Sessions complete with high confidence
 *   - No false positives detected over a window
 *
 * Trust is session-scoped: each session starts at 100. Operator sees trust
 * signal before auto-continuing or accepting a result as authoritative.
 */

const SESSION_INITIAL_TRUST = 100;
const FALSE_POSITIVE_PENALTY = 25; // large: we stopped trusting a "success"
const PROBE_FAIL_PENALTY     = 10;
const CONSECUTIVE_RECOVERY_PENALTY = 8;
const PROBE_PASS_REWARD      = 5;
const SESSION_COMPLETE_REWARD = 10;
const MAX_TRUST = 100;
const MIN_TRUST = 0;

// In-memory trust per session (resets on process restart — intentional)
const _trust = new Map(); // sessionId → { score, events[] }

function _get(sessionId) {
    if (!_trust.has(sessionId)) {
        _trust.set(sessionId, { score: SESSION_INITIAL_TRUST, events: [] });
    }
    return _trust.get(sessionId);
}

function _record(sessionId, event, delta) {
    const t = _get(sessionId);
    t.score = Math.max(MIN_TRUST, Math.min(MAX_TRUST, t.score + delta));
    t.events.push({ ts: Date.now(), event, delta, score: t.score });
    if (t.events.length > 50) t.events.shift();
}

/**
 * Report a false-positive detection (step said OK, probe said otherwise).
 * @param {string} sessionId
 */
function reportFalsePositive(sessionId) {
    _record(sessionId, "false_positive", -FALSE_POSITIVE_PENALTY);
}

/**
 * Report that a verification probe failed after a nominally successful step.
 * @param {string} sessionId
 */
function reportProbeFail(sessionId) {
    _record(sessionId, "probe_fail", -PROBE_FAIL_PENALTY);
}

/**
 * Report that consecutive recoveries were needed (unexpected instability).
 * @param {string} sessionId
 */
function reportConsecutiveRecovery(sessionId) {
    _record(sessionId, "consecutive_recovery", -CONSECUTIVE_RECOVERY_PENALTY);
}

/**
 * Report that a probe confirmed a step's success (true positive).
 * @param {string} sessionId
 */
function reportProbePass(sessionId) {
    _record(sessionId, "probe_pass", +PROBE_PASS_REWARD);
}

/**
 * Report that a session completed successfully with high confidence.
 * @param {string} sessionId
 */
function reportSessionComplete(sessionId) {
    _record(sessionId, "session_complete", +SESSION_COMPLETE_REWARD);
}

/**
 * Get the current trust score and level for a session.
 * @param {string} sessionId
 * @returns {{ score: number, level: string, events: Array }}
 */
function getTrust(sessionId) {
    const t = _get(sessionId);
    const level =
        t.score >= 80 ? "high"     :
        t.score >= 55 ? "moderate" :
        t.score >= 30 ? "low"      : "critical";
    return { score: t.score, level, recentEvents: t.events.slice(-10) };
}

/**
 * Determine if operator should be shown a trust warning.
 * Returns true when trust is below "moderate" — operator should confirm before proceeding.
 * @param {string} sessionId
 * @returns {boolean}
 */
function requiresConfirmation(sessionId) {
    return _get(sessionId).score < 55;
}

/**
 * Reset trust for a session (when operator manually confirms state is clean).
 * Does not restore to 100 — resets to 70 (moderate) to reflect manual verification.
 * @param {string} sessionId
 */
function manualReset(sessionId) {
    const t = _get(sessionId);
    t.score = 70;
    t.events.push({ ts: Date.now(), event: "manual_reset", delta: 0, score: 70 });
}

module.exports = {
    reportFalsePositive, reportProbeFail, reportConsecutiveRecovery,
    reportProbePass, reportSessionComplete,
    getTrust, requiresConfirmation, manualReset,
};
