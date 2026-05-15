"use strict";
/**
 * anomalyDetector — detects abnormal execution patterns.
 *
 * detectAll(entries, opts) → AnomalyReport
 */

// ── individual detectors ──────────────────────────────────────────────

function detectRetrySpike(entries = [], opts = {}) {
    const window    = opts.window    ?? 10;
    const threshold = opts.threshold ?? 3;
    const recent    = entries.slice(-window);
    if (recent.length === 0) return { detected: false, anomalies: [] };
    const avgRetries = recent.reduce((s, e) => s + (e.retryCount ?? 0), 0) / recent.length;
    if (avgRetries > threshold) {
        return {
            detected:   true,
            anomalies:  [{ type: "retry_spike", avgRetries, window, threshold, entries: recent.length }],
        };
    }
    return { detected: false, anomalies: [] };
}

function detectExcessiveSpawning(entries = [], opts = {}) {
    const window    = opts.window    ?? 5;
    const threshold = opts.threshold ?? 20;
    const recent    = entries.slice(-window);
    const total     = recent.reduce((s, e) => s + (e.stepsSpawned ?? 0), 0);
    if (total > threshold) {
        return {
            detected:  true,
            anomalies: [{ type: "excessive_spawning", totalSteps: total, window, threshold }],
        };
    }
    return { detected: false, anomalies: [] };
}

function detectRepeatedLoops(entries = [], fingerprint, opts = {}) {
    const window    = opts.window    ?? 5;
    const threshold = opts.threshold ?? 3;
    const recent    = entries.filter(e => e.fingerprint === fingerprint).slice(-window);
    if (recent.length >= threshold) {
        // All recent executions of same fingerprint in a short window = loop
        const timeSpan = _timeSpanMs(recent);
        if (timeSpan < (opts.loopWindowMs ?? 60000)) {
            return {
                detected:  true,
                anomalies: [{ type: "repeated_loop", fingerprint, executions: recent.length, timeSpanMs: timeSpan }],
            };
        }
    }
    return { detected: false, anomalies: [] };
}

function detectRollbackCycles(entries = [], fingerprint, opts = {}) {
    const threshold = opts.threshold ?? 0.5;
    const fpEntries = entries.filter(e => e.fingerprint === fingerprint);
    if (fpEntries.length < 2) return { detected: false, anomalies: [] };
    const rollbackRate = fpEntries.filter(e => e.rollbackTriggered).length / fpEntries.length;
    // Cycle: rollback → (any) → rollback pattern
    let cycleCount = 0;
    for (let i = 1; i < fpEntries.length; i++) {
        if (fpEntries[i - 1].rollbackTriggered && fpEntries[i].rollbackTriggered) cycleCount++;
    }
    const cycleDensity = fpEntries.length > 1 ? cycleCount / (fpEntries.length - 1) : 0;
    if (rollbackRate > threshold || cycleDensity > 0.3) {
        return {
            detected:  true,
            anomalies: [{ type: "rollback_cycle", fingerprint, rollbackRate, cycleCount, cycleDensity }],
        };
    }
    return { detected: false, anomalies: [] };
}

function detectExecutionDrift(entries = [], fingerprint, opts = {}) {
    const window = opts.window ?? 5;
    const fpEntries = entries.filter(e => e.fingerprint === fingerprint).slice(-window);
    if (fpEntries.length < 3) return { detected: false, anomalies: [] };
    const strategies   = fpEntries.map(e => e.strategy).filter(Boolean);
    const uniqueStrats = new Set(strategies).size;
    if (uniqueStrats >= 3) {
        return {
            detected:  true,
            anomalies: [{
                type:       "execution_drift",
                fingerprint,
                strategies: [...new Set(strategies)],
                uniqueCount: uniqueStrats,
            }],
        };
    }
    return { detected: false, anomalies: [] };
}

// ── detectAll ─────────────────────────────────────────────────────────

function detectAll(entries = [], opts = {}) {
    const uniqueFps = [...new Set(entries.map(e => e.fingerprint).filter(Boolean))];
    const allAnomalies = [];

    const retrySpike = detectRetrySpike(entries, opts);
    if (retrySpike.detected) allAnomalies.push(...retrySpike.anomalies);

    const spawning = detectExcessiveSpawning(entries, opts);
    if (spawning.detected) allAnomalies.push(...spawning.anomalies);

    for (const fp of uniqueFps) {
        const loop = detectRepeatedLoops(entries, fp, opts);
        if (loop.detected) allAnomalies.push(...loop.anomalies);

        const cycle = detectRollbackCycles(entries, fp, opts);
        if (cycle.detected) allAnomalies.push(...cycle.anomalies);

        const drift = detectExecutionDrift(entries, fp, opts);
        if (drift.detected) allAnomalies.push(...drift.anomalies);
    }

    return {
        detected:  allAnomalies.length > 0,
        count:     allAnomalies.length,
        anomalies: allAnomalies,
        severity:  _overallSeverity(allAnomalies),
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _timeSpanMs(entries) {
    if (entries.length < 2) return 0;
    const t0 = new Date(entries[0].ts).getTime();
    const t1 = new Date(entries[entries.length - 1].ts).getTime();
    return Math.abs(t1 - t0);
}

function _overallSeverity(anomalies) {
    if (anomalies.length === 0) return "none";
    const types = anomalies.map(a => a.type);
    if (types.includes("rollback_cycle") || types.includes("repeated_loop")) return "high";
    if (types.includes("retry_spike")   || types.includes("excessive_spawning")) return "medium";
    return "low";
}

module.exports = {
    detectRetrySpike, detectExcessiveSpawning, detectRepeatedLoops,
    detectRollbackCycles, detectExecutionDrift, detectAll,
};
