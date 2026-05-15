"use strict";
/**
 * deploymentStabilityMonitor — deployment health, drift detection, and rollback guidance.
 *
 * checkHealth(snapshot, opts)              → HealthReport
 * checkStartupIntegrity(snapshot)          → IntegrityResult
 * validateDependencies(deps)               → DependencyReport
 * detectConfigDrift(baseline, current)     → DriftReport
 * detectDegradation(current, baseline, opts)→ DegradationReport
 * recommendRollback(report)                → RollbackRecommendation
 * reset()
 */

const DEFAULT_THRESHOLDS = {
    maxErrorRate:      0.05,
    maxLatencyMs:      2000,
    minThroughputRpm:  10,
    maxDegradationPct: 20,
};

let _history = [];   // HealthReport[]

// ── checkHealth ───────────────────────────────────────────────────────

function checkHealth(snapshot, opts = {}) {
    const {
        errorRate          = 0,
        avgLatencyMs       = 0,
        throughputRpm,
        dependenciesHealthy = true,
    } = snapshot;

    const thresholds = { ...DEFAULT_THRESHOLDS, ...opts };
    const issues     = [];

    if (errorRate > thresholds.maxErrorRate) {
        issues.push({ type: "high_error_rate",  value: errorRate,    threshold: thresholds.maxErrorRate,     severity: "high"   });
    }
    if (avgLatencyMs > thresholds.maxLatencyMs) {
        issues.push({ type: "high_latency",      value: avgLatencyMs, threshold: thresholds.maxLatencyMs,    severity: "medium" });
    }
    if (throughputRpm != null && isFinite(throughputRpm) && throughputRpm < thresholds.minThroughputRpm) {
        issues.push({ type: "low_throughput",    value: throughputRpm,threshold: thresholds.minThroughputRpm,severity: "medium" });
    }
    if (!dependenciesHealthy) {
        issues.push({ type: "dependency_unhealthy", severity: "high" });
    }

    const healthy = issues.length === 0;
    const status  = !healthy && issues.some(i => i.severity === "high") ? "degraded"
                  : !healthy ? "warning" : "healthy";

    const report = { healthy, status, issues, snapshot, ts: new Date().toISOString() };
    _history.push(report);
    return report;
}

// ── checkStartupIntegrity ─────────────────────────────────────────────

function checkStartupIntegrity(snapshot = {}) {
    const checks = [
        { check: "config_loaded",  passed: snapshot.configLoaded  !== false },
        { check: "ports_open",     passed: snapshot.portsOpen     !== false },
        { check: "deps_resolved",  passed: snapshot.depsResolved  !== false },
        { check: "schema_valid",   passed: snapshot.schemaValid   !== false },
    ];
    const failed = checks.filter(c => !c.passed);
    return { passed: failed.length === 0, failed, checks, ts: new Date().toISOString() };
}

// ── validateDependencies ──────────────────────────────────────────────

function validateDependencies(deps = []) {
    const results = deps.map(dep => {
        const { name, version, available = true, latencyMs = 0, errorRate = 0 } = dep;
        const issues = [];
        if (!available)     issues.push("unavailable");
        if (latencyMs > 1000) issues.push("high_latency");
        if (errorRate > 0.1)  issues.push("high_error_rate");
        return { name, version: version ?? "unknown", healthy: issues.length === 0, issues };
    });

    return {
        allHealthy: results.every(r => r.healthy),
        healthy:    results.filter(r => r.healthy),
        unhealthy:  results.filter(r => !r.healthy),
        total:      deps.length,
    };
}

// ── detectConfigDrift ─────────────────────────────────────────────────

function detectConfigDrift(baseline = {}, current = {}) {
    const drifted = [];
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);

    for (const key of allKeys) {
        if (!(key in baseline)) {
            drifted.push({ key, type: "added",   currentValue: current[key] });
        } else if (!(key in current)) {
            drifted.push({ key, type: "removed",  baselineValue: baseline[key] });
        } else if (JSON.stringify(baseline[key]) !== JSON.stringify(current[key])) {
            drifted.push({ key, type: "changed", baselineValue: baseline[key], currentValue: current[key] });
        }
    }

    const SENSITIVE = ["port", "host", "database", "secret", "key", "password"];
    const critical  = drifted.some(d => SENSITIVE.some(k => d.key.toLowerCase().includes(k)));
    return { hasDrift: drifted.length > 0, driftCount: drifted.length, drifted, critical };
}

// ── detectDegradation ─────────────────────────────────────────────────

function detectDegradation(current = {}, baseline = null, opts = {}) {
    if (!baseline) return { degraded: false, reason: "no_baseline" };

    const threshold  = opts.degradationPct ?? DEFAULT_THRESHOLDS.maxDegradationPct;
    const indicators = [];

    const errDelta = (current.errorRate ?? 0) - (baseline.errorRate ?? 0);
    if (errDelta > 0.05) {
        indicators.push({
            metric:     "error_rate",
            baseline:   baseline.errorRate,
            current:    current.errorRate,
            delta:      +errDelta.toFixed(3),
        });
    }

    const baseLatency = baseline.avgLatencyMs ?? 0;
    if (baseLatency > 0) {
        const latDeltaPct = ((current.avgLatencyMs ?? 0) - baseLatency) / baseLatency * 100;
        if (latDeltaPct > threshold) {
            indicators.push({
                metric:    "latency",
                baseline:  baseLatency,
                current:   current.avgLatencyMs,
                deltaPct:  +latDeltaPct.toFixed(1),
            });
        }
    }

    const baseTp = baseline.throughputRpm ?? 0;
    if (baseTp > 0) {
        const tpDeltaPct = (baseTp - (current.throughputRpm ?? 0)) / baseTp * 100;
        if (tpDeltaPct > threshold) {
            indicators.push({
                metric:   "throughput",
                baseline: baseTp,
                current:  current.throughputRpm,
                deltaPct: +tpDeltaPct.toFixed(1),
            });
        }
    }

    const degraded  = indicators.length > 0;
    const severity  = indicators.length >= 2 ? "high" : indicators.length === 1 ? "medium" : "none";
    return { degraded, severity, indicators };
}

// ── recommendRollback ─────────────────────────────────────────────────

function recommendRollback(report) {
    if (!report) return { recommend: false, reason: "no_report" };

    const highDegradation = report.degraded && report.severity === "high";
    const highErrorRate   = (report.issues ?? []).some(i => i.type === "high_error_rate");
    const recommend       = highDegradation || highErrorRate;
    const urgency         = recommend &&
                            (report.severity === "high" || highErrorRate) ? "immediate" : "monitored";

    return {
        recommend,
        urgency,
        reason: recommend ? "degradation_above_threshold" : "degradation_within_tolerance",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _history = [];
}

module.exports = {
    DEFAULT_THRESHOLDS,
    checkHealth, checkStartupIntegrity, validateDependencies,
    detectConfigDrift, detectDegradation, recommendRollback,
    reset,
};
