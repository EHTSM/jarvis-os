"use strict";
/**
 * knowledgeQualityEngine.cjs — OKB X V1 Knowledge Intelligence Evolution
 *
 * 7-dimension knowledge quality scoring:
 *   completeness, freshness, confidence, consistency, connectivity, usefulness, explainability
 *
 * Reuses: knowledgeReasoningEngine, engineeringMemoryEngine, continuousLearningEngine,
 *         akoState, memoryIntelligenceEngine, knowledgeGraph, researchKnowledgeEngine
 *
 * Storage: data/knowledge-quality.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "knowledge-quality.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _kre = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ako = () => _try(() => require("./akoState.cjs"));
const _mi  = () => _try(() => require("./memoryIntelligenceEngine.cjs"));
const _kg  = () => _try(() => require("./knowledgeGraph.cjs"));
const _rke = () => _try(() => require("./researchKnowledgeEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `kq_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const WEIGHTS = {
  completeness:    0.20,
  freshness:       0.18,
  confidence:      0.18,
  consistency:     0.15,
  connectivity:    0.12,
  usefulness:      0.10,
  explainability:  0.07,
};

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { scores: [], stats: { total: 0, contexts: 0, avgOverall: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.scores.length > 300) d.scores = d.scores.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

async function score(context, { reasoningAnalysis, rawData } = {}) {
  context = context || "current_knowledge";

  let ra = reasoningAnalysis;
  if (!ra) {
    const r = await _kre()?.analyze?.(context, rawData || {});
    ra = r?.analysis || null;
  }

  const dims      = ra?.dimensions || {};
  const graphStats= _try(() => _kg()?.getStats?.())                        || {};
  const miReport  = _try(() => _mi()?.getIntelligenceReport?.())          || {};
  const akoKpis   = _try(() => _ako()?.getAllKpis?.())                     || [];
  const rkeStats  = _try(() => _rke()?.getStats?.())                      || {};
  const engStats  = _try(() => _em()?.getStatistics?.())                  || {};

  // Map reasoning dims to quality dims
  const kpiList       = Array.isArray(akoKpis) ? akoKpis : [];
  const totalCaptured = kpiList.reduce((s, k) => s + (k.itemsCapured || k.itemsCaptured || 0), 0);
  const totalExpected = Math.max(totalCaptured, 50);
  const completeness  = Math.min(100, (totalCaptured / totalExpected) * 100 * 1.2);

  const stale     = miReport?.staleMemories || 0;
  const total     = miReport?.totalMemories || Math.max(1, totalCaptured);
  const freshness = Math.max(0, 100 - (stale / total) * 100);

  const validated  = kpiList.reduce((s, k) => s + (k.itemsValidated || 0), 0);
  const confidence = totalCaptured > 0 ? Math.min(100, 40 + (validated / totalCaptured) * 60) : 40;

  const conflicts  = miReport?.conflicts || 0;
  const consistency= Math.max(0, 100 - conflicts * 5);

  const nodes  = graphStats?.nodes || 0;
  const edges  = graphStats?.edges || 0;
  const connectivity = nodes > 0 ? Math.min(100, 40 + (edges / Math.max(1, nodes)) * 6) : 40;

  const findings  = rkeStats?.totalFindings || 0;
  const usefulness= Math.min(100, 40 + findings * 3);

  const knowledge = engStats?.engineHealth?.knowledge || 0;
  const explainability = Math.min(100, 40 + knowledge * 0.4);

  const dimensions = {
    completeness:    +Math.min(100, completeness).toFixed(1),
    freshness:       +Math.min(100, freshness).toFixed(1),
    confidence:      +Math.min(100, confidence).toFixed(1),
    consistency:     +Math.min(100, consistency).toFixed(1),
    connectivity:    +Math.min(100, connectivity).toFixed(1),
    usefulness:      +Math.min(100, usefulness).toFixed(1),
    explainability:  +Math.min(100, explainability).toFixed(1),
  };

  const overall = +Object.entries(WEIGHTS)
    .reduce((s, [k, w]) => s + (dimensions[k] || 60) * w, 0)
    .toFixed(1);

  const sorted      = Object.entries(dimensions).sort((a, b) => a[1] - b[1]);
  const improvements = sorted.slice(0, 3).map(([dim, val]) => ({
    dimension: dim,
    currentScore: val,
    priority: val < 50 ? "critical" : val < 65 ? "high" : "medium",
    suggestion: `Improve ${dim} from ${val} to at least ${Math.min(100, val + 15)}`,
  }));

  const entry = {
    id:          _id(),
    context,
    dimensions,
    overall,
    improvements,
    reasoningOverall: ra?.overallScore || null,
    scoredAt:    _ts(),
  };

  const d = _load();
  d.scores.push(entry);
  d.stats.total++;
  d.stats.contexts = new Set(d.scores.map(s => s.context)).size;
  d.stats.avgOverall = +(d.scores.slice(-20).reduce((s, sc) => s + sc.overall, 0) / Math.min(d.scores.length, 20)).toFixed(1);
  _save(d);

  return { ok: true, score: entry };
}

function getScore(id) { return _load().scores.find(s => s.id === id) || null; }

function listScores({ context, limit = 50 } = {}) {
  let list = _load().scores;
  if (context) list = list.filter(s => s.context === context);
  return { ok: true, scores: list.slice(-limit) };
}

function getHistory(context, limit = 10) {
  const list = _load().scores.filter(s => s.context === (context || "current_knowledge"));
  return { ok: true, history: list.slice(-limit) };
}

function getTrend(context, dimension) {
  const hist = getHistory(context || "current_knowledge", 10).history;
  if (hist.length < 2) return { ok: false, error: "insufficient history" };
  const vals = hist.map(h => dimension ? (h.dimensions?.[dimension] || 0) : h.overall);
  const first = vals[0];
  const last  = vals[vals.length - 1];
  const direction = last > first + 1 ? "improving" : last < first - 1 ? "declining" : "stable";
  return { ok: true, context, dimension: dimension || "overall", first: +first.toFixed(1), last: +last.toFixed(1), direction, velocity: +(last - first).toFixed(1) };
}

function getStats() { return { ..._load().stats, updatedAt: _load().updatedAt }; }

module.exports = { score, getScore, listScores, getHistory, getTrend, getStats, WEIGHTS };
