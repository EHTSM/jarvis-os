"use strict";
/**
 * runtimeExecutionPolicyEngine — policy-based execution access control.
 * Deny-by-default. Policies are evaluated in priority order; first match wins.
 *
 * registerPolicy(spec)   → { registered, policyId }
 * removePolicy(spec)     → { removed, policyId }
 * evaluatePolicy(spec)   → { allowed, reason, appliedPolicyId }
 * setGlobalDenyMode(on)  → { set, globalDenyMode }
 * getPolicyMetrics()     → PolicyMetrics
 * reset()
 *
 * Policy match conditions (all must be satisfied for a policy to match):
 *   adapterTypes  — ["*"] or specific adapter list
 *   minAuthority  — minimum required authority level
 *   maxRiskScore  — maximum allowed risk score (0–1)
 *   minTrustScore — minimum required workflow trust score (0–1)
 *   requireSandbox — whether an active sandbox is required
 *
 * effect: "allow" | "deny"
 * priority: higher number evaluated first.
 */

const AUTHORITY_RANK = {
    observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4,
};

let _policies       = new Map();   // policyId → PolicyRecord
let _globalDenyMode = false;
let _decisions      = [];          // PolicyDecision[]
let _counter        = 0;

// ── registerPolicy ────────────────────────────────────────────────────

function registerPolicy(spec = {}) {
    const {
        name           = null,
        adapterTypes   = ["*"],
        minAuthority   = "observer",
        maxRiskScore   = 1.0,
        minTrustScore  = 0.0,
        requireSandbox = false,
        effect         = "allow",
        priority       = 5,
    } = spec;

    if (!name) return { registered: false, reason: "name_required" };
    if (!["allow", "deny"].includes(effect))
        return { registered: false, reason: `invalid_effect: ${effect}` };
    if (!(minAuthority in AUTHORITY_RANK))
        return { registered: false, reason: `invalid_authority: ${minAuthority}` };
    if (maxRiskScore < 0 || maxRiskScore > 1)
        return { registered: false, reason: "maxRiskScore_must_be_0_to_1" };
    if (minTrustScore < 0 || minTrustScore > 1)
        return { registered: false, reason: "minTrustScore_must_be_0_to_1" };

    const policyId = `policy-${++_counter}`;
    _policies.set(policyId, {
        policyId, name,
        adapterTypes: Array.isArray(adapterTypes) ? [...adapterTypes] : ["*"],
        minAuthority, maxRiskScore, minTrustScore,
        requireSandbox, effect, priority,
        registeredAt: new Date().toISOString(),
    });

    return { registered: true, policyId, name, effect, priority };
}

// ── removePolicy ──────────────────────────────────────────────────────

function removePolicy(spec = {}) {
    const { policyId = null } = spec;
    if (!policyId) return { removed: false, reason: "policyId_required" };
    if (!_policies.has(policyId)) return { removed: false, reason: "policy_not_found" };
    _policies.delete(policyId);
    return { removed: true, policyId };
}

// ── _matchesPolicy ────────────────────────────────────────────────────

function _matchesPolicy(policy, ctx) {
    const {
        adapterType    = null,
        authorityLevel = null,
        riskScore      = 0,
        trustScore     = 1.0,
        sandboxActive  = false,
    } = ctx;

    // Adapter type match
    if (!policy.adapterTypes.includes("*") && !policy.adapterTypes.includes(adapterType))
        return false;

    // Authority floor
    const callerRank  = AUTHORITY_RANK[authorityLevel] ?? -1;
    const requiredRank = AUTHORITY_RANK[policy.minAuthority] ?? 0;
    if (callerRank < requiredRank) return false;

    // Risk ceiling
    if (riskScore > policy.maxRiskScore) return false;

    // Trust floor
    if (trustScore < policy.minTrustScore) return false;

    // Sandbox requirement
    if (policy.requireSandbox && !sandboxActive) return false;

    return true;
}

// ── evaluatePolicy ────────────────────────────────────────────────────

function evaluatePolicy(spec = {}) {
    const {
        adapterType    = null,
        operation      = null,
        authorityLevel = null,
        riskScore      = 0,
        trustScore     = 1.0,
        sandboxActive  = false,
    } = spec;

    if (!adapterType || !authorityLevel)
        return { allowed: false, reason: "adapterType_and_authorityLevel_required" };

    // Global kill switch
    if (_globalDenyMode) {
        _decisions.push({ allowed: false, reason: "global_deny_mode", adapterType, operation });
        return { allowed: false, reason: "global_deny_mode", appliedPolicyId: null };
    }

    // Sort policies by priority descending
    const sorted = [..._policies.values()].sort((a, b) => b.priority - a.priority);
    const ctx    = { adapterType, authorityLevel, riskScore, trustScore, sandboxActive };

    for (const policy of sorted) {
        if (_matchesPolicy(policy, ctx)) {
            const allowed = policy.effect === "allow";
            _decisions.push({
                allowed, reason: policy.effect, policyId: policy.policyId,
                policyName: policy.name, adapterType, operation,
            });
            return {
                allowed,
                reason:          policy.effect === "allow" ? "policy_allow" : `policy_deny: ${policy.name}`,
                appliedPolicyId: policy.policyId,
                policyName:      policy.name,
            };
        }
    }

    // No matching policy — deny by default
    _decisions.push({ allowed: false, reason: "no_matching_policy", adapterType, operation });
    return { allowed: false, reason: "no_matching_policy", appliedPolicyId: null };
}

// ── setGlobalDenyMode ─────────────────────────────────────────────────

function setGlobalDenyMode(on) {
    _globalDenyMode = !!on;
    return { set: true, globalDenyMode: _globalDenyMode };
}

// ── getPolicyMetrics ──────────────────────────────────────────────────

function getPolicyMetrics() {
    const all       = [..._policies.values()];
    const allowCount = all.filter(p => p.effect === "allow").length;
    const denyCount  = all.filter(p => p.effect === "deny").length;
    const totalDenied = _decisions.filter(d => !d.allowed).length;
    const totalAllowed = _decisions.filter(d => d.allowed).length;
    return {
        totalPolicies:  all.length,
        allowPolicies:  allowCount,
        denyPolicies:   denyCount,
        totalEvaluations: _decisions.length,
        totalAllowed,
        totalDenied,
        globalDenyMode: _globalDenyMode,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _policies       = new Map();
    _globalDenyMode = false;
    _decisions      = [];
    _counter        = 0;
}

module.exports = {
    AUTHORITY_RANK,
    registerPolicy, removePolicy, evaluatePolicy,
    setGlobalDenyMode, getPolicyMetrics, reset,
};
