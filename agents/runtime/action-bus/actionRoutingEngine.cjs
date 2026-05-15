"use strict";
/**
 * actionRoutingEngine — deterministic action routing, route registration,
 * circular-route detection, and routing-table management.
 *
 * registerRoute(spec)      → { registered, routeId, sourceSubsystem, targetSubsystem }
 * routeAction(envelope)    → { routed, destinations, routeIds }
 * validateRouting(spec)    → { valid, circularRoutes }
 * getRoutingTable()        → RouteRecord[]
 * getRoutingMetrics()      → RoutingMetrics
 * reset()
 *
 * Zero circular-dispatch guarantee: validateRouting detects A→B→A cycles.
 * Self-routes (source === target) are rejected at registration time.
 */

let _routes  = new Map();   // routeId → RouteRecord
let _routed  = 0;
let _counter = 0;

// ── registerRoute ─────────────────────────────────────────────────────

function registerRoute(spec = {}) {
    const {
        sourceSubsystem  = null,
        targetSubsystem  = null,
        actionType       = null,    // null = matches any action type
        priority         = 5,
        conditions       = [],
    } = spec;

    if (!sourceSubsystem) return { registered: false, reason: "sourceSubsystem_required" };
    if (!targetSubsystem) return { registered: false, reason: "targetSubsystem_required" };
    if (sourceSubsystem === targetSubsystem)
        return { registered: false, reason: "self_route_not_allowed", subsystem: sourceSubsystem };

    const routeId = `route-${++_counter}`;
    _routes.set(routeId, {
        routeId, sourceSubsystem, targetSubsystem,
        actionType, priority, conditions,
        active: true, registeredAt: new Date().toISOString(),
    });

    return { registered: true, routeId, sourceSubsystem, targetSubsystem, actionType, priority };
}

// ── routeAction ───────────────────────────────────────────────────────

function routeAction(envelope = {}) {
    const { sourceSubsystem = null, actionType = null } = envelope;
    if (!sourceSubsystem) return { routed: false, reason: "sourceSubsystem_required_in_envelope" };

    const matching = [..._routes.values()]
        .filter(r => r.active && r.sourceSubsystem === sourceSubsystem &&
                     (r.actionType === null || r.actionType === actionType))
        .sort((a, b) => b.priority - a.priority);

    if (matching.length === 0)
        return { routed: false, reason: "no_matching_route", sourceSubsystem, actionType };

    // Deduplicate destinations
    const seen         = new Set();
    const destinations = [];
    const routeIds     = [];
    for (const r of matching) {
        if (!seen.has(r.targetSubsystem)) {
            seen.add(r.targetSubsystem);
            destinations.push(r.targetSubsystem);
            routeIds.push(r.routeId);
        }
    }

    _routed++;
    return { routed: true, sourceSubsystem, actionType, destinations, routeIds, destinationCount: destinations.length };
}

// ── validateRouting ───────────────────────────────────────────────────

function validateRouting(spec = {}) {
    // Build adjacency list for registered routes
    const adj = new Map();
    for (const r of _routes.values()) {
        if (!r.active) continue;
        if (!adj.has(r.sourceSubsystem)) adj.set(r.sourceSubsystem, new Set());
        adj.get(r.sourceSubsystem).add(r.targetSubsystem);
    }

    const circularRoutes = [];

    // DFS cycle detection
    const visited = new Set();
    const inStack = new Set();

    function dfs(node, path) {
        visited.add(node);
        inStack.add(node);
        for (const neighbor of (adj.get(node) ?? [])) {
            if (!visited.has(neighbor)) {
                dfs(neighbor, [...path, node]);
            } else if (inStack.has(neighbor)) {
                const idx = path.indexOf(neighbor);
                circularRoutes.push(idx >= 0
                    ? [...path.slice(idx), node, neighbor]
                    : [node, neighbor]);
            }
        }
        inStack.delete(node);
    }

    for (const node of adj.keys()) {
        if (!visited.has(node)) dfs(node, []);
    }

    return { valid: circularRoutes.length === 0, circularRoutes, circularCount: circularRoutes.length };
}

// ── getRoutingTable ───────────────────────────────────────────────────

function getRoutingTable() {
    return [..._routes.values()];
}

// ── getRoutingMetrics ─────────────────────────────────────────────────

function getRoutingMetrics() {
    const active = [..._routes.values()].filter(r => r.active);
    return {
        totalRoutes:    _routes.size,
        activeRoutes:   active.length,
        totalRoutedActions: _routed,
        uniqueSources:  new Set(active.map(r => r.sourceSubsystem)).size,
        uniqueTargets:  new Set(active.map(r => r.targetSubsystem)).size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _routes  = new Map();
    _routed  = 0;
    _counter = 0;
}

module.exports = {
    registerRoute, routeAction, validateRouting,
    getRoutingTable, getRoutingMetrics, reset,
};
