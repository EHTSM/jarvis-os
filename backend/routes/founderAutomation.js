"use strict";
/**
 * founderAutomation.js — POST-Ω Sprint P2 routes
 *
 * Founder Work Registry  → /founder/*
 * Founder Automation     → /founder/automation/*
 * Production Bible       → /bible/*
 */

const router         = require("express").Router();
const requireAuth    = require("../middleware/requireAuth");

const _try = fn => { try { return fn(); } catch (e) { return null; } };
const _fwr = () => _try(() => require("../services/founderWorkRegistry.cjs"));
const _fae = () => _try(() => require("../services/founderAutomationEngine.cjs"));
const _pbe = () => _try(() => require("../services/productionBibleEngine.cjs"));

router.use(requireAuth);

// ── Founder Work Registry ─────────────────────────────────────────────────────

// Build / rebuild the registry from all known sources
router.post("/founder/registry/build", (req, res) => {
  try {
    const r = _fwr()?.buildRegistry?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Get current registry
router.get("/founder/registry", (req, res) => {
  try {
    const r = _fwr()?.getRegistry?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List workflows with optional filters
router.get("/founder/workflows", (req, res) => {
  try {
    const { domain, class: classType, status, limit } = req.query;
    const r = _fwr()?.listWorkflows?.({ domain, classType, status, limit: limit ? parseInt(limit) : 100 });
    res.json({ ok: true, workflows: r || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Get single workflow
router.get("/founder/workflows/:id", (req, res) => {
  try {
    const w = _fwr()?.getWorkflow?.(req.params.id);
    if (!w) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, workflow: w });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Founder work dashboard
router.get("/founder/dashboard", (req, res) => {
  try {
    const r = _fwr()?.getDashboard?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Founder Automation Engine ─────────────────────────────────────────────────

// Detect all automatable manual workflows
router.get("/founder/automation/detect", (req, res) => {
  try {
    const r = _fae()?.detectManualWorkflows?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Build automation plan for a workflow
router.get("/founder/automation/plan/:workflowId", (req, res) => {
  try {
    const r = _fae()?.buildAutomationPlan?.(req.params.workflowId);
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Execute a workflow
router.post("/founder/automation/execute/:workflowId", async (req, res) => {
  try {
    const { triggeredBy = "founder", context = {} } = req.body || {};
    const r = await _fae()?.executeWorkflow?.(req.params.workflowId, { triggeredBy, context });
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Resume a workflow after approval
router.post("/founder/automation/resume/:runId", (req, res) => {
  try {
    const r = _fae()?.resumeAfterApproval?.(req.params.runId);
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Verify workflow automation status
router.get("/founder/automation/verify/:workflowId", (req, res) => {
  try {
    const r = _fae()?.verifyWorkflow?.(req.params.workflowId);
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Founder time saved report
router.get("/founder/automation/report", (req, res) => {
  try {
    const r = _fae()?.getReport?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List automation runs
router.get("/founder/automation/runs", (req, res) => {
  try {
    const { status, workflowId, limit } = req.query;
    const r = _fae()?.listRuns?.({ status, workflowId, limit: limit ? parseInt(limit) : 20 });
    res.json({ ok: true, runs: r || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Production Bible ──────────────────────────────────────────────────────────

// Build / rebuild the production bible
router.post("/bible/build", (req, res) => {
  try {
    const r = _pbe()?.buildBible?.();
    res.json(r ? { ok: true, summary: r.bible?.summary } : { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Get full bible
router.get("/bible", (req, res) => {
  try {
    const r = _pbe()?.getBible?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List bible workflows with filters
router.get("/bible/workflows", (req, res) => {
  try {
    const { category, automationLevel, currentState, limit } = req.query;
    const r = _pbe()?.listWorkflows?.({ category, automationLevel, currentState, limit: limit ? parseInt(limit) : 50 });
    res.json({ ok: true, workflows: r || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Get single bible workflow
router.get("/bible/workflows/:id", (req, res) => {
  try {
    const w = _pbe()?.getWorkflow?.(req.params.id);
    if (!w) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, workflow: w });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Execute a bible workflow
router.post("/bible/workflows/:id/execute", (req, res) => {
  try {
    const { triggeredBy = "founder" } = req.body || {};
    const r = _pbe()?.executeWorkflow?.(req.params.id, { triggeredBy });
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Bible dashboard
router.get("/bible/dashboard", (req, res) => {
  try {
    const r = _pbe()?.getDashboard?.();
    res.json(r || { ok: false, error: "service unavailable" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Master founder status ─────────────────────────────────────────────────────
router.get("/founder/status", (req, res) => {
  try {
    const reg  = _fwr()?.getRegistry?.();
    const rep  = _fae()?.getReport?.();
    const bdash = _pbe()?.getDashboard?.();
    res.json({
      ok: true,
      founderWorkRegistry:  reg?.summary || {},
      automationReport:     rep?.summary || {},
      productionBible:      bdash || {},
      finalObjective: "Founder operates Ooplix by giving objectives and approvals only.",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
