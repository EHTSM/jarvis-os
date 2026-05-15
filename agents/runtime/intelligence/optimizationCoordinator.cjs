"use strict";
/**
 * optimizationCoordinator — adaptive optimization recommendations and efficiency scoring.
 *
 * recommendOptimizations(profile)               → Recommendations
 * tuneConcurrency(metrics)                      → ConcurrencyTuning
 * optimizeRetryPolicy(retryStats)               → RetryPolicyResult
 * planLatencyReduction(latencyProfile)          → LatencyPlan
 * optimizeDegradedMode(metrics)                 → DegradedModeResult
 * scoreEfficiency(executions)                   → EfficiencyScore
 * buildAdaptivePlan(context)                    → AdaptivePlan
 * getOptimizationHistory()                      → OptimizationRecord[]
 * reset()
 */

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY      = 20;
const MIN_CONCURRENCY      = 1;

let _history = [];
let _counter = 0;

// ── recommendOptimizations ────────────────────────────────────────────

function recommendOptimizations(profile = {}) {
    const {
        errorRate     = 0,
        avgRetries    = 0,
        avgLatencyMs  = 0,
        concurrency   = DEFAULT_CONCURRENCY,
        rollbackRate  = 0,
        sandboxRate   = 0,
    } = profile;

    const recommendations = [];

    if (errorRate > 0.1)     recommendations.push({ action: "reduce_concurrency",      priority: "high",   reason: "high_error_rate" });
    if (avgRetries > 2)      recommendations.push({ action: "optimize_retry_policy",   priority: "medium", reason: "excessive_retries" });
    if (avgLatencyMs > 2000) recommendations.push({ action: "enable_fast_path",        priority: "medium", reason: "high_latency" });
    if (rollbackRate > 0.2)  recommendations.push({ action: "tighten_validation",      priority: "high",   reason: "high_rollback_rate" });
    if (sandboxRate  > 0.5)  recommendations.push({ action: "promote_safe_strategy",   priority: "low",    reason: "overuse_of_sandbox" });
    if (concurrency  > 10 && errorRate > 0.05)
                             recommendations.push({ action: "throttle_concurrency",    priority: "high",   reason: "concurrency_pressure" });

    const record = { type: "recommendations", recommendations: recommendations.length, profile: { ...profile }, ts: new Date().toISOString() };
    _history.push(record);

    return { recommendations, count: recommendations.length, profile };
}

// ── tuneConcurrency ───────────────────────────────────────────────────

function tuneConcurrency(metrics = {}) {
    const { successRate = 1, errorRate = 0, avgLatencyMs = 0, currentConcurrency = DEFAULT_CONCURRENCY } = metrics;

    let recommended = currentConcurrency;

    if (successRate < 0.7 || errorRate > 0.2) {
        recommended = Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.6));
    } else if (successRate > 0.95 && errorRate < 0.02 && avgLatencyMs < 500) {
        recommended = Math.min(MAX_CONCURRENCY, Math.ceil(currentConcurrency * 1.2));
    } else if (errorRate > 0.1) {
        recommended = Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.8));
    }

    const delta     = recommended - currentConcurrency;
    const direction = delta > 0 ? "scale_up" : delta < 0 ? "scale_down" : "hold";

    return { recommended, currentConcurrency, delta, direction };
}

// ── optimizeRetryPolicy ───────────────────────────────────────────────

function optimizeRetryPolicy(retryStats = {}) {
    const { avgRetries = 0, maxRetries = 3, successAfterRetry = 0.5, retryRate = 0 } = retryStats;

    let recommendedMax = maxRetries;
    let backoffStrategy = "exponential";
    const actions = [];

    if (avgRetries > maxRetries * 0.8) {
        recommendedMax = Math.min(5, maxRetries + 1);
        actions.push("increase_max_retries");
    }
    if (successAfterRetry < 0.3) {
        recommendedMax = Math.max(1, maxRetries - 1);
        actions.push("reduce_max_retries");
        backoffStrategy = "linear";
    }
    if (retryRate > 0.5) {
        actions.push("add_jitter");
        backoffStrategy = "exponential_jitter";
    }
    if (actions.length === 0) actions.push("policy_optimal");

    return { recommendedMax, backoffStrategy, actions, currentMax: maxRetries, effectiveChange: recommendedMax !== maxRetries };
}

// ── planLatencyReduction ──────────────────────────────────────────────

function planLatencyReduction(latencyProfile = {}) {
    const { p50Ms = 0, p95Ms = 0, avgMs = 0, baselineMs = null } = latencyProfile;

    const steps = [];
    const targetMs = baselineMs ?? Math.floor(avgMs * 0.7);

    if (p95Ms > 5000)  steps.push({ step: "enable_circuit_breaker",   impact: "high"   });
    if (avgMs  > 2000) steps.push({ step: "reduce_concurrency",        impact: "high"   });
    if (p95Ms  > p50Ms * 3) steps.push({ step: "add_timeout_budget",  impact: "medium" });
    if (avgMs  > 500)  steps.push({ step: "enable_response_caching",   impact: "medium" });
    if (steps.length === 0) steps.push({ step: "maintain_current_policy", impact: "none" });

    return { steps, targetMs, currentAvgMs: avgMs, currentP95Ms: p95Ms, estimatedReductionPct: steps.length > 0 ? 30 : 0 };
}

// ── optimizeDegradedMode ──────────────────────────────────────────────

function optimizeDegradedMode(metrics = {}) {
    const { health = 1, errorRate = 0, concurrency = DEFAULT_CONCURRENCY } = metrics;

    const mode = health >= 0.8 ? "normal"    :
                 health >= 0.6 ? "cautious"  :
                 health >= 0.4 ? "degraded"  : "minimal";

    const modeSettings = {
        normal:   { concurrency: Math.min(MAX_CONCURRENCY, concurrency), strategy: "fast",           shedLoad: false },
        cautious: { concurrency: Math.min(8,  concurrency),              strategy: "safe",           shedLoad: false },
        degraded: { concurrency: Math.min(3,  concurrency),              strategy: "staged",         shedLoad: true  },
        minimal:  { concurrency: 1,                                       strategy: "recovery_first", shedLoad: true  },
    };

    const settings = modeSettings[mode];
    return { mode, ...settings, healthScore: +health.toFixed(3), errorRate: +errorRate.toFixed(3) };
}

// ── scoreEfficiency ───────────────────────────────────────────────────

function scoreEfficiency(executions = []) {
    if (executions.length === 0) return { score: 0, grade: "F", reason: "no_executions" };

    const successRate  = executions.filter(e => e.success !== false).length / executions.length;
    const avgRetries   = executions.reduce((s, e) => s + (e.retryCount ?? 0), 0) / executions.length;
    const rollbackRate = executions.filter(e => e.rollbackTriggered).length / executions.length;

    const raw   = Math.max(0, successRate * 100 - avgRetries * 10 - rollbackRate * 20);
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return {
        score, grade,
        successRate:  +successRate.toFixed(3),
        avgRetries:   +avgRetries.toFixed(2),
        rollbackRate: +rollbackRate.toFixed(3),
        executionCount: executions.length,
    };
}

// ── buildAdaptivePlan ─────────────────────────────────────────────────

function buildAdaptivePlan(context = {}) {
    const planId = `plan-${++_counter}`;
    const { health = 1, errorRate = 0, pressure = "none", riskLevel = "none" } = context;

    const phases = [];

    if (riskLevel === "critical" || errorRate > 0.3) {
        phases.push({ phase: "stabilize",   action: "switch_to_recovery_mode",   urgency: "immediate" });
        phases.push({ phase: "investigate", action: "collect_diagnostics",        urgency: "high"      });
    } else if (riskLevel === "high" || errorRate > 0.1) {
        phases.push({ phase: "reduce_load", action: "throttle_concurrency",       urgency: "high"      });
        phases.push({ phase: "monitor",     action: "increase_sampling_rate",     urgency: "medium"    });
    } else {
        phases.push({ phase: "optimize",    action: "tune_for_throughput",        urgency: "low"       });
    }

    const plan = { planId, phases, context: { health, errorRate, pressure, riskLevel }, createdAt: new Date().toISOString() };
    _history.push({ type: "adaptive_plan", planId, ts: plan.createdAt });
    return plan;
}

// ── getOptimizationHistory / reset ────────────────────────────────────

function getOptimizationHistory() { return [..._history]; }

function reset() {
    _history = [];
    _counter = 0;
}

module.exports = {
    recommendOptimizations, tuneConcurrency, optimizeRetryPolicy,
    planLatencyReduction, optimizeDegradedMode, scoreEfficiency,
    buildAdaptivePlan, getOptimizationHistory, reset,
};
