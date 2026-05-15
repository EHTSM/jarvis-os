"use strict";
/**
 * concurrencyOptimizer — dynamic concurrency scaling and adaptive execution budgeting.
 *
 * updateMetrics(metrics)                       → void
 * getOptimalConcurrency(workloadType, opts)    → ConcurrencyDecision
 * allocateExecutionBudget(workflow)            → BudgetDecision
 * releaseSlot(workloadType)                    → void
 * getOptimizerStats()                          → Stats
 * reset()
 */

// Base concurrency limits by pressure band
const CONCURRENCY_TABLE = {
    none:     { base: 12, max: 20 },
    low:      { base: 8,  max: 12 },
    medium:   { base: 5,  max: 8  },
    high:     { base: 2,  max: 4  },
    critical: { base: 1,  max: 1  },
};

// Budget caps by pressure band
const RETRY_BUDGET = {
    none:     5,
    low:      4,
    medium:   3,
    high:     2,
    critical: 1,
};

const TIMEOUT_BY_LATENCY = {
    realtime:    500,
    interactive: 2000,
    standard:    10000,
    background:  60000,
};

let _metrics           = { pressure: 0, health: 1, successRate: 1, errorRate: 0 };
let _activeSlots       = new Map();   // workloadType → count in use
let _allocationHistory = [];
let _counter           = 0;

// ── updateMetrics ─────────────────────────────────────────────────────

function updateMetrics(metrics = {}) {
    _metrics = {
        pressure:    metrics.pressure    ?? _metrics.pressure,
        health:      metrics.health      ?? _metrics.health,
        successRate: metrics.successRate ?? _metrics.successRate,
        errorRate:   metrics.errorRate   ?? _metrics.errorRate,
    };
}

// ── _pressureBand ─────────────────────────────────────────────────────

function _pressureBand(p = _metrics.pressure) {
    return p >= 0.85 ? "critical"
         : p >= 0.65 ? "high"
         : p >= 0.40 ? "medium"
         : p >= 0.15 ? "low"
         :             "none";
}

// ── getOptimalConcurrency ─────────────────────────────────────────────

function getOptimalConcurrency(workloadType = "standard", opts = {}) {
    const pressure     = opts.pressure    ?? _metrics.pressure;
    const successRate  = opts.successRate ?? _metrics.successRate;
    const health       = opts.health      ?? _metrics.health;
    const pb           = _pressureBand(pressure);
    const table        = CONCURRENCY_TABLE[pb];
    const reasons      = [];

    let concurrency = table.base;
    reasons.push(`base_${pb}_pressure: starting at ${concurrency}`);

    // Scale up if runtime is healthy and succeeding
    if (successRate >= 0.95 && pressure < 0.40 && health >= 0.80) {
        concurrency = Math.min(table.max, Math.round(concurrency * 1.25));
        reasons.push(`scale_up: success_rate=${successRate.toFixed(2)}, health=${health.toFixed(2)}`);
    }

    // Scale down if error rate is elevated
    if (_metrics.errorRate >= 0.10) {
        concurrency = Math.max(1, Math.floor(concurrency * 0.75));
        reasons.push(`scale_down: error_rate=${_metrics.errorRate.toFixed(2)}`);
    }

    // Scale down for high-risk workload types
    if (opts.riskLevel === "critical" || opts.riskLevel === "high") {
        concurrency = Math.max(1, Math.floor(concurrency * 0.60));
        reasons.push(`risk_reduction: workload_risk=${opts.riskLevel}`);
    }

    // Active slots check
    const active = _activeSlots.get(workloadType) ?? 0;
    const available = Math.max(0, concurrency - active);
    const confidenceLevel = pb === "none" || pb === "low" ? "high"
                          : pb === "medium"               ? "moderate"
                          :                                 "low";

    return {
        decisionId:      `conc-${++_counter}`,
        workloadType,
        concurrency,
        activeSlots:     active,
        availableSlots:  available,
        pressureBand:    pb,
        reasoning:       reasons.join("; "),
        telemetryBasis:  { pressure: +pressure.toFixed(3), successRate: +successRate.toFixed(3), health: +health.toFixed(3) },
        historicalEvidence: {
            allocations: _allocationHistory.filter(a => a.workloadType === workloadType).length,
        },
        confidenceLevel,
        ts: new Date().toISOString(),
    };
}

// ── allocateExecutionBudget ───────────────────────────────────────────

function allocateExecutionBudget(workflow = {}) {
    const pressure    = workflow.pressure    ?? _metrics.pressure;
    const pb          = _pressureBand(pressure);
    const latency     = workflow.latencyClass ?? "standard";
    const riskLevel   = workflow.riskLevel    ?? "low";
    const reasons     = [];

    // Retries
    let maxRetries = RETRY_BUDGET[pb];
    reasons.push(`base_retries_${pb}: ${maxRetries}`);

    if (riskLevel === "critical" || riskLevel === "high") {
        maxRetries = Math.max(1, maxRetries - 1);
        reasons.push(`risk_reduction: risk=${riskLevel}`);
    }
    if (_metrics.errorRate >= 0.20) {
        maxRetries = Math.max(1, maxRetries - 1);
        reasons.push(`high_error_rate: ${_metrics.errorRate.toFixed(2)}`);
    }

    // Timeout
    const baseTimeout = TIMEOUT_BY_LATENCY[latency] ?? 10000;
    const timeoutMs   = pb === "critical" ? Math.floor(baseTimeout * 0.5)
                      : pb === "high"     ? Math.floor(baseTimeout * 0.75)
                      :                     baseTimeout;
    if (timeoutMs !== baseTimeout) {
        reasons.push(`timeout_compressed_${pb}: ${timeoutMs}ms (base ${baseTimeout}ms)`);
    }

    // Memory budget (arbitrary units)
    const memoryUnits = pb === "critical" ? 1
                      : pb === "high"     ? 2
                      : pb === "medium"   ? 3
                      :                    5;

    // Track slot
    const current = _activeSlots.get(workflow.type ?? "generic") ?? 0;
    _activeSlots.set(workflow.type ?? "generic", current + 1);
    _allocationHistory.push({ workloadType: workflow.type ?? "generic", pb, ts: new Date().toISOString() });

    return {
        allocated:   true,
        workflowId:  workflow.id ?? `wf-${++_counter}`,
        maxRetries,
        timeoutMs,
        memoryUnits,
        pressureBand: pb,
        reasoning:   reasons.join("; "),
        telemetryBasis: { pressure: +pressure.toFixed(3), errorRate: +_metrics.errorRate.toFixed(3) },
        historicalEvidence: { priorAllocations: _allocationHistory.length },
        confidenceLevel: pb === "none" || pb === "low" ? "high" : "moderate",
    };
}

// ── releaseSlot ───────────────────────────────────────────────────────

function releaseSlot(workloadType = "generic") {
    const current = _activeSlots.get(workloadType) ?? 0;
    _activeSlots.set(workloadType, Math.max(0, current - 1));
}

// ── getOptimizerStats ─────────────────────────────────────────────────

function getOptimizerStats() {
    return {
        currentMetrics:    { ..._metrics },
        pressureBand:      _pressureBand(),
        totalAllocations:  _allocationHistory.length,
        activeTypes:       Object.fromEntries([..._activeSlots.entries()].filter(([, v]) => v > 0)),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _metrics           = { pressure: 0, health: 1, successRate: 1, errorRate: 0 };
    _activeSlots       = new Map();
    _allocationHistory = [];
    _counter           = 0;
}

module.exports = {
    CONCURRENCY_TABLE, RETRY_BUDGET, TIMEOUT_BY_LATENCY,
    updateMetrics, getOptimalConcurrency, allocateExecutionBudget,
    releaseSlot, getOptimizerStats, reset,
};
