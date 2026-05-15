"use strict";
/**
 * workflowOrchestrator — integrates the full decision engine with lifecycle management.
 *
 * Connects:
 *   strategySelector  → dynamic strategy per workflow
 *   workflowRouter    → component routing + arbitration
 *   concurrencyOptimizer → slot budgeting
 *   failureContainment   → protection policies
 *   recoveryCoordinator  → recovery tree execution
 *   executionLifecycle   → state machine
 *   eventBus             → coordination events
 *   runtimeStateManager  → global state
 *   runtimePersistence   → checkpoints + history
 *
 * submitWorkflow(workflow)            → SubmitResult
 * admitWorkflow(workflowId)           → AdmitResult
 * runWorkflow(workflowId, executor)   → RunResult
 * handleFailure(workflowId, error)    → FailureResult
 * completeWorkflow(workflowId, result)→ CompletionResult
 * processArbitrationQueue(resources)  → ArbitrationResult
 * takeCheckpoint()                    → CheckpointResult
 * getOrchestratorStats()              → Stats
 * reset()
 */

const ss  = require("../decision/strategySelector.cjs");
const wr  = require("../decision/workflowRouter.cjs");
const co  = require("../decision/concurrencyOptimizer.cjs");
const fc  = require("../decision/failureContainment.cjs");
const rc  = require("../decision/recoveryCoordinator.cjs");
const el  = require("./executionLifecycle.cjs");
const eb  = require("./eventBus.cjs");
const rsm = require("./runtimeStateManager.cjs");
const rp  = require("./runtimePersistence.cjs");

// Workflow type → component type mapping for routing
const COMPONENT_AFFINITY = {
    browser_task:    "browser_agent",
    automation:      "automation_worker",
    n8n_workflow:    "n8n_worker",
    tool_execution:  "tool_adapter",
    dev_task:        "local_executor",
    vscode_task:     "local_executor",
    generic:         "generic",
};

// ── submitWorkflow ────────────────────────────────────────────────────

function submitWorkflow(workflow = {}) {
    const exec = el.createExecution({
        workflowId:   workflow.id      ?? workflow.workflowId,
        type:         workflow.type    ?? "generic",
        riskLevel:    workflow.riskLevel  ?? "low",
        latencyClass: workflow.latencyClass ?? "standard",
        metadata:     workflow.metadata ?? {},
    });

    rsm.registerWorkflow({ ...workflow, workflowId: exec.workflowId, state: "queued" });
    rsm.enqueueArbitration({ workflowId: exec.workflowId, ...workflow });

    eb.emit("workflow_queued", { workflowId: exec.workflowId, type: exec.type });

    return {
        submitted:    true,
        execId:       exec.execId,
        workflowId:   exec.workflowId,
        state:        "queued",
    };
}

// ── admitWorkflow ─────────────────────────────────────────────────────

function admitWorkflow(workflowId) {
    const exec = el.listExecutions().find(e => e.workflowId === workflowId);
    if (!exec) return { admitted: false, reason: "execution_not_found" };

    const tr = el.transition(exec.execId, "admitted");
    if (!tr.transitioned) return { admitted: false, reason: tr.reason };

    rsm.updateWorkflowState(workflowId, "admitted");
    rsm.dequeueArbitration(workflowId);
    eb.emit("workflow_admitted", { workflowId, execId: exec.execId });

    return { admitted: true, execId: exec.execId, workflowId };
}

// ── runWorkflow ───────────────────────────────────────────────────────

function runWorkflow(workflowId, executor = null) {
    // Find admitted execution
    const exec = el.listExecutions().find(e => e.workflowId === workflowId && e.state === "admitted");
    if (!exec) return { run: false, reason: "no_admitted_execution_found" };

    // 1. Select strategy based on current runtime state
    const stats   = rsm.getRuntimeStats();
    const mode    = rsm.getConsoleSnapshot().mode;
    const stratDecision = ss.selectStrategy({
        pressure:      stats.degradedComponents > 0 ? 0.5 + stats.degradedComponents * 0.1 : 0.1,
        health:        Math.max(0.3, 1 - stats.degradedComponents * 0.15),
        confidence:    stats.activeContainments > 0 ? 0.6 : 0.9,
        anomalyCount:  stats.activeContainments,
        workloadRisk:  exec.riskLevel,
        latencyClass:  exec.latencyClass,
    });

    // 2. Route to best component
    const preferredType = COMPONENT_AFFINITY[exec.type] ?? "generic";
    const routeDecision = wr.routeWorkflow({ type: exec.type, preferredType });

    // 3. Allocate execution budget
    const budget = co.allocateExecutionBudget({
        id:           workflowId,
        type:         exec.type,
        latencyClass: exec.latencyClass,
        riskLevel:    exec.riskLevel,
    });

    // 4. Transition to running
    el.transition(exec.execId, "running", {
        strategy:    stratDecision.strategy,
        componentId: routeDecision.componentId ?? null,
    });
    rsm.updateWorkflowState(workflowId, "running");

    el.addTraceEvent(exec.execId, {
        event:     "strategy_selected",
        strategy:  stratDecision.strategy,
        reasoning: stratDecision.reasoning,
    });

    if (routeDecision.routed) {
        el.addTraceEvent(exec.execId, {
            event:      "routed",
            componentId: routeDecision.componentId,
        });
    }

    eb.emit("strategy_selected", { workflowId, strategy: stratDecision.strategy });
    eb.emit("workflow_running",  { workflowId, execId: exec.execId, componentId: routeDecision.componentId });

    // 5. Execute (call provided executor or simulate)
    let execResult;
    if (typeof executor === "function") {
        execResult = executor({
            strategy:    stratDecision.strategy,
            componentId: routeDecision.componentId,
            budget,
            exec,
        });
    } else {
        execResult = { success: true, result: null };
    }

    // Release concurrency slot
    co.releaseSlot(exec.type);

    return {
        run:         true,
        execId:      exec.execId,
        workflowId,
        strategy:    stratDecision.strategy,
        componentId: routeDecision.componentId ?? null,
        budget:      { maxRetries: budget.maxRetries, timeoutMs: budget.timeoutMs },
        execResult,
    };
}

// ── handleFailure ─────────────────────────────────────────────────────

function handleFailure(workflowId, error = {}) {
    const exec = el.listExecutions().find(
        e => e.workflowId === workflowId && !["completed", "failed"].includes(e.state)
    );
    if (!exec) return { handled: false, reason: "no_active_execution" };

    const errorType    = error.type    ?? "execution_failure";
    const groupId      = error.groupId ?? `group-${exec.type}`;

    // 1. Report failure to containment
    const containCheck = fc.reportFailure(workflowId, groupId);

    el.addTraceEvent(exec.execId, {
        event:     "failure_reported",
        errorType,
        groupId,
        containmentTriggered: containCheck.containmentTriggered,
    });

    if (containCheck.containmentTriggered) {
        rsm.registerContainment(groupId, {
            memberCount:  containCheck.telemetryBasis?.memberCount ?? 1,
            failureRate:  containCheck.failureRate,
            status:       "contained",
        });
        eb.emit("containment_triggered", { groupId, workflowId, failureRate: containCheck.failureRate });
    }

    // 2. Determine recovery path
    const canRetry = exec.retryCount < (error.maxRetries ?? 2);
    if (canRetry) {
        // Stabilize → recovered → retry
        el.transition(exec.execId, "stabilized", { error: errorType });
        el.transition(exec.execId, "recovered");
        rsm.updateWorkflowState(workflowId, "recovered");
        eb.emit("workflow_recovered", { workflowId, execId: exec.execId, retryCount: exec.retryCount });
        el.addTraceEvent(exec.execId, { event: "retry_scheduled", retryCount: exec.retryCount });
        return {
            handled:      true,
            action:       "retry",
            execId:       exec.execId,
            workflowId,
            containmentTriggered: containCheck.containmentTriggered,
            retryCount:   exec.retryCount,
        };
    }

    // 3. Build recovery tree for persistent failures
    const tree = rc.buildRecoveryTree({ type: errorType, incidentId: workflowId });
    rsm.registerRecoveryTree(tree.treeId, {
        incidentType: errorType,
        stepCount:    tree.stepCount,
        status:       "in_progress",
    });
    eb.emit("recovery_started", { workflowId, treeId: tree.treeId, incidentType: errorType });

    el.transition(exec.execId, "failed", { reason: "max_retries_exceeded", treeId: tree.treeId });
    rsm.updateWorkflowState(workflowId, "failed");
    eb.emit("workflow_failed", { workflowId, execId: exec.execId, errorType });

    el.addTraceEvent(exec.execId, { event: "recovery_tree_built", treeId: tree.treeId });

    // Persist history entry
    rp.appendExecutionHistory({ ...exec });

    return {
        handled:      true,
        action:       "recovery_tree",
        execId:       exec.execId,
        workflowId,
        treeId:       tree.treeId,
        containmentTriggered: containCheck.containmentTriggered,
    };
}

// ── completeWorkflow ──────────────────────────────────────────────────

function completeWorkflow(workflowId, result = {}) {
    const exec = el.listExecutions().find(
        e => e.workflowId === workflowId && !["completed", "failed"].includes(e.state)
    );
    if (!exec) return { completed: false, reason: "no_active_execution" };

    el.transition(exec.execId, "completed", { result });
    rsm.updateWorkflowState(workflowId, "completed");
    rsm.unregisterWorkflow(workflowId);
    eb.emit("workflow_completed", { workflowId, execId: exec.execId });

    rp.appendExecutionHistory({ ...exec, state: "completed" });

    return {
        completed:  true,
        execId:     exec.execId,
        workflowId,
        retryCount: exec.retryCount,
        reroutes:   exec.reroutes,
    };
}

// ── processArbitrationQueue ───────────────────────────────────────────

function processArbitrationQueue(resources = {}) {
    const snapshot = rsm.getConsoleSnapshot();
    const queued   = el.listExecutions({ state: "queued" });

    if (queued.length === 0) return { processed: 0, admitted: 0, deferred: 0 };

    const maxConcurrent = resources.maxConcurrent ?? co.getOptimalConcurrency("generic").concurrency;
    const active        = snapshot.activeWorkflows;
    const slots         = Math.max(0, maxConcurrent - active);

    if (slots === 0) return { processed: queued.length, admitted: 0, deferred: queued.length };

    // Arbitrate using router
    const workflows = queued.map(e => ({
        id: e.workflowId, workflowId: e.workflowId,
        riskLevel: e.riskLevel, latencyClass: e.latencyClass, priorityTier: 2,
    }));
    const arb = wr.arbitrate(workflows, { maxConcurrent: slots });

    let admitted = 0;
    for (const w of arb.queue.filter(q => q.status === "admitted")) {
        const result = admitWorkflow(w.workflowId);
        if (result.admitted) admitted++;
    }

    eb.emit("arbitration_run", { admitted, deferred: arb.deferred, total: queued.length });

    return { processed: queued.length, admitted, deferred: queued.length - admitted };
}

// ── takeCheckpoint ────────────────────────────────────────────────────

function takeCheckpoint() {
    const snapshot = rsm.getConsoleSnapshot();
    const ckpt = rp.checkpoint(snapshot);
    return { checkpointId: ckpt.checkpointId, ts: ckpt.ts, mode: snapshot.mode };
}

// ── getOrchestratorStats ──────────────────────────────────────────────

function getOrchestratorStats() {
    const lifecycle = el.getLifecycleStats();
    const state     = rsm.getRuntimeStats();
    const persist   = rp.getPersistenceStats();
    return { lifecycle, state, persistence: persist };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    ss.reset();
    wr.reset();
    co.reset();
    fc.reset();
    rc.reset();
    el.reset();
    eb.reset();
    rsm.reset();
    rp.reset();
}

module.exports = {
    COMPONENT_AFFINITY,
    submitWorkflow, admitWorkflow, runWorkflow,
    handleFailure, completeWorkflow, processArbitrationQueue,
    takeCheckpoint, getOrchestratorStats, reset,
};
