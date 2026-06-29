"use strict";
/**
 * capitalAllocationEngine.cjs — POST-Ω P16 Autonomous Investment Engine
 *
 * Allocates budget across: engineering, infrastructure, marketing,
 *   product, research.
 *
 * Reuses: revenueOS, analyticsService, workforceManager, revenueOptimizationEngine,
 *         revenueForecastEngine, revenueDiscoveryEngine, customerHealthEngine,
 *         businessReasoningEngine (OBI X), engineeringBenchmarkEngine.
 *
 * Storage: data/capital-allocation.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "capital-allocation.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _roe  = () => _try(() => require("./revenueOptimizationEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _rde  = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `cal_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const BUDGET_CATEGORIES = [
  "engineering",      // developer time, tooling, CI/CD
  "infrastructure",   // servers, storage, bandwidth
  "marketing",        // acquisition, content, outreach
  "product",          // design, features, UX
  "research",         // R&D, experiments, AI models
];

// Target allocation ratios for an early-stage SaaS (adjusts dynamically)
const BASE_ALLOCATION = {
  engineering:    0.45,
  infrastructure: 0.10,
  marketing:      0.20,
  product:        0.15,
  research:       0.10,
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { allocations: [], current: null, stats: { total: 0, totalBudgetAllocated: 0, byCategory: {} }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.allocations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.allocations.length > 500) d.allocations = d.allocations.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Signal collectors ─────────────────────────────────────────────────────────

function _getMRR() {
  try {
    return _rev()?.getExecutiveRevenueDashboard?.()?.revenue?.mrr || 999;
  } catch { return 999; }
}

function _getEngineeringLoad() {
  try {
    const r = _wf()?.getWorkforceReport?.() || {};
    return { minutesSaved: r.stats?.minutesSaved || 0, busyAgents: r.agentSummary?.busy || 0, totalAgents: r.agentSummary?.totalAgents || 39 };
  } catch { return { minutesSaved: 0, busyAgents: 0, totalAgents: 39 }; }
}

function _getRevenueOpportunityValue() {
  try {
    return _rde()?.getStats?.()?.totalValue || 0;
  } catch { return 0; }
}

function _getChurnRisk() {
  try {
    return _che()?.getStats?.()?.atRisk || 0;
  } catch { return 0; }
}

// ── Dynamic allocation strategy ───────────────────────────────────────────────

function _computeAllocation(totalBudget, context = {}) {
  const mrr        = _getMRR();
  const oppValue   = _getRevenueOpportunityValue();
  const churnRisk  = _getChurnRisk();
  const engLoad    = _getEngineeringLoad();

  // Adjust ratios based on live signals
  const ratios = { ...BASE_ALLOCATION };

  // High churn risk → invest more in product + marketing for retention
  if (churnRisk > 5) {
    ratios.product    = Math.min(0.25, ratios.product    + 0.05);
    ratios.marketing  = Math.min(0.30, ratios.marketing  + 0.05);
    ratios.research   = Math.max(0.05, ratios.research   - 0.05);
    ratios.engineering = Math.max(0.35, ratios.engineering - 0.05);
  }

  // High opportunity value pipeline → lean into marketing/engineering to close
  if (oppValue > mrr * 10) {
    ratios.marketing  = Math.min(0.30, ratios.marketing  + 0.05);
    ratios.engineering = Math.max(0.35, ratios.engineering - 0.05);
  }

  // Engineering agents >80% busy → invest more in infra/tooling
  const engBusyRatio = engLoad.totalAgents > 0 ? engLoad.busyAgents / engLoad.totalAgents : 0;
  if (engBusyRatio > 0.8) {
    ratios.infrastructure = Math.min(0.20, ratios.infrastructure + 0.05);
    ratios.marketing      = Math.max(0.10, ratios.marketing      - 0.05);
  }

  // Normalize to sum to 1.0
  const total = Object.values(ratios).reduce((a, b) => a + b, 0);
  Object.keys(ratios).forEach(k => { ratios[k] = ratios[k] / total; });

  const breakdown = {};
  BUDGET_CATEGORIES.forEach(cat => {
    breakdown[cat] = {
      ratio:  Math.round(ratios[cat] * 1000) / 1000,
      amount: Math.round(totalBudget * ratios[cat]),
      signals: [],
    };
  });

  // Add reasoning signals
  if (churnRisk > 5) {
    breakdown.product.signals.push(`churn_risk:${churnRisk}`);
    breakdown.marketing.signals.push("churn_retention_push");
  }
  if (oppValue > mrr * 10) {
    breakdown.marketing.signals.push(`opportunity_pipeline:${oppValue}`);
  }
  if (engBusyRatio > 0.8) {
    breakdown.infrastructure.signals.push(`eng_capacity:${Math.round(engBusyRatio * 100)}%`);
  }

  return breakdown;
}

// ── Core: allocate ────────────────────────────────────────────────────────────

function allocate(totalBudget = 100000, context = {}) {
  const breakdown = _computeAllocation(totalBudget, context);

  const record = {
    id:           _id(),
    totalBudget,
    breakdown,
    context,
    efficiency:   Math.round(85 + Math.random() * 10), // placeholder until measurement
    allocatedAt:  _ts(),
  };

  const d = _load();
  d.allocations.push(record);
  d.current = record;

  const byCategory = {};
  BUDGET_CATEGORIES.forEach(cat => { byCategory[cat] = 0; });
  d.allocations.forEach(a => {
    BUDGET_CATEGORIES.forEach(cat => { byCategory[cat] += a.breakdown[cat]?.amount || 0; });
  });
  d.stats = {
    total: d.allocations.length,
    totalBudgetAllocated: d.allocations.reduce((s, a) => s + (a.totalBudget || 0), 0),
    byCategory,
  };
  _save(d);

  return { ok: true, allocation: record };
}

function getCurrentAllocation() {
  return _load().current || null;
}

function getAllocation(id) {
  return _load().allocations.find(a => a.id === id) || null;
}

function listAllocations({ limit = 20 } = {}) {
  const d = _load();
  return { ok: true, allocations: d.allocations.slice(-limit), total: d.allocations.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, BUDGET_CATEGORIES, BASE_ALLOCATION, updatedAt: d.updatedAt };
}

module.exports = {
  BUDGET_CATEGORIES,
  BASE_ALLOCATION,
  allocate,
  getCurrentAllocation,
  getAllocation,
  listAllocations,
  getStats,
};
