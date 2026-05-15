"use strict";
/**
 * workflowStateTracker — tracks state across all executions belonging to a
 * workflow. Aggregates execution outcomes, computes workflow-level health,
 * and supports lineage-aware event mapping.
 *
 * trackWorkflow(spec)              → { tracked, workflowId }
 * recordExecutionOutcome(spec)     → { recorded, workflowId, executionId }
 * getWorkflowState(workflowId)     → WorkflowState | null
 * getWorkflowLineage(workflowId)   → ExecutionRef[]
 * completeWorkflow(spec)           → { completed, workflowId, finalState }
 * getActiveWorkflows()             → WorkflowState[]
 * getWorkflowMetrics()             → WorkflowMetrics
 * reset()
 */

const WORKFLOW_STATES     = ["active", "completed", "failed", "quarantined", "cancelled"];
const EXECUTION_OUTCOMES  = new Set([
    "completed", "failed", "quarantined", "cancelled", "replayed", "retried", "recovered",
]);

let _workflows = new Map();   // workflowId → WorkflowState
let _counter   = 0;

// ── trackWorkflow ──────────────────────────────────────────────────────

function trackWorkflow(spec = {}) {
    const {
        workflowId     = null,
        sourceSubsystem = null,
        authorityLevel  = null,
        correlationId   = null,
        startedAt       = new Date().toISOString(),
        meta            = null,
    } = spec;

    if (!workflowId)      return { tracked: false, reason: "workflowId_required" };
    if (!sourceSubsystem) return { tracked: false, reason: "sourceSubsystem_required" };
    if (_workflows.has(workflowId))
        return { tracked: false, reason: "workflow_already_tracked", workflowId };

    _counter++;
    _workflows.set(workflowId, {
        workflowId, sourceSubsystem, authorityLevel: authorityLevel ?? null,
        correlationId: correlationId ?? null,
        state:        "active",
        executions:   [],
        startedAt,
        completedAt:  null,
        finalState:   null,
        meta:         meta ?? null,
        stats: {
            totalExecutions: 0, completedCount: 0, failedCount: 0,
            quarantinedCount: 0, retriedCount: 0, recoveredCount: 0, replayedCount: 0,
        },
    });

    return { tracked: true, workflowId };
}

// ── recordExecutionOutcome ─────────────────────────────────────────────

function recordExecutionOutcome(spec = {}) {
    const {
        workflowId   = null,
        executionId  = null,
        outcome      = null,
        adapterType  = null,
        durationMs   = null,
        riskScore    = null,
        timestamp    = new Date().toISOString(),
    } = spec;

    if (!workflowId)  return { recorded: false, reason: "workflowId_required" };
    if (!executionId) return { recorded: false, reason: "executionId_required" };
    if (!outcome)     return { recorded: false, reason: "outcome_required" };
    if (!EXECUTION_OUTCOMES.has(outcome))
        return { recorded: false, reason: `invalid_outcome: ${outcome}` };

    let wf = _workflows.get(workflowId);
    if (!wf) {
        // Auto-create workflow record if not explicitly tracked
        trackWorkflow({ workflowId, sourceSubsystem: "auto" });
        wf = _workflows.get(workflowId);
    }

    wf.executions.push(Object.freeze({
        executionId, outcome, adapterType: adapterType ?? null,
        durationMs: durationMs ?? null, riskScore: riskScore ?? null, timestamp,
    }));

    wf.stats.totalExecutions++;
    if (outcome === "completed")   wf.stats.completedCount++;
    if (outcome === "failed")      wf.stats.failedCount++;
    if (outcome === "quarantined") wf.stats.quarantinedCount++;
    if (outcome === "retried")     wf.stats.retriedCount++;
    if (outcome === "recovered")   wf.stats.recoveredCount++;
    if (outcome === "replayed")    wf.stats.replayedCount++;

    return { recorded: true, workflowId, executionId, outcome };
}

// ── getWorkflowState ───────────────────────────────────────────────────

function getWorkflowState(workflowId) {
    if (!workflowId) return null;
    return _workflows.get(workflowId) ?? null;
}

// ── getWorkflowLineage ─────────────────────────────────────────────────

function getWorkflowLineage(workflowId) {
    const wf = _workflows.get(workflowId);
    if (!wf) return [];
    return [...wf.executions];
}

// ── completeWorkflow ───────────────────────────────────────────────────

function completeWorkflow(spec = {}) {
    const {
        workflowId  = null,
        finalState  = "completed",
        completedAt = new Date().toISOString(),
    } = spec;

    if (!workflowId) return { completed: false, reason: "workflowId_required" };
    if (!WORKFLOW_STATES.includes(finalState))
        return { completed: false, reason: `invalid_final_state: ${finalState}` };

    const wf = _workflows.get(workflowId);
    if (!wf) return { completed: false, reason: "workflow_not_found", workflowId };
    if (wf.state !== "active")
        return { completed: false, reason: `workflow_not_active: ${wf.state}`, workflowId };

    wf.state       = finalState;
    wf.completedAt = completedAt;
    wf.finalState  = finalState;

    return { completed: true, workflowId, finalState };
}

// ── getActiveWorkflows ─────────────────────────────────────────────────

function getActiveWorkflows() {
    return [..._workflows.values()].filter(wf => wf.state === "active");
}

// ── getWorkflowMetrics ─────────────────────────────────────────────────

function getWorkflowMetrics() {
    const all       = [..._workflows.values()];
    const byState   = {};
    for (const s of WORKFLOW_STATES) byState[s] = 0;
    for (const wf of all) byState[wf.state] = (byState[wf.state] ?? 0) + 1;

    const durations = all
        .filter(wf => wf.startedAt && wf.completedAt)
        .map(wf => new Date(wf.completedAt) - new Date(wf.startedAt));

    const avgCompletionMs = durations.length
        ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
        : 0;

    const totalExecutions = all.reduce((s, wf) => s + wf.stats.totalExecutions, 0);
    const totalRetried    = all.reduce((s, wf) => s + wf.stats.retriedCount, 0);
    const totalRecovered  = all.reduce((s, wf) => s + wf.stats.recoveredCount, 0);

    return {
        totalWorkflows:   all.length,
        activeCount:      byState.active,
        completedCount:   byState.completed,
        failedCount:      byState.failed,
        quarantinedCount: byState.quarantined,
        avgCompletionMs,
        totalExecutions,
        totalRetried,
        totalRecovered,
        byState,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _workflows = new Map();
    _counter   = 0;
}

module.exports = {
    WORKFLOW_STATES, EXECUTION_OUTCOMES,
    trackWorkflow, recordExecutionOutcome, getWorkflowState,
    getWorkflowLineage, completeWorkflow, getActiveWorkflows,
    getWorkflowMetrics, reset,
};
