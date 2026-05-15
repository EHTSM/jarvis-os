"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const ecm = require("../../agents/runtime/concurrency/executionConcurrencyManager.cjs");
const rae = require("../../agents/runtime/concurrency/resourceArbitrationEngine.cjs");
const dde = require("../../agents/runtime/concurrency/deadlockDetectionEngine.cjs");
const eic = require("../../agents/runtime/concurrency/executionIsolationCoordinator.cjs");
const crv = require("../../agents/runtime/concurrency/concurrencyReplayValidator.cjs");
const tel = require("../../agents/runtime/concurrency/concurrencyTelemetry.cjs");

// ─────────────────────────────────────────────────────────────────────
// executionConcurrencyManager
// ─────────────────────────────────────────────────────────────────────
describe("executionConcurrencyManager", () => {
    beforeEach(() => ecm.reset());

    it("acquireExecutionSlot → acquired with slotId", () => {
        const r = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        assert.equal(r.acquired, true);
        assert.ok(r.slotId.startsWith("slot-"));
        assert.equal(r.workflowId, "wf-1");
    });

    it("acquireExecutionSlot missing workflowId → not acquired", () => {
        const r = ecm.acquireExecutionSlot({});
        assert.equal(r.acquired, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("acquireExecutionSlot defaults to 'default' domain", () => {
        const r = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        assert.equal(r.isolationDomain, "default");
    });

    it("acquireExecutionSlot stores all metadata", () => {
        ecm.acquireExecutionSlot({
            workflowId: "wf-1", executionId: "ex-1",
            isolationDomain: "dom-A", concurrencyGroup: "grp-X",
            priority: 9, recoveryMode: true, maxSlots: 5,
        });
        const active = ecm.getActiveExecutions();
        assert.equal(active[0].executionId,   "ex-1");
        assert.equal(active[0].priority,      9);
        assert.equal(active[0].recoveryMode,  true);
        assert.equal(active[0].concurrencyGroup, "grp-X");
    });

    it("acquireExecutionSlot at capacity → slot_limit_reached", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", maxSlots: 2 });
        ecm.acquireExecutionSlot({ workflowId: "wf-2" });
        const r = ecm.acquireExecutionSlot({ workflowId: "wf-3" });
        assert.equal(r.acquired, false);
        assert.equal(r.reason,   "slot_limit_reached");
        assert.equal(r.active,   2);
        assert.equal(r.max,      2);
    });

    it("different domains have independent limits", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", isolationDomain: "dom-A", maxSlots: 1 });
        const r1 = ecm.acquireExecutionSlot({ workflowId: "wf-2", isolationDomain: "dom-A" });
        assert.equal(r1.acquired, false);
        const r2 = ecm.acquireExecutionSlot({ workflowId: "wf-3", isolationDomain: "dom-B", maxSlots: 5 });
        assert.equal(r2.acquired, true);
    });

    it("releaseExecutionSlot → released", () => {
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        const r = ecm.releaseExecutionSlot(slotId);
        assert.equal(r.released,    true);
        assert.equal(r.slotId,      slotId);
        assert.equal(r.workflowId,  "wf-1");
    });

    it("releaseExecutionSlot not found → not released", () => {
        const r = ecm.releaseExecutionSlot("slot-ghost");
        assert.equal(r.released, false);
        assert.equal(r.reason,   "slot_not_found");
    });

    it("releaseExecutionSlot already released → not released", () => {
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        ecm.releaseExecutionSlot(slotId);
        const r = ecm.releaseExecutionSlot(slotId);
        assert.equal(r.released, false);
        assert.equal(r.reason,   "slot_already_released");
    });

    it("release reduces active count in domain", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", maxSlots: 2 });
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-2" });
        assert.equal(ecm.getConcurrencyState().totalActiveSlots, 2);
        ecm.releaseExecutionSlot(slotId);
        assert.equal(ecm.getConcurrencyState().totalActiveSlots, 1);
    });

    it("getActiveExecutions filters by isolationDomain", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", isolationDomain: "dom-A" });
        ecm.acquireExecutionSlot({ workflowId: "wf-2", isolationDomain: "dom-B" });
        assert.equal(ecm.getActiveExecutions({ isolationDomain: "dom-A" }).length, 1);
        assert.equal(ecm.getActiveExecutions({ isolationDomain: "dom-B" }).length, 1);
    });

    it("getActiveExecutions filters by recoveryMode", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", recoveryMode: true  });
        ecm.acquireExecutionSlot({ workflowId: "wf-2", recoveryMode: false });
        assert.equal(ecm.getActiveExecutions({ recoveryMode: true  }).length, 1);
        assert.equal(ecm.getActiveExecutions({ recoveryMode: false }).length, 1);
    });

    it("getActiveExecutions filters by concurrencyGroup", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", concurrencyGroup: "g1" });
        ecm.acquireExecutionSlot({ workflowId: "wf-2", concurrencyGroup: "g2" });
        assert.equal(ecm.getActiveExecutions({ concurrencyGroup: "g1" }).length, 1);
    });

    it("getActiveExecutions excludes released slots", () => {
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        ecm.releaseExecutionSlot(slotId);
        assert.equal(ecm.getActiveExecutions().length, 0);
    });

    it("getConcurrencyState totalSlots includes released", () => {
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        ecm.releaseExecutionSlot(slotId);
        const state = ecm.getConcurrencyState();
        assert.equal(state.totalSlots,       1);
        assert.equal(state.totalActiveSlots, 0);
    });

    it("getConcurrencyState shows domain stats", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", isolationDomain: "dom-X", maxSlots: 5 });
        const state = ecm.getConcurrencyState();
        assert.equal(state.domains["dom-X"].activeCount, 1);
        assert.equal(state.domains["dom-X"].maxSlots,    5);
    });

    it("getConcurrencyState tracks group sizes", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", concurrencyGroup: "batch-A" });
        ecm.acquireExecutionSlot({ workflowId: "wf-2", concurrencyGroup: "batch-A" });
        ecm.acquireExecutionSlot({ workflowId: "wf-3", concurrencyGroup: "batch-B" });
        const state = ecm.getConcurrencyState();
        assert.equal(state.groups["batch-A"], 2);
        assert.equal(state.groups["batch-B"], 1);
    });

    it("release removes slot from concurrencyGroup", () => {
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-1", concurrencyGroup: "grp" });
        ecm.acquireExecutionSlot({ workflowId: "wf-2", concurrencyGroup: "grp" });
        ecm.releaseExecutionSlot(slotId);
        assert.equal(ecm.getConcurrencyState().groups["grp"], 1);
    });

    it("enforceConcurrencyLimits detects overflow after limit reduction", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", maxSlots: 5 });
        ecm.acquireExecutionSlot({ workflowId: "wf-2" });
        ecm.acquireExecutionSlot({ workflowId: "wf-3" });
        const r = ecm.enforceConcurrencyLimits({ isolationDomain: "default", maxSlots: 2 });
        assert.equal(r.enforced,      true);
        assert.equal(r.overflow,      true);
        assert.equal(r.overflowCount, 1);
    });

    it("enforceConcurrencyLimits domain not found → not enforced", () => {
        const r = ecm.enforceConcurrencyLimits({ isolationDomain: "ghost-domain" });
        assert.equal(r.enforced, false);
        assert.equal(r.reason,   "domain_not_found");
    });

    it("enforceConcurrencyLimits no overflow → overflow=false", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1", maxSlots: 10 });
        const r = ecm.enforceConcurrencyLimits({ isolationDomain: "default" });
        assert.equal(r.enforced,      true);
        assert.equal(r.overflow,      false);
        assert.equal(r.overflowCount, 0);
    });

    it("slot can be re-acquired after release", () => {
        const { slotId } = ecm.acquireExecutionSlot({ workflowId: "wf-1", maxSlots: 1 });
        ecm.releaseExecutionSlot(slotId);
        const r2 = ecm.acquireExecutionSlot({ workflowId: "wf-2" });
        assert.equal(r2.acquired, true);
    });

    it("reset clears all state", () => {
        ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        ecm.reset();
        assert.equal(ecm.getActiveExecutions().length,            0);
        assert.equal(ecm.getConcurrencyState().totalSlots,        0);
        const r = ecm.acquireExecutionSlot({ workflowId: "wf-1" });
        assert.ok(r.slotId.endsWith("-1"));
    });
});

// ─────────────────────────────────────────────────────────────────────
// resourceArbitrationEngine
// ─────────────────────────────────────────────────────────────────────
describe("resourceArbitrationEngine", () => {
    beforeEach(() => rae.reset());

    it("exports RESOURCE_TYPES and ALLOCATION_POLICIES", () => {
        assert.ok(Array.isArray(rae.RESOURCE_TYPES));
        assert.ok(rae.RESOURCE_TYPES.includes("cpu_slots"));
        assert.ok(rae.RESOURCE_TYPES.includes("recovery_capacity"));
        assert.ok(Array.isArray(rae.ALLOCATION_POLICIES));
        assert.ok(rae.ALLOCATION_POLICIES.includes("fair-share"));
        assert.ok(rae.ALLOCATION_POLICIES.includes("starvation-safe"));
    });

    it("requestResources → allocated with reqId", () => {
        const r = rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 5 });
        assert.equal(r.allocated, true);
        assert.ok(r.reqId.startsWith("req-"));
        assert.equal(r.amount, 5);
    });

    it("requestResources missing ownerId → not allocated", () => {
        const r = rae.requestResources({ resourceType: "cpu_slots" });
        assert.equal(r.allocated, false);
        assert.equal(r.reason,    "ownerId_required");
    });

    it("requestResources missing resourceType → not allocated", () => {
        const r = rae.requestResources({ ownerId: "wf-1" });
        assert.equal(r.allocated, false);
        assert.equal(r.reason,    "resourceType_required");
    });

    it("requestResources invalid resourceType → not allocated", () => {
        const r = rae.requestResources({ ownerId: "wf-1", resourceType: "ghost_resource" });
        assert.equal(r.allocated, false);
        assert.ok(r.reason.includes("invalid_resource_type"));
    });

    it("requestResources invalid policy → not allocated", () => {
        const r = rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", policy: "random" });
        assert.equal(r.allocated, false);
        assert.ok(r.reason.includes("invalid_policy"));
    });

    it("requestResources insufficient resources → not allocated", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 95, totalCapacity: 100 });
        const r = rae.requestResources({ ownerId: "wf-2", resourceType: "cpu_slots", amount: 10 });
        assert.equal(r.allocated, false);
        assert.equal(r.reason,    "insufficient_resources");
        assert.equal(r.available, 5);
    });

    it("requestResources multiple owners accumulate", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "memory_budget", amount: 20, totalCapacity: 100 });
        rae.requestResources({ ownerId: "wf-2", resourceType: "memory_budget", amount: 30 });
        const state = rae.getAllocationState();
        assert.equal(state.resources["memory_budget"].available, 50);
        assert.equal(state.resources["memory_budget"].owners,     2);
    });

    it("requestResources same owner adds to existing allocation", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "execution_tokens", amount: 10, totalCapacity: 100 });
        rae.requestResources({ ownerId: "wf-1", resourceType: "execution_tokens", amount: 5  });
        const state = rae.getAllocationState();
        assert.equal(state.resources["execution_tokens"].allocations["wf-1"], 15);
    });

    it("all 5 resource types accepted", () => {
        for (const rt of rae.RESOURCE_TYPES) {
            const r = rae.requestResources({ ownerId: "wf-1", resourceType: rt, amount: 1 });
            assert.equal(r.allocated, true, `${rt} should be accepted`);
        }
    });

    it("all 5 policies accepted", () => {
        for (const policy of rae.ALLOCATION_POLICIES) {
            rae.reset();
            const r = rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 1, policy });
            assert.equal(r.allocated, true, `policy "${policy}" should be accepted`);
        }
    });

    it("releaseResources → released and available increases", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 30, totalCapacity: 100 });
        const r = rae.releaseResources({ ownerId: "wf-1", resourceType: "cpu_slots" });
        assert.equal(r.released,   true);
        assert.equal(r.amount,     30);
        assert.equal(r.available,  100);
    });

    it("releaseResources partial amount", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 40, totalCapacity: 100 });
        const r = rae.releaseResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 20 });
        assert.equal(r.released,  true);
        assert.equal(r.amount,    20);
        assert.equal(r.available, 80);
        assert.equal(rae.getAllocationState().resources["cpu_slots"].allocations["wf-1"], 20);
    });

    it("releaseResources no allocation → not released", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", totalCapacity: 100 });
        const r = rae.releaseResources({ ownerId: "wf-ghost", resourceType: "cpu_slots" });
        assert.equal(r.released, false);
        assert.equal(r.reason,   "no_allocation_found");
    });

    it("releaseResources resource not found → not released", () => {
        const r = rae.releaseResources({ ownerId: "wf-1", resourceType: "cpu_slots" });
        assert.equal(r.released, false);
        assert.equal(r.reason,   "resource_not_found");
    });

    it("rebalanceResources → fair-share each owner gets equal share", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 80, totalCapacity: 100 });
        rae.requestResources({ ownerId: "wf-2", resourceType: "cpu_slots", amount: 10 });
        const r = rae.rebalanceResources("cpu_slots");
        assert.equal(r.rebalanced,        true);
        assert.equal(r.ownersRebalanced,  2);
        assert.equal(r.fairShare,         50);
        const allocs = rae.getAllocationState().resources["cpu_slots"].allocations;
        assert.equal(allocs["wf-1"], 50);
        assert.equal(allocs["wf-2"], 50);
    });

    it("rebalanceResources no owners → ownersRebalanced=0", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", totalCapacity: 100 });
        rae.releaseResources({ ownerId: "wf-1", resourceType: "cpu_slots" });
        const r = rae.rebalanceResources("cpu_slots");
        assert.equal(r.rebalanced,       true);
        assert.equal(r.ownersRebalanced, 0);
    });

    it("rebalanceResources resource not found → not rebalanced", () => {
        const r = rae.rebalanceResources("ghost_resource");
        assert.equal(r.rebalanced, false);
    });

    it("detectResourcePressure low usage → pressure=low", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "memory_budget", amount: 10, totalCapacity: 100 });
        const r = rae.detectResourcePressure("memory_budget");
        assert.equal(r.found,    true);
        assert.equal(r.pressure, "low");
    });

    it("detectResourcePressure high usage → pressure=high", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "memory_budget", amount: 75, totalCapacity: 100 });
        const r = rae.detectResourcePressure("memory_budget");
        assert.equal(r.pressure, "high");
    });

    it("detectResourcePressure critical usage → pressure=critical", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "memory_budget", amount: 90, totalCapacity: 100 });
        const r = rae.detectResourcePressure("memory_budget");
        assert.equal(r.pressure,  "critical");
        assert.equal(r.usedRatio, 0.9);
    });

    it("detectResourcePressure not found → found=false", () => {
        const r = rae.detectResourcePressure("ghost");
        assert.equal(r.found, false);
    });

    it("getAllocationState totalRequests count", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots",    amount: 10, totalCapacity: 100 });
        rae.requestResources({ ownerId: "wf-2", resourceType: "memory_budget", amount: 20, totalCapacity: 100 });
        assert.equal(rae.getAllocationState().totalRequests, 2);
    });

    it("reset clears all state", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "cpu_slots", amount: 50, totalCapacity: 100 });
        rae.reset();
        assert.deepEqual(rae.getAllocationState().resources, {});
        assert.equal(rae.getAllocationState().totalRequests, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// deadlockDetectionEngine
// ─────────────────────────────────────────────────────────────────────
describe("deadlockDetectionEngine", () => {
    beforeEach(() => dde.reset());

    it("analyzeWaitGraph empty → hasCycles=false, nodeCount=0", () => {
        const r = dde.analyzeWaitGraph({ waits: [] });
        assert.equal(r.hasCycles,  false);
        assert.equal(r.nodeCount,  0);
        assert.equal(r.edgeCount,  0);
        assert.ok(r.graphId.startsWith("wg-"));
    });

    it("analyzeWaitGraph simple cycle A→B→A → hasCycles=true", () => {
        const r = dde.analyzeWaitGraph({
            waits: [{ waiterId: "A", waitingFor: "B" }, { waiterId: "B", waitingFor: "A" }],
        });
        assert.equal(r.hasCycles, true);
        assert.equal(r.cycles.length, 1);
    });

    it("analyzeWaitGraph 3-node cycle A→B→C→A → hasCycles=true", () => {
        const r = dde.analyzeWaitGraph({
            waits: [
                { waiterId: "A", waitingFor: "B" },
                { waiterId: "B", waitingFor: "C" },
                { waiterId: "C", waitingFor: "A" },
            ],
        });
        assert.equal(r.hasCycles, true);
        const cycle = r.cycles[0];
        assert.ok(cycle.includes("A") && cycle.includes("B") && cycle.includes("C"));
    });

    it("analyzeWaitGraph DAG no cycle → hasCycles=false", () => {
        const r = dde.analyzeWaitGraph({
            waits: [
                { waiterId: "A", waitingFor: "B" },
                { waiterId: "B", waitingFor: "C" },
            ],
        });
        assert.equal(r.hasCycles, false);
    });

    it("analyzeWaitGraph nodeCount and edgeCount computed", () => {
        const r = dde.analyzeWaitGraph({
            waits: [
                { waiterId: "X", waitingFor: "Y" },
                { waiterId: "Y", waitingFor: "Z" },
            ],
        });
        assert.equal(r.nodeCount, 2);   // X and Y are keys; Z is not a key (no outgoing)
        assert.equal(r.edgeCount, 2);
    });

    it("detectDeadlocks no waits → deadlocksFound=false", () => {
        const r = dde.detectDeadlocks();
        assert.equal(r.deadlocksFound, false);
        assert.equal(r.deadlockCount,  0);
    });

    it("detectDeadlocks after adding cycle → deadlocksFound=true", () => {
        dde.analyzeWaitGraph({ waits: [{ waiterId: "P", waitingFor: "Q" }, { waiterId: "Q", waitingFor: "P" }] });
        const r = dde.detectDeadlocks();
        assert.equal(r.deadlocksFound, true);
        assert.equal(r.deadlockCount,  1);
    });

    it("detectDeadlocks reports stalledWorkflows count", () => {
        dde.registerStalledExecution("wf-stalled", "timeout");
        const r = dde.detectDeadlocks();
        assert.equal(r.stalledWorkflows, 1);
    });

    it("resolveDeadlock removes cycle from wait graph", () => {
        dde.analyzeWaitGraph({ waits: [{ waiterId: "A", waitingFor: "B" }, { waiterId: "B", waitingFor: "A" }] });
        const { cycles } = dde.detectDeadlocks();
        const r = dde.resolveDeadlock({ cycle: cycles[0] });
        assert.equal(r.resolved,     true);
        assert.ok(r.resId.startsWith("dres-"));
        assert.equal(r.removedNodes, cycles[0].length);
        const r2 = dde.detectDeadlocks();
        assert.equal(r2.deadlocksFound, false);
    });

    it("resolveDeadlock no cycle provided → not resolved", () => {
        const r = dde.resolveDeadlock({ cycle: [] });
        assert.equal(r.resolved, false);
        assert.equal(r.reason,   "no_cycle_provided");
    });

    it("resolveDeadlock custom strategy stored", () => {
        dde.analyzeWaitGraph({ waits: [{ waiterId: "A", waitingFor: "B" }, { waiterId: "B", waitingFor: "A" }] });
        const { cycles } = dde.detectDeadlocks();
        const r = dde.resolveDeadlock({ cycle: cycles[0], strategy: "preempt_oldest" });
        assert.equal(r.strategy, "preempt_oldest");
    });

    it("getBlockedExecutions returns executions with waits", () => {
        dde.analyzeWaitGraph({ waits: [{ waiterId: "exec-1", waitingFor: "exec-2" }] });
        const blocked = dde.getBlockedExecutions();
        assert.equal(blocked.length, 1);
        assert.equal(blocked[0].executionId, "exec-1");
        assert.ok(blocked[0].waitingFor.includes("exec-2"));
    });

    it("getBlockedExecutions includes stalled executions", () => {
        dde.registerStalledExecution("stalled-wf", "resource_unavailable");
        const blocked = dde.getBlockedExecutions();
        const stalled = blocked.find(b => b.executionId === "stalled-wf");
        assert.ok(stalled);
        assert.equal(stalled.stalledReason, "resource_unavailable");
    });

    it("validateLockSafety new lock → safe=true", () => {
        const r = dde.validateLockSafety({ lockId: "L1", holderId: "wf-A", requiredBy: [] });
        assert.equal(r.safe,   true);
        assert.equal(r.lockId, "L1");
    });

    it("validateLockSafety missing lockId → safe=false", () => {
        const r = dde.validateLockSafety({ holderId: "wf-A" });
        assert.equal(r.safe, false);
    });

    it("validateLockSafety detects deadlock risk: holder waits for requiredBy", () => {
        // wf-A waits for wf-B (A→B in wait graph)
        dde.analyzeWaitGraph({ waits: [{ waiterId: "wf-A", waitingFor: "wf-B" }] });
        // Now: wf-A holds lock L1, wf-B needs L1 → wf-B would wait for wf-A
        // But wf-A already waits for wf-B → deadlock risk!
        const r = dde.validateLockSafety({ lockId: "L1", holderId: "wf-A", requiredBy: ["wf-B"] });
        assert.equal(r.safe,         false);
        assert.equal(r.deadlockRisk, true);
    });

    it("validateLockSafety no deadlock risk → safe=true", () => {
        // No existing wait graph
        dde.validateLockSafety({ lockId: "L2", holderId: "wf-C", requiredBy: [] });
        const r = dde.validateLockSafety({ lockId: "L2", holderId: "wf-D", requiredBy: ["wf-E"] });
        assert.equal(r.safe, true);
    });

    it("registerStalledExecution recorded correctly", () => {
        dde.registerStalledExecution("stall-1", "infinite_loop");
        const blocked = dde.getBlockedExecutions();
        assert.ok(blocked.some(b => b.executionId === "stall-1" && b.stalledReason === "infinite_loop"));
    });

    it("reset clears all deadlock state", () => {
        dde.analyzeWaitGraph({ waits: [{ waiterId: "A", waitingFor: "B" }] });
        dde.registerStalledExecution("stall-1");
        dde.reset();
        assert.equal(dde.detectDeadlocks().deadlocksFound, false);
        assert.equal(dde.getBlockedExecutions().length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// executionIsolationCoordinator
// ─────────────────────────────────────────────────────────────────────
describe("executionIsolationCoordinator", () => {
    beforeEach(() => eic.reset());

    it("exports BOUNDARY_TYPES and ISOLATION_STATUSES", () => {
        assert.ok(Array.isArray(eic.BOUNDARY_TYPES));
        assert.ok(eic.BOUNDARY_TYPES.includes("strict"));
        assert.ok(eic.BOUNDARY_TYPES.includes("recovery-safe"));
        assert.ok(Array.isArray(eic.ISOLATION_STATUSES));
    });

    it("createIsolationBoundary → created with boundaryId", () => {
        const r = eic.createIsolationBoundary({ isolationDomain: "dom-A", boundaryType: "strict" });
        assert.equal(r.created,         true);
        assert.ok(r.boundaryId.startsWith("bnd-"));
        assert.equal(r.isolationDomain, "dom-A");
        assert.equal(r.boundaryType,    "strict");
    });

    it("createIsolationBoundary missing isolationDomain → not created", () => {
        const r = eic.createIsolationBoundary({ boundaryType: "strict" });
        assert.equal(r.created, false);
        assert.equal(r.reason,  "isolationDomain_required");
    });

    it("createIsolationBoundary invalid boundaryType → not created", () => {
        const r = eic.createIsolationBoundary({ isolationDomain: "dom-A", boundaryType: "ghost" });
        assert.equal(r.created, false);
        assert.ok(r.reason.includes("invalid_boundary_type"));
    });

    it("all boundary types accepted", () => {
        for (const bt of eic.BOUNDARY_TYPES) {
            const r = eic.createIsolationBoundary({ isolationDomain: `dom-${bt}`, boundaryType: bt });
            assert.equal(r.created, true, `boundary type "${bt}" should be accepted`);
        }
    });

    it("validateIsolationSafety clean workflow → safe=true", () => {
        const r = eic.validateIsolationSafety({ workflowId: "wf-1" });
        assert.equal(r.safe, true);
    });

    it("validateIsolationSafety missing workflowId → safe=false", () => {
        const r = eic.validateIsolationSafety({});
        assert.equal(r.safe, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("validateIsolationSafety quarantined workflow → safe=false", () => {
        eic.quarantineUnsafeExecution({ workflowId: "wf-bad" });
        const r = eic.validateIsolationSafety({ workflowId: "wf-bad" });
        assert.equal(r.safe,   false);
        assert.equal(r.reason, "workflow_quarantined");
    });

    it("validateIsolationSafety boundary not found → safe=false", () => {
        const r = eic.validateIsolationSafety({ workflowId: "wf-1", boundaryId: "bnd-ghost" });
        assert.equal(r.safe,   false);
        assert.equal(r.reason, "boundary_not_found");
    });

    it("validateIsolationSafety boundary capacity exceeded → safe=false", () => {
        const { boundaryId } = eic.createIsolationBoundary({ isolationDomain: "dom-A", maxWorkflows: 2 });
        eic.isolateWorkflow({ workflowId: "wf-1", boundaryId });
        eic.isolateWorkflow({ workflowId: "wf-2", boundaryId });
        const r = eic.validateIsolationSafety({ workflowId: "wf-3", boundaryId });
        assert.equal(r.safe,   false);
        assert.equal(r.reason, "boundary_capacity_exceeded");
    });

    it("isolateWorkflow → isolated with isoId", () => {
        const r = eic.isolateWorkflow({ workflowId: "wf-1", isolationDomain: "dom-A" });
        assert.equal(r.isolated,        true);
        assert.ok(r.isoId.startsWith("iso-"));
        assert.equal(r.workflowId,      "wf-1");
        assert.equal(r.isolationDomain, "dom-A");
    });

    it("isolateWorkflow missing workflowId → not isolated", () => {
        const r = eic.isolateWorkflow({});
        assert.equal(r.isolated, false);
        assert.equal(r.reason,   "workflowId_required");
    });

    it("isolateWorkflow already quarantined → not isolated", () => {
        eic.quarantineUnsafeExecution({ workflowId: "wf-Q" });
        const r = eic.isolateWorkflow({ workflowId: "wf-Q" });
        assert.equal(r.isolated, false);
        assert.equal(r.reason,   "workflow_already_quarantined");
    });

    it("isolateWorkflow increments boundary workflowCount", () => {
        const { boundaryId } = eic.createIsolationBoundary({ isolationDomain: "dom-A" });
        eic.isolateWorkflow({ workflowId: "wf-1", boundaryId });
        eic.isolateWorkflow({ workflowId: "wf-2", boundaryId });
        const topo = eic.getIsolationTopology();
        const bnd  = topo.boundaries.find(b => b.boundaryId === boundaryId);
        assert.equal(bnd.workflowCount, 2);
    });

    it("quarantineUnsafeExecution → quarantined=true", () => {
        const r = eic.quarantineUnsafeExecution({ workflowId: "wf-unsafe", reason: "memory_leak" });
        assert.equal(r.quarantined, true);
        assert.equal(r.workflowId,  "wf-unsafe");
        assert.equal(r.reason,      "memory_leak");
    });

    it("quarantineUnsafeExecution missing workflowId → not quarantined", () => {
        const r = eic.quarantineUnsafeExecution({});
        assert.equal(r.quarantined, false);
    });

    it("quarantineUnsafeExecution updates isolation status", () => {
        eic.isolateWorkflow({ workflowId: "wf-X" });
        eic.quarantineUnsafeExecution({ workflowId: "wf-X" });
        const topo = eic.getIsolationTopology();
        assert.equal(topo.quarantinedCount, 1);
        assert.ok(topo.quarantinedWorkflows.includes("wf-X"));
    });

    it("getIsolationTopology counts boundaries and isolations", () => {
        eic.createIsolationBoundary({ isolationDomain: "dom-A" });
        eic.createIsolationBoundary({ isolationDomain: "dom-B" });
        eic.isolateWorkflow({ workflowId: "wf-1" });
        const topo = eic.getIsolationTopology();
        assert.equal(topo.totalBoundaries, 2);
        assert.equal(topo.totalIsolations, 1);
    });

    it("reset clears all state", () => {
        eic.createIsolationBoundary({ isolationDomain: "dom-A" });
        eic.isolateWorkflow({ workflowId: "wf-1" });
        eic.quarantineUnsafeExecution({ workflowId: "wf-2" });
        eic.reset();
        const topo = eic.getIsolationTopology();
        assert.equal(topo.totalBoundaries,  0);
        assert.equal(topo.totalIsolations,  0);
        assert.equal(topo.quarantinedCount, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// concurrencyReplayValidator
// ─────────────────────────────────────────────────────────────────────
describe("concurrencyReplayValidator", () => {
    beforeEach(() => crv.reset());

    it("validateConcurrentReplay → valid with sequence check", () => {
        const r = crv.validateConcurrentReplay({
            executionId: "exec-1",
            events: [
                { type: "workflow_created", sequenceNumber: 1 },
                { type: "workflow_started", sequenceNumber: 2 },
            ],
        });
        assert.equal(r.valid,          true);
        assert.equal(r.eventCount,     2);
        assert.equal(r.sequenceValid,  true);
    });

    it("validateConcurrentReplay missing executionId → not valid", () => {
        const r = crv.validateConcurrentReplay({ events: [] });
        assert.equal(r.valid,  false);
        assert.equal(r.reason, "executionId_required");
    });

    it("validateConcurrentReplay sequence gap → sequenceValid=false", () => {
        const r = crv.validateConcurrentReplay({
            executionId: "exec-2",
            events: [
                { type: "a", sequenceNumber: 1 },
                { type: "b", sequenceNumber: 3 },   // gap at 2
            ],
        });
        assert.equal(r.sequenceValid, false);
    });

    it("validateConcurrentReplay with expectedOrder matching → valid=true", () => {
        const r = crv.validateConcurrentReplay({
            executionId:   "exec-3",
            events:        [{ type: "step_a" }, { type: "step_b" }, { type: "step_c" }],
            expectedOrder: ["step_a", "step_b", "step_c"],
        });
        assert.equal(r.valid,            true);
        assert.equal(r.mismatches.length, 0);
    });

    it("validateConcurrentReplay with expectedOrder mismatch → valid=false", () => {
        const r = crv.validateConcurrentReplay({
            executionId:   "exec-4",
            events:        [{ type: "step_a" }, { type: "step_b" }],
            expectedOrder: ["step_b", "step_a"],
        });
        assert.equal(r.valid, false);
        assert.equal(r.mismatches.length, 2);
    });

    it("validateConcurrentReplay event count mismatch → not valid", () => {
        const r = crv.validateConcurrentReplay({
            executionId:   "exec-5",
            events:        [{ type: "step_a" }],
            expectedOrder: ["step_a", "step_b"],
        });
        assert.equal(r.valid,  false);
        assert.equal(r.reason, "event_count_mismatch");
    });

    it("detectReplayDrift no drift → driftDetected=false", () => {
        const events = [{ type: "step_a" }, { type: "step_b" }];
        crv.validateConcurrentReplay({ executionId: "base", events });
        crv.validateConcurrentReplay({ executionId: "comp", events });
        const r = crv.detectReplayDrift({ baselineId: "base", comparedId: "comp" });
        assert.equal(r.driftDetected,    false);
        assert.equal(r.divergenceCount,  0);
    });

    it("detectReplayDrift with type divergence → driftDetected=true", () => {
        crv.validateConcurrentReplay({ executionId: "b1", events: [{ type: "step_a" }, { type: "step_b" }] });
        crv.validateConcurrentReplay({ executionId: "c1", events: [{ type: "step_a" }, { type: "step_X" }] });
        const r = crv.detectReplayDrift({ baselineId: "b1", comparedId: "c1" });
        assert.equal(r.driftDetected,   true);
        assert.equal(r.divergenceCount, 1);
        assert.equal(r.divergences[0].index,    1);
        assert.equal(r.divergences[0].baseline, "step_b");
        assert.equal(r.divergences[0].compared, "step_X");
    });

    it("detectReplayDrift event count mismatch → driftDetected=true", () => {
        crv.validateConcurrentReplay({ executionId: "b2", events: [{ type: "a" }, { type: "b" }] });
        crv.validateConcurrentReplay({ executionId: "c2", events: [{ type: "a" }] });
        const r = crv.detectReplayDrift({ baselineId: "b2", comparedId: "c2" });
        assert.equal(r.driftDetected, true);
        assert.equal(r.reason,        "event_count_mismatch");
    });

    it("detectReplayDrift baseline not found → driftDetected=false", () => {
        const r = crv.detectReplayDrift({ baselineId: "ghost", comparedId: "also-ghost" });
        assert.equal(r.driftDetected, false);
    });

    it("detectReplayDrift both_ids_required", () => {
        const r = crv.detectReplayDrift({ baselineId: "b" });
        assert.equal(r.driftDetected, false);
        assert.equal(r.reason,        "both_ids_required");
    });

    it("compareExecutionTimelines identical → identical=true", () => {
        const evts = [{ type: "a" }, { type: "b" }];
        crv.validateConcurrentReplay({ executionId: "t1", events: evts });
        crv.validateConcurrentReplay({ executionId: "t2", events: evts });
        const r = crv.compareExecutionTimelines("t1", "t2");
        assert.equal(r.compared,    true);
        assert.equal(r.identical,   true);
        assert.equal(r.lengthMatch, true);
    });

    it("compareExecutionTimelines different → identical=false", () => {
        crv.validateConcurrentReplay({ executionId: "tA", events: [{ type: "a" }, { type: "b" }] });
        crv.validateConcurrentReplay({ executionId: "tB", events: [{ type: "a" }, { type: "z" }] });
        const r = crv.compareExecutionTimelines("tA", "tB");
        assert.equal(r.compared,  true);
        assert.equal(r.identical, false);
    });

    it("compareExecutionTimelines not found → compared=false", () => {
        const r = crv.compareExecutionTimelines("ghost-A", "ghost-B");
        assert.equal(r.compared, false);
    });

    it("validateDeterministicOrdering ordered events → deterministic=true", () => {
        const events = [
            { executionId: "ex-1", sequenceNumber: 1 },
            { executionId: "ex-1", sequenceNumber: 2 },
            { executionId: "ex-2", sequenceNumber: 1 },
            { executionId: "ex-2", sequenceNumber: 2 },
        ];
        const r = crv.validateDeterministicOrdering({ events });
        assert.equal(r.deterministic,  true);
        assert.equal(r.executionCount, 2);
        assert.equal(r.totalEvents,    4);
    });

    it("validateDeterministicOrdering out-of-order → violations reported", () => {
        const events = [
            { executionId: "ex-1", sequenceNumber: 3 },
            { executionId: "ex-1", sequenceNumber: 1 },
        ];
        const r = crv.validateDeterministicOrdering({ events });
        assert.equal(r.deterministic, false);
        assert.equal(r.violations.length, 1);
    });

    it("getReplayConsistencyMetrics empty → consistencyRate=1", () => {
        const m = crv.getReplayConsistencyMetrics();
        assert.equal(m.totalTimelines,     0);
        assert.equal(m.totalDriftChecks,   0);
        assert.equal(m.consistencyRate,    1);
    });

    it("getReplayConsistencyMetrics with drift reduces rate", () => {
        crv.validateConcurrentReplay({ executionId: "b", events: [{ type: "a" }] });
        crv.validateConcurrentReplay({ executionId: "c", events: [{ type: "b" }] });
        crv.detectReplayDrift({ baselineId: "b", comparedId: "c" });
        const m = crv.getReplayConsistencyMetrics();
        assert.equal(m.driftDetectedCount, 1);
        assert.ok(m.consistencyRate < 1);
    });

    it("reset clears all timelines and drift reports", () => {
        crv.validateConcurrentReplay({ executionId: "ex-1", events: [] });
        crv.reset();
        const m = crv.getReplayConsistencyMetrics();
        assert.equal(m.totalTimelines, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// concurrencyTelemetry
// ─────────────────────────────────────────────────────────────────────
describe("concurrencyTelemetry", () => {
    beforeEach(() => tel.reset());

    it("recordConcurrencyEvent returns eventId", () => {
        const r = tel.recordConcurrencyEvent({ type: "slot_acquired", workflowId: "wf-1" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("conc-"));
    });

    it("recordDeadlockEvent returns eventId", () => {
        const r = tel.recordDeadlockEvent({ type: "deadlock_detected", cycle: ["A", "B"] });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("dead-"));
    });

    it("recordArbitrationEvent returns eventId", () => {
        const r = tel.recordArbitrationEvent({ type: "resource_allocated", resourceType: "cpu_slots" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("arb-"));
    });

    it("getConcurrencyMetrics empty → all zeroes/nulls", () => {
        const m = tel.getConcurrencyMetrics();
        assert.equal(m.totalConcurrencyEvents, 0);
        assert.equal(m.totalDeadlockEvents,    0);
        assert.equal(m.totalArbitrationEvents, 0);
        assert.equal(m.starvationEvents,       0);
        assert.equal(m.isolationViolations,    0);
        assert.equal(m.contentionEvents,       0);
        assert.equal(m.avgArbitrationLatencyMs, null);
    });

    it("getConcurrencyMetrics counts starvationEvents", () => {
        tel.recordConcurrencyEvent({ type: "starvation", starvation: true  });
        tel.recordConcurrencyEvent({ type: "normal",     starvation: false });
        assert.equal(tel.getConcurrencyMetrics().starvationEvents, 1);
    });

    it("getConcurrencyMetrics counts isolationViolations", () => {
        tel.recordConcurrencyEvent({ type: "violation", isolationViolation: true  });
        tel.recordConcurrencyEvent({ type: "ok",        isolationViolation: false });
        assert.equal(tel.getConcurrencyMetrics().isolationViolations, 1);
    });

    it("getConcurrencyMetrics counts contentionEvents", () => {
        tel.recordArbitrationEvent({ type: "alloc", contention: true  });
        tel.recordArbitrationEvent({ type: "alloc", contention: false });
        assert.equal(tel.getConcurrencyMetrics().contentionEvents, 1);
    });

    it("getConcurrencyMetrics avgArbitrationLatencyMs computed", () => {
        tel.recordArbitrationEvent({ type: "alloc", latencyMs: 10 });
        tel.recordArbitrationEvent({ type: "alloc", latencyMs: 30 });
        assert.equal(tel.getConcurrencyMetrics().avgArbitrationLatencyMs, 20);
    });

    it("getDeadlockAnalytics empty → all zeroes", () => {
        const a = tel.getDeadlockAnalytics();
        assert.equal(a.totalDeadlockEvents, 0);
        assert.equal(a.resolvedDeadlocks,   0);
        assert.equal(a.unresolvedDeadlocks, 0);
        assert.equal(a.resolutionRate,      0);
    });

    it("getDeadlockAnalytics resolutionRate computed", () => {
        tel.recordDeadlockEvent({ type: "detected", resolved: true  });
        tel.recordDeadlockEvent({ type: "detected", resolved: true  });
        tel.recordDeadlockEvent({ type: "detected", resolved: false });
        const a = tel.getDeadlockAnalytics();
        assert.equal(a.resolvedDeadlocks,   2);
        assert.equal(a.unresolvedDeadlocks, 1);
        assert.ok(Math.abs(a.resolutionRate - 0.667) < 0.001);
    });

    it("getDeadlockAnalytics unresolvedDeadlocks count", () => {
        tel.recordDeadlockEvent({ type: "detected", resolved: false });
        tel.recordDeadlockEvent({ type: "detected", resolved: false });
        assert.equal(tel.getDeadlockAnalytics().unresolvedDeadlocks, 2);
    });

    it("reset clears all telemetry", () => {
        tel.recordConcurrencyEvent({ type: "slot_acquired" });
        tel.recordDeadlockEvent({ type: "detected" });
        tel.recordArbitrationEvent({ type: "alloc" });
        tel.reset();
        const m = tel.getConcurrencyMetrics();
        assert.equal(m.totalConcurrencyEvents, 0);
        assert.equal(m.totalDeadlockEvents,    0);
        assert.equal(m.totalArbitrationEvents, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// integration
// ─────────────────────────────────────────────────────────────────────
describe("runtime concurrency integration", () => {
    beforeEach(() => {
        ecm.reset(); rae.reset(); dde.reset();
        eic.reset(); crv.reset(); tel.reset();
    });

    it("concurrent execution allocation — multiple workflows acquire slots", () => {
        const ids = ["wf-1", "wf-2", "wf-3", "wf-4", "wf-5"];
        const slots = ids.map(id => ecm.acquireExecutionSlot({ workflowId: id, maxSlots: 10 }));
        assert.ok(slots.every(r => r.acquired));
        assert.equal(ecm.getConcurrencyState().totalActiveSlots, 5);
    });

    it("slot limit enforcement — acquisition blocked at capacity", () => {
        for (let i = 0; i < 3; i++)
            ecm.acquireExecutionSlot({ workflowId: `wf-${i}`, maxSlots: 3 });
        const r = ecm.acquireExecutionSlot({ workflowId: "wf-overflow" });
        assert.equal(r.acquired, false);
        assert.equal(r.reason,   "slot_limit_reached");
    });

    it("resource arbitration fairness — three owners share equally", () => {
        rae.requestResources({ ownerId: "wf-A", resourceType: "cpu_slots", amount: 70, totalCapacity: 90 });
        rae.requestResources({ ownerId: "wf-B", resourceType: "cpu_slots", amount: 15 });
        rae.requestResources({ ownerId: "wf-C", resourceType: "cpu_slots", amount:  5 });
        const r = rae.rebalanceResources("cpu_slots");
        assert.equal(r.rebalanced,       true);
        assert.equal(r.ownersRebalanced, 3);
        assert.equal(r.fairShare,        30); // floor(90/3)
    });

    it("starvation prevention — recovery-priority request succeeds under pressure", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "recovery_capacity", amount: 60, totalCapacity: 100 });
        rae.requestResources({ ownerId: "wf-2", resourceType: "recovery_capacity", amount: 30 });
        const r = rae.requestResources({
            ownerId: "wf-recovery", resourceType: "recovery_capacity",
            amount: 10, policy: "recovery-priority",
        });
        assert.equal(r.allocated, true);
        assert.equal(r.remaining, 0);
    });

    it("deadlock detection → resolution → clean graph", () => {
        dde.analyzeWaitGraph({
            waits: [
                { waiterId: "wf-X", waitingFor: "wf-Y" },
                { waiterId: "wf-Y", waitingFor: "wf-X" },
            ],
        });
        const d1 = dde.detectDeadlocks();
        assert.equal(d1.deadlocksFound, true);
        dde.resolveDeadlock({ cycle: d1.cycles[0], strategy: "preempt_oldest" });
        const d2 = dde.detectDeadlocks();
        assert.equal(d2.deadlocksFound, false);
    });

    it("circular wait detection in 3-node chain", () => {
        dde.analyzeWaitGraph({
            waits: [
                { waiterId: "A", waitingFor: "B" },
                { waiterId: "B", waitingFor: "C" },
                { waiterId: "C", waitingFor: "A" },
            ],
        });
        const r = dde.detectDeadlocks();
        assert.equal(r.deadlocksFound, true);
        const cycle = r.cycles[0];
        assert.equal(cycle.length, 3);
    });

    it("orphaned resource cleanup after workflow release", () => {
        rae.requestResources({ ownerId: "wf-temp", resourceType: "execution_tokens", amount: 25, totalCapacity: 100 });
        const before = rae.detectResourcePressure("execution_tokens");
        assert.equal(before.used, 25);
        rae.releaseResources({ ownerId: "wf-temp", resourceType: "execution_tokens" });
        const after = rae.detectResourcePressure("execution_tokens");
        assert.equal(after.used,      0);
        assert.equal(after.available, 100);
    });

    it("replay drift detection in concurrent executions", () => {
        crv.validateConcurrentReplay({
            executionId: "exec-baseline",
            events: [{ type: "step_1" }, { type: "step_2" }, { type: "step_3" }],
        });
        crv.validateConcurrentReplay({
            executionId: "exec-diverged",
            events: [{ type: "step_1" }, { type: "step_X" }, { type: "step_3" }],
        });
        const r = crv.detectReplayDrift({ baselineId: "exec-baseline", comparedId: "exec-diverged" });
        assert.equal(r.driftDetected,   true);
        assert.equal(r.divergenceCount, 1);
        assert.equal(r.divergences[0].index, 1);
    });

    it("deterministic concurrent replay validation across executions", () => {
        const events = [
            { executionId: "ex-1", globalSequence: 1 },
            { executionId: "ex-2", globalSequence: 2 },
            { executionId: "ex-1", globalSequence: 3 },
            { executionId: "ex-2", globalSequence: 4 },
        ];
        const r = crv.validateDeterministicOrdering({ events });
        assert.equal(r.deterministic, true);
    });

    it("isolation-aware concurrency — boundary capacity enforced", () => {
        const { boundaryId } = eic.createIsolationBoundary({ isolationDomain: "prod", maxWorkflows: 2 });
        eic.isolateWorkflow({ workflowId: "wf-1", boundaryId });
        eic.isolateWorkflow({ workflowId: "wf-2", boundaryId });
        const safety = eic.validateIsolationSafety({ workflowId: "wf-3", boundaryId });
        assert.equal(safety.safe,   false);
        assert.equal(safety.reason, "boundary_capacity_exceeded");
    });

    it("contention handling — resource pressure detected when critical", () => {
        rae.requestResources({ ownerId: "wf-1", resourceType: "memory_budget", amount: 92, totalCapacity: 100 });
        const p = rae.detectResourcePressure("memory_budget");
        assert.equal(p.pressure, "critical");
        tel.recordArbitrationEvent({ type: "pressure_detected", resourceType: "memory_budget", contention: true });
        assert.equal(tel.getConcurrencyMetrics().contentionEvents, 1);
    });

    it("concurrent recovery safety — quarantined workflow cannot isolate", () => {
        eic.quarantineUnsafeExecution({ workflowId: "wf-unsafe", reason: "deadlock_detected" });
        const r1 = eic.isolateWorkflow({ workflowId: "wf-unsafe" });
        assert.equal(r1.isolated, false);
        const r2 = eic.validateIsolationSafety({ workflowId: "wf-unsafe" });
        assert.equal(r2.safe, false);
    });

    it("replay consistency validated across parallel workflows", () => {
        for (let i = 0; i < 3; i++) {
            crv.validateConcurrentReplay({
                executionId: `wf-par-${i}`,
                events: [{ type: "step_a" }, { type: "step_b" }],
            });
        }
        // All three should be consistent with each other
        const r12 = crv.compareExecutionTimelines("wf-par-0", "wf-par-1");
        const r23 = crv.compareExecutionTimelines("wf-par-1", "wf-par-2");
        assert.equal(r12.identical, true);
        assert.equal(r23.identical, true);
        const m = crv.getReplayConsistencyMetrics();
        assert.equal(m.totalTimelines, 3);
    });

    it("full telemetry coverage across concurrency pipeline", () => {
        tel.recordConcurrencyEvent({ type: "slot_acquired",    starvation: false });
        tel.recordConcurrencyEvent({ type: "starvation_risk",  starvation: true  });
        tel.recordConcurrencyEvent({ type: "iso_violation",    isolationViolation: true });
        tel.recordDeadlockEvent({ type: "detected",  resolved: true  });
        tel.recordDeadlockEvent({ type: "detected",  resolved: false });
        tel.recordArbitrationEvent({ type: "alloc",  latencyMs: 15, contention: true  });
        tel.recordArbitrationEvent({ type: "alloc",  latencyMs: 25, contention: false });

        const cm = tel.getConcurrencyMetrics();
        assert.equal(cm.totalConcurrencyEvents,  3);
        assert.equal(cm.totalDeadlockEvents,     2);
        assert.equal(cm.totalArbitrationEvents,  2);
        assert.equal(cm.starvationEvents,        1);
        assert.equal(cm.isolationViolations,     1);
        assert.equal(cm.contentionEvents,        1);
        assert.equal(cm.avgArbitrationLatencyMs, 20);

        const da = tel.getDeadlockAnalytics();
        assert.equal(da.resolvedDeadlocks,   1);
        assert.equal(da.unresolvedDeadlocks, 1);
        assert.equal(da.resolutionRate,      0.5);
    });

    it("end-to-end concurrent workflow simulation", () => {
        // 1. Acquire slots for 3 concurrent workflows
        const s1 = ecm.acquireExecutionSlot({ workflowId: "sim-A", maxSlots: 5, isolationDomain: "sim" });
        const s2 = ecm.acquireExecutionSlot({ workflowId: "sim-B" });
        const s3 = ecm.acquireExecutionSlot({ workflowId: "sim-C" });
        assert.ok(s1.acquired && s2.acquired && s3.acquired);

        // 2. Allocate resources
        rae.requestResources({ ownerId: "sim-A", resourceType: "cpu_slots", amount: 20, totalCapacity: 100 });
        rae.requestResources({ ownerId: "sim-B", resourceType: "cpu_slots", amount: 20 });
        rae.requestResources({ ownerId: "sim-C", resourceType: "cpu_slots", amount: 20 });

        // 3. Validate isolation for all three
        const { boundaryId } = eic.createIsolationBoundary({ isolationDomain: "sim", maxWorkflows: 5 });
        for (const id of ["sim-A", "sim-B", "sim-C"]) {
            const safe = eic.validateIsolationSafety({ workflowId: id, boundaryId });
            assert.equal(safe.safe, true);
            eic.isolateWorkflow({ workflowId: id, boundaryId });
        }

        // 4. Check no deadlocks
        const dl = dde.detectDeadlocks();
        assert.equal(dl.deadlocksFound, false);

        // 5. Record concurrent replays
        for (const id of ["sim-A", "sim-B", "sim-C"]) {
            crv.validateConcurrentReplay({ executionId: id, events: [{ type: "run" }, { type: "done" }] });
        }

        // 6. Release resources and slots
        for (const id of ["sim-A", "sim-B", "sim-C"]) {
            rae.releaseResources({ ownerId: id, resourceType: "cpu_slots" });
        }
        ecm.releaseExecutionSlot(s1.slotId);
        ecm.releaseExecutionSlot(s2.slotId);
        ecm.releaseExecutionSlot(s3.slotId);

        assert.equal(ecm.getConcurrencyState().totalActiveSlots, 0);
        assert.equal(rae.detectResourcePressure("cpu_slots").used, 0);
        assert.equal(crv.getReplayConsistencyMetrics().totalTimelines, 3);
    });

    it("starvation event tracked when recovery workflow deferred", () => {
        ecm.acquireExecutionSlot({ workflowId: "normal-wf", maxSlots: 1 });
        const blocked = ecm.acquireExecutionSlot({ workflowId: "recovery-wf", recoveryMode: true });
        assert.equal(blocked.acquired, false);
        tel.recordConcurrencyEvent({ type: "starvation_detected", starvation: true, workflowId: "recovery-wf" });
        assert.equal(tel.getConcurrencyMetrics().starvationEvents, 1);
    });
});
