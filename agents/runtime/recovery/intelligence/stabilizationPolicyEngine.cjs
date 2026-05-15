"use strict";
/**
 * stabilizationPolicyEngine — governance-aware stabilization policies,
 * runtime state evaluation, and stabilization scoring.
 *
 * registerPolicy(spec)              → { registered, policyId, name }
 * evaluatePolicy(spec)              → { evaluated, applicable, actions }
 * applyStabilizationScore(spec)     → { scored, scoreId, stabilizationScore, health }
 * getPolicyRecommendations(spec)    → { recommendations }
 * getPolicyMetrics()                → PolicyMetrics
 * reset()
 *
 * Policy triggers: pressure_threshold | bottleneck_count | starvation_detected |
 *                  error_rate | cascade_depth | recovery_overload
 */

const POLICY_TRIGGERS = [
    "pressure_threshold", "bottleneck_count", "starvation_detected",
    "error_rate", "cascade_depth", "recovery_overload",
];

let _policies    = new Map();   // policyId → PolicyRecord
let _evaluations = [];
let _scores      = [];
let _counter     = 0;

// ── registerPolicy ────────────────────────────────────────────────────

function registerPolicy(spec = {}) {
    const {
        name       = null,
        trigger    = null,
        threshold  = 0,
        action     = null,
        priority   = 5,
        cooldownMs = 0,
    } = spec;

    if (!name)    return { registered: false, reason: "name_required" };
    if (!trigger) return { registered: false, reason: "trigger_required" };
    if (!action)  return { registered: false, reason: "action_required" };
    if (!POLICY_TRIGGERS.includes(trigger))
        return { registered: false, reason: `invalid_trigger: ${trigger}` };

    const policyId = `policy-${++_counter}`;
    _policies.set(policyId, {
        policyId, name, trigger, threshold, action, priority, cooldownMs,
        enabled:      true,
        appliedCount: 0,
        registeredAt: new Date().toISOString(),
    });

    return { registered: true, policyId, name, trigger, action, priority };
}

// ── _evaluateTrigger ──────────────────────────────────────────────────

function _evaluateTrigger(policy, state) {
    const { pressureScore = 0, bottleneckCount = 0, starvationCount = 0,
            errorRate = 0, cascadeDepth = 0, activeRecoveries = 0 } = state;

    switch (policy.trigger) {
        case "pressure_threshold":  return pressureScore   >= policy.threshold;
        case "bottleneck_count":    return bottleneckCount >= policy.threshold;
        case "starvation_detected": return starvationCount >= policy.threshold;
        case "error_rate":          return errorRate       >= policy.threshold;
        case "cascade_depth":       return cascadeDepth    >= policy.threshold;
        case "recovery_overload":   return activeRecoveries >= policy.threshold;
        default:                    return false;
    }
}

// ── evaluatePolicy ────────────────────────────────────────────────────

function evaluatePolicy(spec = {}) {
    const { runtimeState = {} } = spec;

    const applicable = [];
    for (const policy of _policies.values()) {
        if (!policy.enabled) continue;
        if (_evaluateTrigger(policy, runtimeState)) {
            applicable.push({ policyId: policy.policyId, name: policy.name, action: policy.action, priority: policy.priority });
            policy.appliedCount++;
        }
    }

    applicable.sort((a, b) => b.priority - a.priority);

    const evalId = `eval-${++_counter}`;
    _evaluations.push({ evalId, applicableCount: applicable.length, runtimeState, evaluatedAt: new Date().toISOString() });

    return {
        evaluated:       true,
        evalId,
        applicable,
        applicableCount: applicable.length,
        actions:         applicable.map(p => p.action),
    };
}

// ── applyStabilizationScore ───────────────────────────────────────────

function applyStabilizationScore(spec = {}) {
    const {
        pressureScore      = 0,
        bottleneckCount    = 0,
        starvationCount    = 0,
        activeRecoveries   = 0,
        resolvedRecoveries = 0,
        maxBottlenecks     = 10,
        maxStarvation      = 10,
        maxRecoveries      = 20,
    } = spec;

    const bottleneckRatio  = Math.min(1, bottleneckCount  / maxBottlenecks);
    const starvationRatio  = Math.min(1, starvationCount  / maxStarvation);
    const recoveryRatio    = Math.min(1, activeRecoveries / Math.max(1, maxRecoveries));

    const rawScore         = 1 - (pressureScore * 0.4 + bottleneckRatio * 0.25 + starvationRatio * 0.2 + recoveryRatio * 0.15);
    const stabilizationScore = +Math.max(0, Math.min(1, rawScore)).toFixed(3);

    const health = stabilizationScore >= 0.8 ? "healthy"
                 : stabilizationScore >= 0.6 ? "degraded"
                 : stabilizationScore >= 0.4 ? "unstable"
                 :                             "critical";

    const scoreId = `score-${++_counter}`;
    _scores.push({ scoreId, stabilizationScore, health, scoredAt: new Date().toISOString() });

    return { scored: true, scoreId, stabilizationScore, health, resolvedRecoveries };
}

// ── getPolicyRecommendations ──────────────────────────────────────────

function getPolicyRecommendations(spec = {}) {
    const { runtimeState = {} } = spec;
    const result = evaluatePolicy({ runtimeState });

    return {
        recommendations: result.applicable.map(p => ({
            policyId: p.policyId,
            name:     p.name,
            action:   p.action,
            priority: p.priority,
        })),
        recommendationCount: result.applicable.length,
    };
}

// ── getPolicyMetrics ──────────────────────────────────────────────────

function getPolicyMetrics() {
    const all = [..._policies.values()];
    return {
        totalPolicies:    all.length,
        enabledPolicies:  all.filter(p => p.enabled).length,
        totalEvaluations: _evaluations.length,
        totalScores:      _scores.length,
        mostApplied:      all.sort((a, b) => b.appliedCount - a.appliedCount)[0]?.name ?? null,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _policies    = new Map();
    _evaluations = [];
    _scores      = [];
    _counter     = 0;
}

module.exports = {
    POLICY_TRIGGERS,
    registerPolicy, evaluatePolicy, applyStabilizationScore,
    getPolicyRecommendations, getPolicyMetrics, reset,
};
