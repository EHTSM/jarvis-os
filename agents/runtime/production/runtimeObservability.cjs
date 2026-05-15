"use strict";
/**
 * runtimeObservability — structured traces, spans, histograms, and anomaly visibility.
 *
 * startSpan(name, opts)                  → Span
 * endSpan(spanId, opts)                  → SpanResult
 * logEvent(correlationId, event, payload)→ LogEntry
 * recordHistogram(metric, value)         → void
 * getHistogram(metric)                   → HistogramSummary
 * getTrace(correlationId)                → Trace | null
 * getAnomalies(opts)                     → Anomaly[]
 * reset()
 */

let _spans      = new Map();   // spanId → Span
let _logs       = [];          // LogEntry[]
let _histograms = new Map();   // metric → number[]
let _traces     = new Map();   // correlationId → { spanIds[], logIds[] }
let _anomalies  = [];
let _logCounter = 0;

const HISTOGRAM_MAX    = 200;
const DEFAULT_SLOW_MS  = 5000;

// ── internal ──────────────────────────────────────────────────────────

function _ensureTrace(correlationId) {
    if (!_traces.has(correlationId)) _traces.set(correlationId, { spanIds: [], logIds: [] });
}

function _genId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── startSpan ─────────────────────────────────────────────────────────

function startSpan(name, opts = {}) {
    if (!name) throw new Error("span name is required");
    const spanId        = opts.spanId        ?? _genId("span");
    const correlationId = opts.correlationId ?? spanId;

    const span = {
        spanId,
        correlationId,
        name,
        startedAt:    Date.now(),
        parentSpanId: opts.parentSpanId ?? null,
        tags:         opts.tags ?? {},
        status:       "running",
        durationMs:   null,
        error:        null,
    };
    _spans.set(spanId, span);
    _ensureTrace(correlationId);
    _traces.get(correlationId).spanIds.push(spanId);
    return span;
}

// ── endSpan ───────────────────────────────────────────────────────────

function endSpan(spanId, opts = {}) {
    const span = _spans.get(spanId);
    if (!span)                        return { ended: false, reason: "span_not_found" };
    if (span.status !== "running")    return { ended: false, reason: "span_already_ended" };

    span.endedAt   = Date.now();
    span.durationMs = span.endedAt - span.startedAt;
    span.status    = opts.error ? "error" : "ok";
    span.error     = opts.error ?? null;

    recordHistogram(`span.${span.name}.durationMs`, span.durationMs);

    const slowThreshold = opts.slowThresholdMs ?? DEFAULT_SLOW_MS;
    if (span.durationMs > slowThreshold) {
        _anomalies.push({
            type:       "slow_span",
            spanId,
            name:       span.name,
            durationMs: span.durationMs,
            threshold:  slowThreshold,
            ts:         new Date().toISOString(),
        });
    }
    if (opts.error) {
        _anomalies.push({
            type:  "span_error",
            spanId,
            name:  span.name,
            error: String(opts.error),
            ts:    new Date().toISOString(),
        });
    }

    return { ended: true, span };
}

// ── logEvent ──────────────────────────────────────────────────────────

function logEvent(correlationId, event, payload = {}) {
    const logId = `log-${++_logCounter}`;
    const entry = {
        logId,
        correlationId,
        event,
        payload,
        ts: new Date().toISOString(),
    };
    _logs.push(entry);
    _ensureTrace(correlationId);
    _traces.get(correlationId).logIds.push(logId);
    return entry;
}

// ── recordHistogram ───────────────────────────────────────────────────

function recordHistogram(metric, value) {
    if (!_histograms.has(metric)) _histograms.set(metric, []);
    const arr = _histograms.get(metric);
    arr.push(value);
    if (arr.length > HISTOGRAM_MAX) arr.shift();
}

// ── getHistogram ──────────────────────────────────────────────────────

function getHistogram(metric) {
    const values = _histograms.get(metric) ?? [];
    if (values.length === 0) {
        return { metric, count: 0, min: null, max: null, avg: null, p50: null, p95: null };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const n      = sorted.length;
    const sum    = sorted.reduce((s, v) => s + v, 0);
    return {
        metric,
        count: n,
        min:   sorted[0],
        max:   sorted[n - 1],
        avg:   +(sum / n).toFixed(2),
        p50:   sorted[Math.floor(n * 0.50)],
        p95:   sorted[Math.max(0, Math.floor(n * 0.95))],
    };
}

// ── getTrace ──────────────────────────────────────────────────────────

function getTrace(correlationId) {
    const trace = _traces.get(correlationId);
    if (!trace) return null;
    return {
        correlationId,
        spans: trace.spanIds.map(id => _spans.get(id)).filter(Boolean),
        logs:  _logs.filter(l => l.correlationId === correlationId),
    };
}

// ── getAnomalies ──────────────────────────────────────────────────────

function getAnomalies(opts = {}) {
    if (opts.type) return _anomalies.filter(a => a.type === opts.type);
    return [..._anomalies];
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _spans      = new Map();
    _logs       = [];
    _histograms = new Map();
    _traces     = new Map();
    _anomalies  = [];
    _logCounter = 0;
}

module.exports = {
    HISTOGRAM_MAX, DEFAULT_SLOW_MS,
    startSpan, endSpan, logEvent, recordHistogram,
    getHistogram, getTrace, getAnomalies, reset,
};
