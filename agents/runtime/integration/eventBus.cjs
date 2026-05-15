"use strict";
/**
 * eventBus — pub/sub coordination event bus for runtime events.
 *
 * emit(type, payload)                → EmitResult
 * subscribe(type, handler)           → unsubscribeFn
 * subscribeAll(handler)              → unsubscribeFn
 * getRecentEvents(n)                 → Event[]
 * getEventsByType(type, limit)       → Event[]
 * getEventStats()                    → Stats
 * reset()
 */

const EVENT_TYPES = new Set([
    "workflow_queued",
    "workflow_admitted",
    "workflow_running",
    "workflow_completed",
    "workflow_failed",
    "workflow_recovered",
    "component_degraded",
    "component_recovered",
    "containment_triggered",
    "containment_released",
    "recovery_started",
    "recovery_completed",
    "mode_changed",
    "reroute_triggered",
    "strategy_selected",
    "quorum_achieved",
    "budget_allocated",
    "arbitration_run",
]);

const EVENT_BUFFER_SIZE = 1000;

let _handlers    = new Map();   // type → Set<handler>
let _allHandlers = new Set();
let _buffer      = [];           // circular event log
let _seqNum      = 0;
let _typeCounts  = {};

// ── emit ──────────────────────────────────────────────────────────────

function emit(type, payload = {}) {
    if (!EVENT_TYPES.has(type)) {
        return { emitted: false, reason: "unknown_event_type", type };
    }

    const event = {
        eventId: `ev-${++_seqNum}`,
        type,
        payload,
        seqNum:  _seqNum,
        ts:      new Date().toISOString(),
    };

    // Buffer
    _buffer.push(event);
    if (_buffer.length > EVENT_BUFFER_SIZE) _buffer.shift();

    // Type counts
    _typeCounts[type] = (_typeCounts[type] ?? 0) + 1;

    // Dispatch to type-specific handlers (synchronous)
    const typeHandlers = _handlers.get(type);
    if (typeHandlers) {
        for (const h of typeHandlers) {
            try { h(event); } catch (_) { /* isolate handler errors */ }
        }
    }

    // Dispatch to wildcard handlers
    for (const h of _allHandlers) {
        try { h(event); } catch (_) { /* isolate handler errors */ }
    }

    return { emitted: true, eventId: event.eventId, type, seqNum: event.seqNum };
}

// ── subscribe ─────────────────────────────────────────────────────────

function subscribe(type, handler) {
    if (!_handlers.has(type)) _handlers.set(type, new Set());
    _handlers.get(type).add(handler);
    return function unsubscribe() {
        _handlers.get(type)?.delete(handler);
    };
}

// ── subscribeAll ──────────────────────────────────────────────────────

function subscribeAll(handler) {
    _allHandlers.add(handler);
    return function unsubscribe() {
        _allHandlers.delete(handler);
    };
}

// ── getRecentEvents ───────────────────────────────────────────────────

function getRecentEvents(n = 20) {
    return _buffer.slice(-Math.min(n, _buffer.length));
}

// ── getEventsByType ───────────────────────────────────────────────────

function getEventsByType(type, limit = 50) {
    return _buffer.filter(e => e.type === type).slice(-limit);
}

// ── getEventStats ─────────────────────────────────────────────────────

function getEventStats() {
    return {
        totalEmitted:  _seqNum,
        buffered:      _buffer.length,
        byType:        { ..._typeCounts },
        activeHandlers: [..._handlers.values()].reduce((s, set) => s + set.size, 0) + _allHandlers.size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _handlers    = new Map();
    _allHandlers = new Set();
    _buffer      = [];
    _seqNum      = 0;
    _typeCounts  = {};
}

module.exports = {
    EVENT_TYPES,
    emit, subscribe, subscribeAll,
    getRecentEvents, getEventsByType, getEventStats, reset,
};
