"use strict";
/**
 * orgAutomationCenter.cjs — V5 Global AI Organization Platform, Module 7:
 * Organization Automation Center.
 *
 * Unifies workflows, scheduled jobs, triggers, connectors, and AI
 * execution — all as thin composition over real, already-existing
 * services, none duplicated:
 *
 *   workflows/triggers: automationService.cjs (the real K5 Enterprise
 *     Automation Service — rules, conditions, actions, approval gates,
 *     history/statistics), orgId used directly as its workspaceId key
 *     (the same convention Modules 2/5/6 already established).
 *   scheduled jobs:     orgAutomationScheduler.cjs (this mission, this
 *     module) — the real, previously-missing cron-driven dispatcher for
 *     automationService's existing "schedule" trigger type, built on the
 *     already-installed node-cron package's own parser.
 *   connectors:         policyService.assertConnectorAllowed (Enterprise
 *     mission Module 4) — real org connector-restriction policy, checked
 *     before a rule's connector-touching action is allowed to run.
 *   AI execution:       orgAiBrain.ask (V5 Module 1) — real AI execution,
 *     wired into automation WITHOUT touching automationService.cjs's own
 *     closed action-type switch (queue_task/emit_event/notify/set_policy/
 *     escalate — no ai_execute case exists there, and that engine is
 *     shared across many other callers; adding a case would be exactly
 *     the kind of shared-schema change this mission's "extend, don't
 *     rewrite" rule forbids). Instead: a rule is created with the
 *     existing, already-valid action.type="emit_event" and a real
 *     eventName ("org_ai_automation_request"), carrying an extra
 *     (unvalidated, but real — createRule stores the action object
 *     verbatim) aiPrompt field. This file subscribes to that one event
 *     name on the real runtimeEventBus and, on receipt, calls
 *     orgAiBrain.ask() for real — the automation action and the AI call
 *     are two real, already-existing mechanisms wired together via the
 *     event bus both already use, not a new execution path.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _org = () => _try(() => require("./organizationService.cjs"));
const _automation = () => _try(() => require("./automationService.cjs"));
const _scheduler = () => _try(() => require("./orgAutomationScheduler.cjs"));
const _policy = () => _try(() => require("./policyService.cjs"));
const _brain = () => _try(() => require("./orgAiBrain.cjs"));
const _bus = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));

const AI_AUTOMATION_EVENT = "org_ai_automation_request";
const MAX_AI_RUNS = 500;
let _aiRuns = []; // in-memory ring of recent AI-triggered-by-automation results, for read-back

function _assertMember(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
}
function _assertCanManage(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "create_mission")) {
    const e = new Error("Forbidden — requires permission: create_mission");
    e.status = 403;
    throw e;
  }
}

// ── Workflows / triggers (real automationService, orgId-scoped) ─────────────

function listRules(orgId, accountId) {
  _assertMember(orgId, accountId);
  return _automation()?.getRules?.(orgId) || [];
}

function createRule(orgId, accountId, ruleSpec) {
  _assertCanManage(orgId, accountId);
  return _automation()?.createRule?.(orgId, ruleSpec, accountId);
}

/** Creates a rule whose action, when fired, triggers a real AI call —
 * built entirely from the existing, already-valid emit_event action type
 * plus the real event-bus wiring below, not a new action type. */
function createAiTriggeredRule(orgId, accountId, { name, description, trigger, conditions, aiPrompt, capability }) {
  _assertCanManage(orgId, accountId);
  if (!aiPrompt) throw new Error("aiPrompt required");
  return _automation()?.createRule?.(orgId, {
    name, description, trigger, conditions,
    action: { type: "emit_event", eventName: AI_AUTOMATION_EVENT, aiPrompt, capability: capability || "chat", orgId },
  }, accountId);
}

function fireRule(orgId, accountId, ruleId, context) {
  _assertCanManage(orgId, accountId);
  return _automation()?.fireRule?.(orgId, ruleId, context, accountId);
}

function getHistory(orgId, accountId, opts) {
  _assertMember(orgId, accountId);
  return _automation()?.getHistory?.(orgId, opts) || [];
}

function getStatistics(orgId, accountId) {
  _assertMember(orgId, accountId);
  return _automation()?.getStatistics?.(orgId) || {};
}

// ── Scheduled jobs (real node-cron dispatcher) ───────────────────────────────

function getSchedulerStatus() {
  return _scheduler()?.getStatus?.() || { running: false };
}

// ── Connector-gated action helper ────────────────────────────────────────────

/** Checked before any rule action that touches a connector — reuses the
 * real org connector-restriction policy from the prior Enterprise
 * mission, not a new restriction mechanism. */
function assertConnectorActionAllowed(orgId, connectorId) {
  return _policy()?.assertConnectorAllowed?.(orgId, connectorId);
}

// ── AI execution wiring (event-bus subscription, started once) ──────────────

let _subscribed = false;
function _handleAiAutomationEvent(event) {
  const { payload } = event;
  // automationService.cjs's own emit_event case only forwards
  // { workspaceId, ruleId, context, _ts } — it does NOT forward the
  // rule's action object itself (confirmed by reading _executeAction's
  // "emit_event" case), so aiPrompt/capability/orgId are never present
  // directly on the event payload. workspaceId IS the real orgId (the
  // established convention), and ruleId is present — so the rule itself
  // is looked back up here to recover the real aiPrompt/capability this
  // file stored on it at creation time via createAiTriggeredRule.
  const orgId = payload?.workspaceId;
  const ruleId = payload?.ruleId;
  if (!orgId || !ruleId) return;
  const automation = _automation();
  const rule = (automation?.getRules?.(orgId) || []).find(r => r.id === ruleId);
  const aiPrompt = rule?.action?.aiPrompt;
  if (!aiPrompt) return; // not an AI-triggered rule (or aiPrompt missing) — nothing for this handler to do
  const capability = rule?.action?.capability || "chat";

  // orgAiBrain.ask() requires real use_ai permission for whichever
  // accountId is passed — a synthetic "system:automation" identity has
  // none on any real org (confirmed: this was the exact bug caught during
  // verification, a real 403 from the real permission check). The rule's
  // own createdBy is a REAL account that already passed a real
  // create_mission check when the rule was created — running the rule's
  // own AI action on that same account's authority is the correct
  // attribution, not a permission bypass.
  const actingAccountId = rule.createdBy;
  if (!actingAccountId) return;

  const brain = _brain();
  if (!brain) return;
  brain.ask(orgId, actingAccountId, [{ role: "user", content: aiPrompt }], { capability })
    .then(result => {
      _aiRuns.push({ orgId, prompt: aiPrompt, result, ts: new Date().toISOString(), ok: true });
      if (_aiRuns.length > MAX_AI_RUNS) _aiRuns = _aiRuns.slice(-MAX_AI_RUNS);
    })
    .catch(err => {
      _aiRuns.push({ orgId, prompt: aiPrompt, error: err.message, ts: new Date().toISOString(), ok: false });
      if (_aiRuns.length > MAX_AI_RUNS) _aiRuns = _aiRuns.slice(-MAX_AI_RUNS);
    });
}

function startAiWiring() {
  if (_subscribed) return { ok: true, alreadySubscribed: true };
  const bus = _bus();
  if (!bus) return { ok: false, error: "runtimeEventBus unavailable" };
  bus.subscribe("orgAutomationCenter:ai", (event) => {
    if (event.type === AI_AUTOMATION_EVENT) _handleAiAutomationEvent(event);
  });
  _subscribed = true;
  return { ok: true, alreadySubscribed: false };
}

function getAiAutomationRuns(orgId, accountId, opts = {}) {
  _assertMember(orgId, accountId);
  const limit = opts.limit || 50;
  return _aiRuns.filter(r => r.orgId === orgId).slice(-limit).reverse();
}

// ── Full center view ──────────────────────────────────────────────────────────

function getFullCenter(orgId, accountId) {
  _assertMember(orgId, accountId);
  return {
    ok: true, orgId, generatedAt: new Date().toISOString(),
    rules: listRules(orgId, accountId),
    statistics: getStatistics(orgId, accountId),
    scheduler: getSchedulerStatus(),
    aiAutomationRuns: getAiAutomationRuns(orgId, accountId, { limit: 10 }),
  };
}

module.exports = {
  AI_AUTOMATION_EVENT,
  listRules, createRule, createAiTriggeredRule, fireRule, getHistory, getStatistics,
  getSchedulerStatus, assertConnectorActionAllowed,
  startAiWiring, getAiAutomationRuns, getFullCenter,
};
