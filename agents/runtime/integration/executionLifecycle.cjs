"use strict";
/**
 * executionLifecycle — workflow execution lifecycle management with trace recording.
 *
 * States: queued → admitted → running → stabilized → completed | failed
 *                                     → stabilized → recovered → running | failed
 *
 * createExecution(opts)               → Execution
 * transition(execId, newState, meta)  → TransitionResult
 * addTraceEvent(execId, event)        → void
 * getExecution(execId)                → Execution | null
 * getExecutionTrace(execId)           → TraceEvent[]
 * listExecutions(filter)              → Execution[]
 * getLifecycleStats()                 → Stats
 * reset()
 */

const LIFECYCLE_STATES = ["queued", "admitted", "running", "stabilized", "completed", "recovered", "failed"];

const VALID_TRANSITIONS = {
    queued:      ["admitted", "failed"],
    admitted:    ["running", "failed"],
    running:     ["stabilized", "completed", "failed"],
    stabilized:  ["running", "completed", "recovered", "failed"],
    completed:   [],
    recovered:   ["running", "failed"],
    failed:      [],
};

const TERMINAL_STATES = new Set(["completed", "failed"]);

let _executions = new Map();   // execId → Execution
let _counter    = 0;

// ── createExecution ───────────────────────────────────────────────────

function createExecution(opts = {}) {
    const execId = opts.execId ?? `exec-${++_counter}`;
    const exec = {
        execId,
        workflowId:    opts.workflowId   ?? execId,
        type:          opts.type         ?? "generic",
        strategy:      opts.strategy     ?? null,
        componentId:   opts.componentId  ?? null,
        riskLevel:     opts.riskLevel    ?? "low",
        latencyClass:  opts.latencyClass ?? "standard",
        state:         "queued",
        previousState: null,
        createdAt:     new Date().toISOString(),
        admittedAt:    null,
        startedAt:     null,
        completedAt:   null,
        trace:         [],
        retryCount:    0,
        reroutes:      0,
        containmentEvents: 0,
        recoveryEvents:    0,
        metadata:      { ...opts.metadata },
    };
    _executions.set(execId, exec);
    exec.trace.push({ event: "created", state: "queued", ts: exec.createdAt });
    return exec;
}

// ── transition ────────────────────────────────────────────────────────

function transition(execId, newState, meta = {}) {
    const exec = _executions.get(execId);
    if (!exec)                                return { transitioned: false, reason: "execution_not_found" };
    if (!LIFECYCLE_STATES.includes(newState)) return { transitioned: false, reason: "invalid_state" };
    if (TERMINAL_STATES.has(exec.state))      return { transitioned: false, reason: "terminal_state", currentState: exec.state };

    const allowed = VALID_TRANSITIONS[exec.state] ?? [];
    if (!allowed.includes(newState)) {
        return {
            transitioned:  false,
            reason:        "invalid_transition",
            from:          exec.state,
            to:            newState,
            allowedStates: allowed,
        };
    }

    const prevState    = exec.state;
    exec.previousState = prevState;
    exec.state         = newState;

    // Timestamp bookmarks
    const ts = new Date().toISOString();
    if (newState === "admitted")   exec.admittedAt  = ts;
    if (newState === "running")    exec.startedAt   = exec.startedAt ?? ts;
    if (newState === "completed" || newState === "failed") exec.completedAt = ts;

    // Strategy/component from meta
    if (meta.strategy)    exec.strategy    = meta.strategy;
    if (meta.componentId) exec.componentId = meta.componentId;

    // Counters
    if (newState === "running"   && prevState === "recovered") exec.retryCount++;
    if (meta.rerouted)    exec.reroutes++;
    if (meta.contained)   exec.containmentEvents++;
    if (newState === "recovered") exec.recoveryEvents++;

    const traceEntry = { event: `transition:${prevState}→${newState}`, state: newState, ts, ...meta };
    exec.trace.push(traceEntry);

    return {
        transitioned: true,
        execId,
        from:         prevState,
        to:           newState,
        ts,
    };
}

// ── addTraceEvent ─────────────────────────────────────────────────────

function addTraceEvent(execId, event = {}) {
    const exec = _executions.get(execId);
    if (!exec) return { added: false, reason: "execution_not_found" };
    exec.trace.push({ ...event, ts: event.ts ?? new Date().toISOString() });
    return { added: true, execId, traceLength: exec.trace.length };
}

// ── getExecution ──────────────────────────────────────────────────────

function getExecution(execId) {
    return _executions.get(execId) ?? null;
}

// ── getExecutionTrace ─────────────────────────────────────────────────

function getExecutionTrace(execId) {
    return _executions.get(execId)?.trace ?? [];
}

// ── listExecutions ────────────────────────────────────────────────────

function listExecutions(filter = {}) {
    let results = [..._executions.values()];
    if (filter.state)   results = results.filter(e => e.state === filter.state);
    if (filter.type)    results = results.filter(e => e.type  === filter.type);
    if (filter.active)  results = results.filter(e => !TERMINAL_STATES.has(e.state));
    return results;
}

// ── getLifecycleStats ─────────────────────────────────────────────────

function getLifecycleStats() {
    const all   = [..._executions.values()];
    const byState = {};
    for (const e of all) byState[e.state] = (byState[e.state] ?? 0) + 1;
    const completed = all.filter(e => e.state === "completed").length;
    const failed    = all.filter(e => e.state === "failed").length;
    const total     = all.length;
    return {
        total,
        byState,
        successRate: total > 0 ? +((completed / total)).toFixed(3) : 0,
        failureRate: total > 0 ? +(failed / total).toFixed(3) : 0,
        active:      all.filter(e => !TERMINAL_STATES.has(e.state)).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions = new Map();
    _counter    = 0;
}

module.exports = {
    LIFECYCLE_STATES, VALID_TRANSITIONS, TERMINAL_STATES,
    createExecution, transition, addTraceEvent,
    getExecution, getExecutionTrace, listExecutions,
    getLifecycleStats, reset,
};
