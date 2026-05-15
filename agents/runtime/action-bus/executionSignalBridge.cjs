"use strict";
/**
 * executionSignalBridge — inter-subsystem signal emission, forwarding,
 * interception, and fault-aware propagation.
 *
 * emitSignal(spec)      → { emitted, signalId, signalType }
 * forwardSignal(spec)   → { forwarded, forwardId, targetCount }
 * interceptSignal(spec) → { intercepted, interceptId, signalId }
 * getSignalLog()        → SignalRecord[]
 * getSignalMetrics()    → SignalMetrics
 * reset()
 *
 * Signal types: ready | degraded | recovering | failed | quarantined |
 *               pressure_alert | capacity_warning | governance_block
 */

const SIGNAL_TYPES = [
    "ready", "degraded", "recovering", "failed", "quarantined",
    "pressure_alert", "capacity_warning", "governance_block",
];

let _signals     = [];
let _forwards    = [];
let _intercepts  = [];
let _counter     = 0;

// ── emitSignal ────────────────────────────────────────────────────────

function emitSignal(spec = {}) {
    const {
        sourceSubsystem = null,
        signalType      = null,
        payload         = {},
        correlationId   = null,
        workflowId      = null,
    } = spec;

    if (!sourceSubsystem) return { emitted: false, reason: "sourceSubsystem_required" };
    if (!signalType)      return { emitted: false, reason: "signalType_required" };
    if (!SIGNAL_TYPES.includes(signalType))
        return { emitted: false, reason: `invalid_signal_type: ${signalType}` };

    const signalId = `signal-${++_counter}`;
    _signals.push({
        signalId, sourceSubsystem, signalType, payload,
        correlationId, workflowId,
        intercepted: false, forwarded: false,
        emittedAt: new Date().toISOString(),
    });

    return { emitted: true, signalId, sourceSubsystem, signalType, workflowId };
}

// ── forwardSignal ─────────────────────────────────────────────────────

function forwardSignal(spec = {}) {
    const { signalId = null, targetSubsystems = [], reason = "propagation" } = spec;
    if (!signalId) return { forwarded: false, reason: "signalId_required" };
    if (!Array.isArray(targetSubsystems) || targetSubsystems.length === 0)
        return { forwarded: false, reason: "targetSubsystems_required" };

    const signal = _signals.find(s => s.signalId === signalId);
    if (!signal) return { forwarded: false, reason: "signal_not_found", signalId };

    signal.forwarded = true;
    const forwardId  = `fwd-${++_counter}`;
    _forwards.push({
        forwardId, signalId, targetSubsystems: [...targetSubsystems],
        reason, forwardedAt: new Date().toISOString(),
    });

    return { forwarded: true, forwardId, signalId, targetCount: targetSubsystems.length, targetSubsystems };
}

// ── interceptSignal ───────────────────────────────────────────────────

function interceptSignal(spec = {}) {
    const { signalId = null, interceptorId = null, modification = null } = spec;
    if (!signalId)     return { intercepted: false, reason: "signalId_required" };
    if (!interceptorId) return { intercepted: false, reason: "interceptorId_required" };

    const signal = _signals.find(s => s.signalId === signalId);
    if (!signal) return { intercepted: false, reason: "signal_not_found", signalId };
    if (signal.intercepted)
        return { intercepted: false, reason: "signal_already_intercepted", signalId };

    signal.intercepted = true;

    if (modification && typeof modification === "object") {
        Object.assign(signal.payload, modification);
    }

    const interceptId = `intercept-${++_counter}`;
    _intercepts.push({ interceptId, signalId, interceptorId, modification, interceptedAt: new Date().toISOString() });

    return { intercepted: true, interceptId, signalId, interceptorId };
}

// ── getSignalLog ──────────────────────────────────────────────────────

function getSignalLog() {
    return [..._signals];
}

// ── getSignalMetrics ──────────────────────────────────────────────────

function getSignalMetrics() {
    const byType = {};
    for (const t of SIGNAL_TYPES) byType[t] = 0;
    for (const s of _signals) byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;

    return {
        totalSignals:      _signals.length,
        forwardedCount:    _signals.filter(s => s.forwarded).length,
        interceptedCount:  _signals.filter(s => s.intercepted).length,
        byType,
        uniqueSources:     new Set(_signals.map(s => s.sourceSubsystem)).size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _signals    = [];
    _forwards   = [];
    _intercepts = [];
    _counter    = 0;
}

module.exports = {
    SIGNAL_TYPES,
    emitSignal, forwardSignal, interceptSignal,
    getSignalLog, getSignalMetrics, reset,
};
