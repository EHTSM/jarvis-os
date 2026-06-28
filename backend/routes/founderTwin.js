"use strict";
/**
 * POST-Ω Sprint P6 — Founder Digital Twin routes
 * Prefix: /twin/*
 */

const router = require("express").Router();

const _try  = fn => { try { return fn(); } catch { return null; } };
const requireAuth = _try(() => require("../middleware/requireAuth")) || ((req, res, next) => next());

const _dte  = () => _try(() => require("../services/digitalTwinEngine.cjs"));
const _fpe  = () => _try(() => require("../services/founderProfileEngine.cjs"));
const _dle  = () => _try(() => require("../services/decisionLearningEngine.cjs"));
const _ape  = () => _try(() => require("../services/approvalPredictionEngine.cjs"));
const _wpe  = () => _try(() => require("../services/workflowPreferenceEngine.cjs"));
const _ctx  = () => _try(() => require("../services/contextBuilder.cjs"));

// ── Digital Twin ─────────────────────────────────────────────────────────────

router.get("/twin/dashboard", requireAuth, (req, res) =>
  res.json(_dte()?.getDashboard?.() || { ok: false }));

router.get("/twin/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _dte()?.getStats?.() || {} }));

router.get("/twin/decisions", requireAuth, (req, res) => {
  const { outcome, limit } = req.query;
  res.json(_dte()?.getDecisions?.({ outcome, limit: limit ? +limit : 50 }) || { ok: false });
});

router.post("/twin/decide", requireAuth, async (req, res) => {
  const { command, workflowId, domain, category, risk, context } = req.body || {};
  if (!command) return res.status(400).json({ ok: false, error: "command required" });
  try {
    const result = await _dte()?.decide?.(command, { workflowId, domain, category, risk, context });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/twin/outcome/:decisionId", requireAuth, async (req, res) => {
  const { actualOutcome, correction } = req.body || {};
  if (!actualOutcome) return res.status(400).json({ ok: false, error: "actualOutcome required" });
  try {
    const result = await _dte()?.recordOutcome?.(req.params.decisionId, actualOutcome, { correction });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Scenario validation
router.post("/twin/scenario/:name", requireAuth, async (req, res) => {
  try {
    const result = await _dte()?.runScenario?.(req.params.name);
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/twin/scenarios/all", requireAuth, async (req, res) => {
  try {
    const result = await _dte()?.runAllScenarios?.();
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Founder Profile ──────────────────────────────────────────────────────────

router.get("/twin/profile", requireAuth, (req, res) =>
  res.json(_fpe()?.getProfile?.() || { ok: false }));

router.get("/twin/profile/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _fpe()?.getStats?.() || {} }));

router.get("/twin/profile/preferences", requireAuth, (req, res) =>
  res.json(_fpe()?.getPreferences?.() || { ok: false }));

router.get("/twin/profile/preference/:dimension", requireAuth, (req, res) =>
  res.json(_fpe()?.getPreference?.(req.params.dimension) || { ok: false }));

router.post("/twin/profile/action", requireAuth, (req, res) => {
  const { action, category, context, signals, outcome } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: "action required" });
  res.json(_fpe()?.recordAction?.({ action, category, context, signals, outcome }) || { ok: false });
});

router.post("/twin/profile/approval", requireAuth, (req, res) => {
  const { workflowId, approvalType, outcome, confidence, responseMs, risk } = req.body || {};
  res.json(_fpe()?.observeApproval?.({ workflowId, approvalType, outcome, confidence, responseMs, risk }) || { ok: false });
});

// ── Decision Learning ────────────────────────────────────────────────────────

router.get("/twin/decisions/patterns", requireAuth, (req, res) =>
  res.json(_dle()?.getPatterns?.() || { ok: false }));

router.get("/twin/decisions/history", requireAuth, (req, res) => {
  const { domain, outcome, limit } = req.query;
  res.json(_dle()?.getDecisions?.({ domain, outcome, limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/twin/decisions/similar", requireAuth, (req, res) => {
  const { subject, domain, limit } = req.query;
  if (!subject) return res.status(400).json({ ok: false, error: "subject required" });
  res.json(_dle()?.getSimilarDecisions?.(subject, domain, limit ? +limit : 5) || { ok: false });
});

router.post("/twin/decisions/record", requireAuth, (req, res) => {
  const result = _dle()?.recordDecision?.(req.body || {});
  res.json(result || { ok: false });
});

// ── Approval Prediction ──────────────────────────────────────────────────────

router.post("/twin/predict", requireAuth, async (req, res) => {
  const { workflowId, domain, risk, context, confidence } = req.body || {};
  if (!workflowId) return res.status(400).json({ ok: false, error: "workflowId required" });
  try {
    const result = await _ape()?.predictAndRoute?.(workflowId, { domain, risk, context, confidence });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/twin/predict/quick", requireAuth, (req, res) => {
  const { workflowId, domain, risk, context } = req.body || {};
  res.json(_ape()?.predict?.(workflowId || "generic", { domain, risk, context }) || { ok: false });
});

router.post("/twin/predict/outcome/:predictionId", requireAuth, (req, res) => {
  const { actualOutcome } = req.body || {};
  res.json(_ape()?.recordOutcome?.(req.params.predictionId, actualOutcome) || { ok: false });
});

router.get("/twin/predict/history", requireAuth, (req, res) => {
  const { workflowId, routed, limit } = req.query;
  res.json(_ape()?.getPredictions?.({ workflowId, routed, limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/twin/predict/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _ape()?.getStats?.() || {} }));

// ── Workflow Preferences ─────────────────────────────────────────────────────

router.get("/twin/preferences", requireAuth, (req, res) =>
  res.json(_wpe()?.getAllPreferences?.() || { ok: false }));

router.get("/twin/preferences/:category", requireAuth, (req, res) =>
  res.json(_wpe()?.getPreference?.(req.params.category) || { ok: false }));

router.get("/twin/preferences/:category/timing", requireAuth, (req, res) =>
  res.json(_wpe()?.isGoodTime?.(req.params.category) || { ok: false }));

router.post("/twin/preferences/:category/override", requireAuth, (req, res) => {
  const { field, value } = req.body || {};
  if (!field) return res.status(400).json({ ok: false, error: "field required" });
  res.json(_wpe()?.setOverride?.(req.params.category, field, value) || { ok: false });
});

router.post("/twin/preferences/observe", requireAuth, (req, res) => {
  const result = _wpe()?.observeExecution?.(req.body || {});
  res.json(result || { ok: false });
});

router.post("/twin/preferences/sync-bible", requireAuth, (req, res) =>
  res.json(_wpe()?.syncFromBible?.() || { ok: false }));

// ── Context Builder ──────────────────────────────────────────────────────────

router.post("/twin/context", requireAuth, async (req, res) => {
  const { command, workflowId, domain, category } = req.body || {};
  if (!command) return res.status(400).json({ ok: false, error: "command required" });
  try {
    const ctx = await _ctx()?.build?.(command, { workflowId, domain, category });
    res.json(ctx || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/twin/context/quick", requireAuth, (req, res) => {
  const { command, workflowId, domain } = req.body || {};
  if (!command) return res.status(400).json({ ok: false, error: "command required" });
  res.json(_ctx()?.buildQuick?.(command, { workflowId, domain }) || { ok: false });
});

module.exports = router;
