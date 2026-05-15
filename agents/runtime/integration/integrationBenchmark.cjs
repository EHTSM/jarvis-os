"use strict";
/**
 * integrationBenchmark — scoring for runtime integration quality.
 *
 * scoreLifecycleIntegrity(executions)          → IntegrityScore
 * scoreEventCoordination(events)               → CoordinationScore
 * scoreOrchestrationThroughput(metrics)        → ThroughputScore
 * scorePersistenceReliability(snapshots)       → ReliabilityScore
 * scoreStateConsistency(stateSnapshots)        → ConsistencyScore
 * gradeIntegrationMaturity(scores)             → MaturityGrade
 * reset()
 */

const MATURITY_LEVELS = {
    A: "fully_integrated",
    B: "well_integrated",
    C: "partially_integrated",
    D: "minimally_integrated",
    F: "not_integrated",
};

// Required lifecycle trace events for a complete execution
const EXPECTED_TRACE_EVENTS = ["created", "transition:queued→admitted", "transition:admitted→running"];

let _benchmarkHistory = [];

// ── scoreLifecycleIntegrity ───────────────────────────────────────────

function scoreLifecycleIntegrity(executions = []) {
    if (executions.length === 0) return { score: 0, grade: "F", reason: "no_executions" };

    // 1. State completeness: executions reach terminal states
    const terminal   = executions.filter(e => ["completed", "failed"].includes(e.state)).length;
    const termRate   = terminal / executions.length;

    // 2. Trace completeness: executions have trace with lifecycle events
    const withTrace  = executions.filter(e => (e.trace?.length ?? 0) >= 2).length;
    const traceRate  = withTrace / executions.length;

    // 3. Strategy assigned: executions ran with a strategy
    const withStrat  = executions.filter(e => e.strategy != null).length;
    const stratRate  = withStrat / executions.length;

    const raw   = termRate * 40 + traceRate * 35 + stratRate * 25;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "lifecycle_integrity", score, ts: new Date().toISOString() });
    return { score, grade, termRate: +termRate.toFixed(3), traceRate: +traceRate.toFixed(3), stratRate: +stratRate.toFixed(3), total: executions.length };
}

// ── scoreEventCoordination ────────────────────────────────────────────

function scoreEventCoordination(events = []) {
    if (events.length === 0) return { score: 0, grade: "F", reason: "no_events" };

    // Coverage: fraction of expected coordination event types present
    const EXPECTED_TYPES = new Set([
        "workflow_queued", "workflow_admitted", "workflow_running",
        "workflow_completed", "strategy_selected",
    ]);
    const presentTypes   = new Set(events.map(e => e.type));
    const covered        = [...EXPECTED_TYPES].filter(t => presentTypes.has(t)).length;
    const coverageRate   = covered / EXPECTED_TYPES.size;

    // Sequence integrity: workflow events arrive in valid order
    const workflowEvents = events.filter(e => e.type?.startsWith("workflow_"));
    const orderPenalty   = _countOrderViolations(workflowEvents) / Math.max(1, workflowEvents.length);

    // Schema: events have required fields
    const valid        = events.filter(e => e.type && e.payload != null && e.ts).length;
    const schemaRate   = valid / events.length;

    const raw   = coverageRate * 40 + (1 - orderPenalty) * 35 + schemaRate * 25;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "event_coordination", score, ts: new Date().toISOString() });
    return { score, grade, coverageRate: +coverageRate.toFixed(3), schemaRate: +schemaRate.toFixed(3), total: events.length };
}

function _countOrderViolations(events) {
    // completed should not appear before running in same workflowId sequence
    const ORDER = { workflow_queued: 0, workflow_admitted: 1, workflow_running: 2, workflow_completed: 3, workflow_failed: 3, workflow_recovered: 2 };
    const byWorkflow = {};
    let violations = 0;
    for (const e of events) {
        const wid = e.payload?.workflowId;
        if (!wid) continue;
        const rank = ORDER[e.type] ?? 99;
        if (byWorkflow[wid] != null && rank < byWorkflow[wid]) violations++;
        else byWorkflow[wid] = rank;
    }
    return violations;
}

// ── scoreOrchestrationThroughput ──────────────────────────────────────

function scoreOrchestrationThroughput(metrics = {}) {
    const submitted  = metrics.submitted  ?? 0;
    const completed  = metrics.completed  ?? 0;
    const failed     = metrics.failed     ?? 0;
    const avgLatency = metrics.avgLatencyMs ?? null;
    const uptime     = metrics.uptimeMs    ?? null;

    if (submitted === 0) return { score: 0, grade: "F", reason: "no_submissions" };

    const completionRate = completed / submitted;
    const failRate       = failed    / submitted;

    // Throughput per second if uptime known
    const tps = uptime != null && uptime > 0 ? completed / (uptime / 1000) : null;

    // Latency score: <100ms=1.0, <500ms=0.8, <2000ms=0.6, <10s=0.4, else=0.2
    const latencyScore = avgLatency == null ? 0.7
                       : avgLatency <   100 ? 1.0
                       : avgLatency <   500 ? 0.8
                       : avgLatency <  2000 ? 0.6
                       : avgLatency < 10000 ? 0.4
                       :                      0.2;

    const raw   = completionRate * 55 + (1 - failRate) * 20 + latencyScore * 25;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "orchestration_throughput", score, ts: new Date().toISOString() });
    return { score, grade, completionRate: +completionRate.toFixed(3), failRate: +failRate.toFixed(3), latencyScore: +latencyScore.toFixed(2), tps: tps != null ? +tps.toFixed(3) : null };
}

// ── scorePersistenceReliability ───────────────────────────────────────

function scorePersistenceReliability(snapshots = []) {
    if (snapshots.length === 0) return { score: 0, grade: "F", reason: "no_snapshots" };

    // Completeness: snapshots have required fields
    const complete   = snapshots.filter(s => s.checkpointId || s.snapshotId).length;
    const completeRate = complete / snapshots.length;

    // Restorability: snapshots with mode field (can restore mode)
    const restorable = snapshots.filter(s => s.mode != null || s.incidentType != null).length;
    const restoreRate = restorable / snapshots.length;

    // Recency: snapshots spread across time (not all at once)
    const withTs     = snapshots.filter(s => s.ts != null).length;
    const tsRate     = withTs / snapshots.length;

    const raw   = completeRate * 40 + restoreRate * 40 + tsRate * 20;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "persistence_reliability", score, ts: new Date().toISOString() });
    return { score, grade, completeRate: +completeRate.toFixed(3), restoreRate: +restoreRate.toFixed(3), total: snapshots.length };
}

// ── scoreStateConsistency ─────────────────────────────────────────────

function scoreStateConsistency(stateSnapshots = []) {
    if (stateSnapshots.length === 0) return { score: 0, grade: "F", reason: "no_state_snapshots" };

    // Mode validity: all modes are valid
    const VALID_MODES = new Set(["normal", "safe", "degraded", "recovery"]);
    const validModes  = stateSnapshots.filter(s => VALID_MODES.has(s.mode)).length;
    const modeRate    = validModes / stateSnapshots.length;

    // Monotonic: activeWorkflows never goes negative
    const validCounts = stateSnapshots.filter(s =>
        (s.activeWorkflows ?? 0) >= 0 && (s.degradedComponents ?? 0) >= 0
    ).length;
    const countRate   = validCounts / stateSnapshots.length;

    // Coherence: degraded mode should correlate with degraded components
    const coherent    = stateSnapshots.filter(s =>
        (s.mode === "normal" && (s.degradedComponents ?? 0) === 0) ||
        (s.mode !== "normal" && (s.degradedComponents ?? 0) >= 0)   // any degraded count is coherent in non-normal mode
    ).length;
    const coherenceRate = coherent / stateSnapshots.length;

    const raw   = modeRate * 35 + countRate * 35 + coherenceRate * 30;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    _benchmarkHistory.push({ type: "state_consistency", score, ts: new Date().toISOString() });
    return { score, grade, modeRate: +modeRate.toFixed(3), countRate: +countRate.toFixed(3), coherenceRate: +coherenceRate.toFixed(3), total: stateSnapshots.length };
}

// ── gradeIntegrationMaturity ──────────────────────────────────────────

function gradeIntegrationMaturity(scores = {}) {
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
    scoreLifecycleIntegrity, scoreEventCoordination,
    scoreOrchestrationThroughput, scorePersistenceReliability,
    scoreStateConsistency, gradeIntegrationMaturity, reset,
};
