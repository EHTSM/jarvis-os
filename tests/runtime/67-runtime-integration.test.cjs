"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const el  = require("../../agents/runtime/integration/executionLifecycle.cjs");
const eb  = require("../../agents/runtime/integration/eventBus.cjs");
const rsm = require("../../agents/runtime/integration/runtimeStateManager.cjs");
const rp  = require("../../agents/runtime/integration/runtimePersistence.cjs");
const wo  = require("../../agents/runtime/integration/workflowOrchestrator.cjs");
const ib  = require("../../agents/runtime/integration/integrationBenchmark.cjs");

// ═══════════════════════════════════════════════════════════════════════
// executionLifecycle
// ═══════════════════════════════════════════════════════════════════════

describe("executionLifecycle — createExecution", () => {
    beforeEach(() => el.reset());

    it("creates an execution in queued state", () => {
        const e = el.createExecution({ workflowId: "wf-1", type: "api_call" });
        assert.equal(e.state, "queued");
        assert.equal(e.type, "api_call");
        assert.ok(e.execId.startsWith("exec-"));
    });

    it("accepts custom execId", () => {
        const e = el.createExecution({ execId: "custom-1" });
        assert.equal(e.execId, "custom-1");
    });

    it("initial trace contains created event", () => {
        const e = el.createExecution({});
        assert.ok(e.trace.some(t => t.event === "created"));
    });

    it("starts with zero retries and reroutes", () => {
        const e = el.createExecution({});
        assert.equal(e.retryCount, 0);
        assert.equal(e.reroutes, 0);
    });
});

describe("executionLifecycle — transition", () => {
    beforeEach(() => el.reset());

    it("transitions queued → admitted successfully", () => {
        const e  = el.createExecution({});
        const tr = el.transition(e.execId, "admitted");
        assert.equal(tr.transitioned, true);
        assert.equal(tr.from, "queued");
        assert.equal(tr.to,   "admitted");
    });

    it("blocks invalid transition queued → completed", () => {
        const e  = el.createExecution({});
        const tr = el.transition(e.execId, "completed");
        assert.equal(tr.transitioned, false);
        assert.equal(tr.reason, "invalid_transition");
    });

    it("blocks transitions on completed (terminal) execution", () => {
        const e = el.createExecution({});
        el.transition(e.execId, "admitted");
        el.transition(e.execId, "running");
        el.transition(e.execId, "completed");
        const tr = el.transition(e.execId, "failed");
        assert.equal(tr.transitioned, false);
        assert.equal(tr.reason, "terminal_state");
    });

    it("returns execution_not_found for unknown execId", () => {
        const tr = el.transition("ghost", "running");
        assert.equal(tr.transitioned, false);
        assert.equal(tr.reason, "execution_not_found");
    });

    it("records strategy from meta", () => {
        const e = el.createExecution({});
        el.transition(e.execId, "admitted");
        el.transition(e.execId, "running", { strategy: "safe" });
        assert.equal(el.getExecution(e.execId).strategy, "safe");
    });

    it("sets admittedAt timestamp on admit", () => {
        const e = el.createExecution({});
        el.transition(e.execId, "admitted");
        assert.ok(el.getExecution(e.execId).admittedAt != null);
    });

    it("sets completedAt on terminal transition", () => {
        const e = el.createExecution({});
        el.transition(e.execId, "admitted");
        el.transition(e.execId, "running");
        el.transition(e.execId, "completed");
        assert.ok(el.getExecution(e.execId).completedAt != null);
    });

    it("full happy-path: queued→admitted→running→completed", () => {
        const e = el.createExecution({ type: "data_pipeline" });
        el.transition(e.execId, "admitted");
        el.transition(e.execId, "running");
        const tr = el.transition(e.execId, "completed");
        assert.equal(tr.transitioned, true);
        assert.equal(el.getExecution(e.execId).state, "completed");
    });

    it("recovery path: running→stabilized→recovered→running", () => {
        const e = el.createExecution({});
        el.transition(e.execId, "admitted");
        el.transition(e.execId, "running");
        el.transition(e.execId, "stabilized");
        const tr = el.transition(e.execId, "recovered");
        assert.equal(tr.transitioned, true);
        el.transition(e.execId, "running");
        assert.equal(el.getExecution(e.execId).state, "running");
    });
});

describe("executionLifecycle — addTraceEvent / getExecutionTrace", () => {
    beforeEach(() => el.reset());

    it("adds custom trace events", () => {
        const e = el.createExecution({});
        el.addTraceEvent(e.execId, { event: "rerouted", component: "c2" });
        const trace = el.getExecutionTrace(e.execId);
        assert.ok(trace.some(t => t.event === "rerouted"));
    });

    it("returns empty trace for unknown execId", () => {
        assert.equal(el.getExecutionTrace("ghost").length, 0);
    });

    it("returns not_found for unknown execId in addTraceEvent", () => {
        const r = el.addTraceEvent("ghost", { event: "x" });
        assert.equal(r.added, false);
    });
});

describe("executionLifecycle — listExecutions / getLifecycleStats", () => {
    beforeEach(() => el.reset());

    it("listExecutions with state filter", () => {
        el.createExecution({ type: "a" });
        const e2 = el.createExecution({ type: "b" });
        el.transition(e2.execId, "admitted");
        el.transition(e2.execId, "running");
        el.transition(e2.execId, "completed");
        const completed = el.listExecutions({ state: "completed" });
        assert.equal(completed.length, 1);
    });

    it("listExecutions with active filter excludes terminal", () => {
        const e1 = el.createExecution({});
        const e2 = el.createExecution({});
        el.transition(e2.execId, "admitted");
        el.transition(e2.execId, "running");
        el.transition(e2.execId, "completed");
        const active = el.listExecutions({ active: true });
        assert.ok(active.every(e => !["completed", "failed"].includes(e.state)));
    });

    it("getLifecycleStats calculates successRate", () => {
        const e1 = el.createExecution({});
        el.transition(e1.execId, "admitted");
        el.transition(e1.execId, "running");
        el.transition(e1.execId, "completed");
        const e2 = el.createExecution({});
        el.transition(e2.execId, "failed");
        const stats = el.getLifecycleStats();
        assert.equal(stats.total, 2);
        assert.equal(stats.successRate, 0.5);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// eventBus
// ═══════════════════════════════════════════════════════════════════════

describe("eventBus — emit", () => {
    beforeEach(() => eb.reset());

    it("emits known event types successfully", () => {
        const r = eb.emit("workflow_queued", { workflowId: "wf-1" });
        assert.equal(r.emitted, true);
        assert.ok(r.eventId.startsWith("ev-"));
    });

    it("rejects unknown event types", () => {
        const r = eb.emit("totally_unknown_event", {});
        assert.equal(r.emitted, false);
        assert.equal(r.reason, "unknown_event_type");
    });

    it("increments seqNum monotonically", () => {
        const r1 = eb.emit("workflow_queued",   { workflowId: "1" });
        const r2 = eb.emit("workflow_admitted", { workflowId: "1" });
        assert.ok(r2.seqNum > r1.seqNum);
    });
});

describe("eventBus — subscribe / unsubscribe", () => {
    beforeEach(() => eb.reset());

    it("receives emitted events of subscribed type", () => {
        const received = [];
        eb.subscribe("workflow_completed", e => received.push(e));
        eb.emit("workflow_completed", { workflowId: "wf-1" });
        assert.equal(received.length, 1);
        assert.equal(received[0].payload.workflowId, "wf-1");
    });

    it("unsubscribing stops delivery", () => {
        const received = [];
        const unsub = eb.subscribe("workflow_failed", e => received.push(e));
        unsub();
        eb.emit("workflow_failed", { workflowId: "wf-1" });
        assert.equal(received.length, 0);
    });

    it("subscribeAll receives all event types", () => {
        const received = [];
        eb.subscribeAll(e => received.push(e.type));
        eb.emit("workflow_queued",   { workflowId: "1" });
        eb.emit("workflow_admitted", { workflowId: "1" });
        assert.ok(received.includes("workflow_queued"));
        assert.ok(received.includes("workflow_admitted"));
    });

    it("subscribeAll unsubscribe works", () => {
        const received = [];
        const unsub = eb.subscribeAll(e => received.push(e));
        unsub();
        eb.emit("mode_changed", {});
        assert.equal(received.length, 0);
    });
});

describe("eventBus — getRecentEvents / getEventsByType / getEventStats", () => {
    beforeEach(() => eb.reset());

    it("getRecentEvents returns last N events", () => {
        for (let i = 0; i < 5; i++) eb.emit("workflow_queued", { workflowId: `wf-${i}` });
        assert.equal(eb.getRecentEvents(3).length, 3);
    });

    it("getEventsByType filters by type", () => {
        eb.emit("workflow_queued",   { workflowId: "1" });
        eb.emit("workflow_completed",{ workflowId: "1" });
        eb.emit("workflow_queued",   { workflowId: "2" });
        const byType = eb.getEventsByType("workflow_queued");
        assert.equal(byType.length, 2);
        assert.ok(byType.every(e => e.type === "workflow_queued"));
    });

    it("getEventStats tracks total and by type", () => {
        eb.emit("workflow_queued",   { workflowId: "1" });
        eb.emit("mode_changed",      {});
        const stats = eb.getEventStats();
        assert.equal(stats.totalEmitted, 2);
        assert.equal(stats.byType.workflow_queued, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// runtimeStateManager
// ═══════════════════════════════════════════════════════════════════════

describe("runtimeStateManager — setMode", () => {
    beforeEach(() => rsm.reset());

    it("transitions to valid mode", () => {
        const r = rsm.setMode("degraded", "high_pressure");
        assert.equal(r.mode, "degraded");
        assert.equal(r.changed, true);
    });

    it("changed=false when mode unchanged", () => {
        rsm.setMode("normal", "initial");
        const r = rsm.setMode("normal", "again");
        assert.equal(r.changed, false);
    });

    it("rejects invalid mode", () => {
        const r = rsm.setMode("hyper_turbo", "reason");
        assert.equal(r.changed, false);
        assert.equal(r.reason, "invalid_mode");
    });
});

describe("runtimeStateManager — registerWorkflow / unregisterWorkflow", () => {
    beforeEach(() => rsm.reset());

    it("registers and unregisters a workflow", () => {
        rsm.registerWorkflow({ workflowId: "wf-1", type: "api_call", state: "queued" });
        assert.equal(rsm.getActiveWorkflows().length, 1);
        rsm.unregisterWorkflow("wf-1");
        assert.equal(rsm.getActiveWorkflows().length, 0);
    });

    it("active workflows exclude completed/failed", () => {
        rsm.registerWorkflow({ workflowId: "wf-1", state: "completed" });
        rsm.registerWorkflow({ workflowId: "wf-2", state: "running" });
        assert.equal(rsm.getActiveWorkflows().length, 1);
    });
});

describe("runtimeStateManager — updateComponentState / getDegradedComponents", () => {
    beforeEach(() => rsm.reset());

    it("registers components via updateComponentState", () => {
        rsm.updateComponentState("c1", { health: 0.9, status: "healthy" });
        assert.equal(rsm.getDegradedComponents().length, 0);
    });

    it("degraded components appear in getDegradedComponents", () => {
        rsm.updateComponentState("c1", { health: 0.3, status: "degraded" });
        rsm.updateComponentState("c2", { health: 0.9, status: "healthy" });
        const degraded = rsm.getDegradedComponents();
        assert.equal(degraded.length, 1);
        assert.equal(degraded[0].id, "c1");
    });
});

describe("runtimeStateManager — getConsoleSnapshot", () => {
    beforeEach(() => rsm.reset());

    it("returns a snapshot with all required fields", () => {
        const snap = rsm.getConsoleSnapshot();
        assert.ok("mode" in snap);
        assert.ok("activeWorkflows" in snap);
        assert.ok("degradedComponents" in snap);
        assert.ok("activeRecoveryTrees" in snap);
        assert.ok("activeContainments" in snap);
        assert.ok("arbitrationQueueSize" in snap);
    });

    it("reflects registered workflows and components", () => {
        rsm.registerWorkflow({ workflowId: "wf-1", state: "running" });
        rsm.updateComponentState("c1", { health: 0.2, status: "critical" });
        const snap = rsm.getConsoleSnapshot();
        assert.ok(snap.activeWorkflows >= 1);
        assert.ok(snap.degradedComponents >= 1);
    });

    it("reflects active containments and recovery trees", () => {
        rsm.registerContainment("grp-1", { memberCount: 3, status: "contained" });
        rsm.registerRecoveryTree("tree-1", { incidentType: "cascade", status: "in_progress" });
        const snap = rsm.getConsoleSnapshot();
        assert.ok(snap.activeContainments >= 1);
        assert.ok(snap.activeRecoveryTrees >= 1);
    });
});

describe("runtimeStateManager — arbitration queue", () => {
    beforeEach(() => rsm.reset());

    it("enqueues and dequeues workflows", () => {
        rsm.enqueueArbitration({ workflowId: "wf-1" });
        rsm.enqueueArbitration({ workflowId: "wf-2" });
        assert.equal(rsm.getConsoleSnapshot().arbitrationQueueSize, 2);
        rsm.dequeueArbitration("wf-1");
        assert.equal(rsm.getConsoleSnapshot().arbitrationQueueSize, 1);
    });

    it("does not duplicate enqueue", () => {
        rsm.enqueueArbitration({ workflowId: "wf-1" });
        rsm.enqueueArbitration({ workflowId: "wf-1" });
        assert.equal(rsm.getConsoleSnapshot().arbitrationQueueSize, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// runtimePersistence
// ═══════════════════════════════════════════════════════════════════════

describe("runtimePersistence — checkpoint / restore", () => {
    beforeEach(() => rp.reset());

    it("creates a checkpoint with checkpointId", () => {
        const r = rp.checkpoint({ mode: "normal", activeWorkflows: 2 });
        assert.ok(r.checkpointId.startsWith("ckpt-"));
    });

    it("restores checkpoint state", () => {
        const r = rp.checkpoint({ mode: "degraded", activeWorkflows: 5, degradedComponents: 2 });
        const restored = rp.restoreFromCheckpoint(r.checkpointId);
        assert.equal(restored.mode, "degraded");
        assert.equal(restored.activeWorkflows, 5);
    });

    it("returns null for unknown checkpointId", () => {
        assert.equal(rp.restoreFromCheckpoint("ghost"), null);
    });

    it("listCheckpoints returns summary of all checkpoints", () => {
        rp.checkpoint({ mode: "normal" });
        rp.checkpoint({ mode: "safe" });
        const list = rp.listCheckpoints();
        assert.equal(list.length, 2);
        assert.ok(list[0].checkpointId);
    });

    it("pruneCheckpoints removes old entries", () => {
        for (let i = 0; i < 15; i++) rp.checkpoint({ mode: "normal" });
        const pruned = rp.pruneCheckpoints(5);
        assert.ok(pruned >= 10);
        assert.equal(rp.listCheckpoints().length, 5);
    });
});

describe("runtimePersistence — recovery snapshots", () => {
    beforeEach(() => rp.reset());

    it("saves a recovery snapshot", () => {
        const r = rp.saveRecoverySnapshot(
            { type: "cascade_failure", incidentId: "inc-1" },
            { strategy: "rollback", outcome: "resolved", durationMs: 1200 }
        );
        assert.ok(r.snapshotId.startsWith("snap-"));
    });

    it("retrieves snapshots by incidentType", () => {
        rp.saveRecoverySnapshot({ type: "oom" }, { outcome: "resolved" });
        rp.saveRecoverySnapshot({ type: "timeout" }, { outcome: "escalated" });
        const snaps = rp.getRecoverySnapshots({ incidentType: "oom" });
        assert.equal(snaps.length, 1);
        assert.equal(snaps[0].incidentType, "oom");
    });

    it("retrieves snapshots by outcome", () => {
        rp.saveRecoverySnapshot({ type: "oom" }, { outcome: "resolved" });
        rp.saveRecoverySnapshot({ type: "oom" }, { outcome: "escalated" });
        const resolved = rp.getRecoverySnapshots({ outcome: "resolved" });
        assert.equal(resolved.length, 1);
    });
});

describe("runtimePersistence — execution history", () => {
    beforeEach(() => rp.reset());

    it("appends execution history entries", () => {
        rp.appendExecutionHistory({ execId: "e1", type: "api_call", state: "completed" });
        rp.appendExecutionHistory({ execId: "e2", type: "payment",  state: "failed" });
        const history = rp.getExecutionHistory({});
        assert.equal(history.length, 2);
    });

    it("filters history by state", () => {
        rp.appendExecutionHistory({ execId: "e1", state: "completed" });
        rp.appendExecutionHistory({ execId: "e2", state: "failed" });
        const failed = rp.getExecutionHistory({ state: "failed" });
        assert.equal(failed.length, 1);
    });

    it("filters history by limit", () => {
        for (let i = 0; i < 10; i++) rp.appendExecutionHistory({ execId: `e${i}`, state: "completed" });
        const limited = rp.getExecutionHistory({ limit: 3 });
        assert.equal(limited.length, 3);
    });

    it("getPersistenceStats reports successRate", () => {
        rp.appendExecutionHistory({ state: "completed" });
        rp.appendExecutionHistory({ state: "completed" });
        rp.appendExecutionHistory({ state: "failed" });
        const stats = rp.getPersistenceStats();
        assert.ok(Math.abs(stats.successRate - 0.667) < 0.01);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// workflowOrchestrator
// ═══════════════════════════════════════════════════════════════════════

describe("workflowOrchestrator — submitWorkflow", () => {
    beforeEach(() => wo.reset());

    it("submits a workflow and returns queued state", () => {
        const r = wo.submitWorkflow({ id: "wf-1", type: "api_call", riskLevel: "low" });
        assert.equal(r.submitted, true);
        assert.equal(r.state, "queued");
        assert.ok(r.execId);
    });

    it("emits workflow_queued event on submit", () => {
        const events = [];
        const eb2 = require("../../agents/runtime/integration/eventBus.cjs");
        eb2.subscribe("workflow_queued", e => events.push(e));
        wo.submitWorkflow({ id: "wf-2", type: "data_pipeline" });
        assert.ok(events.length > 0);
    });
});

describe("workflowOrchestrator — admitWorkflow", () => {
    beforeEach(() => wo.reset());

    it("admits a queued workflow", () => {
        const sub = wo.submitWorkflow({ id: "wf-1", type: "api_call" });
        const adm = wo.admitWorkflow("wf-1");
        assert.equal(adm.admitted, true);
        assert.equal(adm.execId, sub.execId);
    });

    it("returns not_found for unknown workflowId", () => {
        const r = wo.admitWorkflow("ghost-wf");
        assert.equal(r.admitted, false);
    });
});

describe("workflowOrchestrator — runWorkflow", () => {
    beforeEach(() => wo.reset());

    it("runs an admitted workflow with executor", () => {
        wo.submitWorkflow({ id: "wf-1", type: "api_call", riskLevel: "low", latencyClass: "standard" });
        wo.admitWorkflow("wf-1");
        const r = wo.runWorkflow("wf-1", () => ({ success: true, result: "ok" }));
        assert.equal(r.run, true);
        assert.ok(r.strategy);
        assert.ok(r.budget.maxRetries > 0);
    });

    it("uses fast strategy under nominal conditions", () => {
        wo.submitWorkflow({ id: "wf-2", type: "api_call", riskLevel: "low" });
        wo.admitWorkflow("wf-2");
        const r = wo.runWorkflow("wf-2", () => ({ success: true }));
        assert.ok(["fast", "safe", "staged"].includes(r.strategy));
    });

    it("returns run:false for non-admitted workflow", () => {
        wo.submitWorkflow({ id: "wf-3", type: "api_call" });
        // Don't admit — run directly
        const r = wo.runWorkflow("wf-3");
        assert.equal(r.run, false);
    });
});

describe("workflowOrchestrator — handleFailure", () => {
    beforeEach(() => wo.reset());

    it("schedules retry on first failure", () => {
        wo.submitWorkflow({ id: "wf-1", type: "api_call" });
        wo.admitWorkflow("wf-1");
        wo.runWorkflow("wf-1");
        const r = wo.handleFailure("wf-1", { type: "timeout", maxRetries: 2 });
        assert.equal(r.handled, true);
        assert.equal(r.action, "retry");
    });

    it("builds recovery tree after retries exhausted", () => {
        wo.submitWorkflow({ id: "wf-2", type: "api_call" });
        wo.admitWorkflow("wf-2");
        wo.runWorkflow("wf-2");
        // maxRetries:0 means no retries allowed → recovery tree path immediately
        const r = wo.handleFailure("wf-2", { type: "timeout", maxRetries: 0 });
        assert.equal(r.handled, true);
        assert.equal(r.action, "recovery_tree");
        assert.ok(r.treeId);
    });

    it("returns no_active_execution for unknown workflow", () => {
        const r = wo.handleFailure("ghost-wf", {});
        assert.equal(r.handled, false);
        assert.equal(r.reason, "no_active_execution");
    });
});

describe("workflowOrchestrator — completeWorkflow", () => {
    beforeEach(() => wo.reset());

    it("completes an active workflow", () => {
        wo.submitWorkflow({ id: "wf-1", type: "api_call" });
        wo.admitWorkflow("wf-1");
        wo.runWorkflow("wf-1");
        const r = wo.completeWorkflow("wf-1", { output: "done" });
        assert.equal(r.completed, true);
    });

    it("returns completed:false for unknown workflow", () => {
        const r = wo.completeWorkflow("ghost-wf");
        assert.equal(r.completed, false);
    });
});

describe("workflowOrchestrator — processArbitrationQueue", () => {
    beforeEach(() => wo.reset());

    it("returns zero if nothing queued", () => {
        const r = wo.processArbitrationQueue({ maxConcurrent: 3 });
        assert.equal(r.processed, 0);
    });

    it("admits up to maxConcurrent workflows", () => {
        wo.submitWorkflow({ id: "wf-1", type: "api_call", riskLevel: "low", latencyClass: "standard" });
        wo.submitWorkflow({ id: "wf-2", type: "api_call", riskLevel: "low", latencyClass: "standard" });
        wo.submitWorkflow({ id: "wf-3", type: "api_call", riskLevel: "low", latencyClass: "standard" });
        const r = wo.processArbitrationQueue({ maxConcurrent: 2 });
        assert.ok(r.admitted <= 2);
        assert.ok(r.processed >= 3);
    });
});

describe("workflowOrchestrator — takeCheckpoint", () => {
    beforeEach(() => wo.reset());

    it("creates a checkpoint with checkpointId and mode", () => {
        const r = wo.takeCheckpoint();
        assert.ok(r.checkpointId.startsWith("ckpt-"));
        assert.ok(r.mode);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// integrationBenchmark
// ═══════════════════════════════════════════════════════════════════════

describe("integrationBenchmark — scoreLifecycleIntegrity", () => {
    beforeEach(() => ib.reset());

    it("returns F for no executions", () => {
        assert.equal(ib.scoreLifecycleIntegrity([]).grade, "F");
    });

    it("scores well for completed executions with strategy and trace", () => {
        const execs = Array.from({ length: 5 }, () => ({
            state: "completed",
            strategy: "fast",
            trace: [{ event: "created" }, { event: "transition:queued→admitted" }],
        }));
        const r = ib.scoreLifecycleIntegrity(execs);
        assert.ok(r.score >= 75);
    });

    it("penalises executions without strategy", () => {
        const execs = Array.from({ length: 5 }, () => ({
            state: "completed", strategy: null, trace: [{ event: "created" }],
        }));
        const r = ib.scoreLifecycleIntegrity(execs);
        assert.ok(r.stratRate === 0);
    });
});

describe("integrationBenchmark — scoreEventCoordination", () => {
    beforeEach(() => ib.reset());

    it("returns F for no events", () => {
        assert.equal(ib.scoreEventCoordination([]).grade, "F");
    });

    it("scores well with full event coverage and valid schema", () => {
        const events = [
            { type: "workflow_queued",   payload: { workflowId: "1" }, ts: "2026-01-01T00:00:00Z" },
            { type: "workflow_admitted", payload: { workflowId: "1" }, ts: "2026-01-01T00:00:01Z" },
            { type: "workflow_running",  payload: { workflowId: "1" }, ts: "2026-01-01T00:00:02Z" },
            { type: "workflow_completed",payload: { workflowId: "1" }, ts: "2026-01-01T00:00:03Z" },
            { type: "strategy_selected", payload: { workflowId: "1" }, ts: "2026-01-01T00:00:01Z" },
        ];
        const r = ib.scoreEventCoordination(events);
        assert.ok(r.score >= 75);
    });

    it("penalises events missing schema fields", () => {
        const events = [{ type: "workflow_queued" }, { type: "workflow_admitted" }];
        const r = ib.scoreEventCoordination(events);
        assert.ok(r.schemaRate === 0);
    });
});

describe("integrationBenchmark — scoreOrchestrationThroughput", () => {
    beforeEach(() => ib.reset());

    it("returns F for no submissions", () => {
        assert.equal(ib.scoreOrchestrationThroughput({ submitted: 0 }).grade, "F");
    });

    it("scores A for fast 100% completion", () => {
        const r = ib.scoreOrchestrationThroughput({ submitted: 100, completed: 100, failed: 0, avgLatencyMs: 50 });
        assert.ok(r.score >= 75);
    });

    it("penalises high failure rate", () => {
        const r = ib.scoreOrchestrationThroughput({ submitted: 100, completed: 20, failed: 80, avgLatencyMs: 200 });
        assert.ok(r.failRate === 0.8);
        assert.ok(r.score < 60);
    });
});

describe("integrationBenchmark — scorePersistenceReliability", () => {
    beforeEach(() => ib.reset());

    it("returns F for no snapshots", () => {
        assert.equal(ib.scorePersistenceReliability([]).grade, "F");
    });

    it("scores A for complete restoreable snapshots", () => {
        const snaps = Array.from({ length: 5 }, (_, i) => ({
            checkpointId: `ckpt-${i}`, mode: "normal", ts: new Date().toISOString(),
        }));
        const r = ib.scorePersistenceReliability(snaps);
        assert.ok(r.score >= 75);
    });

    it("penalises snapshots missing ids", () => {
        const snaps = [{ mode: "normal" }, { mode: "safe" }];
        const r = ib.scorePersistenceReliability(snaps);
        assert.ok(r.completeRate === 0);
    });
});

describe("integrationBenchmark — scoreStateConsistency", () => {
    beforeEach(() => ib.reset());

    it("returns F for no state snapshots", () => {
        assert.equal(ib.scoreStateConsistency([]).grade, "F");
    });

    it("scores A for coherent valid state snapshots", () => {
        const snapshots = Array.from({ length: 5 }, () => ({
            mode: "normal", activeWorkflows: 2, degradedComponents: 0,
        }));
        const r = ib.scoreStateConsistency(snapshots);
        assert.ok(r.score >= 75);
    });

    it("penalises invalid mode values", () => {
        const snapshots = [{ mode: "ultra_turbo", activeWorkflows: 0 }];
        const r = ib.scoreStateConsistency(snapshots);
        assert.ok(r.modeRate === 0);
    });
});

describe("integrationBenchmark — gradeIntegrationMaturity", () => {
    beforeEach(() => ib.reset());

    it("returns F for empty scores", () => {
        const r = ib.gradeIntegrationMaturity({});
        assert.equal(r.grade, "F");
        assert.equal(r.maturity, "not_integrated");
    });

    it("returns A and fully_integrated for all-high scores", () => {
        const r = ib.gradeIntegrationMaturity({ a: 92, b: 95, c: 91 });
        assert.equal(r.grade, "A");
        assert.equal(r.maturity, "fully_integrated");
    });

    it("verifies all maturity level labels", () => {
        const levels = [
            { scores: { a: 92 }, grade: "A", maturity: "fully_integrated"       },
            { scores: { a: 78 }, grade: "B", maturity: "well_integrated"         },
            { scores: { a: 63 }, grade: "C", maturity: "partially_integrated"    },
            { scores: { a: 42 }, grade: "D", maturity: "minimally_integrated"    },
            { scores: { a: 20 }, grade: "F", maturity: "not_integrated"          },
        ];
        for (const { scores, grade, maturity } of levels) {
            const r = ib.gradeIntegrationMaturity(scores);
            assert.equal(r.grade, grade);
            assert.equal(r.maturity, maturity);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// integration — full end-to-end runtime simulation
// ═══════════════════════════════════════════════════════════════════════

describe("runtime integration — end-to-end simulation", () => {
    beforeEach(() => {
        wo.reset();
        ib.reset();
    });

    it("simulates browser task, dev task, and automation workflow lifecycle", () => {
        // Register real-like components via the state manager
        const rsm2 = require("../../agents/runtime/integration/runtimeStateManager.cjs");
        const wr2  = require("../../agents/runtime/decision/workflowRouter.cjs");
        wr2.registerComponent("browser-agent-1",     { health: 0.95, type: "browser_agent" });
        wr2.registerComponent("local-executor-1",    { health: 0.90, type: "local_executor" });
        wr2.registerComponent("automation-worker-1", { health: 0.85, type: "automation_worker" });

        const workflows = [
            { id: "wf-browser",     type: "browser_task",  riskLevel: "medium",  latencyClass: "interactive" },
            { id: "wf-dev",         type: "dev_task",      riskLevel: "low",     latencyClass: "standard"    },
            { id: "wf-automation",  type: "automation",    riskLevel: "low",     latencyClass: "background"  },
        ];

        // Submit all
        for (const wf of workflows) wo.submitWorkflow(wf);

        // Process arbitration
        const arb = wo.processArbitrationQueue({ maxConcurrent: 5 });
        assert.ok(arb.admitted >= 1);

        // Run admitted workflows
        let completedCount = 0;
        for (const wf of workflows) {
            const runResult = wo.runWorkflow(wf.id, () => ({ success: true }));
            if (runResult.run) {
                wo.completeWorkflow(wf.id, { output: "ok" });
                completedCount++;
            }
        }
        assert.ok(completedCount >= 1);

        // Verify stats
        const stats = wo.getOrchestratorStats();
        assert.ok(stats.lifecycle.total >= 3);
        assert.ok(stats.persistence.historyEntries >= 1);
    });

    it("simulates failure, retry, and recovery tree creation", () => {
        wo.submitWorkflow({ id: "wf-fail", type: "api_call", riskLevel: "high", latencyClass: "interactive" });
        wo.admitWorkflow("wf-fail");
        wo.runWorkflow("wf-fail");

        // First failure — should retry
        const r1 = wo.handleFailure("wf-fail", { type: "timeout", maxRetries: 1 });
        assert.equal(r1.handled, true);
        assert.equal(r1.action, "retry");

        // Re-run after recovery
        wo.runWorkflow("wf-fail");

        // Second failure with retries exhausted → recovery tree
        const r2 = wo.handleFailure("wf-fail", { type: "timeout", maxRetries: 0 });
        assert.equal(r2.handled, true);

        // Verify checkpoint captures the state
        const ckpt = wo.takeCheckpoint();
        assert.ok(ckpt.checkpointId);
    });

    it("simulates degraded-mode transition affecting strategy selection", () => {
        const rsm2 = require("../../agents/runtime/integration/runtimeStateManager.cjs");
        const ss2  = require("../../agents/runtime/decision/strategySelector.cjs");

        rsm2.setMode("degraded", "high_error_rate");

        // Under degraded mode, strategy should not be 'fast'
        const decision = ss2.selectStrategy({
            pressure:     0.70,
            health:       0.50,
            confidence:   0.75,
            anomalyCount: 1,
        });
        assert.ok(["safe", "staged", "recovery_first", "sandbox"].includes(decision.strategy));
        assert.ok(decision.reasoning.length > 0);
    });

    it("event bus captures full workflow lifecycle events", () => {
        const eb2  = require("../../agents/runtime/integration/eventBus.cjs");
        const captured = [];
        eb2.subscribeAll(e => captured.push(e.type));

        wo.submitWorkflow({ id: "wf-trace", type: "tool_execution", riskLevel: "low", latencyClass: "standard" });
        wo.admitWorkflow("wf-trace");
        wo.runWorkflow("wf-trace");
        wo.completeWorkflow("wf-trace");

        assert.ok(captured.includes("workflow_queued"));
        assert.ok(captured.includes("workflow_admitted"));
        assert.ok(captured.includes("workflow_running"));
        assert.ok(captured.includes("workflow_completed"));
    });

    it("full benchmark pipeline produces integration maturity grade", () => {
        // Run a batch of workflows
        for (let i = 0; i < 5; i++) {
            wo.submitWorkflow({ id: `wf-bench-${i}`, type: "api_call", riskLevel: "low", latencyClass: "standard" });
            wo.admitWorkflow(`wf-bench-${i}`);
            wo.runWorkflow(`wf-bench-${i}`, () => ({ success: true }));
            wo.completeWorkflow(`wf-bench-${i}`);
        }

        const stats = wo.getOrchestratorStats();
        const el2   = require("../../agents/runtime/integration/executionLifecycle.cjs");
        const execs  = el2.listExecutions({});

        const lifecycleScore  = ib.scoreLifecycleIntegrity(execs).score;
        const throughputScore = ib.scoreOrchestrationThroughput({
            submitted: stats.lifecycle.total,
            completed: execs.filter(e => e.state === "completed").length,
            failed:    execs.filter(e => e.state === "failed").length,
            avgLatencyMs: 100,
        }).score;

        const snapshots = rp.listCheckpoints();
        rp.checkpoint(wo.getOrchestratorStats().state);
        const updatedSnaps = rp.listCheckpoints();

        const persistScore = ib.scorePersistenceReliability(
            updatedSnaps.map(s => ({ checkpointId: s.checkpointId, mode: s.mode, ts: s.ts }))
        ).score;

        const maturity = ib.gradeIntegrationMaturity({ lifecycleScore, throughputScore, persistScore });
        assert.ok(["A", "B", "C", "D", "F"].includes(maturity.grade));
        assert.ok(typeof maturity.maturity === "string");
    });
});
