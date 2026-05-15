"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ts   = require("../../agents/runtime/trust/executionTrustScorer.cjs");
const td   = require("../../agents/runtime/trust/trustDecay.cjs");
const cc   = require("../../agents/runtime/trust/confidenceCalibrator.cjs");
const tt   = require("../../agents/runtime/trust/trustTelemetry.cjs");

// ── executionTrustScorer ──────────────────────────────────────────────

describe("executionTrustScorer", () => {
    describe("grade", () => {
        it("90+ → A", () => assert.equal(ts.grade(95), "A"));
        it("75-89 → B", () => assert.equal(ts.grade(80), "B"));
        it("60-74 → C", () => assert.equal(ts.grade(65), "C"));
        it("40-59 → D", () => assert.equal(ts.grade(50), "D"));
        it("0-39 → F",  () => assert.equal(ts.grade(20), "F"));
    });

    describe("scoreCapability", () => {
        it("returns score, grade, factors", () => {
            const r = ts.scoreCapability({ total: 10, successes: 9, failures: 1 });
            assert.ok("score"   in r);
            assert.ok("grade"   in r);
            assert.ok("factors" in r);
        });

        it("perfect history scores near 90", () => {
            const r = ts.scoreCapability({ total: 100, successes: 100, failures: 0 });
            assert.ok(r.score >= 85, `expected >=85, got ${r.score}`);
        });

        it("all failures scores near 0", () => {
            const r = ts.scoreCapability({ total: 10, successes: 0, failures: 10 });
            assert.ok(r.score <= 20, `expected <=20, got ${r.score}`);
        });

        it("no history returns mid-range score", () => {
            const r = ts.scoreCapability({});
            assert.ok(r.score >= 30 && r.score <= 75, `expected 30–75, got ${r.score}`);
        });

        it("score is clamped to 0–100", () => {
            const r = ts.scoreCapability({ total: 0, successes: 0, failures: 100 });
            assert.ok(r.score >= 0 && r.score <= 100);
        });
    });

    describe("scoreWorkflow", () => {
        it("all completed steps scores high", () => {
            const steps = [
                { state: "completed", attempts: 1 },
                { state: "completed", attempts: 1 },
            ];
            const r = ts.scoreWorkflow(steps);
            assert.ok(r.score >= 70, `expected >=70, got ${r.score}`);
        });

        it("all failed steps scores low", () => {
            const steps = [
                { state: "failed", attempts: 1 },
                { state: "failed", attempts: 1 },
            ];
            const r = ts.scoreWorkflow(steps);
            assert.ok(r.score < 60, `expected <60, got ${r.score}`);
        });

        it("retries reduce score", () => {
            const noRetry   = ts.scoreWorkflow([{ state: "completed", attempts: 1 }]);
            const withRetry = ts.scoreWorkflow([{ state: "completed", attempts: 4 }]);
            assert.ok(noRetry.score > withRetry.score);
        });

        it("empty steps returns a valid score", () => {
            const r = ts.scoreWorkflow([]);
            assert.ok(r.score >= 0 && r.score <= 100);
        });
    });

    describe("scoreRecovery", () => {
        it("all successful rollbacks scores high", () => {
            const r = ts.scoreRecovery([{ success: true }, { success: true }]);
            assert.ok(r.score >= 80, `expected >=80, got ${r.score}`);
        });

        it("all failed rollbacks scores low", () => {
            const r = ts.scoreRecovery([{ success: false }, { success: false }]);
            assert.ok(r.score < 60, `expected <60, got ${r.score}`);
        });

        it("no rollback history returns mid default", () => {
            const r = ts.scoreRecovery([]);
            assert.ok(r.score > 0);
            assert.ok(r.factors.noHistoryDefault);
        });
    });

    describe("applySandboxWeighting", () => {
        it("adds 10 when sandboxed", () => {
            const base    = 70;
            const sandboxed = ts.applySandboxWeighting(base, true);
            assert.equal(sandboxed, 80);
        });

        it("no change when not sandboxed", () => {
            assert.equal(ts.applySandboxWeighting(70, false), 70);
        });

        it("clamps to 100 at the top", () => {
            assert.equal(ts.applySandboxWeighting(95, true), 100);
        });
    });

    describe("scoreReliability", () => {
        it("perfect stats scores near 75+", () => {
            const r = ts.scoreReliability({ successRate: 1.0, avgRetries: 0, p99Ms: 1000 });
            assert.ok(r.score >= 70, `expected >=70, got ${r.score}`);
        });

        it("high latency reduces score", () => {
            const fast = ts.scoreReliability({ successRate: 0.8, avgRetries: 0, p99Ms: 1000 });
            const slow = ts.scoreReliability({ successRate: 0.8, avgRetries: 0, p99Ms: 90_000 });
            assert.ok(fast.score > slow.score);
        });

        it("high retries reduce score", () => {
            const low  = ts.scoreReliability({ successRate: 0.9, avgRetries: 0 });
            const high = ts.scoreReliability({ successRate: 0.9, avgRetries: 5 });
            assert.ok(low.score > high.score);
        });
    });
});

// ── trustDecay ────────────────────────────────────────────────────────

describe("trustDecay", () => {
    afterEach(() => td.resetDecay());

    describe("getDecayFactor", () => {
        it("returns 1.0 for entity with no failures", () => {
            assert.equal(td.getDecayFactor("fresh"), 1.0);
        });

        it("factor decreases with each failure", () => {
            td.addFailure("ent-1");
            td.addFailure("ent-1");
            const f = td.getDecayFactor("ent-1");
            assert.ok(f < 1.0, `factor should be < 1.0, got ${f}`);
        });

        it("factor never drops below 0.1", () => {
            for (let i = 0; i < 20; i++) td.addFailure("ent-floor");
            assert.ok(td.getDecayFactor("ent-floor") >= 0.1);
        });
    });

    describe("addFailure", () => {
        it("returns entityId and factor", () => {
            const r = td.addFailure("ent-2");
            assert.equal(r.entityId, "ent-2");
            assert.ok("factor" in r);
            assert.ok("failures" in r);
        });

        it("accumulates failures correctly", () => {
            td.addFailure("ent-3");
            td.addFailure("ent-3");
            const r = td.addFailure("ent-3");
            assert.equal(r.failures, 3);
        });
    });

    describe("applyDecay", () => {
        it("score unchanged with no failures", () => {
            assert.equal(td.applyDecay(80, "clean"), 80);
        });

        it("score reduced after failures", () => {
            td.addFailure("decay-1");
            td.addFailure("decay-1");
            const decayed = td.applyDecay(100, "decay-1");
            assert.ok(decayed < 100);
        });
    });

    describe("resetDecay", () => {
        it("resetDecay(id) removes specific entity", () => {
            td.addFailure("reset-1");
            td.resetDecay("reset-1");
            assert.equal(td.getDecayFactor("reset-1"), 1.0);
        });

        it("resetDecay() clears all entities", () => {
            td.addFailure("a"); td.addFailure("b");
            td.resetDecay();
            assert.equal(td.getDecayFactor("a"), 1.0);
            assert.equal(td.getDecayFactor("b"), 1.0);
        });
    });

    describe("getRecord", () => {
        it("returns null for unknown entity", () => {
            assert.equal(td.getRecord("ghost"), null);
        });

        it("returns failure count and factor", () => {
            td.addFailure("rec-1");
            const r = td.getRecord("rec-1");
            assert.equal(r.failures, 1);
            assert.ok("factor" in r);
            assert.ok("lastFailure" in r);
        });
    });
});

// ── confidenceCalibrator ──────────────────────────────────────────────

describe("confidenceCalibrator", () => {
    describe("calibrate", () => {
        it("returns confidence, grade, components", () => {
            const r = cc.calibrate({});
            assert.ok("confidence" in r);
            assert.ok("grade" in r);
            assert.ok("components" in r);
        });

        it("all best factors → high confidence", () => {
            const r = cc.calibrate({
                deterministic:      true,
                retries:            0,
                successRate:        1.0,
                depStability:       1.0,
                verificationPassed: true,
            });
            assert.ok(r.confidence >= 85, `expected >=85, got ${r.confidence}`);
        });

        it("all worst factors → low confidence", () => {
            const r = cc.calibrate({
                deterministic:      false,
                retries:            10,
                successRate:        0,
                depStability:       0,
                verificationPassed: false,
            });
            assert.ok(r.confidence <= 20, `expected <=20, got ${r.confidence}`);
        });

        it("deterministic adds 20", () => {
            const without = cc.calibrate({ deterministic: false });
            const with_   = cc.calibrate({ deterministic: true  });
            assert.equal(with_.components.deterministicAdd, 20);
            assert.ok(with_.confidence > without.confidence);
        });

        it("each retry reduces confidence by 5", () => {
            const r0 = cc.calibrate({ retries: 0 });
            const r2 = cc.calibrate({ retries: 2 });
            assert.equal(r0.confidence - r2.confidence, 10);
        });

        it("retryPenalty capped at 30", () => {
            const r = cc.calibrate({ retries: 100 });
            assert.equal(r.components.retryPenalty, 30);
        });

        it("verificationPassed adds 20", () => {
            const r = cc.calibrate({ verificationPassed: true });
            assert.equal(r.components.verificationAdd, 20);
        });

        it("confidence clamped to 0–100", () => {
            const r = cc.calibrate({
                deterministic: true, successRate: 1, depStability: 1, verificationPassed: true, retries: 0,
            });
            assert.ok(r.confidence <= 100);
        });

        it("no factors → base 20 only", () => {
            const r = cc.calibrate({});
            assert.equal(r.confidence, 20);
        });
    });
});

// ── trustTelemetry ────────────────────────────────────────────────────

describe("trustTelemetry", () => {
    afterEach(() => tt.reset());

    it("exports 5 event names", () => {
        const expected = [
            "trust_increase", "trust_decrease",
            "verification_success", "verification_failure",
            "hallucination_detected",
        ];
        for (const e of expected) assert.ok(tt.EVENTS.includes(e), `missing: ${e}`);
    });

    it("emitted event appears in log with ts", () => {
        tt.emit("trust_increase", { entityId: "x", delta: 5 });
        const log = tt.getLog();
        assert.equal(log.length, 1);
        assert.equal(log[0].event, "trust_increase");
        assert.ok("ts" in log[0]);
    });

    it("on handler called on matching event", () => {
        let called = false;
        tt.on("trust_decrease", () => { called = true; });
        tt.emit("trust_decrease", {});
        assert.ok(called);
    });

    it("off removes handler", () => {
        let count = 0;
        const fn = () => count++;
        tt.on("verification_success", fn);
        tt.off("verification_success", fn);
        tt.emit("verification_success", {});
        assert.equal(count, 0);
    });

    it("handler errors do not crash", () => {
        tt.on("hallucination_detected", () => { throw new Error("boom"); });
        assert.doesNotThrow(() => tt.emit("hallucination_detected", {}));
    });

    it("clearLog empties log but keeps handlers", () => {
        let fired = false;
        tt.on("verification_failure", () => { fired = true; });
        tt.emit("verification_failure", {});
        tt.clearLog();
        assert.deepEqual(tt.getLog(), []);
        tt.emit("verification_failure", {});
        assert.ok(fired);
    });

    it("multiple events logged in order", () => {
        tt.emit("trust_increase", {});
        tt.emit("trust_decrease", {});
        tt.emit("verification_success", {});
        assert.equal(tt.getLog().length, 3);
    });
});
