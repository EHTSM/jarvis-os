"use strict";
/**
 * isolationTelemetry — isolation lifecycle telemetry, quarantine analytics,
 * recovery metrics, and fault propagation tracking.
 *
 * recordIsolationEvent(event)   → { recorded, eventId }
 * recordFaultEvent(event)       → { recorded, eventId }
 * recordQuotaEvent(event)       → { recorded, eventId }
 * getIsolationMetrics()         → IsolationMetrics
 * getFaultAnalytics()           → FaultAnalytics
 * reset()
 */

const EVENT_TYPES = [
    "domain_created",
    "domain_destroyed",
    "domain_quarantined",
    "domain_released",
    "fault_reported",
    "fault_escalated",
    "quota_exhausted",
    "quota_released",
    "recovery_boundary_created",
    "recovery_boundary_restored",
    "contamination_detected",
];

let _isolationEvents = [];
let _faultEvents     = [];
let _quotaEvents     = [];
let _counter         = 0;

function recordIsolationEvent(event = {}) {
    const entry = {
        eventId:  `isol-${++_counter}`,
        type:     event.type     ?? null,
        domainId: event.domainId ?? null,
        metadata: event.metadata ?? {},
        ts:       new Date().toISOString(),
    };
    _isolationEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

function recordFaultEvent(event = {}) {
    const entry = {
        eventId:      `fault-${++_counter}`,
        domainId:     event.domainId     ?? null,
        faultState:   event.faultState   ?? null,
        failureCount: event.failureCount ?? null,
        errorType:    event.errorType    ?? null,
        escalated:    event.escalated    ?? false,
        ts:           new Date().toISOString(),
    };
    _faultEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

function recordQuotaEvent(event = {}) {
    const entry = {
        eventId:   `quota-${++_counter}`,
        domainId:  event.domainId  ?? null,
        quotaType: event.quotaType ?? null,
        action:    event.action    ?? null,
        used:      event.used      ?? null,
        limit:     event.limit     ?? null,
        ts:        new Date().toISOString(),
    };
    _quotaEvents.push(entry);
    return { recorded: true, eventId: entry.eventId };
}

function getIsolationMetrics() {
    return {
        totalEvents:      _isolationEvents.length,
        domainsCreated:   _isolationEvents.filter(e => e.type === "domain_created").length,
        domainsDestroyed: _isolationEvents.filter(e => e.type === "domain_destroyed").length,
        quarantineEvents: _isolationEvents.filter(e => e.type === "domain_quarantined").length,
        releaseEvents:    _isolationEvents.filter(e => e.type === "domain_released").length,
        recoveryRestores: _isolationEvents.filter(e => e.type === "recovery_boundary_restored").length,
    };
}

function getFaultAnalytics() {
    const byState = {};
    for (const e of _faultEvents)
        if (e.faultState) byState[e.faultState] = (byState[e.faultState] ?? 0) + 1;

    return {
        totalFaultEvents: _faultEvents.length,
        escalations:      _faultEvents.filter(e => e.escalated).length,
        byState,
        quotaExhaustions: _quotaEvents.filter(e => e.action === "exhausted").length,
    };
}

function reset() {
    _isolationEvents = [];
    _faultEvents     = [];
    _quotaEvents     = [];
    _counter         = 0;
}

module.exports = {
    EVENT_TYPES,
    recordIsolationEvent, recordFaultEvent, recordQuotaEvent,
    getIsolationMetrics, getFaultAnalytics, reset,
};
