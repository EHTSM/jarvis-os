"use strict";
/**
 * workloadClassifier — classify workflows by risk, latency sensitivity,
 * recovery complexity, and infrastructure pressure.
 *
 * classify(descriptor)                         → Classification
 * classifyBatch(descriptors)                   → Classification[]
 * getRiskProfile(type)                         → RiskProfile
 * updateProfile(type, feedback)                → void
 * getClassifierStats()                         → Stats
 * reset()
 */

const RISK_LEVELS      = ["low", "medium", "high", "critical"];
const LATENCY_CLASSES  = ["background", "standard", "interactive", "realtime"];
const RECOVERY_CLASSES = ["simple", "moderate", "complex", "non_recoverable"];

// Default risk profiles keyed by workflow type
const DEFAULT_PROFILES = {
    data_pipeline:     { risk: 0.3, latency: 0.2, recovery: 0.3, pressure: 0.2 },
    api_call:          { risk: 0.2, latency: 0.7, recovery: 0.2, pressure: 0.3 },
    file_operation:    { risk: 0.3, latency: 0.3, recovery: 0.4, pressure: 0.1 },
    database_write:    { risk: 0.5, latency: 0.6, recovery: 0.6, pressure: 0.4 },
    notification:      { risk: 0.1, latency: 0.5, recovery: 0.1, pressure: 0.1 },
    payment:           { risk: 0.9, latency: 0.8, recovery: 0.8, pressure: 0.5 },
    auth:              { risk: 0.7, latency: 0.9, recovery: 0.5, pressure: 0.3 },
    background_job:    { risk: 0.2, latency: 0.1, recovery: 0.3, pressure: 0.2 },
    real_time_stream:  { risk: 0.6, latency: 1.0, recovery: 0.5, pressure: 0.7 },
    unknown:           { risk: 0.5, latency: 0.5, recovery: 0.5, pressure: 0.5 },
};

let _profiles  = new Map(Object.entries(DEFAULT_PROFILES).map(([k, v]) => [k, { ...v }]));
let _history   = [];
let _counter   = 0;

// ── _scoreToLevel ─────────────────────────────────────────────────────

function _scoreToRisk(score) {
    return score >= 0.75 ? "critical" : score >= 0.50 ? "high" : score >= 0.25 ? "medium" : "low";
}
function _scoreToLatency(score) {
    return score >= 0.75 ? "realtime" : score >= 0.50 ? "interactive" : score >= 0.25 ? "standard" : "background";
}
function _scoreToRecovery(score) {
    return score >= 0.75 ? "non_recoverable" : score >= 0.50 ? "complex" : score >= 0.25 ? "moderate" : "simple";
}
function _scoreToPressure(score) {
    return score >= 0.75 ? "critical" : score >= 0.50 ? "high" : score >= 0.25 ? "medium" : "low";
}

// ── classify ──────────────────────────────────────────────────────────

function classify(descriptor = {}) {
    const type    = descriptor.type    ?? "unknown";
    const profile = _profiles.get(type) ?? _profiles.get("unknown");

    // Allow descriptor to override/augment profile scores
    const riskScore     = _clamp((descriptor.riskScore     ?? profile.risk)     + (descriptor.riskDelta     ?? 0));
    const latencyScore  = _clamp((descriptor.latencyScore  ?? profile.latency)  + (descriptor.latencyDelta  ?? 0));
    const recoveryScore = _clamp((descriptor.recoveryScore ?? profile.recovery) + (descriptor.recoveryDelta ?? 0));
    const pressureScore = _clamp((descriptor.pressureScore ?? profile.pressure) + (descriptor.pressureDelta ?? 0));

    // Overall criticality = weighted composite
    const overall = riskScore * 0.40 + latencyScore * 0.25 + recoveryScore * 0.20 + pressureScore * 0.15;

    const classificationId = `cls-${++_counter}`;
    const result = {
        classificationId,
        type,
        riskLevel:         _scoreToRisk(riskScore),
        latencyClass:      _scoreToLatency(latencyScore),
        recoveryComplexity: _scoreToRecovery(recoveryScore),
        infrastructurePressure: _scoreToPressure(pressureScore),
        scores: {
            risk:     +riskScore.toFixed(3),
            latency:  +latencyScore.toFixed(3),
            recovery: +recoveryScore.toFixed(3),
            pressure: +pressureScore.toFixed(3),
        },
        overallCriticality: +overall.toFixed(3),
        priorityTier: overall >= 0.70 ? 1 : overall >= 0.45 ? 2 : 3,
        ts: new Date().toISOString(),
    };

    _history.push({ type, overallCriticality: result.overallCriticality, riskLevel: result.riskLevel });
    return result;
}

function _clamp(v) { return Math.min(1, Math.max(0, v)); }

// ── classifyBatch ─────────────────────────────────────────────────────

function classifyBatch(descriptors = []) {
    return descriptors.map(d => classify(d));
}

// ── getRiskProfile ────────────────────────────────────────────────────

function getRiskProfile(type) {
    const profile = _profiles.get(type);
    if (!profile) return { found: false, type };
    return { found: true, type, ...profile };
}

// ── updateProfile ─────────────────────────────────────────────────────

function updateProfile(type, feedback = {}) {
    const existing = _profiles.get(type) ?? { ..._profiles.get("unknown") };
    // Nudge profile scores toward observed outcomes (learning rate 0.1)
    const LR = 0.1;
    if (feedback.risk     != null) existing.risk     = _clamp(existing.risk     + LR * (feedback.risk     - existing.risk));
    if (feedback.latency  != null) existing.latency  = _clamp(existing.latency  + LR * (feedback.latency  - existing.latency));
    if (feedback.recovery != null) existing.recovery = _clamp(existing.recovery + LR * (feedback.recovery - existing.recovery));
    if (feedback.pressure != null) existing.pressure = _clamp(existing.pressure + LR * (feedback.pressure - existing.pressure));
    _profiles.set(type, existing);
    return { updated: true, type, profile: { ...existing } };
}

// ── getClassifierStats ────────────────────────────────────────────────

function getClassifierStats() {
    const riskDist = {};
    for (const h of _history) riskDist[h.riskLevel] = (riskDist[h.riskLevel] ?? 0) + 1;
    return {
        totalClassified: _history.length,
        knownTypes:      _profiles.size,
        riskDistribution: riskDist,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _profiles = new Map(Object.entries(DEFAULT_PROFILES).map(([k, v]) => [k, { ...v }]));
    _history  = [];
    _counter  = 0;
}

module.exports = {
    RISK_LEVELS, LATENCY_CLASSES, RECOVERY_CLASSES,
    classify, classifyBatch, getRiskProfile, updateProfile,
    getClassifierStats, reset,
};
