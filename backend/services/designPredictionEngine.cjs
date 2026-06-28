"use strict";
/**
 * designPredictionEngine.cjs — ODI X V1 Visual Intelligence Evolution
 *
 * Predicts likely failures before they happen:
 *   - UX problems (confusing flows, dead ends, CTAs buried)
 *   - accessibility failures (missing labels, contrast, keyboard traps)
 *   - responsive failures (overflow, hidden content, tiny tap targets)
 *   - user confusion (cognitive overload, unclear hierarchy)
 *
 * Reuses: designQualityEngine, visualReasoningEngine, accessibilityAuditor,
 *         responsiveSimulator, designMemory, engineeringMemoryEngine (platform).
 *
 * Storage: data/design-predictions.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "design-predictions.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _dqe = () => _try(() => require("./designQualityEngine.cjs"));
const _vr  = () => _try(() => require("./visualReasoningEngine.cjs"));
const _aa  = () => _try(() => require("./accessibilityAuditor.cjs"));
const _rs  = () => _try(() => require("./responsiveSimulator.cjs"));
const _dm  = () => _try(() => require("./designMemory.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `dp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Prediction rules ──────────────────────────────────────────────────────────

function _predictUXProblems(qualityScore, reasoningAnalysis) {
  const predictions = [];
  const dims = qualityScore?.dimensions || {};
  const ra   = reasoningAnalysis || {};

  if ((dims.usability || 70) < 60) {
    predictions.push({ type: "poor_usability", likelihood: 0.85, description: "Low usability score predicts user confusion and task failure rates above 25%", severity: "high" });
  }
  if (ra.cognitiveLoad > 70) {
    predictions.push({ type: "cognitive_overload", likelihood: 0.80, description: "High cognitive load will cause users to abandon complex tasks", severity: "high" });
  }
  if (ra.attentionHotspots?.length > 7) {
    predictions.push({ type: "attention_fragmentation", likelihood: 0.70, description: "Too many competing attention hotspots will reduce CTA conversion rate", severity: "medium" });
  }
  if (ra.readingFlow?.pattern === "unknown") {
    predictions.push({ type: "unclear_reading_flow", likelihood: 0.65, description: "Unclear visual hierarchy will cause users to miss key content", severity: "medium" });
  }
  if (ra.confusionSignals?.length > 3) {
    predictions.push({ type: "layout_confusion", likelihood: 0.75, description: `${ra.confusionSignals?.length} confusion signals will cause users to struggle with navigation`, severity: "high" });
  }

  return predictions;
}

function _predictAccessibilityFailures(accessData, qualityScore) {
  const predictions = [];
  const dims = qualityScore?.dimensions || {};
  const violations = accessData?.violations || [];

  if ((dims.accessibility || 70) < 70) {
    predictions.push({ type: "wcag_failure", likelihood: 0.90, description: "Current accessibility score predicts WCAG 2.1 AA non-compliance", severity: "critical" });
  }
  if (violations.some(v => v.id?.includes("color-contrast") || v.rule?.includes("contrast"))) {
    predictions.push({ type: "contrast_failure", likelihood: 0.95, description: "Color contrast violations will fail WCAG 1.4.3 (Contrast Minimum)", severity: "critical" });
  }
  if (violations.some(v => v.id?.includes("label") || v.rule?.includes("label"))) {
    predictions.push({ type: "missing_labels", likelihood: 0.90, description: "Missing ARIA labels will prevent screen reader navigation", severity: "high" });
  }
  if (violations.some(v => v.id?.includes("keyboard") || v.rule?.includes("focus"))) {
    predictions.push({ type: "keyboard_trap", likelihood: 0.85, description: "Keyboard navigation issues predicted — users relying on keyboard will get stuck", severity: "high" });
  }

  return predictions;
}

function _predictResponsiveFailures(responsiveData, qualityScore) {
  const predictions = [];
  const dims     = qualityScore?.dimensions || {};
  const viewports= responsiveData?.viewports || responsiveData?.results || [];

  if ((dims.responsiveness || 70) < 70) {
    predictions.push({ type: "responsive_degradation", likelihood: 0.80, description: "Low responsiveness score predicts layout breakage on mobile devices", severity: "high" });
  }

  const mobileVP = viewports.find(v => v.width < 500 || v.name?.toLowerCase().includes("mobile"));
  if (mobileVP?.issues?.length > 0) {
    predictions.push({ type: "mobile_overflow", likelihood: 0.85, description: "Mobile viewport has layout issues that will cause horizontal scroll or clipped content", severity: "high" });
  }

  const tabletVP = viewports.find(v => (v.width >= 500 && v.width < 1024) || v.name?.toLowerCase().includes("tablet"));
  if (tabletVP?.issues?.length > 0) {
    predictions.push({ type: "tablet_layout_break", likelihood: 0.70, description: "Tablet viewport layout issues will affect ~35% of users", severity: "medium" });
  }

  return predictions;
}

function _predictUserConfusion(reasoningAnalysis, qualityScore) {
  const predictions = [];
  const ra  = reasoningAnalysis || {};
  const dims= qualityScore?.dimensions || {};

  if ((dims.consistency || 70) < 60) {
    predictions.push({ type: "visual_inconsistency", likelihood: 0.80, description: "Low consistency score predicts users will be confused by varying visual language", severity: "medium" });
  }
  if (ra.hierarchyScore < 50) {
    predictions.push({ type: "hierarchy_confusion", likelihood: 0.75, description: "Weak visual hierarchy means users will not know where to focus first", severity: "medium" });
  }
  if ((dims.aesthetics || 70) < 55) {
    predictions.push({ type: "low_trust_aesthetics", likelihood: 0.65, description: "Poor aesthetics score correlates with reduced user trust and bounce rate increase", severity: "low" });
  }

  return predictions;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { predictions: [], stats: { total: 0, criticalPredictions: 0, avgRisk: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.predictions.length > 300) d.predictions = d.predictions.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main prediction ───────────────────────────────────────────────────────────

async function predict(pageUrl, { qualityScore, reasoningAnalysis, accessData, responsiveData } = {}) {
  if (!pageUrl && !qualityScore) return { ok: false, error: "pageUrl or qualityScore required" };

  // Pull data from existing ODI services
  const qs = qualityScore || (pageUrl ? _dqe()?.getHistory?.(pageUrl, 1)?.history?.slice(-1)[0] : null) || { dimensions: {}, overall: 70 };
  const ra = reasoningAnalysis || null;
  const ac = accessData       || _try(() => _aa()?.auditPage?.(pageUrl)) || {};
  const rs = responsiveData   || _try(() => _rs()?.simulate?.(pageUrl, {})) || {};

  const uxProblems      = _predictUXProblems(qs, ra);
  const accessFailures  = _predictAccessibilityFailures(ac, qs);
  const responsiveIssues= _predictResponsiveFailures(rs, qs);
  const confusionIssues = _predictUserConfusion(ra, qs);

  const all = [...uxProblems, ...accessFailures, ...responsiveIssues, ...confusionIssues];
  const riskScore = all.length > 0
    ? Math.round(all.reduce((s, p) => s + p.likelihood * (p.severity === "critical" ? 1.5 : p.severity === "high" ? 1.0 : 0.5), 0) / all.length * 100)
    : 10;

  const d = _load();
  const entry = {
    id:           _id(),
    pageUrl:      pageUrl || "provided",
    uxProblems,
    accessibilityFailures: accessFailures,
    responsiveFailures:    responsiveIssues,
    confusionIssues,
    total:        all.length,
    criticalCount:all.filter(p => p.severity === "critical").length,
    riskScore,
    qualityOverall: qs?.overall || null,
    predictedAt:  _ts(),
  };

  d.predictions.push(entry);
  d.stats.total++;
  d.stats.criticalPredictions += entry.criticalCount;
  const recent = d.predictions.slice(-20);
  d.stats.avgRisk = +(recent.reduce((s, p) => s + p.riskScore, 0) / recent.length).toFixed(1);
  _save(d);

  _try(() => _dm()?.remember?.({
    type: "design_prediction", content: `Risk score for ${pageUrl}: ${riskScore}. ${all.length} predicted issues.`,
    metadata: { riskScore, total: all.length, criticalCount: entry.criticalCount },
  }));

  return { ok: true, prediction: entry };
}

function getPrediction(id) {
  return _load().predictions.find(p => p.id === id) || null;
}

function listPredictions({ pageUrl, limit = 50 } = {}) {
  let preds = _load().predictions;
  if (pageUrl) preds = preds.filter(p => p.pageUrl === pageUrl);
  return { ok: true, predictions: preds.slice(-limit) };
}

function getStats() {
  return { ..._load().stats, updatedAt: _load().updatedAt };
}

module.exports = { predict, getPrediction, listPredictions, getStats };
