"use strict";

// Central dispatch hub for all runtime execution control operations.
// Routes control commands to appropriate subsystem modules.

const VALID_ACTIONS = new Set([
  "pause", "resume", "terminate", "freeze", "unfreeze",
  "quarantine", "isolate", "unisolate", "priority_override", "recover",
]);

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };
const MIN_AUTHORITY = { pause: 1, resume: 1, terminate: 2, freeze: 2, unfreeze: 2,
  quarantine: 2, isolate: 2, unisolate: 2, priority_override: 1, recover: 1 };

let _counter  = 0;
let _commands = [];  // immutable audit log
const MAX_COMMANDS = 5000;

const _registered = new Map(); // executionId → { state, metadata }

function _authRank(level) { return AUTHORITY_LEVELS[level] ?? -1; }

function _validateAuth(action, authorityLevel) {
  const rank = _authRank(authorityLevel);
  if (rank < 0) return { ok: false, reason: "unknown_authority_level" };
  const minRank = MIN_AUTHORITY[action] ?? 2;
  if (rank < minRank) return { ok: false, reason: "insufficient_authority" };
  return { ok: true };
}

function _record(commandId, action, executionId, authorityLevel, result, meta = {}) {
  const entry = Object.freeze({
    commandId, action, executionId, authorityLevel,
    success: result.success,
    reason:  result.reason ?? null,
    timestamp: new Date().toISOString(),
    ...meta,
  });
  _commands.unshift(entry);
  if (_commands.length > MAX_COMMANDS) _commands.length = MAX_COMMANDS;
  return entry;
}

// Register an execution for control tracking
function registerExecution(executionId, metadata = {}) {
  if (!executionId) return { registered: false, reason: "missing_execution_id" };
  if (_registered.has(executionId)) return { registered: false, reason: "already_registered" };
  _registered.set(executionId, {
    state:     "active",
    metadata:  Object.freeze({ ...metadata }),
    createdAt: new Date().toISOString(),
  });
  return { registered: true, executionId };
}

// Dispatch a control action to a registered execution
function dispatchControl({ executionId, action, authorityLevel, reason = "", meta = {} }) {
  const commandId = `cmd-${++_counter}`;

  if (!executionId)    return _record(commandId, action, executionId, authorityLevel, { success: false, reason: "missing_execution_id" });
  if (!VALID_ACTIONS.has(action)) return _record(commandId, action, executionId, authorityLevel, { success: false, reason: "invalid_action" });

  const authCheck = _validateAuth(action, authorityLevel);
  if (!authCheck.ok) return _record(commandId, action, executionId, authorityLevel, { success: false, reason: authCheck.reason });

  if (!_registered.has(executionId)) return _record(commandId, action, executionId, authorityLevel, { success: false, reason: "execution_not_found" });

  const entry = _registered.get(executionId);
  const prevState = entry.state;

  const result = _applyTransition(entry, action, reason);
  return _record(commandId, action, executionId, authorityLevel, result, { prevState, newState: entry.state, ...meta });
}

function _applyTransition(entry, action, reason) {
  const st = entry.state;
  const transitions = {
    pause:            { from: new Set(["active", "resuming"]),            to: "paused"            },
    resume:           { from: new Set(["paused", "frozen"]),              to: "resuming"          },
    terminate:        { from: new Set(["active","paused","frozen","quarantined","isolated","resuming"]), to: "terminating" },
    freeze:           { from: new Set(["active", "paused"]),              to: "frozen"            },
    unfreeze:         { from: new Set(["frozen"]),                        to: "active"            },
    quarantine:       { from: new Set(["active","paused","frozen"]),      to: "quarantined"       },
    isolate:          { from: new Set(["active","paused"]),               to: "isolated"          },
    unisolate:        { from: new Set(["isolated"]),                      to: "active"            },
    priority_override:{ from: new Set(["active","paused","frozen"]),      to: st                  }, // no state change
    recover:          { from: new Set(["quarantined","terminating","terminated"]), to: "recovering" },
  };
  const rule = transitions[action];
  if (!rule) return { success: false, reason: "no_transition_rule" };
  if (!rule.from.has(st)) return { success: false, reason: `invalid_state_transition_from_${st}` };
  entry.state = rule.to;
  return { success: true };
}

function getExecutionState(executionId) {
  if (!_registered.has(executionId)) return { found: false };
  const e = _registered.get(executionId);
  return { found: true, executionId, state: e.state, metadata: e.metadata };
}

function getCommandLog(limit = 100) {
  return _commands.slice(0, limit);
}

function getControllerMetrics() {
  const states = {};
  for (const [, e] of _registered) {
    states[e.state] = (states[e.state] ?? 0) + 1;
  }
  return {
    totalCommands:  _commands.length,
    registeredCount: _registered.size,
    stateDistribution: states,
  };
}

function reset() {
  _counter  = 0;
  _commands = [];
  _registered.clear();
}

module.exports = {
  registerExecution, dispatchControl, getExecutionState,
  getCommandLog, getControllerMetrics, reset,
  VALID_ACTIONS: Array.from(VALID_ACTIONS),
  AUTHORITY_LEVELS,
};
