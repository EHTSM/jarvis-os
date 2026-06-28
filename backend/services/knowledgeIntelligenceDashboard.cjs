"use strict";
/**
 * knowledgeIntelligenceDashboard.cjs — OKB X V1 Knowledge Intelligence Evolution
 *
 * Pure aggregation dashboard. No own storage.
 * Aggregates 6 new OKB X V1 services + 18+ existing knowledge services.
 *
 * Exports: getDashboard(), getContextView(context), getKnowledgeHealth()
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// OKB X V1 services
const _kre = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _kqe = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _kbe = () => _try(() => require("./knowledgeBenchmarkEngine.cjs"));
const _kpe = () => _try(() => require("./knowledgePredictionEngine.cjs"));
const _kee = () => _try(() => require("./knowledgeEvolutionEngine.cjs"));

// Existing knowledge services
const _kg  = () => _try(() => require("./knowledgeGraph.cjs"));
const _gr  = () => _try(() => require("./graphReasoningEngine.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ako = () => _try(() => require("./akoState.cjs"));
const _akw = () => _try(() => require("./akoWorkflow.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _rpu = () => _try(() => require("./researchPublicationEngine.cjs"));
const _rpl = () => _try(() => require("./researchPlanner.cjs"));
const _mi  = () => _try(() => require("./memoryIntelligenceEngine.cjs"));
const _mpl = () => _try(() => require("./memoryPersistenceLayer.cjs"));
const _fp  = () => _try(() => require("./founderProfileEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));
const _wm  = () => _try(() => require("./workspaceMesh.cjs"));
const _wos = () => _try(() => require("./workforceManager.cjs"));
const _cf  = () => _try(() => require("./companyFactory.cjs"));
const _er  = () => _try(() => require("./executiveReasoning.cjs"));
const _ent = () => _try(() => require("./enterpriseOrg.cjs"));
const _po  = () => _try(() => require("./platformOrg.cjs"));

const KNOWLEDGE_SERVICES_REUSED = 20;

function getDashboard() {
  const kreStats = _kre()?.getStats?.()           || {};
  const kqeStats = _kqe()?.getStats?.()           || {};
  const kbeStats = _kbe()?.getStats?.()           || {};
  const kpeStats = _kpe()?.getStats?.()           || {};
  const keeStats = _kee()?.getStats?.()           || {};
  const keeStatus= _kee()?.getEvolutionStatus?.() || {};

  // Existing service snapshots
  const graphStats    = _try(() => _kg()?.getStats?.())                  || {};
  const graphHealth   = _try(() => _gr()?.getHealthScore?.())            || 0;
  const cleRaw        = _try(() => _cle()?.getRecommendations?.())       || {};
  const cleRecs       = (Array.isArray(cleRaw) ? cleRaw : (cleRaw.recommendations || [])).filter(r => r.status === "open");
  const miReport      = _try(() => _mi()?.getIntelligenceReport?.())     || {};
  const rkeStats      = _try(() => _rke()?.getStats?.())                 || {};
  const recentCycles  = _kee()?.listCycles?.({ limit: 5 })?.cycles      || [];
  const recentBMs     = _kbe()?.listBenchmarks?.({ limit: 5 })?.benchmarks || [];
  const recentPreds   = _kpe()?.listPredictions?.({ limit: 5 })?.predictions || [];

  const summary = {
    knowledgeServicesReused: KNOWLEDGE_SERVICES_REUSED,
    totalAnalyses:           kreStats.total           || 0,
    totalScores:             kqeStats.total           || 0,
    totalBenchmarks:         kbeStats.total           || 0,
    totalPredictions:        kpeStats.total           || 0,
    totalEvolutionCycles:    keeStats.totalCycles     || 0,
    criticalPredictions:     kpeStats.criticalPredictions || 0,
    openCLERecommendations:  cleRecs.length,
    avgKnowledgeScore:       kqeStats.avgOverall      || 0,
    avgReasoningScore:       kreStats.avgScore        || 0,
    graphNodes:              graphStats?.nodes        || 0,
    graphHealth,
  };

  const technicalDebt  = _kee()?.getDebtReport?.("current_knowledge") || {};
  const improvSuccess  = _kbe()?.getImprovementSuccessRate?.()         || {};

  const founderTimeSaved = {
    totalMinutes: keeStatus.minutesSaved || 0,
    totalHours:   +((keeStatus.minutesSaved || 0) / 60).toFixed(1),
    perCycle:     25,
  };

  return {
    ok: true,
    summary,
    graphSnapshot:       { nodes: graphStats?.nodes || 0, edges: graphStats?.edges || 0, health: graphHealth },
    memoryHealth:        miReport,
    researchSnapshot:    { findings: rkeStats?.totalFindings || 0 },
    technicalDebt,
    improvementSuccessRate: improvSuccess,
    reasoning:           { avgScore: kreStats.avgScore || 0 },
    riskSummary:         { avgRisk: kpeStats.avgRisk || 0, criticals: kpeStats.criticalPredictions || 0 },
    benchmarks:          { total: kbeStats.total || 0, regressionsDetected: kbeStats.regressionsDetected || 0 },
    learning:            { openRecs: cleRecs.length },
    recentEvolutionCycles: recentCycles,
    recentBenchmarks:    recentBMs,
    recentPredictions:   recentPreds,
    founderTimeSaved,
  };
}

function getContextView(context) {
  if (!context) return { ok: false, error: "context required" };

  const qualHist   = _kqe()?.getHistory?.(context, 10)?.history    || [];
  const qualTrend  = _kqe()?.getTrend?.(context)                   || {};
  const predList   = _kpe()?.listPredictions?.({ context, limit: 5 })?.predictions || [];
  const bmList     = _kbe()?.listBenchmarks?.({ context, limit: 5 })?.benchmarks   || [];
  const cycleList  = _kee()?.listCycles?.({ context, limit: 5 })?.cycles           || [];
  const debt       = _kee()?.getDebtReport?.(context)              || {};
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

function getKnowledgeHealth() {
  const services = [
    // OKB X V1 services
    { name: "knowledgeReasoningEngine",      ok: !!_kre()?.getStats },
    { name: "knowledgeQualityEngine",        ok: !!_kqe()?.getStats },
    { name: "knowledgeBenchmarkEngine",      ok: !!_kbe()?.getStats },
    { name: "knowledgePredictionEngine",     ok: !!_kpe()?.getStats },
    { name: "knowledgeEvolutionEngine",      ok: !!_kee()?.getStats },
    { name: "knowledgeIntelligenceDashboard",ok: true },

    // Existing knowledge services (20)
    { name: "knowledgeGraph",                ok: !!_kg()?.getStats },
    { name: "graphReasoningEngine",          ok: !!_gr()?.getHealthScore },
    { name: "engineeringMemoryEngine",       ok: !!_em()?.getStatistics },
    { name: "continuousLearningEngine",      ok: !!_cle()?.getStats },
    { name: "akoState",                      ok: !!_ako()?.getAllKpis },
    { name: "akoWorkflow",                   ok: !!_akw()?.runKnowledgePipeline },
    { name: "missionMemory",                 ok: !!_mm()?.getMissionStats },
    { name: "researchKnowledgeEngine",       ok: !!_rke()?.getStats },
    { name: "researchPublicationEngine",     ok: !!_rpu()?.getStats },
    { name: "researchPlanner",               ok: !!_rpl()?.getStats },
    { name: "memoryIntelligenceEngine",      ok: !!_mi()?.getIntelligenceReport },
    { name: "memoryPersistenceLayer",        ok: !!_mpl()?.stats },
    { name: "founderProfileEngine",          ok: !!_fp()?.getProfile },
    { name: "founderWorkRegistry",           ok: !!_fwr()?.listWorkflows },
    { name: "workspaceMesh",                 ok: !!_wm()?.listWorkspaces },
    { name: "workforceManager",              ok: !!_wos()?.listAgents },
    { name: "companyFactory",               ok: !!_cf()?.listBlueprints },
    { name: "executiveReasoning",            ok: !!_er()?.runReasoning },
    { name: "enterpriseOrg",               ok: !!_ent()?.getOrgStatus },
    { name: "platformOrg",                  ok: !!_po()?.getOrgStatus },
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

module.exports = { getDashboard, getContextView, getKnowledgeHealth, KNOWLEDGE_SERVICES_REUSED };
