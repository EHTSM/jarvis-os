"use strict";
/**
 * closedBeta routes — Production Mission 6 Extended
 * All routes at /cbeta/* require auth.
 * 14 FIX REQUIRED items from 11-area audit — all implemented.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/closedBeta.cjs");

router.use("/cbeta", requireAuth);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── FIX A1 — Invite Revocation ───────────────────────────────────────────────

router.get("/cbeta/invites", (req, res) => {
  try {
    const { status } = req.query;
    _ok(res, svc.listInviteCodes(status ? { status } : {}));
  } catch (e) { _err(res, e); }
});

router.post("/cbeta/invites/:code/revoke", (req, res) => {
  try {
    const { code } = req.params;
    const { reason } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, error: "code required" });
    _ok(res, svc.revokeInviteCode(code, reason));
  } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});

// ── FIX A2 — First AI Workflow Tracking ─────────────────────────────────────

router.get("/cbeta/ai-workflows", (req, res) => {
  try { _ok(res, svc.getFirstAIWorkflowStats()); } catch (e) { _err(res, e); }
});

router.post("/cbeta/ai-workflows/record", (req, res) => {
  try {
    const { accountId, workflowType } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id) return res.status(400).json({ ok: false, error: "accountId required" });
    if (!workflowType) return res.status(400).json({ ok: false, error: "workflowType required" });
    _ok(res, svc.recordFirstAIWorkflow(id, workflowType));
  } catch (e) { _err(res, e, e.message?.includes("Unknown workflow") ? 400 : 500); }
});

// ── FIX B1 — Org Deletion Safeguards ────────────────────────────────────────

router.get("/cbeta/orgs/:orgId/deletion-check", (req, res) => {
  try { _ok(res, svc.checkOrgDeletionSafeguards(req.params.orgId)); } catch (e) { _err(res, e); }
});

router.delete("/cbeta/orgs/:orgId", (req, res) => {
  try {
    _ok(res, svc.safeDeleteOrg(req.params.orgId, req.user?.sub));
  } catch (e) { _err(res, e, e.status || 500); }
});

// ── FIX E1 — DAU / WAU Aggregation ──────────────────────────────────────────

router.get("/cbeta/metrics/active-users", (req, res) => {
  try { _ok(res, svc.getActiveUserMetrics()); } catch (e) { _err(res, e); }
});

router.post("/cbeta/metrics/activity", (req, res) => {
  try {
    const { accountId, activityType } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id) return res.status(400).json({ ok: false, error: "accountId required" });
    svc.recordActivity(id, activityType || "session");
    _ok(res, { recorded: true });
  } catch (e) { _err(res, e); }
});

// ── FIX E2 — Connector Usage Tracking ───────────────────────────────────────

router.get("/cbeta/connectors/usage", (req, res) => {
  try { _ok(res, svc.getConnectorUsageReport()); } catch (e) { _err(res, e); }
});

router.post("/cbeta/connectors/usage/record", (req, res) => {
  try {
    const { connectorId, accountId, error: hasError, latencyMs } = req.body || {};
    if (!connectorId) return res.status(400).json({ ok: false, error: "connectorId required" });
    svc.recordConnectorUsage(connectorId, accountId || req.user?.sub, { error: !!hasError, latencyMs });
    _ok(res, { recorded: true });
  } catch (e) { _err(res, e); }
});

// ── FIX F1+F2 — Org/Workspace Limits & Quotas ───────────────────────────────

router.get("/cbeta/quotas/:accountId", (req, res) => {
  try { _ok(res, svc.getQuotaStatus(req.params.accountId)); } catch (e) { _err(res, e); }
});

router.get("/cbeta/quotas/me/orgs", (req, res) => {
  try {
    const id = req.user?.sub;
    if (!id) return res.status(401).json({ ok: false, error: "Unauthorized" });
    _ok(res, svc.checkOrgLimit(id));
  } catch (e) { _err(res, e); }
});

router.get("/cbeta/quotas/me/workspaces", (req, res) => {
  try {
    const id = req.user?.sub;
    if (!id) return res.status(401).json({ ok: false, error: "Unauthorized" });
    _ok(res, svc.checkWorkspaceLimit(id));
  } catch (e) { _err(res, e); }
});

// ── FIX G1 — Multi-User Beta Scenario ───────────────────────────────────────

router.get("/cbeta/scenarios/last", (req, res) => {
  try {
    const last = svc.getLastBetaScenario();
    if (!last) return res.status(404).json({ ok: false, error: "No scenario run yet. POST /cbeta/scenarios/run" });
    _ok(res, last);
  } catch (e) { _err(res, e); }
});

router.post("/cbeta/scenarios/run", (req, res) => {
  try { _ok(res, svc.runBetaScenario()); } catch (e) { _err(res, e); }
});

// ── FIX H1 — Billing Downgrade ───────────────────────────────────────────────

router.post("/cbeta/billing/downgrade", (req, res) => {
  try {
    const { accountId, targetPlan } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id)         return res.status(400).json({ ok: false, error: "accountId required" });
    if (!targetPlan) return res.status(400).json({ ok: false, error: "targetPlan required" });
    _ok(res, svc.downgradePlan(id, targetPlan));
  } catch (e) { _err(res, e, e.message?.includes("Cannot downgrade") ? 400 : 500); }
});

// ── FIX H2 — Payment Failures + Retry ───────────────────────────────────────

router.post("/cbeta/billing/payment-failure", (req, res) => {
  try {
    const { accountId, amount, currency, reason, provider } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id) return res.status(400).json({ ok: false, error: "accountId required" });
    _ok(res, svc.recordPaymentFailure(id, { amount, currency, reason, provider }));
  } catch (e) { _err(res, e); }
});

router.get("/cbeta/billing/retry-queue", (req, res) => {
  try { _ok(res, svc.getRetryQueue()); } catch (e) { _err(res, e); }
});

router.post("/cbeta/billing/process-retries", (req, res) => {
  try { _ok(res, svc.processRetryQueue()); } catch (e) { _err(res, e); }
});

// ── FIX H3 — Invoices ────────────────────────────────────────────────────────

router.get("/cbeta/billing/invoices", (req, res) => {
  try {
    const { accountId } = req.query;
    _ok(res, { invoices: svc.listInvoices(accountId || null) });
  } catch (e) { _err(res, e); }
});

router.post("/cbeta/billing/invoices", (req, res) => {
  try {
    const { accountId, plan, amountINR, period, dueAt } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id) return res.status(400).json({ ok: false, error: "accountId required" });
    _ok(res, svc.createInvoice(id, { plan, amountINR, period, dueAt }));
  } catch (e) { _err(res, e); }
});

router.post("/cbeta/billing/invoices/:invoiceId/paid", (req, res) => {
  try {
    const { razorpayId } = req.body || {};
    _ok(res, svc.markInvoicePaid(req.params.invoiceId, razorpayId));
  } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});

// ── FIX H3 — Credits ─────────────────────────────────────────────────────────

router.get("/cbeta/billing/credits/:accountId", (req, res) => {
  try { _ok(res, svc.getCredit(req.params.accountId)); } catch (e) { _err(res, e); }
});

router.post("/cbeta/billing/credits", (req, res) => {
  try {
    const { accountId, amountINR, reason } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id)                               return res.status(400).json({ ok: false, error: "accountId required" });
    if (typeof amountINR !== "number")     return res.status(400).json({ ok: false, error: "amountINR (number) required" });
    _ok(res, svc.addCredit(id, amountINR, reason));
  } catch (e) { _err(res, e, e.message?.includes("positive") ? 400 : 500); }
});

// ── FIX H3 — Coupons ─────────────────────────────────────────────────────────

router.get("/cbeta/billing/coupons", (req, res) => {
  try { _ok(res, { coupons: svc.listCoupons() }); } catch (e) { _err(res, e); }
});

router.post("/cbeta/billing/coupons", (req, res) => {
  try {
    const opts = req.body || {};
    if (!opts.code) return res.status(400).json({ ok: false, error: "code required" });
    _ok(res, svc.createCoupon(opts));
  } catch (e) { _err(res, e, e.message?.includes("already exists") || e.message?.includes("required") ? 400 : 500); }
});

router.post("/cbeta/billing/coupons/validate", (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, error: "code required" });
    _ok(res, svc.validateCoupon(code));
  } catch (e) { _err(res, e); }
});

router.post("/cbeta/billing/coupons/apply", (req, res) => {
  try {
    const { code, accountId, baseAmountINR } = req.body || {};
    if (!code)        return res.status(400).json({ ok: false, error: "code required" });
    if (!baseAmountINR) return res.status(400).json({ ok: false, error: "baseAmountINR required" });
    const id = accountId || req.user?.sub;
    _ok(res, svc.applyCoupon(code, id, baseAmountINR));
  } catch (e) { _err(res, e, e.message?.includes("not found") || e.message?.includes("expired") || e.message?.includes("maximum") || e.message?.includes("longer active") ? 400 : 500); }
});

// ── FIX I1 — Unified Ops Dashboard ──────────────────────────────────────────

router.get("/cbeta/ops/dashboard", (req, res) => {
  try { _ok(res, svc.getUnifiedOpsDashboard()); } catch (e) { _err(res, e); }
});

// ── FIX J1 — End-of-Day Summary ─────────────────────────────────────────────

router.get("/cbeta/eod", (req, res) => {
  try { _ok(res, svc.generateEODSummary({ accountId: req.user?.sub })); } catch (e) { _err(res, e); }
});

router.post("/cbeta/eod/generate", (req, res) => {
  try { _ok(res, svc.generateEODSummary({ accountId: req.user?.sub, ...req.body })); } catch (e) { _err(res, e); }
});

// ── FIX K1 — Launch Readiness Report ────────────────────────────────────────

router.get("/cbeta/launch-readiness", (req, res) => {
  try {
    const r = svc.getLaunchReadinessReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet. POST /cbeta/launch-readiness/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

router.post("/cbeta/launch-readiness/generate", (req, res) => {
  try { _ok(res, svc.generateLaunchReadinessReport()); } catch (e) { _err(res, e); }
});

// ── Metadata ─────────────────────────────────────────────────────────────────

router.get("/cbeta/metadata", (req, res) => {
  _ok(res, {
    betaOrgLimit:       svc.BETA_ORG_LIMIT,
    betaWorkspaceLimit: svc.BETA_WORKSPACE_LIMIT,
    betaScenarioSpec:   svc.BETA_SCENARIO_SPEC,
    aiWorkflowTypes:    svc.AI_WORKFLOW_TYPES,
    planHierarchy:      svc.PLAN_HIERARCHY,
    topIssues:          svc.TOP_ISSUES,
    topRisks:           svc.TOP_RISKS,
    topPainPoints:      svc.TOP_PAIN_POINTS,
  });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

router.post("/cbeta/reset", (req, res) => {
  try { _ok(res, svc.resetClosedBetaState()); } catch (e) { _err(res, e); }
});

module.exports = router;
