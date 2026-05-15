"use strict";

// Handles graceful and forced termination of executions with full audit trail.
// Always attempts graceful cancellation before forced termination.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const GRACEFUL_TIMEOUT_MS = 5000;

let _counter    = 0;
let _records    = new Map(); // executionId → termination record
let _auditLog   = [];
const MAX_AUDIT = 4000;

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

// Initiate graceful termination — caller is responsible for driving it to completion
function initiateTermination(executionId, { authorityLevel = "controller", reason = "", forced = false } = {}) {
  if (!executionId) return { initiated: false, reason: "missing_execution_id" };
  if (_authRank(authorityLevel) < 2) return { initiated: false, reason: "insufficient_authority" };

  if (_records.has(executionId)) {
    const ex = _records.get(executionId);
    if (ex.phase === "terminated") return { initiated: false, reason: "already_terminated" };
    if (ex.phase === "terminating") return { initiated: false, reason: "termination_in_progress" };
  }

  const terminationId = `term-${++_counter}`;
  const now = new Date().toISOString();
  const record = {
    terminationId,
    executionId,
    phase:         "terminating",   // terminating → terminated | failed
    forced,
    reason,
    authorityLevel,
    initiatedAt:   now,
    completedAt:   null,
    gracefulDeadline: new Date(Date.now() + GRACEFUL_TIMEOUT_MS).toISOString(),
    error:         null,
  };
  _records.set(executionId, record);

  _audit({
    auditId: `ta-${_counter}`,
    terminationId, executionId, authorityLevel,
    action:  forced ? "forced_termination" : "graceful_termination",
    phase:   "initiated",
    reason,
    timestamp: now,
  });

  return { initiated: true, terminationId, executionId, forced, gracefulDeadline: record.gracefulDeadline };
}

// Mark termination as completed (called by execution layer after cleanup)
function confirmTermination(executionId, { success = true, error = null } = {}) {
  const record = _records.get(executionId);
  if (!record) return { confirmed: false, reason: "termination_not_found" };
  if (record.phase === "terminated") return { confirmed: false, reason: "already_confirmed" };

  const now = new Date().toISOString();
  record.phase       = success ? "terminated" : "failed";
  record.completedAt = now;
  record.error       = error ?? null;

  _audit({
    auditId: `ta-${++_counter}`,
    terminationId: record.terminationId,
    executionId,
    authorityLevel: record.authorityLevel,
    action:    "termination_confirmed",
    phase:     record.phase,
    success,
    error,
    duration:  record.initiatedAt ? Date.now() - new Date(record.initiatedAt).getTime() : null,
    timestamp: now,
  });

  return { confirmed: true, terminationId: record.terminationId, phase: record.phase };
}

// Force immediate termination if graceful window has elapsed
function forceTerminateIfOverdue(executionId, { authorityLevel = "governor", nowMs = Date.now() } = {}) {
  if (_authRank(authorityLevel) < 3) return { forced: false, reason: "insufficient_authority" };
  const record = _records.get(executionId);
  if (!record) return { forced: false, reason: "termination_not_found" };
  if (record.phase === "terminated") return { forced: false, reason: "already_terminated" };

  const deadline = new Date(record.gracefulDeadline).getTime();
  if (nowMs < deadline) return { forced: false, reason: "grace_period_active", remainingMs: deadline - nowMs };

  record.forced = true;
  const result = confirmTermination(executionId, { success: true });
  return { forced: true, terminationId: record.terminationId, ...result };
}

function getTerminationRecord(executionId) {
  const r = _records.get(executionId);
  if (!r) return { found: false };
  return { found: true, ...r };
}

function getPendingTerminations() {
  const out = [];
  for (const [, r] of _records) {
    if (r.phase === "terminating") out.push({ ...r });
  }
  return out;
}

function getAuditLog(limit = 100) {
  return _auditLog.slice(0, limit);
}

function getTerminationMetrics() {
  let terminating = 0, terminated = 0, failed = 0, forced = 0;
  for (const [, r] of _records) {
    if (r.phase === "terminating") terminating++;
    else if (r.phase === "terminated") terminated++;
    else if (r.phase === "failed") failed++;
    if (r.forced && r.phase !== "terminating") forced++;
  }
  return { total: _records.size, terminating, terminated, failed, forced, auditLogSize: _auditLog.length };
}

function reset() {
  _counter  = 0;
  _records  = new Map();
  _auditLog = [];
}

module.exports = {
  initiateTermination, confirmTermination, forceTerminateIfOverdue,
  getTerminationRecord, getPendingTerminations, getAuditLog,
  getTerminationMetrics, reset,
  GRACEFUL_TIMEOUT_MS,
};
