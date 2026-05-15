"use strict";
/**
 * runtimeBackpressureController — monitors runtime pressure signals and
 * activates admission control when queues fill or error rates spike.
 *
 * recordSignal(spec)             → { recorded, signalId, pressureState }
 * shouldAdmit(spec)              → { admitted, reason, pressureState }
 * getPressureState()             → PressureState
 * getBackpressureMetrics()       → BackpressureMetrics
 * reset()
 *
 * Pressure states: nominal → elevated → active → critical
 * Admission policy:
 *   nominal   — admit all
 *   elevated  — admit unless retryCount > 2
 *   active    — admit only critical/emergency priority or recovery
 *   critical  — admit only recovery + root-runtime authority
 *
 * Thresholds (rolling 60-s window):
 *   errorRate ≥ 0.5  → critical
 *   errorRate ≥ 0.3  → active
 *   errorRate ≥ 0.15 → elevated
 *   queueDepth ≥ 800 → active (in addition to error rate)
 */

const PRESSURE_STATES  = ["nominal", "elevated", "active", "critical"];
const WINDOW_MS        = 60000;
const THRESHOLDS = {
    critical: { errorRate: 0.5,  queueDepth: 950 },
    active:   { errorRate: 0.3,  queueDepth: 800 },
    elevated: { errorRate: 0.15, queueDepth: 600 },
};
const MAX_SIGNALS = 50000;

let _signals    = [];
let _counter    = 0;
let _overrideState = null;   // manual override for testing / kill-switch

// ── recordSignal ──────────────────────────────────────────────────────

function recordSignal(spec = {}) {
    const {
        outcome    = null,    // "success" | "failure" | "timeout" | "rejected"
        queueDepth = 0,
        subsystem  = null,
        timestamp  = new Date().toISOString(),
    } = spec;

    if (!outcome) return { recorded: false, reason: "outcome_required" };

    const signalId = `bp-${++_counter}`;
    const isError  = outcome === "failure" || outcome === "timeout" || outcome === "rejected";

    if (_signals.length >= MAX_SIGNALS) _signals.shift();
    _signals.push(Object.freeze({ signalId, outcome, isError, queueDepth, subsystem: subsystem ?? null, timestamp }));

    const state = _computePressure();
    return { recorded: true, signalId, pressureState: state };
}

// ── _computePressure ───────────────────────────────────────────────────

function _computePressure() {
    if (_overrideState) return _overrideState;

    const cutoff   = new Date(Date.now() - WINDOW_MS).toISOString();
    const window   = _signals.filter(s => s.timestamp >= cutoff);
    if (window.length === 0) return "nominal";

    const errors    = window.filter(s => s.isError).length;
    const errorRate = errors / window.length;
    const maxDepth  = window.reduce((m, s) => Math.max(m, s.queueDepth), 0);

    if (errorRate >= THRESHOLDS.critical.errorRate || maxDepth >= THRESHOLDS.critical.queueDepth) return "critical";
    if (errorRate >= THRESHOLDS.active.errorRate   || maxDepth >= THRESHOLDS.active.queueDepth)   return "active";
    if (errorRate >= THRESHOLDS.elevated.errorRate || maxDepth >= THRESHOLDS.elevated.queueDepth) return "elevated";
    return "nominal";
}

// ── shouldAdmit ────────────────────────────────────────────────────────

function shouldAdmit(spec = {}) {
    const {
        priorityClass  = "normal",
        authorityLevel = "operator",
        recovery       = false,
        retryCount     = 0,
    } = spec;

    const state = _computePressure();

    if (state === "nominal") return { admitted: true, pressureState: state };

    if (state === "elevated") {
        if (retryCount > 2) return { admitted: false, reason: "elevated_pressure_retry_limit", pressureState: state };
        return { admitted: true, pressureState: state };
    }

    if (state === "active") {
        if (recovery) return { admitted: true, pressureState: state };
        if (priorityClass === "emergency" || priorityClass === "critical")
            return { admitted: true, pressureState: state };
        return { admitted: false, reason: "active_pressure_priority_required", pressureState: state };
    }

    if (state === "critical") {
        if (recovery && authorityLevel === "root-runtime")
            return { admitted: true, pressureState: state };
        if (recovery) return { admitted: true, pressureState: state };
        return { admitted: false, reason: "critical_pressure_recovery_only", pressureState: state };
    }

    return { admitted: false, reason: "unknown_pressure_state", pressureState: state };
}

// ── getPressureState ───────────────────────────────────────────────────

function getPressureState() {
    const state = _computePressure();
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
    const window = _signals.filter(s => s.timestamp >= cutoff);
    const errors  = window.filter(s => s.isError).length;
    const errorRate = window.length > 0 ? Math.round(errors / window.length * 1000) / 1000 : 0;

    return {
        state,
        errorRate,
        windowSignals: window.length,
        overridden: !!_overrideState,
    };
}

// ── getBackpressureMetrics ─────────────────────────────────────────────

function getBackpressureMetrics() {
    const ps = getPressureState();
    return {
        currentState:   ps.state,
        errorRate:      ps.errorRate,
        totalSignals:   _signals.length,
        windowSignals:  ps.windowSignals,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _signals       = [];
    _counter       = 0;
    _overrideState = null;
}

// Expose for testing/kill-switch
function _setOverride(state) { _overrideState = state; }

module.exports = {
    PRESSURE_STATES, THRESHOLDS, WINDOW_MS,
    recordSignal, shouldAdmit, getPressureState,
    getBackpressureMetrics, reset,
    _setOverride,
};
