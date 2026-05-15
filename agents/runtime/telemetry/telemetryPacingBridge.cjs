"use strict";
/**
 * telemetryPacingBridge — translates infrastructure telemetry into execution pacing decisions.
 *
 * Bridges real resource pressure into the execution pacing layer without
 * importing it directly — returns pacing configs as plain data.
 *
 * computePacingSignal(healthScore, metrics)      → PacingSignal
 * translateToPacingConfig(signal)                → PacingConfig
 * shouldFastTrack(fingerprint, healthScore)      → FastTrackDecision
 * shouldThrottle(healthScore, metrics)           → ThrottleDecision
 * getEffectivePaceMultiplier(healthScore)        → number
 * getPacingBridgeStats()                         → Stats
 * reset()
 */

const HEALTH_TO_PRESSURE = {
    // health score ranges → pressure level
    healthy:  "none",
    warning:  "medium",
    degraded: "high",
    critical: "critical",
};

// Pacing multipliers by infrastructure pressure
const INFRA_PACE_MULTIPLIERS = {
    none:     1.0,
    low:      1.2,
    medium:   1.5,
    high:     2.5,
    critical: 5.0,
};

// Signals that block fast-tracking regardless of fingerprint verification
const FAST_TRACK_BLOCKERS = new Set(["critical", "degraded"]);

let _signals       = [];
let _throttles     = [];
let _fastTrackHits = 0;
let _fastTrackDenials = 0;

// ── computePacingSignal ───────────────────────────────────────────────

function computePacingSignal(healthScore = {}, metrics = []) {
    const level       = healthScore.level ?? "healthy";
    const pressure    = HEALTH_TO_PRESSURE[level] ?? "none";
    const critMetrics = metrics.filter(m => m.severity === "critical").map(m => m.metric);
    const hasCPUCrit  = metrics.some(m => m.metric === "cpu"     && m.severity === "critical");
    const hasMemCrit  = metrics.some(m => m.metric === "memory"  && m.severity === "critical");
    const hasLatCrit  = metrics.some(m => m.metric === "latency" && m.severity === "critical");

    // Escalate pressure if specific critical signals are present
    let effectivePressure = pressure;
    if (hasCPUCrit || hasMemCrit) {
        effectivePressure = "critical";
    } else if (hasLatCrit && pressure !== "critical") {
        // Critical latency always escalates pressure to at least "high"
        const ORDER = ["none", "low", "medium", "high", "critical"];
        const cur   = ORDER.indexOf(effectivePressure);
        const tgt   = ORDER.indexOf("high");
        if (cur < tgt) effectivePressure = "high";
    }

    const multiplier = INFRA_PACE_MULTIPLIERS[effectivePressure] ?? 1.0;
    const signal = {
        healthScore:      healthScore.score ?? 100,
        level,
        pressure:         effectivePressure,
        multiplier,
        criticalMetrics:  critMetrics,
        blockFastTrack:   FAST_TRACK_BLOCKERS.has(level) || critMetrics.length > 0,
    };
    _signals.push(signal);
    return signal;
}

// ── translateToPacingConfig ───────────────────────────────────────────

function translateToPacingConfig(signal = {}) {
    const { pressure = "none", multiplier = 1.0, blockFastTrack = false } = signal;

    const strategy = pressure === "critical" ? "recovery_first" :
                     pressure === "high"     ? "staged"         :
                     pressure === "medium"   ? "safe"           : "fast";

    const maxConcurrency = pressure === "critical" ? 1 :
                           pressure === "high"     ? 3 :
                           pressure === "medium"   ? 6 : 10;

    return {
        strategy,
        maxConcurrency,
        paceMultiplier: multiplier,
        allowFastTrack: !blockFastTrack,
        pressure,
    };
}

// ── shouldFastTrack ───────────────────────────────────────────────────

function shouldFastTrack(fingerprint, healthScore = {}) {
    const level     = healthScore.level ?? "healthy";
    const score     = healthScore.score ?? 100;
    const blocked   = FAST_TRACK_BLOCKERS.has(level) || healthScore.hasCritical === true;

    if (blocked || score < 60) {
        _fastTrackDenials++;
        return { allowed: false, fingerprint, reason: blocked ? "infrastructure_pressure" : "low_health_score" };
    }

    _fastTrackHits++;
    return { allowed: true, fingerprint, healthScore: score };
}

// ── shouldThrottle ────────────────────────────────────────────────────

function shouldThrottle(healthScore = {}, metrics = []) {
    const score      = healthScore.score ?? 100;
    const level      = healthScore.level ?? "healthy";
    const critCount  = metrics.filter(m => m.severity === "critical").length;
    const degCount   = metrics.filter(m => m.severity === "degraded").length;

    const throttle   = score < 60 || critCount > 0 || level === "critical" || level === "degraded";
    const intensity  = critCount > 2 ? "aggressive" :
                       critCount > 0 || level === "critical" ? "moderate" :
                       level === "degraded" ? "light" : "none";

    const decision = {
        throttle,
        intensity,
        healthScore:   score,
        criticalSignals: critCount,
        degradedSignals: degCount,
        reason:        throttle
            ? (critCount > 0 ? "critical_signals_present" : "low_health_score")
            : "healthy",
    };
    if (throttle) _throttles.push(decision);
    return decision;
}

// ── getEffectivePaceMultiplier ────────────────────────────────────────

function getEffectivePaceMultiplier(healthScore = {}) {
    const level    = healthScore.level ?? "healthy";
    const pressure = HEALTH_TO_PRESSURE[level] ?? "none";
    return INFRA_PACE_MULTIPLIERS[pressure] ?? 1.0;
}

// ── getPacingBridgeStats ──────────────────────────────────────────────

function getPacingBridgeStats() {
    return {
        signalCount:      _signals.length,
        throttleCount:    _throttles.length,
        fastTrackHits:    _fastTrackHits,
        fastTrackDenials: _fastTrackDenials,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _signals           = [];
    _throttles         = [];
    _fastTrackHits     = 0;
    _fastTrackDenials  = 0;
}

module.exports = {
    HEALTH_TO_PRESSURE, INFRA_PACE_MULTIPLIERS,
    computePacingSignal, translateToPacingConfig,
    shouldFastTrack, shouldThrottle,
    getEffectivePaceMultiplier, getPacingBridgeStats, reset,
};
