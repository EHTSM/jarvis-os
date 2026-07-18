"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 4: Enterprise Policy Engine
 * Prefix: /enterprise/policy/:orgId/* (org policy CRUD, requireAuth + manage_policy)
 *         /enterprise/mfa/*           (per-account MFA enrollment, requireAuth only —
 *                                      enrolling/disabling your OWN MFA needs no org
 *                                      permission, just to be who you say you are)
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _policy = () => _try(() => require("../services/policyService.cjs"));
const _org = () => _try(() => require("../services/organizationService.cjs"));

function _requirePolicyPermission(req, res) {
  if (!_org()?.hasPermission?.(req.params.orgId, req.user.sub, "manage_policy")) {
    res.status(403).json({ ok: false, error: "Forbidden — requires permission: manage_policy" });
    return false;
  }
  return true;
}

router.get("/enterprise/policy/:orgId", requireAuth, (req, res) => {
  if (!_requirePolicyPermission(req, res)) return;
  res.json({ ok: true, policy: _policy().getPolicy(req.params.orgId) });
});

router.put("/enterprise/policy/:orgId", requireAuth, (req, res) => {
  try {
    res.json(_policy().setPolicy(req.params.orgId, req.body || {}, req.user.sub));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ── MFA enrollment (per-account, not org-scoped) ────────────────────────────

router.post("/enterprise/mfa/enroll", requireAuth, (req, res) => {
  try {
    res.json({ ok: true, ..._policy().enrollMfa(req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/enterprise/mfa/verify", requireAuth, (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: "token required" });
  try {
    res.json(_policy().verifyMfaEnrollment(req.user.sub, token));
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.get("/enterprise/mfa/status", requireAuth, (req, res) => {
  res.json({ ok: true, enrolled: _policy().isMfaEnrolled(req.user.sub) });
});

router.delete("/enterprise/mfa", requireAuth, (req, res) => {
  try {
    res.json(_policy().disableMfa(req.user.sub, req.user.sub));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
