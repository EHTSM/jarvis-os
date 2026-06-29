"use strict";
/**
 * evolutionQualityEngine.cjs — OSE X V1 Self-Evolution Intelligence
 *
 * 7-dimensional quality scoring for platform evolution health.
 *
 * Dimensions (weights sum to 1.0):
 *   adaptability          0.20 — how quickly platform adapts to new needs
 *   improvement_velocity  0.18 — rate of validated improvements applied
 *   architectural_stability 0.18 — stability of core structures over time
 *   execution_quality     0.15 — success rate of executed improvements
 *   learning_effectiveness 0.15 — lesson uptake + recommendation success
 *   optimization_efficiency 0.10 — ratio of accepted vs. rejected improvements
 *   autonomy_maturity     0.04 — autonomous decision making without founder
 *
 * Storage: data/evolution-quality.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "evolution-quality.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _sie = () => _try(() => require("./selfImprovementEngine.cjs"));
const _sre = () => _try(() => require("./selfReviewEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ile = () => _try(() => require("./improvementLoopEngine.cjs"));
const _aeo = () => _try(() => require("./aeoState.cjs"));
const _ere = () => _try(() => require("./evolutionReasoningEngine.cjs"));

function _ts()    { return new Date().toISOString(); }
function _id()    { return `eq_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }
function _clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

const WEIGHTS = {
  adaptability:             0.20,
  improvement_velocity:     0.18,
  architectural_stability:  0.18,
  execution_quality:        0.15,
  learning_effectiveness:   0.15,
  optimization_efficiency:  0.10,
  autonomy_maturity:        0.04,
};

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { scores: [], stats: { total: 0, avgOverall: 0, contexts: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.scores.length > 300) d.scores = d.scores.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _adaptability(sieStats, aeoKpis) {
  const kpis        = Array.isArray(aeoKpis) ? aeoKpis : [];
  const evoTypes    = kpis.reduce((s, k) => s + (k.evolutionsProposed || 0), 0);
  const cycles      = sieStats?.evolutionCycles || 0;
  const pending     = sieStats?.pendingPatterns || 0;
  // Many proposals + some cycles = good adaptability
  const raw = Math.min(100, evoTypes * 2 + cycles * 10 + pending * 0.5 + 30);
  return _clamp(raw);
}

function _improvementVelocity(aeoKpis, cleStats) {
  const kpis      = Array.isArray(aeoKpis) ? aeoKpis : [];
  const validated = kpis.reduce((s, k) => s + (k.improvementsValidated || 0), 0);
  const applied   = kpis.reduce((s, k) => s + (k.evolutionsApplied     || 0), 0);
  const lessons   = cleStats?.totalLessons || 0;
  return _clamp(Math.min(100, validated * 0.3 + applied * 2 + lessons * 0.5 + 20));
}

function _architecturalStability(sieStats, review) {
  const stability  = review?.scores?.architecture || 50;
  const revertRate = sieStats ? (0) : 0; // no direct signal — use review
  const debt       = review?.debtPoints || 0;
  return _clamp(stability - debt * 0.3);
}

function _executionQuality(ileStats, expStats) {
  const trials  = ileStats?.total         || 0;
  const kept    = ileStats?.kept          || 0;
  const expRuns = expStats?.total         || 0;
  const expOk   = expStats?.validated     || 0;
  const trialRate = trials > 0 ? (kept / trials) * 100 : 50;
  const expRate   = expRuns > 0 ? (expOk / expRuns) * 100 : 50;
  return _clamp(trialRate * 0.6 + expRate * 0.4);
}

function _learningEffectiveness(cleStats) {
  const total  = cleStats?.totalLessons || 0;
  const open   = cleStats?.openRecs     || 0;
  const uptake = total > 0 ? Math.max(0, 100 - (open / Math.max(total, 1)) * 100) : 50;
  return _clamp(uptake * 0.7 + Math.min(30, total * 0.5));
}

function _optimizationEfficiency(aeoKpis) {
  const kpis    = Array.isArray(aeoKpis) ? aeoKpis : [];
  const kept    = kpis.reduce((s, k) => s + (k.evolutionsKept     || 0), 0);
  const reverted= kpis.reduce((s, k) => s + (k.evolutionsReverted || 0), 0);
  const total   = kept + reverted;
  return _clamp(total > 0 ? (kept / total) * 100 : 50);
}

function _autonomyMaturity(sieStats, review) {
  const autoSuccess = Math.min(100, sieStats?.improvementScores?.autonomousSuccess || 0);
  const autonomy    = review?.scores?.autonomy || 50;
  return _clamp(autoSuccess * 0.5 + autonomy * 0.5);
}

// ── Improvements ─────────────────────────────────────────────────────────────

function _makeImprovements(dims, reasoningAnalysis) {
  const ranked = Object.entries(dims)
    .map(([k, v]) => ({ dimension: k, score: v }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  return ranked.map(({ dimension, score }) => {
    const priority = score < 40 ? "critical" : score < 60 ? "high" : "medium";
    const actions  = {
      adaptability:             "Run more AEO evolution pipelines and promote pending patterns",
      improvement_velocity:     "Increase applied improvements — run improvementLoop weekly",
      architectural_stability:  "Address architectural debt — run selfReviewEngine.runReview()",
      execution_quality:        "Validate more experiments via experimentManager",
      learning_effectiveness:   "Action open CLE recommendations — reduce lesson backlog",
      optimization_efficiency:  "Improve pre-validation before applying evolutions",
      autonomy_maturity:        "Enable more autonomous execution paths in POST-Ω execution engine",
    };
    return { dimension, score, priority, action: actions[dimension] || `Improve ${dimension}` };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function score(context, { reasoningAnalysis } = {}) {
  context = context || "current_evolution";

  const sieStats = _try(() => _sie()?.getStatistics?.()) || {};
  const aeoKpis  = _try(() => _aeo()?.getAllKpis?.())    || [];
  const review   = _try(() => _sre()?.getLatestReview?.()) || {};
  const cleRaw   = _try(() => _cle()?.getRecommendations?.()) || {};
  const cleRecs  = Array.isArray(cleRaw) ? cleRaw : (cleRaw.recommendations || []);
  const cleStats = _try(() => _cle()?.getStats?.()) || {};
  cleStats.openRecs = cleRecs.filter(r => r.status === "open").length;
  const ileStats = _try(() => _ile()?.getStats?.()) || {};
  const expStats = _try(() => _try(() => require("./experimentManager.cjs"))?.getStats?.()) || {};

  const dimensions = {
    adaptability:             _adaptability(sieStats, aeoKpis),
    improvement_velocity:     _improvementVelocity(aeoKpis, cleStats),
    architectural_stability:  _architecturalStability(sieStats, review),
    execution_quality:        _executionQuality(ileStats, expStats),
    learning_effectiveness:   _learningEffectiveness(cleStats),
    optimization_efficiency:  _optimizationEfficiency(aeoKpis),
    autonomy_maturity:        _autonomyMaturity(sieStats, review),
  };

  const overall = _clamp(
    Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + (dimensions[k] * w), 0)
  );

  const improvements = _makeImprovements(dimensions, reasoningAnalysis);

  const id    = _id();
  const entry = {
    id, context, overall, dimensions, improvements,
    reasoningOverall: reasoningAnalysis?.overallScore ?? null,
    createdAt: _ts(),
  };

  const d = _load();
  if (!d.history) d.history = {};
  if (!d.history[context]) d.history[context] = [];
  d.history[context].push({ id, overall, createdAt: entry.createdAt });

  d.scores.push(entry);
  const all = d.scores.map(s => s.overall);
  const ctxSet = new Set(d.scores.map(s => s.context));
  d.stats = { total: d.scores.length, avgOverall: +(all.reduce((a,b)=>a+b,0)/all.length).toFixed(1), contexts: ctxSet.size };
  _save(d);

  return { ok: true, score: entry };
}

function getScore(id) { return _load().scores.find(s => s.id === id) || null; }

function listScores({ context, limit = 50 } = {}) {
  let scores = _load().scores;
  if (context) scores = scores.filter(s => s.context === context);
  return { ok: true, scores: scores.slice(-limit) };
}

function getHistory(context, limit = 10) {
  const d = _load();
  const hist = (d.history || {})[context] || [];
  return { ok: true, context, history: hist.slice(-limit) };
}

function getTrend(context, dimension) {
  const d = _load();
  const hist = ((d.history || {})[context] || []).slice(-5);
  if (hist.length < 2) return { ok: false, error: "insufficient history" };
  const scores = hist.map(h => {
    if (!dimension) return h.overall;
    const full = d.scores.find(s => s.id === h.id);
    return full?.dimensions?.[dimension] ?? h.overall;
  });
  const delta = scores[scores.length - 1] - scores[0];
  return {
    ok:        true,
    context,
    dimension: dimension || "overall",
    direction: delta > 2 ? "improving" : delta < -2 ? "declining" : "stable",
    delta:     +delta.toFixed(1),
    latest:    scores[scores.length - 1],
    history:   scores,
  };
}

function getStats() { return { ...(_load().stats), updatedAt: _load().updatedAt }; }

module.exports = { score, getScore, listScores, getHistory, getTrend, getStats, WEIGHTS };
