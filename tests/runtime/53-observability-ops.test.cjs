"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ao  = require("../../agents/runtime/observability/adaptiveOptimizer.cjs");
const tl  = require("../../agents/runtime/observability/observabilityTimeline.cjs");
const ta  = require("../../agents/runtime/observability/throughputAnalytics.cjs");
const om  = require("../../agents/runtime/observability/optimizationMemory.cjs");
const re  = require("../../agents/runtime/observability/recommendationEngine.cjs");

afterEach(() => om.reset());

// ── helpers ───────────────────────────────────────────────────────────

function _entry(fp, success, retries = 0, rollback = false, durationMs = 100, strategy = "safe") {
    return {
        fingerprint: fp,
        success,
        retryCount:  retries,
        rollbackTriggered: rollback,
        durationMs,
        strategy,
        stepsSpawned: 2,
        state: success ? "completed" : "failed",
        ts: new Date().toISOString(),
    };
}

// ── adaptiveOptimizer ─────────────────────────────────────────────────

describe("adaptiveOptimizer – optimizeRetryPolicy", () => {
    it("returns adjusted:false for unknown fingerprint", () => {
        const r = ao.optimizeRetryPolicy("fp-unknown", [], { maxRetries: 3 });
        assert.ok(!r.adjusted);
        assert.equal(r.maxRetries, 3);
    });

    it("reduces maxRetries for high-retry low-success fingerprint", () => {
        const entries = [
            _entry("fp-bad", false, 5),
            _entry("fp-bad", false, 4),
            _entry("fp-bad", false, 5),
        ];
        const r = ao.optimizeRetryPolicy("fp-bad", entries, { maxRetries: 3 });
        assert.ok(r.adjusted);
        assert.ok(r.maxRetries < 3);
    });

    it("never reduces below 1", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp-x", false, 10));
        const r = ao.optimizeRetryPolicy("fp-x", entries, { maxRetries: 1 });
        assert.ok(r.maxRetries >= 1);
    });
});

describe("adaptiveOptimizer – prioritizeWorkflows", () => {
    it("returns empty for no fingerprints", () => {
        assert.equal(ao.prioritizeWorkflows([], []).length, 0);
    });

    it("higher success rate ranks first", () => {
        const entries = [
            _entry("fp-good", true), _entry("fp-good", true),
            _entry("fp-bad",  false), _entry("fp-bad", false),
        ];
        const r = ao.prioritizeWorkflows(["fp-good", "fp-bad"], entries);
        assert.equal(r[0].fingerprint, "fp-good");
    });

    it("each result has successRate and avgDurationMs", () => {
        const entries = [_entry("fp-a", true, 0, false, 200)];
        const r = ao.prioritizeWorkflows(["fp-a"], entries);
        assert.ok("successRate"   in r[0]);
        assert.ok("avgDurationMs" in r[0]);
    });
});

describe("adaptiveOptimizer – downgradeStrategy", () => {
    it("does not downgrade with no bottlenecks", () => {
        const r = ao.downgradeStrategy("fast", {});
        assert.ok(!r.downgraded);
        assert.equal(r.strategy, "fast");
    });

    it("downgrades fast when rollback zones detected", () => {
        const r = ao.downgradeStrategy("fast", { rollbackZones: [{ fingerprint: "fp1" }] });
        assert.ok(r.downgraded);
        assert.notEqual(r.strategy, "fast");
    });

    it("floor is sandbox", () => {
        const bottlenecks = { rollbackZones: [{}], unstableTools: [{}], retryHeavySteps: [{}] };
        let s = "sandbox";
        const r = ao.downgradeStrategy(s, bottlenecks);
        assert.equal(r.strategy, "sandbox");
    });

    it("includes reasons array", () => {
        const r = ao.downgradeStrategy("safe", { unstableTools: [{}] });
        assert.ok(Array.isArray(r.reasons));
    });
});

describe("adaptiveOptimizer – tuneRetryBudget", () => {
    it("safe classification has base budget 3", () => {
        assert.equal(ao.tuneRetryBudget("safe", {}).retryBudget, 3);
    });

    it("reduces budget for retry-heavy bottleneck", () => {
        const r = ao.tuneRetryBudget("safe", { retryHeavySteps: [{}] });
        assert.ok(r.retryBudget < 3);
    });

    it("never goes below 0", () => {
        const bottlenecks = { retryHeavySteps: [{}], rollbackZones: [{}] };
        const r = ao.tuneRetryBudget("destructive", bottlenecks);
        assert.ok(r.retryBudget >= 0);
    });

    it("includes adjustments array", () => {
        const r = ao.tuneRetryBudget("safe", { retryHeavySteps: [{}] });
        assert.ok(Array.isArray(r.adjustments));
    });
});

describe("adaptiveOptimizer – optimize", () => {
    it("returns all keys", () => {
        const r = ao.optimize({ entries: [], depStability: {}, bottlenecks: {} });
        assert.ok("retryPolicies"        in r);
        assert.ok("prioritizedWorkflows" in r);
        assert.ok("strategyDowngrade"    in r);
        assert.ok("retryBudget"          in r);
        assert.ok("saferModeRecs"        in r);
    });

    it("saferModeRecs suggests sandbox for high-rollback fingerprint", () => {
        const entries = [
            _entry("fp-risky", false, 0, true),
            _entry("fp-risky", false, 0, true),
            _entry("fp-risky", true,  0, false),
        ];
        const r = ao.optimize({ entries, bottlenecks: {} });
        assert.ok(r.saferModeRecs.some(x => x.fingerprint === "fp-risky"));
    });
});

// ── observabilityTimeline ─────────────────────────────────────────────

describe("observabilityTimeline – buildExecutionHistory", () => {
    it("returns sorted entries", () => {
        const t1 = new Date(Date.now() - 1000).toISOString();
        const t2 = new Date().toISOString();
        const entries = [
            { ...(_entry("fp", true)), ts: t2 },
            { ...(_entry("fp", true)), ts: t1 },
        ];
        const r = tl.buildExecutionHistory(entries);
        assert.ok(new Date(r[0].ts) <= new Date(r[1].ts));
    });

    it("each entry has required fields", () => {
        const entries = [_entry("fp", true)];
        const r = tl.buildExecutionHistory(entries);
        for (const f of ["ts","fingerprint","success","strategy","durationMs"]) {
            assert.ok(f in r[0], `missing: ${f}`);
        }
    });
});

describe("observabilityTimeline – buildRetryTimeline", () => {
    it("only includes entries with retryCount > 0", () => {
        const entries = [_entry("fp", true, 0), _entry("fp", false, 3)];
        const r = tl.buildRetryTimeline(entries);
        assert.equal(r.length, 1);
        assert.equal(r[0].retryCount, 3);
    });
});

describe("observabilityTimeline – buildRollbackTimeline", () => {
    it("only includes entries with rollbackTriggered", () => {
        const entries = [_entry("fp", false, 0, true), _entry("fp", true, 0, false)];
        const r = tl.buildRollbackTimeline(entries);
        assert.equal(r.length, 1);
    });
});

describe("observabilityTimeline – buildStrategyTimeline", () => {
    it("records transitions when strategy changes", () => {
        const entries = [
            _entry("fp", true, 0, false, 100, "safe"),
            _entry("fp", true, 0, false, 100, "fast"),
            _entry("fp", true, 0, false, 100, "fast"),  // no transition
        ];
        const r = tl.buildStrategyTimeline(entries);
        // first entry + safe→fast transition = 2 transitions (initial null→safe, safe→fast)
        assert.ok(r.length >= 1);
        assert.ok(r.some(t => t.to === "fast"));
    });

    it("each transition has from and to fields", () => {
        const entries = [_entry("fp", true)];
        const r = tl.buildStrategyTimeline(entries);
        if (r.length > 0) {
            assert.ok("from" in r[0]);
            assert.ok("to"   in r[0]);
        }
    });
});

describe("observabilityTimeline – buildTelemetryTimeline", () => {
    it("returns sorted telemetry events", () => {
        const t1 = new Date(Date.now() - 2000).toISOString();
        const t2 = new Date().toISOString();
        const log = [
            { event: "execution_completed", ts: t2 },
            { event: "execution_started",   ts: t1 },
        ];
        const r = tl.buildTelemetryTimeline(log);
        assert.equal(r[0].event, "execution_started");
    });
});

describe("observabilityTimeline – buildAll", () => {
    it("returns all 5 timeline types", () => {
        const r = tl.buildAll([], []);
        assert.ok("executionHistory"  in r);
        assert.ok("retryTimeline"     in r);
        assert.ok("rollbackTimeline"  in r);
        assert.ok("strategyTimeline"  in r);
        assert.ok("telemetryTimeline" in r);
    });

    it("includes generatedAt timestamp", () => {
        const r = tl.buildAll([], []);
        assert.ok(typeof r.generatedAt === "string");
    });

    it("entryCount matches input", () => {
        const entries = [_entry("fp", true), _entry("fp", false)];
        assert.equal(tl.buildAll(entries, []).entryCount, 2);
    });
});

// ── throughputAnalytics ───────────────────────────────────────────────

describe("throughputAnalytics – calcSuccessRatio", () => {
    it("returns ratio 0 for empty entries", () => {
        assert.equal(ta.calcSuccessRatio([]).ratio, 0);
    });

    it("calculates correct ratio", () => {
        const entries = [_entry("fp", true), _entry("fp", false), _entry("fp", true)];
        const r = ta.calcSuccessRatio(entries);
        assert.ok(Math.abs(r.ratio - 2/3) < 0.001);
    });

    it("includes success, failure, total", () => {
        const r = ta.calcSuccessRatio([_entry("fp", true), _entry("fp", false)]);
        assert.equal(r.success, 1);
        assert.equal(r.failure, 1);
        assert.equal(r.total,   2);
    });
});

describe("throughputAnalytics – calcAverageRecoveryCost", () => {
    it("returns 0 for empty entries", () => {
        assert.equal(ta.calcAverageRecoveryCost([]).avgCostMs, 0);
    });

    it("retries and rollbacks add cost", () => {
        const entries = [_entry("fp", false, 3, true)];
        const r = ta.calcAverageRecoveryCost(entries);
        assert.ok(r.avgCostMs > 0);
    });
});

describe("throughputAnalytics – calcVerificationPassRate", () => {
    it("returns 0 for empty entries", () => {
        assert.equal(ta.calcVerificationPassRate([]).passRate, 0);
    });

    it("success without rollback = passed", () => {
        const entries = [_entry("fp", true, 0, false), _entry("fp", false, 0, true)];
        const r = ta.calcVerificationPassRate(entries);
        assert.equal(r.passed, 1);
    });
});

describe("throughputAnalytics – calcSandboxUsage", () => {
    it("returns 0 for non-sandbox entries", () => {
        const entries = [_entry("fp", true, 0, false, 100, "safe")];
        assert.equal(ta.calcSandboxUsage(entries).usageRate, 0);
    });

    it("counts sandbox strategy entries", () => {
        const entries = [
            _entry("fp", true, 0, false, 100, "sandbox"),
            _entry("fp", true, 0, false, 100, "safe"),
        ];
        const r = ta.calcSandboxUsage(entries);
        assert.equal(r.sandboxed, 1);
        assert.equal(r.usageRate, 0.5);
    });
});

describe("throughputAnalytics – calcGovernanceBlockRate", () => {
    it("returns 0 when no governance blocks", () => {
        const entries = [_entry("fp", true)];
        assert.equal(ta.calcGovernanceBlockRate(entries).blockRate, 0);
    });

    it("counts governed:true entries", () => {
        const entries = [
            { ...(_entry("fp", false)), governed: true },
            _entry("fp", true),
        ];
        const r = ta.calcGovernanceBlockRate(entries);
        assert.equal(r.blocked, 1);
        assert.equal(r.blockRate, 0.5);
    });
});

describe("throughputAnalytics – compute", () => {
    it("returns all analytics keys", () => {
        const r = ta.compute([]);
        assert.ok("successRatio"         in r);
        assert.ok("averageRecoveryCost"  in r);
        assert.ok("verificationPassRate" in r);
        assert.ok("sandboxUsage"         in r);
        assert.ok("governanceBlockRate"  in r);
    });
});

// ── optimizationMemory ────────────────────────────────────────────────

describe("optimizationMemory – strategy performance", () => {
    it("getBestStrategy returns null for unknown fingerprint", () => {
        assert.equal(om.getBestStrategy("unknown"), null);
    });

    it("returns best strategy by success rate", () => {
        om.recordStrategyPerformance("fp1", "safe",    true,  200);
        om.recordStrategyPerformance("fp1", "safe",    true,  200);
        om.recordStrategyPerformance("fp1", "sandbox", false, 500);
        assert.equal(om.getBestStrategy("fp1"), "safe");
    });

    it("records multiple strategies", () => {
        om.recordStrategyPerformance("fp2", "fast",   true, 100);
        om.recordStrategyPerformance("fp2", "staged", true, 300);
        const best = om.getBestStrategy("fp2");
        assert.ok(["fast", "staged"].includes(best));
    });
});

describe("optimizationMemory – high-risk flagging", () => {
    it("flagHighRisk adds fingerprint to high-risk list", () => {
        om.flagHighRisk("fp-risk", "rollback_cycle");
        assert.ok(om.isHighRisk("fp-risk"));
    });

    it("unflagHighRisk removes it", () => {
        om.flagHighRisk("fp-risk2", "rollback_cycle");
        om.unflagHighRisk("fp-risk2");
        assert.ok(!om.isHighRisk("fp-risk2"));
    });

    it("getHighRiskFingerprints returns all flagged", () => {
        om.flagHighRisk("fp-a", "a");
        om.flagHighRisk("fp-b", "b");
        const r = om.getHighRiskFingerprints();
        assert.ok(r.some(x => x.fingerprint === "fp-a"));
        assert.ok(r.some(x => x.fingerprint === "fp-b"));
    });

    it("each entry has reason and flaggedAt", () => {
        om.flagHighRisk("fp-c", "test_reason");
        const r = om.getHighRiskFingerprints();
        assert.ok("reason"    in r[0]);
        assert.ok("flaggedAt" in r[0]);
    });
});

describe("optimizationMemory – recovery effectiveness", () => {
    it("getRecoveryRate returns null for unknown fingerprint", () => {
        assert.equal(om.getRecoveryRate("unknown"), null);
    });

    it("calculates recovery rate correctly", () => {
        om.recordRecoveryEffectiveness("fp-rec", true);
        om.recordRecoveryEffectiveness("fp-rec", false);
        assert.equal(om.getRecoveryRate("fp-rec"), 0.5);
    });
});

describe("optimizationMemory – dep degradation trends", () => {
    it("getDepTrend returns stable for single record", () => {
        om.recordDepDegradation("dep-a", 0.9);
        assert.equal(om.getDepTrend("dep-a").trend, "stable");
    });

    it("detects degrading trend", () => {
        om.recordDepDegradation("dep-b", 0.9);
        om.recordDepDegradation("dep-b", 0.7);
        om.recordDepDegradation("dep-b", 0.5);
        assert.equal(om.getDepTrend("dep-b").trend, "degrading");
    });

    it("detects improving trend", () => {
        om.recordDepDegradation("dep-c", 0.3);
        om.recordDepDegradation("dep-c", 0.6);
        om.recordDepDegradation("dep-c", 0.8);
        assert.equal(om.getDepTrend("dep-c").trend, "improving");
    });

    it("getAllDepTrends returns object with depId keys", () => {
        om.recordDepDegradation("dep-x", 0.5);
        om.recordDepDegradation("dep-y", 0.8);
        const r = om.getAllDepTrends();
        assert.ok("dep-x" in r);
        assert.ok("dep-y" in r);
    });
});

// ── recommendationEngine ──────────────────────────────────────────────

describe("recommendationEngine – generateRetryReductions", () => {
    it("returns empty for no bottlenecks", () => {
        assert.equal(re.generateRetryReductions({}, []).length, 0);
    });

    it("generates recommendation for retry-heavy fingerprint", () => {
        const bottlenecks = { retryHeavySteps: [{ fingerprint: "fp-r", avgRetries: 4 }] };
        const r = re.generateRetryReductions(bottlenecks, []);
        assert.ok(r.some(x => x.type === "retry_reduction" && x.fingerprint === "fp-r"));
    });

    it("suggested maxRetries is at least 1", () => {
        const bottlenecks = { retryHeavySteps: [{ fingerprint: "fp-s", avgRetries: 10 }] };
        const r = re.generateRetryReductions(bottlenecks, []);
        assert.ok(r[0].suggested >= 1);
    });
});

describe("recommendationEngine – generateSandboxRecommendations", () => {
    it("recommends sandbox when health score < 60", () => {
        const healthScore = { overall: { score: 45 } };
        const r = re.generateSandboxRecommendations(healthScore, []);
        assert.ok(r.some(x => x.type === "sandbox_recommendation"));
    });

    it("no general sandbox rec when health is good", () => {
        const healthScore = { overall: { score: 90 } };
        const r = re.generateSandboxRecommendations(healthScore, []);
        // Only fingerprt-level recs possible
        assert.ok(!r.some(x => x.type === "sandbox_recommendation" && !x.fingerprint));
    });

    it("recommends sandbox for high-rollback fingerprint", () => {
        const entries = [
            _entry("fp-rb", false, 0, true),
            _entry("fp-rb", false, 0, true),
            _entry("fp-rb", true,  0, false),
        ];
        const r = re.generateSandboxRecommendations({ overall: { score: 80 } }, entries);
        assert.ok(r.some(x => x.fingerprint === "fp-rb"));
    });
});

describe("recommendationEngine – generateDepWarnings", () => {
    it("returns empty for no degradation", () => {
        assert.equal(re.generateDepWarnings({}).length, 0);
    });

    it("generates warning for degrading dep", () => {
        const deg = { "dep-a": { trend: "degrading", first: 0.9, last: 0.4, delta: -0.5 } };
        const r = re.generateDepWarnings(deg);
        assert.ok(r.some(x => x.type === "dep_stabilization_warning" && x.depId === "dep-a"));
    });

    it("does not warn for stable deps", () => {
        const deg = { "dep-b": { trend: "stable", first: 0.9, last: 0.9, delta: 0 } };
        assert.equal(re.generateDepWarnings(deg).length, 0);
    });
});

describe("recommendationEngine – generateWorkflowRedesigns", () => {
    it("returns empty for no anomalies", () => {
        assert.equal(re.generateWorkflowRedesigns([], []).length, 0);
    });

    it("recommends redesign for repeated_loop", () => {
        const anomalies = [{ type: "repeated_loop", fingerprint: "fp-loop", executions: 5, timeSpanMs: 1000 }];
        const r = re.generateWorkflowRedesigns(anomalies, []);
        assert.ok(r.some(x => x.type === "workflow_redesign" && x.fingerprint === "fp-loop"));
    });

    it("recommends redesign for rollback_cycle", () => {
        const anomalies = [{ type: "rollback_cycle", fingerprint: "fp-cycle" }];
        const r = re.generateWorkflowRedesigns(anomalies, []);
        assert.ok(r.some(x => x.type === "workflow_redesign"));
    });
});

describe("recommendationEngine – generate", () => {
    it("returns recommendations, count, highPriority, ts", () => {
        const r = re.generate({});
        assert.ok("recommendations" in r);
        assert.ok("count"           in r);
        assert.ok("highPriority"    in r);
        assert.ok("ts"              in r);
    });

    it("empty context produces no recommendations", () => {
        assert.equal(re.generate({}).count, 0);
    });

    it("high priority items appear first", () => {
        const bottlenecks = { retryHeavySteps: [{ fingerprint: "fp-r", avgRetries: 5 }] };
        const healthScore = { overall: { score: 40 } };
        const r = re.generate({ bottlenecks, healthScore });
        if (r.count > 1) {
            const priorities = r.recommendations.map(x => x.priority);
            const ORDER = { high: 0, medium: 1, low: 2 };
            for (let i = 0; i < priorities.length - 1; i++) {
                assert.ok((ORDER[priorities[i]] ?? 2) <= (ORDER[priorities[i + 1]] ?? 2));
            }
        }
    });
});
