"use strict";

const EVENTS = [
    "execution_started",
    "execution_completed",
    "rollback_started",
    "rollback_completed",
    "dangerous_action_blocked",
    "sandbox_redirected",
];

let _log = [];

function emit(event, payload = {}) {
    if (!EVENTS.includes(event)) {
        throw new Error(`Unknown toolchain telemetry event: "${event}". Valid: ${EVENTS.join(", ")}`);
    }
    const entry = { event, ts: new Date().toISOString(), ...payload };
    _log.push(entry);
    return entry;
}

function getLog()                     { return [..._log]; }
function getByEvent(event)            { return _log.filter(e => e.event === event); }
function reset()                      { _log = []; }

module.exports = { EVENTS, emit, getLog, getByEvent, reset };
