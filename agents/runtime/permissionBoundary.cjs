"use strict";
/**
 * permissionBoundary — autonomous permission level enforcement.
 *
 * Permission levels (numeric, ordered):
 *   READ_ONLY  (0) — ctx reads only, no workflow mutations
 *   LIMITED    (1) — non-risky steps, no system calls
 *   TRUSTED    (2) — full execution
 *   PRIVILEGED (3) — high-risk operations allowed
 *
 * Derived from trust score (trustScorer.getTrustLevel).
 *
 * High-risk operations (riskScore ≥ HIGH_RISK_THRESHOLD) require PRIVILEGED.
 * This threshold matches costModel.shouldRollback's threshold (0.55).
 */

const trust = require("./trustScorer.cjs");

const LEVELS = { READ_ONLY: 0, LIMITED: 1, TRUSTED: 2, PRIVILEGED: 3 };
const LEVEL_NAMES = { 0: "read_only", 1: "limited", 2: "trusted", 3: "privileged" };

const HIGH_RISK_THRESHOLD = 0.55;

// ── Helpers ───────────────────────────────────────────────────────────

function _trustNameToLevel(name) {
    if (name === "privileged") return LEVELS.PRIVILEGED;
    if (name === "trusted")    return LEVELS.TRUSTED;
    return LEVELS.LIMITED;
}

// ── API ───────────────────────────────────────────────────────────────

/** Effective permission level derived from this workflow's trust score. */
function getEffectiveLevel(workflowName) {
    return _trustNameToLevel(trust.getTrustLevel(workflowName).name);
}

/**
 * Check whether a workflow has at least `requiredLevel` permission.
 *
 * @param {string} workflowName
 * @param {number} requiredLevel  — LEVELS constant
 * @returns {{ allowed, reason, level, levelName }}
 */
function checkPermission(workflowName, requiredLevel) {
    const effective = getEffectiveLevel(workflowName);
    if (effective >= requiredLevel) {
        return { allowed: true, reason: "permission_granted", level: effective, levelName: LEVEL_NAMES[effective] };
    }
    return {
        allowed:      false,
        reason:       "insufficient_trust",
        level:        effective,
        levelName:    LEVEL_NAMES[effective],
        required:     requiredLevel,
        requiredName: LEVEL_NAMES[requiredLevel],
    };
}

/**
 * Check whether a step with a given risk score requires human escalation.
 * High-risk operations on non-privileged workflows are flagged.
 *
 * @param {string} workflowName
 * @param {number} stepRiskScore  — 0–1 from costModel.workflowRiskScore
 * @returns {{ escalate, reason?, currentLevel? }}
 */
function requiresEscalation(workflowName, stepRiskScore) {
    if (stepRiskScore < HIGH_RISK_THRESHOLD) return { escalate: false };
    if (getEffectiveLevel(workflowName) >= LEVELS.PRIVILEGED) return { escalate: false };

    return {
        escalate:     true,
        reason:       "high_risk_operation_requires_privilege",
        riskScore:    stepRiskScore,
        currentLevel: LEVEL_NAMES[getEffectiveLevel(workflowName)],
    };
}

/**
 * Given a list of steps and a costModel reference, return which steps
 * would require escalation for this workflow.
 */
function escalationRequired(workflowName, steps, costModelRef) {
    if (!costModelRef) return [];
    return steps
        .map(s => {
            const risk  = costModelRef.workflowRiskScore([s]);
            const check = requiresEscalation(workflowName, risk);
            return check.escalate ? { stepName: s.name, riskScore: risk, ...check } : null;
        })
        .filter(Boolean);
}

module.exports = {
    LEVELS,
    LEVEL_NAMES,
    HIGH_RISK_THRESHOLD,
    getEffectiveLevel,
    checkPermission,
    requiresEscalation,
    escalationRequired,
};
