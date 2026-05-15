"use strict";
/**
 * eventStream — structured runtime event stream with correlation and annotation support.
 *
 * Event types:
 *   execution_started | execution_completed | execution_failed |
 *   retry_triggered | rollback_triggered | stabilization_activated |
 *   pacing_adjusted | escalation_triggered
 *
 * Event schema:
 *   { eventId, type, correlationId, sessionId, seqNum, ts,
 *     payload, parentEventId, annotations }
 *
 * emit(type, payload, opts)                   → EventRecord
 * subscribe(type, handler)                    → unsubscribeFn
 * getEvents(filter)                           → EventRecord[]
 * getEventsByCorrelation(correlationId)       → EventRecord[]
 * getEventsBySession(sessionId)               → EventRecord[]
 * annotateEvent(eventId, annotation)          → AnnotateResult
 * getStats()                                  → Stats
 * reset()
 */

const EVENT_TYPES = new Set([
    "execution_started",
    "execution_completed",
    "execution_failed",
    "retry_triggered",
    "rollback_triggered",
    "stabilization_activated",
    "pacing_adjusted",
    "escalation_triggered",
]);

let _events     = [];          // ordered by seqNum
let _byCorr     = new Map();   // correlationId → eventId[]
let _bySession  = new Map();   // sessionId     → eventId[]
let _byId       = new Map();   // eventId       → EventRecord
let _handlers   = new Map();   // type → Set<handler>
let _seqNum     = 0;
let _counter    = 0;

// ── emit ──────────────────────────────────────────────────────────────

function emit(type, payload = {}, opts = {}) {
    if (!EVENT_TYPES.has(type)) {
        return { emitted: false, reason: "unknown_event_type", type };
    }

    const eventId       = `evt-${++_counter}`;
    const correlationId = opts.correlationId ?? payload.correlationId ?? null;
    const sessionId     = opts.sessionId     ?? payload.sessionId     ?? null;
    const parentEventId = opts.parentEventId ?? null;

    const record = {
        eventId,
        type,
        correlationId,
        sessionId,
        seqNum:       ++_seqNum,
        ts:           opts.ts ?? new Date().toISOString(),
        payload:      { ...payload },
        parentEventId,
        annotations:  [],
    };

    _events.push(record);
    _byId.set(eventId, record);

    if (correlationId) {
        if (!_byCorr.has(correlationId)) _byCorr.set(correlationId, []);
        _byCorr.get(correlationId).push(eventId);
    }
    if (sessionId) {
        if (!_bySession.has(sessionId)) _bySession.set(sessionId, []);
        _bySession.get(sessionId).push(eventId);
    }

    // Synchronous dispatch
    const handlers = _handlers.get(type);
    if (handlers) for (const h of handlers) h(record);

    return { emitted: true, eventId, type, seqNum: record.seqNum };
}

// ── subscribe ─────────────────────────────────────────────────────────

function subscribe(type, handler) {
    if (!_handlers.has(type)) _handlers.set(type, new Set());
    _handlers.get(type).add(handler);
    return () => _handlers.get(type)?.delete(handler);
}

// ── getEvents ─────────────────────────────────────────────────────────

function getEvents(filter = {}) {
    let results = [..._events];
    if (filter.type)          results = results.filter(e => e.type === filter.type);
    if (filter.sessionId)     results = results.filter(e => e.sessionId === filter.sessionId);
    if (filter.correlationId) results = results.filter(e => e.correlationId === filter.correlationId);
    if (filter.since)         results = results.filter(e => e.seqNum >= filter.since);
    if (filter.limit)         results = results.slice(-filter.limit);
    return results;
}

// ── getEventsByCorrelation ────────────────────────────────────────────

function getEventsByCorrelation(correlationId) {
    const ids = _byCorr.get(correlationId) ?? [];
    return ids.map(id => _byId.get(id)).filter(Boolean);
}

// ── getEventsBySession ────────────────────────────────────────────────

function getEventsBySession(sessionId) {
    const ids = _bySession.get(sessionId) ?? [];
    return ids.map(id => _byId.get(id)).filter(Boolean);
}

// ── annotateEvent ─────────────────────────────────────────────────────

function annotateEvent(eventId, annotation) {
    const record = _byId.get(eventId);
    if (!record) return { annotated: false, reason: "event_not_found" };
    record.annotations.push(annotation);
    return { annotated: true, eventId, annotation };
}

// ── getStats ──────────────────────────────────────────────────────────

function getStats() {
    const typeCounts = {};
    for (const e of _events) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    return {
        totalEvents:   _events.length,
        uniqueSessions: _bySession.size,
        uniqueCorrelations: _byCorr.size,
        typeCounts,
        maxSeqNum:     _seqNum,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _events    = [];
    _byCorr    = new Map();
    _bySession = new Map();
    _byId      = new Map();
    _handlers  = new Map();
    _seqNum    = 0;
    _counter   = 0;
}

module.exports = {
    EVENT_TYPES: [...EVENT_TYPES],
    emit, subscribe, getEvents,
    getEventsByCorrelation, getEventsBySession,
    annotateEvent, getStats, reset,
};
