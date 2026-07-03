"use strict";
/**
 * alphaProgram routes — Production Mission 5: Internal Alpha Program
 * All routes at /alpha/* require auth.
 * 7 phase routes + dashboard + report generation.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/alphaProgram.cjs");

router.use("/alpha", requireAuth);

function _ok(res, data)  { res.json({ ok: true,  ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Dashboard ──────────────────────────────────────────────────────────────────
router.get("/alpha/dashboard", (req, res) => {
  try { _ok(res, svc.getAlphaDashboard()); }
  catch (e) { _err(res, e); }
});

// ── Phase A: Founder Experience Audit ─────────────────────────────────────────
router.get("/alpha/experience", (req, res) => {
  try { _ok(res, svc.getExperienceAudit()); }
  catch (e) { _err(res, e); }
});

router.post("/alpha/experience/record", (req, res) => {
  try {
    const { checkpointId, minutes } = req.body || {};
    if (!checkpointId) return res.status(400).json({ ok: false, error: "checkpointId required" });
    if (typeof minutes !== "number") return res.status(400).json({ ok: false, error: "minutes must be a number" });
    _ok(res, svc.recordExperienceTiming(checkpointId, minutes));
  } catch (e) { _err(res, e, e.message.includes("Unknown") ? 400 : 500); }
});

// ── Phase B: Alpha Dataset ─────────────────────────────────────────────────────
router.get("/alpha/dataset", (req, res) => {
  try { _ok(res, svc.getAlphaDataset()); }
  catch (e) { _err(res, e); }
});

router.post("/alpha/dataset/seed", (req, res) => {
  try { _ok(res, svc.seedAlphaDataset()); }
  catch (e) { _err(res, e); }
});

// ── Phase C: Guided Onboarding ─────────────────────────────────────────────────
router.get("/alpha/onboarding", (req, res) => {
  try { _ok(res, svc.getOnboardingValidation()); }
  catch (e) { _err(res, e); }
});

router.post("/alpha/onboarding/record", (req, res) => {
  try {
    const { flowId, status, notes } = req.body || {};
    if (!flowId)  return res.status(400).json({ ok: false, error: "flowId required" });
    if (!status)  return res.status(400).json({ ok: false, error: "status required" });
    _ok(res, svc.recordOnboardingResult(flowId, status, notes));
  } catch (e) { _err(res, e, e.message.includes("Unknown") ? 400 : 500); }
});

// ── Phase D: Daily Workflow Validation ────────────────────────────────────────
router.get("/alpha/workflows", (req, res) => {
  try { _ok(res, svc.getDailyWorkflowValidation()); }
  catch (e) { _err(res, e); }
});

router.post("/alpha/workflows/record", (req, res) => {
  try {
    const { workflowId, status, durationMs, error } = req.body || {};
    if (!workflowId) return res.status(400).json({ ok: false, error: "workflowId required" });
    if (!status)     return res.status(400).json({ ok: false, error: "status required" });
    _ok(res, svc.recordWorkflowRun(workflowId, status, { durationMs, error }));
  } catch (e) { _err(res, e, e.message.includes("Unknown") ? 400 : 500); }
});

// ── Phase E: UX Audit ──────────────────────────────────────────────────────────
router.get("/alpha/ux", (req, res) => {
  try { _ok(res, svc.getUXAudit()); }
  catch (e) { _err(res, e); }
});

router.post("/alpha/ux/record", (req, res) => {
  try {
    const { checkId, status, notes } = req.body || {};
    if (!checkId) return res.status(400).json({ ok: false, error: "checkId required" });
    if (!status)  return res.status(400).json({ ok: false, error: "status required" });
    _ok(res, svc.recordUXResult(checkId, status, notes));
  } catch (e) { _err(res, e, e.message.includes("Unknown") ? 400 : 500); }
});

// ── Phase F: Support Readiness ────────────────────────────────────────────────
router.get("/alpha/support", (req, res) => {
  try { _ok(res, svc.getSupportReadiness()); }
  catch (e) { _err(res, e); }
});

router.post("/alpha/support/record", (req, res) => {
  try {
    const { checkId, status, details } = req.body || {};
    if (!checkId) return res.status(400).json({ ok: false, error: "checkId required" });
    if (!status)  return res.status(400).json({ ok: false, error: "status required" });
    _ok(res, svc.recordSupportResult(checkId, status, details));
  } catch (e) { _err(res, e, e.message.includes("Unknown") ? 400 : 500); }
});

// ── Phase G: Alpha Verification ────────────────────────────────────────────────
router.get("/alpha/report", (req, res) => {
  try {
    const r = svc.getAlphaVerificationReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report generated yet. POST /alpha/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

router.post("/alpha/report/generate", (req, res) => {
  try { _ok(res, svc.generateAlphaVerificationReport()); }
  catch (e) { _err(res, e); }
});

// ── Metadata endpoints ─────────────────────────────────────────────────────────
router.get("/alpha/checkpoints", (req, res) => {
  _ok(res, { experienceCheckpoints: svc.EXPERIENCE_CHECKPOINTS,
             onboardingFlows: svc.ONBOARDING_FLOWS,
             dailyWorkflows: svc.DAILY_WORKFLOWS,
             uxDimensions: svc.UX_DIMENSIONS,
             supportChecklist: svc.SUPPORT_CHECKLIST });
});

// ── Admin ──────────────────────────────────────────────────────────────────────
router.post("/alpha/reset", (req, res) => {
  try { _ok(res, svc.resetAlphaState()); }
  catch (e) { _err(res, e); }
});

module.exports = router;
