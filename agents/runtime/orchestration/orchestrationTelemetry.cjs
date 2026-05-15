"use strict";

const EVENTS = [
    "scheduling_decision",
    "throttling_event",
    "isolation_event",
    "circuit_breaker_activated",
    "dependency_rerouted",
    "execution_balanced",
    "recovery_staged",
    "quarantine_lifted",
];

let _log = [];

function emit(event, payload = {}) {
    if (!EVENTS.includes(event)) {
        throw new Error(`Unknown orchestration event: "${event}". Valid: ${EVENTS.join(", ")}`);
    }
    const entry = { event, ts: new Date().toISOString(), ...payload };
    _log.push(entry);
    return entry;
}

function getLog()          { return [..._log]; }
function getByEvent(event) { return _log.filter(e => e.event === event); }
function reset()           { _log = []; }

module.exports = { EVENTS, emit, getLog, getByEvent, reset };
