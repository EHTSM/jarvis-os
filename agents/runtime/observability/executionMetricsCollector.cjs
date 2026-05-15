"use strict";
/**
 * executionMetricsCollector — collects per-execution metrics, maintains
 * latency histograms, and computes throughput over rolling time windows.
 *
 * recordExecution(spec)          → { recorded, metricId }
 * getLatencyDistribution(opts?)  → LatencyDistribution
 * getThroughput(windowMs?)       → ThroughputReport
 * getAdapterMetrics(adapterType) → AdapterMetrics | null
 * getAuthorityMetrics()          → AuthorityBreakdown
 * getCollectorMetrics()          → CollectorMetrics
 * reset()
 *
 * Histogram buckets (ms): [10, 50, 100, 250, 500, 1000, 2500, 5000, +Inf]
 */

const LATENCY_BUCKETS  = [10, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];
const DEFAULT_WINDOW   = 60000;
const MAX_RECORDS      = 100000;

let _records  = [];
let _counter  = 0;
let _adapters = new Map();   // adapterType → AdapterState
let _auth     = new Map();   // authorityLevel → count

// ── recordExecution ────────────────────────────────────────────────────

function recordExecution(spec = {}) {
    const {
        executionId    = null,
        workflowId     = null,
        adapterType    = null,
        capability     = null,
        authorityLevel = null,
        outcome        = null,    // "completed" | "failed" | "cancelled" | "quarantined" | "timeout"
        latencyMs      = null,
        riskScore      = null,
        dryRun         = false,
        replayed       = false,
        timestamp      = new Date().toISOString(),
    } = spec;

    if (!executionId) return { recorded: false, reason: "executionId_required" };
    if (!outcome)     return { recorded: false, reason: "outcome_required" };

    const metricId = `metric-${++_counter}`;
    const record   = Object.freeze({
        metricId, executionId, workflowId: workflowId ?? null,
        adapterType: adapterType ?? null, capability: capability ?? null,
        authorityLevel: authorityLevel ?? null, outcome,
        latencyMs: latencyMs ?? null, riskScore: riskScore ?? null,
        dryRun, replayed, timestamp,
    });

    if (_records.length >= MAX_RECORDS) _records.shift();
    _records.push(record);

    // Per-adapter tracking
    if (adapterType) {
        let ad = _adapters.get(adapterType);
        if (!ad) {
            ad = { adapterType, total: 0, completed: 0, failed: 0, timeouts: 0, latencies: [] };
            _adapters.set(adapterType, ad);
        }
        ad.total++;
        if (outcome === "completed") ad.completed++;
        if (outcome === "failed")    ad.failed++;
        if (outcome === "timeout")   ad.timeouts++;
        if (latencyMs !== null) {
            ad.latencies.push(latencyMs);
            if (ad.latencies.length > 1000) ad.latencies.shift();
        }
    }

    // Authority tracking
    if (authorityLevel) {
        _auth.set(authorityLevel, (_auth.get(authorityLevel) ?? 0) + 1);
    }

    return { recorded: true, metricId, executionId, outcome };
}

// ── getLatencyDistribution ─────────────────────────────────────────────

function getLatencyDistribution(opts = {}) {
    const { adapterType = null, outcome = null } = opts;
    let src = _records.filter(r => r.latencyMs !== null);
    if (adapterType) src = src.filter(r => r.adapterType === adapterType);
    if (outcome)     src = src.filter(r => r.outcome === outcome);

    const latencies = src.map(r => r.latencyMs);
    if (latencies.length === 0)
        return { count: 0, buckets: {}, p50: null, p95: null, p99: null, avg: null, max: null };

    const sorted = [...latencies].sort((a, b) => a - b);
    const p = (pct) => sorted[Math.floor(sorted.length * pct / 100)] ?? null;

    const buckets = {};
    for (const b of LATENCY_BUCKETS) {
        const label = b === Infinity ? "+Inf" : `${b}ms`;
        buckets[label] = latencies.filter(v => v <= b).length;
    }

    const avg = Math.round(latencies.reduce((a, v) => a + v, 0) / latencies.length);

    return {
        count: latencies.length,
        buckets,
        p50:   p(50),
        p95:   p(95),
        p99:   p(99),
        avg,
        max:   sorted[sorted.length - 1],
    };
}

// ── getThroughput ──────────────────────────────────────────────────────

function getThroughput(windowMs = DEFAULT_WINDOW) {
    const cutoff  = new Date(Date.now() - windowMs).toISOString();
    const window  = _records.filter(r => r.timestamp >= cutoff);

    const total      = window.length;
    const completed  = window.filter(r => r.outcome === "completed").length;
    const failed     = window.filter(r => r.outcome === "failed").length;
    const perSecond  = total > 0 ? Math.round((total / windowMs) * 1000 * 100) / 100 : 0;

    return {
        windowMs,
        totalExecutions:  total,
        completedCount:   completed,
        failedCount:      failed,
        successRate:      total > 0 ? Math.round(completed / total * 1000) / 1000 : 0,
        executionsPerSec: perSecond,
    };
}

// ── getAdapterMetrics ──────────────────────────────────────────────────

function getAdapterMetrics(adapterType) {
    if (!adapterType) return null;
    const ad = _adapters.get(adapterType);
    if (!ad) return null;

    const avgLatency = ad.latencies.length
        ? Math.round(ad.latencies.reduce((a, v) => a + v, 0) / ad.latencies.length)
        : null;
    const successRate = ad.total > 0 ? Math.round(ad.completed / ad.total * 1000) / 1000 : 0;

    return {
        adapterType: ad.adapterType,
        total: ad.total, completed: ad.completed,
        failed: ad.failed, timeouts: ad.timeouts,
        successRate, avgLatencyMs: avgLatency,
    };
}

// ── getAuthorityMetrics ────────────────────────────────────────────────

function getAuthorityMetrics() {
    const dist = {};
    for (const [auth, count] of _auth) dist[auth] = count;
    return { distribution: dist, totalWithAuthority: [..._auth.values()].reduce((a, v) => a + v, 0) };
}

// ── getCollectorMetrics ────────────────────────────────────────────────

function getCollectorMetrics() {
    const total      = _records.length;
    const completed  = _records.filter(r => r.outcome === "completed").length;
    const failed     = _records.filter(r => r.outcome === "failed").length;
    const replayed   = _records.filter(r => r.replayed).length;
    const dryRuns    = _records.filter(r => r.dryRun).length;
    const byAdapter  = {};
    for (const [k, v] of _adapters) byAdapter[k] = v.total;

    return {
        totalRecords: total,
        completedCount: completed,
        failedCount: failed,
        replayedCount: replayed,
        dryRunCount: dryRuns,
        successRate: total > 0 ? Math.round(completed / total * 1000) / 1000 : 0,
        byAdapter,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _records  = [];
    _adapters = new Map();
    _auth     = new Map();
    _counter  = 0;
}

module.exports = {
    LATENCY_BUCKETS, DEFAULT_WINDOW,
    recordExecution, getLatencyDistribution, getThroughput,
    getAdapterMetrics, getAuthorityMetrics, getCollectorMetrics, reset,
};
