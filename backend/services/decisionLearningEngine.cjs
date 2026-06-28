"use strict";
/**
 * decisionLearningEngine.cjs — POST-Ω Sprint P6 FDT
 *
 * Observes every founder decision and builds a decision model.
 * Extracts patterns from: approvals, rejections, code edits,
 * architecture choices, UI decisions, release gates.
 *
 * Reuses: continuousLearningEngine, engineeringMemoryEngine,
 *         approvalEvidence, founderProfileEngine.
 *
 * Storage: data/decision-learning.json (decisions)
 *          data/decision-patterns.json (extracted patterns)
 */

const fs   = require("fs");
const path = require("path");

const ROOT        = path.join(__dirname, "../..");
const DECISIONS_F = path.join(ROOT, "data", "decision-learning.json");
const PATTERNS_F  = path.join(ROOT, "data", "decision-patterns.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _fpe = () => _try(() => require("./founderProfileEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _ae  = () => _try(() => require("./approvalEvidence.cjs"));

function _ts()   { return new Date().toISOString(); }
function _id()   { return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// ── Decision categories ───────────────────────────────────────────────────────

const DECISION_TYPES = {
  APPROVE:       "approve",
  REJECT:        "reject",
  MODIFY:        "modify",
  ESCALATE:      "escalate",
  DEFER:         "defer",
  AUTO_DELEGATE: "auto_delegate",
};

// ── Pattern keys we track ─────────────────────────────────────────────────────

const PATTERN_DIMENSIONS = [
  "high_risk_approval_rate",
  "deployment_approval_rate",
  "ui_approval_rate",
  "code_review_approval_rate",
  "security_approval_rate",
  "cost_override_rate",
  "avg_decision_speed_ms",
  "correction_frequency",
  "weekend_decision_rate",
  "after_hours_decision_rate",
];

function _load(file, fb) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fb; }
}

function _save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function _loadDecisions() {
  return _load(DECISIONS_F, { decisions: [], updatedAt: null });
}

function _loadPatterns() {
  return _load(PATTERNS_F, { patterns: {}, updatedAt: null });
}

// ── Record a decision ─────────────────────────────────────────────────────────

function recordDecision({
  type,           // DECISION_TYPES.*
  subject,        // human-readable — what was decided about
  workflowId,
  domain,         // "deployment", "ui", "code", "security", "cost", etc.
  outcome,        // "approved", "rejected", "modified", etc.
  confidence,     // how confident was the system's prediction (0-1)
  predictionWas,  // what the twin predicted
  durationMs,     // how long founder took
  context = {},
  risk = "medium",
}) {
  if (!type || !subject) return { ok: false, error: "type and subject required" };

  const store = _loadDecisions();
  const id    = _id();

  const decision = {
    id, type, subject, workflowId, domain, outcome,
    confidence, predictionWas, durationMs, context, risk,
    ts:          _ts(),
    wasCorrect:  predictionWas === outcome,
    hour:        new Date().getHours(),
    dayOfWeek:   new Date().getDay(),
  };

  store.decisions.push(decision);
  if (store.decisions.length > 2000) store.decisions = store.decisions.slice(-2000);
  store.updatedAt = _ts();
  _save(DECISIONS_F, store);

  // Update profile
  _try(() => _fpe()?.recordAction?.({
    action:   `${type}: ${subject}`,
    category: domain === "deployment" ? "deployment"
              : domain === "ui"       ? "ui_approval"
              : domain === "code"     ? "code_edit"
              : domain === "security" ? "security_action"
              : domain === "cost"     ? "cost_decision"
              : "business_decision",
    context:  { workflowId, domain, risk, confidence },
    outcome,
  }));

  // Record prediction accuracy
  if (predictionWas) {
    _try(() => _fpe()?.recordPredictionOutcome?.({
      predicted:  predictionWas,
      actual:     outcome,
      corrected:  predictionWas !== outcome,
    }));
  }

  // Persist lesson
  _try(() => _cle()?.createLesson?.({
    type:       "founder_decision",
    title:      `Founder ${outcome}: ${subject.slice(0, 80)}`,
    source:     "decisionLearningEngine",
    confidence: 0.9,
    tags:       ["founder_decision", domain, outcome, risk],
    metadata:   decision,
  }));

  // Async pattern extraction
  _extractPatterns();

  return { ok: true, id, wasCorrect: decision.wasCorrect };
}

// ── Pattern extraction ────────────────────────────────────────────────────────

function _extractPatterns() {
  const store    = _loadDecisions();
  const decisions = store.decisions;
  if (decisions.length < 3) return;

  const patterns = {};

  // Approval rates by domain
  for (const domain of ["high_risk", "deployment", "ui", "code_review", "security"]) {
    const subset = decisions.filter(d => {
      if (domain === "high_risk") return d.risk === "high";
      return d.domain === domain.replace("_review", "");
    });
    if (subset.length === 0) continue;
    const approved = subset.filter(d => d.outcome === "approved").length;
    patterns[`${domain}_approval_rate`] = {
      rate:         approved / subset.length,
      sampleSize:   subset.length,
      confidence:   Math.min(1, subset.length / 10),
      updatedAt:    _ts(),
    };
  }

  // Cost override rate
  const costDecs = decisions.filter(d => d.domain === "cost");
  if (costDecs.length > 0) {
    patterns.cost_override_rate = {
      rate:       costDecs.filter(d => d.type === DECISION_TYPES.MODIFY).length / costDecs.length,
      sampleSize: costDecs.length,
      confidence: Math.min(1, costDecs.length / 5),
      updatedAt:  _ts(),
    };
  }

  // Decision speed
  const timed = decisions.filter(d => d.durationMs > 0);
  if (timed.length > 0) {
    const avg = timed.reduce((s, d) => s + d.durationMs, 0) / timed.length;
    patterns.avg_decision_speed_ms = {
      avgMs:      Math.round(avg),
      sampleSize: timed.length,
      confidence: Math.min(1, timed.length / 20),
      updatedAt:  _ts(),
    };
  }

  // Weekend / after-hours decision patterns
  const weekend  = decisions.filter(d => d.dayOfWeek === 0 || d.dayOfWeek === 6);
  const afterHrs = decisions.filter(d => d.hour < 8 || d.hour > 20);
  if (decisions.length > 0) {
    patterns.weekend_decision_rate  = { rate: weekend.length / decisions.length, confidence: Math.min(1, decisions.length / 30), updatedAt: _ts() };
    patterns.after_hours_decision_rate = { rate: afterHrs.length / decisions.length, confidence: Math.min(1, decisions.length / 30), updatedAt: _ts() };
  }

  // Correction frequency
  if (decisions.length > 0) {
    const corrections = decisions.filter(d => !d.wasCorrect && d.predictionWas).length;
    patterns.correction_frequency = {
      rate:       corrections / decisions.length,
      sampleSize: decisions.length,
      confidence: Math.min(1, decisions.length / 20),
      updatedAt:  _ts(),
    };
  }

  const pStore = _loadPatterns();
  pStore.patterns   = { ...pStore.patterns, ...patterns };
  pStore.updatedAt  = _ts();
  _save(PATTERNS_F, pStore);

  // Store in engineering memory for recall
  _try(() => _eme()?.remember?.({
    type:       "decision_patterns",
    content:    `Founder decision patterns updated: ${Object.keys(patterns).join(", ")}`,
    confidence: 0.85,
    tags:       ["founder_patterns", "decision_learning"],
    metadata:   patterns,
  }));
}

// ── Retrieve decisions ────────────────────────────────────────────────────────

function getDecisions({ domain, outcome, limit = 50, since } = {}) {
  const store = _loadDecisions();
  let list    = store.decisions;
  if (domain)  list = list.filter(d => d.domain === domain);
  if (outcome) list = list.filter(d => d.outcome === outcome);
  if (since)   list = list.filter(d => d.ts >= since);
  return { ok: true, decisions: list.slice(-limit), total: list.length };
}

function getPatterns() {
  _extractPatterns();
  const p = _loadPatterns();
  return { ok: true, patterns: p.patterns, patternCount: Object.keys(p.patterns).length, updatedAt: p.updatedAt };
}

function getSimilarDecisions(subject, domain, limit = 5) {
  const store = _loadDecisions();
  const words = subject.toLowerCase().split(/\s+/);
  const scored = store.decisions
    .filter(d => !domain || d.domain === domain)
    .map(d => {
      const dWords = (d.subject || "").toLowerCase().split(/\s+/);
      const overlap = words.filter(w => dWords.includes(w)).length;
      return { ...d, similarity: overlap / Math.max(words.length, 1) };
    })
    .filter(d => d.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  return { ok: true, similar: scored };
}

function getStats() {
  const store    = _loadDecisions();
  const decisions = store.decisions;
  const correct  = decisions.filter(d => d.wasCorrect && d.predictionWas).length;
  const predicted = decisions.filter(d => d.predictionWas).length;
  return {
    totalDecisions:     decisions.length,
    predictionAccuracy: predicted > 0 ? Math.round(correct / predicted * 100) : 0,
    patternCount:       Object.keys(_loadPatterns().patterns).length,
    domains:            [...new Set(decisions.map(d => d.domain))],
    updatedAt:          store.updatedAt,
  };
}

module.exports = {
  recordDecision,
  getDecisions,
  getPatterns,
  getSimilarDecisions,
  getStats,
  DECISION_TYPES,
  PATTERN_DIMENSIONS,
};
