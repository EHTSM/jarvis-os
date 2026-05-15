"use strict";
/**
 * telemetryWindowManager — rolling telemetry windows, spike detection, and trend analysis.
 *
 * Windows: 1min (60s), 5min (300s), 15min (900s), 1hr (3600s)
 * Trends:  improving | stable | degrading | unstable
 *
 * addSample(metric, value, ts)             → void
 * getWindow(metric, windowMs)              → WindowStats
 * getAllWindowStats(metric)                → { '1m', '5m', '15m', '1h' }
 * detectSpike(metric, windowMs)           → SpikeResult
 * analyzeTrend(metric, windowMs)          → TrendResult
 * getWindowSummary(metric)                → WindowSummary
 * reset()
 */

const WINDOWS = {
    "1m":  60_000,
    "5m":  300_000,
    "15m": 900_000,
    "1h":  3_600_000,
};

// Spike: value exceeds mean + SPIKE_SIGMA × stddev
const SPIKE_SIGMA       = 2.5;
// Trend: slope magnitude thresholds (normalized units per second)
const TREND_SLOPE_STRONG = 0.002;  // 0.12/min — clearly directional
const TREND_SLOPE_WEAK   = 0.0005;
// Instability: coefficient of variation threshold
const INSTABILITY_CV    = 0.3;
const SAMPLES_CAP       = 2000;

let _samples = new Map();   // metric → [{ value, ts }]

// ── addSample ─────────────────────────────────────────────────────────

function addSample(metric, value, ts = null) {
    if (!_samples.has(metric)) _samples.set(metric, []);
    const arr = _samples.get(metric);
    arr.push({ value: +value, ts: ts ? new Date(ts).getTime() : Date.now() });
    if (arr.length > SAMPLES_CAP) arr.shift();
}

// ── _getWindowSamples ─────────────────────────────────────────────────

function _getWindowSamples(metric, windowMs, nowMs = Date.now()) {
    const arr    = _samples.get(metric) ?? [];
    const cutoff = nowMs - windowMs;
    return arr.filter(s => s.ts >= cutoff);
}

// ── _stats ────────────────────────────────────────────────────────────

function _stats(samples) {
    if (samples.length === 0) return null;
    const vals  = samples.map(s => s.value);
    const sorted = [...vals].sort((a, b) => a - b);
    const n     = vals.length;
    const sum   = vals.reduce((s, v) => s + v, 0);
    const avg   = sum / n;
    const variance = vals.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
    const stddev   = Math.sqrt(variance);
    const p50   = sorted[Math.floor(n * 0.50)];
    const p95   = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    return {
        min:    sorted[0],
        max:    sorted[n - 1],
        avg:    +avg.toFixed(4),
        p50:    +p50.toFixed(4),
        p95:    +p95.toFixed(4),
        stddev: +stddev.toFixed(4),
        count:  n,
    };
}

// ── getWindow ─────────────────────────────────────────────────────────

function getWindow(metric, windowMs, nowMs = Date.now()) {
    const samples = _getWindowSamples(metric, windowMs, nowMs);
    if (samples.length === 0) return { metric, windowMs, count: 0, available: false };
    return { metric, windowMs, available: true, ..._stats(samples) };
}

// ── getAllWindowStats ─────────────────────────────────────────────────

function getAllWindowStats(metric, nowMs = Date.now()) {
    const result = {};
    for (const [label, ms] of Object.entries(WINDOWS)) {
        result[label] = getWindow(metric, ms, nowMs);
    }
    return result;
}

// ── detectSpike ───────────────────────────────────────────────────────

function detectSpike(metric, windowMs = WINDOWS["5m"], nowMs = Date.now()) {
    const samples = _getWindowSamples(metric, windowMs, nowMs);
    if (samples.length < 3) return { spiked: false, reason: "insufficient_samples" };

    const stats   = _stats(samples);
    const latest  = samples[samples.length - 1].value;
    const threshold = stats.avg + SPIKE_SIGMA * stats.stddev;
    const spiked  = latest > threshold;

    return {
        spiked,
        latest:     +latest.toFixed(4),
        avg:        stats.avg,
        stddev:     stats.stddev,
        threshold:  +threshold.toFixed(4),
        magnitude:  stats.stddev > 0 ? +((latest - stats.avg) / stats.stddev).toFixed(2) : 0,
    };
}

// ── analyzeTrend ──────────────────────────────────────────────────────

function analyzeTrend(metric, windowMs = WINDOWS["5m"], nowMs = Date.now()) {
    const samples = _getWindowSamples(metric, windowMs, nowMs);
    if (samples.length < 4) return { direction: "stable", reason: "insufficient_samples" };

    // Linear regression (least squares)
    const n   = samples.length;
    const x0  = samples[0].ts;
    const xs  = samples.map(s => (s.ts - x0) / 1000);  // seconds offset
    const ys  = samples.map(s => s.value);

    const sumX  = xs.reduce((s, x) => s + x, 0);
    const sumY  = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

    // Coefficient of variation
    const stats = _stats(samples);
    const cv    = stats.avg > 0 ? stats.stddev / stats.avg : 0;

    let direction;
    // Strong directional slope takes priority over CV instability:
    // monotone trends should not be misclassified as "unstable" just
    // because the range of values is wide.
    if (slope > TREND_SLOPE_STRONG) {
        direction = "degrading";
    } else if (slope < -TREND_SLOPE_STRONG) {
        direction = "improving";
    } else if (cv > INSTABILITY_CV) {
        direction = "unstable";
    } else if (Math.abs(slope) > TREND_SLOPE_WEAK) {
        direction = slope > 0 ? "degrading" : "improving";
    } else {
        direction = "stable";
    }

    return {
        direction,
        slope:     +slope.toFixed(6),
        cv:        +cv.toFixed(4),
        avg:       stats.avg,
        stddev:    stats.stddev,
        samples:   n,
    };
}

// ── getWindowSummary ──────────────────────────────────────────────────

function getWindowSummary(metric, nowMs = Date.now()) {
    const spike  = detectSpike(metric, WINDOWS["5m"], nowMs);
    const trend  = analyzeTrend(metric, WINDOWS["15m"], nowMs);
    const all    = getAllWindowStats(metric, nowMs);
    return { metric, spike, trend, windows: all };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _samples = new Map(); }

module.exports = {
    WINDOWS, SPIKE_SIGMA, TREND_SLOPE_STRONG, INSTABILITY_CV,
    addSample, getWindow, getAllWindowStats,
    detectSpike, analyzeTrend, getWindowSummary, reset,
};
