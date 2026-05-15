"use strict";
/**
 * recoveryBenchmark — measure recovery speed and success rates.
 *
 * benchmarkRecovery(stepName, failureType, runs?)
 *   → { stepName, failureType, runs, successRate, avgMs, p50Ms, p95Ms, results[] }
 *
 * benchmarkWorkflow(name, steps, runs?)
 *   → { name, runs, successRate, avgMs, p50Ms, avgScore, results[] }
 */

const { planAndExecute } = require("./executionPlanner.cjs");

const DEFAULT_RUNS = 5;

function _percentile(sorted, p) {
    return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)] || 0;
}

async function benchmarkRecovery(stepName, failureType, runs = DEFAULT_RUNS) {
    const results = [];

    for (let i = 0; i < runs; i++) {
        const step = {
            name: stepName,
            execute: async () => {
                const err = new Error(`bench-${failureType}`);
                err.type  = failureType;
                throw err;
            },
        };

        const t0  = Date.now();
        const out = await planAndExecute(`bench-recovery-${Date.now()}-${i}`, [step], {
            baseRetries: 1,
            ctx: { _bench: true },
        });

        results.push({
            run:       i + 1,
            recovered: out.result?.success === true,
            durationMs: Date.now() - t0,
            strategy:  out.result?.stepDetails?.[0]?.lastStrategy || null,
        });
    }

    const successes = results.filter(r => r.recovered).length;
    const sorted    = results.map(r => r.durationMs).sort((a, b) => a - b);

    return {
        stepName,
        failureType,
        runs,
        successRate: parseFloat((successes / runs).toFixed(3)),
        avgMs:       Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length),
        p50Ms:       _percentile(sorted, 0.50),
        p95Ms:       _percentile(sorted, 0.95),
        results,
    };
}

async function benchmarkWorkflow(name, steps, runs = DEFAULT_RUNS) {
    const results = [];

    for (let i = 0; i < runs; i++) {
        const t0  = Date.now();
        const out = await planAndExecute(`${name}-bench-${i}`, steps, {
            ctx: { _bench: true },
        });
        results.push({
            run:       i + 1,
            success:   out.result?.success === true,
            durationMs: Date.now() - t0,
            score:     out.executionScore || 0,
        });
    }

    const successes = results.filter(r => r.success).length;
    const sorted    = results.map(r => r.durationMs).sort((a, b) => a - b);

    return {
        name,
        runs,
        successRate: parseFloat((successes / runs).toFixed(3)),
        avgMs:       Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length),
        p50Ms:       _percentile(sorted, 0.50),
        avgScore:    parseFloat((results.reduce((s, r) => s + r.score, 0) / runs).toFixed(1)),
        results,
    };
}

module.exports = { benchmarkRecovery, benchmarkWorkflow, DEFAULT_RUNS };
