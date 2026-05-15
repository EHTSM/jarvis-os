"use strict";
/**
 * concurrencyTelemetry — concurrency metrics, arbitration analytics,
 * deadlock analytics, replay drift analytics, contention analytics,
 * and starvation analytics.
 *
 * recordConcurrencyEvent(event)  → { recorded, eventId }
 * recordDeadlockEvent(event)     → { recorded, eventId }
 * recordArbitrationEvent(event)  → { recorded, eventId }
 * getConcurrencyMetrics()        → ConcurrencyMetrics
 * getDeadlockAnalytics()         → DeadlockAnalytics
 * reset()
 */

let _concurrencyEvents  = [];
let _deadlockEvents     = [];
let _arbitrationEvents  = [];
let _counter            = 0;

// ── recordConcurrencyEvent ────────────────────────────────────────────

function recordConcurrencyEvent(event = {}) {
    const entry = {
        eventId:            `conc-${++_counter}`,
        type:               event.type               ?? null,
        workflowId:         event.workflowId         ?? null,
        isolationDomain:    event.isolationDomain    ?? null,
        activeCount:        event.activeCount        ?? null,
        starvation:         event.starvation         ?? false,
        isolationViolation: event.isolationViolation ?? false,
        ts:                 new Date().toISOString(),
    };
    _concurrencyEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── recordDeadlockEvent ───────────────────────────────────────────────

function recordDeadlockEvent(event = {}) {
    const entry = {
        eventId:  `dead-${++_counter}`,
        type:     event.type     ?? null,
        cycle:    event.cycle    ?? [],
        resolved: event.resolved ?? false,
        strategy: event.strategy ?? null,
        ts:       new Date().toISOString(),
    };
    _deadlockEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── recordArbitrationEvent ────────────────────────────────────────────

function recordArbitrationEvent(event = {}) {
    const entry = {
        eventId:      `arb-${++_counter}`,
        type:         event.type         ?? null,
        resourceType: event.resourceType ?? null,
        ownerId:      event.ownerId      ?? null,
        amount:       event.amount       ?? null,
        policy:       event.policy       ?? null,
        latencyMs:    event.latencyMs    ?? null,
        contention:   event.contention   ?? false,
        ts:           new Date().toISOString(),
    };
    _arbitrationEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── getConcurrencyMetrics ─────────────────────────────────────────────

function getConcurrencyMetrics() {
    const latencies = _arbitrationEvents
        .filter(e => e.latencyMs != null)
        .map(e => e.latencyMs);
    const avgArbitrationLatency = latencies.length > 0
        ? +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
        : null;

    return {
        totalConcurrencyEvents:  _concurrencyEvents.length,
        totalDeadlockEvents:     _deadlockEvents.length,
        totalArbitrationEvents:  _arbitrationEvents.length,
        starvationEvents:        _concurrencyEvents.filter(e => e.starvation).length,
        isolationViolations:     _concurrencyEvents.filter(e => e.isolationViolation).length,
        contentionEvents:        _arbitrationEvents.filter(e => e.contention).length,
        avgArbitrationLatencyMs: avgArbitrationLatency,
    };
}

// ── getDeadlockAnalytics ──────────────────────────────────────────────

function getDeadlockAnalytics() {
    const total      = _deadlockEvents.length;
    const resolved   = _deadlockEvents.filter(e => e.resolved).length;
    const unresolved = total - resolved;
    return {
        totalDeadlockEvents: total,
        resolvedDeadlocks:   resolved,
        unresolvedDeadlocks: unresolved,
        resolutionRate:      total > 0 ? +(resolved / total).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _concurrencyEvents = [];
    _deadlockEvents    = [];
    _arbitrationEvents = [];
    _counter           = 0;
}

module.exports = {
    recordConcurrencyEvent, recordDeadlockEvent, recordArbitrationEvent,
    getConcurrencyMetrics, getDeadlockAnalytics, reset,
};
