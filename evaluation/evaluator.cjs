"use strict";
/**
 * evaluator — task execution evaluation system.
 *
 * Orchestrates the full evaluation pipeline per suite:
 *   preflight → simulation → execution → root-cause analysis → report
 *
 * Measures 7 metrics per run and aggregates across repeated runs:
 *   1. completionRate          — % of suites that completed successfully
 *   2. humanInterventionCount  — runs where recovery gave up (needs human)
 *   3. avgRecoveryAttempts     — total recoveries / failed-step count
 *   4. rollbackFrequency       — rollbacks / total runs
 *   5. recoverySuccessPerType  — per failure-type success rate from memory
 *   6. avgExecutionDuration    — ms per run
 *   7. stabilityScore          — 0–100: consistency across repeated runs
 */

const { runWorkflow }       = require("../agents/runtime/autonomousWorkflow.cjs");
const { runPreflight }      = require("./preflight.cjs");
const { simulateWorkflow }  = require("./simulator.cjs");
const { sandboxedRun }      = require("./sandbox.cjs");
const { RootCauseGraph }    = require("./rootCauseGraph.cjs");
const { generateTextReport, generateJsonReport } = require("./debugReport.cjs");
const { F }                 = require("../agents/runtime/recoveryEngine.cjs");
const memory                = require("../agents/runtime/failureMemory.cjs");
const SUITES                = require("./taskSuites.cjs");

// ── Per-run metrics ───────────────────────────────────────────────────

function computeMetrics(result) {
    const steps     = result.stepDetails || [];
    const failed    = steps.filter(s => s.status === "failed");
    const completed = steps.filter(s => s.status === "completed");
    const totalRecoveries = steps.reduce((n, s) => n + (s.recoveries || 0), 0);
    const rollbacks = steps.some(s => s.status === "failed") ? 1 : 0;
    const totalAttempts = steps.reduce((n, s) => n + (s.attempts || 1), 0);

    // Human intervention needed: any step that failed with exhausted recoveries
    const humanNeeded = failed.some(s => {
        // If a step failed with 0 recoveries, no automated repair was possible
        return (s.recoveries || 0) === 0;
    });

    return {
        success:                  result.success,
        healthScore:              result.healthScore,
        completedSteps:           completed.length,
        failedSteps:              failed.length,
        totalSteps:               steps.length,
        totalRecoveries,
        avgRecoveryAttempts:      failed.length > 0 ? (totalRecoveries / failed.length).toFixed(2) : "0.00",
        rollbacks,
        humanInterventionNeeded:  humanNeeded,
        totalAttempts,
        durationMs:               result.durationMs || 0,
    };
}

// ── Suite runner ──────────────────────────────────────────────────────

/**
 * Run a single named suite through the full evaluation pipeline.
 *
 * opts:
 *   sandboxed        {boolean}  — run in isolated temp directory
 *   skipPreflight    {boolean}  — skip preflight checks
 *   skipSimulation   {boolean}  — skip dry-run analysis
 *   maxRetries       {number}   — workflow retry count
 *   preflightOpts    {object}   — forwarded to runPreflight
 */
async function runSuite(suiteName, opts = {}) {
    const factory = SUITES[suiteName];
    if (!factory) throw new Error(`Unknown suite: "${suiteName}". Available: ${Object.keys(SUITES).join(", ")}`);

    const suite = factory();
    let preflight  = null;
    let simulation = null;

    try {
        // 1. Preflight
        if (!opts.skipPreflight) {
            preflight = await runPreflight(suite.projectPath, {
                checkDeps:    false, // task suites use temp dirs without node_modules
                checkSyntaxScan: false, // syntax is intentionally broken in some suites
                ...opts.preflightOpts,
            });
            if (!preflight.canProceed) {
                return {
                    suiteName, skipped: true, reason: "preflight_blocked",
                    preflight, simulation: null, rootCause: null, metrics: null, result: null,
                };
            }
        }

        // 2. Simulation
        if (!opts.skipSimulation) {
            simulation = await simulateWorkflow(suite.steps);
        }

        // 3. Execute
        const t0    = Date.now();
        const runFn = (opts.sandboxed && suite.projectPath)
            ? (name, steps, runOpts) => sandboxedRun(suite.projectPath, name, steps, runOpts)
            : runWorkflow;

        const result = await runFn(suiteName, suite.steps, {
            maxRetries: opts.maxRetries ?? 3,
            ctx:        opts.ctx || {},
        });

        result.durationMs = result.durationMs ?? (Date.now() - t0);

        // 4. Root cause graph
        const rcg = RootCauseGraph.fromStepDetails(result.stepDetails || []);

        const metrics = computeMetrics(result);

        return {
            suiteName,
            skipped:   false,
            result,
            preflight,
            simulation,
            rootCause: rcg.toJSON(),
            metrics,
        };

    } finally {
        if (suite.cleanup) suite.cleanup();
    }
}

// ── Multi-run stability measurement ───────────────────────────────────

/**
 * Run a suite N times and measure consistency.
 *
 * @returns {{ runs, completionRate, stabilityScore, avgDurationMs, metrics[] }}
 */
async function runRepeated(suiteName, n = 5, opts = {}) {
    const results = [];
    for (let i = 0; i < n; i++) {
        const r = await runSuite(suiteName, opts);
        results.push(r);
    }

    const completions = results.map(r => r.result?.success ? 1 : 0);
    const completionRate = completions.reduce((a, b) => a + b, 0) / n;

    const durations = results.map(r => r.result?.durationMs || 0);
    const avgDurationMs = Math.round(durations.reduce((a, b) => a + b, 0) / n);

    // Stability: 100 if always same result; decreases with variance
    const mean   = completionRate;
    const variance = completions.reduce((s, c) => s + (c - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const stabilityScore = Math.round((1 - stdDev) * 100);

    const humanInterventions = results.filter(r => r.metrics?.humanInterventionNeeded).length;

    return {
        suiteName,
        runs: n,
        completionRate: parseFloat(completionRate.toFixed(3)),
        stabilityScore: Math.max(0, stabilityScore),
        avgDurationMs,
        humanInterventionCount: humanInterventions,
        results,
    };
}

// ── All-suites runner ─────────────────────────────────────────────────

async function runAllSuites(opts = {}) {
    const names   = Object.keys(SUITES);
    const results = [];

    for (const name of names) {
        results.push(await runSuite(name, opts));
    }

    return aggregateResults(results);
}

function aggregateResults(results) {
    const valid      = results.filter(r => !r.skipped && r.result);
    const completed  = valid.filter(r => r.result.success);
    const failed     = valid.filter(r => !r.result.success);

    const completionRate    = valid.length > 0 ? completed.length / valid.length : 0;
    const totalRecoveries   = valid.reduce((s, r) => s + (r.metrics?.totalRecoveries || 0), 0);
    const totalFailedSteps  = valid.reduce((s, r) => s + (r.metrics?.failedSteps || 0), 0);
    const avgRecoveries     = totalFailedSteps > 0 ? (totalRecoveries / totalFailedSteps).toFixed(2) : "0.00";
    const avgDurationMs     = valid.length > 0
        ? Math.round(valid.reduce((s, r) => s + (r.metrics?.durationMs || 0), 0) / valid.length)
        : 0;
    const rollbackFrequency = valid.length > 0
        ? (valid.reduce((s, r) => s + (r.metrics?.rollbacks || 0), 0) / valid.length).toFixed(3)
        : "0.000";
    const humanInterventions = valid.reduce((s, r) => s + (r.metrics?.humanInterventionNeeded ? 1 : 0), 0);
    const avgHealth = valid.length > 0
        ? Math.round(valid.reduce((s, r) => s + (r.result?.healthScore || 0), 0) / valid.length)
        : 0;

    // Recovery success per failure type from memory
    const memSnap   = memory.snapshot();
    const typeStats = {};
    for (const [type, strategies] of Object.entries(memSnap)) {
        const total   = Object.values(strategies).reduce((s, e) => s + e.attempts,  0);
        const success = Object.values(strategies).reduce((s, e) => s + e.successes, 0);
        if (total > 0) typeStats[type] = { attempts: total, successes: success, rate: (success / total).toFixed(2) };
    }

    return {
        totalSuites:              results.length,
        completed:                completed.length,
        failed:                   failed.length,
        skipped:                  results.filter(r => r.skipped).length,
        completionRate:           parseFloat(completionRate.toFixed(3)),
        humanInterventionCount:   humanInterventions,
        avgRecoveryAttempts:      avgRecoveries,
        rollbackFrequency:        parseFloat(rollbackFrequency),
        recoverySuccessPerType:   typeStats,
        avgExecutionDurationMs:   avgDurationMs,
        avgHealthScore:           avgHealth,
        suiteResults:             results,
    };
}

// ── Report generation ─────────────────────────────────────────────────

function generateReport(suiteResult, format = "text") {
    return format === "json"
        ? generateJsonReport(suiteResult)
        : generateTextReport(suiteResult);
}

module.exports = {
    runSuite,
    runRepeated,
    runAllSuites,
    aggregateResults,
    generateReport,
    computeMetrics,
    SUITE_NAMES: Object.keys(SUITES),
};
