"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const eventStream    = require("../../agents/runtime/observability/runtimeEventStream.cjs");
const timeline       = require("../../agents/runtime/observability/executionTimelineManager.cjs");
const wfTracker      = require("../../agents/runtime/observability/workflowStateTracker.cjs");
const telemetry      = require("../../agents/runtime/observability/runtimeTelemetryAggregator.cjs");
const metrics        = require("../../agents/runtime/observability/executionMetricsCollector.cjs");
const heatmap        = require("../../agents/runtime/observability/failureHeatmapEngine.cjs");
const health         = require("../../agents/runtime/observability/runtimeHealthMonitor.cjs");
const snapshots      = require("../../agents/runtime/observability/observabilitySnapshotEngine.cjs");
const corrGraph      = require("../../agents/runtime/observability/executionCorrelationGraph.cjs");
const visibility     = require("../../agents/runtime/observability/runtimeVisibilityController.cjs");

// ── runtimeEventStream ────────────────────────────────────────────────

describe("runtimeEventStream", () => {
    beforeEach(() => eventStream.reset());

    it("emits a valid event and returns sequenceNumber", () => {
        const r = eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        assert.equal(r.emitted, true);
        assert.equal(r.sequenceNumber, 1);
        assert.ok(r.eventId.startsWith("stream-"));
    });

    it("rejects emit without eventType", () => {
        const r = eventStream.emit({ subsystem: "executor" });
        assert.equal(r.emitted, false);
        assert.equal(r.reason, "eventType_required");
    });

    it("rejects emit without subsystem", () => {
        const r = eventStream.emit({ eventType: "system_event" });
        assert.equal(r.emitted, false);
        assert.equal(r.reason, "subsystem_required");
    });

    it("rejects invalid eventType", () => {
        const r = eventStream.emit({ eventType: "fake_type", subsystem: "executor" });
        assert.equal(r.emitted, false);
        assert.ok(r.reason.startsWith("invalid_event_type"));
    });

    it("delivers event to subscriber", () => {
        const received = [];
        eventStream.subscribe({ handler: (e) => received.push(e) });
        eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        assert.equal(received.length, 1);
        assert.equal(received[0].eventType, "execution_submitted");
    });

    it("subscriber filter prevents delivery of non-matching events", () => {
        const received = [];
        eventStream.subscribe({
            handler: (e) => received.push(e),
            filter: { eventType: "workflow_started" },
        });
        eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        assert.equal(received.length, 0);
    });

    it("subscriber filter passes matching events", () => {
        const received = [];
        eventStream.subscribe({
            handler: (e) => received.push(e),
            filter: { eventType: "workflow_started" },
        });
        eventStream.emit({ eventType: "workflow_started", subsystem: "executor" });
        assert.equal(received.length, 1);
    });

    it("unsubscribes correctly", () => {
        const received = [];
        const { subscriptionId } = eventStream.subscribe({ handler: (e) => received.push(e) });
        eventStream.unsubscribe(subscriptionId);
        eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        assert.equal(received.length, 0);
    });

    it("emitted events are frozen", () => {
        eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        const events = eventStream.getEvents();
        assert.equal(Object.isFrozen(events[0]), true);
    });

    it("getEvents returns all events", () => {
        eventStream.emit({ eventType: "execution_submitted", subsystem: "a" });
        eventStream.emit({ eventType: "execution_completed", subsystem: "b" });
        assert.equal(eventStream.getEvents().length, 2);
    });

    it("getEvents with filter returns subset", () => {
        eventStream.emit({ eventType: "execution_submitted", subsystem: "a" });
        eventStream.emit({ eventType: "workflow_started", subsystem: "a" });
        const filtered = eventStream.getEvents({ eventType: "workflow_started" });
        assert.equal(filtered.length, 1);
    });

    it("getEventById finds event", () => {
        const r = eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        const e = eventStream.getEventById(r.eventId);
        assert.ok(e);
        assert.equal(e.eventId, r.eventId);
    });

    it("sequence numbers are monotonically increasing", () => {
        for (let i = 0; i < 5; i++)
            eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        const events = eventStream.getEvents();
        for (let i = 1; i < events.length; i++)
            assert.ok(events[i].sequenceNumber > events[i - 1].sequenceNumber);
    });

    it("getStreamMetrics returns totals", () => {
        eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        eventStream.emit({ eventType: "execution_completed", subsystem: "executor" });
        const m = eventStream.getStreamMetrics();
        assert.equal(m.totalEvents, 2);
        assert.equal(m.bySubsystem["executor"], 2);
    });

    it("handler errors are isolated and do not abort emit", () => {
        eventStream.subscribe({ handler: () => { throw new Error("boom"); } });
        const r = eventStream.emit({ eventType: "execution_submitted", subsystem: "executor" });
        assert.equal(r.emitted, true);
    });
});

// ── executionTimelineManager ──────────────────────────────────────────

describe("executionTimelineManager", () => {
    beforeEach(() => timeline.reset());

    it("records a transition and creates timeline", () => {
        const r = timeline.recordTransition({ executionId: "ex-1", stage: "queued" });
        assert.equal(r.recorded, true);
        assert.equal(r.stage, "queued");
        assert.ok(r.timelineId.startsWith("tl-"));
    });

    it("rejects without executionId", () => {
        const r = timeline.recordTransition({ stage: "queued" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("rejects invalid stage", () => {
        const r = timeline.recordTransition({ executionId: "ex-1", stage: "flying" });
        assert.equal(r.recorded, false);
        assert.ok(r.reason.startsWith("invalid_stage"));
    });

    it("builds multi-stage timeline", () => {
        const ts = (offset) => new Date(1000000 + offset).toISOString();
        timeline.recordTransition({ executionId: "ex-1", stage: "queued",    timestamp: ts(0) });
        timeline.recordTransition({ executionId: "ex-1", stage: "validated", timestamp: ts(100) });
        timeline.recordTransition({ executionId: "ex-1", stage: "executing", timestamp: ts(300) });

        const tl = timeline.getTimeline("ex-1");
        assert.equal(tl.stages.length, 3);
        assert.equal(tl.stages[1].durationMs, 100);
        assert.equal(tl.stages[2].durationMs, 200);
    });

    it("marks timeline complete on terminal stage", () => {
        timeline.recordTransition({ executionId: "ex-1", stage: "queued" });
        timeline.recordTransition({ executionId: "ex-1", stage: "completed" });
        const tl = timeline.getTimeline("ex-1");
        assert.equal(tl.terminalState, "completed");
        assert.ok(tl.completedAt);
    });

    it("getStageBreakdown returns per-stage durations", () => {
        const ts = (o) => new Date(1000000 + o).toISOString();
        timeline.recordTransition({ executionId: "ex-2", stage: "queued",    timestamp: ts(0) });
        timeline.recordTransition({ executionId: "ex-2", stage: "executing", timestamp: ts(250) });
        const bd = timeline.getStageBreakdown("ex-2");
        assert.equal(bd.breakdown["executing"].durationMs, 250);
    });

    it("detectBottleneck identifies slowest stage", () => {
        const ts = (o) => new Date(1000000 + o).toISOString();
        timeline.recordTransition({ executionId: "ex-3", stage: "queued",    timestamp: ts(0) });
        timeline.recordTransition({ executionId: "ex-3", stage: "sandboxed", timestamp: ts(50) });
        timeline.recordTransition({ executionId: "ex-3", stage: "executing", timestamp: ts(1050) });  // 1000ms
        timeline.recordTransition({ executionId: "ex-3", stage: "completed", timestamp: ts(1100) });  // 50ms

        const bn = timeline.detectBottleneck("ex-3");
        assert.equal(bn.bottleneckStage, "executing");
        assert.equal(bn.durationMs, 1000);
    });

    it("getTimelinesForWorkflow returns matching timelines", () => {
        timeline.recordTransition({ executionId: "ex-4", workflowId: "wf-A", stage: "queued" });
        timeline.recordTransition({ executionId: "ex-5", workflowId: "wf-A", stage: "queued" });
        timeline.recordTransition({ executionId: "ex-6", workflowId: "wf-B", stage: "queued" });
        const tls = timeline.getTimelinesForWorkflow("wf-A");
        assert.equal(tls.length, 2);
    });

    it("getTimelineMetrics tracks completed and failed", () => {
        timeline.recordTransition({ executionId: "ex-7", stage: "queued" });
        timeline.recordTransition({ executionId: "ex-7", stage: "completed" });
        timeline.recordTransition({ executionId: "ex-8", stage: "queued" });
        timeline.recordTransition({ executionId: "ex-8", stage: "failed" });
        const m = timeline.getTimelineMetrics();
        assert.equal(m.completedCount, 1);
        assert.equal(m.failedCount, 1);
    });
});

// ── workflowStateTracker ──────────────────────────────────────────────

describe("workflowStateTracker", () => {
    beforeEach(() => wfTracker.reset());

    it("tracks a new workflow", () => {
        const r = wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        assert.equal(r.tracked, true);
        assert.equal(r.workflowId, "wf-1");
    });

    it("rejects duplicate workflow", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        const r = wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        assert.equal(r.tracked, false);
        assert.equal(r.reason, "workflow_already_tracked");
    });

    it("rejects without sourceSubsystem", () => {
        const r = wfTracker.trackWorkflow({ workflowId: "wf-1" });
        assert.equal(r.tracked, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("records execution outcomes", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        const r = wfTracker.recordExecutionOutcome({
            workflowId: "wf-1", executionId: "ex-1", outcome: "completed",
        });
        assert.equal(r.recorded, true);
        const state = wfTracker.getWorkflowState("wf-1");
        assert.equal(state.stats.completedCount, 1);
    });

    it("rejects invalid outcome", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        const r = wfTracker.recordExecutionOutcome({
            workflowId: "wf-1", executionId: "ex-1", outcome: "blasted",
        });
        assert.equal(r.recorded, false);
        assert.ok(r.reason.startsWith("invalid_outcome"));
    });

    it("auto-creates workflow on recordExecutionOutcome if not tracked", () => {
        const r = wfTracker.recordExecutionOutcome({
            workflowId: "wf-auto", executionId: "ex-1", outcome: "completed",
        });
        assert.equal(r.recorded, true);
        assert.ok(wfTracker.getWorkflowState("wf-auto"));
    });

    it("getWorkflowLineage returns execution refs", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        wfTracker.recordExecutionOutcome({ workflowId: "wf-1", executionId: "ex-1", outcome: "completed" });
        wfTracker.recordExecutionOutcome({ workflowId: "wf-1", executionId: "ex-2", outcome: "failed" });
        const lineage = wfTracker.getWorkflowLineage("wf-1");
        assert.equal(lineage.length, 2);
    });

    it("completeWorkflow transitions state", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        const r = wfTracker.completeWorkflow({ workflowId: "wf-1", finalState: "completed" });
        assert.equal(r.completed, true);
        assert.equal(wfTracker.getWorkflowState("wf-1").state, "completed");
    });

    it("cannot complete an already-completed workflow", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        wfTracker.completeWorkflow({ workflowId: "wf-1", finalState: "completed" });
        const r = wfTracker.completeWorkflow({ workflowId: "wf-1", finalState: "completed" });
        assert.equal(r.completed, false);
    });

    it("getActiveWorkflows filters to active only", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        wfTracker.trackWorkflow({ workflowId: "wf-2", sourceSubsystem: "executor" });
        wfTracker.completeWorkflow({ workflowId: "wf-2", finalState: "completed" });
        const active = wfTracker.getActiveWorkflows();
        assert.equal(active.length, 1);
        assert.equal(active[0].workflowId, "wf-1");
    });

    it("getWorkflowMetrics tracks retried and recovered", () => {
        wfTracker.trackWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        wfTracker.recordExecutionOutcome({ workflowId: "wf-1", executionId: "ex-1", outcome: "retried" });
        wfTracker.recordExecutionOutcome({ workflowId: "wf-1", executionId: "ex-2", outcome: "recovered" });
        const m = wfTracker.getWorkflowMetrics();
        assert.equal(m.totalRetried, 1);
        assert.equal(m.totalRecovered, 1);
    });
});

// ── runtimeTelemetryAggregator ────────────────────────────────────────

describe("runtimeTelemetryAggregator", () => {
    beforeEach(() => telemetry.reset());

    it("ingests a signal", () => {
        const r = telemetry.ingestSignal({
            signalType: "execution", subsystem: "executor", outcome: "success",
        });
        assert.equal(r.ingested, true);
        assert.ok(r.signalId.startsWith("sig-"));
    });

    it("rejects without signalType", () => {
        const r = telemetry.ingestSignal({ subsystem: "executor", outcome: "success" });
        assert.equal(r.ingested, false);
        assert.equal(r.reason, "signalType_required");
    });

    it("rejects invalid signalType", () => {
        const r = telemetry.ingestSignal({ signalType: "fake", subsystem: "x", outcome: "success" });
        assert.equal(r.ingested, false);
        assert.ok(r.reason.startsWith("invalid_signal_type"));
    });

    it("getSubsystemMetrics returns correct errorRate", () => {
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success" });
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success" });
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "failure" });
        const m = telemetry.getSubsystemMetrics("executor");
        assert.equal(m.totalSignals, 3);
        assert.equal(m.failureCount, 1);
        assert.ok(m.errorRate > 0);
    });

    it("getSubsystemMetrics tracks latency", () => {
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success", latencyMs: 100 });
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success", latencyMs: 200 });
        const m = telemetry.getSubsystemMetrics("executor");
        assert.equal(m.avgLatencyMs, 150);
    });

    it("getAggregatedMetrics returns byType and bySubsystem", () => {
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success" });
        telemetry.ingestSignal({ signalType: "policy",    subsystem: "policy",   outcome: "success" });
        const agg = telemetry.getAggregatedMetrics();
        assert.equal(agg.byType["execution"], 1);
        assert.equal(agg.byType["policy"],    1);
        assert.equal(agg.totalSignals, 2);
    });

    it("getSignalHistory with filter returns subset", () => {
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success" });
        telemetry.ingestSignal({ signalType: "policy",    subsystem: "policy",   outcome: "success" });
        const h = telemetry.getSignalHistory({ subsystem: "policy" });
        assert.equal(h.length, 1);
        assert.equal(h[0].subsystem, "policy");
    });

    it("getRuntimeRates computes failureRate", () => {
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "success" });
        telemetry.ingestSignal({ signalType: "execution", subsystem: "executor", outcome: "failed" });
        const rates = telemetry.getRuntimeRates();
        assert.ok(rates.failureRate > 0);
    });
});

// ── executionMetricsCollector ─────────────────────────────────────────

describe("executionMetricsCollector", () => {
    beforeEach(() => metrics.reset());

    it("records an execution", () => {
        const r = metrics.recordExecution({
            executionId: "ex-1", outcome: "completed",
            adapterType: "terminal", latencyMs: 150,
        });
        assert.equal(r.recorded, true);
        assert.ok(r.metricId.startsWith("metric-"));
    });

    it("rejects without executionId", () => {
        const r = metrics.recordExecution({ outcome: "completed" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("getLatencyDistribution returns histogram buckets", () => {
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed", latencyMs: 80 });
        metrics.recordExecution({ executionId: "ex-2", outcome: "completed", latencyMs: 200 });
        metrics.recordExecution({ executionId: "ex-3", outcome: "completed", latencyMs: 600 });
        const dist = metrics.getLatencyDistribution();
        assert.equal(dist.count, 3);
        assert.ok(dist.p50 !== null);
        assert.ok(dist.buckets["100ms"] >= 1);
    });

    it("getThroughput returns successRate", () => {
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed", latencyMs: 10 });
        metrics.recordExecution({ executionId: "ex-2", outcome: "completed", latencyMs: 10 });
        metrics.recordExecution({ executionId: "ex-3", outcome: "failed",    latencyMs: 10 });
        const t = metrics.getThroughput();
        assert.ok(t.successRate > 0);
        assert.equal(t.failedCount, 1);
    });

    it("getAdapterMetrics returns per-adapter stats", () => {
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed", adapterType: "terminal", latencyMs: 100 });
        metrics.recordExecution({ executionId: "ex-2", outcome: "failed",    adapterType: "terminal", latencyMs: 200 });
        const am = metrics.getAdapterMetrics("terminal");
        assert.equal(am.total, 2);
        assert.equal(am.failed, 1);
    });

    it("getAuthorityMetrics tracks authority distribution", () => {
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed", authorityLevel: "operator" });
        metrics.recordExecution({ executionId: "ex-2", outcome: "completed", authorityLevel: "controller" });
        const am = metrics.getAuthorityMetrics();
        assert.equal(am.distribution["operator"], 1);
        assert.equal(am.distribution["controller"], 1);
    });

    it("getCollectorMetrics tracks replayed and dryRun", () => {
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed", replayed: true });
        metrics.recordExecution({ executionId: "ex-2", outcome: "completed", dryRun: true });
        const cm = metrics.getCollectorMetrics();
        assert.equal(cm.replayedCount, 1);
        assert.equal(cm.dryRunCount, 1);
    });

    it("latency distribution with filter by adapterType", () => {
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed", adapterType: "terminal",   latencyMs: 50 });
        metrics.recordExecution({ executionId: "ex-2", outcome: "completed", adapterType: "filesystem", latencyMs: 300 });
        const dist = metrics.getLatencyDistribution({ adapterType: "terminal" });
        assert.equal(dist.count, 1);
        assert.equal(dist.max, 50);
    });
});

// ── failureHeatmapEngine ──────────────────────────────────────────────

describe("failureHeatmapEngine", () => {
    beforeEach(() => heatmap.reset());

    it("records a failure", () => {
        const r = heatmap.recordFailure({
            failureType: "execution_error", adapterType: "terminal", subsystem: "executor",
        });
        assert.equal(r.recorded, true);
        assert.ok(r.failureId.startsWith("hf-"));
    });

    it("rejects without adapterType and subsystem", () => {
        const r = heatmap.recordFailure({ failureType: "timeout" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "adapterType_or_subsystem_required");
    });

    it("rejects invalid failureType", () => {
        const r = heatmap.recordFailure({ failureType: "blowing_up", adapterType: "terminal" });
        assert.equal(r.recorded, false);
        assert.ok(r.reason.startsWith("invalid_failure_type"));
    });

    it("getHeatmapByAdapter returns sorted rows", () => {
        heatmap.recordFailure({ failureType: "timeout",         adapterType: "terminal",   subsystem: "executor" });
        heatmap.recordFailure({ failureType: "execution_error", adapterType: "terminal",   subsystem: "executor" });
        heatmap.recordFailure({ failureType: "timeout",         adapterType: "filesystem", subsystem: "executor" });
        const rows = heatmap.getHeatmapByAdapter();
        assert.equal(rows[0].key, "terminal");   // most failures
        assert.equal(rows[0].totalFailures, 2);
    });

    it("getHeatmapBySubsystem aggregates by subsystem", () => {
        heatmap.recordFailure({ failureType: "timeout", adapterType: "terminal", subsystem: "executor" });
        heatmap.recordFailure({ failureType: "timeout", adapterType: "terminal", subsystem: "executor" });
        const rows = heatmap.getHeatmapBySubsystem();
        assert.equal(rows[0].totalFailures, 2);
    });

    it("getTopHotspots returns top-N", () => {
        for (let i = 0; i < 5; i++)
            heatmap.recordFailure({ failureType: "timeout", adapterType: "terminal", subsystem: "executor" });
        for (let i = 0; i < 2; i++)
            heatmap.recordFailure({ failureType: "timeout", adapterType: "git", subsystem: "vcs" });

        const hotspots = heatmap.getTopHotspots(3);
        assert.ok(hotspots.length <= 3);
        assert.ok(hotspots[0].count >= hotspots[1]?.count ?? 0);
    });

    it("getHeatmapByTimeBucket groups by time bucket", () => {
        heatmap.recordFailure({ failureType: "timeout", adapterType: "terminal", timestamp: new Date(1000000).toISOString() });
        heatmap.recordFailure({ failureType: "timeout", adapterType: "terminal", timestamp: new Date(1000001).toISOString() });
        heatmap.recordFailure({ failureType: "timeout", adapterType: "terminal", timestamp: new Date(2000000).toISOString() });
        const buckets = heatmap.getHeatmapByTimeBucket(60000);
        assert.ok(buckets.length >= 1);
    });

    it("getHeatmapMetrics returns totals", () => {
        heatmap.recordFailure({ failureType: "timeout",         adapterType: "terminal", subsystem: "executor" });
        heatmap.recordFailure({ failureType: "execution_error", adapterType: "terminal", subsystem: "executor" });
        const m = heatmap.getHeatmapMetrics();
        assert.equal(m.totalFailures, 2);
        assert.equal(m.byType["timeout"], 1);
    });
});

// ── runtimeHealthMonitor ──────────────────────────────────────────────

describe("runtimeHealthMonitor", () => {
    beforeEach(() => health.reset());

    it("reports a health signal", () => {
        const r = health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        assert.equal(r.reported, true);
        assert.ok(r.signalId.startsWith("hs-"));
    });

    it("rejects without subsystem", () => {
        const r = health.reportHealthSignal({ outcome: "success" });
        assert.equal(r.reported, false);
        assert.equal(r.reason, "subsystem_required");
    });

    it("getSubsystemHealth returns healthy for all-success signals", () => {
        for (let i = 0; i < 5; i++)
            health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        const h = health.getSubsystemHealth("executor");
        assert.equal(h.state, "healthy");
        assert.ok(h.score >= 0.8);
    });

    it("getSubsystemHealth returns degraded for high failure rate", () => {
        for (let i = 0; i < 2; i++)
            health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        for (let i = 0; i < 8; i++)
            health.reportHealthSignal({ subsystem: "executor", outcome: "failure" });
        const h = health.getSubsystemHealth("executor");
        assert.ok(h.state === "degraded" || h.state === "critical");
    });

    it("getRuntimeHealth aggregates across subsystems", () => {
        health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        health.reportHealthSignal({ subsystem: "policy",   outcome: "success" });
        const h = health.getRuntimeHealth();
        assert.ok(h.score > 0);
        assert.equal(h.subsystemCount, 2);
    });

    it("detectDegradation returns only degraded/critical subsystems", () => {
        for (let i = 0; i < 10; i++)
            health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        for (let i = 0; i < 10; i++)
            health.reportHealthSignal({ subsystem: "broken",   outcome: "failure" });
        const degraded = health.detectDegradation();
        assert.ok(degraded.some(d => d.subsystem === "broken"));
        assert.ok(!degraded.some(d => d.subsystem === "executor"));
    });

    it("getHealthHistory returns history entries", () => {
        health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        health.getRuntimeHealth();  // triggers history record
        const hist = health.getHealthHistory();
        assert.ok(hist.length >= 1);
    });

    it("getHealthMetrics returns current state", () => {
        health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        const m = health.getHealthMetrics();
        assert.ok("currentScore" in m);
        assert.ok("currentState" in m);
    });
});

// ── observabilitySnapshotEngine ───────────────────────────────────────

describe("observabilitySnapshotEngine", () => {
    beforeEach(() => snapshots.reset());

    it("captures a snapshot", () => {
        const r = snapshots.captureSnapshot({
            source: "test", payload: { count: 5, state: "healthy" },
        });
        assert.equal(r.captured, true);
        assert.ok(r.snapshotId.startsWith("snap-"));
    });

    it("rejects without source", () => {
        const r = snapshots.captureSnapshot({ payload: { a: 1 } });
        assert.equal(r.captured, false);
        assert.equal(r.reason, "source_required");
    });

    it("rejects without payload", () => {
        const r = snapshots.captureSnapshot({ source: "test" });
        assert.equal(r.captured, false);
        assert.equal(r.reason, "payload_required");
    });

    it("snapshot payload is frozen (immutable)", () => {
        const r = snapshots.captureSnapshot({ source: "test", payload: { x: 1 } });
        const s = snapshots.getSnapshot(r.snapshotId);
        assert.equal(Object.isFrozen(s), true);
        assert.equal(Object.isFrozen(s.payload), true);
    });

    it("getLatestSnapshot returns most recent", () => {
        snapshots.captureSnapshot({ source: "test", payload: { v: 1 } });
        snapshots.captureSnapshot({ source: "test", payload: { v: 2 } });
        const latest = snapshots.getLatestSnapshot();
        assert.equal(latest.payload.v, 2);
    });

    it("getLatestSnapshot filtered by tag", () => {
        snapshots.captureSnapshot({ source: "test", tag: "alpha", payload: { v: 1 } });
        snapshots.captureSnapshot({ source: "test", tag: "beta",  payload: { v: 2 } });
        const alpha = snapshots.getLatestSnapshot("alpha");
        assert.equal(alpha.payload.v, 1);
    });

    it("diffSnapshots detects changed keys", () => {
        const a = snapshots.captureSnapshot({ source: "test", payload: { count: 5, state: "ok" } });
        const b = snapshots.captureSnapshot({ source: "test", payload: { count: 7, state: "ok" } });
        const diff = snapshots.diffSnapshots(a.snapshotId, b.snapshotId);
        assert.equal(diff.hasChanges, true);
        assert.ok("count" in diff.changed);
    });

    it("diffSnapshots detects added and removed keys", () => {
        const a = snapshots.captureSnapshot({ source: "test", payload: { x: 1 } });
        const b = snapshots.captureSnapshot({ source: "test", payload: { y: 2 } });
        const diff = snapshots.diffSnapshots(a.snapshotId, b.snapshotId);
        assert.ok("x" in diff.removed);
        assert.ok("y" in diff.added);
    });

    it("listSnapshots with filter by source", () => {
        snapshots.captureSnapshot({ source: "engine-A", payload: { v: 1 } });
        snapshots.captureSnapshot({ source: "engine-B", payload: { v: 2 } });
        const list = snapshots.listSnapshots({ source: "engine-A" });
        assert.equal(list.length, 1);
    });

    it("pruneSnapshots removes old entries", () => {
        snapshots.captureSnapshot({ source: "test", payload: {}, timestamp: new Date(1000).toISOString() });
        snapshots.captureSnapshot({ source: "test", payload: {}, timestamp: new Date(2000).toISOString() });
        const r = snapshots.pruneSnapshots(1);  // 1ms max age — both are old
        assert.ok(r.pruned >= 2);
    });

    it("getSnapshotMetrics reports bySource", () => {
        snapshots.captureSnapshot({ source: "engine-A", payload: { v: 1 } });
        snapshots.captureSnapshot({ source: "engine-A", payload: { v: 2 } });
        snapshots.captureSnapshot({ source: "engine-B", payload: { v: 3 } });
        const m = snapshots.getSnapshotMetrics();
        assert.equal(m.bySource["engine-A"], 2);
        assert.equal(m.totalSnapshots, 3);
    });
});

// ── executionCorrelationGraph ─────────────────────────────────────────

describe("executionCorrelationGraph", () => {
    beforeEach(() => corrGraph.reset());

    it("links an execution node", () => {
        const r = corrGraph.linkExecution({ executionId: "ex-1", correlationId: "corr-A" });
        assert.equal(r.linked, true);
        assert.ok(r.nodeId.startsWith("gn-"));
    });

    it("rejects without executionId", () => {
        const r = corrGraph.linkExecution({ correlationId: "corr-A" });
        assert.equal(r.linked, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("getCorrelatedExecutions returns all nodes with same correlationId", () => {
        corrGraph.linkExecution({ executionId: "ex-1", correlationId: "corr-A" });
        corrGraph.linkExecution({ executionId: "ex-2", correlationId: "corr-A" });
        corrGraph.linkExecution({ executionId: "ex-3", correlationId: "corr-B" });
        const nodes = corrGraph.getCorrelatedExecutions("corr-A");
        assert.equal(nodes.length, 2);
    });

    it("parent-child relationship wired automatically", () => {
        corrGraph.linkExecution({ executionId: "ex-1" });
        corrGraph.linkExecution({ executionId: "ex-2", parentExecutionId: "ex-1" });
        const children = corrGraph.getChildren("ex-1");
        assert.equal(children.length, 1);
        assert.equal(children[0].executionId, "ex-2");
    });

    it("getAncestors returns parent chain", () => {
        corrGraph.linkExecution({ executionId: "ex-1" });
        corrGraph.linkExecution({ executionId: "ex-2", parentExecutionId: "ex-1" });
        corrGraph.linkExecution({ executionId: "ex-3", parentExecutionId: "ex-2" });
        const ancestors = corrGraph.getAncestors("ex-3");
        assert.equal(ancestors.length, 2);
        assert.equal(ancestors[0].executionId, "ex-2");
        assert.equal(ancestors[1].executionId, "ex-1");
    });

    it("getDescendants returns full subtree", () => {
        corrGraph.linkExecution({ executionId: "ex-1" });
        corrGraph.linkExecution({ executionId: "ex-2", parentExecutionId: "ex-1" });
        corrGraph.linkExecution({ executionId: "ex-3", parentExecutionId: "ex-2" });
        const desc = corrGraph.getDescendants("ex-1");
        assert.equal(desc.length, 2);
    });

    it("addCorrelationEdge records edge", () => {
        corrGraph.linkExecution({ executionId: "ex-1", correlationId: "corr-A" });
        corrGraph.linkExecution({ executionId: "ex-2", correlationId: "corr-A" });
        const r = corrGraph.addCorrelationEdge({
            fromExecutionId: "ex-1", toExecutionId: "ex-2",
            edgeType: "retry", correlationId: "corr-A",
        });
        assert.equal(r.added, true);
        assert.ok(r.edgeId.startsWith("ge-"));
    });

    it("getChain returns nodes and edges for correlation", () => {
        corrGraph.linkExecution({ executionId: "ex-1", correlationId: "corr-A" });
        corrGraph.linkExecution({ executionId: "ex-2", correlationId: "corr-A" });
        corrGraph.addCorrelationEdge({
            fromExecutionId: "ex-1", toExecutionId: "ex-2",
            edgeType: "retry", correlationId: "corr-A",
        });
        const chain = corrGraph.getChain("corr-A");
        assert.equal(chain.nodeCount, 2);
        assert.equal(chain.edgeCount, 1);
    });

    it("getGraphMetrics counts nodes and correlations", () => {
        corrGraph.linkExecution({ executionId: "ex-1", correlationId: "corr-A" });
        corrGraph.linkExecution({ executionId: "ex-2", correlationId: "corr-A" });
        corrGraph.linkExecution({ executionId: "ex-3", correlationId: "corr-B" });
        const m = corrGraph.getGraphMetrics();
        assert.equal(m.totalNodes, 3);
        assert.equal(m.correlationCount, 2);
    });
});

// ── runtimeVisibilityController ───────────────────────────────────────

describe("runtimeVisibilityController", () => {
    beforeEach(() => {
        visibility.reset();
        eventStream.reset();
        telemetry.reset();
        metrics.reset();
        heatmap.reset();
        health.reset();
        snapshots.reset();
        corrGraph.reset();
    });

    it("configure wires modules", () => {
        const r = visibility.configure({
            eventStream, telemetryAggregator: telemetry,
            metricsCollector: metrics, healthMonitor: health,
        });
        assert.equal(r.configured, true);
        assert.ok(r.modules.includes("eventStream"));
        assert.ok(r.modules.includes("healthMonitor"));
    });

    it("recordEvent fans out to eventStream", () => {
        visibility.configure({ eventStream });
        const r = visibility.recordEvent({
            eventType: "execution_submitted", subsystem: "executor", executionId: "ex-1",
        });
        assert.equal(r.recorded, true);
        assert.ok(r.results.stream?.emitted === true);
    });

    it("recordEvent fans out to telemetryAggregator on outcome", () => {
        visibility.configure({ telemetryAggregator: telemetry });
        visibility.recordEvent({
            eventType: "execution_completed", subsystem: "executor",
            executionId: "ex-1", outcome: "completed",
        });
        const agg = telemetry.getAggregatedMetrics();
        assert.equal(agg.totalSignals, 1);
    });

    it("recordEvent fans out to metricsCollector on outcome", () => {
        visibility.configure({ metricsCollector: metrics });
        visibility.recordEvent({
            eventType: "execution_completed", subsystem: "executor",
            executionId: "ex-1", outcome: "completed",
        });
        const cm = metrics.getCollectorMetrics();
        assert.equal(cm.totalRecords, 1);
    });

    it("recordEvent records failure in heatmap", () => {
        visibility.configure({ heatmapEngine: heatmap });
        visibility.recordEvent({
            eventType: "execution_failed", subsystem: "executor",
            executionId: "ex-1", adapterType: "terminal", outcome: "failed",
        });
        const m = heatmap.getHeatmapMetrics();
        assert.equal(m.totalFailures, 1);
    });

    it("recordEvent links to correlationGraph with correlationId", () => {
        visibility.configure({ correlationGraph: corrGraph });
        visibility.recordEvent({
            eventType: "execution_submitted", subsystem: "executor",
            executionId: "ex-1", correlationId: "corr-X",
        });
        const nodes = corrGraph.getCorrelatedExecutions("corr-X");
        assert.equal(nodes.length, 1);
    });

    it("captureRuntimeSnapshot creates immutable snapshot", () => {
        visibility.configure({ snapshotEngine: snapshots, metricsCollector: metrics });
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed" });
        const r = visibility.captureRuntimeSnapshot();
        assert.equal(r.captured, true);
        const snap = snapshots.getSnapshot(r.snapshotId);
        assert.equal(Object.isFrozen(snap), true);
    });

    it("captureRuntimeSnapshot fails if snapshotEngine not configured", () => {
        visibility.configure({ metricsCollector: metrics });
        const r = visibility.captureRuntimeSnapshot();
        assert.equal(r.captured, false);
        assert.equal(r.reason, "snapshotEngine_not_configured");
    });

    it("getVisibilityReport includes configured module data", () => {
        visibility.configure({ metricsCollector: metrics, healthMonitor: health });
        health.reportHealthSignal({ subsystem: "executor", outcome: "success" });
        metrics.recordExecution({ executionId: "ex-1", outcome: "completed" });
        const report = visibility.getVisibilityReport();
        assert.ok("executions" in report);
        assert.ok("health" in report);
    });

    it("enforceRetention prunes old controller events", () => {
        visibility.configure({});
        const oldTs = new Date(1000).toISOString();   // epoch+1s — definitively old
        visibility.recordEvent({ eventType: "execution_submitted", subsystem: "executor", timestamp: oldTs });
        visibility.recordEvent({ eventType: "execution_completed", subsystem: "executor", timestamp: oldTs });
        const r = visibility.enforceRetention({ maxAgeMs: 1000, maxEvents: 100000 });
        assert.ok(r.pruned >= 2);
    });

    it("recordEvent without configure still records to own log", () => {
        const r = visibility.recordEvent({
            eventType: "execution_submitted", subsystem: "executor",
        });
        assert.equal(r.recorded, true);
        const m = visibility.getVisibilityMetrics();
        assert.equal(m.controllerEvents, 1);
    });

    it("end-to-end: multi-module execution visibility simulation", () => {
        visibility.configure({
            eventStream,
            telemetryAggregator: telemetry,
            metricsCollector:    metrics,
            healthMonitor:       health,
            heatmapEngine:       heatmap,
            correlationGraph:    corrGraph,
            snapshotEngine:      snapshots,
        });

        // Simulate 3 executions in a workflow
        for (let i = 1; i <= 3; i++) {
            visibility.recordEvent({
                eventType: "execution_submitted", subsystem: "executor",
                executionId: `ex-${i}`, workflowId: "wf-sim",
                correlationId: "corr-sim", adapterType: "terminal",
            });
        }
        // Two succeed, one fails
        visibility.recordEvent({
            eventType: "execution_completed", subsystem: "executor",
            executionId: "ex-1", workflowId: "wf-sim", correlationId: "corr-sim",
            adapterType: "terminal", outcome: "completed", latencyMs: 120,
        });
        visibility.recordEvent({
            eventType: "execution_completed", subsystem: "executor",
            executionId: "ex-2", workflowId: "wf-sim", correlationId: "corr-sim",
            adapterType: "terminal", outcome: "completed", latencyMs: 95,
        });
        visibility.recordEvent({
            eventType: "execution_failed", subsystem: "executor",
            executionId: "ex-3", workflowId: "wf-sim", correlationId: "corr-sim",
            adapterType: "terminal", outcome: "failed", latencyMs: 3000,
        });

        const report = visibility.getVisibilityReport();
        assert.ok(report.executions.totalRecords >= 2);   // metrics records completed outcomes
        assert.ok(report.telemetry.totalSignals >= 2);

        const chain = corrGraph.getChain("corr-sim");
        assert.ok(chain.nodeCount >= 3);

        const snap = visibility.captureRuntimeSnapshot();
        assert.equal(snap.captured, true);
        const s = snapshots.getSnapshot(snap.snapshotId);
        assert.ok(s.payload.executionMetrics.totalRecords >= 2);
    });
});
