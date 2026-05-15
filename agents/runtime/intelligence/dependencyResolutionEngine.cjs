"use strict";
/**
 * dependencyResolutionEngine (intelligence layer) — topological dependency
 * ordering, dependency depth analysis, and cycle-safe graph validation.
 *
 * registerDependency(spec)         → { registered, depId, from, to }
 * resolveDependencyOrder(nodeIds)  → { resolved, order, cycles }
 * analyzeDependencyDepth(nodeId)   → { found, nodeId, depth, dependents }
 * validateDependencyGraph()        → { valid, cycleCount, cycles }
 * getDependencyMetrics()           → DependencyMetrics
 * reset()
 *
 * Edge semantics: from → to = "from depends on to" (to is a prerequisite).
 * Topological order: prerequisites first (to before from).
 */

let _deps    = [];          // { depId, from, to, weight }
let _nodes   = new Set();
let _counter = 0;

// ── registerDependency ────────────────────────────────────────────────

function registerDependency(spec = {}) {
    const { from = null, to = null, weight = 1 } = spec;
    if (!from) return { registered: false, reason: "from_required" };
    if (!to)   return { registered: false, reason: "to_required" };
    if (from === to) return { registered: false, reason: "self_dependency_not_allowed" };

    _nodes.add(from);
    _nodes.add(to);

    const depId = `dep-${++_counter}`;
    _deps.push({ depId, from, to, weight });
    return { registered: true, depId, from, to, weight };
}

// ── resolveDependencyOrder ────────────────────────────────────────────

function resolveDependencyOrder(nodeIds = []) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0)
        return { resolved: false, reason: "no_nodes_provided" };

    const nodeSet = new Set(nodeIds);

    // Build adjacency for subgraph: prerequisite → dependent (reversed from edge semantics)
    // Edge: from → to (from depends on to), so for topo sort: to must come first
    // In Kahn's: treat "to → from" as the execution-order edge
    const inDegree = new Map();
    const adj      = new Map();   // prerequisite → [dependents]

    for (const n of nodeSet) { inDegree.set(n, 0); adj.set(n, []); }

    for (const { from, to } of _deps) {
        if (!nodeSet.has(from) || !nodeSet.has(to)) continue;
        // to must execute before from → edge: to → from in Kahn's
        adj.get(to).push(from);
        inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
    }

    const queue  = [...nodeSet].filter(n => (inDegree.get(n) ?? 0) === 0);
    const order  = [];

    while (queue.length > 0) {
        const node = queue.shift();
        order.push(node);
        for (const dependent of (adj.get(node) ?? [])) {
            const deg = (inDegree.get(dependent) ?? 0) - 1;
            inDegree.set(dependent, deg);
            if (deg === 0) queue.push(dependent);
        }
    }

    const remaining = [...nodeSet].filter(n => !order.includes(n));
    const cycles    = remaining.length > 0 ? [remaining] : [];

    return {
        resolved:   remaining.length === 0,
        order,
        cycles,
        cycleCount: cycles.length,
    };
}

// ── analyzeDependencyDepth ────────────────────────────────────────────

function analyzeDependencyDepth(nodeId) {
    if (!_nodes.has(nodeId)) return { found: false, reason: "node_not_registered" };

    // Depth = max chain of prerequisites below nodeId
    // Follow "from → to" edges starting from nodeId (what does nodeId depend on, transitively)
    const prereqAdj = new Map();
    for (const n of _nodes) prereqAdj.set(n, []);
    for (const { from, to } of _deps) prereqAdj.get(from).push(to);

    // BFS to find max depth
    const distances = new Map([[nodeId, 0]]);
    const queue     = [nodeId];
    const visited   = new Set([nodeId]);
    let   maxDepth  = 0;

    while (queue.length > 0) {
        const cur  = queue.shift();
        const dist = distances.get(cur);
        for (const prereq of (prereqAdj.get(cur) ?? [])) {
            if (!visited.has(prereq)) {
                visited.add(prereq);
                distances.set(prereq, dist + 1);
                maxDepth = Math.max(maxDepth, dist + 1);
                queue.push(prereq);
            }
        }
    }

    // Dependents: nodes that depend on nodeId (from === nodeId means it depends on something,
    // but we want nodes where to === nodeId, meaning THEY depend on nodeId as prereq)
    const dependents = _deps.filter(d => d.to === nodeId).map(d => d.from);

    return { found: true, nodeId, depth: maxDepth, dependents, dependentCount: dependents.length };
}

// ── validateDependencyGraph ───────────────────────────────────────────

function validateDependencyGraph() {
    if (_nodes.size === 0) return { valid: true, cycleCount: 0, cycles: [], nodeCount: 0 };

    const result = resolveDependencyOrder([..._nodes]);
    return {
        valid:      result.resolved,
        cycleCount: result.cycleCount,
        cycles:     result.cycles,
        nodeCount:  _nodes.size,
        depCount:   _deps.length,
    };
}

// ── getDependencyMetrics ──────────────────────────────────────────────

function getDependencyMetrics() {
    const nodeCount = _nodes.size;
    return {
        totalDependencies:      _deps.length,
        totalNodes:             nodeCount,
        avgDependenciesPerNode: nodeCount > 0 ? +(_deps.length / nodeCount).toFixed(2) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _deps    = [];
    _nodes   = new Set();
    _counter = 0;
}

module.exports = {
    registerDependency, resolveDependencyOrder, analyzeDependencyDepth,
    validateDependencyGraph, getDependencyMetrics, reset,
};
