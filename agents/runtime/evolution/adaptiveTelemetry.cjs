"use strict";

const EVENTS = [
    "strategy_evolved",
    "policy_tuned",
    "predictive_warning",
    "concurrency_scaled",
    "self_healing_triggered",
    "evolution_checkpoint",
];

let _log = [];

function emit(event, payload = {}) {
    if (!EVENTS.includes(event)) {
        throw new Error(`Unknown adaptive telemetry event: "${event}". Valid: ${EVENTS.join(", ")}`);
    }
    const entry = { event, ts: new Date().toISOString(), ...payload };
    _log.push(entry);
    return entry;
}

function getLog()          { return [..._log]; }
function getByEvent(event) { return _log.filter(e => e.event === event); }

function getEfficiencyTrend(fingerprint) {
    const evolved = _log.filter(e =>
        e.event === "strategy_evolved" && e.fingerprint === fingerprint
    );
    return evolved.map(e => ({ ts: e.ts, strategy: e.strategy, score: e.score ?? null }));
}

function getConfidenceTrend(fingerprint) {
    const checkpoints = _log.filter(e =>
        e.event === "evolution_checkpoint" && e.fingerprint === fingerprint
    );
    return checkpoints.map(e => ({ ts: e.ts, confidence: e.confidence ?? null }));
}

function getPredictiveWarnings() {
    return _log.filter(e => e.event === "predictive_warning");
}

function reset() { _log = []; }

module.exports = { EVENTS, emit, getLog, getByEvent, getEfficiencyTrend, getConfidenceTrend, getPredictiveWarnings, reset };
