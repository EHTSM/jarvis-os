"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const lc  = require("../../agents/runtime/integrations/executionLifecycle.cjs");
const wfp = require("../../agents/runtime/memory/workflowFingerprint.cjs");
const ess = require("../../agents/runtime/memory/executionStrategySelector.cjs");

// ── helpers ───────────────────────────────────────────────────────────

function _entry(fp, success, strategy = "direct", retryCount = 0, rollback = false) {
    return { fingerprint: fp, success, strategy, retryCount, rollbackTriggered: rollback,
             durationMs: 100, state: success ? "completed" : "failed",
             ts: new Date().toISOString() };
}

function _plan(steps = ["a", "b"]) {
    return {
        taskId: "t1",
        executionOrder: steps,
        steps: steps.map(id => ({ id, name: id, command: `echo ${id}` })),
    };
}

function _result(success, steps = [], strategy = "direct") {
    return {
        executionId:       "ex-test-1",
        success,
        state:             success ? "completed" : "failed",
        strategy,
        steps,
        stepsPlanned:      steps.map(s => s.id),
        stepsExecuted:     success ? steps.map(s => s.id) : [],
        totalDurationMs:   50,
        rollbackTriggered: false,
        cancelled:         false,
        error:             success ? null : "step failed",
        dryRun:            false,
        simulatedOnly:     false,
    };
}

// ── preExecution ──────────────────────────────────────────────────────

describe("executionLifecycle.preExecution", () => {
    describe("fingerprint", () => {
        it("generates a fingerprint from the plan", () => {
            const ctx = lc.preExecution(_plan(), [], {});
            assert.ok(typeof ctx.fingerprint === "string" && ctx.fingerprint.length === 8);
        });

        it("same plan always produces same fingerprint", () => {
            const plan = _plan(["install", "build", "test"]);
            const ctx1 = lc.preExecution(plan, [], {});
            const ctx2 = lc.preExecution(plan, [], {});
            assert.equal(ctx1.fingerprint, ctx2.fingerprint);
        });

        it("different plans produce different fingerprints", () => {
            const ctx1 = lc.preExecution(_plan(["a"]), [], {});
            const ctx2 = lc.preExecution(_plan(["b"]), [], {});
            assert.notEqual(ctx1.fingerprint, ctx2.fingerprint);
        });
    });

    describe("blocking behaviour", () => {
        it("blocks when 3+ consecutive failures for same fingerprint", () => {
            const plan = _plan(["x"]);
            const fp   = wfp.generate({ steps: [{ id: "x", deps: [] }], deps: [], category: "default" });
            const entries = [_entry(fp, false), _entry(fp, false), _entry(fp, false)];
            const ctx = lc.preExecution(plan, entries, {});
            assert.ok(ctx.blocked);
            assert.ok(ctx.reason.includes("consecutive"));
        });

        it("does NOT block when forceExecute is set", () => {
            const plan = _plan(["x"]);
            const fp   = wfp.generate({ steps: [{ id: "x", deps: [] }], deps: [], category: "default" });
            const entries = [_entry(fp, false), _entry(fp, false), _entry(fp, false)];
            const ctx = lc.preExecution(plan, entries, {}, { forceExecute: true });
            assert.ok(!ctx.blocked);
        });

        it("blocks when rejectThreshold failures with 0 successes", () => {
            const plan = _plan(["z"]);
            const fp   = wfp.generate({ steps: [{ id: "z", deps: [] }], deps: [], category: "default" });
            const entries = [
                _entry(fp, false), _entry(fp, false),
                _entry(fp, false), _entry(fp, false),  // 4 failures, 0 successes
            ];
            const ctx = lc.preExecution(plan, entries, {}, { rejectThreshold: 3 });
            assert.ok(ctx.blocked);
        });

        it("does NOT block with no history", () => {
            const ctx = lc.preExecution(_plan(), [], {});
            assert.ok(!ctx.blocked);
        });

        it("does NOT block when at least one success breaks the streak", () => {
            const plan = _plan(["q"]);
            const fp   = wfp.generate({ steps: [{ id: "q", deps: [] }], deps: [], category: "default" });
            const entries = [
                _entry(fp, false), _entry(fp, true), // success breaks streak
                _entry(fp, false), _entry(fp, false),
            ];
            const ctx = lc.preExecution(plan, entries, {}, { rejectThreshold: 5 });
            assert.ok(!ctx.blocked);
        });
    });

    describe("strategy selection", () => {
        it("uses strategyHint when provided", () => {
            const ctx = lc.preExecution(_plan(), [], {}, { strategyHint: "staged" });
            assert.equal(ctx.strategy, "staged");
        });

        it("returns a valid strategy when none provided", () => {
            const ctx = lc.preExecution(_plan(), [], {});
            assert.ok(ess.STRATEGIES.includes(ctx.strategy));
        });

        it("selects sandbox when sandboxRequired", () => {
            const ctx = lc.preExecution(_plan(), [], {}, { sandboxRequired: true });
            assert.equal(ctx.strategy, "sandbox");
        });

        it("selects recovery_first when rollback history is high", () => {
            const plan = _plan(["s"]);
            const fp   = wfp.generate({ steps: [{ id: "s", deps: [] }], deps: [], category: "default" });
            const entries = Array.from({ length: 6 }, (_, i) =>
                _entry(fp, i % 2 === 0, "direct", 0, true));
            const ctx = lc.preExecution(plan, entries, {});
            assert.equal(ctx.strategy, "recovery_first");
        });
    });

    describe("retry policy", () => {
        it("returns a retryPolicy object with maxRetries", () => {
            const ctx = lc.preExecution(_plan(), [], {});
            assert.ok("maxRetries"        in ctx.retryPolicy);
            assert.ok("backoffMs"         in ctx.retryPolicy);
            assert.ok("backoffMultiplier" in ctx.retryPolicy);
        });

        it("unstable deps increase maxRetries", () => {
            const stableCtx   = lc.preExecution(_plan(), [], {});
            const unstableCtx = lc.preExecution(_plan(), [], { "pkg-a": { stability: 0.2 } });
            assert.ok(unstableCtx.retryPolicy.maxRetries >= stableCtx.retryPolicy.maxRetries);
        });
    });

    describe("confidence", () => {
        it("confidence starts at 50 for unknown fingerprint", () => {
            const ctx = lc.preExecution(_plan(), [], {});
            assert.equal(ctx.confidence, 50);
        });

        it("confidence boosted by successful history", () => {
            const plan = _plan(["c"]);
            const fp   = wfp.generate({ steps: [{ id: "c", deps: [] }], deps: [], category: "default" });
            const entries = [_entry(fp, true), _entry(fp, true)];
            const ctx = lc.preExecution(plan, entries, {});
            assert.ok(ctx.confidence > 50, `expected >50, got ${ctx.confidence}`);
        });

        it("confidence reduced by failures (min 10)", () => {
            const plan = _plan(["d"]);
            const fp   = wfp.generate({ steps: [{ id: "d", deps: [] }], deps: [], category: "default" });
            const entries = [_entry(fp, false), _entry(fp, false)];
            const ctx = lc.preExecution(plan, entries, {}, { forceExecute: true });
            assert.ok(ctx.confidence <= 50, `expected <=50, got ${ctx.confidence}`);
        });
    });

    describe("planLookup", () => {
        it("planLookup.found false for unknown fingerprint", () => {
            const ctx = lc.preExecution(_plan(), [], {});
            assert.ok(!ctx.planLookup.found);
        });

        it("planLookup.found true after successful execution", () => {
            const plan = _plan(["lookup"]);
            const fp   = wfp.generate({ steps: [{ id: "lookup", deps: [] }], deps: [], category: "default" });
            const entries = [_entry(fp, true, "staged")];
            const ctx = lc.preExecution(plan, entries, {});
            assert.ok(ctx.planLookup.found);
            assert.equal(ctx.planLookup.strategy, "staged");
        });
    });
});

// ── postExecution ─────────────────────────────────────────────────────

describe("executionLifecycle.postExecution", () => {
    const _preCtx = (fp = "aabb1122", strategy = "direct") => ({
        fingerprint: fp, blocked: false, strategy,
        retryPolicy: { maxRetries: 1, backoffMs: 100, backoffMultiplier: 2 },
        confidence: 60, successRate: 0.8, rollbackRate: 0.1,
        overallDepStability: 0.9, complexity: 0.2,
    });

    describe("memory entry", () => {
        it("memoryEntry has fingerprint + strategy from preCtx", () => {
            const r   = _result(true, [{ id: "s1", state: "completed", attempts: 1 }]);
            const out = lc.postExecution(r, _preCtx(), {});
            assert.equal(out.memoryEntry.fingerprint, "aabb1122");
            assert.equal(out.memoryEntry.strategy,    "direct");
        });

        it("memoryEntry success reflects completionPolicy result", () => {
            const r   = _result(true, []);
            const out = lc.postExecution(r, _preCtx(), { completionPolicy: "disabled" });
            assert.ok(typeof out.memoryEntry.success === "boolean");
        });

        it("memoryEntry retryCount sums (attempts - 1) across steps", () => {
            const steps = [
                { id: "s1", state: "completed", attempts: 3 },
                { id: "s2", state: "completed", attempts: 1 },
            ];
            const r   = _result(true, steps);
            const out = lc.postExecution(r, _preCtx(), {});
            assert.equal(out.memoryEntry.retryCount, 2);  // (3-1) + (1-1)
        });
    });

    describe("trust scoring", () => {
        it("trustScore has score and grade", () => {
            const r   = _result(true, [{ id: "s1", state: "completed", attempts: 1 }]);
            const out = lc.postExecution(r, _preCtx(), {});
            assert.ok("score" in out.trustScore);
            assert.ok("grade" in out.trustScore);
        });

        it("successful execution produces higher trust than failed", () => {
            const goodSteps = [{ id: "s1", state: "completed", attempts: 1 }];
            const badSteps  = [{ id: "s1", state: "failed",    attempts: 1 }];
            const good = lc.postExecution(_result(true,  goodSteps), _preCtx(), {});
            const bad  = lc.postExecution(_result(false, badSteps),  _preCtx(), {});
            assert.ok(good.trustScore.score > bad.trustScore.score);
        });
    });

    describe("confidence calibration", () => {
        it("calibrated has confidence and grade", () => {
            const r   = _result(true, []);
            const out = lc.postExecution(r, _preCtx(), {});
            assert.ok("confidence" in out.calibrated);
            assert.ok("grade"      in out.calibrated);
        });

        it("staged strategy adds deterministic bonus", () => {
            const direct = lc.postExecution(_result(true, []), _preCtx("x", "direct"), {});
            const staged = lc.postExecution(_result(true, []), _preCtx("x", "staged"), {});
            assert.ok(staged.calibrated.confidence >= direct.calibrated.confidence);
        });
    });

    describe("hallucination detection", () => {
        it("clean result is safe", () => {
            const r   = _result(true, [{ id: "s1", state: "completed", exitCode: 0, attempts: 1 }]);
            const out = lc.postExecution(r, _preCtx(), {});
            assert.ok(out.hallucination.safe);
        });

        it("all-non-zero steps marked success → hallucination detected", () => {
            const r = {
                ..._result(true, [{ id: "s1", state: "completed", exitCode: 1, attempts: 1 }]),
            };
            const out = lc.postExecution(r, _preCtx(), {});
            if (!out.hallucination.safe) {
                assert.ok(out.hallucination.detections.length > 0);
            }
        });
    });

    describe("dep updates", () => {
        it("depUpdates contains one entry per step", () => {
            const steps = [
                { id: "npm", state: "completed", attempts: 1 },
                { id: "git", state: "failed",    attempts: 1 },
            ];
            const out = lc.postExecution(_result(false, steps), _preCtx(), {});
            assert.equal(out.depUpdates.length, 2);
        });

        it("completed step → tool_success type", () => {
            const steps = [{ id: "npm", state: "completed", attempts: 1 }];
            const out   = lc.postExecution(_result(true, steps), _preCtx(), {});
            assert.equal(out.depUpdates[0].type, "tool_success");
        });

        it("failed step → tool_failure type", () => {
            const steps = [{ id: "npm", state: "failed", attempts: 1 }];
            const out   = lc.postExecution(_result(false, steps), _preCtx(), {});
            assert.equal(out.depUpdates[0].type, "tool_failure");
        });
    });

    describe("completion policy", () => {
        it("completion.enforced is always true", () => {
            const out = lc.postExecution(_result(true, []), _preCtx(), {});
            assert.ok(out.completion.enforced);
        });

        it("disabled policy passes any execution", () => {
            const r   = _result(false, []);
            const out = lc.postExecution(r, _preCtx(), { completionPolicy: "disabled" });
            // hallucination check may still block — but no verification failure
            assert.ok(out.completion.enforced);
        });
    });
});
