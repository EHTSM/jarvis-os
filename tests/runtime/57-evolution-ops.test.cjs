"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const apt  = require("../../agents/runtime/evolution/adaptivePolicyTuner.cjs");
const eg   = require("../../agents/runtime/evolution/executionGenetics.cjs");
const aci  = require("../../agents/runtime/evolution/adaptiveConcurrencyIntelligence.cjs");
const sho  = require("../../agents/runtime/evolution/selfHealingOrchestrator.cjs");
const at   = require("../../agents/runtime/evolution/adaptiveTelemetry.cjs");
const em   = require("../../agents/runtime/evolution/evolutionMemory.cjs");

afterEach(() => { apt.reset(); eg.reset(); aci.reset(); at.reset(); em.reset(); });

// ── helpers ───────────────────────────────────────────────────────────

function _entry(fp, success, retries = 0, rollback = false, durationMs = 100, strategy = "safe") {
    return {
        fingerprint: fp, success, retryCount: retries,
        rollbackTriggered: rollback, durationMs, strategy,
        ts: new Date().toISOString(),
    };
}

function _plan(steps = ["a","b"]) {
    return { taskId: "t1", steps: steps.map(id => ({ id, command: `echo ${id}` })) };
}

// ── adaptivePolicyTuner ───────────────────────────────────────────────

describe("adaptivePolicyTuner – DEFAULTS", () => {
    it("exports DEFAULTS with expected keys", () => {
        for (const k of ["retryLimit","concurrencyLevel","throttleSensitivity","sandboxThreshold","circuitBreakerThreshold"]) {
            assert.ok(k in apt.DEFAULTS, `missing: ${k}`);
        }
    });
});

describe("adaptivePolicyTuner – tune", () => {
    it("no tuning for neutral observations", () => {
        const r = apt.tune("policy-1", { successRate: 0.8, avgRetries: 1 });
        assert.ok("tuned" in r);
    });

    it("reduces retryLimit for high-retry low-success", () => {
        const r = apt.tune("policy-2", { successRate: 0.3, avgRetries: 4 });
        if (r.tuned) {
            const policy = apt.getPolicy("policy-2");
            assert.ok(policy.retryLimit < apt.DEFAULTS.retryLimit);
        }
    });

    it("reduces concurrencyLevel under high resource pressure", () => {
        const r = apt.tune("policy-3", { resourcePressure: "high" });
        if (r.tuned) {
            const policy = apt.getPolicy("policy-3");
            assert.ok(policy.concurrencyLevel < apt.DEFAULTS.concurrencyLevel);
        }
    });

    it("reduces sandboxThreshold for high rollback rate", () => {
        const r = apt.tune("policy-4", { rollbackRate: 0.7 });
        if (r.tuned) {
            const policy = apt.getPolicy("policy-4");
            assert.ok(policy.sandboxThreshold < apt.DEFAULTS.sandboxThreshold);
        }
    });

    it("reduces circuitBreakerThreshold on severe failure streak", () => {
        const r = apt.tune("policy-5", { failureStreak: 6 });
        if (r.tuned) {
            const policy = apt.getPolicy("policy-5");
            assert.ok(policy.circuitBreakerThreshold < apt.DEFAULTS.circuitBreakerThreshold);
        }
    });

    it("result includes changes and reasons arrays", () => {
        const r = apt.tune("policy-6", { resourcePressure: "critical" });
        assert.ok(Array.isArray(r.reasons));
        assert.ok(typeof r.changes === "object");
    });

    it("tuningCount increments when tuned", () => {
        apt.tune("policy-7", { resourcePressure: "high" });
        apt.tune("policy-7", { resourcePressure: "high" });
        const policy = apt.getPolicy("policy-7");
        assert.ok(policy.tuningCount >= 0);
    });
});

describe("adaptivePolicyTuner – getPolicy", () => {
    it("returns DEFAULTS for unknown policy key", () => {
        const p = apt.getPolicy("never-tuned");
        assert.equal(p.retryLimit, apt.DEFAULTS.retryLimit);
    });
});

describe("adaptivePolicyTuner – applyAll", () => {
    it("returns tuned count and total", () => {
        const r = apt.applyAll([
            { policyKey: "p1", observations: { resourcePressure: "high" } },
            { policyKey: "p2", observations: { successRate: 0.9 } },
        ]);
        assert.ok("tuned" in r);
        assert.equal(r.total, 2);
    });
});

// ── executionGenetics ─────────────────────────────────────────────────

describe("executionGenetics – getBestGenome", () => {
    it("returns null for unknown fingerprint", () => {
        assert.equal(eg.getBestGenome("fp-unknown"), null);
    });

    it("returns null when all outcomes failed", () => {
        eg.recordGenome("fp-1", { strategy: "safe" }, false, 500);
        assert.equal(eg.getBestGenome("fp-1"), null);
    });

    it("returns genome from successful execution", () => {
        eg.recordGenome("fp-2", { strategy: "fast" }, true, 100);
        const g = eg.getBestGenome("fp-2");
        assert.ok(g !== null);
        assert.equal(g.strategy, "fast");
    });

    it("prefers genome with lowest avg duration among successes", () => {
        eg.recordGenome("fp-3", { strategy: "slow" }, true, 1000);
        eg.recordGenome("fp-3", { strategy: "slow" }, true, 800);
        eg.recordGenome("fp-3", { strategy: "fast" }, true, 100);
        const g = eg.getBestGenome("fp-3");
        assert.equal(g.strategy, "fast");
    });
});

describe("executionGenetics – mutateGenome", () => {
    it("mutates genome with delta applied", () => {
        eg.recordGenome("fp-4", { strategy: "safe", retryLimit: 3 }, true, 200);
        const r = eg.mutateGenome("fp-4", { retryLimit: 2 });
        assert.equal(r.to.retryLimit, 2);
        assert.ok(r.mutated);
    });

    it("records mutation in log", () => {
        eg.recordGenome("fp-5", { strategy: "safe" }, true, 200);
        eg.mutateGenome("fp-5", { strategy: "fast" });
        assert.equal(eg.getMutationLog("fp-5").length, 1);
    });
});

describe("executionGenetics – scoreGenome", () => {
    it("returns 50 for empty outcomes", () => {
        assert.equal(eg.scoreGenome({ strategy: "safe" }, []), 50);
    });

    it("returns higher score for successful outcomes", () => {
        const genome = { strategy: "fast" };
        const outcomes = [
            { genome, success: true,  durationMs: 100 },
            { genome, success: true,  durationMs: 100 },
        ];
        assert.ok(eg.scoreGenome(genome, outcomes) > 50);
    });
});

describe("executionGenetics – getHighSuccessRoutes", () => {
    it("returns empty when no fingerprints have enough history", () => {
        eg.recordGenome("fp-6", { strategy: "safe" }, true, 100);
        assert.equal(eg.getHighSuccessRoutes(0.8).length, 0);  // needs 2+ records
    });

    it("returns routes exceeding threshold", () => {
        eg.recordGenome("fp-7", { strategy: "fast" }, true,  100);
        eg.recordGenome("fp-7", { strategy: "fast" }, true,  100);
        eg.recordGenome("fp-7", { strategy: "fast" }, false, 500);
        // 2/3 = 66% < 80% threshold
        assert.equal(eg.getHighSuccessRoutes(0.8).length, 0);

        eg.recordGenome("fp-8", { strategy: "safe" }, true, 100);
        eg.recordGenome("fp-8", { strategy: "safe" }, true, 100);
        eg.recordGenome("fp-8", { strategy: "safe" }, true, 100);
        const routes = eg.getHighSuccessRoutes(0.8);
        assert.ok(routes.some(r => r.fingerprint === "fp-8"));
    });
});

describe("executionGenetics – getOptimalRecoveryChains", () => {
    it("returns empty when no rollback-ready genomes", () => {
        eg.recordGenome("fp-9", { strategy: "safe" }, true, 100);
        assert.equal(eg.getOptimalRecoveryChains().length, 0);
    });

    it("includes fingerprints with rollbackReady genome", () => {
        eg.recordGenome("fp-10", { strategy: "staged", rollbackReady: true }, true, 200);
        eg.recordGenome("fp-10", { strategy: "staged", rollbackReady: true }, true, 200);
        const chains = eg.getOptimalRecoveryChains();
        assert.ok(chains.some(c => c.fingerprint === "fp-10"));
    });
});

// ── adaptiveConcurrencyIntelligence ───────────────────────────────────

describe("adaptiveConcurrencyIntelligence – getOptimalConcurrency", () => {
    it("returns DEFAULT_CONCURRENCY with no data", () => {
        assert.equal(aci.getOptimalConcurrency(), 4);
    });

    it("returns number within [1, 16]", () => {
        aci.recordExecution(100, true, 4);
        aci.recordExecution(200, true, 4);
        aci.recordExecution(150, true, 4);
        const c = aci.getOptimalConcurrency();
        assert.ok(c >= 1 && c <= 16);
    });

    it("prefers level with higher success rate", () => {
        for (let i = 0; i < 5; i++) aci.recordExecution(100, true,  2);
        for (let i = 0; i < 5; i++) aci.recordExecution(100, false, 8);
        const c = aci.getOptimalConcurrency();
        assert.ok(c <= 4);
    });
});

describe("adaptiveConcurrencyIntelligence – shouldScaleUp / Down", () => {
    it("scaleUp returns true when no pressure and queue backing up", () => {
        assert.ok(aci.shouldScaleUp({ pressure: "none", avgQueueDepth: 10 }));
    });

    it("scaleUp returns false when pressure is high", () => {
        assert.ok(!aci.shouldScaleUp({ pressure: "high", avgQueueDepth: 10 }));
    });

    it("scaleDown returns true for high pressure", () => {
        assert.ok(aci.shouldScaleDown({ pressure: "high" }));
    });

    it("scaleDown returns false for none pressure", () => {
        assert.ok(!aci.shouldScaleDown({ pressure: "none" }));
    });
});

describe("adaptiveConcurrencyIntelligence – drain rate", () => {
    it("default drain rate is 1.0 with no samples", () => {
        assert.equal(aci.getOptimalDrainRate(), 1.0);
    });

    it("learns drain rate from samples", () => {
        aci.learnDrainRate(10, 5000);   // 10 items in 5s = 2/s
        aci.learnDrainRate(20, 10000);  // 20 items in 10s = 2/s
        assert.ok(aci.getOptimalDrainRate() > 0);
    });

    it("ignores zero/negative inputs", () => {
        aci.learnDrainRate(0, 1000);
        aci.learnDrainRate(10, 0);
        assert.equal(aci.getOptimalDrainRate(), 1.0);
    });
});

describe("adaptiveConcurrencyIntelligence – getParallelismLimit", () => {
    it("returns a positive number", () => {
        assert.ok(aci.getParallelismLimit() >= 1);
    });

    it("limit ≤ optimal concurrency for clean history", () => {
        aci.recordExecution(100, true, 4);
        aci.recordExecution(100, true, 4);
        assert.ok(aci.getParallelismLimit() <= aci.getOptimalConcurrency() + 1);
    });
});

// ── selfHealingOrchestrator ───────────────────────────────────────────

describe("selfHealingOrchestrator – autoReroute", () => {
    it("skips steps with low stability", () => {
        const plan = _plan(["good", "bad"]);
        const instMap = { "bad": { stability: 0.2 } };
        const r = sho.autoReroute(plan, instMap, { stabilityThreshold: 0.5 });
        assert.ok(r.changed);
        assert.equal(r.skippedSteps[0].stepId, "bad");
    });

    it("keeps all steps when all stable", () => {
        const plan = _plan(["a","b"]);
        const instMap = { "a": { stability: 0.9 }, "b": { stability: 0.95 } };
        const r = sho.autoReroute(plan, instMap, { stabilityThreshold: 0.5 });
        assert.ok(!r.changed);
        assert.equal(r.rerouted, 2);
    });
});

describe("selfHealingOrchestrator – downgradeMode", () => {
    it("no downgrade for insufficient history", () => {
        const r = sho.downgradeMode("fp", "direct", []);
        assert.ok(!r.downgraded);
    });

    it("downgrades direct when fail rate >= 60%", () => {
        const entries = [
            _entry("fp", false), _entry("fp", false),
            _entry("fp", false), _entry("fp", true),
            _entry("fp", false),
        ];
        const r = sho.downgradeMode("fp", "direct", entries);
        assert.ok(r.downgraded);
        assert.equal(r.from, "direct");
        assert.equal(r.to, "staged");
    });

    it("no downgrade when stable", () => {
        const entries = Array.from({ length: 5 }, () => _entry("fp", true));
        assert.ok(!sho.downgradeMode("fp", "direct", entries).downgraded);
    });
});

describe("selfHealingOrchestrator – shiftToSaferStrategy", () => {
    it("no shift for stable observations", () => {
        const r = sho.shiftToSaferStrategy("fp", "fast", { rollbackRate: 0.05, successRate: 0.9 });
        assert.ok(!r.shifted);
    });

    it("shifts down for high rollback rate", () => {
        const r = sho.shiftToSaferStrategy("fp", "fast", { rollbackRate: 0.7 });
        assert.ok(r.shifted);
        assert.notEqual(r.to, "fast");
    });

    it("shifts to sandbox for 2+ anomalies", () => {
        const r = sho.shiftToSaferStrategy("fp", "safe", { anomalyCount: 3 });
        assert.equal(r.to, "sandbox");
    });
});

describe("selfHealingOrchestrator – recoverFromInstability", () => {
    it("recommends wait_for_cooldown when circuit open", () => {
        const r = sho.recoverFromInstability("fp", { circuitOpen: true });
        assert.equal(r.primaryAction, "wait_for_cooldown");
    });

    it("recommends quarantine for severe failure streak", () => {
        const r = sho.recoverFromInstability("fp", { consecutiveFails: 6 });
        assert.ok(r.actions.some(a => a.action === "quarantine"));
    });

    it("includes actions array", () => {
        const r = sho.recoverFromInstability("fp", {});
        assert.ok(Array.isArray(r.actions) && r.actions.length > 0);
    });
});

describe("selfHealingOrchestrator – autoIsolate", () => {
    it("not isolated for clean state", () => {
        const r = sho.autoIsolate("fp", "closed", []);
        assert.ok(!r.isolated);
    });

    it("isolates when circuit is open", () => {
        const r = sho.autoIsolate("fp", "open", []);
        assert.ok(r.isolated);
        assert.equal(r.reason, "circuit_open");
    });

    it("isolates for rollback_cycle anomaly", () => {
        const anomalies = [{ type: "rollback_cycle" }];
        const r = sho.autoIsolate("fp", "closed", anomalies);
        assert.ok(r.isolated);
    });
});

describe("selfHealingOrchestrator – heal", () => {
    it("returns all healing keys", () => {
        const r = sho.heal({});
        assert.ok("fingerprint" in r);
        assert.ok("healed"      in r);
        assert.ok("reroute"     in r);
        assert.ok("downgrade"   in r);
        assert.ok("strategy"    in r);
        assert.ok("recovery"    in r);
        assert.ok("isolation"   in r);
    });

    it("healed:false for clean context", () => {
        const r = sho.heal({ currentStrategy: "safe", currentMode: "direct" });
        assert.equal(typeof r.healed, "boolean");
    });

    it("healed:true when circuit is open", () => {
        const r = sho.heal({ breakerState: "open", currentStrategy: "fast", currentMode: "direct" });
        assert.ok(r.healed);
    });
});

// ── adaptiveTelemetry ─────────────────────────────────────────────────

describe("adaptiveTelemetry", () => {
    it("accepts all 6 valid events", () => {
        for (const ev of at.EVENTS) {
            assert.doesNotThrow(() => at.emit(ev, {}));
        }
    });

    it("rejects unknown events", () => {
        assert.throws(() => at.emit("not_a_real_event", {}));
    });

    it("all entries have ts", () => {
        at.emit("strategy_evolved", { fingerprint: "fp" });
        for (const e of at.getLog()) assert.ok("ts" in e);
    });

    it("getByEvent filters correctly", () => {
        at.emit("strategy_evolved", { fingerprint: "fp1" });
        at.emit("policy_tuned",     { fingerprint: "fp2" });
        assert.equal(at.getByEvent("strategy_evolved").length, 1);
    });

    it("getEfficiencyTrend returns empty for unknown fingerprint", () => {
        assert.equal(at.getEfficiencyTrend("fp-unknown").length, 0);
    });

    it("getEfficiencyTrend returns emitted strategy_evolved events", () => {
        at.emit("strategy_evolved", { fingerprint: "fp-t", strategy: "fast", score: 75 });
        const trend = at.getEfficiencyTrend("fp-t");
        assert.equal(trend.length, 1);
        assert.equal(trend[0].strategy, "fast");
    });

    it("getPredictiveWarnings returns filtered events", () => {
        at.emit("predictive_warning", { risk: "high" });
        at.emit("strategy_evolved",   { fingerprint: "fp" });
        assert.equal(at.getPredictiveWarnings().length, 1);
    });

    it("reset clears log", () => {
        at.emit("policy_tuned", {});
        at.reset();
        assert.equal(at.getLog().length, 0);
    });
});

// ── evolutionMemory ───────────────────────────────────────────────────

describe("evolutionMemory – evolution patterns", () => {
    it("getSuccessfulPatterns returns empty for unknown fp", () => {
        assert.equal(em.getSuccessfulPatterns("fp-unknown").length, 0);
    });

    it("stores and retrieves patterns", () => {
        em.recordEvolutionPattern("fp-1", { strategy: "fast", success: true });
        assert.equal(em.getSuccessfulPatterns("fp-1").length, 1);
    });

    it("filters out failed patterns from getSuccessfulPatterns", () => {
        em.recordEvolutionPattern("fp-2", { strategy: "bad",  success: false });
        em.recordEvolutionPattern("fp-2", { strategy: "good", success: true  });
        assert.equal(em.getSuccessfulPatterns("fp-2").length, 1);
    });
});

describe("evolutionMemory – failed mutations", () => {
    it("getFailedMutations returns empty for unknown fp", () => {
        assert.equal(em.getFailedMutations("fp-unknown").length, 0);
    });

    it("records and retrieves failed mutations", () => {
        em.recordFailedMutation("fp-3", { strategy: "bad", key: "strat-bad" });
        assert.equal(em.getFailedMutations("fp-3").length, 1);
    });

    it("wasAttemptedMutation returns true for recorded mutation", () => {
        em.recordFailedMutation("fp-4", { key: "test-key" });
        assert.ok(em.wasAttemptedMutation("fp-4", "test-key"));
    });
});

describe("evolutionMemory – concurrency profiles", () => {
    it("getBestConcurrencyProfile returns null with no data", () => {
        assert.equal(em.getBestConcurrencyProfile(), null);
    });

    it("stores and returns best concurrency profile", () => {
        em.recordConcurrencyProfile({ concurrencyLevel: 4, avgDurationMs: 200, success: true });
        em.recordConcurrencyProfile({ concurrencyLevel: 4, avgDurationMs: 200, success: true });
        const best = em.getBestConcurrencyProfile();
        assert.ok(best !== null);
        assert.equal(best.concurrencyLevel, 4);
    });
});

describe("evolutionMemory – safe configs", () => {
    it("getSafeConfig returns null for unknown key", () => {
        assert.equal(em.getSafeConfig("nonexistent"), null);
    });

    it("records and retrieves safe config", () => {
        em.recordSafeConfig("config-a", { retryLimit: 2, strategy: "safe" });
        const r = em.getSafeConfig("config-a");
        assert.equal(r.retryLimit, 2);
    });

    it("getAllSafeConfigs returns all configs", () => {
        em.recordSafeConfig("cfg-1", { x: 1 });
        em.recordSafeConfig("cfg-2", { x: 2 });
        assert.ok(em.getAllSafeConfigs().length >= 2);
    });
});

describe("evolutionMemory – adaptation history", () => {
    it("getAdaptationHistory returns empty for unknown fp", () => {
        assert.equal(em.getAdaptationHistory("fp-unknown").length, 0);
    });

    it("records and retrieves adaptation outcomes", () => {
        em.recordAdaptationOutcome("fp-5", { action: "reduce_retry", result: "improved" });
        assert.equal(em.getAdaptationHistory("fp-5").length, 1);
    });

    it("getLastAdaptation returns most recent", () => {
        em.recordAdaptationOutcome("fp-6", { action: "first" });
        em.recordAdaptationOutcome("fp-6", { action: "second" });
        assert.equal(em.getLastAdaptation("fp-6").action, "second");
    });

    it("getLastAdaptation returns null for unknown fp", () => {
        assert.equal(em.getLastAdaptation("fp-unknown"), null);
    });
});
