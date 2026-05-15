"use strict";
/**
 * runtimeTopologyGraph — workflow dependency graphing, topology snapshots,
 * isolation domain mapping, cycle detection, and critical-path analysis.
 *
 * createTopologyNode(spec)         → { created, nodeId, workflowId }
 * addTopologyEdge(spec)            → { added, edgeId, from, to }
 * detectCycles()                   → { hasCycles, cycles }
 * findCriticalPath(fromId, toId)   → { found, path, length }
 * getTopologySnapshot()            → { snapshotId, nodeCount, edgeCount, nodes, edges }
 * getIsolationDomains()            → { domainCount, domains }
 * reset()
 */

let _nodes   = new Map();   // nodeId → NodeRecord
let _edges   = [];          // EdgeRecord[]
let _counter = 0;

// ── createTopologyNode ────────────────────────────────────────────────

function createTopologyNode(spec = {}) {
    const { workflowId = null, isolationDomain = "default", priority = 5, status = "active" } = spec;
    if (!workflowId) return { created: false, reason: "workflowId_required" };

    const nodeId = `node-${++_counter}`;
    _nodes.set(nodeId, { nodeId, workflowId, isolationDomain, priority, status, createdAt: new Date().toISOString() });
    return { created: true, nodeId, workflowId, isolationDomain };
}

// ── addTopologyEdge ───────────────────────────────────────────────────

function addTopologyEdge(spec = {}) {
    const { from = null, to = null, edgeType = "dependency" } = spec;
    if (!from) return { added: false, reason: "from_required" };
    if (!to)   return { added: false, reason: "to_required" };
    if (!_nodes.has(from)) return { added: false, reason: "from_node_not_found" };
    if (!_nodes.has(to))   return { added: false, reason: "to_node_not_found" };
    if (from === to)       return { added: false, reason: "self_loop_not_allowed" };

    const edgeId = `edge-${++_counter}`;
    _edges.push({ edgeId, from, to, edgeType, addedAt: new Date().toISOString() });
    return { added: true, edgeId, from, to, edgeType };
}

// ── detectCycles ──────────────────────────────────────────────────────

function detectCycles() {
    const adj     = new Map();
    for (const n of _nodes.keys()) adj.set(n, []);
    for (const e of _edges) adj.get(e.from).push(e.to);

    const visited = new Set();
    const inStack = new Set();
    const cycles  = [];

    function dfs(nodeId, stack) {
        visited.add(nodeId);
        inStack.add(nodeId);

        for (const neighbor of (adj.get(nodeId) ?? [])) {
            if (!visited.has(neighbor)) {
                dfs(neighbor, [...stack, nodeId]);
            } else if (inStack.has(neighbor)) {
                const idx = stack.indexOf(neighbor);
                cycles.push(idx >= 0 ? [...stack.slice(idx), nodeId, neighbor] : [nodeId, neighbor]);
            }
        }
        inStack.delete(nodeId);
    }

    for (const nodeId of _nodes.keys()) {
        if (!visited.has(nodeId)) dfs(nodeId, []);
    }

    return { hasCycles: cycles.length > 0, cycleCount: cycles.length, cycles };
}

// ── findCriticalPath ──────────────────────────────────────────────────

function findCriticalPath(fromId, toId) {
    if (!_nodes.has(fromId)) return { found: false, reason: "from_node_not_found" };
    if (!_nodes.has(toId))   return { found: false, reason: "to_node_not_found" };
    if (fromId === toId)     return { found: true, path: [fromId], length: 0 };

    const adj = new Map();
    for (const n of _nodes.keys()) adj.set(n, []);
    for (const e of _edges) adj.get(e.from).push(e.to);

    // BFS for shortest path
    const parent  = new Map();
    const visited = new Set([fromId]);
    const queue   = [fromId];

    while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === toId) {
            const path = [];
            let node   = toId;
            while (node !== undefined) { path.unshift(node); node = parent.get(node); }
            return { found: true, path, length: path.length - 1 };
        }
        for (const next of (adj.get(cur) ?? [])) {
            if (!visited.has(next)) {
                visited.add(next);
                parent.set(next, cur);
                queue.push(next);
            }
        }
    }

    return { found: false, reason: "no_path_exists" };
}

// ── getTopologySnapshot ───────────────────────────────────────────────

function getTopologySnapshot() {
    const snapshotId = `snap-${++_counter}`;
    return {
        snapshotId,
        nodeCount:   _nodes.size,
        edgeCount:   _edges.length,
        nodes:       [..._nodes.values()],
        edges:       [..._edges],
        capturedAt:  new Date().toISOString(),
    };
}

// ── getIsolationDomains ───────────────────────────────────────────────

function getIsolationDomains() {
    const domains = {};
    for (const rec of _nodes.values()) {
        if (!domains[rec.isolationDomain]) domains[rec.isolationDomain] = [];
        domains[rec.isolationDomain].push(rec.nodeId);
    }
    return { domainCount: Object.keys(domains).length, domains };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _nodes   = new Map();
    _edges   = [];
    _counter = 0;
}

module.exports = {
    createTopologyNode, addTopologyEdge, detectCycles,
    findCriticalPath, getTopologySnapshot, getIsolationDomains, reset,
};
