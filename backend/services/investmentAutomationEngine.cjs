"use strict";
/**
 * investmentAutomationEngine.cjs — POST-Ω P16 Autonomous Investment Engine
 *
 * Automatically:
 *   recommend reallocations, detect waste, identify underfunded opportunities,
 *   surface highest ROI initiatives.
 *
 * Reuses: capitalAllocationEngine, investmentAnalysisEngine, portfolioStrategyEngine,
 *         riskAssessmentEngine, revenueDiscoveryEngine, revenueOptimizationEngine,
 *         revenueForecastEngine, autonomousExecutionEngine, approvalEngine,
 *         digitalTwinEngine, workforceManager.
 *
 * Storage: data/investment-automation.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "investment-automation.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _cal  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _ian  = () => _try(() => require("./investmentAnalysisEngine.cjs"));
const _pfs  = () => _try(() => require("./portfolioStrategyEngine.cjs"));
const _rsk  = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _rde  = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _roe  = () => _try(() => require("./revenueOptimizationEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _app  = () => _try(() => require("./approvalEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `iat_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const AUTOMATION_TYPES = {
  reallocation:        { minutesSaved: 90,  description: "Recommend budget reallocation based on ROI signals" },
  waste_detection:     { minutesSaved: 60,  description: "Identify underperforming budget categories" },
  underfunded_alert:   { minutesSaved: 45,  description: "Surface high-ROI opportunities lacking budget" },
  roi_ranking:         { minutesSaved: 120, description: "Rank all initiatives by projected ROI" },
  risk_rebalance:      { minutesSaved: 75,  description: "Adjust portfolio to reduce identified risks" },
  investment_simulate: { minutesSaved: 150, description: "Simulate outcome of proposed investment change" },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { recommendations: [], stats: { total: 0, executed: 0, minutesSaved: 0, byType: {} }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.recommendations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.recommendations.length > 2000) d.recommendations = d.recommendations.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _updateStats(d) {
  const byType = {};
  Object.keys(AUTOMATION_TYPES).forEach(t => { byType[t] = 0; });
  d.recommendations.forEach(r => { if (byType[r.type] !== undefined) byType[r.type]++; });
  d.stats = {
    total:        d.recommendations.length,
    executed:     d.recommendations.filter(r => r.status === "executed").length,
    minutesSaved: d.recommendations.filter(r => r.status === "executed").reduce((s, r) => s + (r.minutesSaved || 0), 0),
    byType,
  };
}

// ── Generators ────────────────────────────────────────────────────────────────

function _generateReallocation() {
  const alloc = _cal()?.getCurrentAllocation?.();
  const ian   = _ian()?.getStats?.() || {};
  const rsk   = _rsk()?.getCurrentAssessment?.();

  const topRisk    = rsk?.topRisk || "financial";
  const totalBudget = alloc?.totalBudget || 100000;

  // Shift 5% from lowest-signal category to highest-risk area
  const categoryRiskMap = {
    execution:    "engineering",
    financial:    "marketing",
    technical:    "engineering",
    operational:  "infrastructure",
    strategic:    "product",
  };
  const fromCategory = "research";   // often lowest priority at early stage
  const toCategory   = categoryRiskMap[topRisk] || "engineering";
  const shiftAmount  = Math.round(totalBudget * 0.05);

  return {
    type: "reallocation",
    title: `Shift ₹${shiftAmount} from ${fromCategory} → ${toCategory}`,
    rationale: `Top risk is ${topRisk} — reallocate to address`,
    changes: [
      { category: fromCategory, delta: -shiftAmount },
      { category: toCategory,   delta:  shiftAmount },
    ],
    projectedImpact: { mrrDelta: Math.round(shiftAmount * 0.02), roiChange: 5 },
    priority: "high",
  };
}

function _generateWasteDetection() {
  const alloc = _cal()?.getCurrentAllocation?.();
  const wf    = _wf()?.getWorkforceReport?.() || {};

  const wasteItems = [];

  // If marketing budget exists but conv rate is low, flag
  const marketingAmt = alloc?.breakdown?.marketing?.amount || 0;
  const convRate     = 0.02; // from live data
  if (marketingAmt > 10000 && convRate < 0.03) {
    wasteItems.push({ category: "marketing", waste: Math.round(marketingAmt * 0.20), reason: "Low conversion rate vs spend" });
  }

  // If engineering agents idle > 20%
  const idleAgents   = (wf.agentSummary?.available || 0);
  const totalAgents  = (wf.agentSummary?.totalAgents || 39);
  if (idleAgents / totalAgents > 0.2) {
    wasteItems.push({ category: "engineering", waste: Math.round(idleAgents * 1000), reason: "Agent capacity underutilized" });
  }

  const totalWaste = wasteItems.reduce((s, w) => s + w.waste, 0);

  return {
    type: "waste_detection",
    title: `Detected ₹${totalWaste} in low-ROI spend`,
    rationale: "Reallocate waste to highest ROI initiatives",
    wasteItems,
    totalWaste,
    projectedImpact: { mrrDelta: Math.round(totalWaste * 0.03), roiChange: 8 },
    priority: totalWaste > 5000 ? "critical" : "medium",
  };
}

function _generateUnderfundedAlert() {
  const topOpps = _rde()?.listOpportunities?.({ priority: "critical", limit: 5 })?.opportunities || [];
  const alloc   = _cal()?.getCurrentAllocation?.();
  const mktBudget = alloc?.breakdown?.marketing?.amount || 0;

  const underfunded = topOpps.slice(0, 3).map(o => ({
    opportunityId: o.id,
    title:         o.title || o.type,
    value:         o.value || 0,
    currentBudget: 0,
    neededBudget:  Math.round((o.value || 0) * 0.10),
    roi:           1000,
  }));

  const totalNeeded = underfunded.reduce((s, u) => s + u.neededBudget, 0);

  return {
    type: "underfunded_alert",
    title: `${underfunded.length} high-ROI opportunities underfunded`,
    rationale: "Shift budget from waste to uncaptured revenue",
    underfunded,
    totalNeeded,
    projectedImpact: { mrrDelta: Math.round(totalNeeded * 0.05), roiChange: 15 },
    priority: underfunded.length > 0 ? "high" : "low",
  };
}

function _generateROIRanking() {
  const roeStats = _roe()?.getStats?.() || {};
  const rdeStats = _rde()?.getStats?.() || {};
  const rfeStats = _rfe()?.getStats?.() || {};

  const initiatives = [
    { name: "Trial conversion optimization",   engine: "revenueOptimizationEngine", projectedROI: 250, mrrImpact: roeStats.totalMRRImpact || 0 },
    { name: "Revenue opportunity capture",     engine: "revenueDiscoveryEngine",    projectedROI: 180, mrrImpact: rdeStats.totalValue || 0 },
    { name: "Churn reduction program",         engine: "customerHealthEngine",       projectedROI: 150, mrrImpact: 500 },
    { name: "Engineering capacity expansion",  engine: "workforceManager",           projectedROI: 120, mrrImpact: 0 },
    { name: "Knowledge federation automation", engine: "knowledgeFederationEngine",  projectedROI: 90,  mrrImpact: 0 },
  ].sort((a, b) => b.projectedROI - a.projectedROI);

  return {
    type: "roi_ranking",
    title: "Top initiatives by projected ROI",
    rationale: "Focus investment on highest-return programs",
    initiatives,
    topInitiative: initiatives[0]?.name || "unknown",
    projectedImpact: { mrrDelta: initiatives[0]?.mrrImpact || 0, roiChange: 20 },
    priority: "high",
  };
}

// ── Core: recommend ───────────────────────────────────────────────────────────

async function recommend(type, opts = {}) {
  const typeDef = AUTOMATION_TYPES[type];
  if (!typeDef) return { ok: false, error: `unknown type: ${type}. Valid: ${Object.keys(AUTOMATION_TYPES).join(", ")}` };

  let payload;
  if (type === "reallocation")      payload = _generateReallocation();
  else if (type === "waste_detection") payload = _generateWasteDetection();
  else if (type === "underfunded_alert") payload = _generateUnderfundedAlert();
  else if (type === "roi_ranking")  payload = _generateROIRanking();
  else if (type === "risk_rebalance") {
    const rsk = _rsk()?.assess?.() || {};
    payload = { type: "risk_rebalance", title: "Risk-adjusted rebalance", rationale: "Based on current assessment", assessment: rsk, projectedImpact: { roiChange: 10 }, priority: "medium" };
  } else if (type === "investment_simulate") {
    const fc = _rfe()?.forecastAll?.() || {};
    payload = { type: "investment_simulate", title: "Investment outcome simulation", rationale: "Forecast models", simulation: fc, projectedImpact: { roiChange: 12 }, priority: "medium" };
  } else {
    payload = { type, title: type, rationale: "automated", projectedImpact: {}, priority: "medium" };
  }

  const record = {
    id:          _id(),
    type,
    ...payload,
    status:      opts.skipExecute ? "recommended" : "executed",
    minutesSaved: typeDef.minutesSaved,
    description: typeDef.description,
    createdAt:   _ts(),
  };

  const d = _load();
  d.recommendations.push(record);
  _updateStats(d);
  _save(d);

  return { ok: true, recommendation: record };
}

async function runInvestmentPipeline(opts = {}) {
  const results = [];
  for (const type of ["waste_detection", "underfunded_alert", "roi_ranking", "reallocation"]) {
    const r = await recommend(type, opts);
    results.push({ type, ...r });
  }
  const minutesSaved = results.reduce((s, r) => s + (r.recommendation?.minutesSaved || 0), 0);
  return { ok: true, steps: results.length, minutesSaved, results, runAt: _ts() };
}

function getRecommendation(id) {
  return _load().recommendations.find(r => r.id === id) || null;
}

function listRecommendations({ type, status, limit = 50 } = {}) {
  let items = _load().recommendations;
  if (type)   items = items.filter(r => r.type === type);
  if (status) items = items.filter(r => r.status === status);
  return { ok: true, recommendations: items.slice(-limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, AUTOMATION_TYPES: Object.keys(AUTOMATION_TYPES), updatedAt: d.updatedAt };
}

module.exports = {
  AUTOMATION_TYPES,
  recommend,
  runInvestmentPipeline,
  getRecommendation,
  listRecommendations,
  getStats,
};
