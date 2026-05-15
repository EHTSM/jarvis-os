"use strict";
/**
 * runtimeStateManager — centralized runtime state + lightweight console API.
 *
 * setMode(mode, reason)                → ModeChange
 * registerWorkflow(workflow)           → void
 * unregisterWorkflow(workflowId)       → void
 * updateComponentState(id, state)      → void
 * registerRecoveryTree(treeId, info)   → void
 * closeRecoveryTree(treeId, outcome)   → void
 * registerContainment(groupId, status) → void
 * releaseContainment(groupId)          → void
 * enqueueArbitration(workflow)         → void
 * dequeueArbitration(workflowId)       → void
 * getConsoleSnapshot()                 → RuntimeSnapshot
 * getActiveWorkflows()                 → Workflow[]
 * getDegradedComponents()              → Component[]
 * getRuntimeStats()                    → Stats
 * reset()
 */

const VALID_MODES     = ["normal", "safe", "degraded", "recovery"];
const COMPONENT_TYPES = ["browser_agent", "local_executor", "automation_worker", "tool_adapter", "n8n_worker", "generic"];

let _mode         = "normal";
let _modeHistory  = [];
let _workflows    = new Map();    // workflowId → { workflowId, type, state, admittedAt }
let _components   = new Map();    // componentId → { id, type, health, pressure, status }
let _recoveryTrees = new Map();   // treeId → { treeId, incidentType, status, startedAt }
let _containments = new Map();    // groupId → { groupId, memberCount, status, triggeredAt }
let _arbitrationQ = [];           // ordered list of pending workflows
let _counter      = 0;

// ── setMode ───────────────────────────────────────────────────────────

function setMode(mode, reason = "") {
    if (!VALID_MODES.includes(mode)) return { changed: false, reason: "invalid_mode" };
    const prev  = _mode;
    _mode       = mode;
    const entry = { mode, previousMode: prev, reason, ts: new Date().toISOString() };
    _modeHistory.push(entry);
    return { changed: mode !== prev, mode, previousMode: prev, reason };
}

// ── registerWorkflow / unregisterWorkflow ─────────────────────────────

function registerWorkflow(workflow = {}) {
    const id = workflow.workflowId ?? workflow.id ?? `wf-${++_counter}`;
    _workflows.set(id, {
        workflowId:  id,
        type:        workflow.type        ?? "generic",
        state:       workflow.state       ?? "queued",
        riskLevel:   workflow.riskLevel   ?? "low",
        latencyClass: workflow.latencyClass ?? "standard",
        admittedAt:  workflow.admittedAt  ?? null,
        startedAt:   workflow.startedAt   ?? null,
    });
    return id;
}

function unregisterWorkflow(workflowId) {
    _workflows.delete(workflowId);
    _arbitrationQ = _arbitrationQ.filter(w => w.workflowId !== workflowId);
}

function updateWorkflowState(workflowId, state) {
    const wf = _workflows.get(workflowId);
    if (wf) wf.state = state;
}

// ── updateComponentState ──────────────────────────────────────────────

function updateComponentState(id, state = {}) {
    const existing = _components.get(id) ?? { id, type: "generic" };
    _components.set(id, {
        ...existing,
        health:   state.health   ?? existing.health   ?? 1.0,
        pressure: state.pressure ?? existing.pressure ?? 0.0,
        status:   state.status   ?? existing.status   ?? "healthy",
        type:     state.type     ?? existing.type,
        updatedAt: new Date().toISOString(),
    });
}

// ── registerRecoveryTree / closeRecoveryTree ──────────────────────────

function registerRecoveryTree(treeId, info = {}) {
    _recoveryTrees.set(treeId, {
        treeId,
        incidentType: info.incidentType ?? "unknown",
        status:       info.status       ?? "in_progress",
        stepCount:    info.stepCount    ?? 0,
        startedAt:    info.startedAt    ?? new Date().toISOString(),
        completedAt:  null,
    });
}

function closeRecoveryTree(treeId, outcome = "completed") {
    const tree = _recoveryTrees.get(treeId);
    if (tree) {
        tree.status      = outcome;
        tree.completedAt = new Date().toISOString();
    }
}

// ── registerContainment / releaseContainment ──────────────────────────

function registerContainment(groupId, status = {}) {
    _containments.set(groupId, {
        groupId,
        memberCount:  status.memberCount  ?? 0,
        failureRate:  status.failureRate  ?? 0,
        status:       status.status       ?? "contained",
        triggeredAt:  status.triggeredAt  ?? new Date().toISOString(),
        releasedAt:   null,
    });
}

function releaseContainment(groupId) {
    const c = _containments.get(groupId);
    if (c) {
        c.status      = "released";
        c.releasedAt  = new Date().toISOString();
    }
}

// ── arbitration queue ─────────────────────────────────────────────────

function enqueueArbitration(workflow = {}) {
    const id = workflow.workflowId ?? workflow.id;
    if (!_arbitrationQ.some(w => w.workflowId === id)) {
        _arbitrationQ.push({ workflowId: id, type: workflow.type ?? "generic", ...workflow });
    }
}

function dequeueArbitration(workflowId) {
    _arbitrationQ = _arbitrationQ.filter(w => w.workflowId !== workflowId);
}

// ── getConsoleSnapshot (runtime console API) ──────────────────────────

function getConsoleSnapshot() {
    const active      = [..._workflows.values()].filter(w => !["completed", "failed"].includes(w.state));
    const degraded    = [..._components.values()].filter(c => c.status === "degraded" || c.status === "critical");
    const activeTrees = [..._recoveryTrees.values()].filter(t => t.status === "in_progress");
    const activeConts = [..._containments.values()].filter(c => c.status === "contained");

    return {
        mode:                 _mode,
        modeChanges:          _modeHistory.length,
        activeWorkflows:      active.length,
        activeWorkflowList:   active.map(w => ({ workflowId: w.workflowId, type: w.type, state: w.state })),
        degradedComponents:   degraded.length,
        degradedList:         degraded.map(c => ({ id: c.id, status: c.status, health: c.health })),
        activeRecoveryTrees:  activeTrees.length,
        recoveryTreeList:     activeTrees.map(t => ({ treeId: t.treeId, incidentType: t.incidentType })),
        activeContainments:   activeConts.length,
        containmentList:      activeConts.map(c => ({ groupId: c.groupId, memberCount: c.memberCount })),
        arbitrationQueueSize: _arbitrationQ.length,
        ts:                   new Date().toISOString(),
    };
}

// ── getActiveWorkflows / getDegradedComponents ────────────────────────

function getActiveWorkflows() {
    return [..._workflows.values()].filter(w => !["completed", "failed"].includes(w.state));
}

function getDegradedComponents() {
    return [..._components.values()].filter(c => c.status !== "healthy");
}

// ── getRuntimeStats ───────────────────────────────────────────────────

function getRuntimeStats() {
    const wfs = [..._workflows.values()];
    const byState = {};
    for (const w of wfs) byState[w.state] = (byState[w.state] ?? 0) + 1;

    return {
        mode:              _mode,
        totalWorkflows:    wfs.length,
        byState,
        totalComponents:   _components.size,
        degradedComponents: getDegradedComponents().length,
        recoveryTrees:     _recoveryTrees.size,
        activeContainments: [..._containments.values()].filter(c => c.status === "contained").length,
        arbitrationPending: _arbitrationQ.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _mode          = "normal";
    _modeHistory   = [];
    _workflows     = new Map();
    _components    = new Map();
    _recoveryTrees = new Map();
    _containments  = new Map();
    _arbitrationQ  = [];
    _counter       = 0;
}

module.exports = {
    VALID_MODES, COMPONENT_TYPES,
    setMode, registerWorkflow, unregisterWorkflow, updateWorkflowState,
    updateComponentState, registerRecoveryTree, closeRecoveryTree,
    registerContainment, releaseContainment,
    enqueueArbitration, dequeueArbitration,
    getConsoleSnapshot, getActiveWorkflows, getDegradedComponents,
    getRuntimeStats, reset,
};
