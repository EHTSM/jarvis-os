"use strict";
/**
 * revenueOptimizationEngine.cjs — POST-Ω P15 Autonomous Revenue Engine
 *
 * Optimizes: conversion, deal velocity, renewal rate, expansion revenue.
 *
 * Reuses: revenueOS, customerHealthEngine, customerSuccessEngine,
 *         customerJourneyEngine, businessReasoningEngine, analyticsService,
 *         pricingIntelligenceEngine, revenueDiscoveryEngine, digitalTwinEngine.
 *
 * Storage: data/revenue-optimization.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "revenue-optimization.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev = () => _try(() => require("./revenueOS.cjs"));
const _che = () => _try(() => require("./customerHealthEngine.cjs"));
const _cse = () => _try(() => require("./customerSuccessEngine.cjs"));
const _cje = () => _try(() => require("./customerJourneyEngine.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _rde = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _pie = () => _try(() => require("./pricingIntelligenceEngine.cjs"));
const _dt  = () => _try(() => require("./digitalTwinEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ropt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const OPTIMIZATION_DIMENSIONS = [
  "conversion_rate",  // trial → paid
  "deal_velocity",    // time from lead to close
  "renewal_rate",     // % customers who renew
  "expansion_mrr",    // revenue from existing customers
  "churn_reduction",  // decrease in monthly churn
  "ltv_improvement",  // increase in customer LTV
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { optimizations: [], activePlaybooks: [], stats: { total: 0, byDimension: {}, totalMRRImpact: 0 }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.optimizations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.optimizations.length > 1000) d.optimizations = d.optimizations.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Optimization builders ─────────────────────────────────────────────────────

function _optimizeConversion() {
  const exec       = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const convRate   = (exec.conversion?.trialConversionRate || 2) / 100;
  const trialCount = exec.conversion?.trialCount || 0;
  const plans      = _rev()?.PLANS || {};
  const starterMRR = plans.starter?.priceMonthly || 999;

  // Industry benchmark: 5-8% trial conversion
  const benchmarkRate  = 0.06;
  const currentMRR     = trialCount * convRate * starterMRR;
  const potentialMRR   = trialCount * benchmarkRate * starterMRR;
  const mrrImpact      = Math.round(potentialMRR - currentMRR);

  return {
    id: _id(), dimension: "conversion_rate",
    title:     "Improve Trial → Paid Conversion",
    current:   { rate: convRate, trials: trialCount, mrrGenerated: Math.round(currentMRR) },
    target:    { rate: benchmarkRate, mrrGenerated: Math.round(potentialMRR) },
    mrrImpact,
    actions: [
      "Send in-app onboarding checklist at day 3",
      "Trigger personalized upsell email when 80% of credits consumed",
      "Offer 1:1 demo call at day 7 for high-engagement trials",
      "Apply early-adopter discount at day 12 if no conversion",
    ],
    priority: mrrImpact > 5000 ? "critical" : mrrImpact > 2000 ? "high" : "medium",
    confidence: 82,
    optimizedAt: _ts(),
  };
}

function _optimizeRenewal() {
  const exec      = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const churnRate = exec.retention?.churnRate || 0;
  const mrr       = exec.revenue?.mrr || 999;
  // Monthly churn → annual churn; 1% monthly = ~11.4% annual
  const annualChurn = Math.round((1 - Math.pow(1 - churnRate / 100, 12)) * 100);
  const mrrAtRisk   = Math.round(mrr * (annualChurn / 100));
  const targetChurn = Math.max(0, churnRate - 1); // reduce monthly churn by 1pp

  return {
    id: _id(), dimension: "renewal_rate",
    title:     "Increase Renewal Rate",
    current:   { monthlyChurnRate: churnRate, annualChurnRate: annualChurn, mrrAtRisk },
    target:    { monthlyChurnRate: targetChurn },
    mrrImpact: Math.round(mrr * 0.01), // each 1pp churn reduction = ~1% MRR saved
    actions: [
      "Send renewal reminder 45 days before subscription anniversary",
      "Assign CSM to accounts with health score < 50",
      "Run win-back campaign for lapsed accounts within 30 days",
      "Trigger SUCCESS_PLAYBOOKS at health score < 60",
    ],
    priority: churnRate > 3 ? "critical" : churnRate > 1 ? "high" : "medium",
    confidence: 90,
    optimizedAt: _ts(),
  };
}

function _optimizeExpansion() {
  const exec     = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const mrr      = exec.revenue?.mrr || 999;
  const expMRR   = exec.revenue?.expansionMRR || 0;
  const expTarget = Math.round(mrr * 0.15); // industry: 15% net revenue retention above 100%

  const healthStats = _che()?.getStats?.() || {};
  const eligible    = (healthStats.total || 0) - (healthStats.atRisk || 0);

  return {
    id: _id(), dimension: "expansion_mrr",
    title:     "Drive Expansion Revenue",
    current:   { expansionMRR: expMRR, eligibleAccounts: eligible },
    target:    { expansionMRR: expTarget },
    mrrImpact: Math.round(expTarget - expMRR),
    actions: [
      "Identify healthy accounts for upgrade campaigns",
      "Launch usage-based upsell when 75% of plan limits reached",
      "Offer team seat expansion for solo accounts with high activity",
      "Present Growth → Team upgrade path at 90-day health check",
    ],
    priority: eligible > 10 ? "high" : "medium",
    confidence: 75,
    optimizedAt: _ts(),
  };
}

function _optimizeDealVelocity() {
  const rde = _rde()?.getStats?.() || {};
  const totalOpps = rde.total || 0;
  const plans     = _rev()?.PLANS || {};
  const avgDealMRR = plans.starter?.priceMonthly || 999;

  // Benchmark: 14-day average from trial to paid for SMB SaaS
  const benchmarkDays = 14;
  return {
    id: _id(), dimension: "deal_velocity",
    title:     "Accelerate Deal Velocity",
    current:   { openOpportunities: totalOpps, estimatedAvgDays: 21 },
    target:    { avgDays: benchmarkDays },
    mrrImpact: Math.round(totalOpps * avgDealMRR * 0.1), // 10% improvement in close rate
    actions: [
      "Auto-generate proposal within 24h of discovery signal",
      "Trigger follow-up sequence if no response within 48h",
      "Escalate to founder twin decision if deal stalls >7 days",
      "Apply early-adopter discount at day 10 for high-value prospects",
    ],
    priority: totalOpps > 5 ? "high" : "medium",
    confidence: 70,
    optimizedAt: _ts(),
  };
}

// ── Core: optimize ────────────────────────────────────────────────────────────

function optimize() {
  const opts = [
    _optimizeConversion(),
    _optimizeRenewal(),
    _optimizeExpansion(),
    _optimizeDealVelocity(),
  ];

  const d = _load();
  const dedup = new Map(d.optimizations.map(o => [o.dimension + ':' + o.title, o]));
  opts.forEach(o => dedup.set(o.dimension + ':' + o.title, o));
  d.optimizations = [...dedup.values()];

  const byDimension = {};
  OPTIMIZATION_DIMENSIONS.forEach(dim => { byDimension[dim] = 0; });
  d.optimizations.forEach(o => { if (byDimension[o.dimension] !== undefined) byDimension[o.dimension]++; });
  const totalMRRImpact = d.optimizations.reduce((s, o) => s + (o.mrrImpact || 0), 0);
  d.stats = { total: d.optimizations.length, byDimension, totalMRRImpact };
  _save(d);

  return {
    ok: true, found: opts.length, total: d.optimizations.length,
    totalMRRImpact,
    byDimension,
    topOptimizations: d.optimizations.sort((a, b) => (b.mrrImpact || 0) - (a.mrrImpact || 0)).slice(0, 3),
  };
}

function getOptimization(id) {
  return _load().optimizations.find(o => o.id === id) || null;
}

function listOptimizations({ dimension, priority, limit = 50 } = {}) {
  let opts = _load().optimizations;
  if (dimension) opts = opts.filter(o => o.dimension === dimension);
  if (priority)  opts = opts.filter(o => o.priority === priority);
  return { ok: true, optimizations: opts.slice(0, limit), total: opts.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, OPTIMIZATION_DIMENSIONS, updatedAt: d.updatedAt };
}

module.exports = {
  OPTIMIZATION_DIMENSIONS,
  optimize,
  getOptimization,
  listOptimizations,
  getStats,
};
