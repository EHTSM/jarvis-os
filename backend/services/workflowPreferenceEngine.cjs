"use strict";
/**
 * workflowPreferenceEngine.cjs — POST-Ω Sprint P6 FDT
 *
 * Maintains the founder's preferences per workflow category.
 * Observes execution patterns to build preference models for:
 *   - execution order preferences
 *   - notification preferences
 *   - review depth per category
 *   - timing preferences (when to execute, when to avoid)
 *   - tool preferences per task type
 *
 * Reuses: founderProfileEngine, decisionLearningEngine,
 *         productionBibleEngine, founderWorkRegistry.
 *
 * Storage: data/workflow-preferences.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "workflow-preferences.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _fpe = () => _try(() => require("./founderProfileEngine.cjs"));
const _dle = () => _try(() => require("./decisionLearningEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));

function _ts() { return new Date().toISOString(); }

// ── Preference taxonomy ───────────────────────────────────────────────────────

const WORKFLOW_CATEGORIES = [
  "deployment",
  "code_review",
  "testing",
  "documentation",
  "ui_review",
  "security",
  "performance",
  "release",
  "infrastructure",
  "business",
  "monitoring",
  "communication",
];

const TIMING_SLOTS = [
  "morning",     // 06-12
  "afternoon",   // 12-17
  "evening",     // 17-21
  "night",       // 21-06
  "weekday",
  "weekend",
];

const REVIEW_DEPTHS = ["skip", "skim", "standard", "thorough", "exhaustive"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _defaultPrefs() {
  const cats = {};
  WORKFLOW_CATEGORIES.forEach(c => {
    cats[c] = {
      reviewDepth:        "standard",
      reviewDepthConf:    0,
      preferredTiming:    [],
      avoidTiming:        [],
      toolPreferences:    {},
      executionOrder:     "system_default",
      notifyOn:           ["failure", "completion"],
      observations:       0,
      lastUpdated:        null,
    };
  });
  return { categories: cats, globalOverrides: {}, observations: [], updatedAt: null };
}

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return _defaultPrefs(); }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.observations.length > 500) d.observations = d.observations.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function _currentSlot() {
  const h   = new Date().getHours();
  const dow = new Date().getDay();
  const slots = [];
  if (h >= 6  && h < 12) slots.push("morning");
  if (h >= 12 && h < 17) slots.push("afternoon");
  if (h >= 17 && h < 21) slots.push("evening");
  if (h >= 21 || h < 6 ) slots.push("night");
  slots.push(dow === 0 || dow === 6 ? "weekend" : "weekday");
  return slots;
}

// ── Observe a workflow execution ──────────────────────────────────────────────

function observeExecution({ category, workflowId, reviewDepth, tools = [], timing = null, outcome, founderOverride = false }) {
  if (!category) return { ok: false, error: "category required" };

  const d   = _load();
  const cat = d.categories[category] || (d.categories[category] = {
    reviewDepth: "standard", reviewDepthConf: 0, preferredTiming: [],
    avoidTiming: [], toolPreferences: {}, executionOrder: "system_default",
    notifyOn: ["failure", "completion"], observations: 0, lastUpdated: null,
  });

  const slots = timing || _currentSlot();

  // Update review depth preference with Laplace smoothing
  if (reviewDepth && REVIEW_DEPTHS.includes(reviewDepth)) {
    if (founderOverride) {
      // Strong signal — founder explicitly chose this depth
      cat.reviewDepth    = reviewDepth;
      cat.reviewDepthConf = Math.min(1, cat.reviewDepthConf + 0.2);
    } else if (cat.observations > 0) {
      // Weak signal — system executed at this depth and founder didn't object
      if (outcome === "success") cat.reviewDepthConf = Math.min(1, cat.reviewDepthConf + 0.05);
    }
  }

  // Update timing preferences
  if (outcome === "success") {
    for (const slot of slots) {
      if (!cat.preferredTiming.includes(slot)) cat.preferredTiming.push(slot);
    }
  } else if (outcome === "failure" || outcome === "rejected") {
    for (const slot of slots) {
      if (!cat.avoidTiming.includes(slot)) cat.avoidTiming.push(slot);
    }
  }

  // Update tool preferences
  for (const tool of tools) {
    cat.toolPreferences[tool] = (cat.toolPreferences[tool] || 0) + (outcome === "success" ? 1 : -0.5);
  }

  cat.observations++;
  cat.lastUpdated = _ts();

  const obs = { category, workflowId, reviewDepth, tools, slots, outcome, founderOverride, ts: _ts() };
  d.observations.push(obs);
  _save(d);

  // Propagate to profile
  _try(() => _fpe()?.recordAction?.({
    action:   `Workflow executed: ${workflowId || category}`,
    category: "business_decision",
    context:  { category, reviewDepth, outcome },
    signals:  founderOverride ? ["deep_code_review"] : [],
    outcome,
  }));

  return { ok: true, category, observations: cat.observations };
}

// ── Preference queries ────────────────────────────────────────────────────────

function getPreference(category) {
  const d   = _load();
  const cat = d.categories[category];
  if (!cat) return { ok: false, error: `Unknown category: ${category}` };
  return {
    ok: true,
    category,
    reviewDepth:     cat.reviewDepth,
    confidence:      cat.reviewDepthConf,
    preferredTiming: cat.preferredTiming,
    avoidTiming:     cat.avoidTiming,
    toolPreferences: cat.toolPreferences,
    executionOrder:  cat.executionOrder,
    notifyOn:        cat.notifyOn,
    observations:    cat.observations,
    lastUpdated:     cat.lastUpdated,
  };
}

function getAllPreferences() {
  const d = _load();
  return {
    ok:          true,
    categories:  d.categories,
    overrides:   d.globalOverrides,
    updatedAt:   d.updatedAt,
  };
}

function isGoodTime(category) {
  const pref  = getPreference(category);
  if (!pref.ok || pref.preferredTiming.length === 0) return { ok: true, suitable: true, reason: "no preference data yet" };
  const slots = _currentSlot();
  const avoided = slots.some(s => pref.avoidTiming.includes(s));
  const preferred = slots.some(s => pref.preferredTiming.includes(s));
  return {
    ok:       true,
    suitable: !avoided,
    preferred,
    slots,
    reason:   avoided    ? "This time slot is associated with poor outcomes for this category."
              : preferred ? "This is a preferred time slot for this category."
              :              "Time slot is neutral.",
  };
}

function setOverride(category, field, value) {
  const d = _load();
  if (!d.categories[category]) return { ok: false, error: `Unknown category: ${category}` };
  d.categories[category][field] = value;
  // Treat as founder override — strong signal
  _try(() => _fpe()?.recordAction?.({
    action:   `Workflow preference override: ${category}.${field}`,
    category: "configuration",
    context:  { category, field, value },
    signals:  [],
    outcome:  "success",
  }));
  _save(d);
  return { ok: true, category, field, value };
}

// ── Sync from production bible ────────────────────────────────────────────────

function syncFromBible() {
  const bible = _try(() => require("./productionBibleEngine.cjs"));
  if (!bible) return { ok: false, error: "productionBibleEngine unavailable" };
  const workflows = bible.listWorkflows?.({ limit: 200 }) || [];
  let synced = 0;
  for (const wf of workflows) {
    const cat = wf.category?.toLowerCase().replace(/\s+/g, "_") || "general";
    if (!WORKFLOW_CATEGORIES.includes(cat)) continue;
    observeExecution({
      category:       cat,
      workflowId:     wf.id,
      reviewDepth:    wf.automationScore > 0.8 ? "skim" : "standard",
      outcome:        wf.currentState === "completed" ? "success" : "pending",
      founderOverride: false,
    });
    synced++;
  }
  return { ok: true, synced };
}

function getStats() {
  const d = _load();
  const cats = Object.keys(d.categories);
  const totalObs = cats.reduce((s, c) => s + (d.categories[c].observations || 0), 0);
  return {
    categoriesTracked:   cats.length,
    totalObservations:   totalObs,
    updatedAt:           d.updatedAt,
  };
}

module.exports = {
  observeExecution,
  getPreference,
  getAllPreferences,
  isGoodTime,
  setOverride,
  syncFromBible,
  getStats,
  WORKFLOW_CATEGORIES,
  TIMING_SLOTS,
  REVIEW_DEPTHS,
};
