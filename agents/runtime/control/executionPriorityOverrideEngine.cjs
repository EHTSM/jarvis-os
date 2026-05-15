"use strict";

// Allows operators/governors to override the computed priority of individual executions.
// Overrides are bounded, audited, and respect authority levels.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const MIN_PRIORITY  = 0;
const MAX_PRIORITY  = 100;
const MAX_OVERRIDES = 2000;
const MAX_AUDIT     = 3000;

let _counter   = 0;
let _overrides = new Map();  // executionId → override record
let _history   = [];         // all past overrides (frozen)
let _auditLog  = [];

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

function applyOverride(executionId, { priorityScore, authorityLevel = "operator", reason = "", expiresAt = null } = {}) {
  if (!executionId) return { applied: false, reason: "missing_execution_id" };
  if (_authRank(authorityLevel) < 1) return { applied: false, reason: "insufficient_authority" };
  if (typeof priorityScore !== "number") return { applied: false, reason: "missing_priority_score" };
  if (priorityScore < MIN_PRIORITY || priorityScore > MAX_PRIORITY)
    return { applied: false, reason: `priority_out_of_range_${MIN_PRIORITY}_${MAX_PRIORITY}` };

  if (_overrides.size >= MAX_OVERRIDES && !_overrides.has(executionId)) {
    // Evict oldest
    const oldest = _overrides.keys().next().value;
    _overrides.delete(oldest);
  }

  const overrideId = `po-${++_counter}`;
  const now        = new Date().toISOString();
  const prev       = _overrides.get(executionId)?.priorityScore ?? null;

  const record = {
    overrideId, executionId, priorityScore, authorityLevel, reason,
    appliedAt:  now,
    expiresAt:  expiresAt ?? null,
    revoked:    false,
  };
  _overrides.set(executionId, record);

  const histEntry = Object.freeze({ ...record });
  _history.unshift(histEntry);

  _audit({ auditId: `poa-${_counter}`, overrideId, executionId, authorityLevel,
    action: "apply_override", priorityScore, prevScore: prev, reason, expiresAt, timestamp: now });

  return { applied: true, overrideId, executionId, priorityScore, prevScore: prev };
}

function revokeOverride(executionId, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return { revoked: false, reason: "insufficient_authority" };
  const record = _overrides.get(executionId);
  if (!record) return { revoked: false, reason: "no_override_found" };
  if (record.revoked) return { revoked: false, reason: "already_revoked" };

  const now       = new Date().toISOString();
  record.revoked  = true;
  _overrides.delete(executionId);

  _audit({ auditId: `poa-${++_counter}`, overrideId: record.overrideId, executionId,
    authorityLevel, action: "revoke_override", reason, timestamp: now });

  return { revoked: true, overrideId: record.overrideId, executionId };
}

// Expire overrides whose expiresAt has passed
function expireOverrides({ nowMs = Date.now() } = {}) {
  const expired = [];
  for (const [execId, record] of _overrides) {
    if (record.expiresAt && nowMs >= new Date(record.expiresAt).getTime()) {
      const r = revokeOverride(execId, { authorityLevel: "root-runtime", reason: "auto_expired" });
      expired.push({ executionId: execId, ...r });
    }
  }
  return { expired: expired.length, details: expired };
}

// Get the current effective priority for an execution (override or original)
function getEffectivePriority(executionId, originalPriority = null) {
  const override = _overrides.get(executionId);
  if (!override || override.revoked) return { executionId, priority: originalPriority, overridden: false };
  return { executionId, priority: override.priorityScore, overridden: true, overrideId: override.overrideId };
}

// Apply a batch of overrides atomically
function applyBatchOverrides(overrides, { authorityLevel = "governor" } = {}) {
  if (_authRank(authorityLevel) < 3) return { ok: false, reason: "insufficient_authority" };
  const results = overrides.map(o =>
    applyOverride(o.executionId, { ...o, authorityLevel })
  );
  const succeeded = results.filter(r => r.applied).length;
  return { ok: true, total: overrides.length, succeeded, results };
}

function getActiveOverrides() {
  return Array.from(_overrides.values()).map(r => ({ ...r }));
}

function getOverrideHistory(limit = 100) {
  return _history.slice(0, limit);
}

function getAuditLog(limit = 100) { return _auditLog.slice(0, limit); }

function getOverrideMetrics() {
  return {
    activeOverrides: _overrides.size,
    totalHistorical: _history.length,
    auditLogSize:    _auditLog.length,
  };
}

function reset() {
  _counter   = 0;
  _overrides = new Map();
  _history   = [];
  _auditLog  = [];
}

module.exports = {
  applyOverride, revokeOverride, expireOverrides, getEffectivePriority,
  applyBatchOverrides, getActiveOverrides, getOverrideHistory,
  getAuditLog, getOverrideMetrics, reset,
  MIN_PRIORITY, MAX_PRIORITY,
};
