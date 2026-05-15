"use strict";
/**
 * stateReconstructionEngine — rebuild runtime state from event streams,
 * deterministic state replay, execution timeline reconstruction,
 * workflow dependency restoration, and scheduler reconstruction.
 *
 * reconstructRuntimeState(events)          → RuntimeState
 * rebuildWorkflowState(workflowId, events) → WorkflowState
 * rebuildSchedulerState(events)            → SchedulerState
 * reconstructExecutionTimeline(events)     → Timeline
 * validateReconstruction(result)           → { valid, issues }
 * reset()
 */

const STATE_MAP = {
    workflow_created:     "created",
    workflow_scheduled:   "scheduled",
    workflow_started:     "running",
    workflow_completed:   "completed",
    workflow_failed:      "failed",
    recovery_started:     "recovering",
    recovery_completed:   "stabilized",
    quarantine_triggered: "quarantined",
};

let _reconstructions = new Map();
let _counter         = 0;

// ── reconstructRuntimeState ───────────────────────────────────────────

function reconstructRuntimeState(events = []) {
    if (!Array.isArray(events)) return { valid: false, reason: "events_must_be_array" };

    const workflowStates     = {};
    const retries            = {};
    const rollbacks          = {};
    const schedulerDecisions = [];

    for (const e of events) {
        const wfId = e.workflowId;
        if (!wfId) continue;

        if (STATE_MAP[e.eventType]) workflowStates[wfId] = STATE_MAP[e.eventType];
        if (e.eventType === "retry_triggered")
            retries[wfId]   = (retries[wfId]   ?? 0) + 1;
        if (e.eventType === "rollback_triggered")
            rollbacks[wfId] = (rollbacks[wfId] ?? 0) + 1;
        if (e.eventType === "scheduler_decision")
            schedulerDecisions.push({ workflowId: wfId, seq: e.deterministicSequence ?? null });
    }

    const recId  = `rec-${++_counter}`;
    const result = {
        reconstructionId:    recId,
        workflowCount:       Object.keys(workflowStates).length,
        workflowStates,
        retries,
        rollbacks,
        schedulerDecisions,
        eventCount:          events.length,
    };
    _reconstructions.set(recId, result);
    return result;
}

// ── rebuildWorkflowState ──────────────────────────────────────────────

function rebuildWorkflowState(workflowId, events = []) {
    const wfEvents = events.filter(e => e.workflowId === workflowId);
    if (wfEvents.length === 0) return { found: false, workflowId };

    let state      = null;
    let retries    = 0;
    let rollbacks  = 0;
    let recoveries = 0;
    const blocked  = [];

    for (const e of wfEvents) {
        if (STATE_MAP[e.eventType])           state = STATE_MAP[e.eventType];
        if (e.eventType === "retry_triggered")    retries++;
        if (e.eventType === "rollback_triggered") rollbacks++;
        if (e.eventType === "recovery_started")   recoveries++;
        if (e.eventType === "dependency_blocked")
            blocked.push(e.eventPayload?.dependencyId ?? null);
    }

    return {
        found:      true,
        workflowId,
        state,
        eventCount: wfEvents.length,
        retries,
        rollbacks,
        recoveries,
        blocked,
    };
}

// ── rebuildSchedulerState ─────────────────────────────────────────────

function rebuildSchedulerState(events = []) {
    const decisions = events.filter(e => e.eventType === "scheduler_decision");
    const queue     = {};

    for (const e of decisions) {
        if (!e.workflowId) continue;
        queue[e.workflowId] = e.eventPayload ?? {};
    }

    return {
        totalDecisions:     decisions.length,
        scheduledWorkflows: Object.keys(queue).length,
        queue,
    };
}

// ── reconstructExecutionTimeline ──────────────────────────────────────

function reconstructExecutionTimeline(events = []) {
    const sorted = [...events].sort(
        (a, b) => (a.deterministicSequence ?? 0) - (b.deterministicSequence ?? 0)
    );

    const timeline = sorted.map((e, i) => ({
        index:      i + 1,
        eventId:    e.eventId,
        workflowId: e.workflowId,
        eventType:  e.eventType,
        sequence:   e.deterministicSequence,
        timestamp:  e.timestamp,
    }));

    const isOrdered = sorted.every((e, i) =>
        i === 0 || (e.deterministicSequence ?? 0) >= (sorted[i - 1].deterministicSequence ?? 0)
    );

    return { totalEvents: timeline.length, isOrdered, timeline };
}

// ── validateReconstruction ────────────────────────────────────────────

function validateReconstruction(result = {}) {
    const issues = [];
    if (result.workflowCount == null) issues.push("missing_workflowCount");
    if (!result.workflowStates)       issues.push("missing_workflowStates");
    if (result.eventCount    == null) issues.push("missing_eventCount");

    for (const [wfId, state] of Object.entries(result.workflowStates ?? {})) {
        if (!state) issues.push(`null_state_for_workflow: ${wfId}`);
    }

    return {
        valid:            issues.length === 0,
        reconstructionId: result.reconstructionId ?? null,
        issues,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _reconstructions = new Map();
    _counter         = 0;
}

module.exports = {
    STATE_MAP,
    reconstructRuntimeState, rebuildWorkflowState, rebuildSchedulerState,
    reconstructExecutionTimeline, validateReconstruction, reset,
};
