"use strict";
/**
 * governanceTelemetry — scheduling, admission, and fairness event telemetry.
 *
 * recordSchedulingEvent(event)   → { recorded, eventId }
 * recordAdmissionEvent(event)    → { recorded, eventId }
 * recordFairnessEvent(event)     → { recorded, eventId }
 * getGovernanceMetrics()         → GovernanceMetrics
 * getPressureAnalytics()         → PressureAnalytics
 * reset()
 */

let _schedulingEvents = [];
let _admissionEvents  = [];
let _fairnessEvents   = [];
let _counter          = 0;

// ── recordSchedulingEvent ─────────────────────────────────────────────

function recordSchedulingEvent(event = {}) {
    if (!event.type) return { recorded: false, reason: "type_required" };

    const eventId = `sched-${++_counter}`;
    _schedulingEvents.push({
        eventId,
        type:       event.type,
        workflowId: event.workflowId  ?? null,
        policy:     event.policy      ?? null,
        latencyMs:  event.latencyMs   ?? null,
        priority:   event.priority    ?? null,
        queueDepth: event.queueDepth  ?? null,
        pressure:   event.pressure    ?? null,
        recordedAt: new Date().toISOString(),
    });

    return { recorded: true, eventId };
}

// ── recordAdmissionEvent ──────────────────────────────────────────────

function recordAdmissionEvent(event = {}) {
    if (!event.type) return { recorded: false, reason: "type_required" };

    const eventId = `adm-${++_counter}`;
    _admissionEvents.push({
        eventId,
        type:       event.type,
        workflowId: event.workflowId ?? null,
        admitted:   event.admitted   ?? null,
        reason:     event.reason     ?? null,
        pressure:   event.pressure   ?? null,
        recordedAt: new Date().toISOString(),
    });

    return { recorded: true, eventId };
}

// ── recordFairnessEvent ───────────────────────────────────────────────

function recordFairnessEvent(event = {}) {
    if (!event.type) return { recorded: false, reason: "type_required" };

    const eventId = `fair-${++_counter}`;
    _fairnessEvents.push({
        eventId,
        type:         event.type,
        workflowId:   event.workflowId   ?? null,
        starvation:   event.starvation   ?? false,
        compensated:  event.compensated  ?? false,
        qosEscalation: event.qosEscalation ?? false,
        burstDetected: event.burstDetected ?? false,
        recordedAt:   new Date().toISOString(),
    });

    return { recorded: true, eventId };
}

// ── getGovernanceMetrics ──────────────────────────────────────────────

function getGovernanceMetrics() {
    const latencies = _schedulingEvents
        .filter(e => e.latencyMs != null)
        .map(e => e.latencyMs);

    const avgSchedulingLatencyMs = latencies.length > 0
        ? +(latencies.reduce((s, v) => s + v, 0) / latencies.length).toFixed(2)
        : 0;

    const admissionsWithOutcome = _admissionEvents.filter(e => e.admitted != null);
    const rejected              = admissionsWithOutcome.filter(e => e.admitted === false).length;
    const admissionRejectionRate = admissionsWithOutcome.length > 0
        ? +(rejected / admissionsWithOutcome.length).toFixed(3)
        : 0;

    return {
        totalSchedulingEvents: _schedulingEvents.length,
        totalAdmissionEvents:  _admissionEvents.length,
        totalFairnessEvents:   _fairnessEvents.length,
        avgSchedulingLatencyMs,
        admissionRejectionRate,
        starvationEvents:   _fairnessEvents.filter(e => e.starvation).length,
        qosEscalations:     _fairnessEvents.filter(e => e.qosEscalation).length,
        burstEvents:        _fairnessEvents.filter(e => e.burstDetected).length,
        fairnessCorrections: _fairnessEvents.filter(e => e.compensated).length,
    };
}

// ── getPressureAnalytics ──────────────────────────────────────────────

function getPressureAnalytics() {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };

    for (const e of _schedulingEvents) {
        const key = e.pressure != null && counts[e.pressure] !== undefined
            ? e.pressure : "unknown";
        counts[key]++;
    }

    const total        = _schedulingEvents.length;
    const criticalRate = total > 0 ? +(counts.critical / total).toFixed(3) : 0;

    return { ...counts, total, criticalRate };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _schedulingEvents = [];
    _admissionEvents  = [];
    _fairnessEvents   = [];
    _counter          = 0;
}

module.exports = {
    recordSchedulingEvent, recordAdmissionEvent, recordFairnessEvent,
    getGovernanceMetrics, getPressureAnalytics, reset,
};
