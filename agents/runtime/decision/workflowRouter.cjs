"use strict";
/**
 * workflowRouter — autonomous workflow rerouting and execution arbitration.
 *
 * registerComponent(id, opts)                  → void
 * updateComponentHealth(id, health, pressure)  → void
 * routeWorkflow(workflow)                      → RouteDecision
 * rerouteFromDegraded(workflowId, reason)      → RerouteDecision
 * arbitrate(workflows, resources)              → ArbitrationResult
 * getRouterStats()                             → Stats
 * reset()
 */

const DEGRADED_HEALTH_THRESHOLD = 0.5;
const CRITICAL_HEALTH_THRESHOLD = 0.2;

// Priority order for arbitration: latencyClass weight
const LATENCY_WEIGHT  = { realtime: 4, interactive: 3, standard: 2, background: 1 };
const RISK_WEIGHT     = { critical: 4, high: 3, medium: 2, low: 1 };
const PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1 };

let _components   = new Map();    // id → { id, type, health, pressure, status }
let _routeHistory = [];
let _counter      = 0;

// ── registerComponent ─────────────────────────────────────────────────

function registerComponent(id, opts = {}) {
    _components.set(id, {
        id,
        type:     opts.type     ?? "generic",
        health:   opts.health   ?? 1.0,
        pressure: opts.pressure ?? 0.0,
        capacity: opts.capacity ?? 10,
        status:   opts.health != null && opts.health < CRITICAL_HEALTH_THRESHOLD
                    ? "critical"
                    : opts.health != null && opts.health < DEGRADED_HEALTH_THRESHOLD
                    ? "degraded"
                    : "healthy",
        tags:     opts.tags     ?? [],
    });
}

// ── updateComponentHealth ─────────────────────────────────────────────

function updateComponentHealth(id, health, pressure = 0) {
    const comp = _components.get(id);
    if (!comp) return { updated: false, reason: "component_not_found" };
    comp.health   = health;
    comp.pressure = pressure;
    comp.status   = health < CRITICAL_HEALTH_THRESHOLD ? "critical"
                  : health < DEGRADED_HEALTH_THRESHOLD ? "degraded"
                  :                                      "healthy";
    return { updated: true, id, status: comp.status };
}

// ── _scoreComponent ───────────────────────────────────────────────────

function _scoreComponent(comp, workflow = {}) {
    if (comp.status === "critical") return -1;          // never route to critical
    const healthScore    = comp.health * 60;
    const pressureScore  = (1 - comp.pressure) * 30;
    const typeBonus      = (comp.type === (workflow.preferredType ?? comp.type)) ? 10 : 0;
    return healthScore + pressureScore + typeBonus;
}

// ── routeWorkflow ─────────────────────────────────────────────────────

function routeWorkflow(workflow = {}) {
    const available = [..._components.values()].filter(c => c.status !== "critical");

    if (available.length === 0) {
        return {
            routed:          false,
            reason:          "no_healthy_components",
            reasoning:       "All registered components are critical or unavailable",
            telemetryBasis:  { totalComponents: _components.size, healthyComponents: 0 },
            historicalEvidence: { reroutedCount: _routeHistory.filter(r => r.rerouted).length },
            confidenceLevel: "low",
        };
    }

    const scored = available
        .map(c => ({ component: c, score: _scoreComponent(c, workflow) }))
        .filter(s => s.score >= 0)
        .sort((a, b) => b.score - a.score || b.component.health - a.component.health);

    if (scored.length === 0) {
        return {
            routed: false, reason: "all_components_degraded",
            reasoning: "All available components are degraded (health below threshold)",
            telemetryBasis: { degradedCount: available.length },
            historicalEvidence: null,
            confidenceLevel: "low",
        };
    }

    const chosen = scored[0].component;
    const healthyCount = available.filter(c => c.status === "healthy").length;
    const reasoning    = `Selected component ${chosen.id} (health=${chosen.health.toFixed(2)}, score=${scored[0].score.toFixed(1)}); ${healthyCount} healthy component(s) available`;

    const routeId = `route-${++_counter}`;
    _routeHistory.push({ routeId, componentId: chosen.id, rerouted: false, ts: new Date().toISOString() });

    return {
        routed:          true,
        routeId,
        componentId:     chosen.id,
        componentHealth: +chosen.health.toFixed(3),
        reasoning,
        telemetryBasis:  { healthyComponents: healthyCount, totalComponents: _components.size, chosenScore: +scored[0].score.toFixed(1) },
        historicalEvidence: { priorRoutesToComponent: _routeHistory.filter(r => r.componentId === chosen.id).length },
        confidenceLevel: chosen.health >= 0.8 ? "high" : "moderate",
    };
}

// ── rerouteFromDegraded ───────────────────────────────────────────────

function rerouteFromDegraded(workflowId, reason = "component_degraded") {
    // Find best alternate component (exclude the one causing the reroute)
    const degraded  = [..._components.values()].filter(c => c.status === "degraded" || c.status === "critical");
    const available = [..._components.values()].filter(c => c.status === "healthy");

    if (available.length === 0) {
        return {
            rerouted:        false,
            workflowId,
            reason:          "no_healthy_alternative",
            reasoning:       `Reroute requested (${reason}) but no healthy alternatives exist`,
            telemetryBasis:  { degradedCount: degraded.length, healthyCount: 0 },
            historicalEvidence: null,
            confidenceLevel: "low",
        };
    }

    available.sort((a, b) => b.health - a.health || a.pressure - b.pressure);
    const target = available[0];

    const routeId = `reroute-${++_counter}`;
    _routeHistory.push({ routeId, componentId: target.id, rerouted: true, ts: new Date().toISOString() });

    return {
        rerouted:        true,
        workflowId,
        routeId,
        targetComponentId:   target.id,
        targetHealth:        +target.health.toFixed(3),
        triggerReason:       reason,
        reasoning:           `Rerouted away from degraded component to ${target.id} (health=${target.health.toFixed(2)}); ${degraded.length} degraded component(s) avoided`,
        telemetryBasis:      { degradedCount: degraded.length, healthyCount: available.length },
        historicalEvidence:  { priorReroutes: _routeHistory.filter(r => r.rerouted).length },
        confidenceLevel:     target.health >= 0.8 ? "high" : "moderate",
    };
}

// ── arbitrate ─────────────────────────────────────────────────────────

function arbitrate(workflows = [], resources = {}) {
    if (workflows.length === 0) return { arbitrated: false, reason: "no_workflows", queue: [] };

    const maxConcurrent = resources.maxConcurrent ?? 5;

    // Score each workflow for priority
    const scored = workflows.map(wf => {
        const latencyW  = LATENCY_WEIGHT[wf.latencyClass  ?? "standard"] ?? 2;
        const riskW     = RISK_WEIGHT[wf.riskLevel        ?? "low"]       ?? 1;
        const priorityW = PRIORITY_WEIGHT[wf.priorityTier ?? 3]           ?? 1;
        const score     = latencyW * 0.40 + riskW * 0.35 + priorityW * 0.25;
        return { workflow: wf, score };
    }).sort((a, b) => b.score - a.score);

    const admitted  = scored.slice(0, maxConcurrent).map((s, idx) => ({
        ...s.workflow,
        position:      idx + 1,
        priorityScore: +s.score.toFixed(3),
        status:        "admitted",
    }));

    const deferred  = scored.slice(maxConcurrent).map((s, idx) => ({
        ...s.workflow,
        position:      maxConcurrent + idx + 1,
        priorityScore: +s.score.toFixed(3),
        status:        "deferred",
    }));

    const criticalAdmitted = admitted.filter(w => w.riskLevel === "critical" || w.latencyClass === "realtime").length;

    return {
        arbitrated:      true,
        admitted:        admitted.length,
        deferred:        deferred.length,
        queue:           [...admitted, ...deferred],
        criticalAdmitted,
        reasoning:       `Arbitrated ${workflows.length} workflows; top ${admitted.length} admitted based on latency×40%+risk×35%+priority×25%`,
        telemetryBasis:  { maxConcurrent, totalWorkflows: workflows.length },
        historicalEvidence: null,
        confidenceLevel: "high",
    };
}

// ── getRouterStats ────────────────────────────────────────────────────

function getRouterStats() {
    const comps = [..._components.values()];
    return {
        totalComponents: comps.length,
        healthyComponents: comps.filter(c => c.status === "healthy").length,
        degradedComponents: comps.filter(c => c.status === "degraded").length,
        criticalComponents: comps.filter(c => c.status === "critical").length,
        totalRoutes:     _routeHistory.length,
        rerouteCount:    _routeHistory.filter(r => r.rerouted).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _components   = new Map();
    _routeHistory = [];
    _counter      = 0;
}

module.exports = {
    DEGRADED_HEALTH_THRESHOLD, CRITICAL_HEALTH_THRESHOLD,
    registerComponent, updateComponentHealth,
    routeWorkflow, rerouteFromDegraded, arbitrate,
    getRouterStats, reset,
};
