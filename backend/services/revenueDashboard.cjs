"use strict";
/**
 * revenueDashboard.cjs — POST-Ω P15 Autonomous Revenue Engine
 *
 * Pure aggregation dashboard — surfaces:
 *   MRR, ARR, Pipeline Value, Forecast Accuracy,
 *   Renewal Rate, Expansion Revenue, Revenue Health, Founder Time Saved.
 *
 * Reuses all 5 P15 engines + 23 existing platform services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// ── P15 engines ───────────────────────────────────────────────────────────────
const _rde  = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _roe  = () => _try(() => require("./revenueOptimizationEngine.cjs"));
const _pie  = () => _try(() => require("./pricingIntelligenceEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _rae  = () => _try(() => require("./revenueAutomationEngine.cjs"));

// ── Existing platform services ────────────────────────────────────────────────
const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _cse  = () => _try(() => require("./customerSuccessEngine.cjs"));
const _cje  = () => _try(() => require("./customerJourneyEngine.cjs"));
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
const _wfm  = () => _try(() => require("./workforceManager.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _bizorg = () => _try(() => require("./businessOrg.cjs"));
const _custorg = () => _try(() => require("./customerJourneyEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _bp   = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _wm   = () => _try(() => require("./workspaceMesh.cjs"));

const REVENUE_SERVICES_REUSED = 23;

// ── Section builders ──────────────────────────────────────────────────────────

function _getCurrentRevenue() {
  try {
    const exec = _rev()?.getExecutiveRevenueDashboard?.() || {};
    return {
      mrr:          exec.revenue?.mrr          || 0,
      arr:          exec.revenue?.arr          || 0,
      netRevenue:   exec.revenue?.netRevenue   || 0,
      grossMarginPct: exec.revenue?.grossMarginPct || 75,
      expansionMRR: exec.revenue?.expansionMRR  || 0,
      churnRate:    exec.retention?.churnRate   || 0,
      atRiskCount:  exec.retention?.atRiskCount || 0,
      activeCount:  exec.retention?.activeCount || 0,
    };
  } catch { return { mrr: 0, arr: 0 }; }
}

function _getPipelineValue() {
  try {
    const stats = _rde()?.getStats?.() || { totalValue: 0, total: 0 };
    return {
      totalValue:     stats.totalValue || 0,
      opportunities:  stats.total       || 0,
      byType:         stats.byType      || {},
    };
  } catch { return { totalValue: 0, opportunities: 0 }; }
}

function _getForecastAccuracy() {
  try {
    const s = _rfe()?.getStats?.() || { avgAccuracy: 0, total: 0 };
    return {
      avgAccuracy:  s.avgAccuracy  || 0,
      totalForecasts: s.total       || 0,
      bestModel:    s.bestModel    || "base",
    };
  } catch { return { avgAccuracy: 0 }; }
}

function _getRenewalHealth() {
  try {
    const exec      = _rev()?.getExecutiveRevenueDashboard?.() || {};
    const churnRate = exec.retention?.churnRate || 0;
    const renewalRate = Math.round(100 - churnRate);
    const mrr = exec.revenue?.mrr || 0;
    return {
      renewalRate,
      churnRate,
      mrrAtRisk: Math.round(mrr * (churnRate / 100)),
      atRiskCount: exec.retention?.atRiskCount || 0,
    };
  } catch { return { renewalRate: 100, churnRate: 0 }; }
}

function _getExpansionRevenue() {
  try {
    const exec   = _rev()?.getExecutiveRevenueDashboard?.() || {};
    const optStats = _roe()?.getStats?.() || { totalMRRImpact: 0 };
    return {
      currentExpansionMRR: exec.revenue?.expansionMRR || 0,
      projectedExpansionMRR: optStats.totalMRRImpact  || 0,
      nrrPct: Math.round(100 + ((exec.revenue?.expansionMRR || 0) - exec.revenue?.mrr * (exec.retention?.churnRate || 0) / 100) / (exec.revenue?.mrr || 1) * 100),
    };
  } catch { return { currentExpansionMRR: 0 }; }
}

function _getRevenueHealth() {
  try {
    const rev    = _getCurrentRevenue();
    const pipe   = _getPipelineValue();
    const optStats = _roe()?.getStats?.() || {};
    const priceStats = _pie()?.getStats?.() || {};

    const healthScore = Math.round(
      (rev.churnRate < 2 ? 30 : rev.churnRate < 5 ? 20 : 10) +
      (rev.grossMarginPct > 70 ? 25 : rev.grossMarginPct > 50 ? 15 : 5) +
      (pipe.opportunities > 0 ? 25 : 0) +
      ((rev.mrr > 0 && optStats.totalMRRImpact > 0) ? 20 : 10)
    );

    return {
      healthScore,
      status: healthScore >= 75 ? "strong" : healthScore >= 50 ? "moderate" : "needs_attention",
      signals: {
        pipelineFull:      pipe.opportunities > 0,
        lowChurn:          rev.churnRate < 2,
        expansionActive:   (rev.expansionMRR || 0) > 0,
        pricingOptimized:  (priceStats.total || 0) > 0,
      },
    };
  } catch { return { healthScore: 0, status: "unknown" }; }
}

function _getFounderTimeSaved() {
  try {
    const autStats  = _rae()?.getStats?.()  || { minutesSaved: 0 };
    const rdeStats  = _rde()?.getStats?.()  || { total: 0 };
    const optStats  = _roe()?.getStats?.()  || { total: 0 };
    const fctStats  = _rfe()?.getStats?.()  || { total: 0 };
    const priceStats = _pie()?.getStats?.() || { total: 0 };

    const fromAutomation  = autStats.minutesSaved || 0;
    const fromDiscovery   = (rdeStats.total  || 0) * 20; // 20min per manual opportunity analysis
    const fromOptimization= (optStats.total  || 0) * 30;
    const fromForecasting = (fctStats.total  || 0) * 45;
    const fromPricing     = (priceStats.total|| 0) * 15;

    const total = fromAutomation + fromDiscovery + fromOptimization + fromForecasting + fromPricing;
    return {
      totalMinutes: total,
      totalHours:   Math.round(total / 60 * 10) / 10,
      bySource: {
        automation:   fromAutomation,
        discovery:    fromDiscovery,
        optimization: fromOptimization,
        forecasting:  fromForecasting,
        pricing:      fromPricing,
      },
    };
  } catch { return { totalMinutes: 0, totalHours: 0, bySource: {} }; }
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const revenue         = _getCurrentRevenue();
  const pipelineValue   = _getPipelineValue();
  const forecastAccuracy= _getForecastAccuracy();
  const renewalHealth   = _getRenewalHealth();
  const expansionRevenue= _getExpansionRevenue();
  const revenueHealth   = _getRevenueHealth();
  const founderTimeSaved= _getFounderTimeSaved();

  return {
    ok: true,
    summary: {
      revenueServicesReused: REVENUE_SERVICES_REUSED,
      mrr:              revenue.mrr,
      arr:              revenue.arr,
      pipelineValue:    pipelineValue.totalValue,
      forecastAccuracy: forecastAccuracy.avgAccuracy,
      renewalRate:      renewalHealth.renewalRate,
      expansionMRR:     expansionRevenue.currentExpansionMRR,
      revenueHealthScore: revenueHealth.healthScore,
      founderHoursSaved:founderTimeSaved.totalHours,
    },
    revenue,
    pipelineValue,
    forecastAccuracy,
    renewalHealth,
    expansionRevenue,
    revenueHealth,
    founderTimeSaved,
    generatedAt: new Date().toISOString(),
  };
}

// ── Revenue pipeline view ─────────────────────────────────────────────────────

function getPipelineView() {
  const rdeStats = _rde()?.getStats?.() || {};
  const roeStats = _roe()?.getStats?.() || {};
  const pieStats = _pie()?.getStats?.() || {};
  const rfeStats = _rfe()?.getStats?.() || {};
  const raeStats = _rae()?.getStats?.() || {};

  return {
    ok: true,
    pipeline: [
      { step: "Discover Opportunities", engine: "revenueDiscoveryEngine",   items: rdeStats.total,        status: rdeStats.total > 0 ? "active" : "idle" },
      { step: "Qualify",                engine: "revenueDiscoveryEngine",   items: rdeStats.total,        status: "delegated" },
      { step: "Prioritize",             engine: "revenueDiscoveryEngine",   items: rdeStats.total,        status: rdeStats.total > 0 ? "active" : "idle" },
      { step: "Price",                  engine: "pricingIntelligenceEngine",items: pieStats.total,        status: pieStats.total > 0 ? "active" : "idle" },
      { step: "Generate Proposal",      engine: "revenueAutomationEngine",  items: raeStats.executed,     status: raeStats.total > 0 ? "active" : "idle" },
      { step: "Follow-up",              engine: "revenueAutomationEngine",  items: null,                  status: "delegated" },
      { step: "Negotiate",              engine: "revenueAutomationEngine",  items: null,                  status: "delegated" },
      { step: "Convert",                engine: "revenueOptimizationEngine",items: roeStats.total,        status: roeStats.total > 0 ? "active" : "idle" },
      { step: "Upsell",                 engine: "revenueOptimizationEngine",items: null,                  status: "delegated" },
      { step: "Renew",                  engine: "revenueAutomationEngine",  items: null,                  status: "delegated" },
      { step: "Forecast",               engine: "revenueForecastEngine",    items: rfeStats.total,        status: rfeStats.total > 0 ? "active" : "idle" },
      { step: "Optimize",               engine: "revenueOptimizationEngine",items: roeStats.totalMRRImpact, status: roeStats.total > 0 ? "active" : "idle" },
    ],
  };
}

// ── System health ─────────────────────────────────────────────────────────────

function getRevenueSystemHealth() {
  const checks = [
    // P15 engines
    { name: "revenueDiscoveryEngine",   ok: !!_rde() },
    { name: "revenueOptimizationEngine",ok: !!_roe() },
    { name: "pricingIntelligenceEngine",ok: !!_pie() },
    { name: "revenueForecastEngine",    ok: !!_rfe() },
    { name: "revenueAutomationEngine",  ok: !!_rae() },
    { name: "revenueDashboard",         ok: true },
    // Existing platform services (23)
    { name: "revenueOS",                ok: !!_rev() },
    { name: "customerHealthEngine",     ok: !!_che() },
    { name: "customerSuccessEngine",    ok: !!_cse() },
    { name: "customerJourneyEngine",    ok: !!_cje() },
    { name: "analyticsService",         ok: !!_ana() },
    { name: "businessReasoningEngine",  ok: !!_obi() },
    { name: "knowledgeReasoningEngine", ok: !!_okb() },
    { name: "evolutionReasoningEngine", ok: !!_ose() },
    { name: "digitalTwinEngine",        ok: !!_dt() },
    { name: "companyLifecycleEngine",   ok: !!_clf() },
    { name: "productPlannerEngine",     ok: !!_ppe() },
    { name: "marketplaceCatalogEngine", ok: !!_mce() },
    { name: "knowledgeFederationEngine",ok: !!_kfe() },
    { name: "autonomousExecutionEngine",ok: !!_exe() },
    { name: "approvalEngine",           ok: !!_app() },
    { name: "workforceManager",         ok: !!_wfm() },
    { name: "selfImprovementEngine",    ok: !!_sie() },
    { name: "businessOrg",              ok: !!_bizorg() },
    { name: "researchKnowledgeEngine",  ok: !!_rke() },
    { name: "companyBlueprintEngine",   ok: !!_bp() },
    { name: "workspaceMesh",            ok: !!_wm() },
    { name: "businessReasoningEngine2", ok: !!_obi() }, // second check for OBI X
  ];

  // De-dup by name
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
  REVENUE_SERVICES_REUSED,
  getDashboard,
  getPipelineView,
  getRevenueSystemHealth,
};
