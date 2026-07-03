"use strict";
/**
 * productionDeployment routes — PM7: Live Production Deployment tracking
 * Routes at /pm7/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/productionDeployment.cjs");

router.use("/pm7", requireAuth);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Deployment report ─────────────────────────────────────────────────────────

router.post("/pm7/report/generate", async (req, res) => {
  try { _ok(res, await svc.generateDeploymentReport(req.body?.overrides)); } catch (e) { _err(res, e); }
});

router.get("/pm7/report", (req, res) => {
  try {
    const r = svc.getDeploymentReport();
    if (!r) return res.status(404).json({ ok: false, error: "No PM7 report. POST /pm7/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

// ── Local readiness check ─────────────────────────────────────────────────────

router.get("/pm7/readiness", (req, res) => {
  try { _ok(res, svc.verifyLocalReadiness()); } catch (e) { _err(res, e); }
});

// ── Health check ──────────────────────────────────────────────────────────────

router.get("/pm7/health", async (req, res) => {
  try { _ok(res, await svc.checkLocalHealth()); } catch (e) { _err(res, e); }
});

// ── Deployment instructions ───────────────────────────────────────────────────

router.get("/pm7/instructions", (req, res) => {
  try { _ok(res, { instructions: svc.getDeploymentInstructions() }); } catch (e) { _err(res, e); }
});

router.get("/pm7/instructions/:task", (req, res) => {
  try {
    const key = `task${req.params.task}`;
    const all = svc.getDeploymentInstructions();
    const instr = all[key] || all[Object.keys(all).find(k => k.includes(req.params.task))];
    if (!instr) return res.status(404).json({ ok: false, error: `No instructions for task ${req.params.task}` });
    _ok(res, instr);
  } catch (e) { _err(res, e); }
});

// ── Task management ───────────────────────────────────────────────────────────

router.get("/pm7/tasks", (req, res) => {
  try { _ok(res, { tasks: svc.TASKS }); } catch (e) { _err(res, e); }
});

router.post("/pm7/tasks/:id/complete", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1 || id > 18) return res.status(400).json({ ok: false, error: "Task id must be 1-18" });
    _ok(res, svc.markTaskComplete(id, req.body?.notes));
  } catch (e) { _err(res, e); }
});

router.post("/pm7/tasks/:id/fail", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1 || id > 18) return res.status(400).json({ ok: false, error: "Task id must be 1-18" });
    _ok(res, svc.markTaskFailed(id, req.body?.error));
  } catch (e) { _err(res, e); }
});

// ── State + admin ─────────────────────────────────────────────────────────────

router.get("/pm7/state", (req, res) => {
  try { _ok(res, svc.getDeployState()); } catch (e) { _err(res, e); }
});

router.post("/pm7/reset", (req, res) => {
  try { _ok(res, svc.resetDeployState()); } catch (e) { _err(res, e); }
});

// ── Metadata ──────────────────────────────────────────────────────────────────

router.get("/pm7/metadata", (req, res) => {
  _ok(res, {
    mission:     "Production Mission 7 — Live Production Deployment",
    version:     svc.DEPLOY_VERSION,
    totalTasks:  svc.TASKS.length,
    phases:      ["Pre-deploy (1-3)", "VPS (4-11)", "Verification (12-17)", "Report (18)"],
    routes: [
      "POST /pm7/report/generate", "GET /pm7/report",
      "GET /pm7/readiness", "GET /pm7/health",
      "GET /pm7/instructions", "GET /pm7/instructions/:task",
      "GET /pm7/tasks", "POST /pm7/tasks/:id/complete", "POST /pm7/tasks/:id/fail",
      "GET /pm7/state", "POST /pm7/reset", "GET /pm7/metadata",
    ],
  });
});

module.exports = router;
