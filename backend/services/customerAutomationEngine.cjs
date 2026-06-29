"use strict";
/**
 * customerAutomationEngine.cjs — POST-Ω P11 Autonomous Customer Organization
 *
 * Automatically executes customer lifecycle automations:
 *   follow-up, reminder, escalation, meeting scheduling,
 *   proposal generation, onboarding prep, documentation,
 *   churn detection, retention workflows.
 *
 * Reuses: autonomousExecutionEngine, approvalEngine, workspaceMesh,
 *         revenueOS, customerSuccess, continuousLearningEngine,
 *         customerHealthEngine, customerJourneyEngine, customerSuccessEngine.
 *
 * Storage: data/customer-automations.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "customer-automations.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _exe = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _apr = () => _try(() => require("./approvalEngine.cjs"));
const _wm  = () => _try(() => require("./workspaceMesh.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _cse = () => _try(() => require("./customerSuccessEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ca_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Automation types ──────────────────────────────────────────────────────────

const AUTOMATION_TYPES = {
  follow_up:            { label: "Follow-up",            minutesSaved: 20, requiresApproval: false },
  reminder:             { label: "Reminder",             minutesSaved: 5,  requiresApproval: false },
  escalation:           { label: "Escalation",           minutesSaved: 30, requiresApproval: true  },
  schedule_meeting:     { label: "Schedule Meeting",     minutesSaved: 25, requiresApproval: false },
  generate_proposal:    { label: "Generate Proposal",    minutesSaved: 60, requiresApproval: true  },
  prepare_onboarding:   { label: "Prepare Onboarding",  minutesSaved: 45, requiresApproval: false },
  prepare_documentation:{ label: "Prepare Documentation",minutesSaved: 40, requiresApproval: false },
  detect_churn:         { label: "Detect Churn",        minutesSaved: 15, requiresApproval: false },
  retention_workflow:   { label: "Retention Workflow",  minutesSaved: 90, requiresApproval: true  },
  renewal_reminder:     { label: "Renewal Reminder",    minutesSaved: 20, requiresApproval: false },
  upsell_outreach:      { label: "Upsell Outreach",     minutesSaved: 35, requiresApproval: false },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      automations: [],
      stats: { total: 0, executed: 0, pending: 0, failed: 0, minutesSaved: 0, churnInterventions: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.automations.length > 500) d.automations = d.automations.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _updateStats(d) {
  const executed = d.automations.filter(a => a.status === "executed").length;
  const pending  = d.automations.filter(a => a.status === "pending").length;
  const failed   = d.automations.filter(a => a.status === "failed").length;
  const totalMS  = d.automations.filter(a => a.status === "executed")
                    .reduce((s, a) => s + (AUTOMATION_TYPES[a.type]?.minutesSaved || 0), 0);
  const churnI   = d.automations.filter(a => a.type === "retention_workflow" || a.type === "detect_churn").length;
  d.stats = { total: d.automations.length, executed, pending, failed, minutesSaved: totalMS, churnInterventions: churnI };
}

// ── Core automation executor ──────────────────────────────────────────────────

async function trigger(customerId, type, { context = {}, skipExecute = false } = {}) {
  if (!customerId) return { ok: false, error: "customerId required" };
  if (!AUTOMATION_TYPES[type]) return { ok: false, error: `unknown automation type: ${type}` };

  const def     = AUTOMATION_TYPES[type];
  const health  = _try(() => _che()?.getHealthRecord?.(customerId)) || null;
  const journey = _try(() => _cje()?.getJourney?.(customerId))     || null;

  const id   = _id();
  const auto = {
    id, customerId, type,
    label:       def.label,
    status:      "pending",
    context:     { healthScore: health?.overall, stage: journey?.stage, ...context },
    requiresApproval: def.requiresApproval,
    minutesSaved: def.minutesSaved,
    createdAt:   _ts(),
    updatedAt:   _ts(),
  };

  const d = _load();
  d.automations.push(auto);

  if (!skipExecute) {
    try {
      if (def.requiresApproval) {
        // Wire to approval engine for high-stakes automations
        _try(() => _apr()?.requestApproval?.({
          context:     `customer_automation_${type}_${customerId}`,
          description: `${def.label} for customer ${customerId}`,
          data:        auto,
          source:      "customerAutomationEngine",
        }));
        auto.status = "awaiting_approval";
      } else {
        // Execute immediately via execution engine
        _try(() => _exe()?.executeWorkflow?.({
          workflowId:  `customer_${type}`,
          context:     { customerId, ...context, healthScore: health?.overall, stage: journey?.stage },
          source:      "customerAutomationEngine",
        }));
        auto.status      = "executed";
        auto.executedAt  = _ts();
        // Record outcome in CLE
        _try(() => _cle()?.recordOutcome?.({
          context: `customer_automation_${customerId}`,
          outcome: "success",
          type:    `automation_${type}`,
        }));
      }
    } catch (e) {
      auto.status = "failed";
      auto.error  = e.message;
    }
  } else {
    auto.status = "executed"; // test mode
    auto.executedAt = _ts();
  }

  auto.updatedAt = _ts();
  const idx = d.automations.findIndex(a => a.id === id);
  if (idx >= 0) d.automations[idx] = auto;

  _updateStats(d);
  _save(d);

  return { ok: true, automation: auto };
}

// ── Automatic detection + triggering ─────────────────────────────────────────

async function runAutomationScan(opts = {}) {
  const { skipExecute = false } = opts;
  const journeys = _try(() => _cje()?.listJourneys?.({ limit: 200 }))?.journeys || [];
  const triggered = [];

  for (const journey of journeys) {
    const cid    = journey.customerId;
    const health = _try(() => _che()?.getHealthRecord?.(cid)) || null;
    const score  = health?.overall || 0;
    const stage  = journey.stage;

    // Churn risk → retention workflow
    if (journey.churnRisk === "critical" || (health?.risk === "critical" && score < 30)) {
      const r = await trigger(cid, "retention_workflow", { context: { reason: "critical_health" }, skipExecute });
      triggered.push(r.automation);
    }
    // Onboarding stage → prepare onboarding docs
    else if (stage === "onboarding" && score < 60) {
      const r = await trigger(cid, "prepare_onboarding", { context: { stage }, skipExecute });
      triggered.push(r.automation);
    }
    // High health in adoption → upsell outreach
    else if (stage === "adoption" && score >= 75) {
      const r = await trigger(cid, "upsell_outreach", { context: { stage }, skipExecute });
      triggered.push(r.automation);
    }
    // Renewal upcoming within 30d → renewal reminder
    else if (stage === "renewal" && journey.renewalDate) {
      const daysLeft = Math.round((new Date(journey.renewalDate).getTime() - Date.now()) / 86400000);
      if (daysLeft > 0 && daysLeft < 30) {
        const r = await trigger(cid, "renewal_reminder", { context: { daysLeft }, skipExecute });
        triggered.push(r.automation);
      }
    }
  }

  return { ok: true, scanned: journeys.length, triggered: triggered.length, automations: triggered };
}

function getAutomation(id) { return _load().automations.find(a => a.id === id) || null; }

function listAutomations({ customerId, type, status, limit = 50 } = {}) {
  let list = _load().automations;
  if (customerId) list = list.filter(a => a.customerId === customerId);
  if (type)       list = list.filter(a => a.type       === type);
  if (status)     list = list.filter(a => a.status     === status);
  return { ok: true, automations: list.slice(0, limit) };
}

function getStats() { return { ...(_load().stats), AUTOMATION_TYPES: Object.keys(AUTOMATION_TYPES), updatedAt: _load().updatedAt }; }

module.exports = { AUTOMATION_TYPES, trigger, runAutomationScan, getAutomation, listAutomations, getStats };
