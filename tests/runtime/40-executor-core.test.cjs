"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const esm  = require("../../agents/runtime/execution/executionStateMachine.cjs");
const tele = require("../../agents/runtime/execution/executionTelemetry.cjs");
const pers = require("../../agents/runtime/execution/executionPersistence.cjs");
const ret  = require("../../agents/runtime/execution/retryEngine.cjs");
const canc = require("../../agents/runtime/execution/cancellationManager.cjs");

// ── executionStateMachine ─────────────────────────────────────────────

describe("executionStateMachine", () => {
    afterEach(() => esm.reset());

    describe("STATES", () => {
        it("exports all 9 state names", () => {
            const expected = ["pending","preparing","executing","checkpointing","blocked","failed","rolled_back","completed","cancelled"];
            const values = Object.values(esm.STATES);
            for (const s of expected) assert.ok(values.includes(s), `missing: ${s}`);
        });
    });

    describe("create + getState", () => {
        it("initial state is pending", () => {
            esm.create("ex-1");
            assert.equal(esm.getState("ex-1"), "pending");
        });

        it("getState returns null for unknown execution", () => {
            assert.equal(esm.getState("nope"), null);
        });

        it("multiple machines are isolated", () => {
            esm.create("a");
            esm.create("b");
            esm.transition("a", "prepare");
            assert.equal(esm.getState("a"), "preparing");
            assert.equal(esm.getState("b"), "pending");
        });
    });

    describe("transition", () => {
        it("pending → preparing via prepare", () => {
            esm.create("ex-2");
            assert.equal(esm.transition("ex-2", "prepare"), "preparing");
        });

        it("preparing → executing via execute", () => {
            esm.create("ex-3");
            esm.transition("ex-3", "prepare");
            assert.equal(esm.transition("ex-3", "execute"), "executing");
        });

        it("executing → completed via complete", () => {
            esm.create("ex-4");
            esm.transition("ex-4", "prepare");
            esm.transition("ex-4", "execute");
            assert.equal(esm.transition("ex-4", "complete"), "completed");
        });

        it("executing → checkpointing → executing (staged loop)", () => {
            esm.create("ex-5");
            esm.transition("ex-5", "prepare");
            esm.transition("ex-5", "execute");
            assert.equal(esm.transition("ex-5", "checkpoint"), "checkpointing");
            assert.equal(esm.transition("ex-5", "execute"),    "executing");
        });

        it("executing → failed → rolled_back → completed", () => {
            esm.create("ex-6");
            esm.transition("ex-6", "prepare");
            esm.transition("ex-6", "execute");
            esm.transition("ex-6", "fail");
            esm.transition("ex-6", "rollback");
            assert.equal(esm.transition("ex-6", "complete"), "completed");
        });

        it("cancel is valid from any non-terminal state", () => {
            for (const start of ["pending", "preparing", "executing"]) {
                esm.create(`cancel-${start}`);
                if (start !== "pending") esm.transition(`cancel-${start}`, "prepare");
                if (start === "executing") esm.transition(`cancel-${start}`, "execute");
                assert.equal(esm.transition(`cancel-${start}`, "cancel"), "cancelled");
            }
        });

        it("throws on invalid transition", () => {
            esm.create("ex-7");
            assert.throws(() => esm.transition("ex-7", "complete"), /Invalid transition/);
        });

        it("throws for unknown execution id", () => {
            assert.throws(() => esm.transition("ghost", "prepare"), /No state machine/);
        });
    });

    describe("getHistory", () => {
        it("records each transition with from, event, to, ts", () => {
            esm.create("ex-8");
            esm.transition("ex-8", "prepare");
            const h = esm.getHistory("ex-8");
            assert.equal(h.length, 1);
            assert.equal(h[0].from,  "pending");
            assert.equal(h[0].event, "prepare");
            assert.equal(h[0].to,    "preparing");
            assert.ok("ts" in h[0]);
        });

        it("returns empty array for unknown execution", () => {
            assert.deepEqual(esm.getHistory("nope"), []);
        });
    });

    describe("isTerminal", () => {
        it("terminal states return true", () => {
            for (const s of ["blocked","failed","rolled_back","completed","cancelled"]) {
                assert.ok(esm.isTerminal(s), `${s} should be terminal`);
            }
        });
        it("non-terminal states return false", () => {
            for (const s of ["pending","preparing","executing","checkpointing"]) {
                assert.ok(!esm.isTerminal(s), `${s} should not be terminal`);
            }
        });
    });
});

// ── executionTelemetry ────────────────────────────────────────────────

describe("executionTelemetry", () => {
    afterEach(() => tele.reset());

    describe("EVENTS", () => {
        it("exports all 6 execution event names", () => {
            const expected = ["step_started","step_completed","step_failed","rollback_started","rollback_completed","execution_cancelled"];
            for (const e of expected) assert.ok(tele.EVENTS.includes(e), `missing: ${e}`);
        });
    });

    describe("emit + getLog", () => {
        it("emitted event appears in log", () => {
            tele.emit("step_started", { stepId: "install" });
            const log = tele.getLog();
            assert.equal(log.length, 1);
            assert.equal(log[0].event,        "step_started");
            assert.equal(log[0].data.stepId,  "install");
        });

        it("multiple events logged in order", () => {
            tele.emit("step_started",    { stepId: "a" });
            tele.emit("step_completed",  { stepId: "a" });
            tele.emit("step_started",    { stepId: "b" });
            assert.equal(tele.getLog().length, 3);
        });

        it("handler errors do not crash", () => {
            tele.on("step_failed", () => { throw new Error("boom"); });
            assert.doesNotThrow(() => tele.emit("step_failed", {}));
        });
    });

    describe("on / off", () => {
        it("handler called on matching event", () => {
            let called = false;
            tele.on("rollback_started", () => { called = true; });
            tele.emit("rollback_started", {});
            assert.ok(called);
        });

        it("off removes handler", () => {
            let count = 0;
            const fn = () => { count++; };
            tele.on("step_completed", fn);
            tele.off("step_completed", fn);
            tele.emit("step_completed", {});
            assert.equal(count, 0);
        });
    });

    describe("clearLog", () => {
        it("clears log without removing handlers", () => {
            let called = false;
            tele.on("execution_cancelled", () => { called = true; });
            tele.emit("execution_cancelled", {});
            tele.clearLog();
            assert.deepEqual(tele.getLog(), []);
            tele.emit("execution_cancelled", {});
            assert.ok(called);
        });
    });
});

// ── executionPersistence ──────────────────────────────────────────────

describe("executionPersistence", () => {
    afterEach(() => pers.reset());

    it("get returns null for unknown execution", () => {
        assert.equal(pers.get("nope"), null);
    });

    it("save + get roundtrip", () => {
        pers.save("ex-1", { currentStep: "install", runtimeMs: 1000 });
        const r = pers.get("ex-1");
        assert.equal(r.currentStep, "install");
        assert.equal(r.runtimeMs,   1000);
    });

    it("save fills default fields for missing keys", () => {
        pers.save("ex-2", {});
        const r = pers.get("ex-2");
        assert.ok("exitCodes"        in r);
        assert.ok("stdoutSummaries"  in r);
        assert.ok("stderrSummaries"  in r);
        assert.ok("retryCounts"      in r);
        assert.ok("rollbackState"    in r);
    });

    it("update merges patch into existing record", () => {
        pers.save("ex-3", { currentStep: "test", exitCodes: {} });
        pers.update("ex-3", { exitCodes: { test: 0 }, runtimeMs: 200 });
        const r = pers.get("ex-3");
        assert.equal(r.currentStep,       "test");
        assert.equal(r.exitCodes.test,    0);
        assert.equal(r.runtimeMs,         200);
    });

    it("update on unknown creates record", () => {
        pers.update("ex-new", { currentStep: "deploy" });
        assert.ok(pers.get("ex-new") !== null);
    });

    it("getAll returns all records", () => {
        pers.save("a", {}); pers.save("b", {});
        assert.equal(pers.getAll().length, 2);
    });
});

// ── retryEngine ───────────────────────────────────────────────────────

describe("retryEngine", () => {
    describe("shouldRetry", () => {
        it("returns false when maxRetries reached", () => {
            assert.ok(!ret.shouldRetry(1, 3, { maxRetries: 3, retryableExitCodes: [1] }));
        });

        it("returns false for null exitCode (spawn error / timeout)", () => {
            assert.ok(!ret.shouldRetry(null, 0, { maxRetries: 3, retryableExitCodes: [1] }));
        });

        it("returns true for retryable exit code within budget", () => {
            assert.ok(ret.shouldRetry(1, 0, { maxRetries: 3, retryableExitCodes: [1, 2] }));
        });

        it("returns false for non-retryable exit code", () => {
            assert.ok(!ret.shouldRetry(5, 0, { maxRetries: 3, retryableExitCodes: [1, 2] }));
        });
    });

    describe("getBackoffMs", () => {
        it("returns backoffMs * multiplier^attempt", () => {
            const policy = { backoffMs: 100, backoffMultiplier: 2 };
            assert.equal(ret.getBackoffMs(0, policy), 100);
            assert.equal(ret.getBackoffMs(1, policy), 200);
            assert.equal(ret.getBackoffMs(2, policy), 400);
        });

        it("is capped at 30 000ms", () => {
            assert.ok(ret.getBackoffMs(100, { backoffMs: 1000, backoffMultiplier: 2 }) <= 30_000);
        });
    });

    describe("executeWithRetry", () => {
        it("returns success:true for fn that returns exitCode 0", async () => {
            const r = await ret.executeWithRetry(() => Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "" }), { maxRetries: 0 });
            assert.ok(r.success);
            assert.equal(r.attempts, 1);
        });

        it("returns success:false when fn always returns non-zero and maxRetries 0", async () => {
            const r = await ret.executeWithRetry(() => Promise.resolve({ exitCode: 1, stdout: "", stderr: "err" }), { maxRetries: 0, retryableExitCodes: [] });
            assert.ok(!r.success);
            assert.equal(r.attempts, 1);
        });

        it("retries up to maxRetries times then gives up", async () => {
            let calls = 0;
            const r = await ret.executeWithRetry(
                () => { calls++; return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" }); },
                { maxRetries: 2, backoffMs: 1, backoffMultiplier: 1, retryableExitCodes: [1] }
            );
            assert.ok(!r.success);
            assert.equal(calls, 3);    // attempts 0, 1, 2
        });

        it("stops retrying as soon as fn succeeds", async () => {
            let calls = 0;
            const r = await ret.executeWithRetry(
                () => {
                    calls++;
                    return Promise.resolve({ exitCode: calls < 2 ? 1 : 0, stdout: "", stderr: "" });
                },
                { maxRetries: 5, backoffMs: 1, backoffMultiplier: 1, retryableExitCodes: [1] }
            );
            assert.ok(r.success);
            assert.equal(calls, 2);
        });

        it("handles thrown errors (spawn failure) without retrying for null exitCode", async () => {
            const r = await ret.executeWithRetry(
                () => Promise.reject(new Error("ENOENT")),
                { maxRetries: 3, retryableExitCodes: [1] }
            );
            assert.ok(!r.success);
            assert.ok(r.error !== null);
        });

        it("passes attempt index to fn", async () => {
            const attempts = [];
            await ret.executeWithRetry(
                (i) => { attempts.push(i); return Promise.resolve({ exitCode: i < 1 ? 1 : 0, stdout: "", stderr: "" }); },
                { maxRetries: 2, backoffMs: 1, backoffMultiplier: 1, retryableExitCodes: [1] }
            );
            assert.deepEqual(attempts, [0, 1]);
        });
    });
});

// ── cancellationManager ───────────────────────────────────────────────

describe("cancellationManager", () => {
    afterEach(() => canc.reset());

    describe("register + isCancelled", () => {
        it("isCancelled returns false before cancellation", () => {
            canc.register("ex-1");
            assert.ok(!canc.isCancelled("ex-1"));
        });

        it("isCancelled returns false for unregistered execution", () => {
            assert.ok(!canc.isCancelled("nope"));
        });
    });

    describe("cancel", () => {
        it("returns cancelled:true after cancel()", () => {
            canc.register("ex-2");
            const r = canc.cancel("ex-2");
            assert.ok(r.cancelled);
            assert.equal(r.executionId, "ex-2");
        });

        it("isCancelled returns true after cancel()", () => {
            canc.register("ex-3");
            canc.cancel("ex-3");
            assert.ok(canc.isCancelled("ex-3"));
        });

        it("default method is graceful", () => {
            canc.register("ex-4");
            const r = canc.cancel("ex-4");
            assert.equal(r.method, "graceful");
        });

        it("force:true sets method to forced", () => {
            canc.register("ex-5");
            const r = canc.cancel("ex-5", { force: true });
            assert.equal(r.method, "forced");
        });

        it("second cancel returns already_cancelled reason", () => {
            canc.register("ex-6");
            canc.cancel("ex-6");
            const r = canc.cancel("ex-6");
            assert.equal(r.reason, "already_cancelled");
        });

        it("cancel on unregistered returns not_registered", () => {
            const r = canc.cancel("ghost");
            assert.ok(!r.cancelled);
            assert.equal(r.reason, "not_registered");
        });
    });

    describe("onCancel + runCleanupHooks", () => {
        it("registered cleanup hook is called by runCleanupHooks", async () => {
            let cleaned = false;
            canc.register("ex-7");
            canc.onCancel("ex-7", async () => { cleaned = true; });
            await canc.runCleanupHooks("ex-7");
            assert.ok(cleaned);
        });

        it("cleanup hook errors do not propagate", async () => {
            canc.register("ex-8");
            canc.onCancel("ex-8", async () => { throw new Error("cleanup boom"); });
            await assert.doesNotReject(() => canc.runCleanupHooks("ex-8"));
        });

        it("runCleanupHooks on unknown execution is a no-op", async () => {
            await assert.doesNotReject(() => canc.runCleanupHooks("nope"));
        });
    });

    describe("deregister", () => {
        it("deregistered execution no longer tracked", () => {
            canc.register("ex-9");
            canc.deregister("ex-9");
            assert.ok(!canc.isCancelled("ex-9"));
        });
    });
});
