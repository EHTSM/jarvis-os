"use strict";
/**
 * investmentDashboard.cjs — POST-Ω P16 Autonomous Investment Engine
 *
 * Pure aggregation. Surfaces:
 *   Capital Allocation, ROI Score, Risk Score, Investment Health,
 *   Portfolio Balance, Budget Utilization, Founder Time Saved.
 *
 * Reuses all 5 P16 engines + 24 existing platform services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// ── P16 engines ───────────────────────────────────────────────────────────────
const _cal  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _ian  = () => _try(() => require("./investmentAnalysisEngine.cjs"));
const _pfs  = () => _try(() => require("./portfolioStrategyEngine.cjs"));
const _rsk  = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _iat  = () => _try(() => require("./investmentAutomationEngine.cjs"));

// ── Existing platform services ────────────────────────────────────────────────
const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _cse  = () => _try(() => require("./customerSuccessEngine.cjs"));
const _rde  = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _roe  = () => _try(() => require("./revenueOptimizationEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _dt   = () => _try(() => require("./digitalTwinEngine.cjs"));
const _clf  = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _ppe  = () => _try(() => require("./productPlannerEngine.cjs"));
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _exe  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _app  = () => _try(() => require("./approvalEngine.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _bp   = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _wm   = () => _try(() => require("./workspaceMesh.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _pie  = () => _try(() => require("./pricingIntelligenceEngine.cjs"));

const INVESTMENT_SERVICES_REUSED = 24;

// ── Section builders ──────────────────────────────────────────────────────────

function _getCapitalAllocation() {
  try {
    const alloc = _cal()?.getCurrentAllocation?.();
    if (!alloc) return { hasAllocation: false, totalBudget: 0, breakdown: {} };
    return {
      hasAllocation: true,
      totalBudget:   alloc.totalBudget,
      efficiency:    alloc.efficiency,
      breakdown:     Object.fromEntries(
        Object.entries(alloc.breakdown).map(([cat, v]) => [cat, { amount: v.amount, ratio: v.ratio }])
      ),
      allocatedAt: alloc.allocatedAt,
    };
  } catch { return { hasAllocation: false, totalBudget: 0 }; }
}

function _getROIScore() {
  try {
    const s = _ian()?.getStats?.() || {};
    return {
      avgROI:        s.avgROI || 0,
      totalAnalyses: s.total  || 0,
      liveMetrics:   s.liveMetrics ? {
        estimatedCAC:   s.liveMetrics.estimatedCAC,
        paybackMonths:  s.liveMetrics.paybackMonths,
        cashEfficiency: s.liveMetrics.cashEfficiency,
        avgLTV:         s.liveMetrics.avgLTV,
      } : {},
    };
  } catch { return { avgROI: 0 }; }
}

function _getRiskScore() {
  try {
    const rsk = _rsk()?.getCurrentAssessment?.();
    if (!rsk) return { overallScore: 0, overallLevel: "unknown" };
    return {
      overallScore:  rsk.overallScore,
      overallLevel:  rsk.overallLevel,
      topRisk:       rsk.topRisk,
      byDimension:   Object.fromEntries(
        (rsk.dimensions || []).map(d => [d.dimension, { score: d.score, level: d.level }])
      ),
    };
  } catch { return { overallScore: 0, overallLevel: "unknown" }; }
}

function _getInvestmentHealth() {
  try {
    const iatStats = _iat()?.getStats?.() || {};
    const calStats = _cal()?.getStats?.() || {};
    const rskStats = _rsk()?.getStats?.() || {};

    const healthScore = Math.round(
      Math.max(0, 100 - (rskStats.avgRiskScore || 50)) * 0.5 +
      (calStats.total > 0 ? 30 : 0) +
      (iatStats.executed > 0 ? 20 : 0)
    );

    return {
      healthScore,
      status: healthScore >= 70 ? "strong" : healthScore >= 40 ? "moderate" : "needs_attention",
      recommendationsExecuted: iatStats.executed || 0,
      allocationsRun:          calStats.total    || 0,
    };
  } catch { return { healthScore: 0, status: "unknown" }; }
}

function _getPortfolioBalance() {
  try {
    const pfs = _pfs()?.getCurrentStrategy?.();
    if (!pfs) return { hasStrategy: false };
    return {
      hasStrategy:   true,
      mode:          pfs.mode,
      overallScore:  pfs.overallScore,
      topFocus:      pfs.topFocus,
      dimensions:    Object.fromEntries(
        Object.entries(pfs.portfolio).map(([dim, v]) => [dim, { weight: v.weight, budget: v.budget, action: v.action }])
      ),
    };
  } catch { return { hasStrategy: false }; }
}

function _getBudgetUtilization() {
  try {
    const alloc = _cal()?.getCurrentAllocation?.();
    if (!alloc) return { utilized: false };
    const totalAlloc = alloc.totalBudget;
    const mrr        = _rev()?.getExecutiveRevenueDashboard?.()?.revenue?.mrr || 999;
    const utilizationRatio = totalAlloc > 0 ? Math.round((mrr / (totalAlloc / 12)) * 100) : 0;
    return {
      utilized:          true,
      totalBudget:       totalAlloc,
      currentMRR:        mrr,
      utilizationRatio,  // MRR / monthly budget %
      burnMultiple:      mrr > 0 ? Math.round(totalAlloc / mrr * 10) / 10 : 0,
    };
  } catch { return { utilized: false }; }
}

function _getFounderTimeSaved() {
  try {
    const iatStats = _iat()?.getStats?.() || { minutesSaved: 0 };
    const calStats = _cal()?.getStats?.() || { total: 0 };
    const rskStats = _rsk()?.getStats?.() || { total: 0 };
    const ianStats = _ian()?.getStats?.() || { total: 0 };
    const pfsStats = _pfs()?.getStats?.() || { total: 0 };

    const fromAutomation  = iatStats.minutesSaved || 0;
    const fromAllocation  = (calStats.total || 0) * 90;
    const fromRisk        = (rskStats.total || 0) * 45;
    const fromAnalysis    = (ianStats.total || 0) * 60;
    const fromPortfolio   = (pfsStats.total || 0) * 30;

    const total = fromAutomation + fromAllocation + fromRisk + fromAnalysis + fromPortfolio;
    return {
      totalMinutes: total,
      totalHours:   Math.round(total / 60 * 10) / 10,
      bySource: {
        automation:  fromAutomation,
        allocation:  fromAllocation,
        risk:        fromRisk,
        analysis:    fromAnalysis,
        portfolio:   fromPortfolio,
      },
    };
  } catch { return { totalMinutes: 0, totalHours: 0, bySource: {} }; }
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const capitalAllocation  = _getCapitalAllocation();
  const roiScore           = _getROIScore();
  const riskScore          = _getRiskScore();
  const investmentHealth   = _getInvestmentHealth();
  const portfolioBalance   = _getPortfolioBalance();
  const budgetUtilization  = _getBudgetUtilization();
  const founderTimeSaved   = _getFounderTimeSaved();

  return {
    ok: true,
    summary: {
      investmentServicesReused: INVESTMENT_SERVICES_REUSED,
      totalBudget:      capitalAllocation.totalBudget,
      avgROI:           roiScore.avgROI,
      riskScore:        riskScore.overallScore,
      investmentHealth: investmentHealth.healthScore,
      portfolioMode:    portfolioBalance.mode || "unset",
      founderHoursSaved: founderTimeSaved.totalHours,
    },
    capitalAllocation,
    roiScore,
    riskScore,
    investmentHealth,
    portfolioBalance,
    budgetUtilization,
    founderTimeSaved,
    generatedAt: new Date().toISOString(),
  };
}

// ── Pipeline view ─────────────────────────────────────────────────────────────

function getPipelineView() {
  const calStats = _cal()?.getStats?.() || {};
  const ianStats = _ian()?.getStats?.() || {};
  const pfsStats = _pfs()?.getStats?.() || {};
  const rskStats = _rsk()?.getStats?.() || {};
  const iatStats = _iat()?.getStats?.() || {};

  return {
    ok: true,
    pipeline: [
      { step: "Collect Metrics",        engine: "capitalAllocationEngine",    items: calStats.total,    status: calStats.total > 0 ? "active" : "idle" },
      { step: "Analyze ROI",            engine: "investmentAnalysisEngine",   items: ianStats.total,    status: ianStats.total > 0 ? "active" : "idle" },
      { step: "Rank Opportunities",     engine: "investmentAutomationEngine", items: iatStats.total,    status: iatStats.total > 0 ? "active" : "idle" },
      { step: "Assess Risk",            engine: "riskAssessmentEngine",       items: rskStats.total,    status: rskStats.total > 0 ? "active" : "idle" },
      { step: "Allocate Budget",        engine: "capitalAllocationEngine",    items: calStats.total,    status: calStats.total > 0 ? "active" : "idle" },
      { step: "Recommend Investment",   engine: "investmentAutomationEngine", items: iatStats.executed, status: iatStats.total > 0 ? "active" : "idle" },
      { step: "Simulate Outcomes",      engine: "portfolioStrategyEngine",    items: pfsStats.total,    status: pfsStats.total > 0 ? "active" : "idle" },
      { step: "Validate",               engine: "investmentAnalysisEngine",   items: null,              status: "delegated" },
      { step: "Approve",                engine: "approvalEngine",             items: null,              status: "delegated" },
      { step: "Execute",                engine: "autonomousExecutionEngine",  items: null,              status: "delegated" },
      { step: "Measure ROI",            engine: "investmentAnalysisEngine",   items: ianStats.total,    status: ianStats.total > 0 ? "active" : "idle" },
      { step: "Learn",                  engine: "selfImprovementEngine",      items: null,              status: "delegated" },
    ],
  };
}

// ── System health ─────────────────────────────────────────────────────────────

function getInvestmentSystemHealth() {
  const checks = [
    // P16 engines
    { name: "capitalAllocationEngine",    ok: !!_cal() },
    { name: "investmentAnalysisEngine",   ok: !!_ian() },
    { name: "portfolioStrategyEngine",    ok: !!_pfs() },
    { name: "riskAssessmentEngine",       ok: !!_rsk() },
    { name: "investmentAutomationEngine", ok: !!_iat() },
    { name: "investmentDashboard",        ok: true },
    // Existing platform services (24)
    { name: "revenueOS",                  ok: !!_rev() },
    { name: "customerHealthEngine",       ok: !!_che() },
    { name: "customerSuccessEngine",      ok: !!_cse() },
    { name: "revenueDiscoveryEngine",     ok: !!_rde() },
    { name: "revenueOptimizationEngine",  ok: !!_roe() },
    { name: "revenueForecastEngine",      ok: !!_rfe() },
    { name: "analyticsService",           ok: !!_ana() },
    { name: "businessReasoningEngine",    ok: !!_obi() },
    { name: "knowledgeReasoningEngine",   ok: !!_okb() },
    { name: "evolutionReasoningEngine",   ok: !!_ose() },
    { name: "digitalTwinEngine",          ok: !!_dt() },
    { name: "companyLifecycleEngine",     ok: !!_clf() },
    { name: "productPlannerEngine",       ok: !!_ppe() },
    { name: "marketplaceCatalogEngine",   ok: !!_mce() },
    { name: "knowledgeFederationEngine",  ok: !!_kfe() },
    { name: "autonomousExecutionEngine",  ok: !!_exe() },
    { name: "approvalEngine",             ok: !!_app() },
    { name: "workforceManager",           ok: !!_wf() },
    { name: "selfImprovementEngine",      ok: !!_sie() },
    { name: "companyBlueprintEngine",     ok: !!_bp() },
    { name: "workspaceMesh",              ok: !!_wm() },
    { name: "engineeringBenchmarkEngine", ok: !!_eb() },
    { name: "pricingIntelligenceEngine",  ok: !!_pie() },
  ];

  const seen = new Set();
  const deduped = checks.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
  const healthy  = deduped.filter(c => c.ok).length;
  const degraded = deduped.filter(c => !c.ok).length;

  return {
    ok: true,
    total:   deduped.length,
    healthy, degraded,
    status:  degraded === 0 ? "operational" : degraded < 5 ? "degraded" : "critical",
    services: deduped,
  };
}

module.exports = {
  INVESTMENT_SERVICES_REUSED,
  getDashboard,
  getPipelineView,
  getInvestmentSystemHealth,
};
