"use strict";
/**
 * healthScorer — derive overall system health from benchmark data.
 *
 * score(context)
 *   → { determinism, stability, recovery, cost, consistency, composite, grade }
 *
 * scoreFromBenchmarks(results[])
 *   → health score derived from benchmark result array
 *
 * grade(score)  → letter grade A–F
 *
 * Stateless.
 */

const ca = require("./costAnalyzer.cjs");

const COST_HIGH_THRESHOLD = 0.01;    // $0.01/execution = high cost

// ── score ─────────────────────────────────────────────────────────────

function score(context = {}) {
    // Determinism: inverse of average flip rate
    const determinism = _clamp(Math.round((1 - (context.avgFlipRate ?? 0)) * 100));

    // Stability: average success rate across workflows
    const stability   = _clamp(Math.round((context.avgSuccessRate ?? 0.5) * 100));

    // Recovery: average repair rate (how often failures are auto-recovered)
    const recovery    = _clamp(Math.round((context.avgRepairRate ?? 0.5) * 100));

    // Cost: inverse of normalised cost per execution (low cost = high score)
    const costPerExec = context.avgCostPerExecution ?? 0;
    const costScore   = costPerExec === 0
        ? 100
        : _clamp(Math.round(Math.max(0, 1 - costPerExec / COST_HIGH_THRESHOLD) * 100));

    // Consistency: proportion of workflows that are consistent (flipRate ≤ 0.15)
    const consistency = _clamp(Math.round((context.consistentRate ?? 0.8) * 100));

    const composite = Math.round(
        determinism  * 0.25 +
        stability    * 0.25 +
        recovery     * 0.20 +
        costScore    * 0.15 +
        consistency  * 0.15
    );

    return { determinism, stability, recovery, cost: costScore, consistency, composite, grade: grade(composite) };
}

// ── scoreFromBenchmarks ───────────────────────────────────────────────

function scoreFromBenchmarks(results = []) {
    if (results.length === 0) {
        return score({});
    }

    const avgFlipRate    = _avg(results, r => r.flipRate    ?? 0);
    const avgSuccessRate = _avg(results, r => r.successRate ?? 0);
    const avgRepairRate  = _avg(results, r => r.repairRate  ?? 0);
    const avgMs          = _avg(results, r => r.avgMs       ?? 0);

    // Cost: estimate from avgMs as proxy (no actual token data in benchmark results)
    // Use costAnalyzer if records exist, otherwise estimate from time
    const costReport     = ca.fullReport();
    const avgCostPerExec = costReport.totalRecords > 0
        ? costReport.avgCostPerExecution
        : avgMs / 1000 * 0.000001;   // rough proxy: 1ms ≈ $0.000001

    const consistentRate = results.filter(r => (r.flipRate ?? 0) <= 0.15).length / results.length;

    return score({ avgFlipRate, avgSuccessRate, avgRepairRate, avgCostPerExecution: avgCostPerExec, consistentRate });
}

// ── grade ─────────────────────────────────────────────────────────────

function grade(s) {
    if (s >= 90) return "A";
    if (s >= 75) return "B";
    if (s >= 60) return "C";
    if (s >= 45) return "D";
    return "F";
}

// ── helpers ───────────────────────────────────────────────────────────

function _clamp(v) { return Math.max(0, Math.min(100, v)); }
function _avg(arr, fn) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + fn(v), 0) / arr.length;
}

module.exports = { score, scoreFromBenchmarks, grade, COST_HIGH_THRESHOLD };
