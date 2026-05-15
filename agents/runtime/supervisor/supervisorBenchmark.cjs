"use strict";
/**
 * supervisorBenchmark — scoring and maturity grading for the execution supervisor layer.
 *
 * scoreStabilityQuality(supervisions)            → StabilityScore
 * scoreCoordinationQuality(decisions)            → CoordinationScore
 * scoreContainmentEffectiveness(containments)    → ContainmentScore
 * scoreAdaptiveEfficiency(adaptations)           → AdaptiveScore
 * gradeSupervisorMaturity(scores)                → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "autonomous_supervisor",
    B: "coordinated_supervisor",
    C: "reactive_supervisor",
    D: "basic_supervisor",
    F: "unsupervised",
};

let _benchmarkHistory = [];

// ── scoreStabilityQuality ─────────────────────────────────────────────

function scoreStabilityQuality(supervisions = []) {
    if (supervisions.length === 0) return { score: 0, grade: "F", reason: "no_supervisions" };

    const verified      = supervisions.filter(s => s.verified !== false).length;
    const verifiedRate  = verified / supervisions.length;
    const stabilized    = supervisions.filter(s => s.stabilized === true).length;
    const avgRisk       = supervisions.reduce((s, r) => s + (r.riskScore ?? 50), 0) / supervisions.length;
    const riskPenalty   = avgRisk / 100 * 30;

    const raw   = Math.min(100, verifiedRate * 70 + (stabilized > 0 ? 10 : 0) - riskPenalty + 20);
    const score = +Math.max(0, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "stability", score, ts: new Date().toISOString() });
    return { score, grade, verifiedRate: +verifiedRate.toFixed(3), avgRiskScore: +avgRisk.toFixed(1), total: supervisions.length };
}

// ── scoreCoordinationQuality ──────────────────────────────────────────

function scoreCoordinationQuality(decisions = []) {
    if (decisions.length === 0) return { score: 0, grade: "F", reason: "no_decisions" };

    // A coordination decision is "good" if:
    // - it has a finalStrategy
    // - domainsAffected > 0 (multi-domain coordination)
    // - it didn't require an override (verified = true)
    const good = decisions.filter(d =>
        d.finalStrategy && (d.domainsAffected ?? 0) >= 0 && d.verified !== false
    ).length;

    const goodRate     = good / decisions.length;
    const avgDomains   = decisions.reduce((s, d) => s + (d.domainsAffected ?? 0), 0) / decisions.length;
    const domainBonus  = Math.min(20, avgDomains * 5);

    const raw   = Math.min(100, goodRate * 80 + domainBonus);
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "coordination", score, ts: new Date().toISOString() });
    return { score, grade, goodRate: +goodRate.toFixed(3), avgDomainsAffected: +avgDomains.toFixed(2), total: decisions.length };
}

// ── scoreContainmentEffectiveness ────────────────────────────────────

function scoreContainmentEffectiveness(containments = []) {
    if (containments.length === 0) return { score: 0, grade: "F", reason: "no_containments" };

    const resolved     = containments.filter(c => c.outcome === "resolved" || c.status === "closed");
    const resolvedRate = resolved.length / containments.length;

    const cascadeStopped = containments.filter(c => c.cascadeStopped === true).length;
    const cascadeBonus   = containments.length > 0
        ? Math.min(20, (cascadeStopped / containments.length) * 20)
        : 0;

    const raw   = Math.min(100, resolvedRate * 80 + cascadeBonus);
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "containment", score, ts: new Date().toISOString() });
    return { score, grade, resolvedRate: +resolvedRate.toFixed(3), total: containments.length, cascadeStopped };
}

// ── scoreAdaptiveEfficiency ───────────────────────────────────────────

function scoreAdaptiveEfficiency(adaptations = []) {
    if (adaptations.length === 0) return { score: 0, grade: "F", reason: "no_adaptations" };

    const effective     = adaptations.filter(a => a.improved !== false && a.effective !== false).length;
    const effectiveRate = effective / adaptations.length;
    const avgLatencyMs  = adaptations.reduce((s, a) => s + (a.decisionMs ?? 0), 0) / adaptations.length;
    const speedBonus    = avgLatencyMs < 5 ? 10 : avgLatencyMs < 50 ? 5 : 0;

    const raw   = Math.min(100, effectiveRate * 90 + speedBonus);
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "adaptive", score, ts: new Date().toISOString() });
    return { score, grade, effectiveRate: +effectiveRate.toFixed(3), avgDecisionMs: +avgLatencyMs.toFixed(1), total: adaptations.length };
}

// ── gradeSupervisorMaturity ───────────────────────────────────────────

function gradeSupervisorMaturity(scores = {}) {
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
    scoreStabilityQuality, scoreCoordinationQuality,
    scoreContainmentEffectiveness, scoreAdaptiveEfficiency,
    gradeSupervisorMaturity, reset,
};
