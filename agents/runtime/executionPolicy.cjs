"use strict";
/**
 * executionPolicy — adaptive execution mode selection.
 *
 * Policies:
 *   aggressive   — maximum retries, allows high-risk ops, no fail-fast
 *   balanced     — default (3 retries, moderate guards)
 *   conservative — minimal retries, sandboxed, fail-fast on first error
 *   auto         — self-select based on workflow risk score
 *
 * selectPolicy(riskScore)
 *   < 0.20  → aggressive
 *   ≥ 0.60  → conservative
 *   else    → balanced
 *
 * applyPolicy(policyName, opts)
 *   Returns a new opts object with policy-derived values merged in.
 *   Caller-supplied values always win (opt-in override).
 */

const POLICIES = {
    aggressive: {
        maxRetries:        5,
        allowHighRisk:     true,
        failFast:          false,
        sandboxed:         false,
        skipOptional:      false,
        timeoutMultiplier: 2.0,
        description:       "Maximum retries, high-risk ops allowed, no fail-fast",
    },
    balanced: {
        maxRetries:        3,
        allowHighRisk:     false,
        failFast:          false,
        sandboxed:         false,
        skipOptional:      false,
        timeoutMultiplier: 1.5,
        description:       "Default: moderate retries, no high-risk ops",
    },
    conservative: {
        maxRetries:        1,
        allowHighRisk:     false,
        failFast:          true,
        sandboxed:         true,
        skipOptional:      true,
        timeoutMultiplier: 1.0,
        description:       "Minimal retries, sandboxed, fail-fast on first error",
    },
};

const AGGRESSIVE_THRESHOLD   = 0.20;
const CONSERVATIVE_THRESHOLD = 0.60;

// ── API ───────────────────────────────────────────────────────────────

/** Return the policy config object by name (defaults to balanced). */
function getPolicy(name) {
    return POLICIES[name] || POLICIES.balanced;
}

/** Auto-select a policy name from a 0–1 risk score. */
function selectPolicy(riskScore) {
    if (typeof riskScore !== "number") return "balanced";
    if (riskScore < AGGRESSIVE_THRESHOLD)    return "aggressive";
    if (riskScore >= CONSERVATIVE_THRESHOLD) return "conservative";
    return "balanced";
}

/**
 * Merge policy defaults into opts.
 * Caller-supplied values take precedence (policy is a default, not an override).
 *
 * @param {string} policyName
 * @param {object} opts
 * @returns {object} merged opts
 */
function applyPolicy(policyName, opts = {}) {
    const policy = getPolicy(policyName);
    return {
        maxRetries:    opts.maxRetries    ?? policy.maxRetries,
        allowHighRisk: opts.allowHighRisk ?? policy.allowHighRisk,
        failFast:      opts.failFast      ?? policy.failFast,
        sandboxed:     opts.sandboxed     ?? policy.sandboxed,
        ...opts,
        _policy:       policyName,
        _policyConfig: policy,
    };
}

/** All valid policy names. */
function allPolicies() {
    return Object.keys(POLICIES);
}

module.exports = {
    getPolicy,
    selectPolicy,
    applyPolicy,
    allPolicies,
    POLICIES,
    AGGRESSIVE_THRESHOLD,
    CONSERVATIVE_THRESHOLD,
};
