"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const sp  = require("../../agents/runtime/intelligence/successPredictor.cjs");
const rw  = require("../../agents/runtime/intelligence/reliabilityWeighter.cjs");

// ── successPredictor — predict ────────────────────────────────────────

describe("successPredictor — predict (no history)", () => {
    it("returns score 50 and confidence 0 with no history", () => {
        const r = sp.predict("wf-no-history-xyz");
        assert.equal(r.score, 50);
        assert.equal(r.confidence, 0);
    });
    it("predictedSuccess is null with no history", () => {
        const r = sp.predict("wf-no-history-abc");
        assert.equal(r.predictedSuccess, null);
    });
    it("factors contains insufficient_history when no data", () => {
        const r = sp.predict("wf-empty-xyz");
        assert.ok(r.factors.includes("insufficient_history"));
    });
    it("repairProbability is null when no failure memory entry", () => {
        const r = sp.predict("wf-no-history-def");
        assert.equal(r.repairProbability, null);
    });
    it("returns object with required fields", () => {
        const r = sp.predict("wf-fields-check");
        assert.ok("score"             in r);
        assert.ok("confidence"        in r);
        assert.ok("predictedSuccess"  in r);
        assert.ok("repairProbability" in r);
        assert.ok("factors"           in r);
    });
});

describe("successPredictor — forecastExecution (no history)", () => {
    it("returns expectedSuccess null with no history", () => {
        const r = sp.forecastExecution("wf-fc-none");
        assert.equal(r.expectedSuccess, null);
    });
    it("returns confidence 0 with no history", () => {
        const r = sp.forecastExecution("wf-fc-none-2");
        assert.equal(r.confidence, 0);
    });
    it("returns sampleSize field", () => {
        const r = sp.forecastExecution("wf-fc-fields");
        assert.ok("sampleSize" in r);
    });
    it("returns trend field", () => {
        const r = sp.forecastExecution("wf-fc-trend");
        assert.ok("trend" in r);
    });
});

// ── reliabilityWeighter ───────────────────────────────────────────────

describe("reliabilityWeighter — weight (no history)", () => {
    afterEach(() => rw.reset());

    it("returns weight 0.50 and tier stable with no history", () => {
        const r = rw.weight("wf-rw-no-hist");
        assert.equal(r.weight, 0.50);
        assert.equal(r.tier,   "stable");
        assert.equal(r.basis,  "no_history");
    });
    it("returns object with weight, tier, basis", () => {
        const r = rw.weight("wf-rw-fields");
        assert.ok("weight" in r);
        assert.ok("tier"   in r);
        assert.ok("basis"  in r);
    });
});

describe("reliabilityWeighter — setOverride / clearOverride", () => {
    afterEach(() => rw.reset());

    it("setOverride returns trusted tier for 1.0", () => {
        rw.setOverride("wf-over-1", 1.0);
        const r = rw.weight("wf-over-1");
        assert.equal(r.tier,  "trusted");
        assert.equal(r.basis, "override");
    });
    it("setOverride returns unreliable tier for 0.0", () => {
        rw.setOverride("wf-over-2", 0.0);
        const r = rw.weight("wf-over-2");
        assert.equal(r.tier, "unreliable");
    });
    it("clearOverride restores no_history default", () => {
        rw.setOverride("wf-over-3", 0.9);
        rw.clearOverride("wf-over-3");
        const r = rw.weight("wf-over-3");
        assert.equal(r.basis, "no_history");
    });
    it("override clamps to [0,1]", () => {
        rw.setOverride("wf-clamp", 2.5);
        assert.ok(rw.weight("wf-clamp").weight <= 1);
    });
});

describe("reliabilityWeighter — rank", () => {
    afterEach(() => rw.reset());

    it("returns sorted array descending by weight", () => {
        rw.setOverride("wf-a", 0.9);
        rw.setOverride("wf-b", 0.3);
        rw.setOverride("wf-c", 0.6);
        const ranked = rw.rank(["wf-a", "wf-b", "wf-c"]);
        assert.equal(ranked[0].workflowId, "wf-a");
        assert.equal(ranked[2].workflowId, "wf-b");
    });
    it("each entry has workflowId, weight, tier", () => {
        rw.setOverride("wf-r", 0.5);
        const ranked = rw.rank(["wf-r"]);
        assert.ok("workflowId" in ranked[0]);
        assert.ok("weight"     in ranked[0]);
        assert.ok("tier"       in ranked[0]);
    });
    it("empty array returns empty rank", () => {
        assert.deepEqual(rw.rank([]), []);
    });
});

describe("reliabilityWeighter — TIERS", () => {
    it("trusted tier starts at 0.80", () => {
        const trusted = rw.TIERS.find(t => t.name === "trusted");
        assert.equal(trusted.min, 0.80);
    });
    it("has all four tier names", () => {
        const names = rw.TIERS.map(t => t.name);
        assert.ok(names.includes("trusted"));
        assert.ok(names.includes("stable"));
        assert.ok(names.includes("degraded"));
        assert.ok(names.includes("unreliable"));
    });
});
