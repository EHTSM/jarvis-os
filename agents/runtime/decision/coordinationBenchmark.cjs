"use strict";
/**
 * coordinationBenchmark — scoring for autonomous coordination quality.
 *
 * scoreDecisionQuality(decisions)              → QualityScore
 * scoreRerouteEffectiveness(reroutes)          → EffectivenessScore
 * scoreContainmentSuccess(containments)        → ContainmentScore
 * scoreRecoveryCoordination(recoveries)        → CoordinationScore
 * scoreArbitrationFairness(arbitrations)       → FairnessScore
 * gradeAutonomyMaturity(scores)                → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "fully_autonomous",
    B: "coordinated_autonomous",
    C: "supervised_autonomous",
    D: "reactive_autonomous",
    F: "no_autonomy",
};

// Required explainability fields for decisions
const REQUIRED_DECISION_FIELDS = ["reasoning", "telemetryBasis", "confidenceLevel"];

let _benchmarkHistory = [];

// ── scoreDecisionQuality ──────────────────────────────────────────────

function scoreDecisionQuality(decisions = []) {
    if (decisions.length === 0) return { score: 0, grade: "F", reason: "no_decisions" };

    // 1. Explainability: all required fields present
    const explained = decisions.filter(d =>
        REQUIRED_DECISION_FIELDS.every(f => d[f] != null)
    ).length;
    const explainabilityRate = explained / decisions.length;

    // 2. Confidence distribution: penalise high ratio of "low" confidence decisions
    const highConfidence = decisions.filter(d => d.confidenceLevel === "high").length;
    const lowConfidence  = decisions.filter(d => d.confidenceLevel === "low").length;
    const confidenceScore = decisions.length > 0
        ? (highConfidence * 1.0 + (decisions.length - highConfidence - lowConfidence) * 0.6 + lowConfidence * 0.2) / decisions.length
        : 1;

    // 3. Reasoning depth: reasoning strings over 20 chars scored as substantive
    const substantive = decisions.filter(d => (d.reasoning ?? "").length > 20).length;
    const reasoningRate = substantive / decisions.length;

    const raw   = explainabilityRate * 40 + confidenceScore * 35 + reasoningRate * 25;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "decision_quality", score, ts: new Date().toISOString() });
    return { score, grade, explainabilityRate: +explainabilityRate.toFixed(3), confidenceScore: +confidenceScore.toFixed(3), reasoningRate: +reasoningRate.toFixed(3), total: decisions.length };
}

// ── scoreRerouteEffectiveness ─────────────────────────────────────────

function scoreRerouteEffectiveness(reroutes = []) {
    if (reroutes.length === 0) return { score: 0, grade: "F", reason: "no_reroutes" };

    const successful = reroutes.filter(r => r.rerouted === true || r.success === true).length;
    const successRate = successful / reroutes.length;

    // Quality: rerouted to healthy components (health >= 0.6)
    const toHealthy = reroutes.filter(r =>
        (r.targetHealth ?? r.componentHealth ?? 1) >= 0.6
    ).length;
    const healthRate = toHealthy / reroutes.length;

    // Speed: reroutes that had a reason (proactive) vs triggered by failure
    const proactive = reroutes.filter(r => r.proactive === true).length;
    const proactiveRate = reroutes.length > 0 ? proactive / reroutes.length : 0;

    const raw   = successRate * 50 + healthRate * 35 + proactiveRate * 15;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "reroute_effectiveness", score, ts: new Date().toISOString() });
    return { score, grade, successRate: +successRate.toFixed(3), healthRate: +healthRate.toFixed(3), proactiveRate: +proactiveRate.toFixed(3), total: reroutes.length };
}

// ── scoreContainmentSuccess ───────────────────────────────────────────

function scoreContainmentSuccess(containments = []) {
    if (containments.length === 0) return { score: 0, grade: "F", reason: "no_containments" };

    // Containment effectiveness: did it stop propagation?
    const stopped    = containments.filter(c => c.propagationStopped === true || c.effective === true).length;
    const stopRate   = stopped / containments.length;

    // Speed: contained before spread (early vs late containment)
    const early      = containments.filter(c => (c.failureRateAtTrigger ?? 1) < 0.75).length;
    const earlyRate  = early / containments.length;

    // Blast radius control: small radius = better
    const smallRadius = containments.filter(c => {
        const r = c.blastRadius ?? c.memberCount ?? Infinity;
        return r <= 5;
    }).length;
    const radiusScore = smallRadius / containments.length;

    const raw   = stopRate * 50 + earlyRate * 30 + radiusScore * 20;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "containment_success", score, ts: new Date().toISOString() });
    return { score, grade, stopRate: +stopRate.toFixed(3), earlyRate: +earlyRate.toFixed(3), radiusScore: +radiusScore.toFixed(3), total: containments.length };
}

// ── scoreRecoveryCoordination ─────────────────────────────────────────

function scoreRecoveryCoordination(recoveries = []) {
    if (recoveries.length === 0) return { score: 0, grade: "F", reason: "no_recoveries" };

    const completed   = recoveries.filter(r => r.status === "completed" || r.success === true).length;
    const completeRate = completed / recoveries.length;

    // Step efficiency: completed without excessive retries (≤ 2 failed steps = efficient)
    const efficient   = recoveries.filter(r => (r.failedSteps ?? 0) <= 2).length;
    const efficiency  = efficient / recoveries.length;

    // Multi-step coordination: bonus for trees with 3+ steps
    const coordinated = recoveries.filter(r => (r.totalSteps ?? r.stepCount ?? 1) >= 3).length;
    const coordRate   = coordinated / recoveries.length;

    const raw   = completeRate * 55 + efficiency * 30 + coordRate * 15;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "recovery_coordination", score, ts: new Date().toISOString() });
    return { score, grade, completeRate: +completeRate.toFixed(3), efficiency: +efficiency.toFixed(3), coordRate: +coordRate.toFixed(3), total: recoveries.length };
}

// ── scoreArbitrationFairness ──────────────────────────────────────────

function scoreArbitrationFairness(arbitrations = []) {
    if (arbitrations.length === 0) return { score: 0, grade: "F", reason: "no_arbitrations" };

    // Fairness 1: critical/realtime workflows are always in top admitted slots
    let criticalAdmittedCount = 0;
    let criticalTotalCount    = 0;

    for (const arb of arbitrations) {
        const admitted = arb.queue?.filter(w => w.status === "admitted") ?? [];
        const deferred = arb.queue?.filter(w => w.status === "deferred") ?? [];
        const criticalInAdmitted = admitted.filter(w => w.riskLevel === "critical" || w.latencyClass === "realtime").length;
        const criticalInDeferred = deferred.filter(w => w.riskLevel === "critical" || w.latencyClass === "realtime").length;
        criticalAdmittedCount += criticalInAdmitted;
        criticalTotalCount    += criticalInAdmitted + criticalInDeferred;
    }

    const criticalFairness = criticalTotalCount > 0 ? criticalAdmittedCount / criticalTotalCount : 1;

    // Fairness 2: non-critical workflows eventually get admitted (deferred rate not too high)
    const totalAdmitted  = arbitrations.reduce((s, a) => s + (a.admitted ?? 0), 0);
    const totalWorkflows = arbitrations.reduce((s, a) => s + ((a.admitted ?? 0) + (a.deferred ?? 0)), 0);
    const admissionRate  = totalWorkflows > 0 ? totalAdmitted / totalWorkflows : 1;

    const raw   = criticalFairness * 60 + admissionRate * 40;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "arbitration_fairness", score, ts: new Date().toISOString() });
    return { score, grade, criticalFairness: +criticalFairness.toFixed(3), admissionRate: +admissionRate.toFixed(3), total: arbitrations.length };
}

// ── gradeAutonomyMaturity ─────────────────────────────────────────────

function gradeAutonomyMaturity(scores = {}) {
    const values = Object.values(scores).filter(v => typeof v === "number");
    if (values.length === 0) return { grade: "F", score: 0, maturity: MATURITY_LEVELS.F };

    const avg   = values.reduce((s, v) => s + v, 0) / values.length;
    const grade = avg >= 90 ? "A" : avg >= 75 ? "B" : avg >= 60 ? "C" : avg >= 40 ? "D" : "F";
    return { score: +avg.toFixed(1), grade, maturity: MATURITY_LEVELS[grade], inputs: values.length };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _benchmarkHistory = []; }

module.exports = {
    MATURITY_LEVELS, REQUIRED_DECISION_FIELDS,
    scoreDecisionQuality, scoreRerouteEffectiveness,
    scoreContainmentSuccess, scoreRecoveryCoordination,
    scoreArbitrationFairness, gradeAutonomyMaturity, reset,
};
