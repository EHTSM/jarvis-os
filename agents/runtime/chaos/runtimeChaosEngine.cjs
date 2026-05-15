"use strict";
/**
 * runtimeChaosEngine — deterministic fault injection for resilience testing.
 *
 * setSeed(seed)
 * injectFault(context, opts)                           → FaultResult
 * simulateDependencyFailure(deps, failureRate)         → DepFailureResult
 * simulateLatencySpike(baseLatencyMs, multiplier)      → LatencySpikeResult
 * simulateMemoryPressure(heapMB, pressureFactor)       → MemoryPressureResult
 * simulateCascadingFailure(executions, cascadeProb)    → CascadeResult
 * simulatePartialOutage(services, outageRate)          → OutageResult
 * getInjectionHistory()                                → FaultRecord[]
 * reset()
 *
 * All randomness uses a seeded LCG so simulations are reproducible.
 */

// ── seeded PRNG (Numerical Recipes LCG) ──────────────────────────────
let _seed = 42;

function _rand() {
    _seed = ((_seed * 1664525) + 1013904223) >>> 0;
    return _seed / 4294967296;   // [0, 1)
}

function setSeed(seed) {
    _seed = (seed >>> 0) || 42;
}

// ── state ─────────────────────────────────────────────────────────────
const FAULT_TYPES = [
    "dep_failure", "latency_spike", "memory_pressure",
    "execution_failure", "partial_outage",
];

let _history = [];

function _record(type, params, result) {
    const rec = { type, params, result, ts: new Date().toISOString() };
    _history.push(rec);
    return rec;
}

// ── injectFault ───────────────────────────────────────────────────────

function injectFault(context = {}, opts = {}) {
    const probability = opts.probability ?? 0.3;
    const triggered   = _rand() < probability;

    if (!triggered) return { triggered: false, faultType: null, context };

    const faultType = opts.faultType
        ?? FAULT_TYPES[Math.floor(_rand() * FAULT_TYPES.length)];

    let result;
    switch (faultType) {
        case "dep_failure":
            result = simulateDependencyFailure(context.deps ?? {}, opts.failureRate ?? 0.5);
            break;
        case "latency_spike":
            result = simulateLatencySpike(context.baseLatencyMs ?? 100, opts.multiplier ?? 10);
            break;
        case "memory_pressure":
            result = simulateMemoryPressure(context.heapMB ?? 100, opts.pressureFactor ?? 3);
            break;
        case "execution_failure":
            result = { failed: true, executionId: context.executionId ?? "unknown", error: "injected_fault" };
            break;
        case "partial_outage":
            result = simulatePartialOutage(context.services ?? [], opts.outageRate ?? 0.4);
            break;
        default:
            result = { failed: true, reason: "unknown_fault_type" };
    }

    _record(faultType, { probability, ...opts }, result);
    return { triggered: true, faultType, result, context };
}

// ── simulateDependencyFailure ─────────────────────────────────────────

function simulateDependencyFailure(deps = {}, failureRate = 0.5) {
    const entries = Object.entries(deps);
    if (entries.length === 0) {
        return { failedDeps: ["dep-default"], healthyDeps: [], failureCount: 1 };
    }
    const failed  = entries.filter(() => _rand() < failureRate).map(([k]) => k);
    const healthy = entries.filter(([k]) => !failed.includes(k)).map(([k]) => k);
    return { failedDeps: failed, healthyDeps: healthy, failureCount: failed.length };
}

// ── simulateLatencySpike ──────────────────────────────────────────────

function simulateLatencySpike(baseLatencyMs = 100, multiplier = 10) {
    const variation  = 0.8 + _rand() * 0.4;  // ±20%
    const spikedMs   = Math.round(baseLatencyMs * multiplier * variation);
    return {
        baseLatencyMs,
        spikedLatencyMs: spikedMs,
        multiplier,
        factor: +(spikedMs / baseLatencyMs).toFixed(2),
    };
}

// ── simulateMemoryPressure ────────────────────────────────────────────

function simulateMemoryPressure(heapMB = 100, pressureFactor = 3) {
    const pressuredMB = Math.round(heapMB * pressureFactor * (0.9 + _rand() * 0.2));
    const risk        = pressuredMB > 400 ? "critical" :
                        pressuredMB > 250 ? "high"     :
                        pressuredMB > 150 ? "medium"   : "low";
    return { originalHeapMB: heapMB, pressuredHeapMB: pressuredMB, pressureFactor, risk };
}

// ── simulateCascadingFailure ──────────────────────────────────────────

function simulateCascadingFailure(executions = [], cascadeProb = 0.6) {
    if (executions.length === 0) return { cascaded: false, failedCount: 0, chain: [] };

    const chain  = [];
    let   active = true;

    for (const exec of executions) {
        if (!active) break;
        const fails = _rand() < cascadeProb;
        chain.push({ executionId: exec.id ?? exec.fingerprint ?? "unknown", failed: fails });
        if (!fails) active = false;  // cascade halts on first success
    }

    const failedCount = chain.filter(c => c.failed).length;
    return { cascaded: failedCount > 1, failedCount, totalInChain: chain.length, chain };
}

// ── simulatePartialOutage ─────────────────────────────────────────────

function simulatePartialOutage(services = [], outageRate = 0.4) {
    if (services.length === 0) {
        return { outageRate, affectedServices: [], healthyServices: [], outageCount: 0 };
    }
    const affected   = services.filter(() => _rand() < outageRate);
    const healthy    = services.filter(s => !affected.includes(s));
    return {
        outageRate,
        affectedServices:  affected,
        healthyServices:   healthy,
        outageCount:       affected.length,
        severeOutage:      affected.length > services.length / 2,
    };
}

// ── getInjectionHistory / reset ───────────────────────────────────────

function getInjectionHistory() { return [..._history]; }

function reset() {
    _seed    = 42;
    _history = [];
}

module.exports = {
    FAULT_TYPES,
    setSeed,
    injectFault,
    simulateDependencyFailure,
    simulateLatencySpike,
    simulateMemoryPressure,
    simulateCascadingFailure,
    simulatePartialOutage,
    getInjectionHistory,
    reset,
};
