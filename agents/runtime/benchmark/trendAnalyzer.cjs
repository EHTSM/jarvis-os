"use strict";
/**
 * trendAnalyzer — detect regression/improvement trends across benchmark runs.
 *
 * record(name, metrics)            — store a run (delegates to benchmarkHistory)
 * analyze(name, n?)
 *   → { trend, delta, regressions[], improvements[], confidence, sampleSize }
 *
 * detectRegressions(name, n?)      → { detected, items[], severity }
 * detectImprovements(name, n?)     → { detected, items[] }
 * compareRuns(metricsA, metricsB)  → { deltas{}, verdict }
 * confidenceTrend(name, n?)        → { direction, delta, samples[] }
 * reset()
 */

const bh = require("./benchmarkHistory.cjs");

const REGRESSION_THRESHOLD  = 0.08;   // successRate drop ≥ 8%
const IMPROVEMENT_THRESHOLD = 0.05;   // successRate gain ≥ 5%
const FLIP_SPIKE            = 0.15;   // flipRate jump ≥ 0.15

// ── record ────────────────────────────────────────────────────────────

function record(name, metrics) {
    return bh.snapshot(name, metrics);
}

// ── analyze ───────────────────────────────────────────────────────────

function analyze(name, n = 10) {
    const longTrend  = bh.longTermTrend(name, n);
    const d          = bh.delta(name);
    const regressions  = detectRegressions(name, n);
    const improvements = detectImprovements(name, n);

    const confidence = _computeConfidence(longTrend, d);

    return {
        name,
        trend:        longTrend.trend,
        sampleSize:   longTrend.sampleSize,
        delta:        d.available ? d.changes : null,
        regressions:  regressions.items,
        improvements: improvements.items,
        confidence,
        regression:   d.regression  || false,
        improvement:  d.improvement || false,
    };
}

// ── detectRegressions ─────────────────────────────────────────────────

function detectRegressions(name, n = 10) {
    const hist = bh.getHistory(name, n);
    if (hist.length < 2) return { detected: false, items: [], severity: "none" };

    const items = [];

    for (let i = 0; i < hist.length - 1; i++) {
        const curr = hist[i].metrics;
        const prev = hist[i + 1].metrics;

        const srDrop  = (prev.successRate ?? 0) - (curr.successRate ?? 0);
        const frSpike = (curr.flipRate    ?? 0) - (prev.flipRate    ?? 0);

        if (srDrop  >= REGRESSION_THRESHOLD) {
            items.push({ type: "success_rate_drop",  delta: -parseFloat(srDrop.toFixed(3)), ts: hist[i].ts });
        }
        if (frSpike >= FLIP_SPIKE) {
            items.push({ type: "flip_rate_spike",    delta: parseFloat(frSpike.toFixed(3)), ts: hist[i].ts });
        }
    }

    const severity = items.length === 0 ? "none"
        : items.length >= 3              ? "critical"
        : items.length >= 2              ? "high"
        : "medium";

    return { detected: items.length > 0, items, severity };
}

// ── detectImprovements ────────────────────────────────────────────────

function detectImprovements(name, n = 10) {
    const hist = bh.getHistory(name, n);
    if (hist.length < 2) return { detected: false, items: [] };

    const items = [];

    for (let i = 0; i < hist.length - 1; i++) {
        const curr = hist[i].metrics;
        const prev = hist[i + 1].metrics;

        const srGain   = (curr.successRate ?? 0) - (prev.successRate ?? 0);
        const frDrop   = (prev.flipRate    ?? 0) - (curr.flipRate    ?? 0);

        if (srGain >= IMPROVEMENT_THRESHOLD) {
            items.push({ type: "success_rate_gain",  delta: parseFloat(srGain.toFixed(3)), ts: hist[i].ts });
        }
        if (frDrop >= 0.10) {
            items.push({ type: "flip_rate_drop",     delta: parseFloat(frDrop.toFixed(3)), ts: hist[i].ts });
        }
    }

    return { detected: items.length > 0, items };
}

// ── compareRuns ───────────────────────────────────────────────────────

function compareRuns(metricsA, metricsB) {
    const keys    = ["successRate", "repairRate", "flipRate", "avgMs", "p95Ms"];
    const deltas  = {};
    let   verdict = "neutral";

    for (const key of keys) {
        const a = metricsA?.[key] ?? metricsA?.score?.[key];
        const b = metricsB?.[key] ?? metricsB?.score?.[key];
        if (a != null && b != null) {
            deltas[key] = { a, b, delta: parseFloat((b - a).toFixed(4)) };
        }
    }

    const srDelta = deltas.successRate?.delta ?? 0;
    if      (srDelta >=  IMPROVEMENT_THRESHOLD) verdict = "improved";
    else if (srDelta <= -REGRESSION_THRESHOLD)  verdict = "regressed";

    return { deltas, verdict };
}

// ── confidenceTrend ───────────────────────────────────────────────────

function confidenceTrend(name, n = 10) {
    const hist    = bh.getHistory(name, n).reverse();   // oldest-first
    if (hist.length < 2) return { direction: "unknown", delta: 0, samples: [] };

    const samples = hist.map(h => ({
        ts:          h.ts,
        successRate: h.metrics.successRate ?? 0,
        flipRate:    h.metrics.flipRate    ?? 0,
        composite:   h.metrics.composite  ?? h.metrics.score?.composite ?? 0,
    }));

    const first = samples[0].composite;
    const last  = samples[samples.length - 1].composite;
    const delta = parseFloat((last - first).toFixed(2));

    return {
        direction: delta > 5 ? "growing" : delta < -5 ? "declining" : "stable",
        delta,
        samples,
    };
}

function reset() { bh.reset(); }

// ── helpers ───────────────────────────────────────────────────────────

function _computeConfidence(trend, d) {
    if (trend.sampleSize < 2) return 0;
    let conf = Math.min(0.90, trend.sampleSize / 10);
    if (d.regression)  conf -= 0.15;
    if (d.improvement) conf += 0.10;
    return parseFloat(Math.max(0, Math.min(1, conf)).toFixed(3));
}

module.exports = {
    record,
    analyze,
    detectRegressions,
    detectImprovements,
    compareRuns,
    confidenceTrend,
    reset,
    REGRESSION_THRESHOLD,
    IMPROVEMENT_THRESHOLD,
};
