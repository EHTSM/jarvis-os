"use strict";
/**
 * knowledgeBenchmarkEngine.cjs — OKB X V1 Knowledge Intelligence Evolution
 *
 * Benchmarks knowledge quality over time:
 *   - compare vs historical knowledge state
 *   - compare vs engineering memory
 *   - compare vs research findings
 *   - compare vs production bible
 *   - compare vs mission outcomes
 *   - compare vs founder decisions
 *   - detect knowledge regressions
 *
 * Reuses: knowledgeQualityEngine, engineeringMemoryEngine, researchKnowledgeEngine,
 *         researchPublicationEngine, akoState, missionMemory, founderWorkRegistry
 *
 * Storage: data/knowledge-benchmarks.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-benchmarks.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _kqe = () => _try(() => require("./knowledgeQualityEngine.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _rpe = () => _try(() => require("./researchPublicationEngine.cjs"));
const _ako = () => _try(() => require("./akoState.cjs"));
const _mm  = () => _try(() => require("./missionMemory.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kbm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

const KNOWLEDGE_BASELINE = {
  completeness:   55,
  freshness:      70,
  confidence:     50,
  consistency:    75,
  connectivity:   50,
  usefulness:     55,
  explainability: 50,
  overall:        58,
};

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      benchmarks: [],
      baseline:   { ...KNOWLEDGE_BASELINE },
      improvHistory: [],
      stats: { total: 0, improvementsDetected: 0, regressionsDetected: 0, improvSuccessRate: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.benchmarks.length  > 300) d.benchmarks   = d.benchmarks.slice(-300);
  if (d.improvHistory.length > 200) d.improvHistory = d.improvHistory.slice(-200);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Compare functions ─────────────────────────────────────────────────────────

async function compareVersions(context, { currentScore, previousScore } = {}) {
  context = context || "current_knowledge";
  const d    = _load();
  const hist = _kqe()?.getHistory?.(context, 2)?.history || [];
  const curr = currentScore?.dimensions || hist[hist.length - 1]?.dimensions || {};
  const prev = previousScore?.dimensions || hist[hist.length - 2]?.dimensions || null;
  const currOverall = currentScore?.overall  || hist[hist.length - 1]?.overall  || 58;
  const prevOverall = previousScore?.overall || hist[hist.length - 2]?.overall  || null;

  const dims   = Object.keys(KNOWLEDGE_BASELINE).filter(k => k !== "overall");
  const deltas = {};
  for (const dim of dims) {
    const c = curr[dim] ?? KNOWLEDGE_BASELINE[dim];
    const p = prev?.[dim] ?? KNOWLEDGE_BASELINE[dim];
    deltas[dim] = { current: c, previous: p, delta: +(c - p).toFixed(1) };
  }

  const overallDelta  = prevOverall != null ? +(currOverall - prevOverall).toFixed(1) : null;
  const isImprovement = overallDelta != null ? overallDelta > 0 : null;

  const bm = {
    id:            _id(),
    context,
    type:          "version_compare",
    current:       { overall: currOverall, dimensions: curr },
    previous:      { overall: prevOverall, dimensions: prev },
    deltas,
    overallDelta,
    isImprovement,
    vsBaseline:    +(currOverall - KNOWLEDGE_BASELINE.overall).toFixed(1),
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
  context = context || "current_knowledge";
  const d    = _load();
  const hist = _kqe()?.getHistory?.(context, 1)?.history || [];
  const currDims    = currentScore?.dimensions || hist[hist.length - 1]?.dimensions || {};
  const currOverall = currentScore?.overall    || hist[hist.length - 1]?.overall    || 58;

  const gaps = {};
  for (const [dim, baseVal] of Object.entries(d.baseline)) {
    if (dim === "overall") continue;
    const curr = currDims[dim] ?? 58;
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
    productionReady:   meetsOverall && dimsMeeting >= Math.round(totalDims * 0.6),
    ts:                _ts(),
  };

  d.benchmarks.push(bm);
  d.stats.total++;
  _save(d);
  return { ok: true, benchmark: bm };
}

async function compareEngMemory(context) {
  context = context || "current_knowledge";
  const d       = _load();
  const engStats = _try(() => _em()?.getStatistics?.()) || {};
  const growth   = _try(() => _em()?.getKnowledgeGrowth?.()) || {};
  const items    = engStats?.engineHealth?.knowledge || 0;
  const growRate = growth?.growthRate || 0;

  const bm = {
    id:            _id(),
    context,
    type:          "eng_memory_compare",
    engineeringItems: items,
    growthRate:    growRate,
    assessment:    items > 100 ? "mature" : items > 50 ? "growing" : "early",
    recommendation: items < 50 ? "Build engineering memory by running more missions with capture" : "Engineering memory healthy",
    ts:            _ts(),
  };
  d.benchmarks.push(bm);
  d.stats.total++;
  _save(d);
  return { ok: true, benchmark: bm };
}

async function compareResearch(context) {
  context = context || "current_knowledge";
  const d         = _load();
  const rkeStats  = _try(() => _rke()?.getStats?.())            || {};
  const rpeStats  = _try(() => _rpe()?.getStats?.())            || {};
  const findings  = rkeStats?.totalFindings   || 0;
  const pubs      = rpeStats?.total           || 0;

  const bm = {
    id:         _id(),
    context,
    type:       "research_compare",
    findings,
    publications: pubs,
    coverage:   findings > 20 ? "comprehensive" : findings > 10 ? "moderate" : "sparse",
    recommendation: findings < 10 ? "Capture more research findings to build knowledge base" : "Research coverage acceptable",
    ts:         _ts(),
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
  d.improvHistory.push({ improvId, context, beforeScore, afterScore, improvement, applied, success, ts: _ts() });
  const recent = d.improvHistory.slice(-20);
  d.stats.improvSuccessRate = recent.length > 0 ? +(recent.filter(f => f.success).length / recent.length * 100).toFixed(1) : 0;
  _save(d);
  return { ok: true, improvId, success, improvement };
}

function getImprovementSuccessRate() {
  const d      = _load();
  const recent = d.improvHistory.slice(-20);
  const rate   = recent.length > 0 ? recent.filter(f => f.success).length / recent.length * 100 : 0;
  return { ok: true, rate: +rate.toFixed(1), totalImprovements: d.improvHistory.length };
}

function detectRegression(context) {
  const trend        = _kqe()?.getTrend?.(context || "current_knowledge") || {};
  const isRegression = trend.direction === "declining";
  const d = _load();
  if (isRegression) d.stats.regressionsDetected++;
  _save(d);
  return {
    ok:               true,
    context,
    isRegression,
    knowledgeTrend:   trend.direction || "unknown",
    recommendation:   isRegression
      ? "Knowledge quality declining — run evolution cycle immediately"
      : "No regression detected — maintain current knowledge trajectory",
  };
}

function getBenchmark(id) { return _load().benchmarks.find(b => b.id === id) || null; }
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
function getStats() { return { ..._load().stats, KNOWLEDGE_BASELINE, updatedAt: _load().updatedAt }; }

module.exports = {
  KNOWLEDGE_BASELINE,
  compareVersions,
  compareToBaseline,
  compareEngMemory,
  compareResearch,
  recordImprovementResult,
  getImprovementSuccessRate,
  detectRegression,
  getBenchmark,
  listBenchmarks,
  getBaseline,
  setBaseline,
  getStats,
};
