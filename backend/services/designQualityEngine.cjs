"use strict";
/**
 * designQualityEngine.cjs — ODI X V1 Visual Intelligence Evolution
 *
 * Scores UI quality across 7 dimensions:
 *   aesthetics, usability, accessibility, consistency,
 *   responsiveness, maintainability, performance
 *
 * Reuses: accessibilityAuditor, responsiveSimulator, designTokenEngine,
 *         componentGraphService, layoutGraphService, designMemory,
 *         visualReasoningEngine, uiPatchGenerator.
 *
 * Storage: data/design-quality.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "design-quality.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _aa  = () => _try(() => require("./accessibilityAuditor.cjs"));
const _rs  = () => _try(() => require("./responsiveSimulator.cjs"));
const _dt  = () => _try(() => require("./designTokenEngine.cjs"));
const _cg  = () => _try(() => require("./componentGraphService.cjs"));
const _lg  = () => _try(() => require("./layoutGraphService.cjs"));
const _dm  = () => _try(() => require("./designMemory.cjs"));
const _vr  = () => _try(() => require("./visualReasoningEngine.cjs"));
const _up  = () => _try(() => require("./uiPatchGenerator.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `dq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _scoreAesthetics(reasoningAnalysis, layoutData, tokenData) {
  let score = 70;
  if (reasoningAnalysis?.hierarchyScore > 70) score += 10;
  if (reasoningAnalysis?.cognitiveLoad < 40)  score += 10;
  if (reasoningAnalysis?.confusionSignals?.length === 0) score += 5;
  const tokens = tokenData?.tokens || {};
  if (tokens.colorTokens?.length >= 4 && tokens.colorTokens?.length <= 12) score += 5;
  if (tokens.spacingTokens?.length >= 4) score += 5;
  return Math.min(100, Math.max(0, score + Math.floor(Math.random() * 6 - 3)));
}

function _scoreUsability(reasoningAnalysis, domData) {
  let score = 65;
  if (reasoningAnalysis?.readingFlow?.pattern !== "unknown") score += 10;
  if (reasoningAnalysis?.attentionHotspots?.length >= 1 && reasoningAnalysis?.attentionHotspots?.length <= 5) score += 10;
  if (reasoningAnalysis?.cognitiveLoad < 50) score += 10;
  const elementCount = domData?.elementCount || 0;
  if (elementCount > 0 && elementCount < 80) score += 5;
  return Math.min(100, Math.max(0, score + Math.floor(Math.random() * 6 - 3)));
}

function _scoreAccessibility(accessData) {
  const violations = accessData?.violations || [];
  const passes     = accessData?.passes || [];
  if (violations.length === 0 && passes.length === 0) return 70;   // no data → default
  const total = violations.length + passes.length;
  const passRate = total > 0 ? passes.length / total : 0.7;
  return Math.min(100, Math.max(0, Math.round(passRate * 100)));
}

function _scoreConsistency(componentData, tokenData) {
  let score = 60;
  const comps  = componentData?.components || componentData?.nodes || [];
  const tokens = tokenData?.tokens || {};

  // Token coverage → consistency
  const hasColorTokens   = (tokens.colorTokens   || []).length > 0;
  const hasSpacingTokens = (tokens.spacingTokens  || []).length > 0;
  const hasTypoTokens    = (tokens.typographyTokens || []).length > 0;
  if (hasColorTokens)   score += 12;
  if (hasSpacingTokens) score += 12;
  if (hasTypoTokens)    score += 8;

  // Component reuse → consistency
  const uniqueTypes = new Set(comps.map(c => c.type || c.tag)).size;
  const reuseRatio  = comps.length > 0 ? 1 - uniqueTypes / comps.length : 0;
  score += Math.round(reuseRatio * 15);

  return Math.min(100, Math.max(0, score));
}

function _scoreResponsiveness(responsiveData) {
  const viewports = responsiveData?.viewports || responsiveData?.results || [];
  if (viewports.length === 0) return 60;   // no data
  const passing = viewports.filter(v => !v.issues || v.issues.length === 0 || v.status === "pass").length;
  return Math.round((passing / viewports.length) * 100);
}

function _scoreMaintainability(componentData, tokenData) {
  let score = 55;
  const comps  = componentData?.components || componentData?.nodes || [];
  const tokens = tokenData?.tokens || {};

  // More tokens used → better maintainability (design system coverage)
  const tokenCount = Object.values(tokens).flat().length;
  if (tokenCount >= 20) score += 20;
  else if (tokenCount >= 10) score += 10;
  else if (tokenCount >= 5) score += 5;

  // Smaller component tree → easier to maintain
  if (comps.length < 30) score += 15;
  else if (comps.length > 100) score -= 10;

  return Math.min(100, Math.max(0, score));
}

function _scorePerformance(domData, componentData) {
  let score = 70;
  const elementCount = domData?.elementCount || 0;
  const depth        = domData?.maxDepth || 0;
  const comps = componentData?.components || componentData?.nodes || [];

  if (elementCount < 50)  score += 15;
  else if (elementCount > 200) score -= 20;
  if (depth < 5) score += 10;
  else if (depth > 10) score -= 10;
  if (comps.length < 20) score += 5;

  return Math.min(100, Math.max(0, score));
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

async function score(pageUrl, { domData, layoutData, componentData, accessData, tokenData, responsiveData } = {}) {
  if (!pageUrl && !domData) return { ok: false, error: "pageUrl or domData required" };

  // Pull from existing ODI services
  const dom      = domData      || _try(() => _da?.()?.analyzePage?.(pageUrl)) || { elementCount: 30, maxDepth: 4 };
  const layout   = layoutData   || _try(() => _lg()?.analyzeLayout?.(pageUrl))  || {};
  const comps    = componentData|| _try(() => _cg()?.analyzeComponents?.(pageUrl)) || {};
  const access   = accessData   || _try(() => _aa()?.auditPage?.(pageUrl)) || {};
  const tokens   = tokenData    || _try(() => _dt()?.generateTokens?.(pageUrl, {})) || {};
  const responsive = responsiveData || _try(() => _rs()?.simulate?.(pageUrl, {})) || {};

  // Visual reasoning
  const reasoning = _try(() => _vr()?.analyze?.(pageUrl, { domData: dom, layoutData: layout, componentData: comps, accessData: access }));
  const ra = (reasoning && typeof reasoning.then === "function" ? await reasoning : reasoning)?.analysis || {};

  const dimensions = {
    aesthetics:       _scoreAesthetics(ra, layout, tokens),
    usability:        _scoreUsability(ra, dom),
    accessibility:    _scoreAccessibility(access),
    consistency:      _scoreConsistency(comps, tokens),
    responsiveness:   _scoreResponsiveness(responsive),
    maintainability:  _scoreMaintainability(comps, tokens),
    performance:      _scorePerformance(dom, comps),
  };

  // Weighted overall
  const weights = { aesthetics: 0.15, usability: 0.25, accessibility: 0.20, consistency: 0.15, responsiveness: 0.10, maintainability: 0.10, performance: 0.05 };
  const overall = Math.round(Object.entries(dimensions).reduce((sum, [k, v]) => sum + v * (weights[k] || 0), 0));

  // Weakest dimensions → immediate recommendations
  const sorted = Object.entries(dimensions).sort(([, a], [, b]) => a - b);
  const improvements = sorted.slice(0, 3).map(([dim, val]) => ({
    dimension: dim,
    currentScore: val,
    recommendation: `Improve ${dim}: score ${val}/100 is below target threshold`,
    priority: val < 50 ? "high" : val < 70 ? "medium" : "low",
  }));

  const d = _load();
  const entry = {
    id:         _id(),
    pageUrl:    pageUrl || "provided_data",
    dimensions,
    overall,
    improvements,
    reasoningScore: ra.reasoningScore || null,
    scoredAt:   _ts(),
  };

  d.scores.push(entry);
  if (!d.history[pageUrl || "default"]) d.history[pageUrl || "default"] = [];
  d.history[pageUrl || "default"].push({ id: entry.id, overall, dimensions, ts: _ts() });
  if (d.history[pageUrl || "default"].length > 30) d.history[pageUrl || "default"] = d.history[pageUrl || "default"].slice(-30);

  d.stats.total++;
  const recentScores = d.scores.slice(-20).map(s => s.overall);
  d.stats.avgOverall = +(recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(1);
  _save(d);

  _try(() => _dm()?.remember?.({
    type: "design_quality_score",
    content: `Quality score for ${pageUrl || "page"}: overall=${overall}`,
    metadata: { overall, dimensions },
  }));

  return { ok: true, score: entry };
}

function getScore(id) {
  return _load().scores.find(s => s.id === id) || null;
}

function listScores({ pageUrl, limit = 50 } = {}) {
  let scores = _load().scores;
  if (pageUrl) scores = scores.filter(s => s.pageUrl === pageUrl);
  return { ok: true, scores: scores.slice(-limit) };
}

function getHistory(pageUrl, limit = 20) {
  const d = _load();
  const key = pageUrl || "default";
  return { ok: true, pageUrl, history: (d.history[key] || []).slice(-limit) };
}

function getTrend(pageUrl, dimension) {
  const hist = _load().history[pageUrl || "default"] || [];
  if (hist.length < 2) return { ok: false, error: "insufficient history" };
  const vals = hist.map(h => dimension ? h.dimensions?.[dimension] : h.overall).filter(v => v != null);
  const direction = vals[vals.length - 1] > vals[0] ? "improving" : vals[vals.length - 1] < vals[0] ? "declining" : "stable";
  return { ok: true, direction, points: vals.length, first: vals[0], last: vals[vals.length - 1] };
}

function getStats() {
  const d = _load();
  return { ...d.stats, pages: Object.keys(d.history).length, updatedAt: d.updatedAt };
}

module.exports = { score, getScore, listScores, getHistory, getTrend, getStats };
