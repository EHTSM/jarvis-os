"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const priorityEngine  = require("../../agents/runtime/orchestration/executionPriorityEngine.cjs");
const queueCoord      = require("../../agents/runtime/orchestration/adaptiveQueueCoordinator.cjs");
const depPlanner      = require("../../agents/runtime/orchestration/dependencyExecutionPlanner.cjs");
const loadBalancer    = require("../../agents/runtime/orchestration/runtimeLoadBalancer.cjs");
const scheduler       = require("../../agents/runtime/orchestration/workflowSchedulingEngine.cjs");
const concurrency     = require("../../agents/runtime/orchestration/executionConcurrencyManager.cjs");
const backpressure    = require("../../agents/runtime/orchestration/runtimeBackpressureController.cjs");
const policyResolver  = require("../../agents/runtime/orchestration/orchestrationPolicyResolver.cjs");
const fairness        = require("../../agents/runtime/orchestration/executionFairnessManager.cjs");
const supervisor      = require("../../agents/runtime/orchestration/orchestrationSupervisor.cjs");

// ── executionPriorityEngine ───────────────────────────────────────────

describe("executionPriorityEngine", () => {
    beforeEach(() => priorityEngine.reset());

    it("computes a baseline priority score", () => {
        const r = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal" });
        assert.ok(r.score >= 0 && r.score <= 100);
        assert.ok(r.priorityClass);
        assert.ok(r.breakdown);
    });

    it("higher authority produces higher score", () => {
        const a = priorityEngine.computePriority({ authorityLevel: "observer",      urgency: "normal" });
        const b = priorityEngine.computePriority({ authorityLevel: "root-runtime",  urgency: "normal" });
        assert.ok(b.score > a.score);
    });

    it("emergency urgency outranks low urgency", () => {
        const a = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "low" });
        const b = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "emergency" });
        assert.ok(b.score > a.score);
    });

    it("recovery bonus increases score", () => {
        const a = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal", recovery: false });
        const b = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal", recovery: true });
        assert.ok(b.score >= a.score);
    });

    it("high risk score reduces priority", () => {
        const a = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal", riskScore: 0 });
        const b = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal", riskScore: 0.9 });
        assert.ok(a.score > b.score);
    });

    it("aging bonus increases score over time", () => {
        const a = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal", waitSinceMs: 0 });
        const b = priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal", waitSinceMs: 60000 });
        assert.ok(b.score > a.score);
    });

    it("rankExecutions sorts high to low", () => {
        const execs = [
            { authorityLevel: "observer",     urgency: "low" },
            { authorityLevel: "root-runtime", urgency: "emergency" },
            { authorityLevel: "operator",     urgency: "normal" },
        ];
        const ranked = priorityEngine.rankExecutions(execs);
        assert.ok(ranked[0].priorityScore >= ranked[1].priorityScore);
        assert.ok(ranked[1].priorityScore >= ranked[2].priorityScore);
    });

    it("applyAging boosts scores with wait time", () => {
        const execs = [
            { authorityLevel: "operator", urgency: "normal", enqueuedAt: new Date(Date.now() - 30000).toISOString() },
            { authorityLevel: "operator", urgency: "normal", enqueuedAt: new Date().toISOString() },
        ];
        const aged = priorityEngine.applyAging(execs);
        assert.ok(aged[0].waitSinceMs >= 29000);
    });

    it("getPriorityMetrics tracks computed count", () => {
        priorityEngine.computePriority({ authorityLevel: "operator", urgency: "normal" });
        priorityEngine.computePriority({ authorityLevel: "governor", urgency: "critical" });
        const m = priorityEngine.getPriorityMetrics();
        assert.equal(m.totalComputed, 2);
    });

    it("emergency priority class assigned for very high scores", () => {
        const r = priorityEngine.computePriority({ authorityLevel: "root-runtime", urgency: "emergency", recovery: true });
        assert.ok(r.priorityClass === "emergency" || r.priorityClass === "critical");
    });
});

// ── adaptiveQueueCoordinator ──────────────────────────────────────────

describe("adaptiveQueueCoordinator", () => {
    beforeEach(() => queueCoord.reset());

    it("enqueues an execution", () => {
        const r = queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50, priorityClass: "normal" });
        assert.equal(r.enqueued, true);
        assert.ok(r.itemId.startsWith("qi-"));
    });

    it("rejects without executionId", () => {
        const r = queueCoord.enqueue({ priorityScore: 50 });
        assert.equal(r.enqueued, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("routes emergency to priority queue", () => {
        const r = queueCoord.enqueue({ executionId: "ex-1", priorityScore: 95, priorityClass: "emergency" });
        assert.equal(r.queueName, "priority");
    });

    it("routes recovery to recovery queue", () => {
        const r = queueCoord.enqueue({ executionId: "ex-2", priorityScore: 70, priorityClass: "normal", recovery: true });
        assert.equal(r.queueName, "recovery");
    });

    it("routes retry to retry queue", () => {
        const r = queueCoord.enqueue({ executionId: "ex-3", priorityScore: 50, priorityClass: "normal", retryCount: 1 });
        assert.equal(r.queueName, "retry");
    });

    it("dequeue returns highest-priority item first", () => {
        queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50,  priorityClass: "normal" });
        queueCoord.enqueue({ executionId: "ex-2", priorityScore: 95,  priorityClass: "emergency" });
        queueCoord.enqueue({ executionId: "ex-3", priorityScore: 70,  priorityClass: "normal" });
        const first = queueCoord.dequeue();
        assert.equal(first.executionId, "ex-2");   // emergency queue
    });

    it("dequeue from specific queue", () => {
        queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50, priorityClass: "normal" });
        const item = queueCoord.dequeue("default");
        assert.ok(item);
        assert.equal(item.executionId, "ex-1");
    });

    it("peek does not remove item", () => {
        queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50, priorityClass: "normal" });
        queueCoord.peek();
        assert.equal(queueCoord.getQueueDepth(), 1);
    });

    it("getQueueDepth returns total", () => {
        queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50,  priorityClass: "normal" });
        queueCoord.enqueue({ executionId: "ex-2", priorityScore: 90,  priorityClass: "emergency" });
        assert.equal(queueCoord.getQueueDepth(), 2);
    });

    it("getQueueHealth reports state per queue", () => {
        const h = queueCoord.getQueueHealth();
        assert.ok("default" in h);
        assert.ok("priority" in h);
        assert.equal(h.default.state, "healthy");
    });

    it("purgeQueue clears specific queue", () => {
        queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50, priorityClass: "normal" });
        const r = queueCoord.purgeQueue("default");
        assert.equal(r.purged, true);
        assert.equal(r.count, 1);
        assert.equal(queueCoord.getQueueDepth("default"), 0);
    });

    it("getCoordinatorMetrics tracks enqueued and dropped", () => {
        queueCoord.enqueue({ executionId: "ex-1", priorityScore: 50, priorityClass: "normal" });
        const m = queueCoord.getCoordinatorMetrics();
        assert.equal(m.totalEnqueued, 1);
        assert.equal(m.droppedCount, 0);
    });
});

// ── dependencyExecutionPlanner ────────────────────────────────────────

describe("dependencyExecutionPlanner", () => {
    beforeEach(() => depPlanner.reset());

    it("registers an execution", () => {
        const r = depPlanner.registerExecution({ executionId: "ex-1" });
        assert.equal(r.registered, true);
    });

    it("rejects duplicate registration", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        const r = depPlanner.registerExecution({ executionId: "ex-1" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "execution_already_registered");
    });

    it("adds dependency", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        const r = depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        assert.equal(r.added, true);
    });

    it("blocks executions with unresolved dependencies", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        const ready = depPlanner.getReadyExecutions();
        assert.ok(!ready.some(e => e.executionId === "ex-2"));
    });

    it("getReadyExecutions returns executions with no dependencies", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        const ready = depPlanner.getReadyExecutions();
        assert.ok(ready.some(e => e.executionId === "ex-1"));
    });

    it("markCompleted unlocks dependents", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        depPlanner.markCompleted("ex-1");
        const ready = depPlanner.getReadyExecutions();
        assert.ok(ready.some(e => e.executionId === "ex-2"));
    });

    it("markFailed cascades failure to dependents", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.registerExecution({ executionId: "ex-3" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        depPlanner.addDependency({ executionId: "ex-3", dependsOnId: "ex-2" });
        const r = depPlanner.markFailed("ex-1");
        assert.ok(r.failedIds.includes("ex-1"));
        assert.ok(r.failedIds.includes("ex-2"));
        assert.ok(r.failedIds.includes("ex-3"));
    });

    it("cycle detection prevents adding cyclic dependency", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-1", dependsOnId: "ex-2" });
        const r = depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        assert.equal(r.added, false);
        assert.equal(r.reason, "cycle_detected");
    });

    it("self dependency rejected", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        const r = depPlanner.addDependency({ executionId: "ex-1", dependsOnId: "ex-1" });
        assert.equal(r.added, false);
        assert.equal(r.reason, "self_dependency");
    });

    it("hasCycle returns false for acyclic graph", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        assert.equal(depPlanner.hasCycle(), false);
    });

    it("getBlockedExecutions lists pending blocked nodes", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        const blocked = depPlanner.getBlockedExecutions();
        assert.ok(blocked.some(b => b.executionId === "ex-2"));
    });

    it("getExecutionPlan returns count by state", () => {
        depPlanner.registerExecution({ executionId: "ex-1" });
        depPlanner.registerExecution({ executionId: "ex-2" });
        depPlanner.addDependency({ executionId: "ex-2", dependsOnId: "ex-1" });
        const plan = depPlanner.getExecutionPlan();
        assert.equal(plan.totalExecutions, 2);
        assert.equal(plan.readyCount, 1);
    });
});

// ── runtimeLoadBalancer ───────────────────────────────────────────────

describe("runtimeLoadBalancer", () => {
    beforeEach(() => loadBalancer.reset());

    it("registers an adapter", () => {
        const r = loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 5 });
        assert.equal(r.registered, true);
        assert.ok(r.adapterId.startsWith("lb-terminal-"));
    });

    it("rejects without adapterType", () => {
        const r = loadBalancer.registerAdapter({});
        assert.equal(r.registered, false);
        assert.equal(r.reason, "adapterType_required");
    });

    it("selectAdapter returns least-loaded", () => {
        const a = loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 10 });
        const b = loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 10 });
        loadBalancer.recordUtilization({ adapterId: a.adapterId, delta: 5 });
        const s = loadBalancer.selectAdapter({ adapterType: "terminal" });
        assert.equal(s.selected, true);
        assert.equal(s.adapterId, b.adapterId);   // b is less loaded
    });

    it("selectAdapter by capability", () => {
        loadBalancer.registerAdapter({ adapterType: "filesystem", maxSlots: 5 });
        const s = loadBalancer.selectAdapter({ capability: "read_file" });
        assert.equal(s.selected, true);
        assert.equal(s.adapterType, "filesystem");
    });

    it("returns no_available_adapter_slot when all full", () => {
        const r = loadBalancer.registerAdapter({ adapterType: "git", maxSlots: 2 });
        loadBalancer.recordUtilization({ adapterId: r.adapterId, delta: 2 });
        const s = loadBalancer.selectAdapter({ adapterType: "git" });
        assert.equal(s.selected, false);
        assert.equal(s.reason, "no_available_adapter_slot");
    });

    it("releaseSlot decrements activeSlots", () => {
        const r = loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 5 });
        loadBalancer.recordUtilization({ adapterId: r.adapterId, delta: 1 });
        loadBalancer.releaseSlot({ adapterId: r.adapterId, outcome: "completed" });
        const dist = loadBalancer.getLoadDistribution();
        assert.equal(dist.adapters[0].activeSlots, 0);
    });

    it("getLoadDistribution returns per-adapter rows", () => {
        loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 10 });
        loadBalancer.registerAdapter({ adapterType: "git",      maxSlots: 5 });
        const dist = loadBalancer.getLoadDistribution();
        assert.equal(dist.adapters.length, 2);
        assert.ok("byType" in dist);
    });

    it("getLoadBalancerMetrics returns utilization", () => {
        loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 10 });
        const m = loadBalancer.getLoadBalancerMetrics();
        assert.equal(m.registeredAdapters, 1);
        assert.equal(m.totalCapacity, 10);
    });
});

// ── workflowSchedulingEngine ──────────────────────────────────────────

describe("workflowSchedulingEngine", () => {
    beforeEach(() => scheduler.reset());

    it("schedules a workflow immediately", () => {
        const r = scheduler.scheduleWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor" });
        assert.equal(r.scheduled, true);
        assert.ok(r.scheduleId.startsWith("sched-"));
    });

    it("rejects without workflowId", () => {
        const r = scheduler.scheduleWorkflow({ sourceSubsystem: "executor" });
        assert.equal(r.scheduled, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("getDueWorkflows returns workflows with runAt <= now", () => {
        scheduler.scheduleWorkflow({
            workflowId: "wf-1", sourceSubsystem: "executor",
            scheduledAt: new Date(Date.now() - 100).toISOString(),
        });
        const due = scheduler.getDueWorkflows();
        assert.equal(due.length, 1);
        assert.equal(due[0].workflowId, "wf-1");
    });

    it("getDueWorkflows skips future workflows", () => {
        scheduler.scheduleWorkflow({
            workflowId: "wf-1", sourceSubsystem: "executor",
            scheduledAt: new Date(Date.now() + 60000).toISOString(),
        });
        const due = scheduler.getDueWorkflows();
        assert.equal(due.length, 0);
    });

    it("cancelSchedule cancels a pending workflow", () => {
        const s = scheduler.scheduleWorkflow({ workflowId: "wf-1", sourceSubsystem: "executor", delayMs: 60000 });
        const r = scheduler.cancelSchedule(s.scheduleId);
        assert.equal(r.cancelled, true);
    });

    it("cannot cancel a fired workflow", () => {
        const s = scheduler.scheduleWorkflow({
            workflowId: "wf-1", sourceSubsystem: "executor",
            scheduledAt: new Date(Date.now() - 100).toISOString(),
        });
        scheduler.getDueWorkflows();   // fires it
        const r = scheduler.cancelSchedule(s.scheduleId);
        assert.equal(r.cancelled, false);
    });

    it("rescheduleRetry uses exponential backoff", () => {
        const r = scheduler.rescheduleRetry({ workflowId: "wf-1", retryCount: 1 });
        assert.equal(r.rescheduled, true);
        assert.ok(r.delayMs >= scheduler.BASE_RETRY_DELAY_MS);
    });

    it("rescheduleRetry increases delay with retryCount", () => {
        const r1 = scheduler.rescheduleRetry({ workflowId: "wf-1", retryCount: 1, baseDelayMs: 1000 });
        const r2 = scheduler.rescheduleRetry({ workflowId: "wf-2", retryCount: 3, baseDelayMs: 1000 });
        assert.ok(r2.delayMs > r1.delayMs);
    });

    it("rescheduleRecovery schedules with recovery flag", () => {
        const r = scheduler.rescheduleRecovery({ workflowId: "wf-1" });
        assert.equal(r.rescheduled, true);
        const entry = scheduler.getSchedule(r.scheduleId);
        assert.equal(entry.recovery, true);
    });

    it("getDueWorkflows sorts by priority descending", () => {
        const past = new Date(Date.now() - 100).toISOString();
        scheduler.scheduleWorkflow({ workflowId: "wf-low",  sourceSubsystem: "s", priorityScore: 30, scheduledAt: past });
        scheduler.scheduleWorkflow({ workflowId: "wf-high", sourceSubsystem: "s", priorityScore: 90, scheduledAt: past });
        const due = scheduler.getDueWorkflows();
        assert.equal(due[0].workflowId, "wf-high");
    });

    it("getSchedulingMetrics tracks retry and recovery entries", () => {
        scheduler.rescheduleRetry({ workflowId: "wf-1", retryCount: 2 });
        scheduler.rescheduleRecovery({ workflowId: "wf-2" });
        const m = scheduler.getSchedulingMetrics();
        assert.equal(m.retryEntries, 1);
        assert.equal(m.recoveryEntries, 1);
    });
});

// ── executionConcurrencyManager ───────────────────────────────────────

describe("executionConcurrencyManager", () => {
    beforeEach(() => concurrency.reset());

    it("acquires a concurrency slot", () => {
        const r = concurrency.acquire({ executionId: "ex-1", adapterType: "terminal" });
        assert.equal(r.acquired, true);
        assert.ok(r.slotId.startsWith("slot-"));
    });

    it("rejects without executionId", () => {
        const r = concurrency.acquire({ adapterType: "terminal" });
        assert.equal(r.acquired, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("enforces global limit", () => {
        concurrency.configure({ global: 2, perAdapter: 10, perSubsystem: 10 });
        concurrency.acquire({ executionId: "ex-1" });
        concurrency.acquire({ executionId: "ex-2" });
        const r = concurrency.acquire({ executionId: "ex-3" });
        assert.equal(r.acquired, false);
        assert.equal(r.reason, "global_limit_reached");
    });

    it("enforces per-adapter limit", () => {
        concurrency.configure({ global: 50, perAdapter: 2, perSubsystem: 20 });
        concurrency.acquire({ executionId: "ex-1", adapterType: "terminal" });
        concurrency.acquire({ executionId: "ex-2", adapterType: "terminal" });
        const r = concurrency.acquire({ executionId: "ex-3", adapterType: "terminal" });
        assert.equal(r.acquired, false);
        assert.equal(r.reason, "adapter_limit_reached");
    });

    it("enforces per-subsystem limit", () => {
        concurrency.configure({ global: 50, perAdapter: 20, perSubsystem: 2 });
        concurrency.acquire({ executionId: "ex-1", subsystem: "executor" });
        concurrency.acquire({ executionId: "ex-2", subsystem: "executor" });
        const r = concurrency.acquire({ executionId: "ex-3", subsystem: "executor" });
        assert.equal(r.acquired, false);
        assert.equal(r.reason, "subsystem_limit_reached");
    });

    it("release frees a slot", () => {
        concurrency.configure({ global: 1 });
        const a = concurrency.acquire({ executionId: "ex-1" });
        concurrency.release(a.slotId);
        const b = concurrency.acquire({ executionId: "ex-2" });
        assert.equal(b.acquired, true);
    });

    it("cannot release same slot twice", () => {
        const a = concurrency.acquire({ executionId: "ex-1" });
        concurrency.release(a.slotId);
        const r = concurrency.release(a.slotId);
        assert.equal(r.released, false);
        assert.equal(r.reason, "slot_already_released");
    });

    it("isAdmitted checks limits without acquiring", () => {
        concurrency.configure({ global: 1 });
        concurrency.acquire({ executionId: "ex-1" });
        const r = concurrency.isAdmitted({});
        assert.equal(r.admitted, false);
    });

    it("getConcurrencyState reports active slots", () => {
        concurrency.acquire({ executionId: "ex-1", adapterType: "terminal", subsystem: "exec" });
        const s = concurrency.getConcurrencyState();
        assert.equal(s.globalActive, 1);
        assert.equal(s.byAdapter["terminal"], 1);
        assert.equal(s.bySubsystem["exec"], 1);
    });

    it("getConcurrencyMetrics tracks acquired and rejected", () => {
        concurrency.configure({ global: 1 });
        concurrency.acquire({ executionId: "ex-1" });
        concurrency.acquire({ executionId: "ex-2" });  // rejected
        const m = concurrency.getConcurrencyMetrics();
        assert.equal(m.totalAcquired, 1);
        assert.equal(m.totalRejected, 1);
    });
});

// ── runtimeBackpressureController ─────────────────────────────────────

describe("runtimeBackpressureController", () => {
    beforeEach(() => { backpressure.reset(); backpressure._setOverride(null); });

    it("records a signal", () => {
        const r = backpressure.recordSignal({ outcome: "success" });
        assert.equal(r.recorded, true);
        assert.ok(r.signalId.startsWith("bp-"));
        assert.equal(r.pressureState, "nominal");
    });

    it("rejects without outcome", () => {
        const r = backpressure.recordSignal({});
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "outcome_required");
    });

    it("nominal state admits all", () => {
        backpressure._setOverride("nominal");
        const r = backpressure.shouldAdmit({ priorityClass: "normal", retryCount: 5 });
        assert.equal(r.admitted, true);
    });

    it("elevated state blocks high retryCount", () => {
        backpressure._setOverride("elevated");
        const r = backpressure.shouldAdmit({ priorityClass: "normal", retryCount: 3 });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "elevated_pressure_retry_limit");
    });

    it("elevated state still admits normal executions", () => {
        backpressure._setOverride("elevated");
        const r = backpressure.shouldAdmit({ priorityClass: "normal", retryCount: 1 });
        assert.equal(r.admitted, true);
    });

    it("active state admits only critical/emergency or recovery", () => {
        backpressure._setOverride("active");
        const a = backpressure.shouldAdmit({ priorityClass: "normal",    recovery: false });
        const b = backpressure.shouldAdmit({ priorityClass: "emergency", recovery: false });
        const c = backpressure.shouldAdmit({ priorityClass: "normal",    recovery: true });
        assert.equal(a.admitted, false);
        assert.equal(b.admitted, true);
        assert.equal(c.admitted, true);
    });

    it("critical state blocks non-recovery", () => {
        backpressure._setOverride("critical");
        const r = backpressure.shouldAdmit({ priorityClass: "emergency", recovery: false });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "critical_pressure_recovery_only");
    });

    it("critical state admits recovery", () => {
        backpressure._setOverride("critical");
        const r = backpressure.shouldAdmit({ recovery: true });
        assert.equal(r.admitted, true);
    });

    it("high error rate triggers elevated pressure naturally", () => {
        // Fill window with failures
        const oldTs = (offset) => new Date(Date.now() - offset).toISOString();
        for (let i = 0; i < 20; i++)
            backpressure.recordSignal({ outcome: "failure", timestamp: oldTs(i * 100) });
        for (let i = 0; i < 4; i++)
            backpressure.recordSignal({ outcome: "success", timestamp: oldTs(i * 100 + 10000) });
        const ps = backpressure.getPressureState();
        assert.ok(ps.state !== "nominal");
    });

    it("getPressureState returns errorRate", () => {
        backpressure.recordSignal({ outcome: "success" });
        backpressure.recordSignal({ outcome: "failure" });
        const ps = backpressure.getPressureState();
        assert.ok(ps.errorRate > 0);
    });

    it("getBackpressureMetrics returns current state", () => {
        const m = backpressure.getBackpressureMetrics();
        assert.ok("currentState" in m);
        assert.ok("errorRate"    in m);
    });
});

// ── orchestrationPolicyResolver ───────────────────────────────────────

describe("orchestrationPolicyResolver", () => {
    beforeEach(() => policyResolver.reset());

    it("registers a policy", () => {
        const r = policyResolver.registerPolicy({ name: "allow-all", effect: "allow" });
        assert.equal(r.registered, true);
        assert.ok(r.policyId.startsWith("opol-"));
    });

    it("rejects without name", () => {
        const r = policyResolver.registerPolicy({ effect: "allow" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "name_required");
    });

    it("rejects invalid effect", () => {
        const r = policyResolver.registerPolicy({ name: "bad", effect: "maybe" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "effect_must_be_allow_or_deny");
    });

    it("resolvePolicy returns default policy when no match", () => {
        const r = policyResolver.resolvePolicy({ subsystem: "x", adapterType: "terminal" });
        assert.equal(r.resolved, true);
        assert.equal(r.policyId, "default");
    });

    it("resolvePolicy returns matching policy", () => {
        policyResolver.registerPolicy({ name: "terminal-allow", adapterTypes: ["terminal"], effect: "allow" });
        const r = policyResolver.resolvePolicy({ adapterType: "terminal" });
        assert.equal(r.policy.name, "terminal-allow");
    });

    it("deny policy blocks admission", () => {
        policyResolver.registerPolicy({ name: "block-observer", authorityLevels: ["observer"], effect: "deny", priority: 100 });
        const r = policyResolver.evaluateAdmission({ authorityLevel: "observer" });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "policy_deny");
    });

    it("priority above minimum required", () => {
        policyResolver.registerPolicy({ name: "min-prio", effect: "allow", minPriority: 70 });
        const r = policyResolver.evaluateAdmission({ priorityScore: 50 });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "priority_below_policy_minimum");
    });

    it("retryCount exceeding maxRetries blocked", () => {
        policyResolver.registerPolicy({ name: "limit-retries", effect: "allow", maxRetries: 2 });
        const r = policyResolver.evaluateAdmission({ retryCount: 3 });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "retry_limit_exceeded");
    });

    it("removePolicy removes it", () => {
        const reg = policyResolver.registerPolicy({ name: "temp", effect: "allow" });
        policyResolver.removePolicy(reg.policyId);
        assert.equal(policyResolver.listPolicies().length, 0);
    });

    it("getPolicyMetrics tracks counts", () => {
        policyResolver.registerPolicy({ name: "a", effect: "allow" });
        policyResolver.registerPolicy({ name: "b", effect: "deny" });
        policyResolver.resolvePolicy({});
        const m = policyResolver.getPolicyMetrics();
        assert.equal(m.allowCount, 1);
        assert.equal(m.denyCount, 1);
        assert.ok(m.totalEvaluated >= 1);
    });
});

// ── executionFairnessManager ──────────────────────────────────────────

describe("executionFairnessManager", () => {
    beforeEach(() => fairness.reset());

    it("records an execution", () => {
        const r = fairness.recordExecution({ executionId: "ex-1", subsystem: "executor", workflowId: "wf-1" });
        assert.equal(r.recorded, true);
        assert.ok(r.shareId.startsWith("fair-"));
    });

    it("rejects without executionId", () => {
        const r = fairness.recordExecution({ subsystem: "executor" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("getNextFairExecution returns single candidate", () => {
        const c = [{ executionId: "ex-1", subsystem: "a", workflowId: "wf-1", priorityScore: 50 }];
        const r = fairness.getNextFairExecution(c);
        assert.equal(r.executionId, "ex-1");
    });

    it("getNextFairExecution selects least-served candidate", () => {
        // Serve subsystem-a 5 times, subsystem-b 0 times
        for (let i = 0; i < 5; i++)
            fairness.recordExecution({ executionId: `ex-a-${i}`, subsystem: "subsystem-a", workflowId: "wf-1" });

        const candidates = [
            { executionId: "next-a", subsystem: "subsystem-a", workflowId: "wf-1", priorityScore: 70 },
            { executionId: "next-b", subsystem: "subsystem-b", workflowId: "wf-2", priorityScore: 70 },
        ];
        const next = fairness.getNextFairExecution(candidates);
        assert.equal(next.executionId, "next-b");   // subsystem-b has 0 share
    });

    it("tie-breaks on priorityScore when shares equal", () => {
        const c = [
            { executionId: "low",  subsystem: "x", workflowId: "wf-1", priorityScore: 30 },
            { executionId: "high", subsystem: "x", workflowId: "wf-1", priorityScore: 80 },
        ];
        const next = fairness.getNextFairExecution(c);
        assert.equal(next.executionId, "high");
    });

    it("getShareDistribution returns per-subsystem share", () => {
        fairness.recordExecution({ executionId: "ex-1", subsystem: "a", workflowId: "wf-1" });
        fairness.recordExecution({ executionId: "ex-2", subsystem: "b", workflowId: "wf-2" });
        const dist = fairness.getShareDistribution();
        assert.equal(dist.totalExecutions, 2);
        assert.ok("a" in dist.bySubsystem);
        assert.ok("b" in dist.bySubsystem);
    });

    it("getStarvedEntities detects starvation", () => {
        // Flood subsystem-a; starve subsystem-b
        for (let i = 0; i < 10; i++)
            fairness.recordExecution({ executionId: `ex-${i}`, subsystem: "a", workflowId: "wf-1" });
        fairness.recordExecution({ executionId: "ex-b", subsystem: "b", workflowId: "wf-2" });

        const starved = fairness.getStarvedEntities(0.5);
        assert.ok(starved.some(s => s.entity === "b"));
    });

    it("getFairnessMetrics returns subsystem and workflow counts", () => {
        fairness.recordExecution({ executionId: "ex-1", subsystem: "a", workflowId: "wf-1" });
        const m = fairness.getFairnessMetrics();
        assert.equal(m.subsystemCount, 1);
        assert.equal(m.workflowCount, 1);
    });
});

// ── orchestrationSupervisor ───────────────────────────────────────────

describe("orchestrationSupervisor", () => {
    beforeEach(() => {
        supervisor.reset();
        priorityEngine.reset();
        queueCoord.reset();
        depPlanner.reset();
        loadBalancer.reset();
        scheduler.reset();
        concurrency.reset();
        backpressure.reset();
        backpressure._setOverride(null);
        policyResolver.reset();
        fairness.reset();
    });

    it("configure wires modules", () => {
        const r = supervisor.configure({
            priorityEngine, queueCoordinator: queueCoord,
            concurrencyManager: concurrency, backpressureController: backpressure,
        });
        assert.equal(r.configured, true);
        assert.ok(r.modules.includes("priorityEngine"));
        assert.ok(r.modules.includes("concurrencyManager"));
    });

    it("admitExecution succeeds with no modules configured", () => {
        const r = supervisor.admitExecution({ executionId: "ex-1", workflowId: "wf-1" });
        assert.equal(r.admitted, true);
    });

    it("admitExecution rejects without executionId", () => {
        const r = supervisor.admitExecution({ workflowId: "wf-1" });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "executionId_required");
    });

    it("admitExecution runs through backpressure gate", () => {
        supervisor.configure({ backpressureController: backpressure });
        backpressure._setOverride("critical");
        const r = supervisor.admitExecution({ executionId: "ex-1", workflowId: "wf-1" });
        assert.equal(r.admitted, false);
        assert.equal(r.stage, "backpressure");
    });

    it("admitExecution runs through policy gate", () => {
        supervisor.configure({ policyResolver });
        policyResolver.registerPolicy({ name: "deny-all", effect: "deny", priority: 100 });
        const r = supervisor.admitExecution({ executionId: "ex-1" });
        assert.equal(r.admitted, false);
        assert.equal(r.stage, "policy");
    });

    it("admitExecution enforces concurrency", () => {
        supervisor.configure({ concurrencyManager: concurrency });
        concurrency.configure({ global: 1 });
        supervisor.admitExecution({ executionId: "ex-1" });
        const r = supervisor.admitExecution({ executionId: "ex-2" });
        assert.equal(r.admitted, false);
        assert.equal(r.stage, "concurrency");
    });

    it("admitExecution routes to queue when queueCoordinator configured", () => {
        supervisor.configure({ queueCoordinator: queueCoord });
        const r = supervisor.admitExecution({ executionId: "ex-1", priorityClass: "normal" });
        assert.equal(r.admitted, true);
        assert.equal(queueCoord.getQueueDepth(), 1);
    });

    it("completeExecution releases concurrency slot", () => {
        supervisor.configure({ concurrencyManager: concurrency });
        concurrency.configure({ global: 1 });
        supervisor.admitExecution({ executionId: "ex-1" });
        supervisor.completeExecution({ executionId: "ex-1", outcome: "completed" });
        const r = supervisor.admitExecution({ executionId: "ex-2" });
        assert.equal(r.admitted, true);
    });

    it("getOrchestrationStatus reports admission counts", () => {
        supervisor.configure({});
        supervisor.admitExecution({ executionId: "ex-1" });
        const s = supervisor.getOrchestrationStatus();
        assert.equal(s.admitted, 1);
    });

    it("detectDegradation detects high rejection rate", () => {
        supervisor.configure({ concurrencyManager: concurrency });
        concurrency.configure({ global: 1 });
        supervisor.admitExecution({ executionId: "ex-1" });
        // Reject many
        for (let i = 2; i <= 10; i++) supervisor.admitExecution({ executionId: `ex-${i}` });
        const deg = supervisor.detectDegradation();
        assert.ok(deg.some(d => d.type === "high_rejection_rate"));
    });

    it("getOrchestratorMetrics tracks admissionRate", () => {
        supervisor.configure({ concurrencyManager: concurrency });
        concurrency.configure({ global: 1 });
        supervisor.admitExecution({ executionId: "ex-1" });
        supervisor.admitExecution({ executionId: "ex-2" });  // rejected
        const m = supervisor.getOrchestratorMetrics();
        assert.ok(m.admissionRate < 1);
    });

    it("end-to-end orchestration simulation", () => {
        supervisor.configure({
            priorityEngine,
            queueCoordinator:      queueCoord,
            concurrencyManager:    concurrency,
            backpressureController: backpressure,
            policyResolver,
            fairnessManager:       fairness,
            loadBalancer,
        });

        concurrency.configure({ global: 10 });
        loadBalancer.registerAdapter({ adapterType: "terminal", maxSlots: 5 });

        // Allow operator traffic
        policyResolver.registerPolicy({
            name: "allow-operator", authorityLevels: ["operator"],
            effect: "allow", priority: 50,
        });

        const ids = ["e1", "e2", "e3", "e4", "e5"];
        for (const id of ids) {
            const r = supervisor.admitExecution({
                executionId: id, workflowId: "wf-sim",
                subsystem: "executor", adapterType: "terminal",
                capability: "execute_command",
                authorityLevel: "operator", urgency: "normal",
            });
            assert.equal(r.admitted, true);
        }

        // Complete them all
        for (const id of ids)
            supervisor.completeExecution({ executionId: id, outcome: "completed" });

        const m = supervisor.getOrchestratorMetrics();
        assert.equal(m.totalAdmitted, ids.length);
        assert.equal(m.totalCompleted, ids.length);
        assert.equal(m.activeExecutions, 0);
        assert.equal(m.admissionRate, 1);
    });
});
