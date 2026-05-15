"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const topology  = require("../../agents/runtime/intelligence/runtimeTopologyGraph.cjs");
const lineage   = require("../../agents/runtime/intelligence/executionLineageTracker.cjs");
const depEngine = require("../../agents/runtime/intelligence/dependencyResolutionEngine.cjs");
const bottleneck = require("../../agents/runtime/intelligence/bottleneckAnalysisEngine.cjs");
const pressure  = require("../../agents/runtime/intelligence/systemicPressureAnalyzer.cjs");
const hub       = require("../../agents/runtime/intelligence/runtimeObservabilityHub.cjs");

// ── runtimeTopologyGraph ──────────────────────────────────────────────
describe("runtimeTopologyGraph", () => {
    beforeEach(() => topology.reset());

    it("creates a topology node and returns nodeId", () => {
        const r = topology.createTopologyNode({ workflowId: "wf-1" });
        assert.equal(r.created, true);
        assert.ok(r.nodeId.startsWith("node-"));
        assert.equal(r.workflowId, "wf-1");
    });

    it("rejects node creation without workflowId", () => {
        const r = topology.createTopologyNode({});
        assert.equal(r.created, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("node inherits isolationDomain default", () => {
        const r = topology.createTopologyNode({ workflowId: "wf-1" });
        assert.equal(r.isolationDomain, "default");
    });

    it("adds an edge between two existing nodes", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        const r = topology.addTopologyEdge({ from: a.nodeId, to: b.nodeId });
        assert.equal(r.added, true);
        assert.ok(r.edgeId.startsWith("edge-"));
        assert.equal(r.from, a.nodeId);
        assert.equal(r.to, b.nodeId);
    });

    it("rejects edge for missing from", () => {
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        const r = topology.addTopologyEdge({ to: b.nodeId });
        assert.equal(r.added, false);
        assert.equal(r.reason, "from_required");
    });

    it("rejects edge for missing to", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const r = topology.addTopologyEdge({ from: a.nodeId });
        assert.equal(r.added, false);
        assert.equal(r.reason, "to_required");
    });

    it("rejects edge to non-existent node", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const r = topology.addTopologyEdge({ from: a.nodeId, to: "node-999" });
        assert.equal(r.added, false);
        assert.equal(r.reason, "to_node_not_found");
    });

    it("rejects self-loop edge", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const r = topology.addTopologyEdge({ from: a.nodeId, to: a.nodeId });
        assert.equal(r.added, false);
        assert.equal(r.reason, "self_loop_not_allowed");
    });

    it("detectCycles returns hasCycles=false for acyclic graph", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        const c = topology.createTopologyNode({ workflowId: "wf-c" });
        topology.addTopologyEdge({ from: a.nodeId, to: b.nodeId });
        topology.addTopologyEdge({ from: b.nodeId, to: c.nodeId });
        const r = topology.detectCycles();
        assert.equal(r.hasCycles, false);
        assert.equal(r.cycleCount, 0);
    });

    it("detectCycles detects a simple cycle", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        topology.addTopologyEdge({ from: a.nodeId, to: b.nodeId });
        topology.addTopologyEdge({ from: b.nodeId, to: a.nodeId });
        const r = topology.detectCycles();
        assert.equal(r.hasCycles, true);
        assert.ok(r.cycleCount >= 1);
    });

    it("detectCycles detects a 3-node cycle", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        const c = topology.createTopologyNode({ workflowId: "wf-c" });
        topology.addTopologyEdge({ from: a.nodeId, to: b.nodeId });
        topology.addTopologyEdge({ from: b.nodeId, to: c.nodeId });
        topology.addTopologyEdge({ from: c.nodeId, to: a.nodeId });
        const r = topology.detectCycles();
        assert.equal(r.hasCycles, true);
    });

    it("findCriticalPath returns the shortest path between connected nodes", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        const c = topology.createTopologyNode({ workflowId: "wf-c" });
        topology.addTopologyEdge({ from: a.nodeId, to: b.nodeId });
        topology.addTopologyEdge({ from: b.nodeId, to: c.nodeId });
        const r = topology.findCriticalPath(a.nodeId, c.nodeId);
        assert.equal(r.found, true);
        assert.equal(r.path[0], a.nodeId);
        assert.equal(r.path[r.path.length - 1], c.nodeId);
        assert.equal(r.length, 2);
    });

    it("findCriticalPath returns found=false when no path exists", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        const r = topology.findCriticalPath(a.nodeId, b.nodeId);
        assert.equal(r.found, false);
        assert.equal(r.reason, "no_path_exists");
    });

    it("findCriticalPath returns path of length 0 for same node", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const r = topology.findCriticalPath(a.nodeId, a.nodeId);
        assert.equal(r.found, true);
        assert.equal(r.length, 0);
    });

    it("findCriticalPath returns found=false for unknown node", () => {
        const r = topology.findCriticalPath("node-999", "node-998");
        assert.equal(r.found, false);
    });

    it("getTopologySnapshot includes all nodes and edges", () => {
        const a = topology.createTopologyNode({ workflowId: "wf-a" });
        const b = topology.createTopologyNode({ workflowId: "wf-b" });
        topology.addTopologyEdge({ from: a.nodeId, to: b.nodeId });
        const snap = topology.getTopologySnapshot();
        assert.ok(snap.snapshotId.startsWith("snap-"));
        assert.equal(snap.nodeCount, 2);
        assert.equal(snap.edgeCount, 1);
        assert.ok(Array.isArray(snap.nodes));
        assert.ok(Array.isArray(snap.edges));
    });

    it("getIsolationDomains groups nodes by domain", () => {
        topology.createTopologyNode({ workflowId: "wf-1", isolationDomain: "zone-a" });
        topology.createTopologyNode({ workflowId: "wf-2", isolationDomain: "zone-a" });
        topology.createTopologyNode({ workflowId: "wf-3", isolationDomain: "zone-b" });
        const r = topology.getIsolationDomains();
        assert.equal(r.domainCount, 2);
        assert.equal(r.domains["zone-a"].length, 2);
        assert.equal(r.domains["zone-b"].length, 1);
    });

    it("getIsolationDomains returns empty domains for no nodes", () => {
        const r = topology.getIsolationDomains();
        assert.equal(r.domainCount, 0);
    });
});

// ── executionLineageTracker ───────────────────────────────────────────
describe("executionLineageTracker", () => {
    beforeEach(() => lineage.reset());

    it("registers an execution and returns execId", () => {
        const r = lineage.registerExecution({ workflowId: "wf-1" });
        assert.equal(r.registered, true);
        assert.ok(r.execId.startsWith("exec-"));
    });

    it("rejects registration without workflowId", () => {
        const r = lineage.registerExecution({});
        assert.equal(r.registered, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("accepts custom execId", () => {
        const r = lineage.registerExecution({ workflowId: "wf-1", execId: "my-exec-1" });
        assert.equal(r.registered, true);
        assert.equal(r.execId, "my-exec-1");
    });

    it("rejects duplicate execId", () => {
        lineage.registerExecution({ workflowId: "wf-1", execId: "dup" });
        const r = lineage.registerExecution({ workflowId: "wf-2", execId: "dup" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "execId_already_registered");
    });

    it("links parent to child", () => {
        const p = lineage.registerExecution({ workflowId: "wf-p" });
        const c = lineage.registerExecution({ workflowId: "wf-c" });
        const r = lineage.linkParentChild({ parentId: p.execId, childId: c.execId });
        assert.equal(r.linked, true);
        assert.ok(r.linkId.startsWith("link-"));
    });

    it("rejects self-link", () => {
        const e = lineage.registerExecution({ workflowId: "wf-1" });
        const r = lineage.linkParentChild({ parentId: e.execId, childId: e.execId });
        assert.equal(r.linked, false);
        assert.equal(r.reason, "self_link_not_allowed");
    });

    it("rejects link for unregistered parent", () => {
        const c = lineage.registerExecution({ workflowId: "wf-c" });
        const r = lineage.linkParentChild({ parentId: "nobody", childId: c.execId });
        assert.equal(r.linked, false);
        assert.equal(r.reason, "parent_not_registered");
    });

    it("rejects link for unregistered child", () => {
        const p = lineage.registerExecution({ workflowId: "wf-p" });
        const r = lineage.linkParentChild({ parentId: p.execId, childId: "nobody" });
        assert.equal(r.linked, false);
        assert.equal(r.reason, "child_not_registered");
    });

    it("rejects re-linking a child that already has a parent", () => {
        const p1 = lineage.registerExecution({ workflowId: "wf-p1" });
        const p2 = lineage.registerExecution({ workflowId: "wf-p2" });
        const c  = lineage.registerExecution({ workflowId: "wf-c" });
        lineage.linkParentChild({ parentId: p1.execId, childId: c.execId });
        const r = lineage.linkParentChild({ parentId: p2.execId, childId: c.execId });
        assert.equal(r.linked, false);
        assert.equal(r.reason, "child_already_has_parent");
    });

    it("getLineage returns ancestors and descendants", () => {
        const gp = lineage.registerExecution({ workflowId: "wf-gp" });
        const p  = lineage.registerExecution({ workflowId: "wf-p"  });
        const c  = lineage.registerExecution({ workflowId: "wf-c"  });
        lineage.linkParentChild({ parentId: gp.execId, childId: p.execId });
        lineage.linkParentChild({ parentId: p.execId,  childId: c.execId });
        const r = lineage.getLineage(p.execId);
        assert.equal(r.found, true);
        assert.ok(r.ancestors.includes(gp.execId));
        assert.ok(r.descendants.includes(c.execId));
    });

    it("getLineage returns found=false for unknown execId", () => {
        const r = lineage.getLineage("nobody");
        assert.equal(r.found, false);
    });

    it("getLineage root has no ancestors", () => {
        const root = lineage.registerExecution({ workflowId: "wf-root" });
        const r    = lineage.getLineage(root.execId);
        assert.equal(r.ancestors.length, 0);
    });

    it("traceCausalChain returns full chain from root", () => {
        const a = lineage.registerExecution({ workflowId: "wf-a" });
        const b = lineage.registerExecution({ workflowId: "wf-b" });
        const c = lineage.registerExecution({ workflowId: "wf-c" });
        lineage.linkParentChild({ parentId: a.execId, childId: b.execId });
        lineage.linkParentChild({ parentId: b.execId, childId: c.execId });
        const r = lineage.traceCausalChain(c.execId);
        assert.equal(r.found, true);
        assert.equal(r.chain[0], a.execId);
        assert.equal(r.chain[r.chain.length - 1], c.execId);
        assert.equal(r.depth, 2);
    });

    it("traceCausalChain for root returns chain of length 1", () => {
        const root = lineage.registerExecution({ workflowId: "wf-root" });
        const r    = lineage.traceCausalChain(root.execId);
        assert.equal(r.chain.length, 1);
        assert.equal(r.depth, 0);
    });

    it("getLineageMetrics reports root and leaf counts", () => {
        const p = lineage.registerExecution({ workflowId: "wf-p" });
        const c = lineage.registerExecution({ workflowId: "wf-c" });
        lineage.linkParentChild({ parentId: p.execId, childId: c.execId });
        const m = lineage.getLineageMetrics();
        assert.equal(m.totalExecutions, 2);
        assert.equal(m.rootCount, 1);
        assert.equal(m.leafCount, 1);
        assert.equal(m.totalLinks, 1);
    });

    it("getLineageMetrics tracks maxDepth", () => {
        const a = lineage.registerExecution({ workflowId: "wf-a" });
        const b = lineage.registerExecution({ workflowId: "wf-b" });
        const c = lineage.registerExecution({ workflowId: "wf-c" });
        lineage.linkParentChild({ parentId: a.execId, childId: b.execId });
        lineage.linkParentChild({ parentId: b.execId, childId: c.execId });
        const m = lineage.getLineageMetrics();
        assert.equal(m.maxDepth, 2);
    });
});

// ── dependencyResolutionEngine (intelligence) ─────────────────────────
describe("dependencyResolutionEngine (intelligence)", () => {
    beforeEach(() => depEngine.reset());

    it("registers a dependency and returns depId", () => {
        const r = depEngine.registerDependency({ from: "A", to: "B" });
        assert.equal(r.registered, true);
        assert.ok(r.depId.startsWith("dep-"));
        assert.equal(r.from, "A");
        assert.equal(r.to, "B");
    });

    it("rejects dependency without from", () => {
        const r = depEngine.registerDependency({ to: "B" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "from_required");
    });

    it("rejects dependency without to", () => {
        const r = depEngine.registerDependency({ from: "A" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "to_required");
    });

    it("rejects self-dependency", () => {
        const r = depEngine.registerDependency({ from: "A", to: "A" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "self_dependency_not_allowed");
    });

    it("resolveDependencyOrder returns topological order", () => {
        // A depends on B, B depends on C → order: C, B, A
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "C" });
        const r = depEngine.resolveDependencyOrder(["A", "B", "C"]);
        assert.equal(r.resolved, true);
        assert.ok(r.order.indexOf("C") < r.order.indexOf("B"));
        assert.ok(r.order.indexOf("B") < r.order.indexOf("A"));
    });

    it("resolveDependencyOrder detects cycles", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "A" });
        const r = depEngine.resolveDependencyOrder(["A", "B"]);
        assert.equal(r.resolved, false);
        assert.ok(r.cycleCount > 0);
    });

    it("resolveDependencyOrder rejects empty nodeIds", () => {
        const r = depEngine.resolveDependencyOrder([]);
        assert.equal(r.resolved, false);
        assert.equal(r.reason, "no_nodes_provided");
    });

    it("resolveDependencyOrder handles independent nodes (no deps between them)", () => {
        depEngine.registerDependency({ from: "X", to: "Y" });
        const r = depEngine.resolveDependencyOrder(["A", "B"]);
        // A and B have no deps in the subgraph, both should appear in any order
        assert.equal(r.resolved, true);
        assert.equal(r.order.length, 2);
    });

    it("analyzeDependencyDepth returns depth for registered node", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "C" });
        const r = depEngine.analyzeDependencyDepth("A");
        assert.equal(r.found, true);
        assert.equal(r.nodeId, "A");
        assert.equal(r.depth, 2); // A → B → C
    });

    it("analyzeDependencyDepth returns 0 depth for node with no deps", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        const r = depEngine.analyzeDependencyDepth("B");
        assert.equal(r.depth, 0);
    });

    it("analyzeDependencyDepth returns dependents list", () => {
        depEngine.registerDependency({ from: "A", to: "B" }); // A depends on B
        depEngine.registerDependency({ from: "C", to: "B" }); // C depends on B
        const r = depEngine.analyzeDependencyDepth("B");
        // dependents of B = those that depend ON B (A and C)
        assert.ok(r.dependents.includes("A"));
        assert.ok(r.dependents.includes("C"));
    });

    it("analyzeDependencyDepth fails for unknown node", () => {
        const r = depEngine.analyzeDependencyDepth("nobody");
        assert.equal(r.found, false);
        assert.equal(r.reason, "node_not_registered");
    });

    it("validateDependencyGraph returns valid=true for acyclic graph", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "C" });
        const r = depEngine.validateDependencyGraph();
        assert.equal(r.valid, true);
        assert.equal(r.cycleCount, 0);
    });

    it("validateDependencyGraph detects cyclic graph", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "C" });
        depEngine.registerDependency({ from: "C", to: "A" });
        const r = depEngine.validateDependencyGraph();
        assert.equal(r.valid, false);
        assert.ok(r.cycleCount > 0);
    });

    it("getDependencyMetrics reports totals", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "C" });
        const m = depEngine.getDependencyMetrics();
        assert.equal(m.totalDependencies, 2);
        assert.equal(m.totalNodes, 3);
    });
});

// ── bottleneckAnalysisEngine ──────────────────────────────────────────
describe("bottleneckAnalysisEngine", () => {
    beforeEach(() => bottleneck.reset());

    it("registers execution metrics and returns metricId", () => {
        const r = bottleneck.registerExecutionMetrics({ workflowId: "wf-1", latencyMs: 200 });
        assert.equal(r.registered, true);
        assert.ok(r.metricId.startsWith("metric-"));
    });

    it("rejects metrics without workflowId", () => {
        const r = bottleneck.registerExecutionMetrics({ latencyMs: 200 });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("detectBottlenecks returns empty for no metrics", () => {
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottleneckCount, 0);
        assert.equal(r.bottlenecks.length, 0);
    });

    it("detectBottlenecks identifies latency bottleneck", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-slow", latencyMs: 2000 });
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottleneckCount, 1);
        assert.equal(r.bottlenecks[0].workflowId, "wf-slow");
    });

    it("detectBottlenecks identifies retry bottleneck", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-retry", retryCount: 10 });
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottleneckCount, 1);
    });

    it("detectBottlenecks identifies queue depth bottleneck", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-queue", queueDepth: 100 });
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottleneckCount, 1);
    });

    it("detectBottlenecks identifies error rate bottleneck", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-err", errorRate: 0.5 });
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottleneckCount, 1);
    });

    it("detectBottlenecks ignores healthy workflow", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-ok", latencyMs: 50, retryCount: 1, errorRate: 0.01 });
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottleneckCount, 0);
    });

    it("detectBottlenecks sorts by severity descending", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-bad",  latencyMs: 5000, retryCount: 20 });
        bottleneck.registerExecutionMetrics({ workflowId: "wf-mild", latencyMs: 1200 });
        const r = bottleneck.detectBottlenecks();
        assert.equal(r.bottlenecks[0].workflowId, "wf-bad");
    });

    it("detectBottlenecks returns up to 3 hotspots", () => {
        for (let i = 0; i < 5; i++)
            bottleneck.registerExecutionMetrics({ workflowId: `wf-${i}`, latencyMs: 2000 + i * 100 });
        const r = bottleneck.detectBottlenecks();
        assert.ok(r.hotspots.length <= 3);
    });

    it("analyzeCascadingFailure requires workflowId", () => {
        const r = bottleneck.analyzeCascadingFailure({});
        assert.equal(r.analyzed, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("analyzeCascadingFailure returns 0 affected with no dependency map", () => {
        const r = bottleneck.analyzeCascadingFailure({ workflowId: "wf-1" });
        assert.equal(r.analyzed, true);
        assert.equal(r.affectedCount, 0);
        assert.ok(r.failureId.startsWith("fail-"));
    });

    it("analyzeCascadingFailure propagates to direct dependents", () => {
        const r = bottleneck.analyzeCascadingFailure({
            workflowId: "wf-root",
            dependencyMap: { "wf-root": ["wf-child1", "wf-child2"] },
        });
        assert.equal(r.affectedCount, 2);
        assert.ok(r.affectedNodes.includes("wf-child1"));
    });

    it("analyzeCascadingFailure propagates multi-level cascade", () => {
        const r = bottleneck.analyzeCascadingFailure({
            workflowId: "root",
            dependencyMap: { root: ["a", "b"], a: ["c"], b: ["d"] },
        });
        assert.equal(r.affectedCount, 4);
        assert.equal(r.cascadeDepth, 2);
    });

    it("getHotspotReport returns up to 5 hotspots sorted by severity", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "wf-1", latencyMs: 5000 });
        bottleneck.registerExecutionMetrics({ workflowId: "wf-2", latencyMs: 200  });
        const r = bottleneck.getHotspotReport();
        assert.ok(r.hotspots.length <= 5);
        assert.equal(r.totalTracked, 2);
        assert.ok(r.thresholds != null);
    });

    it("BOTTLENECK_THRESHOLDS is exported", () => {
        assert.ok(bottleneck.BOTTLENECK_THRESHOLDS.latencyMs > 0);
    });
});

// ── systemicPressureAnalyzer ──────────────────────────────────────────
describe("systemicPressureAnalyzer", () => {
    beforeEach(() => pressure.reset());

    it("records a pressure reading and returns readingId", () => {
        const r = pressure.recordPressureReading({ score: 0.6, isolationDomain: "zone-a" });
        assert.equal(r.recorded, true);
        assert.ok(r.readingId.startsWith("reading-"));
    });

    it("rejects reading without score or pressureLevel", () => {
        const r = pressure.recordPressureReading({ isolationDomain: "zone-a" });
        assert.equal(r.recorded, false);
    });

    it("infers score from pressureLevel critical", () => {
        const r = pressure.recordPressureReading({ pressureLevel: "critical" });
        assert.equal(r.recorded, true);
        assert.ok(r.score >= 0.8);
    });

    it("infers score from pressureLevel low", () => {
        const r = pressure.recordPressureReading({ pressureLevel: "low" });
        assert.equal(r.recorded, true);
        assert.ok(r.score < 0.5);
    });

    it("analyzeSystemicPressure returns low for no readings", () => {
        const r = pressure.analyzeSystemicPressure();
        assert.equal(r.analyzed, true);
        assert.equal(r.overallPressure, "low");
        assert.equal(r.overallScore, 0);
    });

    it("analyzeSystemicPressure aggregates by domain", () => {
        pressure.recordPressureReading({ isolationDomain: "zone-a", score: 0.9 });
        pressure.recordPressureReading({ isolationDomain: "zone-b", score: 0.2 });
        const r = pressure.analyzeSystemicPressure();
        assert.ok(r.domains["zone-a"] != null);
        assert.ok(r.domains["zone-b"] != null);
        assert.equal(r.overallPressure, "critical");
    });

    it("analyzeSystemicPressure uses max domain score as overall", () => {
        pressure.recordPressureReading({ isolationDomain: "zone-a", score: 0.3 });
        pressure.recordPressureReading({ isolationDomain: "zone-b", score: 0.85 });
        const r = pressure.analyzeSystemicPressure();
        assert.ok(r.overallScore >= 0.85);
    });

    it("detectPressureCascade requires sourceDomain", () => {
        const r = pressure.detectPressureCascade({});
        assert.equal(r.detected, false);
        assert.equal(r.reason, "sourceDomain_required");
    });

    it("detectPressureCascade propagates to connected domains", () => {
        pressure.recordPressureReading({ isolationDomain: "zone-a", score: 0.9 });
        const r = pressure.detectPressureCascade({
            sourceDomain:     "zone-a",
            propagationFactor: 0.7,
            connectedDomains: ["zone-b", "zone-c"],
        });
        assert.equal(r.detected, true);
        assert.ok(r.cascadeId.startsWith("cascade-"));
        assert.ok(r.affectedDomains.length > 0);
    });

    it("detectPressureCascade does not affect domains when source score is zero", () => {
        const r = pressure.detectPressureCascade({
            sourceDomain:     "zone-x",
            connectedDomains: ["zone-y"],
        });
        assert.equal(r.detected, true);
        assert.equal(r.affectedDomains.length, 0);
    });

    it("detectPressureCascade excludes sourceDomain from affected", () => {
        pressure.recordPressureReading({ isolationDomain: "zone-a", score: 0.9 });
        const r = pressure.detectPressureCascade({
            sourceDomain:     "zone-a",
            connectedDomains: ["zone-a", "zone-b"],
        });
        assert.ok(!r.affectedDomains.some(d => d.domain === "zone-a"));
    });

    it("getPressureTimeline returns sorted readings", () => {
        pressure.recordPressureReading({ score: 0.3 });
        pressure.recordPressureReading({ score: 0.6 });
        const t = pressure.getPressureTimeline();
        assert.equal(t.totalReadings, 2);
        assert.ok(Array.isArray(t.readings));
    });

    it("getPressureTimeline detects rising trend", () => {
        for (let i = 0; i < 6; i++)
            pressure.recordPressureReading({ score: 0.1 + i * 0.15 });
        const t = pressure.getPressureTimeline();
        assert.equal(t.trend, "rising");
    });

    it("getPressureTimeline detects stable trend for equal scores", () => {
        for (let i = 0; i < 4; i++)
            pressure.recordPressureReading({ score: 0.4 });
        const t = pressure.getPressureTimeline();
        assert.equal(t.trend, "stable");
    });

    it("PRESSURE_LEVELS is exported with correct thresholds", () => {
        assert.equal(pressure.PRESSURE_LEVELS.critical, 0.8);
        assert.equal(pressure.PRESSURE_LEVELS.low, 0);
    });
});

// ── runtimeObservabilityHub ───────────────────────────────────────────
describe("runtimeObservabilityHub", () => {
    beforeEach(() => hub.reset());

    it("captureRuntimeSnapshot returns snapshotId", () => {
        const r = hub.captureRuntimeSnapshot({ label: "test-snap" });
        assert.equal(r.captured, true);
        assert.ok(r.snapshotId.startsWith("obs-"));
        assert.equal(r.label, "test-snap");
    });

    it("captureRuntimeSnapshot stores governance metrics", () => {
        hub.captureRuntimeSnapshot({
            governanceMetrics: { pressure: "high", admittedCount: 10 },
        });
        const report = hub.generateObservabilityReport();
        assert.equal(report.snapshotCount, 1);
        assert.ok(report.latestSnapshot.governanceMetrics != null);
    });

    it("correlateGovernanceMetrics returns correlationId", () => {
        const r = hub.correlateGovernanceMetrics({ pressureLevel: "low" });
        assert.equal(r.correlated, true);
        assert.ok(r.correlationId.startsWith("corr-"));
    });

    it("correlateGovernanceMetrics detects starvation_under_pressure", () => {
        const r = hub.correlateGovernanceMetrics({
            pressureLevel:  "high",
            fairnessMetrics: { starvationEvents: 3, compensatedCount: 0 },
        });
        assert.ok(r.correlations.some(c => c.type === "starvation_under_pressure"));
    });

    it("correlateGovernanceMetrics detects uncompensated_starvation", () => {
        const r = hub.correlateGovernanceMetrics({
            pressureLevel:  "low",
            fairnessMetrics: { starvationEvents: 2, compensatedCount: 0 },
        });
        assert.ok(r.correlations.some(c => c.type === "uncompensated_starvation"));
    });

    it("correlateGovernanceMetrics detects qos_violation_pattern", () => {
        const r = hub.correlateGovernanceMetrics({
            pressureLevel: "high",
            qosMetrics:    { totalViolations: 4, totalAssignments: 10 },
        });
        assert.ok(r.correlations.some(c => c.type === "qos_violation_pattern"));
    });

    it("correlateGovernanceMetrics detects under_throttling_under_pressure", () => {
        const r = hub.correlateGovernanceMetrics({
            pressureLevel: "critical",
            admissionState: { totalAdmitted: 10, totalRejected: 0 },
        });
        assert.ok(r.correlations.some(c => c.type === "under_throttling_under_pressure"));
    });

    it("traceExecutionPath requires workflowId", () => {
        const r = hub.traceExecutionPath({ events: [{ sequence: 1, type: "start" }] });
        assert.equal(r.traced, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("traceExecutionPath requires events", () => {
        const r = hub.traceExecutionPath({ workflowId: "wf-1", events: [] });
        assert.equal(r.traced, false);
        assert.equal(r.reason, "events_required");
    });

    it("traceExecutionPath sorts events by sequence", () => {
        const r = hub.traceExecutionPath({
            workflowId: "wf-1",
            events: [
                { sequence: 3, type: "complete" },
                { sequence: 1, type: "start"    },
                { sequence: 2, type: "running"  },
            ],
        });
        assert.equal(r.traced, true);
        assert.equal(r.path[0].sequence, 1);
        assert.equal(r.path[2].sequence, 3);
    });

    it("traceExecutionPath marks contiguous sequence as replayable", () => {
        const r = hub.traceExecutionPath({
            workflowId: "wf-1",
            events: [
                { sequence: 1, type: "start"   },
                { sequence: 2, type: "running" },
                { sequence: 3, type: "done"    },
            ],
        });
        assert.equal(r.isReplayable, true);
        assert.ok(r.pathId.startsWith("path-"));
    });

    it("traceExecutionPath marks sequence gap as not replayable", () => {
        const r = hub.traceExecutionPath({
            workflowId: "wf-1",
            events: [
                { sequence: 1, type: "start" },
                { sequence: 3, type: "done"  }, // gap at 2
            ],
        });
        assert.equal(r.isReplayable, false);
        assert.ok(r.issues.length > 0);
    });

    it("traceExecutionPath marks missing type as not replayable", () => {
        const r = hub.traceExecutionPath({
            workflowId: "wf-1",
            events: [{ sequence: 1 }],
        });
        assert.equal(r.isReplayable, false);
    });

    it("generateObservabilityReport aggregates all data", () => {
        hub.captureRuntimeSnapshot({ label: "snap1" });
        hub.captureRuntimeSnapshot({ label: "snap2" });
        hub.correlateGovernanceMetrics({ pressureLevel: "high", fairnessMetrics: { starvationEvents: 1, compensatedCount: 0 } });
        hub.traceExecutionPath({ workflowId: "wf-1", events: [{ sequence: 1, type: "start" }] });
        const r = hub.generateObservabilityReport();
        assert.equal(r.snapshotCount, 2);
        assert.equal(r.correlationCount, 1);
        assert.equal(r.pathCount, 1);
        assert.ok(r.keyInsights.length > 0);
    });

    it("generateObservabilityReport tracks replayable vs non-replayable paths", () => {
        hub.traceExecutionPath({ workflowId: "wf-good", events: [{ sequence: 1, type: "start" }, { sequence: 2, type: "done" }] });
        hub.traceExecutionPath({ workflowId: "wf-bad",  events: [{ sequence: 1, type: "start" }, { sequence: 3, type: "done" }] });
        const r = hub.generateObservabilityReport();
        assert.equal(r.replayablePaths, 1);
        assert.equal(r.nonReplayablePaths, 1);
    });
});

// ── end-to-end runtime intelligence simulation ────────────────────────
describe("end-to-end runtime intelligence simulation", () => {
    beforeEach(() => {
        topology.reset(); lineage.reset(); depEngine.reset();
        bottleneck.reset(); pressure.reset(); hub.reset();
    });

    it("builds a topology, traces lineage, and detects bottlenecks", () => {
        // Build topology
        const n1 = topology.createTopologyNode({ workflowId: "wf-root", isolationDomain: "primary" });
        const n2 = topology.createTopologyNode({ workflowId: "wf-child", isolationDomain: "primary" });
        topology.addTopologyEdge({ from: n1.nodeId, to: n2.nodeId });

        // Register executions and lineage
        const e1 = lineage.registerExecution({ workflowId: "wf-root",  execId: "e1" });
        const e2 = lineage.registerExecution({ workflowId: "wf-child", execId: "e2" });
        lineage.linkParentChild({ parentId: e1.execId, childId: e2.execId });

        // Register bottleneck metrics
        bottleneck.registerExecutionMetrics({ workflowId: "wf-child", latencyMs: 3000 });

        // Check
        const snap  = topology.getTopologySnapshot();
        const chain = lineage.traceCausalChain("e2");
        const bns   = bottleneck.detectBottlenecks();

        assert.equal(snap.nodeCount, 2);
        assert.equal(chain.depth, 1);
        assert.equal(bns.bottleneckCount, 1);
    });

    it("resolves dependency order and validates graph integrity", () => {
        depEngine.registerDependency({ from: "wf-c", to: "wf-b" });
        depEngine.registerDependency({ from: "wf-b", to: "wf-a" });

        const validation = depEngine.validateDependencyGraph();
        const order      = depEngine.resolveDependencyOrder(["wf-a", "wf-b", "wf-c"]);

        assert.equal(validation.valid, true);
        assert.equal(order.resolved, true);
        assert.ok(order.order.indexOf("wf-a") < order.order.indexOf("wf-b"));
        assert.ok(order.order.indexOf("wf-b") < order.order.indexOf("wf-c"));
    });

    it("detects cascading failure across dependency tree", () => {
        bottleneck.registerExecutionMetrics({ workflowId: "root", latencyMs: 5000 });
        const r = bottleneck.analyzeCascadingFailure({
            workflowId: "root",
            dependencyMap: { root: ["svc-a", "svc-b"], "svc-a": ["svc-c"] },
        });
        assert.equal(r.affectedCount, 3);
        assert.equal(r.cascadeDepth, 2);
    });

    it("records systemic pressure and detects cascade to connected domains", () => {
        pressure.recordPressureReading({ isolationDomain: "primary", score: 0.85 });
        const cascade = pressure.detectPressureCascade({
            sourceDomain:     "primary",
            propagationFactor: 0.8,
            connectedDomains: ["secondary", "tertiary"],
        });
        assert.equal(cascade.detected, true);
        assert.ok(cascade.affectedDomains.length >= 1);
    });

    it("governance correlation surfaces starvation and QoS violations together", () => {
        const r = hub.correlateGovernanceMetrics({
            pressureLevel:  "critical",
            fairnessMetrics: { starvationEvents: 5, compensatedCount: 1 },
            qosMetrics:      { totalViolations: 6, totalAssignments: 10 },
        });
        assert.ok(r.correlations.some(c => c.type === "starvation_under_pressure"));
        assert.ok(r.correlations.some(c => c.type === "qos_violation_pattern"));
    });

    it("full observability report after multi-module simulation", () => {
        hub.captureRuntimeSnapshot({
            topologyMetrics:  { nodeCount: 10, edgeCount: 12 },
            governanceMetrics: { pressure: "high" },
        });
        hub.correlateGovernanceMetrics({
            pressureLevel:  "high",
            fairnessMetrics: { starvationEvents: 2, compensatedCount: 2 },
        });
        hub.traceExecutionPath({
            workflowId: "wf-sim",
            events: [
                { sequence: 1, type: "admitted"  },
                { sequence: 2, type: "scheduled" },
                { sequence: 3, type: "executing" },
                { sequence: 4, type: "completed" },
            ],
        });

        const report = hub.generateObservabilityReport();
        assert.equal(report.snapshotCount, 1);
        assert.equal(report.pathCount, 1);
        assert.equal(report.replayablePaths, 1);
        assert.ok(report.generatedAt != null);
    });

    it("deterministic topology replay produces identical snapshot", () => {
        const n1 = topology.createTopologyNode({ workflowId: "wf-1" });
        const n2 = topology.createTopologyNode({ workflowId: "wf-2" });
        topology.addTopologyEdge({ from: n1.nodeId, to: n2.nodeId });

        const snap1 = topology.getTopologySnapshot();
        const snap2 = topology.getTopologySnapshot();

        // Structure is identical; only snapshotIds differ
        assert.equal(snap1.nodeCount, snap2.nodeCount);
        assert.equal(snap1.edgeCount, snap2.edgeCount);
        assert.notEqual(snap1.snapshotId, snap2.snapshotId);
    });

    it("cycle-safe dependency analysis blocks cycle registration from corrupting order", () => {
        depEngine.registerDependency({ from: "A", to: "B" });
        depEngine.registerDependency({ from: "B", to: "C" });
        depEngine.registerDependency({ from: "C", to: "A" }); // creates cycle

        const v = depEngine.validateDependencyGraph();
        const o = depEngine.resolveDependencyOrder(["A", "B", "C"]);

        assert.equal(v.valid, false);
        assert.equal(o.resolved, false);
    });
});
