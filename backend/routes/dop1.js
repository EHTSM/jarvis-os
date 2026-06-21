"use strict";
/**
 * DOP-1 — Production Infrastructure Validation Routes
 * Prefix: /dop/*
 * All routes require auth.
 *
 * POST /dop/audit                  — full 10-module audit (all in parallel + stress)
 * POST /dop/audit/:module          — re-run single module
 * GET  /dop/report                 — last full report
 * GET  /dop/report/infrastructure  — infrastructure sub-report
 * GET  /dop/report/deployment      — deployment sub-report
 * GET  /dop/report/security        — security sub-report
 * GET  /dop/report/performance     — performance sub-report
 * GET  /dop/history                — run summary history
 * GET  /dop/benchmark              — benchmark (20 gates)
 * GET  /dop/module/:id             — single module from last report
 * GET  /dop/verdict                — current GO / CONDITIONAL GO / NO GO
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const dop1 = require("../services/dop1InfraValidation.cjs");

function _ok(res, data)          { res.json({ ok: true, ...data }); }
function _err(res, e, code = 500){ res.status(code).json({ ok: false, error: e?.message || String(e) }); }

const VALID_MODULES = ["vps","nginx","ssl","dns","domains","deployment","backup","monitoring","security","stress"];

// POST /dop/audit — full audit
router.post("/dop/audit", requireAuth, async (req, res) => {
  try { _ok(res, { report: await dop1.runFullAudit() }); }
  catch (e) { _err(res, e); }
});

// POST /dop/audit/:module — single module
router.post("/dop/audit/:module", requireAuth, async (req, res) => {
  const mod = req.params.module;
  if (!VALID_MODULES.includes(mod))
    return _err(res, new Error(`Unknown module: ${mod} — use: ${VALID_MODULES.join("|")}`), 400);
  try { _ok(res, await dop1.runModuleAudit(mod)); }
  catch (e) { _err(res, e); }
});

// GET /dop/report — last full report
router.get("/dop/report", requireAuth, async (req, res) => {
  try {
    const report = dop1.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No report yet — POST /dop/audit first" });
    _ok(res, { report });
  } catch (e) { _err(res, e); }
});

// GET /dop/report/infrastructure
router.get("/dop/report/infrastructure", requireAuth, async (req, res) => {
  try {
    const r = dop1.getLastReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet" });
    _ok(res, { report: r.reports?.infrastructure });
  } catch (e) { _err(res, e); }
});

// GET /dop/report/deployment
router.get("/dop/report/deployment", requireAuth, async (req, res) => {
  try {
    const r = dop1.getLastReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet" });
    _ok(res, { report: r.reports?.deployment });
  } catch (e) { _err(res, e); }
});

// GET /dop/report/security
router.get("/dop/report/security", requireAuth, async (req, res) => {
  try {
    const r = dop1.getLastReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet" });
    _ok(res, { report: r.reports?.security });
  } catch (e) { _err(res, e); }
});

// GET /dop/report/performance
router.get("/dop/report/performance", requireAuth, async (req, res) => {
  try {
    const r = dop1.getLastReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet" });
    _ok(res, { report: r.reports?.performance });
  } catch (e) { _err(res, e); }
});

// GET /dop/history — run summary
router.get("/dop/history", requireAuth, async (req, res) => {
  try { _ok(res, { history: dop1.getReportHistory() }); }
  catch (e) { _err(res, e); }
});

// GET /dop/benchmark — 20 benchmark gates
router.get("/dop/benchmark", requireAuth, async (req, res) => {
  try { _ok(res, await dop1.runBenchmark()); }
  catch (e) { _err(res, e); }
});

// GET /dop/module/:id — module detail from last report
router.get("/dop/module/:id", requireAuth, async (req, res) => {
  const mod = req.params.id;
  if (!VALID_MODULES.includes(mod))
    return _err(res, new Error(`Unknown module: ${mod}`), 400);
  try {
    const r = dop1.getLastReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet" });
    _ok(res, { module: r.modules?.[mod === "dns" ? "dns" : mod] });
  } catch (e) { _err(res, e); }
});

// GET /dop/verdict — quick go/no-go
router.get("/dop/verdict", requireAuth, async (req, res) => {
  try {
    const r = dop1.getLastReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet — POST /dop/audit first" });
    _ok(res, {
      verdict:        r.verdict,
      productionScore: r.productionScore,
      criticalFails:  r.criticalFails,
      runAt:          r.runAt,
      moduleScores:   r.summary,
    });
  } catch (e) { _err(res, e); }
});

module.exports = router;
