"use strict";
/**
 * orchestrationPolicyResolver — resolves orchestration policies for a given
 * execution context (subsystem, authority, adapter). Provides rate limits,
 * concurrency overrides, priority overrides, and admission decisions.
 *
 * registerPolicy(spec)           → { registered, policyId }
 * resolvePolicy(spec)            → { resolved, policy }
 * evaluateAdmission(spec)        → { admitted, reason, policyId }
 * removePolicy(policyId)         → { removed }
 * listPolicies()                 → PolicyEntry[]
 * getPolicyMetrics()             → PolicyMetrics
 * reset()
 *
 * Policy fields:
 *   name, subsystems[], adapterTypes[], authorityLevels[],
 *   maxConcurrency, rateLimit (per minute), minPriority, maxRetries,
 *   admitRecovery (bool), effect ("allow"|"deny"), priority (higher = first)
 *
 * Deny-by-default: if no policy matches, defaults to allow with base limits.
 */

const AUTHORITY_RANK = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const MAX_POLICIES   = 500;

let _policies  = new Map();   // policyId → PolicyEntry
let _counter   = 0;
let _evaluated = 0;

// ── registerPolicy ─────────────────────────────────────────────────────

function registerPolicy(spec = {}) {
    const {
        name            = null,
        subsystems      = [],      // empty = match all
        adapterTypes    = [],
        authorityLevels = [],
        maxConcurrency  = null,
        rateLimit       = null,    // executions per minute
        minPriority     = 0,
        maxRetries      = null,
        admitRecovery   = true,
        effect          = "allow",
        priority        = 50,
    } = spec;

    if (!name) return { registered: false, reason: "name_required" };
    if (effect !== "allow" && effect !== "deny")
        return { registered: false, reason: "effect_must_be_allow_or_deny" };
    if (_policies.size >= MAX_POLICIES)
        return { registered: false, reason: "policy_capacity_exceeded" };

    const policyId = `opol-${++_counter}`;
    _policies.set(policyId, Object.freeze({
        policyId, name, subsystems, adapterTypes, authorityLevels,
        maxConcurrency: maxConcurrency ?? null,
        rateLimit:      rateLimit      ?? null,
        minPriority, maxRetries: maxRetries ?? null,
        admitRecovery, effect, priority,
        createdAt: new Date().toISOString(),
    }));

    return { registered: true, policyId, name, effect, priority };
}

// ── _matches ───────────────────────────────────────────────────────────

function _matches(policy, spec) {
    const { subsystem = null, adapterType = null, authorityLevel = null } = spec;

    if (policy.subsystems.length > 0 && subsystem && !policy.subsystems.includes(subsystem))
        return false;
    if (policy.adapterTypes.length > 0 && adapterType && !policy.adapterTypes.includes(adapterType))
        return false;
    if (policy.authorityLevels.length > 0 && authorityLevel && !policy.authorityLevels.includes(authorityLevel))
        return false;

    return true;
}

// ── resolvePolicy ──────────────────────────────────────────────────────

function resolvePolicy(spec = {}) {
    const sorted = [..._policies.values()].sort((a, b) => b.priority - a.priority);

    for (const p of sorted) {
        if (_matches(p, spec)) {
            _evaluated++;
            return { resolved: true, policy: p, policyId: p.policyId };
        }
    }

    // Default policy
    _evaluated++;
    return {
        resolved: true,
        policy: {
            policyId: "default", name: "default", effect: "allow",
            maxConcurrency: 10, rateLimit: null, minPriority: 0,
            maxRetries: null, admitRecovery: true, priority: 0,
        },
        policyId: "default",
    };
}

// ── evaluateAdmission ──────────────────────────────────────────────────

function evaluateAdmission(spec = {}) {
    const {
        subsystem      = null,
        adapterType    = null,
        authorityLevel = null,
        priorityScore  = 50,
        retryCount     = 0,
        recovery       = false,
    } = spec;

    const { policy, policyId } = resolvePolicy({ subsystem, adapterType, authorityLevel });

    if (policy.effect === "deny")
        return { admitted: false, reason: "policy_deny", policyId, policyName: policy.name };

    if (recovery && !policy.admitRecovery)
        return { admitted: false, reason: "recovery_not_admitted_by_policy", policyId };

    if (priorityScore < policy.minPriority)
        return { admitted: false, reason: "priority_below_policy_minimum", required: policy.minPriority, given: priorityScore, policyId };

    if (policy.maxRetries !== null && retryCount > policy.maxRetries)
        return { admitted: false, reason: "retry_limit_exceeded", limit: policy.maxRetries, count: retryCount, policyId };

    return { admitted: true, policyId, maxConcurrency: policy.maxConcurrency };
}

// ── removePolicy ───────────────────────────────────────────────────────

function removePolicy(policyId) {
    if (!policyId) return { removed: false, reason: "policyId_required" };
    if (!_policies.has(policyId)) return { removed: false, reason: "policy_not_found", policyId };
    _policies.delete(policyId);
    return { removed: true, policyId };
}

// ── listPolicies ───────────────────────────────────────────────────────

function listPolicies() {
    return [..._policies.values()].sort((a, b) => b.priority - a.priority);
}

// ── getPolicyMetrics ───────────────────────────────────────────────────

function getPolicyMetrics() {
    const all    = [..._policies.values()];
    const allows = all.filter(p => p.effect === "allow").length;
    const denies = all.filter(p => p.effect === "deny").length;
    return { totalPolicies: all.length, allowCount: allows, denyCount: denies, totalEvaluated: _evaluated };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() { _policies = new Map(); _counter = 0; _evaluated = 0; }

module.exports = {
    AUTHORITY_RANK, MAX_POLICIES,
    registerPolicy, resolvePolicy, evaluateAdmission,
    removePolicy, listPolicies, getPolicyMetrics, reset,
};
