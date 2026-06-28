"use strict";
/**
 * engineeringIntelligenceDashboard.cjs — OAI X V1 Engineering Intelligence Evolution
 *
 * Unified dashboard aggregating the entire Engineering Intelligence platform:
 *   - Engineering Score (overall + 7 dimensions)
 *   - Architecture Score
 *   - Security Score
 *   - Performance Score
 *   - Technical Debt (engineering + arch + perf + security)
 *   - Prediction Accuracy
 *   - Engineering Health (all services)
 *   - Founder Time Saved
 *
 * No own storage — aggregates from all 6 new + all existing engineering services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _ere  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _eqe  = () => _try(() => require("./engineeringQualityEngine.cjs"));
const _ebe  = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _epe  = () => _try(() => require("./engineeringPredictionEngine.cjs"));
const _dee  = () => _try(() => require("./engineeringEvolutionEngine.cjs"));
const _em   = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _sh   = () => _try(() => require("./selfHealingRuntime.cjs"));
const _ro   = () => _try(() => require("./continuousRuntimeObserver.cjs"));
const _rr   = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _ede  = () => _try(() => require("./engineeringDecisionEngine.cjs"));
const _epc  = () => _try(() => require("./engineeringPipelineCoordinator.cjs"));

// ── Dashboard ─────────────────────────────────────────────────────────────────

function getDashboard() {
  const eqeStats  = _eqe()?.getStats?.()  || {};
  const ereStats  = _ere()?.getStats?.()  || {};
  const ebeStats  = _ebe()?.getStats?.()  || {};
  const epeStats  = _epe()?.getStats?.()  || {};
  const deeStatus = _dee()?.getEvolutionStatus?.() || {};
  const deeStats  = _dee()?.getStats?.()  || {};
  const emStats   = _em()?.getStatistics?.() || {};
  const raw       = _try(() => _cle()?.getRecommendations?.()) || {};
  const openRecs  = Array.isArray(raw) ? raw.length : (raw.recommendations || []).length;
  const cleStats  = _cle()?.getStats?.() || {};

  // Recent quality scores
  const recentScores = _eqe()?.listScores?.({ limit: 10 })?.scores || [];
  const avgQuality   = recentScores.length > 0
    ? +(recentScores.reduce((s, sc) => s + (sc.overall || 0), 0) / recentScores.length).toFixed(1)
    : null;

  const latestScore  = recentScores.slice(-1)[0];
  const dimensions   = latestScore?.dimensions || null;

  // Derived scores
  const architectureScore  = dimensions?.architecture    || null;
  const securityScore      = dimensions?.security        || null;
  const performanceScore   = dimensions?.performance     || null;
  const codeQualityScore   = dimensions?.code_quality    || null;

  // Debt report (context-agnostic)
  const debtReport = _dee()?.getDebtReport?.("current_repo") || null;

  // Fix success rate
  const fixRate = _ebe()?.getFixSuccessRate?.() || { rate: 0, totalFixes: 0 };

  // Runtime health
  const healStatus = _try(() => _sh()?.getStatus?.()) || {};
  const obsvHealth = _try(() => _ro()?.getHealth?.()) || {};
  const pipeStats  = _epc()?.getStats?.() || {};

  // Decision engine metrics
  const decisionMetrics = _try(() => _ede()?.getDashboardMetrics?.()) || {};

  // Engineering memory
  const memTimeline  = _try(() => _em()?.getKnowledgeGrowth?.()) || {};

  // Prediction accuracy (resolved vs total)
  const predStats    = epeStats;
  const predTotal    = predStats.total || 0;
  const predCritical = predStats.criticalPredictions || 0;

  const ENGINEERING_SERVICES_REUSED = 18;

  return {
    ok: true,
    summary: {
      engineeringScore:        avgQuality,
      architectureScore,
      securityScore,
      performanceScore,
      codeQualityScore,
      totalScoredContexts:     eqeStats.contexts || 0,
      totalScores:             eqeStats.total    || 0,
      totalEvolutionCycles:    deeStatus.totalCycles || 0,
      engineeringServicesReused: ENGINEERING_SERVICES_REUSED,
    },
    dimensions,
    technicalDebt: debtReport ? {
      total:         debtReport.totalDebt,
      engineering:   debtReport.engineeringDebt?.score,
      architecture:  debtReport.architectureDebt?.score,
      performance:   debtReport.performanceDebt?.score,
      security:      debtReport.securityDebt?.score,
      severity:      debtReport.severity,
    } : { total: null },
    fixSuccessRate: {
      rate:       fixRate.rate,
      totalFixes: fixRate.totalFixes,
    },
    reasoning: {
      totalAnalyses:    ereStats.total || 0,
      avgReasoningScore:ereStats.avgReasoningScore || null,
    },
    riskSummary: {
      avgRisk:            predStats.avgRisk || 0,
      criticalPredictions: predCritical,
      totalPredictions:   predTotal,
    },
    benchmarks: {
      totalRuns:            ebeStats.total    || 0,
      improvementsDetected: ebeStats.improvementsDetected || 0,
      regressionsDetected:  ebeStats.regressionsDetected  || 0,
    },
    learning: {
      totalLessons:    cleStats.totalLessons     || 0,
      openRecs:        openRecs,
      appliedLessons:  cleStats.appliedLessons   || 0,
      engineeringMemories: emStats.totalKnowledge || 0,
    },
    runtime: {
      healCycles:    healStatus.totalCycles    || 0,
      healSuccessRate: healStatus.successRate  || null,
      observerSources: obsvHealth.sources?.length || 0,
      pipelines:     pipeStats.total           || 0,
    },
    recentEvolutionCycles: _dee()?.listCycles?.({ limit: 3 })?.cycles?.map(c => ({
      id: c.id, context: c.context, qualityAfter: c.qualityAfter, improved: c.improved, ts: c.ts,
    })) || [],
    founderTimeSaved: {
      totalMinutes: deeStats.minutesSaved || 0,
      totalHours:   +((deeStats.minutesSaved || 0) / 60).toFixed(1),
      perCycle:     deeStatus.totalCycles > 0 ? Math.round((deeStats.minutesSaved || 0) / deeStatus.totalCycles) : 30,
    },
  };
}

// ── Context-specific view ─────────────────────────────────────────────────────

function getContextView(context) {
  if (!context) return { ok: false, error: "context required" };
  context = context || "current_repo";

  const qualHistory = _eqe()?.getHistory?.(context, 10)?.history || [];
  const trend       = _eqe()?.getTrend?.(context) || {};
  const latestScore = qualHistory.slice(-1)[0];
  const debt        = _dee()?.getDebtReport?.(context);
  const qualTrend   = _dee()?.getQualityTrend?.(context) || {};
  const predictions = _epe()?.listPredictions?.({ context, limit: 3 })?.predictions || [];
  const benchmarks  = _ebe()?.listBenchmarks?.({ context, limit: 3 })?.benchmarks || [];
  const cycles      = _dee()?.listCycles?.({ context, limit: 5 })?.cycles || [];

  return {
    ok: true, context,
    currentScore:      latestScore || null,
    qualityTrend:      { direction: trend.direction || qualTrend.direction, points: qualHistory.length },
    debt:              debt || null,
    recentPredictions: predictions.map(p => ({ id: p.id, riskScore: p.riskScore, total: p.total, criticalCount: p.criticalCount })),
    recentBenchmarks:  benchmarks.map(b => ({ id: b.id, type: b.type, overallDelta: b.overallDelta })),
    evolutionCycles:   cycles.length,
  };
}

// ── Engineering ecosystem health ──────────────────────────────────────────────

function getEngineeringHealth() {
  const services = [
    // existing engineering services
    { name: "engineeringMemoryEngine",       check: () => !!require("./engineeringMemoryEngine.cjs") },
    { name: "engineeringRuleRegistry",       check: () => !!require("./engineeringRuleRegistry.cjs") },
    { name: "engineeringDecisionEngine",     check: () => !!require("./engineeringDecisionEngine.cjs") },
    { name: "engineeringConfidenceEngine",   check: () => !!require("./engineeringConfidenceEngine.cjs") },
    { name: "continuousLearningEngine",      check: () => !!require("./continuousLearningEngine.cjs") },
    { name: "selfHealingRuntime",            check: () => !!require("./selfHealingRuntime.cjs") },
    { name: "continuousRuntimeObserver",     check: () => !!require("./continuousRuntimeObserver.cjs") },
    { name: "autonomousExecutionEngine",     check: () => !!require("./autonomousExecutionEngine.cjs") },
    { name: "engineeringBenchmark",          check: () => !!require("./engineeringBenchmark.cjs") },
    { name: "engineeringOrgWorkflow",        check: () => !!require("./engineeringOrgWorkflow.cjs") },
    { name: "engineeringOrgState",           check: () => !!require("./engineeringOrgState.cjs") },
    { name: "repositoryEditingEngine",       check: () => !!require("./repositoryEditingEngine.cjs") },
    { name: "aiComposerEngine",              check: () => !!require("./aiComposerEngine.cjs") },
    { name: "repoIntelligenceEngine",        check: () => !!require("./repoIntelligenceEngine.cjs") },
    { name: "engineeringSmellDetector",      check: () => !!require("./engineeringSmellDetector.cjs") },
    { name: "engineeringPipelineCoordinator",check: () => !!require("./engineeringPipelineCoordinator.cjs") },
    { name: "engineeringCapabilities",       check: () => !!require("./engineeringCapabilities.cjs") },
    { name: "workspaceMesh",                 check: () => !!require("./workspaceMesh.cjs") },
    // OAI X V1 new services
    { name: "engineeringReasoningEngine",    check: () => !!require("./engineeringReasoningEngine.cjs") },
    { name: "engineeringQualityEngine",      check: () => !!require("./engineeringQualityEngine.cjs") },
    { name: "engineeringBenchmarkEngine",    check: () => !!require("./engineeringBenchmarkEngine.cjs") },
    { name: "engineeringPredictionEngine",   check: () => !!require("./engineeringPredictionEngine.cjs") },
    { name: "engineeringEvolutionEngine",    check: () => !!require("./engineeringEvolutionEngine.cjs") },
    { name: "engineeringIntelligenceDashboard", check: () => true },
  ];

  const results = services.map(s => {
    try { return { name: s.name, ok: s.check(), status: "healthy" }; }
    catch { return { name: s.name, ok: false, status: "unavailable" }; }
  });

  return {
    ok:      true,
    healthy: results.filter(r => r.ok).length,
    total:   results.length,
    services:results,
  };
}

module.exports = { getDashboard, getContextView, getEngineeringHealth };
