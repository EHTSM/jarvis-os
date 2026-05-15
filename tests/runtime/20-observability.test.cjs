"use strict";
const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const hd  = require("../../agents/runtime/dashboards/healthDashboard.cjs");
const rl  = require("../../agents/runtime/dashboards/replayLog.cjs");
const ad  = require("../../agents/runtime/dashboards/anomalyDashboard.cjs");
const det = require("../../agents/runtime/anomalyDetector.cjs");
const rs  = require("../../agents/runtime/runtimeStabilizer.cjs");

// ── healthDashboard ───────────────────────────────────────────────────────

describe("healthDashboard — getHealthSummary", () => {
    it("returns required top-level keys", () => {
        const s = hd.getHealthSummary();
        assert.ok("status"      in s);
        assert.ok("score"       in s);
        assert.ok("execution"   in s);
        assert.ok("resources"   in s);
        assert.ok("anomalies"   in s);
        assert.ok("stability"   in s);
        assert.ok("generatedAt" in s);
    });
    it("status is one of: healthy, degraded, critical", () => {
        const { status } = hd.getHealthSummary();
        assert.ok(["healthy", "degraded", "critical"].includes(status));
    });
    it("score is 0–100", () => {
        const { score } = hd.getHealthSummary();
        assert.ok(score >= 0 && score <= 100);
    });
    it("execution.workflowsRun is a number", () => {
        const { execution } = hd.getHealthSummary();
        assert.ok(typeof execution.workflowsRun === "number");
    });
    it("resources.memPressure is 0–1", () => {
        const { resources } = hd.getHealthSummary();
        assert.ok(resources.memPressure >= 0 && resources.memPressure <= 1);
    });
    it("anomalies fields are present", () => {
        const { anomalies } = hd.getHealthSummary();
        assert.ok(typeof anomalies.critical === "number");
        assert.ok(typeof anomalies.warning  === "number");
        assert.ok(typeof anomalies.total    === "number");
    });
    it("critical anomalies lower score", () => {
        // Reset state for clean slate
        det.reset();
        rs.reset();
        const baseline = hd.getHealthSummary().score;
        // Inject critical anomalies
        for (let i = 0; i < 5; i++) {
            det.detectInfiniteRetry(`score-test-${i}`, "step", 10);
        }
        const after = hd.getHealthSummary().score;
        assert.ok(after <= baseline, `expected ${after} <= ${baseline}`);
        det.reset();
    });
});

describe("healthDashboard — getWorkflowHealth", () => {
    it("returns required fields for any workflow", () => {
        const h = hd.getWorkflowHealth("some-wf");
        assert.equal(h.name, "some-wf");
        assert.ok(typeof h.trust        === "number");
        assert.ok(typeof h.level        === "string");
        assert.ok(typeof h.anomalies    === "number");
        assert.ok(typeof h.quarantined  === "boolean");
        assert.ok(typeof h.instabilities === "number");
        assert.ok(typeof h.generatedAt  === "string");
    });
    it("successRate is null when no history", () => {
        const h = hd.getWorkflowHealth("fresh-wf-" + Date.now());
        assert.equal(h.successRate, null);
    });
    it("quarantined=true when stabilizer has quarantined it", () => {
        const wf = "qtest-" + Date.now();
        rs.quarantine(wf, 30_000, "test");
        const h = hd.getWorkflowHealth(wf);
        assert.equal(h.quarantined, true);
        rs.releaseQuarantine(wf);
    });
});

// ── replayLog ─────────────────────────────────────────────────────────────

describe("replayLog — basic operations", () => {
    afterEach(() => rl.reset());

    it("record() returns an event with required fields", () => {
        const e = rl.record("wf1", "workflow_start", { step: 0 });
        assert.equal(e.workflowId, "wf1");
        assert.equal(e.eventType,  "workflow_start");
        assert.deepEqual(e.data,   { step: 0 });
        assert.ok(typeof e.seq === "number");
        assert.ok(typeof e.ts  === "string");
    });
    it("getReplay() returns events sorted by seq", () => {
        rl.record("wf1", "workflow_start");
        rl.record("wf1", "step_start");
        rl.record("wf1", "step_end");
        const events = rl.getReplay("wf1");
        assert.equal(events.length, 3);
        assert.ok(events[0].seq < events[1].seq);
        assert.ok(events[1].seq < events[2].seq);
    });
    it("getReplay() returns empty array for unknown workflow", () => {
        assert.deepEqual(rl.getReplay("unknown"), []);
    });
    it("getAllWorkflows() lists workflow IDs", () => {
        rl.record("wf-a", "workflow_start");
        rl.record("wf-b", "workflow_start");
        const wfs = rl.getAllWorkflows();
        assert.ok(wfs.includes("wf-a"));
        assert.ok(wfs.includes("wf-b"));
    });
    it("seq increments across different workflows", () => {
        const e1 = rl.record("wf-x", "step_start");
        const e2 = rl.record("wf-y", "step_start");
        assert.ok(e2.seq > e1.seq);
    });
    it("reset() clears all logs", () => {
        rl.record("wf1", "workflow_start");
        rl.reset();
        assert.deepEqual(rl.getAllWorkflows(), []);
    });
});

describe("replayLog — exportReplay", () => {
    afterEach(() => rl.reset());

    it("exportReplay returns formatted string", () => {
        rl.record("wf1", "workflow_start");
        rl.record("wf1", "step_start", { name: "build" });
        const out = rl.exportReplay("wf1");
        assert.ok(typeof out === "string");
        assert.ok(out.includes("workflow_start"));
        assert.ok(out.includes("step_start"));
    });
    it("exportReplay includes data in output", () => {
        rl.record("wf1", "step_end", { duration: 42 });
        const out = rl.exportReplay("wf1");
        assert.ok(out.includes("42"));
    });
    it("exportReplay returns placeholder for unknown workflow", () => {
        const out = rl.exportReplay("no-events");
        assert.ok(out.includes("no-events"));
    });
    it("EVENT_TYPES contains expected event names", () => {
        assert.ok(rl.EVENT_TYPES.includes("workflow_start"));
        assert.ok(rl.EVENT_TYPES.includes("step_failed"));
        assert.ok(rl.EVENT_TYPES.includes("anomaly_detected"));
    });
});

// ── anomalyDashboard ──────────────────────────────────────────────────────

describe("anomalyDashboard — getSummary", () => {
    before(() => det.reset());
    after(()  => det.reset());

    it("getSummary returns required fields", () => {
        const s = ad.getSummary();
        assert.ok("total"         in s);
        assert.ok("byType"        in s);
        assert.ok("bySeverity"    in s);
        assert.ok("criticalCount" in s);
        assert.ok("warningCount"  in s);
        assert.ok("generatedAt"   in s);
    });
    it("total matches sum of byType values", () => {
        const s     = ad.getSummary();
        const typed = Object.values(s.byType).reduce((a, b) => a + b, 0);
        assert.equal(s.total, typed);
    });
    it("reflects injected anomalies", () => {
        det.reset();
        det.detectInfiniteRetry("wf-dash", "step", 8);
        const s = ad.getSummary();
        assert.ok(s.total >= 1);
        assert.ok(s.byType["infinite_retry"] >= 1);
        det.reset();
    });
    it("criticalCount >= 0", () => {
        assert.ok(ad.getSummary().criticalCount >= 0);
    });
});

describe("anomalyDashboard — getTopOffenders", () => {
    before(() => det.reset());
    after(()  => det.reset());

    it("returns array", () => {
        assert.ok(Array.isArray(ad.getTopOffenders()));
    });
    it("entries have workflowId and count", () => {
        det.reset();
        det.detectInfiniteRetry("offender-a", "s", 9);
        det.detectInfiniteRetry("offender-a", "s2", 9);
        const top = ad.getTopOffenders(5);
        assert.ok(top.length > 0);
        assert.ok("workflowId" in top[0]);
        assert.ok("count"      in top[0]);
        det.reset();
    });
    it("sorted descending by count", () => {
        det.reset();
        det.detectInfiniteRetry("heavy", "s",  9);
        det.detectInfiniteRetry("heavy", "s2", 9);
        det.detectInfiniteRetry("light", "s",  9);
        const top = ad.getTopOffenders(5);
        if (top.length >= 2) {
            assert.ok(top[0].count >= top[1].count);
        }
        det.reset();
    });
    it("respects n limit", () => {
        det.reset();
        for (let i = 0; i < 10; i++) det.detectInfiniteRetry(`wf-${i}`, "s", 9);
        const top = ad.getTopOffenders(3);
        assert.ok(top.length <= 3);
        det.reset();
    });
});

describe("anomalyDashboard — getTimeline", () => {
    before(() => det.reset());
    after(()  => det.reset());

    it("returns array for workflow with anomalies", () => {
        det.reset();
        det.detectInfiniteRetry("timeline-wf", "s", 9);
        const tl = ad.getTimeline("timeline-wf");
        assert.ok(Array.isArray(tl));
        assert.ok(tl.length > 0);
        det.reset();
    });
    it("entries have ts, type, severity, detail", () => {
        det.reset();
        det.detectInfiniteRetry("tl-wf", "step", 9);
        const tl = ad.getTimeline("tl-wf");
        assert.ok("ts"       in tl[0]);
        assert.ok("type"     in tl[0]);
        assert.ok("severity" in tl[0]);
        assert.ok("detail"   in tl[0]);
        det.reset();
    });
    it("returns empty array for unknown workflow", () => {
        assert.deepEqual(ad.getTimeline("never-seen-wf"), []);
    });
    it("sorted chronologically", () => {
        det.reset();
        det.detectInfiniteRetry("sorted-wf", "s1", 9);
        det.detectInfiniteRetry("sorted-wf", "s2", 9);
        const tl = ad.getTimeline("sorted-wf");
        if (tl.length >= 2) {
            assert.ok(new Date(tl[0].ts) <= new Date(tl[1].ts));
        }
        det.reset();
    });
});
