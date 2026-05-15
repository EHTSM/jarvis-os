"use strict";
/**
 * coordinationTelemetry — scheduling telemetry, dependency analytics,
 * execution graph metrics, replay analytics, and coordination pressure tracking.
 *
 * recordSchedulingEvent(event)    → { recorded, eventId }
 * recordDependencyEvent(event)    → { recorded, eventId }
 * recordReplayEvent(event)        → { recorded, eventId }
 * getCoordinationMetrics()        → CoordinationMetrics
 * getReplayAnalytics()            → ReplayAnalytics
 * reset()
 */

const EVENT_TYPES = [
    "execution_scheduled",
    "slot_reserved",
    "slot_released",
    "starvation_detected",
    "schedule_rebalanced",
    "dependency_blocked",
    "dependency_resolved",
    "dependency_failed",
    "dependency_propagated",
    "replay_started",
    "replay_completed",
    "replay_inconsistent",
];

let _schedulingEvents = [];
let _dependencyEvents = [];
let _replayEvents     = [];
let _counter          = 0;

// ── recordSchedulingEvent ─────────────────────────────────────────────

function recordSchedulingEvent(event = {}) {
    const entry = {
        eventId:     `sched-${++_counter}`,
        type:        event.type        ?? null,
        executionId: event.executionId ?? null,
        priority:    event.priority    ?? null,
        policy:      event.policy      ?? null,
        latencyMs:   event.latencyMs   ?? null,
        starvation:  event.starvation  ?? false,
        ts:          new Date().toISOString(),
    };
    _schedulingEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── recordDependencyEvent ─────────────────────────────────────────────

function recordDependencyEvent(event = {}) {
    const entry = {
        eventId:      `dep-${++_counter}`,
        type:         event.type         ?? null,
        executionId:  event.executionId  ?? null,
        dependencyId: event.dependencyId ?? null,
        affected:     event.affected     ?? 0,
        ts:           new Date().toISOString(),
    };
    _dependencyEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── recordReplayEvent ─────────────────────────────────────────────────

function recordReplayEvent(event = {}) {
    const entry = {
        eventId:     `rpl-${++_counter}`,
        type:        event.type        ?? null,
        executionId: event.executionId ?? null,
        consistent:  event.consistent  ?? null,
        eventCount:  event.eventCount  ?? null,
        ts:          new Date().toISOString(),
    };
    _replayEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── getCoordinationMetrics ────────────────────────────────────────────

function getCoordinationMetrics() {
    const latencies = _schedulingEvents
        .filter(e => e.latencyMs != null)
        .map(e => e.latencyMs);
    const avgLatency = latencies.length > 0
        ? +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
        : null;

    return {
        totalSchedulingEvents: _schedulingEvents.length,
        totalDependencyEvents: _dependencyEvents.length,
        scheduledExecutions:   _schedulingEvents.filter(e => e.type === "execution_scheduled").length,
        starvationEvents:      _schedulingEvents.filter(e => e.starvation).length,
        blockedExecutions:     _dependencyEvents.filter(e => e.type === "dependency_blocked").length,
        dependencyFailures:    _dependencyEvents.filter(e => e.type === "dependency_failed").length,
        avgSchedulingLatencyMs: avgLatency,
    };
}

// ── getReplayAnalytics ────────────────────────────────────────────────

function getReplayAnalytics() {
    const withResult     = _replayEvents.filter(e => e.consistent != null);
    const total          = withResult.length;
    const consistent     = withResult.filter(e => e.consistent === true).length;
    const inconsistent   = withResult.filter(e => e.consistent === false).length;
    return {
        totalReplays:        _replayEvents.length,
        consistentReplays:   consistent,
        inconsistentReplays: inconsistent,
        consistencyRate:     total > 0 ? +(consistent / total).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _schedulingEvents = [];
    _dependencyEvents = [];
    _replayEvents     = [];
    _counter          = 0;
}

module.exports = {
    EVENT_TYPES,
    recordSchedulingEvent, recordDependencyEvent, recordReplayEvent,
    getCoordinationMetrics, getReplayAnalytics, reset,
};
