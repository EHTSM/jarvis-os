"use strict";

// Manages control state for entire workflows — pause/resume/cancel at workflow scope,
// cascading to all member executions.

const AUTHORITY_LEVELS = { observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4 };

const WORKFLOW_STATES = new Set(["active","paused","frozen","cancelling","cancelled","completed","degraded"]);
const TERMINAL_STATES = new Set(["cancelled","completed"]);

let _counter   = 0;
let _workflows = new Map(); // workflowId → workflow record (mutable shell, frozen snapshots)
let _auditLog  = [];
const MAX_AUDIT = 3000;

function _authRank(level) { return AUTHORITY_LEVELS[level] ?? -1; }

function _audit(workflowId, action, authorityLevel, result, extra = {}) {
  const entry = Object.freeze({
    auditId: `wca-${++_counter}`,
    workflowId, action, authorityLevel,
    success: result.success,
    reason:  result.reason ?? null,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  _auditLog.unshift(entry);
  if (_auditLog.length > MAX_AUDIT) _auditLog.length = MAX_AUDIT;
  return entry;
}

function registerWorkflow(workflowId, { executionIds = [], metadata = {}, authorityLevel = "controller" } = {}) {
  if (!workflowId) return { registered: false, reason: "missing_workflow_id" };
  if (_workflows.has(workflowId)) return { registered: false, reason: "already_registered" };

  _workflows.set(workflowId, {
    workflowId,
    state:        "active",
    executionIds: [...executionIds],
    metadata:     Object.freeze({ ...metadata }),
    createdAt:    new Date().toISOString(),
    pausedAt:     null,
    cancelledAt:  null,
  });
  return { registered: true, workflowId, executionCount: executionIds.length };
}

function addExecution(workflowId, executionId) {
  if (!workflowId || !executionId) return { added: false, reason: "missing_id" };
  const wf = _workflows.get(workflowId);
  if (!wf) return { added: false, reason: "workflow_not_found" };
  if (TERMINAL_STATES.has(wf.state)) return { added: false, reason: "workflow_terminal" };
  if (!wf.executionIds.includes(executionId)) wf.executionIds.push(executionId);
  return { added: true, workflowId, executionId };
}

function pauseWorkflow(workflowId, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return _audit(workflowId, "pause", authorityLevel, { success: false, reason: "insufficient_authority" });
  const wf = _workflows.get(workflowId);
  if (!wf) return _audit(workflowId, "pause", authorityLevel, { success: false, reason: "workflow_not_found" });
  if (wf.state !== "active") return _audit(workflowId, "pause", authorityLevel, { success: false, reason: `invalid_state_${wf.state}` });
  wf.state    = "paused";
  wf.pausedAt = new Date().toISOString();
  return _audit(workflowId, "pause", authorityLevel, { success: true }, { affectedExecutions: wf.executionIds.length, reason });
}

function resumeWorkflow(workflowId, { authorityLevel = "operator", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 1) return _audit(workflowId, "resume", authorityLevel, { success: false, reason: "insufficient_authority" });
  const wf = _workflows.get(workflowId);
  if (!wf) return _audit(workflowId, "resume", authorityLevel, { success: false, reason: "workflow_not_found" });
  if (wf.state !== "paused") return _audit(workflowId, "resume", authorityLevel, { success: false, reason: `invalid_state_${wf.state}` });
  wf.state    = "active";
  wf.pausedAt = null;
  return _audit(workflowId, "resume", authorityLevel, { success: true }, { reason });
}

function cancelWorkflow(workflowId, { authorityLevel = "controller", reason = "" } = {}) {
  if (_authRank(authorityLevel) < 2) return _audit(workflowId, "cancel", authorityLevel, { success: false, reason: "insufficient_authority" });
  const wf = _workflows.get(workflowId);
  if (!wf) return _audit(workflowId, "cancel", authorityLevel, { success: false, reason: "workflow_not_found" });
  if (TERMINAL_STATES.has(wf.state)) return _audit(workflowId, "cancel", authorityLevel, { success: false, reason: "already_terminal" });
  wf.state       = "cancelling";
  wf.cancelledAt = new Date().toISOString();
  return _audit(workflowId, "cancel", authorityLevel, { success: true },
    { affectedExecutions: wf.executionIds.length, reason });
}

function completeWorkflow(workflowId, { authorityLevel = "controller" } = {}) {
  const wf = _workflows.get(workflowId);
  if (!wf) return { completed: false, reason: "workflow_not_found" };
  if (TERMINAL_STATES.has(wf.state)) return { completed: false, reason: "already_terminal" };
  wf.state = "completed";
  return { completed: true, workflowId };
}

function getWorkflowState(workflowId) {
  const wf = _workflows.get(workflowId);
  if (!wf) return { found: false };
  return {
    found: true,
    workflowId:    wf.workflowId,
    state:         wf.state,
    executionCount: wf.executionIds.length,
    executionIds:  [...wf.executionIds],
    metadata:      wf.metadata,
    pausedAt:      wf.pausedAt,
    cancelledAt:   wf.cancelledAt,
  };
}

function getActiveWorkflows() {
  const out = [];
  for (const [, wf] of _workflows) {
    if (!TERMINAL_STATES.has(wf.state)) out.push({ workflowId: wf.workflowId, state: wf.state, executionCount: wf.executionIds.length });
  }
  return out;
}

function getAuditLog(limit = 100) {
  return _auditLog.slice(0, limit);
}

function getWorkflowManagerMetrics() {
  const states = {};
  for (const [, wf] of _workflows) states[wf.state] = (states[wf.state] ?? 0) + 1;
  return {
    totalWorkflows:  _workflows.size,
    auditLogSize:    _auditLog.length,
    stateDistribution: states,
  };
}

function reset() {
  _counter   = 0;
  _workflows = new Map();
  _auditLog  = [];
}

module.exports = {
  registerWorkflow, addExecution, pauseWorkflow, resumeWorkflow,
  cancelWorkflow, completeWorkflow, getWorkflowState, getActiveWorkflows,
  getAuditLog, getWorkflowManagerMetrics, reset,
};
