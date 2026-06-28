"use strict";
/**
 * businessIntelligenceDashboard.cjs — OBI X V1 Business Intelligence Evolution
 *
 * Pure aggregation dashboard. No own storage.
 * Aggregates all 6 new OBI X V1 services + 18 existing business services.
 *
 * Exports: getDashboard(), getContextView(context), getBusinessHealth()
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _bre  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _bqe  = () => _try(() => require("./businessQualityEngine.cjs"));
const _bbe  = () => _try(() => require("./businessBenchmarkEngine.cjs"));
const _bpe  = () => _try(() => require("./businessPredictionEngine.cjs"));
const _bee  = () => _try(() => require("./businessEvolutionEngine.cjs"));
const _bid  = () => _try(() => require("./businessIntelligenceDashboard.cjs"));

// Existing business services
const _bie  = () => _try(() => require("./businessIntelligenceEngine.cjs"));
const _bos  = () => _try(() => require("./businessOrgState.cjs"));
const _boe  = () => _try(() => require("./businessOrg.cjs"));
const _rev  = () => _try(() => require("./revenueOS.cjs"));
const _gos  = () => _try(() => require("./growthOS.cjs"));
const _cs   = () => _try(() => require("./customerSuccess.cjs"));
const _crm  = () => _try(() => require("./crmService.js"));
const _as   = () => _try(() => require("./analyticsService.cjs"));
const _bs   = () => _try(() => require("./billingService.js"));
const _cseo = () => _try(() => require("./contentSEOEngine.cjs"));
const _sce  = () => _try(() => require("./socialContentEngine.cjs"));
const _cf   = () => _try(() => require("./companyFactory.cjs"));
const _fp   = () => _try(() => require("./founderProfileEngine.cjs"));
const _wos  = () => _try(() => require("./workforceManager.cjs"));
const _wm   = () => _try(() => require("./workspaceMesh.cjs"));
const _ri   = () => _try(() => require("./researchPlanner.cjs"));
const _er   = () => _try(() => require("./executiveReasoning.cjs"));
const _ent  = () => _try(() => require("./enterpriseOrg.cjs"));
const _po   = () => _try(() => require("./platformOrg.cjs"));
const _bte  = () => _try(() => require("./businessTemplateEngine.cjs"));

const BUSINESS_SERVICES_REUSED = 18;

function getDashboard() {
  // OBI X V1 stats
  const breStats = _bre()?.getStats?.()      || {};
  const bqeStats = _bqe()?.getStats?.()      || {};
  const bbeStats = _bbe()?.getStats?.()      || {};
  const bpeStats = _bpe()?.getStats?.()      || {};
  const evoStats = _bee()?.getStats?.()      || {};
  const evoStatus= _bee()?.getEvolutionStatus?.() || {};

  // Existing service snapshots
  const biRaw   = _try(() => _bie()?.getRecommendations?.()) || {};
  const openRecs = (Array.isArray(biRaw) ? biRaw : (biRaw.recommendations || [])).filter(r => r.status === "open").length;
  const pipeline = _try(() => _bos()?.getPipelineStats?.())  || {};
  const csOverview = _try(() => _cs()?.getOverview?.())      || {};
  const crmStats   = _try(() => _crm()?.getStats?.())        || {};
  const recentBenchmarks = _bbe()?.listBenchmarks?.({ limit: 5 })?.benchmarks || [];
  const recentPreds      = _bpe()?.listPredictions?.({ limit: 5 })?.predictions || [];
  const recentCycles     = _bee()?.listCycles?.({ limit: 5 })?.cycles || [];

  const summary = {
    businessServicesReused: BUSINESS_SERVICES_REUSED,
    totalAnalyses:          breStats.total        || 0,
    totalScores:            bqeStats.total        || 0,
    totalBenchmarks:        bbeStats.total        || 0,
    totalPredictions:       bpeStats.total        || 0,
    totalEvolutionCycles:   evoStats.totalCycles  || 0,
    criticalPredictions:    bpeStats.criticalPredictions || 0,
    openBIRecommendations:  openRecs,
    avgBusinessScore:       bqeStats.avgOverall   || 0,
    avgReasoning:           breStats.avgScore     || 0,
  };

  const technicalDebt    = _bee()?.getDebtReport?.("current_business") || {};
  const improvSuccessRate= _bbe()?.getImprovementSuccessRate?.() || {};

  const founderTimeSaved = {
    totalMinutes: evoStats.minutesSaved  || 0,
    totalHours:   +((evoStats.minutesSaved || 0) / 60).toFixed(1),
    perCycle:     30,
  };

  return {
    ok: true,
    summary,
    pipelineStats:   pipeline,
    customerOverview:csOverview,
    technicalDebt,
    improvementSuccessRate: improvSuccessRate,
    reasoning:       { avgScore: breStats.avgScore || 0 },
    riskSummary:     { avgRisk: bpeStats.avgRisk || 0, criticals: bpeStats.criticalPredictions || 0 },
    benchmarks:      { total: bbeStats.total || 0, regressionsDetected: bbeStats.regressionsDetected || 0 },
    learning:        { openRecs },
    crmStats,
    recentBenchmarks,
    recentPredictions: recentPreds,
    recentEvolutionCycles: recentCycles,
    founderTimeSaved,
  };
}

function getContextView(context) {
  if (!context) return { ok: false, error: "context required" };

  const qualHist   = _bqe()?.getHistory?.(context, 10)?.history    || [];
  const qualTrend  = _bqe()?.getTrend?.(context)                   || {};
  const predList   = _bpe()?.listPredictions?.({ context, limit: 5 })?.predictions || [];
  const bmList     = _bbe()?.listBenchmarks?.({ context, limit: 5 })?.benchmarks   || [];
  const cycleList  = _bee()?.listCycles?.({ context, limit: 5 })?.cycles           || [];
  const debt       = _bee()?.getDebtReport?.(context)              || {};
  const current    = qualHist[qualHist.length - 1] || null;

  return {
    ok: true,
    context,
    currentScore:       current?.overall || null,
    qualityTrend:       qualTrend,
    recentPredictions:  predList,
    recentBenchmarks:   bmList,
    recentCycles:       cycleList,
    debt,
  };
}

function getBusinessHealth() {
  const services = [
    // OBI X V1 services
    { name: "businessReasoningEngine",     ok: !!_bre()?.getStats },
    { name: "businessQualityEngine",       ok: !!_bqe()?.getStats },
    { name: "businessBenchmarkEngine",     ok: !!_bbe()?.getStats },
    { name: "businessPredictionEngine",    ok: !!_bpe()?.getStats },
    { name: "businessEvolutionEngine",     ok: !!_bee()?.getStats },
    { name: "businessIntelligenceDashboard", ok: true },

    // Existing business services
    { name: "businessIntelligenceEngine",  ok: !!_bie()?.getRecommendations },
    { name: "businessOrgState",            ok: !!_bos()?.getAllKpis },
    { name: "businessOrg",                 ok: !!_boe()?.getOrgStatus },
    { name: "revenueOS",                   ok: !!_rev()?.getRevenueDashboard },
    { name: "growthOS",                    ok: !!_gos()?.getGrowthDashboard },
    { name: "customerSuccess",             ok: !!_cs()?.getOverview },
    { name: "crmService",                  ok: !!_crm()?.getStats },
    { name: "analyticsService",            ok: !!_as()?.getExecutive },
    { name: "billingService",              ok: !!_bs()?.getStatus },
    { name: "contentSEOEngine",            ok: !!_cseo()?.getDashboard },
    { name: "socialContentEngine",         ok: !!_sce()?.getDashboard },
    { name: "companyFactory",              ok: !!_cf()?.listBlueprints },
    { name: "founderProfileEngine",        ok: !!_fp()?.getProfile },
    { name: "workforceManager",            ok: !!_wos()?.listAgents },
    { name: "workspaceMesh",               ok: !!_wm()?.listWorkspaces },
    { name: "researchPlanner",             ok: !!_ri()?.listProjects },
    { name: "executiveReasoning",          ok: !!_er()?.runReasoning },
    { name: "enterpriseOrg",              ok: !!_ent()?.getOrgStatus },
  ];

  const healthy = services.filter(s => s.ok).length;
  return {
    ok:       true,
    total:    services.length,
    healthy,
    degraded: services.length - healthy,
    services,
    status:   healthy === services.length ? "operational" : healthy > services.length * 0.8 ? "degraded" : "critical",
  };
}

module.exports = { getDashboard, getContextView, getBusinessHealth, BUSINESS_SERVICES_REUSED };
