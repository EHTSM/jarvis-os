"use strict";
/**
 * adaptiveRoutingEngine — latency-aware, reliability-weighted adaptive routing.
 *
 * registerRoute(routeId, opts)                          → RouteRecord
 * updateRouteMetrics(routeId, metrics)                  → UpdateResult
 * scoreRoute(routeId)                                   → RouteScore
 * selectBestRoute(routeIds, context)                    → RoutingDecision
 * prioritizeStrategies(strategyScores)                  → PrioritizedList
 * adaptToWorkload(routes, workload)                     → WorkloadAdaptation
 * applyPressureAdaptation(routes, pressure)             → PressureResult
 * getRoutingStats()                                     → RoutingStats
 * reset()
 */

const PRESSURE_LIMITS = {
    none:     { maxConcurrency: 10, strategy: "fast"     },
    low:      { maxConcurrency: 8,  strategy: "safe"     },
    medium:   { maxConcurrency: 5,  strategy: "safe"     },
    high:     { maxConcurrency: 3,  strategy: "staged"   },
    critical: { maxConcurrency: 1,  strategy: "recovery_first" },
};

let _routes   = new Map();   // routeId → RouteRecord
let _decisions = [];

// ── registerRoute ─────────────────────────────────────────────────────

function registerRoute(routeId, opts = {}) {
    if (!routeId) return { registered: false, reason: "missing_route_id" };
    const route = {
        routeId,
        reliability:    opts.reliability   ?? 1.0,
        avgLatencyMs:   opts.avgLatencyMs  ?? 100,
        throughputRpm:  opts.throughputRpm ?? 60,
        healthy:        opts.healthy !== false,
        priority:       opts.priority      ?? 1,
        strategy:       opts.strategy      ?? "safe",
        callCount:      0,
        successCount:   0,
        registeredAt:   new Date().toISOString(),
    };
    _routes.set(routeId, route);
    return { registered: true, routeId, route };
}

// ── updateRouteMetrics ────────────────────────────────────────────────

function updateRouteMetrics(routeId, metrics = {}) {
    const route = _routes.get(routeId);
    if (!route) return { updated: false, reason: "route_not_found" };

    if (metrics.reliability  !== undefined) route.reliability  = metrics.reliability;
    if (metrics.avgLatencyMs !== undefined) route.avgLatencyMs = metrics.avgLatencyMs;
    if (metrics.throughputRpm !== undefined) route.throughputRpm = metrics.throughputRpm;
    if (metrics.healthy      !== undefined) route.healthy      = metrics.healthy;
    if (metrics.success !== undefined) {
        route.callCount++;
        if (metrics.success) route.successCount++;
    }
    route.lastUpdatedAt = new Date().toISOString();
    return { updated: true, routeId };
}

// ── scoreRoute ────────────────────────────────────────────────────────

function scoreRoute(routeId) {
    const route = _routes.get(routeId);
    if (!route) return { score: 0, grade: "F", reason: "route_not_found" };
    if (!route.healthy) return { score: 0, grade: "F", reason: "unhealthy" };

    // reliability × 0.4 + latency × 0.3 + stability × 0.3
    const reliabilityScore = route.reliability * 100;
    const latencyScore     = route.avgLatencyMs <= 100  ? 100 :
                             route.avgLatencyMs <= 500  ? 80  :
                             route.avgLatencyMs <= 2000 ? 60  :
                             route.avgLatencyMs <= 5000 ? 40  : 20;
    const liveSuccessRate  = route.callCount > 0
        ? route.successCount / route.callCount
        : route.reliability;
    const stabilityScore   = liveSuccessRate * 100;

    const raw   = reliabilityScore * 0.4 + latencyScore * 0.3 + stabilityScore * 0.3;
    const score = +Math.min(100, Math.max(0, raw)).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, routeId, reliabilityScore: +reliabilityScore.toFixed(1), latencyScore, stabilityScore: +stabilityScore.toFixed(1) };
}

// ── selectBestRoute ───────────────────────────────────────────────────

function selectBestRoute(routeIds = [], context = {}) {
    const pool = routeIds.length > 0
        ? routeIds.map(id => _routes.get(id)).filter(Boolean)
        : [..._routes.values()];

    const healthy = pool.filter(r => r.healthy);
    if (healthy.length === 0) return { selected: false, reason: "no_healthy_routes" };

    const scored = healthy.map(r => ({ route: r, score: scoreRoute(r.routeId).score }));
    scored.sort((a, b) => b.score - a.score || a.route.avgLatencyMs - b.route.avgLatencyMs);

    const best = scored[0].route;
    const decision = {
        selected:    true,
        routeId:     best.routeId,
        score:       scored[0].score,
        strategy:    context.strategy ?? best.strategy,
        candidateCount: healthy.length,
        ts:          new Date().toISOString(),
    };
    _decisions.push(decision);
    return decision;
}

// ── prioritizeStrategies ──────────────────────────────────────────────

function prioritizeStrategies(strategyScores = {}) {
    const entries = Object.entries(strategyScores)
        .filter(([, v]) => typeof v === "number")
        .sort(([, a], [, b]) => b - a);

    return {
        ranked:    entries.map(([strategy, score]) => ({ strategy, score })),
        topStrategy: entries[0]?.[0] ?? null,
        topScore:    entries[0]?.[1] ?? 0,
        count:     entries.length,
    };
}

// ── adaptToWorkload ───────────────────────────────────────────────────

function adaptToWorkload(routeIds = [], workload = {}) {
    const { rpm = 0, concurrency = 1, burstFactor = 1 } = workload;
    const pool = routeIds.length > 0
        ? routeIds.map(id => _routes.get(id)).filter(Boolean)
        : [..._routes.values()];

    const totalCapacity = pool.reduce((s, r) => s + (r.throughputRpm ?? 0), 0);
    const loadRatio     = totalCapacity > 0 ? rpm / totalCapacity : 0;
    const overloaded    = loadRatio > 0.9 || concurrency * burstFactor > totalCapacity / 60;

    const recommended = overloaded ? "staged" : loadRatio > 0.7 ? "safe" : "fast";
    return {
        overloaded,
        loadRatio:       +loadRatio.toFixed(3),
        totalCapacity,
        recommendedStrategy: recommended,
        routeCount:      pool.length,
    };
}

// ── applyPressureAdaptation ───────────────────────────────────────────

function applyPressureAdaptation(routeIds = [], pressure = "none") {
    const limits = PRESSURE_LIMITS[pressure] ?? PRESSURE_LIMITS.none;
    const pool   = routeIds.length > 0
        ? routeIds.map(id => _routes.get(id)).filter(Boolean)
        : [..._routes.values()];

    const healthy = pool.filter(r => r.healthy);
    return {
        pressure,
        maxConcurrency:    limits.maxConcurrency,
        recommendedStrategy: limits.strategy,
        eligibleRoutes:    healthy.length,
        shedLoad:          pressure === "critical",
    };
}

// ── getRoutingStats ───────────────────────────────────────────────────

function getRoutingStats() {
    return {
        totalRoutes:    _routes.size,
        healthyRoutes:  [..._routes.values()].filter(r => r.healthy).length,
        decisionCount:  _decisions.length,
        avgScore:       _routes.size > 0
            ? +([..._routes.keys()].reduce((s, id) => s + scoreRoute(id).score, 0) / _routes.size).toFixed(1)
            : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _routes    = new Map();
    _decisions = [];
}

module.exports = {
    PRESSURE_LIMITS,
    registerRoute, updateRouteMetrics, scoreRoute,
    selectBestRoute, prioritizeStrategies,
    adaptToWorkload, applyPressureAdaptation, getRoutingStats, reset,
};
