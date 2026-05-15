"use strict";
/**
 * healthScorer — produces 0-100 health scores for the runtime.
 *
 * score(entries, depStability, opts) → HealthReport
 */

function _clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

// ── component scorers ────────────────────────────────────────────────

function scoreWorkflowStability(entries = []) {
    if (entries.length === 0) return { score: 100, grade: "A", detail: "no_history" };
    const successRate  = entries.filter(e => e.success).length / entries.length;
    const rollbackRate = entries.filter(e => e.rollbackTriggered).length / entries.length;
    const avgRetries   = entries.reduce((s, e) => s + (e.retryCount ?? 0), 0) / entries.length;
    const raw = (successRate * 60) + ((1 - rollbackRate) * 25) + (Math.max(0, 1 - avgRetries / 5) * 15);
    return { score: _clamp(raw), grade: _grade(_clamp(raw)), successRate, rollbackRate, avgRetries };
}

function scoreDependencyReliability(depStability = {}) {
    const vals = Object.values(depStability);
    if (vals.length === 0) return { score: 100, grade: "A", detail: "no_deps" };
    const avgStab = vals.reduce((s, v) => s + (v.stability ?? 1.0), 0) / vals.length;
    const raw = _clamp(avgStab * 100);
    return { score: raw, grade: _grade(raw), avgStability: avgStab, depCount: vals.length };
}

function scoreRecoveryEfficiency(entries = []) {
    if (entries.length === 0) return { score: 100, grade: "A", detail: "no_history" };
    const withRollback = entries.filter(e => e.rollbackTriggered);
    if (withRollback.length === 0) return { score: 100, grade: "A", rollbacksAttempted: 0 };
    // Recovery efficiency: how often a rollback is followed by a success
    let recoveries = 0;
    for (let i = 0; i < entries.length - 1; i++) {
        if (entries[i].rollbackTriggered && entries[i + 1].success) recoveries++;
    }
    const rate = recoveries / withRollback.length;
    const raw  = _clamp(rate * 100);
    return { score: raw, grade: _grade(raw), rollbacksAttempted: withRollback.length, recoveries };
}

function scoreTrustStability(entries = []) {
    if (entries.length === 0) return { score: 100, grade: "A", detail: "no_history" };
    // Measure variability of success: low variance = high stability
    const successRate = entries.filter(e => e.success).length / entries.length;
    // Penalize strategy churn
    const strategies   = entries.map(e => e.strategy).filter(Boolean);
    const uniqueStrats = new Set(strategies).size;
    const stratPenalty = Math.min(20, (uniqueStrats - 1) * 5);
    const raw = _clamp(successRate * 80 + 20 - stratPenalty);
    return { score: raw, grade: _grade(raw), successRate, uniqueStrategies: uniqueStrats };
}

// ── scoreOverall ──────────────────────────────────────────────────────

function scoreOverall(components = {}) {
    const weights = {
        workflowStability:     0.35,
        dependencyReliability: 0.25,
        recoveryEfficiency:    0.20,
        trustStability:        0.20,
    };
    let total = 0;
    for (const [k, w] of Object.entries(weights)) {
        total += (components[k]?.score ?? 100) * w;
    }
    const s = _clamp(total);
    return { score: s, grade: _grade(s) };
}

// ── score (main entry point) ──────────────────────────────────────────

function score(entries = [], depStability = {}, opts = {}) {
    const workflowStability     = scoreWorkflowStability(entries);
    const dependencyReliability = scoreDependencyReliability(depStability);
    const recoveryEfficiency    = scoreRecoveryEfficiency(entries);
    const trustStability        = scoreTrustStability(entries);
    const overall               = scoreOverall({ workflowStability, dependencyReliability, recoveryEfficiency, trustStability });

    return {
        overall,
        workflowStability,
        dependencyReliability,
        recoveryEfficiency,
        trustStability,
        ts: new Date().toISOString(),
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _grade(s) {
    if (s >= 90) return "A";
    if (s >= 75) return "B";
    if (s >= 60) return "C";
    if (s >= 40) return "D";
    return "F";
}

module.exports = {
    scoreWorkflowStability, scoreDependencyReliability,
    scoreRecoveryEfficiency, scoreTrustStability,
    scoreOverall, score,
};
