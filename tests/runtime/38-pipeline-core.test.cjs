"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const cs    = require("../../agents/runtime/planning/checkpointStore.cjs");
const em    = require("../../agents/runtime/planning/executionMetadata.cjs");
const hooks = require("../../agents/runtime/planning/planningHooks.cjs");
const audit = require("../../agents/runtime/planning/executionAudit.cjs");

// ── checkpointStore ───────────────────────────────────────────────────

describe("checkpointStore", () => {
    afterEach(() => cs.reset());

    describe("STAGES", () => {
        it("exports the 7 pipeline stage names", () => {
            assert.ok(cs.STAGES.includes("decompose"));
            assert.ok(cs.STAGES.includes("simulate"));
            assert.ok(cs.STAGES.includes("score"));
            assert.ok(cs.STAGES.includes("select_strategy"));
            assert.ok(cs.STAGES.includes("verify"));
            assert.ok(cs.STAGES.includes("approve"));
            assert.ok(cs.STAGES.includes("execute"));
            assert.equal(cs.STAGES.length, 7);
        });
    });

    describe("store + get", () => {
        it("get returns empty array for unknown execution", () => {
            assert.deepEqual(cs.get("nope"), []);
        });

        it("stores a checkpoint and retrieves it", () => {
            cs.store("ex-1", "decompose", { status: "complete", steps: 4 });
            const all = cs.get("ex-1");
            assert.equal(all.length, 1);
            assert.equal(all[0].stage, "decompose");
            assert.equal(all[0].data.status, "complete");
        });

        it("get with stage filter returns only matching checkpoints", () => {
            cs.store("ex-2", "decompose", { status: "complete" });
            cs.store("ex-2", "simulate",  { status: "complete" });
            const decomps = cs.get("ex-2", "decompose");
            assert.equal(decomps.length, 1);
            assert.equal(decomps[0].stage, "decompose");
        });

        it("multiple stages stored in order", () => {
            cs.store("ex-3", "decompose",       { status: "complete" });
            cs.store("ex-3", "simulate",        { status: "complete" });
            cs.store("ex-3", "select_strategy", { status: "complete" });
            assert.equal(cs.get("ex-3").length, 3);
        });

        it("each checkpoint has stage, data, ts fields", () => {
            cs.store("ex-4", "score", { feasibility: 90 });
            const cp = cs.get("ex-4")[0];
            assert.ok("stage" in cp);
            assert.ok("data"  in cp);
            assert.ok("ts"    in cp);
        });

        it("different executions are isolated", () => {
            cs.store("ex-a", "decompose", { status: "complete" });
            cs.store("ex-b", "decompose", { status: "complete" });
            assert.equal(cs.get("ex-a").length, 1);
            assert.equal(cs.get("ex-b").length, 1);
        });
    });

    describe("list", () => {
        it("list is an alias for get without stage filter", () => {
            cs.store("ex-5", "decompose", {});
            cs.store("ex-5", "simulate",  {});
            assert.deepEqual(cs.list("ex-5"), cs.get("ex-5"));
        });
    });

    describe("clear", () => {
        it("clear removes all checkpoints for an execution", () => {
            cs.store("ex-6", "decompose", {});
            cs.clear("ex-6");
            assert.deepEqual(cs.get("ex-6"), []);
        });

        it("clear does not affect other executions", () => {
            cs.store("ex-7", "decompose", {});
            cs.store("ex-8", "decompose", {});
            cs.clear("ex-7");
            assert.equal(cs.get("ex-8").length, 1);
        });
    });

    describe("getAll", () => {
        it("returns all executions as an object", () => {
            cs.store("ex-9",  "decompose", {});
            cs.store("ex-10", "simulate",  {});
            const all = cs.getAll();
            assert.ok("ex-9"  in all);
            assert.ok("ex-10" in all);
        });
    });
});

// ── executionMetadata ─────────────────────────────────────────────────

describe("executionMetadata", () => {
    afterEach(() => em.reset());

    it("get returns null for unknown execution", () => {
        assert.equal(em.get("nope"), null);
    });

    it("record + get roundtrip", () => {
        em.record("ex-1", { strategy: "direct", confidence: 90 });
        const r = em.get("ex-1");
        assert.ok(r !== null);
        assert.equal(r.strategy,   "direct");
        assert.equal(r.confidence, 90);
    });

    it("record includes executionId and recordedAt", () => {
        em.record("ex-2", { strategy: "staged" });
        const r = em.get("ex-2");
        assert.equal(r.executionId, "ex-2");
        assert.ok("recordedAt" in r);
    });

    it("update merges patch into existing record", () => {
        em.record("ex-3", { strategy: "direct", confidence: 70 });
        em.update("ex-3", { confidence: 90, feasibilityScore: 95 });
        const r = em.get("ex-3");
        assert.equal(r.strategy,       "direct");
        assert.equal(r.confidence,     90);
        assert.equal(r.feasibilityScore, 95);
    });

    it("update on unknown execution creates record", () => {
        em.update("ex-new", { strategy: "sandbox" });
        const r = em.get("ex-new");
        assert.ok(r !== null);
        assert.equal(r.strategy, "sandbox");
    });

    it("list returns all recorded metadata", () => {
        em.record("ex-4", { strategy: "direct" });
        em.record("ex-5", { strategy: "staged" });
        assert.equal(em.list().length, 2);
    });

    it("defaults null fields when not provided", () => {
        em.record("ex-6", {});
        const r = em.get("ex-6");
        assert.equal(r.strategy,            null);
        assert.equal(r.feasibilityScore,    null);
        assert.equal(r.confidence,          null);
        assert.deepEqual(r.simBlockers,     []);
    });
});

// ── planningHooks ─────────────────────────────────────────────────────

describe("planningHooks", () => {
    afterEach(() => hooks.reset());

    describe("EVENTS", () => {
        it("exports the 6 event names", () => {
            assert.ok(hooks.EVENTS.includes("planning_started"));
            assert.ok(hooks.EVENTS.includes("simulation_completed"));
            assert.ok(hooks.EVENTS.includes("verification_completed"));
            assert.ok(hooks.EVENTS.includes("strategy_selected"));
            assert.ok(hooks.EVENTS.includes("execution_blocked"));
            assert.ok(hooks.EVENTS.includes("execution_approved"));
            assert.equal(hooks.EVENTS.length, 6);
        });
    });

    describe("emit + getLog", () => {
        it("getLog returns empty array before any events", () => {
            assert.deepEqual(hooks.getLog(), []);
        });

        it("emitted events appear in log", () => {
            hooks.emit("planning_started", { taskId: "t1" });
            const log = hooks.getLog();
            assert.equal(log.length, 1);
            assert.equal(log[0].event, "planning_started");
            assert.equal(log[0].data.taskId, "t1");
        });

        it("each log entry has event, data, ts", () => {
            hooks.emit("strategy_selected", { strategy: "direct" });
            const entry = hooks.getLog()[0];
            assert.ok("event" in entry);
            assert.ok("data"  in entry);
            assert.ok("ts"    in entry);
        });

        it("multiple events are logged in order", () => {
            hooks.emit("planning_started",      {});
            hooks.emit("simulation_completed",  {});
            hooks.emit("execution_approved",    {});
            const events = hooks.getLog().map(e => e.event);
            assert.deepEqual(events, ["planning_started", "simulation_completed", "execution_approved"]);
        });
    });

    describe("on + off", () => {
        it("registered handler is called on emit", () => {
            let called = false;
            hooks.on("planning_started", () => { called = true; });
            hooks.emit("planning_started", {});
            assert.ok(called);
        });

        it("handler receives emitted data", () => {
            let received = null;
            hooks.on("strategy_selected", data => { received = data; });
            hooks.emit("strategy_selected", { strategy: "staged" });
            assert.equal(received?.strategy, "staged");
        });

        it("off removes handler", () => {
            let count = 0;
            const fn = () => { count++; };
            hooks.on("execution_approved", fn);
            hooks.off("execution_approved", fn);
            hooks.emit("execution_approved", {});
            assert.equal(count, 0);
        });

        it("handler errors do not propagate", () => {
            hooks.on("planning_started", () => { throw new Error("boom"); });
            assert.doesNotThrow(() => hooks.emit("planning_started", {}));
        });
    });

    describe("clearLog", () => {
        it("clears log but keeps handlers", () => {
            let called = false;
            hooks.on("execution_blocked", () => { called = true; });
            hooks.emit("execution_blocked", {});
            hooks.clearLog();
            assert.deepEqual(hooks.getLog(), []);
            hooks.emit("execution_blocked", {});
            assert.ok(called);
        });
    });
});

// ── executionAudit ────────────────────────────────────────────────────

describe("executionAudit", () => {
    afterEach(() => audit.reset());

    describe("record + get", () => {
        it("get returns empty array for unknown execution", () => {
            assert.deepEqual(audit.get("nope"), []);
        });

        it("records audit entry and retrieves it", () => {
            audit.record("ex-1", {
                taskId:          "task-abc",
                executionPath:   ["decompose", "simulate"],
                strategyChosen:  "direct",
                blockingReasons: [],
            });
            const entries = audit.get("ex-1");
            assert.equal(entries.length, 1);
            assert.equal(entries[0].taskId, "task-abc");
            assert.equal(entries[0].strategyChosen, "direct");
        });

        it("entry includes seq, executionId, ts fields", () => {
            audit.record("ex-2", { taskId: "t" });
            const e = audit.get("ex-2")[0];
            assert.ok("seq"         in e);
            assert.ok("executionId" in e);
            assert.ok("ts"          in e);
        });

        it("seq increments across records", () => {
            audit.record("ex-3", { taskId: "t" });
            audit.record("ex-4", { taskId: "t" });
            const s1 = audit.get("ex-3")[0].seq;
            const s2 = audit.get("ex-4")[0].seq;
            assert.ok(s2 > s1);
        });
    });

    describe("getAll", () => {
        it("returns all records sorted by seq", () => {
            audit.record("ex-5", { taskId: "t" });
            audit.record("ex-6", { taskId: "t" });
            const all = audit.getAll();
            assert.equal(all.length, 2);
            assert.ok(all[0].seq < all[1].seq);
        });
    });

    describe("findByTaskId", () => {
        it("returns only records matching taskId", () => {
            audit.record("ex-7", { taskId: "task-x" });
            audit.record("ex-8", { taskId: "task-y" });
            audit.record("ex-9", { taskId: "task-x" });
            const found = audit.findByTaskId("task-x");
            assert.equal(found.length, 2);
            assert.ok(found.every(e => e.taskId === "task-x"));
        });

        it("returns empty array for unknown taskId", () => {
            assert.deepEqual(audit.findByTaskId("ghost"), []);
        });
    });

    describe("summarize", () => {
        it("returns null for unknown execution", () => {
            assert.equal(audit.summarize("nope"), null);
        });

        it("returns summary with required fields", () => {
            audit.record("ex-10", {
                taskId:          "t",
                executionPath:   ["decompose", "simulate", "score", "approve"],
                strategyChosen:  "staged",
                blockingReasons: [],
            });
            const s = audit.summarize("ex-10");
            assert.equal(s.executionId,     "ex-10");
            assert.equal(s.strategyChosen,  "staged");
            assert.equal(s.blocked,         false);
            assert.equal(s.stagesReached,   4);
        });

        it("blocked is true when blockingReasons is non-empty", () => {
            audit.record("ex-11", {
                taskId:          "t",
                executionPath:   ["decompose", "approve"],
                strategyChosen:  "direct",
                blockingReasons: [{ code: "low_confidence", message: "x" }],
            });
            const s = audit.summarize("ex-11");
            assert.ok(s.blocked);
            assert.equal(s.blockingCount, 1);
        });
    });
});
