"use strict";
/**
 * concurrencyReplayValidator — deterministic replay validation under concurrency,
 * concurrent scheduling replay analysis, replay drift detection, parallel execution
 * consistency, and replay-safe concurrency verification.
 *
 * validateConcurrentReplay(spec)        → { valid, executionId, mismatches }
 * detectReplayDrift(spec)               → { driftDetected, divergences }
 * compareExecutionTimelines(idA, idB)   → { compared, identical }
 * validateDeterministicOrdering(spec)   → { deterministic, violations }
 * getReplayConsistencyMetrics()         → ConsistencyMetrics
 * reset()
 *
 * Detects: non-deterministic scheduling, race-condition drift,
 *          replay divergence, inconsistent ordering, unstable concurrency.
 */

let _timelines    = new Map();   // executionId → { executionId, events[], recordedAt }
let _driftReports = [];
let _counter      = 0;

// ── _validateSequence ─────────────────────────────────────────────────

function _validateSequence(events) {
    const withSeq = events.filter(e => e.sequenceNumber != null);
    for (let i = 0; i < withSeq.length; i++) {
        if (withSeq[i].sequenceNumber !== i + 1) return false;
    }
    return true;
}

function _eventType(e) {
    return typeof e === "string" ? e : (e.type ?? null);
}

// ── validateConcurrentReplay ──────────────────────────────────────────

function validateConcurrentReplay(spec = {}) {
    const { executionId = null, events = [], expectedOrder = null } = spec;
    if (!executionId) return { valid: false, reason: "executionId_required" };

    _timelines.set(executionId, {
        executionId,
        events:     [...events],
        recordedAt: new Date().toISOString(),
    });

    const seqValid = _validateSequence(events);

    if (expectedOrder == null) {
        return { valid: seqValid, executionId, eventCount: events.length, sequenceValid: seqValid };
    }

    if (expectedOrder.length !== events.length) {
        return {
            valid:      false,
            executionId,
            reason:     "event_count_mismatch",
            expected:   expectedOrder.length,
            actual:     events.length,
        };
    }

    const mismatches = [];
    for (let i = 0; i < expectedOrder.length; i++) {
        if (expectedOrder[i] !== _eventType(events[i]))
            mismatches.push({ index: i, expected: expectedOrder[i], actual: _eventType(events[i]) });
    }

    return {
        valid:         mismatches.length === 0,
        executionId,
        eventCount:    events.length,
        mismatches,
        sequenceValid: seqValid,
    };
}

// ── detectReplayDrift ─────────────────────────────────────────────────

function detectReplayDrift(spec = {}) {
    const { baselineId = null, comparedId = null } = spec;
    if (!baselineId || !comparedId)
        return { driftDetected: false, reason: "both_ids_required" };

    const baseline = _timelines.get(baselineId);
    const compared = _timelines.get(comparedId);
    if (!baseline) return { driftDetected: false, reason: "baseline_not_found" };
    if (!compared) return { driftDetected: false, reason: "compared_not_found" };

    const driftId   = `drift-${++_counter}`;
    const baseEvts  = baseline.events;
    const compEvts  = compared.events;

    if (baseEvts.length !== compEvts.length) {
        const report = {
            driftId,
            driftDetected: true,
            reason:        "event_count_mismatch",
            baseline:      baseEvts.length,
            compared:      compEvts.length,
            divergences:   [],
            divergenceCount: 0,
        };
        _driftReports.push(report);
        return report;
    }

    const divergences = [];
    for (let i = 0; i < baseEvts.length; i++) {
        const bType = _eventType(baseEvts[i]);
        const cType = _eventType(compEvts[i]);
        if (bType !== cType) divergences.push({ index: i, baseline: bType, compared: cType });
    }

    const report = {
        driftId,
        driftDetected:  divergences.length > 0,
        divergences,
        divergenceCount: divergences.length,
    };
    _driftReports.push(report);
    return report;
}

// ── compareExecutionTimelines ─────────────────────────────────────────

function compareExecutionTimelines(idA, idB) {
    const tlA = _timelines.get(idA);
    const tlB = _timelines.get(idB);
    if (!tlA) return { compared: false, reason: `timeline_not_found: ${idA}` };
    if (!tlB) return { compared: false, reason: `timeline_not_found: ${idB}` };

    const lenA      = tlA.events.length;
    const lenB      = tlB.events.length;
    const identical = lenA === lenB && tlA.events.every((e, i) =>
        _eventType(e) === _eventType(tlB.events[i])
    );

    return { compared: true, identical, lengthA: lenA, lengthB: lenB, lengthMatch: lenA === lenB };
}

// ── validateDeterministicOrdering ────────────────────────────────────

function validateDeterministicOrdering(spec = {}) {
    const { events = [] } = spec;

    const byExec = {};
    for (const e of events) {
        const eid = e.executionId ?? "unknown";
        if (!byExec[eid]) byExec[eid] = [];
        byExec[eid].push(e);
    }

    const violations = [];
    for (const [eid, evts] of Object.entries(byExec)) {
        for (let i = 1; i < evts.length; i++) {
            const prev = evts[i - 1].globalSequence ?? evts[i - 1].sequenceNumber ?? 0;
            const curr = evts[i].globalSequence     ?? evts[i].sequenceNumber     ?? 0;
            if (curr < prev)
                violations.push({ executionId: eid, index: i, prev, curr });
        }
    }

    return {
        deterministic:  violations.length === 0,
        executionCount: Object.keys(byExec).length,
        totalEvents:    events.length,
        violations,
    };
}

// ── getReplayConsistencyMetrics ───────────────────────────────────────

function getReplayConsistencyMetrics() {
    const total   = _driftReports.length;
    const drifted = _driftReports.filter(r => r.driftDetected).length;
    return {
        totalTimelines:     _timelines.size,
        totalDriftChecks:   total,
        driftDetectedCount: drifted,
        consistencyRate:    total > 0 ? +((total - drifted) / total).toFixed(3) : 1,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _timelines    = new Map();
    _driftReports = [];
    _counter      = 0;
}

module.exports = {
    validateConcurrentReplay, detectReplayDrift,
    compareExecutionTimelines, validateDeterministicOrdering,
    getReplayConsistencyMetrics, reset,
};
