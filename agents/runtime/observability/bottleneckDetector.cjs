"use strict";
/**
 * bottleneckDetector — detects execution bottlenecks from metrics and history.
 *
 * detectAll(entries, depStability, metrics) → { slowWorkflows, unstableTools,
 *   retryHeavySteps, blockingDeps, rollbackZones, memoryPressure }
 */

// ── per-detector functions ────────────────────────────────────────────

function detectSlowWorkflows(entries, thresholdMs = 5000) {
    const slow = [];
    const byFp = _groupBy(entries, "fingerprint");
    for (const [fp, group] of Object.entries(byFp)) {
        const avg = group.reduce((s, e) => s + (e.durationMs ?? 0), 0) / group.length;
        if (avg > thresholdMs) {
            slow.push({ fingerprint: fp, avgDurationMs: avg, executions: group.length, thresholdMs });
        }
    }
    return slow;
}

function detectUnstableTools(depStability = {}, threshold = 0.7) {
    return Object.entries(depStability)
        .filter(([, v]) => (v.stability ?? 1.0) < threshold)
        .map(([id, v]) => ({ depId: id, stability: v.stability ?? 0, threshold }));
}

function detectRetryHeavySteps(entries, threshold = 2) {
    const heavy = [];
    const byFp  = _groupBy(entries, "fingerprint");
    for (const [fp, group] of Object.entries(byFp)) {
        const avgRetries = group.reduce((s, e) => s + (e.retryCount ?? 0), 0) / group.length;
        if (avgRetries > threshold) {
            heavy.push({ fingerprint: fp, avgRetries, executions: group.length, threshold });
        }
    }
    return heavy;
}

function detectBlockingDeps(depStability = {}, threshold = 0.5) {
    return Object.entries(depStability)
        .filter(([, v]) => (v.stability ?? 1.0) < threshold)
        .map(([id, v]) => ({ depId: id, stability: v.stability ?? 0, threshold, type: "blocking" }));
}

function detectRollbackZones(entries, threshold = 0.3) {
    const zones = [];
    const byFp  = _groupBy(entries, "fingerprint");
    for (const [fp, group] of Object.entries(byFp)) {
        const rollbackRate = group.filter(e => e.rollbackTriggered).length / group.length;
        if (rollbackRate > threshold && group.length >= 2) {
            zones.push({ fingerprint: fp, rollbackRate, executions: group.length, threshold });
        }
    }
    return zones;
}

function detectMemoryPressure(metrics = {}, thresholdMB = 200) {
    const heapMB = (metrics.avgHeapUsedMB ?? 0);
    if (heapMB > thresholdMB) {
        return [{ heapMB, thresholdMB, pressure: true }];
    }
    return [];
}

// ── detectAll ─────────────────────────────────────────────────────────

function detectAll(entries = [], depStability = {}, metrics = {}, opts = {}) {
    return {
        slowWorkflows:    detectSlowWorkflows(entries,    opts.slowThresholdMs  ?? 5000),
        unstableTools:    detectUnstableTools(depStability, opts.unstableThreshold ?? 0.7),
        retryHeavySteps:  detectRetryHeavySteps(entries, opts.retryThreshold    ?? 2),
        blockingDeps:     detectBlockingDeps(depStability, opts.blockingThreshold ?? 0.5),
        rollbackZones:    detectRollbackZones(entries,    opts.rollbackThreshold ?? 0.3),
        memoryPressure:   detectMemoryPressure(metrics,   opts.memoryThresholdMB ?? 200),
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _groupBy(arr, key) {
    return arr.reduce((acc, item) => {
        const k = item[key] ?? "unknown";
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
    }, {});
}

module.exports = {
    detectSlowWorkflows, detectUnstableTools, detectRetryHeavySteps,
    detectBlockingDeps, detectRollbackZones, detectMemoryPressure, detectAll,
};
