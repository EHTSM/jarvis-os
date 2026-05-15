"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const mem   = require("../../agents/runtime/intelligence/orchestrationMemory.cjs");
const route = require("../../agents/runtime/intelligence/adaptiveRoutingEngine.cjs");
const pred  = require("../../agents/runtime/intelligence/predictiveFailureEngine.cjs");
const opt   = require("../../agents/runtime/intelligence/optimizationCoordinator.cjs");
const evo   = require("../../agents/runtime/intelligence/strategyEvolutionEngine.cjs");
const bench = require("../../agents/runtime/intelligence/intelligenceBenchmark.cjs");

afterEach(() => {
    mem.reset();
    route.reset();
    pred.reset();
    opt.reset();
    evo.reset();
    bench.reset();
});

// ═══════════════════════════════════════════════════════════════════════
// orchestrationMemory
// ═══════════════════════════════════════════════════════════════════════

describe("orchestrationMemory — recordExecution", () => {
    it("records a successful execution", () => {
        const r = mem.recordExecution({ executionId: "e1", strategy: "fast", fingerprint: "fp1", success: true });
        assert.equal(r.recorded, true);
        assert.equal(r.executionId, "e1");
    });

    it("auto-generates executionId when missing", () => {
        const r = mem.recordExecution({ strategy: "safe" });
        assert.ok(r.executionId.startsWith("exec-"));
    });

    it("records a failed execution", () => {
        mem.recordExecution({ executionId: "e1", strategy: "staged", success: false });
        const o = mem.getStrategyOutcomes("staged");
        assert.equal(o.successRate, 0);
    });

    it("tracks multiple executions for same strategy", () => {
        mem.recordExecution({ executionId: "e1", strategy: "safe", success: true });
        mem.recordExecution({ executionId: "e2", strategy: "safe", success: true });
        mem.recordExecution({ executionId: "e3", strategy: "safe", success: false });
        const o = mem.getStrategyOutcomes("safe");
        assert.equal(o.count, 3);
        assert.ok(Math.abs(o.successRate - 0.667) < 0.001);
    });
});

describe("orchestrationMemory — getStrategyOutcomes", () => {
    it("returns zero counts for unknown strategy", () => {
        const o = mem.getStrategyOutcomes("nonexistent");
        assert.equal(o.count, 0);
        assert.equal(o.successRate, 0);
    });

    it("calculates avg retries and rollback rate", () => {
        mem.recordExecution({ executionId: "e1", strategy: "fast", retryCount: 2, rollbackTriggered: true, success: false });
        mem.recordExecution({ executionId: "e2", strategy: "fast", retryCount: 0, rollbackTriggered: false, success: true });
        const o = mem.getStrategyOutcomes("fast");
        assert.equal(o.avgRetries, 1);
        assert.equal(o.rollbackRate, 0.5);
    });
});

describe("orchestrationMemory — getFingerprintHistory", () => {
    it("returns empty result for unknown fingerprint", () => {
        const h = mem.getFingerprintHistory("unknown-fp");
        assert.equal(h.count, 0);
    });

    it("tracks multiple strategies used for same fingerprint", () => {
        mem.recordExecution({ executionId: "e1", fingerprint: "fp-x", strategy: "fast",   success: true  });
        mem.recordExecution({ executionId: "e2", fingerprint: "fp-x", strategy: "staged", success: false });
        const h = mem.getFingerprintHistory("fp-x");
        assert.equal(h.count, 2);
        assert.ok(h.strategies.includes("fast"));
        assert.ok(h.strategies.includes("staged"));
    });

    it("reports last strategy and success", () => {
        mem.recordExecution({ executionId: "e1", fingerprint: "fp-y", strategy: "safe", success: false });
        mem.recordExecution({ executionId: "e2", fingerprint: "fp-y", strategy: "fast", success: true  });
        const h = mem.getFingerprintHistory("fp-y");
        assert.equal(h.lastStrategy, "fast");
        assert.equal(h.lastSuccess, true);
    });
});

describe("orchestrationMemory — getRetryPatterns", () => {
    it("returns zero avgRetries when no executions", () => {
        const r = mem.getRetryPatterns();
        assert.equal(r.avgRetries, 0);
    });

    it("identifies high-retry fingerprints", () => {
        mem.recordExecution({ executionId: "e1", fingerprint: "fp-r", retryCount: 3, success: true });
        mem.recordExecution({ executionId: "e2", fingerprint: "fp-r", retryCount: 4, success: false });
        const r = mem.getRetryPatterns();
        assert.ok(r.patterns.some(p => p.fingerprint === "fp-r" && p.avgRetries > 1));
    });
});

describe("orchestrationMemory — correlateIncident", () => {
    it("correlates executions with an incident", () => {
        mem.recordExecution({ executionId: "e1", success: false });
        mem.recordExecution({ executionId: "e2", success: false });
        const r = mem.correlateIncident("inc-1", ["e1", "e2"]);
        assert.equal(r.incidentId, "inc-1");
        assert.equal(r.correlated, 2);
        assert.equal(r.failureRate, 1);
    });

    it("merges with existing correlation on same incident", () => {
        mem.recordExecution({ executionId: "e1", success: false });
        mem.recordExecution({ executionId: "e2", success: true });
        mem.correlateIncident("inc-2", ["e1"]);
        const r2 = mem.correlateIncident("inc-2", ["e2"]);
        assert.equal(r2.executionCount, 2);
    });
});

describe("orchestrationMemory — reconstructLineage", () => {
    it("returns found:false for unknown execution", () => {
        const r = mem.reconstructLineage("missing");
        assert.equal(r.found, false);
    });

    it("reconstructs a simple parent → child chain", () => {
        mem.recordExecution({ executionId: "parent", strategy: "safe",   success: true  });
        mem.recordExecution({ executionId: "child",  strategy: "staged", success: false, parentId: "parent" });
        const r = mem.reconstructLineage("child");
        assert.equal(r.found, true);
        assert.equal(r.depth, 2);
        assert.equal(r.rootId, "parent");
    });

    it("finds children of a parent execution", () => {
        mem.recordExecution({ executionId: "root" });
        mem.recordExecution({ executionId: "c1", parentId: "root" });
        mem.recordExecution({ executionId: "c2", parentId: "root" });
        const r = mem.reconstructLineage("root");
        assert.equal(r.childCount, 2);
    });
});

describe("orchestrationMemory — getMemoryStats", () => {
    it("tracks all dimensions after mixed executions", () => {
        mem.recordExecution({ executionId: "e1", strategy: "fast",   fingerprint: "fp1" });
        mem.recordExecution({ executionId: "e2", strategy: "staged", fingerprint: "fp2" });
        mem.recordDegradation({ type: "latency", severity: "high" });
        mem.correlateIncident("inc-1", ["e1"]);
        const s = mem.getMemoryStats();
        assert.equal(s.totalExecutions, 2);
        assert.equal(s.uniqueStrategies, 2);
        assert.equal(s.uniqueFingerprints, 2);
        assert.equal(s.degradationEvents, 1);
        assert.equal(s.incidents, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// adaptiveRoutingEngine
// ═══════════════════════════════════════════════════════════════════════

describe("adaptiveRoutingEngine — registerRoute", () => {
    it("registers a route with defaults", () => {
        const r = route.registerRoute("r1");
        assert.equal(r.registered, true);
        assert.equal(r.routeId, "r1");
        assert.equal(r.route.healthy, true);
    });

    it("rejects registration without routeId", () => {
        const r = route.registerRoute("");
        assert.equal(r.registered, false);
    });

    it("accepts custom reliability and latency", () => {
        const r = route.registerRoute("r2", { reliability: 0.95, avgLatencyMs: 50 });
        assert.equal(r.route.reliability, 0.95);
        assert.equal(r.route.avgLatencyMs, 50);
    });
});

describe("adaptiveRoutingEngine — scoreRoute", () => {
    it("returns F for unknown route", () => {
        const s = route.scoreRoute("nope");
        assert.equal(s.grade, "F");
    });

    it("returns F for unhealthy route", () => {
        route.registerRoute("r-sick", { healthy: false });
        const s = route.scoreRoute("r-sick");
        assert.equal(s.grade, "F");
        assert.equal(s.reason, "unhealthy");
    });

    it("scores a perfect route highly", () => {
        route.registerRoute("r-perfect", { reliability: 1, avgLatencyMs: 50, healthy: true });
        const s = route.scoreRoute("r-perfect");
        assert.ok(s.score >= 90);
        assert.equal(s.grade, "A");
    });

    it("penalizes high latency route", () => {
        route.registerRoute("r-slow", { reliability: 1, avgLatencyMs: 10000, healthy: true });
        const s = route.scoreRoute("r-slow");
        assert.ok(s.score < 90);
    });
});

describe("adaptiveRoutingEngine — selectBestRoute", () => {
    it("returns selected:false when no healthy routes", () => {
        route.registerRoute("r-dead", { healthy: false });
        const d = route.selectBestRoute(["r-dead"]);
        assert.equal(d.selected, false);
    });

    it("selects the highest-scoring route", () => {
        route.registerRoute("r-good",  { reliability: 1,   avgLatencyMs: 50  });
        route.registerRoute("r-worse", { reliability: 0.5, avgLatencyMs: 3000 });
        const d = route.selectBestRoute(["r-good", "r-worse"]);
        assert.equal(d.selected, true);
        assert.equal(d.routeId, "r-good");
    });

    it("uses all registered routes when none specified", () => {
        route.registerRoute("rA", { reliability: 0.9, avgLatencyMs: 100 });
        const d = route.selectBestRoute();
        assert.equal(d.selected, true);
    });
});

describe("adaptiveRoutingEngine — updateRouteMetrics", () => {
    it("returns not found for missing route", () => {
        const r = route.updateRouteMetrics("ghost");
        assert.equal(r.updated, false);
    });

    it("updates reliability and latency", () => {
        route.registerRoute("r-upd", { reliability: 0.5, avgLatencyMs: 200 });
        route.updateRouteMetrics("r-upd", { reliability: 0.99, avgLatencyMs: 30 });
        const s = route.scoreRoute("r-upd");
        assert.ok(s.score > 80);
    });

    it("tracks success calls for live success rate", () => {
        route.registerRoute("r-track");
        route.updateRouteMetrics("r-track", { success: true  });
        route.updateRouteMetrics("r-track", { success: true  });
        route.updateRouteMetrics("r-track", { success: false });
        const s = route.scoreRoute("r-track");
        assert.ok(s.score > 0);
    });
});

describe("adaptiveRoutingEngine — prioritizeStrategies", () => {
    it("ranks strategies by score descending", () => {
        const r = route.prioritizeStrategies({ fast: 90, safe: 70, staged: 50 });
        assert.equal(r.ranked[0].strategy, "fast");
        assert.equal(r.topStrategy, "fast");
        assert.equal(r.count, 3);
    });

    it("ignores non-numeric values", () => {
        const r = route.prioritizeStrategies({ fast: 80, label: "ignore" });
        assert.equal(r.count, 1);
    });
});

describe("adaptiveRoutingEngine — adaptToWorkload", () => {
    it("detects overloaded state", () => {
        route.registerRoute("r-cap", { throughputRpm: 10, healthy: true });
        const r = route.adaptToWorkload(["r-cap"], { rpm: 100 });
        assert.equal(r.overloaded, true);
    });

    it("recommends fast strategy under low load", () => {
        route.registerRoute("r-big", { throughputRpm: 1000, healthy: true });
        const r = route.adaptToWorkload(["r-big"], { rpm: 10 });
        assert.equal(r.overloaded, false);
        assert.equal(r.recommendedStrategy, "fast");
    });
});

describe("adaptiveRoutingEngine — applyPressureAdaptation", () => {
    it("restricts concurrency under critical pressure", () => {
        route.registerRoute("r1");
        const r = route.applyPressureAdaptation(["r1"], "critical");
        assert.equal(r.maxConcurrency, 1);
        assert.equal(r.shedLoad, true);
    });

    it("allows higher concurrency under no pressure", () => {
        route.registerRoute("r1");
        const r = route.applyPressureAdaptation(["r1"], "none");
        assert.ok(r.maxConcurrency >= 8);
        assert.equal(r.shedLoad, false);
    });
});

describe("adaptiveRoutingEngine — getRoutingStats", () => {
    it("tracks route counts and decisions", () => {
        route.registerRoute("rA", { reliability: 0.9, avgLatencyMs: 100 });
        route.registerRoute("rB", { healthy: false });
        route.selectBestRoute();
        const s = route.getRoutingStats();
        assert.equal(s.totalRoutes, 2);
        assert.equal(s.healthyRoutes, 1);
        assert.equal(s.decisionCount, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// predictiveFailureEngine
// ═══════════════════════════════════════════════════════════════════════

describe("predictiveFailureEngine — scoreFailureRisk", () => {
    it("scores zero risk for perfect metrics", () => {
        const r = pred.scoreFailureRisk({ errorRate: 0, avgRetries: 0, rollbackRate: 0 });
        assert.equal(r.score, 0);
        assert.equal(r.level, "none");
    });

    it("scores critical for high error rate", () => {
        const r = pred.scoreFailureRisk({ errorRate: 1 });
        assert.ok(r.score >= 40);
        assert.ok(["medium","high","critical"].includes(r.level));
    });

    it("combines multiple risk factors", () => {
        const r = pred.scoreFailureRisk({ errorRate: 0.5, avgRetries: 3, rollbackRate: 0.3, latencySpike: 1 });
        assert.ok(r.score > 50);
        assert.ok(["high","critical"].includes(r.level));
    });
});

describe("predictiveFailureEngine — detectAnomalyTrend", () => {
    it("returns flat with insufficient data", () => {
        const r = pred.detectAnomalyTrend([{ score: 10 }]);
        assert.equal(r.trending, false);
    });

    it("detects rising trend", () => {
        const history = [10, 20, 30, 40, 50].map(score => ({ score }));
        const r = pred.detectAnomalyTrend(history);
        assert.equal(r.direction, "rising");
        assert.equal(r.trending, true);
    });

    it("detects falling trend", () => {
        const history = [50, 40, 30, 20, 10].map(score => ({ score }));
        const r = pred.detectAnomalyTrend(history);
        assert.equal(r.direction, "falling");
    });

    it("returns flat for mixed signals", () => {
        const history = [10, 50, 10, 50, 10].map(score => ({ score }));
        const r = pred.detectAnomalyTrend(history);
        assert.equal(r.direction, "flat");
    });
});

describe("predictiveFailureEngine — predictRetryEscalation", () => {
    it("returns no history for empty input", () => {
        const r = pred.predictRetryEscalation([]);
        assert.equal(r.escalating, false);
    });

    it("detects escalation when recent retries spike", () => {
        const history = [
            ...Array(10).fill({ retryCount: 1 }),
            ...Array(5).fill({ retryCount: 5 }),
        ];
        const r = pred.predictRetryEscalation(history);
        assert.equal(r.escalating, true);
    });

    it("no escalation for stable retry counts", () => {
        const history = Array(10).fill({ retryCount: 1 });
        const r = pred.predictRetryEscalation(history);
        assert.equal(r.escalating, false);
    });
});

describe("predictiveFailureEngine — predictDegradationProbability", () => {
    it("returns zero probability for empty degradations", () => {
        const r = pred.predictDegradationProbability([]);
        assert.equal(r.probability, 0);
        assert.equal(r.level, "none");
    });

    it("increases probability with more recent events", () => {
        const degradations = Array(8).fill({ severity: "high", ts: new Date().toISOString() });
        const r = pred.predictDegradationProbability(degradations);
        assert.ok(r.probability > 0.2);
    });
});

describe("predictiveFailureEngine — predictCascadeProbability", () => {
    it("returns low probability for isolated incident", () => {
        const r = pred.predictCascadeProbability(
            { services: ["svc-a", "svc-b"], dependencies: [] },
            { severity: "P3", affectedServices: ["svc-a"] }
        );
        assert.ok(r.probability < 0.5);
    });

    it("returns higher probability for P1 with downstream deps", () => {
        const topology = {
            services:     ["a", "b", "c", "d"],
            dependencies: [{ from: "a", to: "b" }, { from: "a", to: "c" }],
        };
        const r = pred.predictCascadeProbability(topology, { severity: "P1", affectedServices: ["a"] });
        assert.ok(r.probability > 0.4);
        assert.equal(r.downstreamCount, 2);
    });
});

describe("predictiveFailureEngine — forecastSaturation", () => {
    it("returns insufficient_data for single datapoint", () => {
        const r = pred.forecastSaturation([{ utilization: 0.5 }]);
        assert.equal(r.saturated, false);
    });

    it("detects current saturation", () => {
        const r = pred.forecastSaturation([{ utilization: 0.8 }, { utilization: 0.95 }]);
        assert.equal(r.saturated, true);
    });

    it("predicts future saturation from rising trend", () => {
        const history = [0.6, 0.65, 0.70, 0.75, 0.80].map(u => ({ utilization: u }));
        const r = pred.forecastSaturation(history);
        assert.equal(r.saturated, false);
        assert.ok(r.slope > 0);
    });
});

describe("predictiveFailureEngine — scoreInstabilityRisk", () => {
    it("returns no risk for zero executions", () => {
        const r = pred.scoreInstabilityRisk([]);
        assert.equal(r.score, 0);
        assert.equal(r.level, "none");
    });

    it("scores high instability for failing executions", () => {
        const executions = Array(10).fill({ success: false, retryCount: 3, rollbackTriggered: true });
        const r = pred.scoreInstabilityRisk(executions);
        assert.ok(r.score > 60);
        assert.ok(["high","critical"].includes(r.level));
    });

    it("scores no risk for perfectly stable executions", () => {
        const executions = Array(10).fill({ success: true, retryCount: 0, rollbackTriggered: false });
        const r = pred.scoreInstabilityRisk(executions);
        assert.equal(r.score, 0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// optimizationCoordinator
// ═══════════════════════════════════════════════════════════════════════

describe("optimizationCoordinator — recommendOptimizations", () => {
    it("returns empty recommendations for healthy profile", () => {
        const r = opt.recommendOptimizations({ errorRate: 0, avgRetries: 0, avgLatencyMs: 100 });
        assert.equal(r.count, 0);
    });

    it("recommends reduce_concurrency for high error rate", () => {
        const r = opt.recommendOptimizations({ errorRate: 0.3 });
        assert.ok(r.recommendations.some(rec => rec.action === "reduce_concurrency"));
    });

    it("recommends optimize_retry_policy for excessive retries", () => {
        const r = opt.recommendOptimizations({ avgRetries: 3 });
        assert.ok(r.recommendations.some(rec => rec.action === "optimize_retry_policy"));
    });

    it("recommends enable_fast_path for high latency", () => {
        const r = opt.recommendOptimizations({ avgLatencyMs: 5000 });
        assert.ok(r.recommendations.some(rec => rec.action === "enable_fast_path"));
    });
});

describe("optimizationCoordinator — tuneConcurrency", () => {
    it("holds concurrency when metrics are healthy", () => {
        const r = opt.tuneConcurrency({ successRate: 0.97, errorRate: 0.01, avgLatencyMs: 200, currentConcurrency: 5 });
        assert.equal(r.direction, "scale_up");
    });

    it("scales down on high error rate", () => {
        const r = opt.tuneConcurrency({ successRate: 0.5, errorRate: 0.3, currentConcurrency: 10 });
        assert.equal(r.direction, "scale_down");
        assert.ok(r.recommended < 10);
    });

    it("holds when metrics are moderate", () => {
        const r = opt.tuneConcurrency({ successRate: 0.85, errorRate: 0.05, avgLatencyMs: 1000, currentConcurrency: 5 });
        assert.ok(r.direction === "hold" || r.direction === "scale_down");
    });
});

describe("optimizationCoordinator — optimizeRetryPolicy", () => {
    it("returns policy_optimal for healthy retry stats", () => {
        const r = opt.optimizeRetryPolicy({ avgRetries: 0.5, maxRetries: 3, successAfterRetry: 0.8, retryRate: 0.1 });
        assert.ok(r.actions.includes("policy_optimal"));
    });

    it("reduces max retries when success-after-retry is very low", () => {
        const r = opt.optimizeRetryPolicy({ avgRetries: 1, maxRetries: 3, successAfterRetry: 0.1, retryRate: 0.2 });
        assert.ok(r.actions.includes("reduce_max_retries"));
        assert.ok(r.recommendedMax < 3);
    });

    it("adds jitter for high retry rate", () => {
        const r = opt.optimizeRetryPolicy({ avgRetries: 2, maxRetries: 3, successAfterRetry: 0.5, retryRate: 0.8 });
        assert.ok(r.actions.includes("add_jitter"));
    });
});

describe("optimizationCoordinator — planLatencyReduction", () => {
    it("suggests circuit breaker for very high p95", () => {
        const r = opt.planLatencyReduction({ p50Ms: 500, p95Ms: 8000, avgMs: 1000 });
        assert.ok(r.steps.some(s => s.step === "enable_circuit_breaker"));
    });

    it("suggests reduce_concurrency for high avg latency", () => {
        const r = opt.planLatencyReduction({ p50Ms: 1000, p95Ms: 3000, avgMs: 2500 });
        assert.ok(r.steps.some(s => s.step === "reduce_concurrency"));
    });

    it("maintains current policy for low latency", () => {
        const r = opt.planLatencyReduction({ p50Ms: 50, p95Ms: 100, avgMs: 60 });
        assert.ok(r.steps.some(s => s.step === "maintain_current_policy"));
    });
});

describe("optimizationCoordinator — optimizeDegradedMode", () => {
    it("returns normal mode for healthy system", () => {
        const r = opt.optimizeDegradedMode({ health: 0.95 });
        assert.equal(r.mode, "normal");
        assert.equal(r.shedLoad, false);
    });

    it("returns cautious mode at 0.7 health", () => {
        const r = opt.optimizeDegradedMode({ health: 0.7 });
        assert.equal(r.mode, "cautious");
    });

    it("returns degraded mode at 0.5 health", () => {
        const r = opt.optimizeDegradedMode({ health: 0.5 });
        assert.equal(r.mode, "degraded");
        assert.equal(r.shedLoad, true);
    });

    it("returns minimal mode at very low health", () => {
        const r = opt.optimizeDegradedMode({ health: 0.2 });
        assert.equal(r.mode, "minimal");
        assert.equal(r.concurrency, 1);
    });
});

describe("optimizationCoordinator — scoreEfficiency", () => {
    it("returns F for no executions", () => {
        const r = opt.scoreEfficiency([]);
        assert.equal(r.grade, "F");
    });

    it("returns A for perfectly efficient executions", () => {
        const execs = Array(10).fill({ success: true, retryCount: 0, rollbackTriggered: false });
        const r = opt.scoreEfficiency(execs);
        assert.equal(r.score, 100);
        assert.equal(r.grade, "A");
    });

    it("penalizes retries and rollbacks", () => {
        const execs = Array(5).fill({ success: true, retryCount: 3, rollbackTriggered: true });
        const r = opt.scoreEfficiency(execs);
        assert.ok(r.score < 100);
    });
});

describe("optimizationCoordinator — buildAdaptivePlan", () => {
    it("builds a stabilize plan for critical risk", () => {
        const r = opt.buildAdaptivePlan({ riskLevel: "critical", errorRate: 0.5 });
        assert.ok(r.planId.startsWith("plan-"));
        assert.ok(r.phases.some(p => p.phase === "stabilize"));
    });

    it("builds an optimize plan for healthy context", () => {
        const r = opt.buildAdaptivePlan({ riskLevel: "none", errorRate: 0.01 });
        assert.ok(r.phases.some(p => p.phase === "optimize"));
    });

    it("stores plan in optimization history", () => {
        opt.buildAdaptivePlan({});
        const h = opt.getOptimizationHistory();
        assert.ok(h.some(e => e.type === "adaptive_plan"));
    });
});

// ═══════════════════════════════════════════════════════════════════════
// strategyEvolutionEngine
// ═══════════════════════════════════════════════════════════════════════

describe("strategyEvolutionEngine — recordOutcome", () => {
    it("records a successful outcome", () => {
        const r = evo.recordOutcome("fast", { success: true, retryCount: 0, durationMs: 100 });
        assert.equal(r.recorded, true);
        assert.equal(r.callCount, 1);
    });

    it("increments callCount on repeated calls", () => {
        evo.recordOutcome("safe", { success: true });
        evo.recordOutcome("safe", { success: false });
        const r = evo.recordOutcome("safe", { success: true });
        assert.equal(r.callCount, 3);
    });
});

describe("strategyEvolutionEngine — rankStrategies", () => {
    it("returns empty list when no data", () => {
        const r = evo.rankStrategies();
        assert.equal(r.count, 0);
    });

    it("ranks by success rate descending", () => {
        evo.recordOutcome("fast",   { success: true  });
        evo.recordOutcome("fast",   { success: true  });
        evo.recordOutcome("staged", { success: false });
        const r = evo.rankStrategies();
        assert.equal(r.topStrategy, "fast");
        assert.ok(r.ranked[0].score > r.ranked[r.ranked.length - 1].score);
    });
});

describe("strategyEvolutionEngine — promoteStrategy / demoteStrategy", () => {
    it("promotes a strategy up one tier", () => {
        // "safe" is at index 3; promoting should go to index 4
        const r = evo.promoteStrategy("safe");
        assert.equal(r.promoted, true);
        assert.ok(r.newTier > 3);
    });

    it("cannot promote beyond top tier", () => {
        // "fast" is at index 4 (top)
        const r = evo.promoteStrategy("fast");
        assert.equal(r.promoted, false);
        assert.equal(r.reason, "already_at_top");
    });

    it("demotes a strategy down one tier", () => {
        const r = evo.demoteStrategy("safe");
        assert.equal(r.demoted, true);
    });

    it("cannot demote below floor", () => {
        // "sandbox" is at index 0 (floor)
        const r = evo.demoteStrategy("sandbox");
        assert.equal(r.demoted, false);
        assert.equal(r.reason, "already_at_floor");
    });
});

describe("strategyEvolutionEngine — scoreConfidence", () => {
    it("returns grade F with no data", () => {
        const r = evo.scoreConfidence("fast");
        assert.equal(r.grade, "F");
        assert.equal(r.reason, "no_data");
    });

    it("scores A after many successful outcomes", () => {
        for (let i = 0; i < 10; i++) evo.recordOutcome("fast", { success: true });
        const r = evo.scoreConfidence("fast");
        assert.ok(r.score >= 90);
        assert.equal(r.grade, "A");
    });

    it("scores lower with failures in history", () => {
        for (let i = 0; i < 5; i++) evo.recordOutcome("staged", { success: true  });
        for (let i = 0; i < 5; i++) evo.recordOutcome("staged", { success: false });
        const r = evo.scoreConfidence("staged");
        assert.ok(r.score < 90);
    });
});

describe("strategyEvolutionEngine — runEvolutionCycle", () => {
    it("returns evolved:false for no executions", () => {
        const r = evo.runEvolutionCycle([]);
        assert.equal(r.evolved, false);
    });

    it("learns from execution batch", () => {
        const execs = Array(10).fill({ strategy: "fast", success: true, retryCount: 0, durationMs: 100 });
        const r = evo.runEvolutionCycle(execs);
        assert.equal(r.executionsLearned, 10);
    });

    it("auto-promotes strategy with high success rate", () => {
        // Need ≥5 executions and ≥90% success to auto-promote
        const execs = Array(6).fill({ strategy: "safe", success: true });
        const r = evo.runEvolutionCycle(execs);
        assert.ok(r.promotions.includes("safe"));
    });

    it("auto-demotes strategy with very low success rate", () => {
        const execs = [
            ...Array(4).fill({ strategy: "staged", success: false }),
            { strategy: "staged", success: false },
        ];
        const r = evo.runEvolutionCycle(execs);
        assert.ok(r.demotions.includes("staged"));
    });
});

describe("strategyEvolutionEngine — getEvolutionState", () => {
    it("returns zero counts after reset", () => {
        const s = evo.getEvolutionState();
        assert.equal(s.strategyCount, 0);
        assert.equal(s.cycleCount, 0);
    });

    it("tracks cycles and strategies across calls", () => {
        evo.recordOutcome("fast",   { success: true });
        evo.recordOutcome("staged", { success: true });
        evo.runEvolutionCycle([]);
        const s = evo.getEvolutionState();
        assert.equal(s.strategyCount, 2);
        assert.equal(s.cycleCount, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// intelligenceBenchmark
// ═══════════════════════════════════════════════════════════════════════

describe("intelligenceBenchmark — scoreRoutingIntelligence", () => {
    it("returns grade F for no decisions", () => {
        const r = bench.scoreRoutingIntelligence([], []);
        assert.equal(r.grade, "F");
    });

    it("scores A when all decisions led to successful outcomes", () => {
        const decisions = [{ routeId: "r1", score: 95 }, { routeId: "r2", score: 90 }];
        const outcomes  = [{ routeId: "r1", success: true }, { routeId: "r2", success: true }];
        const r = bench.scoreRoutingIntelligence(decisions, outcomes);
        assert.ok(r.score >= 75);
        assert.equal(r.hitRate, 1);
    });

    it("scores lower when outcomes don't match decisions", () => {
        const decisions = [{ routeId: "r1", score: 80 }];
        const outcomes  = [{ routeId: "r1", success: false }];
        const r = bench.scoreRoutingIntelligence(decisions, outcomes);
        assert.ok(r.score < 80);
    });
});

describe("intelligenceBenchmark — scorePredictionAccuracy", () => {
    it("returns F for no predictions", () => {
        const r = bench.scorePredictionAccuracy([], []);
        assert.equal(r.grade, "F");
    });

    it("scores 100 when all predictions are correct", () => {
        const predictions = [{ level: "critical" }, { level: "none" }];
        const actuals     = [{ failed: true },     { failed: false }];
        const r = bench.scorePredictionAccuracy(predictions, actuals);
        assert.equal(r.score, 100);
        assert.equal(r.grade, "A");
    });

    it("scores lower with incorrect predictions", () => {
        const predictions = [{ level: "none" }];
        const actuals     = [{ failed: true  }];
        const r = bench.scorePredictionAccuracy(predictions, actuals);
        assert.ok(r.score < 100);
    });
});

describe("intelligenceBenchmark — scoreOptimizationImpact", () => {
    it("returns C for no baseline", () => {
        const r = bench.scoreOptimizationImpact({}, {});
        assert.equal(r.grade, "C");
    });

    it("scores well when error rate improved significantly", () => {
        const before = { errorRate: 0.2, avgLatencyMs: 2000, throughputRpm: 50 };
        const after  = { errorRate: 0.02, avgLatencyMs: 800, throughputRpm: 80 };
        const r = bench.scoreOptimizationImpact(before, after);
        assert.ok(r.score > 70);
        assert.ok(r.errImprovement > 0);
    });

    it("scores below 50 when metrics got worse", () => {
        const before = { errorRate: 0.05, avgLatencyMs: 500 };
        const after  = { errorRate: 0.3,  avgLatencyMs: 3000 };
        const r = bench.scoreOptimizationImpact(before, after);
        assert.ok(r.score < 50);
    });
});

describe("intelligenceBenchmark — scoreLearningEffectiveness", () => {
    it("returns F for no cycles", () => {
        const r = bench.scoreLearningEffectiveness([]);
        assert.equal(r.grade, "F");
    });

    it("scores higher when cycles consistently evolved", () => {
        const cycles = [
            { evolved: true, promotions: ["fast"], demotions: [], executionsLearned: 10 },
            { evolved: true, promotions: ["safe"], demotions: [], executionsLearned: 8  },
            { evolved: true, promotions: [],       demotions: ["staged"], executionsLearned: 6 },
        ];
        const r = bench.scoreLearningEffectiveness(cycles);
        assert.ok(r.score >= 60);
    });

    it("scores lower when no cycles evolved", () => {
        const cycles = Array(5).fill({ evolved: false, promotions: [], demotions: [], executionsLearned: 0 });
        const r = bench.scoreLearningEffectiveness(cycles);
        assert.ok(r.score < 40);
    });
});

describe("intelligenceBenchmark — scoreAdaptiveEfficiency", () => {
    it("returns F for no adaptations", () => {
        const r = bench.scoreAdaptiveEfficiency([]);
        assert.equal(r.grade, "F");
    });

    it("scores A for fully effective fast adaptations", () => {
        const adaptations = Array(10).fill({ improved: true, decisionMs: 5 });
        const r = bench.scoreAdaptiveEfficiency(adaptations);
        assert.ok(r.score >= 90);
    });

    it("scores lower when adaptations did not improve outcomes", () => {
        const adaptations = Array(5).fill({ improved: false, decisionMs: 200 });
        const r = bench.scoreAdaptiveEfficiency(adaptations);
        assert.ok(r.score < 20);
    });
});

describe("intelligenceBenchmark — gradeIntelligenceMaturity", () => {
    it("returns F for empty scores", () => {
        const r = bench.gradeIntelligenceMaturity({});
        assert.equal(r.grade, "F");
        assert.equal(r.score, 0);
    });

    it("returns A for all-high scores", () => {
        const r = bench.gradeIntelligenceMaturity({ routing: 95, prediction: 92, optimization: 91 });
        assert.equal(r.grade, "A");
        assert.equal(r.maturity, bench.MATURITY_LEVELS.A);
    });

    it("returns correct maturity label for each grade", () => {
        assert.equal(bench.MATURITY_LEVELS.A, "autonomous_intelligence");
        assert.equal(bench.MATURITY_LEVELS.B, "adaptive_intelligence");
        assert.equal(bench.MATURITY_LEVELS.C, "basic_intelligence");
        assert.equal(bench.MATURITY_LEVELS.D, "reactive_only");
        assert.equal(bench.MATURITY_LEVELS.F, "no_intelligence");
    });

    it("averages multiple scores correctly", () => {
        const r = bench.gradeIntelligenceMaturity({ a: 80, b: 80, c: 80 });
        assert.equal(r.score, 80);
        assert.equal(r.grade, "B");
        assert.equal(r.inputs, 3);
    });

    it("ignores non-numeric inputs", () => {
        const r = bench.gradeIntelligenceMaturity({ a: 90, label: "skip" });
        assert.equal(r.inputs, 1);
        assert.equal(r.score, 90);
    });
});
