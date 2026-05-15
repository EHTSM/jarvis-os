"use strict";

// Allows operators to manually trigger recovery for failed, quarantined, or stuck executions.
// Supports retry scheduling, escalation, and recovery strategy selection.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };

const RECOVERY_STRATEGIES = new Set(["retry", "requeue", "escalate", "checkpoint_restore", "fresh_start"]);
const RECOVERY_STATES     = new Set(["pending", "triggered", "in_progress", "succeeded", "failed", "cancelled"]);
const MAX_AUDIT = 3000;
const MAX_RECORDS = 5000;

let _counter = 0;
let _records = new Map();  // recoveryId → recovery record
let _byExecution = new Map(); // executionId → Set<recoveryId>
let _auditLog = [];

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

function triggerRecovery(executionId, {
  strategy       = "retry",
  authorityLevel = "operator",
  reason         = "",
  checkpointId   = null,
  scheduledFor   = null,
  metadata       = {},
} = {}) {
  if (!executionId) return { triggered: false, reason: "missing_execution_id" };
  if (_authRank(authorityLevel) < 1) return { triggered: false, reason: "insufficient_authority" };
  if (!RECOVERY_STRATEGIES.has(strategy)) return { triggered: false, reason: "invalid_strategy" };

  // Prevent duplicate in-flight recovery
  const existing = _byExecution.get(executionId);
  if (existing) {
    for (const rid of existing) {
      const r = _records.get(rid);
      if (r && (r.state === "pending" || r.state === "triggered" || r.state === "in_progress"))
        return { triggered: false, reason: "recovery_already_in_progress" };
    }
  }

  if (_records.size >= MAX_RECORDS) {
    // Evict oldest terminal record
    for (const [rid, r] of _records) {
      if (r.state === "succeeded" || r.state === "failed" || r.state === "cancelled") {
        _records.delete(rid);
        break;
      }
    }
  }

  const recoveryId = `rec-${++_counter}`;
  const now        = new Date().toISOString();

  const record = {
    recoveryId, executionId, strategy, authorityLevel, reason,
    checkpointId:  checkpointId ?? null,
    scheduledFor:  scheduledFor ?? now,
    state:         "pending",
    triggeredAt:   now,
    startedAt:     null,
    completedAt:   null,
    result:        null,
    metadata:      Object.freeze({ ...metadata }),
  };
  _records.set(recoveryId, record);
  if (!_byExecution.has(executionId)) _byExecution.set(executionId, new Set());
  _byExecution.get(executionId).add(recoveryId);

  _audit({ auditId: `mra-${_counter}`, recoveryId, executionId, authorityLevel,
    action: "trigger_recovery", strategy, reason, scheduledFor: record.scheduledFor, timestamp: now });

  return Object.freeze({ triggered: true, recoveryId, executionId, strategy, scheduledFor: record.scheduledFor });
}

function advanceRecovery(recoveryId, newState, { result = null, authorityLevel = "root-runtime" } = {}) {
  if (!RECOVERY_STATES.has(newState)) return { advanced: false, reason: "invalid_state" };
  const record = _records.get(recoveryId);
  if (!record) return { advanced: false, reason: "recovery_not_found" };

  const ALLOWED_TRANSITIONS = {
    pending:     new Set(["triggered", "cancelled"]),
    triggered:   new Set(["in_progress", "cancelled"]),
    in_progress: new Set(["succeeded", "failed", "cancelled"]),
  };
  const allowed = ALLOWED_TRANSITIONS[record.state];
  if (!allowed || !allowed.has(newState)) return { advanced: false, reason: `invalid_transition_${record.state}_to_${newState}` };

  const now = new Date().toISOString();
  if (newState === "in_progress") record.startedAt   = now;
  if (newState === "succeeded" || newState === "failed" || newState === "cancelled") {
    record.completedAt = now;
    record.result      = result;
  }
  record.state = newState;

  _audit({ auditId: `mra-${++_counter}`, recoveryId, executionId: record.executionId,
    authorityLevel, action: `recovery_${newState}`, result, timestamp: now });

  return { advanced: true, recoveryId, executionId: record.executionId, state: newState };
}

function cancelRecovery(recoveryId, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return { cancelled: false, reason: "insufficient_authority" };
  return advanceRecovery(recoveryId, "cancelled", { result: reason, authorityLevel });
}

function getRecovery(recoveryId) {
  const r = _records.get(recoveryId);
  if (!r) return { found: false };
  return { found: true, ...r };
}

function getRecoveriesForExecution(executionId) {
  const ids = _byExecution.get(executionId);
  if (!ids) return [];
  return Array.from(ids).map(rid => _records.get(rid)).filter(Boolean);
}

function getPendingRecoveries() {
  const out = [];
  for (const [, r] of _records) {
    if (r.state === "pending" || r.state === "triggered") out.push({ ...r });
  }
  return out.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
}

function getAuditLog(limit = 100) { return _auditLog.slice(0, limit); }

function getRecoveryMetrics() {
  const states = {};
  const strategies = {};
  for (const [, r] of _records) {
    states[r.state]        = (states[r.state] ?? 0) + 1;
    strategies[r.strategy] = (strategies[r.strategy] ?? 0) + 1;
  }
  return { total: _records.size, stateDistribution: states, strategyDistribution: strategies, auditLogSize: _auditLog.length };
}

function reset() {
  _counter     = 0;
  _records     = new Map();
  _byExecution = new Map();
  _auditLog    = [];
}

module.exports = {
  triggerRecovery, advanceRecovery, cancelRecovery,
  getRecovery, getRecoveriesForExecution, getPendingRecoveries,
  getAuditLog, getRecoveryMetrics, reset,
  RECOVERY_STRATEGIES: Array.from(RECOVERY_STRATEGIES),
};
