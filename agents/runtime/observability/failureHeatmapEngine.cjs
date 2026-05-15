"use strict";
/**
 * failureHeatmapEngine — failure hotspot detection across adapter type,
 * subsystem, time bucket, and authority level.
 *
 * recordFailure(spec)             → { recorded, failureId }
 * getHeatmapByAdapter()           → HeatmapRow[]
 * getHeatmapBySubsystem()         → HeatmapRow[]
 * getHeatmapByTimeBucket(bucketMs?) → TimeBucketRow[]
 * getTopHotspots(n?)              → Hotspot[]
 * detectAnomalies(threshold?)     → Anomaly[]
 * getHeatmapMetrics()             → HeatmapMetrics
 * reset()
 *
 * Time bucket: configurable (default 60 000 ms = 1-minute buckets).
 * Failure types: execution_error, timeout, policy_denied, circuit_open,
 *                sandbox_escaped, quarantine, authority_error, validation_error
 */

const FAILURE_TYPES = new Set([
    "execution_error", "timeout", "policy_denied", "circuit_open",
    "sandbox_escaped", "quarantine", "authority_error", "validation_error",
    "spawn_error", "unknown",
]);

const DEFAULT_BUCKET_MS  = 60000;
const ANOMALY_THRESHOLD  = 0.4;   // failure rate above this → anomaly
const MAX_FAILURES       = 50000;

let _failures   = [];
let _counter    = 0;

// ── recordFailure ─────────────────────────────────────────────────────

function recordFailure(spec = {}) {
    const {
        failureType    = "unknown",
        adapterType    = null,
        subsystem      = null,
        workflowId     = null,
        executionId    = null,
        correlationId  = null,
        authorityLevel = null,
        riskScore      = null,
        timestamp      = new Date().toISOString(),
    } = spec;

    if (!adapterType && !subsystem)
        return { recorded: false, reason: "adapterType_or_subsystem_required" };
    if (!FAILURE_TYPES.has(failureType))
        return { recorded: false, reason: `invalid_failure_type: ${failureType}` };

    const failureId = `hf-${++_counter}`;
    const failure   = Object.freeze({
        failureId, failureType,
        adapterType:    adapterType    ?? null,
        subsystem:      subsystem      ?? null,
        workflowId:     workflowId     ?? null,
        executionId:    executionId    ?? null,
        correlationId:  correlationId  ?? null,
        authorityLevel: authorityLevel ?? null,
        riskScore:      riskScore      ?? null,
        timestamp,
    });

    if (_failures.length >= MAX_FAILURES) _failures.shift();
    _failures.push(failure);

    return { recorded: true, failureId, failureType, adapterType, subsystem };
}

// ── _aggregate ────────────────────────────────────────────────────────

function _aggregate(keyFn) {
    const map = new Map();
    for (const f of _failures) {
        const key = keyFn(f);
        if (!key) continue;
        let row = map.get(key);
        if (!row) { row = { key, totalFailures: 0, byType: {} }; map.set(key, row); }
        row.totalFailures++;
        row.byType[f.failureType] = (row.byType[f.failureType] ?? 0) + 1;
    }
    return [...map.values()].sort((a, b) => b.totalFailures - a.totalFailures);
}

// ── getHeatmapByAdapter ────────────────────────────────────────────────

function getHeatmapByAdapter() {
    return _aggregate(f => f.adapterType).map(r => ({ adapterType: r.key, ...r }));
}

// ── getHeatmapBySubsystem ──────────────────────────────────────────────

function getHeatmapBySubsystem() {
    return _aggregate(f => f.subsystem).map(r => ({ subsystem: r.key, ...r }));
}

// ── getHeatmapByTimeBucket ─────────────────────────────────────────────

function getHeatmapByTimeBucket(bucketMs = DEFAULT_BUCKET_MS) {
    const map = new Map();
    for (const f of _failures) {
        const ts     = new Date(f.timestamp).getTime();
        const bucket = Math.floor(ts / bucketMs) * bucketMs;
        let   row    = map.get(bucket);
        if (!row) { row = { bucketStart: new Date(bucket).toISOString(), count: 0, byType: {} }; map.set(bucket, row); }
        row.count++;
        row.byType[f.failureType] = (row.byType[f.failureType] ?? 0) + 1;
    }
    return [...map.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

// ── getTopHotspots ─────────────────────────────────────────────────────

function getTopHotspots(n = 5) {
    const adapterRows  = getHeatmapByAdapter();
    const systemRows   = getHeatmapBySubsystem();
    const combined     = [];

    for (const r of adapterRows)  combined.push({ dimension: "adapter",    id: r.key, count: r.totalFailures, byType: r.byType });
    for (const r of systemRows)   combined.push({ dimension: "subsystem",  id: r.key, count: r.totalFailures, byType: r.byType });

    // Deduplicate and take top-n
    const seen = new Set();
    return combined
        .filter(h => { const k = `${h.dimension}:${h.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

// ── detectAnomalies ────────────────────────────────────────────────────

function detectAnomalies(threshold = ANOMALY_THRESHOLD) {
    const buckets = getHeatmapByTimeBucket();
    if (buckets.length < 2) return [];

    const counts  = buckets.map(b => b.count);
    const avg     = counts.reduce((a, v) => a + v, 0) / counts.length;
    const anomalies = [];

    for (const b of buckets) {
        const rate = avg > 0 ? b.count / avg : 0;
        if (rate > (1 + threshold)) {
            anomalies.push({
                bucketStart:  b.bucketStart,
                count:        b.count,
                baseline:     Math.round(avg * 100) / 100,
                spikeRatio:   Math.round(rate * 100) / 100,
                byType:       b.byType,
            });
        }
    }
    return anomalies;
}

// ── getHeatmapMetrics ──────────────────────────────────────────────────

function getHeatmapMetrics() {
    const byType = {};
    for (const f of _failures)
        byType[f.failureType] = (byType[f.failureType] ?? 0) + 1;

    const topAdapter  = getHeatmapByAdapter()[0]   ?? null;
    const topSubsys   = getHeatmapBySubsystem()[0] ?? null;

    return {
        totalFailures:     _failures.length,
        byType,
        topAdapterHotspot:  topAdapter  ? { adapterType: topAdapter.key,  count: topAdapter.totalFailures }  : null,
        topSubsystemHotspot: topSubsys  ? { subsystem:   topSubsys.key,   count: topSubsys.totalFailures }   : null,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _failures = [];
    _counter  = 0;
}

module.exports = {
    FAILURE_TYPES, DEFAULT_BUCKET_MS, ANOMALY_THRESHOLD,
    recordFailure, getHeatmapByAdapter, getHeatmapBySubsystem,
    getHeatmapByTimeBucket, getTopHotspots, detectAnomalies,
    getHeatmapMetrics, reset,
};
