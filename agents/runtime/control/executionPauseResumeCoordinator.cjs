"use strict";

// Coordinates pause and resume operations across executions and workflows,
// with checkpoint support for safe state preservation.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const MAX_CHECKPOINTS  = 200;
const MAX_AUDIT        = 3000;

let _counter     = 0;
let _paused      = new Map();   // executionId → pause record
let _checkpoints = new Map();   // executionId → checkpoint data
let _auditLog    = [];

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

function pauseExecution(executionId, { authorityLevel = "operator", reason = "", checkpointData = null } = {}) {
  if (!executionId) return { paused: false, reason: "missing_execution_id" };
  if (_authRank(authorityLevel) < 1) return { paused: false, reason: "insufficient_authority" };
  if (_paused.has(executionId)) return { paused: false, reason: "already_paused" };

  const pauseId = `pause-${++_counter}`;
  const now     = new Date().toISOString();

  const record = {
    pauseId, executionId, authorityLevel, reason,
    pausedAt:   now,
    resumedAt:  null,
    hasCheckpoint: checkpointData !== null,
  };
  _paused.set(executionId, record);

  // Store checkpoint if provided
  if (checkpointData !== null) {
    if (_checkpoints.size >= MAX_CHECKPOINTS) {
      // Evict oldest (first inserted)
      const oldest = _checkpoints.keys().next().value;
      _checkpoints.delete(oldest);
    }
    _checkpoints.set(executionId, Object.freeze({ executionId, data: checkpointData, savedAt: now }));
  }

  _audit({ auditId: `pra-${_counter}`, pauseId, executionId, authorityLevel, action: "pause", reason, timestamp: now });

  return { paused: true, pauseId, executionId, hasCheckpoint: record.hasCheckpoint };
}

function resumeExecution(executionId, { authorityLevel = "operator", reason = "" } = {}) {
  if (!executionId) return { resumed: false, reason: "missing_execution_id" };
  if (_authRank(authorityLevel) < 1) return { resumed: false, reason: "insufficient_authority" };

  const record = _paused.get(executionId);
  if (!record) return { resumed: false, reason: "execution_not_paused" };

  const now          = new Date().toISOString();
  record.resumedAt   = now;
  const pauseDurationMs = Date.now() - new Date(record.pausedAt).getTime();

  const checkpoint = _checkpoints.get(executionId) ?? null;
  _paused.delete(executionId);

  _audit({ auditId: `pra-${++_counter}`, pauseId: record.pauseId, executionId,
    authorityLevel, action: "resume", reason, pauseDurationMs, timestamp: now });

  return { resumed: true, pauseId: record.pauseId, executionId, pauseDurationMs,
    checkpoint: checkpoint ? checkpoint.data : null };
}

// Bulk pause — pauses a list of executions, returns per-execution results
function pauseAll(executionIds, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return { ok: false, reason: "insufficient_authority" };
  const results = executionIds.map(id => ({ executionId: id, ...pauseExecution(id, { authorityLevel, reason }) }));
  const succeeded = results.filter(r => r.paused).length;
  return { ok: true, total: executionIds.length, succeeded, results };
}

// Bulk resume
function resumeAll(executionIds, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return { ok: false, reason: "insufficient_authority" };
  const results = executionIds.map(id => ({ executionId: id, ...resumeExecution(id, { authorityLevel, reason }) }));
  const succeeded = results.filter(r => r.resumed).length;
  return { ok: true, total: executionIds.length, succeeded, results };
}

function saveCheckpoint(executionId, checkpointData) {
  if (!executionId) return { saved: false, reason: "missing_execution_id" };
  if (_checkpoints.size >= MAX_CHECKPOINTS) {
    const oldest = _checkpoints.keys().next().value;
    _checkpoints.delete(oldest);
  }
  const now = new Date().toISOString();
  _checkpoints.set(executionId, Object.freeze({ executionId, data: checkpointData, savedAt: now }));
  return { saved: true, executionId, savedAt: now };
}

function getCheckpoint(executionId) {
  const cp = _checkpoints.get(executionId);
  if (!cp) return { found: false };
  return { found: true, ...cp };
}

function getPausedExecutions() {
  return Array.from(_paused.values()).map(r => ({ ...r }));
}

function getAuditLog(limit = 100) {
  return _auditLog.slice(0, limit);
}

function getCoordinatorMetrics() {
  return {
    currentlyPaused:  _paused.size,
    savedCheckpoints: _checkpoints.size,
    auditLogSize:     _auditLog.length,
  };
}

function reset() {
  _counter     = 0;
  _paused      = new Map();
  _checkpoints = new Map();
  _auditLog    = [];
}

module.exports = {
  pauseExecution, resumeExecution, pauseAll, resumeAll,
  saveCheckpoint, getCheckpoint, getPausedExecutions,
  getAuditLog, getCoordinatorMetrics, reset,
};
