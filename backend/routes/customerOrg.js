"use strict";
/**
 * POST-Ω P11 — Autonomous Customer Organization
 * Routes: /customer-org/*
 */

const router = require("express").Router();
const _try   = fn => { try { return fn(); } catch { return null; } };
const _cje   = () => _try(() => require("../services/customerJourneyEngine.cjs"));
const _che   = () => _try(() => require("../services/customerHealthEngine.cjs"));
const _cse   = () => _try(() => require("../services/customerSuccessEngine.cjs"));
const _csup  = () => _try(() => require("../services/customerSupportEngine.cjs"));
const _cae   = () => _try(() => require("../services/customerAutomationEngine.cjs"));
const _cod   = () => _try(() => require("../services/customerOrganizationDashboard.cjs"));

function ok(res, data)     { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { err(res, e.message, 500); }
  };
}

// ── Journey ───────────────────────────────────────────────────────────────────
router.post("/customer-org/journey/sync", wrap(async (req, res) => {
  ok(res, _cje()?.syncJourneys?.());
}));
router.get("/customer-org/journey/stages", wrap(async (req, res) => {
  ok(res, _cje()?.getStageDistribution?.());
}));
router.get("/customer-org/journey/:customerId", wrap(async (req, res) => {
  const j = _cje()?.getJourney?.(req.params.customerId);
  if (!j) return err(res, "journey not found", 404);
  ok(res, { journey: j });
}));
router.post("/customer-org/journey/:customerId/advance", wrap(async (req, res) => {
  ok(res, _cje()?.advanceStage?.(req.params.customerId, req.body.stage));
}));
router.get("/customer-org/journey", wrap(async (req, res) => {
  const { stage, churnRisk, limit } = req.query;
  ok(res, _cje()?.listJourneys?.({ stage, churnRisk, limit: parseInt(limit)||50 }));
}));
router.get("/customer-org/journey/stats", wrap(async (req, res) => {
  ok(res, _cje()?.getStats?.() || {});
}));

// ── Health ────────────────────────────────────────────────────────────────────
router.post("/customer-org/health/score-all", wrap(async (req, res) => {
  ok(res, _che()?.scoreAll?.());
}));
router.post("/customer-org/health/score/:customerId", wrap(async (req, res) => {
  ok(res, _che()?.scoreCustomer?.(req.params.customerId, req.body));
}));
router.get("/customer-org/health/:customerId", wrap(async (req, res) => {
  const h = _che()?.getHealthRecord?.(req.params.customerId);
  if (!h) return err(res, "health record not found", 404);
  ok(res, { health: h });
}));
router.get("/customer-org/health/:customerId/history", wrap(async (req, res) => {
  ok(res, _che()?.getHealthHistory?.(req.params.customerId, parseInt(req.query.limit)||10));
}));
router.get("/customer-org/health/:customerId/trend", wrap(async (req, res) => {
  ok(res, _che()?.getHealthTrend?.(req.params.customerId));
}));
router.get("/customer-org/health", wrap(async (req, res) => {
  const { risk, grade, limit } = req.query;
  ok(res, _che()?.listHealthRecords?.({ risk, grade, limit: parseInt(limit)||50 }));
}));
router.get("/customer-org/health/stats", wrap(async (req, res) => {
  ok(res, _che()?.getStats?.() || {});
}));

// ── Success ───────────────────────────────────────────────────────────────────
router.post("/customer-org/success/plan/:customerId", wrap(async (req, res) => {
  ok(res, _cse()?.generateSuccessPlan?.(req.params.customerId));
}));
router.get("/customer-org/success/plan/:customerId", wrap(async (req, res) => {
  const p = _cse()?.getPlan?.(req.params.customerId);
  if (!p) return err(res, "plan not found", 404);
  ok(res, { plan: p });
}));
router.get("/customer-org/success/plans", wrap(async (req, res) => {
  ok(res, _cse()?.listPlans?.({ stage: req.query.stage, limit: parseInt(req.query.limit)||50 }));
}));
router.post("/customer-org/success/predict/:customerId", wrap(async (req, res) => {
  ok(res, _cse()?.predict?.(req.params.customerId));
}));
router.post("/customer-org/success/outcome/:customerId", wrap(async (req, res) => {
  ok(res, _cse()?.recordOutcome?.(req.params.customerId, req.body));
}));
router.get("/customer-org/success/stats", wrap(async (req, res) => {
  ok(res, _cse()?.getStats?.() || {});
}));

// ── Support ───────────────────────────────────────────────────────────────────
router.post("/customer-org/support/ticket", wrap(async (req, res) => {
  const r = _csup()?.createTicket?.(req.body);
  if (!r?.ok) return err(res, r?.error || "create failed");
  ok(res, r);
}));
router.post("/customer-org/support/ticket/:id/resolve", wrap(async (req, res) => {
  ok(res, _csup()?.resolveTicket?.(req.params.id, req.body));
}));
router.get("/customer-org/support/ticket/:id", wrap(async (req, res) => {
  const t = _csup()?.getTicket?.(req.params.id);
  if (!t) return err(res, "ticket not found", 404);
  ok(res, { ticket: t });
}));
router.get("/customer-org/support/tickets", wrap(async (req, res) => {
  const { customerId, status, severity, limit } = req.query;
  ok(res, _csup()?.listTickets?.({ customerId, status, severity, limit: parseInt(limit)||50 }));
}));
router.post("/customer-org/support/suggest", wrap(async (req, res) => {
  const { issue, customerId } = req.body;
  ok(res, _csup()?.getSuggestedResolution?.(issue, customerId));
}));
router.get("/customer-org/support/stats", wrap(async (req, res) => {
  ok(res, _csup()?.getStats?.() || {});
}));

// ── Automation ────────────────────────────────────────────────────────────────
router.post("/customer-org/automation/trigger", wrap(async (req, res) => {
  const { customerId, type, context, skipExecute } = req.body;
  if (!customerId || !type) return err(res, "customerId and type required");
  const r = await _cae()?.trigger?.(customerId, type, { context, skipExecute });
  if (!r?.ok) return err(res, r?.error || "trigger failed");
  ok(res, r);
}));
router.post("/customer-org/automation/scan", wrap(async (req, res) => {
  ok(res, await _cae()?.runAutomationScan?.({ skipExecute: req.body.skipExecute }));
}));
router.get("/customer-org/automation/:id", wrap(async (req, res) => {
  const a = _cae()?.getAutomation?.(req.params.id);
  if (!a) return err(res, "automation not found", 404);
  ok(res, { automation: a });
}));
router.get("/customer-org/automation", wrap(async (req, res) => {
  const { customerId, type, status, limit } = req.query;
  ok(res, _cae()?.listAutomations?.({ customerId, type, status, limit: parseInt(limit)||50 }));
}));
router.get("/customer-org/automation/stats", wrap(async (req, res) => {
  ok(res, _cae()?.getStats?.() || {});
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/customer-org/dashboard", wrap(async (req, res) => {
  ok(res, _cod()?.getDashboard?.() || { ok: false, error: "dashboard unavailable" });
}));
router.get("/customer-org/dashboard/customer/:customerId", wrap(async (req, res) => {
  ok(res, _cod()?.getCustomerView?.(req.params.customerId));
}));
router.get("/customer-org/dashboard/health", wrap(async (req, res) => {
  ok(res, _cod()?.getCustomerOrganizationHealth?.() || {});
}));

module.exports = router;
