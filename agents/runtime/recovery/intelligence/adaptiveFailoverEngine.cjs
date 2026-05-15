"use strict";
/**
 * adaptiveFailoverEngine — adaptive workflow failover routing, backup path
 * selection, circular failover prevention, and failover lifecycle tracking.
 *
 * registerFailoverRoute(spec)   → { registered, routeId, primaryId, backupId }
 * triggerFailover(spec)         → { triggered, failoverId, workflowId, backupId }
 * validateFailoverSafety(spec)  → { safe, reason }
 * getFailoverState()            → FailoverState
 * getFailoverMetrics()          → FailoverMetrics
 * reset()
 */

let _routes    = new Map();   // primaryId → RouteRecord[]  (one primary can have multiple backup routes)
let _routeById = new Map();   // routeId → RouteRecord
let _failovers = [];
let _activeFailovers = new Set();  // workflowIds currently in failover
let _counter   = 0;

// ── registerFailoverRoute ─────────────────────────────────────────────

function registerFailoverRoute(spec = {}) {
    const {
        primaryId  = null,
        backupId   = null,
        priority   = 5,
        conditions = [],
    } = spec;

    if (!primaryId) return { registered: false, reason: "primaryId_required" };
    if (!backupId)  return { registered: false, reason: "backupId_required" };
    if (primaryId === backupId) return { registered: false, reason: "primary_backup_must_differ" };

    const routeId = `route-${++_counter}`;
    const record  = { routeId, primaryId, backupId, priority, conditions, active: true, registeredAt: new Date().toISOString() };

    if (!_routes.has(primaryId)) _routes.set(primaryId, []);
    _routes.get(primaryId).push(record);
    _routeById.set(routeId, record);

    return { registered: true, routeId, primaryId, backupId, priority };
}

// ── triggerFailover ───────────────────────────────────────────────────

function triggerFailover(spec = {}) {
    const { workflowId = null, reason = "unspecified" } = spec;
    if (!workflowId) return { triggered: false, reason: "workflowId_required" };

    const routes = (_routes.get(workflowId) ?? [])
        .filter(r => r.active)
        .sort((a, b) => b.priority - a.priority);

    if (routes.length === 0)
        return { triggered: false, reason: "no_failover_route", workflowId };

    // Pick highest-priority route whose backupId is not itself in failover
    const route = routes.find(r => !_activeFailovers.has(r.backupId)) ?? routes[0];

    const failoverId = `failover-${++_counter}`;
    _activeFailovers.add(workflowId);
    _failovers.push({
        failoverId,
        workflowId,
        backupId:  route.backupId,
        routeId:   route.routeId,
        reason,
        status:    "active",
        triggeredAt: new Date().toISOString(),
    });

    return { triggered: true, failoverId, workflowId, backupId: route.backupId, routeId: route.routeId, reason };
}

// ── validateFailoverSafety ────────────────────────────────────────────

function validateFailoverSafety(spec = {}) {
    const { workflowId = null, backupId = null } = spec;
    if (!workflowId) return { safe: false, reason: "workflowId_required" };
    if (!backupId)   return { safe: false, reason: "backupId_required" };

    // Check circular: backupId routes back to workflowId
    const backupRoutes = _routes.get(backupId) ?? [];
    const circular     = backupRoutes.some(r => r.backupId === workflowId);
    if (circular) return { safe: false, reason: "circular_failover_detected", workflowId, backupId };

    // Check: backupId is already in active failover
    if (_activeFailovers.has(backupId))
        return { safe: false, reason: "backup_already_in_failover", workflowId, backupId };

    return { safe: true, workflowId, backupId };
}

// ── getFailoverState ──────────────────────────────────────────────────

function getFailoverState() {
    const activeFailovers = _failovers.filter(f => f.status === "active");
    return {
        totalRoutes:        _routeById.size,
        totalFailovers:     _failovers.length,
        activeFailoverCount: activeFailovers.length,
        activeWorkflowIds:  [..._activeFailovers],
    };
}

// ── getFailoverMetrics ────────────────────────────────────────────────

function getFailoverMetrics() {
    return {
        totalRoutes:    _routeById.size,
        totalFailovers: _failovers.length,
        activeFailovers: _activeFailovers.size,
        uniquePrimaries: _routes.size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _routes         = new Map();
    _routeById      = new Map();
    _failovers      = [];
    _activeFailovers = new Set();
    _counter        = 0;
}

module.exports = {
    registerFailoverRoute, triggerFailover, validateFailoverSafety,
    getFailoverState, getFailoverMetrics, reset,
};
