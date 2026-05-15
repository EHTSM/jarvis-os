"use strict";
/**
 * runtimeTelemetryAggregator — aggregates telemetry signals from multiple
 * subsystems into unified runtime metrics. Supports rolling-window rates,
 * subsystem-level breakdowns, and bounded retention.
 *
 * ingestSignal(spec)             → { ingested, signalId }
 * getSubsystemMetrics(subsystem) → SubsystemMetrics | null
 * getRuntimeRates(windowMs?)     → RuntimeRates
 * getAggregatedMetrics()         → AggregatedMetrics
 * getSignalHistory(filter?)      → Signal[]
 * reset()
 *
 * Signal types: execution, policy, sandbox, circuit, recovery, health, audit
 */

const SIGNAL_TYPES = new Set([
    "execution", "policy", "sandbox", "circuit",
    "recovery", "health", "audit", "system",
]);

const DEFAULT_WINDOW_MS = 60000;   // 1-minute rolling window
const MAX_SIGNALS       = 50000;

let _signals    = [];
let _counter    = 0;
let _subsystems = new Map();   // subsystem → SubsystemState

// ── ingestSignal ──────────────────────────────────────────────────────

function ingestSignal(spec = {}) {
    const {
        signalType     = null,
        subsystem      = null,
        outcome        = null,
        adapterType    = null,
        workflowId     = null,
        correlationId  = null,
        riskScore      = null,
        latencyMs      = null,
        authorityLevel = null,
        timestamp      = new Date().toISOString(),
    } = spec;

    if (!signalType) return { ingested: false, reason: "signalType_required" };
    if (!subsystem)  return { ingested: false, reason: "subsystem_required" };
    if (!outcome)    return { ingested: false, reason: "outcome_required" };
    if (!SIGNAL_TYPES.has(signalType))
        return { ingested: false, reason: `invalid_signal_type: ${signalType}` };

    const signalId = `sig-${++_counter}`;
    const signal   = Object.freeze({
        signalId, signalType, subsystem, outcome,
        adapterType:    adapterType    ?? null,
        workflowId:     workflowId     ?? null,
        correlationId:  correlationId  ?? null,
        riskScore:      riskScore      ?? null,
        latencyMs:      latencyMs      ?? null,
        authorityLevel: authorityLevel ?? null,
        timestamp,
    });

    if (_signals.length >= MAX_SIGNALS) _signals.shift();
    _signals.push(signal);

    // Update per-subsystem state
    let ss = _subsystems.get(subsystem);
    if (!ss) {
        ss = {
            subsystem,
            totalSignals: 0, successCount: 0, failureCount: 0,
            latencies: [], lastSignalAt: null,
        };
        _subsystems.set(subsystem, ss);
    }
    ss.totalSignals++;
    ss.lastSignalAt = timestamp;
    if (outcome === "success" || outcome === "ok" || outcome === "completed")
        ss.successCount++;
    else if (outcome === "failure" || outcome === "error" || outcome === "failed")
        ss.failureCount++;
    if (latencyMs !== null) {
        ss.latencies.push(latencyMs);
        if (ss.latencies.length > 500) ss.latencies.shift();  // bounded
    }

    return { ingested: true, signalId, subsystem, signalType };
}

// ── getSubsystemMetrics ────────────────────────────────────────────────

function getSubsystemMetrics(subsystem) {
    if (!subsystem) return null;
    const ss = _subsystems.get(subsystem);
    if (!ss) return null;

    const errorRate = ss.totalSignals > 0 ? ss.failureCount / ss.totalSignals : 0;
    const avgLatencyMs = ss.latencies.length
        ? Math.round(ss.latencies.reduce((a, v) => a + v, 0) / ss.latencies.length)
        : null;
    const maxLatencyMs = ss.latencies.length ? Math.max(...ss.latencies) : null;

    return {
        subsystem: ss.subsystem,
        totalSignals:  ss.totalSignals,
        successCount:  ss.successCount,
        failureCount:  ss.failureCount,
        errorRate:     Math.round(errorRate * 1000) / 1000,
        avgLatencyMs,
        maxLatencyMs,
        lastSignalAt:  ss.lastSignalAt,
    };
}

// ── getRuntimeRates ────────────────────────────────────────────────────

function getRuntimeRates(windowMs = DEFAULT_WINDOW_MS) {
    const cutoff  = new Date(Date.now() - windowMs).toISOString();
    const window  = _signals.filter(s => s.timestamp >= cutoff);

    const total   = window.length;
    const failed  = window.filter(s =>
        s.outcome === "failure" || s.outcome === "error" || s.outcome === "failed"
    ).length;
    const policy  = window.filter(s => s.signalType === "policy").length;
    const circuit = window.filter(s => s.signalType === "circuit").length;

    const latencies = window.filter(s => s.latencyMs !== null).map(s => s.latencyMs);
    const avgLatencyMs = latencies.length
        ? Math.round(latencies.reduce((a, v) => a + v, 0) / latencies.length)
        : null;

    return {
        windowMs,
        totalSignals:   total,
        failureRate:    total > 0 ? Math.round((failed / total) * 1000) / 1000 : 0,
        policySignals:  policy,
        circuitSignals: circuit,
        avgLatencyMs,
    };
}

// ── getAggregatedMetrics ───────────────────────────────────────────────

function getAggregatedMetrics() {
    const byType      = {};
    const bySubsystem = {};
    const byOutcome   = {};

    for (const s of _signals) {
        byType[s.signalType]    = (byType[s.signalType]    ?? 0) + 1;
        bySubsystem[s.subsystem] = (bySubsystem[s.subsystem] ?? 0) + 1;
        byOutcome[s.outcome]    = (byOutcome[s.outcome]    ?? 0) + 1;
    }

    const riskScores = _signals.filter(s => s.riskScore !== null).map(s => s.riskScore);
    const avgRisk    = riskScores.length
        ? Math.round(riskScores.reduce((a, v) => a + v, 0) / riskScores.length * 1000) / 1000
        : 0;

    return {
        totalSignals: _signals.length,
        subsystemCount: _subsystems.size,
        byType, bySubsystem, byOutcome,
        avgRiskScore: avgRisk,
    };
}

// ── getSignalHistory ───────────────────────────────────────────────────

function getSignalHistory(filter = null) {
    if (!filter) return [..._signals];
    return _signals.filter(s => {
        if (filter.subsystem  && s.subsystem  !== filter.subsystem)  return false;
        if (filter.signalType && s.signalType !== filter.signalType) return false;
        if (filter.workflowId && s.workflowId !== filter.workflowId) return false;
        if (filter.adapterType && s.adapterType !== filter.adapterType) return false;
        return true;
    });
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _signals    = [];
    _subsystems = new Map();
    _counter    = 0;
}

module.exports = {
    SIGNAL_TYPES, DEFAULT_WINDOW_MS,
    ingestSignal, getSubsystemMetrics, getRuntimeRates,
    getAggregatedMetrics, getSignalHistory, reset,
};
