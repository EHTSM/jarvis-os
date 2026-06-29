"use strict";
/**
 * riskAssessmentEngine.cjs — POST-Ω P16 Autonomous Investment Engine
 *
 * Evaluates: execution, financial, technical, operational, strategic risk.
 *
 * Reuses: revenueOS, customerHealthEngine, revenueForecastEngine,
 *         capitalAllocationEngine, investmentAnalysisEngine, portfolioStrategyEngine,
 *         workforceManager, analyticsService, businessReasoningEngine (OBI X),
 *         knowledgeReasoningEngine (OKB X), evolutionReasoningEngine (OSE X).
 *
 * Storage: data/risk-assessment.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "risk-assessment.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _cal  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _ian  = () => _try(() => require("./investmentAnalysisEngine.cjs"));
const _pfs  = () => _try(() => require("./portfolioStrategyEngine.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `rsk_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const RISK_DIMENSIONS = [
  "execution",    // can we actually deliver?
  "financial",    // do we have runway?
  "technical",    // is the tech stack stable?
  "operational",  // are workflows running?
  "strategic",    // are we building the right thing?
];

const RISK_LEVELS = { low: 1, medium: 2, high: 3, critical: 4 };

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { assessments: [], current: null, stats: { total: 0, byDimension: {}, avgRiskScore: 0 }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.assessments)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.assessments.length > 500) d.assessments = d.assessments.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Risk assessors ────────────────────────────────────────────────────────────

function _assessExecution() {
  const wf = _wf()?.getWorkforceReport?.() || {};
  const busyAgents   = wf.agentSummary?.busy || 0;
  const totalAgents  = wf.agentSummary?.totalAgents || 39;
  const successRate  = wf.stats?.missionsRun > 0 ? Math.min(100, (wf.stats.missionsRun - (wf.stats.teamsReplaced || 0)) / wf.stats.missionsRun * 100) : 85;
  const busyRatio    = totalAgents > 0 ? busyAgents / totalAgents : 0;

  const score = Math.round(
    (busyRatio > 0.9 ? 70 : busyRatio > 0.7 ? 50 : 30) +
    (successRate < 80 ? 30 : successRate < 90 ? 20 : 10)
  );

  return {
    dimension: "execution", score,
    level:  score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    factors: [
      { factor: "agent_capacity", value: `${Math.round(busyRatio*100)}% busy`, risk: busyRatio > 0.8 ? "high" : "low" },
      { factor: "success_rate",   value: `${Math.round(successRate)}%`,         risk: successRate < 85 ? "medium" : "low" },
    ],
    mitigation: busyRatio > 0.8 ? "Scale agent pool or deprioritize low-ROI missions" : "Maintain current workforce",
    assessedAt: _ts(),
  };
}

function _assessFinancial() {
  const exec    = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const mrr     = exec.revenue?.mrr || 999;
  const churnRate = exec.retention?.churnRate || 0;
  const alloc   = _cal()?.getCurrentAllocation?.();
  const monthlyBurn = alloc?.totalBudget || mrr * 1.5;
  const runwayMonths = mrr > 0 ? Math.round(mrr / monthlyBurn * 12) : 6;

  const ian = _ian()?.getStats?.() || {};
  const roi = ian.avgROI || 0;

  const score = Math.round(
    (runwayMonths < 3 ? 80 : runwayMonths < 6 ? 50 : 20) +
    (roi < 0 ? 30 : roi < 20 ? 15 : 0) +
    (churnRate > 5 ? 20 : churnRate > 2 ? 10 : 0)
  );

  return {
    dimension: "financial", score,
    level: score >= 70 ? "critical" : score >= 50 ? "high" : score >= 30 ? "medium" : "low",
    factors: [
      { factor: "mrr",         value: `₹${mrr}`,          risk: mrr < 5000 ? "high" : "low" },
      { factor: "churn_rate",  value: `${churnRate}%/mo`,  risk: churnRate > 3 ? "high" : "low" },
      { factor: "roi",         value: `${roi}%`,           risk: roi < 20 ? "medium" : "low" },
    ],
    mitigation: mrr < 5000 ? "Execute top 3 revenue opportunities immediately" : "Monitor MRR growth trajectory",
    assessedAt: _ts(),
  };
}

function _assessTechnical() {
  const okb = _okb()?.getStats?.() || {};
  const ose = _ose()?.getStats?.() || {};
  // Higher knowledge coverage = lower technical risk
  const knowledgeItems  = okb.totalItems || 500;
  const evolutionScore  = ose.avgConfidence || 70;

  const score = Math.round(
    Math.max(0, 60 - knowledgeItems / 50) +
    (evolutionScore < 60 ? 25 : evolutionScore < 75 ? 15 : 0)
  );

  return {
    dimension: "technical", score,
    level: score >= 60 ? "high" : score >= 35 ? "medium" : "low",
    factors: [
      { factor: "knowledge_coverage",  value: `${knowledgeItems} items`,   risk: knowledgeItems < 200 ? "high" : "low" },
      { factor: "evolution_confidence", value: `${evolutionScore}%`,        risk: evolutionScore < 70 ? "medium" : "low" },
    ],
    mitigation: knowledgeItems < 200 ? "Expand knowledge capture from engineering patterns" : "Maintain knowledge hygiene",
    assessedAt: _ts(),
  };
}

function _assessOperational() {
  const exec      = _rev()?.getExecutiveRevenueDashboard?.() || {};
  const churnRisk = _che()?.getStats?.()?.atRisk || 0;
  const totalCust = _che()?.getStats?.()?.total   || 1;
  const atRiskPct = Math.round((churnRisk / totalCust) * 100);

  const score = Math.round(
    (atRiskPct > 60 ? 60 : atRiskPct > 30 ? 40 : 20) +
    (exec.revenue?.mrr < 2000 ? 20 : 0)
  );

  return {
    dimension: "operational", score,
    level: score >= 60 ? "high" : score >= 35 ? "medium" : "low",
    factors: [
      { factor: "at_risk_customers", value: `${atRiskPct}%`, risk: atRiskPct > 30 ? "high" : "low" },
      { factor: "mrr_stability",     value: `₹${exec.revenue?.mrr || 0}/mo`, risk: (exec.revenue?.mrr || 0) < 2000 ? "medium" : "low" },
    ],
    mitigation: atRiskPct > 30 ? "Deploy customer success playbooks for at-risk segment" : "Continue health monitoring",
    assessedAt: _ts(),
  };
}

function _assessStrategic() {
  const pfs     = _pfs()?.getCurrentStrategy?.();
  const oppCost = _ian()?.getStats?.()?.liveMetrics?.oppCost || 0;
  const arr     = _rev()?.getExecutiveRevenueDashboard?.()?.revenue?.arr || 11988;
  const oppPct  = arr > 0 ? Math.round((oppCost / arr) * 100) : 0;

  const score = Math.round(
    (oppPct > 200 ? 50 : oppPct > 100 ? 35 : 20) +
    (!pfs ? 20 : pfs.overallScore < 50 ? 15 : 0)
  );

  return {
    dimension: "strategic", score,
    level: score >= 55 ? "high" : score >= 35 ? "medium" : "low",
    factors: [
      { factor: "opportunity_cost", value: `${oppPct}% of ARR unrealized`, risk: oppPct > 100 ? "high" : "low" },
      { factor: "portfolio_health", value: pfs ? `score:${pfs.overallScore}` : "unset", risk: !pfs ? "medium" : "low" },
    ],
    mitigation: oppPct > 100 ? "Activate revenue automation for top 3 pipeline opportunities" : "Portfolio on track",
    assessedAt: _ts(),
  };
}

// ── Core: assess ──────────────────────────────────────────────────────────────

function assess() {
  const dimensions = [
    _assessExecution(),
    _assessFinancial(),
    _assessTechnical(),
    _assessOperational(),
    _assessStrategic(),
  ];

  const overallScore = Math.round(
    dimensions.reduce((s, d) => s + (d.score || 0), 0) / dimensions.length
  );
  const overallLevel = overallScore >= 70 ? "critical" : overallScore >= 50 ? "high" : overallScore >= 30 ? "medium" : "low";

  const record = {
    id: _id(),
    overallScore, overallLevel,
    dimensions,
    topRisk:     dimensions.sort((a, b) => (b.score || 0) - (a.score || 0))[0]?.dimension || "financial",
    assessedAt:  _ts(),
  };

  const d = _load();
  d.assessments.push(record);
  d.current = record;

  const byDimension = {};
  RISK_DIMENSIONS.forEach(dim => { byDimension[dim] = dimensions.find(x => x.dimension === dim)?.score || 0; });
  const avgRiskScore = Math.round(d.assessments.reduce((s, a) => s + (a.overallScore || 0), 0) / d.assessments.length);
  d.stats = { total: d.assessments.length, byDimension, avgRiskScore };
  _save(d);

  return { ok: true, assessment: record };
}

function getCurrentAssessment() {
  return _load().current || null;
}

function getAssessment(id) {
  return _load().assessments.find(a => a.id === id) || null;
}

function listAssessments({ level, limit = 20 } = {}) {
  let items = _load().assessments;
  if (level) items = items.filter(a => a.overallLevel === level);
  return { ok: true, assessments: items.slice(-limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, RISK_DIMENSIONS, RISK_LEVELS, updatedAt: d.updatedAt };
}

module.exports = {
  RISK_DIMENSIONS,
  RISK_LEVELS,
  assess,
  getCurrentAssessment,
  getAssessment,
  listAssessments,
  getStats,
};
