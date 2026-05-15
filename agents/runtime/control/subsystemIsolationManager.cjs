"use strict";

// Manages subsystem isolation — quarantine individual subsystems, prevent cross-subsystem
// communication, track affected executions, and support controlled re-integration.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const ISOLATION_STATES = new Set(["isolated", "degraded", "reintegrating", "normal"]);
const MAX_AUDIT = 3000;

let _counter    = 0;
let _subsystems = new Map();  // subsystemId → subsystem record
let _auditLog   = [];

function _authRank(l) { return AUTHORITY_LEVELS[l] ?? -1; }

function _audit(entry) {
  _auditLog.unshift(Object.freeze(entry));
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

function registerSubsystem(subsystemId, { metadata = {}, allowedPeers = [] } = {}) {
  if (!subsystemId) return { registered: false, reason: "missing_subsystem_id" };
  if (_subsystems.has(subsystemId)) return { registered: false, reason: "already_registered" };
  _subsystems.set(subsystemId, {
    subsystemId,
    state:          "normal",
    allowedPeers:   [...allowedPeers],
    blockedPeers:   [],
    affectedExecutions: [],
    metadata:       Object.freeze({ ...metadata }),
    isolatedAt:     null,
    reintegrationAt: null,
  });
  return { registered: true, subsystemId };
}

function isolateSubsystem(subsystemId, { authorityLevel = "controller", reason = "", affectedExecutions = [] } = {}) {
  if (!subsystemId) return { isolated: false, reason: "missing_subsystem_id" };
  if (_authRank(authorityLevel) < 2) return { isolated: false, reason: "insufficient_authority" };

  // Auto-register if not present
  if (!_subsystems.has(subsystemId)) registerSubsystem(subsystemId);

  const ss = _subsystems.get(subsystemId);
  if (ss.state === "isolated") return { isolated: false, reason: "already_isolated" };

  ss.state               = "isolated";
  ss.isolatedAt          = new Date().toISOString();
  ss.affectedExecutions  = [...affectedExecutions];

  const isolationId = `iso-${++_counter}`;
  _audit({ auditId: `isoa-${_counter}`, isolationId, subsystemId, authorityLevel,
    action: "isolate", reason, affectedCount: affectedExecutions.length, timestamp: ss.isolatedAt });

  return { isolated: true, isolationId, subsystemId, affectedCount: affectedExecutions.length };
}

function markDegraded(subsystemId, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return { ok: false, reason: "insufficient_authority" };
  const ss = _subsystems.get(subsystemId);
  if (!ss) return { ok: false, reason: "subsystem_not_found" };
  if (ss.state === "isolated") return { ok: false, reason: "subsystem_isolated" };
  const prev = ss.state;
  ss.state = "degraded";
  _audit({ auditId: `isoa-${++_counter}`, subsystemId, authorityLevel, action: "mark_degraded",
    reason, prevState: prev, timestamp: new Date().toISOString() });
  return { ok: true, subsystemId, prevState: prev, newState: "degraded" };
}

function beginReintegration(subsystemId, { authorityLevel = "controller", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 2) return { ok: false, reason: "insufficient_authority" };
  const ss = _subsystems.get(subsystemId);
  if (!ss) return { ok: false, reason: "subsystem_not_found" };
  if (ss.state !== "isolated" && ss.state !== "degraded") return { ok: false, reason: `invalid_state_${ss.state}` };

  const now = new Date().toISOString();
  ss.state            = "reintegrating";
  ss.reintegrationAt  = now;
  _audit({ auditId: `isoa-${++_counter}`, subsystemId, authorityLevel, action: "begin_reintegration",
    reason, timestamp: now });
  return { ok: true, subsystemId, state: "reintegrating" };
}

function completeReintegration(subsystemId, { authorityLevel = "controller" } = {}) {
  if (_authRank(authorityLevel) < 2) return { ok: false, reason: "insufficient_authority" };
  const ss = _subsystems.get(subsystemId);
  if (!ss) return { ok: false, reason: "subsystem_not_found" };
  if (ss.state !== "reintegrating") return { ok: false, reason: `must_be_reintegrating_not_${ss.state}` };

  ss.state               = "normal";
  ss.isolatedAt          = null;
  ss.affectedExecutions  = [];
  _audit({ auditId: `isoa-${++_counter}`, subsystemId, authorityLevel, action: "complete_reintegration",
    timestamp: new Date().toISOString() });
  return { ok: true, subsystemId, state: "normal" };
}

// Can subsystemA communicate with subsystemB?
function canCommunicate(fromSubsystem, toSubsystem) {
  const from = _subsystems.get(fromSubsystem);
  const to   = _subsystems.get(toSubsystem);

  if (from?.state === "isolated") return { allowed: false, reason: "source_isolated" };
  if (to?.state   === "isolated") return { allowed: false, reason: "target_isolated" };
  if (from?.blockedPeers.includes(toSubsystem)) return { allowed: false, reason: "peer_blocked" };
  return { allowed: true };
}

function blockPeer(subsystemId, peerId, { authorityLevel = "controller" } = {}) {
  if (_authRank(authorityLevel) < 2) return { ok: false, reason: "insufficient_authority" };
  if (!_subsystems.has(subsystemId)) registerSubsystem(subsystemId);
  const ss = _subsystems.get(subsystemId);
  if (!ss.blockedPeers.includes(peerId)) ss.blockedPeers.push(peerId);
  return { ok: true, subsystemId, blocked: peerId };
}

function unblockPeer(subsystemId, peerId, { authorityLevel = "controller" } = {}) {
  if (_authRank(authorityLevel) < 2) return { ok: false, reason: "insufficient_authority" };
  const ss = _subsystems.get(subsystemId);
  if (!ss) return { ok: false, reason: "subsystem_not_found" };
  ss.blockedPeers = ss.blockedPeers.filter(p => p !== peerId);
  return { ok: true, subsystemId, unblocked: peerId };
}

function getSubsystemState(subsystemId) {
  const ss = _subsystems.get(subsystemId);
  if (!ss) return { found: false };
  return { found: true, subsystemId: ss.subsystemId, state: ss.state,
    affectedExecutions: [...ss.affectedExecutions], blockedPeers: [...ss.blockedPeers],
    isolatedAt: ss.isolatedAt, reintegrationAt: ss.reintegrationAt };
}

function getIsolatedSubsystems() {
  const out = [];
  for (const [, ss] of _subsystems) if (ss.state === "isolated") out.push(ss.subsystemId);
  return out;
}

function getAuditLog(limit = 100) { return _auditLog.slice(0, limit); }

function getIsolationMetrics() {
  const states = {};
  for (const [, ss] of _subsystems) states[ss.state] = (states[ss.state] ?? 0) + 1;
  return { total: _subsystems.size, stateDistribution: states, auditLogSize: _auditLog.length };
}

function reset() {
  _counter    = 0;
  _subsystems = new Map();
  _auditLog   = [];
}

module.exports = {
  registerSubsystem, isolateSubsystem, markDegraded, beginReintegration,
  completeReintegration, canCommunicate, blockPeer, unblockPeer,
  getSubsystemState, getIsolatedSubsystems, getAuditLog, getIsolationMetrics, reset,
};
