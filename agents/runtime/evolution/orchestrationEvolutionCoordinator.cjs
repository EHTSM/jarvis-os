"use strict";
/**
 * orchestrationEvolutionCoordinator — centralises all adaptive evolution modules.
 *
 * beforeExecution(plan, entries, depStability, metrics, opts)  → EvolutionPreContext
 * afterExecution(result, preCtx, entries, depStability, opts)  → EvolutionPostContext
 * onFailure(result, preCtx, observations)                      → FailureResponse
 * onRecovery(result, preCtx)                                   → RecoveryResponse
 * getEvolutionState()                                          → EvolutionSnapshot
 * reset()
 *
 * Pure integration — no new agents, no UI, no wrappers.
 * Each hook calls existing evolution modules; callers own I/O and persistence.
 */

const pfp  = require("./predictiveFailurePrevention.cjs");
const ocs  = require("./orchestrationConfidenceScorer.cjs");
const wp   = require("./workloadProfiler.cjs");
const apt  = require("./adaptivePolicyTuner.cjs");
const aci  = require("./adaptiveConcurrencyIntelligence.cjs");
const sho  = require("./selfHealingOrchestrator.cjs");
const see  = require("./strategyEvolutionEngine.cjs");
const eg   = require("./executionGenetics.cjs");
const em   = require("./evolutionMemory.cjs");
const tele = require("./adaptiveTelemetry.cjs");

// ── oscillation guard ─────────────────────────────────────────────────
// Prevents rapid policy thrashing: a policy key can only be tuned once per interval.
const MIN_TUNE_INTERVAL_MS = 5000;
const _lastTuned = new Map();  // policyKey → timestamp

function _canTune(policyKey) {
    const last = _lastTuned.get(policyKey) ?? 0;
    return (Date.now() - last) >= MIN_TUNE_INTERVAL_MS;
}

function _markTuned(policyKey) {
    _lastTuned.set(policyKey, Date.now());
}

// ── helpers ───────────────────────────────────────────────────────────

function _fingerprint(plan) {
    return plan?._fp ?? plan?.fingerprint ?? plan?.taskId ?? plan?.id ?? "unknown";
}

function _steps(plan) {
    return plan?.steps ?? (plan?.executionOrder ?? []).map(id => ({ id }));
}

// ── beforeExecution ───────────────────────────────────────────────────

function beforeExecution(plan, entries = [], depStability = {}, metrics = {}, opts = {}) {
    const fp = _fingerprint(plan);

    // 1. Predictive failure prevention
    const riskReport = pfp.predict({
        fingerprint:  fp,
        entries,
        depStability,
        metrics,
        queueDepth:   opts.queueDepth   ?? 0,
        arrivalRate:  opts.arrivalRate  ?? 0,
        drainRate:    opts.drainRate    ?? 1,
    });

    // Block CRITICAL risk unless forced
    if (riskReport.overallRisk === "critical" && !opts.forceExecute) {
        tele.emit("predictive_warning", {
            fingerprint: fp,
            risk:        riskReport.overallRisk,
            blocked:     true,
        });
        return {
            fp,
            blocked:      true,
            blockReason:  "predictive_risk_critical",
            riskReport,
            confidenceReport: null,
            workloadProfile:  null,
            policyAdjustments: {},
            currentPolicy:    apt.getPolicy(fp),
            concurrencyLevel: aci.getOptimalConcurrency(),
            strategyOverride: null,
        };
    }

    // Emit predictive warning for HIGH/MEDIUM
    if (riskReport.shouldWarn) {
        tele.emit("predictive_warning", {
            fingerprint: fp,
            risk:        riskReport.overallRisk,
            blocked:     false,
        });
    }

    // 2. Orchestration confidence (pre)
    const confidenceReport = ocs.score({
        fingerprint:    fp,
        entries,
        depStability,
        classification: opts.classification ?? "safe",
        resourceStatus: { pressure: metrics.pressure ?? "none" },
    });

    tele.emit("evolution_checkpoint", {
        fingerprint: fp,
        phase:       "pre_execution",
        confidence:  confidenceReport.overall.score,
    });

    // 3. Workload profiling + policy adjustment
    const workloadProfile  = wp.classify(entries.filter(e => e.fingerprint === fp), depStability, metrics);
    const profileBehavior  = wp.getProfileBehavior(workloadProfile.primary);
    const policyAdjustments = wp.profileAffectsOrchestration(workloadProfile.profiles, {});

    // 4. Current adaptive policy
    const currentPolicy = apt.getPolicy(fp);

    // 5. Concurrency level
    const concurrencyLevel = aci.getOptimalConcurrency();

    // 6. Evolved strategy
    const CANDIDATES = ["safe", "fast", "staged", "recovery_first", "sandbox", "dry_run"];
    const fpCandidates = opts.strategyCandidates ?? CANDIDATES;
    const evolutionResult = see.evolveStrategy(fp, fpCandidates);
    const strategyOverride = evolutionResult.strategy !== "safe" || evolutionResult.evolved
        ? evolutionResult.strategy
        : (profileBehavior.preferredStrategy ?? null);

    if (evolutionResult.evolved) {
        tele.emit("strategy_evolved", {
            fingerprint: fp,
            from:        evolutionResult.from,
            strategy:    evolutionResult.strategy,
            score:       evolutionResult.score,
        });
    }

    return {
        fp,
        blocked:          false,
        blockReason:      null,
        riskReport,
        confidenceReport,
        workloadProfile,
        profileBehavior,
        policyAdjustments,
        currentPolicy,
        concurrencyLevel,
        strategyOverride,
        evolutionResult,
    };
}

// ── afterExecution ────────────────────────────────────────────────────

function afterExecution(result, preCtx, entries = [], depStability = {}, opts = {}) {
    const fp          = preCtx?.fp ?? _fingerprint(result);
    const strategy    = result?._integration?.strategy ?? result?.strategy ?? preCtx?.strategyOverride ?? "safe";
    const success     = result?.success ?? false;
    const durationMs  = result?.totalDurationMs ?? 0;
    const telEmitted  = [];

    // 1. Recompute confidence + delta
    const postConfidence = ocs.score({
        fingerprint:    fp,
        entries,
        depStability,
        classification: opts.classification ?? "safe",
        resourceStatus: { pressure: opts.resourcePressure ?? "none" },
    });
    const preScore      = preCtx?.confidenceReport?.overall?.score ?? postConfidence.overall.score;
    const confidenceDelta = postConfidence.overall.score - preScore;

    tele.emit("evolution_checkpoint", {
        fingerprint: fp,
        phase:       "post_execution",
        confidence:  postConfidence.overall.score,
        delta:       confidenceDelta,
    });
    telEmitted.push("evolution_checkpoint");

    // Persist confidence trend in evolution memory
    em.recordAdaptationOutcome(fp, {
        type:       "confidence_update",
        pre:        preScore,
        post:       postConfidence.overall.score,
        delta:      confidenceDelta,
        strategy,
        success,
    });

    // 2. Policy tuning (oscillation guard)
    let tuningResult = null;
    if (_canTune(fp)) {
        const fpEntries    = entries.filter(e => e.fingerprint === fp);
        const successRate  = fpEntries.length > 0
            ? fpEntries.filter(e => e.success).length / fpEntries.length
            : (success ? 1 : 0);
        const avgRetries   = fpEntries.reduce((s, e) => s + (e.retryCount ?? 0), 0) / Math.max(1, fpEntries.length);
        const rollbackRate = fpEntries.filter(e => e.rollbackTriggered).length / Math.max(1, fpEntries.length);

        tuningResult = apt.tune(fp, {
            successRate,
            avgRetries,
            rollbackRate,
            resourcePressure: opts.resourcePressure ?? "none",
            depStability:    _avgStability(depStability),
        });

        if (tuningResult.tuned) {
            _markTuned(fp);
            tele.emit("policy_tuned", {
                fingerprint: fp,
                changes:     tuningResult.changes,
                reasons:     tuningResult.reasons,
            });
            telEmitted.push("policy_tuned");
            em.recordSafeConfig(`${fp}-policy`, tuningResult.policy);
        }
    }

    // 3. Record strategy outcome + evolve
    see.recordOutcome(fp, strategy, success, durationMs);
    const evolutionResult = see.evolveStrategy(fp, opts.strategyCandidates ?? ["safe","fast","staged","recovery_first","sandbox"]);
    if (evolutionResult.evolved) {
        tele.emit("strategy_evolved", {
            fingerprint: fp,
            strategy:    evolutionResult.strategy,
            from:        evolutionResult.from,
            score:       evolutionResult.score,
        });
        telEmitted.push("strategy_evolved");
    }

    // 4. Record genome
    const genome = {
        strategy,
        retryLimit:    preCtx?.currentPolicy?.retryLimit ?? 3,
        classification: opts.classification ?? "safe",
        sandboxed:     strategy === "sandbox",
        rollbackReady: result?.rollbackReady ?? false,
    };
    eg.recordGenome(fp, genome, success, durationMs);

    // 5. Learn drain rate
    if (opts.queueDepth != null && durationMs > 0) {
        aci.learnDrainRate(opts.queueDepth, durationMs);
    }
    aci.recordExecution(durationMs, success, preCtx?.concurrencyLevel ?? 4);

    // 6. Concurrency scaling decision
    const resourceStatus  = { pressure: opts.resourcePressure ?? "none", avgQueueDepth: opts.queueDepth ?? 0 };
    const scaledUp   = aci.shouldScaleUp(resourceStatus);
    const scaledDown = aci.shouldScaleDown(resourceStatus);
    if (scaledUp || scaledDown) {
        tele.emit("concurrency_scaled", {
            fingerprint:   fp,
            direction:     scaledUp ? "up" : "down",
            newLevel:      aci.getOptimalConcurrency(),
            pressure:      resourceStatus.pressure,
        });
        telEmitted.push("concurrency_scaled");
    }

    // 7. Evolution pattern recording
    if (success) {
        em.recordEvolutionPattern(fp, { strategy, success: true, durationMs, confidenceDelta });
        if (evolutionResult.evolved) {
            em.recordAdaptationOutcome(fp, {
                type:    "strategy_evolution",
                from:    evolutionResult.from,
                to:      evolutionResult.strategy,
                success: true,
            });
        }
    }

    return {
        fp,
        confidenceDelta,
        postConfidence,
        tuningResult,
        evolutionResult,
        genomeRecorded: genome,
        concurrencyLevel: aci.getOptimalConcurrency(),
        telemetryEmitted: telEmitted,
    };
}

// ── onFailure ─────────────────────────────────────────────────────────

function onFailure(result, preCtx, observations = {}) {
    const fp         = preCtx?.fp ?? _fingerprint(result);
    const strategy   = preCtx?.strategyOverride ?? "safe";
    const telEmitted = [];

    // Record failed strategy outcome
    see.recordOutcome(fp, strategy, false, result?.totalDurationMs ?? 0);

    // Self-healing
    const healingPlan = sho.heal({
        fingerprint:    fp,
        plan:           result?.plan ?? null,
        currentStrategy: strategy,
        currentMode:    observations.currentMode ?? "direct",
        entries:        observations.entries     ?? [],
        depStability:   observations.depStability ?? {},
        breakerState:   observations.breakerState ?? "closed",
        anomalies:      observations.anomalies    ?? [],
        observations,
    });

    if (healingPlan.healed) {
        tele.emit("self_healing_triggered", {
            fingerprint: fp,
            actions:     healingPlan.recovery?.actions?.map(a => a.action) ?? [],
            strategy:    healingPlan.strategy?.to ?? strategy,
        });
        telEmitted.push("self_healing_triggered");
    }

    // Emergency policy tuning on failure (bypass oscillation guard for critical failures)
    const failureStreak  = observations.failureStreak ?? 1;
    const isEmergency    = failureStreak >= 3 || observations.breakerState === "open";
    let emergencyTuning  = null;

    if (isEmergency || _canTune(fp)) {
        emergencyTuning = apt.tune(fp, {
            successRate:      0,
            avgRetries:       observations.avgRetries ?? 1,
            rollbackRate:     observations.rollbackRate ?? 0,
            resourcePressure: observations.resourcePressure ?? "none",
            failureStreak,
        });
        if (emergencyTuning.tuned) {
            _markTuned(fp);
            tele.emit("policy_tuned", {
                fingerprint: fp,
                emergency:   true,
                changes:     emergencyTuning.changes,
            });
            telEmitted.push("policy_tuned");
        }
    }

    // Record failed genome
    const genome = {
        strategy,
        classification: observations.classification ?? "safe",
        rollbackReady:  result?.rollbackReady ?? false,
    };
    eg.recordGenome(fp, genome, false, result?.totalDurationMs ?? 0);
    em.recordFailedMutation(fp, { strategy, reason: result?.error ?? "execution_failed" });

    return {
        fp,
        healingPlan,
        emergencyTuning,
        telemetryEmitted: telEmitted,
    };
}

// ── onRecovery ────────────────────────────────────────────────────────

function onRecovery(result, preCtx, opts = {}) {
    const fp         = preCtx?.fp ?? _fingerprint(result);
    const strategy   = preCtx?.strategyOverride ?? result?.strategy ?? "safe";
    const telEmitted = [];

    // Record recovery pattern
    const pattern = {
        strategy,
        success:    true,
        durationMs: result?.totalDurationMs ?? 0,
        source:     opts.recoverySource ?? "auto",
    };
    em.recordRecoveryPattern?.(fp, pattern);
    em.recordAdaptationOutcome(fp, {
        type:    "recovery",
        strategy,
        success: true,
    });

    // Boost strategy score on successful recovery
    see.recordOutcome(fp, strategy, true, result?.totalDurationMs ?? 0);

    // Record successful genome
    eg.recordGenome(fp, {
        strategy,
        rollbackReady: true,
        classification: opts.classification ?? "safe",
    }, true, result?.totalDurationMs ?? 0);

    tele.emit("self_healing_triggered", {
        fingerprint:  fp,
        phase:        "recovery",
        strategy,
        recovered:    true,
    });
    telEmitted.push("self_healing_triggered");

    return {
        fp,
        patternRecorded: pattern,
        strategyBoosted: true,
        telemetryEmitted: telEmitted,
    };
}

// ── getEvolutionState ─────────────────────────────────────────────────

function getEvolutionState(fingerprint) {
    const fp = fingerprint ?? null;

    return {
        preferredStrategy:    fp ? see.getPreferredStrategy(fp)         : null,
        evolutionGeneration:  fp ? see.getEvolutionGeneration(fp)       : null,
        bestGenome:           fp ? eg.getBestGenome(fp)                  : null,
        currentPolicy:        fp ? apt.getPolicy(fp)                    : null,
        optimalConcurrency:   aci.getOptimalConcurrency(),
        parallelismLimit:     aci.getParallelismLimit(),
        optimalDrainRate:     aci.getOptimalDrainRate(),
        highSuccessRoutes:    eg.getHighSuccessRoutes(),
        recoveryChains:       eg.getOptimalRecoveryChains(),
        adaptationHistory:    fp ? em.getAdaptationHistory(fp)           : [],
        safeConfig:           fp ? em.getSafeConfig(`${fp}-policy`)      : null,
        telemetryLog:         tele.getLog(),
        ts:                   new Date().toISOString(),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    see.reset();
    apt.reset();
    aci.reset();
    eg.reset();
    em.reset();
    tele.reset();
    _lastTuned.clear();
}

// ── helpers ───────────────────────────────────────────────────────────

function _avgStability(depStability) {
    const vals = Object.values(depStability);
    if (vals.length === 0) return 1.0;
    return vals.reduce((s, v) => s + (v.stability ?? 1.0), 0) / vals.length;
}

module.exports = {
    beforeExecution,
    afterExecution,
    onFailure,
    onRecovery,
    getEvolutionState,
    reset,
};
