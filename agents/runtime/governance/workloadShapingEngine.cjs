"use strict";
/**
 * workloadShapingEngine — workload burst smoothing, execution pacing,
 * runtime pressure shaping, and deterministic load shaping.
 *
 * shapeIncomingWorkload(spec)    → { shaped, shapeId, admitted, deferred }
 * smoothExecutionBurst(spec)     → { smoothed, burstId, deferredCount, pacingMs }
 * calculateRuntimePressure()     → { pressure, pressureScore, recommendation }
 * getWorkloadMetrics()           → WorkloadMetrics
 * reset()
 */

let _bursts  = [];
let _windows = [];
let _counter = 0;

// ── shapeIncomingWorkload ─────────────────────────────────────────────

function shapeIncomingWorkload(spec = {}) {
    const {
        workflowIds  = [],
        maxPerWindow = 10,
        windowMs     = 1000,
    } = spec;

    if (!Array.isArray(workflowIds) || workflowIds.length === 0)
        return { shaped: false, reason: "no_workflows_provided" };

    const shapeId    = `shape-${++_counter}`;
    const total      = workflowIds.length;
    const admitted   = workflowIds.slice(0, maxPerWindow);
    const deferred   = workflowIds.slice(maxPerWindow);

    _windows.push({
        shapeId, total,
        admitted:  admitted.length,
        deferred:  deferred.length,
        windowMs,
        shapedAt:  new Date().toISOString(),
    });

    return {
        shaped:      true,
        shapeId,
        total,
        admitted:    admitted.length,
        deferred:    deferred.length,
        admittedIds: admitted,
        deferredIds: deferred,
        pacingMs:    deferred.length > 0 ? windowMs : 0,
    };
}

// ── smoothExecutionBurst ──────────────────────────────────────────────

function smoothExecutionBurst(spec = {}) {
    const {
        burstSize    = 0,
        maxBurstRate = 10,
        smoothingMs  = 500,
    } = spec;

    if (burstSize <= 0) return { smoothed: false, reason: "invalid_burst_size" };

    const burstId       = `burst-${++_counter}`;
    const deferredCount = Math.max(0, burstSize - maxBurstRate);
    const pacingMs      = deferredCount > 0
        ? Math.ceil(deferredCount / maxBurstRate) * smoothingMs
        : 0;

    _bursts.push({ burstId, burstSize, maxBurstRate, deferredCount, pacingMs, recordedAt: new Date().toISOString() });

    return { smoothed: true, burstId, burstSize, maxBurstRate, deferredCount, pacingMs };
}

// ── calculateRuntimePressure ──────────────────────────────────────────

function calculateRuntimePressure() {
    const recent       = _bursts.slice(-10);
    const avgBurstSize = recent.length > 0
        ? recent.reduce((s, b) => s + b.burstSize, 0) / recent.length : 0;
    const totalDeferred = _bursts.reduce((s, b) => s + b.deferredCount, 0);

    const score    = Math.min(1, avgBurstSize / 100);
    const pressure = score >= 0.8 ? "critical"
                   : score >= 0.5 ? "high"
                   : score >= 0.2 ? "medium"
                   :                "low";

    const recommendation = score >= 0.8 ? "throttle_all"
                         : score >= 0.5 ? "apply_backpressure"
                         : score >= 0.2 ? "smooth_bursts"
                         :                "none";

    return {
        avgBurstSize:  +avgBurstSize.toFixed(2),
        totalDeferred,
        pressureScore: +score.toFixed(3),
        pressure,
        recommendation,
        burstCount:    _bursts.length,
    };
}

// ── getWorkloadMetrics ────────────────────────────────────────────────

function getWorkloadMetrics() {
    return {
        totalBursts:   _bursts.length,
        totalWindows:  _windows.length,
        totalDeferred: _bursts.reduce((s, b) => s + b.deferredCount, 0),
        avgBurstSize:  _bursts.length > 0
            ? +(_bursts.reduce((s, b) => s + b.burstSize, 0) / _bursts.length).toFixed(2)
            : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _bursts  = [];
    _windows = [];
    _counter = 0;
}

module.exports = {
    shapeIncomingWorkload, smoothExecutionBurst,
    calculateRuntimePressure, getWorkloadMetrics, reset,
};
