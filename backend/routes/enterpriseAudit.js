"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 3: Enterprise Audit
 * Prefix: /enterprise/audit/:orgId/*
 *
 * Every route requires an authenticated session with view_audit_log
 * permission on the org (added to organizationService's ACTIONS in
 * Module 1) — org_owner and org_admin only, since audit visibility is
 * itself a sensitive capability (it reveals who did what, including
 * other members' login/permission history).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _audit = () => _try(() => require("../services/auditService.cjs"));
const _org = () => _try(() => require("../services/organizationService.cjs"));
const _policy = () => _try(() => require("../services/policyService.cjs"));

function _requireAuditPermission(req, res) {
  if (!_org()?.hasPermission?.(req.params.orgId, req.user.sub, "view_audit_log")) {
    res.status(403).json({ ok: false, error: "Forbidden — requires permission: view_audit_log" });
    return false;
  }
  // B25-01/GG-1 closure: real org membership confirmed above — now enforce
  // the org's own IP allowlist, if it has configured one.
  try { _policy()?.assertIpAllowed?.(req.params.orgId, req); }
  catch (e) { res.status(e.status || 403).json({ ok: false, error: e.message }); return false; }
  return true;
}

router.get("/enterprise/audit/:orgId/search", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { type, typePrefix, actorId, accountId, since, until, limit } = req.query;
  res.json({ ok: true, ..._audit().searchAuditLog({ orgId: req.params.orgId, type, typePrefix, actorId, accountId, since, until, limit: limit ? +limit : undefined }) });
});

router.get("/enterprise/audit/:orgId/login-history", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { since, until, limit } = req.query;
  res.json({ ok: true, ..._audit().getLoginHistory(req.params.orgId, { since, until, limit: limit ? +limit : undefined }) });
});

router.get("/enterprise/audit/:orgId/sso-login-history", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { since, until, limit } = req.query;
  res.json({ ok: true, ..._audit().getSsoLoginHistory(req.params.orgId, { since, until, limit: limit ? +limit : undefined }) });
});

router.get("/enterprise/audit/:orgId/permission-history", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { since, until, limit } = req.query;
  res.json({ ok: true, ..._audit().getPermissionHistory(req.params.orgId, { since, until, limit: limit ? +limit : undefined }) });
});

router.get("/enterprise/audit/:orgId/scim-history", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { since, until, limit } = req.query;
  res.json({ ok: true, ..._audit().getScimHistory(req.params.orgId, { since, until, limit: limit ? +limit : undefined }) });
});

router.get("/enterprise/audit/:orgId/ai-history", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { since, limit } = req.query;
  res.json({ ok: true, ..._audit().getAiActionHistory(req.params.orgId, { since, limit: limit ? +limit : undefined }) });
});

router.get("/enterprise/audit/:orgId/billing-history", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  try {
    res.json({ ok: true, ..._audit().getBillingHistory(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/enterprise/audit/:orgId/export", requireAuth, (req, res) => {
  if (!_requireAuditPermission(req, res)) return;
  const { type, typePrefix, actorId, accountId, since, until, limit, format } = req.query;
  const result = _audit().exportAuditLog(req.params.orgId, { type, typePrefix, actorId, accountId, since, until, limit: limit ? +limit : undefined, format });
  const contentType = result.format === "csv" ? "text/csv" : "application/x-ndjson";
  const ext = result.format === "csv" ? "csv" : "ndjson";
  res.type(contentType);
  res.setHeader("Content-Disposition", `attachment; filename="audit-${req.params.orgId}-${Date.now()}.${ext}"`);
  res.send(result.body);
});

module.exports = router;
