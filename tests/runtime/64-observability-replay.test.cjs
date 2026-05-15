"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const es    = require("../../agents/runtime/observability/eventStream.cjs");
const tl    = require("../../agents/runtime/observability/executionTimeline.cjs");
const rpl   = require("../../agents/runtime/observability/replayEngine.cjs");
const corr  = require("../../agents/runtime/observability/correlationTracker.cjs");
const cmp   = require("../../agents/runtime/observability/telemetryCompressor.cjs");
const bench = require("../../agents/runtime/observability/observabilityBenchmark.cjs");

afterEach(() => {
    es.reset();
    tl.reset();
    rpl.reset();
    corr.reset();
    cmp.reset();
    bench.reset();
});

// ── helpers ───────────────────────────────────────────────────────────

function _evt(type, overrides = {}) {
    return {
        eventId:  overrides.eventId  ?? `evt-${Math.random().toString(36).slice(2)}`,
        type,
        seqNum:   overrides.seqNum   ?? 1,
        ts:       overrides.ts       ?? new Date().toISOString(),
        payload:  overrides.payload  ?? {},
        parentEventId: overrides.parentEventId ?? null,
        annotations:   [],
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// eventStream
// ═══════════════════════════════════════════════════════════════════════

describe("eventStream — emit", () => {
    it("emits all 8 supported event types", () => {
        for (const type of es.EVENT_TYPES) {
            const r = es.emit(type, {}, {});
            assert.equal(r.emitted, true, `${type} should emit`);
        }
    });

    it("rejects unknown event type", () => {
        const r = es.emit("unknown_event", {});
        assert.equal(r.emitted, false);
        assert.equal(r.reason, "unknown_event_type");
    });

    it("assigns monotonically increasing seqNum", () => {
        const r1 = es.emit("execution_started", {});
        const r2 = es.emit("execution_completed", {});
        assert.ok(r2.seqNum > r1.seqNum);
    });

    it("stores correlationId and sessionId from opts", () => {
        es.emit("execution_started", {}, { correlationId: "corr-1", sessionId: "sess-1" });
        const events = es.getEventsBySession("sess-1");
        assert.equal(events.length, 1);
        assert.equal(events[0].correlationId, "corr-1");
    });

    it("stores parentEventId from opts", () => {
        const r1 = es.emit("execution_started", {}, { sessionId: "s1" });
        es.emit("execution_failed", {}, { sessionId: "s1", parentEventId: r1.eventId });
        const events = es.getEventsBySession("s1");
        assert.equal(events[1].parentEventId, r1.eventId);
    });
});

describe("eventStream — subscribe", () => {
    it("receives events synchronously via handler", () => {
        const received = [];
        const unsub = es.subscribe("execution_failed", e => received.push(e));
        es.emit("execution_started",  {});
        es.emit("execution_failed",   {});
        es.emit("execution_completed",{});
        assert.equal(received.length, 1);
        assert.equal(received[0].type, "execution_failed");
        unsub();
    });

    it("unsubscribe stops further delivery", () => {
        const received = [];
        const unsub = es.subscribe("retry_triggered", e => received.push(e));
        es.emit("retry_triggered", {});
        unsub();
        es.emit("retry_triggered", {});
        assert.equal(received.length, 1);
    });

    it("multiple handlers for same type all fire", () => {
        const hits = [];
        es.subscribe("rollback_triggered", () => hits.push(1));
        es.subscribe("rollback_triggered", () => hits.push(2));
        es.emit("rollback_triggered", {});
        assert.equal(hits.length, 2);
    });
});

describe("eventStream — getEvents / getEventsByCorrelation", () => {
    it("getEvents returns all events in order", () => {
        es.emit("execution_started",   {}, { sessionId: "s" });
        es.emit("execution_completed", {}, { sessionId: "s" });
        const evts = es.getEvents();
        assert.equal(evts.length, 2);
        assert.ok(evts[0].seqNum < evts[1].seqNum);
    });

    it("getEvents filters by type", () => {
        es.emit("execution_started",   {}, {});
        es.emit("execution_failed",    {}, {});
        es.emit("execution_completed", {}, {});
        const failed = es.getEvents({ type: "execution_failed" });
        assert.equal(failed.length, 1);
    });

    it("getEvents filters by since seqNum", () => {
        const r1 = es.emit("execution_started",  {});
        es.emit("execution_failed",    {});
        const r3 = es.emit("retry_triggered",    {});
        const later = es.getEvents({ since: r1.seqNum + 1 });
        assert.equal(later.length, 2);
        assert.ok(later[0].seqNum >= r1.seqNum + 1);
    });

    it("getEventsByCorrelation returns all events sharing correlationId", () => {
        es.emit("execution_started",   {}, { correlationId: "c-42" });
        es.emit("retry_triggered",     {}, { correlationId: "c-42" });
        es.emit("execution_completed", {}, { correlationId: "c-99" });
        const group = es.getEventsByCorrelation("c-42");
        assert.equal(group.length, 2);
    });
});

describe("eventStream — annotateEvent", () => {
    it("adds annotation to event", () => {
        const r = es.emit("execution_failed", {});
        es.annotateEvent(r.eventId, "anomaly:high_retry_spike");
        const evts = es.getEvents({ type: "execution_failed" });
        assert.ok(evts[0].annotations.includes("anomaly:high_retry_spike"));
    });

    it("returns not found for unknown eventId", () => {
        const r = es.annotateEvent("ghost-evt", "test");
        assert.equal(r.annotated, false);
    });

    it("multiple annotations accumulate", () => {
        const r = es.emit("escalation_triggered", {});
        es.annotateEvent(r.eventId, "ann-1");
        es.annotateEvent(r.eventId, "ann-2");
        const evts = es.getEvents({ type: "escalation_triggered" });
        assert.equal(evts[0].annotations.length, 2);
    });
});

describe("eventStream — getStats", () => {
    it("tracks total events and type counts", () => {
        es.emit("execution_started",   {}, { sessionId: "s1", correlationId: "c1" });
        es.emit("execution_failed",    {}, { sessionId: "s1", correlationId: "c1" });
        es.emit("retry_triggered",     {}, { sessionId: "s2", correlationId: "c2" });
        const s = es.getStats();
        assert.equal(s.totalEvents, 3);
        assert.equal(s.typeCounts.execution_started, 1);
        assert.equal(s.typeCounts.execution_failed, 1);
        assert.equal(s.uniqueSessions, 2);
        assert.equal(s.uniqueCorrelations, 2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// executionTimeline
// ═══════════════════════════════════════════════════════════════════════

describe("executionTimeline — startTimeline", () => {
    it("creates a new open timeline", () => {
        const r = tl.startTimeline("sess-1");
        assert.equal(r.started, true);
        assert.equal(r.timeline.status, "open");
    });

    it("rejects duplicate sessionId", () => {
        tl.startTimeline("sess-dup");
        const r = tl.startTimeline("sess-dup");
        assert.equal(r.started, false);
        assert.equal(r.reason, "session_already_exists");
    });
});

describe("executionTimeline — recordEvent", () => {
    it("records events into a timeline", () => {
        tl.startTimeline("s1");
        tl.recordEvent("s1", _evt("execution_started", { seqNum: 1 }));
        tl.recordEvent("s1", _evt("execution_completed", { seqNum: 2 }));
        const stats = tl.getTimelineStats("s1");
        assert.equal(stats.eventCount, 2);
    });

    it("returns session_not_found for unknown session", () => {
        const r = tl.recordEvent("ghost", _evt("execution_started"));
        assert.equal(r.recorded, false);
    });

    it("rejects recording into closed timeline", () => {
        tl.startTimeline("s-closed");
        tl.closeTimeline("s-closed");
        const r = tl.recordEvent("s-closed", _evt("execution_started"));
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "timeline_closed");
    });
});

describe("executionTimeline — closeTimeline", () => {
    it("closes a timeline with outcome", () => {
        tl.startTimeline("s-close");
        tl.recordEvent("s-close", _evt("execution_started"));
        const r = tl.closeTimeline("s-close", "completed");
        assert.equal(r.closed, true);
        assert.equal(r.outcome, "completed");
        assert.ok(r.durationMs >= 0);
        assert.equal(r.eventCount, 1);
    });

    it("rejects closing an already-closed timeline", () => {
        tl.startTimeline("s-cc");
        tl.closeTimeline("s-cc");
        const r = tl.closeTimeline("s-cc");
        assert.equal(r.closed, false);
    });
});

describe("executionTimeline — buildCausalityChain", () => {
    it("returns found:false for unknown root event", () => {
        const r = tl.buildCausalityChain("ghost-id", []);
        assert.equal(r.found, false);
    });

    it("builds a simple 3-event chain", () => {
        const e1 = _evt("execution_started",  { eventId: "e1", seqNum: 1, parentEventId: null });
        const e2 = _evt("execution_failed",   { eventId: "e2", seqNum: 2, parentEventId: "e1" });
        const e3 = _evt("retry_triggered",    { eventId: "e3", seqNum: 3, parentEventId: "e2" });
        const e4 = _evt("rollback_triggered", { eventId: "e4", seqNum: 4, parentEventId: "e3" });
        const r  = tl.buildCausalityChain("e1", [e1, e2, e3, e4]);
        assert.equal(r.found, true);
        assert.equal(r.depth, 4);
        assert.ok(r.types.includes("retry_triggered"));
    });

    it("stops chain at events not connected to root", () => {
        const e1 = _evt("execution_started", { eventId: "e1", seqNum: 1 });
        const e2 = _evt("execution_failed",  { eventId: "e2", seqNum: 2, parentEventId: "e1" });
        const e3 = _evt("pacing_adjusted",   { eventId: "e3", seqNum: 3, parentEventId: null });  // unconnected
        const r  = tl.buildCausalityChain("e1", [e1, e2, e3]);
        assert.equal(r.depth, 2);
    });

    it("returns chain sorted by seqNum", () => {
        const e1 = _evt("execution_started",  { eventId: "e1", seqNum: 1 });
        const e3 = _evt("retry_triggered",    { eventId: "e3", seqNum: 3, parentEventId: "e1" });
        const e2 = _evt("execution_failed",   { eventId: "e2", seqNum: 2, parentEventId: "e1" });
        const r  = tl.buildCausalityChain("e1", [e1, e3, e2]);
        const seqs = r.chain.map(c => c.seqNum);
        assert.deepEqual(seqs, [1, 2, 3]);
    });
});

describe("executionTimeline — anomaly annotation", () => {
    it("annotates a timeline with an anomaly", () => {
        tl.startTimeline("s-ann");
        tl.annotateAnomaly("s-ann", { type: "latency_spike", severity: "high" });
        const stats = tl.getTimelineStats("s-ann");
        assert.equal(stats.anomalyCount, 1);
    });

    it("returns not found for unknown session", () => {
        const r = tl.annotateAnomaly("ghost", { type: "test" });
        assert.equal(r.annotated, false);
    });
});

describe("executionTimeline — getTimelineStats", () => {
    it("returns null for unknown session", () => {
        assert.equal(tl.getTimelineStats("nope"), null);
    });

    it("reports hasFailure and hasRetry correctly", () => {
        tl.startTimeline("s-stat");
        tl.recordEvent("s-stat", _evt("execution_started"));
        tl.recordEvent("s-stat", _evt("execution_failed"));
        tl.recordEvent("s-stat", _evt("retry_triggered"));
        const stats = tl.getTimelineStats("s-stat");
        assert.equal(stats.hasFailure, true);
        assert.equal(stats.hasRetry, true);
        assert.equal(stats.hasRollback, false);
    });
});

describe("executionTimeline — listTimelines", () => {
    it("lists all timelines with summary", () => {
        tl.startTimeline("s-l1");
        tl.startTimeline("s-l2");
        tl.closeTimeline("s-l1");
        const list = tl.listTimelines();
        assert.equal(list.length, 2);
        const statuses = list.map(t => t.status);
        assert.ok(statuses.includes("closed"));
        assert.ok(statuses.includes("open"));
    });
});

// ═══════════════════════════════════════════════════════════════════════
// replayEngine
// ═══════════════════════════════════════════════════════════════════════

describe("replayEngine — createReplaySession", () => {
    it("creates session sorted by seqNum", () => {
        const events = [
            _evt("execution_completed", { eventId: "e3", seqNum: 3 }),
            _evt("execution_started",   { eventId: "e1", seqNum: 1 }),
            _evt("execution_failed",    { eventId: "e2", seqNum: 2 }),
        ];
        const s = rpl.createReplaySession(events);
        const session = rpl.getReplaySession(s.sessionId);
        assert.equal(session.events[0].eventId, "e1");
        assert.equal(session.events[1].eventId, "e2");
        assert.equal(session.events[2].eventId, "e3");
    });

    it("accepts custom sessionId", () => {
        const r = rpl.createReplaySession([], { sessionId: "my-replay" });
        assert.equal(r.sessionId, "my-replay");
    });
});

describe("replayEngine — replayNext", () => {
    it("replays events one by one", () => {
        const events = [
            _evt("execution_started",   { eventId: "e1", seqNum: 1 }),
            _evt("execution_completed", { eventId: "e2", seqNum: 2 }),
        ];
        const { sessionId } = rpl.createReplaySession(events);
        const r1 = rpl.replayNext(sessionId);
        assert.equal(r1.replayed, true);
        assert.equal(r1.event.eventId, "e1");
        assert.equal(r1.remaining, 1);

        const r2 = rpl.replayNext(sessionId);
        assert.equal(r2.event.eventId, "e2");
        assert.equal(r2.completed, true);
    });

    it("returns no_more_events when exhausted", () => {
        const { sessionId } = rpl.createReplaySession([_evt("execution_started", { seqNum: 1 })]);
        rpl.replayNext(sessionId);
        const r = rpl.replayNext(sessionId);
        assert.equal(r.replayed, false);
        assert.equal(r.completed, true);
    });

    it("returns session_not_found for unknown session", () => {
        const r = rpl.replayNext("ghost");
        assert.equal(r.replayed, false);
        assert.equal(r.reason, "session_not_found");
    });
});

describe("replayEngine — replayAll", () => {
    it("replays entire session and counts by type", () => {
        const events = [
            _evt("execution_started",   { seqNum: 1 }),
            _evt("execution_failed",    { seqNum: 2 }),
            _evt("retry_triggered",     { seqNum: 3 }),
            _evt("execution_completed", { seqNum: 4 }),
        ];
        const { sessionId } = rpl.createReplaySession(events);
        const r = rpl.replayAll(sessionId);
        assert.equal(r.replayed, true);
        assert.equal(r.totalReplayed, 4);
        assert.equal(r.typeCounts.execution_started, 1);
        assert.equal(r.typeCounts.execution_failed, 1);
        assert.equal(r.status, "completed");
    });

    it("is idempotent — can replay same session multiple times", () => {
        const events = [
            _evt("execution_started", { seqNum: 1 }),
            _evt("execution_completed", { seqNum: 2 }),
        ];
        const { sessionId } = rpl.createReplaySession(events);
        rpl.replayAll(sessionId);
        const r2 = rpl.replayAll(sessionId);
        assert.equal(r2.totalReplayed, 2);
    });
});

describe("replayEngine — replayIncident", () => {
    it("returns no_events for empty input", () => {
        const r = rpl.replayIncident([]);
        assert.equal(r.replayed, false);
    });

    it("identifies phases in an incident replay", () => {
        const events = [
            _evt("execution_started",       { seqNum: 1 }),
            _evt("execution_failed",         { seqNum: 2 }),
            _evt("retry_triggered",          { seqNum: 3 }),
            _evt("stabilization_activated",  { seqNum: 4 }),
            _evt("execution_completed",      { seqNum: 5 }),
        ];
        const r = rpl.replayIncident(events, { incidentId: "inc-1" });
        assert.equal(r.replayed, true);
        assert.equal(r.incidentId, "inc-1");
        const phaseNames = r.phases.map(p => p.phase);
        assert.ok(phaseNames.includes("pre_failure"));
        assert.ok(phaseNames.includes("failure"));
        assert.ok(phaseNames.includes("recovery"));
        assert.ok(phaseNames.includes("stabilization"));
        assert.ok(phaseNames.includes("resolution"));
        assert.equal(r.resolved, true);
    });

    it("reports unresolved incident when no completion event", () => {
        const events = [
            _evt("execution_started", { seqNum: 1 }),
            _evt("execution_failed",  { seqNum: 2 }),
            _evt("retry_triggered",   { seqNum: 3 }),
        ];
        const r = rpl.replayIncident(events);
        assert.equal(r.resolved, false);
    });
});

describe("replayEngine — scoreReplay", () => {
    it("returns F for empty inputs", () => {
        assert.equal(rpl.scoreReplay([], []).grade, "F");
    });

    it("scores A for perfect replay", () => {
        const events = [
            _evt("execution_started",   { eventId: "e1", seqNum: 1 }),
            _evt("execution_completed", { eventId: "e2", seqNum: 2 }),
        ];
        const r = rpl.scoreReplay(events, events);
        assert.ok(r.score >= 90);
        assert.equal(r.grade, "A");
    });

    it("scores lower when replayed events differ from original", () => {
        const original = [
            _evt("execution_started",   { eventId: "e1", seqNum: 1 }),
            _evt("execution_failed",    { eventId: "e2", seqNum: 2 }),
            _evt("rollback_triggered",  { eventId: "e3", seqNum: 3 }),
        ];
        const replayed = [
            _evt("execution_started",   { eventId: "e1", seqNum: 1 }),
            _evt("execution_completed", { eventId: "e4", seqNum: 2 }),  // different type
        ];
        const r = rpl.scoreReplay(original, replayed);
        assert.ok(r.score < 90);
    });

    it("scores causality confidence from parent chain", () => {
        const original = [
            _evt("execution_started", { eventId: "e1", seqNum: 1 }),
            _evt("execution_failed",  { eventId: "e2", seqNum: 2, parentEventId: "e1" }),
        ];
        const r = rpl.scoreReplay(original, original);
        assert.ok(r.causalityConf > 0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// correlationTracker
// ═══════════════════════════════════════════════════════════════════════

describe("correlationTracker — createCorrelation", () => {
    it("creates a correlation with a unique ID", () => {
        const r = corr.createCorrelation("workflow");
        assert.ok(r.correlationId.startsWith("corr-"));
        assert.equal(r.type, "workflow");
        assert.equal(r.events.length, 0);
    });

    it("accepts custom correlationId in metadata", () => {
        const r = corr.createCorrelation("incident", { correlationId: "my-corr-123" });
        assert.equal(r.correlationId, "my-corr-123");
    });

    it("stores parentCorrelationId for child correlations", () => {
        const parent = corr.createCorrelation("workflow");
        const child  = corr.createCorrelation("retry_chain", { parentCorrelationId: parent.correlationId });
        assert.equal(child.parentId, parent.correlationId);
    });
});

describe("correlationTracker — linkEvent / linkTelemetry / linkEscalation", () => {
    it("links events to a correlation", () => {
        const c = corr.createCorrelation("workflow");
        corr.linkEvent(c.correlationId, "evt-1", "trigger");
        corr.linkEvent(c.correlationId, "evt-2", "result");
        const rec = corr.getCorrelation(c.correlationId);
        assert.equal(rec.events.length, 2);
    });

    it("returns not_found for unknown correlationId", () => {
        const r = corr.linkEvent("ghost-corr", "evt-1");
        assert.equal(r.linked, false);
    });

    it("links telemetry references", () => {
        const c = corr.createCorrelation("telemetry_session");
        corr.linkTelemetry(c.correlationId, { metric: "cpu", value: 0.9 });
        const rec = corr.getCorrelation(c.correlationId);
        assert.equal(rec.telemetry.length, 1);
    });

    it("links escalations", () => {
        const c = corr.createCorrelation("incident");
        corr.linkEscalation(c.correlationId, { ruleId: "critical_health", level: "critical" });
        const rec = corr.getCorrelation(c.correlationId);
        assert.equal(rec.escalations.length, 1);
    });
});

describe("correlationTracker — findRelated", () => {
    it("returns found:false for unknown correlation", () => {
        const r = corr.findRelated("ghost");
        assert.equal(r.found, false);
    });

    it("finds children of a correlation", () => {
        const parent = corr.createCorrelation("workflow");
        const child1 = corr.createCorrelation("retry_chain", { parentCorrelationId: parent.correlationId });
        const child2 = corr.createCorrelation("recovery",    { parentCorrelationId: parent.correlationId });
        const r = corr.findRelated(parent.correlationId);
        assert.equal(r.found, true);
        assert.equal(r.children.length, 2);
    });

    it("finds siblings sharing the same parent", () => {
        const parent = corr.createCorrelation("workflow");
        const c1 = corr.createCorrelation("retry_chain", { parentCorrelationId: parent.correlationId });
        corr.createCorrelation("recovery",    { parentCorrelationId: parent.correlationId });
        const r  = corr.findRelated(c1.correlationId);
        assert.equal(r.siblings.length, 1);
    });
});

describe("correlationTracker — traceLineage", () => {
    it("traces from a child up to root and down to all descendants", () => {
        const root   = corr.createCorrelation("workflow");
        const mid    = corr.createCorrelation("retry_chain", { parentCorrelationId: root.correlationId });
        const leaf   = corr.createCorrelation("recovery",    { parentCorrelationId: mid.correlationId });
        const result = corr.traceLineage(leaf.correlationId);
        assert.equal(result.rootId, root.correlationId);
        assert.ok(result.depth >= 2);
        assert.ok(result.size >= 3);
    });

    it("single root node has depth 0", () => {
        const root = corr.createCorrelation("workflow");
        const r    = corr.traceLineage(root.correlationId);
        assert.equal(r.depth, 0);
        assert.equal(r.size, 1);
    });
});

describe("correlationTracker — getCorrelationStats", () => {
    it("reports total and by type", () => {
        corr.createCorrelation("workflow");
        corr.createCorrelation("workflow");
        corr.createCorrelation("incident");
        const s = corr.getCorrelationStats();
        assert.equal(s.total, 3);
        assert.equal(s.byType.workflow, 2);
        assert.equal(s.byType.incident, 1);
    });

    it("counts linked events in total", () => {
        const c = corr.createCorrelation("workflow");
        corr.linkEvent(c.correlationId, "e1");
        corr.linkEvent(c.correlationId, "e2");
        const s = corr.getCorrelationStats();
        assert.equal(s.totalEvents, 2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// telemetryCompressor
// ═══════════════════════════════════════════════════════════════════════

describe("telemetryCompressor — compress RLE", () => {
    it("compresses a run of identical values into one entry", () => {
        const samples = Array(10).fill({ value: 0.5, ts: null });
        const r = cmp.compress(samples, { strategy: "rle" });
        assert.equal(r.strategy, "rle");
        assert.equal(r.runs.length, 1);
        assert.equal(r.runs[0].count, 10);
        assert.ok(r.compressionRatio < 1);
    });

    it("preserves all distinct values", () => {
        const samples = [0.1, 0.2, 0.3].map(v => ({ value: v, ts: null }));
        const r = cmp.compress(samples, { strategy: "rle" });
        assert.equal(r.runs.length, 3);
        assert.equal(r.compressionRatio, 1);
    });
});

describe("telemetryCompressor — compress delta", () => {
    it("delta encodes a series", () => {
        const samples = [0.1, 0.2, 0.3, 0.4].map(v => ({ value: v, ts: null }));
        const r = cmp.compress(samples, { strategy: "delta" });
        assert.equal(r.strategy, "delta");
        assert.ok(Math.abs(r.base - 0.1) < 0.001);
        assert.equal(r.deltas.length, 4);
    });
});

describe("telemetryCompressor — compress significant_points", () => {
    it("keeps only significant changes", () => {
        // Flat at 0.5 then spike to 0.9 then back
        const samples = [
            ...Array(10).fill(0.5),
            0.9,
            ...Array(5).fill(0.5),
        ].map(v => ({ value: v, ts: null }));
        const r = cmp.compress(samples, { strategy: "significant_points" });
        assert.ok(r.compressedCount < samples.length);
        assert.ok(r.compressionRatio < 1);
    });

    it("always keeps first and last sample", () => {
        const samples = [0.1, 0.5, 0.5, 0.5, 0.9].map(v => ({ value: v, ts: null }));
        const r = cmp.compress(samples, { strategy: "significant_points" });
        assert.equal(r.points[0].value, 0.1);
        assert.equal(r.points[r.points.length - 1].value, 0.9);
    });
});

describe("telemetryCompressor — decompress", () => {
    it("decompress(compress(x)) round-trips RLE losslessly", () => {
        const original = [0.1, 0.1, 0.2, 0.2, 0.2, 0.3].map(v => ({ value: v, ts: null }));
        const compressed = cmp.compress(original, { strategy: "rle" });
        const restored   = cmp.decompress(compressed);
        assert.equal(restored.length, original.length);
        assert.ok(Math.abs(restored[0].value - 0.1) < 0.0001);
    });

    it("decompress(compress(x)) round-trips delta encoding", () => {
        const original = [0.1, 0.2, 0.3, 0.4].map(v => ({ value: v, ts: null }));
        const compressed = cmp.compress(original, { strategy: "delta" });
        const restored   = cmp.decompress(compressed);
        assert.equal(restored.length, original.length);
        for (let i = 0; i < original.length; i++) {
            assert.ok(Math.abs(restored[i].value - original[i].value) < 0.00001);
        }
    });

    it("decompress(compress(x)) for significant_points returns subset", () => {
        const original = Array(20).fill(0.5).map(v => ({ value: v, ts: null }));
        const compressed = cmp.compress(original, { strategy: "significant_points" });
        const restored   = cmp.decompress(compressed);
        assert.ok(restored.length <= original.length);
    });
});

describe("telemetryCompressor — estimateCompressionRatio", () => {
    it("returns 1.0 for empty samples", () => {
        assert.equal(cmp.estimateCompressionRatio([]), 1);
    });

    it("returns < 1.0 for highly compressible data", () => {
        const samples = Array(100).fill({ value: 0.5, ts: null });
        const ratio = cmp.estimateCompressionRatio(samples);
        assert.ok(ratio < 1.0);
    });

    it("returns ~1.0 for incompressible data", () => {
        const samples = Array.from({ length: 20 }, (_, i) => ({ value: i * 0.05, ts: null }));
        const ratio = cmp.estimateCompressionRatio(samples);
        assert.ok(ratio <= 1.0);
    });
});

describe("telemetryCompressor — compressSession", () => {
    it("returns compressed:false for empty events", () => {
        const r = cmp.compressSession([]);
        assert.equal(r.compressed, false);
    });

    it("groups events by type and compresses each", () => {
        const events = [
            { type: "execution_started",   seqNum: 1, ts: new Date().toISOString() },
            { type: "execution_started",   seqNum: 2, ts: new Date().toISOString() },
            { type: "execution_failed",    seqNum: 3, ts: new Date().toISOString() },
        ];
        const r = cmp.compressSession(events);
        assert.equal(r.compressed, true);
        assert.equal(r.eventTypeCount, 2);
        assert.ok("execution_started" in r.byType);
        assert.ok("execution_failed"  in r.byType);
    });
});

describe("telemetryCompressor — getCompressionStats", () => {
    it("tracks compressions performed", () => {
        cmp.compress([{ value: 0.5 }, { value: 0.5 }], { strategy: "rle" });
        cmp.compress([{ value: 0.3 }, { value: 0.6 }], { strategy: "delta" });
        const s = cmp.getCompressionStats();
        assert.equal(s.compressions, 2);
        assert.equal(s.byStrategy.rle, 1);
        assert.equal(s.byStrategy.delta, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// observabilityBenchmark
// ═══════════════════════════════════════════════════════════════════════

describe("observabilityBenchmark — scoreReplayReliability", () => {
    it("returns F for no replays", () => {
        assert.equal(bench.scoreReplayReliability([]).grade, "F");
    });

    it("scores A for all successful high-accuracy replays", () => {
        const replays = Array(5).fill({ replayed: true, status: "completed", accuracy: 1.0 });
        const r = bench.scoreReplayReliability(replays);
        assert.ok(r.score >= 90);
        assert.equal(r.grade, "A");
    });

    it("scores lower for failed replays", () => {
        const replays = [
            { replayed: false, status: "failed" },
            { replayed: true,  status: "completed", accuracy: 0.5 },
        ];
        const r = bench.scoreReplayReliability(replays);
        assert.ok(r.score < 75);
    });
});

describe("observabilityBenchmark — scoreTimelineConsistency", () => {
    it("returns F for no timelines", () => {
        assert.equal(bench.scoreTimelineConsistency([]).grade, "F");
    });

    it("scores well for all closed consistent timelines", () => {
        const now = new Date().toISOString();
        const timelines = Array(5).fill({
            status:    "closed",
            startedAt: now,
            closedAt:  now,
            outcome:   "completed",
            events:    [{ seqNum: 1 }, { seqNum: 2 }],
        });
        const r = bench.scoreTimelineConsistency(timelines);
        assert.ok(r.score >= 75);
        assert.equal(r.closedRate, 1);
    });

    it("detects out-of-order events as inconsistent", () => {
        const now = new Date().toISOString();
        const timelines = [{
            status:    "closed",
            startedAt: now,
            closedAt:  now,
            outcome:   "completed",
            events:    [{ seqNum: 5 }, { seqNum: 2 }],  // out of order
        }];
        const r = bench.scoreTimelineConsistency(timelines);
        // The timeline with out-of-order events should reduce consistency score
        assert.ok(r.score < 100);
    });
});

describe("observabilityBenchmark — scoreEventCompleteness", () => {
    it("returns F for no events", () => {
        assert.equal(bench.scoreEventCompleteness([]).grade, "F");
    });

    it("scores A when all event types present with valid schema", () => {
        const now = new Date().toISOString();
        const events = bench.REQUIRED_EVENT_TYPES.map((type, i) => ({
            eventId: `e-${i}`, type, seqNum: i, ts: now,
        }));
        const r = bench.scoreEventCompleteness(events);
        assert.ok(r.score >= 90);
        assert.equal(r.missingTypes.length, 0);
    });

    it("identifies missing event types", () => {
        const now = new Date().toISOString();
        const events = [
            { eventId: "e1", type: "execution_started",   seqNum: 1, ts: now },
            { eventId: "e2", type: "execution_completed", seqNum: 2, ts: now },
        ];
        const r = bench.scoreEventCompleteness(events);
        assert.ok(r.missingTypes.length > 0);
        assert.ok(r.coverageRate < 1);
    });

    it("penalises events missing required schema fields", () => {
        const events = [
            { type: "execution_started" },  // missing eventId, seqNum, ts
        ];
        const r = bench.scoreEventCompleteness(events, ["execution_started"]);
        assert.ok(r.schemaRate < 1);
    });
});

describe("observabilityBenchmark — scoreCorrelationAccuracy", () => {
    it("returns F for no correlations", () => {
        assert.equal(bench.scoreCorrelationAccuracy([]).grade, "F");
    });

    it("scores well when correlations have linked events", () => {
        const correlations = [
            { correlationId: "c1", events: [{ eventId: "e1" }], telemetry: [] },
            { correlationId: "c2", events: [{ eventId: "e2" }], telemetry: [{ metric: "cpu" }] },
        ];
        const r = bench.scoreCorrelationAccuracy(correlations, []);
        assert.ok(r.score > 50);
    });

    it("validates external links against known correlation IDs", () => {
        const correlations = [{ correlationId: "c1", events: [{ eventId: "e1" }], telemetry: [] }];
        const links = [
            { correlationId: "c1", eventId: "e1" },   // valid
            { correlationId: "c-ghost", eventId: "e9" }, // invalid
        ];
        const r = bench.scoreCorrelationAccuracy(correlations, links);
        assert.ok(r.linkValidRate < 1);
    });
});

describe("observabilityBenchmark — gradeCausalityConfidence", () => {
    it("returns F for no chains", () => {
        assert.equal(bench.gradeCausalityConfidence([]).grade, "F");
    });

    it("scores A for deep found chains", () => {
        const chains = Array(5).fill({ found: true, depth: 5 });
        const r = bench.gradeCausalityConfidence(chains);
        assert.ok(r.score >= 75);
    });

    it("scores lower for not-found chains", () => {
        const chains = [{ found: false }, { found: false }, { found: false }];
        const r = bench.gradeCausalityConfidence(chains);
        assert.ok(r.score < 40);
    });
});

describe("observabilityBenchmark — gradeObservabilityMaturity", () => {
    it("returns F for empty scores", () => {
        const r = bench.gradeObservabilityMaturity({});
        assert.equal(r.grade, "F");
        assert.equal(r.maturity, bench.MATURITY_LEVELS.F);
    });

    it("returns A and full_observability for all-high scores", () => {
        const r = bench.gradeObservabilityMaturity({ replay: 95, timeline: 92, events: 91, correlation: 93 });
        assert.equal(r.grade, "A");
        assert.equal(r.maturity, "full_observability");
    });

    it("verifies all maturity labels", () => {
        assert.equal(bench.MATURITY_LEVELS.A, "full_observability");
        assert.equal(bench.MATURITY_LEVELS.B, "high_observability");
        assert.equal(bench.MATURITY_LEVELS.C, "partial_observability");
        assert.equal(bench.MATURITY_LEVELS.D, "minimal_observability");
        assert.equal(bench.MATURITY_LEVELS.F, "blind_runtime");
    });

    it("averages inputs and counts them", () => {
        const r = bench.gradeObservabilityMaturity({ a: 80, b: 70, c: 60 });
        assert.ok(Math.abs(r.score - 70) < 0.1);
        assert.equal(r.inputs, 3);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — full observability pipeline
// ═══════════════════════════════════════════════════════════════════════

describe("observability pipeline — integration", () => {
    it("records a workflow incident and replays it step-by-step", () => {
        const sessionId     = "wf-incident-1";
        const corrId        = "corr-wf-1";

        // 1. Create correlation
        const c = corr.createCorrelation("workflow", { correlationId: corrId });
        assert.equal(c.correlationId, corrId);

        // 2. Start timeline
        tl.startTimeline(sessionId);

        // 3. Emit events via event stream
        const e1 = es.emit("execution_started",   { fingerprint: "fp-abc" }, { correlationId: corrId, sessionId });
        const e2 = es.emit("execution_failed",     { error: "timeout"      }, { correlationId: corrId, sessionId, parentEventId: e1.eventId });
        const e3 = es.emit("retry_triggered",      { attempt: 1            }, { correlationId: corrId, sessionId, parentEventId: e2.eventId });
        const e4 = es.emit("rollback_triggered",   { reason: "too_many_retries" }, { correlationId: corrId, sessionId, parentEventId: e3.eventId });
        const e5 = es.emit("escalation_triggered", { level: "critical"     }, { correlationId: corrId, sessionId, parentEventId: e4.eventId });

        // 4. Record all events into timeline
        for (const evt of es.getEventsBySession(sessionId)) {
            tl.recordEvent(sessionId, evt);
        }
        tl.annotateAnomaly(sessionId, { type: "cascade_failure", severity: "critical" });

        // 5. Close timeline
        const closed = tl.closeTimeline(sessionId, "escalated");
        assert.equal(closed.outcome, "escalated");
        assert.equal(closed.eventCount, 5);

        // 6. Link events to correlation
        for (const evt of es.getEventsByCorrelation(corrId)) {
            corr.linkEvent(corrId, evt.eventId);
        }
        const related = corr.findRelated(corrId);
        assert.equal(related.eventCount, 5);

        // 7. Build causality chain from root
        const events = es.getEventsBySession(sessionId);
        const chain  = tl.buildCausalityChain(e1.eventId, events);
        assert.ok(chain.depth >= 2);
        assert.ok(chain.types.includes("execution_failed"));

        // 8. Replay incident
        const incidentReplay = rpl.replayIncident(events);
        assert.equal(incidentReplay.replayed, true);
        assert.equal(incidentReplay.resolved, false);
        assert.ok(incidentReplay.phases.length >= 2);

        // 9. Create replay session and replay all
        const { sessionId: rplId } = rpl.createReplaySession(events);
        const replayResult = rpl.replayAll(rplId);
        assert.equal(replayResult.totalReplayed, 5);

        // 10. Score replay
        const score = rpl.scoreReplay(events, rpl.getReplaySession(rplId).replayed);
        assert.ok(score.score > 80);

        // 11. Timeline stats
        const stats = tl.getTimelineStats(sessionId);
        assert.equal(stats.hasFailure, true);
        assert.equal(stats.hasRetry, true);
        assert.equal(stats.hasRollback, true);
        assert.equal(stats.anomalyCount, 1);
    });

    it("compresses a large telemetry session and maintains integrity", () => {
        // Simulate 200 events
        const events = Array.from({ length: 200 }, (_, i) => ({
            type:   i % 5 === 0 ? "execution_failed" : "execution_started",
            seqNum: i + 1,
            ts:     new Date().toISOString(),
        }));
        const r = cmp.compressSession(events);
        assert.equal(r.compressed, true);
        assert.ok(r.compressionRatio <= 1);
        assert.ok(r.totalCompressed <= r.totalOriginal);
    });

    it("full benchmark pipeline produces a maturity grade", () => {
        const now = new Date().toISOString();
        // Replay reliability
        const replays     = Array(5).fill({ replayed: true, accuracy: 0.95 });
        const rscore      = bench.scoreReplayReliability(replays);

        // Timeline consistency
        const timelines   = Array(5).fill({ status: "closed", startedAt: now, closedAt: now, outcome: "completed", events: [{ seqNum: 1 }, { seqNum: 2 }] });
        const tscore      = bench.scoreTimelineConsistency(timelines);

        // Event completeness
        const evts        = bench.REQUIRED_EVENT_TYPES.map((type, i) => ({ eventId: `e-${i}`, type, seqNum: i, ts: now }));
        const escore      = bench.scoreEventCompleteness(evts);

        // Correlation accuracy
        const correlations = [{ correlationId: "c1", events: [{ eventId: "e1" }], telemetry: [] }];
        const cscore      = bench.scoreCorrelationAccuracy(correlations, []);

        const maturity = bench.gradeObservabilityMaturity({
            replay:      rscore.score,
            timeline:    tscore.score,
            events:      escore.score,
            correlation: cscore.score,
        });

        assert.ok(["A","B","C","D","F"].includes(maturity.grade));
        assert.ok(maturity.score >= 0 && maturity.score <= 100);
        assert.ok(Object.values(bench.MATURITY_LEVELS).includes(maturity.maturity));
    });
});
