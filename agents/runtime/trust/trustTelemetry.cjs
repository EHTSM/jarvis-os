"use strict";
/**
 * trustTelemetry — emit and observe trust + verification lifecycle events.
 *
 * EVENTS: trust_increase, trust_decrease, verification_success,
 *         verification_failure, hallucination_detected
 * emit(event, data)
 * on(event, handler)
 * off(event, handler)
 * getLog()     → [{event, data, ts}]
 * clearLog()
 * reset()      — clears log AND all handlers
 */

const EVENTS = [
    "trust_increase",
    "trust_decrease",
    "verification_success",
    "verification_failure",
    "hallucination_detected",
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
