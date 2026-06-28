"use strict";
/**
 * designBenchmarkEngine.cjs — ODI X V1 Visual Intelligence Evolution
 *
 * Benchmarks UI quality over time and against best practices:
 *   - compares current vs previous versions (version-to-version delta)
 *   - compares against accepted patches (patch success tracking)
 *   - compares against internal best-practice baselines
 *   - tracks patch success rate, visual regression delta
 *
 * Reuses: designQualityEngine, uiPatchGenerator, visualRegressionEngine,
 *         designMemory, researchBenchmarkEngine (platform).
 *
 * Storage: data/design-benchmarks.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "design-benchmarks.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _dqe = () => _try(() => require("./designQualityEngine.cjs"));
const _up  = () => _try(() => require("./uiPatchGenerator.cjs"));
const _vreg= () => _try(() => require("./visualRegressionEngine.cjs"));
const _dm  = () => _try(() => require("./designMemory.cjs"));
const _bm  = () => _try(() => require("./benchmarkEngine.cjs"));   // platform benchmark for comparison

function _ts() { return new Date().toISOString(); }
function _id() { return `dbm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Internal design quality baselines (best practices) ────────────────────────

const BEST_PRACTICE_BASELINE = {
  aesthetics:      75,
  usability:       80,
  accessibility:   90,
  consistency:     75,
  responsiveness:  85,
  maintainability: 70,
  performance:     75,
  overall:         78,
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      benchmarks:    [],
      baseline:      { ...BEST_PRACTICE_BASELINE },
      patchHistory:  [],
      stats: { total: 0, improvementsDetected: 0, regressionsDetected: 0, patchSuccessRate: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.benchmarks.length   > 300) d.benchmarks  = d.benchmarks.slice(-300);
  if (d.patchHistory.length > 200) d.patchHistory = d.patchHistory.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Version comparison ────────────────────────────────────────────────────────

async function compareVersions(pageUrl, { currentScore, previousScore } = {}) {
  if (!pageUrl) return { ok: false, error: "pageUrl required" };

  const d = _load();

  // If no scores provided, pull from quality engine history
  const hist  = _dqe()?.getHistory?.(pageUrl, 2)?.history || [];
  const curr  = currentScore  || hist[hist.length - 1]?.dimensions || {};
  const prev  = previousScore || hist[hist.length - 2]?.dimensions || null;

  const currOverall = currentScore?.overall  || hist[hist.length - 1]?.overall || 70;
  const prevOverall = previousScore?.overall || hist[hist.length - 2]?.overall || null;

  const deltas = {};
  const dims = ["aesthetics","usability","accessibility","consistency","responsiveness","maintainability","performance"];

  for (const dim of dims) {
    const c = curr[dim] ?? 70;
    const p = prev?.[dim] ?? BEST_PRACTICE_BASELINE[dim];
    deltas[dim] = { current: c, previous: p, delta: +(c - p).toFixed(1) };
  }

  const overallDelta = prevOverall != null ? +(currOverall - prevOverall).toFixed(1) : null;
  const isImprovement = overallDelta != null ? overallDelta > 0 : null;

  const bm = {
    id:           _id(),
    pageUrl,
    type:         "version_compare",
    current:      { overall: currOverall, dimensions: curr },
    previous:     { overall: prevOverall, dimensions: prev },
    deltas,
    overallDelta,
    isImprovement,
    vsBaseline:   +(currOverall - BEST_PRACTICE_BASELINE.overall).toFixed(1),
    ts:           _ts(),
  };

  d.benchmarks.push(bm);
  d.stats.total++;
  if (isImprovement === true)  d.stats.improvementsDetected++;
  if (isImprovement === false) d.stats.regressionsDetected++;
  _save(d);

  return { ok: true, benchmark: bm };
}

// ── Baseline comparison ───────────────────────────────────────────────────────

async function compareToBaseline(pageUrl, { currentScore } = {}) {
  const hist     = _dqe()?.getHistory?.(pageUrl, 1)?.history || [];
  const currDims = currentScore?.dimensions || hist[hist.length - 1]?.dimensions || {};
  const currOverall = currentScore?.overall || hist[hist.length - 1]?.overall || 70;

  const d = _load();
  const gaps = {};
  for (const [dim, baseVal] of Object.entries(d.baseline)) {
    if (dim === "overall") continue;
    const curr = currDims[dim] ?? 70;
    gaps[dim] = { current: curr, baseline: baseVal, gap: +(curr - baseVal).toFixed(1), meetsBaseline: curr >= baseVal };
  }

  const meetsOverall = currOverall >= d.baseline.overall;
  const dimsMeeting  = Object.values(gaps).filter(g => g.meetsBaseline).length;
  const totalDims    = Object.keys(gaps).length;

  const bm = {
    id:           _id(),
    pageUrl,
    type:         "baseline_compare",
    current:      { overall: currOverall, dimensions: currDims },
    baseline:     d.baseline,
    gaps,
    meetsOverall,
    dimensionsMeeting: `${dimsMeeting}/${totalDims}`,
    readyForProduction: meetsOverall && dimsMeeting >= Math.round(totalDims * 0.7),
    ts:           _ts(),
  };

  d.benchmarks.push(bm);
  d.stats.total++;
  _save(d);

  return { ok: true, benchmark: bm };
}

// ── Patch success tracking ────────────────────────────────────────────────────

function recordPatchResult({ patchId, pageUrl, beforeScore, afterScore, applied }) {
  const d = _load();
  const improvement = afterScore != null && beforeScore != null ? afterScore - beforeScore : null;
  const success     = applied && (improvement == null || improvement >= 0);

  d.patchHistory.push({ patchId, pageUrl, beforeScore, afterScore, improvement, applied, success, ts: _ts() });

  const patches = d.patchHistory;
  const successCount = patches.filter(p => p.success).length;
  d.stats.patchSuccessRate = patches.length > 0 ? +(successCount / patches.length * 100).toFixed(1) : 0;
  _save(d);

  return { ok: true, patchId, success, improvement };
}

function getPatchSuccessRate() {
  const d = _load();
  const recent = d.patchHistory.slice(-20);
  const rate   = recent.length > 0 ? recent.filter(p => p.success).length / recent.length * 100 : 0;
  return { ok: true, rate: +rate.toFixed(1), totalPatches: d.patchHistory.length, recentWindow: 20 };
}

// ── Regression detection ──────────────────────────────────────────────────────

async function detectRegression(pageUrl) {
  const regressions = _vreg()?.listRegressions?.({ limit: 5 }) || { regressions: [] };
  const qualHistory = _dqe()?.getHistory?.(pageUrl, 5)?.history || [];
  const trend       = _dqe()?.getTrend?.(pageUrl) || {};

  const designRegression = trend.direction === "declining";
  const visualRegression = (regressions.regressions || []).some(r => r.pageUrl === pageUrl && r.hasDiff);

  const d = _load();
  if (designRegression) d.stats.regressionsDetected++;
  _save(d);

  return {
    ok: true, pageUrl,
    designRegression,
    visualRegression,
    qualityTrend: trend.direction || "unknown",
    recommendation: designRegression
      ? "Quality declining — schedule immediate patch generation"
      : visualRegression
        ? "Visual regression detected — review recent patches"
        : "No regression detected",
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getBenchmark(id) {
  return _load().benchmarks.find(b => b.id === id) || null;
}

function listBenchmarks({ pageUrl, type, limit = 50 } = {}) {
  let list = _load().benchmarks;
  if (pageUrl) list = list.filter(b => b.pageUrl === pageUrl);
  if (type)    list = list.filter(b => b.type === type);
  return { ok: true, benchmarks: list.slice(-limit) };
}

function getBaseline() {
  return _load().baseline;
}

function setBaseline(values) {
  const d = _load();
  d.baseline = { ...d.baseline, ...values };
  _save(d);
  return { ok: true, baseline: d.baseline };
}

function getStats() {
  return { ..._load().stats, updatedAt: _load().updatedAt };
}

module.exports = {
  BEST_PRACTICE_BASELINE,
  compareVersions,
  compareToBaseline,
  recordPatchResult,
  getPatchSuccessRate,
  detectRegression,
  getBenchmark,
  listBenchmarks,
  getBaseline,
  setBaseline,
  getStats,
};
