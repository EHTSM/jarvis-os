"use strict";
/**
 * actionEnvelopeManager — action envelope creation, normalization, validation,
 * and lifecycle state-machine enforcement.
 *
 * createEnvelope(spec)           → { created, envelope }
 * validateEnvelope(envelope)     → { valid, violations }
 * normalizeEnvelope(envelope)    → envelope (with defaults filled)
 * updateLifecycleState(spec)     → { updated, actionId, oldState, newState }
 * getEnvelopeHistory(actionId)   → StateTransition[]
 * reset()
 *
 * Lifecycle: queued → validated → authorized → scheduled → executing
 *                → completed | failed → recovered → replayed → completed
 *            quarantined is terminal from any state.
 */

const LIFECYCLE_STATES = [
    "queued", "validated", "authorized", "scheduled",
    "executing", "completed", "failed", "recovered", "replayed", "quarantined",
];

const VALID_TRANSITIONS = {
    queued:      ["validated",  "quarantined"],
    validated:   ["authorized", "quarantined"],
    authorized:  ["scheduled",  "quarantined"],
    scheduled:   ["executing",  "quarantined"],
    executing:   ["completed",  "failed",     "quarantined"],
    failed:      ["recovered",  "quarantined"],
    recovered:   ["replayed",   "quarantined"],
    replayed:    ["completed",  "quarantined"],
    completed:   [],
    quarantined: [],
};

const VALID_RISK_CLASSES  = ["safe", "guarded", "elevated", "critical", "restricted"];
const VALID_AUTH_LEVELS   = ["observer", "operator", "controller", "governor", "root-runtime"];
const REQUIRED_FIELDS     = ["actionId", "workflowId", "sourceSubsystem", "targetSubsystem", "actionType", "lifecycleState", "timestamp"];

let _envelopes    = new Map();   // actionId → envelope
let _stateHistory = new Map();   // actionId → StateTransition[]
let _counter      = 0;

// ── createEnvelope ────────────────────────────────────────────────────

function createEnvelope(spec = {}) {
    const {
        workflowId       = null,
        sourceSubsystem  = null,
        targetSubsystem  = null,
        actionType       = null,
        riskClass        = "safe",
        authorityLevel   = "observer",
        lifecycleState   = "queued",
        replayId         = null,
        correlationId    = null,
        lineageId        = null,
        payload          = {},
        metadata         = {},
    } = spec;

    if (!workflowId)      return { created: false, reason: "workflowId_required" };
    if (!sourceSubsystem) return { created: false, reason: "sourceSubsystem_required" };
    if (!targetSubsystem) return { created: false, reason: "targetSubsystem_required" };
    if (!actionType)      return { created: false, reason: "actionType_required" };

    const actionId  = spec.actionId ?? `action-${++_counter}`;
    if (_envelopes.has(actionId))
        return { created: false, reason: "actionId_already_exists", actionId };

    const envelope = {
        actionId,
        workflowId,
        sourceSubsystem,
        targetSubsystem,
        actionType,
        riskClass,
        authorityLevel,
        lifecycleState,
        timestamp:     spec.timestamp ?? new Date().toISOString(),
        replayId,
        correlationId: correlationId ?? actionId,
        lineageId,
        payload,
        metadata,
    };

    _envelopes.set(actionId, envelope);
    _stateHistory.set(actionId, [{ state: lifecycleState, reason: "created", ts: envelope.timestamp }]);

    return { created: true, actionId, envelope };
}

// ── validateEnvelope ──────────────────────────────────────────────────

function validateEnvelope(envelope = {}) {
    const violations = [];

    for (const field of REQUIRED_FIELDS) {
        if (!envelope[field]) violations.push(`missing_required_field: ${field}`);
    }

    if (envelope.lifecycleState && !LIFECYCLE_STATES.includes(envelope.lifecycleState))
        violations.push(`invalid_lifecycle_state: ${envelope.lifecycleState}`);

    if (envelope.riskClass && !VALID_RISK_CLASSES.includes(envelope.riskClass))
        violations.push(`invalid_risk_class: ${envelope.riskClass}`);

    if (envelope.authorityLevel && !VALID_AUTH_LEVELS.includes(envelope.authorityLevel))
        violations.push(`invalid_authority_level: ${envelope.authorityLevel}`);

    return { valid: violations.length === 0, violations };
}

// ── normalizeEnvelope ─────────────────────────────────────────────────

function normalizeEnvelope(envelope = {}) {
    const normalized = { ...envelope };
    if (!normalized.timestamp)     normalized.timestamp     = new Date().toISOString();
    if (!normalized.correlationId) normalized.correlationId = normalized.actionId ?? null;
    if (!normalized.lifecycleState) normalized.lifecycleState = "queued";
    if (!normalized.riskClass)     normalized.riskClass     = "safe";
    if (!normalized.authorityLevel) normalized.authorityLevel = "observer";
    if (!normalized.payload)       normalized.payload       = {};
    if (!normalized.metadata)      normalized.metadata      = {};
    if (normalized.replayId === undefined) normalized.replayId  = null;
    if (normalized.lineageId === undefined) normalized.lineageId = null;
    return normalized;
}

// ── updateLifecycleState ──────────────────────────────────────────────

function updateLifecycleState(spec = {}) {
    const { actionId = null, newState = null, reason = "transition" } = spec;
    if (!actionId) return { updated: false, reason: "actionId_required" };
    if (!newState) return { updated: false, reason: "newState_required" };
    if (!LIFECYCLE_STATES.includes(newState))
        return { updated: false, reason: `invalid_state: ${newState}` };

    const envelope = _envelopes.get(actionId);
    if (!envelope) return { updated: false, reason: "envelope_not_found" };

    const oldState   = envelope.lifecycleState;
    const allowed    = VALID_TRANSITIONS[oldState] ?? [];
    if (!allowed.includes(newState))
        return { updated: false, reason: "invalid_transition", oldState, newState, allowed };

    envelope.lifecycleState = newState;
    _stateHistory.get(actionId).push({ state: newState, reason, ts: new Date().toISOString() });

    return { updated: true, actionId, oldState, newState };
}

// ── getEnvelopeHistory ────────────────────────────────────────────────

function getEnvelopeHistory(actionId) {
    if (!actionId) return [];
    return _stateHistory.get(actionId) ?? [];
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _envelopes    = new Map();
    _stateHistory = new Map();
    _counter      = 0;
}

module.exports = {
    LIFECYCLE_STATES, VALID_TRANSITIONS,
    createEnvelope, validateEnvelope, normalizeEnvelope,
    updateLifecycleState, getEnvelopeHistory, reset,
};
