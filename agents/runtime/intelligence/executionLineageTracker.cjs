"use strict";
/**
 * executionLineageTracker — parent-child execution tracking, causal chain
 * tracing, lineage tree construction, and ancestor/descendant discovery.
 *
 * registerExecution(spec)    → { registered, execId }
 * linkParentChild(spec)      → { linked, linkId, parentId, childId }
 * getLineage(execId)         → { found, execId, ancestors, descendants }
 * traceCausalChain(execId)   → { found, execId, chain, depth }
 * getLineageMetrics()        → LineageMetrics
 * reset()
 */

let _executions   = new Map();  // execId → ExecutionRecord
let _parentMap    = new Map();  // childId → parentId
let _childrenMap  = new Map();  // parentId → Set<childId>
let _links        = [];
let _counter      = 0;

// ── registerExecution ─────────────────────────────────────────────────

function registerExecution(spec = {}) {
    const { workflowId = null, status = "pending", metadata = {} } = spec;
    if (!workflowId) return { registered: false, reason: "workflowId_required" };

    const execId = spec.execId ?? `exec-${++_counter}`;
    if (_executions.has(execId)) return { registered: false, reason: "execId_already_registered", execId };

    _executions.set(execId, { execId, workflowId, status, metadata, registeredAt: new Date().toISOString() });
    return { registered: true, execId, workflowId };
}

// ── linkParentChild ───────────────────────────────────────────────────

function linkParentChild(spec = {}) {
    const { parentId = null, childId = null } = spec;
    if (!parentId) return { linked: false, reason: "parentId_required" };
    if (!childId)  return { linked: false, reason: "childId_required" };
    if (parentId === childId) return { linked: false, reason: "self_link_not_allowed" };
    if (!_executions.has(parentId)) return { linked: false, reason: "parent_not_registered" };
    if (!_executions.has(childId))  return { linked: false, reason: "child_not_registered" };
    if (_parentMap.has(childId))    return { linked: false, reason: "child_already_has_parent" };

    _parentMap.set(childId, parentId);
    if (!_childrenMap.has(parentId)) _childrenMap.set(parentId, new Set());
    _childrenMap.get(parentId).add(childId);

    const linkId = `link-${++_counter}`;
    _links.push({ linkId, parentId, childId, linkedAt: new Date().toISOString() });
    return { linked: true, linkId, parentId, childId };
}

// ── getLineage ────────────────────────────────────────────────────────

function getLineage(execId) {
    if (!_executions.has(execId)) return { found: false, reason: "execution_not_found" };

    // Walk up for ancestors
    const ancestors = [];
    let cur = _parentMap.get(execId);
    while (cur !== undefined) {
        ancestors.push(cur);
        cur = _parentMap.get(cur);
    }

    // Walk down for descendants (DFS)
    const descendants = [];
    const stack = [...(_childrenMap.get(execId) ?? [])];
    const seen  = new Set();
    while (stack.length > 0) {
        const node = stack.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        descendants.push(node);
        for (const child of (_childrenMap.get(node) ?? [])) stack.push(child);
    }

    return { found: true, execId, ancestors, descendants, ancestorCount: ancestors.length, descendantCount: descendants.length };
}

// ── traceCausalChain ──────────────────────────────────────────────────

function traceCausalChain(execId) {
    if (!_executions.has(execId)) return { found: false, reason: "execution_not_found" };

    // Walk to root
    const chain = [execId];
    let cur = _parentMap.get(execId);
    while (cur !== undefined) {
        chain.unshift(cur);
        cur = _parentMap.get(cur);
    }

    return { found: true, execId, chain, depth: chain.length - 1, root: chain[0] };
}

// ── getLineageMetrics ─────────────────────────────────────────────────

function getLineageMetrics() {
    const all        = [..._executions.keys()];
    const rootCount  = all.filter(id => !_parentMap.has(id)).length;
    const leafCount  = all.filter(id => !_childrenMap.has(id) || _childrenMap.get(id).size === 0).length;
    return {
        totalExecutions: _executions.size,
        totalLinks:      _links.length,
        rootCount,
        leafCount,
        maxDepth:        all.reduce((max, id) => {
            let depth = 0;
            let cur   = _parentMap.get(id);
            while (cur !== undefined) { depth++; cur = _parentMap.get(cur); }
            return Math.max(max, depth);
        }, 0),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions  = new Map();
    _parentMap   = new Map();
    _childrenMap = new Map();
    _links       = [];
    _counter     = 0;
}

module.exports = {
    registerExecution, linkParentChild, getLineage,
    traceCausalChain, getLineageMetrics, reset,
};
