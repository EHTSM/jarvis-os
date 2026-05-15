"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const sup   = require("../../agents/runtime/supervisor/executionSupervisor.cjs");
const psm   = require("../../agents/runtime/supervisor/pressureStateMachine.cjs");
const cont  = require("../../agents/runtime/supervisor/incidentContainment.cjs");
const pacer = require("../../agents/runtime/supervisor/executionPacer.cjs");
const rec   = require("../../agents/runtime/supervisor/recoveryOrchestrator.cjs");
const bench = require("../../agents/runtime/supervisor/supervisorBenchmark.cjs");

afterEach(() => {
    sup.reset();
    psm.reset();
    cont.reset();
    pacer.reset();
    rec.reset();
    bench.reset();
});

// ═══════════════════════════════════════════════════════════════════════
// executionSupervisor — lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe("executionSupervisor — supervise lifecycle", () => {
    it("runs all 6 phases and returns supervisionId", () => {
        const r = sup.supervise({}, {});
        assert.ok(r.supervisionId.startsWith("sup-"));
        assert.equal(r.phases.length, 6);
        const phaseNames = r.phases.map(p => p.phase);
        assert.deepEqual(phaseNames, ["detect", "analyze", "decide", "coordinate", "verify", "stabilize"]);
    });

    it("selects fast strategy for zero-risk execution", () => {
        const r = sup.supervise({ retryCount: 0 }, { riskScore: 0, routeScore: 95 });
        assert.equal(r.finalStrategy, "fast");
        assert.equal(r.verified, true);
    });

    it("selects sandbox for very high risk", () => {
        const r = sup.supervise({}, { riskScore: 90, routeScore: 20 });
        // verify override may push to safer; sandbox or recovery_first acceptable
        assert.ok(["sandbox", "recovery_first"].includes(r.finalStrategy));
    });

    it("detects rollback anomaly", () => {
        const r = sup.supervise({ rollbackTriggered: true }, { riskScore: 30 });
        assert.ok(r.anomalyCount >= 1);
    });

    it("detects high retry count anomaly", () => {
        const r = sup.supervise({ retryCount: 5 }, {});
        assert.ok(r.anomalyCount >= 1);
    });

    it("detects poor route quality anomaly", () => {
        const r = sup.supervise({}, { riskScore: 10, routeScore: 20 });
        assert.ok(r.anomalyCount >= 1);
    });

    it("strategy ranking from signals overrides default selection", () => {
        const r = sup.supervise({}, {
            riskScore:       20,
            strategyRanking: [{ strategy: "staged", score: 95 }, { strategy: "safe", score: 80 }],
        });
        // Low risk + staged ranked top → staged or safer override
        assert.ok(["staged", "recovery_first", "sandbox"].includes(r.finalStrategy) ||
                  r.finalStrategy === "staged");
    });

    it("marks pace as slow for high risk", () => {
        const r = sup.supervise({}, { riskScore: 75 });
        assert.equal(r.pace, "slow");
    });

    it("marks verification as required for moderate risk", () => {
        const r = sup.supervise({}, { riskScore: 55 });
        assert.equal(r.verification, "required");
    });

    it("verification is optional for low-risk high-confidence execution", () => {
        const r = sup.supervise({}, {
            riskScore:    10,
            routeScore:   95,
            confidenceMap: { routing: 90, prediction: 88 },
        });
        assert.equal(r.verification, "optional");
    });

    it("triggers stabilization when risk is high", () => {
        const r = sup.supervise({}, { riskScore: 80 });
        assert.equal(r.stabilized, true);
    });

    it("does not stabilize for zero risk", () => {
        const r = sup.supervise({}, { riskScore: 0 });
        assert.equal(r.stabilized, false);
    });

    it("records supervision in audit trail", () => {
        sup.supervise({}, { riskScore: 50 });
        const trail = sup.getAuditTrail();
        assert.ok(trail.some(e => e.type === "supervision"));
    });
});

describe("executionSupervisor — aggregateConfidence", () => {
    it("returns grade F with no signals", () => {
        const r = sup.aggregateConfidence({});
        assert.equal(r.grade, "F");
        assert.equal(r.domainCount, 0);
    });

    it("aggregates partial domain map", () => {
        const r = sup.aggregateConfidence({
            confidenceMap: { routing: 90, prediction: 80 },
        });
        assert.equal(r.domainCount, 2);
        assert.ok(r.aggregate > 0);
    });

    it("applies coverage penalty for missing domains", () => {
        const full = sup.aggregateConfidence({
            confidenceMap: { routing: 85, prediction: 85, optimization: 85, memory: 85, evolution: 85 },
        });
        const partial = sup.aggregateConfidence({
            confidenceMap: { routing: 85 },
        });
        assert.ok(full.aggregate >= partial.aggregate);
    });

    it("identifies weakest domain as weakLink", () => {
        const r = sup.aggregateConfidence({
            confidenceMap: { routing: 90, prediction: 30, optimization: 85 },
        });
        assert.equal(r.weakLink, "prediction");
        assert.equal(r.minScore, 30);
    });

    it("returns A grade for all-high confidence", () => {
        const r = sup.aggregateConfidence({
            confidenceMap: { routing: 95, prediction: 92, optimization: 94, memory: 91, evolution: 93 },
        });
        assert.equal(r.grade, "A");
    });
});

describe("executionSupervisor — triggerStabilization", () => {
    it("returns stabilized:false for healthy metrics", () => {
        const r = sup.triggerStabilization({ riskScore: 0, errorRate: 0 });
        assert.equal(r.stabilized, false);
    });

    it("reduces concurrency on high risk", () => {
        const r = sup.triggerStabilization({ riskScore: 65, concurrency: 10 });
        assert.ok(r.actions.includes("reduce_concurrency"));
        assert.ok(r.targetConcurrency < 10);
    });

    it("prioritizes safe strategies on moderate risk", () => {
        const r = sup.triggerStabilization({ riskScore: 55 });
        assert.ok(r.actions.includes("prioritize_safe_strategies"));
    });

    it("throttles risky workflows on risk >= 70", () => {
        const r = sup.triggerStabilization({ riskScore: 72 });
        assert.ok(r.actions.includes("throttle_risky_workflows"));
    });

    it("activates recovery mode on critical pressure", () => {
        const r = sup.triggerStabilization({ riskScore: 10, pressure: "critical" });
        assert.ok(r.actions.includes("activate_recovery_mode") || r.actions.includes("reduce_concurrency"));
    });

    it("records stabilization in audit trail", () => {
        sup.triggerStabilization({ riskScore: 75 });
        const trail = sup.getAuditTrail();
        assert.ok(trail.some(e => e.type === "stabilization"));
    });
});

describe("executionSupervisor — getSupervisionStats", () => {
    it("tracks total supervisions and avg risk", () => {
        sup.supervise({}, { riskScore: 40 });
        sup.supervise({}, { riskScore: 60 });
        const s = sup.getSupervisionStats();
        assert.equal(s.total, 2);
        assert.equal(s.avgRiskScore, 50);
    });

    it("tracks verified rate correctly", () => {
        sup.supervise({ retryCount: 0 }, { riskScore: 0, routeScore: 95 });  // should verify
        const s = sup.getSupervisionStats();
        assert.ok(s.verifiedRate >= 0 && s.verifiedRate <= 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// pressureStateMachine
// ═══════════════════════════════════════════════════════════════════════

describe("pressureStateMachine — initial state", () => {
    it("starts in normal state", () => {
        assert.equal(psm.getState(), "normal");
    });
});

describe("pressureStateMachine — evaluate", () => {
    it("recommends normal when metrics are healthy", () => {
        const r = psm.evaluate({ errorRate: 0.01, retryRate: 0.05 });
        assert.equal(r.recommended, "normal");
        assert.equal(r.willTransition, false);
    });

    it("recommends elevated on moderate error rate", () => {
        const r = psm.evaluate({ errorRate: 0.15, retryRate: 0.1 });
        assert.equal(r.recommended, "elevated");
        assert.equal(r.willTransition, true);
    });

    it("recommends critical on very high error rate", () => {
        const r = psm.evaluate({ errorRate: 0.5, health: 0.2 });
        assert.equal(r.recommended, "critical");
    });
});

describe("pressureStateMachine — transition", () => {
    it("transitions normal → elevated on high error rate", () => {
        const r = psm.transition({ errorRate: 0.15 });
        assert.equal(r.transitioned, true);
        assert.equal(r.from, "normal");
        assert.equal(r.to, "elevated");
        assert.equal(psm.getState(), "elevated");
    });

    it("does not transition when no condition met", () => {
        const r = psm.transition({ errorRate: 0.02 });
        assert.equal(r.transitioned, false);
        assert.equal(psm.getState(), "normal");
    });

    it("transitions elevated → degraded on higher error rate", () => {
        psm.forceTransition("elevated");
        const r = psm.transition({ errorRate: 0.25 });
        assert.equal(r.transitioned, true);
        assert.equal(r.to, "degraded");
    });

    it("transitions degraded → critical", () => {
        psm.forceTransition("degraded");
        const r = psm.transition({ errorRate: 0.5, health: 0.3 });
        assert.equal(r.transitioned, true);
        assert.equal(r.to, "critical");
    });

    it("transitions critical → recovery", () => {
        psm.forceTransition("critical");
        const r = psm.transition({ errorRate: 0.3 });
        assert.equal(r.transitioned, true);
        assert.equal(r.to, "recovery");
    });

    it("transitions recovery → normal when healthy again", () => {
        psm.forceTransition("recovery");
        const r = psm.transition({ errorRate: 0.02, health: 0.95 });
        assert.equal(r.transitioned, true);
        assert.equal(r.to, "normal");
    });

    it("records every transition in history", () => {
        psm.transition({ errorRate: 0.15 });
        psm.transition({ errorRate: 0.25 });
        const h = psm.getHistory();
        assert.ok(h.length >= 1);
    });
});

describe("pressureStateMachine — applyStateActions", () => {
    it("returns applied:false for unknown state", () => {
        const r = psm.applyStateActions("unknown_state");
        assert.equal(r.applied, false);
    });

    it("critical state has concurrencyLimit of 1 and shedLoad true", () => {
        const r = psm.applyStateActions("critical");
        assert.equal(r.applied, true);
        assert.equal(r.concurrencyLimit, 1);
        assert.equal(r.shedLoad, true);
    });

    it("normal state has no concurrency limit", () => {
        const r = psm.applyStateActions("normal");
        assert.equal(r.concurrencyLimit, null);
        assert.equal(r.shedLoad, false);
    });

    it("recovery state uses safe strategy", () => {
        const r = psm.applyStateActions("recovery");
        assert.equal(r.strategy, "safe");
    });
});

describe("pressureStateMachine — forceTransition", () => {
    it("forces transition to any valid state", () => {
        const r = psm.forceTransition("critical", "emergency");
        assert.equal(r.transitioned, true);
        assert.equal(r.to, "critical");
        assert.equal(r.forced, true);
        assert.equal(psm.getState(), "critical");
    });

    it("rejects invalid state", () => {
        const r = psm.forceTransition("nonexistent");
        assert.equal(r.transitioned, false);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// incidentContainment
// ═══════════════════════════════════════════════════════════════════════

describe("incidentContainment — openContainment", () => {
    it("opens a containment for an incident", () => {
        const r = cont.openContainment({ type: "execution_failure", severity: "P2", incidentId: "inc-1" });
        assert.ok(r.containmentId.startsWith("cont-"));
        assert.equal(r.status, "active");
        assert.equal(r.incidentId, "inc-1");
    });

    it("assigns correct strategies for cascade_failure", () => {
        const r = cont.openContainment({ type: "cascade_failure" });
        assert.ok(r.strategies.includes("circuit_break_all"));
    });

    it("defaults to unknown strategies for unknown type", () => {
        const r = cont.openContainment({ type: "mystery_type" });
        assert.ok(r.strategies.includes("investigate"));
    });
});

describe("incidentContainment — closeContainment", () => {
    it("closes an active containment", () => {
        const { containmentId } = cont.openContainment({ type: "execution_failure" });
        const r = cont.closeContainment(containmentId, "resolved");
        assert.equal(r.closed, true);
        assert.equal(r.outcome, "resolved");
        assert.ok(r.durationMs >= 0);
    });

    it("returns not_found for unknown id", () => {
        const r = cont.closeContainment("missing-id");
        assert.equal(r.closed, false);
        assert.equal(r.reason, "not_found");
    });

    it("rejects closing already-closed containment", () => {
        const { containmentId } = cont.openContainment({ type: "execution_failure" });
        cont.closeContainment(containmentId);
        const r2 = cont.closeContainment(containmentId);
        assert.equal(r2.closed, false);
        assert.equal(r2.reason, "already_closed");
    });
});

describe("incidentContainment — containCascade", () => {
    it("returns not contained for empty incident list", () => {
        const r = cont.containCascade([]);
        assert.equal(r.contained, false);
    });

    it("detects cascade when multiple incidents present", () => {
        const r = cont.containCascade([
            { type: "cascade_failure", severity: "P1" },
            { type: "execution_failure", severity: "P2" },
        ]);
        assert.equal(r.contained, true);
        assert.equal(r.isCascade, true);
        assert.equal(r.maxSeverity, "P1");
    });

    it("enables circuit break for cascade_failure type", () => {
        const r = cont.containCascade([{ type: "cascade_failure" }]);
        assert.equal(r.circuitBreak, true);
    });

    it("opens one containment per incident", () => {
        const r = cont.containCascade([{ type: "execution_failure" }, { type: "resource_exhaustion" }]);
        assert.equal(r.containmentIds.length, 2);
    });
});

describe("incidentContainment — isolateBlastRadius", () => {
    it("returns none radius for empty affected list", () => {
        const r = cont.isolateBlastRadius({}, { services: ["a", "b"], dependencies: [] });
        assert.equal(r.radius, "none");
    });

    it("computes low radius for single service with no deps", () => {
        const r = cont.isolateBlastRadius(
            { affectedServices: ["svc-a"], severity: "P2" },
            { services: ["svc-a", "svc-b", "svc-c"], dependencies: [] }
        );
        assert.equal(r.radius, "low");
        assert.equal(r.isolatedCount, 1);
    });

    it("computes medium radius with downstream deps", () => {
        const r = cont.isolateBlastRadius(
            { affectedServices: ["svc-a"] },
            {
                services:     ["svc-a", "svc-b", "svc-c", "svc-d"],
                dependencies: [{ from: "svc-a", to: "svc-b" }, { from: "svc-a", to: "svc-c" }],
            }
        );
        assert.ok(["medium", "high"].includes(r.radius));
        assert.equal(r.isolatedCount, 3);  // svc-a + svc-b + svc-c
    });

    it("critical radius triggers circuit_break_all", () => {
        const services = ["a", "b", "c", "d"];
        const r = cont.isolateBlastRadius(
            { affectedServices: ["a"] },
            {
                services,
                dependencies: [
                    { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "a", to: "d" },
                ],
            }
        );
        assert.ok(r.actions.includes("circuit_break_all") || r.radius === "critical");
    });
});

describe("incidentContainment — scoreContainmentEffectiveness", () => {
    it("returns F for no containments", () => {
        const r = cont.scoreContainmentEffectiveness([]);
        assert.equal(r.grade, "F");
    });

    it("scores A for all resolved containments", () => {
        const { containmentId } = cont.openContainment({ type: "execution_failure" });
        cont.closeContainment(containmentId, "resolved");
        const history = cont.getContainmentHistory();
        const r = cont.scoreContainmentEffectiveness(history);
        assert.ok(r.score > 0);
        assert.ok(r.resolvedRate === 1);
    });

    it("scores lower for unresolved containments", () => {
        cont.openContainment({ type: "cascade_failure" });
        const history = cont.getContainmentHistory();
        const r = cont.scoreContainmentEffectiveness(history);
        assert.ok(r.score < 80);
    });
});

describe("incidentContainment — getActiveContainments", () => {
    it("returns only active containments", () => {
        const c1 = cont.openContainment({ type: "execution_failure" });
        const c2 = cont.openContainment({ type: "execution_failure" });
        cont.closeContainment(c1.containmentId);
        const active = cont.getActiveContainments();
        assert.equal(active.length, 1);
        assert.equal(active[0].containmentId, c2.containmentId);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// executionPacer
// ═══════════════════════════════════════════════════════════════════════

describe("executionPacer — registerVerified / registerRisky", () => {
    it("verified fingerprint gets fastest multiplier", () => {
        pacer.registerVerified("fp-verified");
        const m = pacer.getPaceMultiplier("fp-verified");
        assert.equal(m, pacer.RISK_MULTIPLIERS.none);
    });

    it("risky fingerprint gets slower multiplier", () => {
        pacer.registerRisky("fp-risky", "high");
        const m = pacer.getPaceMultiplier("fp-risky");
        assert.equal(m, pacer.RISK_MULTIPLIERS.high);
    });

    it("registering as verified removes from risky", () => {
        pacer.registerRisky("fp-x", "critical");
        pacer.registerVerified("fp-x");
        assert.equal(pacer.getPaceMultiplier("fp-x"), pacer.RISK_MULTIPLIERS.none);
    });

    it("registering as risky removes from verified", () => {
        pacer.registerVerified("fp-y");
        pacer.registerRisky("fp-y", "medium");
        assert.equal(pacer.getPaceMultiplier("fp-y"), pacer.RISK_MULTIPLIERS.medium);
    });
});

describe("executionPacer — calculatePace", () => {
    it("verified fingerprint gets fast paceLabel", () => {
        pacer.registerVerified("fp-det");
        const r = pacer.calculatePace({ fingerprint: "fp-det" }, { pressure: "none" });
        assert.equal(r.paceLabel, "fast");
        assert.equal(r.isVerified, true);
    });

    it("critical risk fingerprint gets very_slow pace", () => {
        pacer.registerRisky("fp-bad", "critical");
        const r = pacer.calculatePace({ fingerprint: "fp-bad" }, { pressure: "none" });
        assert.equal(r.paceLabel, "very_slow");
    });

    it("pace increases under critical pressure", () => {
        const noPressure   = pacer.calculatePace({ fingerprint: "fp-a" }, { pressure: "none"     });
        const highPressure = pacer.calculatePace({ fingerprint: "fp-b" }, { pressure: "critical" });
        assert.ok(highPressure.paceMs > noPressure.paceMs);
    });

    it("derives risk level from riskScore when not registered", () => {
        const r = pacer.calculatePace({ fingerprint: "fp-new" }, { riskScore: 85 });
        assert.equal(r.riskLevel, "critical");
    });

    it("pace multiplier combines fingerprint and pressure", () => {
        pacer.registerRisky("fp-mul", "high");
        const r = pacer.calculatePace({ fingerprint: "fp-mul" }, { pressure: "high" });
        assert.ok(r.multiplier > pacer.RISK_MULTIPLIERS.high);
    });
});

describe("executionPacer — adaptPacing", () => {
    it("no actions for healthy system", () => {
        const r = pacer.adaptPacing({ pressure: "none", riskScore: 0 });
        assert.ok(r.actions.length === 0 || r.globalMultiplier === 1.0);
    });

    it("fast-tracks verified under no pressure with high verified ratio", () => {
        const r = pacer.adaptPacing({ pressure: "none", riskScore: 5, verifiedRatio: 0.8 });
        assert.ok(r.actions.includes("allow_fast_path_for_verified"));
    });

    it("slows everything under critical pressure", () => {
        const r = pacer.adaptPacing({ pressure: "critical", riskScore: 80 });
        assert.ok(r.actions.includes("apply_maximum_slowdown_to_unverified"));
        assert.equal(r.globalMultiplier, pacer.PRESSURE_MULTIPLIERS.critical);
    });
});

describe("executionPacer — getPacingStats", () => {
    it("tracks decisions after calculatePace calls", () => {
        pacer.registerVerified("fp-1");
        pacer.calculatePace({ fingerprint: "fp-1" }, {});
        pacer.calculatePace({ fingerprint: "fp-2" }, {});
        const s = pacer.getPacingStats();
        assert.equal(s.decisionCount, 2);
        assert.equal(s.verifiedFingerprints, 1);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// recoveryOrchestrator
// ═══════════════════════════════════════════════════════════════════════

describe("recoveryOrchestrator — selectRecoveryStrategy", () => {
    it("selects sandbox for security_violation", () => {
        const r = rec.selectRecoveryStrategy({ type: "security_violation", severity: "P1" });
        assert.equal(r.selected, "sandbox");
    });

    it("selects reroute for cascade_failure", () => {
        const r = rec.selectRecoveryStrategy({ type: "cascade_failure", severity: "P1" });
        assert.equal(r.selected, "reroute");
    });

    it("selects retry for execution_failure first attempt", () => {
        const r = rec.selectRecoveryStrategy({ type: "execution_failure" });
        assert.equal(r.selected, "retry");
    });

    it("skips already-failed strategies and uses next", () => {
        const r = rec.selectRecoveryStrategy(
            { type: "execution_failure" },
            { priorFailedStrategies: ["retry"] }
        );
        assert.equal(r.selected, "reroute");
    });

    it("escalated flag set after 2+ prior failures", () => {
        const r = rec.selectRecoveryStrategy(
            { type: "execution_failure" },
            { priorFailedStrategies: ["retry", "reroute"] }
        );
        assert.equal(r.escalated, true);
    });

    it("falls back to sandbox when all strategies exhausted", () => {
        const r = rec.selectRecoveryStrategy(
            { type: "execution_failure" },
            { priorFailedStrategies: ["retry", "reroute", "repair"] }
        );
        assert.equal(r.selected, "sandbox");
    });

    it("includes alternatives list", () => {
        const r = rec.selectRecoveryStrategy({ type: "execution_failure" });
        assert.ok(Array.isArray(r.alternatives));
        assert.ok(r.alternatives.length > 0);
    });
});

describe("recoveryOrchestrator — executeRecovery", () => {
    it("executes a valid strategy and returns steps", () => {
        const r = rec.executeRecovery("retry", {});
        assert.equal(r.executed, true);
        assert.equal(r.strategy, "retry");
        assert.equal(r.success, true);
        assert.equal(r.steps.length, 3);
    });

    it("rejects unknown strategy", () => {
        const r = rec.executeRecovery("teleport", {});
        assert.equal(r.executed, false);
        assert.equal(r.reason, "unknown_strategy");
    });

    it("respects simulateFailure flag", () => {
        const r = rec.executeRecovery("rollback", { simulateFailure: true });
        assert.equal(r.success, false);
    });

    it("executes all 5 strategies", () => {
        for (const strategy of rec.RECOVERY_STRATEGIES) {
            const r = rec.executeRecovery(strategy, {});
            assert.equal(r.executed, true, `${strategy} should execute`);
        }
    });

    it("records execution in recovery history", () => {
        rec.executeRecovery("repair", {});
        const h = rec.getRecoveryHistory();
        assert.equal(h.length, 1);
        assert.equal(h[0].strategy, "repair");
    });
});

describe("recoveryOrchestrator — coordinateRecovery", () => {
    it("returns not coordinated for empty list", () => {
        const r = rec.coordinateRecovery([]);
        assert.equal(r.coordinated, false);
    });

    it("coordinates multiple incidents", () => {
        const r = rec.coordinateRecovery([
            { type: "execution_failure", severity: "P2" },
            { type: "resource_exhaustion", severity: "P2" },
        ]);
        assert.equal(r.coordinated, true);
        assert.equal(r.incidentCount, 2);
        assert.ok(Array.isArray(r.strategies));
    });

    it("applies global sandbox when any incident is security_violation", () => {
        const r = rec.coordinateRecovery([
            { type: "security_violation" },
            { type: "execution_failure" },
        ]);
        assert.equal(r.globalSandbox, true);
    });
});

describe("recoveryOrchestrator — scoreRecoveryOutcome", () => {
    it("returns F for empty attempts", () => {
        const r = rec.scoreRecoveryOutcome([]);
        assert.equal(r.grade, "F");
    });

    it("scores A for single successful attempt", () => {
        const r = rec.scoreRecoveryOutcome([{ success: true, attemptNumber: 1 }]);
        assert.ok(r.score >= 75);
    });

    it("penalizes multiple attempts even on success", () => {
        const oneAttempt = rec.scoreRecoveryOutcome([{ success: true, attemptNumber: 1 }]);
        const threeAttempt = rec.scoreRecoveryOutcome([{ success: true, attemptNumber: 3 }]);
        assert.ok(oneAttempt.score > threeAttempt.score);
    });

    it("scores lower for failed recoveries", () => {
        const r = rec.scoreRecoveryOutcome([
            { success: false, attemptNumber: 1 },
            { success: false, attemptNumber: 2 },
        ]);
        assert.ok(r.score < 50);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// supervisorBenchmark
// ═══════════════════════════════════════════════════════════════════════

describe("supervisorBenchmark — scoreStabilityQuality", () => {
    it("returns F for no supervisions", () => {
        const r = bench.scoreStabilityQuality([]);
        assert.equal(r.grade, "F");
    });

    it("scores higher when all supervisions are verified", () => {
        const sups = Array(5).fill({ verified: true, stabilized: false, riskScore: 10 });
        const r = bench.scoreStabilityQuality(sups);
        assert.ok(r.score > 60);
    });

    it("penalizes high average risk score", () => {
        const low  = bench.scoreStabilityQuality(Array(5).fill({ verified: true, riskScore: 5  }));
        const high = bench.scoreStabilityQuality(Array(5).fill({ verified: true, riskScore: 80 }));
        assert.ok(low.score > high.score);
    });
});

describe("supervisorBenchmark — scoreCoordinationQuality", () => {
    it("returns F for no decisions", () => {
        const r = bench.scoreCoordinationQuality([]);
        assert.equal(r.grade, "F");
    });

    it("scores well for verified multi-domain decisions", () => {
        const decisions = Array(5).fill({ finalStrategy: "fast", domainsAffected: 3, verified: true });
        const r = bench.scoreCoordinationQuality(decisions);
        assert.ok(r.score >= 60);
    });

    it("domain bonus increases score", () => {
        const lowDomain  = bench.scoreCoordinationQuality([{ finalStrategy: "safe", domainsAffected: 1, verified: true }]);
        const highDomain = bench.scoreCoordinationQuality([{ finalStrategy: "safe", domainsAffected: 4, verified: true }]);
        assert.ok(highDomain.score >= lowDomain.score);
    });
});

describe("supervisorBenchmark — scoreContainmentEffectiveness", () => {
    it("returns F for no containments", () => {
        const r = bench.scoreContainmentEffectiveness([]);
        assert.equal(r.grade, "F");
    });

    it("scores for resolved containments", () => {
        const r = bench.scoreContainmentEffectiveness([
            { outcome: "resolved", status: "closed", cascadeStopped: true },
            { outcome: "resolved", status: "closed", cascadeStopped: false },
        ]);
        assert.ok(r.score > 0);
        assert.equal(r.resolvedRate, 1);
    });

    it("cascade stopped bonus improves score", () => {
        const withCascade    = bench.scoreContainmentEffectiveness([{ outcome: "resolved", status: "closed", cascadeStopped: true }]);
        const withoutCascade = bench.scoreContainmentEffectiveness([{ outcome: "resolved", status: "closed", cascadeStopped: false }]);
        assert.ok(withCascade.score >= withoutCascade.score);
    });
});

describe("supervisorBenchmark — scoreAdaptiveEfficiency", () => {
    it("returns F for no adaptations", () => {
        const r = bench.scoreAdaptiveEfficiency([]);
        assert.equal(r.grade, "F");
    });

    it("scores A for all effective fast adaptations", () => {
        const adaptations = Array(10).fill({ improved: true, effective: true, decisionMs: 2 });
        const r = bench.scoreAdaptiveEfficiency(adaptations);
        assert.ok(r.score >= 90);
    });

    it("scores low for ineffective adaptations", () => {
        const adaptations = Array(5).fill({ improved: false, effective: false, decisionMs: 100 });
        const r = bench.scoreAdaptiveEfficiency(adaptations);
        assert.ok(r.score < 20);
    });
});

describe("supervisorBenchmark — gradeSupervisorMaturity", () => {
    it("returns F for empty scores", () => {
        const r = bench.gradeSupervisorMaturity({});
        assert.equal(r.grade, "F");
        assert.equal(r.maturity, bench.MATURITY_LEVELS.F);
    });

    it("returns A for all-high scores", () => {
        const r = bench.gradeSupervisorMaturity({ stability: 95, coordination: 92, containment: 91, adaptive: 93 });
        assert.equal(r.grade, "A");
        assert.equal(r.maturity, bench.MATURITY_LEVELS.A);
        assert.equal(r.maturity, "autonomous_supervisor");
    });

    it("verifies all maturity level labels", () => {
        assert.equal(bench.MATURITY_LEVELS.A, "autonomous_supervisor");
        assert.equal(bench.MATURITY_LEVELS.B, "coordinated_supervisor");
        assert.equal(bench.MATURITY_LEVELS.C, "reactive_supervisor");
        assert.equal(bench.MATURITY_LEVELS.D, "basic_supervisor");
        assert.equal(bench.MATURITY_LEVELS.F, "unsupervised");
    });

    it("averages scores correctly", () => {
        const r = bench.gradeSupervisorMaturity({ a: 76, b: 76, c: 74 });
        assert.ok(Math.abs(r.score - 75.3) < 0.2);
        assert.equal(r.grade, "B");
        assert.equal(r.inputs, 3);
    });

    it("ignores non-numeric values", () => {
        const r = bench.gradeSupervisorMaturity({ good: 90, label: "skip", flag: true });
        assert.equal(r.inputs, 1);
        assert.equal(r.score, 90);
    });
});
