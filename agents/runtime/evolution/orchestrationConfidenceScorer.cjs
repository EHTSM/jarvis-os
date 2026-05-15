"use strict";
/**
 * orchestrationConfidenceScorer — produces confidence scores for execution dimensions.
 *
 * score(context) → ConfidenceReport
 */

function _clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function _grade(s) {
    if (s >= 90) return "A";
    if (s >= 75) return "B";
    if (s >= 60) return "C";
    if (s >= 40) return "D";
    return "F";
}

// ── individual scorers ────────────────────────────────────────────────

function scoreExecutionSafety(fingerprint, entries = [], classification = "safe") {
    const CLASS_PENALTY = { safe: 0, elevated: 5, dangerous: 20, destructive: 40 };
    const fpEntries   = entries.filter(e => e.fingerprint === fingerprint);
    if (fpEntries.length === 0) {
        const base = _clamp(80 - (CLASS_PENALTY[classification] ?? 0));
        return { score: base, grade: _grade(base), detail: "no_history" };
    }
    const successRate  = fpEntries.filter(e => e.success).length / fpEntries.length;
    const penalty      = CLASS_PENALTY[classification] ?? 0;
    const raw          = _clamp(successRate * 80 + 20 - penalty);
    return { score: raw, grade: _grade(raw), successRate, classification };
}

function scoreDependencyReliability(depStability = {}) {
    const vals = Object.values(depStability);
    if (vals.length === 0) return { score: 100, grade: "A", detail: "no_deps" };
    const avgStab = vals.reduce((s, v) => s + (v.stability ?? 1.0), 0) / vals.length;
    const raw = _clamp(avgStab * 100);
    return { score: raw, grade: _grade(raw), avgStability: +avgStab.toFixed(3), depCount: vals.length };
}

function scoreRecoverySuccess(fingerprint, entries = []) {
    const fpEntries    = entries.filter(e => e.fingerprint === fingerprint);
    const withRollback = fpEntries.filter(e => e.rollbackTriggered);
    if (withRollback.length === 0) return { score: 100, grade: "A", detail: "no_rollbacks" };

    let recoveries = 0;
    for (let i = 0; i < fpEntries.length - 1; i++) {
        if (fpEntries[i].rollbackTriggered && fpEntries[i + 1].success) recoveries++;
    }
    const rate = recoveries / withRollback.length;
    const raw  = _clamp(rate * 100);
    return { score: raw, grade: _grade(raw), rollbacks: withRollback.length, recoveries };
}

function scoreOverloadRisk(resourceStatus = {}) {
    const PRESSURE_SCORE = { none: 5, low: 20, medium: 45, high: 70, critical: 95 };
    const raw = PRESSURE_SCORE[resourceStatus.pressure ?? "none"] ?? 5;
    return { score: raw, grade: _grade(100 - raw), pressure: resourceStatus.pressure ?? "none" };
}

function scoreRollbackProbability(fingerprint, entries = []) {
    const fpEntries = entries.filter(e => e.fingerprint === fingerprint);
    if (fpEntries.length === 0) return { score: 5, grade: "A", detail: "no_history" };
    const rollbackRate = fpEntries.filter(e => e.rollbackTriggered).length / fpEntries.length;
    const raw = _clamp(rollbackRate * 100);
    return { score: raw, grade: _grade(100 - raw), rollbackRate: +rollbackRate.toFixed(3) };
}

// ── score (main entry point) ──────────────────────────────────────────

function score(context = {}) {
    const {
        fingerprint    = null,
        entries        = [],
        depStability   = {},
        classification = "safe",
        resourceStatus = {},
    } = context;

    const fp = fingerprint ?? "";
    const executionSafety      = scoreExecutionSafety(fp, entries, classification);
    const dependencyReliability = scoreDependencyReliability(depStability);
    const recoverySuccess      = scoreRecoverySuccess(fp, entries);
    const overloadRisk         = scoreOverloadRisk(resourceStatus);
    const rollbackProbability  = scoreRollbackProbability(fp, entries);

    // Overall: weighted average of safety-oriented scores, penalised by risk/rollback
    const safetyWeighted = (
        executionSafety.score * 0.35 +
        dependencyReliability.score * 0.25 +
        recoverySuccess.score * 0.20 +
        (100 - overloadRisk.score) * 0.10 +
        (100 - rollbackProbability.score) * 0.10
    );
    const overall = { score: _clamp(safetyWeighted), grade: _grade(_clamp(safetyWeighted)) };

    return {
        overall,
        executionSafety,
        dependencyReliability,
        recoverySuccess,
        overloadRisk,
        rollbackProbability,
        ts: new Date().toISOString(),
    };
}

module.exports = {
    scoreExecutionSafety, scoreDependencyReliability, scoreRecoverySuccess,
    scoreOverloadRisk, scoreRollbackProbability, score,
};
