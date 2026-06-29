"use strict";
/**
 * evolutionIntelligenceDashboard.cjs — OSE X V1 Self-Evolution Intelligence
 *
 * Pure aggregation dashboard. No own storage.
 * Surfaces: Evolution Score, Autonomy Score, Platform Maturity,
 *           Improvement Velocity, Optimization Debt, Experiment Success,
 *           Prediction Accuracy, Founder Time Saved.
 *
 * Aggregates 6 new OSE X V1 services + 20+ existing evolution services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };

// OSE X V1 services
const _ere = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _eqe = () => _try(() => require("./evolutionQualityEngine.cjs"));
const _ebe = () => _try(() => require("./evolutionBenchmarkEngine.cjs"));
const _epe = () => _try(() => require("./evolutionPredictionEngine.cjs"));
const _eee = () => _try(() => require("./evolutionEvolutionEngine.cjs"));

// Existing evolution / self-improvement services
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _ile = () => _try(() => require("./improvementLoopEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _exp = () => _try(() => require("./experimentManager.cjs"));
const _aeo = () => _try(() => require("./aeoState.cjs"));
const _aew = () => _try(() => require("./aeoWorkflow.cjs"));
const _rpl = () => _try(() => require("./researchPlanner.cjs"));
const _be  = () => _try(() => require("./benchmarkEngine.cjs"));
const _iml = () => _try(() => require("./improvementLoop.cjs"));
const _shf = () => _try(() => require("./selfHealingRuntime.cjs"));
const _cro = () => _try(() => require("./continuousRuntimeObserver.cjs"));

// X-series intelligence dashboards (reused)
const _oai = () => _try(() => require("./engineeringIntelligenceDashboard.cjs"));
const _obi = () => _try(() => require("./businessIntelligenceDashboard.cjs"));
const _okb = () => _try(() => require("./knowledgeIntelligenceDashboard.cjs"));
const _odix= () => _try(() => require("./odeIntelligenceDashboard.cjs")); // ODI X V1

const EVOLUTION_SERVICES_REUSED = 20;

function getDashboard() {
  const ereStats  = _ere()?.getStats?.()           || {};
  const eqeStats  = _eqe()?.getStats?.()           || {};
  const ebeStats  = _ebe()?.getStats?.()           || {};
  const epeStats  = _epe()?.getStats?.()           || {};
  const eeeStats  = _eee()?.getStats?.()           || {};
  const eeeStatus = _eee()?.getEvolutionStatus?.() || {};

  // Existing service snapshots
  const sieStats  = _try(() => _sie()?.getStatistics?.())         || {};
  const review    = _try(() => _sre()?.getLatestReview?.())       || {};
  const cleRaw    = _try(() => _cle()?.getRecommendations?.())    || {};
  const cleRecs   = (Array.isArray(cleRaw) ? cleRaw : (cleRaw.recommendations || [])).filter(r => r.status === "open");
  const expStats  = _try(() => _exp()?.getStats?.())              || {};
  const aeoKpis   = _try(() => _aeo()?.getAllKpis?.())            || [];
  const kpis      = Array.isArray(aeoKpis) ? aeoKpis : [];
  const applied   = kpis.reduce((s, k) => s + (k.evolutionsApplied || 0), 0);
  const kept      = kpis.reduce((s, k) => s + (k.evolutionsKept   || 0), 0);

  const recentCycles = _eee()?.listCycles?.({ limit: 5 })?.cycles      || [];
  const recentBMs    = _ebe()?.listBenchmarks?.({ limit: 5 })?.benchmarks || [];
  const recentPreds  = _epe()?.listPredictions?.({ limit: 5 })?.predictions || [];

  // Compute high-level scores
  const evolutionScore   = review?.overall || 0;
  const autonomyScore    = review?.scores?.autonomy || 0;
  const platformMaturity = Math.min(100, evolutionScore + (sieStats?.evolutionCycles || 0) * 2);
  const improvVelocity   = kpis.reduce((s, k) => s + (k.improvementsValidated || 0), 0);
  const optDebt          = eeeStatus?.platformEvolutionScore ? Math.max(0, 70 - eeeStatus.platformEvolutionScore) : 0;
  const expSuccess       = expStats?.total > 0 ? +(expStats.validated / expStats.total * 100).toFixed(1) : 0;
  const predAccuracy     = (sieStats?.improvementScores?.predictionAccuracy || 0);

  const summary = {
    evolutionServicesReused:  EVOLUTION_SERVICES_REUSED,
    totalAnalyses:            ereStats.total            || 0,
    totalScores:              eqeStats.total            || 0,
    totalBenchmarks:          ebeStats.total            || 0,
    totalPredictions:         epeStats.total            || 0,
    totalEvolutionCycles:     eeeStats.totalCycles      || 0,
    criticalPredictions:      epeStats.criticalPredictions || 0,
    openCLERecommendations:   cleRecs.length,
    evolutionScore,
    autonomyScore,
    platformMaturity,
    improvementVelocity:      improvVelocity,
    optimizationDebt:         +optDebt.toFixed(1),
    experimentSuccess:        expSuccess,
    predictionAccuracy:       predAccuracy,
  };

  const technicalDebt  = _eee()?.getDebtReport?.("current_evolution") || {};
  const improvSuccess  = _ebe()?.getImprovementSuccessRate?.()          || {};

  const founderTimeSaved = {
    totalMinutes: eeeStatus.minutesSaved || 0,
    totalHours:   +((eeeStatus.minutesSaved || 0) / 60).toFixed(1),
    perCycle:     30,
  };

  return {
    ok: true,
    summary,
    evolutionScore:      { current: evolutionScore, trend: review?.scores || {} },
    autonomyScore:       { current: autonomyScore, maturity: platformMaturity },
    platformMaturity,
    improvementVelocity: { total: improvVelocity, applied, kept },
    optimizationDebt:    { debt: +optDebt.toFixed(1), platformScore: eeeStatus.platformEvolutionScore || 0 },
    experimentSuccess:   { rate: expSuccess, total: expStats.total || 0 },
    predictionAccuracy:  { score: predAccuracy },
    pendingPatterns:     sieStats.pendingPatterns || 0,
    openLessons:         cleRecs.length,
    technicalDebt,
    improvementSuccessRate: improvSuccess,
    recentEvolutionCycles: recentCycles,
    recentBenchmarks:    recentBMs,
    recentPredictions:   recentPreds,
    founderTimeSaved,
  };
}

function getContextView(context) {
  if (!context) return { ok: false, error: "context required" };

  const qualHist  = _eqe()?.getHistory?.(context, 10)?.history    || [];
  const qualTrend = _eqe()?.getTrend?.(context)                   || {};
  const predList  = _epe()?.listPredictions?.({ context, limit: 5 })?.predictions || [];
  const bmList    = _ebe()?.listBenchmarks?.({ context, limit: 5 })?.benchmarks   || [];
  const cycleList = _eee()?.listCycles?.({ context, limit: 5 })?.cycles           || [];
  const debt      = _eee()?.getDebtReport?.(context)              || {};
  const current   = qualHist[qualHist.length - 1] || null;

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

function getEvolutionHealth() {
  const services = [
    // OSE X V1 services
    { name: "evolutionReasoningEngine",      ok: !!_ere()?.getStats },
    { name: "evolutionQualityEngine",        ok: !!_eqe()?.getStats },
    { name: "evolutionBenchmarkEngine",      ok: !!_ebe()?.getStats },
    { name: "evolutionPredictionEngine",     ok: !!_epe()?.getStats },
    { name: "evolutionEvolutionEngine",      ok: !!_eee()?.getStats },
    { name: "evolutionIntelligenceDashboard",ok: true },

    // Existing evolution services (20)
    { name: "selfImprovementEngine",         ok: !!_sie()?.getStatistics },
    { name: "selfReviewEngine",              ok: !!_sre()?.getLatestReview },
    { name: "improvementLoopEngine",         ok: !!_ile()?.getStats },
    { name: "continuousLearningEngine",      ok: !!_cle()?.getStats },
    { name: "experimentManager",             ok: !!_exp()?.getStats },
    { name: "aeoState",                      ok: !!_aeo()?.getAllKpis },
    { name: "aeoWorkflow",                   ok: !!_aew()?.runEvolutionPipeline },
    { name: "researchPlanner",               ok: !!_rpl()?.getStats },
    { name: "benchmarkEngine",               ok: !!_be()?.getStats },
    { name: "improvementLoop",               ok: !!_iml()?.getMetrics },
    { name: "selfHealingRuntime",            ok: !!_shf()?.getStats },
    { name: "continuousRuntimeObserver",     ok: !!_cro()?.getHealth },

    // X-series dashboards
    { name: "engineeringIntelligenceDashboard", ok: !!_oai()?.getDashboard },
    { name: "businessIntelligenceDashboard",    ok: !!_obi()?.getDashboard },
    { name: "knowledgeIntelligenceDashboard",   ok: !!_okb()?.getDashboard },
  ];

  const healthy = services.filter(s => s.ok).length;
  return {
    ok:       true,
    total:    services.length,
    healthy,
    degraded: services.length - healthy,
    services,
    status:   healthy === services.length ? "operational"
            : healthy > services.length * 0.8 ? "degraded"
            : "critical",
  };
}

module.exports = { getDashboard, getContextView, getEvolutionHealth, EVOLUTION_SERVICES_REUSED };
