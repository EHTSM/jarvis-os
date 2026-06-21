"use strict";
/**
 * Production Wiring Sprint 1 — routes
 * Exposes audit endpoints for all 6 integrations.
 * Routes: /wiring/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/productionWiring.cjs");

function _ok(res, data) { res.json({ ok: true, ...data }); }
function _err(res, e, code = 500) { res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// ── Full audit (all 6 integrations) ─────────────────────────────────────────
// POST — triggers a fresh audit + test requests; may take 10-15s
router.post("/wiring/audit", requireAuth, async (req, res) => {
  try {
    const report = await svc.runFullAudit();
    _ok(res, { report });
  } catch (e) { _err(res, e); }
});

// GET — returns the last cached audit report (fast, no live calls)
router.get("/wiring/report", requireAuth, async (req, res) => {
  try {
    const report = svc.getLastReport();
    if (!report) return res.status(404).json({ ok: false, error: "No audit run yet — POST /wiring/audit first" });
    _ok(res, { report });
  } catch (e) { _err(res, e); }
});

// GET — report history (summaries only, no detailed checks)
router.get("/wiring/history", requireAuth, async (req, res) => {
  try { _ok(res, { history: svc.getReportHistory() }); }
  catch (e) { _err(res, e); }
});

// ── Single-integration re-audit ──────────────────────────────────────────────
// POST /wiring/audit/:integration — re-run one integration only
router.post("/wiring/audit/:integration", requireAuth, async (req, res) => {
  try {
    const result = await svc.auditSingle(req.params.integration);
    _ok(res, { result });
  } catch (e) { _err(res, e.message?.includes("Unknown") ? 400 : 500, e); }
});

// ── Integration-specific status ──────────────────────────────────────────────
router.get("/wiring/ai", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditAIProviders() }); } catch (e) { _err(res, e); }
});

router.get("/wiring/payments", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditPayments() }); } catch (e) { _err(res, e); }
});

router.get("/wiring/email", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditEmail() }); } catch (e) { _err(res, e); }
});

router.get("/wiring/oauth", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditOAuth() }); } catch (e) { _err(res, e); }
});

router.get("/wiring/whatsapp", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditWhatsApp() }); } catch (e) { _err(res, e); }
});

router.get("/wiring/browser", requireAuth, async (req, res) => {
  try { _ok(res, { result: await svc.auditBrowserAutomation() }); } catch (e) { _err(res, e); }
});

// ── Benchmark ────────────────────────────────────────────────────────────────
router.get("/wiring/benchmark", requireAuth, async (req, res) => {
  try { _ok(res, await svc.runBenchmark()); } catch (e) { _err(res, e); }
});

module.exports = router;
