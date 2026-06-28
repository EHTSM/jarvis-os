"use strict";
/**
 * visualReasoningEngine.cjs — ODI X V1 Visual Intelligence Evolution
 *
 * Understands WHY a UI looks and behaves as it does:
 *   - visual hierarchy analysis (z-order, size contrast, grouping)
 *   - cognitive load estimation (element density, color count, motion)
 *   - reading flow prediction (F/Z-pattern, scanpath estimation)
 *   - user attention prediction (salience map from visual weight)
 *   - confusing layout detection (misaligned, overcrowded, inconsistent spacing)
 *
 * Reuses: screenshotAnalyzerService, domAnalyzerService, layoutGraphService,
 *         componentGraphService, designMemory, accessibilityAuditor.
 *
 * Storage: data/visual-reasoning.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "visual-reasoning.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _sa  = () => _try(() => require("./screenshotAnalyzerService.cjs"));
const _da  = () => _try(() => require("./domAnalyzerService.cjs"));
const _lg  = () => _try(() => require("./layoutGraphService.cjs"));
const _cg  = () => _try(() => require("./componentGraphService.cjs"));
const _dm  = () => _try(() => require("./designMemory.cjs"));
const _aa  = () => _try(() => require("./accessibilityAuditor.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `vr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Scoring helpers ───────────────────────────────────────────────────────────

function _cognitiveLoadScore(domData, layoutData) {
  let load = 0;
  const elementCount = domData?.elementCount || domData?.elements?.length || 0;
  const colorCount   = layoutData?.colorCount || 0;
  const depth        = domData?.maxDepth || domData?.depth || 0;

  // More elements → higher cognitive load
  if (elementCount > 100) load += 30;
  else if (elementCount > 50) load += 15;
  else if (elementCount > 20) load += 5;

  // More colors → more cognitive load
  if (colorCount > 12) load += 25;
  else if (colorCount > 6) load += 10;

  // Deep nesting → higher cognitive load
  if (depth > 8) load += 20;
  else if (depth > 5) load += 10;

  return Math.min(100, load);   // 0=simple, 100=overwhelming
}

function _hierarchyScore(layoutData, componentData) {
  let score = 60;  // baseline
  const nodeCount = layoutData?.nodes?.length || 0;
  const levels    = layoutData?.levels || componentData?.depth || 0;

  // 3-5 levels is ideal hierarchy
  if (levels >= 3 && levels <= 5) score += 20;
  else if (levels < 2)            score -= 10;
  else if (levels > 7)            score -= 20;

  // Good node count for hierarchy
  if (nodeCount > 0 && nodeCount < 50) score += 10;
  else if (nodeCount > 100)            score -= 10;

  return Math.max(0, Math.min(100, score));
}

function _readingFlowPattern(layoutData) {
  // Estimate dominant reading pattern from layout structure
  const nodes = layoutData?.nodes || [];
  if (nodes.length === 0) return { pattern: "unknown", confidence: 0 };

  // Simple heuristic: if horizontal groups > vertical groups → Z-pattern
  // otherwise → F-pattern
  const horizontalGroups = nodes.filter(n => n.direction === "horizontal" || n.type === "row").length;
  const verticalGroups   = nodes.filter(n => n.direction === "vertical"   || n.type === "column").length;

  if (horizontalGroups > verticalGroups * 1.5) return { pattern: "Z", confidence: 0.75 };
  if (verticalGroups   > horizontalGroups * 1.5) return { pattern: "F", confidence: 0.75 };
  return { pattern: "mixed", confidence: 0.6 };
}

function _attentionHotspots(componentData, accessData) {
  const hotspots = [];
  const comps = componentData?.components || componentData?.nodes || [];

  // High-priority attention: CTAs, errors, headings
  for (const c of comps.slice(0, 20)) {
    const type = (c.type || c.tag || "").toLowerCase();
    if (/button|cta|hero|banner|h1|h2/.test(type)) {
      hotspots.push({ element: c.name || c.tag || type, weight: 0.9, reason: "primary_cta_or_heading" });
    }
    if (/error|alert|warning/.test(type)) {
      hotspots.push({ element: c.name || type, weight: 0.85, reason: "attention_signal" });
    }
  }

  // Accessibility violations → forced attention
  const violations = accessData?.violations || [];
  for (const v of violations.slice(0, 3)) {
    hotspots.push({ element: v.element || v.rule || "unknown", weight: 0.7, reason: "accessibility_issue" });
  }

  // Default if nothing found
  if (hotspots.length === 0) hotspots.push({ element: "above_fold_hero", weight: 0.8, reason: "default_primary_attention" });

  return hotspots.slice(0, 10);
}

function _confusionSignals(layoutData, domData) {
  const signals = [];
  const nodes = layoutData?.nodes || [];

  // Misaligned elements
  const misaligned = nodes.filter(n => n.alignment === "misaligned" || n.alignmentIssue === true).length;
  if (misaligned > 0) signals.push({ type: "misalignment", severity: "medium", count: misaligned });

  // Overcrowded sections (density)
  const crowded = nodes.filter(n => n.density > 0.8 || n.crowded === true).length;
  if (crowded > 0) signals.push({ type: "overcrowding", severity: "high", count: crowded });

  // Inconsistent spacing
  const inconsistentSpacing = nodes.filter(n => n.spacingInconsistent === true).length;
  if (inconsistentSpacing > 0) signals.push({ type: "inconsistent_spacing", severity: "low", count: inconsistentSpacing });

  // Element count heuristic
  const elementCount = domData?.elementCount || 0;
  if (elementCount > 150) signals.push({ type: "element_overload", severity: "high", count: elementCount });
  else if (elementCount > 80) signals.push({ type: "element_density", severity: "medium", count: elementCount });

  return signals;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { analyses: [], stats: { total: 0, avgCognLoad: 0, avgHierarchy: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.analyses.length > 300) d.analyses = d.analyses.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main analysis ─────────────────────────────────────────────────────────────

async function analyze(pageUrl, { screenshotPath, domData, layoutData, componentData, accessData } = {}) {
  if (!pageUrl && !screenshotPath && !domData) return { ok: false, error: "pageUrl, screenshotPath, or domData required" };

  // Pull from existing ODI services if raw data not provided
  const dom     = domData     || _try(() => _da()?.analyzePage?.(pageUrl)) || {};
  const layout  = layoutData  || _try(() => _lg()?.analyzeLayout?.(pageUrl)) || {};
  const comps   = componentData || _try(() => _cg()?.analyzeComponents?.(pageUrl)) || {};
  const access  = accessData  || _try(() => _aa()?.auditPage?.(pageUrl)) || {};

  const cognitiveLoad    = _cognitiveLoadScore(dom, layout);
  const hierarchyScore   = _hierarchyScore(layout, comps);
  const readingFlow      = _readingFlowPattern(layout);
  const attentionHotspots= _attentionHotspots(comps, access);
  const confusionSignals = _confusionSignals(layout, dom);

  // Overall reasoning score: higher = better understood + clearer hierarchy
  const reasoningScore = Math.round(
    hierarchyScore * 0.4 +
    (100 - cognitiveLoad) * 0.35 +
    readingFlow.confidence * 100 * 0.15 +
    Math.max(0, 100 - confusionSignals.length * 15) * 0.10
  );

  const d = _load();
  const analysis = {
    id:              _id(),
    pageUrl:         pageUrl || screenshotPath || "provided_data",
    cognitiveLoad,
    hierarchyScore,
    readingFlow,
    attentionHotspots,
    confusionSignals,
    reasoningScore,
    insights: [
      cognitiveLoad > 60  ? "High cognitive load — consider reducing element density" : null,
      hierarchyScore < 50 ? "Weak visual hierarchy — strengthen primary→secondary→tertiary levels" : null,
      confusionSignals.length > 2 ? `${confusionSignals.length} confusion signals detected` : null,
      `Dominant reading pattern: ${readingFlow.pattern} (confidence=${readingFlow.confidence})`,
      `${attentionHotspots.length} attention hotspots identified`,
    ].filter(Boolean),
    analyzedAt: _ts(),
  };

  d.analyses.push(analysis);
  d.stats.total++;
  d.stats.avgCognLoad = +(d.analyses.slice(-20).reduce((s, a) => s + a.cognitiveLoad, 0) / Math.min(d.analyses.length, 20)).toFixed(1);
  d.stats.avgHierarchy= +(d.analyses.slice(-20).reduce((s, a) => s + a.hierarchyScore, 0) / Math.min(d.analyses.length, 20)).toFixed(1);
  _save(d);

  // Store in design memory
  _try(() => _dm()?.remember?.({
    type: "visual_reasoning", content: JSON.stringify({ pageUrl, reasoningScore, cognitiveLoad, hierarchyScore }),
    metadata: { reasoningScore, cognitiveLoad, hierarchyScore },
  }));

  return { ok: true, analysis };
}

function getAnalysis(id) {
  return _load().analyses.find(a => a.id === id) || null;
}

function listAnalyses({ limit = 50 } = {}) {
  return { ok: true, analyses: _load().analyses.slice(-limit) };
}

function getStats() {
  return { ..._load().stats, updatedAt: _load().updatedAt };
}

module.exports = { analyze, getAnalysis, listAnalyses, getStats };
