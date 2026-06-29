"use strict";
/**
 * revenueDiscoveryEngine.cjs — POST-Ω P15 Autonomous Revenue Engine
 *
 * Automatically discovers revenue opportunities from existing platform data:
 *   leads, upsell opportunities, cross-sell opportunities,
 *   dormant customers, partner opportunities.
 *
 * Reuses: revenueOS, customerHealthEngine, customerJourneyEngine,
 *         customerSuccessEngine, analyticsService, businessReasoningEngine,
 *         knowledgeFederationEngine, companyLifecycleEngine.
 *
 * Storage: data/revenue-discovery.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "revenue-discovery.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev = () => _try(() => require("./revenueOS.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _cse = () => _try(() => require("./customerSuccessEngine.cjs"));
const _ana = () => _try(() => require("./analyticsService.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _kfe = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _clf = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _mce = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _ppe = () => _try(() => require("./productPlannerEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `rdsc_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const OPPORTUNITY_TYPES = [
  "upsell",           // upgrade existing customer to higher plan
  "cross_sell",       // sell complementary product/service
  "dormant_revival",  // re-engage inactive customer
  "lead_conversion",  // convert trial → paid
  "expansion",        // expand usage within existing account
  "partner",          // identify partner / referral opportunity
  "win_back",         // recover churned customer
];

const OPPORTUNITY_PRIORITY = { critical: 4, high: 3, medium: 2, low: 1 };

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { opportunities: [], stats: { total: 0, byType: {}, totalValue: 0, newCount: 0 }, lastScan: null, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.opportunities)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.opportunities.length > 2000) d.opportunities = d.opportunities.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Discovery runners ─────────────────────────────────────────────────────────

function _discoverUpsells() {
  const opps = [];
  try {
    const signals = _rev()?.listUpgradeSignals?.({ limit: 100 }) || [];
    const plans   = _rev()?.PLANS || {};
    const planKeys = Object.keys(plans);

    signals.forEach(sig => {
      const currTier = plans[sig.plan]?.tier ?? 0;
      const nextPlan = planKeys.find(k => (plans[k]?.tier || 0) === currTier + 1);
      const mrrDelta = nextPlan ? (plans[nextPlan].priceMonthly - (plans[sig.plan]?.priceMonthly || 0)) : 0;
      opps.push({
        id: _id(), type: "upsell",
        title:    `Upsell: ${sig.accountId || sig.id} → ${nextPlan || "higher tier"}`,
        signal:   sig.signalId || sig.id,
        value:    mrrDelta * 12,
        mrrDelta,
        priority: mrrDelta > 5000 ? "critical" : mrrDelta > 2000 ? "high" : "medium",
        context:  { currentPlan: sig.plan, suggestedPlan: nextPlan, signalWeight: sig.weight },
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return opps;
}

function _discoverDormant() {
  const opps = [];
  try {
    const risks = _rev()?.listChurnRisks?.({ limit: 50 }) || [];
    risks.forEach(risk => {
      const plan  = risk.plan || "starter";
      const plans = _rev()?.PLANS || {};
      const mrr   = plans[plan]?.priceMonthly || 999;
      opps.push({
        id: _id(), type: "dormant_revival",
        title:    `Revival: ${risk.accountId || risk.id} (${risk.riskLevel || "at-risk"})`,
        signal:   "churn_risk",
        value:    mrr * 12,
        mrrDelta: 0,
        priority: (risk.score || 0) > 70 ? "critical" : "high",
        context:  { riskScore: risk.score, riskLevel: risk.riskLevel, signals: risk.signals },
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return opps;
}

function _discoverLeadConversions() {
  const opps = [];
  try {
    const exec = _rev()?.getExecutiveRevenueDashboard?.() || {};
    const trialCount = exec.conversion?.trialCount || 0;
    const convRate   = (exec.conversion?.trialConversionRate || 2) / 100;
    const plans      = _rev()?.PLANS || {};
    const starterMRR = plans.starter?.priceMonthly || 999;

    if (trialCount > 0) {
      const expectedConversions = Math.round(trialCount * convRate);
      const expectedMRR         = expectedConversions * starterMRR;
      opps.push({
        id: _id(), type: "lead_conversion",
        title:    `Convert ${trialCount} trial users (${expectedConversions} expected)`,
        signal:   "trial_cohort",
        value:    expectedMRR * 12,
        mrrDelta: expectedMRR,
        priority: trialCount > 20 ? "critical" : "high",
        context:  { trialCount, conversionRate: convRate, expectedConversions, expectedMRR },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return opps;
}

function _discoverExpansion() {
  const opps = [];
  try {
    const healthRecs = _che()?.listHealthRecords?.({ limit: 100 }) || { records: [] };
    const highHealth = (healthRecs.records || []).filter(r => (r.score || 0) >= 70);
    const plans = _rev()?.PLANS || {};

    highHealth.slice(0, 10).forEach(rec => {
      const plan      = rec.plan || "starter";
      const currMRR   = plans[plan]?.priceMonthly || 999;
      const planKeys  = Object.keys(plans);
      const currTier  = plans[plan]?.tier ?? 2;
      const nextPlan  = planKeys.find(k => (plans[k]?.tier || 0) === currTier + 1);
      const nextMRR   = nextPlan ? plans[nextPlan].priceMonthly : currMRR * 1.5;

      opps.push({
        id: _id(), type: "expansion",
        title:    `Expansion: healthy customer ${rec.accountId || rec.id}`,
        signal:   "high_health_score",
        value:    (nextMRR - currMRR) * 12,
        mrrDelta: nextMRR - currMRR,
        priority: rec.score >= 85 ? "high" : "medium",
        context:  { healthScore: rec.score, currentPlan: plan, suggestedPlan: nextPlan },
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return opps;
}

function _discoverCrossSell() {
  const opps = [];
  try {
    const marketAssets = _mce()?.listAssets?.({ status: "published", limit: 20 })?.assets || [];
    const productPlans = _ppe()?.listPlans?.({ limit: 5 })?.plans || [];

    if (marketAssets.length > 0 && productPlans.length > 0) {
      opps.push({
        id: _id(), type: "cross_sell",
        title:    `Cross-sell: ${marketAssets.length} marketplace assets to active customers`,
        signal:   "marketplace_assets_available",
        value:    marketAssets.length * 500 * 12,
        mrrDelta: marketAssets.length * 500,
        priority: "medium",
        context:  { availableAssets: marketAssets.length, productPlans: productPlans.length },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return opps;
}

function _discoverWinBack() {
  const opps = [];
  try {
    const surveys = _rev()?.listExitSurveys?.({ limit: 20 }) || [];
    if (surveys.length > 0) {
      const plans   = _rev()?.PLANS || {};
      const avgMRR  = plans.starter?.priceMonthly || 999;
      opps.push({
        id: _id(), type: "win_back",
        title:    `Win-back: ${surveys.length} churned customers with exit surveys`,
        signal:   "exit_survey_available",
        value:    surveys.length * avgMRR * 12 * 0.2, // 20% win-back rate
        mrrDelta: Math.round(surveys.length * avgMRR * 0.2),
        priority: surveys.length > 5 ? "high" : "medium",
        context:  { churned: surveys.length, winBackRate: 0.2 },
        discoveredAt: _ts(),
      });
    }
  } catch {}
  return opps;
}

// ── Core: discover ────────────────────────────────────────────────────────────

function discover() {
  const all = [
    ..._discoverUpsells(),
    ..._discoverDormant(),
    ..._discoverLeadConversions(),
    ..._discoverExpansion(),
    ..._discoverCrossSell(),
    ..._discoverWinBack(),
  ];

  const d = _load();
  const before = d.opportunities.length;
  const dedup  = new Map(d.opportunities.map(o => [`${o.type}:${o.signal}:${o.title}`, o]));
  all.forEach(o => dedup.set(`${o.type}:${o.signal}:${o.title}`, o));
  d.opportunities = [...dedup.values()].sort((a, b) =>
    (OPPORTUNITY_PRIORITY[b.priority] || 0) - (OPPORTUNITY_PRIORITY[a.priority] || 0)
  );

  const byType = {};
  OPPORTUNITY_TYPES.forEach(t => { byType[t] = 0; });
  d.opportunities.forEach(o => { if (byType[o.type] !== undefined) byType[o.type]++; });
  const totalValue = d.opportunities.reduce((s, o) => s + (o.value || 0), 0);
  d.stats = { total: d.opportunities.length, byType, totalValue, newCount: all.length };
  d.lastScan = _ts();
  _save(d);

  return {
    ok: true, found: all.length, total: d.opportunities.length,
    totalValue, byType,
    topOpportunities: d.opportunities.slice(0, 5),
  };
}

function getOpportunity(id) {
  return _load().opportunities.find(o => o.id === id) || null;
}

function listOpportunities({ type, priority, minValue, limit = 50 } = {}) {
  let opps = _load().opportunities;
  if (type)     opps = opps.filter(o => o.type === type);
  if (priority) opps = opps.filter(o => o.priority === priority);
  if (minValue) opps = opps.filter(o => (o.value || 0) >= minValue);
  return { ok: true, opportunities: opps.slice(0, limit), total: opps.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, OPPORTUNITY_TYPES, lastScan: d.lastScan, updatedAt: d.updatedAt };
}

module.exports = {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_PRIORITY,
  discover,
  getOpportunity,
  listOpportunities,
  getStats,
};
