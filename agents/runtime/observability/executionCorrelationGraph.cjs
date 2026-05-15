"use strict";
/**
 * executionCorrelationGraph — correlation-ID-aware execution tracing.
 * Tracks parent-child relationships between executions and chains correlated
 * events into traversable graphs.
 *
 * linkExecution(spec)               → { linked, nodeId }
 * addCorrelationEdge(spec)          → { added, edgeId }
 * getExecutionNode(executionId)     → ExecutionNode | null
 * getCorrelatedExecutions(correlId) → ExecutionNode[]
 * getChildren(executionId)          → ExecutionNode[]
 * getAncestors(executionId)         → ExecutionNode[]
 * getDescendants(executionId)       → ExecutionNode[]
 * getChain(correlationId)           → ChainReport
 * getGraphMetrics()                 → GraphMetrics
 * reset()
 */

let _nodes    = new Map();   // executionId → ExecutionNode
let _edges    = [];          // EdgeRecord[]
let _corrIdx  = new Map();   // correlationId → Set<executionId>
let _counter  = 0;
let _edgeCtr  = 0;

// ── linkExecution ──────────────────────────────────────────────────────

function linkExecution(spec = {}) {
    const {
        executionId    = null,
        workflowId     = null,
        correlationId  = null,
        parentExecutionId = null,
        adapterType    = null,
        capability     = null,
        authorityLevel = null,
        outcome        = null,
        timestamp      = new Date().toISOString(),
    } = spec;

    if (!executionId) return { linked: false, reason: "executionId_required" };

    const nodeId = `gn-${++_counter}`;
    const node   = {
        nodeId, executionId,
        workflowId:        workflowId        ?? null,
        correlationId:     correlationId     ?? null,
        parentExecutionId: parentExecutionId ?? null,
        adapterType:       adapterType       ?? null,
        capability:        capability        ?? null,
        authorityLevel:    authorityLevel    ?? null,
        outcome:           outcome           ?? null,
        timestamp,
        children: [],
    };

    _nodes.set(executionId, node);

    // Register in correlation index
    if (correlationId) {
        if (!_corrIdx.has(correlationId)) _corrIdx.set(correlationId, new Set());
        _corrIdx.get(correlationId).add(executionId);
    }

    // Wire parent → child
    if (parentExecutionId && _nodes.has(parentExecutionId)) {
        _nodes.get(parentExecutionId).children.push(executionId);
    }

    return { linked: true, nodeId, executionId, correlationId };
}

// ── addCorrelationEdge ─────────────────────────────────────────────────

function addCorrelationEdge(spec = {}) {
    const {
        fromExecutionId = null,
        toExecutionId   = null,
        edgeType        = "correlation",  // "correlation" | "retry" | "recovery" | "replay"
        correlationId   = null,
        timestamp       = new Date().toISOString(),
    } = spec;

    if (!fromExecutionId) return { added: false, reason: "fromExecutionId_required" };
    if (!toExecutionId)   return { added: false, reason: "toExecutionId_required" };

    const edgeId = `ge-${++_edgeCtr}`;
    _edges.push(Object.freeze({
        edgeId, fromExecutionId, toExecutionId,
        edgeType, correlationId: correlationId ?? null, timestamp,
    }));

    return { added: true, edgeId, fromExecutionId, toExecutionId, edgeType };
}

// ── getExecutionNode ───────────────────────────────────────────────────

function getExecutionNode(executionId) {
    if (!executionId) return null;
    return _nodes.get(executionId) ?? null;
}

// ── getCorrelatedExecutions ────────────────────────────────────────────

function getCorrelatedExecutions(correlationId) {
    if (!correlationId) return [];
    const ids = _corrIdx.get(correlationId);
    if (!ids) return [];
    return [...ids].map(id => _nodes.get(id)).filter(Boolean);
}

// ── getChildren ───────────────────────────────────────────────────────

function getChildren(executionId) {
    const node = _nodes.get(executionId);
    if (!node) return [];
    return node.children.map(cid => _nodes.get(cid)).filter(Boolean);
}

// ── getAncestors ──────────────────────────────────────────────────────

function getAncestors(executionId) {
    const ancestors = [];
    let   current   = _nodes.get(executionId);
    const visited   = new Set();

    while (current?.parentExecutionId) {
        if (visited.has(current.parentExecutionId)) break;
        visited.add(current.parentExecutionId);
        const parent = _nodes.get(current.parentExecutionId);
        if (!parent) break;
        ancestors.push(parent);
        current = parent;
    }
    return ancestors;
}

// ── getDescendants ─────────────────────────────────────────────────────

function getDescendants(executionId) {
    const result  = [];
    const queue   = [...(getChildren(executionId))];
    const visited = new Set([executionId]);

    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || visited.has(node.executionId)) continue;
        visited.add(node.executionId);
        result.push(node);
        queue.push(...getChildren(node.executionId));
    }
    return result;
}

// ── getChain ──────────────────────────────────────────────────────────

function getChain(correlationId) {
    const nodes       = getCorrelatedExecutions(correlationId);
    const edgesInChain = _edges.filter(e => e.correlationId === correlationId);
    const outcomes    = {};
    for (const n of nodes) {
        if (n.outcome) outcomes[n.outcome] = (outcomes[n.outcome] ?? 0) + 1;
    }
    return {
        correlationId,
        nodeCount:  nodes.length,
        edgeCount:  edgesInChain.length,
        nodes:      nodes.map(n => ({ executionId: n.executionId, outcome: n.outcome, adapterType: n.adapterType })),
        edges:      edgesInChain,
        outcomes,
    };
}

// ── getGraphMetrics ────────────────────────────────────────────────────

function getGraphMetrics() {
    const nodes        = [..._nodes.values()];
    const rootNodes    = nodes.filter(n => !n.parentExecutionId);
    const leafNodes    = nodes.filter(n => n.children.length === 0);
    const byAdapter    = {};
    const byOutcome    = {};

    for (const n of nodes) {
        if (n.adapterType) byAdapter[n.adapterType] = (byAdapter[n.adapterType] ?? 0) + 1;
        if (n.outcome)     byOutcome[n.outcome]     = (byOutcome[n.outcome]     ?? 0) + 1;
    }

    return {
        totalNodes:       nodes.length,
        totalEdges:       _edges.length,
        correlationCount: _corrIdx.size,
        rootNodes:        rootNodes.length,
        leafNodes:        leafNodes.length,
        byAdapter,
        byOutcome,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _nodes   = new Map();
    _edges   = [];
    _corrIdx = new Map();
    _counter = 0;
    _edgeCtr = 0;
}

module.exports = {
    linkExecution, addCorrelationEdge, getExecutionNode,
    getCorrelatedExecutions, getChildren, getAncestors,
    getDescendants, getChain, getGraphMetrics, reset,
};
