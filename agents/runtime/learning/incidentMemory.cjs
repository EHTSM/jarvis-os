"use strict";
/**
 * incidentMemory — incident retention, adaptive pacing evolution, decision heuristics.
 *
 * recordIncident(incident)                     → IncidentSummary
 * getRelevantIncidents(context, topN)          → IncidentSummary[]
 * evolvePacingPolicy(telemetryHistory, outcomes) → PacingPolicy
 * recommendAction(conditions)                  → ActionRecommendation
 * getMemoryStats()                             → Stats
 * reset()
 */

const MAX_INCIDENTS   = 500;
const SIMILARITY_KEYS = ["errorType", "strategy", "healthLevel", "pressureLevel"];

// Heuristic decision table: (pressure × health) → action
const HEURISTIC_TABLE = [
    { pressure: "critical", health: "critical",  action: "halt_and_escalate",    confidence: 0.95 },
    { pressure: "critical", health: "degraded",  action: "rollback_and_stabilize", confidence: 0.90 },
    { pressure: "critical", health: "warning",   action: "throttle_and_retry",   confidence: 0.85 },
    { pressure: "critical", health: "healthy",   action: "reduce_concurrency",   confidence: 0.80 },
    { pressure: "high",     health: "critical",  action: "rollback_and_stabilize", confidence: 0.85 },
    { pressure: "high",     health: "degraded",  action: "throttle_and_retry",   confidence: 0.80 },
    { pressure: "high",     health: "warning",   action: "safe_strategy",        confidence: 0.75 },
    { pressure: "high",     health: "healthy",   action: "continue_with_pacing", confidence: 0.70 },
    { pressure: "medium",   health: "critical",  action: "throttle_and_retry",   confidence: 0.75 },
    { pressure: "medium",   health: "degraded",  action: "safe_strategy",        confidence: 0.70 },
    { pressure: "medium",   health: "warning",   action: "continue_with_pacing", confidence: 0.65 },
    { pressure: "medium",   health: "healthy",   action: "normal_execution",     confidence: 0.90 },
    { pressure: "low",      health: "critical",  action: "safe_strategy",        confidence: 0.70 },
    { pressure: "low",      health: "degraded",  action: "continue_with_pacing", confidence: 0.65 },
    { pressure: "low",      health: "warning",   action: "normal_execution",     confidence: 0.80 },
    { pressure: "low",      health: "healthy",   action: "normal_execution",     confidence: 0.95 },
    { pressure: "none",     health: "healthy",   action: "fast_execution",       confidence: 0.99 },
];

let _incidents = [];
let _counter   = 0;

// ── recordIncident ────────────────────────────────────────────────────

function recordIncident(incident = {}) {
    const summary = {
        incidentId:    incident.incidentId    ?? `inc-${++_counter}`,
        errorType:     incident.errorType     ?? "unknown",
        strategy:      incident.strategy      ?? "default",
        healthLevel:   incident.healthLevel   ?? "unknown",
        pressureLevel: incident.pressureLevel ?? "unknown",
        outcome:       incident.outcome       ?? "unknown",  // resolved | escalated | unresolved
        durationMs:    incident.durationMs    ?? 0,
        recoverySteps: incident.recoverySteps ?? [],
        lessonLearned: incident.lessonLearned ?? null,
        prevention:    incident.prevention    ?? null,
        ts:            incident.ts            ?? new Date().toISOString(),
    };

    _incidents.push(summary);
    if (_incidents.length > MAX_INCIDENTS) _incidents.shift();
    return summary;
}

// ── getRelevantIncidents ──────────────────────────────────────────────

function getRelevantIncidents(context = {}, topN = 5) {
    if (_incidents.length === 0) return [];

    const scored = _incidents.map(inc => {
        let matchScore = 0;
        for (const key of SIMILARITY_KEYS) {
            if (context[key] != null && inc[key] === context[key]) matchScore++;
        }
        return { incident: inc, matchScore };
    });

    return scored
        .filter(s => s.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, topN)
        .map(s => ({ ...s.incident, relevanceScore: s.matchScore / SIMILARITY_KEYS.length }));
}

// ── evolvePacingPolicy ────────────────────────────────────────────────

function evolvePacingPolicy(telemetryHistory = [], outcomes = []) {
    // Derive pacing parameters from telemetry trends + recovery success rates
    const recentTelemetry = telemetryHistory.slice(-20);
    const recentOutcomes  = outcomes.slice(-20);

    const avgHealth = recentTelemetry.length > 0
        ? recentTelemetry.reduce((s, t) => s + (t.healthScore ?? 0.7), 0) / recentTelemetry.length
        : 0.7;

    const avgPressure = recentTelemetry.length > 0
        ? recentTelemetry.reduce((s, t) => s + (t.pressureScore ?? 0.3), 0) / recentTelemetry.length
        : 0.3;

    const successRate = recentOutcomes.length > 0
        ? recentOutcomes.filter(o => o.success).length / recentOutcomes.length
        : 0.8;

    // Derive recommended pacing interval (ms) — higher pressure = slower
    const basePaceMs    = 100;
    const pressureMult  = 1 + avgPressure * 3;   // 1× at 0 pressure → 4× at full pressure
    const healthMult    = avgHealth >= 0.8 ? 0.8 : avgHealth >= 0.6 ? 1.0 : 1.5;
    const successBonus  = successRate >= 0.9 ? 0.8 : 1.0;
    const recommendedMs = Math.round(basePaceMs * pressureMult * healthMult * successBonus);

    // Concurrency limit
    const maxConcurrency = successRate >= 0.9 && avgPressure < 0.3 ? 10
                         : successRate >= 0.7 && avgPressure < 0.6 ? 5
                         : 2;

    const strategy = avgPressure >= 0.7 ? "recovery_first"
                   : avgPressure >= 0.4 ? "safe"
                   : successRate >= 0.9  ? "fast"
                   :                       "staged";

    return {
        evolved: true,
        recommendedPaceMs: recommendedMs,
        maxConcurrency,
        strategy,
        basis: {
            avgHealth:    +avgHealth.toFixed(3),
            avgPressure:  +avgPressure.toFixed(3),
            successRate:  +successRate.toFixed(3),
            sampleCount:  recentTelemetry.length,
        },
    };
}

// ── recommendAction ───────────────────────────────────────────────────

function recommendAction(conditions = {}) {
    const pressure = conditions.pressureLevel ?? conditions.pressure ?? "low";
    const health   = conditions.healthLevel   ?? conditions.health   ?? "healthy";

    // Exact match in heuristic table
    let match = HEURISTIC_TABLE.find(r => r.pressure === pressure && r.health === health);

    // Fallback: match on pressure only
    if (!match) match = HEURISTIC_TABLE.find(r => r.pressure === pressure);

    // Final fallback
    if (!match) match = { action: "safe_strategy", confidence: 0.5 };

    // Augment confidence using relevant incident history
    const relevant = getRelevantIncidents({ pressureLevel: pressure, healthLevel: health }, 3);
    const resolvedRate = relevant.length > 0
        ? relevant.filter(i => i.outcome === "resolved").length / relevant.length
        : null;

    return {
        action:            match.action,
        confidence:        +match.confidence.toFixed(3),
        historicalSupport: relevant.length,
        resolvedRate:      resolvedRate != null ? +resolvedRate.toFixed(3) : null,
        conditions:        { pressure, health },
    };
}

// ── getMemoryStats ────────────────────────────────────────────────────

function getMemoryStats() {
    const total    = _incidents.length;
    const resolved = _incidents.filter(i => i.outcome === "resolved").length;
    const byError  = {};
    for (const i of _incidents) byError[i.errorType] = (byError[i.errorType] ?? 0) + 1;
    return {
        totalIncidents:  total,
        resolvedRate:    total > 0 ? +(resolved / total).toFixed(3) : 0,
        byErrorType:     byError,
        heuristicRules:  HEURISTIC_TABLE.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _incidents = [];
    _counter   = 0;
}

module.exports = {
    MAX_INCIDENTS, HEURISTIC_TABLE,
    recordIncident, getRelevantIncidents, evolvePacingPolicy,
    recommendAction, getMemoryStats, reset,
};
