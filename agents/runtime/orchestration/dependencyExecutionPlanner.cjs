"use strict";
/**
 * dependencyExecutionPlanner — DAG-based dependency tracking for execution
 * ordering. Blocks executions until all declared dependencies complete.
 * Detects cycles before registration.
 *
 * registerExecution(spec)        → { registered, executionId }
 * addDependency(spec)            → { added } | { added: false, reason }
 * markCompleted(executionId)     → { unlocked, unlockedIds }
 * markFailed(executionId)        → { propagated, failedIds }
 * getReadyExecutions()           → ExecutionNode[]
 * getBlockedExecutions()         → ExecutionNode[]
 * hasCycle()                     → boolean
 * getExecutionPlan()             → ExecutionPlan
 * getPlannerMetrics()            → PlannerMetrics
 * reset()
 */

let _nodes   = new Map();   // executionId → Node
let _counter = 0;

function _node(executionId) {
    return _nodes.get(executionId) ?? null;
}

function _detectCycle(startId, targetId, visited = new Set()) {
    if (startId === targetId) return true;
    if (visited.has(startId)) return false;
    visited.add(startId);
    const node = _nodes.get(startId);
    if (!node) return false;
    for (const dep of node.dependsOn) {
        if (_detectCycle(dep, targetId, visited)) return true;
    }
    return false;
}

// ── registerExecution ──────────────────────────────────────────────────

function registerExecution(spec = {}) {
    const {
        executionId    = null,
        workflowId     = null,
        adapterType    = null,
        capability     = null,
        authorityLevel = null,
        priorityScore  = 50,
        meta           = null,
    } = spec;

    if (!executionId) return { registered: false, reason: "executionId_required" };
    if (_nodes.has(executionId))
        return { registered: false, reason: "execution_already_registered", executionId };

    _nodes.set(executionId, {
        executionId,
        workflowId:     workflowId     ?? null,
        adapterType:    adapterType    ?? null,
        capability:     capability     ?? null,
        authorityLevel: authorityLevel ?? null,
        priorityScore,
        meta:           meta           ?? null,
        dependsOn:      new Set(),    // executionIds this must wait for
        dependents:     new Set(),    // executionIds waiting on this
        state:          "pending",    // pending | ready | running | completed | failed | cancelled
        registeredAt:   new Date().toISOString(),
    });
    _counter++;
    return { registered: true, executionId };
}

// ── addDependency ──────────────────────────────────────────────────────

function addDependency(spec = {}) {
    const { executionId = null, dependsOnId = null } = spec;
    if (!executionId)  return { added: false, reason: "executionId_required" };
    if (!dependsOnId)  return { added: false, reason: "dependsOnId_required" };
    if (executionId === dependsOnId) return { added: false, reason: "self_dependency" };

    const node = _nodes.get(executionId);
    const dep  = _nodes.get(dependsOnId);
    if (!node) return { added: false, reason: "execution_not_found", executionId };
    if (!dep)  return { added: false, reason: "dependency_not_found",  dependsOnId };

    // Cycle check: would adding executionId → dependsOnId create a cycle?
    if (_detectCycle(dependsOnId, executionId)) {
        return { added: false, reason: "cycle_detected", executionId, dependsOnId };
    }

    node.dependsOn.add(dependsOnId);
    dep.dependents.add(executionId);

    return { added: true, executionId, dependsOnId };
}

// ── _recomputeReady ────────────────────────────────────────────────────

function _recomputeReady() {
    for (const node of _nodes.values()) {
        if (node.state !== "pending") continue;
        const allDone = [...node.dependsOn].every(id => {
            const d = _nodes.get(id);
            return d && d.state === "completed";
        });
        if (allDone) node.state = "ready";
    }
}

// ── markCompleted ──────────────────────────────────────────────────────

function markCompleted(executionId) {
    const node = _nodes.get(executionId);
    if (!node) return { unlocked: false, reason: "execution_not_found", executionId };

    node.state       = "completed";
    node.completedAt = new Date().toISOString();

    _recomputeReady();

    const unlockedIds = [...node.dependents].filter(id => {
        const d = _nodes.get(id);
        return d && d.state === "ready";
    });

    return { unlocked: true, executionId, unlockedIds };
}

// ── markFailed ────────────────────────────────────────────────────────

function markFailed(executionId) {
    const node = _nodes.get(executionId);
    if (!node) return { propagated: false, reason: "execution_not_found", executionId };

    const failedIds = [];

    function _cascade(id) {
        const n = _nodes.get(id);
        if (!n || n.state === "failed") return;
        n.state = "failed";
        failedIds.push(id);
        for (const dep of n.dependents) _cascade(dep);
    }

    _cascade(executionId);
    return { propagated: true, executionId, failedIds };
}

// ── getReadyExecutions ─────────────────────────────────────────────────

function getReadyExecutions() {
    _recomputeReady();
    return [..._nodes.values()]
        .filter(n => n.state === "ready")
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .map(n => ({
            executionId:    n.executionId,
            workflowId:     n.workflowId,
            adapterType:    n.adapterType,
            capability:     n.capability,
            authorityLevel: n.authorityLevel,
            priorityScore:  n.priorityScore,
            state:          n.state,
        }));
}

// ── getBlockedExecutions ───────────────────────────────────────────────

function getBlockedExecutions() {
    return [..._nodes.values()]
        .filter(n => n.state === "pending" && n.dependsOn.size > 0)
        .map(n => ({
            executionId: n.executionId,
            blockedBy:   [...n.dependsOn],
            state:       n.state,
        }));
}

// ── hasCycle ───────────────────────────────────────────────────────────

function hasCycle() {
    const visited = new Set();
    const inStack = new Set();

    function dfs(id) {
        if (inStack.has(id)) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        inStack.add(id);
        const node = _nodes.get(id);
        if (node) for (const dep of node.dependsOn) { if (dfs(dep)) return true; }
        inStack.delete(id);
        return false;
    }

    for (const id of _nodes.keys()) { if (dfs(id)) return true; }
    return false;
}

// ── getExecutionPlan ───────────────────────────────────────────────────

function getExecutionPlan() {
    _recomputeReady();
    const byState = {};
    for (const n of _nodes.values())
        byState[n.state] = (byState[n.state] ?? 0) + 1;

    return {
        totalExecutions: _nodes.size,
        readyCount:  byState.ready      ?? 0,
        pendingCount: byState.pending   ?? 0,
        completedCount: byState.completed ?? 0,
        failedCount: byState.failed     ?? 0,
        hasCycle:    hasCycle(),
        byState,
    };
}

// ── getPlannerMetrics ──────────────────────────────────────────────────

function getPlannerMetrics() {
    return getExecutionPlan();
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() { _nodes = new Map(); _counter = 0; }

module.exports = {
    registerExecution, addDependency, markCompleted, markFailed,
    getReadyExecutions, getBlockedExecutions, hasCycle,
    getExecutionPlan, getPlannerMetrics, reset,
};
