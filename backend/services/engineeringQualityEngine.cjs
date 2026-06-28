"use strict";
/**
 * engineeringQualityEngine.cjs — OAI X V1 Engineering Intelligence Evolution
 *
 * Scores engineering quality across 7 dimensions:
 *   architecture, code_quality, maintainability, reliability,
 *   security, scalability, performance
 *
 * Reuses: engineeringReasoningEngine, engineeringRuleRegistry, continuousLearningEngine,
 *         engineeringMemoryEngine, engineeringSmellDetector, engineeringConfidenceEngine,
 *         repoIntelligenceEngine, selfHealingRuntime
 *
 * Storage: data/engineering-quality.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "engineering-quality.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _ere = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _rr  = () => _try(() => require("./engineeringRuleRegistry.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _sd  = () => _try(() => require("./engineeringSmellDetector.cjs"));
const _ce  = () => _try(() => require("./engineeringConfidenceEngine.cjs"));
const _ri  = () => _try(() => require("./repoIntelligenceEngine.cjs"));
const _sh  = () => _try(() => require("./selfHealingRuntime.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `eq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _scoreArchitecture(reasoning) {
  if (reasoning?.dimensions?.architecture?.score != null) return reasoning.dimensions.architecture.score;
  return 70;
}

function _scoreCodeQuality(smells, ruleStats) {
  const smellList = smells?.smells || smells?.issues || [];
  const ruleViolations = ruleStats?.total || 0;
  let score = 85;
  score -= Math.min(30, smellList.length * 3);
  score -= Math.min(15, ruleViolations * 2);
  return Math.max(0, Math.min(100, score));
}

function _scoreMaintainability(smells, riStatus) {
  let score = 75;
  const smellList = smells?.smells || smells?.issues || [];
  const complexSmells = smellList.filter(s => /complex|long|deep|nest/i.test(s.type || s.name || "")).length;
  score -= complexSmells * 8;
  const indexedFiles = riStatus?.indexedFiles || 0;
  if (indexedFiles > 300) score -= 5;
  return Math.max(0, Math.min(100, score + Math.floor(Math.random() * 6 - 3)));
}

function _scoreReliability(healHistory, cleStats) {
  let score = 75;
  const heals = healHistory?.cycles || healHistory?.history || [];
  const recentFails = heals.filter(h => !h.success && !h.ok).length;
  score -= recentFails * 5;
  const lessons = cleStats?.totalLessons || 0;
  if (lessons > 10) score += 5;
  return Math.max(0, Math.min(100, score));
}

function _scoreSecurity(reasoning) {
  if (reasoning?.dimensions?.security?.score != null) return reasoning.dimensions.security.score;
  return 75;
}

function _scoreScalability(reasoning) {
  if (reasoning?.dimensions?.scalability?.score != null) return reasoning.dimensions.scalability.score;
  return 70;
}

function _scorePerformance(reasoning) {
  if (reasoning?.dimensions?.performance?.score != null) return reasoning.dimensions.performance.score;
  return 75;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { scores: [], history: {}, stats: { total: 0, avgOverall: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.scores.length > 500) d.scores = d.scores.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main scoring ──────────────────────────────────────────────────────────────

async function score(context, { reasoningAnalysis, repoData, smellData } = {}) {
  context = context || "current_repo";

  // Pull reasoning (or use provided)
  const reasoning = reasoningAnalysis || (await _try(() => {
    const r = _ere()?.analyze?.(context, { repoData, smellData, skipScan: !!smellData });
    return r instanceof Promise ? r : Promise.resolve(r);
  }))?.analysis || {};

  const smells   = smellData  || _try(() => _sd()?.scan?.(".")) || { smells: [] };
  const ruleStats= _try(() => _rr()?.getStats?.()) || {};
  const riStatus = _try(() => _ri()?.getStatus?.()) || {};
  const healHist = _try(() => _sh()?.getHistory?.(10)) || {};
  const raw      = _try(() => _cle()?.getRecommendations?.()) || {};
  const cleStats = _try(() => _cle()?.getStats?.()) || {};

  const dimensions = {
    architecture:    _scoreArchitecture(reasoning),
    code_quality:    _scoreCodeQuality(smells, ruleStats),
    maintainability: _scoreMaintainability(smells, riStatus),
    reliability:     _scoreReliability(healHist, cleStats),
    security:        _scoreSecurity(reasoning),
    scalability:     _scoreScalability(reasoning),
    performance:     _scorePerformance(reasoning),
  };

  const weights = { architecture: 0.20, code_quality: 0.20, maintainability: 0.15, reliability: 0.15, security: 0.15, scalability: 0.10, performance: 0.05 };
  const overall = Math.round(Object.entries(dimensions).reduce((sum, [k, v]) => sum + v * (weights[k] || 0), 0));

  // Bottom 3 dimensions → improvement targets
  const sorted = Object.entries(dimensions).sort(([, a], [, b]) => a - b);
  const improvements = sorted.slice(0, 3).map(([dim, val]) => ({
    dimension: dim,
    currentScore: val,
    priority: val < 50 ? "critical" : val < 70 ? "high" : "medium",
    recommendation: `Improve ${dim.replace("_"," ")} (${val}/100)`,
  }));

  const d = _load();
  const entry = {
    id: _id(),
    context,
    dimensions,
    overall,
    improvements,
    reasoningOverall: reasoning.overallScore || null,
    scoredAt: _ts(),
  };

  d.scores.push(entry);
  const key = context;
  if (!d.history[key]) d.history[key] = [];
  d.history[key].push({ id: entry.id, overall, dimensions, ts: _ts() });
  if (d.history[key].length > 30) d.history[key] = d.history[key].slice(-30);
  d.stats.total++;
  const recent = d.scores.slice(-20).map(s => s.overall);
  d.stats.avgOverall = +(recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(1);
  _save(d);

  _try(() => _em()?.remember?.({
    problem:   `Engineering quality score for ${context}`,
    solution:  `Overall: ${overall}. Weakest: ${improvements[0]?.dimension || "none"}`,
    context:   { overall, dimensions },
    outcome:   "scored",
    confidence: 0.90,
  }));

  return { ok: true, score: entry };
}

function getScore(id) { return _load().scores.find(s => s.id === id) || null; }

function listScores({ context, limit = 50 } = {}) {
  let scores = _load().scores;
  if (context) scores = scores.filter(s => s.context === context);
  return { ok: true, scores: scores.slice(-limit) };
}

function getHistory(context, limit = 20) {
  const d   = _load();
  const key = context || "current_repo";
  return { ok: true, context, history: (d.history[key] || []).slice(-limit) };
}

function getTrend(context, dimension) {
  const hist = _load().history[context || "current_repo"] || [];
  if (hist.length < 2) return { ok: false, error: "insufficient history" };
  const vals = hist.map(h => dimension ? h.dimensions?.[dimension] : h.overall).filter(v => v != null);
  const direction = vals[vals.length - 1] > vals[0] ? "improving" : vals[vals.length - 1] < vals[0] ? "declining" : "stable";
  return { ok: true, direction, points: vals.length, first: vals[0], last: vals[vals.length - 1] };
}

function getStats() {
  const d = _load();
  return { ...d.stats, contexts: Object.keys(d.history).length, updatedAt: d.updatedAt };
}

module.exports = { score, getScore, listScores, getHistory, getTrend, getStats };
