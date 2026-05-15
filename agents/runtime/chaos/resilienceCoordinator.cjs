"use strict";
/**
 * resilienceCoordinator — automatic failover, fallback, and failure containment.
 *
 * routeWithFailover(plan, routes, opts)             → RoutingResult
 * selectFallbackStrategy(current, context)          → FallbackResult
 * coordinateRetry(plan, attempt, opts)              → RetryDecision
 * containFailure(executionId, scope)                → ContainmentResult
 * rerouteServiceDependency(depId, alternatives)     → RerouteResult
 * getDegradedModeConfig(healthScore)                → DegradedConfig
 * getResilienceState()                              → ResilienceSnapshot
 * reset()
 */

const STRATEGY_CHAIN = ["fast", "safe", "staged", "recovery_first", "sandbox"];
const MODE_CHAIN     = ["normal", "cautious", "degraded", "minimal"];

const DEGRADED_MODE_THRESHOLDS = {
    normal:   { maxConcurrency: 8, retryLimit: 3 },
    cautious: { maxConcurrency: 4, retryLimit: 2 },
    degraded: { maxConcurrency: 2, retryLimit: 1 },
    minimal:  { maxConcurrency: 1, retryLimit: 0 },
};

let _failoverLog  = [];
let _containments = [];
let _rerouteLog   = [];

// ── routeWithFailover ─────────────────────────────────────────────────

function routeWithFailover(plan, availableRoutes = [], opts = {}) {
    if (!plan) return { routed: false, reason: "no_plan" };

    const healthy = availableRoutes.filter(r => r.healthy !== false);
    if (healthy.length === 0) {
        _failoverLog.push({ type: "no_healthy_routes", planId: plan.taskId ?? plan.id ?? "unknown", ts: new Date().toISOString() });
        return { routed: false, reason: "no_healthy_routes", fallback: opts.fallbackRoute ?? null };
    }

    // Best route: highest priority, then lowest latency
    const sorted   = [...healthy].sort((a, b) => {
        const pd = (b.priority ?? 5) - (a.priority ?? 5);
        return pd !== 0 ? pd : (a.latencyMs ?? 0) - (b.latencyMs ?? 0);
    });
    const selected = sorted[0];
    _failoverLog.push({ type: "route_selected", routeId: selected.id, planId: plan.taskId ?? plan.id ?? "unknown", ts: new Date().toISOString() });
    return { routed: true, selectedRoute: selected, attemptedRoutes: sorted.length };
}

// ── selectFallbackStrategy ────────────────────────────────────────────

function selectFallbackStrategy(current, _context = {}) {
    const idx = STRATEGY_CHAIN.indexOf(current);
    if (idx === -1) return { strategy: "safe", downgraded: false, reason: "unknown_strategy" };
    if (idx >= STRATEGY_CHAIN.length - 1) return { strategy: "sandbox", downgraded: false, reason: "at_floor" };
    const next = STRATEGY_CHAIN[idx + 1];
    return { strategy: next, from: current, downgraded: true, reason: "fallback_selected" };
}

// ── coordinateRetry ───────────────────────────────────────────────────

function coordinateRetry(plan, attempt, opts = {}) {
    const maxAttempts  = opts.maxAttempts  ?? 3;
    const backoffBase  = opts.backoffBase  ?? 100;
    const maxBackoffMs = opts.maxBackoffMs ?? 5000;

    if (attempt >= maxAttempts) {
        return { shouldRetry: false, reason: "max_attempts_reached", attempt, maxAttempts };
    }

    const backoffMs = Math.min(maxBackoffMs, backoffBase * Math.pow(2, attempt));
    const strategy  = attempt >= 2 ? "recovery_first" : attempt >= 1 ? "safe" : (opts.strategy ?? "safe");
    return { shouldRetry: true, attempt, nextAttempt: attempt + 1, backoffMs, strategy };
}

// ── containFailure ────────────────────────────────────────────────────

function containFailure(executionId, scope = {}) {
    const record = {
        executionId,
        contained:  true,
        scope:      scope.type    ?? "task",
        tenantId:   scope.tenantId ?? "default",
        isolated:   true,
        ts:         new Date().toISOString(),
    };
    _containments.push(record);
    return record;
}

// ── rerouteServiceDependency ──────────────────────────────────────────

function rerouteServiceDependency(depId, alternatives = []) {
    if (alternatives.length === 0) return { rerouted: false, depId, reason: "no_alternatives" };
    const sorted   = [...alternatives].sort((a, b) => (b.stability ?? 0) - (a.stability ?? 0));
    const selected = sorted[0];
    const record   = { depId, selectedAlternative: selected, rerouted: true, ts: new Date().toISOString() };
    _rerouteLog.push(record);
    return record;
}

// ── getDegradedModeConfig ─────────────────────────────────────────────

function getDegradedModeConfig(healthScore = 1.0) {
    const mode = healthScore >= 0.8 ? "normal"   :
                 healthScore >= 0.6 ? "cautious" :
                 healthScore >= 0.4 ? "degraded" : "minimal";
    return { mode, healthScore, ...DEGRADED_MODE_THRESHOLDS[mode] };
}

// ── getResilienceState ────────────────────────────────────────────────

function getResilienceState() {
    return {
        failoverCount:  _failoverLog.length,
        containments:   _containments.length,
        rerouteCount:   _rerouteLog.length,
        failoverLog:    [..._failoverLog],
        containmentLog: [..._containments],
        rerouteLog:     [..._rerouteLog],
        ts:             new Date().toISOString(),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _failoverLog  = [];
    _containments = [];
    _rerouteLog   = [];
}

module.exports = {
    STRATEGY_CHAIN, MODE_CHAIN, DEGRADED_MODE_THRESHOLDS,
    routeWithFailover, selectFallbackStrategy, coordinateRetry,
    containFailure, rerouteServiceDependency, getDegradedModeConfig,
    getResilienceState, reset,
};
