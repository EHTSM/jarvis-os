"use strict";
/**
 * executionSimulator — probabilistic pre-execution estimation.
 *
 * Distinct from evaluation/simulator.cjs (static source analysis).
 * This module uses execution history to estimate:
 *
 *   estimateRuntime(steps)          — sum of per-step historical medians
 *   estimateFailureProbability(steps) — P(≥1 step fails) from history
 *   estimateRecoveryComplexity(steps) — expected recovery effort from clusters
 *   dryRun(steps, ctx)              — replace execute with no-op, return predictions
 *   simulate(name, steps, opts)     — full report combining all estimates
 */

const history = require("./executionHistory.cjs");
const pcl     = require("./patternCluster.cjs");

const DEFAULT_STEP_MS   = 200;   // fallback when no history
const DEFAULT_FAIL_PROB = 0.10;  // fallback failure probability per step

// ── Per-step helpers ──────────────────────────────────────────────────

function _durations(stepName) {
    return history.byType(`step:${stepName}`)
        .filter(r => r.success && r.durationMs > 0)
        .map(r => r.durationMs)
        .sort((a, b) => a - b);
}

function _median(sorted) {
    if (sorted.length === 0) return DEFAULT_STEP_MS;
    return sorted[Math.floor(sorted.length / 2)];
}

function _failureRate(stepName) {
    const recs = history.byType(`step:${stepName}`);
    if (recs.length < 3) return DEFAULT_FAIL_PROB;
    const successes = recs.filter(r => r.success).length;
    return parseFloat((1 - successes / recs.length).toFixed(3));
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Estimated total runtime = sum of per-step historical medians.
 *
 * @param {object[]} steps
 * @returns {{ totalMs, perStep[], hasHistory }}
 */
function estimateRuntime(steps) {
    const perStep = steps.map(s => ({
        name:        s.name,
        estimatedMs: _median(_durations(s.name)),
    }));
    return {
        totalMs:    perStep.reduce((s, v) => s + v.estimatedMs, 0),
        perStep,
        hasHistory: steps.some(s => history.byType(`step:${s.name}`).length >= 3),
    };
}

/**
 * P(at least one step fails) = 1 − ∏ P(step_i succeeds).
 *
 * @param {object[]} steps
 * @returns {{ overallFailureProbability, perStep[], highRiskSteps[] }}
 */
function estimateFailureProbability(steps) {
    const perStep = steps.map(s => ({
        name:        s.name,
        failureProb: _failureRate(s.name),
    }));

    const pAllSucceed  = perStep.reduce((p, v) => p * (1 - v.failureProb), 1.0);
    const highRiskSteps = perStep.filter(s => s.failureProb > 0.30).map(s => s.name);

    return {
        overallFailureProbability: parseFloat((1 - pAllSucceed).toFixed(3)),
        perStep,
        highRiskSteps,
    };
}

/**
 * Estimate recovery effort from pattern cluster history.
 * A step with many recorded recovery attempts needs more future recovery budget.
 *
 * @param {object[]} steps
 * @returns {{ totalEstimatedRecoveries, complexity, perStep[] }}
 */
function estimateRecoveryComplexity(steps) {
    const clusters = pcl.getClusters();
    let totalEst   = 0;

    const perStep = steps.map(s => {
        const matching = clusters.filter(c =>
            c.stepName && (s.name.includes(c.stepName) || c.stepName.includes(s.name))
        );

        let est = 0;
        if (matching.length > 0) {
            const avgTotal = matching.reduce((sum, c) => sum + c.totalAttempts, 0) / matching.length;
            const avgSuccesses = matching.reduce((sum, c) => sum + c.totalSuccesses, 0) / matching.length;
            // Expected retries before success = 1/successRate (geometric dist)
            const avgRate = avgSuccesses / Math.max(avgTotal, 1);
            est = avgRate > 0 ? parseFloat(((1 / avgRate) - 1).toFixed(1)) : 1;
        }
        totalEst += est;
        return { name: s.name, estimatedRecoveryAttempts: est };
    });

    return {
        totalEstimatedRecoveries: parseFloat(totalEst.toFixed(1)),
        complexity: totalEst < 1 ? "low" : totalEst < 3 ? "medium" : "high",
        perStep,
    };
}

/**
 * Dry-run: execute steps with ctx._dryRun = true.
 * Steps can check this flag to no-op themselves.
 * For steps that don't handle it, execute() is skipped entirely (returns null).
 *
 * @param {object[]} steps
 * @param {object}   ctx
 * @returns {{ steps[], allSimulated }}
 */
async function dryRun(steps, ctx = {}) {
    const dryCtx = { ...ctx, _dryRun: true };
    const results = [];

    for (const step of steps) {
        const t0 = Date.now();
        try {
            const result = typeof step.dryRun === "function"
                ? await step.dryRun(dryCtx)
                : null;

            const ms = Date.now() - t0;
            results.push({
                name:        step.name,
                simulated:   true,
                result,
                actualMs:    ms,
                estimatedMs: _median(_durations(step.name)),
                failureProb: _failureRate(step.name),
            });
            dryCtx[step.name] = result;
        } catch (err) {
            results.push({ name: step.name, simulated: false, error: err.message });
        }
    }

    return { steps: results, allSimulated: results.every(r => r.simulated !== false) };
}

/**
 * Full pre-execution simulation report.
 *
 * @param {string}   name
 * @param {object[]} steps
 * @param {{ dryRun?: boolean, ctx?: object }} opts
 * @returns {SimulationReport}
 */
async function simulate(name, steps, opts = {}) {
    const runtime    = estimateRuntime(steps);
    const failure    = estimateFailureProbability(steps);
    const complexity = estimateRecoveryComplexity(steps);
    const dry        = opts.dryRun ? await dryRun(steps, opts.ctx || {}) : null;

    const fp = failure.overallFailureProbability;
    const riskLevel = fp > 0.50 ? "high" : fp > 0.20 ? "medium" : "low";

    return {
        workflowName:                name,
        estimatedRuntimeMs:          runtime.totalMs,
        overallFailureProbability:   failure.overallFailureProbability,
        recoveryComplexity:          complexity.complexity,
        riskLevel,
        highRiskSteps:               failure.highRiskSteps,
        runtime,
        failure,
        complexity,
        dryRunResult:                dry,
        simulatedAt:                 new Date().toISOString(),
    };
}

module.exports = {
    estimateRuntime,
    estimateFailureProbability,
    estimateRecoveryComplexity,
    dryRun,
    simulate,
    DEFAULT_STEP_MS,
    DEFAULT_FAIL_PROB,
};
