"use strict";
/**
 * observabilityBenchmark — scoring for the observability and replay infrastructure.
 *
 * scoreReplayReliability(replayResults)           → ReliabilityScore
 * scoreTimelineConsistency(timelines)             → ConsistencyScore
 * scoreEventCompleteness(events, expectedTypes)   → CompletenessScore
 * scoreCorrelationAccuracy(correlations, links)   → AccuracyScore
 * gradeCausalityConfidence(causalityChains)       → CausalityGrade
 * gradeObservabilityMaturity(scores)              → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "full_observability",
    B: "high_observability",
    C: "partial_observability",
    D: "minimal_observability",
    F: "blind_runtime",
};

const REQUIRED_EVENT_TYPES = [
    "execution_started",
    "execution_completed",
    "execution_failed",
    "retry_triggered",
    "rollback_triggered",
    "stabilization_activated",
    "pacing_adjusted",
    "escalation_triggered",
];

let _benchmarkHistory = [];

// ── scoreReplayReliability ────────────────────────────────────────────

function scoreReplayReliability(replayResults = []) {
    if (replayResults.length === 0) return { score: 0, grade: "F", reason: "no_replays" };

    const successful    = replayResults.filter(r => r.replayed !== false && r.status !== "failed").length;
    const successRate   = successful / replayResults.length;
    const avgAccuracy   = replayResults
        .filter(r => r.accuracy != null)
        .reduce((s, r, _, arr) => s + r.accuracy / arr.length, 0);

    const raw   = successRate * 60 + avgAccuracy * 40;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "replay_reliability", score, ts: new Date().toISOString() });
    return { score, grade, successRate: +successRate.toFixed(3), avgAccuracy: +avgAccuracy.toFixed(3), total: replayResults.length };
}

// ── scoreTimelineConsistency ──────────────────────────────────────────

function scoreTimelineConsistency(timelines = []) {
    if (timelines.length === 0) return { score: 0, grade: "F", reason: "no_timelines" };

    let consistentCount = 0;

    for (const tl of timelines) {
        const events = tl.events ?? [];
        if (events.length === 0) continue;

        // Check: events are in seqNum order
        let ordered = true;
        for (let i = 1; i < events.length; i++) {
            if ((events[i].seqNum ?? i) < (events[i - 1].seqNum ?? i - 1)) {
                ordered = false; break;
            }
        }

        // Check: timeline has a valid start and (if closed) a close time
        const hasStart   = Boolean(tl.startedAt);
        const hasClose   = tl.status !== "closed" || Boolean(tl.closedAt);
        const hasOutcome = tl.status !== "closed" || Boolean(tl.outcome);

        if (ordered && hasStart && hasClose && hasOutcome) consistentCount++;
    }

    const consistencyRate = consistentCount / timelines.length;
    const closedRate      = timelines.filter(tl => tl.status === "closed").length / timelines.length;

    const raw   = consistencyRate * 70 + closedRate * 30;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "timeline_consistency", score, ts: new Date().toISOString() });
    return { score, grade, consistencyRate: +consistencyRate.toFixed(3), closedRate: +closedRate.toFixed(3), total: timelines.length };
}

// ── scoreEventCompleteness ────────────────────────────────────────────

function scoreEventCompleteness(events = [], expectedTypes = REQUIRED_EVENT_TYPES) {
    if (events.length === 0) return { score: 0, grade: "F", reason: "no_events" };

    const presentTypes = new Set(events.map(e => e.type));
    const covered      = expectedTypes.filter(t => presentTypes.has(t)).length;
    const coverageRate = covered / expectedTypes.length;

    // Check schema integrity: all events have required fields
    const valid   = events.filter(e => e.eventId && e.type && e.seqNum != null && e.ts).length;
    const schemaRate = valid / events.length;

    const raw   = coverageRate * 60 + schemaRate * 40;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "event_completeness", score, ts: new Date().toISOString() });
    return {
        score, grade,
        coverageRate:    +coverageRate.toFixed(3),
        schemaRate:      +schemaRate.toFixed(3),
        coveredTypes:    covered,
        totalExpected:   expectedTypes.length,
        missingTypes:    expectedTypes.filter(t => !presentTypes.has(t)),
    };
}

// ── scoreCorrelationAccuracy ──────────────────────────────────────────

function scoreCorrelationAccuracy(correlations = [], links = []) {
    if (correlations.length === 0) return { score: 0, grade: "F", reason: "no_correlations" };

    // A correlation is "accurate" if it has at least one linked event or telemetry ref
    const withLinks = correlations.filter(c =>
        (c.events?.length ?? 0) > 0 || (c.telemetry?.length ?? 0) > 0
    ).length;
    const linkRate  = withLinks / correlations.length;

    // Validate provided links: each link should reference an existing correlationId
    const corrIds   = new Set(correlations.map(c => c.correlationId));
    const validLinks = links.filter(l => corrIds.has(l.correlationId)).length;
    const linkValid  = links.length > 0 ? validLinks / links.length : 1;

    const raw   = linkRate * 60 + linkValid * 40;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "correlation_accuracy", score, ts: new Date().toISOString() });
    return { score, grade, linkRate: +linkRate.toFixed(3), linkValidRate: +linkValid.toFixed(3), total: correlations.length };
}

// ── gradeCausalityConfidence ──────────────────────────────────────────

function gradeCausalityConfidence(causalityChains = []) {
    if (causalityChains.length === 0) return { score: 0, grade: "F", reason: "no_chains" };

    const found      = causalityChains.filter(c => c.found !== false).length;
    const foundRate  = found / causalityChains.length;
    const avgDepth   = causalityChains
        .filter(c => c.depth != null)
        .reduce((s, c, _, arr) => s + c.depth / arr.length, 0);
    const depthBonus = Math.min(20, avgDepth * 4);  // deeper chains = more causality captured

    const raw   = Math.min(100, foundRate * 80 + depthBonus);
    const score = +raw.toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "causality_confidence", score, ts: new Date().toISOString() });
    return { score, grade, foundRate: +foundRate.toFixed(3), avgDepth: +avgDepth.toFixed(2), total: causalityChains.length };
}

// ── gradeObservabilityMaturity ────────────────────────────────────────

function gradeObservabilityMaturity(scores = {}) {
    const values = Object.values(scores).filter(v => typeof v === "number");
    if (values.length === 0) return { grade: "F", score: 0, maturity: MATURITY_LEVELS.F };

    const avg   = values.reduce((s, v) => s + v, 0) / values.length;
    const grade = avg >= 90 ? "A" : avg >= 75 ? "B" : avg >= 60 ? "C" : avg >= 40 ? "D" : "F";
    return { score: +avg.toFixed(1), grade, maturity: MATURITY_LEVELS[grade], inputs: values.length };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _benchmarkHistory = []; }

module.exports = {
    MATURITY_LEVELS, REQUIRED_EVENT_TYPES,
    scoreReplayReliability, scoreTimelineConsistency,
    scoreEventCompleteness, scoreCorrelationAccuracy,
    gradeCausalityConfidence, gradeObservabilityMaturity, reset,
};
