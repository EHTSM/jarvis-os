"use strict";
/**
 * adaptivePolicyTuner — dynamically adjusts runtime policies from observed outcomes.
 *
 * tune(policyKey, observations)  → TuneResult
 * getPolicy(policyKey)           → PolicyState
 * applyAll(contexts[])           → TuningReport
 * reset(policyKey?)
 */

const DEFAULTS = {
    retryLimit:              3,
    concurrencyLevel:        4,
    throttleSensitivity:     0.7,    // 0-1: higher = throttle sooner
    sandboxThreshold:        0.4,    // rollbackRate above this → sandbox
    circuitBreakerThreshold: 3,      // consecutive failures before open
};

let _policies = new Map();  // policyKey → PolicyState

function _get(policyKey) {
    if (!_policies.has(policyKey)) {
        _policies.set(policyKey, { ...DEFAULTS, policyKey, tuningCount: 0 });
    }
    return _policies.get(policyKey);
}

// ── tune ──────────────────────────────────────────────────────────────

function tune(policyKey, observations = {}) {
    const policy   = _get(policyKey);
    const changes  = {};
    const reasons  = [];

    const {
        successRate     = null,
        rollbackRate    = 0,
        avgRetries      = 0,
        resourcePressure = "none",
        depStability    = 1.0,
        failureStreak   = 0,
    } = observations;

    // ── retryLimit ──────────────────────────────────────────────────
    if (avgRetries > 3 && successRate !== null && successRate < 0.5) {
        const next = Math.max(1, policy.retryLimit - 1);
        if (next !== policy.retryLimit) { changes.retryLimit = next; reasons.push("high_retry_low_success"); }
    } else if (avgRetries < 0.5 && successRate !== null && successRate > 0.9) {
        const next = Math.min(5, policy.retryLimit + 1);
        if (next !== policy.retryLimit) { changes.retryLimit = next; reasons.push("stable_increase_retries"); }
    }

    // ── concurrencyLevel ───────────────────────────────────────────
    if (resourcePressure === "high" || resourcePressure === "critical") {
        const next = Math.max(1, policy.concurrencyLevel - 1);
        if (next !== policy.concurrencyLevel) { changes.concurrencyLevel = next; reasons.push("resource_pressure"); }
    } else if (resourcePressure === "none" && successRate !== null && successRate > 0.85) {
        const next = Math.min(8, policy.concurrencyLevel + 1);
        if (next !== policy.concurrencyLevel) { changes.concurrencyLevel = next; reasons.push("stable_scale_up"); }
    }

    // ── throttleSensitivity ────────────────────────────────────────
    if (resourcePressure === "critical") {
        const next = Math.min(0.95, policy.throttleSensitivity + 0.1);
        if (next !== policy.throttleSensitivity) { changes.throttleSensitivity = +next.toFixed(2); reasons.push("critical_pressure"); }
    } else if (resourcePressure === "none" && policy.throttleSensitivity > DEFAULTS.throttleSensitivity) {
        const next = Math.max(DEFAULTS.throttleSensitivity, policy.throttleSensitivity - 0.05);
        if (next !== policy.throttleSensitivity) { changes.throttleSensitivity = +next.toFixed(2); reasons.push("pressure_relieved"); }
    }

    // ── sandboxThreshold ───────────────────────────────────────────
    if (rollbackRate > 0.5) {
        const next = Math.max(0.1, policy.sandboxThreshold - 0.1);
        if (next !== policy.sandboxThreshold) { changes.sandboxThreshold = +next.toFixed(2); reasons.push("high_rollback_rate"); }
    } else if (rollbackRate < 0.1 && policy.sandboxThreshold < DEFAULTS.sandboxThreshold) {
        const next = Math.min(DEFAULTS.sandboxThreshold, policy.sandboxThreshold + 0.05);
        if (next !== policy.sandboxThreshold) { changes.sandboxThreshold = +next.toFixed(2); reasons.push("low_rollback_relax"); }
    }

    // ── circuitBreakerThreshold ────────────────────────────────────
    if (failureStreak >= 5) {
        const next = Math.max(1, policy.circuitBreakerThreshold - 1);
        if (next !== policy.circuitBreakerThreshold) { changes.circuitBreakerThreshold = next; reasons.push("severe_failure_streak"); }
    } else if (depStability < 0.5) {
        const next = Math.max(2, policy.circuitBreakerThreshold - 1);
        if (next !== policy.circuitBreakerThreshold) { changes.circuitBreakerThreshold = next; reasons.push("unstable_deps"); }
    }

    const tuned = Object.keys(changes).length > 0;
    Object.assign(policy, changes);
    if (tuned) policy.tuningCount++;

    return { policyKey, tuned, changes, reasons, policy: { ...policy } };
}

// ── getPolicy ─────────────────────────────────────────────────────────

function getPolicy(policyKey) {
    return { ..._get(policyKey) };
}

// ── applyAll ──────────────────────────────────────────────────────────

function applyAll(contexts = []) {
    const results = contexts.map(ctx => tune(ctx.policyKey ?? "global", ctx.observations ?? ctx));
    return {
        tuned:   results.filter(r => r.tuned).length,
        total:   results.length,
        results,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset(policyKey) {
    if (policyKey !== undefined) _policies.delete(policyKey);
    else _policies = new Map();
}

module.exports = { DEFAULTS, tune, getPolicy, applyAll, reset };
