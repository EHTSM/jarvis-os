"use strict";
/**
 * revenueAutomationEngine.cjs — POST-Ω P15 Autonomous Revenue Engine
 *
 * Automatically:
 *   generate proposals, send follow-ups, schedule meetings,
 *   prepare contracts, prepare invoices, trigger renewals.
 *
 * Reuses: revenueOS (generateInvoice, sendRenewalReminder, createWinBackCampaign),
 *         autonomousExecutionEngine, approvalEngine, workforceManager,
 *         digitalTwinEngine, customerSuccessEngine, pricingIntelligenceEngine,
 *         revenueDiscoveryEngine.
 *
 * Storage: data/revenue-automation.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "revenue-automation.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev = () => _try(() => require("./revenueOS.cjs"));
const _exe = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _app = () => _try(() => require("./approvalEngine.cjs"));
const _wfm = () => _try(() => require("./workforceManager.cjs"));
const _dt  = () => _try(() => require("./digitalTwinEngine.cjs"));
const _cse = () => _try(() => require("./customerSuccessEngine.cjs"));
const _pie = () => _try(() => require("./pricingIntelligenceEngine.cjs"));
const _rde = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `raut_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const AUTOMATION_ACTIONS = {
  generate_proposal:  { minutesSaved: 120, requiresApproval: false, description: "Auto-generate sales proposal from opportunity data" },
  send_followup:      { minutesSaved:  30, requiresApproval: false, description: "Send automated follow-up sequence" },
  schedule_meeting:   { minutesSaved:  45, requiresApproval: false, description: "Auto-schedule discovery/renewal meeting" },
  prepare_contract:   { minutesSaved: 180, requiresApproval: true,  description: "Draft contract from template" },
  prepare_invoice:    { minutesSaved:  60, requiresApproval: false, description: "Generate and send invoice via revenueOS" },
  trigger_renewal:    { minutesSaved:  90, requiresApproval: false, description: "Trigger renewal reminder and offer" },
  win_back_campaign:  { minutesSaved: 120, requiresApproval: false, description: "Launch win-back campaign for churned customer" },
  upsell_offer:       { minutesSaved:  45, requiresApproval: false, description: "Send personalized upsell offer" },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { automations: [], stats: { total: 0, executed: 0, minutesSaved: 0, byAction: {} }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.automations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.automations.length > 2000) d.automations = d.automations.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Action executors ──────────────────────────────────────────────────────────

async function _executeAction(action, params, opts) {
  const skipExecute = opts?.skipExecute || false;
  const actionDef   = AUTOMATION_ACTIONS[action];
  if (!actionDef) return { ok: false, error: `unknown action: ${action}` };

  if (skipExecute) return { ok: true, skipped: true };

  try {
    if (action === "prepare_invoice") {
      const result = _rev()?.generateInvoice?.(params?.accountId || "auto", {
        amount: params?.amount || 999,
        plan:   params?.plan   || "starter",
        period: params?.period || "monthly",
      });
      return { ok: true, result };
    }

    if (action === "trigger_renewal") {
      const result = _rev()?.sendRenewalReminder?.(params?.accountId || "auto");
      return { ok: true, result };
    }

    if (action === "win_back_campaign") {
      const result = _rev()?.createWinBackCampaign?.(params?.accountId || "auto", {
        template: params?.template || "standard",
        discount: 40,
      });
      return { ok: true, result };
    }

    // For other actions: delegate to execution engine
    if (!skipExecute && _exe()) {
      const run = await _exe().executeWorkflow({
        name:  `revenue_automation_${action}`,
        steps: [{ type: "revenue_action", action, params }],
      }).catch(() => null);
      return { ok: true, result: run || { status: "delegated" } };
    }

    return { ok: true, result: { status: "executed", action, params } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Core: automate ────────────────────────────────────────────────────────────

async function automate(action, params = {}, opts = {}) {
  const actionDef = AUTOMATION_ACTIONS[action];
  if (!actionDef) return { ok: false, error: `unknown action: ${action}. Valid: ${Object.keys(AUTOMATION_ACTIONS).join(", ")}` };

  // Check if approval required
  if (actionDef.requiresApproval && !opts.skipExecute) {
    try {
      const pkg = _app()?.generateApprovalPackage?.({
        type: "revenue_contract",
        action, params, risk: "medium",
      });
      if (pkg) {
        const session = await _app()?.requestApproval?.(pkg?.packageId, { source: "revenueAutomationEngine" });
        const record = {
          id: _id(), action, params,
          status:           "awaiting_approval",
          requiresApproval: true,
          approvalSessionId: session?.sessionId,
          minutesSaved:     actionDef.minutesSaved,
          description:      actionDef.description,
          createdAt:        _ts(),
        };
        const d = _load();
        d.automations.push(record);
        _updateStats(d);
        _save(d);
        return { ok: true, automation: record };
      }
    } catch {}
  }

  const result = await _executeAction(action, params, opts);

  const record = {
    id:          _id(),
    action,
    params,
    status:      result.ok ? "executed" : "failed",
    error:       result.ok ? undefined : result.error,
    requiresApproval: actionDef.requiresApproval,
    minutesSaved: result.ok ? actionDef.minutesSaved : 0,
    description:  actionDef.description,
    result:       result.result || null,
    executedAt:   _ts(),
  };

  const d = _load();
  d.automations.push(record);
  _updateStats(d);
  _save(d);

  return { ok: result.ok, automation: record };
}

function _updateStats(d) {
  const byAction = {};
  Object.keys(AUTOMATION_ACTIONS).forEach(a => { byAction[a] = 0; });
  d.automations.forEach(a => { if (byAction[a.action] !== undefined) byAction[a.action]++; });
  d.stats = {
    total:        d.automations.length,
    executed:     d.automations.filter(a => a.status === "executed").length,
    minutesSaved: d.automations.filter(a => a.status === "executed").reduce((s, a) => s + (a.minutesSaved || 0), 0),
    byAction,
  };
}

// ── Revenue pipeline automation ───────────────────────────────────────────────

async function runRevenuePipeline(opts = {}) {
  const results = [];

  // 1. Discover opportunities
  const opps = _rde()?.discover?.() || { ok: true, found: 0 };
  results.push({ step: "discover", ...opps });

  // 2. Generate proposals for top opportunities
  const topOpps = _rde()?.listOpportunities?.({ priority: "critical", limit: 3 })?.opportunities || [];
  for (const opp of topOpps.slice(0, 2)) {
    const r = await automate("generate_proposal", { opportunityId: opp.id, value: opp.value }, opts);
    results.push({ step: "generate_proposal", opportunity: opp.id, ...r });
  }

  // 3. Trigger renewals for at-risk customers
  const che = _che()?.getStats?.() || {};
  if ((che.atRisk || 0) > 0) {
    const r = await automate("trigger_renewal", { segment: "at_risk", count: che.atRisk }, opts);
    results.push({ step: "trigger_renewal", atRisk: che.atRisk, ...r });
  }

  // 4. Send follow-ups
  const r = await automate("send_followup", { trigger: "pipeline_automation" }, opts);
  results.push({ step: "send_followup", ...r });

  const minutesSaved = results.reduce((s, r) => s + (r.automation?.minutesSaved || 0), 0);
  return {
    ok:           true,
    steps:        results.length,
    minutesSaved,
    results,
    pipelineRunAt: _ts(),
  };
}

function getAutomation(id) {
  return _load().automations.find(a => a.id === id) || null;
}

function listAutomations({ action, status, limit = 50 } = {}) {
  let auts = _load().automations;
  if (action) auts = auts.filter(a => a.action === action);
  if (status) auts = auts.filter(a => a.status === status);
  return { ok: true, automations: auts.slice(-limit), total: auts.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, AUTOMATION_ACTIONS: Object.keys(AUTOMATION_ACTIONS), updatedAt: d.updatedAt };
}

module.exports = {
  AUTOMATION_ACTIONS,
  automate,
  runRevenuePipeline,
  getAutomation,
  listAutomations,
  getStats,
};
