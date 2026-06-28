"use strict";
/**
 * autonomousExecution.js — POST-Ω Sprint P3 routes
 *
 * /execution/*   — AEE orchestration
 * /execution/metrics — dashboard
 */

const router      = require("express").Router();
const requireAuth = require("../middleware/requireAuth");

const _try = fn => { try { return fn(); } catch { return null; } };
const _aee = () => _try(() => require("../services/autonomousExecutionEngine.cjs"));
const _pln = () => _try(() => require("../services/executionPlanner.cjs"));
const _val = () => _try(() => require("../services/executionValidator.cjs"));
const _ev  = () => _try(() => require("../services/executionEvidence.cjs"));
const _rec = () => _try(() => require("../services/executionRecovery.cjs"));
const _met = () => _try(() => require("../services/executionMetrics.cjs"));

router.use(requireAuth);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/execution/dashboard", (req, res) => {
  try {
    const r = _met()?.getDashboard?.();
    res.json(r || { ok: false, error: "metrics unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/metrics/summary", (req, res) => {
  try {
    const r = _met()?.getSummary?.();
    res.json(r || { ok: false, error: "metrics unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Planning ──────────────────────────────────────────────────────────────────

// Build plan for a single workflow
router.get("/execution/plan/:workflowId", (req, res) => {
  try {
    const r = _pln()?.buildPlan?.(req.params.workflowId);
    res.json(r || { ok: false, error: "planner unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Build batch plans
router.post("/execution/plans/batch", (req, res) => {
  try {
    const { domain, limit, classType } = req.body || {};
    const r = _pln()?.buildBatchPlans?.({ domain, limit, classType });
    res.json(r || { ok: false, error: "planner unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Prerequisite validation ───────────────────────────────────────────────────

router.get("/execution/validate/prereqs/:workflowId", (req, res) => {
  try {
    const { blockers = [] } = req.query;
    const r = _val()?.validatePrerequisites?.(req.params.workflowId, typeof blockers === "string" ? [blockers] : blockers);
    res.json(r || { ok: false, error: "validator unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/validate/health/:workflowId", (req, res) => {
  try {
    const r = _val()?.validateHealth?.(req.params.workflowId);
    res.json(r || { ok: false, error: "validator unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Run a real test suite as validation evidence
router.post("/execution/validate/tests", (req, res) => {
  try {
    const { testFile } = req.body || {};
    if (!testFile) return res.status(400).json({ ok: false, error: "testFile required" });
    const r = _val()?.validateTestSuite?.(testFile);
    res.json(r || { ok: false, error: "validator unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Execution ─────────────────────────────────────────────────────────────────

// Execute a single workflow
router.post("/execution/execute/:workflowId", async (req, res) => {
  try {
    const { triggeredBy = "founder", context = {}, maxRetries } = req.body || {};
    const r = await _aee()?.executeWorkflow?.(req.params.workflowId, { triggeredBy, context, maxRetries });
    res.json(r || { ok: false, error: "engine unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Execute a batch
router.post("/execution/batch", async (req, res) => {
  try {
    const { domain, limit = 5, triggeredBy = "founder" } = req.body || {};
    const r = await _aee()?.executeBatch?.({ domain, limit, triggeredBy });
    res.json(r || { ok: false, error: "engine unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Resume after approval
router.post("/execution/resume/:runId", async (req, res) => {
  try {
    const r = await _aee()?.resumeAfterApproval?.(req.params.runId);
    res.json(r || { ok: false, error: "engine unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Run queries ───────────────────────────────────────────────────────────────

router.get("/execution/runs", (req, res) => {
  try {
    const { status, workflowId, domain, limit } = req.query;
    const r = _aee()?.listRuns?.({ status, workflowId, domain, limit: limit ? parseInt(limit) : 50 });
    res.json({ ok: true, runs: r || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/runs/:runId", (req, res) => {
  try {
    const r = _aee()?.getRun?.(req.params.runId);
    if (!r) return res.status(404).json({ ok: false, error: "run not found" });
    res.json({ ok: true, run: r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/stats", (req, res) => {
  try {
    const r = _aee()?.getStats?.();
    res.json({ ok: true, stats: r || {} });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Workflow metrics ──────────────────────────────────────────────────────────

router.get("/execution/metrics/:workflowId", (req, res) => {
  try {
    const r = _met()?.getWorkflowMetrics?.(req.params.workflowId);
    res.json(r || { ok: false, error: "metrics unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Evidence ──────────────────────────────────────────────────────────────────

router.get("/execution/evidence", (req, res) => {
  try {
    const { workflowId, domain, outcome, limit } = req.query;
    const r = _ev()?.listEvidence?.({ workflowId, domain, outcome, limit: limit ? parseInt(limit) : 50 });
    res.json({ ok: true, evidence: r || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/evidence/summary", (req, res) => {
  try {
    const r = _ev()?.getSummary?.();
    res.json({ ok: true, summary: r || {} });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/evidence/:evidenceId", (req, res) => {
  try {
    const r = _ev()?.getEvidence?.(req.params.evidenceId);
    if (!r) return res.status(404).json({ ok: false, error: "evidence not found" });
    res.json({ ok: true, evidence: r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Recovery ──────────────────────────────────────────────────────────────────

router.get("/execution/recovery/stats", (req, res) => {
  try {
    const r = _rec()?.getStats?.();
    res.json({ ok: true, stats: r || {} });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/execution/recovery/runs", (req, res) => {
  try {
    const { executionId, workflowId, limit } = req.query;
    const r = _rec()?.listRecoveries?.({ executionId, workflowId, limit: limit ? parseInt(limit) : 20 });
    res.json({ ok: true, recoveries: r || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Master status ─────────────────────────────────────────────────────────────
router.get("/execution/status", (req, res) => {
  try {
    const stats  = _aee()?.getStats?.() || {};
    const evSum  = _ev()?.getSummary?.() || {};
    const recSt  = _rec()?.getStats?.() || {};
    res.json({
      ok:   true,
      engine: "autonomousExecutionEngine",
      stats, evidenceSummary: evSum, recoveryStats: recSt,
      successCriterion: "Founder says: 'Deploy today's release.' — platform does the rest.",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
