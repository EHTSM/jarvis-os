"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const graph    = require("../../agents/runtime/coordination/executionGraphManager.cjs");
const sched    = require("../../agents/runtime/coordination/deterministicScheduler.cjs");
const depRes   = require("../../agents/runtime/coordination/dependencyResolutionEngine.cjs");
const replay   = require("../../agents/runtime/coordination/executionReplayCoordinator.cjs");
const wfsm     = require("../../agents/runtime/coordination/workflowStateMachine.cjs");
const telemetry = require("../../agents/runtime/coordination/coordinationTelemetry.cjs");

// ─── executionGraphManager ────────────────────────────────────────────────────

describe("executionGraphManager", () => {
    beforeEach(() => graph.reset());

    it("exports EXECUTION_TYPES", () => {
        assert.ok(Array.isArray(graph.EXECUTION_TYPES));
        assert.ok(graph.EXECUTION_TYPES.includes("task"));
        assert.ok(graph.EXECUTION_TYPES.includes("workflow"));
        assert.ok(graph.EXECUTION_TYPES.includes("agent"));
        assert.ok(graph.EXECUTION_TYPES.includes("capability"));
        assert.ok(graph.EXECUTION_TYPES.includes("recovery"));
    });

    it("createExecutionGraph → created with graphId", () => {
        const r = graph.createExecutionGraph({ name: "test-graph" });
        assert.equal(r.created, true);
        assert.ok(r.graphId.startsWith("grph-"));
    });

    it("addNode → added", () => {
        const { graphId } = graph.createExecutionGraph({});
        const r = graph.addNode(graphId, { nodeId: "A" });
        assert.equal(r.added, true);
        assert.equal(r.nodeId, "A");
        assert.equal(r.graphId, graphId);
    });

    it("addNode stores all metadata", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, {
            nodeId:            "A",
            executionType:     "agent",
            priority:          8,
            executionCost:     3,
            isolationDomain:   "dom-1",
            retryPolicy:       { maxRetries: 3 },
            verificationPolicy: { type: "file_exists" },
        });
        const topo = graph.getExecutionTopology(graphId);
        const node = topo.nodes.find(n => n.nodeId === "A");
        assert.equal(node.executionType, "agent");
        assert.equal(node.priority, 8);
        assert.equal(node.executionCost, 3);
        assert.equal(node.isolationDomain, "dom-1");
        assert.ok(node.retryPolicy != null);
        assert.deepEqual(node.dependencies, []);
        assert.deepEqual(node.dependents, []);
    });

    it("addNode missing nodeId → not added", () => {
        const { graphId } = graph.createExecutionGraph({});
        const r = graph.addNode(graphId, {});
        assert.equal(r.added, false);
        assert.equal(r.reason, "nodeId_required");
    });

    it("addNode duplicate nodeId → not added", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        const r = graph.addNode(graphId, { nodeId: "A" });
        assert.equal(r.added, false);
        assert.equal(r.reason, "duplicate_node");
    });

    it("addNode to nonexistent graph → not added", () => {
        const r = graph.addNode("grph-ghost", { nodeId: "A" });
        assert.equal(r.added, false);
        assert.equal(r.reason, "graph_not_found");
    });

    it("addDependency → updates dependencies and dependents", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        const r = graph.addDependency(graphId, "B", "A");
        assert.equal(r.added, true);
        const topo = graph.getExecutionTopology(graphId);
        const B    = topo.nodes.find(n => n.nodeId === "B");
        const A    = topo.nodes.find(n => n.nodeId === "A");
        assert.ok(B.dependencies.includes("A"));
        assert.ok(A.dependents.includes("B"));
    });

    it("addDependency from_node_not_found → not added", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        const r = graph.addDependency(graphId, "Z", "A");
        assert.equal(r.added, false);
        assert.equal(r.reason, "from_node_not_found");
    });

    it("addDependency to_node_not_found → not added", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        const r = graph.addDependency(graphId, "A", "Z");
        assert.equal(r.added, false);
        assert.equal(r.reason, "to_node_not_found");
    });

    it("addDependency graph_not_found → not added", () => {
        const r = graph.addDependency("grph-none", "A", "B");
        assert.equal(r.added, false);
        assert.equal(r.reason, "graph_not_found");
    });

    it("validateGraph empty → valid", () => {
        const { graphId } = graph.createExecutionGraph({});
        const r = graph.validateGraph(graphId);
        assert.equal(r.valid, true);
        assert.equal(r.nodeCount, 0);
        assert.equal(r.edgeCount, 0);
    });

    it("validateGraph linear chain → valid", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addNode(graphId, { nodeId: "C" });
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "B");
        const r = graph.validateGraph(graphId);
        assert.equal(r.valid, true);
        assert.equal(r.nodeCount, 3);
        assert.equal(r.edgeCount, 2);
    });

    it("validateGraph with cycle → invalid, cycles_detected", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "A", "B");
        graph.addDependency(graphId, "B", "A");
        const r = graph.validateGraph(graphId);
        assert.equal(r.valid, false);
        assert.equal(r.reason, "cycles_detected");
        assert.ok(r.cycles.length > 0);
    });

    it("detectCycles no cycles → hasCycles=false", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "B", "A");
        const r = graph.detectCycles(graphId);
        assert.equal(r.hasCycles, false);
        assert.deepEqual(r.cycles, []);
    });

    it("detectCycles A↔B cycle → hasCycles=true", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "A", "B");
        graph.addDependency(graphId, "B", "A");
        const r = graph.detectCycles(graphId);
        assert.equal(r.hasCycles, true);
        assert.ok(r.cycles.length > 0);
    });

    it("detectCycles 3-node cycle A→B→C→A → hasCycles=true", () => {
        const { graphId } = graph.createExecutionGraph({});
        ["A", "B", "C"].forEach(id => graph.addNode(graphId, { nodeId: id }));
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "B");
        graph.addDependency(graphId, "A", "C");
        const r = graph.detectCycles(graphId);
        assert.equal(r.hasCycles, true);
    });

    it("generateExecutionPlan linear A←B←C → order [A,B,C]", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addNode(graphId, { nodeId: "C" });
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "B");
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.generated, true);
        assert.deepEqual(r.executionOrder, ["A", "B", "C"]);
        assert.equal(r.totalNodes, 3);
    });

    it("generateExecutionPlan parallel nodes → all in stage 0", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addNode(graphId, { nodeId: "C" });
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.generated, true);
        assert.equal(r.stages.length, 1);
        assert.equal(r.stages[0].length, 3);
    });

    it("generateExecutionPlan with cycle → not generated", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "A", "B");
        graph.addDependency(graphId, "B", "A");
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.generated, false);
        assert.equal(r.reason, "cycles_detected");
    });

    it("generateExecutionPlan priority ordering — higher priority runs first at same level", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A", priority: 3 });
        graph.addNode(graphId, { nodeId: "B", priority: 9 });
        graph.addNode(graphId, { nodeId: "C", priority: 6 });
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.generated, true);
        assert.equal(r.executionOrder[0], "B");
        assert.equal(r.executionOrder[1], "C");
        assert.equal(r.executionOrder[2], "A");
    });

    it("generateExecutionPlan diamond pattern → D waits for B and C", () => {
        const { graphId } = graph.createExecutionGraph({});
        ["A", "B", "C", "D"].forEach(id => graph.addNode(graphId, { nodeId: id }));
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "A");
        graph.addDependency(graphId, "D", "B");
        graph.addDependency(graphId, "D", "C");
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.generated, true);
        assert.equal(r.executionOrder[0], "A");
        assert.equal(r.executionOrder[r.executionOrder.length - 1], "D");
    });

    it("generateExecutionPlan stages group parallel nodes correctly", () => {
        const { graphId } = graph.createExecutionGraph({});
        ["A", "B", "C", "D"].forEach(id => graph.addNode(graphId, { nodeId: id }));
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "A");
        graph.addDependency(graphId, "D", "B");
        graph.addDependency(graphId, "D", "C");
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.stages.length, 3);
        assert.deepEqual(r.stages[0], ["A"]);
        assert.ok(r.stages[1].includes("B") && r.stages[1].includes("C"));
        assert.deepEqual(r.stages[2], ["D"]);
    });

    it("generateExecutionPlan empty graph → empty order and stages", () => {
        const { graphId } = graph.createExecutionGraph({});
        const r = graph.generateExecutionPlan(graphId);
        assert.equal(r.generated, true);
        assert.deepEqual(r.executionOrder, []);
        assert.deepEqual(r.stages, []);
    });

    it("getExecutionTopology returns nodeCount and edgeCount", () => {
        const { graphId } = graph.createExecutionGraph({ name: "topo-test" });
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "B", "A");
        const r = graph.getExecutionTopology(graphId);
        assert.equal(r.graphId, graphId);
        assert.equal(r.nodeCount, 2);
        assert.equal(r.edgeCount, 1);
        assert.equal(r.name, "topo-test");
    });

    it("getExecutionTopology nonexistent → null", () => {
        assert.equal(graph.getExecutionTopology("grph-nope"), null);
    });

    it("addDependency is idempotent — duplicate edge not double-counted", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "B", "A");
        const r = graph.validateGraph(graphId);
        assert.equal(r.edgeCount, 1);
    });

    it("reset clears all graphs", () => {
        graph.createExecutionGraph({});
        graph.reset();
        assert.equal(graph.getExecutionTopology("grph-1"), null);
    });
});

// ─── deterministicScheduler ───────────────────────────────────────────────────

describe("deterministicScheduler", () => {
    beforeEach(() => sched.reset());

    it("exports SCHEDULING_POLICIES", () => {
        assert.ok(Array.isArray(sched.SCHEDULING_POLICIES));
        assert.ok(sched.SCHEDULING_POLICIES.includes("fifo"));
        assert.ok(sched.SCHEDULING_POLICIES.includes("priority"));
        assert.ok(sched.SCHEDULING_POLICIES.includes("recovery-priority"));
    });

    it("scheduleExecution → scheduled with schedId", () => {
        const r = sched.scheduleExecution({ executionId: "exec-1" });
        assert.equal(r.scheduled, true);
        assert.ok(r.schedId.startsWith("sch-"));
        assert.equal(r.executionId, "exec-1");
        assert.equal(r.position, 1);
    });

    it("scheduleExecution invalid policy → not scheduled", () => {
        const r = sched.scheduleExecution({ executionId: "exec-x", policy: "random" });
        assert.equal(r.scheduled, false);
        assert.ok(r.reason.includes("invalid_policy"));
    });

    it("scheduleExecution all 5 policies succeed", () => {
        for (const policy of sched.SCHEDULING_POLICIES) {
            const r = sched.scheduleExecution({ policy });
            assert.equal(r.scheduled, true, `${policy} should schedule`);
        }
    });

    it("getNextExecution FIFO — returns first scheduled", () => {
        sched.scheduleExecution({ executionId: "A", priority: 5 });
        sched.scheduleExecution({ executionId: "B", priority: 5 });
        const r = sched.getNextExecution();
        assert.equal(r.executionId, "A");
    });

    it("getNextExecution priority — higher priority first", () => {
        sched.scheduleExecution({ executionId: "A", priority: 3 });
        sched.scheduleExecution({ executionId: "B", priority: 8 });
        sched.scheduleExecution({ executionId: "C", priority: 5 });
        const r = sched.getNextExecution();
        assert.equal(r.executionId, "B");
    });

    it("getNextExecution recovery-mode items precede high-priority non-recovery", () => {
        sched.scheduleExecution({ executionId: "high", priority: 10, recoveryMode: false });
        sched.scheduleExecution({ executionId: "rec",  priority: 1,  recoveryMode: true  });
        const r = sched.getNextExecution();
        assert.equal(r.executionId, "rec");
    });

    it("getNextExecution empty queue → null", () => {
        assert.equal(sched.getNextExecution(), null);
    });

    it("getNextExecution filter by isolationDomain", () => {
        sched.scheduleExecution({ executionId: "A", isolationDomain: "dom-1" });
        sched.scheduleExecution({ executionId: "B", isolationDomain: "dom-2" });
        const r = sched.getNextExecution({ isolationDomain: "dom-2" });
        assert.equal(r.executionId, "B");
    });

    it("getNextExecution filter by recoveryMode=true", () => {
        sched.scheduleExecution({ executionId: "A", recoveryMode: false });
        sched.scheduleExecution({ executionId: "B", recoveryMode: true  });
        const r = sched.getNextExecution({ recoveryMode: true });
        assert.equal(r.executionId, "B");
    });

    it("reserveExecutionSlot → reserved with slotId", () => {
        sched.scheduleExecution({ executionId: "exec-2" });
        const r = sched.reserveExecutionSlot("exec-2");
        assert.equal(r.reserved, true);
        assert.ok(r.slotId.startsWith("slot-"));
        assert.equal(r.executionId, "exec-2");
    });

    it("reserveExecutionSlot already running → not reserved", () => {
        sched.scheduleExecution({ executionId: "exec-3" });
        sched.reserveExecutionSlot("exec-3");
        const r = sched.reserveExecutionSlot("exec-3");
        assert.equal(r.reserved, false);
        assert.equal(r.reason, "already_running");
    });

    it("reserveExecutionSlot not found → not reserved", () => {
        const r = sched.reserveExecutionSlot("exec-ghost");
        assert.equal(r.reserved, false);
        assert.equal(r.reason, "execution_not_found");
    });

    it("releaseExecutionSlot → released, removed from queue", () => {
        sched.scheduleExecution({ executionId: "exec-4" });
        const { slotId } = sched.reserveExecutionSlot("exec-4");
        const r = sched.releaseExecutionSlot(slotId);
        assert.equal(r.released, true);
        assert.equal(r.executionId, "exec-4");
        const state = sched.getSchedulerState();
        assert.equal(state.activeSlots, 0);
    });

    it("releaseExecutionSlot not found → not released", () => {
        const r = sched.releaseExecutionSlot("slot-ghost");
        assert.equal(r.released, false);
        assert.equal(r.reason, "slot_not_found");
    });

    it("getSchedulerState pending/running counts", () => {
        sched.scheduleExecution({ executionId: "A" });
        sched.scheduleExecution({ executionId: "B" });
        sched.reserveExecutionSlot("A");
        const s = sched.getSchedulerState();
        assert.equal(s.pending, 1);
        assert.equal(s.running, 1);
        assert.equal(s.activeSlots, 1);
    });

    it("getSchedulerState empty", () => {
        const s = sched.getSchedulerState();
        assert.equal(s.pending, 0);
        assert.equal(s.running, 0);
        assert.equal(s.activeSlots, 0);
        assert.equal(s.queueSize, 0);
    });

    it("rebalanceSchedule re-sorts and returns queueSize", () => {
        sched.scheduleExecution({ executionId: "A", priority: 5 });
        sched.scheduleExecution({ executionId: "B", priority: 9 });
        const r = sched.rebalanceSchedule();
        assert.equal(r.rebalanced, true);
        assert.equal(r.queueSize, 2);
        assert.equal(sched.getNextExecution().executionId, "B");
    });

    it("released slot reduces running count", () => {
        sched.scheduleExecution({ executionId: "exec-5" });
        const { slotId } = sched.reserveExecutionSlot("exec-5");
        assert.equal(sched.getSchedulerState().running, 1);
        sched.releaseExecutionSlot(slotId);
        assert.equal(sched.getSchedulerState().running, 0);
    });

    it("getNextExecution skips running items", () => {
        sched.scheduleExecution({ executionId: "A", priority: 10 });
        sched.scheduleExecution({ executionId: "B", priority: 5  });
        sched.reserveExecutionSlot("A");
        const r = sched.getNextExecution();
        assert.equal(r.executionId, "B");
    });

    it("reset clears all scheduler state", () => {
        sched.scheduleExecution({ executionId: "A" });
        sched.reset();
        const s = sched.getSchedulerState();
        assert.equal(s.queueSize, 0);
        assert.equal(s.scheduledItems.length, 0);
    });
});

// ─── dependencyResolutionEngine ───────────────────────────────────────────────

describe("dependencyResolutionEngine", () => {
    beforeEach(() => depRes.reset());

    it("resolveDependencies no dependencies → ready", () => {
        const r = depRes.resolveDependencies("exec-1", { dependencies: [] });
        assert.equal(r.status, "ready");
        assert.deepEqual(r.blockedOn, []);
        assert.ok(r.resolutionId.startsWith("res-"));
    });

    it("resolveDependencies all completed → ready", () => {
        const r = depRes.resolveDependencies("exec-2", {
            dependencies: ["A", "B"], completedDependencies: ["A", "B"],
        });
        assert.equal(r.status, "ready");
        assert.deepEqual(r.blockedOn, []);
    });

    it("resolveDependencies some incomplete → blocked", () => {
        const r = depRes.resolveDependencies("exec-3", {
            dependencies: ["A", "B"], completedDependencies: ["A"],
        });
        assert.equal(r.status, "blocked");
        assert.deepEqual(r.blockedOn, ["B"]);
    });

    it("resolveDependencies with failed dependency → failed", () => {
        const r = depRes.resolveDependencies("exec-4", {
            dependencies: ["A", "B"], failedDependencies: ["A"],
        });
        assert.equal(r.status, "failed");
    });

    it("resolveDependencies all failed → failed", () => {
        const r = depRes.resolveDependencies("exec-5", {
            dependencies: ["A", "B"], failedDependencies: ["A", "B"],
        });
        assert.equal(r.status, "failed");
    });

    it("getBlockedExecutions returns only blocked", () => {
        depRes.resolveDependencies("ready-1",   { dependencies: [], completedDependencies: [] });
        depRes.resolveDependencies("blocked-1", { dependencies: ["X"] });
        depRes.resolveDependencies("blocked-2", { dependencies: ["Y"] });
        const blocked = depRes.getBlockedExecutions();
        assert.equal(blocked.length, 2);
        assert.ok(blocked.every(e => e.status === "blocked"));
    });

    it("propagateDependencyFailure marks dependents as failed", () => {
        depRes.resolveDependencies("exec-B", { dependencies: ["A"] });
        depRes.resolveDependencies("exec-C", { dependencies: ["A"] });
        depRes.resolveDependencies("exec-D", { dependencies: ["X"] });
        const r = depRes.propagateDependencyFailure("A");
        assert.equal(r.affectedCount, 2);
        assert.ok(r.affected.includes("exec-B"));
        assert.ok(r.affected.includes("exec-C"));
        assert.ok(!r.affected.includes("exec-D"));
    });

    it("propagateDependencyFailure only affects executions with that dep", () => {
        depRes.resolveDependencies("exec-E", { dependencies: ["B"] });
        const r = depRes.propagateDependencyFailure("A");
        assert.equal(r.affectedCount, 0);
        assert.equal(depRes.validateDependencyHealth("exec-E").status, "blocked");
    });

    it("propagateDependencyFailure skips already-failed dependencies", () => {
        depRes.resolveDependencies("exec-F", { dependencies: ["A"], failedDependencies: ["A"] });
        const r = depRes.propagateDependencyFailure("A");
        assert.equal(r.affectedCount, 0);
    });

    it("getBlockedExecutions empty after failure propagation", () => {
        depRes.resolveDependencies("exec-G", { dependencies: ["A"] });
        depRes.propagateDependencyFailure("A");
        assert.equal(depRes.getBlockedExecutions().length, 0);
    });

    it("analyzeDependencyImpact identifies downstream", () => {
        depRes.resolveDependencies("B", { dependencies: ["A"] });
        depRes.resolveDependencies("C", { dependencies: ["B"] });
        depRes.resolveDependencies("D", { dependencies: ["C"] });
        const r = depRes.analyzeDependencyImpact("A");
        assert.equal(r.found, true);
        assert.ok(r.downstreamAffected.includes("B"));
        assert.ok(r.downstreamAffected.includes("C"));
        assert.ok(r.downstreamAffected.includes("D"));
        assert.equal(r.impactDepth, 3);
    });

    it("analyzeDependencyImpact no downstream → empty", () => {
        depRes.resolveDependencies("leaf", { dependencies: ["X"] });
        const r = depRes.analyzeDependencyImpact("leaf");
        assert.equal(r.found, true);
        assert.deepEqual(r.downstreamAffected, []);
        assert.equal(r.impactDepth, 0);
    });

    it("analyzeDependencyImpact not found → found=false", () => {
        const r = depRes.analyzeDependencyImpact("ghost");
        assert.equal(r.found, false);
    });

    it("validateDependencyHealth healthy when ready", () => {
        depRes.resolveDependencies("exec-H", { dependencies: ["A"], completedDependencies: ["A"] });
        const r = depRes.validateDependencyHealth("exec-H");
        assert.equal(r.healthy, true);
        assert.equal(r.status, "ready");
    });

    it("validateDependencyHealth blocked → not healthy", () => {
        depRes.resolveDependencies("exec-I", { dependencies: ["A"] });
        const r = depRes.validateDependencyHealth("exec-I");
        assert.equal(r.healthy, false);
        assert.ok(r.blockedOn.includes("A"));
    });

    it("validateDependencyHealth not found → not healthy", () => {
        const r = depRes.validateDependencyHealth("exec-none");
        assert.equal(r.healthy, false);
        assert.equal(r.reason, "execution_not_found");
    });

    it("resolveDependencies overwrites previous record", () => {
        depRes.resolveDependencies("exec-J", { dependencies: ["A"] });
        depRes.resolveDependencies("exec-J", { dependencies: ["A"], completedDependencies: ["A"] });
        assert.equal(depRes.validateDependencyHealth("exec-J").status, "ready");
    });

    it("reset clears all resolution records", () => {
        depRes.resolveDependencies("exec-K", { dependencies: ["A"] });
        depRes.reset();
        assert.equal(depRes.getBlockedExecutions().length, 0);
        assert.equal(depRes.validateDependencyHealth("exec-K").reason, "execution_not_found");
    });
});

// ─── executionReplayCoordinator ───────────────────────────────────────────────

describe("executionReplayCoordinator", () => {
    beforeEach(() => replay.reset());

    it("recordExecutionPath first event → seq=1", () => {
        const r = replay.recordExecutionPath("exec-1", { type: "step", nodeId: "A" });
        assert.equal(r.recorded, true);
        assert.equal(r.sequenceNumber, 1);
        assert.ok(r.eventId.startsWith("evt-"));
    });

    it("recordExecutionPath multiple events → sequential numbers", () => {
        replay.recordExecutionPath("exec-2", { type: "step" });
        replay.recordExecutionPath("exec-2", { type: "step" });
        const r = replay.recordExecutionPath("exec-2", { type: "rollback", rollbackEvent: true });
        assert.equal(r.sequenceNumber, 3);
    });

    it("recordExecutionPath creates path on first call", () => {
        replay.recordExecutionPath("exec-3", { type: "step" });
        const tl = replay.reconstructExecutionTimeline("exec-3");
        assert.equal(tl.found, true);
        assert.equal(tl.totalEvents, 1);
    });

    it("recordExecutionPath rollbackEvent=true tracked separately", () => {
        replay.recordExecutionPath("exec-4", { type: "step" });
        replay.recordExecutionPath("exec-4", { type: "rollback", rollbackEvent: true });
        replay.recordExecutionPath("exec-4", { type: "step" });
        const tl = replay.reconstructExecutionTimeline("exec-4");
        assert.equal(tl.rollbacks, 1);
    });

    it("recordExecutionPath retries counted in timeline", () => {
        replay.recordExecutionPath("exec-5", { type: "step", retries: 2 });
        replay.recordExecutionPath("exec-5", { type: "step", retries: 1 });
        const tl = replay.reconstructExecutionTimeline("exec-5");
        assert.equal(tl.retries, 3);
    });

    it("replayExecution → replayed with replayId", () => {
        replay.recordExecutionPath("exec-6", { type: "step" });
        const r = replay.replayExecution("exec-6");
        assert.equal(r.replayed, true);
        assert.ok(r.replayId.startsWith("rpl-"));
        assert.equal(r.consistent, true);
        assert.equal(r.status, "completed");
    });

    it("replayExecution not found → not replayed", () => {
        const r = replay.replayExecution("exec-ghost");
        assert.equal(r.replayed, false);
        assert.equal(r.reason, "execution_not_found");
    });

    it("replayExecution eventsReplayed count matches recorded", () => {
        replay.recordExecutionPath("exec-7", { type: "step" });
        replay.recordExecutionPath("exec-7", { type: "step" });
        replay.recordExecutionPath("exec-7", { type: "complete" });
        const r = replay.replayExecution("exec-7");
        assert.equal(r.eventsReplayed, 3);
    });

    it("validateReplayConsistency no expected → consistent, sequenceValid=true", () => {
        replay.recordExecutionPath("exec-8", { type: "step" });
        replay.recordExecutionPath("exec-8", { type: "step" });
        const r = replay.validateReplayConsistency("exec-8");
        assert.equal(r.consistent, true);
        assert.equal(r.sequenceValid, true);
        assert.equal(r.eventCount, 2);
    });

    it("validateReplayConsistency matching expected → consistent", () => {
        replay.recordExecutionPath("exec-9", { type: "step"     });
        replay.recordExecutionPath("exec-9", { type: "rollback" });
        replay.recordExecutionPath("exec-9", { type: "step"     });
        const r = replay.validateReplayConsistency("exec-9", [
            { type: "step" }, { type: "rollback" }, { type: "step" },
        ]);
        assert.equal(r.consistent, true);
        assert.deepEqual(r.mismatches, []);
    });

    it("validateReplayConsistency count mismatch → not consistent", () => {
        replay.recordExecutionPath("exec-10", { type: "step" });
        const r = replay.validateReplayConsistency("exec-10", [
            { type: "step" }, { type: "step" },
        ]);
        assert.equal(r.consistent, false);
        assert.equal(r.reason, "event_count_mismatch");
    });

    it("validateReplayConsistency type mismatch → not consistent, reports mismatch index", () => {
        replay.recordExecutionPath("exec-11", { type: "step"   });
        replay.recordExecutionPath("exec-11", { type: "failed" });
        const r = replay.validateReplayConsistency("exec-11", [
            { type: "step" }, { type: "rollback" },
        ]);
        assert.equal(r.consistent, false);
        assert.equal(r.mismatches[0].index, 1);
        assert.equal(r.mismatches[0].expected, "rollback");
        assert.equal(r.mismatches[0].actual, "failed");
    });

    it("validateReplayConsistency no path → not consistent", () => {
        const r = replay.validateReplayConsistency("exec-none");
        assert.equal(r.consistent, false);
        assert.equal(r.reason, "no_path_recorded");
    });

    it("replayExecution with mismatching expected → inconsistent status", () => {
        replay.recordExecutionPath("exec-12", { type: "step" });
        const r = replay.replayExecution("exec-12", {
            expectedEvents: [{ type: "rollback" }],
        });
        assert.equal(r.replayed, true);
        assert.equal(r.consistent, false);
        assert.equal(r.status, "inconsistent");
    });

    it("reconstructExecutionTimeline not found → found=false", () => {
        const r = replay.reconstructExecutionTimeline("exec-ghost");
        assert.equal(r.found, false);
    });

    it("reconstructExecutionTimeline has startedAt", () => {
        replay.recordExecutionPath("exec-13", { type: "step" });
        const tl = replay.reconstructExecutionTimeline("exec-13");
        assert.ok(tl.startedAt != null);
    });

    it("getReplayState initial → 0 tracked, 0 replays", () => {
        const s = replay.getReplayState();
        assert.equal(s.trackedExecutions, 0);
        assert.equal(s.totalReplays, 0);
        assert.deepEqual(s.replays, []);
    });

    it("getReplayState after recording and replaying", () => {
        replay.recordExecutionPath("exec-14", { type: "step" });
        replay.replayExecution("exec-14");
        replay.replayExecution("exec-14");
        const s = replay.getReplayState();
        assert.equal(s.trackedExecutions, 1);
        assert.equal(s.totalReplays, 2);
    });

    it("separate executionIds have independent paths", () => {
        replay.recordExecutionPath("exec-A", { type: "step"     });
        replay.recordExecutionPath("exec-B", { type: "rollback" });
        assert.equal(replay.reconstructExecutionTimeline("exec-A").totalEvents, 1);
        assert.equal(replay.reconstructExecutionTimeline("exec-B").totalEvents, 1);
    });

    it("reset clears all paths and replays", () => {
        replay.recordExecutionPath("exec-Z", { type: "step" });
        replay.replayExecution("exec-Z");
        replay.reset();
        assert.equal(replay.getReplayState().trackedExecutions, 0);
        assert.equal(replay.reconstructExecutionTimeline("exec-Z").found, false);
    });
});

// ─── workflowStateMachine ─────────────────────────────────────────────────────

describe("workflowStateMachine", () => {
    beforeEach(() => wfsm.reset());

    it("exports WORKFLOW_STATES and VALID_TRANSITIONS", () => {
        assert.ok(Array.isArray(wfsm.WORKFLOW_STATES));
        assert.ok(wfsm.WORKFLOW_STATES.includes("created"));
        assert.ok(wfsm.WORKFLOW_STATES.includes("quarantined"));
        assert.ok(wfsm.WORKFLOW_STATES.includes("recovering"));
        assert.ok(typeof wfsm.VALID_TRANSITIONS === "object");
        assert.ok(wfsm.TERMINAL_STATES instanceof Set);
    });

    it("createWorkflowState → created with state=created", () => {
        const r = wfsm.createWorkflowState({ workflowId: "wf-001" });
        assert.equal(r.created, true);
        assert.ok(r.wfId.startsWith("wf-"));
        assert.equal(r.workflowId, "wf-001");
        assert.equal(r.state, "created");
    });

    it("createWorkflowState no workflowId → not created", () => {
        const r = wfsm.createWorkflowState({});
        assert.equal(r.created, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("getWorkflowState found", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-002" });
        const s = wfsm.getWorkflowState(wfId);
        assert.equal(s.state, "created");
        assert.equal(s.isTerminal, false);
        assert.ok(s.createdAt != null);
    });

    it("getWorkflowState not found → null", () => {
        assert.equal(wfsm.getWorkflowState("wf-ghost"), null);
    });

    it("transitionState created → scheduled ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-003" });
        const r = wfsm.transitionState(wfId, "scheduled");
        assert.equal(r.transitioned, true);
        assert.equal(r.from, "created");
        assert.equal(r.to, "scheduled");
    });

    it("transitionState created → running ✗ (invalid)", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-004" });
        const r = wfsm.transitionState(wfId, "running");
        assert.equal(r.transitioned, false);
        assert.equal(r.reason, "invalid_transition");
    });

    it("transitionState scheduled → admitted ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-005" });
        wfsm.transitionState(wfId, "scheduled");
        const r = wfsm.transitionState(wfId, "admitted");
        assert.equal(r.transitioned, true);
    });

    it("transitionState admitted → running ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-006" });
        wfsm.transitionState(wfId, "scheduled");
        wfsm.transitionState(wfId, "admitted");
        const r = wfsm.transitionState(wfId, "running");
        assert.equal(r.transitioned, true);
    });

    it("transitionState running → completed ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-007" });
        ["scheduled","admitted","running"].forEach(s => wfsm.transitionState(wfId, s));
        const r = wfsm.transitionState(wfId, "completed");
        assert.equal(r.transitioned, true);
    });

    it("transitionState running → failed ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-008" });
        ["scheduled","admitted","running"].forEach(s => wfsm.transitionState(wfId, s));
        const r = wfsm.transitionState(wfId, "failed");
        assert.equal(r.transitioned, true);
    });

    it("transitionState running → blocked ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-009" });
        ["scheduled","admitted","running"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "blocked").transitioned, true);
    });

    it("transitionState running → recovering ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-010" });
        ["scheduled","admitted","running"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "recovering").transitioned, true);
    });

    it("transitionState failed → recovering ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-011" });
        ["scheduled","admitted","running","failed"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "recovering").transitioned, true);
    });

    it("transitionState failed → quarantined ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-012" });
        ["scheduled","admitted","running","failed"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "quarantined").transitioned, true);
    });

    it("transitionState recovering → stabilized ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-013" });
        ["scheduled","admitted","running","recovering"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "stabilized").transitioned, true);
    });

    it("transitionState stabilized → running ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-014" });
        ["scheduled","admitted","running","recovering","stabilized"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "running").transitioned, true);
    });

    it("transitionState quarantined → recovering ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-015" });
        ["scheduled","admitted","running","failed","quarantined"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "recovering").transitioned, true);
    });

    it("transitionState completed → any ✗ (terminal)", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-016" });
        ["scheduled","admitted","running","completed"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "scheduled").transitioned, false);
        assert.equal(wfsm.getWorkflowState(wfId).isTerminal, true);
    });

    it("transitionState cancelled → any ✗ (terminal)", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-017" });
        wfsm.transitionState(wfId, "scheduled");
        wfsm.transitionState(wfId, "cancelled");
        assert.equal(wfsm.transitionState(wfId, "scheduled").transitioned, false);
        assert.equal(wfsm.getWorkflowState(wfId).isTerminal, true);
    });

    it("validateTransition workflow_not_found → invalid", () => {
        const r = wfsm.validateTransition("wf-ghost", "scheduled");
        assert.equal(r.valid, false);
        assert.equal(r.reason, "workflow_not_found");
    });

    it("validateTransition invalid target state → invalid", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-018" });
        const r = wfsm.validateTransition(wfId, "nonexistent_state");
        assert.equal(r.valid, false);
    });

    it("getTransitionHistory records all transitions with reasons", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-019" });
        wfsm.transitionState(wfId, "scheduled", "auto_scheduled");
        wfsm.transitionState(wfId, "admitted",  "admission_approved");
        const h = wfsm.getTransitionHistory(wfId);
        assert.equal(h.found, true);
        assert.equal(h.history.length, 2);
        assert.equal(h.history[0].from, "created");
        assert.equal(h.history[0].to, "scheduled");
        assert.equal(h.history[0].reason, "auto_scheduled");
    });

    it("getTransitionHistory not found → found=false", () => {
        assert.equal(wfsm.getTransitionHistory("wf-ghost").found, false);
    });

    it("full happy path: created→scheduled→admitted→running→completed", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-020" });
        const path = ["scheduled", "admitted", "running", "completed"];
        for (const s of path) assert.equal(wfsm.transitionState(wfId, s).transitioned, true);
        assert.equal(wfsm.getWorkflowState(wfId).state, "completed");
        assert.equal(wfsm.getWorkflowState(wfId).isTerminal, true);
    });

    it("recovery path: running→failed→recovering→stabilized→running→completed", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-021" });
        const path = ["scheduled","admitted","running","failed","recovering","stabilized","running","completed"];
        for (const s of path) assert.equal(wfsm.transitionState(wfId, s).transitioned, true, `to ${s}`);
    });

    it("transitionState not found → not transitioned", () => {
        const r = wfsm.transitionState("wf-none", "scheduled");
        assert.equal(r.transitioned, false);
        assert.equal(r.reason, "workflow_not_found");
    });

    it("blocked → scheduled retry ✓", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-022" });
        ["scheduled","blocked"].forEach(s => wfsm.transitionState(wfId, s));
        assert.equal(wfsm.transitionState(wfId, "scheduled").transitioned, true);
    });

    it("reset clears all workflow state", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "wf-023" });
        wfsm.reset();
        assert.equal(wfsm.getWorkflowState(wfId), null);
    });
});

// ─── coordinationTelemetry ────────────────────────────────────────────────────

describe("coordinationTelemetry", () => {
    beforeEach(() => telemetry.reset());

    it("exports EVENT_TYPES", () => {
        assert.ok(Array.isArray(telemetry.EVENT_TYPES));
        assert.ok(telemetry.EVENT_TYPES.includes("execution_scheduled"));
        assert.ok(telemetry.EVENT_TYPES.includes("dependency_blocked"));
        assert.ok(telemetry.EVENT_TYPES.includes("replay_completed"));
    });

    it("recordSchedulingEvent returns eventId", () => {
        const r = telemetry.recordSchedulingEvent({ type: "execution_scheduled", executionId: "A" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("sched-"));
    });

    it("recordDependencyEvent returns eventId", () => {
        const r = telemetry.recordDependencyEvent({ type: "dependency_blocked", executionId: "B" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("dep-"));
    });

    it("recordReplayEvent returns eventId", () => {
        const r = telemetry.recordReplayEvent({ type: "replay_completed", consistent: true });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("rpl-"));
    });

    it("getCoordinationMetrics empty → all zeroes", () => {
        const m = telemetry.getCoordinationMetrics();
        assert.equal(m.totalSchedulingEvents, 0);
        assert.equal(m.totalDependencyEvents, 0);
        assert.equal(m.starvationEvents, 0);
        assert.equal(m.blockedExecutions, 0);
        assert.equal(m.avgSchedulingLatencyMs, null);
    });

    it("getCoordinationMetrics counts scheduledExecutions", () => {
        telemetry.recordSchedulingEvent({ type: "execution_scheduled" });
        telemetry.recordSchedulingEvent({ type: "execution_scheduled" });
        telemetry.recordSchedulingEvent({ type: "slot_reserved" });
        assert.equal(telemetry.getCoordinationMetrics().scheduledExecutions, 2);
    });

    it("getCoordinationMetrics counts starvationEvents", () => {
        telemetry.recordSchedulingEvent({ type: "starvation_detected", starvation: true  });
        telemetry.recordSchedulingEvent({ type: "execution_scheduled", starvation: false });
        assert.equal(telemetry.getCoordinationMetrics().starvationEvents, 1);
    });

    it("getCoordinationMetrics counts blockedExecutions", () => {
        telemetry.recordDependencyEvent({ type: "dependency_blocked" });
        telemetry.recordDependencyEvent({ type: "dependency_blocked" });
        telemetry.recordDependencyEvent({ type: "dependency_resolved" });
        assert.equal(telemetry.getCoordinationMetrics().blockedExecutions, 2);
    });

    it("getCoordinationMetrics counts dependencyFailures", () => {
        telemetry.recordDependencyEvent({ type: "dependency_failed" });
        assert.equal(telemetry.getCoordinationMetrics().dependencyFailures, 1);
    });

    it("getCoordinationMetrics avgSchedulingLatencyMs computed", () => {
        telemetry.recordSchedulingEvent({ type: "slot_reserved", latencyMs: 10 });
        telemetry.recordSchedulingEvent({ type: "slot_reserved", latencyMs: 20 });
        assert.equal(telemetry.getCoordinationMetrics().avgSchedulingLatencyMs, 15);
    });

    it("getReplayAnalytics empty → zeroes", () => {
        const r = telemetry.getReplayAnalytics();
        assert.equal(r.totalReplays, 0);
        assert.equal(r.consistencyRate, 0);
    });

    it("getReplayAnalytics counts consistent/inconsistent replays", () => {
        telemetry.recordReplayEvent({ type: "replay_completed",   consistent: true  });
        telemetry.recordReplayEvent({ type: "replay_completed",   consistent: true  });
        telemetry.recordReplayEvent({ type: "replay_inconsistent", consistent: false });
        const r = telemetry.getReplayAnalytics();
        assert.equal(r.consistentReplays, 2);
        assert.equal(r.inconsistentReplays, 1);
        assert.ok(r.consistencyRate > 0.6 && r.consistencyRate < 0.7);
    });

    it("getReplayAnalytics events without consistent flag not counted in rates", () => {
        telemetry.recordReplayEvent({ type: "replay_started" });
        telemetry.recordReplayEvent({ type: "replay_completed", consistent: true });
        const r = telemetry.getReplayAnalytics();
        assert.equal(r.totalReplays, 2);
        assert.equal(r.consistentReplays, 1);
        assert.equal(r.consistencyRate, 1.0);
    });

    it("reset clears all telemetry", () => {
        telemetry.recordSchedulingEvent({ type: "execution_scheduled" });
        telemetry.recordDependencyEvent({ type: "dependency_blocked" });
        telemetry.recordReplayEvent({ type: "replay_completed", consistent: true });
        telemetry.reset();
        const m = telemetry.getCoordinationMetrics();
        assert.equal(m.totalSchedulingEvents, 0);
        assert.equal(m.totalDependencyEvents, 0);
        assert.equal(telemetry.getReplayAnalytics().totalReplays, 0);
    });
});

// ─── Integration ──────────────────────────────────────────────────────────────

describe("runtime coordination integration", () => {
    beforeEach(() => {
        graph.reset(); sched.reset(); depRes.reset();
        replay.reset(); wfsm.reset(); telemetry.reset();
    });

    it("DAG scheduling simulation — A→B→C executes in order with state machine", () => {
        const { graphId } = graph.createExecutionGraph({ name: "pipeline" });
        ["A", "B", "C"].forEach(id => graph.addNode(graphId, { nodeId: id }));
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "B");

        const plan = graph.generateExecutionPlan(graphId);
        assert.deepEqual(plan.executionOrder, ["A", "B", "C"]);

        // Schedule each in execution order
        for (const execId of plan.executionOrder) {
            sched.scheduleExecution({ executionId: execId });
            const { wfId } = wfsm.createWorkflowState({ workflowId: execId });
            wfsm.transitionState(wfId, "scheduled");
            telemetry.recordSchedulingEvent({ type: "execution_scheduled", executionId: execId });
        }

        assert.equal(telemetry.getCoordinationMetrics().scheduledExecutions, 3);
        assert.equal(sched.getSchedulerState().pending, 3);
    });

    it("cycle detection prevents execution plan generation", () => {
        const { graphId } = graph.createExecutionGraph({});
        graph.addNode(graphId, { nodeId: "A" });
        graph.addNode(graphId, { nodeId: "B" });
        graph.addDependency(graphId, "A", "B");
        graph.addDependency(graphId, "B", "A");

        const validate = graph.validateGraph(graphId);
        assert.equal(validate.valid, false);

        const plan = graph.generateExecutionPlan(graphId);
        assert.equal(plan.generated, false);
        assert.equal(plan.reason, "cycles_detected");
    });

    it("dependency failure cascades through chain — A fails → B and C fail", () => {
        depRes.resolveDependencies("B", { dependencies: ["A"] });
        depRes.resolveDependencies("C", { dependencies: ["B"] });

        // A fails → propagate to B
        const r1 = depRes.propagateDependencyFailure("A");
        assert.equal(r1.affectedCount, 1);
        assert.ok(r1.affected.includes("B"));

        // B is now failed → propagate to C
        const r2 = depRes.propagateDependencyFailure("B");
        assert.equal(r2.affectedCount, 1);
        assert.ok(r2.affected.includes("C"));

        assert.equal(depRes.validateDependencyHealth("C").status, "failed");
        telemetry.recordDependencyEvent({ type: "dependency_failed", dependencyId: "A", affected: 1 });
        telemetry.recordDependencyEvent({ type: "dependency_failed", dependencyId: "B", affected: 1 });
        assert.equal(telemetry.getCoordinationMetrics().dependencyFailures, 2);
    });

    it("replay consistency validation after execution recording", () => {
        const execId = "exec-replay-test";
        replay.recordExecutionPath(execId, { type: "step",     nodeId: "A" });
        replay.recordExecutionPath(execId, { type: "step",     nodeId: "B" });
        replay.recordExecutionPath(execId, { type: "complete", nodeId: "C" });

        const result = replay.replayExecution(execId, {
            expectedEvents: [{ type: "step" }, { type: "step" }, { type: "complete" }],
        });
        assert.equal(result.consistent, true);

        telemetry.recordReplayEvent({ type: "replay_completed", consistent: true, eventCount: 3 });
        assert.equal(telemetry.getReplayAnalytics().consistentReplays, 1);
    });

    it("recovery workflow — failed → recovering → stabilized → running → completed", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "recovery-wf" });
        const path = ["scheduled","admitted","running","failed","recovering","stabilized","running","completed"];
        for (const s of path) {
            const r = wfsm.transitionState(wfId, s);
            assert.equal(r.transitioned, true, `transition to ${s} failed`);
        }
        assert.equal(wfsm.getWorkflowState(wfId).isTerminal, true);
        const history = wfsm.getTransitionHistory(wfId);
        assert.equal(history.history.length, path.length);
    });

    it("priority scheduling — high-priority item runs first among queued", () => {
        sched.scheduleExecution({ executionId: "low",  priority: 2 });
        sched.scheduleExecution({ executionId: "high", priority: 9 });
        sched.scheduleExecution({ executionId: "med",  priority: 5 });

        const next = sched.getNextExecution();
        assert.equal(next.executionId, "high");

        const { slotId } = sched.reserveExecutionSlot("high");
        sched.releaseExecutionSlot(slotId);
        assert.equal(sched.getNextExecution().executionId, "med");
    });

    it("starvation prevention — recovery-mode always scheduled ahead of all priorities", () => {
        sched.scheduleExecution({ executionId: "p10", priority: 10, recoveryMode: false });
        sched.scheduleExecution({ executionId: "p9",  priority: 9,  recoveryMode: false });
        sched.scheduleExecution({ executionId: "rec", priority: 1,  recoveryMode: true  });

        assert.equal(sched.getNextExecution().executionId, "rec");
        telemetry.recordSchedulingEvent({ type: "starvation_detected", starvation: true, executionId: "rec" });
        assert.equal(telemetry.getCoordinationMetrics().starvationEvents, 1);
    });

    it("blocked dependency halts admission — workflow goes to blocked state", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "blocked-wf" });
        wfsm.transitionState(wfId, "scheduled");

        const health = depRes.resolveDependencies("blocked-wf", { dependencies: ["upstream-task"] });
        assert.equal(health.status, "blocked");

        // Cannot admit while blocked — transition to blocked
        wfsm.transitionState(wfId, "blocked");
        assert.equal(wfsm.getWorkflowState(wfId).state, "blocked");

        telemetry.recordDependencyEvent({ type: "dependency_blocked", executionId: "blocked-wf" });
        assert.equal(telemetry.getCoordinationMetrics().blockedExecutions, 1);
    });

    it("full E2E: diamond DAG + scheduler + state machine + replay + telemetry", () => {
        // Build diamond graph A → B,C → D
        const { graphId } = graph.createExecutionGraph({ name: "diamond" });
        ["A","B","C","D"].forEach(id => graph.addNode(graphId, { nodeId: id }));
        graph.addDependency(graphId, "B", "A");
        graph.addDependency(graphId, "C", "A");
        graph.addDependency(graphId, "D", "B");
        graph.addDependency(graphId, "D", "C");

        const plan = graph.generateExecutionPlan(graphId);
        assert.equal(plan.generated, true);
        assert.equal(plan.stages.length, 3);

        // Schedule all, create state machines
        const wfIds = {};
        for (const execId of plan.executionOrder) {
            sched.scheduleExecution({ executionId: execId });
            const { wfId } = wfsm.createWorkflowState({ workflowId: execId });
            wfIds[execId] = wfId;
            telemetry.recordSchedulingEvent({ type: "execution_scheduled", executionId: execId });
        }

        // Execute A: reserve slot, record events, complete
        const slotA = sched.reserveExecutionSlot("A");
        wfsm.transitionState(wfIds["A"], "scheduled");
        wfsm.transitionState(wfIds["A"], "admitted");
        wfsm.transitionState(wfIds["A"], "running");
        replay.recordExecutionPath("A", { type: "step", nodeId: "A" });
        wfsm.transitionState(wfIds["A"], "completed");
        sched.releaseExecutionSlot(slotA.slotId);

        // Verify replay consistency for A
        const rplResult = replay.replayExecution("A");
        assert.equal(rplResult.consistent, true);
        telemetry.recordReplayEvent({ type: "replay_completed", consistent: true });

        // D still waiting for B and C
        depRes.resolveDependencies("D", {
            dependencies: ["B","C"], completedDependencies: [],
        });
        assert.equal(depRes.validateDependencyHealth("D").status, "blocked");

        const m = telemetry.getCoordinationMetrics();
        assert.equal(m.scheduledExecutions, 4);
        assert.equal(telemetry.getReplayAnalytics().consistentReplays, 1);
    });

    it("replay inconsistency detected and logged", () => {
        replay.recordExecutionPath("exec-bad", { type: "step"   });
        replay.recordExecutionPath("exec-bad", { type: "failed" });

        const r = replay.replayExecution("exec-bad", {
            expectedEvents: [{ type: "step" }, { type: "completed" }],
        });
        assert.equal(r.consistent, false);

        telemetry.recordReplayEvent({ type: "replay_inconsistent", consistent: false });
        assert.equal(telemetry.getReplayAnalytics().inconsistentReplays, 1);
    });

    it("multi-policy scheduling — recovery items from any policy go first", () => {
        sched.scheduleExecution({ executionId: "a", policy: "fifo",     priority: 10, recoveryMode: false });
        sched.scheduleExecution({ executionId: "b", policy: "priority", priority: 1,  recoveryMode: true  });
        sched.scheduleExecution({ executionId: "c", policy: "fifo",     priority: 5,  recoveryMode: true  });

        // Both recovery items before non-recovery; among recovery items, higher priority first
        assert.equal(sched.getNextExecution().executionId, "c");
    });

    it("dependency impact analysis — correct depth measurement", () => {
        depRes.resolveDependencies("L1", { dependencies: ["root"] });
        depRes.resolveDependencies("L2", { dependencies: ["L1"]  });
        depRes.resolveDependencies("L3", { dependencies: ["L2"]  });
        depRes.resolveDependencies("L4", { dependencies: ["L3"]  });

        const impact = depRes.analyzeDependencyImpact("root");
        assert.equal(impact.impactDepth, 4);
    });

    it("workflow cancelled before scheduling — no execution", () => {
        const { wfId } = wfsm.createWorkflowState({ workflowId: "cancelled-wf" });
        wfsm.transitionState(wfId, "cancelled");
        assert.equal(wfsm.getWorkflowState(wfId).isTerminal, true);
        const r = wfsm.transitionState(wfId, "scheduled");
        assert.equal(r.transitioned, false);
    });

    it("getReplayAnalytics consistency rate with mixed results", () => {
        for (let i = 0; i < 3; i++)
            telemetry.recordReplayEvent({ type: "replay_completed",    consistent: true  });
        for (let i = 0; i < 1; i++)
            telemetry.recordReplayEvent({ type: "replay_inconsistent", consistent: false });
        const r = telemetry.getReplayAnalytics();
        assert.equal(r.consistentReplays, 3);
        assert.equal(r.inconsistentReplays, 1);
        assert.equal(r.consistencyRate, 0.75);
    });
});
