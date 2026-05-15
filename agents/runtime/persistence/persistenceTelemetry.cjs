"use strict";
/**
 * persistenceTelemetry — persistence metrics, replay metrics, snapshot analytics,
 * reconstruction analytics, corruption analytics, and recovery durability analytics.
 *
 * recordPersistenceEvent(event)  → { recorded, eventId }
 * recordRecoveryEvent(event)     → { recorded, eventId }
 * recordIntegrityEvent(event)    → { recorded, eventId }
 * getPersistenceMetrics()        → PersistenceMetrics
 * getRecoveryAnalytics()         → RecoveryAnalytics
 * reset()
 */

let _persistenceEvents = [];
let _recoveryEvents    = [];
let _integrityEvents   = [];
let _counter           = 0;

// ── recordPersistenceEvent ────────────────────────────────────────────

function recordPersistenceEvent(event = {}) {
    const entry = {
        eventId:     `pers-${++_counter}`,
        type:        event.type        ?? null,
        workflowId:  event.workflowId  ?? null,
        executionId: event.executionId ?? null,
        latencyMs:   event.latencyMs   ?? null,
        eventCount:  event.eventCount  ?? null,
        ts:          new Date().toISOString(),
    };
    _persistenceEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── recordRecoveryEvent ───────────────────────────────────────────────

function recordRecoveryEvent(event = {}) {
    const entry = {
        eventId:     `rec-${++_counter}`,
        type:        event.type        ?? null,
        workflowId:  event.workflowId  ?? null,
        success:     event.success     ?? null,
        interrupted: event.interrupted ?? false,
        latencyMs:   event.latencyMs   ?? null,
        ts:          new Date().toISOString(),
    };
    _recoveryEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── recordIntegrityEvent ──────────────────────────────────────────────

function recordIntegrityEvent(event = {}) {
    const entry = {
        eventId:         `int-${++_counter}`,
        type:            event.type            ?? null,
        corrupted:       event.corrupted       ?? false,
        corruptionCount: event.corruptionCount ?? 0,
        workflowId:      event.workflowId      ?? null,
        ts:              new Date().toISOString(),
    };
    _integrityEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

// ── getPersistenceMetrics ─────────────────────────────────────────────

function getPersistenceMetrics() {
    const latencies = _persistenceEvents
        .filter(e => e.latencyMs != null)
        .map(e => e.latencyMs);
    const avgLatency = latencies.length > 0
        ? +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
        : null;

    return {
        totalPersistenceEvents:  _persistenceEvents.length,
        totalRecoveryEvents:     _recoveryEvents.length,
        totalIntegrityEvents:    _integrityEvents.length,
        avgPersistenceLatencyMs: avgLatency,
        snapshotCount:           _persistenceEvents.filter(e => e.type === "snapshot_created").length,
        replayRebuildCount:      _persistenceEvents.filter(e => e.type === "replay_rebuild").length,
        corruptionIncidents:     _integrityEvents.filter(e => e.corrupted).length,
    };
}

// ── getRecoveryAnalytics ──────────────────────────────────────────────

function getRecoveryAnalytics() {
    const withResult = _recoveryEvents.filter(e => e.success != null);
    const total      = withResult.length;
    const succeeded  = withResult.filter(e => e.success === true).length;
    const interrupted = _recoveryEvents.filter(e => e.interrupted).length;

    const latencies = _recoveryEvents
        .filter(e => e.latencyMs != null)
        .map(e => e.latencyMs);
    const avgLatency = latencies.length > 0
        ? +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
        : null;

    return {
        totalRecoveries:       _recoveryEvents.length,
        successfulRecoveries:  succeeded,
        interruptedRecoveries: interrupted,
        recoverySuccessRate:   total > 0 ? +(succeeded / total).toFixed(3) : 0,
        avgRecoveryLatencyMs:  avgLatency,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _persistenceEvents = [];
    _recoveryEvents    = [];
    _integrityEvents   = [];
    _counter           = 0;
}

module.exports = {
    recordPersistenceEvent, recordRecoveryEvent, recordIntegrityEvent,
    getPersistenceMetrics, getRecoveryAnalytics, reset,
};
