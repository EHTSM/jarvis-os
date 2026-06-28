"use strict";
/**
 * businessBenchmarkEngine.cjs — OBI X V1 Business Intelligence Evolution
 *
 * Benchmarks business quality over time:
 *   - compare vs previous months / quarters
 *   - compare vs previous campaigns / launches
 *   - compare vs baseline
 *   - track improvement success rate
 *   - detect business regressions
 *
 * Reuses: businessQualityEngine, businessOrgState, revenueOS,
 *         businessIntelligenceEngine, analyticsService
 *
 * Storage: data/business-benchmarks.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "business-benchmarks.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bqe = () => _try(() => require("./businessQualityEngine.cjs"));
const _bos = () => _try(() => require("./businessOrgState.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _bie = () => _try(() => require("./businessIntelligenceEngine.cjs"));
const _as  = () => _try(() => require("./analyticsService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `bbm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Baseline ──────────────────────────────────────────────────────────────────

const BUSINESS_BASELINE = {
  revenue_health:     65,
  customer_health:    70,
  growth_health:      60,
  sales_health:       60,
  marketing_health:   60,
  retention_health:   65,
  operational_health: 65,
  overall:            64,
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      benchmarks: [],
      baseline:   { ...BUSINESS_BASELINE },
      fixHistory: [],
      stats: { total: 0, improvementsDetected: 0, regressionsDetected: 0, fixSuccessRate: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.benchmarks.length > 300) d.benchmarks = d.benchmarks.slice(-300);
  if (d.fixHistory.length > 200) d.fixHistory  = d.fixHistory.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Benchmark functions ───────────────────────────────────────────────────────

async function compareVersions(context, { currentScore, previousScore } = {}) {
  context = context || "current_business";
  const d    = _load();
  const hist = _bqe()?.getHistory?.(context, 2)?.history || [];
  const curr = currentScore?.dimensions || hist[hist.length - 1]?.dimensions || {};
  const prev = previousScore?.dimensions || hist[hist.length - 2]?.dimensions || null;
  const currOverall = currentScore?.overall  || hist[hist.length - 1]?.overall  || 64;
  const prevOverall = previousScore?.overall || hist[hist.length - 2]?.overall  || null;

  const dims   = Object.keys(BUSINESS_BASELINE).filter(k => k !== "overall");
  const deltas = {};
  for (const dim of dims) {
    const c = curr[dim] ?? BUSINESS_BASELINE[dim];
    const p = prev?.[dim] ?? BUSINESS_BASELINE[dim];
    deltas[dim] = { current: c, previous: p, delta: +(c - p).toFixed(1) };
  }

  const overallDelta   = prevOverall != null ? +(currOverall - prevOverall).toFixed(1) : null;
  const isImprovement  = overallDelta != null ? overallDelta > 0 : null;

  const bm = {
    id:            _id(),
    context,
    type:          "version_compare",
    current:       { overall: currOverall, dimensions: curr },
    previous:      { overall: prevOverall, dimensions: prev },
    deltas,
    overallDelta,
    isImprovement,
    vsBaseline:    +(currOverall - BUSINESS_BASELINE.overall).toFixed(1),
    ts:            _ts(),
  };

  d.benchmarks.push(bm);
  d.stats.total++;
  if (isImprovement === true)  d.stats.improvementsDetected++;
  if (isImprovement === false) d.stats.regressionsDetected++;
  _save(d);
  return { ok: true, benchmark: bm };
}

async function compareToBaseline(context, { currentScore } = {}) {
  context = context || "current_business";
  const d    = _load();
  const hist = _bqe()?.getHistory?.(context, 1)?.history || [];
  const currDims    = currentScore?.dimensions || hist[hist.length - 1]?.dimensions || {};
  const currOverall = currentScore?.overall    || hist[hist.length - 1]?.overall    || 64;

  const gaps = {};
  for (const [dim, baseVal] of Object.entries(d.baseline)) {
    if (dim === "overall") continue;
    const curr = currDims[dim] ?? 64;
    gaps[dim]  = { current: curr, baseline: baseVal, gap: +(curr - baseVal).toFixed(1), meetsBaseline: curr >= baseVal };
  }

  const meetsOverall = currOverall >= d.baseline.overall;
  const dimsMeeting  = Object.values(gaps).filter(g => g.meetsBaseline).length;
  const totalDims    = Object.keys(gaps).length;

  const bm = {
    id:                _id(),
    context,
    type:              "baseline_compare",
    current:           { overall: currOverall, dimensions: currDims },
    baseline:          d.baseline,
    gaps,
    meetsOverall,
    dimensionsMeeting: `${dimsMeeting}/${totalDims}`,
    productionReady:   meetsOverall && dimsMeeting >= Math.round(totalDims * 0.7),
    ts:                _ts(),
  };

  d.benchmarks.push(bm);
  d.stats.total++;
  _save(d);
  return { ok: true, benchmark: bm };
}

async function compareQuarter(context, { quarter } = {}) {
  context = context || "current_business";
  const d    = _load();
  const hist = _bqe()?.getHistory?.(context, 90)?.history || [];

  // quarter grouping: last 3 months vs previous 3 months
  const now     = Date.now();
  const q1Start = now - 90 * 24 * 3600 * 1000;
  const q2Start = now - 180 * 24 * 3600 * 1000;
  const recent  = hist.filter(h => new Date(h.scoredAt).getTime() >= q1Start);
  const prior   = hist.filter(h => {
    const t = new Date(h.scoredAt).getTime();
    return t >= q2Start && t < q1Start;
  });

  const avgScore = arr => arr.length > 0 ? +(arr.reduce((s, h) => s + h.overall, 0) / arr.length).toFixed(1) : null;
  const recentAvg = avgScore(recent);
  const priorAvg  = avgScore(prior);
  const delta     = recentAvg != null && priorAvg != null ? +(recentAvg - priorAvg).toFixed(1) : null;

  const bm = {
    id:           _id(),
    context,
    type:         "quarter_compare",
    quarter:      quarter || _bos()?.currentQuarter?.() || "Q-current",
    recentAvg,
    priorAvg,
    delta,
    trend:        delta == null ? "insufficient_data" : delta > 2 ? "improving" : delta < -2 ? "declining" : "stable",
    ts:           _ts(),
  };

  d.benchmarks.push(bm);
  d.stats.total++;
  _save(d);
  return { ok: true, benchmark: bm };
}

function recordImprovementResult({ improvId, context, beforeScore, afterScore, applied }) {
  const d = _load();
  const improvement = afterScore != null && beforeScore != null ? afterScore - beforeScore : null;
  const success     = applied && (improvement == null || improvement >= 0);
  d.fixHistory.push({ improvId, context, beforeScore, afterScore, improvement, applied, success, ts: _ts() });
  const recent = d.fixHistory.slice(-20);
  d.stats.fixSuccessRate = recent.length > 0 ? +(recent.filter(f => f.success).length / recent.length * 100).toFixed(1) : 0;
  _save(d);
  return { ok: true, improvId, success, improvement };
}

function getImprovementSuccessRate() {
  const d      = _load();
  const recent = d.fixHistory.slice(-20);
  const rate   = recent.length > 0 ? recent.filter(f => f.success).length / recent.length * 100 : 0;
  return { ok: true, rate: +rate.toFixed(1), totalImprovements: d.fixHistory.length };
}

function detectRegression(context) {
  const trend        = _bqe()?.getTrend?.(context || "current_business") || {};
  const isRegression = trend.direction === "declining";
  const d = _load();
  if (isRegression) d.stats.regressionsDetected++;
  _save(d);
  return {
    ok:            true,
    context,
    isRegression,
    businessTrend: trend.direction || "unknown",
    recommendation: isRegression
      ? "Business quality declining — run improvement cycle immediately"
      : "No regression detected — maintain current business trajectory",
  };
}

function getBenchmark(id)  { return _load().benchmarks.find(b => b.id === id) || null; }
function listBenchmarks({ context, type, limit = 50 } = {}) {
  let list = _load().benchmarks;
  if (context) list = list.filter(b => b.context === context);
  if (type)    list = list.filter(b => b.type    === type);
  return { ok: true, benchmarks: list.slice(-limit) };
}
function getBaseline()       { return _load().baseline; }
function setBaseline(values) {
  const d = _load(); d.baseline = { ...d.baseline, ...values }; _save(d);
  return { ok: true, baseline: d.baseline };
}
function getStats() { return { ..._load().stats, BUSINESS_BASELINE, updatedAt: _load().updatedAt }; }

module.exports = {
  BUSINESS_BASELINE,
  compareVersions,
  compareToBaseline,
  compareQuarter,
  recordImprovementResult,
  getImprovementSuccessRate,
  detectRegression,
  getBenchmark,
  listBenchmarks,
  getBaseline,
  setBaseline,
  getStats,
};
