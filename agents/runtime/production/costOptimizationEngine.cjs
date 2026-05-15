"use strict";
/**
 * costOptimizationEngine — execution cost estimation and efficiency optimization.
 *
 * estimateCost(entry, opts)                    → CostEstimate
 * scoreEfficiency(entries)                     → EfficiencyScore
 * detectExpensiveWorkflows(entries, threshold) → ExpensiveWorkflow[]
 * analyzeRetryCost(entries)                    → RetryCostReport
 * detectResourceWaste(entries, metrics)        → WasteReport
 * recommendThrottling(entries, metrics)        → ThrottlingRecommendation
 * reset()
 */

const COST_PER_MS           = 0.00001;    // $0.00001 per ms
const COST_PER_MB_MS        = 0.000001;   // $0.000001 per MB·ms
const RETRY_COST_MULTIPLIER = 1.5;        // each retry costs 1.5× the base duration
const SANDBOX_OVERHEAD      = 2.0;        // sandbox executions cost 2×
const EXPENSIVE_THRESHOLD   = 0.10;       // $0.10 default threshold for "expensive"
const WASTE_RETRY_THRESHOLD = 3;          // ≥3 retries per execution = wasteful

let _costHistory  = [];

// ── estimateCost ──────────────────────────────────────────────────────

function estimateCost(entry, opts = {}) {
    const durationMs = entry.durationMs ?? entry.totalDurationMs ?? 0;
    const heapMB     = entry.heapUsedMB ?? 0;
    const retryCount = entry.retryCount ?? 0;
    const sandboxed  = entry.sandboxed  ?? entry.strategy === "sandbox" ?? false;

    const cpuCost   = durationMs * COST_PER_MS;
    const memCost   = heapMB * durationMs * COST_PER_MB_MS;
    const retryCost = retryCount * durationMs * COST_PER_MS * RETRY_COST_MULTIPLIER;
    const base      = cpuCost + memCost + retryCost;
    const total     = sandboxed ? base * SANDBOX_OVERHEAD : base;

    const record = {
        fingerprint: entry.fingerprint ?? null,
        cpuCost:     +cpuCost.toFixed(6),
        memCost:     +memCost.toFixed(6),
        retryCost:   +retryCost.toFixed(6),
        totalCost:   +total.toFixed(6),
        sandboxed,
        durationMs,
        retryCount,
    };
    _costHistory.push(record);
    return record;
}

// ── scoreEfficiency ───────────────────────────────────────────────────

function scoreEfficiency(entries = []) {
    if (entries.length === 0) return { score: 0, grade: "F", reason: "no_entries" };

    const successRate    = entries.filter(e => e.success).length / entries.length;
    const avgRetries     = entries.reduce((s, e) => s + (e.retryCount ?? 0), 0) / entries.length;
    const rollbackRate   = entries.filter(e => e.rollbackTriggered).length / entries.length;

    const retryPenalty   = Math.min(0.4, avgRetries * 0.1);
    const rollbackPenalty = rollbackRate * 0.3;
    const rawScore       = Math.max(0, successRate - retryPenalty - rollbackPenalty) * 100;
    const score          = +rawScore.toFixed(1);

    const grade = score >= 90 ? "A" :
                  score >= 75 ? "B" :
                  score >= 60 ? "C" :
                  score >= 40 ? "D" : "F";

    return {
        score,
        grade,
        successRate:  +successRate.toFixed(3),
        avgRetries:   +avgRetries.toFixed(2),
        rollbackRate: +rollbackRate.toFixed(3),
    };
}

// ── detectExpensiveWorkflows ──────────────────────────────────────────

function detectExpensiveWorkflows(entries = [], threshold = EXPENSIVE_THRESHOLD) {
    const costly = [];
    for (const entry of entries) {
        const cost = estimateCost(entry);
        if (cost.totalCost > threshold) {
            costly.push({ fingerprint: entry.fingerprint ?? "unknown", ...cost, threshold });
        }
    }
    return costly.sort((a, b) => b.totalCost - a.totalCost);
}

// ── analyzeRetryCost ──────────────────────────────────────────────────

function analyzeRetryCost(entries = []) {
    if (entries.length === 0) {
        return { totalRetryCost: 0, avgRetriesPerExecution: 0, wastedExecutions: 0, wasteRate: 0 };
    }

    let totalRetryCost   = 0;
    let totalRetries     = 0;
    let wastedExecutions = 0;

    for (const entry of entries) {
        const cost = estimateCost(entry);
        totalRetryCost += cost.retryCost;
        totalRetries   += entry.retryCount ?? 0;
        if ((entry.retryCount ?? 0) >= WASTE_RETRY_THRESHOLD) wastedExecutions++;
    }

    return {
        totalRetryCost:         +totalRetryCost.toFixed(6),
        avgRetriesPerExecution: +(totalRetries / entries.length).toFixed(2),
        wastedExecutions,
        wasteRate:              +(wastedExecutions / entries.length).toFixed(3),
    };
}

// ── detectResourceWaste ───────────────────────────────────────────────

function detectResourceWaste(entries = [], metrics = {}) {
    const wastes       = [];
    const successRate  = entries.length > 0
        ? entries.filter(e => e.success).length / entries.length : 1;

    const avgHeapMB = metrics.avgHeapUsedMB ?? 0;
    if (avgHeapMB > 200 && successRate < 0.5) {
        wastes.push({ type: "high_heap_low_success", avgHeapUsedMB: avgHeapMB, successRate });
    }

    const sandboxed = entries.filter(e => e.sandboxed || e.strategy === "sandbox");
    if (sandboxed.length > 0 && sandboxed.every(e => e.success)) {
        wastes.push({ type: "sandbox_overkill", sandboxedCount: sandboxed.length });
    }

    const highRetry = entries.filter(e => (e.retryCount ?? 0) >= WASTE_RETRY_THRESHOLD);
    if (highRetry.length > 0) {
        wastes.push({
            type:       "excessive_retries",
            count:      highRetry.length,
            avgRetries: +(highRetry.reduce((s, e) => s + (e.retryCount ?? 0), 0) / highRetry.length).toFixed(2),
        });
    }

    return { wastes, hasWaste: wastes.length > 0 };
}

// ── recommendThrottling ───────────────────────────────────────────────

function recommendThrottling(entries = [], metrics = {}) {
    const efficiency = scoreEfficiency(entries);
    const retryCost  = analyzeRetryCost(entries);
    const recs       = [];

    if (efficiency.avgRetries > 2) {
        recs.push({ action: "reduce_retry_limit",      reason: "high_avg_retries",             urgency: "medium" });
    }
    if (efficiency.score < 50) {
        recs.push({ action: "throttle_concurrency",    reason: "low_efficiency_score",          urgency: "high" });
    }
    if (retryCost.wasteRate > 0.3) {
        recs.push({ action: "enable_circuit_breaker",  reason: "high_waste_rate",               urgency: "high" });
    }
    if ((metrics.pressure ?? "none") === "critical") {
        recs.push({ action: "shed_load",               reason: "critical_resource_pressure",    urgency: "immediate" });
    }

    return {
        recommendations: recs,
        shouldThrottle:  recs.length > 0,
        efficiency,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _costHistory = [];
}

module.exports = {
    COST_PER_MS, RETRY_COST_MULTIPLIER, SANDBOX_OVERHEAD,
    EXPENSIVE_THRESHOLD, WASTE_RETRY_THRESHOLD,
    estimateCost, scoreEfficiency, detectExpensiveWorkflows,
    analyzeRetryCost, detectResourceWaste, recommendThrottling,
    reset,
};
