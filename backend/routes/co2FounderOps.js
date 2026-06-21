"use strict";
/**
 * CO2 Production Deployment + Founder Dogfooding Routes
 * Prefix: /co2/*
 * All routes require auth.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getDeploymentState, updateDeployItem,
  getAIProviderConfig, updateAIProvider,
  getBillingConfig, updateBillingItem,
  getEmailConfig, updateEmailItem,
  logDogfoodSession, getDogfoodDashboard,
  runQA, getQARuns,
  reportBug, updateBug, getBugRegistry,
  recordPerfMeasurement, getPerfDashboard,
  generateReadinessReport, getReadinessReport,
  generateAlphaReport, getAlphaReport,
  runBenchmark,
  DEPLOY_CHECKLIST, AI_PROVIDERS, BILLING_ITEMS, EMAIL_ITEMS,
  DOGFOOD_MODULES, ESCAPE_CATEGORIES, QA_MODULES, BUG_SEVERITIES, BUG_STATUSES,
  PERF_BENCHMARKS, ALPHA_CRITERIA,
} = require("../services/co2FounderOps.cjs");

const _ok  = (res, data)          => res.json({ ok: true, ...data });
const _err = (res, e, code = 500) => res.status(code).json({ ok: false, error: e?.message || String(e) });

// ── M1: Deploy ───────────────────────────────────────────────────────────────
router.get("/co2/deploy",                requireAuth, (req, res) => {
  try { _ok(res, getDeploymentState()); } catch (e) { _err(res, e); }
});
router.post("/co2/deploy/:itemId/done",  requireAuth, (req, res) => {
  try { _ok(res, updateDeployItem(req.params.itemId, true,  (req.body || {}).note || "")); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.post("/co2/deploy/:itemId/undone",requireAuth, (req, res) => {
  try { _ok(res, updateDeployItem(req.params.itemId, false, (req.body || {}).note || "")); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.get("/co2/deploy/checklist",      requireAuth, (req, res) => _ok(res, { items: DEPLOY_CHECKLIST }));

// ── M2: AI Providers ─────────────────────────────────────────────────────────
router.get("/co2/ai-providers",          requireAuth, (req, res) => {
  try { _ok(res, getAIProviderConfig()); } catch (e) { _err(res, e); }
});
router.post("/co2/ai-providers/:id",     requireAuth, (req, res) => {
  try { _ok(res, updateAIProvider(req.params.id, req.body || {})); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.get("/co2/ai-providers/catalog",  requireAuth, (req, res) => _ok(res, { providers: AI_PROVIDERS }));

// ── M3: Billing ───────────────────────────────────────────────────────────────
router.get("/co2/billing",                    requireAuth, (req, res) => {
  try { _ok(res, getBillingConfig()); } catch (e) { _err(res, e); }
});
router.post("/co2/billing/:itemId/done",      requireAuth, (req, res) => {
  try { _ok(res, updateBillingItem(req.params.itemId, true,  (req.body || {}).note || "")); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.post("/co2/billing/:itemId/undone",    requireAuth, (req, res) => {
  try { _ok(res, updateBillingItem(req.params.itemId, false, (req.body || {}).note || "")); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.get("/co2/billing/items",              requireAuth, (req, res) => _ok(res, { items: BILLING_ITEMS }));

// ── M4: Email ─────────────────────────────────────────────────────────────────
router.get("/co2/email",                  requireAuth, (req, res) => {
  try { _ok(res, getEmailConfig()); } catch (e) { _err(res, e); }
});
router.post("/co2/email/:itemId/done",    requireAuth, (req, res) => {
  try { _ok(res, updateEmailItem(req.params.itemId, true,  (req.body || {}).note || "")); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.post("/co2/email/:itemId/undone",  requireAuth, (req, res) => {
  try { _ok(res, updateEmailItem(req.params.itemId, false, (req.body || {}).note || "")); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.get("/co2/email/items",            requireAuth, (req, res) => _ok(res, { items: EMAIL_ITEMS }));

// ── M5: Dogfooding ────────────────────────────────────────────────────────────
router.get("/co2/dogfood",               requireAuth, (req, res) => {
  try { _ok(res, getDogfoodDashboard()); } catch (e) { _err(res, e); }
});
router.post("/co2/dogfood/session",      requireAuth, (req, res) => {
  try { _ok(res, logDogfoodSession(req.body || {})); } catch (e) { _err(res, e); }
});
router.get("/co2/dogfood/modules",       requireAuth, (req, res) => {
  _ok(res, { modules: DOGFOOD_MODULES, escapeCategories: ESCAPE_CATEGORIES });
});

// ── M6: Product QA ────────────────────────────────────────────────────────────
router.get("/co2/qa",              requireAuth, (req, res) => {
  try { _ok(res, { runs: getQARuns(), modules: QA_MODULES }); } catch (e) { _err(res, e); }
});
router.post("/co2/qa/run",         requireAuth, (req, res) => {
  try { _ok(res, runQA(req.body || {})); } catch (e) { _err(res, e); }
});
router.get("/co2/qa/modules",      requireAuth, (req, res) => _ok(res, { modules: QA_MODULES }));

// ── M7: Bug Registry ──────────────────────────────────────────────────────────
router.get("/co2/bugs",            requireAuth, (req, res) => {
  try { _ok(res, getBugRegistry()); } catch (e) { _err(res, e); }
});
router.post("/co2/bugs",           requireAuth, (req, res) => {
  try { _ok(res, reportBug(req.body || {})); } catch (e) { _err(res, e); }
});
router.patch("/co2/bugs/:id",      requireAuth, (req, res) => {
  try { _ok(res, updateBug(req.params.id, req.body || {})); }
  catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.get("/co2/bugs/meta",       requireAuth, (req, res) => {
  _ok(res, { severities: BUG_SEVERITIES, statuses: BUG_STATUSES });
});

// ── M8: Performance ───────────────────────────────────────────────────────────
router.get("/co2/perf",            requireAuth, (req, res) => {
  try { _ok(res, getPerfDashboard()); } catch (e) { _err(res, e); }
});
router.post("/co2/perf/record",    requireAuth, (req, res) => {
  try { _ok(res, recordPerfMeasurement(req.body || {})); } catch (e) { _err(res, e); }
});
router.get("/co2/perf/benchmarks", requireAuth, (req, res) => {
  _ok(res, { benchmarks: PERF_BENCHMARKS });
});

// ── M9: Readiness Report ──────────────────────────────────────────────────────
router.get("/co2/readiness",         requireAuth, (req, res) => {
  try { _ok(res, getReadinessReport() || { message: "No report generated yet. POST to /co2/readiness/generate" }); }
  catch (e) { _err(res, e); }
});
router.post("/co2/readiness/generate", requireAuth, (req, res) => {
  try { _ok(res, generateReadinessReport()); } catch (e) { _err(res, e); }
});

// ── M10: Alpha Report ─────────────────────────────────────────────────────────
router.get("/co2/alpha",             requireAuth, (req, res) => {
  try { _ok(res, getAlphaReport() || { message: "No report generated yet. POST to /co2/alpha/generate" }); }
  catch (e) { _err(res, e); }
});
router.post("/co2/alpha/generate",   requireAuth, (req, res) => {
  try { _ok(res, generateAlphaReport()); } catch (e) { _err(res, e); }
});
router.get("/co2/alpha/criteria",    requireAuth, (req, res) => {
  _ok(res, { criteria: ALPHA_CRITERIA });
});

// ── Executive ─────────────────────────────────────────────────────────────────
router.get("/co2/executive", requireAuth, (req, res) => {
  try {
    const deploy  = getDeploymentState();
    const ai      = getAIProviderConfig();
    const billing = getBillingConfig();
    const email   = getEmailConfig();
    const dogfood = getDogfoodDashboard();
    const bugs    = getBugRegistry();
    const perf    = getPerfDashboard();
    const rr      = getReadinessReport();
    const alpha   = getAlphaReport();

    const scores = [deploy.critScore, ai.score, billing.critScore, email.critScore,
                    dogfood.progressPct, bugs.fixRate];
    const overall = Math.round(scores.reduce((s, v) => s + (v || 0), 0) / scores.length);

    _ok(res, {
      overall,
      deploy:  { score: deploy.critScore,  deployed: deploy.deployed   },
      ai:      { score: ai.score,          active: ai.activeCount      },
      billing: { score: billing.critScore, live: billing.razorpayLive  },
      email:   { score: email.critScore,   ready: email.smtpReady      },
      dogfood: { score: dogfood.progressPct, days: dogfood.activeDays  },
      bugs:    { fixRate: bugs.fixRate, critical: bugs.critical, total: bugs.total },
      perf:    { memoryMB: perf.live.memory.rss },
      readiness: rr ? { overall: rr.overall, grade: rr.grade, readinessLevel: rr.readinessLevel } : null,
      alpha:     alpha ? { score: alpha.weightedScore, readiness: alpha.alphaReadiness } : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) { _err(res, e); }
});

// ── Benchmark ─────────────────────────────────────────────────────────────────
router.get("/co2/benchmark", requireAuth, (req, res) => {
  try { _ok(res, runBenchmark()); } catch (e) { _err(res, e); }
});

module.exports = router;
