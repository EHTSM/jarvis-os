"use strict";
/**
 * executionGraphManager — DAG-based workflow dependency graph with cycle
 * detection, topological execution planning, and priority-aware ordering.
 *
 * createExecutionGraph(spec)              → { created, graphId }
 * addNode(graphId, nodeSpec)              → { added, nodeId, graphId }
 * addDependency(graphId, from, to)        → { added, graphId, from, to }
 * validateGraph(graphId)                  → { valid, graphId, nodeCount, edgeCount }
 * detectCycles(graphId)                   → { hasCycles, cycles }
 * generateExecutionPlan(graphId)          → { generated, graphId, executionOrder, stages, totalNodes }
 * getExecutionTopology(graphId)           → TopologyRecord | null
 * reset()
 */

const EXECUTION_TYPES = ["task", "workflow", "agent", "capability", "recovery"];

let _graphs  = new Map();
let _counter = 0;

// ── createExecutionGraph ──────────────────────────────────────────────

function createExecutionGraph(spec = {}) {
    const graphId = `grph-${++_counter}`;
    _graphs.set(graphId, {
        graphId,
        name:      spec.name ?? null,
        nodes:     new Map(),
        status:    "building",
        createdAt: new Date().toISOString(),
    });
    return { created: true, graphId };
}

// ── addNode ───────────────────────────────────────────────────────────

function addNode(graphId, nodeSpec = {}) {
    const graph = _graphs.get(graphId);
    if (!graph) return { added: false, reason: "graph_not_found" };

    const {
        nodeId,
        executionType      = "task",
        priority           = 5,
        executionCost      = 1,
        retryPolicy        = null,
        isolationDomain    = null,
        verificationPolicy = null,
    } = nodeSpec;

    if (!nodeId)               return { added: false, reason: "nodeId_required" };
    if (graph.nodes.has(nodeId)) return { added: false, reason: "duplicate_node" };

    graph.nodes.set(nodeId, {
        nodeId,
        executionType,
        dependencies: [],
        dependents:   [],
        priority,
        executionCost,
        retryPolicy,
        isolationDomain,
        verificationPolicy,
        status:    "pending",
        addedAt:   new Date().toISOString(),
    });
    return { added: true, nodeId, graphId };
}

// ── addDependency ─────────────────────────────────────────────────────

function addDependency(graphId, fromNodeId, toNodeId) {
    // fromNodeId depends on toNodeId  →  toNodeId must run first
    const graph = _graphs.get(graphId);
    if (!graph)                          return { added: false, reason: "graph_not_found" };
    if (!graph.nodes.has(fromNodeId))    return { added: false, reason: "from_node_not_found" };
    if (!graph.nodes.has(toNodeId))      return { added: false, reason: "to_node_not_found" };
    if (fromNodeId === toNodeId)         return { added: false, reason: "self_dependency" };

    const from = graph.nodes.get(fromNodeId);
    const to   = graph.nodes.get(toNodeId);

    if (!from.dependencies.includes(toNodeId)) {
        from.dependencies.push(toNodeId);
        to.dependents.push(fromNodeId);
    }
    return { added: true, graphId, from: fromNodeId, to: toNodeId };
}

// ── validateGraph ─────────────────────────────────────────────────────

function validateGraph(graphId) {
    const graph = _graphs.get(graphId);
    if (!graph) return { valid: false, reason: "graph_not_found" };

    const cycleResult = detectCycles(graphId);
    if (cycleResult.hasCycles)
        return { valid: false, reason: "cycles_detected", cycles: cycleResult.cycles };

    let edgeCount = 0;
    for (const node of graph.nodes.values()) edgeCount += node.dependencies.length;

    return { valid: true, graphId, nodeCount: graph.nodes.size, edgeCount };
}

// ── detectCycles ──────────────────────────────────────────────────────

function detectCycles(graphId) {
    const graph = _graphs.get(graphId);
    if (!graph) return { hasCycles: false, reason: "graph_not_found" };

    // DFS coloring: 0=unvisited, 1=in-progress (gray), 2=done (black)
    const color  = new Map();
    const cycles = [];

    for (const id of graph.nodes.keys()) color.set(id, 0);

    function dfs(nodeId, path) {
        color.set(nodeId, 1);
        for (const depId of (graph.nodes.get(nodeId)?.dependencies ?? [])) {
            if (color.get(depId) === 1) {
                cycles.push([...path, nodeId, depId]);
            } else if (color.get(depId) === 0) {
                dfs(depId, [...path, nodeId]);
            }
        }
        color.set(nodeId, 2);
    }

    for (const id of graph.nodes.keys()) {
        if (color.get(id) === 0) dfs(id, []);
    }

    return { hasCycles: cycles.length > 0, cycles };
}

// ── generateExecutionPlan ─────────────────────────────────────────────

function generateExecutionPlan(graphId) {
    const graph = _graphs.get(graphId);
    if (!graph) return { generated: false, reason: "graph_not_found" };
    if (graph.nodes.size === 0)
        return { generated: true, graphId, executionOrder: [], stages: [], totalNodes: 0 };

    const cycleResult = detectCycles(graphId);
    if (cycleResult.hasCycles) return { generated: false, reason: "cycles_detected" };

    // Kahn's topological sort with priority tie-breaking
    const remaining = new Map();
    for (const [id, node] of graph.nodes) remaining.set(id, node.dependencies.length);

    let queue = [...graph.nodes.keys()].filter(id => remaining.get(id) === 0);
    queue.sort((a, b) => (graph.nodes.get(b).priority ?? 0) - (graph.nodes.get(a).priority ?? 0));

    const order = [];
    while (queue.length > 0) {
        const nodeId = queue.shift();
        order.push(nodeId);
        for (const depId of (graph.nodes.get(nodeId)?.dependents ?? [])) {
            const n = remaining.get(depId) - 1;
            remaining.set(depId, n);
            if (n === 0) {
                queue.push(depId);
                queue.sort((a, b) => (graph.nodes.get(b).priority ?? 0) - (graph.nodes.get(a).priority ?? 0));
            }
        }
    }

    return {
        generated:      true,
        graphId,
        executionOrder: order,
        stages:         _buildStages(graph, order),
        totalNodes:     graph.nodes.size,
    };
}

function _buildStages(graph, order) {
    const depth = new Map();
    for (const nodeId of order) {
        const deps = graph.nodes.get(nodeId)?.dependencies ?? [];
        depth.set(nodeId, deps.length === 0
            ? 0
            : Math.max(...deps.map(d => depth.get(d) ?? 0)) + 1);
    }
    if (depth.size === 0) return [];
    const maxD   = Math.max(...depth.values());
    const stages = [];
    for (let d = 0; d <= maxD; d++) {
        const stage = order.filter(n => depth.get(n) === d);
        if (stage.length > 0) stages.push(stage);
    }
    return stages;
}

// ── getExecutionTopology ──────────────────────────────────────────────

function getExecutionTopology(graphId) {
    const graph = _graphs.get(graphId);
    if (!graph) return null;

    let edgeCount = 0;
    const edges   = [];
    for (const [id, node] of graph.nodes) {
        edgeCount += node.dependencies.length;
        if (node.dependencies.length > 0)
            edges.push({ from: id, dependsOn: [...node.dependencies] });
    }

    return {
        graphId,
        name:      graph.name,
        nodeCount: graph.nodes.size,
        edgeCount,
        nodes:     [...graph.nodes.values()].map(n => ({
            ...n,
            dependencies: [...n.dependencies],
            dependents:   [...n.dependents],
        })),
        edges,
        status: graph.status,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _graphs  = new Map();
    _counter = 0;
}

module.exports = {
    EXECUTION_TYPES,
    createExecutionGraph, addNode, addDependency,
    validateGraph, detectCycles, generateExecutionPlan,
    getExecutionTopology, reset,
};
