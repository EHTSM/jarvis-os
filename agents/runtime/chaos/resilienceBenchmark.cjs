"use strict";
/**
 * resilienceBenchmark — stress benchmarks, chaos survival, and maturity grading.
 *
 * runStressBenchmark(executions, opts)               → BenchmarkResult
 * benchmarkRecoverySpeed(incidentTimeline)           → RecoveryBenchmark
 * scoreChaosSurvival(chaosEvents, recoveries)        → SurvivalScore
 * scoreRecoverySuccessRate(recoveries)               → SuccessRateScore
 * scoreDegradationTolerance(metrics, baseline)       → ToleranceScore
 * gradeResilienceMaturity(scores)                    → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "enterprise_grade",
    B: "production_ready",
    C: "developing",
    D: "fragile",
    F: "unstable",
};

let _benchmarkHistory = [];

// ── runStressBenchmark ────────────────────────────────────────────────

function runStressBenchmark(executions = [], _opts = {}) {
    if (executions.length === 0) return { score: 0, grade: "F", reason: "no_executions" };

    const successRate  = executions.filter(e => e.success).length / executions.length;
    const avgRetries   = executions.reduce((s, e) => s + (e.retryCount ?? 0), 0) / executions.length;
    const avgDuration  = executions.reduce((s, e) => s + (e.durationMs ?? 0), 0) / executions.length;
    const rollbackRate = executions.filter(e => e.rollbackTriggered).length / executions.length;

    const raw = Math.max(0,
        successRate  * 50 +
        Math.max(0, 20 - avgRetries   * 5) +
        Math.max(0, 20 - rollbackRate * 40) +
        (avgDuration < 1000 ? 10 : avgDuration < 5000 ? 5 : 0)
    );
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    const result = { score, grade, successRate: +successRate.toFixed(3), avgRetries: +avgRetries.toFixed(2), rollbackRate: +rollbackRate.toFixed(3), avgDuration: +avgDuration.toFixed(1), executionCount: executions.length };
    _benchmarkHistory.push({ type: "stress", result, ts: new Date().toISOString() });
    return result;
}

// ── benchmarkRecoverySpeed ────────────────────────────────────────────

function benchmarkRecoverySpeed(incidentTimeline = []) {
    if (incidentTimeline.length === 0) return { avgRecoveryMs: null, score: 0, grade: "F", reason: "no_incidents" };

    const resolved = incidentTimeline.filter(i => i.resolvedAt && i.openedAt);
    if (resolved.length === 0) return { avgRecoveryMs: null, score: 0, grade: "F", reason: "no_resolved_incidents" };

    const durations = resolved.map(i =>
        new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime()
    );
    const avgMs = durations.reduce((s, d) => s + d, 0) / durations.length;
    const p95Ms = [...durations].sort((a, b) => a - b)[Math.max(0, Math.floor(durations.length * 0.95) - 1)] ?? avgMs;

    // <1 min → 95, <5 min → 80, <15 min → 65, <1 hr → 45, else 20
    const score = avgMs < 60000    ? 95 :
                  avgMs < 300000   ? 80 :
                  avgMs < 900000   ? 65 :
                  avgMs < 3600000  ? 45 : 20;
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { avgRecoveryMs: +avgMs.toFixed(0), p95RecoveryMs: +p95Ms.toFixed(0), score, grade, resolvedCount: resolved.length };
}

// ── scoreChaosSurvival ────────────────────────────────────────────────

function scoreChaosSurvival(chaosEvents = [], recoveries = []) {
    if (chaosEvents.length === 0) return { score: 100, grade: "A", reason: "no_chaos_injected", survivalRate: 1 };

    const survived    = recoveries.filter(r => r.recovered !== false).length;
    const survivalRate = survived / chaosEvents.length;
    const critical     = chaosEvents.filter(e => e.severity === "critical").length;
    const critSurvived = recoveries.filter(r => r.severity === "critical" && r.recovered !== false).length;

    const raw = Math.min(100,
        survivalRate * 70 +
        (critical > 0 ? (critSurvived / critical) * 30 : 30)
    );
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, survivalRate: +survivalRate.toFixed(3), chaosCount: chaosEvents.length, recoveredCount: survived };
}

// ── scoreRecoverySuccessRate ──────────────────────────────────────────

function scoreRecoverySuccessRate(recoveries = []) {
    if (recoveries.length === 0) return { score: 0, grade: "F", reason: "no_recoveries" };

    const successful = recoveries.filter(r => r.success !== false && r.recovered !== false);
    const rate       = successful.length / recoveries.length;
    const score      = +( rate * 100 ).toFixed(1);
    const grade      = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, successRate: +rate.toFixed(3), total: recoveries.length, successful: successful.length };
}

// ── scoreDegradationTolerance ─────────────────────────────────────────

function scoreDegradationTolerance(metrics = {}, baseline = {}) {
    if (!baseline || Object.keys(baseline).length === 0) {
        return { score: 50, grade: "C", reason: "no_baseline" };
    }

    const errInc = (metrics.errorRate  ?? 0) - (baseline.errorRate  ?? 0);
    const baseL  = baseline.avgLatencyMs ?? 0;
    const latInc = baseL > 0 ? ((metrics.avgLatencyMs ?? 0) - baseL) / baseL : 0;
    const baseT  = baseline.throughputRpm ?? 0;
    const tpDec  = baseT > 0 ? (baseT - (metrics.throughputRpm ?? baseT)) / baseT : 0;

    const raw   = 100 - errInc * 200 - latInc * 50 - tpDec * 50;
    const score = +Math.max(0, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, errIncrease: +errInc.toFixed(3), latIncrease: +latInc.toFixed(3), tpDecrease: +tpDec.toFixed(3) };
}

// ── gradeResilienceMaturity ───────────────────────────────────────────

function gradeResilienceMaturity(scores = {}) {
    const values = Object.values(scores).filter(v => typeof v === "number");
    if (values.length === 0) return { grade: "F", score: 0, maturity: MATURITY_LEVELS.F };

    const avg   = values.reduce((s, v) => s + v, 0) / values.length;
    const grade = avg >= 90 ? "A" : avg >= 75 ? "B" : avg >= 60 ? "C" : avg >= 40 ? "D" : "F";
    return { score: +avg.toFixed(1), grade, maturity: MATURITY_LEVELS[grade], inputs: values.length };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _benchmarkHistory = []; }

module.exports = {
    MATURITY_LEVELS,
    runStressBenchmark, benchmarkRecoverySpeed, scoreChaosSurvival,
    scoreRecoverySuccessRate, scoreDegradationTolerance, gradeResilienceMaturity,
    reset,
};
