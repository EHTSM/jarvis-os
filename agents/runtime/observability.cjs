"use strict";
/**
 * observability — runtime event collection for workflow execution.
 *
 * Captures a time-ordered event log and provides derived views:
 *   timelineFor(workflowId)   — all events for one workflow, in order
 *   recoveryHeatmap()         — step name → total recovery attempts
 *   retryAnalytics()          — step name → {attempts, successes, failures}
 *   failureFrequency()        — failure type → occurrence count
 *   strategyDashboard()       — strategy id → {attempts, successes, successRate, avgDurationMs}
 *
 * Thread-safety: Node.js is single-threaded so no locking needed.
 * The event log is module-level (process-singleton). Call reset() between tests.
 */

// ── Storage ───────────────────────────────────────────────────────────

const _events = [];
let   _seq    = 0;

// ── Core emitter ──────────────────────────────────────────────────────

function emit(type, data = {}) {
    _events.push({ seq: ++_seq, timestamp: Date.now(), type, ...data });
}

// ── Named emitters (used by autonomousWorkflow) ───────────────────────

function workflowStart(workflowId, workflowName, traceId) {
    emit("workflow_start", { workflowId, workflowName, traceId: traceId || null });
}

function workflowEnd(workflowId, workflowName, success, durationMs, traceId) {
    emit("workflow_end", { workflowId, workflowName, success, durationMs, traceId: traceId || null });
}

function stepAttempt(workflowId, stepName, attempt, success) {
    emit("step_attempt", { workflowId, stepName, attempt, success });
}

function stepFailed(workflowId, stepName, failureType, attempt) {
    emit("step_failed", { workflowId, stepName, failureType: failureType || "unknown", attempt });
}

function recoveryAttempt(workflowId, stepName, strategyId, attempt) {
    emit("recovery_attempt", { workflowId, stepName, strategyId: strategyId || null, attempt });
}

function recoveryResult(workflowId, stepName, strategyId, success, durationMs) {
    emit("recovery_result", { workflowId, stepName, strategyId: strategyId || null, success, durationMs: durationMs || 0 });
}

// ── Derived views ─────────────────────────────────────────────────────

/** All events for a specific workflow, sorted by sequence number. */
function timelineFor(workflowId) {
    return _events
        .filter(e => e.workflowId === workflowId)
        .sort((a, b) => a.seq - b.seq);
}

/**
 * Recovery heatmap: step name → number of recovery attempts.
 * Steps with many recovery attempts are the "hot spots" in the workflow.
 */
function recoveryHeatmap() {
    const map = {};
    for (const e of _events) {
        if (e.type !== "recovery_attempt") continue;
        const k = e.stepName || "unknown";
        map[k]  = (map[k] || 0) + 1;
    }
    return map;
}

/**
 * Retry analytics: per-step attempt stats across all workflows.
 */
function retryAnalytics() {
    const steps = {};
    for (const e of _events) {
        if (e.type !== "step_attempt") continue;
        const k = e.stepName || "unknown";
        if (!steps[k]) steps[k] = { attempts: 0, successes: 0, failures: 0 };
        steps[k].attempts++;
        if (e.success) steps[k].successes++;
        else           steps[k].failures++;
    }
    for (const k of Object.keys(steps)) {
        const s = steps[k];
        s.successRate = s.attempts > 0 ? parseFloat((s.successes / s.attempts).toFixed(3)) : 0;
    }
    return steps;
}

/**
 * Failure frequency by type: failure_type → count.
 */
function failureFrequency() {
    const freq = {};
    for (const e of _events) {
        if (e.type !== "step_failed") continue;
        const t   = e.failureType || "unknown";
        freq[t] = (freq[t] || 0) + 1;
    }
    return freq;
}

/**
 * Strategy success dashboard.
 * Returns per-strategy performance aggregated across all recovery events.
 */
function strategyDashboard() {
    const strategies = {};
    for (const e of _events) {
        if (e.type !== "recovery_result") continue;
        const id = e.strategyId || "unknown";
        if (!strategies[id]) {
            strategies[id] = { attempts: 0, successes: 0, failures: 0, totalMs: 0 };
        }
        strategies[id].attempts++;
        if (e.success) strategies[id].successes++;
        else           strategies[id].failures++;
        strategies[id].totalMs += e.durationMs || 0;
    }
    for (const id of Object.keys(strategies)) {
        const s = strategies[id];
        s.successRate   = s.attempts > 0 ? parseFloat((s.successes / s.attempts).toFixed(3)) : 0;
        s.avgDurationMs = s.attempts > 0 ? Math.round(s.totalMs / s.attempts) : 0;
    }
    return strategies;
}

// ── Housekeeping ──────────────────────────────────────────────────────

function reset()    { _events.length = 0; _seq = 0; }
function snapshot() { return [..._events]; }
function count()    { return _events.length; }

module.exports = {
    emit,
    workflowStart,
    workflowEnd,
    stepAttempt,
    stepFailed,
    recoveryAttempt,
    recoveryResult,
    timelineFor,
    recoveryHeatmap,
    retryAnalytics,
    failureFrequency,
    strategyDashboard,
    reset,
    snapshot,
    count,
};
