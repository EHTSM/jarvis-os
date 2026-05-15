"use strict";
/**
 * telemetryIngestor — raw infrastructure telemetry ingestion.
 *
 * Supported signal types:
 *   cpu | memory | queue | latency | retry | failure |
 *   disk | websocket | api
 *
 * ingest(signalType, payload)            → IngestResult
 * ingestBatch(signals[])                 → BatchResult
 * getSignal(signalType)                  → latest payload | null
 * getSignalHistory(signalType, limit)    → SignalRecord[]
 * getSupportedSignals()                  → string[]
 * getIngestStats()                       → Stats
 * reset()
 */

const SUPPORTED_SIGNALS = [
    "cpu", "memory", "queue", "latency",
    "retry", "failure", "disk", "websocket", "api",
];

// Per-type schema validators: return null if valid, string error otherwise
const VALIDATORS = {
    cpu:       p => (p.value == null)        ? "missing_value"        : null,
    memory:    p => (p.usedBytes == null && p.pressureRatio == null) ? "missing_usage" : null,
    queue:     p => (p.depth == null)        ? "missing_depth"        : null,
    latency:   p => (p.avgMs == null)        ? "missing_avgMs"        : null,
    retry:     p => (p.rate == null && p.count == null) ? "missing_rate" : null,
    failure:   p => (p.rate == null && p.count == null) ? "missing_rate" : null,
    disk:      p => (p.usedBytes == null && p.ioWaitMs == null) ? "missing_usage" : null,
    websocket: p => (p.dropRate == null && p.activeConnections == null) ? "missing_drop_rate" : null,
    api:       p => (p.errorRate == null && p.latencyMs == null) ? "missing_error_rate" : null,
};

let _signals   = new Map();   // signalType → latest payload
let _history   = new Map();   // signalType → SignalRecord[]
let _ingestCount = 0;
let _errorCount  = 0;

const HISTORY_CAP = 500;

// ── ingest ────────────────────────────────────────────────────────────

function ingest(signalType, payload = {}) {
    if (!SUPPORTED_SIGNALS.includes(signalType)) {
        _errorCount++;
        return { ingested: false, reason: "unsupported_signal_type", signalType };
    }

    const validator = VALIDATORS[signalType];
    const err       = validator ? validator(payload) : null;
    if (err) {
        _errorCount++;
        return { ingested: false, reason: err, signalType };
    }

    const record = { signalType, payload: { ...payload }, ts: payload.ts ?? new Date().toISOString() };

    _signals.set(signalType, record);

    if (!_history.has(signalType)) _history.set(signalType, []);
    const hist = _history.get(signalType);
    hist.push(record);
    if (hist.length > HISTORY_CAP) hist.shift();

    _ingestCount++;
    return { ingested: true, signalType, ts: record.ts };
}

// ── ingestBatch ───────────────────────────────────────────────────────

function ingestBatch(signals = []) {
    const results  = signals.map(s => ingest(s.type ?? s.signalType, s.payload ?? s));
    const ingested = results.filter(r => r.ingested).length;
    const failed   = results.length - ingested;
    return { total: signals.length, ingested, failed, results };
}

// ── getSignal ─────────────────────────────────────────────────────────

function getSignal(signalType) {
    return _signals.get(signalType) ?? null;
}

// ── getSignalHistory ──────────────────────────────────────────────────

function getSignalHistory(signalType, limit = 100) {
    const hist = _history.get(signalType) ?? [];
    return hist.slice(-limit);
}

// ── getSupportedSignals ───────────────────────────────────────────────

function getSupportedSignals() { return [...SUPPORTED_SIGNALS]; }

// ── getIngestStats ────────────────────────────────────────────────────

function getIngestStats() {
    return {
        totalIngested:   _ingestCount,
        totalErrors:     _errorCount,
        activeSignals:   _signals.size,
        signalTypes:     [..._signals.keys()],
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _signals     = new Map();
    _history     = new Map();
    _ingestCount = 0;
    _errorCount  = 0;
}

module.exports = {
    SUPPORTED_SIGNALS,
    ingest, ingestBatch, getSignal, getSignalHistory,
    getSupportedSignals, getIngestStats, reset,
};
