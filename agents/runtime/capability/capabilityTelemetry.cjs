"use strict";
/**
 * capabilityTelemetry — observe capability lifecycle events.
 *
 * EVENTS: capability_started, capability_completed, capability_failed, capability_blocked
 * emit(event, data)
 * on(event, handler)
 * off(event, handler)
 * getLog()    → [{event, data, ts}]
 * clearLog()
 * reset()     — clears log AND handlers
 */

const EVENTS = [
    "capability_started",
    "capability_completed",
    "capability_failed",
    "capability_blocked",
];

const _log      = [];
const _handlers = new Map(EVENTS.map(e => [e, []]));

function emit(event, data = {}) {
    _log.push({ event, data, ts: new Date().toISOString() });
    for (const fn of (_handlers.get(event) ?? [])) {
        try { fn(data); } catch (_) {}
    }
}

function on(event, handler) {
    if (_handlers.has(event)) _handlers.get(event).push(handler);
}

function off(event, handler) {
    if (!_handlers.has(event)) return;
    const arr = _handlers.get(event);
    const i = arr.indexOf(handler);
    if (i !== -1) arr.splice(i, 1);
}

function getLog()   { return [..._log]; }
function clearLog() { _log.length = 0; }

function reset() {
    _log.length = 0;
    for (const [, arr] of _handlers) arr.length = 0;
}

module.exports = { EVENTS, emit, on, off, getLog, clearLog, reset };
