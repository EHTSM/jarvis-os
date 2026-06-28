"use strict";
/**
 * researchDashboard.cjs — POST-Ω Sprint P10 Autonomous Research Institute
 *
 * Pure aggregation dashboard for the Research Institute:
 *   - research backlog (priority-sorted)
 *   - running + completed experiments
 *   - benchmark history + trends
 *   - knowledge generated
 *   - improvement opportunities
 *   - research score (0-100)
 *   - technology radar
 *   - founder time saved
 *
 * No own storage — aggregates from all 5 research services.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _rp  = () => _try(() => require("./researchPlanner.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _bm  = () => _try(() => require("./benchmarkEngine.cjs"));
const _em  = () => _try(() => require("./experimentManager.cjs"));
const _rpe = () => _try(() => require("./researchPublicationEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

// ── Research score calculation ────────────────────────────────────────────────

function _calcResearchScore(planStats, expStats, bmStats, kStats) {
  let score = 0;
  // Plans: up to 25 pts
  if (planStats?.completed > 0) score += Math.min(25, planStats.completed * 5);
  // Experiments: up to 25 pts
  if (expStats?.completed  > 0) score += Math.min(25, expStats.completed  * 4);
  if (expStats?.validated  > 0) score += Math.min(10, expStats.validated  * 3);
  // Benchmarks: up to 20 pts
  if (bmStats?.totalRuns   > 0) score += Math.min(20, bmStats.totalRuns   * 2);
  if (bmStats?.improvementsDetected > 0) score += Math.min(10, bmStats.improvementsDetected * 2);
  // Knowledge: up to 10 pts
  if (kStats?.findingsIndexed > 0) score += Math.min(10, kStats.findingsIndexed);
  return Math.min(100, score);
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const planStats  = _rp()?.getStats?.()  || {};
  const expStats   = _em()?.getStats?.()  || {};
  const bmStats    = _bm()?.getStats?.()  || {};
  const kStats     = _rke()?.getStats?.()||{};
  const pubStats   = _rpe()?.getStats?.()||{};
  const cleStats   = _cle()?.getStats?.() || {};
  const emeStats   = _eme()?.getStatistics?.() || {};

  // Backlog
  const backlog = (_rp()?.getBacklog?.({ limit: 10 })?.backlog || []).map(b => ({
    planId:   b.planId,
    topic:    b.topic,
    domain:   b.domain,
    priority: b.priority,
  }));

  // Running experiments
  const runningExps = _em()?.listExperiments?.({ status: "running",   limit: 5 })?.experiments || [];
  const completedExps = _em()?.listExperiments?.({ status: "completed", limit: 10 })?.experiments || [];

  // Benchmark history (last run per target)
  const bmHistory = {};
  for (const target of Object.keys((_bm()?.BENCHMARK_TARGETS || {}))) {
    const h = _bm()?.getHistory?.(target, 3);
    if (h?.ok && h.history.length > 0) bmHistory[target] = h.history.slice(-1)[0];
  }

  // Knowledge generated
  const recentFindings = _rke()?.getFindings?.({ limit: 5 })?.findings || [];

  // Improvement opportunities
  const improvements = _rke()?.getRecommendations?.({ limit: 5 })?.recommendations || [];

  // Research score
  const researchScore = _calcResearchScore(planStats, expStats, bmStats, kStats);

  // Technology radar summary
  const radar = _rke()?.getRadar?.() || {};
  const radarSummary = {};
  for (const ring of (radar.rings || [])) {
    radarSummary[ring] = (radar.byRing?.[ring] || []).length;
  }

  // Evolution proposals
  const evolutionQueue = _rpe()?.getEvolutionQueue?.({ limit: 5 })?.queue || [];

  // Founder time saved
  const totalMinutesSaved = (planStats.minutesSaved || 0) + (pubStats.minutesSaved || 0);

  return {
    ok: true,
    summary: {
      totalPlans:          planStats.total         || 0,
      completedPlans:      planStats.completed     || 0,
      backlogSize:         planStats.backlogSize   || 0,
      totalExperiments:    expStats.total          || 0,
      completedExperiments:expStats.completed      || 0,
      validatedExperiments:expStats.validated      || 0,
      totalBenchmarkRuns:  bmStats.totalRuns       || 0,
      improvementsDetected:bmStats.improvementsDetected || 0,
      findingsIndexed:     kStats.findingsIndexed  || 0,
      publicationsGenerated: pubStats.totalPublished || 0,
      evolutionProposals:  pubStats.evolutionProposals || 0,
      totalMinutesSaved,
    },
    researchScore,
    backlog,
    runningExperiments:   runningExps.map(e => ({ id: e.id, name: e.name, type: e.type, planId: e.planId })),
    completedExperiments: completedExps.slice(-5).map(e => ({
      id: e.id, name: e.name, type: e.type,
      overallImprovement: e.results?.overallImprovement,
      confidence: e.results?.confidence,
      completedAt: e.completedAt,
    })),
    benchmarkHistory: bmHistory,
    recentFindings:   recentFindings.map(f => ({ id: f.id, topic: f.topic, domain: f.domain, confidence: f.confidence })),
    improvementOpportunities: improvements.slice(0, 5).map(r => ({ domain: r.domain, recommendation: r.recommendation, confidence: r.confidence })),
    radarSummary,
    evolutionQueue:   evolutionQueue.slice(0, 5),
    founderTimeSaved: {
      totalMinutes: totalMinutesSaved,
      totalHours:   Math.round(totalMinutesSaved / 60 * 10) / 10,
      perResearchCycle: planStats.completed > 0 ? Math.round(totalMinutesSaved / planStats.completed) : 0,
    },
    knowledge: {
      totalItems:    emeStats.totalItems     || 0,
      lessons:       cleStats.totalLessons   || 0,
      recommendations: cleStats.openRecs    || 0,
    },
  };
}

// ── Research score detail ─────────────────────────────────────────────────────

function getResearchScore() {
  const planStats = _rp()?.getStats?.()  || {};
  const expStats  = _em()?.getStats?.()  || {};
  const bmStats   = _bm()?.getStats?.()  || {};
  const kStats    = _rke()?.getStats?.() || {};
  const score     = _calcResearchScore(planStats, expStats, bmStats, kStats);

  return {
    ok: true, score,
    breakdown: {
      plans:       { completed: planStats.completed || 0, contribution: Math.min(25, (planStats.completed || 0) * 5) },
      experiments: { completed: expStats.completed  || 0, validated: expStats.validated || 0, contribution: Math.min(35, (expStats.completed || 0) * 4 + (expStats.validated || 0) * 3) },
      benchmarks:  { runs: bmStats.totalRuns || 0, improvements: bmStats.improvementsDetected || 0, contribution: Math.min(30, (bmStats.totalRuns || 0) * 2 + (bmStats.improvementsDetected || 0) * 2) },
      knowledge:   { findings: kStats.findingsIndexed || 0, contribution: Math.min(10, kStats.findingsIndexed || 0) },
    },
  };
}

// ── Benchmark detail view ─────────────────────────────────────────────────────

function getBenchmarkView({ target, limit = 10 } = {}) {
  if (target) {
    const history  = _bm()?.getHistory?.(target, limit) || { ok: false };
    const trend    = _bm()?.getTrend?.(target, { limit }) || { ok: false };
    const baseline = _bm()?.getBaseline?.(target);
    return { ok: true, target, history: history.history || [], trend: trend.direction, baseline };
  }

  // All targets summary
  const targets = Object.keys(_bm()?.BENCHMARK_TARGETS || {});
  const summary = targets.map(t => {
    const h = _bm()?.getHistory?.(t, 3) || { history: [] };
    const last = h.history.slice(-1)[0];
    return { target: t, lastRun: last?.ts, metrics: last?.metrics };
  });
  return { ok: true, targets: summary };
}

module.exports = {
  getDashboard,
  getResearchScore,
  getBenchmarkView,
};
