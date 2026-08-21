"use strict";
/**
 * closedBeta routes — Production Mission 6 Extended
 * All routes at /cbeta/* require auth.
 * 14 FIX REQUIRED items from 11-area audit — all implemented.
 */
const router = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const svc = require("../services/closedBeta.cjs");
// Module Loader & Dynamic Module Resolution Security Sweep (2026-08-21):
// unguarded hardcoded-path require — see odi.js for the live-reproduced
// finding this fix pattern closes; reused here verbatim.
const _try = fn => { try { return fn(); } catch { return null; } };
const _orgSvc = () => _try(() => require("../services/organizationService.cjs"));

router.use("/cbeta", requireAuth);

// C.10 audit (2026-08-14/15): the billing sub-routes below (FIX H1/H2/H3 —
// downgrade, payment-failure, invoices, credits, coupons/apply) accept an
// arbitrary client-supplied accountId with no ownership check at all,
// gated only by the barrel-level requireAuth above — the exact same bug
// class this file's own prior "Security Hardening (Zero-Trust Competitor
// Remediation, Phase 4)" pass already fixed for GET /cbeta/orgs/:orgId/
// deletion-check (see comment below). That pass did not extend to these
// routes. Reproduced live: an authenticated account with no relationship to
// another real account read that account's real credit balance (200, not
// 403/404) AND successfully wrote a forged ₹99,999 credit onto it — a
// persisted, real financial-record corruption, not just a read leak.
// These are internal beta-ops billing-management tools (accepting a target
// accountId is intentional for an operator managing another user's
// billing) — the fix is restricting WHO may specify someone else's
// accountId, matching the exact operatorOnly pattern already used for the
// equivalent platform-financial-data class in revenueOS.js.
router.use(
  ["/cbeta/billing/downgrade", "/cbeta/billing/payment-failure", "/cbeta/billing/retry-queue",
   "/cbeta/billing/process-retries", "/cbeta/billing/invoices", "/cbeta/billing/credits",
   "/cbeta/billing/coupons/apply"],
  operatorOnly
);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// Security Hardening (Zero-Trust Competitor Remediation, Phase 4): found
// during systemic tenant-isolation verification, same bug class as the
// platformOrg/workforce IDORs fixed earlier in this pass —
// GET /cbeta/orgs/:orgId/deletion-check had no ownership/membership check,
// gated only by the barrel-level requireAuth above, disclosing another
// org's member count and open-mission count to any authenticated user by
// ID guessing. The DELETE route on the same :orgId param is NOT affected —
// it delegates through svc.safeDeleteOrg -> organizationService.deleteOrg
// -> archiveOrg, which already calls _assertPermission(orgId, accountId,
// "delete_org") at the deepest layer; verified real and unchanged.
function _requireOrgMemberOrAdmin(req, res, next) {
  const orgId = req.params.orgId;
  const accountId = req.user?.sub;
  const svc2 = _orgSvc();
  const role = accountId ? svc2.getMemberRole(orgId, accountId) : null;
  if (role || (accountId && svc2.isEnterpriseAdmin(accountId))) return next();
  return res.status(404).json({ ok: false, error: "Organization not found" });
}

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

router.get("/cbeta/orgs/:orgId/deletion-check", _requireOrgMemberOrAdmin, (req, res) => {
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
