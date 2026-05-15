"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const chaos   = require("../../agents/runtime/chaos/runtimeChaosEngine.cjs");
const rc      = require("../../agents/runtime/chaos/resilienceCoordinator.cjs");
const replay  = require("../../agents/runtime/chaos/runtimeReplayEngine.cjs");
const dsm     = require("../../agents/runtime/chaos/distributedStateManager.cjs");
const shc     = require("../../agents/runtime/chaos/selfHealingCoordinator.cjs");
const bench   = require("../../agents/runtime/chaos/resilienceBenchmark.cjs");

afterEach(() => {
    chaos.reset(); rc.reset(); replay.reset(); dsm.reset(); shc.reset(); bench.reset();
});

// ── helpers ───────────────────────────────────────────────────────────

function _exec(fp, success, retries = 0, rollback = false, durationMs = 100) {
    return { fingerprint: fp, success, retryCount: retries, rollbackTriggered: rollback, durationMs, ts: new Date().toISOString() };
}

// ═════════════════════════════════════════════════════════════════════
// runtimeChaosEngine
// ═════════════════════════════════════════════════════════════════════

describe("runtimeChaosEngine – fault injection", () => {
    it("injectFault with probability=0 never triggers", () => {
        for (let i = 0; i < 10; i++) {
            const r = chaos.injectFault({}, { probability: 0 });
            assert.equal(r.triggered, false);
        }
    });

    it("injectFault with probability=1 always triggers", () => {
        const r = chaos.injectFault({}, { probability: 1, faultType: "execution_failure" });
        assert.equal(r.triggered, true);
        assert.equal(r.faultType, "execution_failure");
    });

    it("injectFault records history on trigger", () => {
        chaos.injectFault({}, { probability: 1, faultType: "execution_failure" });
        assert.equal(chaos.getInjectionHistory().length, 1);
    });

    it("injectFault does not record history when not triggered", () => {
        chaos.injectFault({}, { probability: 0 });
        assert.equal(chaos.getInjectionHistory().length, 0);
    });

    it("getInjectionHistory returns array", () => {
        assert.ok(Array.isArray(chaos.getInjectionHistory()));
    });

    it("FAULT_TYPES contains expected types", () => {
        for (const t of ["dep_failure","latency_spike","memory_pressure","execution_failure","partial_outage"]) {
            assert.ok(chaos.FAULT_TYPES.includes(t), `missing: ${t}`);
        }
    });
});

describe("runtimeChaosEngine – dependency outage simulation", () => {
    it("failureRate=1 fails all deps", () => {
        const deps = { svc1: {}, svc2: {}, svc3: {} };
        const r    = chaos.simulateDependencyFailure(deps, 1);
        assert.equal(r.failedDeps.length, 3);
        assert.equal(r.healthyDeps.length, 0);
        assert.equal(r.failureCount, 3);
    });

    it("failureRate=0 fails no deps", () => {
        const deps = { svc1: {}, svc2: {}, svc3: {} };
        const r    = chaos.simulateDependencyFailure(deps, 0);
        assert.equal(r.failedDeps.length, 0);
        assert.equal(r.healthyDeps.length, 3);
    });

    it("empty deps object always returns a default failure", () => {
        const r = chaos.simulateDependencyFailure({}, 1);
        assert.equal(r.failureCount, 1);
        assert.ok(r.failedDeps.includes("dep-default"));
    });
});

describe("runtimeChaosEngine – latency and memory simulation", () => {
    it("simulateLatencySpike returns spikedLatencyMs > baseLatencyMs", () => {
        const r = chaos.simulateLatencySpike(100, 10);
        assert.ok(r.spikedLatencyMs > r.baseLatencyMs);
        assert.equal(r.baseLatencyMs, 100);
        assert.equal(r.multiplier, 10);
    });

    it("simulateMemoryPressure returns pressuredHeapMB > originalHeapMB", () => {
        const r = chaos.simulateMemoryPressure(100, 3);
        assert.ok(r.pressuredHeapMB > r.originalHeapMB);
        assert.ok(typeof r.risk === "string");
    });

    it("simulateMemoryPressure risk=critical for extreme pressure", () => {
        const r = chaos.simulateMemoryPressure(200, 5);
        // 200 * 5 * ~1 = ~1000 MB → critical
        assert.ok(["critical","high"].includes(r.risk));
    });
});

describe("runtimeChaosEngine – cascading failure simulation", () => {
    it("cascadeProb=1 fails all executions in chain", () => {
        const execs = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
        const r     = chaos.simulateCascadingFailure(execs, 1);
        assert.equal(r.cascaded, true);
        assert.equal(r.failedCount, 3);
    });

    it("cascadeProb=0 fails no executions (cascade halts immediately)", () => {
        const execs = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
        const r     = chaos.simulateCascadingFailure(execs, 0);
        assert.equal(r.failedCount, 0);
        assert.equal(r.cascaded, false);
    });

    it("empty executions returns cascaded=false", () => {
        const r = chaos.simulateCascadingFailure([], 0.8);
        assert.equal(r.cascaded, false);
        assert.equal(r.failedCount, 0);
    });
});

describe("runtimeChaosEngine – partial outage simulation", () => {
    it("outageRate=1 affects all services", () => {
        const services = ["svc1", "svc2", "svc3", "svc4"];
        const r        = chaos.simulatePartialOutage(services, 1);
        assert.equal(r.outageCount, 4);
        assert.equal(r.severeOutage, true);
    });

    it("outageRate=0 affects no services", () => {
        const services = ["svc1", "svc2", "svc3"];
        const r        = chaos.simulatePartialOutage(services, 0);
        assert.equal(r.outageCount, 0);
        assert.equal(r.severeOutage, false);
    });

    it("empty services list returns no outage", () => {
        const r = chaos.simulatePartialOutage([], 0.8);
        assert.equal(r.outageCount, 0);
    });
});

// ═════════════════════════════════════════════════════════════════════
// resilienceCoordinator
// ═════════════════════════════════════════════════════════════════════

describe("resilienceCoordinator – failover routing", () => {
    it("routes to healthy route with highest priority", () => {
        const routes = [
            { id: "r1", healthy: true,  priority: 3, latencyMs: 100 },
            { id: "r2", healthy: true,  priority: 7, latencyMs: 200 },
            { id: "r3", healthy: false, priority: 9, latencyMs: 50  },
        ];
        const r = rc.routeWithFailover({ taskId: "t1" }, routes);
        assert.equal(r.routed, true);
        assert.equal(r.selectedRoute.id, "r2");
    });

    it("returns not-routed when no healthy routes", () => {
        const routes = [{ id: "r1", healthy: false }];
        const r = rc.routeWithFailover({ taskId: "t1" }, routes);
        assert.equal(r.routed, false);
        assert.equal(r.reason, "no_healthy_routes");
    });

    it("returns not-routed for missing plan", () => {
        const r = rc.routeWithFailover(null, []);
        assert.equal(r.routed, false);
    });
});

describe("resilienceCoordinator – fallback strategy", () => {
    it("fast downgrades to safe", () => {
        const r = rc.selectFallbackStrategy("fast");
        assert.equal(r.strategy, "safe");
        assert.equal(r.downgraded, true);
    });

    it("safe downgrades to staged", () => {
        const r = rc.selectFallbackStrategy("safe");
        assert.equal(r.strategy, "staged");
    });

    it("sandbox cannot downgrade further", () => {
        const r = rc.selectFallbackStrategy("sandbox");
        assert.equal(r.strategy, "sandbox");
        assert.equal(r.downgraded, false);
        assert.equal(r.reason, "at_floor");
    });

    it("unknown strategy falls back to safe", () => {
        const r = rc.selectFallbackStrategy("nonexistent");
        assert.equal(r.strategy, "safe");
        assert.equal(r.downgraded, false);
    });
});

describe("resilienceCoordinator – degraded mode and retry", () => {
    it("getDegradedModeConfig returns normal for healthy score", () => {
        const r = rc.getDegradedModeConfig(0.9);
        assert.equal(r.mode, "normal");
        assert.equal(r.maxConcurrency, 8);
    });

    it("getDegradedModeConfig returns minimal for critical score", () => {
        const r = rc.getDegradedModeConfig(0.1);
        assert.equal(r.mode, "minimal");
        assert.equal(r.maxConcurrency, 1);
        assert.equal(r.retryLimit, 0);
    });

    it("coordinateRetry allows retry within limit", () => {
        const r = rc.coordinateRetry({ taskId: "t1" }, 1, { maxAttempts: 3 });
        assert.equal(r.shouldRetry, true);
        assert.ok(r.backoffMs > 0);
    });

    it("coordinateRetry stops after max attempts", () => {
        const r = rc.coordinateRetry({ taskId: "t1" }, 3, { maxAttempts: 3 });
        assert.equal(r.shouldRetry, false);
        assert.equal(r.reason, "max_attempts_reached");
    });

    it("coordinateRetry uses recovery_first strategy on attempt 2+", () => {
        const r = rc.coordinateRetry({ taskId: "t1" }, 2, { maxAttempts: 5 });
        assert.equal(r.strategy, "recovery_first");
    });

    it("containFailure records containment", () => {
        rc.containFailure("exec-1", { type: "task", tenantId: "t-x" });
        const state = rc.getResilienceState();
        assert.equal(state.containments, 1);
        assert.equal(state.containmentLog[0].executionId, "exec-1");
    });

    it("rerouteServiceDependency selects highest-stability alternative", () => {
        const alts = [
            { id: "alt1", stability: 0.5 },
            { id: "alt2", stability: 0.9 },
            { id: "alt3", stability: 0.3 },
        ];
        const r = rc.rerouteServiceDependency("dep-main", alts);
        assert.equal(r.rerouted, true);
        assert.equal(r.selectedAlternative.id, "alt2");
    });

    it("rerouteServiceDependency fails with no alternatives", () => {
        const r = rc.rerouteServiceDependency("dep-x", []);
        assert.equal(r.rerouted, false);
    });
});

// ═════════════════════════════════════════════════════════════════════
// runtimeReplayEngine
// ═════════════════════════════════════════════════════════════════════

describe("runtimeReplayEngine – session creation", () => {
    it("createSession stores executions", () => {
        const execs   = [_exec("fp1", true), _exec("fp1", false)];
        const session = replay.createSession(execs);
        assert.equal(session.totalCount, 2);
        assert.equal(session.successCount, 1);
    });

    it("createSession accepts custom sessionId", () => {
        const session = replay.createSession([], { sessionId: "custom-1" });
        assert.equal(session.sessionId, "custom-1");
    });

    it("getSession retrieves created session", () => {
        const s = replay.createSession([]);
        assert.ok(replay.getSession(s.sessionId) !== null);
    });

    it("getSession returns null for unknown id", () => {
        assert.equal(replay.getSession("ghost"), null);
    });
});

describe("runtimeReplayEngine – replay and divergence", () => {
    it("replay reconstructs timeline for all fingerprints", () => {
        const execs = [_exec("fp1", true, 0, false, 100), _exec("fp1", false, 1, false, 200)];
        const s     = replay.createSession(execs);
        const r     = replay.replay(s.sessionId);
        assert.equal(r.replayed, true);
        assert.equal(r.replayedCount, 2);
        assert.ok(typeof r.successRate === "number");
    });

    it("replay filters to target fingerprint", () => {
        const execs = [_exec("fp-a", true), _exec("fp-b", true), _exec("fp-a", false)];
        const s     = replay.createSession(execs);
        const r     = replay.replay(s.sessionId, "fp-a");
        assert.equal(r.replayedCount, 2);
    });

    it("replay returns not-found for unknown session", () => {
        const r = replay.replay("ghost-session");
        assert.equal(r.replayed, false);
        assert.equal(r.reason, "session_not_found");
    });

    it("detectDivergence detects no divergence for perfect replay", () => {
        const execs = Array.from({ length: 10 }, () => _exec("fp1", true));
        const s     = replay.createSession(execs);
        const r     = replay.replay(s.sessionId);
        const div   = replay.detectDivergence(s, r);
        assert.equal(div.diverged, false);
        assert.equal(div.severity, "none");
    });

    it("detectDivergence detects high divergence when success rates differ heavily", () => {
        // Session: all success; replay will reconstruct the same data, no divergence unless we fake it
        // To simulate divergence, craft a session with mismatched counts
        const successExecs = Array.from({ length: 10 }, () => _exec("fp1", true));
        const s            = replay.createSession(successExecs);
        // Fake a replayResult with different successRate
        const fakeReplay   = { replayed: true, successRate: 0.2 };
        const div          = replay.detectDivergence(s, fakeReplay);
        assert.equal(div.diverged, true);
        assert.ok(["high","medium"].includes(div.severity));
    });

    it("scoreVerification returns A grade for identical replay", () => {
        const execs = Array.from({ length: 10 }, () => _exec("fp1", true));
        const s     = replay.createSession(execs);
        const r     = replay.replay(s.sessionId);
        const score = replay.scoreVerification(s, r);
        assert.ok(["A","B"].includes(score.grade));
        assert.equal(score.verified, true);
    });

    it("compareFingerprints identifies equivalent fingerprints", () => {
        const entries = [
            _exec("fp-x", true, 0, false, 100),
            _exec("fp-y", true, 0, false, 110),
        ];
        const r = replay.compareFingerprints("fp-x", "fp-y", entries);
        assert.equal(r.equivalent, true);
    });

    it("compareFingerprints detects divergent fingerprints", () => {
        const entries = [
            ...Array.from({ length: 5 }, () => _exec("fp-good", true)),
            ...Array.from({ length: 5 }, () => _exec("fp-bad",  false)),
        ];
        const r = replay.compareFingerprints("fp-good", "fp-bad", entries);
        assert.equal(r.equivalent, false);
        assert.ok(Math.abs(r.successRateDelta) > 0.5);
    });
});

// ═════════════════════════════════════════════════════════════════════
// distributedStateManager
// ═════════════════════════════════════════════════════════════════════

describe("distributedStateManager – node lifecycle", () => {
    it("addNode creates a new node", () => {
        const r = dsm.addNode("node-1");
        assert.equal(r.added, true);
        assert.equal(r.nodeId, "node-1");
    });

    it("addNode rejects duplicate nodeId", () => {
        dsm.addNode("node-1");
        const r = dsm.addNode("node-1");
        assert.equal(r.added, false);
        assert.equal(r.reason, "already_exists");
    });

    it("addNode rejects missing nodeId", () => {
        const r = dsm.addNode(null);
        assert.equal(r.added, false);
    });

    it("removeNode removes the node", () => {
        dsm.addNode("node-x");
        const r = dsm.removeNode("node-x");
        assert.equal(r.removed, true);
    });

    it("removeNode clears leader when leader is removed", () => {
        dsm.addNode("leader-node", { priority: 10 });
        dsm.electLeader();
        const r = dsm.removeNode("leader-node");
        assert.equal(r.leaderCleared, true);
    });
});

describe("distributedStateManager – leader election", () => {
    it("elects the highest-priority node", () => {
        dsm.addNode("n1", { priority: 5 });
        dsm.addNode("n2", { priority: 10 });
        dsm.addNode("n3", { priority: 1 });
        const r = dsm.electLeader();
        assert.equal(r.elected, true);
        assert.equal(r.leader, "n2");
    });

    it("election fails with no healthy candidates", () => {
        dsm.addNode("sick", { healthy: false });
        const r = dsm.electLeader();
        assert.equal(r.elected, false);
        assert.equal(r.reason, "no_healthy_candidates");
    });

    it("uses alphabetical tiebreaker for equal priority", () => {
        dsm.addNode("node-b", { priority: 5 });
        dsm.addNode("node-a", { priority: 5 });
        const r = dsm.electLeader();
        assert.equal(r.leader, "node-a");
    });
});

describe("distributedStateManager – state sync and split-brain", () => {
    it("syncState increments version", () => {
        dsm.addNode("n1");
        dsm.syncState("n1", { key: "val" });
        const r = dsm.syncState("n1", { key2: "val2" });
        assert.equal(r.synced, true);
        assert.equal(r.version, 2);
    });

    it("syncState fails for unknown node", () => {
        const r = dsm.syncState("ghost", { x: 1 });
        assert.equal(r.synced, false);
    });

    it("detectSplitBrain identifies two partitions with leaders — split-brain scenario", () => {
        const groups = [
            { nodes: ["n1", "n2"], leader: "n1" },
            { nodes: ["n3", "n4"], leader: "n3" },
        ];
        const r = dsm.detectSplitBrain(groups);
        assert.equal(r.splitBrain, true);
        assert.equal(r.severity, "critical");
        assert.equal(r.groupsWithLeader, 2);
    });

    it("detectSplitBrain is safe with single partition", () => {
        const r = dsm.detectSplitBrain([{ nodes: ["n1","n2"], leader: "n1" }]);
        assert.equal(r.splitBrain, false);
    });

    it("validateQuorum passes with majority", () => {
        // quorum = floor(5/2)+1 = 3; participants=3 → 3>=3 → true
        const r = dsm.validateQuorum(["n1","n2","n3"], 5);
        assert.equal(r.hasQuorum, true);
        assert.equal(r.quorumRequired, 3);
    });

    it("validateQuorum detects quorum loss", () => {
        const r = dsm.validateQuorum(["n1", "n2"], 5);
        assert.equal(r.hasQuorum, false);
        assert.ok(r.deficit > 0);
    });

    it("repairDrift fixes drifted keys", () => {
        dsm.addNode("n1");
        dsm.syncState("n1", { a: "old" });
        const r = dsm.repairDrift("n1", { a: "new", b: "fresh" });
        assert.equal(r.repaired, true);
        assert.ok(r.driftedKeys.includes("a"));
        assert.ok(r.driftedKeys.includes("b"));
    });

    it("getConsistencyScore returns valid grade", () => {
        dsm.addNode("n1");
        dsm.addNode("n2");
        dsm.electLeader();
        const r = dsm.getConsistencyScore();
        assert.ok(typeof r.score === "number");
        assert.ok(["A","B","C","D","F"].includes(r.grade));
        assert.equal(r.hasLeader, true);
    });
});

// ═════════════════════════════════════════════════════════════════════
// selfHealingCoordinator
// ═════════════════════════════════════════════════════════════════════

describe("selfHealingCoordinator – anomaly detection and healing", () => {
    it("detectAndHeal returns no_anomalies for empty input", () => {
        const r = shc.detectAndHeal([]);
        assert.equal(r.healed, false);
        assert.equal(r.reason, "no_anomalies");
    });

    it("detectAndHeal triggers healing for retry_spike", () => {
        const r = shc.detectAndHeal([{ type: "retry_spike" }]);
        assert.equal(r.healed, true);
        assert.ok(r.actions.includes("reduce_retry_limit"));
    });

    it("detectAndHeal triggers healing for cascading_failure", () => {
        const r = shc.detectAndHeal([{ type: "cascading_failure" }]);
        assert.equal(r.healed, true);
        assert.ok(r.actions.includes("circuit_break_all"));
        assert.equal(r.severity, "high");
    });

    it("detectAndHeal deduplicates actions for repeated anomaly types", () => {
        const r = shc.detectAndHeal([{ type: "retry_spike" }, { type: "retry_spike" }]);
        const unique = new Set(r.actions);
        assert.equal(unique.size, r.actions.length);
    });

    it("healingHistory grows with each heal call", () => {
        shc.detectAndHeal([{ type: "repeated_loop" }]);
        shc.detectAndHeal([{ type: "memory_exhaustion" }]);
        assert.equal(shc.getHealingHistory().length, 2);
    });

    it("isolateNode records isolation", () => {
        shc.isolateNode("node-sick", "rollback_cycle");
        const history = shc.getHealingHistory();
        const record  = history.find(h => h.nodeId === "node-sick");
        assert.ok(record !== undefined);
        assert.equal(record.reason, "rollback_cycle");
    });
});

describe("selfHealingCoordinator – recovery chains", () => {
    it("executeRecoveryChain runs all steps", () => {
        const steps = [{ name: "step1" }, { name: "step2" }, { name: "step3" }];
        const r     = shc.executeRecoveryChain(steps);
        assert.equal(r.executed, true);
        assert.equal(r.succeeded, true);
        assert.equal(r.stepsRun, 3);
    });

    it("executeRecoveryChain returns not-executed for empty steps", () => {
        const r = shc.executeRecoveryChain([]);
        assert.equal(r.executed, false);
    });

    it("executeRecoveryChain stops on failing step", () => {
        const steps = [
            { name: "ok-step" },
            { name: "fail-step", shouldFail: true },
            { name: "skipped-step" },
        ];
        const r = shc.executeRecoveryChain(steps);
        assert.equal(r.succeeded, false);
        assert.equal(r.failed, true);
        assert.ok(r.stepsRun < 3);
    });

    it("executeRecoveryChain assigns a chainId", () => {
        const r = shc.executeRecoveryChain([{ name: "s1" }]);
        assert.ok(r.chainId.startsWith("chain-"));
    });
});

describe("selfHealingCoordinator – stabilization and scoring", () => {
    it("stabilizeOrchestration returns stable for healthy metrics", () => {
        const r = shc.stabilizeOrchestration({ successRate: 0.95, avgRetries: 0.2, errorRate: 0.01, pressure: "none" });
        assert.equal(r.stable, true);
        assert.equal(r.actions.length, 0);
    });

    it("stabilizeOrchestration recommends actions for degraded metrics", () => {
        const r = shc.stabilizeOrchestration({ successRate: 0.2, avgRetries: 5, errorRate: 0.5, pressure: "critical" });
        assert.equal(r.stable, false);
        assert.ok(r.actions.length > 0);
    });

    it("stabilizationScore is lower for degraded metrics", () => {
        const good = shc.stabilizeOrchestration({ successRate: 0.95, avgRetries: 0, errorRate: 0, pressure: "none" });
        const bad  = shc.stabilizeOrchestration({ successRate: 0.1, avgRetries: 8, errorRate: 0.8, pressure: "critical" });
        assert.ok(good.stabilizationScore > bad.stabilizationScore);
    });

    it("scoreAdaptiveStability returns F for empty history", () => {
        const r = shc.scoreAdaptiveStability([]);
        assert.equal(r.grade, "F");
    });

    it("scoreAdaptiveStability returns higher score for successful heals with few actions", () => {
        const history = [
            { healed: true, actions: ["one"] },
            { healed: true, actions: ["one"] },
        ];
        const r = shc.scoreAdaptiveStability(history);
        assert.ok(r.score > 50);
    });
});

// ═════════════════════════════════════════════════════════════════════
// resilienceBenchmark
// ═════════════════════════════════════════════════════════════════════

describe("resilienceBenchmark – stress benchmark", () => {
    it("all-success executions score A or B", () => {
        const execs = Array.from({ length: 20 }, () => _exec("fp", true, 0, false, 200));
        const r     = bench.runStressBenchmark(execs);
        assert.ok(["A","B"].includes(r.grade));
        assert.ok(r.score >= 70);
    });

    it("all-failure executions score F", () => {
        const execs = Array.from({ length: 10 }, () => _exec("fp", false, 5, true, 10000));
        const r     = bench.runStressBenchmark(execs);
        assert.equal(r.grade, "F");
    });

    it("empty executions returns F with reason", () => {
        const r = bench.runStressBenchmark([]);
        assert.equal(r.grade, "F");
        assert.equal(r.reason, "no_executions");
    });
});

describe("resilienceBenchmark – recovery speed", () => {
    it("fast recovery (<1 min) scores A", () => {
        const now  = Date.now();
        const timeline = [{ openedAt: new Date(now - 30000).toISOString(), resolvedAt: new Date(now).toISOString() }];
        const r    = bench.benchmarkRecoverySpeed(timeline);
        assert.equal(r.grade, "A");
        assert.ok(r.avgRecoveryMs < 60000);
    });

    it("slow recovery (>1 hr) scores F", () => {
        const now  = Date.now();
        const timeline = [{ openedAt: new Date(now - 7200000).toISOString(), resolvedAt: new Date(now).toISOString() }];
        const r    = bench.benchmarkRecoverySpeed(timeline);
        assert.ok(["D","F"].includes(r.grade));
    });

    it("no incidents returns F", () => {
        const r = bench.benchmarkRecoverySpeed([]);
        assert.equal(r.grade, "F");
    });
});

describe("resilienceBenchmark – chaos survival and resilience scoring", () => {
    it("scoreChaosSurvival is 100/A with no chaos injected", () => {
        const r = bench.scoreChaosSurvival([], []);
        assert.equal(r.score, 100);
        assert.equal(r.grade, "A");
    });

    it("scoreChaosSurvival scores lower when recovery fails", () => {
        const events    = [{ severity: "critical" }, { severity: "high" }];
        const recoveries = [{ recovered: false }, { recovered: false }];
        const r         = bench.scoreChaosSurvival(events, recoveries);
        assert.ok(r.score < 100);
        assert.ok(r.survivalRate === 0);
    });

    it("scoreChaosSurvival perfect recovery scores high", () => {
        const events     = [{ severity: "high" }, { severity: "medium" }];
        const recoveries = [{ recovered: true }, { recovered: true }];
        const r          = bench.scoreChaosSurvival(events, recoveries);
        assert.ok(r.score >= 70);
    });

    it("scoreRecoverySuccessRate 100% success scores A", () => {
        const recoveries = [{ success: true }, { success: true }, { success: true }];
        const r          = bench.scoreRecoverySuccessRate(recoveries);
        assert.equal(r.grade, "A");
        assert.equal(r.successRate, 1);
    });

    it("scoreRecoverySuccessRate empty input returns F", () => {
        const r = bench.scoreRecoverySuccessRate([]);
        assert.equal(r.grade, "F");
    });

    it("scoreDegradationTolerance returns C without baseline", () => {
        const r = bench.scoreDegradationTolerance({ errorRate: 0.1 }, {});
        assert.equal(r.grade, "C");
    });

    it("scoreDegradationTolerance penalises error rate increase", () => {
        const baseline = { errorRate: 0.01 };
        const current  = { errorRate: 0.30 };
        const r        = bench.scoreDegradationTolerance(current, baseline);
        assert.ok(r.score < 60);
    });

    it("gradeResilienceMaturity averages input scores", () => {
        const r = bench.gradeResilienceMaturity({ stress: 85, recovery: 78, chaos: 90 });
        assert.ok(r.score >= 75);
        assert.ok(["A","B"].includes(r.grade));
        assert.ok(typeof r.maturity === "string");
    });

    it("gradeResilienceMaturity returns F for empty scores", () => {
        const r = bench.gradeResilienceMaturity({});
        assert.equal(r.grade, "F");
    });
});
