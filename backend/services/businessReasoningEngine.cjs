"use strict";
/**
 * businessReasoningEngine.cjs — OBI X V1 Business Intelligence Evolution
 *
 * Multi-dimensional business reasoning over existing live data.
 * Dimensions: revenue, pricing, customer, marketing, sales, growth, retention
 *
 * Reuses: businessIntelligenceEngine, businessOrgState, revenueOS,
 *         growthOS, customerSuccess, crmService, analyticsService,
 *         executiveReasoning, founderProfileEngine
 *
 * Storage: data/business-reasoning.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "business-reasoning.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bie = () => _try(() => require("./businessIntelligenceEngine.cjs"));
const _bos = () => _try(() => require("./businessOrgState.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _gos = () => _try(() => require("./growthOS.cjs"));
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _crm = () => _try(() => require("./crmService.js"));
const _as  = () => _try(() => require("./analyticsService.cjs"));
const _er  = () => _try(() => require("./executiveReasoning.cjs"));
const _fp  = () => _try(() => require("./founderProfileEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `br_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Dimension reasoning functions ─────────────────────────────────────────────

function _reasonRevenue(revenueData, kpis) {
  const mrr     = revenueData?.mrr       || kpis?.mrr?.value    || 0;
  const arr     = revenueData?.arr       || mrr * 12;
  const growth  = revenueData?.growth    || kpis?.growth?.value || 0;
  const churn   = revenueData?.churnRate || kpis?.churn?.value  || 0;

  let score    = 70;
  const issues = [];

  if (mrr < 1000)              { score -= 20; issues.push({ type: "low_mrr",          severity: "high",   description: `MRR ${mrr} below minimum viable threshold` }); }
  if (growth < 5)              { score -= 15; issues.push({ type: "slow_growth",       severity: "high",   description: `Revenue growth ${growth}% — needs acceleration` }); }
  if (growth >= 20)            { score += 15; }
  if (churn > 10)              { score -= 20; issues.push({ type: "high_churn",        severity: "critical", description: `Churn ${churn}% eroding revenue base` }); }
  if (churn <= 3 && mrr > 0)  { score += 10; }
  if (arr > 100000)            { score += 10; }

  return { score: Math.max(0, Math.min(100, score)), mrr, arr, growth, churn, issues };
}

function _reasonPricing(deals, revenueData) {
  const dealList  = deals?.deals || [];
  const avgDeal   = dealList.length > 0 ? dealList.reduce((s, d) => s + (d.value || 0), 0) / dealList.length : 0;
  const wonDeals  = dealList.filter(d => d.stage === "won").length;
  const lostDeals = dealList.filter(d => d.stage === "lost").length;
  const winRate   = (wonDeals + lostDeals) > 0 ? (wonDeals / (wonDeals + lostDeals)) * 100 : 50;

  let score    = 70;
  const issues = [];

  if (winRate < 20)  { score -= 20; issues.push({ type: "low_win_rate",    severity: "high",   description: `Win rate ${winRate.toFixed(0)}% — pricing or positioning misaligned` }); }
  if (winRate > 50)  { score += 15; }
  if (avgDeal < 100) { score -= 10; issues.push({ type: "low_deal_value",  severity: "medium", description: `Average deal ${avgDeal.toFixed(0)} — pricing too low` }); }
  if (avgDeal > 500) { score += 10; }

  return { score: Math.max(0, Math.min(100, score)), avgDeal: +avgDeal.toFixed(2), winRate: +winRate.toFixed(1), issues };
}

function _reasonCustomer(csOverview, crmStats) {
  const health    = csOverview?.avgHealth    || 70;
  const riskCount = csOverview?.riskAlerts   || 0;
  const total     = crmStats?.total          || 0;
  const nps       = csOverview?.nps          || 0;

  let score    = health;
  const issues = [];

  if (riskCount > 3)  { score -= 15; issues.push({ type: "churn_risk_cluster", severity: "high",   description: `${riskCount} customers at churn risk` }); }
  if (health < 60)    { score -= 10; issues.push({ type: "poor_customer_health", severity: "high",  description: `Average customer health ${health} below threshold` }); }
  if (nps < 20)       { score -= 10; issues.push({ type: "low_nps",             severity: "medium", description: `NPS score ${nps} indicates dissatisfaction` }); }
  if (nps > 50)       { score += 10; }
  if (total < 5)      { score -= 5;  issues.push({ type: "low_customer_base",   severity: "medium", description: "Customer base too small for reliable metrics" }); }

  return { score: Math.max(0, Math.min(100, score)), health, riskCount, total, nps, issues };
}

function _reasonMarketing(growthData, campaigns) {
  const emailList   = campaigns?.emails      || [];
  const smsList     = campaigns?.sms         || [];
  const waList      = campaigns?.whatsapp    || [];
  const totalCamps  = emailList.length + smsList.length + waList.length;
  const overallROI  = growthData?.roi        || 0;

  let score    = 65;
  const issues = [];

  if (totalCamps === 0)  { score -= 20; issues.push({ type: "no_campaigns",      severity: "high",   description: "No active marketing campaigns" }); }
  if (totalCamps >= 5)   { score += 15; }
  if (overallROI < 0)    { score -= 15; issues.push({ type: "negative_roi",      severity: "critical", description: `Marketing ROI ${overallROI}% — campaigns losing money` }); }
  if (overallROI >= 100) { score += 15; }

  return { score: Math.max(0, Math.min(100, score)), totalCamps, overallROI, issues };
}

function _reasonSales(deals, pipeline) {
  const dealList      = deals?.deals         || [];
  const openDeals     = dealList.filter(d => !["won","lost"].includes(d.stage)).length;
  const wonDeals      = dealList.filter(d => d.stage === "won").length;
  const pipelineValue = pipeline?.totalValue || dealList.reduce((s, d) => s + (d.value || 0), 0);
  const velocity      = wonDeals > 0 ? pipelineValue / wonDeals : 0;

  let score    = 65;
  const issues = [];

  if (openDeals === 0)      { score -= 15; issues.push({ type: "empty_pipeline",   severity: "high",   description: "No deals in pipeline" }); }
  if (openDeals >= 10)      { score += 10; }
  if (pipelineValue < 1000) { score -= 10; issues.push({ type: "thin_pipeline",    severity: "medium", description: `Pipeline value ${pipelineValue} below target` }); }
  if (wonDeals === 0 && dealList.length > 5) {
    score -= 15;
    issues.push({ type: "no_closed_deals", severity: "high", description: "Deals not closing — sales process blocker" });
  }

  return { score: Math.max(0, Math.min(100, score)), openDeals, wonDeals, pipelineValue, velocity, issues };
}

function _reasonGrowth(analytics, growthData) {
  const missions    = analytics?.missionTrends?.total  || 0;
  const automations = growthData?.automations           || 0;
  const audiences   = growthData?.audiences             || 0;

  let score    = 65;
  const issues = [];

  if (automations === 0)  { score -= 15; issues.push({ type: "no_automations",  severity: "high",   description: "No growth automations active" }); }
  if (automations >= 5)   { score += 10; }
  if (audiences === 0)    { score -= 10; issues.push({ type: "no_audiences",    severity: "medium", description: "No audience segments defined" }); }
  if (audiences >= 3)     { score += 10; }
  if (missions >= 10)     { score += 5;  }

  return { score: Math.max(0, Math.min(100, score)), missions, automations, audiences, issues };
}

function _reasonRetention(churnRisks, csOverview) {
  const risks    = churnRisks?.risks?.length || churnRisks?.length || 0;
  const avgHealth= csOverview?.avgHealth     || 70;
  const playbooks= csOverview?.playbooks     || 0;

  let score    = 70;
  const issues = [];

  if (risks > 5)       { score -= 20; issues.push({ type: "mass_churn_risk", severity: "critical", description: `${risks} customers at churn risk — immediate action required` }); }
  if (risks > 2)       { score -= 10; issues.push({ type: "churn_signals",   severity: "high",     description: `${risks} churn risk signals detected` }); }
  if (avgHealth < 60)  { score -= 10; issues.push({ type: "low_retention",   severity: "high",     description: "Customer health trending toward churn" }); }
  if (avgHealth >= 80) { score += 10; }

  return { score: Math.max(0, Math.min(100, score)), risks, avgHealth, playbooks, issues };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { analyses: [], stats: { total: 0, avgScore: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.analyses.length > 300) d.analyses = d.analyses.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main analyze ──────────────────────────────────────────────────────────────

async function analyze(context, { revenueData, dealsData, campaignData } = {}) {
  context = context || "current_business";

  // Pull live data from existing services
  const kpis      = _try(() => _bos()?.getAllKpis?.())               || {};
  const pipeline  = _try(() => _bos()?.getPipelineStats?.())         || {};
  const deals     = dealsData   || _try(() => _bos()?.listDeals?.()) || {};
  const biRaw     = _try(() => _bie()?.getRecommendations?.())       || {};
  const recs      = Array.isArray(biRaw) ? biRaw : (biRaw.recommendations || []);
  const csHealth  = _try(() => _cs()?.getOverview?.())               || {};
  const crmStats  = _try(() => _crm()?.getStats?.())                 || {};
  const campaigns = campaignData || {};
  const analytics = _try(() => _as()?.getMissionTrends?.())          || {};
  const revDash   = revenueData  || _try(() => _rev()?.getRevenueDashboard?.()) || {};
  const churnList = _try(() => _rev()?.listChurnRisks?.())           || {};

  const dims = {
    revenue:   _reasonRevenue(revDash, kpis),
    pricing:   _reasonPricing(deals, revDash),
    customer:  _reasonCustomer(csHealth, crmStats),
    marketing: _reasonMarketing({ roi: 0 }, campaigns),
    sales:     _reasonSales(deals, pipeline),
    growth:    _reasonGrowth(analytics, {}),
    retention: _reasonRetention(churnList, csHealth),
  };

  const weights = { revenue: 0.25, customer: 0.20, sales: 0.15, retention: 0.15, growth: 0.10, marketing: 0.10, pricing: 0.05 };
  const overall = Object.entries(weights).reduce((s, [k, w]) => s + (dims[k]?.score || 70) * w, 0);

  const allIssues = Object.values(dims).flatMap(d => d.issues || []);
  const insights  = allIssues
    .sort((a, b) => (a.severity === "critical" ? 0 : a.severity === "high" ? 1 : 2) - (b.severity === "critical" ? 0 : b.severity === "high" ? 1 : 2))
    .slice(0, 5);

  const entry = {
    id:           _id(),
    context,
    dimensions:   dims,
    overallScore: +overall.toFixed(1),
    insights,
    biRecommendations: recs.length,
    analyzedAt:   _ts(),
  };

  const d = _load();
  d.analyses.push(entry);
  d.stats.total++;
  d.stats.avgScore = +(d.analyses.slice(-20).reduce((s, a) => s + a.overallScore, 0) / Math.min(d.analyses.length, 20)).toFixed(1);
  _save(d);

  return { ok: true, analysis: entry };
}

function getAnalysis(id)  { return _load().analyses.find(a => a.id === id) || null; }
function listAnalyses({ limit = 50 } = {}) {
  const d = _load();
  return { ok: true, analyses: d.analyses.slice(-limit), total: d.analyses.length };
}
function getStats() { return { ..._load().stats, updatedAt: _load().updatedAt }; }

module.exports = { analyze, getAnalysis, listAnalyses, getStats };
