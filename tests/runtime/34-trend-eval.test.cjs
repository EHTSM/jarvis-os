"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const bh = require("../../agents/runtime/benchmark/benchmarkHistory.cjs");
const ta = require("../../agents/runtime/benchmark/trendAnalyzer.cjs");
const se = require("../../agents/runtime/benchmark/selfEvaluator.cjs");

// ── benchmarkHistory — snapshot + getHistory ──────────────────────────

describe("benchmarkHistory — snapshot", () => {
    afterEach(() => bh.reset());

    it("snapshot returns entry with required fields", () => {
        const e = bh.snapshot("wf-bh-1", { successRate: 0.9 });
        assert.ok("snapshotId" in e);
        assert.ok("name"       in e);
        assert.ok("ts"         in e);
        assert.ok("metrics"    in e);
    });
    it("metrics are stored verbatim", () => {
        const e = bh.snapshot("wf-bh-2", { successRate: 0.75, flipRate: 0.1 });
        assert.equal(e.metrics.successRate, 0.75);
        assert.equal(e.metrics.flipRate,    0.1);
    });
    it("snapshotIds are unique", () => {
        const a = bh.snapshot("wf-bh-3", {});
        const b = bh.snapshot("wf-bh-3", {});
        assert.notEqual(a.snapshotId, b.snapshotId);
    });
});

describe("benchmarkHistory — getHistory", () => {
    afterEach(() => bh.reset());

    it("returns empty array for unknown workflow", () => {
        assert.deepEqual(bh.getHistory("no-such-wf"), []);
    });
    it("newest first ordering", () => {
        bh.snapshot("wf-order", { successRate: 0.5 });
        bh.snapshot("wf-order", { successRate: 0.9 });
        const h = bh.getHistory("wf-order");
        assert.equal(h[0].metrics.successRate, 0.9);
    });
    it("n limit is respected", () => {
        for (let i = 0; i < 10; i++) bh.snapshot("wf-limit", { run: i });
        assert.equal(bh.getHistory("wf-limit", 3).length, 3);
    });
    it("list() returns all tracked names", () => {
        bh.snapshot("wf-list-a", {});
        bh.snapshot("wf-list-b", {});
        const names = bh.list();
        assert.ok(names.includes("wf-list-a"));
        assert.ok(names.includes("wf-list-b"));
    });
});

describe("benchmarkHistory — delta", () => {
    afterEach(() => bh.reset());

    it("returns available:false with no snapshots", () => {
        assert.equal(bh.delta("wf-d-none").available, false);
    });
    it("returns available:false with only one snapshot", () => {
        bh.snapshot("wf-d-one", { successRate: 0.8 });
        assert.equal(bh.delta("wf-d-one").available, false);
    });
    it("returns available:true with two snapshots", () => {
        bh.snapshot("wf-d-two", { successRate: 0.7 });
        bh.snapshot("wf-d-two", { successRate: 0.9 });
        assert.equal(bh.delta("wf-d-two").available, true);
    });
    it("delta detects improvement (successRate up)", () => {
        bh.snapshot("wf-d-impr", { successRate: 0.5 });
        bh.snapshot("wf-d-impr", { successRate: 0.9 });
        const d = bh.delta("wf-d-impr");
        assert.equal(d.changes.successRate.direction, "up");
    });
    it("delta detects regression (successRate down)", () => {
        bh.snapshot("wf-d-regr", { successRate: 0.9 });
        bh.snapshot("wf-d-regr", { successRate: 0.4 });
        const d = bh.delta("wf-d-regr");
        assert.equal(d.regression, true);
    });
    it("improvement flag set when successRate rises significantly", () => {
        bh.snapshot("wf-d-flag", { successRate: 0.4 });
        bh.snapshot("wf-d-flag", { successRate: 0.9 });
        assert.equal(bh.delta("wf-d-flag").improvement, true);
    });
});

describe("benchmarkHistory — longTermTrend", () => {
    afterEach(() => bh.reset());

    it("insufficient_data with < 2 snapshots", () => {
        assert.equal(bh.longTermTrend("wf-lt-empty").trend, "insufficient_data");
    });
    it("improving trend with rising successRate", () => {
        [0.4, 0.5, 0.6, 0.7, 0.8, 0.9].forEach(sr =>
            bh.snapshot("wf-lt-up", { successRate: sr })
        );
        assert.equal(bh.longTermTrend("wf-lt-up").trend, "improving");
    });
    it("degrading trend with falling successRate", () => {
        [0.9, 0.8, 0.7, 0.5, 0.4, 0.3].forEach(sr =>
            bh.snapshot("wf-lt-down", { successRate: sr })
        );
        assert.equal(bh.longTermTrend("wf-lt-down").trend, "degrading");
    });
    it("sampleSize reflects snapshot count", () => {
        for (let i = 0; i < 5; i++) bh.snapshot("wf-lt-size", { successRate: 0.8 });
        assert.equal(bh.longTermTrend("wf-lt-size").sampleSize, 5);
    });
});

describe("benchmarkHistory — purgeOlderThan", () => {
    afterEach(() => bh.reset());

    it("does not prune fresh snapshots", () => {
        bh.snapshot("wf-purge", { successRate: 1 });
        const r = bh.purgeOlderThan(30);
        assert.equal(r.pruned, 0);
    });
    it("returns pruned and remaining counts", () => {
        const r = bh.purgeOlderThan(365);
        assert.ok("pruned"    in r);
        assert.ok("remaining" in r);
    });
});

// ── trendAnalyzer ─────────────────────────────────────────────────────

describe("trendAnalyzer — record + analyze", () => {
    afterEach(() => ta.reset());

    it("analyze returns required fields", () => {
        ta.record("wf-ta-1", { successRate: 0.8 });
        ta.record("wf-ta-1", { successRate: 0.9 });
        const r = ta.analyze("wf-ta-1");
        assert.ok("trend"        in r);
        assert.ok("sampleSize"   in r);
        assert.ok("regressions"  in r);
        assert.ok("improvements" in r);
        assert.ok("confidence"   in r);
    });
    it("confidence is 0 with < 2 samples", () => {
        ta.record("wf-ta-conf", { successRate: 0.5 });
        const r = ta.analyze("wf-ta-conf");
        assert.equal(r.confidence, 0);
    });
    it("confidence > 0 with multiple samples", () => {
        for (let i = 0; i < 5; i++) ta.record("wf-ta-conf2", { successRate: 0.8 });
        const r = ta.analyze("wf-ta-conf2");
        assert.ok(r.confidence > 0);
    });
});

describe("trendAnalyzer — detectRegressions", () => {
    afterEach(() => ta.reset());

    it("no regressions for stable workflow", () => {
        for (let i = 0; i < 5; i++) ta.record("wf-reg-stable", { successRate: 0.9, flipRate: 0 });
        const r = ta.detectRegressions("wf-reg-stable");
        assert.equal(r.detected, false);
    });
    it("detects success_rate_drop regression", () => {
        ta.record("wf-reg-drop", { successRate: 0.9, flipRate: 0.0 });
        ta.record("wf-reg-drop", { successRate: 0.5, flipRate: 0.0 });
        const r = ta.detectRegressions("wf-reg-drop");
        assert.equal(r.detected, true);
        assert.ok(r.items.some(i => i.type === "success_rate_drop"));
    });
    it("detects flip_rate_spike regression", () => {
        ta.record("wf-reg-flip", { successRate: 0.9, flipRate: 0.0 });
        ta.record("wf-reg-flip", { successRate: 0.9, flipRate: 0.5 });
        const r = ta.detectRegressions("wf-reg-flip");
        assert.equal(r.detected, true);
        assert.ok(r.items.some(i => i.type === "flip_rate_spike"));
    });
    it("severity is none for no regressions", () => {
        ta.record("wf-reg-sev", { successRate: 0.9 });
        assert.equal(ta.detectRegressions("wf-reg-sev").severity, "none");
    });
});

describe("trendAnalyzer — detectImprovements", () => {
    afterEach(() => ta.reset());

    it("detects success_rate_gain", () => {
        ta.record("wf-impr-1", { successRate: 0.4, flipRate: 0.0 });
        ta.record("wf-impr-1", { successRate: 0.9, flipRate: 0.0 });
        const r = ta.detectImprovements("wf-impr-1");
        assert.equal(r.detected, true);
        assert.ok(r.items.some(i => i.type === "success_rate_gain"));
    });
    it("not detected for steady-state workflow", () => {
        ta.record("wf-impr-2", { successRate: 0.8 });
        ta.record("wf-impr-2", { successRate: 0.8 });
        const r = ta.detectImprovements("wf-impr-2");
        assert.equal(r.detected, false);
    });
});

describe("trendAnalyzer — compareRuns", () => {
    it("verdict is improved when successRate rises", () => {
        const r = ta.compareRuns({ successRate: 0.5 }, { successRate: 0.9 });
        assert.equal(r.verdict, "improved");
    });
    it("verdict is regressed when successRate drops", () => {
        const r = ta.compareRuns({ successRate: 0.9 }, { successRate: 0.5 });
        assert.equal(r.verdict, "regressed");
    });
    it("verdict is neutral for small change", () => {
        const r = ta.compareRuns({ successRate: 0.8 }, { successRate: 0.82 });
        assert.equal(r.verdict, "neutral");
    });
    it("deltas includes successRate key", () => {
        const r = ta.compareRuns({ successRate: 0.6 }, { successRate: 0.8 });
        assert.ok("successRate" in r.deltas);
    });
});

describe("trendAnalyzer — confidenceTrend", () => {
    afterEach(() => ta.reset());

    it("returns unknown direction with < 2 samples", () => {
        assert.equal(ta.confidenceTrend("wf-ct-none").direction, "unknown");
    });
    it("growing when composite score rises", () => {
        ta.record("wf-ct-up", { composite: 40 });
        ta.record("wf-ct-up", { composite: 80 });
        const r = ta.confidenceTrend("wf-ct-up");
        assert.equal(r.direction, "growing");
    });
    it("declining when composite score falls", () => {
        ta.record("wf-ct-down", { composite: 80 });
        ta.record("wf-ct-down", { composite: 40 });
        const r = ta.confidenceTrend("wf-ct-down");
        assert.equal(r.direction, "declining");
    });
    it("samples array populated", () => {
        ta.record("wf-ct-samp", { composite: 70 });
        ta.record("wf-ct-samp", { composite: 75 });
        const r = ta.confidenceTrend("wf-ct-samp");
        assert.ok(r.samples.length >= 2);
    });
});

// ── selfEvaluator ─────────────────────────────────────────────────────

describe("selfEvaluator — explainFailure", () => {
    it("returns required fields", () => {
        const r = se.explainFailure({ successRate: 0.2 });
        assert.ok("reason"        in r);
        assert.ok("primaryFactor" in r);
        assert.ok("factors"       in r);
        assert.ok("confidence"    in r);
        assert.ok("suggestions"   in r);
    });
    it("detects zero_success_rate factor", () => {
        const r = se.explainFailure({ successRate: 0, runs: [] });
        assert.ok(r.factors.some(f => f.factor === "zero_success_rate"));
    });
    it("detects high_flip_rate factor", () => {
        const r = se.explainFailure({ successRate: 0.5, flipRate: 0.8, runs: [] });
        assert.ok(r.factors.some(f => f.factor === "high_flip_rate"));
    });
    it("suggestions is an array", () => {
        const r = se.explainFailure({ successRate: 0, runs: [] });
        assert.ok(Array.isArray(r.suggestions));
        assert.ok(r.suggestions.length > 0);
    });
    it("no failure factors for perfect run", () => {
        const r = se.explainFailure({ successRate: 1, flipRate: 0, runs: [] });
        assert.equal(r.factors.length, 0);
    });
});

describe("selfEvaluator — explainRepairOutcome", () => {
    it("outcome:success for successful repair", () => {
        assert.equal(se.explainRepairOutcome({ success: true, retries: 0 }).outcome, "success");
    });
    it("outcome:failure for failed repair", () => {
        assert.equal(se.explainRepairOutcome({ success: false }).outcome, "failure");
    });
    it("first_attempt_success factor when retries=0", () => {
        const r = se.explainRepairOutcome({ success: true, retries: 0 });
        assert.ok(r.factors.includes("first_attempt_success"));
    });
    it("recommendation is a string", () => {
        const r = se.explainRepairOutcome({ success: false, error: "timeout" });
        assert.ok(typeof r.recommendation === "string");
    });
});

describe("selfEvaluator — explainInstability", () => {
    it("severity:none for stable metrics", () => {
        const r = se.explainInstability({ successRate: 0.95, flipRate: 0.05, totalRuns: 10 });
        assert.equal(r.severity, "none");
    });
    it("severity:critical for extreme flip rate", () => {
        const r = se.explainInstability({ successRate: 0.5, flipRate: 0.8, totalRuns: 10 });
        assert.equal(r.severity, "critical");
    });
    it("primaryCause for high flip rate", () => {
        const r = se.explainInstability({ flipRate: 0.9, successRate: 0.5 });
        assert.ok(r.primaryCause.includes("variance") || r.primaryCause.includes("success"));
    });
    it("causes is an array", () => {
        assert.ok(Array.isArray(se.explainInstability({}).causes));
    });
});

describe("selfEvaluator — explainConfidenceDrop", () => {
    it("factors array is populated when score drops", () => {
        const r = se.explainConfidenceDrop({ composite: 80, successRate: 0.9 }, { composite: 50, successRate: 0.5 });
        assert.ok(r.factors.length > 0);
    });
    it("delta reflects composite change", () => {
        const r = se.explainConfidenceDrop({ composite: 80 }, { composite: 60 });
        assert.ok(r.delta < 0);
    });
    it("severity:high for large drop", () => {
        const r = se.explainConfidenceDrop({ composite: 90 }, { composite: 60 });
        assert.equal(r.severity, "high");
    });
    it("recommendation is a non-empty string", () => {
        const r = se.explainConfidenceDrop({}, {});
        assert.ok(typeof r.recommendation === "string");
    });
});

describe("selfEvaluator — evaluateRun", () => {
    it("returns summary string", () => {
        const r = se.evaluateRun({ name: "test-wf", successRate: 1, repairRate: 1, flipRate: 0, score: { composite: 95 } });
        assert.ok(typeof r.summary === "string");
    });
    it("overall:healthy for high composite", () => {
        const r = se.evaluateRun({ name: "x", successRate: 1, repairRate: 1, flipRate: 0, score: { composite: 95 } });
        assert.equal(r.overall, "healthy");
    });
    it("overall:critical for low composite", () => {
        const r = se.evaluateRun({ name: "x", successRate: 0, repairRate: 0, flipRate: 1, score: { composite: 20 } });
        assert.equal(r.overall, "critical");
    });
    it("failure is null for perfect run", () => {
        const r = se.evaluateRun({ name: "x", successRate: 1, repairRate: 1, flipRate: 0, score: { composite: 100 } });
        assert.equal(r.failure, null);
    });
    it("confidence is 1 when flipRate is 0", () => {
        const r = se.evaluateRun({ name: "x", successRate: 1, flipRate: 0, score: { composite: 100 } });
        assert.equal(r.confidence, 1);
    });
});
