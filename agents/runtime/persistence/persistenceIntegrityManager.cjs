"use strict";
/**
 * persistenceIntegrityManager — event stream validation, corruption detection,
 * sequence integrity validation, replay consistency checks, and snapshot integrity.
 *
 * validateEventIntegrity(events)      → IntegrityResult
 * detectCorruption(events)            → CorruptionReport
 * validateSequenceOrdering(events)    → OrderingResult
 * verifySnapshotIntegrity(snapshot)   → SnapshotIntegrityResult
 * getIntegrityMetrics()               → IntegrityMetrics
 * reset()
 *
 * Detects: missing events, duplicate sequence numbers, invalid replay order,
 * corrupted snapshots, non-deterministic recovery paths.
 */

const VALID_SNAPSHOT_STATES = [
    "created", "scheduled", "admitted", "running",
    "blocked", "recovering", "stabilized",
    "completed", "failed", "quarantined", "cancelled",
];

let _results = [];
let _counter = 0;

// ── validateEventIntegrity ────────────────────────────────────────────

function validateEventIntegrity(events = []) {
    if (!Array.isArray(events)) return { valid: false, reason: "events_must_be_array" };

    const issues   = [];
    const seenIds  = new Set();
    const seenSeqs = new Set();

    for (const e of events) {
        if (!e.eventId)   issues.push({ type: "missing_eventId",   event: e });
        if (!e.eventType) issues.push({ type: "missing_eventType", event: e });

        if (e.eventId) {
            if (seenIds.has(e.eventId))
                issues.push({ type: "duplicate_eventId", eventId: e.eventId });
            seenIds.add(e.eventId);
        }

        if (e.deterministicSequence != null) {
            if (seenSeqs.has(e.deterministicSequence))
                issues.push({ type: "duplicate_sequence", seq: e.deterministicSequence });
            seenSeqs.add(e.deterministicSequence);
        }
    }

    const result = {
        integId:    `int-${++_counter}`,
        valid:      issues.length === 0,
        eventCount: events.length,
        issues,
    };
    _results.push(result);
    return result;
}

// ── detectCorruption ──────────────────────────────────────────────────

function detectCorruption(events = []) {
    if (!Array.isArray(events)) return { corrupted: true, reason: "invalid_input" };

    const corruptions = [];
    const seenSeqs    = new Set();
    let   lastSeq     = null;

    for (const e of events) {
        if (!e.eventId || !e.eventType)
            corruptions.push({ type: "missing_required_fields", eventId: e.eventId ?? "unknown" });

        if (e.deterministicSequence != null) {
            if (seenSeqs.has(e.deterministicSequence))
                corruptions.push({ type: "duplicate_sequence", seq: e.deterministicSequence });
            seenSeqs.add(e.deterministicSequence);

            if (lastSeq != null && e.deterministicSequence < lastSeq)
                corruptions.push({ type: "sequence_regression", seq: e.deterministicSequence, lastSeq });
            lastSeq = e.deterministicSequence;
        }

        if (e.replaySafe === false)
            corruptions.push({ type: "non_replay_safe_event", eventId: e.eventId });
    }

    return {
        corrupted:       corruptions.length > 0,
        corruptionCount: corruptions.length,
        corruptions,
    };
}

// ── validateSequenceOrdering ──────────────────────────────────────────

function validateSequenceOrdering(events = []) {
    if (!Array.isArray(events)) return { ordered: false, reason: "invalid_input" };

    const withSeq = events.filter(e => e.deterministicSequence != null);
    if (withSeq.length === 0)
        return { ordered: true, gaps: [], duplicates: [], eventCount: 0 };

    const seqs = withSeq.map(e => e.deterministicSequence).sort((a, b) => a - b);
    const min  = seqs[0];
    const max  = seqs[seqs.length - 1];

    const seen       = new Set();
    const duplicates = [];
    for (const s of seqs) {
        if (seen.has(s)) duplicates.push(s);
        seen.add(s);
    }

    const gaps = [];
    for (let i = min; i <= max; i++) {
        if (!seen.has(i)) gaps.push(i);
    }

    return {
        ordered:    gaps.length === 0 && duplicates.length === 0,
        gaps,
        duplicates,
        eventCount: withSeq.length,
        minSeq:     min,
        maxSeq:     max,
    };
}

// ── verifySnapshotIntegrity ───────────────────────────────────────────

function verifySnapshotIntegrity(snapshot = {}) {
    const issues = [];
    if (!snapshot.snapshotId)    issues.push("missing_snapshotId");
    if (!snapshot.workflowId)    issues.push("missing_workflowId");
    if (!snapshot.workflowState) issues.push("missing_workflowState");
    if (!snapshot.createdAt)     issues.push("missing_createdAt");

    if (snapshot.workflowState && !VALID_SNAPSHOT_STATES.includes(snapshot.workflowState))
        issues.push(`invalid_workflowState: ${snapshot.workflowState}`);

    return {
        valid:      issues.length === 0,
        snapshotId: snapshot.snapshotId ?? null,
        issues,
    };
}

// ── getIntegrityMetrics ───────────────────────────────────────────────

function getIntegrityMetrics() {
    return {
        totalChecks:  _results.length,
        passedChecks: _results.filter(r => r.valid).length,
        failedChecks: _results.filter(r => !r.valid).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _results = [];
    _counter = 0;
}

module.exports = {
    validateEventIntegrity, detectCorruption, validateSequenceOrdering,
    verifySnapshotIntegrity, getIntegrityMetrics, reset,
};
