"use strict";
/**
 * investmentAnalysisEngine.cjs — POST-Ω P16 Autonomous Investment Engine
 *
 * Analyzes: ROI, CAC, LTV, payback period, cash efficiency, opportunity cost.
 *
 * Reuses: revenueOS (PLAN_LTV, PLANS), customerHealthEngine, revenueDiscoveryEngine,
 *         revenueOptimizationEngine, revenueForecastEngine, analyticsService,
 *         workforceManager, capitalAllocationEngine, businessReasoningEngine,
 *         engineeringBenchmarkEngine.
 *
 * Storage: data/investment-analysis.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "investment-analysis.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _rde  = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _roe  = () => _try(() => require("./revenueOptimizationEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _cal  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ian_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const ANALYSIS_TYPES = [
  "roi",             // return on investment
  "cac",             // customer acquisition cost
  "ltv",             // lifetime value
  "payback",         // payback period (months)
  "cash_efficiency", // revenue per dollar spent
  "opportunity_cost",// value of NOT investing in top opportunity
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { analyses: [], stats: { total: 0, avgROI: 0, byType: {} }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.analyses)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.analyses.length > 1000) d.analyses = d.analyses.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Live metric getters ───────────────────────────────────────────────────────

function _getLiveMetrics() {
  const exec     = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const plans    = _rev()?.PLANS      || {};
  const planLTV  = _rev()?.PLAN_LTV   || {};
  const cheStats = _che()?.getStats?.() || {};

  const mrr        = exec.revenue?.mrr        || 999;
  const arr        = exec.revenue?.arr        || 11988;
  const paidCount  = exec.conversion?.paidCount || 1;
  const trialCount = exec.conversion?.trialCount || 48;
  const convRate   = (exec.conversion?.trialConversionRate || 2) / 100;

  // Average LTV weighted across plan mix (use starter as default for early stage)
  const avgLTV = planLTV.starter || 11988;

  // CAC estimate: marketing budget / new customers (using capital allocation if available)
  const alloc = _cal()?.getCurrentAllocation?.();
  const marketingBudget = alloc?.breakdown?.marketing?.amount || mrr * 0.20;
  const newCustomersPerMonth = Math.max(1, Math.round(trialCount * convRate));
  const estimatedCAC = Math.round(marketingBudget / newCustomersPerMonth);

  // Payback period = CAC / monthly revenue per customer
  const avgMonthlyRevPerCustomer = paidCount > 0 ? Math.round(mrr / paidCount) : plans.starter?.priceMonthly || 999;
  const paybackMonths = avgMonthlyRevPerCustomer > 0 ? Math.round(estimatedCAC / avgMonthlyRevPerCustomer) : 12;

  // Cash efficiency = ARR / total monthly spend estimate
  const totalMonthlySpend = alloc?.totalBudget || mrr * 1.5;
  const cashEfficiency = totalMonthlySpend > 0 ? Math.round((arr / 12 / totalMonthlySpend) * 100) / 100 : 0;

  // ROI = (ARR - annualCost) / annualCost
  const annualCost = totalMonthlySpend * 12;
  const roi = annualCost > 0 ? Math.round(((arr - annualCost) / annualCost) * 100) : 0;

  // Opportunity cost: top opportunity pipeline value NOT yet captured
  const topOpps = _rde()?.listOpportunities?.({ priority: "critical", limit: 3 })?.opportunities || [];
  const oppCost = topOpps.reduce((s, o) => s + (o.value || 0), 0);

  return { mrr, arr, paidCount, trialCount, convRate, avgLTV, estimatedCAC, paybackMonths, cashEfficiency, roi, oppCost, newCustomersPerMonth, avgMonthlyRevPerCustomer };
}

// ── Analysis builders ─────────────────────────────────────────────────────────

function _analyzeROI(m) {
  return {
    id: _id(), type: "roi",
    title: "Platform ROI",
    value: m.roi,
    unit: "%",
    current: { arr: m.arr, estimatedAnnualCost: m.arr * 1.5 },
    target:  { roi: Math.max(50, m.roi + 20) },
    interpretation: m.roi > 50 ? "strong" : m.roi > 0 ? "positive" : "negative",
    recommendation: m.roi < 50 ? "Reduce CAC or increase LTV via expansion revenue" : "Maintain current allocation",
    analyzedAt: _ts(),
  };
}

function _analyzeCAC(m) {
  // SaaS benchmark: CAC < 1/3 of LTV is healthy
  const cacToLTV = m.avgLTV > 0 ? Math.round((m.estimatedCAC / m.avgLTV) * 100) : 0;
  return {
    id: _id(), type: "cac",
    title: "Customer Acquisition Cost",
    value: m.estimatedCAC,
    unit: "₹",
    current: { cac: m.estimatedCAC, newCustomersPerMonth: m.newCustomersPerMonth },
    benchmark: { cacToLTVPct: cacToLTV, healthy: cacToLTV < 33 },
    target: { cac: Math.round(m.avgLTV / 3) },
    interpretation: cacToLTV < 33 ? "healthy" : cacToLTV < 50 ? "acceptable" : "high",
    recommendation: cacToLTV > 33 ? "Improve trial→paid conversion or add referral channel" : "CAC within healthy range",
    analyzedAt: _ts(),
  };
}

function _analyzeLTV(m) {
  const ltvCACRatio = m.estimatedCAC > 0 ? Math.round(m.avgLTV / m.estimatedCAC) : 0;
  return {
    id: _id(), type: "ltv",
    title: "Customer Lifetime Value",
    value: m.avgLTV,
    unit: "₹",
    current: { avgLTV: m.avgLTV, ltvCACRatio },
    benchmark: { ltvCACGoodThreshold: 3 },
    interpretation: ltvCACRatio >= 3 ? "strong" : ltvCACRatio >= 1 ? "acceptable" : "weak",
    recommendation: ltvCACRatio < 3 ? "Invest in retention and upsell to improve LTV" : "LTV:CAC is healthy",
    analyzedAt: _ts(),
  };
}

function _analyzePayback(m) {
  return {
    id: _id(), type: "payback",
    title: "Payback Period",
    value: m.paybackMonths,
    unit: "months",
    current: { cac: m.estimatedCAC, avgMonthlyRevPerCustomer: m.avgMonthlyRevPerCustomer },
    benchmark: { healthyThresholdMonths: 12 },
    interpretation: m.paybackMonths <= 12 ? "healthy" : m.paybackMonths <= 18 ? "acceptable" : "long",
    recommendation: m.paybackMonths > 12 ? "Shorten payback by improving conversion or increasing ARPU" : "Payback period is healthy",
    analyzedAt: _ts(),
  };
}

function _analyzeCashEfficiency(m) {
  return {
    id: _id(), type: "cash_efficiency",
    title: "Cash Efficiency Ratio",
    value: m.cashEfficiency,
    unit: "x ARR/spend",
    current: { cashEfficiency: m.cashEfficiency, arr: m.arr },
    interpretation: m.cashEfficiency >= 1 ? "efficient" : m.cashEfficiency >= 0.5 ? "moderate" : "inefficient",
    recommendation: m.cashEfficiency < 1 ? "Cut infrastructure waste and automate manual workflows" : "Cash efficiency is strong",
    analyzedAt: _ts(),
  };
}

function _analyzeOpportunityCost(m) {
  return {
    id: _id(), type: "opportunity_cost",
    title: "Revenue Pipeline Opportunity Cost",
    value: m.oppCost,
    unit: "₹ per year (unrealized)",
    current: { uncapturedARR: m.oppCost },
    recommendation: m.oppCost > m.arr * 0.5 ? "Invest in sales automation to capture pipeline" : "Pipeline is manageable",
    analyzedAt: _ts(),
  };
}

// ── Core: analyze ─────────────────────────────────────────────────────────────

function analyze() {
  const m = _getLiveMetrics();

  const results = [
    _analyzeROI(m),
    _analyzeCAC(m),
    _analyzeLTV(m),
    _analyzePayback(m),
    _analyzeCashEfficiency(m),
    _analyzeOpportunityCost(m),
  ];

  const d    = _load();
  const dedup = new Map(d.analyses.map(a => [a.type, a]));
  results.forEach(r => dedup.set(r.type, r));
  d.analyses = [...dedup.values()];

  const byType = {};
  ANALYSIS_TYPES.forEach(t => { byType[t] = d.analyses.filter(a => a.type === t).length; });
  const avgROI = results.find(r => r.type === "roi")?.value || 0;
  d.stats = { total: d.analyses.length, avgROI, byType, liveMetrics: m };
  _save(d);

  return { ok: true, found: results.length, total: d.analyses.length, liveMetrics: m, analyses: results };
}

function getAnalysis(id) {
  return _load().analyses.find(a => a.id === id) || null;
}

function listAnalyses({ type, limit = 50 } = {}) {
  let items = _load().analyses;
  if (type) items = items.filter(a => a.type === type);
  return { ok: true, analyses: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, ANALYSIS_TYPES, updatedAt: d.updatedAt };
}

module.exports = {
  ANALYSIS_TYPES,
  analyze,
  getAnalysis,
  listAnalyses,
  getStats,
};
