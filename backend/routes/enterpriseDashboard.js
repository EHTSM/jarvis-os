"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 8: Enterprise Dashboard
 * Prefix: /enterprise/dashboard/:orgId/*
 *
 * SECURITY NOTE: orgMiddleware.cjs's attachOrg only reads orgId from the
 * X-Org-Id header / req.query.orgId / req.body.orgId — never
 * req.params.orgId. Composing attachOrg+requireOrgMember on a router whose
 * routes take orgId as a URL path param gives ZERO real protection: with
 * no header/query/body orgId, attachOrg silently auto-resolves the
 * caller's OWN primary org instead, and requireOrgMember then "passes" by
 * checking membership in that wrong (but real) org — never the one in the
 * URL. (Confirmed live: a non-member could read another org's /overview,
 * /compliance, /ai, /connectors, /analytics with only that bug in place.)
 * Every route below therefore explicitly re-validates req.params.orgId via
 * organizationService.hasPermission — the same real, single source of
 * truth every other permission check in this codebase uses — instead of
 * relying on that middleware pairing at all.
 *
 * Reads use view_members (every real org role, including "viewer") except
 * billing (requires manage_billing internally, via
 * organizationService.getOrgBillingOverview, same as every other billing
 * read route in this codebase) and security/users/devices (org_admin+
 * only, since all three reveal member-level detail a plain member
 * shouldn't see about peers — reusing Module 3's view_audit_log tier).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _dash = () => _try(() => require("../services/enterpriseDashboard.cjs"));
const _org = () => _try(() => require("../services/organizationService.cjs"));
const _policy = () => _try(() => require("../services/policyService.cjs"));

router.use("/enterprise/dashboard", requireAuth);

// B25-01/GG-1 closure: shared so both permission tiers below enforce the
// org's own IP allowlist identically, after real membership is confirmed.
function _checkIpAllowed(req, res) {
  try { _policy()?.assertIpAllowed?.(req.params.orgId, req); return true; }
  catch (e) { res.status(e.status || 403).json({ ok: false, error: e.message }); return false; }
}

function _requireOrgMember(req, res) {
  if (!_org()?.hasPermission?.(req.params.orgId, req.user.sub, "view_members")) {
    res.status(403).json({ ok: false, error: "Forbidden — not a member of this organization" });
    return false;
  }
  return _checkIpAllowed(req, res);
}

function _requireAdminTier(req, res) {
  if (!_org()?.hasPermission?.(req.params.orgId, req.user.sub, "view_audit_log")) {
    res.status(403).json({ ok: false, error: "Forbidden — requires org_owner or org_admin" });
    return false;
  }
  return _checkIpAllowed(req, res);
}

router.get("/enterprise/dashboard/:orgId", (req, res) => {
  if (!_requireOrgMember(req, res)) return;
  res.json(_dash().getFullDashboard(req.params.orgId, req.user.sub));
});

router.get("/enterprise/dashboard/:orgId/overview", (req, res) => {
  if (!_requireOrgMember(req, res)) return;
  res.json(_dash().getOverview(req.params.orgId, req.user.sub));
});

router.get("/enterprise/dashboard/:orgId/compliance", (req, res) => {
  if (!_requireOrgMember(req, res)) return;
  res.json(_dash().getCompliance(req.params.orgId));
});

router.get("/enterprise/dashboard/:orgId/security", (req, res) => {
  if (!_requireAdminTier(req, res)) return;
  res.json(_dash().getSecurity(req.params.orgId));
});

router.get("/enterprise/dashboard/:orgId/users", (req, res) => {
  if (!_requireAdminTier(req, res)) return;
  res.json(_dash().getUsers(req.params.orgId));
});

router.get("/enterprise/dashboard/:orgId/devices", (req, res) => {
  if (!_requireAdminTier(req, res)) return;
  res.json(_dash().getDevices(req.params.orgId));
});

router.get("/enterprise/dashboard/:orgId/ai", (req, res) => {
  if (!_requireOrgMember(req, res)) return;
  res.json(_dash().getAiSummary(req.params.orgId));
});

router.get("/enterprise/dashboard/:orgId/billing", (req, res) => {
  // No separate membership pre-check: getOrgBillingOverview already
  // requires manage_billing internally and getBillingSummary propagates
  // that as { ok:false, error, status } rather than throwing uncaught.
  //
  // Phase B.14: that propagated `status` was computed but never applied, so a
  // denied request returned **HTTP 200** carrying { ok:false, status:403 }.
  // Reproduced 3/3 with a genuine non-member of the target org: HTTP=200,
  // body ok=false status=403. Access itself was correctly denied — no financial
  // data leaked (the body held only the error envelope) — but every sibling
  // route on this dashboard (`overview`, `users`, `analytics`) returns a real
  // 403, so a finance client checking HTTP status would read a permission
  // denial on the billing surface as a successful, empty response.
  //
  // Honour the status the service already returns, using the same
  // res.status(...).json(...) shape _requireOrgMember uses above.
  const result = _dash().getBillingSummary(req.params.orgId, req.user.sub);
  if (result && result.ok === false && Number.isInteger(result.status)) {
    return res.status(result.status).json(result);
  }
  res.json(result);
});

router.get("/enterprise/dashboard/:orgId/connectors", (req, res) => {
  if (!_requireOrgMember(req, res)) return;
  res.json(_dash().getConnectorsSummary(req.params.orgId));
});

router.get("/enterprise/dashboard/:orgId/analytics", (req, res) => {
  if (!_requireOrgMember(req, res)) return;
  res.json(_dash().getAnalytics(req.params.orgId));
});

module.exports = router;
