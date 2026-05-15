"use strict";
/**
 * runtimeHealthMonitor — computes runtime and per-subsystem health scores
 * (0.0–1.0) from aggregated signal windows. Detects degradation and emits
 * health-state transitions.
 *
 * reportHealthSignal(spec)        → { reported, signalId }
 * getSubsystemHealth(subsystem)   → SubsystemHealth
 * getRuntimeHealth()              → RuntimeHealth
 * getHealthHistory(subsystem?)    → HealthRecord[]
 * detectDegradation()             → DegradedSubsystem[]
 * getHealthMetrics()              → HealthMetrics
 * reset()
 *
 * Health states: healthy (≥0.8), warning (≥0.6), degraded (≥0.4), critical (<0.4)
 * Score formula: successRate * 0.6 + availabilityRate * 0.3 + latencyScore * 0.1
 */

const HEALTH_STATES = {
    healthy:  { label: "healthy",  min: 0.8 },
    warning:  { label: "warning",  min: 0.6 },
    degraded: { label: "degraded", min: 0.4 },
    critical: { label: "critical", min: 0.0 },
};

const DEFAULT_WINDOW_MS = 120000;  // 2-minute rolling window
const LATENCY_CEILING   = 5000;    // 5 s maps to score 0.0
const MAX_SIGNALS       = 100000;

let _signals    = [];
let _history    = [];
let _counter    = 0;
let _histCount  = 0;

function _healthLabel(score) {
    if (score >= 0.8) return "healthy";
    if (score >= 0.6) return "warning";
    if (score >= 0.4) return "degraded";
    return "critical";
}

// ── reportHealthSignal ─────────────────────────────────────────────────

function reportHealthSignal(spec = {}) {
    const {
        subsystem   = null,
        outcome     = null,   // "success" | "failure" | "timeout" | "degraded"
        available   = true,
        latencyMs   = null,
        timestamp   = new Date().toISOString(),
    } = spec;

    if (!subsystem) return { reported: false, reason: "subsystem_required" };
    if (!outcome)   return { reported: false, reason: "outcome_required" };

    const signalId = `hs-${++_counter}`;
    const signal   = Object.freeze({
        signalId, subsystem, outcome,
        available, latencyMs: latencyMs ?? null, timestamp,
    });

    if (_signals.length >= MAX_SIGNALS) _signals.shift();
    _signals.push(signal);

    return { reported: true, signalId, subsystem };
}

// ── _computeScore ──────────────────────────────────────────────────────

function _computeScore(subsystemSignals) {
    if (subsystemSignals.length === 0) return 1.0;  // unknown = assume healthy

    const total      = subsystemSignals.length;
    const successes  = subsystemSignals.filter(s => s.outcome === "success").length;
    const available  = subsystemSignals.filter(s => s.available).length;
    const latencies  = subsystemSignals.filter(s => s.latencyMs !== null).map(s => s.latencyMs);

    const successRate  = total > 0 ? successes / total : 1.0;
    const availRate    = total > 0 ? available / total : 1.0;
    const avgLatency   = latencies.length
        ? latencies.reduce((a, v) => a + v, 0) / latencies.length : 0;
    const latencyScore = Math.max(0, 1 - avgLatency / LATENCY_CEILING);

    const score = successRate * 0.6 + availRate * 0.3 + latencyScore * 0.1;
    return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}

// ── getSubsystemHealth ─────────────────────────────────────────────────

function getSubsystemHealth(subsystem, windowMs = DEFAULT_WINDOW_MS) {
    if (!subsystem) return null;
    const cutoff  = new Date(Date.now() - windowMs).toISOString();
    const window  = _signals.filter(s => s.subsystem === subsystem && s.timestamp >= cutoff);
    const score   = _computeScore(window);
    const state   = _healthLabel(score);
    return { subsystem, score, state, signalCount: window.length };
}

// ── getRuntimeHealth ──────────────────────────────────────────────────

function getRuntimeHealth(windowMs = DEFAULT_WINDOW_MS) {
    const cutoff     = new Date(Date.now() - windowMs).toISOString();
    const window     = _signals.filter(s => s.timestamp >= cutoff);
    const subsystems = [...new Set(window.map(s => s.subsystem))];

    if (subsystems.length === 0) {
        return { score: 1.0, state: "healthy", subsystemCount: 0, degradedSubsystems: [] };
    }

    const scores   = subsystems.map(ss => {
        const sub = window.filter(s => s.subsystem === ss);
        return _computeScore(sub);
    });
    const avgScore = Math.round(scores.reduce((a, v) => a + v, 0) / scores.length * 1000) / 1000;
    const state    = _healthLabel(avgScore);

    const degraded = subsystems
        .map((ss, i) => ({ subsystem: ss, score: scores[i], state: _healthLabel(scores[i]) }))
        .filter(s => s.state !== "healthy");

    // Record to history
    const histId = `hrec-${++_histCount}`;
    _history.push(Object.freeze({
        histId, score: avgScore, state,
        subsystemCount: subsystems.length,
        degradedCount:  degraded.length,
        timestamp: new Date().toISOString(),
    }));
    if (_history.length > 1000) _history.shift();

    return {
        score: avgScore, state,
        subsystemCount:      subsystems.length,
        degradedSubsystems:  degraded,
    };
}

// ── getHealthHistory ───────────────────────────────────────────────────

function getHealthHistory(subsystem = null) {
    if (subsystem) {
        const cutoff = new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();
        return _signals.filter(s => s.subsystem === subsystem && s.timestamp >= cutoff);
    }
    return [..._history];
}

// ── detectDegradation ─────────────────────────────────────────────────

function detectDegradation(windowMs = DEFAULT_WINDOW_MS) {
    const cutoff     = new Date(Date.now() - windowMs).toISOString();
    const window     = _signals.filter(s => s.timestamp >= cutoff);
    const subsystems = [...new Set(window.map(s => s.subsystem))];

    return subsystems
        .map(ss => {
            const sub   = window.filter(s => s.subsystem === ss);
            const score = _computeScore(sub);
            return { subsystem: ss, score, state: _healthLabel(score) };
        })
        .filter(s => s.state === "degraded" || s.state === "critical")
        .sort((a, b) => a.score - b.score);
}

// ── getHealthMetrics ───────────────────────────────────────────────────

function getHealthMetrics() {
    const health = getRuntimeHealth();
    return {
        currentScore:        health.score,
        currentState:        health.state,
        totalSignals:        _signals.length,
        historyEntries:      _history.length,
        degradedSubsystems:  health.degradedSubsystems.length,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _signals   = [];
    _history   = [];
    _counter   = 0;
    _histCount = 0;
}

module.exports = {
    HEALTH_STATES, DEFAULT_WINDOW_MS,
    reportHealthSignal, getSubsystemHealth, getRuntimeHealth,
    getHealthHistory, detectDegradation, getHealthMetrics, reset,
};
