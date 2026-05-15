"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const wl  = require("../../agents/runtime/memory/workflowLearning.cjs");
const ari = require("../../agents/runtime/memory/adaptiveRetryIntelligence.cjs");
const ess = require("../../agents/runtime/memory/executionStrategySelector.cjs");
const map = require("../../agents/runtime/memory/memoryAwarePlanner.cjs");

// ── Shared test data helpers ──────────────────────────────────────────

function _entry(fingerprint, success, strategy = "direct", retryCount = 0) {
    return { fingerprint, success, strategy, retryCount, rollbackTriggered: false,
             ts: new Date().toISOString() };
}

// ── workflowLearning ──────────────────────────────────────────────────

describe("workflowLearning", () => {
    describe("identifyHighSuccess", () => {
        it("returns fingerprints with successRate >= threshold", () => {
            const entries = [
                _entry("fp1", true), _entry("fp1", true), _entry("fp1", true),
                _entry("fp2", true), _entry("fp2", false),
            ];
            const r = wl.identifyHighSuccess(entries, 0.9);
            assert.ok(r.some(x => x.fingerprint === "fp1"));
            assert.ok(!r.some(x => x.fingerprint === "fp2"));
        });

        it("includes executions count", () => {
            const entries = [_entry("fp3", true), _entry("fp3", true)];
            const r = wl.identifyHighSuccess(entries, 0.8);
            assert.equal(r[0].executions, 2);
        });

        it("returns empty for all-failure history", () => {
            const entries = [_entry("fp4", false), _entry("fp4", false)];
            assert.equal(wl.identifyHighSuccess(entries).length, 0);
        });

        it("default threshold 0.8", () => {
            const entries = [
                _entry("fp5", true), _entry("fp5", true), _entry("fp5", true),
                _entry("fp5", true), _entry("fp5", false),  // 80% → qualifies
            ];
            assert.ok(wl.identifyHighSuccess(entries).some(x => x.fingerprint === "fp5"));
        });
    });

    describe("identifyUnstable", () => {
        it("returns fingerprints with successRate < threshold and ≥2 executions", () => {
            const entries = [_entry("fp6", false), _entry("fp6", false)];
            const r = wl.identifyUnstable(entries, 0.5);
            assert.ok(r.some(x => x.fingerprint === "fp6"));
        });

        it("excludes fingerprints with only 1 execution", () => {
            const entries = [_entry("fp7", false)];
            assert.equal(wl.identifyUnstable(entries).length, 0);
        });

        it("excludes high-success fingerprints", () => {
            const entries = [_entry("fp8", true), _entry("fp8", true)];
            assert.equal(wl.identifyUnstable(entries).length, 0);
        });
    });

    describe("recommendStrategy", () => {
        it("returns most-used successful strategy", () => {
            const entries = [
                _entry("fp9", true, "staged"),
                _entry("fp9", true, "staged"),
                _entry("fp9", true, "direct"),
            ];
            assert.equal(wl.recommendStrategy("fp9", entries), "staged");
        });

        it("returns safe for unknown fingerprint", () => {
            assert.equal(wl.recommendStrategy("unknown", []), "safe");
        });

        it("ignores failed entries", () => {
            const entries = [
                _entry("fp10", false, "direct"),
                _entry("fp10", true,  "sandbox"),
            ];
            assert.equal(wl.recommendStrategy("fp10", entries), "sandbox");
        });
    });

    describe("shouldAvoid", () => {
        it("returns avoid:false for unknown fingerprint", () => {
            assert.ok(!wl.shouldAvoid("unknown", []).avoid);
        });

        it("returns avoid:false for single failure", () => {
            const entries = [_entry("fp11", false)];
            assert.ok(!wl.shouldAvoid("fp11", entries, 3).avoid);
        });

        it("returns avoid:true after 3 consecutive failures", () => {
            const entries = [
                _entry("fp12", false),
                _entry("fp12", false),
                _entry("fp12", false),
            ];
            const r = wl.shouldAvoid("fp12", entries, 3);
            assert.ok(r.avoid);
            assert.ok(r.reason.includes("consecutive"));
        });

        it("resets consecutive count after a success", () => {
            const entries = [
                _entry("fp13", false),
                _entry("fp13", true),   // reset
                _entry("fp13", false),
                _entry("fp13", false),
            ];
            assert.ok(!wl.shouldAvoid("fp13", entries, 3).avoid);
        });
    });
});

// ── adaptiveRetryIntelligence ─────────────────────────────────────────

describe("adaptiveRetryIntelligence", () => {
    describe("computePolicy", () => {
        it("returns a valid retry policy shape", () => {
            const p = ari.computePolicy({});
            assert.ok("maxRetries"        in p);
            assert.ok("backoffMs"         in p);
            assert.ok("backoffMultiplier" in p);
            assert.ok(Array.isArray(p.retryableExitCodes));
        });

        it("stable deps → base maxRetries", () => {
            const p = ari.computePolicy({ depStability: 1.0 });
            assert.equal(p.maxRetries, ari.BASE_POLICY.maxRetries);
        });

        it("low dep stability increases maxRetries", () => {
            const stable   = ari.computePolicy({ depStability: 1.0 });
            const unstable = ari.computePolicy({ depStability: 0.3 });
            assert.ok(unstable.maxRetries > stable.maxRetries);
        });

        it("high complexity reduces maxRetries", () => {
            const low  = ari.computePolicy({ complexity: 0.1 });
            const high = ari.computePolicy({ complexity: 0.9 });
            assert.ok(high.maxRetries <= low.maxRetries);
        });

        it("rollback history increases backoffMs", () => {
            const noRb = ari.computePolicy({ rollbackCount: 0 });
            const withRb = ari.computePolicy({ rollbackCount: 3 });
            assert.ok(withRb.backoffMs > noRb.backoffMs);
        });

        it("historical retry wins raise maxRetries to at least 2", () => {
            const entries = [{ fingerprint: "fp14", success: true, retryCount: 2 }];
            const p = ari.computePolicy({ fingerprint: "fp14", entries, depStability: 1.0 });
            assert.ok(p.maxRetries >= 2);
        });

        it("maxRetries never goes below 1", () => {
            const p = ari.computePolicy({ complexity: 1.0, depStability: 1.0 });
            assert.ok(p.maxRetries >= 1);
        });
    });
});

// ── executionStrategySelector ─────────────────────────────────────────

describe("executionStrategySelector", () => {
    describe("STRATEGIES", () => {
        it("exports 4 strategies", () => {
            const expected = ["safe", "fast", "recovery_first", "sandbox"];
            for (const s of expected) assert.ok(ess.STRATEGIES.includes(s), `missing: ${s}`);
        });
    });

    describe("select", () => {
        it("sandboxRequired → sandbox", () => {
            assert.equal(ess.select({ sandboxRequired: true }), "sandbox");
        });

        it("high rollbackRate → recovery_first", () => {
            assert.equal(ess.select({ rollbackRate: 0.5 }), "recovery_first");
        });

        it("very low successRate → recovery_first", () => {
            assert.equal(ess.select({ successRate: 0.1, rollbackRate: 0 }), "recovery_first");
        });

        it("unstable deps → safe", () => {
            assert.equal(ess.select({ depStability: 0.4, successRate: 0.9 }), "safe");
        });

        it("high success + low complexity + low rollback → fast", () => {
            const s = ess.select({ successRate: 0.95, complexity: 0.2, rollbackRate: 0.0, depStability: 0.9 });
            assert.equal(s, "fast");
        });

        it("default with no context → safe", () => {
            assert.equal(ess.select({}), "safe");
        });

        it("sandboxRequired beats everything", () => {
            assert.equal(ess.select({ sandboxRequired: true, successRate: 1.0, depStability: 1.0 }), "sandbox");
        });
    });
});

// ── memoryAwarePlanner ────────────────────────────────────────────────

describe("memoryAwarePlanner", () => {
    describe("lookupPlan", () => {
        it("returns found:false for unknown fingerprint", () => {
            const r = map.lookupPlan("unknown", []);
            assert.ok(!r.found);
            assert.equal(r.recommendation, "no_history");
        });

        it("returns found:true with strategy when successes exist", () => {
            const entries = [{ fingerprint: "fp15", success: true, strategy: "staged" }];
            const r = map.lookupPlan("fp15", entries);
            assert.ok(r.found);
            assert.equal(r.strategy, "staged");
            assert.equal(r.recommendation, "reuse_strategy");
        });

        it("returns proceed_with_caution when failures exist but no success", () => {
            const entries = [{ fingerprint: "fp16", success: false }];
            const r = map.lookupPlan("fp16", entries);
            assert.ok(!r.found);
            assert.equal(r.recommendation, "proceed_with_caution");
        });

        it("returns latest successful record", () => {
            const entries = [
                { fingerprint: "fp17", success: true, strategy: "direct" },
                { fingerprint: "fp17", success: true, strategy: "sandbox" },
            ];
            const r = map.lookupPlan("fp17", entries);
            assert.equal(r.strategy, "sandbox");
        });
    });

    describe("shouldReject", () => {
        it("returns reject:false for unknown fingerprint", () => {
            assert.ok(!map.shouldReject("unknown", []).reject);
        });

        it("returns reject:false when failures < threshold", () => {
            const entries = [{ fingerprint: "fp18", success: false }];
            assert.ok(!map.shouldReject("fp18", entries, 3).reject);
        });

        it("returns reject:true at threshold failures with 0 successes", () => {
            const entries = [
                { fingerprint: "fp19", success: false },
                { fingerprint: "fp19", success: false },
                { fingerprint: "fp19", success: false },
            ];
            const r = map.shouldReject("fp19", entries, 3);
            assert.ok(r.reject);
            assert.ok(r.reason.includes("fp19"));
        });

        it("returns reject:false when there is at least 1 success", () => {
            const entries = [
                { fingerprint: "fp20", success: false },
                { fingerprint: "fp20", success: false },
                { fingerprint: "fp20", success: false },
                { fingerprint: "fp20", success: true  },
            ];
            assert.ok(!map.shouldReject("fp20", entries, 3).reject);
        });
    });

    describe("boostConfidence", () => {
        it("no boost for unknown fingerprint", () => {
            assert.equal(map.boostConfidence(60, "unknown", []), 60);
        });

        it("+10 per success, capped at +25", () => {
            const entries = [
                { fingerprint: "fp21", success: true },
                { fingerprint: "fp21", success: true },
            ];
            const r = map.boostConfidence(60, "fp21", entries);
            assert.equal(r, 80);  // 60 + 20
        });

        it("boost capped at +25 even with many successes", () => {
            const entries = Array.from({ length: 10 }, () => ({ fingerprint: "fp22", success: true }));
            const r = map.boostConfidence(60, "fp22", entries);
            assert.equal(r, 85);  // 60 + 25 (cap)
        });

        it("confidence capped at 100", () => {
            const entries = [{ fingerprint: "fp23", success: true }];
            const r = map.boostConfidence(99, "fp23", entries);
            assert.equal(r, 100);
        });

        it("ignores failed entries", () => {
            const entries = [{ fingerprint: "fp24", success: false }];
            assert.equal(map.boostConfidence(60, "fp24", entries), 60);
        });
    });

    describe("worstCaseStrategy", () => {
        it("returns safe for unknown fingerprint", () => {
            assert.equal(map.worstCaseStrategy("unknown", []), "safe");
        });

        it("returns recovery_first when failures exist", () => {
            const entries = [{ fingerprint: "fp25", success: false, strategy: "direct" }];
            assert.equal(map.worstCaseStrategy("fp25", entries), "recovery_first");
        });
    });
});
