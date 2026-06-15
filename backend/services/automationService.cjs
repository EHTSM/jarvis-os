"use strict";
/**
 * K5 — Enterprise Automation Service
 * Manages workspace automation rules — triggers, conditions, actions,
 * approval gates, escalation rules, history, statistics.
 *
 * Execution reuses the existing autonomousLoop.addTask() + taskQueue.
 * No new scheduler. No new execution engine. No new observer.
 * Events emitted via runtimeEventBus. History piggybacks on the
 * task queue result — no separate log storage beyond this service file.
 *
 * Storage: data/automation-layer.json (keyed by workspaceId)
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../../data/automation-layer.json");
const MAX_HISTORY = 500;

// ── Lazy deps ─────────────────────────────────────────────────────
let _loop = null, _bus = null, _govSvc = null, _secSvc = null;
function _autoLoop() {
  if (!_loop) try { _loop = require("../../agents/autonomousLoop.cjs"); } catch {}
  return _loop;
}
function _evtBus() {
  if (!_bus) try { _bus = require("../../agents/runtime/runtimeEventBus.cjs"); } catch {}
  return _bus;
}
function _gov() {
  if (!_govSvc) try { _govSvc = require("./governanceService.cjs"); } catch {}
  return _govSvc;
}
function _sec() {
  if (!_secSvc) try { _secSvc = require("./securityLayer.cjs"); } catch {}
  return _secSvc;
}

// ── Constants ─────────────────────────────────────────────────────
const TRIGGER_TYPES = [
  "schedule",       // cron / one-shot schedule
  "event",          // runtimeEventBus event name
  "threshold",      // metric crosses a threshold
  "manual",         // operator-triggered
  "webhook",        // inbound webhook payload
  "approval",       // triggered on approval decision
];

const ACTION_TYPES = [
  "queue_task",     // push a task to autonomousLoop
  "emit_event",     // emit a named event on runtimeEventBus
  "notify",         // log notification to security audit log
  "set_policy",     // update a governance policy enforcement
  "escalate",       // escalate via runtimeEventBus escalation event
];

const BUILT_IN_TEMPLATES = [
  {
    id:          "atpl_daily_health",
    name:        "Daily Health Check",
    description: "Run a system health check every day at 08:00.",
    category:    "operations",
    rule: {
      trigger: { type: "schedule", cron: "0 8 * * *", label: "Daily 08:00" },
      conditions: [],
      action:  { type: "queue_task", input: "Run daily system health check and report findings" },
    },
  },
  {
    id:          "atpl_high_error_alert",
    name:        "High Error Rate Escalation",
    description: "Escalate when error count threshold is crossed.",
    category:    "reliability",
    rule: {
      trigger:    { type: "threshold", metric: "error_count", operator: "gt", value: 50 },
      conditions: [{ field: "window_minutes", operator: "lte", value: 15 }],
      action:     { type: "escalate", message: "Error threshold exceeded — auto-escalating" },
    },
  },
  {
    id:          "atpl_member_onboard",
    name:        "New Member Onboarding",
    description: "Queue onboarding task when a member joins the workspace.",
    category:    "hr",
    rule: {
      trigger:    { type: "event", eventName: "workspace_member_added" },
      conditions: [],
      action:     { type: "queue_task", input: "Onboard new workspace member: {{accountId}}" },
    },
  },
  {
    id:          "atpl_deploy_approval",
    name:        "Deployment Approval Gate",
    description: "Pause deployment pipeline until an Admin approves.",
    category:    "deployment",
    rule: {
      trigger:    { type: "event", eventName: "deployment_started" },
      conditions: [{ field: "environment", operator: "eq", value: "production" }],
      action:     { type: "notify", message: "Deployment to production requires approval" },
      approvalGate: { requiredRole: "Admin", timeoutHours: 24 },
    },
  },
  {
    id:          "atpl_weekly_report",
    name:        "Weekly Governance Report",
    description: "Queue a governance report every Monday morning.",
    category:    "governance",
    rule: {
      trigger:    { type: "schedule", cron: "0 9 * * 1", label: "Monday 09:00" },
      conditions: [],
      action:     { type: "queue_task", input: "Generate weekly governance and compliance report" },
    },
  },
];

// ── Storage ───────────────────────────────────────────────────────
function _read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}
function _write(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function _wsData(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) {
    all[workspaceId] = { rules: [], templates: [], history: [] };
    _write(all);
  }
  return { all, ws: all[workspaceId] };
}
function _save(all) { _write(all); }

// ── History helper ────────────────────────────────────────────────
function _addHistory(ws, ruleId, ruleName, outcome, detail = "", dryRun = false) {
  if (!ws.history) ws.history = [];
  ws.history.unshift({
    id:       crypto.randomBytes(5).toString("hex"),
    ruleId,
    ruleName,
    outcome,  // "success" | "failed" | "skipped" | "pending_approval" | "dry_run"
    detail,
    dryRun,
    ts:       Date.now(),
  });
  if (ws.history.length > MAX_HISTORY) ws.history.length = MAX_HISTORY;
}

// ── Condition evaluator ───────────────────────────────────────────
function _evalCondition(condition, context = {}) {
  const { field, operator, value } = condition;
  const actual = context[field];
  if (actual === undefined) return true; // missing context → pass
  switch (operator) {
    case "eq":  return actual == value;
    case "neq": return actual != value;
    case "gt":  return Number(actual) > Number(value);
    case "lt":  return Number(actual) < Number(value);
    case "gte": return Number(actual) >= Number(value);
    case "lte": return Number(actual) <= Number(value);
    case "contains": return String(actual).includes(String(value));
    default: return true;
  }
}

function _evalConditions(conditions, context) {
  return (conditions || []).every(c => _evalCondition(c, context));
}

// ── Template interpolation ────────────────────────────────────────
function _interpolate(str, context) {
  return String(str || "").replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] ?? `{{${key}}}`);
}

// ── Execute action ────────────────────────────────────────────────
async function _executeAction(rule, context, workspaceId, dryRun = false) {
  const { action, approvalGate } = rule;
  if (!action) return { outcome: "skipped", detail: "no action defined" };

  if (approvalGate) {
    const msg = `Rule "${rule.name}" requires ${approvalGate.requiredRole} approval (timeout: ${approvalGate.timeoutHours}h)`;
    if (!dryRun) {
      _evtBus()?.emit("automation_approval_required", {
        workspaceId, ruleId: rule.id, ruleName: rule.name, approvalGate, _ts: Date.now(),
      });
      try { _sec()?.addAuditEntry(workspaceId, "system", "automation.approval_required", msg); } catch {}
    }
    return { outcome: "pending_approval", detail: msg };
  }

  if (dryRun) {
    return { outcome: "dry_run", detail: `Would execute: ${action.type} — ${action.input || action.message || action.eventName || ""}` };
  }

  switch (action.type) {
    case "queue_task": {
      const input = _interpolate(action.input, context);
      let taskId = null;
      try {
        const loop = _autoLoop();
        if (loop) {
          const task = loop.addTask({ input, type: "automation", recurringCron: null });
          taskId = task?.id;
        }
      } catch {}
      return { outcome: "success", detail: `Queued task: "${input}"${taskId ? ` (id=${taskId})` : ""}` };
    }
    case "emit_event": {
      const eventName = action.eventName || "automation_action";
      _evtBus()?.emit(eventName, { workspaceId, ruleId: rule.id, context, _ts: Date.now() });
      return { outcome: "success", detail: `Emitted event: ${eventName}` };
    }
    case "notify": {
      const msg = _interpolate(action.message || "Automation rule fired", context);
      try { _sec()?.addAuditEntry(workspaceId, "system", "automation.notify", msg); } catch {}
      _evtBus()?.emit("automation_notify", { workspaceId, ruleId: rule.id, message: msg, _ts: Date.now() });
      return { outcome: "success", detail: msg };
    }
    case "escalate": {
      const msg = _interpolate(action.message || "Automation escalation", context);
      _evtBus()?.emit("escalation", { workspaceId, ruleId: rule.id, message: msg, _ts: Date.now() });
      try { _sec()?.addAuditEntry(workspaceId, "system", "automation.escalate", msg); } catch {}
      return { outcome: "success", detail: `Escalated: ${msg}` };
    }
    case "set_policy": {
      try {
        const govSvc = _gov();
        if (govSvc && action.policyId) govSvc.updatePolicy(workspaceId, action.policyId, { enforcement: action.enforcement }, "system");
      } catch {}
      return { outcome: "success", detail: `Policy ${action.policyId} set to ${action.enforcement}` };
    }
    default:
      return { outcome: "skipped", detail: `Unknown action type: ${action.type}` };
  }
}

// ── Public API ────────────────────────────────────────────────────

function getRules(workspaceId) {
  const { ws } = _wsData(workspaceId);
  return ws.rules;
}

function createRule(workspaceId, { name, description = "", trigger, conditions = [], action, approvalGate = null, escalation = null, enabled = true }, requestingAccountId) {
  if (!name?.trim())      throw new Error("Rule name required");
  if (!trigger?.type)     throw new Error("trigger.type required");
  if (!TRIGGER_TYPES.includes(trigger.type)) throw new Error(`Invalid trigger type. Valid: ${TRIGGER_TYPES.join(", ")}`);
  if (action && !ACTION_TYPES.includes(action.type)) throw new Error(`Invalid action type. Valid: ${ACTION_TYPES.join(", ")}`);

  const { all, ws } = _wsData(workspaceId);
  const rule = {
    id:           `rule_${crypto.randomBytes(6).toString("hex")}`,
    name:         name.trim(),
    description:  description.trim(),
    trigger,
    conditions,
    action,
    approvalGate,
    escalation,
    enabled,
    status:       "active",
    createdBy:    requestingAccountId,
    createdAt:    Date.now(),
    updatedAt:    Date.now(),
    runCount:     0,
    lastRunAt:    null,
    lastOutcome:  null,
  };
  ws.rules.push(rule);
  _evtBus()?.emit("automation_rule_created", { workspaceId, ruleId: rule.id, _ts: Date.now() });
  try { _sec()?.addAuditEntry(workspaceId, requestingAccountId, "automation.rule_created", `name=${name}`); } catch {}
  _save(all);
  return rule;
}

function updateRule(workspaceId, ruleId, patch, requestingAccountId) {
  const { all, ws } = _wsData(workspaceId);
  const rule = ws.rules.find(r => r.id === ruleId);
  if (!rule) throw new Error("Rule not found");
  const ALLOWED = ["name", "description", "trigger", "conditions", "action", "approvalGate", "escalation", "enabled", "status"];
  for (const k of ALLOWED) { if (patch[k] !== undefined) rule[k] = patch[k]; }
  rule.updatedAt = Date.now();
  try { _sec()?.addAuditEntry(workspaceId, requestingAccountId, "automation.rule_updated", `id=${ruleId}`); } catch {}
  _save(all);
  return rule;
}

function getTemplates(workspaceId) {
  const { ws } = _wsData(workspaceId);
  return [...BUILT_IN_TEMPLATES, ...ws.templates];
}

function createTemplate(workspaceId, { name, description = "", category = "operations", rule }, requestingAccountId) {
  if (!name?.trim()) throw new Error("Template name required");
  const { all, ws } = _wsData(workspaceId);
  const tpl = {
    id:          `atpl_${crypto.randomBytes(6).toString("hex")}`,
    name:        name.trim(),
    description: description.trim(),
    category,
    rule:        rule || {},
    createdBy:   requestingAccountId,
    createdAt:   Date.now(),
    custom:      true,
  };
  ws.templates.push(tpl);
  _save(all);
  return tpl;
}

async function fireRule(workspaceId, ruleId, context = {}, requestingAccountId = "system", dryRun = false) {
  const { all, ws } = _wsData(workspaceId);
  const rule = ws.rules.find(r => r.id === ruleId);
  if (!rule) throw new Error("Rule not found");
  if (!dryRun && !rule.enabled) return { outcome: "skipped", detail: "Rule is disabled" };

  // Evaluate conditions
  if (!_evalConditions(rule.conditions, context)) {
    _addHistory(ws, ruleId, rule.name, "skipped", "Conditions not met", dryRun);
    _save(all);
    return { outcome: "skipped", detail: "Conditions not met" };
  }

  // Execute
  const result = await _executeAction(rule, context, workspaceId, dryRun);

  // Record
  if (!dryRun) {
    rule.runCount++;
    rule.lastRunAt   = Date.now();
    rule.lastOutcome = result.outcome;
  }
  _addHistory(ws, ruleId, rule.name, result.outcome, result.detail, dryRun);
  _evtBus()?.emit("automation_rule_fired", { workspaceId, ruleId, outcome: result.outcome, dryRun, _ts: Date.now() });
  _save(all);
  return result;
}

async function dryRun(workspaceId, { ruleId, ruleData, context = {} }, requestingAccountId) {
  if (ruleId) {
    return fireRule(workspaceId, ruleId, context, requestingAccountId, true);
  }
  // Inline rule dry-run (for rule builder preview)
  if (!ruleData) throw new Error("ruleId or ruleData required");
  const mockRule = { id: "dry_run", name: ruleData.name || "Preview", ...ruleData };
  if (!_evalConditions(mockRule.conditions, context)) {
    return { outcome: "skipped", detail: "Conditions not met in dry run" };
  }
  return _executeAction(mockRule, context, workspaceId, true);
}

function getHistory(workspaceId, { limit = 100, ruleId } = {}) {
  const { ws } = _wsData(workspaceId);
  let rows = ws.history || [];
  if (ruleId) rows = rows.filter(h => h.ruleId === ruleId);
  return rows.slice(0, Math.min(limit, MAX_HISTORY));
}

function getStatistics(workspaceId) {
  const { ws } = _wsData(workspaceId);
  const rules   = ws.rules || [];
  const history = ws.history || [];

  const activeRules    = rules.filter(r => r.enabled && r.status === "active");
  const byTrigger      = {};
  for (const r of rules) byTrigger[r.trigger?.type || "unknown"] = (byTrigger[r.trigger?.type || "unknown"] || 0) + 1;

  const byOutcome = { success: 0, failed: 0, skipped: 0, pending_approval: 0, dry_run: 0 };
  for (const h of history) byOutcome[h.outcome] = (byOutcome[h.outcome] || 0) + 1;

  const last24h = history.filter(h => h.ts > Date.now() - 86400_000).length;
  const last7d  = history.filter(h => h.ts > Date.now() - 7 * 86400_000).length;

  return {
    rules:   { total: rules.length, active: activeRules.length, byTrigger },
    history: { total: history.length, last24h, last7d, byOutcome },
    topRules: rules.sort((a, b) => b.runCount - a.runCount).slice(0, 5).map(r => ({
      id: r.id, name: r.name, runCount: r.runCount, lastOutcome: r.lastOutcome, lastRunAt: r.lastRunAt,
    })),
  };
}

module.exports = {
  TRIGGER_TYPES, ACTION_TYPES,
  getRules, createRule, updateRule,
  getTemplates, createTemplate,
  fireRule, dryRun,
  getHistory, getStatistics,
};
