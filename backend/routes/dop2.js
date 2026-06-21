"use strict";
/**
 * DOP-2 Routes — Real Production Deployment
 * All routes require authentication.
 */
const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc             = require("../services/dop2Deployment.cjs");

function _ok(res, data)  { res.json({ ok: true,  ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// POST /dop2/deploy — run full 10-phase deployment validation
router.post("/dop2/deploy", requireAuth, async (req, res) => {
  try { _ok(res, { report: await svc.runFullDeployment() }); }
  catch (e) { _err(res, e); }
});

// POST /dop2/deploy/phase/:id — run a single phase
router.post("/dop2/deploy/phase/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!svc.VALID_PHASES.includes(id)) return _err(res, new Error(`Unknown phase: ${id}`), 400);
  try { _ok(res, { phase: await svc.runPhase(id) }); }
  catch (e) { _err(res, e); }
});

// GET /dop2/report — last full report
router.get("/dop2/report", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet — run POST /dop2/deploy"), 404);
  _ok(res, { report: r });
});

// GET /dop2/report/deployment — deployment sub-report
router.get("/dop2/report/deployment", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet"), 404);
  _ok(res, { report: r.reports?.deployment });
});

// GET /dop2/report/liveurl — live URL sub-report
router.get("/dop2/report/liveurl", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet"), 404);
  _ok(res, { report: r.reports?.liveUrl });
});

// GET /dop2/report/failedchecks — failed checks report
router.get("/dop2/report/failedchecks", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet"), 404);
  _ok(res, { report: r.reports?.failedChecks });
});

// GET /dop2/report/warnings — warnings report
router.get("/dop2/report/warnings", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet"), 404);
  _ok(res, { report: r.reports?.warnings });
});

// GET /dop2/history — run summary history
router.get("/dop2/history", requireAuth, (req, res) => {
  _ok(res, { history: svc.getReportHistory() });
});

// GET /dop2/benchmark — 20-gate deployment benchmark
router.get("/dop2/benchmark", requireAuth, async (req, res) => {
  try { _ok(res, { benchmark: await svc.runBenchmark() }); }
  catch (e) { _err(res, e); }
});

// GET /dop2/phase/:id — phase detail from last report
router.get("/dop2/phase/:id", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet"), 404);
  const { id } = req.params;
  const PHASE_MAP = {
    vps_connection: "vpsConn", dependencies: "deps", repository: "repo",
    environment: "env", nginx: "nginx", ssl: "ssl",
    pm2: "pm2", health_verification: "health", smoke_test: "smoke",
  };
  const key = PHASE_MAP[id] || id;
  const phase = r.phases?.[key];
  if (!phase) return _err(res, new Error(`Phase not found: ${id}`), 404);
  _ok(res, { phase });
});

// GET /dop2/verdict — GO/CONDITIONAL GO/NO GO
router.get("/dop2/verdict", requireAuth, (req, res) => {
  const r = svc.getLastReport();
  if (!r) return _err(res, new Error("No report yet"), 404);
  _ok(res, {
    verdict: r.verdict,
    productionScore: r.productionScore,
    criticalFails:   r.criticalFails,
    totalChecks:     r.totalChecks,
    totalPassing:    r.totalPassing,
    vpsHost:         r.vpsHost,
    baseUrl:         r.baseUrl,
    runAt:           r.runAt,
  });
});

module.exports = router;
