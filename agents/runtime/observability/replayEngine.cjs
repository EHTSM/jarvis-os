"use strict";
/**
 * replayEngine — deterministic execution replay from stored event sequences.
 *
 * createReplaySession(events, opts)            → ReplaySession
 * replayNext(sessionId)                        → ReplayStepResult
 * replayAll(sessionId)                         → ReplayResult
 * replayIncident(incidentEvents, opts)         → IncidentReplay
 * scoreReplay(original, replayed)              → ReplayScore
 * getReplaySession(sessionId)                  → ReplaySession | null
 * getReplayStats()                             → Stats
 * reset()
 */

let _sessions = new Map();
let _counter  = 0;

// ── createReplaySession ───────────────────────────────────────────────

function createReplaySession(events = [], opts = {}) {
    const sessionId = opts.sessionId ?? `rpl-${++_counter}`;

    // Sort deterministically by seqNum, then ts, then eventId for stability
    const ordered = [...events].sort((a, b) => {
        const sd = (a.seqNum ?? 0) - (b.seqNum ?? 0);
        if (sd !== 0) return sd;
        const td = new Date(a.ts ?? 0).getTime() - new Date(b.ts ?? 0).getTime();
        if (td !== 0) return td;
        return (a.eventId ?? "").localeCompare(b.eventId ?? "");
    });

    const session = {
        sessionId,
        events:      ordered,
        cursor:      0,
        totalEvents: ordered.length,
        replayed:    [],
        status:      "ready",
        createdAt:   new Date().toISOString(),
        opts:        { ...opts },
    };
    _sessions.set(sessionId, session);
    return { sessionId, totalEvents: ordered.length, status: "ready" };
}

// ── replayNext ────────────────────────────────────────────────────────

function replayNext(sessionId) {
    const session = _sessions.get(sessionId);
    if (!session)                         return { replayed: false, reason: "session_not_found" };
    if (session.status === "completed")   return { replayed: false, reason: "already_completed", completed: true };
    if (session.cursor >= session.totalEvents) {
        session.status = "completed";
        return { replayed: false, reason: "no_more_events", completed: true };
    }

    const event = session.events[session.cursor];
    session.replayed.push(event);
    session.cursor++;
    session.status = session.cursor >= session.totalEvents ? "completed" : "in_progress";

    return {
        replayed:   true,
        sessionId,
        event,
        cursor:     session.cursor,
        remaining:  session.totalEvents - session.cursor,
        completed:  session.status === "completed",
    };
}

// ── replayAll ─────────────────────────────────────────────────────────

function replayAll(sessionId) {
    const session = _sessions.get(sessionId);
    if (!session) return { replayed: false, reason: "session_not_found" };

    // Reset cursor if already completed for idempotent replay
    session.cursor   = 0;
    session.replayed = [];
    session.status   = "in_progress";

    while (session.cursor < session.totalEvents) {
        replayNext(sessionId);
    }

    const replayedTypes = session.replayed.map(e => e.type);
    const typeCounts    = {};
    for (const t of replayedTypes) typeCounts[t] = (typeCounts[t] ?? 0) + 1;

    return {
        replayed:      true,
        sessionId,
        totalReplayed: session.replayed.length,
        typeCounts,
        status:        "completed",
    };
}

// ── replayIncident ────────────────────────────────────────────────────

function replayIncident(incidentEvents = [], opts = {}) {
    if (incidentEvents.length === 0) return { replayed: false, reason: "no_events" };

    const incidentId = opts.incidentId ?? `inc-replay-${++_counter}`;

    // Filter to failure-related events and their causal chain
    const FAILURE_TYPES = new Set([
        "execution_failed", "retry_triggered", "rollback_triggered",
        "stabilization_activated", "escalation_triggered",
    ]);

    const failureEvents  = incidentEvents.filter(e => FAILURE_TYPES.has(e.type));
    const firstFailure   = failureEvents[0] ?? null;

    // Step-by-step: group events by phase
    const phases = [
        { phase: "pre_failure",  events: incidentEvents.filter(e => e.type === "execution_started") },
        { phase: "failure",      events: incidentEvents.filter(e => e.type === "execution_failed")   },
        { phase: "recovery",     events: incidentEvents.filter(e =>
            e.type === "retry_triggered" || e.type === "rollback_triggered" )},
        { phase: "stabilization",events: incidentEvents.filter(e =>
            e.type === "stabilization_activated" || e.type === "escalation_triggered") },
        { phase: "resolution",   events: incidentEvents.filter(e => e.type === "execution_completed") },
    ].filter(p => p.events.length > 0);

    return {
        replayed:      true,
        incidentId,
        totalEvents:   incidentEvents.length,
        failureCount:  failureEvents.length,
        phases,
        firstFailureType: firstFailure?.type ?? null,
        firstFailureTs:   firstFailure?.ts    ?? null,
        resolved:      incidentEvents.some(e => e.type === "execution_completed"),
    };
}

// ── scoreReplay ───────────────────────────────────────────────────────

function scoreReplay(original = [], replayed = []) {
    if (original.length === 0) return { score: 0, grade: "F", reason: "no_original" };
    if (replayed.length === 0) return { score: 0, grade: "F", reason: "no_replayed" };

    // Replay accuracy: fraction of original events reproduced
    const origIds    = new Set(original.map(e => e.eventId).filter(Boolean));
    const repIds     = new Set(replayed.map(e => e.eventId).filter(Boolean));
    const reproduced = [...origIds].filter(id => repIds.has(id)).length;
    const accuracy   = origIds.size > 0 ? reproduced / origIds.size : 0;

    // Sequence fidelity: are type sequences matching?
    const origTypes  = original.map(e => e.type);
    const repTypes   = replayed.map(e => e.type);
    const typeMatches = Math.min(origTypes.length, repTypes.length);
    const typeCorrect = origTypes.slice(0, typeMatches).filter((t, i) => t === repTypes[i]).length;
    const seqFidelity = typeMatches > 0 ? typeCorrect / typeMatches : 1;

    // Causality confidence: fraction of events with parentEventId that chain correctly
    const withParent = replayed.filter(e => e.parentEventId);
    const validChain = withParent.filter(e => repIds.has(e.parentEventId) || origIds.has(e.parentEventId));
    const causalConf = withParent.length > 0 ? validChain.length / withParent.length : 1;

    // Event integrity: all required fields present
    const integrityChecks = replayed.filter(e =>
        e.eventId && e.type && e.seqNum != null && e.ts
    ).length;
    const integrity = replayed.length > 0 ? integrityChecks / replayed.length : 1;

    const raw   = accuracy * 40 + seqFidelity * 30 + causalConf * 20 + integrity * 10;
    const score = +Math.min(100, raw).toFixed(1);
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return {
        score, grade,
        accuracy:         +accuracy.toFixed(3),
        seqFidelity:      +seqFidelity.toFixed(3),
        causalityConf:    +causalConf.toFixed(3),
        eventIntegrity:   +integrity.toFixed(3),
        originalCount:    original.length,
        replayedCount:    replayed.length,
    };
}

// ── getReplaySession / getReplayStats / reset ─────────────────────────

function getReplaySession(sessionId) {
    return _sessions.get(sessionId) ?? null;
}

function getReplayStats() {
    const sessions = [..._sessions.values()];
    return {
        totalSessions:   sessions.length,
        completedSessions: sessions.filter(s => s.status === "completed").length,
        totalEventsReplayed: sessions.reduce((s, r) => s + r.replayed.length, 0),
    };
}

function reset() {
    _sessions = new Map();
    _counter  = 0;
}

module.exports = {
    createReplaySession, replayNext, replayAll,
    replayIncident, scoreReplay,
    getReplaySession, getReplayStats, reset,
};
