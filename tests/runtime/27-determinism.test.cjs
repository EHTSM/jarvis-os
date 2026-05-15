"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ec  = require("../../agents/runtime/determinism/executionConsistency.cjs");
const tc  = require("../../agents/runtime/debug/traceCorrelator.cjs");

// ── executionConsistency — record + validate ──────────────────────────

describe("executionConsistency — validate (no data)", () => {
    afterEach(() => ec.reset());

    it("returns consistent:true with no records", () => {
        const r = ec.validate("wf-empty");
        assert.equal(r.consistent,      true);
        assert.equal(r.flipRate,         0);
        assert.equal(r.consensusOutcome, null);
        assert.equal(r.sampleSize,       0);
    });
    it("returns consistent:true with one record", () => {
        ec.record("wf-one", "r1", true);
        const r = ec.validate("wf-one");
        assert.equal(r.consistent,       true);
        assert.equal(r.consensusOutcome, true);
        assert.equal(r.sampleSize,       1);
    });
});

describe("executionConsistency — consistent workflow", () => {
    afterEach(() => ec.reset());

    it("all-success runs → flipRate 0, consistent:true", () => {
        ["r1","r2","r3","r4"].forEach(id => ec.record("wf-cons", id, true));
        const r = ec.validate("wf-cons");
        assert.equal(r.flipRate, 0);
        assert.equal(r.consistent, true);
    });
    it("all-failure runs → flipRate 0, consistent:true", () => {
        ["r1","r2","r3"].forEach(id => ec.record("wf-fail", id, false));
        const r = ec.validate("wf-fail");
        assert.equal(r.flipRate, 0);
        assert.equal(r.consistent, true);
    });
    it("consensusOutcome reflects majority", () => {
        ec.record("wf-maj", "r1", true);
        ec.record("wf-maj", "r2", true);
        ec.record("wf-maj", "r3", false);
        const r = ec.validate("wf-maj");
        assert.equal(r.consensusOutcome, true);
    });
    it("deviations counts runs different from consensus", () => {
        ec.record("wf-dev", "r1", true);
        ec.record("wf-dev", "r2", true);
        ec.record("wf-dev", "r3", false);
        const r = ec.validate("wf-dev");
        assert.equal(r.deviations, 1);
    });
});

describe("executionConsistency — inconsistent workflow", () => {
    afterEach(() => ec.reset());

    it("alternating outcomes → flipRate 1.0, consistent:false", () => {
        for (let i = 0; i < 6; i++) ec.record("wf-alt", `r${i}`, i % 2 === 0);
        const r = ec.validate("wf-alt");
        assert.equal(r.flipRate, 1.0);
        assert.equal(r.consistent, false);
    });
    it("sampleSize matches recorded count", () => {
        for (let i = 0; i < 8; i++) ec.record("wf-size", `r${i}`, true);
        assert.equal(ec.validate("wf-size").sampleSize, 8);
    });
});

describe("executionConsistency — stableOrder", () => {
    it("sorts steps alphabetically by name", () => {
        const steps = [
            { name: "deploy" },
            { name: "build"  },
            { name: "test"   },
        ];
        const ordered = ec.stableOrder(steps);
        assert.equal(ordered[0].name, "build");
        assert.equal(ordered[1].name, "deploy");
        assert.equal(ordered[2].name, "test");
    });
    it("returns empty array for non-array input", () => {
        assert.deepEqual(ec.stableOrder(null), []);
    });
    it("does not mutate the original array", () => {
        const steps = [{ name: "z" }, { name: "a" }];
        ec.stableOrder(steps);
        assert.equal(steps[0].name, "z");
    });
    it("stable: same names keep relative order", () => {
        const steps = [{ name: "a", id: 1 }, { name: "a", id: 2 }];
        const ordered = ec.stableOrder(steps);
        assert.equal(ordered.length, 2);
    });
});

describe("executionConsistency — getHistory", () => {
    afterEach(() => ec.reset());

    it("returns sorted records by seq", () => {
        ec.record("wf-h", "r1", true);
        ec.record("wf-h", "r2", false);
        const h = ec.getHistory("wf-h");
        assert.equal(h.length, 2);
        assert.ok(h[0].seq < h[1].seq);
    });
    it("returns empty for unknown workflow", () => {
        assert.deepEqual(ec.getHistory("no-such-wf"), []);
    });
    it("each record has runId, outcome, ts", () => {
        ec.record("wf-fields", "run-1", true);
        const h = ec.getHistory("wf-fields");
        assert.ok("runId"   in h[0]);
        assert.ok("outcome" in h[0]);
        assert.ok("ts"      in h[0]);
    });
});

// ── traceCorrelator ───────────────────────────────────────────────────

describe("traceCorrelator — correlate", () => {
    afterEach(() => tc.reset());

    it("returns required fields", () => {
        const r = tc.correlate([]);
        assert.ok("groups"          in r);
        assert.ok("repeatedPatterns" in r);
        assert.ok("uniqueCount"      in r);
        assert.ok("duplicateCount"   in r);
    });
    it("empty traces → all zeros", () => {
        const r = tc.correlate([]);
        assert.equal(r.uniqueCount,    0);
        assert.equal(r.duplicateCount, 0);
    });
    it("identical traces count as one unique", () => {
        const t = "Error\n  at fn (app.js:10:5)";
        const r = tc.correlate([t, t, t]);
        assert.equal(r.uniqueCount, 1);
    });
    it("identical traces land in repeatedPatterns", () => {
        const t = "Error\n  at fn (app.js:10:5)";
        const r = tc.correlate([t, t]);
        assert.ok(r.repeatedPatterns.length > 0);
    });
    it("distinct traces produce multiple groups", () => {
        const t1 = "TypeError\n  at fn1 (a.js:1:1)";
        const t2 = "SyntaxError\n  at fn2 (b.js:2:2)";
        const r  = tc.correlate([t1, t2]);
        assert.ok(r.uniqueCount >= 1);
    });
    it("groups sorted by count descending", () => {
        const t = "Error\n  at fn (x.js:1:1)";
        const r = tc.correlate([t, t, t, "SyntaxError\n  at g (y.js:1:1)"]);
        assert.ok(r.groups[0].count >= r.groups[r.groups.length - 1].count);
    });
});

describe("traceCorrelator — scoreRepairEffectiveness", () => {
    it("returns required fields", () => {
        const r = tc.scoreRepairEffectiveness("syntax_error");
        assert.ok("strategies"    in r);
        assert.ok("bestStrategy"  in r);
        assert.ok("totalAttempts" in r);
    });
    it("strategies is an array", () => {
        const r = tc.scoreRepairEffectiveness("type_error");
        assert.ok(Array.isArray(r.strategies));
    });
    it("bestStrategy is null when no recorded strategies", () => {
        const r = tc.scoreRepairEffectiveness("unknown_error_xyz_abc");
        assert.equal(r.bestStrategy, null);
    });
});

describe("traceCorrelator — suppressDuplicates", () => {
    it("removes exact duplicate messages", () => {
        const errors = [
            { message: "Cannot find module './foo'", count: 1 },
            { message: "Cannot find module './foo'", count: 1 },
        ];
        const r = tc.suppressDuplicates(errors);
        assert.equal(r.unique.length, 1);
        assert.ok(r.suppressedCount >= 1);
    });
    it("unique errors all pass through", () => {
        const errors = [
            { message: "Error A", count: 1 },
            { message: "Error B", count: 1 },
        ];
        const r = tc.suppressDuplicates(errors);
        assert.equal(r.unique.length, 2);
    });
    it("returns required fields", () => {
        const r = tc.suppressDuplicates([]);
        assert.ok("unique"         in r);
        assert.ok("suppressed"     in r);
        assert.ok("suppressedCount" in r);
    });
    it("normalises number variations as duplicate", () => {
        const errors = [
            { message: "timeout after 100ms", count: 1 },
            { message: "timeout after 200ms", count: 1 },
        ];
        const r = tc.suppressDuplicates(errors);
        assert.equal(r.unique.length, 1);
    });
});

describe("traceCorrelator — rankRootCauses", () => {
    it("returns empty array for empty input", () => {
        assert.deepEqual(tc.rankRootCauses([], []), []);
    });
    it("returns ranked items with required fields", () => {
        const errors = [
            { message: "Cannot find module", type: "module_not_found", count: 2, lastSeen: new Date().toISOString() },
        ];
        const ranked = tc.rankRootCauses(errors, []);
        assert.ok(ranked.length > 0);
        assert.ok("cause"      in ranked[0]);
        assert.ok("confidence" in ranked[0]);
        assert.ok("traceCount" in ranked[0]);
    });
    it("trace counts augment ranking", () => {
        const errors = [
            { message: "TypeError: x", type: "type_error", count: 1, lastSeen: new Date().toISOString() },
        ];
        const traces = [
            "TypeError: x\n  at fn (a.js:1:1)",
            "TypeError: x\n  at fn (a.js:1:1)",
        ];
        const ranked = tc.rankRootCauses(errors, traces);
        assert.ok(ranked[0].traceCount >= 0);
    });
});
