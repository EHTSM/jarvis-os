"use strict";
/**
 * resourceMonitor — runtime resource awareness for concurrency throttling
 * and timeout prediction.
 *
 * Provides:
 *   getMemoryPressure()     — 0–1 heap utilisation (0=free, 1=saturated)
 *   getCpuLoad()            — 0–1 based on 1-minute load avg / cpu count
 *   getQueuePressure()      — 0–1 based on current vs max queue depth
 *   maxConcurrency(opts)    — safe step concurrency given current resources
 *   predictTimeout(name)    — estimated ms from execution history p95
 *   shouldThrottle()        — true + reason when any resource is critical
 *   resourceSnapshot()      — full status object for reporting
 */

const os      = require("os");
const history = require("./executionHistory.cjs");

// ── Thresholds ────────────────────────────────────────────────────────

const MEM_HIGH   = 0.85;   // heap pressure above this → throttle
const CPU_HIGH   = 0.75;   // CPU load above this → reduce concurrency
const QUEUE_HIGH = 0.90;   // queue fill above this → backpressure

// ── Pressure functions ────────────────────────────────────────────────

/**
 * Returns 0–1 heap utilisation.
 * Also considers RSS vs total system RAM (weighted at 50%).
 */
function getMemoryPressure() {
    const { heapUsed, heapTotal, rss } = process.memoryUsage();
    const heapP = heapUsed / (heapTotal || 1);
    const sysP  = rss / (os.totalmem() || 1);
    return parseFloat(Math.min(Math.max(heapP * 0.7 + sysP * 0.3, 0), 1).toFixed(3));
}

/**
 * Returns 0–1 normalised 1-minute CPU load.
 * Value > 1 is clamped to 1 (can happen under heavy burst load).
 */
function getCpuLoad() {
    const cpus = os.cpus().length || 1;
    const load = os.loadavg()[0] || 0;
    return parseFloat(Math.min(load / cpus, 1.0).toFixed(3));
}

/**
 * Returns 0–1 queue fill ratio.
 *
 * @param {number} currentDepth
 * @param {number} maxDepth      default 100
 */
function getQueuePressure(currentDepth = 0, maxDepth = 100) {
    if (maxDepth <= 0) return 1.0;
    return parseFloat(Math.min(currentDepth / maxDepth, 1.0).toFixed(3));
}

// ── Concurrency ───────────────────────────────────────────────────────

/**
 * Compute safe concurrency based on current resource pressure.
 *
 * @param {{ baseMax?: number, queueDepth?: number, maxQueue?: number }} opts
 * @returns {number} concurrency limit (always ≥ 1)
 */
function maxConcurrency(opts = {}) {
    const { baseMax = os.cpus().length, queueDepth = 0, maxQueue = 100 } = opts;
    const mem   = getMemoryPressure();
    const cpu   = getCpuLoad();
    const queue = getQueuePressure(queueDepth, maxQueue);

    let factor = 1.0;
    if (mem   > MEM_HIGH)   factor = Math.min(factor, 0.5);
    if (cpu   > CPU_HIGH)   factor = Math.min(factor, 0.6);
    if (queue > QUEUE_HIGH) factor = Math.min(factor, 0.3);

    return Math.max(1, Math.floor(baseMax * factor));
}

// ── Timeout prediction ────────────────────────────────────────────────

/**
 * Predict a safe timeout for a named step from its execution history.
 * Uses the p95 duration × multiplier.  Falls back to defaultMs.
 *
 * @param {string} stepName
 * @param {{ defaultMs?: number, percentile?: number, multiplier?: number }} opts
 * @returns {number} milliseconds
 */
function predictTimeout(stepName, opts = {}) {
    const { defaultMs = 30_000, percentile = 0.95, multiplier = 1.5 } = opts;

    const records = history.byType(`step:${stepName}`);
    const durations = records
        .filter(r => r.success && r.durationMs > 0)
        .map(r => r.durationMs)
        .sort((a, b) => a - b);

    if (durations.length < 3) return defaultMs;

    const idx = Math.min(
        Math.floor(durations.length * percentile),
        durations.length - 1
    );
    return Math.ceil(durations[idx] * multiplier);
}

// ── Throttle decision ─────────────────────────────────────────────────

/**
 * @returns {{ throttle: boolean, reason: string, value: number }}
 */
function shouldThrottle() {
    const mem = getMemoryPressure();
    const cpu = getCpuLoad();
    if (mem > MEM_HIGH) return { throttle: true,  reason: "high_memory_pressure", value: mem };
    if (cpu > CPU_HIGH) return { throttle: true,  reason: "high_cpu_load",        value: cpu };
    return              { throttle: false, reason: "ok",                   value: Math.max(mem, cpu) };
}

// ── Snapshot ──────────────────────────────────────────────────────────

function resourceSnapshot() {
    const mem  = getMemoryPressure();
    const cpu  = getCpuLoad();
    const thr  = shouldThrottle();
    return {
        memoryPressure:  mem,
        cpuLoad:         cpu,
        maxConcurrency:  maxConcurrency(),
        shouldThrottle:  thr,
        heapMB:          Math.round(process.memoryUsage().heapUsed / 1_048_576),
        totalMemMB:      Math.round(os.totalmem() / 1_048_576),
        cpuCount:        os.cpus().length,
    };
}

module.exports = {
    getMemoryPressure,
    getCpuLoad,
    getQueuePressure,
    maxConcurrency,
    predictTimeout,
    shouldThrottle,
    resourceSnapshot,
    MEM_HIGH,
    CPU_HIGH,
    QUEUE_HIGH,
};
