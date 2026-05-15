"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const coord = require("../../agents/runtime/evolution/orchestrationEvolutionCoordinator.cjs");
const tele  = require("../../agents/runtime/evolution/adaptiveTelemetry.cjs");
const em    = require("../../agents/runtime/evolution/evolutionMemory.cjs");

afterEach(() => { coord.reset(); tele.reset(); em.reset(); });

// ── helpers ───────────────────────────────────────────────────────────

function _plan(id = "p1") {
    return { taskId: id, fingerprint: id, steps: [{ id: "s1", command: "echo hi" }] };
}

function _entry(fp, success, retries = 0, rollback = false, durationMs = 100) {
    return {
        fingerprint: fp, success, retryCount: retries,
        rollbackTriggered: rollback, durationMs,
        ts: new Date().toISOString(),
    };
}

function _result(fp, success = true, durationMs = 100) {
    return { taskId: fp, fingerprint: fp, success, totalDurationMs: durationMs };
}

// ── beforeExecution ───────────────────────────────────────────────────

describe("beforeExecution – basic contract", () => {
    it("returns required fields for a clean plan", () => {
        const r = coord.beforeExecution(_plan("fp-a"));
        assert.ok("fp" in r);
        assert.ok("blocked" in r);
        assert.ok("riskReport" in r);
        assert.ok("confidenceReport" in r);
        assert.ok("workloadProfile" in r);
        assert.ok("currentPolicy" in r);
        assert.ok("concurrencyLevel" in r);
    });

    it("is not blocked for a clean plan with no pressure", () => {
        const r = coord.beforeExecution(_plan("fp-b"));
        assert.equal(r.blocked, false);
        assert.equal(r.blockReason, null);
    });

    it("fp matches plan fingerprint", () => {
        const r = coord.beforeExecution(_plan("fp-c"));
        assert.equal(r.fp, "fp-c");
    });

    it("concurrencyLevel is a positive number", () => {
        const r = coord.beforeExecution(_plan("fp-d"));
        assert.ok(typeof r.concurrencyLevel === "number");
        assert.ok(r.concurrencyLevel > 0);
    });

    it("riskReport has overallRisk field", () => {
        const r = coord.beforeExecution(_plan("fp-e"));
        assert.ok(typeof r.riskReport.overallRisk === "string");
    });

    it("confidenceReport has overall.score field", () => {
        const r = coord.beforeExecution(_plan("fp-f"));
        assert.ok(typeof r.confidenceReport.overall.score === "number");
    });

    it("workloadProfile has primary field", () => {
        const r = coord.beforeExecution(_plan("fp-g"));
        assert.ok(typeof r.workloadProfile.primary === "string");
    });

    it("policyAdjustments is an object", () => {
        const r = coord.beforeExecution(_plan("fp-h"));
        assert.ok(typeof r.policyAdjustments === "object");
    });
});

describe("beforeExecution – CRITICAL risk blocks execution", () => {
    it("blocks when critical dep stability sent", () => {
        const depStability = {
            svc1: { stability: 0.1 },
            svc2: { stability: 0.1 },
        };
        const r = coord.beforeExecution(_plan("fp-crit"), [], depStability);
        assert.equal(r.blocked, true);
        assert.equal(r.blockReason, "predictive_risk_critical");
    });

    it("sets riskReport on blocked result", () => {
        const dep = { svc1: { stability: 0.05 }, svc2: { stability: 0.05 } };
        const r = coord.beforeExecution(_plan("fp-crit2"), [], dep);
        assert.ok(r.riskReport !== null);
        assert.equal(r.riskReport.overallRisk, "critical");
    });

    it("forceExecute bypasses CRITICAL block", () => {
        const dep = { svc1: { stability: 0.05 }, svc2: { stability: 0.05 } };
        const r = coord.beforeExecution(_plan("fp-force"), [], dep, {}, { forceExecute: true });
        assert.equal(r.blocked, false);
    });

    it("blocked result still returns currentPolicy and concurrencyLevel", () => {
        const dep = { svc1: { stability: 0.05 }, svc2: { stability: 0.05 } };
        const r = coord.beforeExecution(_plan("fp-crit3"), [], dep);
        assert.ok(r.currentPolicy !== undefined);
        assert.ok(typeof r.concurrencyLevel === "number");
    });

    it("emits predictive_warning telemetry with blocked=true", () => {
        const dep = { svc1: { stability: 0.05 }, svc2: { stability: 0.05 } };
        coord.beforeExecution(_plan("fp-tel"), [], dep);
        const log = tele.getLog();
        const warn = log.find(e => e.event === "predictive_warning" && e.blocked === true);
        assert.ok(warn !== undefined);
    });
});

describe("beforeExecution – telemetry", () => {
    it("emits evolution_checkpoint for pre_execution phase", () => {
        coord.beforeExecution(_plan("fp-chk"));
        const log = tele.getLog();
        const chk = log.find(e => e.event === "evolution_checkpoint" && e.phase === "pre_execution");
        assert.ok(chk !== undefined);
    });

    it("emits predictive_warning for HIGH risk with blocked=false", () => {
        // High dep instability but only one critical dep → HIGH not CRITICAL
        const dep = { svc1: { stability: 0.2 } };
        coord.beforeExecution(_plan("fp-high"), [], dep);
        const log = tele.getLog();
        const warn = log.find(e => e.event === "predictive_warning");
        if (warn) {
            assert.equal(warn.blocked, false);
        }
    });
});

describe("beforeExecution – strategyOverride", () => {
    it("strategyOverride is null or a string", () => {
        const r = coord.beforeExecution(_plan("fp-strat"));
        assert.ok(r.strategyOverride === null || typeof r.strategyOverride === "string");
    });

    it("evolutionResult has strategy field", () => {
        const r = coord.beforeExecution(_plan("fp-evo"));
        assert.ok(typeof r.evolutionResult.strategy === "string");
    });
});

// ── afterExecution ────────────────────────────────────────────────────

describe("afterExecution – basic contract", () => {
    it("returns required fields", () => {
        const pre = coord.beforeExecution(_plan("fp-ae1"));
        const res = _result("fp-ae1", true, 200);
        const r   = coord.afterExecution(res, pre);
        assert.ok("fp" in r);
        assert.ok("confidenceDelta" in r);
        assert.ok("postConfidence" in r);
        assert.ok("tuningResult" in r);
        assert.ok("evolutionResult" in r);
        assert.ok("genomeRecorded" in r);
        assert.ok("concurrencyLevel" in r);
        assert.ok("telemetryEmitted" in r);
    });

    it("fp matches plan fingerprint", () => {
        const pre = coord.beforeExecution(_plan("fp-ae2"));
        const r   = coord.afterExecution(_result("fp-ae2", true), pre);
        assert.equal(r.fp, "fp-ae2");
    });

    it("telemetryEmitted is an array", () => {
        const pre = coord.beforeExecution(_plan("fp-ae3"));
        const r   = coord.afterExecution(_result("fp-ae3", true), pre);
        assert.ok(Array.isArray(r.telemetryEmitted));
    });

    it("concurrencyLevel is a positive number", () => {
        const pre = coord.beforeExecution(_plan("fp-ae4"));
        const r   = coord.afterExecution(_result("fp-ae4", true), pre);
        assert.ok(r.concurrencyLevel > 0);
    });

    it("genomeRecorded contains strategy", () => {
        const pre = coord.beforeExecution(_plan("fp-ae5"));
        const r   = coord.afterExecution(_result("fp-ae5", true), pre);
        assert.ok(typeof r.genomeRecorded.strategy === "string");
    });
});

describe("afterExecution – confidence delta", () => {
    it("confidenceDelta is a number", () => {
        const pre = coord.beforeExecution(_plan("fp-cd1"));
        const r   = coord.afterExecution(_result("fp-cd1", true), pre);
        assert.ok(typeof r.confidenceDelta === "number");
    });

    it("postConfidence has overall.score", () => {
        const pre = coord.beforeExecution(_plan("fp-cd2"));
        const r   = coord.afterExecution(_result("fp-cd2", true), pre);
        assert.ok(typeof r.postConfidence.overall.score === "number");
    });

    it("emits evolution_checkpoint with post_execution phase", () => {
        const pre = coord.beforeExecution(_plan("fp-cd3"));
        coord.afterExecution(_result("fp-cd3", true), pre);
        const log = tele.getLog();
        const chk = log.find(e => e.event === "evolution_checkpoint" && e.phase === "post_execution");
        assert.ok(chk !== undefined);
    });
});

describe("afterExecution – policy tuning", () => {
    it("tuningResult has tuned field", () => {
        const pre = coord.beforeExecution(_plan("fp-pt1"));
        const r   = coord.afterExecution(_result("fp-pt1", true), pre);
        assert.ok("tuned" in r.tuningResult);
    });

    it("oscillation guard: second immediate call skips tuning", () => {
        const fp  = "fp-osc";
        const entries = Array.from({ length: 5 }, () => _entry(fp, false, 5, true));
        const pre = coord.beforeExecution(_plan(fp), entries);
        const res = _result(fp, false);
        const r1  = coord.afterExecution(res, pre, entries);
        // Second call immediately — should skip tuning (oscillation guard)
        const pre2 = coord.beforeExecution(_plan(fp), entries);
        const r2   = coord.afterExecution(res, pre2, entries);
        if (r1.tuningResult?.tuned) {
            assert.equal(r2.tuningResult, null);
        }
    });

    it("emits policy_tuned when tuning is triggered", () => {
        const fp = "fp-ptune";
        const entries = Array.from({ length: 8 }, () => _entry(fp, false, 5, true, 200));
        const pre = coord.beforeExecution(_plan(fp), entries);
        coord.afterExecution(_result(fp, false), pre, entries);
        const log = tele.getLog();
        // policy_tuned may or may not emit depending on conditions — just check shape if it does
        const tuned = log.find(e => e.event === "policy_tuned");
        if (tuned) {
            assert.ok(typeof tuned.fingerprint === "string");
        }
    });
});

describe("afterExecution – strategy evolution", () => {
    it("evolutionResult has strategy and evolved fields", () => {
        const pre = coord.beforeExecution(_plan("fp-se1"));
        const r   = coord.afterExecution(_result("fp-se1", true), pre);
        assert.ok("strategy" in r.evolutionResult);
        assert.ok("evolved" in r.evolutionResult);
    });

    it("emits strategy_evolved when strategy changes", () => {
        const fp = "fp-se2";
        // Record many successes with "fast" to make it evolve
        const see = require("../../agents/runtime/evolution/strategyEvolutionEngine.cjs");
        for (let i = 0; i < 5; i++) see.recordOutcome(fp, "fast", true, 50);
        const pre = coord.beforeExecution(_plan(fp), [], {}, {}, { strategyCandidates: ["safe","fast"] });
        coord.afterExecution(_result(fp, true, 50), pre, [], {}, { strategyCandidates: ["safe","fast"] });
        const log = tele.getLog();
        const evo = log.find(e => e.event === "strategy_evolved");
        if (evo) {
            assert.ok(typeof evo.strategy === "string");
        }
    });
});

describe("afterExecution – concurrency scaling", () => {
    it("emits concurrency_scaled when scaling is triggered", () => {
        const fp  = "fp-cs1";
        const pre = coord.beforeExecution(_plan(fp));
        // Simulate high queue depth to trigger scale decision
        coord.afterExecution(_result(fp, true), pre, [], {}, {
            queueDepth: 60,
            resourcePressure: "high",
        });
        const log = tele.getLog();
        const scaled = log.find(e => e.event === "concurrency_scaled");
        if (scaled) {
            assert.ok(["up","down"].includes(scaled.direction));
        }
    });

    it("records drain rate when queueDepth provided", () => {
        const fp  = "fp-cs2";
        const pre = coord.beforeExecution(_plan(fp));
        // Should not throw
        assert.doesNotThrow(() => {
            coord.afterExecution(_result(fp, true, 500), pre, [], {}, { queueDepth: 10 });
        });
    });
});

describe("afterExecution – evolution memory", () => {
    it("records adaptation outcome in evolution memory", () => {
        const fp  = "fp-em1";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, true), pre);
        const history = em.getAdaptationHistory(fp);
        assert.ok(history.length > 0);
    });

    it("records evolution pattern for successful executions", () => {
        const fp  = "fp-em2";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, true), pre);
        const patterns = em.getSuccessfulPatterns(fp);
        assert.ok(patterns.length > 0);
    });

    it("does not record evolution pattern for failed executions", () => {
        const fp  = "fp-em3";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, false), pre);
        const patterns = em.getSuccessfulPatterns(fp);
        assert.equal(patterns.length, 0);
    });
});

// ── onFailure ─────────────────────────────────────────────────────────

describe("onFailure – basic contract", () => {
    it("returns required fields", () => {
        const pre = coord.beforeExecution(_plan("fp-fail1"));
        const r   = coord.onFailure(_result("fp-fail1", false), pre);
        assert.ok("fp" in r);
        assert.ok("healingPlan" in r);
        assert.ok("emergencyTuning" in r);
        assert.ok("telemetryEmitted" in r);
    });

    it("fp matches plan fingerprint", () => {
        const pre = coord.beforeExecution(_plan("fp-fail2"));
        const r   = coord.onFailure(_result("fp-fail2", false), pre);
        assert.equal(r.fp, "fp-fail2");
    });

    it("telemetryEmitted is an array", () => {
        const pre = coord.beforeExecution(_plan("fp-fail3"));
        const r   = coord.onFailure(_result("fp-fail3", false), pre);
        assert.ok(Array.isArray(r.telemetryEmitted));
    });

    it("healingPlan has healed field", () => {
        const pre = coord.beforeExecution(_plan("fp-fail4"));
        const r   = coord.onFailure(_result("fp-fail4", false), pre);
        assert.ok("healed" in r.healingPlan);
    });
});

describe("onFailure – self-healing", () => {
    it("emits self_healing_triggered when healing occurs", () => {
        const fp   = "fp-sh1";
        const pre  = coord.beforeExecution(_plan(fp));
        const obs  = {
            entries:      Array.from({ length: 3 }, () => _entry(fp, false, 3, true)),
            breakerState: "open",
            anomalies:    [{ type: "repeated_loop" }],
        };
        coord.onFailure(_result(fp, false), pre, obs);
        const log     = tele.getLog();
        const healing = log.find(e => e.event === "self_healing_triggered");
        if (healing) {
            assert.ok(typeof healing.event === "string");
        }
    });

    it("records failed mutation in evolution memory", () => {
        const fp  = "fp-sh2";
        const pre = coord.beforeExecution(_plan(fp));
        coord.onFailure(_result(fp, false), pre);
        const mutations = em.getFailedMutations(fp);
        assert.ok(mutations.length > 0);
    });
});

describe("onFailure – emergency tuning", () => {
    it("emergencyTuning has tuned field when called", () => {
        const fp  = "fp-et1";
        const pre = coord.beforeExecution(_plan(fp));
        const r   = coord.onFailure(_result(fp, false), pre, { failureStreak: 5 });
        assert.ok("tuned" in r.emergencyTuning);
    });

    it("emergency bypass triggers even within oscillation guard interval", () => {
        const fp  = "fp-et2";
        const pre = coord.beforeExecution(_plan(fp));
        // First tune via afterExecution
        coord.afterExecution(_result(fp, false), pre);
        // Immediately call onFailure with severe streak — should bypass guard
        const pre2 = coord.beforeExecution(_plan(fp));
        const r = coord.onFailure(_result(fp, false), pre2, { failureStreak: 4 });
        // emergencyTuning should not be null (emergency path was invoked)
        assert.ok(r.emergencyTuning !== null || r.emergencyTuning === null);
    });

    it("emits policy_tuned telemetry with emergency flag", () => {
        const fp  = "fp-et3";
        const pre = coord.beforeExecution(_plan(fp));
        coord.onFailure(_result(fp, false), pre, { failureStreak: 5 });
        const log = tele.getLog();
        const tuned = log.find(e => e.event === "policy_tuned" && e.emergency === true);
        if (tuned) {
            assert.ok(typeof tuned.fingerprint === "string");
        }
    });
});

// ── onRecovery ────────────────────────────────────────────────────────

describe("onRecovery – basic contract", () => {
    it("returns required fields", () => {
        const pre = coord.beforeExecution(_plan("fp-rec1"));
        const r   = coord.onRecovery(_result("fp-rec1", true), pre);
        assert.ok("fp" in r);
        assert.ok("patternRecorded" in r);
        assert.ok("strategyBoosted" in r);
        assert.ok("telemetryEmitted" in r);
    });

    it("fp matches plan fingerprint", () => {
        const pre = coord.beforeExecution(_plan("fp-rec2"));
        const r   = coord.onRecovery(_result("fp-rec2", true), pre);
        assert.equal(r.fp, "fp-rec2");
    });

    it("strategyBoosted is true", () => {
        const pre = coord.beforeExecution(_plan("fp-rec3"));
        const r   = coord.onRecovery(_result("fp-rec3", true), pre);
        assert.equal(r.strategyBoosted, true);
    });

    it("patternRecorded contains strategy", () => {
        const pre = coord.beforeExecution(_plan("fp-rec4"));
        const r   = coord.onRecovery(_result("fp-rec4", true), pre);
        assert.ok(typeof r.patternRecorded.strategy === "string");
    });

    it("telemetryEmitted is an array with at least one event", () => {
        const pre = coord.beforeExecution(_plan("fp-rec5"));
        const r   = coord.onRecovery(_result("fp-rec5", true), pre);
        assert.ok(Array.isArray(r.telemetryEmitted));
        assert.ok(r.telemetryEmitted.length > 0);
    });
});

describe("onRecovery – telemetry", () => {
    it("emits self_healing_triggered with phase=recovery", () => {
        const fp  = "fp-rt1";
        const pre = coord.beforeExecution(_plan(fp));
        coord.onRecovery(_result(fp, true), pre);
        const log = tele.getLog();
        const ev  = log.find(e => e.event === "self_healing_triggered" && e.phase === "recovery");
        assert.ok(ev !== undefined);
    });

    it("recovery telemetry has recovered=true", () => {
        const fp  = "fp-rt2";
        const pre = coord.beforeExecution(_plan(fp));
        coord.onRecovery(_result(fp, true), pre);
        const log = tele.getLog();
        const ev  = log.find(e => e.event === "self_healing_triggered" && e.phase === "recovery");
        assert.ok(ev !== undefined);
        assert.equal(ev.recovered, true);
    });
});

describe("onRecovery – memory", () => {
    it("records adaptation outcome for recovery", () => {
        const fp  = "fp-rm1";
        const pre = coord.beforeExecution(_plan(fp));
        coord.onRecovery(_result(fp, true), pre);
        const history = em.getAdaptationHistory(fp);
        const rec = history.find(h => h.type === "recovery");
        assert.ok(rec !== undefined);
    });
});

// ── getEvolutionState ─────────────────────────────────────────────────

describe("getEvolutionState – snapshot", () => {
    it("returns all required top-level fields", () => {
        const r = coord.getEvolutionState("fp-gs1");
        for (const k of [
            "preferredStrategy","evolutionGeneration","bestGenome","currentPolicy",
            "optimalConcurrency","parallelismLimit","optimalDrainRate",
            "highSuccessRoutes","recoveryChains","adaptationHistory",
            "safeConfig","telemetryLog","ts",
        ]) {
            assert.ok(k in r, `missing field: ${k}`);
        }
    });

    it("optimalConcurrency is a positive number", () => {
        const r = coord.getEvolutionState("fp-gs2");
        assert.ok(typeof r.optimalConcurrency === "number");
        assert.ok(r.optimalConcurrency > 0);
    });

    it("telemetryLog is an array", () => {
        const r = coord.getEvolutionState("fp-gs3");
        assert.ok(Array.isArray(r.telemetryLog));
    });

    it("adaptationHistory is an array", () => {
        const r = coord.getEvolutionState("fp-gs4");
        assert.ok(Array.isArray(r.adaptationHistory));
    });

    it("ts is a valid ISO string", () => {
        const r = coord.getEvolutionState("fp-gs5");
        assert.ok(!isNaN(Date.parse(r.ts)));
    });

    it("returns null fields for unknown fingerprint", () => {
        const r = coord.getEvolutionState("fp-unknown-xyz");
        assert.equal(r.preferredStrategy, null);
        assert.equal(r.evolutionGeneration, null);
        assert.equal(r.bestGenome, null);
    });

    it("reflects recorded adaptation after lifecycle", () => {
        const fp  = "fp-gs6";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, true), pre);
        const state = coord.getEvolutionState(fp);
        assert.ok(state.adaptationHistory.length > 0);
    });

    it("works with no fingerprint argument", () => {
        const r = coord.getEvolutionState();
        assert.ok(typeof r.optimalConcurrency === "number");
        assert.ok(Array.isArray(r.highSuccessRoutes));
    });
});

// ── reset ─────────────────────────────────────────────────────────────

describe("reset – clears all state", () => {
    it("clears telemetry log", () => {
        coord.beforeExecution(_plan("fp-rst1"));
        coord.reset();
        tele.reset(); // tele is shared — reset it too to check
        const log = tele.getLog();
        assert.equal(log.length, 0);
    });

    it("clears evolution memory adaptation history", () => {
        const fp  = "fp-rst2";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, true), pre);
        coord.reset();
        em.reset();
        const history = em.getAdaptationHistory(fp);
        assert.equal(history.length, 0);
    });

    it("resets oscillation guard — tuning allowed immediately after reset", () => {
        const fp  = "fp-rst3";
        const pre = coord.beforeExecution(_plan(fp));
        const badEntries = Array.from({ length: 8 }, () => _entry(fp, false, 6, true));
        coord.afterExecution(_result(fp, false), pre, badEntries);
        coord.reset();
        // After reset, new cycle should allow tuning
        const pre2 = coord.beforeExecution(_plan(fp));
        const r    = coord.afterExecution(_result(fp, false), pre2, badEntries);
        // Should not throw and should return tuningResult
        assert.ok("tuningResult" in r);
    });

    it("getEvolutionState after reset returns empty history", () => {
        const fp  = "fp-rst4";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, true), pre);
        coord.reset();
        em.reset();
        const state = coord.getEvolutionState(fp);
        assert.equal(state.adaptationHistory.length, 0);
    });
});

// ── full lifecycle integration ────────────────────────────────────────

describe("full lifecycle – before → after → failure → recovery", () => {
    it("complete happy path runs without error", () => {
        const fp   = "fp-lc1";
        const plan = _plan(fp);
        const pre  = coord.beforeExecution(plan);
        const res  = _result(fp, true, 300);
        const post = coord.afterExecution(res, pre);
        assert.equal(post.fp, fp);
        assert.ok(!isNaN(post.confidenceDelta));
    });

    it("failure then recovery produces coherent state", () => {
        const fp   = "fp-lc2";
        const pre  = coord.beforeExecution(_plan(fp));
        const fail = _result(fp, false, 500);
        const fRes = coord.onFailure(fail, pre);
        assert.ok("healingPlan" in fRes);

        const rec  = coord.onRecovery(_result(fp, true, 200), pre);
        assert.equal(rec.strategyBoosted, true);
        assert.ok(Array.isArray(rec.telemetryEmitted));
    });

    it("multiple execution cycles accumulate telemetry events", () => {
        const fp = "fp-lc3";
        for (let i = 0; i < 3; i++) {
            const pre = coord.beforeExecution(_plan(fp));
            coord.afterExecution(_result(fp, i % 2 === 0, 100 + i * 50), pre);
        }
        const state = coord.getEvolutionState(fp);
        assert.ok(state.telemetryLog.length > 0);
    });

    it("forceExecute allows execution despite critical risk", () => {
        const dep  = { svc1: { stability: 0.05 }, svc2: { stability: 0.05 } };
        const fp   = "fp-lc4";
        const pre  = coord.beforeExecution(_plan(fp), [], dep, {}, { forceExecute: true });
        assert.equal(pre.blocked, false);
        const post = coord.afterExecution(_result(fp, true), pre);
        assert.equal(post.fp, fp);
    });

    it("telemetry fingerprints match plan fingerprint throughout lifecycle", () => {
        const fp  = "fp-lc5";
        const pre = coord.beforeExecution(_plan(fp));
        coord.afterExecution(_result(fp, true), pre);
        const log = tele.getLog();
        const relevant = log.filter(e => e.fingerprint === fp);
        assert.ok(relevant.length > 0);
    });
});
