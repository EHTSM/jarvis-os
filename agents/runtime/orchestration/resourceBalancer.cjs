"use strict";
/**
 * resourceBalancer — tracks and regulates runtime resource pressure.
 *
 * record(metricsEntry)   → void
 * getStatus()            → ResourceStatus
 * shouldThrottle(fp?)    → ThrottleDecision
 * shouldDelay(fp?)       → boolean
 * rebalance()            → RebalanceResult
 * reset()
 */

const THRESHOLDS = {
    heapMB:          400,
    cpuUserMs:       500,
    activeProcesses: 20,
    queueDepth:      50,
    retryRate:       0.5,
};

let _window    = [];
const WINDOW   = 20;   // rolling window size

// ── record ────────────────────────────────────────────────────────────

function record(entry) {
    _window.push({
        ts:               entry.ts ?? new Date().toISOString(),
        heapUsedBytes:    entry.heapUsedBytes  ?? 0,
        cpuUserMs:        entry.cpuUserMs      ?? 0,
        stepsSpawned:     entry.stepsSpawned   ?? 0,
        queueDepth:       entry.queueDepth     ?? 0,
        retryCount:       entry.retryCount     ?? 0,
        success:          entry.success        ?? true,
        fingerprint:      entry.fingerprint    ?? null,
    });
    if (_window.length > WINDOW) _window.shift();
}

// ── getStatus ─────────────────────────────────────────────────────────

function getStatus() {
    if (_window.length === 0) {
        return {
            pressure: "none",
            heapMB:           0,
            avgCpuUserMs:     0,
            totalProcesses:   0,
            avgQueueDepth:    0,
            retryRate:        0,
            windowSize:       0,
        };
    }
    const n             = _window.length;
    const heapMB        = (_window[n - 1].heapUsedBytes ?? 0) / (1024 * 1024);
    const avgCpuUserMs  = _window.reduce((s, e) => s + e.cpuUserMs, 0) / n;
    const totalProcs    = _window.reduce((s, e) => s + e.stepsSpawned, 0);
    const avgQueueDepth = _window.reduce((s, e) => s + e.queueDepth, 0) / n;
    const retryRate     = _window.reduce((s, e) => s + e.retryCount, 0) /
                          Math.max(1, _window.length);

    const pressure = _calcPressure(heapMB, avgCpuUserMs, totalProcs, avgQueueDepth, retryRate);

    return { pressure, heapMB, avgCpuUserMs, totalProcesses: totalProcs, avgQueueDepth, retryRate, windowSize: n };
}

// ── shouldThrottle ────────────────────────────────────────────────────

function shouldThrottle(fingerprint) {
    const status = getStatus();
    const throttle = status.pressure === "high" || status.pressure === "critical";
    return {
        throttle,
        reason:   throttle ? `resource pressure: ${status.pressure}` : null,
        pressure: status.pressure,
    };
}

// ── shouldDelay ───────────────────────────────────────────────────────

function shouldDelay(fingerprint, opts = {}) {
    const status = getStatus();
    return status.pressure === "medium" || status.pressure === "high" || status.pressure === "critical";
}

// ── rebalance ─────────────────────────────────────────────────────────

function rebalance() {
    const status  = getStatus();
    const actions = [];

    if (status.heapMB > THRESHOLDS.heapMB) {
        actions.push({ action: "reduce_concurrency", reason: "heap_pressure", severity: "high" });
    }
    if (status.avgCpuUserMs > THRESHOLDS.cpuUserMs) {
        actions.push({ action: "delay_non_critical", reason: "cpu_pressure", severity: "medium" });
    }
    if (status.totalProcesses > THRESHOLDS.activeProcesses) {
        actions.push({ action: "throttle_spawning", reason: "process_overload", severity: "high" });
    }
    if (status.avgQueueDepth > THRESHOLDS.queueDepth) {
        actions.push({ action: "drain_queue", reason: "queue_congestion", severity: "medium" });
    }
    if (status.retryRate > THRESHOLDS.retryRate) {
        actions.push({ action: "reduce_retries", reason: "retry_storm", severity: "high" });
    }

    return { status, actions, balanced: actions.length === 0 };
}

// ── helpers ───────────────────────────────────────────────────────────

function _calcPressure(heapMB, cpuMs, procs, queue, retryRate) {
    let score = 0;
    if (heapMB        > THRESHOLDS.heapMB)          score += 3;
    else if (heapMB   > THRESHOLDS.heapMB * 0.7)    score += 1;
    if (cpuMs         > THRESHOLDS.cpuUserMs)        score += 2;
    else if (cpuMs    > THRESHOLDS.cpuUserMs * 0.7)  score += 1;
    if (procs         > THRESHOLDS.activeProcesses)  score += 2;
    if (queue         > THRESHOLDS.queueDepth)       score += 2;
    if (retryRate     > THRESHOLDS.retryRate)         score += 2;
    if (score >= 6) return "critical";
    if (score >= 3) return "high";
    if (score >= 2) return "medium";
    if (score >= 1) return "low";
    return "none";
}

function reset() { _window = []; }

module.exports = { THRESHOLDS, record, getStatus, shouldThrottle, shouldDelay, rebalance, reset };
