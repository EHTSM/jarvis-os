"use strict";
/**
 * executionTimeline — per-session execution timeline recording with causality tracking
 * and anomaly annotations.
 *
 * startTimeline(sessionId, opts)               → Timeline
 * recordEvent(sessionId, event)                → RecordResult
 * closeTimeline(sessionId, outcome)            → ClosedTimeline
 * getTimeline(sessionId)                       → Timeline | null
 * buildCausalityChain(rootEventId, events)     → CausalityChain
 * annotateAnomaly(sessionId, annotation)       → void
 * getTimelineStats(sessionId)                  → TimelineStats
 * listTimelines()                              → TimelineSummary[]
 * reset()
 */

let _timelines = new Map();   // sessionId → Timeline

// ── startTimeline ─────────────────────────────────────────────────────

function startTimeline(sessionId, opts = {}) {
    if (_timelines.has(sessionId)) {
        return { started: false, reason: "session_already_exists", sessionId };
    }

    const timeline = {
        sessionId,
        status:     "open",
        startedAt:  opts.ts ?? new Date().toISOString(),
        closedAt:   null,
        outcome:    null,
        events:     [],
        anomalies:  [],
        metadata:   { ...opts.metadata },
        durationMs: null,
    };
    _timelines.set(sessionId, timeline);
    return { started: true, sessionId, timeline };
}

// ── recordEvent ───────────────────────────────────────────────────────

function recordEvent(sessionId, event = {}) {
    const tl = _timelines.get(sessionId);
    if (!tl) return { recorded: false, reason: "session_not_found" };
    if (tl.status === "closed") return { recorded: false, reason: "timeline_closed" };

    const entry = {
        eventId:       event.eventId ?? null,
        type:          event.type    ?? "unknown",
        seqNum:        event.seqNum  ?? tl.events.length,
        ts:            event.ts      ?? new Date().toISOString(),
        parentEventId: event.parentEventId ?? null,
        payload:       event.payload ?? {},
        annotations:   event.annotations ?? [],
    };
    tl.events.push(entry);
    return { recorded: true, sessionId, eventIndex: tl.events.length - 1 };
}

// ── closeTimeline ─────────────────────────────────────────────────────

function closeTimeline(sessionId, outcome = "completed") {
    const tl = _timelines.get(sessionId);
    if (!tl) return { closed: false, reason: "session_not_found" };
    if (tl.status === "closed") return { closed: false, reason: "already_closed" };

    tl.status   = "closed";
    tl.closedAt = new Date().toISOString();
    tl.outcome  = outcome;
    tl.durationMs = new Date(tl.closedAt).getTime() - new Date(tl.startedAt).getTime();

    return {
        closed:     true,
        sessionId,
        outcome,
        durationMs: tl.durationMs,
        eventCount: tl.events.length,
    };
}

// ── getTimeline ───────────────────────────────────────────────────────

function getTimeline(sessionId) {
    return _timelines.get(sessionId) ?? null;
}

// ── buildCausalityChain ───────────────────────────────────────────────

function buildCausalityChain(rootEventId, events = []) {
    if (!rootEventId || events.length === 0) {
        return { rootEventId, chain: [], depth: 0, found: false };
    }

    const byId   = new Map(events.map(e => [e.eventId, e]));
    const root   = byId.get(rootEventId);
    if (!root) return { rootEventId, chain: [], depth: 0, found: false };

    // Walk forward: find all events whose parentEventId chains back to root
    const chain  = [root];
    const visited = new Set([rootEventId]);

    let changed = true;
    while (changed) {
        changed = false;
        for (const e of events) {
            if (!visited.has(e.eventId) && visited.has(e.parentEventId)) {
                chain.push(e);
                visited.add(e.eventId);
                changed = true;
            }
        }
    }

    // Sort by seqNum
    chain.sort((a, b) => (a.seqNum ?? 0) - (b.seqNum ?? 0));

    return {
        rootEventId,
        found:   true,
        chain:   chain.map(e => ({ eventId: e.eventId, type: e.type, seqNum: e.seqNum })),
        depth:   chain.length,
        types:   [...new Set(chain.map(e => e.type))],
    };
}

// ── annotateAnomaly ───────────────────────────────────────────────────

function annotateAnomaly(sessionId, annotation = {}) {
    const tl = _timelines.get(sessionId);
    if (!tl) return { annotated: false, reason: "session_not_found" };
    tl.anomalies.push({ ...annotation, annotatedAt: new Date().toISOString() });
    return { annotated: true, sessionId };
}

// ── getTimelineStats ──────────────────────────────────────────────────

function getTimelineStats(sessionId) {
    const tl = _timelines.get(sessionId);
    if (!tl) return null;

    const typeCounts = {};
    for (const e of tl.events) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;

    return {
        sessionId,
        status:      tl.status,
        eventCount:  tl.events.length,
        anomalyCount: tl.anomalies.length,
        durationMs:  tl.durationMs,
        outcome:     tl.outcome,
        typeCounts,
        hasFailure:  typeCounts.execution_failed > 0 || false,
        hasRetry:    typeCounts.retry_triggered  > 0 || false,
        hasRollback: typeCounts.rollback_triggered > 0 || false,
    };
}

// ── listTimelines ─────────────────────────────────────────────────────

function listTimelines() {
    return [..._timelines.values()].map(tl => ({
        sessionId:  tl.sessionId,
        status:     tl.status,
        outcome:    tl.outcome,
        eventCount: tl.events.length,
        startedAt:  tl.startedAt,
    }));
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() { _timelines = new Map(); }

module.exports = {
    startTimeline, recordEvent, closeTimeline, getTimeline,
    buildCausalityChain, annotateAnomaly, getTimelineStats, listTimelines, reset,
};
