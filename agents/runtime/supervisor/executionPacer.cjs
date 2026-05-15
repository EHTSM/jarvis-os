"use strict";
/**
 * executionPacer — adaptive execution pacing: risky workflows run slower,
 * verified deterministic workflows run faster.
 *
 * registerVerified(fingerprint)                  → void
 * registerRisky(fingerprint, riskLevel)          → void
 * calculatePace(execution, context)              → PaceDecision
 * getPaceMultiplier(fingerprint)                 → number
 * adaptPacing(systemState)                       → PacingAdaptation
 * getPacingStats()                               → PacingStats
 * reset()
 */

const BASE_PACE_MS = 100;

const RISK_MULTIPLIERS = {
    none:     0.5,    // verified deterministic → 2× faster
    low:      0.75,
    medium:   1.0,
    high:     2.0,
    critical: 4.0,
};

const PRESSURE_MULTIPLIERS = {
    none:     1.0,
    low:      1.1,
    medium:   1.3,
    high:     1.8,
    critical: 3.0,
};

let _verified     = new Set();
let _risky        = new Map();   // fingerprint → riskLevel
let _paceDecisions = [];

// ── registerVerified ──────────────────────────────────────────────────

function registerVerified(fingerprint) {
    _verified.add(fingerprint);
    _risky.delete(fingerprint);  // promote out of risky if present
}

// ── registerRisky ─────────────────────────────────────────────────────

function registerRisky(fingerprint, riskLevel = "medium") {
    _verified.delete(fingerprint);
    _risky.set(fingerprint, riskLevel);
}

// ── getPaceMultiplier ─────────────────────────────────────────────────

function getPaceMultiplier(fingerprint) {
    if (_verified.has(fingerprint)) return RISK_MULTIPLIERS.none;

    const level = _risky.get(fingerprint) ?? "medium";
    return RISK_MULTIPLIERS[level] ?? RISK_MULTIPLIERS.medium;
}

// ── calculatePace ─────────────────────────────────────────────────────

function calculatePace(execution = {}, context = {}) {
    const fingerprint = execution.fingerprint ?? "unknown";
    const pressure    = context.pressure      ?? "none";
    const riskScore   = context.riskScore     ?? 0;

    // Determine risk level from score if not registered
    const riskLevel = _risky.get(fingerprint) ??
        (riskScore >= 80 ? "critical" :
         riskScore >= 60 ? "high"     :
         riskScore >= 40 ? "medium"   :
         riskScore >= 20 ? "low"      : "none");

    const fpMultiplier  = getPaceMultiplier(fingerprint);
    const presMultiplier = PRESSURE_MULTIPLIERS[pressure] ?? 1.0;
    const combined       = fpMultiplier * presMultiplier;

    const paceMs    = +Math.round(BASE_PACE_MS * combined);
    const paceLabel = combined <= 0.6 ? "fast"   :
                      combined <= 1.1 ? "normal" :
                      combined <= 2.0 ? "slow"   : "very_slow";

    const decision = {
        fingerprint,
        paceMs,
        paceLabel,
        multiplier:      +combined.toFixed(2),
        isVerified:      _verified.has(fingerprint),
        riskLevel,
        pressure,
    };
    _paceDecisions.push(decision);
    return decision;
}

// ── adaptPacing ───────────────────────────────────────────────────────

function adaptPacing(systemState = {}) {
    const { pressure = "none", riskScore = 0, verifiedRatio = 0 } = systemState;

    const actions = [];
    const globalMultiplier = PRESSURE_MULTIPLIERS[pressure] ?? 1.0;

    if (pressure === "critical" || riskScore >= 70) {
        actions.push("apply_maximum_slowdown_to_unverified");
        actions.push("fast_track_verified_only");
    } else if (pressure === "high" || riskScore >= 50) {
        actions.push("slow_down_high_risk_workflows");
    }
    if (verifiedRatio > 0.7 && pressure === "none") {
        actions.push("allow_fast_path_for_verified");
    }

    return {
        globalMultiplier,
        actions,
        pressure,
        effectivePaceMs: +Math.round(BASE_PACE_MS * globalMultiplier),
    };
}

// ── getPacingStats ────────────────────────────────────────────────────

function getPacingStats() {
    return {
        verifiedFingerprints: _verified.size,
        riskyFingerprints:    _risky.size,
        decisionCount:        _paceDecisions.length,
        avgPaceMs:            _paceDecisions.length > 0
            ? +(_paceDecisions.reduce((s, d) => s + d.paceMs, 0) / _paceDecisions.length).toFixed(1)
            : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _verified      = new Set();
    _risky         = new Map();
    _paceDecisions = [];
}

module.exports = {
    BASE_PACE_MS, RISK_MULTIPLIERS, PRESSURE_MULTIPLIERS,
    registerVerified, registerRisky, calculatePace,
    getPaceMultiplier, adaptPacing, getPacingStats, reset,
};
