"use strict";
/**
 * intelligenceBenchmark — scoring and maturity grading for the intelligence layer.
 *
 * scoreRoutingIntelligence(decisions, outcomes)     → RoutingScore
 * scorePredictionAccuracy(predictions, actuals)     → PredictionScore
 * scoreOptimizationImpact(before, after)            → ImpactScore
 * scoreLearningEffectiveness(cycles)                → LearningScore
 * scoreAdaptiveEfficiency(adaptations)              → AdaptiveScore
 * gradeIntelligenceMaturity(scores)                 → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "autonomous_intelligence",
    B: "adaptive_intelligence",
    C: "basic_intelligence",
    D: "reactive_only",
    F: "no_intelligence",
};

let _benchmarkHistory = [];

// ── scoreRoutingIntelligence ──────────────────────────────────────────

function scoreRoutingIntelligence(decisions = [], outcomes = []) {
    if (decisions.length === 0) return { score: 0, grade: "F", reason: "no_decisions" };

    const outcomeMap = new Map(outcomes.map(o => [o.routeId ?? o.decisionId, o]));
    let matched = 0;

    for (const d of decisions) {
        const outcome = outcomeMap.get(d.routeId ?? d.decisionId);
        if (outcome && outcome.success !== false) matched++;
    }

    const hitRate = matched / decisions.length;
    // Bonus for consistently selecting low-latency routes
    const avgScore = decisions.reduce((s, d) => s + (d.score ?? 0), 0) / decisions.length;
    const raw      = hitRate * 80 + Math.min(20, (avgScore / 100) * 20);
    const score    = +Math.min(100, raw).toFixed(1);
    const grade    = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "routing", score, ts: new Date().toISOString() });
    return { score, grade, hitRate: +hitRate.toFixed(3), decisionCount: decisions.length };
}

// ── scorePredictionAccuracy ───────────────────────────────────────────

function scorePredictionAccuracy(predictions = [], actuals = []) {
    if (predictions.length === 0) return { score: 0, grade: "F", reason: "no_predictions" };

    const pairs = Math.min(predictions.length, actuals.length);
    if (pairs === 0) return { score: 0, grade: "F", reason: "no_actuals" };

    let correct = 0;
    for (let i = 0; i < pairs; i++) {
        const pred   = predictions[i];
        const actual = actuals[i];
        // A prediction is "correct" if the predicted risk level matches actual, or the
        // predicted failure flag matches the observed failure
        const predFailed  = pred.level === "critical" || pred.level === "high" || pred.willFail === true;
        const actualFailed = actual.failed === true || actual.level === "critical" || actual.level === "high";
        if (predFailed === actualFailed) correct++;
    }

    const accuracy = correct / pairs;
    const score    = +(accuracy * 100).toFixed(1);
    const grade    = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "prediction", score, ts: new Date().toISOString() });
    return { score, grade, accuracy: +accuracy.toFixed(3), pairsEvaluated: pairs };
}

// ── scoreOptimizationImpact ───────────────────────────────────────────

function scoreOptimizationImpact(before = {}, after = {}) {
    if (!before || Object.keys(before).length === 0) return { score: 50, grade: "C", reason: "no_baseline" };

    const errImprovement  = (before.errorRate   ?? 0) - (after.errorRate   ?? 0);
    const latImprovement  = (before.avgLatencyMs ?? 0) - (after.avgLatencyMs ?? 0);
    const tpImprovement   = (after.throughputRpm ?? 0) - (before.throughputRpm ?? 0);
    const baseL           = before.avgLatencyMs ?? 1;
    const baseT           = before.throughputRpm ?? 1;

    const raw  = Math.min(100, Math.max(0,
        50 +
        errImprovement  * 200 +
        (latImprovement / baseL) * 30 +
        (tpImprovement  / baseT) * 20
    ));
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "optimization", score, ts: new Date().toISOString() });
    return { score, grade, errImprovement: +errImprovement.toFixed(3), latImprovementMs: +latImprovement.toFixed(1), tpImprovement: +tpImprovement.toFixed(1) };
}

// ── scoreLearningEffectiveness ────────────────────────────────────────

function scoreLearningEffectiveness(cycles = []) {
    if (cycles.length === 0) return { score: 0, grade: "F", reason: "no_cycles" };

    const evolved      = cycles.filter(c => c.evolved).length;
    const evolvedRate  = evolved / cycles.length;
    const promotions   = cycles.reduce((s, c) => s + (c.promotions?.length ?? 0), 0);
    const demotions    = cycles.reduce((s, c) => s + (c.demotions?.length ?? 0), 0);
    const adaptations  = promotions + demotions;
    const avgLearned   = cycles.reduce((s, c) => s + (c.executionsLearned ?? 0), 0) / cycles.length;

    const raw   = Math.min(100, evolvedRate * 60 + Math.min(20, adaptations * 5) + Math.min(20, avgLearned));
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "learning", score, ts: new Date().toISOString() });
    return { score, grade, evolvedRate: +evolvedRate.toFixed(3), cycleCount: cycles.length, totalAdaptations: adaptations };
}

// ── scoreAdaptiveEfficiency ───────────────────────────────────────────

function scoreAdaptiveEfficiency(adaptations = []) {
    if (adaptations.length === 0) return { score: 0, grade: "F", reason: "no_adaptations" };

    const effective    = adaptations.filter(a => a.improved !== false).length;
    const effectiveRate = effective / adaptations.length;
    const avgLatency   = adaptations.reduce((s, a) => s + (a.decisionMs ?? 0), 0) / adaptations.length;
    const latencyBonus = avgLatency < 10 ? 10 : avgLatency < 100 ? 5 : 0;

    const raw   = Math.min(100, effectiveRate * 90 + latencyBonus);
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "adaptive", score, ts: new Date().toISOString() });
    return { score, grade, effectiveRate: +effectiveRate.toFixed(3), avgDecisionMs: +avgLatency.toFixed(1), count: adaptations.length };
}

// ── gradeIntelligenceMaturity ─────────────────────────────────────────

function gradeIntelligenceMaturity(scores = {}) {
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
    scoreRoutingIntelligence, scorePredictionAccuracy, scoreOptimizationImpact,
    scoreLearningEffectiveness, scoreAdaptiveEfficiency, gradeIntelligenceMaturity,
    reset,
};
