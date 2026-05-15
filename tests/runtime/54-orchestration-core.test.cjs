"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const osm  = require("../../agents/runtime/orchestration/orchestrationStateMachine.cjs");
const tele = require("../../agents/runtime/orchestration/orchestrationTelemetry.cjs");
const ws   = require("../../agents/runtime/orchestration/workflowScheduler.cjs");
const cb   = require("../../agents/runtime/orchestration/circuitBreaker.cjs");

afterEach(() => { ws.reset(); cb.reset(); tele.reset(); });

// ── orchestrationStateMachine ─────────────────────────────────────────

describe("orchestrationStateMachine – STATES", () => {
    it("exports all 12 states", () => {
        const expected = [
            "queued","scheduled","running","staged","sandboxed","rollback",
            "recovery","isolated","throttled","completed","failed","governance_blocked",
        ];
        for (const s of expected) {
            assert.ok(Object.values(osm.STATES).includes(s), `missing state: ${s}`);
        }
    });

    it("TERMINAL_STATES contains completed, failed, governance_blocked", () => {
        assert.ok(osm.TERMINAL_STATES.has("completed"));
        assert.ok(osm.TERMINAL_STATES.has("failed"));
        assert.ok(osm.TERMINAL_STATES.has("governance_blocked"));
    });

    it("isTerminal returns true for terminal states", () => {
        assert.ok(osm.isTerminal("completed"));
        assert.ok(osm.isTerminal("failed"));
        assert.ok(!osm.isTerminal("running"));
    });
});

describe("orchestrationStateMachine – create", () => {
    it("initial state defaults to queued", () => {
        const fsm = osm.create();
        assert.equal(fsm.state, "queued");
    });

    it("can set custom initial state", () => {
        const fsm = osm.create("scheduled");
        assert.equal(fsm.state, "scheduled");
    });

    it("throws for unknown initial state", () => {
        assert.throws(() => osm.create("nonexistent"), /Unknown initial state/);
    });
});

describe("orchestrationStateMachine – transition", () => {
    it("queued → scheduled is valid", () => {
        const fsm = osm.create();
        fsm.transition("scheduled");
        assert.equal(fsm.state, "scheduled");
    });

    it("scheduled → running is valid", () => {
        const fsm = osm.create("scheduled");
        fsm.transition("running");
        assert.equal(fsm.state, "running");
    });

    it("running → completed is valid", () => {
        const fsm = osm.create("running");
        fsm.transition("completed");
        assert.equal(fsm.state, "completed");
    });

    it("running → rollback → recovery is valid", () => {
        const fsm = osm.create("running");
        fsm.transition("rollback");
        fsm.transition("recovery");
        assert.equal(fsm.state, "recovery");
    });

    it("invalid transition throws", () => {
        const fsm = osm.create();
        assert.throws(() => fsm.transition("running"), /Invalid transition/);
    });

    it("transition from terminal state throws", () => {
        const fsm = osm.create("completed");
        assert.throws(() => fsm.transition("running"), /terminal/);
    });

    it("history records all transitions", () => {
        const fsm = osm.create();
        fsm.transition("scheduled");
        fsm.transition("running");
        assert.equal(fsm.history.length, 3);  // initial + 2 transitions
    });

    it("terminal is true after reaching terminal state", () => {
        const fsm = osm.create("running");
        fsm.transition("failed");
        assert.ok(fsm.terminal);
    });
});

describe("orchestrationStateMachine – canTransition", () => {
    it("canTransition returns true for valid next state", () => {
        const fsm = osm.create();
        assert.ok(fsm.canTransition("scheduled"));
    });

    it("canTransition returns false for invalid next state", () => {
        const fsm = osm.create();
        assert.ok(!fsm.canTransition("running"));
    });

    it("canTransition returns false from terminal state", () => {
        const fsm = osm.create("completed");
        assert.ok(!fsm.canTransition("running"));
    });
});

describe("orchestrationStateMachine – validTransitionsFrom", () => {
    it("queued has valid transitions", () => {
        const t = osm.validTransitionsFrom("queued");
        assert.ok(t.includes("scheduled"));
    });

    it("completed has no transitions", () => {
        assert.equal(osm.validTransitionsFrom("completed").length, 0);
    });
});

// ── orchestrationTelemetry ────────────────────────────────────────────

describe("orchestrationTelemetry", () => {
    it("emits scheduling_decision", () => {
        tele.emit("scheduling_decision", { taskId: "t1" });
        assert.ok(tele.getLog().some(e => e.event === "scheduling_decision"));
    });

    it("emits throttling_event", () => {
        tele.emit("throttling_event", { taskId: "t1" });
        assert.ok(tele.getLog().some(e => e.event === "throttling_event"));
    });

    it("emits isolation_event", () => {
        tele.emit("isolation_event", { taskId: "t1" });
        assert.ok(tele.getLog().some(e => e.event === "isolation_event"));
    });

    it("emits circuit_breaker_activated", () => {
        tele.emit("circuit_breaker_activated", { fingerprint: "fp1" });
        assert.ok(tele.getLog().some(e => e.event === "circuit_breaker_activated"));
    });

    it("emits dependency_rerouted", () => {
        tele.emit("dependency_rerouted", {});
        assert.ok(tele.getLog().some(e => e.event === "dependency_rerouted"));
    });

    it("emits execution_balanced", () => {
        tele.emit("execution_balanced", {});
        assert.ok(tele.getLog().some(e => e.event === "execution_balanced"));
    });

    it("emits recovery_staged", () => {
        tele.emit("recovery_staged", {});
        assert.ok(tele.getLog().some(e => e.event === "recovery_staged"));
    });

    it("emits quarantine_lifted", () => {
        tele.emit("quarantine_lifted", {});
        assert.ok(tele.getLog().some(e => e.event === "quarantine_lifted"));
    });

    it("all 8 events accepted", () => {
        for (const ev of tele.EVENTS) {
            assert.doesNotThrow(() => tele.emit(ev, {}));
        }
    });

    it("unknown event throws", () => {
        assert.throws(() => tele.emit("not_a_real_event", {}));
    });

    it("all entries have ts", () => {
        tele.emit("scheduling_decision", {});
        for (const e of tele.getLog()) assert.ok("ts" in e);
    });

    it("getByEvent filters correctly", () => {
        tele.emit("scheduling_decision", { id: 1 });
        tele.emit("throttling_event",    { id: 2 });
        assert.equal(tele.getByEvent("scheduling_decision").length, 1);
    });

    it("reset clears log", () => {
        tele.emit("scheduling_decision", {});
        tele.reset();
        assert.equal(tele.getLog().length, 0);
    });
});

// ── workflowScheduler ─────────────────────────────────────────────────

describe("workflowScheduler – enqueue / dequeue", () => {
    function _plan(id) {
        return { taskId: id, executionOrder: ["a"], steps: [{ id: "a", command: "echo a" }] };
    }

    it("enqueue returns a queue entry with id and priority", () => {
        const e = ws.enqueue(_plan("t1"), { priority: 70 });
        assert.ok(typeof e.id === "string");
        assert.equal(e.priority, 70);
    });

    it("hasPending is true after enqueue", () => {
        ws.enqueue(_plan("t1"));
        assert.ok(ws.hasPending());
    });

    it("dequeue returns highest-priority entry first", () => {
        ws.enqueue(_plan("low"),  { priority: 20 });
        ws.enqueue(_plan("high"), { priority: 90 });
        const e = ws.dequeue();
        assert.equal(e.taskId, "high");
    });

    it("critical tasks dequeued before high-priority non-critical", () => {
        ws.enqueue(_plan("normal"),   { priority: 90, critical: false });
        ws.enqueue(_plan("critical"), { priority: 50, critical: true  });
        assert.equal(ws.dequeue().taskId, "critical");
    });

    it("dequeue returns null when queue is empty", () => {
        assert.equal(ws.dequeue(), null);
    });

    it("hasPending is false after all dequeued", () => {
        ws.enqueue(_plan("t1"));
        ws.dequeue();
        assert.ok(!ws.hasPending());
    });

    it("size tracks queue depth", () => {
        ws.enqueue(_plan("a"));
        ws.enqueue(_plan("b"));
        assert.equal(ws.size(), 2);
        ws.dequeue();
        assert.equal(ws.size(), 1);
    });

    it("getQueue returns copy without mutating", () => {
        ws.enqueue(_plan("t1"));
        const q = ws.getQueue();
        q.pop();
        assert.equal(ws.size(), 1);
    });
});

describe("workflowScheduler – dep-aware dequeue", () => {
    function _plan(id, deps = []) {
        return { taskId: id, deps, executionOrder: ["a"] };
    }

    it("skips entry whose deps are not ready", () => {
        ws.enqueue(_plan("dep-task", ["dep-a"]));
        ws.enqueue(_plan("free-task", []));
        const e = ws.dequeue(["ready-dep"]);
        assert.equal(e.taskId, "free-task");
    });

    it("returns entry when deps are ready", () => {
        ws.enqueue(_plan("blocked-task", ["dep-a"]));
        const e = ws.dequeue(["dep-a"]);
        assert.equal(e.taskId, "blocked-task");
    });
});

describe("workflowScheduler – starvation + promote", () => {
    function _plan(id) { return { taskId: id }; }

    it("checkStarvation detects entry waiting too long", () => {
        ws.enqueue(_plan("old-task"));
        const entry = ws.getQueue()[0];
        // Simulate old entry by modifying enqueuedAt
        entry.enqueuedAt = Date.now() - 60000;
        const r = ws.checkStarvation(Date.now(), 30000);
        assert.ok(r.detected);
        assert.equal(r.count, 1);
    });

    it("checkStarvation returns detected:false for fresh entries", () => {
        ws.enqueue(_plan("fresh"));
        const r = ws.checkStarvation(Date.now(), 30000);
        assert.ok(!r.detected);
    });

    it("promote increases priority", () => {
        ws.enqueue(_plan("promo"), { priority: 40 });
        const taskId = ws.getQueue()[0].taskId;
        ws.promote(taskId, 20);
        assert.equal(ws.getQueue()[0].priority, 60);
    });

    it("promote returns false for unknown taskId", () => {
        assert.ok(!ws.promote("no-such-task"));
    });

    it("priority capped at 100 after promote", () => {
        ws.enqueue(_plan("t"), { priority: 95 });
        ws.promote("t", 20);
        assert.equal(ws.getQueue()[0].priority, 100);
    });
});

// ── circuitBreaker ────────────────────────────────────────────────────

describe("circuitBreaker – basic state", () => {
    it("initially closed for unknown fingerprint", () => {
        assert.equal(cb.getState("fp-new"), "closed");
    });

    it("isOpen returns false for closed breaker", () => {
        assert.ok(!cb.isOpen("fp-new2"));
    });

    it("stays closed after single failure", () => {
        cb.record("fp-1", false);
        assert.equal(cb.getState("fp-1"), "closed");
    });

    it("opens after 3 consecutive failures (default threshold)", () => {
        cb.record("fp-2", false);
        cb.record("fp-2", false);
        cb.record("fp-2", false);
        assert.equal(cb.getState("fp-2"), "open");
        assert.ok(cb.isOpen("fp-2"));
    });

    it("success resets consecutive fail counter", () => {
        cb.record("fp-3", false);
        cb.record("fp-3", false);
        cb.record("fp-3", true);   // resets counter
        cb.record("fp-3", false);
        cb.record("fp-3", false);  // only 2 since reset
        assert.equal(cb.getState("fp-3"), "closed");
    });
});

describe("circuitBreaker – recovery", () => {
    it("tryRecover returns false before cooldown", () => {
        cb.record("fp-4", false);
        cb.record("fp-4", false);
        cb.record("fp-4", false);
        assert.ok(!cb.tryRecover("fp-4", Date.now(), { cooldownMs: 30000 }));
    });

    it("tryRecover moves to half_open after cooldown", () => {
        cb.record("fp-5", false);
        cb.record("fp-5", false);
        cb.record("fp-5", false);
        assert.ok(cb.tryRecover("fp-5", Date.now() + 60000, { cooldownMs: 30000 }));
        assert.equal(cb.getState("fp-5"), "half_open");
    });

    it("success in half_open moves toward closed", () => {
        cb.record("fp-6", false, { failureThreshold: 1 });
        cb.tryRecover("fp-6", Date.now() + 60000, { cooldownMs: 0 });
        cb.record("fp-6", true, { halfOpenPasses: 1 });
        assert.equal(cb.getState("fp-6"), "closed");
    });

    it("failure in half_open re-opens", () => {
        cb.record("fp-7", false, { failureThreshold: 1 });
        cb.tryRecover("fp-7", Date.now() + 60000, { cooldownMs: 0 });
        cb.record("fp-7", false);
        assert.equal(cb.getState("fp-7"), "open");
    });

    it("forceClose resets to closed", () => {
        cb.record("fp-8", false);
        cb.record("fp-8", false);
        cb.record("fp-8", false);
        cb.forceClose("fp-8");
        assert.equal(cb.getState("fp-8"), "closed");
        assert.ok(!cb.isOpen("fp-8"));
    });
});

describe("circuitBreaker – getAll / getOpenBreakers", () => {
    it("getAll returns all tracked breakers", () => {
        cb.record("fp-a", false);
        cb.record("fp-b", true);
        const all = cb.getAll();
        assert.ok("fp-a" in all);
        assert.ok("fp-b" in all);
    });

    it("getOpenBreakers returns only open ones", () => {
        cb.record("fp-open", false, { failureThreshold: 1 });
        cb.record("fp-closed", true);
        const open = cb.getOpenBreakers();
        assert.ok(open.some(b => b.fingerprint === "fp-open"));
        assert.ok(!open.some(b => b.fingerprint === "fp-closed"));
    });
});
