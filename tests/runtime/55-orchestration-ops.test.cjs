"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ec  = require("../../agents/runtime/orchestration/executionCoordinator.cjs");
const rb  = require("../../agents/runtime/orchestration/resourceBalancer.cjs");
const ip  = require("../../agents/runtime/orchestration/isolationPolicy.cjs");
const dor = require("../../agents/runtime/orchestration/dependencyOrchestrator.cjs");
const om  = require("../../agents/runtime/orchestration/orchestrationMemory.cjs");
const oa  = require("../../agents/runtime/orchestration/orchestrationAdvisor.cjs");
const tele = require("../../agents/runtime/orchestration/orchestrationTelemetry.cjs");

afterEach(() => { rb.reset(); ip.reset(); om.reset(); tele.reset(); });

// ── helpers ───────────────────────────────────────────────────────────

function _plan(id, deps = []) {
    return { taskId: id, deps, executionOrder: ["a"], steps: [{ id: "a", command: "echo a" }] };
}

function _metricsEntry(overrides = {}) {
    return {
        heapUsedBytes: 100 * 1024 * 1024,
        cpuUserMs:     10,
        stepsSpawned:  2,
        queueDepth:    0,
        retryCount:    0,
        success:       true,
        fingerprint:   "fp-test",
        ts:            new Date().toISOString(),
        ...overrides,
    };
}

// ── executionCoordinator ──────────────────────────────────────────────

describe("executionCoordinator – coordinate", () => {
    it("normal flow returns state sandboxed for dangerous plan", () => {
        const r = ec.coordinate(_plan("t1"), { classification: "dangerous" });
        assert.equal(r.state, "sandboxed");
    });

    it("safe plan transitions to running state", () => {
        const r = ec.coordinate(_plan("t1"), { classification: "safe" });
        assert.ok(["running","staged","sandboxed"].includes(r.state));
    });

    it("throttled option transitions to throttled state", () => {
        const r = ec.coordinate(_plan("t1"), { throttled: true, throttleReason: "cpu_pressure" });
        assert.equal(r.state, "throttled");
    });

    it("isolated option transitions to isolated state", () => {
        const r = ec.coordinate(_plan("t1"), { isolated: true, isolationReason: "quarantined" });
        assert.equal(r.state, "isolated");
    });

    it("result includes strategy", () => {
        const r = ec.coordinate(_plan("t1"), { classification: "safe" });
        assert.ok("strategy" in r);
    });

    it("emits scheduling_decision telemetry for normal execution", () => {
        ec.coordinate(_plan("t1"), { classification: "safe" });
        assert.ok(tele.getLog().some(e => e.event === "scheduling_decision"));
    });

    it("emits throttling_event when throttled", () => {
        ec.coordinate(_plan("t1"), { throttled: true, throttleReason: "x" });
        assert.ok(tele.getLog().some(e => e.event === "throttling_event"));
    });
});

describe("executionCoordinator – sequence", () => {
    it("returns plans in topological order", () => {
        const plans = [
            _plan("b", ["a"]),
            _plan("a", []),
        ];
        const r = ec.sequence(plans);
        const ids = r.map(p => p.taskId);
        assert.ok(ids.indexOf("a") < ids.indexOf("b"));
    });

    it("no deps → stable alphabetical order", () => {
        const plans = [_plan("c"), _plan("a"), _plan("b")];
        const ids   = ec.sequence(plans).map(p => p.taskId);
        assert.deepEqual(ids, ["a","b","c"]);
    });

    it("returns all plans even with cycle (deadlock guard)", () => {
        const plans = [_plan("x", ["y"]), _plan("y", ["x"])];
        assert.equal(ec.sequence(plans).length, 2);
    });
});

describe("executionCoordinator – getParallelGroups", () => {
    it("independent plans form one group", () => {
        const plans = [_plan("a"), _plan("b"), _plan("c")];
        const groups = ec.getParallelGroups(plans);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].length, 3);
    });

    it("dep creates two groups", () => {
        const plans = [_plan("a"), _plan("b", ["a"])];
        const groups = ec.getParallelGroups(plans);
        assert.equal(groups.length, 2);
    });

    it("each group is an array", () => {
        const groups = ec.getParallelGroups([_plan("a")]);
        assert.ok(Array.isArray(groups[0]));
    });
});

describe("executionCoordinator – routeExecution", () => {
    it("normal safe plan routes to direct", () => {
        const r = ec.routeExecution(_plan("t"), { classification: "safe" });
        assert.equal(r.route, "direct");
    });

    it("dangerous classification routes to sandbox", () => {
        const r = ec.routeExecution(_plan("t"), { classification: "dangerous" });
        assert.equal(r.route, "sandbox");
    });

    it("destructive classification routes to sandbox", () => {
        const r = ec.routeExecution(_plan("t"), { classification: "destructive" });
        assert.equal(r.route, "sandbox");
    });

    it("circuit open blocks execution", () => {
        const r = ec.routeExecution(_plan("t"), { circuitOpen: true });
        assert.equal(r.route, "blocked");
        assert.equal(r.strategy, null);
    });

    it("quarantined routes to quarantine", () => {
        const r = ec.routeExecution(_plan("t"), { quarantined: true });
        assert.equal(r.route, "quarantine");
    });

    it("elevated with rollbackReady routes to staged", () => {
        const r = ec.routeExecution(_plan("t"), { classification: "elevated", rollbackReady: true });
        assert.equal(r.route, "staged");
    });
});

// ── resourceBalancer ──────────────────────────────────────────────────

describe("resourceBalancer – getStatus", () => {
    it("pressure is none for empty window", () => {
        assert.equal(rb.getStatus().pressure, "none");
    });

    it("normal metrics have no pressure", () => {
        rb.record(_metricsEntry());
        assert.equal(rb.getStatus().pressure, "none");
    });

    it("high heap produces high or critical pressure", () => {
        rb.record(_metricsEntry({ heapUsedBytes: 500 * 1024 * 1024 }));
        const { pressure } = rb.getStatus();
        assert.ok(["high","critical"].includes(pressure), `unexpected: ${pressure}`);
    });

    it("status includes heapMB, avgCpuUserMs, totalProcesses", () => {
        rb.record(_metricsEntry());
        const s = rb.getStatus();
        assert.ok("heapMB"         in s);
        assert.ok("avgCpuUserMs"   in s);
        assert.ok("totalProcesses" in s);
    });
});

describe("resourceBalancer – shouldThrottle", () => {
    it("no throttle for clean metrics", () => {
        rb.record(_metricsEntry());
        assert.ok(!rb.shouldThrottle().throttle);
    });

    it("throttles under high pressure", () => {
        // heap > threshold (score+3) + high retry rate (score+2) → "high" pressure
        for (let i = 0; i < 5; i++) {
            rb.record(_metricsEntry({ heapUsedBytes: 600 * 1024 * 1024, retryCount: 2 }));
        }
        const r = rb.shouldThrottle();
        assert.ok(r.throttle);
    });
});

describe("resourceBalancer – rebalance", () => {
    it("balanced:true for clean metrics", () => {
        rb.record(_metricsEntry());
        assert.ok(rb.rebalance().balanced);
    });

    it("returns actions for overloaded state", () => {
        for (let i = 0; i < 5; i++) {
            rb.record(_metricsEntry({
                heapUsedBytes: 500 * 1024 * 1024,
                retryCount:    5,
                stepsSpawned:  10,
            }));
        }
        const r = rb.rebalance();
        assert.ok(Array.isArray(r.actions));
        assert.ok(r.actions.length > 0);
    });
});

// ── isolationPolicy ───────────────────────────────────────────────────

describe("isolationPolicy – getPolicy", () => {
    it("safe classification → level none", () => {
        assert.equal(ip.getPolicy("safe").level, "none");
    });

    it("dangerous → sandboxRequired true", () => {
        assert.ok(ip.getPolicy("dangerous").sandboxRequired);
    });

    it("destructive → isolated level", () => {
        assert.equal(ip.getPolicy("destructive").level, "isolated");
    });

    it("quarantined fingerprint → quarantine level", () => {
        ip.quarantine("fp-quar", "test");
        const r = ip.getPolicy("safe", { fingerprint: "fp-quar" });
        assert.equal(r.level, "quarantine");
        assert.ok(r.quarantined);
    });
});

describe("isolationPolicy – shouldEscalateToSandbox", () => {
    it("returns false for single entry", () => {
        assert.ok(!ip.shouldEscalateToSandbox("fp", [{ fingerprint: "fp", success: false }]));
    });

    it("returns true when failure rate > 50%", () => {
        const entries = [
            { fingerprint: "fp", success: false, rollbackTriggered: false },
            { fingerprint: "fp", success: false, rollbackTriggered: false },
            { fingerprint: "fp", success: true,  rollbackTriggered: false },
        ];
        assert.ok(ip.shouldEscalateToSandbox("fp", entries));
    });
});

describe("isolationPolicy – quarantine", () => {
    it("quarantine marks fingerprint", () => {
        ip.quarantine("fp-q", "repeated_failure");
        assert.ok(ip.isQuarantined("fp-q"));
    });

    it("liftQuarantine removes it", () => {
        ip.quarantine("fp-q2", "x");
        ip.liftQuarantine("fp-q2");
        assert.ok(!ip.isQuarantined("fp-q2"));
    });

    it("getQuarantined lists all", () => {
        ip.quarantine("fp-a", "reason-a");
        ip.quarantine("fp-b", "reason-b");
        const list = ip.getQuarantined();
        assert.ok(list.some(x => x.fingerprint === "fp-a"));
        assert.ok(list.some(x => x.fingerprint === "fp-b"));
    });
});

describe("isolationPolicy – elevatePrivilege", () => {
    it("elevates from none to monitored by default", () => {
        const r = ip.elevatePrivilege("fp-e");
        assert.ok(r.elevated);
        assert.equal(r.privilegeLevel, "monitored");
    });

    it("returns elevated:false when already at target level", () => {
        ip.elevatePrivilege("fp-e2", { targetLevel: "sandboxed" });
        const r = ip.elevatePrivilege("fp-e2", { targetLevel: "sandboxed" });
        assert.ok(!r.elevated);
    });

    it("getPrivilegeLevel returns current level", () => {
        ip.elevatePrivilege("fp-e3", { targetLevel: "isolated" });
        assert.equal(ip.getPrivilegeLevel("fp-e3"), "isolated");
    });
});

// ── dependencyOrchestrator ────────────────────────────────────────────

describe("dependencyOrchestrator – mapDependencies", () => {
    it("returns graph keyed by taskId", () => {
        const plans = [_plan("a"), _plan("b", ["a"])];
        const g = dor.mapDependencies(plans);
        assert.ok("a" in g);
        assert.ok("b" in g);
    });

    it("includes deps array", () => {
        const plans = [_plan("c", ["a", "b"])];
        const g = dor.mapDependencies(plans);
        assert.deepEqual(g["c"].deps, ["a", "b"]);
    });
});

describe("dependencyOrchestrator – identifyUnstableChains", () => {
    it("returns empty when all deps are stable", () => {
        const plans = [_plan("a", ["dep-x"])];
        const depStab = { "dep-x": { stability: 0.95 } };
        assert.equal(dor.identifyUnstableChains(plans, depStab).length, 0);
    });

    it("flags plan with unstable dep", () => {
        const plans = [{ taskId: "plan-a", deps: ["dep-bad"], executionOrder: [] }];
        const depStab = { "dep-bad": { stability: 0.3 } };
        const r = dor.identifyUnstableChains(plans, depStab);
        assert.ok(r.some(x => x.planId === "plan-a"));
    });
});

describe("dependencyOrchestrator – rerouteAroundDegraded", () => {
    it("keeps stable steps", () => {
        const plan = {
            taskId: "t", steps: [
                { id: "good", command: "echo" },
                { id: "bad",  command: "echo" },
            ]
        };
        const depStab = { "bad": { stability: 0.2 } };
        const r = dor.rerouteAroundDegraded(plan, depStab, 0.5);
        assert.ok(r.changed);
        assert.equal(r.skippedSteps.length, 1);
        assert.equal(r.skippedSteps[0].stepId, "bad");
    });

    it("changed:false when no steps degraded", () => {
        const plan = { taskId: "t", steps: [{ id: "good", command: "echo" }] };
        const r = dor.rerouteAroundDegraded(plan, { "good": { stability: 0.9 } }, 0.5);
        assert.ok(!r.changed);
    });
});

describe("dependencyOrchestrator – prioritizeStablePaths", () => {
    it("stable plans appear first", () => {
        const plans = [
            { taskId: "unstable", deps: ["dep-bad"] },
            { taskId: "stable",   deps: ["dep-good"] },
        ];
        const depStab = { "dep-bad": { stability: 0.2 }, "dep-good": { stability: 1.0 } };
        const r = dor.prioritizeStablePaths(plans, depStab);
        assert.equal(r[0].taskId, "stable");
    });
});

describe("dependencyOrchestrator – resolve", () => {
    it("stable when no dep info provided", () => {
        const r = dor.resolve("fp", {});
        assert.ok(r.stable);
        assert.equal(r.recommendation, "proceed");
    });

    it("reroute recommended when deps degraded", () => {
        const r = dor.resolve("fp", { "dep-a": { stability: 0.4 } });
        assert.equal(r.recommendation, "reroute");
        assert.ok(r.degradedDeps.length > 0);
    });

    it("includes avgStability", () => {
        const r = dor.resolve("fp", { "dep-a": { stability: 0.9 } });
        assert.ok(typeof r.avgStability === "number");
    });
});

// ── orchestrationMemory ───────────────────────────────────────────────

describe("orchestrationMemory – unstable workflows", () => {
    it("recordUnstable marks fingerprint", () => {
        om.recordUnstable("fp1", "rollback_cycle");
        assert.ok(om.isUnstable("fp1"));
    });

    it("clearUnstable removes it", () => {
        om.recordUnstable("fp2", "x");
        om.clearUnstable("fp2");
        assert.ok(!om.isUnstable("fp2"));
    });

    it("getUnstable lists all flagged", () => {
        om.recordUnstable("fp3", "a");
        om.recordUnstable("fp4", "b");
        const r = om.getUnstable();
        assert.ok(r.some(x => x.fingerprint === "fp3"));
    });

    it("count increments on repeated record", () => {
        om.recordUnstable("fp5", "x");
        om.recordUnstable("fp5", "x");
        const list = om.getUnstable();
        assert.equal(list.find(x => x.fingerprint === "fp5").count, 2);
    });
});

describe("orchestrationMemory – trusted paths", () => {
    it("getTrustedPath returns null for unknown fingerprint", () => {
        assert.equal(om.getTrustedPath("fp-unknown"), null);
    });

    it("recordTrustedPath stores path", () => {
        om.recordTrustedPath("fp6", "safe", 200);
        const r = om.getTrustedPath("fp6");
        assert.equal(r.strategy, "safe");
        assert.ok(r.successCount >= 1);
    });

    it("getAllTrustedPaths returns all", () => {
        om.recordTrustedPath("fp7", "fast");
        om.recordTrustedPath("fp8", "staged");
        assert.ok(om.getAllTrustedPaths().length >= 2);
    });
});

describe("orchestrationMemory – overload patterns", () => {
    it("recordOverloadPattern stores pattern", () => {
        om.recordOverloadPattern({ type: "heap_spike", heapMB: 500 });
        const r = om.getOverloadPatterns();
        assert.ok(r.some(p => p.type === "heap_spike"));
    });

    it("recordedAt is set on each entry", () => {
        om.recordOverloadPattern({ type: "test" });
        assert.ok("recordedAt" in om.getOverloadPatterns()[0]);
    });
});

describe("orchestrationMemory – stable routes", () => {
    it("getStableRoute returns null for unknown key", () => {
        assert.equal(om.getStableRoute("unknown-route"), null);
    });

    it("recordStableRoute stores route", () => {
        om.recordStableRoute("route-a", 0.9);
        const r = om.getStableRoute("route-a");
        assert.equal(r.quality, 0.9);
    });

    it("uses increments on repeat", () => {
        om.recordStableRoute("route-b", 0.8);
        om.recordStableRoute("route-b", 0.8);
        assert.equal(om.getStableRoute("route-b").uses, 2);
    });
});

describe("orchestrationMemory – recovery patterns", () => {
    it("getRecoveryPatterns returns empty for unknown fingerprint", () => {
        assert.equal(om.getRecoveryPatterns("fp-unknown").length, 0);
    });

    it("recordRecoveryPattern stores pattern", () => {
        om.recordRecoveryPattern("fp9", { strategy: "staged", success: true });
        assert.equal(om.getRecoveryPatterns("fp9").length, 1);
    });

    it("getBestRecoveryPattern returns last successful", () => {
        om.recordRecoveryPattern("fp10", { strategy: "safe",   success: false });
        om.recordRecoveryPattern("fp10", { strategy: "staged", success: true  });
        const best = om.getBestRecoveryPattern("fp10");
        assert.equal(best.strategy, "staged");
    });
});

// ── orchestrationAdvisor ──────────────────────────────────────────────

describe("orchestrationAdvisor – suggestQueueOptimization", () => {
    it("returns empty for small queue", () => {
        assert.equal(oa.suggestQueueOptimization([]).length, 0);
    });

    it("suggests optimization for large queue", () => {
        const queue = Array.from({ length: 25 }, (_, i) => ({
            taskId: `t${i}`, priority: 30, enqueuedAt: Date.now(),
        }));
        const r = oa.suggestQueueOptimization(queue);
        assert.ok(r.some(x => x.type === "queue_optimization"));
    });
});

describe("orchestrationAdvisor – suggestConcurrencyTuning", () => {
    it("reduces concurrency for high pressure", () => {
        const r = oa.suggestConcurrencyTuning({ pressure: "high" });
        assert.ok(r.some(x => x.action === "reduce_concurrency"));
    });

    it("increases concurrency for no pressure with deep queue", () => {
        const r = oa.suggestConcurrencyTuning({ pressure: "none", avgQueueDepth: 10 });
        assert.ok(r.some(x => x.action === "increase_concurrency"));
    });

    it("no tuning needed for none pressure and shallow queue", () => {
        const r = oa.suggestConcurrencyTuning({ pressure: "none", avgQueueDepth: 0 });
        assert.equal(r.length, 0);
    });
});

describe("orchestrationAdvisor – suggestIsolation", () => {
    it("returns empty when no open breakers", () => {
        assert.equal(oa.suggestIsolation([], [], []).length, 0);
    });

    it("suggests isolation for open breakers", () => {
        const breakers = [{ fingerprint: "fp1", consecutiveFails: 3, failures: 3 }];
        const r = oa.suggestIsolation(breakers, [], []);
        assert.ok(r.some(x => x.type === "isolation_recommendation" && x.fingerprint === "fp1"));
    });

    it("suggests isolation for rollback_cycle anomaly", () => {
        const anomalies = [{ type: "rollback_cycle", fingerprint: "fp2" }];
        const r = oa.suggestIsolation([], [], anomalies);
        assert.ok(r.some(x => x.type === "isolation_recommendation"));
    });
});

describe("orchestrationAdvisor – suggestDepRerouting", () => {
    it("returns empty for no unstable chains", () => {
        assert.equal(oa.suggestDepRerouting([], {}).length, 0);
    });

    it("generates rerouting suggestion for unstable chain", () => {
        const chains = [{ planId: "plan-x", unstableDeps: ["dep-bad"], avgStability: 0.3 }];
        const r = oa.suggestDepRerouting(chains, {});
        assert.ok(r.some(x => x.type === "dep_rerouting" && x.planId === "plan-x"));
    });

    it("high priority when stability < 0.4", () => {
        const chains = [{ planId: "p", unstableDeps: ["d"], avgStability: 0.2 }];
        const r = oa.suggestDepRerouting(chains, {});
        assert.equal(r[0].priority, "high");
    });
});

describe("orchestrationAdvisor – suggestOverloadPrevention", () => {
    it("returns empty when no rebalance actions", () => {
        assert.equal(oa.suggestOverloadPrevention({}, []).length, 0);
    });

    it("generates prevention advice per action", () => {
        const actions = [
            { action: "reduce_concurrency", reason: "heap_pressure", severity: "high" },
            { action: "drain_queue",        reason: "queue_congestion", severity: "medium" },
        ];
        const r = oa.suggestOverloadPrevention({}, actions);
        assert.equal(r.length, 2);
        assert.ok(r.some(x => x.action === "reduce_concurrency"));
    });
});

describe("orchestrationAdvisor – generate", () => {
    it("returns recommendations, count, highPriority, ts", () => {
        const r = oa.generate({});
        assert.ok("recommendations" in r);
        assert.ok("count"           in r);
        assert.ok("highPriority"    in r);
        assert.ok("ts"              in r);
    });

    it("empty context produces no recommendations", () => {
        assert.equal(oa.generate({}).count, 0);
    });

    it("high priority items sorted first", () => {
        const r = oa.generate({
            openBreakers:   [{ fingerprint: "fp", consecutiveFails: 3, failures: 3 }],
            rebalanceActions: [{ action: "reduce_concurrency", reason: "heap", severity: "high" }],
        });
        if (r.count > 1) {
            const ORDER = { high: 0, medium: 1, low: 2 };
            for (let i = 0; i < r.recommendations.length - 1; i++) {
                assert.ok(
                    (ORDER[r.recommendations[i].priority] ?? 2) <=
                    (ORDER[r.recommendations[i + 1].priority] ?? 2)
                );
            }
        }
    });
});
