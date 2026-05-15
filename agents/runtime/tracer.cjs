"use strict";
/**
 * tracer — lightweight span-based execution tracing.
 *
 * Concepts:
 *   Trace  — one workflow execution, identified by traceId
 *   Span   — one named unit of work (step, recovery attempt) within a trace
 *   Lineage — ancestor chain of a span via parentSpanId links
 *   Recovery chain — all spans whose name starts with "recovery:"
 *
 * Usage:
 *   const traceId = tracer.createTrace(workflowId);
 *   const spanId  = tracer.startSpan(traceId, "step:foo");
 *   tracer.addSpanEvent(traceId, spanId, "attempt", { n: 1 });
 *   tracer.finishSpan(traceId, spanId, "ok");
 *
 * No external dependencies. All state is in-memory.
 * Call reset() between tests to clear all traces.
 */

const { randomBytes } = require("crypto");

// ── Storage ───────────────────────────────────────────────────────────

const _traces = new Map();  // traceId → { traceId, workflowId, parentTraceId, startedAt, spans: Map }

// ── ID generation ─────────────────────────────────────────────────────

function _id(bytes) { return randomBytes(bytes).toString("hex"); }

// ── Trace management ──────────────────────────────────────────────────

/**
 * Create a new trace for a workflow execution.
 *
 * @param {string}  workflowId
 * @param {string?} parentTraceId  — set when this workflow was spawned by another
 * @returns {string} traceId
 */
function createTrace(workflowId, parentTraceId = null) {
    const traceId = _id(16);
    _traces.set(traceId, {
        traceId,
        workflowId,
        parentTraceId: parentTraceId || null,
        startedAt: Date.now(),
        spans: new Map(),
    });
    return traceId;
}

// ── Span management ───────────────────────────────────────────────────

/**
 * Open a new span inside a trace.
 *
 * @param {string}  traceId
 * @param {string}  name         — e.g. "step:build", "recovery:syntax-add-brace"
 * @param {string?} parentSpanId — links to the enclosing step span
 * @param {object?} metadata
 * @returns {string} spanId
 */
function startSpan(traceId, name, parentSpanId = null, metadata = {}) {
    const trace = _traces.get(traceId);
    if (!trace) throw new Error(`tracer: unknown traceId "${traceId}"`);

    const spanId = _id(8);
    trace.spans.set(spanId, {
        spanId,
        traceId,
        parentSpanId: parentSpanId || null,
        name,
        startedAt:  Date.now(),
        finishedAt: null,
        durationMs: null,
        status:     "running",
        metadata:   { ...metadata },
        events:     [],
    });
    return spanId;
}

/**
 * Append a lightweight event to a span (e.g. retry-n, recovery-triggered).
 */
function addSpanEvent(traceId, spanId, event, data = {}) {
    const span = _traces.get(traceId)?.spans.get(spanId);
    if (span) span.events.push({ timestamp: Date.now(), event, ...data });
}

/**
 * Close a span.
 *
 * @param {string}  traceId
 * @param {string}  spanId
 * @param {string}  status    — "ok" | "error" | "skipped" | "recovered"
 * @param {object?} metadata  — merged into span.metadata
 */
function finishSpan(traceId, spanId, status = "ok", metadata = {}) {
    const span = _traces.get(traceId)?.spans.get(spanId);
    if (!span) return;
    span.finishedAt = Date.now();
    span.durationMs = span.finishedAt - span.startedAt;
    span.status     = status;
    Object.assign(span.metadata, metadata);
}

// ── Queries ───────────────────────────────────────────────────────────

/**
 * Return a serializable trace object with spans as an array.
 */
function getTrace(traceId) {
    const trace = _traces.get(traceId);
    if (!trace) return null;
    return {
        traceId:       trace.traceId,
        workflowId:    trace.workflowId,
        parentTraceId: trace.parentTraceId,
        startedAt:     trace.startedAt,
        spans:         [...trace.spans.values()],
    };
}

/**
 * Ancestor chain for a span — root span is first, queried span is last.
 */
function buildLineage(traceId, spanId) {
    const trace = _traces.get(traceId);
    if (!trace) return [];

    const chain = [];
    let cur = trace.spans.get(spanId);
    while (cur) {
        chain.unshift({
            spanId:    cur.spanId,
            name:      cur.name,
            status:    cur.status,
            durationMs: cur.durationMs,
        });
        cur = cur.parentSpanId ? trace.spans.get(cur.parentSpanId) : null;
    }
    return chain;
}

/**
 * All recovery spans in a trace, in chronological order.
 * Recovery spans have names prefixed with "recovery:".
 */
function recoveryChain(traceId) {
    const trace = _traces.get(traceId);
    if (!trace) return [];

    return [...trace.spans.values()]
        .filter(s => s.name.startsWith("recovery:"))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map(s => ({
            spanId:     s.spanId,
            name:       s.name,
            strategyId: s.metadata.strategyId || null,
            stepName:   s.metadata.stepName   || null,
            status:     s.status,
            durationMs: s.durationMs,
        }));
}

/**
 * All active trace IDs (useful for debugging and test verification).
 */
function allTraces() { return [..._traces.keys()]; }

// ── Housekeeping ──────────────────────────────────────────────────────

function reset() { _traces.clear(); }

module.exports = {
    createTrace,
    startSpan,
    addSpanEvent,
    finishSpan,
    getTrace,
    buildLineage,
    recoveryChain,
    allTraces,
    reset,
};
