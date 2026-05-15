"use strict";
/**
 * telemetryNormalizer — converts heterogeneous runtime signals into unified
 * supervision metrics and classifies severity.
 *
 * Unified NormalizedMetric shape:
 *   { metric, raw, value (0..1), severity, source, ts }
 *
 * normalizeCPU(payload)                  → NormalizedMetric
 * normalizeMemory(payload)               → NormalizedMetric
 * normalizeQueue(payload)                → NormalizedMetric
 * normalizeLatency(payload, baseline)    → NormalizedMetric
 * normalizeRetry(payload)                → NormalizedMetric
 * normalizeFailure(payload)              → NormalizedMetric
 * normalizeDisk(payload)                 → NormalizedMetric
 * normalizeWebsocket(payload)            → NormalizedMetric
 * normalizeAPI(payload)                  → NormalizedMetric
 * normalizeAll(signalMap)                → NormalizedMetric[]
 * classifySeverity(metricName, value)    → severity string
 * reset()
 */

// Severity thresholds: [critical, degraded, warning] (values 0..1)
const SEVERITY_THRESHOLDS = {
    cpu:       [0.90, 0.75, 0.60],
    memory:    [0.90, 0.80, 0.70],
    queue:     [0.90, 0.70, 0.50],
    latency:   [0.80, 0.60, 0.40],   // relative excess ratio
    retry:     [0.50, 0.30, 0.10],
    failure:   [0.30, 0.15, 0.05],
    disk:      [0.95, 0.85, 0.75],
    websocket: [0.30, 0.20, 0.10],   // drop rate
    api:       [0.30, 0.20, 0.05],   // error rate
};

const DEFAULT_LATENCY_BASELINE_MS = 200;

let _customThresholds = {};

// ── classifySeverity ──────────────────────────────────────────────────

function classifySeverity(metricName, value) {
    const thresholds = _customThresholds[metricName] ?? SEVERITY_THRESHOLDS[metricName];
    if (!thresholds) return "healthy";
    const [crit, deg, warn] = thresholds;
    return value >= crit ? "critical"  :
           value >= deg  ? "degraded"  :
           value >= warn ? "warning"   : "healthy";
}

// ── _metric helper ────────────────────────────────────────────────────

function _metric(metric, value, source, ts) {
    const clamped  = +Math.min(1, Math.max(0, value)).toFixed(4);
    const severity = classifySeverity(metric, clamped);
    return { metric, value: clamped, severity, source, ts: ts ?? new Date().toISOString() };
}

// ── normalizeCPU ──────────────────────────────────────────────────────

function normalizeCPU(payload = {}) {
    const value = payload.value ?? 0;
    return _metric("cpu", value, "cpu", payload.ts);
}

// ── normalizeMemory ───────────────────────────────────────────────────

function normalizeMemory(payload = {}) {
    let value = payload.pressureRatio ?? 0;
    if (value === 0 && payload.totalBytes > 0) {
        value = payload.usedBytes / payload.totalBytes;
    }
    return _metric("memory", value, "memory", payload.ts);
}

// ── normalizeQueue ────────────────────────────────────────────────────

function normalizeQueue(payload = {}) {
    const depth   = payload.depth       ?? 0;
    const maxCap  = payload.maxCapacity ?? Math.max(100, depth);
    const value   = maxCap > 0 ? depth / maxCap : 0;
    return _metric("queue", value, "queue", payload.ts);
}

// ── normalizeLatency ──────────────────────────────────────────────────

function normalizeLatency(payload = {}, baselineMs = DEFAULT_LATENCY_BASELINE_MS) {
    const avgMs   = payload.avgMs ?? 0;
    const base    = baselineMs > 0 ? baselineMs : DEFAULT_LATENCY_BASELINE_MS;
    // Normalize: excess ratio capped at 1 (5× baseline = 1.0)
    const excess  = Math.max(0, avgMs - base) / (base * 4);
    return _metric("latency", excess, "latency", payload.ts);
}

// ── normalizeRetry ────────────────────────────────────────────────────

function normalizeRetry(payload = {}) {
    const rate  = payload.rate ?? (payload.count != null ? Math.min(1, payload.count / 100) : 0);
    return _metric("retry", rate, "retry", payload.ts);
}

// ── normalizeFailure ──────────────────────────────────────────────────

function normalizeFailure(payload = {}) {
    const rate = payload.rate ?? (payload.count != null ? Math.min(1, payload.count / 100) : 0);
    return _metric("failure", rate, "failure", payload.ts);
}

// ── normalizeDisk ─────────────────────────────────────────────────────

function normalizeDisk(payload = {}) {
    let value = 0;
    if (payload.totalBytes > 0) value = payload.usedBytes / payload.totalBytes;
    // Also factor in ioWaitMs (>100ms = saturated)
    const ioFactor = payload.ioWaitMs != null ? Math.min(1, payload.ioWaitMs / 200) : 0;
    const combined = Math.max(value, ioFactor);
    return _metric("disk", combined, "disk", payload.ts);
}

// ── normalizeWebsocket ────────────────────────────────────────────────

function normalizeWebsocket(payload = {}) {
    const dropRate      = payload.dropRate      ?? 0;
    const reconnectRate = payload.reconnectRate ?? 0;
    const value         = Math.max(dropRate, reconnectRate * 0.5);
    return _metric("websocket", value, "websocket", payload.ts);
}

// ── normalizeAPI ──────────────────────────────────────────────────────

function normalizeAPI(payload = {}) {
    const errorRate   = payload.errorRate ?? 0;
    const available   = payload.available !== false ? 1 : 0;
    // Unavailable API = worst case
    const value       = available === 0 ? 1.0 : errorRate;
    return _metric("api", value, "api", payload.ts);
}

// ── normalizeAll ──────────────────────────────────────────────────────

const NORMALIZERS = {
    cpu:       normalizeCPU,
    memory:    normalizeMemory,
    queue:     normalizeQueue,
    latency:   normalizeLatency,
    retry:     normalizeRetry,
    failure:   normalizeFailure,
    disk:      normalizeDisk,
    websocket: normalizeWebsocket,
    api:       normalizeAPI,
};

function normalizeAll(signalMap = {}) {
    return Object.entries(signalMap)
        .filter(([type]) => NORMALIZERS[type])
        .map(([type, payload]) => {
            const raw = payload?.payload ?? payload;
            return NORMALIZERS[type](raw);
        });
}

// ── setCustomThresholds (test-only override) ──────────────────────────

function setCustomThresholds(metricName, thresholds) {
    _customThresholds[metricName] = thresholds;
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _customThresholds = {}; }

module.exports = {
    SEVERITY_THRESHOLDS,
    normalizeCPU, normalizeMemory, normalizeQueue, normalizeLatency,
    normalizeRetry, normalizeFailure, normalizeDisk, normalizeWebsocket,
    normalizeAPI, normalizeAll, classifySeverity, setCustomThresholds, reset,
};
