"use strict";
/**
 * bottleneckAnalysisEngine — execution bottleneck detection, hotspot scoring,
 * and cascading failure analysis.
 *
 * registerExecutionMetrics(spec)  → { registered, metricId }
 * detectBottlenecks()             → { bottlenecks, hotspots, bottleneckCount }
 * analyzeCascadingFailure(spec)   → { analyzed, failureId, affectedCount, cascadeDepth }
 * getHotspotReport()              → HotspotReport
 * reset()
 */

const BOTTLENECK_THRESHOLDS = {
    latencyMs:  1000,
    retryCount: 5,
    queueDepth: 50,
    errorRate:  0.3,
};

let _metrics  = new Map();  // workflowId → MetricRecord
let _failures = [];
let _counter  = 0;

// ── registerExecutionMetrics ──────────────────────────────────────────

function registerExecutionMetrics(spec = {}) {
    const { workflowId = null, latencyMs = 0, retryCount = 0, queueDepth = 0, errorRate = 0 } = spec;
    if (!workflowId) return { registered: false, reason: "workflowId_required" };

    const metricId = `metric-${++_counter}`;
    _metrics.set(workflowId, { metricId, workflowId, latencyMs, retryCount, queueDepth, errorRate, recordedAt: new Date().toISOString() });
    return { registered: true, metricId, workflowId };
}

// ── _severityScore ────────────────────────────────────────────────────

function _severityScore(rec) {
    return (rec.latencyMs  / BOTTLENECK_THRESHOLDS.latencyMs)
         + (rec.retryCount / BOTTLENECK_THRESHOLDS.retryCount)
         + (rec.queueDepth / BOTTLENECK_THRESHOLDS.queueDepth)
         + (rec.errorRate  / BOTTLENECK_THRESHOLDS.errorRate);
}

function _isBottleneck(rec) {
    return rec.latencyMs  >= BOTTLENECK_THRESHOLDS.latencyMs
        || rec.retryCount >= BOTTLENECK_THRESHOLDS.retryCount
        || rec.queueDepth >= BOTTLENECK_THRESHOLDS.queueDepth
        || rec.errorRate  >= BOTTLENECK_THRESHOLDS.errorRate;
}

// ── detectBottlenecks ─────────────────────────────────────────────────

function detectBottlenecks() {
    const bottlenecks = [];

    for (const rec of _metrics.values()) {
        if (_isBottleneck(rec)) {
            bottlenecks.push({
                workflowId:    rec.workflowId,
                latencyMs:     rec.latencyMs,
                retryCount:    rec.retryCount,
                queueDepth:    rec.queueDepth,
                errorRate:     rec.errorRate,
                severityScore: +_severityScore(rec).toFixed(3),
            });
        }
    }

    bottlenecks.sort((a, b) => b.severityScore - a.severityScore);

    return {
        bottlenecks,
        hotspots:       bottlenecks.slice(0, 3),
        bottleneckCount: bottlenecks.length,
        totalTracked:   _metrics.size,
    };
}

// ── analyzeCascadingFailure ───────────────────────────────────────────

function analyzeCascadingFailure(spec = {}) {
    const { workflowId = null, dependencyMap = {}, maxDepth = 5 } = spec;
    if (!workflowId) return { analyzed: false, reason: "workflowId_required" };

    // BFS from epicenter through dependencyMap (workflowId → [dependent workflowIds])
    const affectedNodes = new Set();
    const queue         = [{ id: workflowId, depth: 0 }];
    let   cascadeDepth  = 0;

    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (depth >= maxDepth) continue;

        const dependents = dependencyMap[id] ?? [];
        for (const dep of dependents) {
            if (!affectedNodes.has(dep)) {
                affectedNodes.add(dep);
                cascadeDepth = Math.max(cascadeDepth, depth + 1);
                queue.push({ id: dep, depth: depth + 1 });
            }
        }
    }

    const failureId = `fail-${++_counter}`;
    _failures.push({ failureId, workflowId, affectedCount: affectedNodes.size, cascadeDepth, analyzedAt: new Date().toISOString() });

    return {
        analyzed:     true,
        failureId,
        workflowId,
        affectedNodes: [...affectedNodes],
        affectedCount: affectedNodes.size,
        cascadeDepth,
    };
}

// ── getHotspotReport ──────────────────────────────────────────────────

function getHotspotReport() {
    const all = [..._metrics.values()]
        .map(rec => ({ workflowId: rec.workflowId, severityScore: +_severityScore(rec).toFixed(3), isBottleneck: _isBottleneck(rec) }))
        .sort((a, b) => b.severityScore - a.severityScore);

    return {
        hotspots:       all.slice(0, 5),
        totalTracked:   _metrics.size,
        bottleneckCount: all.filter(h => h.isBottleneck).length,
        thresholds:     { ...BOTTLENECK_THRESHOLDS },
        cascadeCount:   _failures.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _metrics  = new Map();
    _failures = [];
    _counter  = 0;
}

module.exports = {
    BOTTLENECK_THRESHOLDS,
    registerExecutionMetrics, detectBottlenecks,
    analyzeCascadingFailure, getHotspotReport, reset,
};
