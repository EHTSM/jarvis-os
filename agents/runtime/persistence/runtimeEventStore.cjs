"use strict";
/**
 * runtimeEventStore — append-only runtime event persistence with deterministic
 * ordering, workflow event streams, execution audit history, and replay-safe design.
 *
 * appendEvent(event)                → { appended, eventId, deterministicSequence }
 * getEventStream(opts)              → EventEntry[]
 * getEventsByWorkflow(workflowId)   → EventEntry[]
 * getEventsByType(eventType)        → EventEntry[]
 * reconstructState(workflowId)      → ReconstructedState
 * compactEventStream(workflowId)    → { compacted, retainedCount, removedCount }
 * getStoreMetrics()                 → StoreMetrics
 * reset()
 */

const VALID_EVENT_TYPES = [
    "workflow_created",
    "workflow_scheduled",
    "workflow_started",
    "workflow_completed",
    "workflow_failed",
    "retry_triggered",
    "rollback_triggered",
    "recovery_started",
    "recovery_completed",
    "dependency_blocked",
    "dependency_resolved",
    "quarantine_triggered",
    "scheduler_decision",
    "replay_started",
    "replay_completed",
];

const STATE_TRANSITIONS = {
    workflow_created:     "created",
    workflow_scheduled:   "scheduled",
    workflow_started:     "running",
    workflow_completed:   "completed",
    workflow_failed:      "failed",
    recovery_started:     "recovering",
    recovery_completed:   "stabilized",
    quarantine_triggered: "quarantined",
};

let _events             = [];
let _counter            = 0;
let _compactedWorkflows = new Set();

// ── appendEvent ───────────────────────────────────────────────────────

function appendEvent(event = {}) {
    const {
        workflowId      = null,
        executionId     = null,
        eventType       = null,
        eventPayload    = {},
        replaySafe      = true,
        isolationDomain = null,
    } = event;

    if (!eventType) return { appended: false, reason: "eventType_required" };
    if (!VALID_EVENT_TYPES.includes(eventType))
        return { appended: false, reason: `invalid_event_type: ${eventType}` };

    const seq   = ++_counter;
    const entry = {
        eventId:               `evs-${seq}`,
        workflowId,
        executionId,
        eventType,
        eventPayload:          { ...eventPayload },
        deterministicSequence: seq,
        timestamp:             new Date().toISOString(),
        replaySafe,
        isolationDomain,
    };
    _events.push(entry);
    return { appended: true, eventId: entry.eventId, deterministicSequence: seq };
}

// ── getEventStream ────────────────────────────────────────────────────

function getEventStream(opts = {}) {
    let result = [..._events];
    if (opts.fromSequence != null)
        result = result.filter(e => e.deterministicSequence >= opts.fromSequence);
    if (opts.toSequence != null)
        result = result.filter(e => e.deterministicSequence <= opts.toSequence);
    if (opts.replaySafeOnly)
        result = result.filter(e => e.replaySafe);
    return result;
}

// ── getEventsByWorkflow ───────────────────────────────────────────────

function getEventsByWorkflow(workflowId) {
    return _events.filter(e => e.workflowId === workflowId);
}

// ── getEventsByType ───────────────────────────────────────────────────

function getEventsByType(eventType) {
    return _events.filter(e => e.eventType === eventType);
}

// ── reconstructState ──────────────────────────────────────────────────

function reconstructState(workflowId) {
    const events = getEventsByWorkflow(workflowId);
    if (events.length === 0) return { found: false, workflowId };

    let state     = null;
    let retries   = 0;
    let rollbacks = 0;
    let recoveries = 0;

    for (const e of events) {
        if (STATE_TRANSITIONS[e.eventType]) state = STATE_TRANSITIONS[e.eventType];
        if (e.eventType === "retry_triggered")    retries++;
        if (e.eventType === "rollback_triggered") rollbacks++;
        if (e.eventType === "recovery_started")   recoveries++;
    }

    return {
        found:      true,
        workflowId,
        state,
        eventCount: events.length,
        retries,
        rollbacks,
        recoveries,
        lastEvent:  events[events.length - 1],
    };
}

// ── compactEventStream ────────────────────────────────────────────────

function compactEventStream(workflowId) {
    const wfEvents = _events.filter(e => e.workflowId === workflowId);
    if (wfEvents.length === 0) return { compacted: false, reason: "no_events_found" };

    const TERMINAL = new Set(["workflow_completed", "workflow_failed", "quarantine_triggered"]);
    const latestTerminal = [...wfEvents].reverse().find(e => TERMINAL.has(e.eventType));

    const before = _events.length;
    if (latestTerminal) {
        const termSeq = latestTerminal.deterministicSequence;
        _events = _events.filter(e =>
            e.workflowId !== workflowId || e.deterministicSequence >= termSeq
        );
    }

    _compactedWorkflows.add(workflowId);
    const removed = before - _events.length;
    return { compacted: true, workflowId, retainedCount: _events.length, removedCount: removed };
}

// ── getStoreMetrics ───────────────────────────────────────────────────

function getStoreMetrics() {
    const byType = {};
    for (const t of VALID_EVENT_TYPES) byType[t] = 0;
    for (const e of _events) byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;

    return {
        totalEvents:        _events.length,
        uniqueWorkflows:    new Set(_events.map(e => e.workflowId).filter(Boolean)).size,
        compactedWorkflows: _compactedWorkflows.size,
        replaySafeEvents:   _events.filter(e => e.replaySafe).length,
        byType,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _events             = [];
    _counter            = 0;
    _compactedWorkflows = new Set();
}

module.exports = {
    VALID_EVENT_TYPES,
    appendEvent, getEventStream, getEventsByWorkflow, getEventsByType,
    reconstructState, compactEventStream, getStoreMetrics, reset,
};
