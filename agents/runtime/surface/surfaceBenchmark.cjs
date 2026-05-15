"use strict";
/**
 * surfaceBenchmark — execution tracing, pressure governance, and surface maturity scoring.
 *
 * recordTrace(trace)                          → TraceRecord
 * getTraces(filter)                           → TraceRecord[]
 * evaluatePressureGovernance(pressure, executions) → GovernanceResult
 * scoreAdmissionEffectiveness(admissions)     → AdmissionScore
 * scoreVerificationCoverage(verifications)    → VerificationScore
 * scoreRollbackReliability(rollbacks)         → RollbackScore
 * scoreSandboxEfficiency(sandboxes)           → SandboxScore
 * gradeExecutionSurfaceMaturity(scores)       → MaturityGrade
 * getBenchmarkStats()                         → Stats
 * reset()
 */

const MATURITY_GRADES = {
    A: "fully_capable",
    B: "largely_capable",
    C: "partially_capable",
    D: "limited_capability",
    F: "not_capable",
};

// Pressure governance thresholds
const PRESSURE_GOVERNANCE = {
    critical: { threshold: 0.90, throttleDangerous: true,  delayNoncritical: true,  prioritizeRecovery: true  },
    high:     { threshold: 0.70, throttleDangerous: true,  delayNoncritical: true,  prioritizeRecovery: false },
    elevated: { threshold: 0.50, throttleDangerous: false, delayNoncritical: true,  prioritizeRecovery: false },
    nominal:  { threshold: 0.00, throttleDangerous: false, delayNoncritical: false, prioritizeRecovery: false },
};

const REQUIRED_TRACE_FIELDS = ["traceId", "capType", "isolationLevel", "verificationResult", "rollbackState", "runtimeConfidence"];

let _traces  = [];
let _counter = 0;

// ── recordTrace ───────────────────────────────────────────────────────

function recordTrace(trace = {}) {
    const recordId = `tr-${++_counter}`;
    const missing  = REQUIRED_TRACE_FIELDS.filter(f => trace[f] == null);

    const record = {
        recordId,
        traceId:             trace.traceId            ?? null,
        capType:             trace.capType            ?? null,
        isolationLevel:      trace.isolationLevel     ?? null,
        verificationResult:  trace.verificationResult ?? null,
        rollbackState:       trace.rollbackState      ?? null,
        runtimeConfidence:   trace.runtimeConfidence  ?? null,
        execId:              trace.execId             ?? null,
        classification:      trace.classification     ?? null,
        durationMs:          trace.durationMs         ?? null,
        surface:             trace.surface            ?? null,
        complete:            missing.length === 0,
        missingFields:       missing,
        ts:                  new Date().toISOString(),
    };

    _traces.push(record);
    if (_traces.length > 5000) _traces.shift();

    return {
        recorded:     true,
        recordId,
        complete:     record.complete,
        missingFields: missing,
    };
}

// ── getTraces ─────────────────────────────────────────────────────────

function getTraces(filter = {}) {
    let result = [..._traces];
    if (filter.capType)          result = result.filter(t => t.capType === filter.capType);
    if (filter.surface)          result = result.filter(t => t.surface === filter.surface);
    if (filter.isolationLevel)   result = result.filter(t => t.isolationLevel === filter.isolationLevel);
    if (filter.classification)   result = result.filter(t => t.classification === filter.classification);
    if (filter.complete != null) result = result.filter(t => t.complete === filter.complete);
    return result;
}

// ── evaluatePressureGovernance ────────────────────────────────────────

function evaluatePressureGovernance(pressure = 0, executions = []) {
    const band = pressure >= PRESSURE_GOVERNANCE.critical.threshold ? "critical"
               : pressure >= PRESSURE_GOVERNANCE.high.threshold     ? "high"
               : pressure >= PRESSURE_GOVERNANCE.elevated.threshold  ? "elevated"
               :                                                        "nominal";

    const rules = PRESSURE_GOVERNANCE[band];
    const governed = [];
    const violations = [];

    for (const exec of executions) {
        const classification = exec.classification ?? "safe";
        const priority       = exec.priority       ?? "standard";
        const isRecovery     = exec.isRecovery     ?? false;

        // Under critical/high: dangerous actions must be throttled
        if (rules.throttleDangerous && (classification === "dangerous" || classification === "destructive")) {
            if (!exec.throttled) {
                violations.push({ execId: exec.execId, rule: "dangerous_must_be_throttled", pressure: +pressure.toFixed(3) });
            } else {
                governed.push({ execId: exec.execId, rule: "throttled_dangerous" });
            }
        }

        // Under elevated+: noncritical must be delayed
        if (rules.delayNoncritical && priority === "background" && !isRecovery) {
            if (!exec.delayed) {
                violations.push({ execId: exec.execId, rule: "noncritical_must_be_delayed", pressure: +pressure.toFixed(3) });
            } else {
                governed.push({ execId: exec.execId, rule: "delayed_noncritical" });
            }
        }

        // Under critical: recovery operations must be prioritized (run first)
        if (rules.prioritizeRecovery && isRecovery) {
            if (!exec.prioritized) {
                violations.push({ execId: exec.execId, rule: "recovery_must_be_prioritized", pressure: +pressure.toFixed(3) });
            } else {
                governed.push({ execId: exec.execId, rule: "prioritized_recovery" });
            }
        }
    }

    const complianceRate = executions.length > 0
        ? +((governed.length) / Math.max(governed.length + violations.length, 1)).toFixed(3)
        : 1.0;

    return {
        pressure: +pressure.toFixed(3),
        band,
        throttleDangerous:   rules.throttleDangerous,
        delayNoncritical:    rules.delayNoncritical,
        prioritizeRecovery:  rules.prioritizeRecovery,
        governed:            governed.length,
        violations,
        complianceRate,
    };
}

// ── scoreAdmissionEffectiveness ───────────────────────────────────────

function scoreAdmissionEffectiveness(admissions = []) {
    if (admissions.length === 0) return { score: 0, grade: "F", reason: "no_admissions" };

    const total    = admissions.length;
    const admitted = admissions.filter(a => a.admitted === true).length;
    const rejected = total - admitted;

    // Legitimate rejects: pressure/health/confidence violations are good catches
    const legitimateRejects = admissions.filter(a =>
        !a.admitted && a.reasons && a.reasons.some(r =>
            r.includes("pressure") || r.includes("health") || r.includes("confidence") ||
            r.includes("quorum") || r.includes("isolation")
        )
    ).length;

    const admitRate     = admitted / total;
    const legitimacyRate = rejected > 0 ? legitimateRejects / rejected : 1.0;

    // Score components
    const admitScore      = admitRate <= 0.95 ? 100 : 80;     // healthy reject rate expected
    const legitimacyScore = legitimacyRate * 100;

    // Penalty: destructive admitted without quorum
    const badAdmits = admissions.filter(a =>
        a.admitted && a.classification === "destructive" && !a.quorum
    ).length;
    const penalty = Math.min(40, badAdmits * 10);

    const score = Math.max(0, Math.round((admitScore * 0.40 + legitimacyScore * 0.60) - penalty));
    return {
        score,
        grade:           _grade(score),
        total,
        admitted,
        rejected,
        legitimateRejects,
        admitRate:       +admitRate.toFixed(3),
        legitimacyRate:  +legitimacyRate.toFixed(3),
        badAdmitPenalty: penalty,
    };
}

// ── scoreVerificationCoverage ─────────────────────────────────────────

function scoreVerificationCoverage(verifications = []) {
    if (verifications.length === 0) return { score: 0, grade: "F", reason: "no_verifications" };

    const total     = verifications.length;
    const covered   = verifications.filter(v => v.outcome !== "skipped").length;
    const passed    = verifications.filter(v => v.outcome === "passed").length;
    const partial   = verifications.filter(v => v.outcome === "partial").length;
    const failed    = verifications.filter(v => v.outcome === "failed" || v.outcome === "unchanged").length;

    const coverageRate = covered / total;
    const passRate     = covered > 0 ? (passed + partial * 0.5) / covered : 0;

    // Score: coverage 50%, pass rate 50%
    const score = Math.round(coverageRate * 50 + passRate * 50);
    return {
        score,
        grade:        _grade(score),
        total,
        covered,
        passed,
        partial,
        failed,
        skipped:      total - covered,
        coverageRate: +coverageRate.toFixed(3),
        passRate:     +passRate.toFixed(3),
    };
}

// ── scoreRollbackReliability ──────────────────────────────────────────

function scoreRollbackReliability(rollbacks = []) {
    if (rollbacks.length === 0) return { score: 0, grade: "F", reason: "no_rollbacks" };

    const total      = rollbacks.length;
    const successful = rollbacks.filter(r => r.rolledBack === true || r.aborted === true || r.cancelled === true).length;
    const withState  = rollbacks.filter(r => r.restoredState && Object.keys(r.restoredState).length > 0).length;
    const withActions = rollbacks.filter(r => Array.isArray(r.actions) && r.actions.length > 0).length;

    const successRate  = successful / total;
    const stateRate    = successful > 0 ? withState / successful : 0;
    const actionRate   = successful > 0 ? withActions / successful : 0;

    const score = Math.round(successRate * 50 + stateRate * 25 + actionRate * 25);
    return {
        score,
        grade:       _grade(score),
        total,
        successful,
        withState,
        withActions,
        successRate: +successRate.toFixed(3),
        stateRate:   +stateRate.toFixed(3),
        actionRate:  +actionRate.toFixed(3),
    };
}

// ── scoreSandboxEfficiency ────────────────────────────────────────────

function scoreSandboxEfficiency(sandboxes = []) {
    if (sandboxes.length === 0) return { score: 0, grade: "F", reason: "no_sandboxes" };

    const total    = sandboxes.length;
    const clean    = sandboxes.filter(s => s.status === "exited" || s.clean === true).length;
    const violated = sandboxes.filter(s => s.status === "exited_with_violations" || s.violated === true).length;
    const active   = sandboxes.filter(s => s.status === "active").length;

    // Correct sandbox decisions: dangerous/destructive must be sandboxed
    const correctlySandboxed = sandboxes.filter(s =>
        (s.classification === "dangerous" || s.classification === "destructive") && s.sandboxed
    ).length;
    const shouldBeSandboxed  = sandboxes.filter(s =>
        s.classification === "dangerous" || s.classification === "destructive"
    ).length;

    const cleanRate    = (total - active) > 0 ? clean / (total - active) : 1.0;
    const decisionRate = shouldBeSandboxed > 0 ? correctlySandboxed / shouldBeSandboxed : 1.0;

    const score = Math.round(cleanRate * 60 + decisionRate * 40);
    return {
        score,
        grade:       _grade(score),
        total,
        clean,
        violated,
        active,
        correctlySandboxed,
        shouldBeSandboxed,
        cleanRate:   +cleanRate.toFixed(3),
        decisionRate: +decisionRate.toFixed(3),
    };
}

// ── gradeExecutionSurfaceMaturity ─────────────────────────────────────

function gradeExecutionSurfaceMaturity(scores = {}) {
    const {
        admission     = 0,
        verification  = 0,
        rollback      = 0,
        sandbox       = 0,
        traceComplete = 0,   // % of traces with all required fields [0-100]
        governance    = 0,   // compliance rate × 100
    } = scores;

    const composite = Math.round(
        admission     * 0.20 +
        verification  * 0.20 +
        rollback      * 0.15 +
        sandbox       * 0.15 +
        traceComplete * 0.15 +
        governance    * 0.15
    );

    const grade   = _grade(composite);
    const maturity = MATURITY_GRADES[grade] ?? "not_capable";

    return {
        composite,
        grade,
        maturity,
        breakdown: { admission, verification, rollback, sandbox, traceComplete, governance },
        recommendation: _maturityRecommendation(grade, scores),
    };
}

function _maturityRecommendation(grade, scores) {
    if (grade === "A") return "execution_surface_fully_operational";
    const lowest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0];
    return `improve_${lowest?.[0] ?? "coverage"}_to_advance`;
}

// ── getBenchmarkStats ─────────────────────────────────────────────────

function getBenchmarkStats() {
    const complete   = _traces.filter(t => t.complete).length;
    const bySurface  = {};
    const byIsolation = {};
    for (const t of _traces) {
        if (t.surface)         bySurface[t.surface]         = (bySurface[t.surface]         ?? 0) + 1;
        if (t.isolationLevel)  byIsolation[t.isolationLevel] = (byIsolation[t.isolationLevel] ?? 0) + 1;
    }
    return {
        totalTraces:    _traces.length,
        completeTraces: complete,
        traceCompleteRate: _traces.length > 0 ? +( complete / _traces.length).toFixed(3) : 0,
        bySurface,
        byIsolation,
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _grade(score) {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 40) return "D";
    return "F";
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _traces  = [];
    _counter = 0;
}

module.exports = {
    MATURITY_GRADES, PRESSURE_GOVERNANCE, REQUIRED_TRACE_FIELDS,
    recordTrace, getTraces,
    evaluatePressureGovernance,
    scoreAdmissionEffectiveness, scoreVerificationCoverage,
    scoreRollbackReliability, scoreSandboxEfficiency,
    gradeExecutionSurfaceMaturity,
    getBenchmarkStats, reset,
};
