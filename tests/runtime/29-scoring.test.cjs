"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ws  = require("../../agents/runtime/scoring/workflowScorer.cjs");
const rr  = require("../../agents/runtime/replay/repairReplayer.cjs");

// ── workflowScorer — scoreDeployment ──────────────────────────────────

describe("workflowScorer — scoreDeployment", () => {
    it("returns 0 for missing deploymentId", () => {
        assert.equal(ws.scoreDeployment(""), 0);
    });
    it("returns 100 for healthy deployment with no issues", () => {
        const r = ws.scoreDeployment("dep-1", { status: "healthy", events: [] });
        assert.ok(r > 0 && r <= 100);
    });
    it("reduces score for failed status", () => {
        const ok   = ws.scoreDeployment("dep-a", { status: "healthy",  events: [] });
        const fail = ws.scoreDeployment("dep-b", { status: "failed",   events: [] });
        assert.ok(fail < ok);
    });
    it("reduces score for rolled_back status", () => {
        const ok = ws.scoreDeployment("dep-c", { status: "healthy",     events: [] });
        const rb = ws.scoreDeployment("dep-d", { status: "rolled_back", events: [] });
        assert.ok(rb < ok);
    });
    it("health_check_passed event boosts score", () => {
        const without = ws.scoreDeployment("dep-e", { status: "healthy", events: [] });
        const with_   = ws.scoreDeployment("dep-f", {
            status: "healthy",
            events: [{ event: "health_check_passed" }],
        });
        assert.ok(with_ >= without);
    });
    it("score is between 0 and 100", () => {
        const r = ws.scoreDeployment("dep-x", { status: "failed", error: "boom", events: [] });
        assert.ok(r >= 0 && r <= 100);
    });
});

describe("workflowScorer — scoreDebugging", () => {
    it("returns 50 for no repairs", () => {
        assert.equal(ws.scoreDebugging("type_error", []), 50);
    });
    it("100% success rate gives high score", () => {
        const repairs = Array(5).fill({ success: true, durationMs: 100 });
        assert.ok(ws.scoreDebugging("type_error", repairs) > 60);
    });
    it("0% success rate gives low score", () => {
        const repairs = Array(5).fill({ success: false, durationMs: 500 });
        assert.ok(ws.scoreDebugging("type_error", repairs) < 50);
    });
    it("score is 0–100", () => {
        const repairs = [{ success: true, durationMs: 100 }];
        const s = ws.scoreDebugging("syntax_error", repairs);
        assert.ok(s >= 0 && s <= 100);
    });
});

describe("workflowScorer — scoreReproducibility", () => {
    it("returns a number between 0 and 100 (or 50 for no data)", () => {
        const r = ws.scoreReproducibility("wf-repro-test-xyz");
        assert.ok(r >= 0 && r <= 100);
    });
    it("neutral 50 for unknown workflow", () => {
        assert.equal(ws.scoreReproducibility("wf-unknown-xyz-abc"), 50);
    });
});

describe("workflowScorer — scoreRecovery", () => {
    it("returns a number 0–100", () => {
        const r = ws.scoreRecovery("any-wf");
        assert.ok(r >= 0 && r <= 100);
    });
});

describe("workflowScorer — scoreDeterminism", () => {
    it("returns a number 0–100", () => {
        const r = ws.scoreDeterminism("any-wf");
        assert.ok(r >= 0 && r <= 100);
    });
});

describe("workflowScorer — fullScore", () => {
    it("returns all five score keys", () => {
        const r = ws.fullScore("wf-full-test");
        assert.ok("deployment"     in r);
        assert.ok("debugging"      in r);
        assert.ok("reproducibility" in r);
        assert.ok("recovery"        in r);
        assert.ok("determinism"     in r);
        assert.ok("composite"       in r);
    });
    it("composite is within 0–100", () => {
        const r = ws.fullScore("wf-composite");
        assert.ok(r.composite >= 0 && r.composite <= 100);
    });
    it("deployment score propagates from context", () => {
        const r = ws.fullScore("wf-ctx", {
            deploymentRecord: { status: "healthy", events: [] },
        });
        assert.ok(r.deployment > 0);
    });
    it("debugging score propagates from context repairs", () => {
        const r = ws.fullScore("wf-debug-ctx", {
            errorType: "type_error",
            repairs:   [{ success: true, durationMs: 100 }],
        });
        assert.ok(r.debugging > 0);
    });
});

// ── repairReplayer ────────────────────────────────────────────────────

describe("repairReplayer — record + replaySuccessful", () => {
    afterEach(() => rr.reset());

    it("replaySuccessful returns empty array with no records", () => {
        assert.deepEqual(rr.replaySuccessful("type_error"), []);
    });
    it("replaySuccessful returns top N successful strategies", () => {
        rr.record("type_error", "strategy-a", true,  100);
        rr.record("type_error", "strategy-b", false, 200);
        rr.record("type_error", "strategy-c", true,  150);
        const top = rr.replaySuccessful("type_error", 2);
        assert.ok(top.length <= 2);
        assert.ok(top.every(s => s.successes > 0));
    });
    it("results include strategy, successRate, attempts, avgMs", () => {
        rr.record("syntax_error", "fix-a", true, 80);
        const top = rr.replaySuccessful("syntax_error");
        assert.ok("strategy"    in top[0]);
        assert.ok("successRate" in top[0]);
        assert.ok("attempts"    in top[0]);
        assert.ok("avgMs"       in top[0]);
    });
    it("successRate computed correctly", () => {
        rr.record("se", "fix-x", true,  50);
        rr.record("se", "fix-x", false, 50);
        rr.record("se", "fix-x", true,  50);
        const top = rr.replaySuccessful("se");
        assert.ok(Math.abs(top[0].successRate - 0.667) < 0.01);
    });
});

describe("repairReplayer — compare", () => {
    afterEach(() => rr.reset());

    it("returns required fields", () => {
        const r = rr.compare("type_error");
        assert.ok("errorType"     in r);
        assert.ok("strategies"    in r);
        assert.ok("bestStrategy"  in r);
        assert.ok("worstStrategy" in r);
    });
    it("empty when no records for type", () => {
        const r = rr.compare("nonexistent_type_xyz");
        assert.deepEqual(r.strategies, []);
        assert.equal(r.bestStrategy,  null);
    });
    it("bestStrategy is highest successRate", () => {
        rr.record("te", "bad",  false, 100);
        rr.record("te", "good", true,  100);
        const r = rr.compare("te");
        assert.equal(r.bestStrategy, "good");
    });
    it("worstStrategy is lowest successRate", () => {
        rr.record("te2", "x", true,  100);
        rr.record("te2", "y", false, 100);
        const r = rr.compare("te2");
        assert.equal(r.worstStrategy, "y");
    });
    it("strategies sorted descending by successRate", () => {
        rr.record("te3", "a", true,  100);
        rr.record("te3", "b", false, 100);
        const r = rr.compare("te3");
        assert.ok(r.strategies[0].successRate >= r.strategies[r.strategies.length - 1].successRate);
    });
});

describe("repairReplayer — benchmark", () => {
    afterEach(() => rr.reset());

    it("insufficient_data when fewer than 2 windows", () => {
        rr.record("bm-type", "s", true, 100);
        const r = rr.benchmark("bm-type", 5);
        assert.equal(r.trend, "insufficient_data");
    });
    it("trend is improving when successRate increases", () => {
        // Window 1: 0 successes, Window 2: all successes
        for (let i = 0; i < 5; i++) rr.record("bm-impr", "s", false, 10);
        for (let i = 0; i < 5; i++) rr.record("bm-impr", "s", true,  10);
        const r = rr.benchmark("bm-impr", 5);
        assert.equal(r.trend, "improving");
    });
    it("trend is degrading when successRate decreases", () => {
        for (let i = 0; i < 5; i++) rr.record("bm-degr", "s", true,  10);
        for (let i = 0; i < 5; i++) rr.record("bm-degr", "s", false, 10);
        const r = rr.benchmark("bm-degr", 5);
        assert.equal(r.trend, "degrading");
    });
    it("delta field is a number", () => {
        for (let i = 0; i < 10; i++) rr.record("bm-delta", "s", i % 2 === 0, 10);
        const r = rr.benchmark("bm-delta", 5);
        assert.ok(typeof r.delta === "number");
    });
    it("windows array is present", () => {
        for (let i = 0; i < 10; i++) rr.record("bm-wins", "s", true, 10);
        const r = rr.benchmark("bm-wins", 5);
        assert.ok(Array.isArray(r.windows));
    });
});

describe("repairReplayer — getAll", () => {
    afterEach(() => rr.reset());

    it("getAll returns all records when no filter", () => {
        rr.record("a", "s", true, 10);
        rr.record("b", "s", true, 10);
        assert.equal(rr.getAll().length, 2);
    });
    it("getAll(errorType) filters by type", () => {
        rr.record("type_a", "s", true, 10);
        rr.record("type_b", "s", true, 10);
        assert.equal(rr.getAll("type_a").length, 1);
    });
});
