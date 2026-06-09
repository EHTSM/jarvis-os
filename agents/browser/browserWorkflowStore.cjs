"use strict";
/**
 * browserWorkflowStore — save, replay, and analyse browser automation workflows.
 *
 * Provides:
 *   Templates   — named, reusable workflow definitions with parameter slots
 *   History     — every workflow execution with outcome, timing, and screenshots
 *   Replay      — re-run any saved template or past execution
 *   Health      — per-workflow success rates, average duration, retry counts
 *
 * Storage: data/browser-workflow-store.json (single file, max 500 history entries)
 *
 * Design rules:
 *   - No runtime orchestration — this is a read/write store, not an executor
 *   - Callers (browserRunner, routes) drive execution; store just records + retrieves
 *   - All writes are synchronous JSON to avoid async file-lock bugs
 *   - IDs are time-based slugs: readable and sortable
 *
 * Public API:
 *   Templates:
 *     saveTemplate(name, steps, meta)     → { ok, id }
 *     getTemplate(id)                     → template | null
 *     listTemplates(filter?)              → template[]
 *     deleteTemplate(id)                  → { ok }
 *     cloneTemplate(id, newName)          → { ok, id }
 *
 *   History:
 *     recordExecution(result, meta)       → { ok, id }
 *     getExecution(id)                    → execution | null
 *     listHistory(filter?)                → execution[]
 *     clearHistory(olderThanDays?)        → { ok, removed }
 *
 *   Health:
 *     getWorkflowHealth(templateId)       → health report
 *     getSystemHealth()                   → overall automation health
 *
 *   Replay:
 *     getReplaySteps(executionId)         → steps[] ready for runner.run()
 */

const fs   = require("fs");
const path = require("path");

const STORE_PATH    = path.join(__dirname, "../../data/browser-workflow-store.json");
const MAX_HISTORY   = 500;
const MAX_TEMPLATES = 100;

// ── Store I/O ─────────────────────────────────────────────────────────────────
function _load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return { templates: [], history: [], meta: { created: Date.now() } };
  }
}

function _save(store) {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error("[BrowserWorkflowStore] Write failed:", err.message);
  }
}

function _id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * Save a workflow as a named, reusable template.
 *
 * @param {string}   name    — human-readable name
 * @param {Array}    steps   — Playwright step array
 * @param {object}   meta    — { description?, category?, tags?, params?, source? }
 * @returns {{ ok: boolean, id: string }}
 */
function saveTemplate(name, steps, meta = {}) {
  if (!name || !steps?.length) return { ok: false, error: "name and steps required" };

  const store = _load();

  // Enforce max templates (evict oldest custom ones)
  const customs = store.templates.filter(t => !t.builtin);
  if (customs.length >= MAX_TEMPLATES) {
    const oldest = customs.sort((a, b) => a.savedAt - b.savedAt)[0];
    store.templates = store.templates.filter(t => t.id !== oldest.id);
  }

  const id = _id("tpl");
  const template = {
    id,
    name:        name.slice(0, 100),
    steps:       steps.slice(0, 50),
    savedAt:     Date.now(),
    savedAtISO:  new Date().toISOString(),
    description: (meta.description || "").slice(0, 300),
    category:    meta.category || "custom",
    tags:        (meta.tags || []).slice(0, 10),
    source:      meta.source || "manual",
    params:      meta.params || {},     // { paramName: { description, example } }
    usageCount:  0,
    lastUsed:    null,
  };

  store.templates.push(template);
  _save(store);
  return { ok: true, id };
}

function getTemplate(id) {
  return _load().templates.find(t => t.id === id) ?? null;
}

function listTemplates({ category, tag, search } = {}) {
  let list = _load().templates;
  if (category) list = list.filter(t => t.category === category);
  if (tag)      list = list.filter(t => t.tags?.includes(tag));
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags?.some(tag => tag.toLowerCase().includes(q))
    );
  }
  return list.sort((a, b) => b.savedAt - a.savedAt);
}

function deleteTemplate(id) {
  const store = _load();
  const before = store.templates.length;
  store.templates = store.templates.filter(t => t.id !== id);
  _save(store);
  return { ok: store.templates.length < before, removed: before - store.templates.length };
}

function cloneTemplate(id, newName) {
  const tpl = getTemplate(id);
  if (!tpl) return { ok: false, error: "Template not found" };
  return saveTemplate(newName || `${tpl.name} (copy)`, tpl.steps, {
    description: tpl.description,
    category:    tpl.category,
    tags:        tpl.tags,
    params:      tpl.params,
    source:      `clone:${id}`,
  });
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * Record a completed workflow execution.
 * Called by browserRunner after each run() completes.
 *
 * @param {object}  result  — runner.run() result
 * @param {object}  meta    — { templateId?, workflowName?, triggeredBy? }
 * @returns {{ ok: boolean, id: string }}
 */
function recordExecution(result, meta = {}) {
  if (!result) return { ok: false, error: "result required" };

  const store = _load();

  // Enforce max history (evict oldest)
  if (store.history.length >= MAX_HISTORY) {
    store.history = store.history
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .slice(0, MAX_HISTORY - 1);
  }

  const id = _id("exec");
  const stepSummaries = (result.steps || []).map((s, i) => ({
    index:     i,
    action:    s.action,
    label:     s.label || s.action,
    ok:        s.ok,
    attempts:  s.attempts || 1,
    recovered: s.recoveredViaReload || false,
    error:     s.ok ? undefined : (s.error || "").slice(0, 200),
  }));

  const passCount  = stepSummaries.filter(s => s.ok).length;
  const totalRetries = stepSummaries.reduce((n, s) => n + Math.max(0, (s.attempts || 1) - 1), 0);

  const execution = {
    id,
    workflowId:   result.workflowId || null,
    templateId:   meta.templateId || null,
    name:         (meta.workflowName || result.label || "Unnamed workflow").slice(0, 100),
    triggeredBy:  meta.triggeredBy || "api",
    recordedAt:   Date.now(),
    recordedAtISO: new Date().toISOString(),

    // Outcome
    ok:           result.ok,
    cancelled:    result.cancelled || false,
    failedAt:     result.failedAt ?? null,
    summary:      (result.summary || "").slice(0, 500),

    // URLs
    startUrl:     (result.steps?.[0]?.url || "").slice(0, 300),
    finalUrl:     (result.currentUrl || "").slice(0, 300),
    finalTitle:   (result.currentTitle || "").slice(0, 200),

    // Steps
    stepCount:    stepSummaries.length,
    stepsPassed:  passCount,
    stepsFailed:  stepSummaries.length - passCount,
    totalRetries,
    steps:        stepSummaries,

    // Timing
    startedAt:    result.startedAt || null,
    completedAt:  result.completedAt || new Date().toISOString(),

    // Evidence
    hasScreenshot: !!result.screenshot,
    screenshotKb:  result.screenshot ? Math.round(result.screenshot.length / 1400) : null,

    // Stored steps for replay (capped to save space)
    replaySteps: (result._originalSteps || []).slice(0, 50),
  };

  store.history.unshift(execution);
  _save(store);

  // Update template usage stats if linked
  if (meta.templateId) {
    const tpl = store.templates.find(t => t.id === meta.templateId);
    if (tpl) {
      tpl.usageCount = (tpl.usageCount || 0) + 1;
      tpl.lastUsed   = new Date().toISOString();
      _save(store);
    }
  }

  return { ok: true, id };
}

function getExecution(id) {
  return _load().history.find(e => e.id === id) ?? null;
}

function listHistory({ templateId, ok, limit = 50, offset = 0 } = {}) {
  let list = _load().history;
  if (templateId !== undefined) list = list.filter(e => e.templateId === templateId);
  if (ok !== undefined)         list = list.filter(e => e.ok === ok);
  return list.slice(offset, offset + limit);
}

function clearHistory(olderThanDays = 30) {
  const store   = _load();
  const cutoff  = Date.now() - olderThanDays * 86_400_000;
  const before  = store.history.length;
  store.history = store.history.filter(e => e.recordedAt > cutoff);
  _save(store);
  return { ok: true, removed: before - store.history.length };
}

// ── Health scoring ─────────────────────────────────────────────────────────────

/**
 * Health report for a specific template (based on its execution history).
 *
 * Score bands:
 *   90–100  = Excellent  — highly reliable
 *   75–89   = Good       — minor flakiness
 *   50–74   = Fair       — intermittent failures
 *   0–49    = Poor       — unreliable, needs attention
 */
function getWorkflowHealth(templateId) {
  const executions = listHistory({ templateId, limit: 100 });
  if (executions.length === 0) {
    return { templateId, runs: 0, score: null, band: "no-data", message: "No executions recorded yet" };
  }

  const runs          = executions.length;
  const passed        = executions.filter(e => e.ok).length;
  const passRate      = passed / runs;
  const totalRetries  = executions.reduce((n, e) => n + (e.totalRetries || 0), 0);
  const avgRetries    = totalRetries / runs;
  const recovered     = executions.reduce((n, e) => n + (e.steps || []).filter(s => s.recovered).length, 0);

  // Timing (from completedAt - startedAt if available)
  const timings = executions
    .filter(e => e.startedAt && e.completedAt)
    .map(e => new Date(e.completedAt) - new Date(e.startedAt))
    .filter(ms => ms > 0 && ms < 600_000);
  const avgMs = timings.length ? Math.round(timings.reduce((n, t) => n + t, 0) / timings.length) : null;

  // Score: 100 * passRate - penalties for retries
  const retryPenalty = Math.min(20, avgRetries * 5);
  const score        = Math.max(0, Math.round(passRate * 100 - retryPenalty));
  const band         = score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 50 ? "fair" : "poor";

  const recent5 = executions.slice(0, 5).map(e => e.ok ? "✓" : "✗").join(" ");

  return {
    templateId,
    runs,
    passed,
    failed:        runs - passed,
    passRate:      Math.round(passRate * 100),
    totalRetries,
    avgRetries:    Math.round(avgRetries * 10) / 10,
    recoveries:    recovered,
    avgDurationMs: avgMs,
    avgDurationSec: avgMs ? Math.round(avgMs / 100) / 10 : null,
    score,
    band,
    recent5,
    message:       _healthMessage(band, passRate, avgRetries),
  };
}

function _healthMessage(band, passRate, avgRetries) {
  if (band === "excellent") return `Highly reliable — ${Math.round(passRate * 100)}% success rate`;
  if (band === "good")      return `Generally reliable — occasional retries (avg ${Math.round(avgRetries * 10) / 10}/run)`;
  if (band === "fair")      return `Intermittent failures — ${Math.round(passRate * 100)}% success rate, review selectors`;
  return `Unreliable — ${Math.round(passRate * 100)}% success rate — check target site or selectors`;
}

/**
 * Overall automation system health across all recorded executions.
 */
function getSystemHealth() {
  const store     = _load();
  const history   = store.history;
  const templates = store.templates;

  if (history.length === 0) {
    return { runs: 0, score: null, band: "no-data", message: "No executions recorded" };
  }

  const runs       = history.length;
  const passed     = history.filter(e => e.ok).length;
  const passRate   = passed / runs;
  const cancelled  = history.filter(e => e.cancelled).length;
  const retries    = history.reduce((n, e) => n + (e.totalRetries || 0), 0);
  const recoveries = history.reduce((n, e) => n + (e.steps || []).filter(s => s.recovered).length, 0);

  // Recent trend — last 10 runs
  const recent10   = history.slice(0, 10);
  const recentPass = recent10.filter(e => e.ok).length;
  const trend      = recentPass >= 8 ? "improving" : recentPass >= 5 ? "stable" : "degrading";

  const score = Math.min(100, Math.round(passRate * 100 - (retries / runs) * 3));
  const band  = score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 50 ? "fair" : "poor";

  return {
    runs, passed, failed: runs - passed,
    passRate:       Math.round(passRate * 100),
    cancelled,
    totalRetries:   retries,
    totalRecoveries: recoveries,
    savedTemplates: templates.length,
    score,
    band,
    trend,
    recentSeries:   recent10.map(e => e.ok ? "✓" : "✗").join(" "),
    message:        `${Math.round(passRate * 100)}% pass rate over ${runs} runs (trend: ${trend})`,
  };
}

// ── Replay ────────────────────────────────────────────────────────────────────

/**
 * Get steps for replaying a past execution.
 * Returns the original steps that were used when the execution ran.
 */
function getReplaySteps(executionId) {
  const exec = getExecution(executionId);
  if (!exec) return null;
  if (!exec.replaySteps?.length) return null;
  return exec.replaySteps;
}

/**
 * Get steps for running a saved template.
 * Optionally substitute template params.
 */
function getTemplateSteps(templateId, paramValues = {}) {
  const tpl = getTemplate(templateId);
  if (!tpl) return null;

  // Simple string substitution for {{paramName}} patterns in step fields
  if (Object.keys(paramValues).length === 0) return tpl.steps;

  return tpl.steps.map(step => {
    const s = { ...step };
    for (const [key, val] of Object.entries(paramValues)) {
      const placeholder = `{{${key}}}`;
      if (s.url)      s.url      = s.url.replace(placeholder, val);
      if (s.text)     s.text     = s.text.replace(placeholder, val);
      if (s.selector) s.selector = s.selector.replace(placeholder, val);
      if (s.script)   s.script   = s.script.replace(placeholder, val);
      if (s.label)    s.label    = s.label.replace(placeholder, val);
    }
    return s;
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function stats() {
  const store = _load();
  return {
    templates: store.templates.length,
    history:   store.history.length,
    maxTemplates: MAX_TEMPLATES,
    maxHistory:   MAX_HISTORY,
  };
}

module.exports = {
  // Templates
  saveTemplate, getTemplate, listTemplates, deleteTemplate, cloneTemplate,
  // History
  recordExecution, getExecution, listHistory, clearHistory,
  // Health
  getWorkflowHealth, getSystemHealth,
  // Replay
  getReplaySteps, getTemplateSteps,
  // Stats
  stats,
};
