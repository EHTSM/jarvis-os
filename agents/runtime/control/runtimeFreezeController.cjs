"use strict";

// Manages runtime freeze state — halts all new execution admission while preserving
// in-flight execution state. Supports scoped (subsystem) and global freezes.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const MAX_AUDIT = 3000;

let _counter   = 0;
let _globalFreeze = null;          // null | freeze record
let _scopedFreezes = new Map();    // scope → freeze record
let _auditLog  = [];

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

function _makeFreezeRecord(scope, authorityLevel, reason, expiresAt) {
  return {
    freezeId:      `freeze-${++_counter}`,
    scope,
    authorityLevel,
    reason,
    frozenAt:      new Date().toISOString(),
    expiresAt:     expiresAt ?? null,
    unfrozenAt:    null,
    active:        true,
  };
}

// Apply a global freeze — all execution admission blocked
function applyGlobalFreeze({ authorityLevel = "governor", reason = "", durationMs = null } = {}) {
  if (_authRank(authorityLevel) < 3) return { frozen: false, reason: "insufficient_authority" };
  if (_globalFreeze && _globalFreeze.active) return { frozen: false, reason: "global_freeze_active" };

  const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
  _globalFreeze = _makeFreezeRecord("global", authorityLevel, reason, expiresAt);

  _audit({ auditId: `fa-${_counter}`, freezeId: _globalFreeze.freezeId, scope: "global",
    authorityLevel, action: "freeze", reason, expiresAt, timestamp: _globalFreeze.frozenAt });

  return { frozen: true, freezeId: _globalFreeze.freezeId, scope: "global", expiresAt };
}

// Apply a scoped freeze for a subsystem
function applyScopedFreeze(scope, { authorityLevel = "controller", reason = "", durationMs = null } = {}) {
  if (!scope) return { frozen: false, reason: "missing_scope" };
  if (_authRank(authorityLevel) < 2) return { frozen: false, reason: "insufficient_authority" };
  if (_globalFreeze?.active) return { frozen: false, reason: "global_freeze_active_use_global" };
  if (_scopedFreezes.has(scope) && _scopedFreezes.get(scope).active) return { frozen: false, reason: "scope_already_frozen" };

  const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
  const record    = _makeFreezeRecord(scope, authorityLevel, reason, expiresAt);
  _scopedFreezes.set(scope, record);

  _audit({ auditId: `fa-${_counter}`, freezeId: record.freezeId, scope,
    authorityLevel, action: "freeze_scope", reason, expiresAt, timestamp: record.frozenAt });

  return { frozen: true, freezeId: record.freezeId, scope, expiresAt };
}

function liftGlobalFreeze({ authorityLevel = "governor", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 3) return { lifted: false, reason: "insufficient_authority" };
  if (!_globalFreeze || !_globalFreeze.active) return { lifted: false, reason: "no_active_global_freeze" };

  const now = new Date().toISOString();
  _globalFreeze.active     = false;
  _globalFreeze.unfrozenAt = now;

  _audit({ auditId: `fa-${++_counter}`, freezeId: _globalFreeze.freezeId, scope: "global",
    authorityLevel, action: "unfreeze", reason, timestamp: now });

  return { lifted: true, freezeId: _globalFreeze.freezeId };
}

function liftScopedFreeze(scope, { authorityLevel = "controller", reason = "" } = {}) {
  if (!scope) return { lifted: false, reason: "missing_scope" };
  if (_authRank(authorityLevel) < 2) return { lifted: false, reason: "insufficient_authority" };
  const record = _scopedFreezes.get(scope);
  if (!record || !record.active) return { lifted: false, reason: "scope_not_frozen" };

  const now = new Date().toISOString();
  record.active     = false;
  record.unfrozenAt = now;

  _audit({ auditId: `fa-${++_counter}`, freezeId: record.freezeId, scope,
    authorityLevel, action: "unfreeze_scope", reason, timestamp: now });

  return { lifted: true, freezeId: record.freezeId, scope };
}

// Expire freezes whose durationMs has elapsed
function expireFreezes({ nowMs = Date.now() } = {}) {
  const expired = [];
  if (_globalFreeze?.active && _globalFreeze.expiresAt && nowMs >= new Date(_globalFreeze.expiresAt).getTime()) {
    const r = liftGlobalFreeze({ authorityLevel: "root-runtime", reason: "auto_expired" });
    expired.push({ scope: "global", ...r });
  }
  for (const [scope, record] of _scopedFreezes) {
    if (record.active && record.expiresAt && nowMs >= new Date(record.expiresAt).getTime()) {
      const r = liftScopedFreeze(scope, { authorityLevel: "root-runtime", reason: "auto_expired" });
      expired.push({ scope, ...r });
    }
  }
  return { expired: expired.length, details: expired };
}

// Check if scope is frozen (global OR scoped)
function isFrozen(scope = null) {
  if (_globalFreeze?.active) return { frozen: true, reason: "global_freeze", freezeId: _globalFreeze.freezeId };
  if (scope) {
    const r = _scopedFreezes.get(scope);
    if (r?.active) return { frozen: true, reason: "scoped_freeze", scope, freezeId: r.freezeId };
  }
  return { frozen: false };
}

function getFreezeStatus() {
  const activeScopedFreezes = [];
  for (const [scope, record] of _scopedFreezes) {
    if (record.active) activeScopedFreezes.push({ scope, freezeId: record.freezeId, frozenAt: record.frozenAt, expiresAt: record.expiresAt });
  }
  return {
    globalFreeze:  _globalFreeze?.active ? { freezeId: _globalFreeze.freezeId, frozenAt: _globalFreeze.frozenAt, expiresAt: _globalFreeze.expiresAt } : null,
    scopedFreezes: activeScopedFreezes,
    totalActive:   (_globalFreeze?.active ? 1 : 0) + activeScopedFreezes.length,
  };
}

function getAuditLog(limit = 100) {
  return _auditLog.slice(0, limit);
}

function getFreezeMetrics() {
  let totalHistorical = 0;
  for (const [, r] of _scopedFreezes) if (!r.active) totalHistorical++;
  return {
    auditLogSize:       _auditLog.length,
    activeGlobal:       _globalFreeze?.active ? 1 : 0,
    activeScopedCount:  getFreezeStatus().scopedFreezes.length,
    historicalScoped:   totalHistorical,
  };
}

function reset() {
  _counter       = 0;
  _globalFreeze  = null;
  _scopedFreezes = new Map();
  _auditLog      = [];
}

module.exports = {
  applyGlobalFreeze, applyScopedFreeze, liftGlobalFreeze, liftScopedFreeze,
  expireFreezes, isFrozen, getFreezeStatus, getAuditLog, getFreezeMetrics, reset,
};
