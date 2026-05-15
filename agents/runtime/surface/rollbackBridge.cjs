"use strict";
/**
 * rollbackBridge — execution rollback support and deterministic replay.
 *
 * Rollback types: filesystem | git | checkpoint | abort | cancel
 * Replay: reconstruct execution path from stored trace events.
 *
 * registerRollbackPoint(execId, type, state)   → RollbackPoint
 * rollback(execId, type, opts)                 → RollbackResult
 * abort(execId, reason)                        → AbortResult
 * cancel(workflowId, reason)                   → CancelResult
 * buildReplayTrace(execId, events)             → ReplayTrace
 * replayStep(traceId, stepIndex)               → StepResult
 * getReplayTrace(traceId)                      → ReplayTrace | null
 * getRollbackStats()                           → Stats
 * reset()
 */

const ROLLBACK_TYPES   = ["filesystem", "git", "checkpoint", "abort", "cancel"];
const STEP_TYPES       = ["route", "admit", "execute", "retry", "rollback", "stabilize", "verify", "complete", "fail"];

let _rollbackPoints = new Map();  // execId → [{ type, state, ts }]
let _replayTraces   = new Map();  // traceId → ReplayTrace
let _aborted        = new Set();  // aborted execIds
let _cancelled      = new Set();  // cancelled workflowIds
let _counter        = 0;

// ── registerRollbackPoint ─────────────────────────────────────────────

function registerRollbackPoint(execId, type, state = {}) {
    if (!ROLLBACK_TYPES.includes(type)) {
        return { registered: false, reason: `invalid_rollback_type: ${type}` };
    }
    if (!_rollbackPoints.has(execId)) _rollbackPoints.set(execId, []);
    const points = _rollbackPoints.get(execId);
    const point  = {
        pointId: `rp-${++_counter}`,
        execId,
        type,
        state:   { ...state },
        ts:      new Date().toISOString(),
    };
    points.push(point);
    return { registered: true, pointId: point.pointId, execId, type };
}

// ── rollback ──────────────────────────────────────────────────────────

function rollback(execId, type, opts = {}) {
    const points = _rollbackPoints.get(execId);
    if (!points || points.length === 0) {
        return { rolledBack: false, reason: "no_rollback_points", execId };
    }

    // Find latest rollback point of this type (or any type if type not specified)
    const matching = type
        ? points.filter(p => p.type === type)
        : points;

    if (matching.length === 0) {
        return { rolledBack: false, reason: `no_rollback_point_of_type_${type}`, execId };
    }

    const target = matching[matching.length - 1];   // most recent

    // Simulate rollback action
    let actions = [];
    switch (target.type) {
        case "filesystem":
            actions = ["restore_file_contents", "reset_permissions", "remove_created_files"];
            break;
        case "git":
            actions = ["git_revert_commit", "restore_working_tree", "reset_index"];
            break;
        case "checkpoint":
            actions = ["restore_runtime_state", "reset_concurrency_slots", "clear_active_containments"];
            break;
        case "abort":
            actions = ["signal_abort", "drain_queue", "release_budget_slots"];
            break;
        case "cancel":
            actions = ["remove_from_queue", "release_reservations", "notify_dependents"];
            break;
    }

    return {
        rolledBack:   true,
        execId,
        pointId:      target.pointId,
        type:         target.type,
        restoredState: target.state,
        actions,
        reasoning:    `Rolled back to ${target.type} checkpoint at ${target.ts}`,
        ts:           new Date().toISOString(),
    };
}

// ── abort ─────────────────────────────────────────────────────────────

function abort(execId, reason = "manual_abort") {
    if (_aborted.has(execId)) {
        return { aborted: false, reason: "already_aborted", execId };
    }
    _aborted.add(execId);
    // Auto-register an abort rollback point
    registerRollbackPoint(execId, "abort", { reason });

    return {
        aborted:     true,
        execId,
        reason,
        actions:     ["signal_abort", "drain_queue", "release_budget_slots"],
        ts:          new Date().toISOString(),
    };
}

// ── cancel ────────────────────────────────────────────────────────────

function cancel(workflowId, reason = "manual_cancel") {
    if (_cancelled.has(workflowId)) {
        return { cancelled: false, reason: "already_cancelled", workflowId };
    }
    _cancelled.add(workflowId);

    return {
        cancelled:   true,
        workflowId,
        reason,
        actions:     ["remove_from_queue", "release_reservations", "notify_dependents"],
        ts:          new Date().toISOString(),
    };
}

// ── buildReplayTrace ──────────────────────────────────────────────────

function buildReplayTrace(execId, events = []) {
    const traceId = `replay-${++_counter}`;

    // Sort events by seqNum, then ts for determinism
    const sorted = [...events].sort((a, b) => {
        const sd = (a.seqNum ?? 0) - (b.seqNum ?? 0);
        return sd !== 0 ? sd : ((a.ts ?? "") < (b.ts ?? "") ? -1 : 1);
    });

    // Build replay steps: map events to typed steps
    const steps = sorted.map((evt, idx) => ({
        stepIndex:   idx,
        stepType:    _inferStepType(evt),
        event:       evt.event ?? evt.type ?? "unknown",
        payload:     evt.payload ?? evt,
        state:       evt.state   ?? null,
        strategy:    evt.strategy ?? null,
        componentId: evt.componentId ?? null,
        retryCount:  evt.retryCount  ?? null,
        rollback:    evt.rollback     ?? false,
        ts:          evt.ts ?? null,
    }));

    const trace = {
        traceId,
        execId,
        steps,
        totalSteps:  steps.length,
        cursor:      0,
        status:      "ready",   // ready | replaying | completed
        createdAt:   new Date().toISOString(),
        // Summary statistics
        routeSteps:      steps.filter(s => s.stepType === "route").length,
        retrySteps:      steps.filter(s => s.stepType === "retry").length,
        rollbackSteps:   steps.filter(s => s.stepType === "rollback").length,
        stabilizeSteps:  steps.filter(s => s.stepType === "stabilize").length,
    };

    _replayTraces.set(traceId, trace);
    return {
        traceId,
        execId,
        totalSteps:     trace.totalSteps,
        routeSteps:     trace.routeSteps,
        retrySteps:     trace.retrySteps,
        rollbackSteps:  trace.rollbackSteps,
        stabilizeSteps: trace.stabilizeSteps,
        status:         "ready",
    };
}

function _inferStepType(evt) {
    const e = (evt.event ?? evt.type ?? "").toLowerCase();
    if (e.includes("route") || e.includes("routed"))       return "route";
    if (e.includes("admit") || e.includes("admitted"))     return "admit";
    if (e.includes("retry") || e.includes("recover"))      return "retry";
    if (e.includes("rollback") || e.includes("revert"))    return "rollback";
    if (e.includes("stab") || e.includes("throttle"))      return "stabilize";
    if (e.includes("verif"))                                return "verify";
    if (e.includes("complet") || e.includes("success"))    return "complete";
    if (e.includes("fail") || e.includes("error"))         return "fail";
    return "execute";
}

// ── replayStep ────────────────────────────────────────────────────────

function replayStep(traceId, stepIndex = null) {
    const trace = _replayTraces.get(traceId);
    if (!trace)                          return { replayed: false, reason: "trace_not_found" };
    if (trace.status === "completed")    return { replayed: false, reason: "no_more_steps", completed: true };

    const idx  = stepIndex ?? trace.cursor;
    const step = trace.steps[idx];
    if (!step) {
        trace.status = "completed";
        return { replayed: false, reason: "no_more_steps", completed: true };
    }

    trace.cursor = idx + 1;
    trace.status = trace.cursor >= trace.totalSteps ? "completed" : "replaying";

    return {
        replayed:    true,
        traceId,
        stepIndex:   idx,
        step,
        cursor:      trace.cursor,
        remaining:   trace.totalSteps - trace.cursor,
        completed:   trace.status === "completed",
    };
}

// ── getReplayTrace ────────────────────────────────────────────────────

function getReplayTrace(traceId) {
    return _replayTraces.get(traceId) ?? null;
}

// ── getRollbackStats ──────────────────────────────────────────────────

function getRollbackStats() {
    const allPoints  = [..._rollbackPoints.values()].flat();
    const byType     = {};
    for (const p of allPoints) byType[p.type] = (byType[p.type] ?? 0) + 1;
    return {
        totalRollbackPoints: allPoints.length,
        byType,
        abortedExecutions:   _aborted.size,
        cancelledWorkflows:  _cancelled.size,
        replayTraces:        _replayTraces.size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _rollbackPoints = new Map();
    _replayTraces   = new Map();
    _aborted        = new Set();
    _cancelled      = new Set();
    _counter        = 0;
}

module.exports = {
    ROLLBACK_TYPES, STEP_TYPES,
    registerRollbackPoint, rollback, abort, cancel,
    buildReplayTrace, replayStep, getReplayTrace,
    getRollbackStats, reset,
};
