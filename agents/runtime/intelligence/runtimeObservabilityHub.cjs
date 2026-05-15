"use strict";
/**
 * runtimeObservabilityHub — central runtime observability aggregation,
 * governance metric correlation, execution path tracing, and snapshot reporting.
 *
 * captureRuntimeSnapshot(spec)       → { captured, snapshotId }
 * correlateGovernanceMetrics(spec)   → { correlated, correlationId, correlations }
 * traceExecutionPath(spec)           → { traced, pathId, path, isReplayable }
 * generateObservabilityReport()      → ObservabilityReport
 * reset()
 */

let _snapshots    = [];
let _correlations = [];
let _paths        = [];
let _counter      = 0;

// ── captureRuntimeSnapshot ────────────────────────────────────────────

function captureRuntimeSnapshot(spec = {}) {
    const {
        topologyMetrics    = null,
        governanceMetrics  = null,
        concurrencyMetrics = null,
        pressureMetrics    = null,
        label              = null,
    } = spec;

    const snapshotId = `obs-${++_counter}`;
    _snapshots.push({
        snapshotId,
        label,
        topologyMetrics,
        governanceMetrics,
        concurrencyMetrics,
        pressureMetrics,
        capturedAt: new Date().toISOString(),
    });

    return { captured: true, snapshotId, label };
}

// ── correlateGovernanceMetrics ────────────────────────────────────────

function correlateGovernanceMetrics(spec = {}) {
    const {
        pressureLevel      = "low",
        admissionState     = null,
        fairnessMetrics    = null,
        qosMetrics         = null,
    } = spec;

    const correlationId  = `corr-${++_counter}`;
    const correlations   = [];

    // Detect: admission_pressure_mismatch
    if (admissionState != null) {
        const { totalAdmitted = 0, totalRejected = 0 } = admissionState;
        const total = totalAdmitted + totalRejected;
        if (total > 0 && totalRejected / total > 0.5 && pressureLevel === "low") {
            correlations.push({ type: "admission_pressure_mismatch", detail: "high rejection rate despite low pressure" });
        }
        if (pressureLevel === "critical" && totalRejected === 0 && totalAdmitted > 0) {
            correlations.push({ type: "under_throttling_under_pressure", detail: "critical pressure with no rejections" });
        }
    }

    // Detect: starvation_under_pressure
    if (fairnessMetrics != null) {
        const { starvationEvents = 0, compensatedCount = 0 } = fairnessMetrics;
        if (starvationEvents > 0 && pressureLevel !== "low") {
            correlations.push({ type: "starvation_under_pressure", detail: `${starvationEvents} starvation events at ${pressureLevel} pressure` });
        }
        if (starvationEvents > 0 && compensatedCount === 0) {
            correlations.push({ type: "uncompensated_starvation", detail: "starvation detected but no compensation applied" });
        }
    }

    // Detect: qos_violation_pattern
    if (qosMetrics != null) {
        const { totalViolations = 0, totalAssignments = 1 } = qosMetrics;
        if (totalViolations > 0 && totalViolations / totalAssignments >= 0.3) {
            correlations.push({ type: "qos_violation_pattern", detail: `${totalViolations} violations across ${totalAssignments} assignments` });
        }
    }

    _correlations.push({ correlationId, pressureLevel, correlationCount: correlations.length, correlations, analyzedAt: new Date().toISOString() });

    return { correlated: true, correlationId, correlationCount: correlations.length, correlations };
}

// ── traceExecutionPath ────────────────────────────────────────────────

function traceExecutionPath(spec = {}) {
    const { workflowId = null, events = [] } = spec;
    if (!workflowId) return { traced: false, reason: "workflowId_required" };
    if (!Array.isArray(events) || events.length === 0)
        return { traced: false, reason: "events_required" };

    // Sort by sequence
    const path = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    // Validate replay-readiness
    let isReplayable = true;
    const issues     = [];

    for (let i = 0; i < path.length; i++) {
        const e = path[i];
        if (!e.type)            { isReplayable = false; issues.push(`event[${i}] missing type`); }
        if (e.sequence == null) { isReplayable = false; issues.push(`event[${i}] missing sequence`); }
    }

    // Check for sequence gaps
    if (path.length > 0 && path[0].sequence != null) {
        for (let i = 1; i < path.length; i++) {
            if (path[i].sequence != null && path[i - 1].sequence != null &&
                path[i].sequence !== path[i - 1].sequence + 1) {
                isReplayable = false;
                issues.push(`sequence gap between ${path[i-1].sequence} and ${path[i].sequence}`);
            }
        }
    }

    const pathId = `path-${++_counter}`;
    _paths.push({ pathId, workflowId, eventCount: path.length, isReplayable, tracedAt: new Date().toISOString() });

    return { traced: true, pathId, workflowId, path, eventCount: path.length, isReplayable, issues };
}

// ── generateObservabilityReport ───────────────────────────────────────

function generateObservabilityReport() {
    const latestSnapshot = _snapshots.length > 0 ? _snapshots[_snapshots.length - 1] : null;

    const keyInsights = [];
    for (const c of _correlations) {
        for (const corr of c.correlations) {
            keyInsights.push(`[${corr.type}] ${corr.detail}`);
        }
    }

    const replayablePaths    = _paths.filter(p => p.isReplayable).length;
    const nonReplayablePaths = _paths.length - replayablePaths;

    return {
        snapshotCount:     _snapshots.length,
        correlationCount:  _correlations.length,
        pathCount:         _paths.length,
        replayablePaths,
        nonReplayablePaths,
        latestSnapshot,
        keyInsights,
        keyInsightCount:   keyInsights.length,
        generatedAt:       new Date().toISOString(),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _snapshots    = [];
    _correlations = [];
    _paths        = [];
    _counter      = 0;
}

module.exports = {
    captureRuntimeSnapshot, correlateGovernanceMetrics,
    traceExecutionPath, generateObservabilityReport, reset,
};
