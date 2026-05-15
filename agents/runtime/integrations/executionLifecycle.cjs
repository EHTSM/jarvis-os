"use strict";
/**
 * executionLifecycle — pure pre/post execution hooks for memory-aware runtime.
 *
 * preExecution(plan, entries, depStab, opts)
 *   → PreContext { fingerprint, blocked, reason?, strategy, retryPolicy, confidence,
 *                  successRate, rollbackRate, overallDepStability, complexity, planLookup }
 *
 * postExecution(result, preCtx, opts)
 *   → PostContext { hallucination, verification, completion, trustScore,
 *                   calibrated, memoryEntry, depUpdates[], analytics }
 *
 * All functions are pure (no side effects) — callers own all I/O and recording.
 */

const wfp = require("../memory/workflowFingerprint.cjs");
const wl  = require("../memory/workflowLearning.cjs");
const ari = require("../memory/adaptiveRetryIntelligence.cjs");
const ess = require("../memory/executionStrategySelector.cjs");
const map = require("../memory/memoryAwarePlanner.cjs");
const ea  = require("../memory/executionAnalytics.cjs");
const ts  = require("../trust/executionTrustScorer.cjs");
const cc  = require("../trust/confidenceCalibrator.cjs");
const hd  = require("../trust/hallucinationDetector.cjs");
const ve  = require("../trust/verificationEngine.cjs");
const cp  = require("../trust/completionPolicy.cjs");

// ── helpers ───────────────────────────────────────────────────────────

function _avgDepStability(depStab = {}) {
    const vals = Object.values(depStab);
    if (vals.length === 0) return 1.0;
    return vals.reduce((s, v) => s + (v.stability ?? 1.0), 0) / vals.length;
}

function _estimateComplexity(plan) {
    const steps = (plan.executionOrder ?? plan.steps ?? []).length;
    return Math.min(1.0, steps / 10);   // 10 steps → complexity 1.0
}

function _totalRetries(steps = []) {
    return steps.reduce((s, st) => s + Math.max(0, (st.attempts ?? 1) - 1), 0);
}

// ── preExecution ──────────────────────────────────────────────────────

function preExecution(plan, entries = [], depStab = {}, opts = {}) {
    const fingerprint = wfp.generate({
        steps:    plan.steps ?? plan.executionOrder ?? [],
        deps:     plan.deps ?? [],
        category: plan.category ?? "default",
    });

    // Danger checks
    const avoidCheck  = wl.shouldAvoid(fingerprint, entries, opts.consecutiveFailThreshold ?? 3);
    const rejectCheck = map.shouldReject(fingerprint, entries, opts.rejectThreshold ?? 3);

    if ((avoidCheck.avoid || rejectCheck.reject) && !opts.forceExecute) {
        return {
            fingerprint,
            blocked:              true,
            reason:               avoidCheck.reason ?? rejectCheck.reason,
            strategy:             null,
            retryPolicy:          null,
            confidence:           0,
            successRate:          null,
            rollbackRate:         0,
            overallDepStability:  _avgDepStability(depStab),
            complexity:           _estimateComplexity(plan),
            planLookup:           map.lookupPlan(fingerprint, entries),
        };
    }

    // Per-fingerprint analytics
    const fpEntries     = entries.filter(e => e.fingerprint === fingerprint);
    const fpAnalytics   = ea.compute(fpEntries);
    const successRate   = fpAnalytics.totalExecutions > 0 ? fpAnalytics.successRate : null;
    const rollbackRate  = fpAnalytics.rollbackFrequency;
    const rollbackCount = fpEntries.filter(e => e.rollbackTriggered).length;

    const overallDepStability = _avgDepStability(depStab);
    const complexity          = _estimateComplexity(plan);

    // Strategy selection
    const strategy = opts.strategyHint ?? ess.select({
        sandboxRequired: opts.sandboxRequired ?? false,
        successRate,
        rollbackRate,
        depStability:    overallDepStability,
        complexity,
    });

    // Adaptive retry policy
    const retryPolicy = ari.computePolicy({
        fingerprint,
        entries,
        depStability:  overallDepStability,
        rollbackCount,
        complexity,
    });

    // Confidence: start at 50, boost from proven successes, penalise recent failures
    const recentFailures = fpEntries.filter(e => !e.success).length;
    let confidence = map.boostConfidence(50, fingerprint, entries);
    confidence = Math.max(10, confidence - recentFailures * 5);

    return {
        fingerprint,
        blocked:             false,
        strategy,
        retryPolicy,
        confidence,
        successRate,
        rollbackRate,
        overallDepStability,
        complexity,
        planLookup:          map.lookupPlan(fingerprint, entries),
    };
}

// ── postExecution ─────────────────────────────────────────────────────

function postExecution(result, preCtx, opts = {}) {
    // Hallucination detection
    const hallucination = hd.analyze(result, {
        plan:              opts.plan              ?? {},
        requiredArtifacts: opts.requiredArtifacts ?? [],
    });

    // Output verification (against caller-supplied expected output if any)
    const verification = ve.verifyOutput(opts.expectedOutput ?? null, null);

    // Completion policy gate
    const completion = cp.enforce(result, verification, {
        policy: opts.completionPolicy ?? "lenient",
    });

    // Trust scoring from step results
    const trustScore = ts.scoreWorkflow(result.steps ?? []);

    // Confidence calibration
    const retryCount = _totalRetries(result.steps ?? []);
    const calibrated = cc.calibrate({
        deterministic:     preCtx.strategy === "dry_run" || preCtx.strategy === "staged",
        retries:           retryCount,
        successRate:       preCtx.successRate ?? (result.success ? 1.0 : 0.0),
        depStability:      preCtx.overallDepStability ?? 1.0,
        verificationPassed: verification.verified && hallucination.safe,
    });

    // Derive dependency updates from step results (for caller to persist)
    const depUpdates = (result.steps ?? []).map(step => ({
        depId: step.id,
        type:  (step.state === "completed" || step.state === "skipped" || step.state === "simulated")
               ? "tool_success"
               : "tool_failure",
    }));

    // Memory entry (for caller to persist via mem.record)
    const memoryEntry = {
        executionId:       result.executionId,
        taskId:            opts.taskId            ?? null,
        fingerprint:       preCtx.fingerprint,
        strategy:          preCtx.strategy,
        success:           completion.passed,
        durationMs:        result.totalDurationMs ?? 0,
        retryCount,
        rollbackTriggered: result.rollbackTriggered ?? false,
        failureReason:     result.error ?? null,
        state:             result.state,
    };

    // Single-execution analytics slice for immediate reporting
    const analytics = ea.compute([memoryEntry]);

    return { hallucination, verification, completion, trustScore, calibrated, memoryEntry, depUpdates, analytics };
}

module.exports = { preExecution, postExecution };
