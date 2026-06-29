"use strict";
/**
 * evolutionBenchmarkEngine.cjs — OSE X V1 Self-Evolution Intelligence
 *
 * Benchmarks the platform's self-evolution capability against:
 *  - previous evolution cycles
 *  - accepted vs. rejected improvements
 *  - historical platform versions (selfReview trend)
 *  - research recommendations
 *
 * Storage: data/evolution-benchmarks.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "evolution-benchmarks.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _eqe = () => _try(() => require("./evolutionQualityEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _rpl = () => _try(() => require("./researchPlanner.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ebm_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EVOLUTION_BASELINE = {
  adaptability:             50,
  improvement_velocity:     45,
  architectural_stability:  60,
  execution_quality:        55,
  learning_effectiveness:   50,
  optimization_efficiency:  55,
  autonomy_maturity:        35,
  overall:                  50,
};

// ── Storage ───────────────────────────────────────────────────────────────────

let _baseline = { ...EVOLUTION_BASELINE };

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { benchmarks: [], improvementResults: [], stats: { total: 0, regressionsDetected: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.benchmarks.length > 200) d.benchmarks = d.benchmarks.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _store(bm) {
  const d = _load();
  d.benchmarks.push(bm);
  d.stats.total = d.benchmarks.length;
  _save(d);
}

// ── Compare helpers ───────────────────────────────────────────────────────────

async function compareVersions(context, opts = {}) {
  context = context || "current_evolution";
  const hist  = _eqe()?.getHistory?.(context, 10)?.history || [];
  const id    = _id();

  if (hist.length < 2) {
    const bm = { id, type: "version_compare", context, insufficient: true,
                 vsBaseline: 0, meetsOverall: false, productionReady: false,
                 createdAt: _ts() };
    _store(bm);
    return { ok: true, benchmark: bm };
  }

  const first  = hist[0].overall;
  const latest = hist[hist.length - 1].overall;
  const delta  = +(latest - first).toFixed(1);

  const bm = {
    id, type: "version_compare", context,
    first, latest, delta,
    vsBaseline:    +(latest - _baseline.overall).toFixed(1),
    meetsOverall:  latest >= _baseline.overall,
    productionReady: latest >= _baseline.overall && delta >= 0,
    trend:         delta > 2 ? "improving" : delta < -2 ? "declining" : "stable",
    createdAt: _ts(),
  };
  _store(bm);
  return { ok: true, benchmark: bm };
}

async function compareToBaseline(context, opts = {}) {
  context = context || "current_evolution";
  const hist   = _eqe()?.getHistory?.(context, 5)?.history || [];
  const latest = hist[hist.length - 1];
  const id     = _id();

  if (!latest) {
    const bm = { id, type: "baseline_compare", context, insufficient: true,
                 meetsOverall: false, productionReady: false, gaps: {},
                 createdAt: _ts() };
    _store(bm);
    return { ok: true, benchmark: bm };
  }

  const fullScore = _eqe()?.getScore?.(latest.id);
  const dims      = fullScore?.dimensions || {};
  const gaps      = {};
  let   met       = 0;

  Object.entries(_baseline).forEach(([k, base]) => {
    if (k === "overall") return;
    const actual = dims[k] ?? 0;
    const gap    = +(base - actual).toFixed(1);
    gaps[k]      = { actual, baseline: base, gap, meets: gap <= 0 };
    if (gap <= 0) met++;
  });

  const dimCount = Object.keys(gaps).length;
  const bm = {
    id, type: "baseline_compare", context,
    overall:         latest.overall,
    baselineOverall: _baseline.overall,
    vsBaseline:      +(latest.overall - _baseline.overall).toFixed(1),
    meetsOverall:    latest.overall >= _baseline.overall,
    dimsMet:         met,
    dimsTotal:       dimCount,
    gaps,
    productionReady: latest.overall >= _baseline.overall && met >= Math.ceil(dimCount * 0.7),
    createdAt: _ts(),
  };
  _store(bm);
  return { ok: true, benchmark: bm };
}

async function comparePreviousCycles(context) {
  context = context || "current_evolution";
  const sieStats  = _try(() => _sie()?.getStatistics?.()) || {};
  const cycles    = sieStats.evolutionCycles || 0;
  const pending   = sieStats.pendingPatterns || 0;
  const id        = _id();

  const assessment = cycles === 0 ? "no_cycles"
    : cycles < 3 ? "early"
    : cycles < 10 ? "developing"
    : "mature";

  const bm = {
    id, type: "cycle_compare", context,
    evolutionCycles: cycles,
    pendingPatterns: pending,
    assessment,
    recommendation: assessment === "no_cycles"
      ? "Run selfImprovementEngine.runEvolutionCycle() to begin tracking"
      : assessment === "early"
      ? "Continue running cycles — more data needed for comparison"
      : `${cycles} cycles run — platform is ${assessment}`,
    createdAt: _ts(),
  };
  _store(bm);
  return { ok: true, benchmark: bm };
}

async function compareResearchRecommendations(context) {
  context = context || "current_evolution";
  const plans    = _try(() => _rpl()?.listPlans?.({ limit: 10 })?.plans) || [];
  const active   = plans.filter(p => p.status === "active" || p.status === "running").length;
  const done     = plans.filter(p => p.status === "completed").length;
  const total    = plans.length;
  const coverage = total > 0 ? +(done / total * 100).toFixed(1) : 0;
  const id       = _id();

  const bm = {
    id, type: "research_compare", context,
    researchPlans: total, active, completed: done, coverage,
    recommendation: coverage > 70 ? "comprehensive"
      : coverage > 40 ? "moderate"
      : "sparse",
    createdAt: _ts(),
  };
  _store(bm);
  return { ok: true, benchmark: bm };
}

// ── Improvement results ───────────────────────────────────────────────────────

function recordImprovementResult({ improvId, context, beforeScore, afterScore, applied }) {
  const d       = _load();
  const success = applied && afterScore > beforeScore;
  const improvement = +(afterScore - beforeScore).toFixed(1);
  d.improvementResults = d.improvementResults || [];
  d.improvementResults.push({ improvId, context, beforeScore, afterScore, improvement, applied, success, recordedAt: _ts() });
  if (d.improvementResults.length > 500) d.improvementResults = d.improvementResults.slice(-500);
  _save(d);
  return { ok: true, success, improvement };
}

function getImprovementSuccessRate() {
  const d = _load();
  const results = d.improvementResults || [];
  if (!results.length) return { ok: true, rate: 0, total: 0, successful: 0 };
  const successful = results.filter(r => r.success).length;
  return { ok: true, rate: +(successful / results.length * 100).toFixed(1), total: results.length, successful };
}

function detectRegression(context) {
  const trend = _eqe()?.getTrend?.(context);
  if (!trend?.ok) return { ok: true, isRegression: false, reason: "insufficient data" };
  const isRegression = trend.direction === "declining" && Math.abs(trend.delta) > 5;
  return { ok: true, isRegression, direction: trend.direction, delta: trend.delta };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function getBenchmark(id) { return _load().benchmarks.find(b => b.id === id) || null; }

function listBenchmarks({ context, type, limit = 50 } = {}) {
  let bms = _load().benchmarks;
  if (context) bms = bms.filter(b => b.context === context);
  if (type)    bms = bms.filter(b => b.type === type);
  return { ok: true, benchmarks: bms.slice(-limit) };
}

function getBaseline()      { return { ..._baseline }; }
function setBaseline(patch) { _baseline = { ..._baseline, ...patch }; return { ok: true, baseline: _baseline }; }

function getStats() {
  const d = _load();
  const results = d.improvementResults || [];
  return {
    total:              d.stats?.total || 0,
    regressionsDetected: d.stats?.regressionsDetected || 0,
    improvementResults:  results.length,
    updatedAt:          d.updatedAt,
  };
}

module.exports = {
  EVOLUTION_BASELINE,
  compareVersions,
  compareToBaseline,
  comparePreviousCycles,
  compareResearchRecommendations,
  recordImprovementResult,
  getImprovementSuccessRate,
  detectRegression,
  getBenchmark,
  listBenchmarks,
  getBaseline,
  setBaseline,
  getStats,
};
