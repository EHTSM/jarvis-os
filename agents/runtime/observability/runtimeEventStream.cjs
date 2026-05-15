"use strict";
/**
 * runtimeEventStream — ordered, bounded, in-memory event stream for runtime
 * observability. Every emitted event gets a monotonically increasing sequence
 * number and an ISO timestamp. Subscribers receive a frozen copy.
 *
 * emit(spec)                     → { emitted, eventId, sequenceNumber }
 * subscribe(spec)                → { subscribed, subscriptionId }
 * unsubscribe(subscriptionId)    → { unsubscribed }
 * getEvents(filter?)             → StreamEvent[]
 * getEventById(eventId)          → StreamEvent | null
 * getStreamMetrics()             → StreamMetrics
 * reset()
 *
 * Bounded retention: oldest events dropped when _events.length > MAX_EVENTS.
 * Zero circular propagation: emit() never calls emit() internally.
 */

const MAX_EVENTS       = 10000;
const VALID_EVENT_TYPES = new Set([
    "execution_submitted", "execution_advanced", "execution_completed",
    "execution_failed", "execution_cancelled", "execution_quarantined",
    "execution_replayed", "workflow_started", "workflow_completed",
    "workflow_failed", "adapter_event", "policy_event", "sandbox_event",
    "health_event", "telemetry_event", "system_event", "recovery_event",
    "circuit_event", "audit_event", "correlation_event",
]);

let _events        = [];
let _subscribers   = new Map();
let _counter       = 0;
let _sequence      = 0;
let _subCounter    = 0;
let _dropCount     = 0;

// ── emit ──────────────────────────────────────────────────────────────

function emit(spec = {}) {
    const {
        eventType      = null,
        subsystem      = null,
        executionId    = null,
        workflowId     = null,
        correlationId  = null,
        adapterType    = null,
        authorityLevel = null,
        payload        = null,
        timestamp      = new Date().toISOString(),
    } = spec;

    if (!eventType)  return { emitted: false, reason: "eventType_required" };
    if (!subsystem)  return { emitted: false, reason: "subsystem_required" };
    if (!VALID_EVENT_TYPES.has(eventType))
        return { emitted: false, reason: `invalid_event_type: ${eventType}` };

    const eventId        = `stream-${++_counter}`;
    const sequenceNumber = ++_sequence;

    const event = Object.freeze({
        eventId, sequenceNumber, eventType, subsystem,
        executionId:    executionId    ?? null,
        workflowId:     workflowId     ?? null,
        correlationId:  correlationId  ?? null,
        adapterType:    adapterType    ?? null,
        authorityLevel: authorityLevel ?? null,
        payload:        payload !== null ? Object.freeze({ ...payload }) : null,
        timestamp,
    });

    // Bounded retention
    if (_events.length >= MAX_EVENTS) {
        _events.shift();
        _dropCount++;
    }
    _events.push(event);

    // Deliver to subscribers (errors are isolated)
    for (const [, sub] of _subscribers) {
        if (sub.filter && !_matchFilter(event, sub.filter)) continue;
        try { sub.handler(event); } catch (_) { /* isolate handler errors */ }
    }

    return { emitted: true, eventId, sequenceNumber, eventType, subsystem };
}

function _matchFilter(event, filter) {
    if (filter.eventType  && event.eventType  !== filter.eventType)  return false;
    if (filter.subsystem  && event.subsystem  !== filter.subsystem)  return false;
    if (filter.workflowId && event.workflowId !== filter.workflowId) return false;
    if (filter.adapterType && event.adapterType !== filter.adapterType) return false;
    return true;
}

// ── subscribe ──────────────────────────────────────────────────────────

function subscribe(spec = {}) {
    const { handler = null, filter = null, label = null } = spec;
    if (typeof handler !== "function") return { subscribed: false, reason: "handler_required" };

    const subscriptionId = `sub-${++_subCounter}`;
    _subscribers.set(subscriptionId, { subscriptionId, handler, filter, label });
    return { subscribed: true, subscriptionId, label };
}

// ── unsubscribe ────────────────────────────────────────────────────────

function unsubscribe(subscriptionId) {
    if (!subscriptionId) return { unsubscribed: false, reason: "subscriptionId_required" };
    if (!_subscribers.has(subscriptionId))
        return { unsubscribed: false, reason: "subscription_not_found", subscriptionId };
    _subscribers.delete(subscriptionId);
    return { unsubscribed: true, subscriptionId };
}

// ── getEvents ──────────────────────────────────────────────────────────

function getEvents(filter = null) {
    if (!filter) return [..._events];
    return _events.filter(e => _matchFilter(e, filter));
}

// ── getEventById ───────────────────────────────────────────────────────

function getEventById(eventId) {
    if (!eventId) return null;
    return _events.find(e => e.eventId === eventId) ?? null;
}

// ── getStreamMetrics ───────────────────────────────────────────────────

function getStreamMetrics() {
    const byType = {};
    const bySubsystem = {};
    for (const e of _events) {
        byType[e.eventType]    = (byType[e.eventType]    ?? 0) + 1;
        bySubsystem[e.subsystem] = (bySubsystem[e.subsystem] ?? 0) + 1;
    }
    return {
        totalEvents:       _events.length,
        droppedEvents:     _dropCount,
        subscriberCount:   _subscribers.size,
        lastSequence:      _sequence,
        byType,
        bySubsystem,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _events      = [];
    _subscribers = new Map();
    _counter     = 0;
    _sequence    = 0;
    _subCounter  = 0;
    _dropCount   = 0;
}

module.exports = {
    MAX_EVENTS, VALID_EVENT_TYPES,
    emit, subscribe, unsubscribe,
    getEvents, getEventById, getStreamMetrics, reset,
};
