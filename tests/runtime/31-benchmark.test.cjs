"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const el = require("../../agents/runtime/benchmark/executionLimits.cjs");
const ca = require("../../agents/runtime/benchmark/costAnalyzer.cjs");
const tb = require("../../agents/runtime/benchmark/taskBenchmark.cjs");

// ── executionLimits — enforce ─────────────────────────────────────────

describe("executionLimits — enforce", () => {
    it("allowed:true for clean context", () => {
        const r = el.enforce({});
        assert.equal(r.allowed, true);
        assert.deepEqual(r.violated, []);
    });
    it("blocks when retries exceed limit", () => {
        const r = el.enforce({ retries: 10 }, { maxRetries: 5 });
        assert.equal(r.allowed, false);
        assert.ok(r.violated.includes("maxRetries"));
    });
    it("blocks when depth exceeds limit", () => {
        const r = el.enforce({ depth: 15 }, { maxDepth: 10 });
        assert.equal(r.allowed, false);
        assert.ok(r.violated.includes("maxDepth"));
    });
    it("blocks when repairLoops exceed limit", () => {
        const r = el.enforce({ repairLoops: 5 }, { maxRepairLoops: 3 });
        assert.ok(r.violated.includes("maxRepairLoops"));
    });
    it("blocks when elapsedMs exceeds limit", () => {
        const r = el.enforce({ elapsedMs: 60_000 }, { maxExecutionMs: 30_000 });
        assert.ok(r.violated.includes("maxExecutionMs"));
    });
    it("reports all violated limits at once", () => {
        const r = el.enforce({ retries: 99, depth: 99 }, { maxRetries: 5, maxDepth: 10 });
        assert.ok(r.violated.includes("maxRetries"));
        assert.ok(r.violated.includes("maxDepth"));
    });
    it("reason string mentions violated limit", () => {
        const r = el.enforce({ retries: 99 }, { maxRetries: 5 });
        assert.ok(r.reason.includes("maxRetries"));
    });
});

describe("executionLimits — DEFAULT_LIMITS", () => {
    it("maxRetries is 5", () => {
        assert.equal(el.DEFAULT_LIMITS.maxRetries, 5);
    });
    it("maxRepairLoops is 3", () => {
        assert.equal(el.DEFAULT_LIMITS.maxRepairLoops, 3);
    });
    it("maxDepth is 10", () => {
        assert.equal(el.DEFAULT_LIMITS.maxDepth, 10);
    });
});

describe("executionLimits — wrapWithTimeout", () => {
    it("resolves when fn completes before timeout", async () => {
        const fn     = el.wrapWithTimeout(async () => "done", 1000);
        const result = await fn();
        assert.equal(result, "done");
    });
    it("rejects with execution_timeout when fn exceeds timeout", async () => {
        const fn = el.wrapWithTimeout(
            () => new Promise(r => { const t = setTimeout(r, 500); if (t.unref) t.unref(); }),
            10
        );
        await assert.rejects(fn, /execution_timeout/);
    });
});

describe("executionLimits — trackDepth / releaseDepth", () => {
    afterEach(() => el.reset());

    it("trackDepth starts at 1", () => {
        const r = el.trackDepth("wf-depth-1");
        assert.equal(r.depth, 1);
        assert.equal(r.allowed, true);
    });
    it("trackDepth increments on each call", () => {
        el.trackDepth("wf-depth-2");
        const r = el.trackDepth("wf-depth-2");
        assert.equal(r.depth, 2);
    });
    it("releaseDepth decrements", () => {
        el.trackDepth("wf-depth-3");
        el.trackDepth("wf-depth-3");
        el.releaseDepth("wf-depth-3");
        assert.equal(el.getDepth("wf-depth-3"), 1);
    });
    it("getDepth returns 0 for unknown workflow", () => {
        assert.equal(el.getDepth("wf-no-depth"), 0);
    });
    it("trackDepth returns allowed:false when depth exceeds limit", () => {
        for (let i = 0; i < 10; i++) el.trackDepth("wf-deep");
        const r = el.trackDepth("wf-deep", { maxDepth: 10 });
        assert.equal(r.allowed, false);
    });
});

describe("executionLimits — createLimiter", () => {
    it("tick returns allowed:true initially", () => {
        const lim = el.createLimiter();
        assert.equal(lim.tick("retry").allowed, true);
    });
    it("exceeded() is false initially", () => {
        const lim = el.createLimiter();
        assert.equal(lim.exceeded(), false);
    });
    it("exceeded() becomes true after limit breach", () => {
        const lim = el.createLimiter({ maxRetries: 2 });
        lim.tick("retry"); lim.tick("retry"); lim.tick("retry");
        assert.equal(lim.exceeded(), true);
    });
    it("summary() returns retries, repairLoops, violations", () => {
        const lim = el.createLimiter({ maxRepairLoops: 1 });
        lim.tick("repair"); lim.tick("repair");
        const s = lim.summary();
        assert.ok("retries"     in s);
        assert.ok("repairLoops" in s);
        assert.ok("violations"  in s);
    });
    it("violations are unique (not duplicated)", () => {
        const lim = el.createLimiter({ maxRetries: 1 });
        for (let i = 0; i < 5; i++) lim.tick("retry");
        assert.equal(lim.summary().violations.filter(v => v === "maxRetries").length, 1);
    });
    it("lim.reset() clears counts", () => {
        const lim = el.createLimiter({ maxRetries: 2 });
        lim.tick("retry"); lim.tick("retry"); lim.tick("retry");
        lim.reset();
        assert.equal(lim.exceeded(), false);
        assert.equal(lim.summary().retries, 0);
    });
});

// ── costAnalyzer ──────────────────────────────────────────────────────

describe("costAnalyzer — estimateTokens", () => {
    afterEach(() => ca.reset());

    it("empty string → 0 tokens", () => {
        assert.equal(ca.estimateTokens(""), 0);
    });
    it("non-string → 0 tokens", () => {
        assert.equal(ca.estimateTokens(null), 0);
    });
    it("4 chars ≈ 1 token", () => {
        assert.equal(ca.estimateTokens("abcd"), 1);
    });
    it("scales linearly", () => {
        const t100  = ca.estimateTokens("a".repeat(400));
        const t200  = ca.estimateTokens("a".repeat(800));
        assert.equal(t200, t100 * 2);
    });
    it("CHARS_PER_TOKEN constant is 4", () => {
        assert.equal(ca.CHARS_PER_TOKEN, 4);
    });
});

describe("costAnalyzer — estimateCost", () => {
    afterEach(() => ca.reset());

    it("returns inputCost, outputCost, totalCost", () => {
        const r = ca.estimateCost(1000, 200);
        assert.ok("inputCost"  in r);
        assert.ok("outputCost" in r);
        assert.ok("totalCost"  in r);
    });
    it("output costs more per token than input", () => {
        const r = ca.estimateCost(0, 1000);
        assert.ok(r.outputCost > ca.estimateCost(1000, 0).inputCost);
    });
    it("totalCost = inputCost + outputCost", () => {
        const r = ca.estimateCost(1000, 500);
        assert.ok(Math.abs(r.totalCost - (r.inputCost + r.outputCost)) < 0.000001);
    });
    it("zero tokens → zero cost", () => {
        const r = ca.estimateCost(0, 0);
        assert.equal(r.totalCost, 0);
    });
});

describe("costAnalyzer — record + getCost", () => {
    afterEach(() => ca.reset());

    it("getCost returns null for unknown id", () => {
        assert.equal(ca.getCost("no-such-id"), null);
    });
    it("record + getCost returns entry", () => {
        ca.record("exec-1", "input text here", "output text", 100);
        const c = ca.getCost("exec-1");
        assert.ok(c !== null);
        assert.equal(c.id, "exec-1");
    });
    it("tokens > 0 after recording non-empty texts", () => {
        ca.record("exec-2", "a".repeat(400), "b".repeat(200), 50);
        const c = ca.getCost("exec-2");
        assert.ok(c.tokens > 0);
    });
    it("multiple records for same id accumulate", () => {
        ca.record("multi", "aaaa", "bbbb", 10);
        ca.record("multi", "cccc", "dddd", 20);
        const c = ca.getCost("multi");
        assert.equal(c.attempts, 2);
        assert.ok(c.durationMs === 30);
    });
});

describe("costAnalyzer — repairOverhead", () => {
    afterEach(() => ca.reset());

    it("returns required fields", () => {
        const r = ca.repairOverhead("syntax_error", 3);
        assert.ok("type"               in r);
        assert.ok("attempts"           in r);
        assert.ok("totalTokens"        in r);
        assert.ok("totalCost"          in r);
        assert.ok("avgCostPerAttempt"  in r);
    });
    it("totalTokens scales with attempts", () => {
        const r1 = ca.repairOverhead("type_error", 1);
        const r3 = ca.repairOverhead("type_error", 3);
        assert.equal(r3.totalTokens, r1.totalTokens * 3);
    });
});

describe("costAnalyzer — fullReport", () => {
    afterEach(() => ca.reset());

    it("returns empty report with no records", () => {
        const r = ca.fullReport();
        assert.equal(r.totalRecords, 0);
        assert.equal(r.totalCost,    0);
    });
    it("totalRecords matches recorded count", () => {
        ca.record("a", "txt", "txt", 10, { type: "deploy" });
        ca.record("b", "txt", "txt", 20, { type: "repair" });
        const r = ca.fullReport();
        assert.equal(r.totalRecords, 2);
    });
    it("costByType groups by type", () => {
        ca.record("x", "a".repeat(400), "", 10, { type: "deploy" });
        ca.record("y", "b".repeat(400), "", 10, { type: "deploy" });
        const r = ca.fullReport();
        assert.equal(r.costByType.deploy.count, 2);
    });
    it("heaviestWorkflows is sorted by cost desc", () => {
        ca.record("cheap", "x",         "", 5, { type: "a" });
        ca.record("pricey", "x".repeat(10000), "", 50, { type: "b" });
        const r = ca.fullReport();
        assert.equal(r.heaviestWorkflows[0].id, "pricey");
    });
    it("avgCostPerExecution is totalCost / totalRecords", () => {
        ca.record("t1", "a".repeat(400), "", 10);
        ca.record("t2", "a".repeat(400), "", 10);
        const r = ca.fullReport();
        assert.ok(Math.abs(r.avgCostPerExecution - r.totalCost / 2) < 0.000001);
    });
});

// ── taskBenchmark — run ───────────────────────────────────────────────

describe("taskBenchmark — run", () => {
    afterEach(() => tb.reset());

    it("run returns required metric fields", async () => {
        const r = await tb.run(() => ({ success: true }), 3);
        assert.ok("runs"        in r);
        assert.ok("successRate" in r);
        assert.ok("failRate"    in r);
        assert.ok("avgMs"       in r);
        assert.ok("p50Ms"       in r);
        assert.ok("p95Ms"       in r);
        assert.ok("flipRate"    in r);
        assert.ok("consistency" in r);
    });
    it("all-success → successRate 1", async () => {
        const r = await tb.run(() => ({ success: true }), 5);
        assert.equal(r.successRate, 1);
    });
    it("all-fail → failRate 1", async () => {
        const r = await tb.run(() => ({ success: false }), 5);
        assert.equal(r.failRate, 1);
    });
    it("alternating → flipRate 1.0", async () => {
        let i = 0;
        const r = await tb.run(() => ({ success: i++ % 2 === 0 }), 6);
        assert.equal(r.flipRate, 1);
    });
    it("consistent → consistency:true", async () => {
        const r = await tb.run(() => ({ success: true }), 10);
        assert.equal(r.consistency, true);
    });
    it("runs array length matches times", async () => {
        const r = await tb.run(() => ({ success: true }), 7);
        assert.equal(r.runs.length, 7);
    });
    it("handles thrown errors as failures", async () => {
        const r = await tb.run(() => { throw new Error("boom"); }, 3);
        assert.equal(r.successRate, 0);
        assert.ok(r.runs.every(run => run.error != null));
    });
    it("repaired flag propagated from scenario", async () => {
        const r = await tb.run(() => ({ success: true, repaired: true }), 4);
        assert.ok(r.runs.every(run => run.repaired));
    });
});

describe("taskBenchmark — score", () => {
    it("returns all score dimensions", () => {
        const s = tb.score({ successRate: 0.9, flipRate: 0.05, runs: [] });
        assert.ok("completion"      in s);
        assert.ok("repairRate"      in s);
        assert.ok("stability"       in s);
        assert.ok("reproducibility" in s);
        assert.ok("composite"       in s);
    });
    it("perfect run gives high composite", () => {
        const s = tb.score({
            successRate: 1, flipRate: 0,
            runs: Array(10).fill({ success: true, repaired: true }),
        });
        assert.ok(s.composite >= 80);
    });
    it("all-fail run gives low composite", () => {
        const s = tb.score({
            successRate: 0, flipRate: 0,
            runs: Array(10).fill({ success: false, repaired: false }),
        });
        assert.ok(s.composite < 40);
    });
    it("all scores are 0–100", () => {
        const s = tb.score({ successRate: 0.5, flipRate: 0.3, runs: [] });
        for (const v of Object.values(s)) {
            assert.ok(v >= 0 && v <= 100, `${v} out of range`);
        }
    });
});

describe("taskBenchmark — store + getAll", () => {
    afterEach(() => tb.reset());

    it("getAll returns empty array initially", () => {
        assert.deepEqual(tb.getAll(), []);
    });
    it("store adds to getAll", () => {
        tb.store("my-bench", { successRate: 0.9 });
        assert.equal(tb.getAll().length, 1);
    });
    it("each stored entry has name and ts", () => {
        tb.store("bench-x", { successRate: 1 });
        const all = tb.getAll();
        assert.ok("name" in all[0]);
        assert.ok("ts"   in all[0]);
    });
});
