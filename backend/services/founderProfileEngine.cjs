"use strict";
/**
 * founderProfileEngine.cjs — POST-Ω Sprint P6 FDT
 *
 * The Founder's persistent behavioral profile.
 * Records every observable action and maintains confidence-scored preference
 * vectors across 9 dimensions. Does NOT implement its own memory — writes
 * through to continuousLearningEngine and engineeringMemoryEngine.
 *
 * Storage: data/founder-profile.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "founder-profile.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));

// ── Preference dimensions ─────────────────────────────────────────────────────

const DIMENSIONS = [
  "ui_density",           // compact vs spacious
  "documentation_depth",  // minimal vs exhaustive
  "risk_tolerance",       // conservative vs aggressive
  "automation_preference",// manual vs fully automated
  "security_preference",  // permissive vs strict
  "performance_preference",// fast-enough vs micro-optimized
  "cost_preference",      // cost-conscious vs quality-first
  "code_review_depth",    // quick-scan vs line-by-line
  "release_cadence",      // fast-ship vs careful-gate
];

// ── Action categories ─────────────────────────────────────────────────────────

const ACTION_CATEGORIES = [
  "approval",
  "rejection",
  "code_edit",
  "architecture_decision",
  "ui_approval",
  "deployment",
  "documentation",
  "release",
  "business_decision",
  "configuration",
  "security_action",
  "cost_decision",
];

function _ts() { return new Date().toISOString(); }
function _id() { return `fp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _defaultProfile() {
  const prefs = {};
  DIMENSIONS.forEach(d => { prefs[d] = { score: 0.5, confidence: 0, observations: 0 }; });
  const cats  = {};
  ACTION_CATEGORIES.forEach(c => { cats[c] = { count: 0, lastSeen: null }; });
  return {
    id:         "founder_primary",
    createdAt:  _ts(),
    updatedAt:  null,
    preferences: prefs,
    actionCounts: cats,
    observations: [],   // rolling last 500
    trustScore:   0,    // 0-100 — how well we know the founder
    totalActions: 0,
    correctionCount: 0,
    predictionAccuracy: { correct: 0, total: 0 },
  };
}

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return _defaultProfile(); }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  d.updatedAt = _ts();
  // Cap observations at 500
  if (d.observations.length > 500) d.observations = d.observations.slice(-500);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Preference updaters ───────────────────────────────────────────────────────

const PREFERENCE_SIGNALS = {
  // [action_type, dimension, direction (+1 or -1), weight]
  "approved_high_risk":       [["risk_tolerance",       +1, 0.3]],
  "rejected_high_risk":       [["risk_tolerance",       -1, 0.4]],
  "approved_auto":            [["automation_preference", +1, 0.3]],
  "rejected_auto":            [["automation_preference", -1, 0.4]],
  "added_docs":               [["documentation_depth",   +1, 0.2]],
  "skipped_docs":             [["documentation_depth",   -1, 0.2]],
  "approved_ui_compact":      [["ui_density",            +1, 0.2]],
  "approved_ui_spacious":     [["ui_density",            -1, 0.2]],
  "chose_cheaper_option":     [["cost_preference",       +1, 0.3]],
  "chose_quality_option":     [["cost_preference",       -1, 0.3]],
  "fast_shipped":             [["release_cadence",       +1, 0.25]],
  "slow_gated_release":       [["release_cadence",       -1, 0.25]],
  "deep_code_review":         [["code_review_depth",     +1, 0.3]],
  "quick_code_review":        [["code_review_depth",     -1, 0.3]],
  "security_hardened":        [["security_preference",   +1, 0.3]],
  "security_relaxed":         [["security_preference",   -1, 0.3]],
  "optimized_performance":    [["performance_preference", +1, 0.25]],
  "accepted_perf_tradeoff":   [["performance_preference", -1, 0.25]],
};

function _updatePreference(prefs, dimension, direction, weight) {
  const p = prefs[dimension];
  if (!p) return;
  const delta  = direction * weight * (1 - Math.abs(p.score - 0.5));
  p.score      = Math.max(0, Math.min(1, p.score + delta));
  p.observations++;
  // Confidence grows with observations (Bayesian-ish)
  p.confidence = Math.min(1, p.observations / 20);
}

function _computeTrustScore(d) {
  const avgConf = DIMENSIONS.reduce((s, dim) => s + (d.preferences[dim]?.confidence || 0), 0) / DIMENSIONS.length;
  const obsScore = Math.min(1, d.totalActions / 100);
  const accScore = d.predictionAccuracy.total > 0
    ? d.predictionAccuracy.correct / d.predictionAccuracy.total
    : 0;
  return Math.round((avgConf * 0.4 + obsScore * 0.3 + accScore * 0.3) * 100);
}

// ── Observation recording ─────────────────────────────────────────────────────

function recordAction({ action, category, context = {}, signals = [], outcome = "success" }) {
  if (!action) return { ok: false, error: "action required" };

  const d  = _load();
  const id = _id();

  // Track category
  const cat = d.actionCounts[category] || (d.actionCounts[category] = { count: 0, lastSeen: null });
  cat.count++;
  cat.lastSeen = _ts();

  // Apply preference signals
  for (const sig of signals) {
    const rules = PREFERENCE_SIGNALS[sig] || [];
    for (const [dim, dir, wt] of rules) {
      _updatePreference(d.preferences, dim, dir, wt);
    }
  }

  // Store observation
  const obs = { id, action, category, context, signals, outcome, ts: _ts() };
  d.observations.push(obs);
  d.totalActions++;
  d.trustScore = _computeTrustScore(d);

  _save(d);

  // Propagate to learning systems (non-blocking)
  _try(() => _cle()?.createLesson?.({
    type:       "founder_action",
    title:      `Founder action: ${action}`,
    category,
    source:     "founderProfileEngine",
    confidence: 0.85,
    tags:       ["founder", category, ...(signals || [])],
    metadata:   obs,
  }));

  return { ok: true, id, trustScore: d.trustScore };
}

// ── Preference reading ────────────────────────────────────────────────────────

function getPreferences() {
  const d = _load();
  return {
    ok: true,
    preferences: d.preferences,
    trustScore: d.trustScore,
    totalActions: d.totalActions,
    dimensions: DIMENSIONS,
  };
}

function getPreference(dimension) {
  const d   = _load();
  const pref = d.preferences[dimension];
  if (!pref) return { ok: false, error: `Unknown dimension: ${dimension}` };
  return { ok: true, dimension, ...pref };
}

function getProfile() {
  const d = _load();
  return {
    ok:                  true,
    id:                  d.id,
    trustScore:          d.trustScore,
    totalActions:        d.totalActions,
    correctionCount:     d.correctionCount,
    predictionAccuracy:  d.predictionAccuracy,
    preferences:         d.preferences,
    actionCounts:        d.actionCounts,
    recentObservations:  d.observations.slice(-10),
    updatedAt:           d.updatedAt,
  };
}

// ── Prediction accuracy feedback ──────────────────────────────────────────────

function recordPredictionOutcome({ predicted, actual, corrected = false }) {
  const d = _load();
  d.predictionAccuracy.total++;
  if (predicted === actual) d.predictionAccuracy.correct++;
  if (corrected) {
    d.correctionCount++;
    // Corrections are stronger learning signals — record as high-weight action
    _try(() => _eme()?.remember?.({
      type:       "founder_correction",
      content:    `Predicted "${predicted}" but founder chose "${actual}"`,
      confidence: 0.95,
      tags:       ["founder_correction", "prediction_miss"],
    }));
  }
  d.trustScore = _computeTrustScore(d);
  _save(d);
  return { ok: true, accuracy: d.predictionAccuracy.correct / d.predictionAccuracy.total };
}

// ── Record approval/rejection from P4 Approval Engine ────────────────────────

function observeApproval({ workflowId, approvalType, outcome, confidence, responseMs, risk }) {
  const signals = [];
  if (outcome === "approved") {
    signals.push(risk === "high" ? "approved_high_risk" : "approved_auto");
  } else if (outcome === "rejected") {
    signals.push(risk === "high" ? "rejected_high_risk" : "rejected_auto");
  }
  return recordAction({
    action:   `${outcome}: ${workflowId}`,
    category: "approval",
    context:  { workflowId, approvalType, confidence, responseMs, risk },
    signals,
    outcome,
  });
}

// ── Stats ────────────────────────────────────────────────────────────────────

function getStats() {
  const d = _load();
  const acc = d.predictionAccuracy;
  return {
    trustScore:          d.trustScore,
    totalActions:        d.totalActions,
    correctionCount:     d.correctionCount,
    predictionAccuracy:  acc.total > 0 ? Math.round(acc.correct / acc.total * 100) : 0,
    predictionTotal:     acc.total,
    dimensions:          DIMENSIONS.length,
    updatedAt:           d.updatedAt,
  };
}

module.exports = {
  recordAction,
  recordPredictionOutcome,
  observeApproval,
  getPreferences,
  getPreference,
  getProfile,
  getStats,
  DIMENSIONS,
  ACTION_CATEGORIES,
};
