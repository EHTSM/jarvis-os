"use strict";
/**
 * anomalyDetector — runtime anomaly detection for workflow execution.
 *
 * Detectors:
 *   detectRetrySpike(wfId, stepName, attempts)
 *     flags when attempts > RETRY_SPIKE_MULTIPLIER × historical average
 *
 *   detectRuntimeSpike(wfId, stepName, durationMs)
 *     flags when duration > RUNTIME_SPIKE_MULTIPLIER × historical p95
 *
 *   detectInfiniteRetry(wfId, stepName, attempts)
 *     flags when attempts ≥ INFINITE_RETRY_THRESHOLD
 *
 *   detectResourceAbuse(wfId)
 *     flags when heap pressure exceeds RESOURCE_ABUSE_HEAP
 *
 *   analyzeWorkflow(result)
 *     post-run analysis of a full WorkflowResult (infinite retry, suspicious branching)
 *
 * Anomalies are stored in-memory per workflowId.
 * Call reset() between test runs.
 */

const history = require("./executionHistory.cjs");
const rm      = require("./resourceMonitor.cjs");

const RETRY_SPIKE_MULTIPLIER   = 3;     // flag if attempts > 3× historical avg attempts/success
const RUNTIME_SPIKE_MULTIPLIER = 3;     // flag if duration > 3× historical p95
const INFINITE_RETRY_THRESHOLD = 6;     // hard cap — ≥ 6 attempts = effectively infinite
const RESOURCE_ABUSE_HEAP      = 0.92;  // heap pressure ≥ 92%
const BRANCHING_THRESHOLD      = 0.50;  // > 50% steps troubled = suspicious

// In-memory anomaly store: workflowId → anomaly[]
const _anomalies = new Map();

function _push(workflowId, anomaly) {
    if (!_anomalies.has(workflowId)) _anomalies.set(workflowId, []);
    _anomalies.get(workflowId).push({
        ...anomaly,
        workflowId,
        detectedAt: new Date().toISOString(),
    });
    return anomaly;
}

// ── Detectors ─────────────────────────────────────────────────────────

/**
 * Retry spike: current attempt count is unusually high vs. historical average.
 * avgAttemptsPerSuccess = totalRecords / successRecords (geometric dist approximation).
 */
function detectRetrySpike(workflowId, stepName, attempts) {
    const recs      = history.byType(`step:${stepName}`);
    if (recs.length < 4) return null;

    const successes = recs.filter(r => r.success).length;
    if (successes === 0) return null;

    // Average attempts per successful completion
    const avg = recs.length / successes;
    if (attempts > avg * RETRY_SPIKE_MULTIPLIER && attempts > 2) {
        return _push(workflowId, {
            type:     "retry_spike",
            stepName,
            attempts,
            baseline: parseFloat(avg.toFixed(2)),
            severity: attempts >= INFINITE_RETRY_THRESHOLD ? "critical" : "warning",
        });
    }
    return null;
}

/**
 * Runtime spike: step is taking much longer than its historical p95.
 */
function detectRuntimeSpike(workflowId, stepName, durationMs) {
    const recs = history.byType(`step:${stepName}`)
        .filter(r => r.success && r.durationMs > 0);
    if (recs.length < 4) return null;

    const sorted = recs.map(r => r.durationMs).sort((a, b) => a - b);
    const p95    = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)];

    if (durationMs > p95 * RUNTIME_SPIKE_MULTIPLIER) {
        return _push(workflowId, {
            type:        "runtime_spike",
            stepName,
            durationMs,
            p95Baseline: p95,
            severity:    "warning",
        });
    }
    return null;
}

/**
 * Infinite retry: absolute attempt count threshold breached.
 */
function detectInfiniteRetry(workflowId, stepName, attempts) {
    if (attempts >= INFINITE_RETRY_THRESHOLD) {
        return _push(workflowId, {
            type:     "infinite_retry",
            stepName,
            attempts,
            severity: "critical",
        });
    }
    return null;
}

/**
 * Resource abuse: heap pressure is dangerously high.
 */
function detectResourceAbuse(workflowId) {
    const mem = rm.getMemoryPressure();
    if (mem > RESOURCE_ABUSE_HEAP) {
        return _push(workflowId, {
            type:      "resource_abuse",
            resource:  "memory",
            value:     mem,
            threshold: RESOURCE_ABUSE_HEAP,
            severity:  "critical",
        });
    }
    return null;
}

/**
 * Post-run full analysis of a WorkflowResult.
 * Checks every step for infinite retry and looks for suspicious branching.
 */
function analyzeWorkflow(result) {
    const wfId     = result.id;
    const detected = [];

    for (const step of result.stepDetails || []) {
        const ir = detectInfiniteRetry(wfId, step.name, step.attempts || 0);
        if (ir) detected.push(ir);
    }

    // Suspicious branching: majority of steps were troubled (failed or needed recovery)
    const total    = (result.stepDetails || []).length;
    const troubled = (result.stepDetails || [])
        .filter(s => s.status !== "completed" || (s.recoveries || 0) > 0).length;

    if (total > 0 && troubled / total > BRANCHING_THRESHOLD) {
        const anomaly = {
            type:          "suspicious_branching",
            troubledSteps: troubled,
            totalSteps:    total,
            branchingRate: parseFloat((troubled / total).toFixed(2)),
            severity:      "warning",
        };
        _push(wfId, anomaly);
        detected.push({ ...anomaly, workflowId: wfId, detectedAt: new Date().toISOString() });
    }

    return detected;
}

// ── Query ─────────────────────────────────────────────────────────────

function getAnomalies(workflowId) {
    return _anomalies.get(workflowId) || [];
}

function getAllAnomalies() {
    const all = [];
    for (const anoms of _anomalies.values()) all.push(...anoms);
    return all;
}

function reset() { _anomalies.clear(); }

module.exports = {
    detectRetrySpike,
    detectRuntimeSpike,
    detectInfiniteRetry,
    detectResourceAbuse,
    analyzeWorkflow,
    getAnomalies,
    getAllAnomalies,
    reset,
    RETRY_SPIKE_MULTIPLIER,
    RUNTIME_SPIKE_MULTIPLIER,
    INFINITE_RETRY_THRESHOLD,
    BRANCHING_THRESHOLD,
    RESOURCE_ABUSE_HEAP,
};
