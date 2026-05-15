"use strict";
/**
 * runtimeVisibilityController — central coordinator for the observability
 * layer. Wires all observability modules, enforces retention policies, and
 * provides a unified runtime visibility API.
 *
 * configure(config)              → { configured, modules }
 * recordEvent(spec)              → { recorded, results }
 * captureRuntimeSnapshot()       → { captured, snapshotId }
 * getVisibilityReport()          → VisibilityReport
 * enforceRetention(policy?)      → RetentionResult
 * getVisibilityMetrics()         → VisibilityMetrics
 * reset()
 *
 * Optional modules (all injected via configure()):
 *   eventStream, timelineManager, workflowTracker, telemetryAggregator,
 *   metricsCollector, heatmapEngine, healthMonitor, snapshotEngine,
 *   correlationGraph
 *
 * Retention policy: { maxAgeMs, maxEvents } — applied on enforceRetention()
 */

const DEFAULT_RETENTION = {
    maxAgeMs:   3600000,    // 1 hour
    maxEvents:  100000,
};

let _config    = null;
let _counter   = 0;
let _events    = [];   // own bounded event log for the controller itself
let _retention = { ...DEFAULT_RETENTION };

// ── configure ─────────────────────────────────────────────────────────

function configure(config = {}) {
    _config = {
        eventStream:         config.eventStream         ?? null,
        timelineManager:     config.timelineManager     ?? null,
        workflowTracker:     config.workflowTracker     ?? null,
        telemetryAggregator: config.telemetryAggregator ?? null,
        metricsCollector:    config.metricsCollector    ?? null,
        heatmapEngine:       config.heatmapEngine       ?? null,
        healthMonitor:       config.healthMonitor       ?? null,
        snapshotEngine:      config.snapshotEngine      ?? null,
        correlationGraph:    config.correlationGraph    ?? null,
    };
    if (config.retention) {
        _retention = {
            maxAgeMs:  config.retention.maxAgeMs  ?? DEFAULT_RETENTION.maxAgeMs,
            maxEvents: config.retention.maxEvents ?? DEFAULT_RETENTION.maxEvents,
        };
    }
    const wired = Object.keys(_config).filter(k => _config[k] !== null);
    return { configured: true, modules: wired };
}

// ── recordEvent ────────────────────────────────────────────────────────

function recordEvent(spec = {}) {
    const {
        eventType      = null,
        subsystem      = null,
        executionId    = null,
        workflowId     = null,
        correlationId  = null,
        adapterType    = null,
        authorityLevel = null,
        outcome        = null,
        latencyMs      = null,
        payload        = null,
        timestamp      = new Date().toISOString(),
    } = spec;

    if (!eventType) return { recorded: false, reason: "eventType_required" };
    if (!subsystem) return { recorded: false, reason: "subsystem_required" };

    const eventId = `vc-evt-${++_counter}`;
    const results = {};

    // Fan out to configured modules
    const c = _config;

    if (c?.eventStream) {
        try {
            results.stream = c.eventStream.emit({
                eventType, subsystem, executionId, workflowId,
                correlationId, adapterType, authorityLevel, payload, timestamp,
            });
        } catch (_) { results.stream = { error: true }; }
    }

    if (c?.telemetryAggregator && outcome) {
        try {
            results.telemetry = c.telemetryAggregator.ingestSignal({
                signalType: "execution", subsystem, outcome,
                adapterType, workflowId, correlationId,
                latencyMs, authorityLevel, timestamp,
            });
        } catch (_) { results.telemetry = { error: true }; }
    }

    if (c?.metricsCollector && executionId && outcome) {
        try {
            results.metrics = c.metricsCollector.recordExecution({
                executionId, workflowId, adapterType,
                authorityLevel, outcome, latencyMs,
                timestamp,
            });
        } catch (_) { results.metrics = { error: true }; }
    }

    if (c?.healthMonitor && subsystem) {
        const healthOutcome = (outcome === "completed" || outcome === "success") ? "success"
            : (outcome === "failed" || outcome === "error") ? "failure"
            : outcome ?? "success";
        try {
            results.health = c.healthMonitor.reportHealthSignal({
                subsystem, outcome: healthOutcome, latencyMs, timestamp,
            });
        } catch (_) { results.health = { error: true }; }
    }

    if (c?.heatmapEngine && outcome &&
        (outcome === "failed" || outcome === "error" || outcome === "timeout" ||
         outcome === "quarantined" || outcome === "policy_denied")) {
        try {
            const failureType = outcome === "policy_denied" ? "policy_denied"
                : outcome === "timeout" ? "timeout"
                : outcome === "quarantined" ? "quarantine"
                : "execution_error";
            results.heatmap = c.heatmapEngine.recordFailure({
                failureType, adapterType, subsystem,
                workflowId, executionId, correlationId,
                authorityLevel, timestamp,
            });
        } catch (_) { results.heatmap = { error: true }; }
    }

    if (c?.correlationGraph && executionId && correlationId) {
        try {
            results.graph = c.correlationGraph.linkExecution({
                executionId, workflowId, correlationId,
                adapterType, authorityLevel, outcome, timestamp,
            });
        } catch (_) { results.graph = { error: true }; }
    }

    // Own bounded log
    if (_events.length >= _retention.maxEvents) _events.shift();
    _events.push(Object.freeze({ eventId, eventType, subsystem, executionId, workflowId, correlationId, outcome, timestamp }));

    return { recorded: true, eventId, fanOutCount: Object.keys(results).length, results };
}

// ── captureRuntimeSnapshot ─────────────────────────────────────────────

function captureRuntimeSnapshot() {
    const c = _config;
    if (!c?.snapshotEngine) return { captured: false, reason: "snapshotEngine_not_configured" };

    const payload = {
        controllerEventCount: _events.length,
        modules: Object.keys(c).filter(k => c[k] !== null),
        retention: { ..._retention },
    };

    if (c.metricsCollector) {
        try { payload.executionMetrics = c.metricsCollector.getCollectorMetrics(); } catch (_) {}
    }
    if (c.healthMonitor) {
        try { payload.runtimeHealth = c.healthMonitor.getRuntimeHealth(); } catch (_) {}
    }
    if (c.telemetryAggregator) {
        try { payload.telemetryMetrics = c.telemetryAggregator.getAggregatedMetrics(); } catch (_) {}
    }
    if (c.heatmapEngine) {
        try { payload.heatmapMetrics = c.heatmapEngine.getHeatmapMetrics(); } catch (_) {}
    }
    if (c.correlationGraph) {
        try { payload.graphMetrics = c.correlationGraph.getGraphMetrics(); } catch (_) {}
    }

    return c.snapshotEngine.captureSnapshot({
        source:  "visibility_controller",
        tag:     "runtime_snapshot",
        payload,
    });
}

// ── getVisibilityReport ────────────────────────────────────────────────

function getVisibilityReport() {
    const c = _config;
    const report = {
        controllerEvents: _events.length,
        configuredModules: c ? Object.keys(c).filter(k => c[k] !== null) : [],
        retention: { ..._retention },
    };

    if (c?.metricsCollector) {
        try { report.executions = c.metricsCollector.getCollectorMetrics(); } catch (_) {}
    }
    if (c?.healthMonitor) {
        try { report.health = c.healthMonitor.getRuntimeHealth(); } catch (_) {}
    }
    if (c?.telemetryAggregator) {
        try { report.telemetry = c.telemetryAggregator.getAggregatedMetrics(); } catch (_) {}
    }
    if (c?.heatmapEngine) {
        try { report.heatmap = c.heatmapEngine.getHeatmapMetrics(); } catch (_) {}
    }
    if (c?.correlationGraph) {
        try { report.graph = c.correlationGraph.getGraphMetrics(); } catch (_) {}
    }
    if (c?.workflowTracker) {
        try { report.workflows = c.workflowTracker.getWorkflowMetrics(); } catch (_) {}
    }
    if (c?.eventStream) {
        try { report.stream = c.eventStream.getStreamMetrics(); } catch (_) {}
    }

    return report;
}

// ── enforceRetention ──────────────────────────────────────────────────

function enforceRetention(policy = null) {
    const effective = policy ?? _retention;
    const before    = _events.length;
    const cutoff    = new Date(Date.now() - effective.maxAgeMs).toISOString();

    _events = _events.filter(e => e.timestamp >= cutoff);
    while (_events.length > effective.maxEvents) _events.shift();

    const pruned = before - _events.length;
    const results = { pruned, remaining: _events.length };

    if (_config?.snapshotEngine) {
        try {
            const r = _config.snapshotEngine.pruneSnapshots(effective.maxAgeMs);
            results.snapshotsPruned = r.pruned;
        } catch (_) {}
    }

    return results;
}

// ── getVisibilityMetrics ───────────────────────────────────────────────

function getVisibilityMetrics() {
    return {
        controllerEvents:  _events.length,
        configuredModules: _config ? Object.keys(_config).filter(k => _config[k] !== null).length : 0,
        retention:         { ..._retention },
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _config    = null;
    _events    = [];
    _counter   = 0;
    _retention = { ...DEFAULT_RETENTION };
}

module.exports = {
    DEFAULT_RETENTION,
    configure, recordEvent, captureRuntimeSnapshot,
    getVisibilityReport, enforceRetention,
    getVisibilityMetrics, reset,
};
