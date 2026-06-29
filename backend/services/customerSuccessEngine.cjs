"use strict";
/**
 * customerSuccessEngine.cjs — POST-Ω P11 Autonomous Customer Organization
 *
 * Generates success plans automatically.
 * Predicts: churn, expansion, renewal, satisfaction, support demand, upsell.
 *
 * Reuses: customerSuccess, revenueOS, continuousLearningEngine,
 *         businessIntelligenceDashboard, customerHealthEngine, customerJourneyEngine.
 *
 * Storage: data/customer-success-plans.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "customer-success-plans.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _obi = () => _try(() => require("./businessIntelligenceDashboard.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `csp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { plans: [], predictions: [], stats: { total: 0, churnPrevented: 0, expansionsTriggered: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.plans.length       > 500) d.plans       = d.plans.slice(-500);
  if (d.predictions.length > 500) d.predictions = d.predictions.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Predictions ───────────────────────────────────────────────────────────────

function _predictChurn(health, journey) {
  const risk = health?.risk || "medium";
  const prob = risk === "critical" ? 0.85 : risk === "high" ? 0.60 : risk === "medium" ? 0.30 : 0.08;
  return {
    probability: prob,
    severity:    prob > 0.7 ? "critical" : prob > 0.4 ? "high" : prob > 0.2 ? "medium" : "low",
    signals:     health?.alerts?.map(a => a.code) || [],
    timeframe:   prob > 0.7 ? "7 days" : prob > 0.4 ? "30 days" : "90 days",
  };
}

function _predictExpansion(health, journey, revHealth) {
  const score     = health?.overall || 0;
  const stage     = journey?.stage  || "lead";
  const plan      = revHealth?.plan || "trial";
  const isPaid    = plan !== "trial" && plan !== "trialing";
  const inAdoption= ["adoption","activation","expansion"].includes(stage);
  const prob = (score >= 75 && isPaid && inAdoption) ? 0.70
             : (score >= 60 && isPaid) ? 0.45
             : 0.15;
  return {
    probability: prob,
    upsellSignal: prob > 0.5 ? "ready_to_expand" : prob > 0.3 ? "monitor" : "not_ready",
    recommendedPlan: plan === "pro" ? "enterprise" : plan === "starter" ? "pro" : null,
    timeframe: prob > 0.5 ? "this_week" : "this_month",
  };
}

function _predictRenewal(health, revHealth) {
  const renewalDate = revHealth?.renewalDate;
  const score       = health?.overall || 0;
  const daysToRenew = renewalDate
    ? Math.round((new Date(renewalDate).getTime() - Date.now()) / 86400000)
    : 90;
  const prob = score >= 70 ? 0.88 : score >= 50 ? 0.65 : score >= 30 ? 0.40 : 0.20;
  return {
    probability: prob,
    daysToRenewal: daysToRenew,
    renewalDate: renewalDate || null,
    action: prob < 0.5 && daysToRenew < 30 ? "immediate_intervention"
          : prob < 0.7 ? "renewal_campaign"
          : "standard_renewal",
  };
}

function _predictSatisfaction(health, journey) {
  const score = health?.overall || 0;
  const nps   = score >= 80 ? "promoter" : score >= 50 ? "passive" : "detractor";
  return { estimatedNPS: nps, score, probability: +(score / 100).toFixed(2) };
}

function _predictSupportDemand(health) {
  const risk   = health?.risk || "medium";
  const demand = risk === "critical" ? "high" : risk === "high" ? "medium" : "low";
  const tickets= risk === "critical" ? 3 : risk === "high" ? 2 : 0;
  return { demand, estimatedTicketsNext30d: tickets };
}

function _predictUpsell(health, journey) {
  const stage = journey?.stage || "lead";
  const score = health?.overall || 0;
  const ready = score > 70 && ["adoption","expansion","renewal","advocacy"].includes(stage);
  return {
    ready,
    confidence: ready ? 0.72 : 0.25,
    bestTiming: ready ? "next_touchpoint" : "post_adoption",
    opportunity: ready ? "premium_features" : null,
  };
}

// ── Success plan generator ────────────────────────────────────────────────────

function generateSuccessPlan(customerId) {
  const health    = _try(() => _che()?.getHealthRecord?.(customerId)) || null;
  const journey   = _try(() => _cje()?.getJourney?.(customerId))     || null;
  const revHealth = _try(() => _rev()?.getCustomerHealth?.(customerId)) || null;
  const csHealth  = _try(() => _cs()?.getHealth?.(customerId))        || null;
  const tasks     = csHealth?.tasks || _cs()?.SUCCESS_TASKS || [];

  const predictions = {
    churn:         _predictChurn(health, journey),
    expansion:     _predictExpansion(health, journey, revHealth),
    renewal:       _predictRenewal(health, revHealth),
    satisfaction:  _predictSatisfaction(health, journey),
    supportDemand: _predictSupportDemand(health),
    upsell:        _predictUpsell(health, journey),
  };

  const stage   = journey?.stage || "onboarding";
  const actions = [];

  if (predictions.churn.probability > 0.6)
    actions.push({ priority: "critical", type: "intervention",  action: "Schedule emergency check-in call within 24h", automation: true });
  if (predictions.renewal.probability < 0.6 && predictions.renewal.daysToRenewal < 30)
    actions.push({ priority: "high",     type: "renewal",       action: "Send renewal proposal with discount offer",   automation: true });
  if (predictions.expansion.probability > 0.5)
    actions.push({ priority: "high",     type: "upsell",        action: `Propose upgrade to ${predictions.expansion.recommendedPlan || "next tier"}`, automation: false });
  if (stage === "onboarding")
    actions.push({ priority: "high",     type: "onboarding",    action: "Send onboarding checklist and schedule kickoff", automation: true });
  if (stage === "activation")
    actions.push({ priority: "medium",   type: "activation",    action: "Guide to first value moment — assign CSM task", automation: true });
  if (predictions.supportDemand.demand === "high")
    actions.push({ priority: "medium",   type: "support",       action: "Pre-emptively reach out before ticket opens",  automation: true });

  // Add outstanding success tasks
  tasks.slice(0, 3).forEach(t =>
    actions.push({ priority: "low", type: "success_task", action: t.label, taskId: t.id, automation: false })
  );

  const id   = _id();
  const plan = {
    id, customerId,
    stage, healthScore: health?.overall || 0,
    predictions, actions,
    playbook:    revHealth?.activePlaybook || null,
    generatedAt: _ts(),
  };

  const d = _load();
  const existing = d.plans.findIndex(p => p.customerId === customerId);
  if (existing >= 0) d.plans[existing] = plan;
  else d.plans.push(plan);
  d.stats.total = d.plans.length;
  _save(d);

  return { ok: true, plan };
}

function getPlan(customerId) { return _load().plans.find(p => p.customerId === customerId) || null; }

function listPlans({ stage, limit = 50 } = {}) {
  let plans = _load().plans;
  if (stage) plans = plans.filter(p => p.stage === stage);
  return { ok: true, plans: plans.slice(0, limit) };
}

function predict(customerId) {
  const health  = _try(() => _che()?.getHealthRecord?.(customerId)) || {};
  const journey = _try(() => _cje()?.getJourney?.(customerId))     || {};
  const revH    = _try(() => _rev()?.getCustomerHealth?.(customerId)) || {};
  return {
    ok: true,
    customerId,
    churn:         _predictChurn(health, journey),
    expansion:     _predictExpansion(health, journey, revH),
    renewal:       _predictRenewal(health, revH),
    satisfaction:  _predictSatisfaction(health, journey),
    supportDemand: _predictSupportDemand(health),
    upsell:        _predictUpsell(health, journey),
  };
}

function recordOutcome(customerId, { outcome, type }) {
  _try(() => _cle()?.recordOutcome?.({ context: `customer_success_${customerId}`, outcome, type }));
  const d = _load();
  if (outcome === "churn_prevented")    d.stats.churnPrevented++;
  if (outcome === "expansion_executed") d.stats.expansionsTriggered++;
  _save(d);
  return { ok: true, recorded: true };
}

function getStats() { return { ...(_load().stats), updatedAt: _load().updatedAt }; }

module.exports = { generateSuccessPlan, getPlan, listPlans, predict, recordOutcome, getStats };
