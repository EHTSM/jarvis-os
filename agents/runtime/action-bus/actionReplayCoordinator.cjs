"use strict";
/**
 * actionReplayCoordinator — idempotent action replay, replay safety validation,
 * and replay attempt tracking.
 *
 * recordActionForReplay(spec)       → { recorded, replayRecordId, actionId }
 * replayAction(spec)                → { replayed, replayActionId, originalActionId, envelope }
 * validateReplayIdempotency(spec)   → { safeToReplay, idempotent, previousAttempts }
 * getReplayHistory(actionId)        → ReplayAttempt[]
 * getReplayMetrics()                → ReplayMetrics
 * reset()
 *
 * Idempotency rules:
 *   idempotent=true  → always safe to replay (any number of times)
 *   idempotent=false → safe only if previousAttempts === 0
 */

let _records  = new Map();   // actionId → ReplayRecord (original envelope + flags)
let _attempts = new Map();   // actionId → ReplayAttempt[]
let _counter  = 0;

// ── recordActionForReplay ─────────────────────────────────────────────

function recordActionForReplay(spec = {}) {
    const {
        actionId    = null,
        actionType  = null,
        workflowId  = null,
        idempotent  = false,
        replayable  = true,
        payload     = {},
        envelope    = null,
    } = spec;

    if (!actionId)   return { recorded: false, reason: "actionId_required" };
    if (!actionType) return { recorded: false, reason: "actionType_required" };
    if (_records.has(actionId))
        return { recorded: false, reason: "already_recorded_for_replay", actionId };

    const replayRecordId = `replay-rec-${++_counter}`;
    _records.set(actionId, {
        replayRecordId, actionId, actionType, workflowId, idempotent, replayable,
        payload, envelope, recordedAt: new Date().toISOString(),
    });
    _attempts.set(actionId, []);

    return { recorded: true, replayRecordId, actionId, idempotent, replayable };
}

// ── replayAction ──────────────────────────────────────────────────────

function replayAction(spec = {}) {
    const { actionId = null, replayReason = "manual_replay" } = spec;
    if (!actionId) return { replayed: false, reason: "actionId_required" };

    const record = _records.get(actionId);
    if (!record) return { replayed: false, reason: "action_not_recorded_for_replay", actionId };
    if (!record.replayable) return { replayed: false, reason: "action_not_replayable", actionId };

    const safety = validateReplayIdempotency({ actionId });
    if (!safety.safeToReplay)
        return { replayed: false, reason: "replay_not_idempotent_safe", actionId, previousAttempts: safety.previousAttempts };

    const replayActionId = `action-replay-${++_counter}`;
    const attempt = { replayActionId, actionId, replayReason, replayedAt: new Date().toISOString() };
    _attempts.get(actionId).push(attempt);

    const envelope = record.envelope
        ? { ...record.envelope, actionId: replayActionId, replayId: actionId, lifecycleState: "queued", timestamp: new Date().toISOString() }
        : {
            actionId: replayActionId, replayId: actionId,
            workflowId: record.workflowId, actionType: record.actionType,
            lifecycleState: "queued", payload: record.payload,
            timestamp: new Date().toISOString(),
          };

    return { replayed: true, replayActionId, originalActionId: actionId, replayReason, envelope };
}

// ── validateReplayIdempotency ─────────────────────────────────────────

function validateReplayIdempotency(spec = {}) {
    const { actionId = null } = spec;
    if (!actionId) return { safeToReplay: false, reason: "actionId_required" };

    const record = _records.get(actionId);
    if (!record) return { safeToReplay: false, reason: "action_not_recorded", actionId };

    const previousAttempts = (_attempts.get(actionId) ?? []).length;
    const idempotent       = record.idempotent;
    const safeToReplay     = idempotent || previousAttempts === 0;

    return { safeToReplay, idempotent, previousAttempts, actionId, replayable: record.replayable };
}

// ── getReplayHistory ──────────────────────────────────────────────────

function getReplayHistory(actionId) {
    if (!actionId) return [];
    return _attempts.get(actionId) ?? [];
}

// ── getReplayMetrics ──────────────────────────────────────────────────

function getReplayMetrics() {
    const allAttempts   = [..._attempts.values()].flat();
    const idempotentRec = [..._records.values()].filter(r => r.idempotent).length;
    return {
        totalRecorded:    _records.size,
        totalReplayed:    allAttempts.length,
        idempotentCount:  idempotentRec,
        uniqueReplayed:   new Set(allAttempts.map(a => a.actionId)).size,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _records  = new Map();
    _attempts = new Map();
    _counter  = 0;
}

module.exports = {
    recordActionForReplay, replayAction, validateReplayIdempotency,
    getReplayHistory, getReplayMetrics, reset,
};
