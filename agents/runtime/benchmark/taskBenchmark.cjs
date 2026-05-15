"use strict";
/**
 * taskBenchmark — run a scenario function N times and collect measurable metrics.
 *
 * run(fn, times, opts?)
 *   → { runs[], successRate, failRate, avgMs, p50Ms, p95Ms,
 *        flipRate, consistency, minMs, maxMs, totalMs }
 *   fn must return or resolve { success, repaired?, durationMs? }
 *
 * benchmark(scenario, times, opts?)
 *   → { name, category, ...runMetrics, repairRate, retryEfficiency }
 *   scenario = { name, category, run() }
 *
 * score(metrics)
 *   → { completion, repairRate, stability, reproducibility, composite } — all 0–100
 *
 * store(name, result)  — accumulate results
 * getAll()             → all stored benchmarks
 * reset()
 */

const el = require("./executionLimits.cjs");

let _results = [];
let _seq     = 0;

// ── run ───────────────────────────────────────────────────────────────

async function run(fn, times = 1, opts = {}) {
    const limits  = opts.limits || {};
    const limiter = el.createLimiter(limits);
    const runs    = [];

    for (let i = 0; i < times; i++) {
        const t0 = Date.now();
        let outcome;

        try {
            const result = await Promise.resolve(fn());
            outcome = {
                index:     i + 1,
                success:   !!result?.success,
                repaired:  result?.repaired ?? false,
                retries:   result?.retries  ?? 0,
                durationMs: result?.durationMs ?? (Date.now() - t0),
                error:     result?.error || null,
            };
        } catch (e) {
            outcome = {
                index:     i + 1,
                success:   false,
                repaired:  false,
                retries:   0,
                durationMs: Date.now() - t0,
                error:     e.message,
            };
        }

        runs.push(outcome);

        // Check limits after each run
        const check = limiter.tick("retry");
        if (!check.allowed && opts.abortOnLimitExceeded) break;
    }

    return _aggregate(runs);
}

// ── benchmark ─────────────────────────────────────────────────────────

async function benchmark(scenario, times = 20, opts = {}) {
    if (!scenario || typeof scenario.run !== "function") {
        throw new Error("scenario must have a run() function");
    }

    const metrics    = await run(scenario.run.bind(scenario), times, opts);
    const repairRate = runs_repairRate(metrics.runs);

    return {
        name:         scenario.name     || "unnamed",
        category:     scenario.category || "generic",
        description:  scenario.description || "",
        ...metrics,
        repairRate,
        score:        score(metrics),
    };
}

// ── score ─────────────────────────────────────────────────────────────

function score(metrics) {
    const completion     = Math.round(metrics.successRate  * 100);
    const stability      = Math.round((1 - metrics.flipRate) * 100);
    const reproducibility = Math.round(
        metrics.runs.length > 1 ? (1 - metrics.flipRate) * 100 : 50
    );
    const repairRate    = Math.round(runs_repairRate(metrics.runs) * 100);

    // Rollback success = success after repaired (proxy)
    const rollbackSuccess = repairRate > 0 ? Math.min(100, repairRate + 10) : 0;

    const composite = Math.round(
        completion      * 0.30 +
        repairRate      * 0.25 +
        stability       * 0.20 +
        reproducibility * 0.15 +
        rollbackSuccess * 0.10
    );

    return { completion, repairRate, stability, reproducibility, rollbackSuccess, composite };
}

// ── storage ───────────────────────────────────────────────────────────

function store(name, result) {
    _results.push({ seq: ++_seq, name, ts: new Date().toISOString(), ...result });
}

function getAll() { return [..._results]; }

function reset() { _results = []; _seq = 0; el.reset(); }

// ── helpers ───────────────────────────────────────────────────────────

function _aggregate(runs) {
    const durations  = runs.map(r => r.durationMs).sort((a, b) => a - b);
    const successes  = runs.filter(r => r.success).length;
    const total      = runs.length;
    const sum        = durations.reduce((s, d) => s + d, 0);

    let flips = 0;
    for (let i = 1; i < runs.length; i++) {
        if (runs[i].success !== runs[i - 1].success) flips++;
    }
    const flipRate = runs.length > 1 ? parseFloat((flips / (runs.length - 1)).toFixed(3)) : 0;

    return {
        runs,
        totalRuns:    total,
        successRate:  total > 0 ? parseFloat((successes / total).toFixed(3)) : 0,
        failRate:     total > 0 ? parseFloat(((total - successes) / total).toFixed(3)) : 0,
        avgMs:        total > 0 ? Math.round(sum / total) : 0,
        p50Ms:        durations[Math.floor(total * 0.50)] || 0,
        p95Ms:        durations[Math.min(Math.floor(total * 0.95), total - 1)] || 0,
        minMs:        durations[0] || 0,
        maxMs:        durations[total - 1] || 0,
        totalMs:      sum,
        flipRate,
        consistency:  flipRate <= 0.15,
    };
}

function runs_repairRate(runs) {
    if (runs.length === 0) return 0;
    return parseFloat((runs.filter(r => r.repaired).length / runs.length).toFixed(3));
}

module.exports = { run, benchmark, score, store, getAll, reset };
