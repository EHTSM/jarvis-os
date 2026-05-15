"use strict";
/**
 * planningHooks — lightweight observability event system for the planning pipeline.
 *
 * on(event, handler)
 * off(event, handler)
 * emit(event, data)
 * getLog()     → [{event, data, ts}] — full event history
 * clearLog()
 * reset()      — clears handlers and log
 *
 * Handlers are called synchronously. Handler errors are swallowed to protect the pipeline.
 */

const EVENTS = [
    "planning_started",
    "simulation_completed",
    "verification_completed",
    "strategy_selected",
    "execution_blocked",
    "execution_approved",
];

const _handlers = new Map();
const _log      = [];

function on(event, handler) {
    if (!_handlers.has(event)) _handlers.set(event, new Set());
    _handlers.get(event).add(handler);
}

function off(event, handler) {
    _handlers.get(event)?.delete(handler);
}

function emit(event, data = {}) {
    const entry = { event, data, ts: new Date().toISOString() };
    _log.push(entry);
    for (const fn of (_handlers.get(event) ?? [])) {
        try { fn(data); } catch (_) { /* handler errors must not break the pipeline */ }
    }
}

function getLog()   { return [..._log]; }
function clearLog() { _log.length = 0; }

function reset() {
    _handlers.clear();
    _log.length = 0;
}

module.exports = { on, off, emit, getLog, clearLog, reset, EVENTS };
