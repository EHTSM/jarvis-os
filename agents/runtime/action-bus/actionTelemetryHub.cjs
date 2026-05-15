"use strict";
/**
 * actionTelemetryHub — centralized telemetry collection and reporting for
 * all action-bus activity.
 *
 * recordActionEvent(spec)       → { recorded, eventId, actionId }
 * getActionTimeline(actionId)   → TelemetryEvent[]
 * generateBusReport()           → BusReport
 * getSubsystemHealth(subsystem) → SubsystemHealth
 * getTelemetryMetrics()         → TelemetryMetrics
 * reset()
 *
 * Event categories: publish | dispatch | route | signal | replay | error | lifecycle
 */

const EVENT_CATEGORIES = [
    "publish", "dispatch", "route", "signal", "replay", "error", "lifecycle",
];

let _events  = [];      // TelemetryEvent[]
let _counter = 0;

// ── recordActionEvent ─────────────────────────────────────────────────

function recordActionEvent(spec = {}) {
    const {
        actionId        = null,
        subsystem       = null,
        category        = null,
        eventType       = null,
        workflowId      = null,
        correlationId   = null,
        latencyMs       = null,
        outcome         = "ok",
        payload         = {},
        error           = null,
    } = spec;

    if (!actionId)  return { recorded: false, reason: "actionId_required" };
    if (!subsystem) return { recorded: false, reason: "subsystem_required" };
    if (!category)  return { recorded: false, reason: "category_required" };
    if (!EVENT_CATEGORIES.includes(category))
        return { recorded: false, reason: `invalid_category: ${category}` };

    const eventId = `tel-${++_counter}`;
    _events.push({
        eventId, actionId, subsystem, category, eventType,
        workflowId, correlationId,
        latencyMs: typeof latencyMs === "number" ? latencyMs : null,
        outcome, payload, error,
        recordedAt: new Date().toISOString(),
    });

    return { recorded: true, eventId, actionId, subsystem, category };
}

// ── getActionTimeline ─────────────────────────────────────────────────

function getActionTimeline(actionId) {
    if (!actionId) return [];
    return _events.filter(e => e.actionId === actionId);
}

// ── generateBusReport ─────────────────────────────────────────────────

function generateBusReport() {
    const byCategory = {};
    for (const cat of EVENT_CATEGORIES) byCategory[cat] = 0;
    for (const e of _events) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;

    const errors     = _events.filter(e => e.outcome === "error" || e.category === "error");
    const latencies  = _events.filter(e => typeof e.latencyMs === "number").map(e => e.latencyMs);
    const avgLatency = latencies.length > 0
        ? latencies.reduce((s, v) => s + v, 0) / latencies.length
        : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

    const uniqueActions   = new Set(_events.map(e => e.actionId)).size;
    const uniqueWorkflows = new Set(_events.filter(e => e.workflowId).map(e => e.workflowId)).size;
    const subsystems      = new Set(_events.map(e => e.subsystem));

    return {
        totalEvents:      _events.length,
        uniqueActions,
        uniqueWorkflows,
        subsystemCount:   subsystems.size,
        errorCount:       errors.length,
        byCategory,
        avgLatencyMs:     Math.round(avgLatency * 100) / 100,
        maxLatencyMs:     maxLatency,
        generatedAt:      new Date().toISOString(),
    };
}

// ── getSubsystemHealth ────────────────────────────────────────────────

function getSubsystemHealth(subsystem) {
    if (!subsystem) return { found: false, reason: "subsystem_required" };

    const subsystemEvents = _events.filter(e => e.subsystem === subsystem);
    if (subsystemEvents.length === 0)
        return { found: false, subsystem, reason: "no_events_recorded" };

    const errorEvents   = subsystemEvents.filter(e => e.outcome === "error" || e.category === "error");
    const errorRate     = subsystemEvents.length > 0 ? errorEvents.length / subsystemEvents.length : 0;
    const latencies     = subsystemEvents.filter(e => typeof e.latencyMs === "number").map(e => e.latencyMs);
    const avgLatency    = latencies.length > 0
        ? latencies.reduce((s, v) => s + v, 0) / latencies.length
        : 0;

    let health;
    if (errorRate >= 0.5)       health = "critical";
    else if (errorRate >= 0.3)  health = "degraded";
    else if (errorRate >= 0.1)  health = "warning";
    else                         health = "healthy";

    return {
        found: true, subsystem, health,
        totalEvents:  subsystemEvents.length,
        errorCount:   errorEvents.length,
        errorRate:    Math.round(errorRate * 1000) / 1000,
        avgLatencyMs: Math.round(avgLatency * 100) / 100,
    };
}

// ── getTelemetryMetrics ───────────────────────────────────────────────

function getTelemetryMetrics() {
    const byOutcome = {};
    for (const e of _events) {
        byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
    }

    const uniqueSubsystems = new Set(_events.map(e => e.subsystem)).size;
    const latencies        = _events.filter(e => typeof e.latencyMs === "number").map(e => e.latencyMs);

    return {
        totalEvents:      _events.length,
        uniqueSubsystems,
        byOutcome,
        latencyRecorded:  latencies.length,
        avgLatencyMs:     latencies.length > 0
            ? Math.round((latencies.reduce((s, v) => s + v, 0) / latencies.length) * 100) / 100
            : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _events  = [];
    _counter = 0;
}

module.exports = {
    EVENT_CATEGORIES,
    recordActionEvent, getActionTimeline,
    generateBusReport, getSubsystemHealth,
    getTelemetryMetrics, reset,
};
