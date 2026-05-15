"use strict";
/**
 * executionAuditLedger — immutable append-only audit trail for all
 * execution-layer events.
 *
 * appendEvent(spec)                  → { appended, eventId, sequenceNumber }
 * getEventsByWorkflow(workflowId)    → AuditEvent[]
 * getEventsByAdapter(adapterType)    → AuditEvent[]
 * getEventsByCorrelation(correlationId) → AuditEvent[]
 * getEventsByOutcome(outcome)        → AuditEvent[]
 * verifyLedgerIntegrity()            → { intact, eventCount, lastSequence }
 * getLedgerMetrics()                 → LedgerMetrics
 * reset()
 *
 * Immutability: each event is Object.frozen() before storage.
 * Sequence numbers are monotonically increasing and contiguous.
 * Events can never be updated, deleted, or reordered after appending.
 */

let _ledger   = [];   // AuditEvent[] — append-only
let _counter  = 0;
let _sequence = 0;

// ── appendEvent ───────────────────────────────────────────────────────

function appendEvent(spec = {}) {
    const {
        adapterType    = null,
        operation      = null,
        authorityLevel = null,
        principalId    = null,
        workflowId     = null,
        correlationId  = null,
        outcome        = null,
        policyDecision = null,
        riskScore      = null,
        executionId    = null,
        payload        = null,
    } = spec;

    if (!adapterType) return { appended: false, reason: "adapterType_required" };
    if (!outcome)     return { appended: false, reason: "outcome_required" };

    const eventId        = `audit-${++_counter}`;
    const sequenceNumber = ++_sequence;

    // Freeze the event — immutable once appended
    const event = Object.freeze({
        eventId,
        sequenceNumber,
        adapterType,
        operation:      operation     ?? null,
        authorityLevel: authorityLevel ?? null,
        principalId:    principalId    ?? null,
        workflowId:     workflowId     ?? null,
        correlationId:  correlationId  ?? null,
        outcome,
        policyDecision: policyDecision ?? null,
        riskScore:      riskScore      ?? null,
        executionId:    executionId    ?? null,
        payload:        payload !== null ? Object.freeze({ ...payload }) : null,
        timestamp:      new Date().toISOString(),
    });

    _ledger.push(event);

    return { appended: true, eventId, sequenceNumber, adapterType, outcome };
}

// ── getEventsByWorkflow ───────────────────────────────────────────────

function getEventsByWorkflow(workflowId) {
    if (!workflowId) return [];
    return _ledger.filter(e => e.workflowId === workflowId);
}

// ── getEventsByAdapter ────────────────────────────────────────────────

function getEventsByAdapter(adapterType) {
    if (!adapterType) return [];
    return _ledger.filter(e => e.adapterType === adapterType);
}

// ── getEventsByCorrelation ────────────────────────────────────────────

function getEventsByCorrelation(correlationId) {
    if (!correlationId) return [];
    return _ledger.filter(e => e.correlationId === correlationId);
}

// ── getEventsByOutcome ────────────────────────────────────────────────

function getEventsByOutcome(outcome) {
    if (!outcome) return [];
    return _ledger.filter(e => e.outcome === outcome);
}

// ── verifyLedgerIntegrity ─────────────────────────────────────────────

function verifyLedgerIntegrity() {
    // Verify sequence numbers are contiguous and monotonically increasing
    let intact = true;
    for (let i = 0; i < _ledger.length; i++) {
        const expected = i + 1;
        if (_ledger[i].sequenceNumber !== expected) {
            intact = false;
            break;
        }
        if (!Object.isFrozen(_ledger[i])) {
            intact = false;
            break;
        }
    }

    return {
        intact,
        eventCount:   _ledger.length,
        lastSequence: _sequence,
        contiguous:   intact,
    };
}

// ── getLedgerMetrics ──────────────────────────────────────────────────

function getLedgerMetrics() {
    const byOutcome  = {};
    const byAdapter  = {};
    const byAuthority = {};

    for (const e of _ledger) {
        byOutcome[e.outcome]     = (byOutcome[e.outcome]     ?? 0) + 1;
        byAdapter[e.adapterType] = (byAdapter[e.adapterType] ?? 0) + 1;
        if (e.authorityLevel)
            byAuthority[e.authorityLevel] = (byAuthority[e.authorityLevel] ?? 0) + 1;
    }

    const denied   = _ledger.filter(e => e.outcome === "policy_denied" || e.outcome === "denied").length;
    const riskScores = _ledger.filter(e => e.riskScore !== null).map(e => e.riskScore);
    const avgRisk  = riskScores.length > 0
        ? riskScores.reduce((s, v) => s + v, 0) / riskScores.length
        : 0;

    return {
        totalEvents:   _ledger.length,
        deniedCount:   denied,
        byOutcome,
        byAdapter,
        byAuthority,
        avgRiskScore:  Math.round(avgRisk * 1000) / 1000,
        lastSequence:  _sequence,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _ledger   = [];
    _counter  = 0;
    _sequence = 0;
}

module.exports = {
    appendEvent,
    getEventsByWorkflow, getEventsByAdapter,
    getEventsByCorrelation, getEventsByOutcome,
    verifyLedgerIntegrity, getLedgerMetrics, reset,
};
