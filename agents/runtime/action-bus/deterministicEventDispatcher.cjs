"use strict";
/**
 * deterministicEventDispatcher — synchronous, ordered event dispatch to
 * registered handlers in deterministic (registration-order) sequence.
 *
 * registerHandler(spec)    → { registered, handlerId }
 * deregisterHandler(spec)  → { deregistered, handlerId }
 * dispatchEvent(spec)      → { dispatched, dispatchId, handlerCount, results }
 * getDispatchLog()         → DispatchRecord[]
 * getDispatchMetrics()     → DispatchMetrics
 * reset()
 *
 * Determinism guarantee: handlers are invoked in FIFO registration order.
 * "*" eventType wildcard matches all event types.
 * Handler functions are called synchronously; failures are caught and logged.
 */

let _handlers    = [];       // ordered list of HandlerRecord
let _dispatchLog = [];
let _counter     = 0;

// ── registerHandler ───────────────────────────────────────────────────

function registerHandler(spec = {}) {
    const {
        eventType  = "*",
        subsystem  = null,
        handlerFn  = null,
        priority   = 5,
    } = spec;

    if (!subsystem) return { registered: false, reason: "subsystem_required" };

    const handlerId = `handler-${++_counter}`;
    _handlers.push({ handlerId, eventType, subsystem, handlerFn, priority, active: true, registeredAt: new Date().toISOString() });

    return { registered: true, handlerId, eventType, subsystem, priority };
}

// ── deregisterHandler ─────────────────────────────────────────────────

function deregisterHandler(spec = {}) {
    const { handlerId = null } = spec;
    if (!handlerId) return { deregistered: false, reason: "handlerId_required" };

    const idx = _handlers.findIndex(h => h.handlerId === handlerId);
    if (idx === -1) return { deregistered: false, reason: "handler_not_found" };

    _handlers[idx].active = false;
    return { deregistered: true, handlerId };
}

// ── dispatchEvent ─────────────────────────────────────────────────────

function dispatchEvent(spec = {}) {
    const { eventType = null, payload = {}, sourceSubsystem = null, correlationId = null } = spec;
    if (!eventType) return { dispatched: false, reason: "eventType_required" };

    const dispatchId = `dispatch-${++_counter}`;
    const timestamp  = new Date().toISOString();

    // Collect matching active handlers in FIFO registration order
    const matching = _handlers.filter(h =>
        h.active && (h.eventType === "*" || h.eventType === eventType)
    );

    const results = [];
    for (const handler of matching) {
        let outcome = "invoked";
        let error   = null;
        if (typeof handler.handlerFn === "function") {
            try {
                handler.handlerFn({ eventType, payload, sourceSubsystem, correlationId, dispatchId });
            } catch (e) {
                outcome = "failed";
                error   = e.message ?? "unknown_error";
            }
        }
        results.push({ handlerId: handler.handlerId, subsystem: handler.subsystem, outcome, error });
    }

    const record = {
        dispatchId, eventType, sourceSubsystem, correlationId,
        handlerCount: matching.length,
        failedCount:  results.filter(r => r.outcome === "failed").length,
        results, timestamp,
    };
    _dispatchLog.push(record);

    return { dispatched: true, dispatchId, eventType, handlerCount: matching.length, results };
}

// ── getDispatchLog ────────────────────────────────────────────────────

function getDispatchLog() {
    return [..._dispatchLog];
}

// ── getDispatchMetrics ────────────────────────────────────────────────

function getDispatchMetrics() {
    const failed  = _dispatchLog.reduce((s, d) => s + d.failedCount, 0);
    const total   = _dispatchLog.reduce((s, d) => s + d.handlerCount, 0);
    return {
        totalDispatches:     _dispatchLog.length,
        totalHandlerInvocations: total,
        failedInvocations:   failed,
        activeHandlers:      _handlers.filter(h => h.active).length,
        totalHandlers:       _handlers.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _handlers    = [];
    _dispatchLog = [];
    _counter     = 0;
}

module.exports = {
    registerHandler, deregisterHandler, dispatchEvent,
    getDispatchLog, getDispatchMetrics, reset,
};
