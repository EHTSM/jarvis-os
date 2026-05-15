"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const pa  = require("../../agents/runtime/learning/patternAnalyzer.cjs");
const al  = require("../../agents/runtime/learning/adaptiveLearner.cjs");
const ap  = require("../../agents/runtime/learning/anomalyPredictor.cjs");
const wc  = require("../../agents/runtime/learning/workloadClassifier.cjs");
const im  = require("../../agents/runtime/learning/incidentMemory.cjs");
const lb  = require("../../agents/runtime/learning/learningBenchmark.cjs");

// ── helpers ───────────────────────────────────────────────────────────

function makeExec(overrides = {}) {
    return {
        type: "data_pipeline", strategy: "fast", outcome: "success",
        durationMs: 100, errorType: null, ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// patternAnalyzer
// ═══════════════════════════════════════════════════════════════════════

describe("patternAnalyzer — recordExecution", () => {
    beforeEach(() => pa.reset());

    it("records an execution and returns it with a generated id", () => {
        const e = pa.recordExecution(makeExec());
        assert.ok(e.id.startsWith("exec-"));
        assert.equal(e.type, "data_pipeline");
        assert.equal(e.outcome, "success");
    });

    it("uses provided id if given", () => {
        const e = pa.recordExecution(makeExec({ id: "my-id" }));
        assert.equal(e.id, "my-id");
    });

    it("builds a fingerprint from type:strategy:errorType", () => {
        const e = pa.recordExecution(makeExec({ type: "api_call", strategy: "safe", errorType: "timeout" }));
        assert.equal(e.fingerprint, "api_call:safe:timeout");
    });

    it("uses provided fingerprint if given", () => {
        const e = pa.recordExecution(makeExec({ fingerprint: "custom-fp" }));
        assert.equal(e.fingerprint, "custom-fp");
    });
});

describe("patternAnalyzer — detectPatterns", () => {
    beforeEach(() => pa.reset());

    it("returns empty array when no executions recorded", () => {
        const patterns = pa.detectPatterns();
        assert.equal(patterns.length, 0);
    });

    it("detects frequent fingerprints above threshold", () => {
        for (let i = 0; i < 5; i++) {
            pa.recordExecution(makeExec({ type: "api_call", strategy: "fast", errorType: null }));
        }
        const patterns = pa.detectPatterns({ minOccurrences: 3 });
        const fp = patterns.find(p => p.patternType === "frequent_fingerprint");
        assert.ok(fp, "should have frequent_fingerprint pattern");
        assert.ok(fp.occurrences >= 3);
    });

    it("does not report patterns below threshold", () => {
        pa.recordExecution(makeExec({ type: "rare_type" }));
        pa.recordExecution(makeExec({ type: "rare_type" }));
        const patterns = pa.detectPatterns({ minOccurrences: 5 });
        const fp = patterns.find(p => p.fingerprint === "rare_type:fast:ok");
        assert.equal(fp, undefined);
    });

    it("detects strategy-outcome patterns", () => {
        for (let i = 0; i < 4; i++) {
            pa.recordExecution(makeExec({ strategy: "safe", outcome: "success" }));
        }
        const patterns = pa.detectPatterns({ minOccurrences: 3 });
        const so = patterns.find(p => p.patternType === "strategy_outcome" && p.strategy === "safe");
        assert.ok(so);
        assert.equal(so.outcome, "success");
    });

    it("sorts patterns by occurrence count descending", () => {
        for (let i = 0; i < 6; i++) pa.recordExecution(makeExec({ strategy: "fast" }));
        for (let i = 0; i < 4; i++) pa.recordExecution(makeExec({ strategy: "safe" }));
        const patterns = pa.detectPatterns({ minOccurrences: 3 });
        assert.ok(patterns[0].occurrences >= patterns[patterns.length - 1].occurrences);
    });
});

describe("patternAnalyzer — getRecurringFailures", () => {
    beforeEach(() => pa.reset());

    it("returns empty when no failures", () => {
        for (let i = 0; i < 3; i++) pa.recordExecution(makeExec());
        assert.equal(pa.getRecurringFailures().length, 0);
    });

    it("detects recurring failures above threshold", () => {
        for (let i = 0; i < 4; i++) {
            pa.recordExecution(makeExec({ outcome: "failure", errorType: "timeout" }));
        }
        const failures = pa.getRecurringFailures(3);
        assert.ok(failures.length > 0);
        assert.equal(failures[0].errorType, "timeout");
        assert.ok(failures[0].count >= 4);
    });

    it("includes all strategies observed for that error", () => {
        pa.recordExecution(makeExec({ outcome: "failure", errorType: "oom", strategy: "fast" }));
        pa.recordExecution(makeExec({ outcome: "failure", errorType: "oom", strategy: "safe" }));
        pa.recordExecution(makeExec({ outcome: "failure", errorType: "oom", strategy: "staged" }));
        const failures = pa.getRecurringFailures(1);
        const oom = failures.find(f => f.errorType === "oom");
        assert.ok(oom.strategies.includes("fast"));
        assert.ok(oom.strategies.includes("safe"));
    });
});

describe("patternAnalyzer — clusterFingerprints", () => {
    beforeEach(() => pa.reset());

    it("returns empty for no executions", () => {
        assert.equal(pa.clusterFingerprints([]).length, 0);
    });

    it("puts identical fingerprints in the same cluster", () => {
        const execs = [
            { id: "e1", fingerprint: "api_call:fast:timeout", outcome: "failure" },
            { id: "e2", fingerprint: "api_call:fast:timeout", outcome: "failure" },
            { id: "e3", fingerprint: "api_call:fast:timeout", outcome: "failure" },
        ];
        const clusters = pa.clusterFingerprints(execs);
        assert.equal(clusters.length, 1);
        assert.equal(clusters[0].size, 3);
    });

    it("puts very different fingerprints in separate clusters", () => {
        const execs = [
            { id: "e1", fingerprint: "api_call:fast:timeout", outcome: "failure" },
            { id: "e2", fingerprint: "payment:rollback:auth_error", outcome: "failure" },
        ];
        const clusters = pa.clusterFingerprints(execs);
        assert.equal(clusters.length, 2);
    });

    it("each cluster has representative and outcomes", () => {
        const execs = [{ id: "e1", fingerprint: "x:y:z", outcome: "success" }];
        const clusters = pa.clusterFingerprints(execs);
        assert.ok(clusters[0].representative);
        assert.ok(clusters[0].outcomes);
    });
});

describe("patternAnalyzer — getHotWorkflows", () => {
    beforeEach(() => pa.reset());

    it("returns empty when no executions", () => {
        assert.equal(pa.getHotWorkflows().length, 0);
    });

    it("returns top N by frequency", () => {
        for (let i = 0; i < 5; i++) pa.recordExecution(makeExec({ type: "api_call" }));
        for (let i = 0; i < 3; i++) pa.recordExecution(makeExec({ type: "payment" }));
        pa.recordExecution(makeExec({ type: "auth" }));
        const hot = pa.getHotWorkflows(2);
        assert.equal(hot.length, 2);
        assert.equal(hot[0].type, "api_call");
    });

    it("includes count and frequency", () => {
        pa.recordExecution(makeExec({ type: "data_pipeline" }));
        const hot = pa.getHotWorkflows(1);
        assert.ok(hot[0].count >= 1);
        assert.ok(hot[0].frequency > 0);
    });
});

describe("patternAnalyzer — getPatternStats", () => {
    beforeEach(() => pa.reset());

    it("returns zero stats when empty", () => {
        const s = pa.getPatternStats();
        assert.equal(s.totalExecutions, 0);
        assert.equal(s.failureRate, 0);
    });

    it("computes failure and success rates correctly", () => {
        for (let i = 0; i < 3; i++) pa.recordExecution(makeExec({ outcome: "success" }));
        for (let i = 0; i < 1; i++) pa.recordExecution(makeExec({ outcome: "failure" }));
        const s = pa.getPatternStats();
        assert.equal(s.totalExecutions, 4);
        assert.equal(s.failureRate, 0.25);
        assert.equal(s.successRate, 0.75);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// adaptiveLearner
// ═══════════════════════════════════════════════════════════════════════

describe("adaptiveLearner — recordRetryOutcome", () => {
    beforeEach(() => al.reset());

    it("records a successful retry without error", () => {
        assert.doesNotThrow(() => al.recordRetryOutcome({ errorType: "timeout", strategy: "fast" }, { success: true }));
    });

    it("tracks multiple outcomes for the same context", () => {
        for (let i = 0; i < 3; i++) {
            al.recordRetryOutcome({ errorType: "timeout", strategy: "fast" }, { success: true });
        }
        const stats = al.getLearningStats();
        assert.equal(stats.retryContexts, 1);
        assert.equal(stats.totalRetries, 3);
    });
});

describe("adaptiveLearner — getRetryRecommendation", () => {
    beforeEach(() => al.reset());

    it("returns insufficient_data when no history", () => {
        const r = al.getRetryRecommendation({ errorType: "timeout" });
        assert.equal(r.reason, "insufficient_data");
        assert.equal(r.recommended, null);
    });

    it("recommends the strategy with highest success rate", () => {
        // fast: 1/3 success
        al.recordRetryOutcome({ errorType: "oom", strategy: "fast" }, { success: true });
        al.recordRetryOutcome({ errorType: "oom", strategy: "fast" }, { success: false });
        al.recordRetryOutcome({ errorType: "oom", strategy: "fast" }, { success: false });
        // safe: 3/3 success
        al.recordRetryOutcome({ errorType: "oom", strategy: "safe" }, { success: true });
        al.recordRetryOutcome({ errorType: "oom", strategy: "safe" }, { success: true });
        al.recordRetryOutcome({ errorType: "oom", strategy: "safe" }, { success: true });

        const r = al.getRetryRecommendation({ errorType: "oom" });
        assert.equal(r.recommended, "safe");
        assert.ok(r.successRate > 0.5);
    });

    it("requires minimum samples before recommending", () => {
        al.recordRetryOutcome({ errorType: "rare", strategy: "fast" }, { success: true });
        const r = al.getRetryRecommendation({ errorType: "rare" });
        // 1 sample < MIN_SAMPLES_FOR_RECOMMENDATION(2) → insufficient
        assert.equal(r.reason, "insufficient_data");
    });

    it("sets high confidence when 5+ samples available", () => {
        for (let i = 0; i < 6; i++) {
            al.recordRetryOutcome({ errorType: "net", strategy: "staged" }, { success: true });
        }
        const r = al.getRetryRecommendation({ errorType: "net" });
        assert.equal(r.confidence, "high");
    });
});

describe("adaptiveLearner — recordStabilizationOutcome", () => {
    beforeEach(() => al.reset());

    it("records stabilization outcomes", () => {
        al.recordStabilizationOutcome("throttle", { healthScore: 0.9, latencyScore: 0.2, memoryScore: 0.1 }, { effective: true, recoveryMs: 500 });
        const stats = al.getLearningStats();
        assert.equal(stats.stabilContexts, 1);
        assert.equal(stats.totalStabilizations, 1);
    });
});

describe("adaptiveLearner — getBestStabilizationStrategy", () => {
    beforeEach(() => al.reset());

    it("returns no_data_for_conditions when nothing recorded", () => {
        const r = al.getBestStabilizationStrategy({ healthScore: 0.5, latencyScore: 0.5, memoryScore: 0.5 });
        assert.equal(r.strategy, null);
        assert.equal(r.reason, "no_data_for_conditions");
    });

    it("returns the strategy with highest effectiveness rate", () => {
        const cond = { healthScore: 0.9, latencyScore: 0.1, memoryScore: 0.1 };
        al.recordStabilizationOutcome("throttle", cond, { effective: true });
        al.recordStabilizationOutcome("throttle", cond, { effective: true });
        al.recordStabilizationOutcome("throttle", cond, { effective: false });
        al.recordStabilizationOutcome("rollback", cond, { effective: true });
        al.recordStabilizationOutcome("rollback", cond, { effective: true });
        al.recordStabilizationOutcome("rollback", cond, { effective: true });

        const r = al.getBestStabilizationStrategy(cond);
        assert.equal(r.strategy, "rollback");
        assert.ok(r.effectivenessRate > 0.5);
    });
});

describe("adaptiveLearner — rankRecoveryStrategies", () => {
    beforeEach(() => al.reset());

    it("returns empty when no history", () => {
        const ranked = al.rankRecoveryStrategies({});
        assert.equal(ranked.length, 0);
    });

    it("ranks strategies by effectiveness rate descending", () => {
        const cond = { healthScore: 0.7, latencyScore: 0.3, memoryScore: 0.3 };
        al.recordStabilizationOutcome("rollback", cond, { effective: true });
        al.recordStabilizationOutcome("rollback", cond, { effective: true });
        al.recordStabilizationOutcome("throttle", cond, { effective: false });
        al.recordStabilizationOutcome("throttle", cond, { effective: false });

        const ranked = al.rankRecoveryStrategies({});
        assert.equal(ranked[0].strategy, "rollback");
        assert.ok(ranked[0].effectivenessRate > ranked[ranked.length - 1].effectivenessRate);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// anomalyPredictor
// ═══════════════════════════════════════════════════════════════════════

describe("anomalyPredictor — addObservation / predictAnomaly", () => {
    beforeEach(() => ap.reset());

    it("returns insufficient_data with fewer than 3 observations", () => {
        ap.addObservation("cpu", 0.5);
        ap.addObservation("cpu", 0.6);
        const p = ap.predictAnomaly("cpu");
        assert.equal(p.predicted, false);
        assert.equal(p.reason, "insufficient_data");
    });

    it("predicts anomaly likely on steeply rising series", () => {
        for (let i = 0; i < 10; i++) ap.addObservation("cpu", 0.1 * i);
        const p = ap.predictAnomaly("cpu", { threshold: 0.8 });
        assert.equal(p.predicted, true);
        assert.equal(p.anomalyLikely, true);
        assert.ok(p.slope > 0);
    });

    it("does not predict anomaly on flat series", () => {
        for (let i = 0; i < 10; i++) ap.addObservation("mem", 0.3);
        const p = ap.predictAnomaly("mem", { threshold: 0.8 });
        assert.equal(p.anomalyLikely, false);
    });

    it("returns metric name in result", () => {
        for (let i = 0; i < 5; i++) ap.addObservation("latency", 0.1 * i);
        const p = ap.predictAnomaly("latency");
        assert.equal(p.metric, "latency");
    });

    it("confidence is high with 10+ observations", () => {
        for (let i = 0; i < 12; i++) ap.addObservation("err_rate", i * 0.05);
        const p = ap.predictAnomaly("err_rate");
        assert.equal(p.confidence, "high");
    });
});

describe("anomalyPredictor — forecastThresholdBreach", () => {
    beforeEach(() => ap.reset());

    it("returns insufficient_data for fewer than 2 observations", () => {
        ap.addObservation("q", 0.5);
        const f = ap.forecastThresholdBreach("q", 0.9);
        assert.equal(f.willBreach, false);
        assert.equal(f.reason, "insufficient_data");
    });

    it("reports already breached when current value exceeds threshold", () => {
        for (let i = 0; i < 5; i++) ap.addObservation("disk", 0.95);
        const f = ap.forecastThresholdBreach("disk", 0.9);
        assert.equal(f.willBreach, true);
        assert.equal(f.alreadyBreached, true);
    });

    it("forecasts steps to breach on rising series", () => {
        for (let i = 0; i < 8; i++) ap.addObservation("pressure", 0.1 + i * 0.05);
        const f = ap.forecastThresholdBreach("pressure", 0.9);
        assert.equal(f.willBreach, true);
        assert.ok(f.stepsAway > 0);
    });

    it("returns willBreach false on declining series", () => {
        for (let i = 0; i < 8; i++) ap.addObservation("err", 0.9 - i * 0.08);
        const f = ap.forecastThresholdBreach("err", 0.9);
        assert.equal(f.willBreach, false);
    });
});

describe("anomalyPredictor — scoreExecutionConfidence", () => {
    beforeEach(() => ap.reset());

    it("returns high confidence for healthy context", () => {
        const c = ap.scoreExecutionConfidence({ successRate: 1.0, errorRate: 0, latencyScore: 0, memoryScore: 0 });
        assert.equal(c.level, "high");
        assert.ok(c.score >= 0.85);
    });

    it("returns critical confidence for degraded context", () => {
        const c = ap.scoreExecutionConfidence({ successRate: 0.1, errorRate: 0.9, latencyScore: 0.9, memoryScore: 0.9 });
        assert.equal(c.level, "critical");
        assert.ok(c.score < 0.40);
    });

    it("includes component breakdown", () => {
        const c = ap.scoreExecutionConfidence({ successRate: 0.8, errorRate: 0.1 });
        assert.ok(c.components.successHealth != null);
        assert.ok(c.components.errorHealth != null);
    });

    it("applies anomaly penalty when active predictions exist", () => {
        for (let i = 0; i < 10; i++) ap.addObservation("cpu", 0.1 * i);
        ap.predictAnomaly("cpu", { threshold: 0.5 });
        const cBase = ap.scoreExecutionConfidence({ successRate: 0.9, errorRate: 0.05 });
        assert.ok(cBase.anomalyPenalty >= 0.05, "penalty should be at least 0.05 when one anomaly active");
    });
});

describe("anomalyPredictor — getActivePredictions", () => {
    beforeEach(() => ap.reset());

    it("returns empty when no predictions made", () => {
        assert.equal(ap.getActivePredictions().length, 0);
    });

    it("returns only predictions where anomalyLikely is true", () => {
        for (let i = 0; i < 5; i++) ap.addObservation("cpu", 0.1 * i);
        ap.predictAnomaly("cpu", { threshold: 0.3 });
        for (let i = 0; i < 5; i++) ap.addObservation("mem", 0.3);
        ap.predictAnomaly("mem", { threshold: 0.9 });

        const active = ap.getActivePredictions();
        assert.ok(active.every(p => p.anomalyLikely === true));
    });
});

// ═══════════════════════════════════════════════════════════════════════
// workloadClassifier
// ═══════════════════════════════════════════════════════════════════════

describe("workloadClassifier — classify", () => {
    beforeEach(() => wc.reset());

    it("classifies a payment workflow as high risk realtime", () => {
        const c = wc.classify({ type: "payment" });
        assert.equal(c.riskLevel, "critical");
        assert.equal(c.latencyClass, "realtime");
        assert.ok(c.overallCriticality > 0.5);
    });

    it("classifies a background_job as low risk", () => {
        const c = wc.classify({ type: "background_job" });
        assert.equal(c.riskLevel, "low");
        assert.equal(c.latencyClass, "background");
    });

    it("assigns unknown type using unknown profile", () => {
        const c = wc.classify({ type: "some_exotic_type" });
        assert.ok(["low", "medium", "high", "critical"].includes(c.riskLevel));
    });

    it("applies riskDelta to override base profile", () => {
        const baseline = wc.classify({ type: "api_call" });
        const elevated = wc.classify({ type: "api_call", riskDelta: 0.5 });
        const baselineRiskIdx = ["low", "medium", "high", "critical"].indexOf(baseline.riskLevel);
        const elevatedRiskIdx = ["low", "medium", "high", "critical"].indexOf(elevated.riskLevel);
        assert.ok(elevatedRiskIdx >= baselineRiskIdx);
    });

    it("assigns a priorityTier of 1 for high criticality", () => {
        const c = wc.classify({ type: "payment" });
        assert.equal(c.priorityTier, 1);
    });

    it("assigns priorityTier 3 for low criticality", () => {
        const c = wc.classify({ type: "background_job" });
        assert.equal(c.priorityTier, 3);
    });

    it("includes classificationId", () => {
        const c = wc.classify({ type: "auth" });
        assert.ok(c.classificationId.startsWith("cls-"));
    });
});

describe("workloadClassifier — classifyBatch", () => {
    beforeEach(() => wc.reset());

    it("classifies multiple workflows", () => {
        const results = wc.classifyBatch([
            { type: "api_call" },
            { type: "payment" },
            { type: "background_job" },
        ]);
        assert.equal(results.length, 3);
    });

    it("returns empty for empty batch", () => {
        assert.equal(wc.classifyBatch([]).length, 0);
    });
});

describe("workloadClassifier — getRiskProfile", () => {
    beforeEach(() => wc.reset());

    it("returns known profile for known type", () => {
        const p = wc.getRiskProfile("payment");
        assert.equal(p.found, true);
        assert.ok(p.risk > 0);
    });

    it("returns found:false for unknown type", () => {
        const p = wc.getRiskProfile("totally_unknown_workflow_xyz");
        assert.equal(p.found, false);
    });
});

describe("workloadClassifier — updateProfile", () => {
    beforeEach(() => wc.reset());

    it("nudges profile scores toward feedback values", () => {
        const before = wc.getRiskProfile("api_call");
        wc.updateProfile("api_call", { risk: 1.0 });
        const after = wc.getRiskProfile("api_call");
        assert.ok(after.risk > before.risk, "risk should increase after high feedback");
    });

    it("creates profile for new type", () => {
        const r = wc.updateProfile("brand_new", { risk: 0.8, latency: 0.5 });
        assert.equal(r.updated, true);
        const p = wc.getRiskProfile("brand_new");
        assert.equal(p.found, true);
    });

    it("clamps updated values to [0,1]", () => {
        wc.updateProfile("notification", { risk: 999 });
        const p = wc.getRiskProfile("notification");
        assert.ok(p.risk <= 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// incidentMemory
// ═══════════════════════════════════════════════════════════════════════

describe("incidentMemory — recordIncident", () => {
    beforeEach(() => im.reset());

    it("records incident and returns summary with id", () => {
        const s = im.recordIncident({ errorType: "oom", strategy: "safe", outcome: "resolved" });
        assert.ok(s.incidentId.startsWith("inc-"));
        assert.equal(s.errorType, "oom");
        assert.equal(s.outcome, "resolved");
    });

    it("uses provided incidentId", () => {
        const s = im.recordIncident({ incidentId: "my-inc", errorType: "timeout" });
        assert.equal(s.incidentId, "my-inc");
    });
});

describe("incidentMemory — getRelevantIncidents", () => {
    beforeEach(() => im.reset());

    it("returns empty when no incidents stored", () => {
        assert.equal(im.getRelevantIncidents({ errorType: "timeout" }).length, 0);
    });

    it("returns incidents matching context keys", () => {
        im.recordIncident({ errorType: "timeout", strategy: "safe", healthLevel: "warning", pressureLevel: "high" });
        im.recordIncident({ errorType: "oom",     strategy: "fast", healthLevel: "healthy", pressureLevel: "low" });
        const relevant = im.getRelevantIncidents({ errorType: "timeout", pressureLevel: "high" });
        assert.ok(relevant.length > 0);
        assert.ok(relevant[0].relevanceScore > 0);
    });

    it("returns top N results", () => {
        for (let i = 0; i < 10; i++) {
            im.recordIncident({ errorType: "timeout", strategy: "safe", healthLevel: "warning", pressureLevel: "high" });
        }
        const relevant = im.getRelevantIncidents({ errorType: "timeout" }, 3);
        assert.ok(relevant.length <= 3);
    });

    it("filters out non-matching incidents", () => {
        im.recordIncident({ errorType: "disk_full", strategy: "rollback" });
        const relevant = im.getRelevantIncidents({ errorType: "timeout" });
        assert.equal(relevant.length, 0);
    });
});

describe("incidentMemory — evolvePacingPolicy", () => {
    beforeEach(() => im.reset());

    it("returns an evolved policy with required fields", () => {
        const policy = im.evolvePacingPolicy([], []);
        assert.equal(policy.evolved, true);
        assert.ok(policy.recommendedPaceMs > 0);
        assert.ok(policy.maxConcurrency > 0);
        assert.ok(typeof policy.strategy === "string");
    });

    it("recommends fast strategy when healthy telemetry and high success", () => {
        const telemetry = Array.from({ length: 10 }, () => ({ healthScore: 0.95, pressureScore: 0.1 }));
        const outcomes  = Array.from({ length: 10 }, () => ({ success: true }));
        const policy = im.evolvePacingPolicy(telemetry, outcomes);
        assert.equal(policy.strategy, "fast");
        assert.ok(policy.maxConcurrency >= 5);
    });

    it("recommends recovery_first under heavy pressure", () => {
        const telemetry = Array.from({ length: 10 }, () => ({ healthScore: 0.4, pressureScore: 0.85 }));
        const outcomes  = Array.from({ length: 10 }, () => ({ success: false }));
        const policy = im.evolvePacingPolicy(telemetry, outcomes);
        assert.equal(policy.strategy, "recovery_first");
    });

    it("includes basis stats", () => {
        const telemetry = [{ healthScore: 0.8, pressureScore: 0.2 }];
        const policy = im.evolvePacingPolicy(telemetry, [{ success: true }]);
        assert.ok(policy.basis.avgHealth != null);
        assert.ok(policy.basis.avgPressure != null);
        assert.ok(policy.basis.successRate != null);
    });
});

describe("incidentMemory — recommendAction", () => {
    beforeEach(() => im.reset());

    it("returns an action recommendation", () => {
        const r = im.recommendAction({ pressureLevel: "low", healthLevel: "healthy" });
        assert.ok(typeof r.action === "string");
        assert.ok(r.confidence > 0);
    });

    it("recommends halt_and_escalate for critical pressure and critical health", () => {
        const r = im.recommendAction({ pressureLevel: "critical", healthLevel: "critical" });
        assert.equal(r.action, "halt_and_escalate");
    });

    it("recommends normal_execution for low pressure healthy system", () => {
        const r = im.recommendAction({ pressureLevel: "low", healthLevel: "healthy" });
        assert.equal(r.action, "normal_execution");
    });

    it("includes historicalSupport count", () => {
        im.recordIncident({ pressureLevel: "high", healthLevel: "degraded", outcome: "resolved" });
        const r = im.recommendAction({ pressureLevel: "high", healthLevel: "degraded" });
        assert.ok(r.historicalSupport >= 0);
    });

    it("includes resolvedRate when historical incidents exist", () => {
        im.recordIncident({ pressureLevel: "medium", healthLevel: "warning", outcome: "resolved" });
        const r = im.recommendAction({ pressureLevel: "medium", healthLevel: "warning" });
        if (r.historicalSupport > 0) {
            assert.ok(r.resolvedRate != null);
        }
    });
});

describe("incidentMemory — getMemoryStats", () => {
    beforeEach(() => im.reset());

    it("returns zero stats when empty", () => {
        const s = im.getMemoryStats();
        assert.equal(s.totalIncidents, 0);
        assert.equal(s.resolvedRate, 0);
    });

    it("counts resolved incidents correctly", () => {
        im.recordIncident({ outcome: "resolved" });
        im.recordIncident({ outcome: "resolved" });
        im.recordIncident({ outcome: "escalated" });
        const s = im.getMemoryStats();
        assert.equal(s.totalIncidents, 3);
        assert.ok(Math.abs(s.resolvedRate - 0.667) < 0.01);
    });

    it("reports byErrorType distribution", () => {
        im.recordIncident({ errorType: "timeout" });
        im.recordIncident({ errorType: "timeout" });
        im.recordIncident({ errorType: "oom" });
        const s = im.getMemoryStats();
        assert.equal(s.byErrorType.timeout, 2);
        assert.equal(s.byErrorType.oom, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// learningBenchmark
// ═══════════════════════════════════════════════════════════════════════

describe("learningBenchmark — scorePredictionAccuracy", () => {
    beforeEach(() => lb.reset());

    it("returns F for no predictions", () => {
        const r = lb.scorePredictionAccuracy([], []);
        assert.equal(r.grade, "F");
    });

    it("returns A for perfect binary accuracy", () => {
        const preds   = [{ anomalyLikely: true }, { anomalyLikely: false }, { anomalyLikely: true }];
        const actuals = [{ anomalyOccurred: true }, { anomalyOccurred: false }, { anomalyOccurred: true }];
        const r = lb.scorePredictionAccuracy(preds, actuals);
        assert.equal(r.grade, "A");
        assert.equal(r.binaryAccuracy, 1);
    });

    it("returns low score for random predictions", () => {
        const preds   = [{ anomalyLikely: true }, { anomalyLikely: true }, { anomalyLikely: true }];
        const actuals = [{ anomalyOccurred: false }, { anomalyOccurred: false }, { anomalyOccurred: false }];
        const r = lb.scorePredictionAccuracy(preds, actuals);
        assert.ok(r.score < 60);
    });
});

describe("learningBenchmark — scoreRecoveryEffectiveness", () => {
    beforeEach(() => lb.reset());

    it("returns F for no outcomes", () => {
        assert.equal(lb.scoreRecoveryEffectiveness([]).grade, "F");
    });

    it("returns A for 100% resolved with fast recovery", () => {
        const outcomes = Array.from({ length: 5 }, () => ({ outcome: "resolved", durationMs: 200 }));
        const r = lb.scoreRecoveryEffectiveness(outcomes);
        assert.equal(r.grade, "A");
    });

    it("penalises slow recovery (> 30s)", () => {
        const outcomes = Array.from({ length: 5 }, () => ({ outcome: "resolved", durationMs: 60000 }));
        const r = lb.scoreRecoveryEffectiveness(outcomes);
        assert.ok(r.score < 90, "slow recovery should not achieve grade A");
    });

    it("penalises unresolved outcomes", () => {
        const outcomes = Array.from({ length: 5 }, () => ({ outcome: "escalated", durationMs: 1000 }));
        const r = lb.scoreRecoveryEffectiveness(outcomes);
        assert.ok(r.resolveRate === 0);
        assert.ok(r.score < 50);
    });
});

describe("learningBenchmark — scoreRetryOptimization", () => {
    beforeEach(() => lb.reset());

    it("returns F for no history", () => {
        assert.equal(lb.scoreRetryOptimization([]).grade, "F");
    });

    it("scores A when recommendation followed and successful", () => {
        const history = Array.from({ length: 5 }, () => ({
            recommended: "safe", usedStrategy: "safe", success: true,
        }));
        const r = lb.scoreRetryOptimization(history);
        assert.ok(r.score >= 60, `expected score >= 60, got ${r.score}`);
    });

    it("scores lower when recommendation ignored", () => {
        const history = Array.from({ length: 5 }, () => ({
            recommended: "safe", usedStrategy: "fast", success: false,
        }));
        const r = lb.scoreRetryOptimization(history);
        assert.ok(r.adoptionRate === 0);
    });
});

describe("learningBenchmark — scoreAnomalyForecastPrecision", () => {
    beforeEach(() => lb.reset());

    it("returns F for no forecasts", () => {
        assert.equal(lb.scoreAnomalyForecastPrecision([], []).grade, "F");
    });

    it("returns A for perfect forecasts", () => {
        const forecasts = [{ willBreach: true }, { willBreach: false }, { willBreach: true }];
        const events    = [{ occurred: true },   { occurred: false },   { occurred: true }];
        const r = lb.scoreAnomalyForecastPrecision(forecasts, events);
        assert.equal(r.grade, "A");
        assert.equal(r.precision, 1);
        assert.equal(r.recall, 1);
    });

    it("penalises false positives (precision drops)", () => {
        const forecasts = [{ willBreach: true }, { willBreach: true }, { willBreach: true }];
        const events    = [{ occurred: true },   { occurred: false },  { occurred: false }];
        const r = lb.scoreAnomalyForecastPrecision(forecasts, events);
        assert.ok(r.precision < 1);
        assert.ok(r.fp >= 2);
    });

    it("penalises false negatives (recall drops)", () => {
        const forecasts = [{ willBreach: false }, { willBreach: false }, { willBreach: false }];
        const events    = [{ occurred: true },    { occurred: true },    { occurred: false }];
        const r = lb.scoreAnomalyForecastPrecision(forecasts, events);
        assert.ok(r.recall === 0);
    });
});

describe("learningBenchmark — scoreStabilizationEfficiency", () => {
    beforeEach(() => lb.reset());

    it("returns F for no stabilizations", () => {
        assert.equal(lb.scoreStabilizationEfficiency([]).grade, "F");
    });

    it("returns A for fast effective stabilizations", () => {
        const stabs = Array.from({ length: 5 }, () => ({ effective: true, durationMs: 500, steps: 1 }));
        const r = lb.scoreStabilizationEfficiency(stabs);
        assert.equal(r.grade, "A");
    });

    it("penalises wasteful stabilizations (> 3 steps)", () => {
        const stabs = Array.from({ length: 5 }, () => ({ effective: true, durationMs: 500, steps: 5 }));
        const r = lb.scoreStabilizationEfficiency(stabs);
        assert.ok(r.wasteRate === 1);
        assert.ok(r.score < 90);
    });

    it("penalises ineffective stabilizations", () => {
        const stabs = Array.from({ length: 5 }, () => ({ effective: false, durationMs: 500, steps: 1 }));
        const r = lb.scoreStabilizationEfficiency(stabs);
        assert.ok(r.effectRate === 0);
        assert.ok(r.score <= 50);
    });
});

describe("learningBenchmark — gradeLearningMaturity", () => {
    beforeEach(() => lb.reset());

    it("returns F for empty scores", () => {
        const r = lb.gradeLearningMaturity({});
        assert.equal(r.grade, "F");
        assert.equal(r.maturity, "no_learning");
    });

    it("returns A and autonomous_learning for all-high scores", () => {
        const r = lb.gradeLearningMaturity({ predictionAccuracy: 95, recoveryEffectiveness: 92, retryOptimization: 91 });
        assert.equal(r.grade, "A");
        assert.equal(r.maturity, "autonomous_learning");
    });

    it("returns C for mixed medium scores", () => {
        const r = lb.gradeLearningMaturity({ a: 65, b: 62, c: 63 });
        assert.equal(r.grade, "C");
        assert.equal(r.maturity, "basic_learning");
    });

    it("inputs count matches number of score values", () => {
        const r = lb.gradeLearningMaturity({ a: 80, b: 85 });
        assert.equal(r.inputs, 2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// integration — end-to-end adaptive learning pipeline
// ═══════════════════════════════════════════════════════════════════════

describe("adaptive learning pipeline — integration", () => {
    beforeEach(() => {
        pa.reset(); al.reset(); ap.reset();
        wc.reset(); im.reset(); lb.reset();
    });

    it("full pipeline: classify → learn → predict → recommend → benchmark", () => {
        // 1. Classify the workload
        const cls = wc.classify({ type: "payment" });
        assert.equal(cls.riskLevel, "critical");

        // 2. Record executions and detect patterns
        for (let i = 0; i < 5; i++) {
            pa.recordExecution({ type: "payment", strategy: "safe", outcome: "success", errorType: null });
        }
        for (let i = 0; i < 3; i++) {
            pa.recordExecution({ type: "payment", strategy: "fast", outcome: "failure", errorType: "timeout" });
        }
        const patterns = pa.detectPatterns({ minOccurrences: 3 });
        assert.ok(patterns.length > 0);

        // 3. Learn from retry outcomes
        for (let i = 0; i < 4; i++) {
            al.recordRetryOutcome({ errorType: "timeout", strategy: "fast" }, { success: false });
            al.recordRetryOutcome({ errorType: "timeout", strategy: "safe" }, { success: true });
        }
        const rec = al.getRetryRecommendation({ errorType: "timeout" });
        assert.equal(rec.recommended, "safe");

        // 4. Feed telemetry and predict anomaly
        for (let i = 0; i < 10; i++) ap.addObservation("error_rate", i * 0.08);
        const pred = ap.predictAnomaly("error_rate", { threshold: 0.7 });
        assert.equal(pred.predicted, true);

        // 5. Score execution confidence
        const conf = ap.scoreExecutionConfidence({ successRate: 0.6, errorRate: 0.3, latencyScore: 0.4, memoryScore: 0.2 });
        assert.ok(conf.score < 0.8);

        // 6. Record and retrieve incidents
        im.recordIncident({ errorType: "timeout", strategy: "fast", healthLevel: "degraded", pressureLevel: "high", outcome: "resolved" });
        const relevant = im.getRelevantIncidents({ errorType: "timeout", pressureLevel: "high" });
        assert.ok(relevant.length > 0);

        // 7. Evolve pacing policy
        const telHistory = Array.from({ length: 10 }, (_, i) => ({ healthScore: 0.9 - i * 0.02, pressureScore: 0.1 + i * 0.02 }));
        const outcomes   = Array.from({ length: 10 }, () => ({ success: true }));
        const policy = im.evolvePacingPolicy(telHistory, outcomes);
        assert.equal(policy.evolved, true);

        // 8. Recommend action
        const action = im.recommendAction({ pressureLevel: "high", healthLevel: "degraded" });
        assert.ok(action.action.length > 0);

        // 9. Benchmark the learning
        const benchScores = {
            predictionAccuracy:    lb.scorePredictionAccuracy(
                [{ anomalyLikely: true }], [{ anomalyOccurred: true }]
            ).score,
            recoveryEffectiveness: lb.scoreRecoveryEffectiveness(
                [{ outcome: "resolved", durationMs: 800 }]
            ).score,
            stabilizationEfficiency: lb.scoreStabilizationEfficiency(
                [{ effective: true, durationMs: 1000, steps: 2 }]
            ).score,
        };
        const maturity = lb.gradeLearningMaturity(benchScores);
        assert.ok(["A", "B", "C", "D", "F"].includes(maturity.grade));
        assert.ok(typeof maturity.maturity === "string");
    });

    it("pattern clustering groups related incidents correctly", () => {
        const execs = [
            { id: "i1", fingerprint: "payment:fast:timeout", outcome: "failure" },
            { id: "i2", fingerprint: "payment:fast:timeout", outcome: "failure" },
            { id: "i3", fingerprint: "payment:safe:oom",     outcome: "failure" },
            { id: "i4", fingerprint: "api_call:fast:net",    outcome: "failure" },
        ];
        const clusters = pa.clusterFingerprints(execs);
        assert.ok(clusters.length >= 2, "should have at least 2 distinct clusters");
        const largestCluster = clusters.sort((a, b) => b.size - a.size)[0];
        assert.ok(largestCluster.size >= 2);
    });

    it("benchmark maturity grades all levels correctly", () => {
        const levels = [
            { scores: { a: 92, b: 91 },         grade: "A", maturity: "autonomous_learning"  },
            { scores: { a: 78, b: 76 },         grade: "B", maturity: "adaptive_learning"    },
            { scores: { a: 62, b: 63 },         grade: "C", maturity: "basic_learning"       },
            { scores: { a: 42, b: 43 },         grade: "D", maturity: "reactive_only"        },
            { scores: { a: 20, b: 25 },         grade: "F", maturity: "no_learning"          },
        ];
        for (const { scores, grade, maturity } of levels) {
            const r = lb.gradeLearningMaturity(scores);
            assert.equal(r.grade, grade, `expected ${grade} for avg ${Object.values(scores).reduce((s,v)=>s+v,0)/2}`);
            assert.equal(r.maturity, maturity);
        }
    });
});
