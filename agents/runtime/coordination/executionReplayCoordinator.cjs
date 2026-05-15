"use strict";
/**
 * executionReplayCoordinator — deterministic execution replay with path
 * recording, sequence validation, and consistency verification.
 *
 * recordExecutionPath(execId, event)          → { recorded, eventId, sequenceNumber }
 * replayExecution(execId, opts)               → { replayed, replayId, consistent, status }
 * validateReplayConsistency(execId, expected) → ConsistencyResult
 * reconstructExecutionTimeline(execId)        → TimelineRecord | { found: false }
 * getReplayState()                            → { trackedExecutions, totalReplays, replays }
 * reset()
 *
 * Replay tracking: node execution order, scheduling decisions, retries,
 * rollback events, isolation events, containment actions.
 */

let _paths   = new Map();
let _replays = new Map();
let _counter = 0;

// ── recordExecutionPath ───────────────────────────────────────────────

function recordExecutionPath(executionId, event = {}) {
    if (!_paths.has(executionId)) {
        _paths.set(executionId, {
            executionId,
            events:    [],
            startedAt: new Date().toISOString(),
        });
    }
    const path  = _paths.get(executionId);
    const entry = {
        eventId:            `evt-${++_counter}`,
        type:               event.type               ?? "step",
        nodeId:             event.nodeId             ?? null,
        schedulingDecision: event.schedulingDecision ?? null,
        retries:            event.retries            ?? 0,
        rollbackEvent:      event.rollbackEvent      ?? false,
        isolationEvent:     event.isolationEvent     ?? false,
        containmentAction:  event.containmentAction  ?? null,
        sequenceNumber:     path.events.length + 1,
        ts:                 new Date().toISOString(),
    };
    path.events.push(entry);
    return { recorded: true, eventId: entry.eventId, sequenceNumber: entry.sequenceNumber };
}

// ── replayExecution ───────────────────────────────────────────────────

function replayExecution(executionId, opts = {}) {
    const path = _paths.get(executionId);
    if (!path) return { replayed: false, reason: "execution_not_found" };

    const replayId    = `rpl-${++_counter}`;
    const consistency = validateReplayConsistency(executionId, opts.expectedEvents ?? null);

    _replays.set(replayId, {
        replayId,
        executionId,
        eventsReplayed: path.events.length,
        consistency,
        replayedAt:     new Date().toISOString(),
        status:         consistency.consistent ? "completed" : "inconsistent",
    });

    return {
        replayed:       true,
        replayId,
        executionId,
        eventsReplayed: path.events.length,
        consistent:     consistency.consistent,
        status:         consistency.consistent ? "completed" : "inconsistent",
    };
}

// ── validateReplayConsistency ─────────────────────────────────────────

function validateReplayConsistency(executionId, expectedEvents = null) {
    const path = _paths.get(executionId);
    if (!path) return { consistent: false, reason: "no_path_recorded" };

    const actual = path.events;

    if (expectedEvents == null) {
        return {
            consistent:    true,
            executionId,
            eventCount:    actual.length,
            sequenceValid: _sequenceValid(actual),
        };
    }

    if (expectedEvents.length !== actual.length) {
        return {
            consistent: false,
            reason:     "event_count_mismatch",
            expected:   expectedEvents.length,
            actual:     actual.length,
        };
    }

    const mismatches = [];
    for (let i = 0; i < expectedEvents.length; i++) {
        if (expectedEvents[i].type !== actual[i].type)
            mismatches.push({ index: i, expected: expectedEvents[i].type, actual: actual[i].type });
    }

    return {
        consistent:    mismatches.length === 0,
        executionId,
        eventCount:    actual.length,
        mismatches,
        sequenceValid: _sequenceValid(actual),
    };
}

function _sequenceValid(events) {
    for (let i = 0; i < events.length; i++) {
        if (events[i].sequenceNumber !== i + 1) return false;
    }
    return true;
}

// ── reconstructExecutionTimeline ──────────────────────────────────────

function reconstructExecutionTimeline(executionId) {
    const path = _paths.get(executionId);
    if (!path) return { found: false, executionId };

    const rollbacks = path.events.filter(e => e.rollbackEvent).length;
    const retries   = path.events.reduce((s, e) => s + (e.retries ?? 0), 0);

    return {
        found:       true,
        executionId,
        totalEvents: path.events.length,
        rollbacks,
        retries,
        startedAt:   path.startedAt,
        timeline:    path.events.map(e => ({
            sequenceNumber: e.sequenceNumber,
            type:           e.type,
            nodeId:         e.nodeId,
            rollbackEvent:  e.rollbackEvent,
            isolationEvent: e.isolationEvent,
            ts:             e.ts,
        })),
    };
}

// ── getReplayState ────────────────────────────────────────────────────

function getReplayState() {
    return {
        trackedExecutions: _paths.size,
        totalReplays:      _replays.size,
        replays:           [..._replays.values()].map(r => ({ ...r })),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _paths   = new Map();
    _replays = new Map();
    _counter = 0;
}

module.exports = {
    recordExecutionPath, replayExecution, validateReplayConsistency,
    reconstructExecutionTimeline, getReplayState, reset,
};
