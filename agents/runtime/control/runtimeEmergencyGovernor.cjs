"use strict";

// Highest-authority safety layer. Handles emergency shutdown, critical alerts,
// drastic interventions, and system-wide safety overrides.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const MAX_AUDIT = 5000;

const EMERGENCY_LEVELS = { advisory: 1, warning: 2, critical: 3, emergency: 4 };

let _counter         = 0;
let _emergencyState  = null;   // null | active emergency record
let _alertLog        = [];     // all emitted alerts
let _interventions   = [];     // all executed interventions
let _auditLog        = [];

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

// Issue an emergency alert (does not trigger shutdown automatically)
function issueAlert({ level = "warning", message, authorityLevel = "operator", source = "manual", metadata = {} } = {}) {
  if (!message) return { issued: false, reason: "missing_message" };
  if (_authRank(authorityLevel) < 1) return { issued: false, reason: "insufficient_authority" };
  if (!EMERGENCY_LEVELS[level]) return { issued: false, reason: "invalid_level" };

  const alertId = `alert-${++_counter}`;
  const now     = new Date().toISOString();
  const entry   = Object.freeze({
    alertId, level, message, authorityLevel, source,
    metadata: Object.freeze({ ...metadata }),
    timestamp: now,
  });
  _alertLog.unshift(entry);
  _audit({ auditId: `ega-${_counter}`, alertId, action: "issue_alert", level, message, authorityLevel, timestamp: now });
  return { issued: true, alertId, level };
}

// Declare system-wide emergency — blocks new admission
function declareEmergency({ authorityLevel = "governor", reason = "", level = "critical", metadata = {} } = {}) {
  if (_authRank(authorityLevel) < 3) return { declared: false, reason: "insufficient_authority" };
  if (_emergencyState?.active) return { declared: false, reason: "emergency_already_active" };
  if (!EMERGENCY_LEVELS[level]) return { declared: false, reason: "invalid_level" };

  const emergencyId = `emerg-${++_counter}`;
  const now         = new Date().toISOString();
  _emergencyState   = {
    emergencyId, level, reason, authorityLevel,
    active:       true,
    declaredAt:   now,
    resolvedAt:   null,
    interventions: [],
    metadata:     Object.freeze({ ...metadata }),
  };

  _audit({ auditId: `ega-${_counter}`, emergencyId, action: "declare_emergency", level, reason, authorityLevel, timestamp: now });
  return { declared: true, emergencyId, level, state: "emergency_shutdown" };
}

function resolveEmergency({ authorityLevel = "governor", resolution = "" } = {}) {
  if (_authRank(authorityLevel) < 3) return { resolved: false, reason: "insufficient_authority" };
  if (!_emergencyState?.active) return { resolved: false, reason: "no_active_emergency" };

  const now               = new Date().toISOString();
  _emergencyState.active  = false;
  _emergencyState.resolvedAt = now;
  _emergencyState.resolution = resolution;

  _audit({ auditId: `ega-${++_counter}`, emergencyId: _emergencyState.emergencyId,
    action: "resolve_emergency", authorityLevel, resolution, timestamp: now });

  return { resolved: true, emergencyId: _emergencyState.emergencyId, resolvedAt: now };
}

// Execute a drastic intervention during an emergency (e.g., drain queues, block adapters)
function executeIntervention({ action, targetId = null, authorityLevel = "governor", reason = "" } = {}) {
  if (!action) return { executed: false, reason: "missing_action" };
  if (_authRank(authorityLevel) < 3) return { executed: false, reason: "insufficient_authority" };
  if (!_emergencyState?.active) return { executed: false, reason: "no_active_emergency" };

  const interventionId = `intv-${++_counter}`;
  const now            = new Date().toISOString();
  const entry = Object.freeze({
    interventionId, action, targetId: targetId ?? null, authorityLevel, reason, timestamp: now,
  });
  _interventions.unshift(entry);
  _emergencyState.interventions.push(interventionId);

  _audit({ auditId: `ega-${_counter}`, interventionId, emergencyId: _emergencyState.emergencyId,
    action: `intervention:${action}`, targetId, authorityLevel, reason, timestamp: now });

  return { executed: true, interventionId, action, timestamp: now };
}

// Drastic kill-all — terminates all active executions by registering them for cancellation.
// Returns the list of execution IDs passed in, marked for termination.
function emergencyKillAll(executionIds, { authorityLevel = "root-runtime", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 4) return { ok: false, reason: "insufficient_authority" };
  if (!Array.isArray(executionIds) || executionIds.length === 0) return { ok: false, reason: "no_execution_ids" };

  const killId = `kill-${++_counter}`;
  const now    = new Date().toISOString();

  const result = {
    killId, count: executionIds.length, executionIds: [...executionIds], authorityLevel, reason, timestamp: now,
  };
  _audit({ auditId: `ega-${_counter}`, killId, action: "emergency_kill_all", count: executionIds.length, authorityLevel, reason, timestamp: now });

  return { ok: true, ...result };
}

function isEmergencyActive() {
  return _emergencyState?.active === true;
}

function getEmergencyState() {
  if (!_emergencyState) return { active: false };
  return {
    active:      _emergencyState.active,
    emergencyId: _emergencyState.emergencyId,
    level:       _emergencyState.level,
    reason:      _emergencyState.reason,
    declaredAt:  _emergencyState.declaredAt,
    resolvedAt:  _emergencyState.resolvedAt,
    interventionCount: _emergencyState.interventions.length,
  };
}

function getAlertLog(limit = 100) { return _alertLog.slice(0, limit); }
function getInterventions(limit = 100) { return _interventions.slice(0, limit); }
function getAuditLog(limit = 100) { return _auditLog.slice(0, limit); }

function getGovernorMetrics() {
  const alertsByLevel = {};
  for (const a of _alertLog) alertsByLevel[a.level] = (alertsByLevel[a.level] ?? 0) + 1;
  return {
    emergencyActive: isEmergencyActive(),
    totalAlerts:     _alertLog.length,
    alertsByLevel,
    totalInterventions: _interventions.length,
    auditLogSize:    _auditLog.length,
  };
}

function reset() {
  _counter        = 0;
  _emergencyState = null;
  _alertLog       = [];
  _interventions  = [];
  _auditLog       = [];
}

module.exports = {
  issueAlert, declareEmergency, resolveEmergency, executeIntervention,
  emergencyKillAll, isEmergencyActive, getEmergencyState,
  getAlertLog, getInterventions, getAuditLog, getGovernorMetrics, reset,
  EMERGENCY_LEVELS,
};
