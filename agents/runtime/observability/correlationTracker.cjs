"use strict";
/**
 * correlationTracker — correlation ID management linking workflows, retries,
 * recoveries, telemetry signals, and escalations.
 *
 * createCorrelation(type, metadata)            → CorrelationRecord
 * linkEvent(correlationId, eventId, role)      → LinkResult
 * linkTelemetry(correlationId, telemetryRef)   → LinkResult
 * linkEscalation(correlationId, escalRef)      → LinkResult
 * getCorrelation(correlationId)                → CorrelationRecord | null
 * findRelated(correlationId)                   → RelatedEntities
 * traceLineage(correlationId)                  → LineageTree
 * getCorrelationStats()                        → Stats
 * reset()
 */

const CORRELATION_TYPES = [
    "workflow", "retry_chain", "recovery", "telemetry_session",
    "escalation", "incident", "pacing",
];

let _correlations = new Map();
let _counter      = 0;

// ── createCorrelation ─────────────────────────────────────────────────

function createCorrelation(type, metadata = {}) {
    const correlationId = metadata.correlationId ?? `corr-${++_counter}`;
    const parentId      = metadata.parentCorrelationId ?? null;

    const record = {
        correlationId,
        type,
        parentId,
        events:      [],   // { eventId, role }
        telemetry:   [],   // telemetry references
        escalations: [],   // escalation references
        metadata:    { ...metadata },
        createdAt:   new Date().toISOString(),
    };
    _correlations.set(correlationId, record);
    return record;
}

// ── linkEvent ─────────────────────────────────────────────────────────

function linkEvent(correlationId, eventId, role = "related") {
    const rec = _correlations.get(correlationId);
    if (!rec) return { linked: false, reason: "correlation_not_found" };
    rec.events.push({ eventId, role, linkedAt: new Date().toISOString() });
    return { linked: true, correlationId, eventId, role };
}

// ── linkTelemetry ─────────────────────────────────────────────────────

function linkTelemetry(correlationId, telemetryRef = {}) {
    const rec = _correlations.get(correlationId);
    if (!rec) return { linked: false, reason: "correlation_not_found" };
    rec.telemetry.push({ ...telemetryRef, linkedAt: new Date().toISOString() });
    return { linked: true, correlationId };
}

// ── linkEscalation ────────────────────────────────────────────────────

function linkEscalation(correlationId, escalRef = {}) {
    const rec = _correlations.get(correlationId);
    if (!rec) return { linked: false, reason: "correlation_not_found" };
    rec.escalations.push({ ...escalRef, linkedAt: new Date().toISOString() });
    return { linked: true, correlationId };
}

// ── getCorrelation ────────────────────────────────────────────────────

function getCorrelation(correlationId) {
    return _correlations.get(correlationId) ?? null;
}

// ── findRelated ───────────────────────────────────────────────────────

function findRelated(correlationId) {
    const root = _correlations.get(correlationId);
    if (!root) return { found: false, correlationId };

    // Find all correlations that share parentId with this one, or are children
    const children = [..._correlations.values()].filter(
        c => c.parentId === correlationId
    );
    const siblings  = root.parentId
        ? [..._correlations.values()].filter(
            c => c.parentId === root.parentId && c.correlationId !== correlationId
          )
        : [];

    return {
        found:        true,
        correlationId,
        type:         root.type,
        eventCount:   root.events.length,
        telemetryCount: root.telemetry.length,
        escalationCount: root.escalations.length,
        children:     children.map(c => ({ correlationId: c.correlationId, type: c.type })),
        siblings:     siblings.map(c => ({ correlationId: c.correlationId, type: c.type })),
    };
}

// ── traceLineage ──────────────────────────────────────────────────────

function traceLineage(correlationId) {
    const visited = new Set();
    const nodes   = [];

    function walk(id, depth) {
        if (visited.has(id) || depth > 20) return;
        visited.add(id);
        const rec = _correlations.get(id);
        if (!rec) return;
        nodes.push({ correlationId: id, type: rec.type, depth, parentId: rec.parentId });
        // Walk children
        for (const child of _correlations.values()) {
            if (child.parentId === id) walk(child.correlationId, depth + 1);
        }
    }

    // Find root of lineage
    let rootId = correlationId;
    const seen = new Set();
    while (true) {
        const rec = _correlations.get(rootId);
        if (!rec || !rec.parentId || seen.has(rootId)) break;
        seen.add(rootId);
        rootId = rec.parentId;
    }

    walk(rootId, 0);
    return {
        correlationId,
        rootId,
        nodes,
        depth: Math.max(...nodes.map(n => n.depth), 0),
        size:  nodes.length,
    };
}

// ── getCorrelationStats ───────────────────────────────────────────────

function getCorrelationStats() {
    const all = [..._correlations.values()];
    const byType = {};
    for (const c of all) byType[c.type] = (byType[c.type] ?? 0) + 1;
    return {
        total:          all.length,
        byType,
        totalEvents:    all.reduce((s, c) => s + c.events.length, 0),
        totalTelemetry: all.reduce((s, c) => s + c.telemetry.length, 0),
        totalEscalations: all.reduce((s, c) => s + c.escalations.length, 0),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _correlations = new Map();
    _counter      = 0;
}

module.exports = {
    CORRELATION_TYPES,
    createCorrelation, linkEvent, linkTelemetry, linkEscalation,
    getCorrelation, findRelated, traceLineage,
    getCorrelationStats, reset,
};
