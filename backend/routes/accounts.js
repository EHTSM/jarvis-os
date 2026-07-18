"use strict";
/**
 * Account routes — registration, profile, account management.
 *
 * Public SaaS: registration is open self-serve (see betaReadiness.isOpenSignup).
 * An invite code is still accepted and validated if supplied (keeps existing
 * co3 invite-code links/tracking working), but is no longer required. Set
 * OPEN_SIGNUP=false in .env to fall back to the closed-beta invite-code +
 * 50-user cap gate. Email verification is sent on successful registration.
 */

const router   = require("express").Router();
const accounts = require("../services/accountService");
const billing  = require("../services/billingService");
const auditLog = require("../utils/auditLog.cjs");
const logger   = require("../utils/logger");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

// Lazy-load betaReadiness to avoid circular-require at startup
const _beta = () => { try { return require("../services/betaReadiness.cjs"); } catch { return null; } };
const _org  = () => { try { return require("../services/organizationService.cjs"); } catch { return null; } };
const _ws   = () => { try { return require("../services/workspaceService.cjs"); } catch { return null; } };

// Every new customer needs a real organization + workspace to land in — signup
// previously created only the account + trial billing record, leaving the
// entire org/workspace/RBAC layer (built in prior missions) disconnected from
// new users. orgName is optional (the onboarding wizard collects business
// *type*, not a company name); falls back to "<name>'s Organization" or the
// email's local part. Both are non-fatal: a signup should never fail just
// because org/workspace provisioning hit an error — the account already
// exists and the user can create these manually from the app.
//
// organizationService.createOrg rejects duplicate slugs (409) — a real
// collision case, since "<name>'s Organization" is common for shared first
// names (e.g. two different "Priya"s signing up). On a 409 specifically,
// retry once with the account id appended so the customer still gets an org
// rather than silently landing with none.
function _provisionOrgAndWorkspace(account, orgName) {
  const displayName = (orgName || "").trim() || (account.name ? `${account.name}'s Organization` : `${account.email.split("@")[0]}'s Organization`);
  const result = { orgId: null, workspaceId: null };

  const org = _org();
  if (org) {
    try {
      const created = org.createOrg({ name: displayName }, account.id);
      result.orgId = created.id;
    } catch (e) {
      if (e.status === 409) {
        try {
          const retried = org.createOrg({ name: `${displayName} (${account.id.slice(0, 6)})` }, account.id);
          result.orgId = retried.id;
        } catch (e2) {
          logger.warn(`[Register] org provisioning failed for ${account.id} after retry: ${e2.message}`);
        }
      } else {
        logger.warn(`[Register] org provisioning failed for ${account.id}: ${e.message}`);
      }
    }
  }

  const ws = _ws();
  if (ws) {
    try {
      const created = ws.createWorkspace({ name: displayName, creatorAccountId: account.id });
      result.workspaceId = created.id;
      ws.switchWorkspace(created.id, account.id);
    } catch (e) {
      logger.warn(`[Register] workspace provisioning failed for ${account.id}: ${e.message}`);
    }
  }

  return result;
}

// ── POST /accounts/register (+ /api/accounts/register alias below) ────────
// Public self-serve registration — sends email verification, provisions a
// starter organization + workspace, on success.
const _registerRL = rateLimiter(5, 15 * 60_000); // 5 registrations per 15 min per IP

function _handleRegister(req, res) {
  const { email, password, name, inviteCode, orgName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  // Beta gate: invite code required + hard cap of 50 users (only enforced
  // when OPEN_SIGNUP=false; see betaReadiness.isOpenSignup)
  const beta = _beta();
  if (beta) {
    const gate = beta.checkBetaGate(inviteCode);
    if (!gate.allowed) {
      return res.status(403).json({ error: gate.reason });
    }
  }

  const result = accounts.createAccount({ email, password, name, role: "user" });
  if (!result.success) {
    return res.status(409).json({ error: result.error });
  }

  // Mark invite code as used
  if (beta && inviteCode) beta.markInviteCodeUsed(inviteCode, result.account.id);

  // Send email verification
  if (beta) {
    try { beta.sendEmailVerification(result.account.id, result.account.email, name); }
    catch { /* non-fatal */ }
  }

  const provisioned = _provisionOrgAndWorkspace(result.account, orgName);

  auditLog.recordAuth({ action: "register", operator: result.account.id, method: "email" });
  res.status(201).json({
    success: true,
    account: result.account,
    org: provisioned,
    message: "Account created. Check your email to verify your address.",
  });
}

router.post("/accounts/register", _registerRL, _handleRegister);

// ── GET /accounts/me ──────────────────────────────────────────────
router.get("/accounts/me", requireAuth, (req, res) => {
  const accountId = req.user.sub || req.user.id || "operator";
  const account   = accounts.getById(accountId);
  const access    = billing.checkAccess(accountId);

  res.json({
    success: true,
    account: account || { id: accountId, role: req.user.role },
    billing: {
      plan:        access.status === "active" ? billing.getRecord(accountId).plan : "trial",
      status:      access.status,
      daysLeft:    access.daysLeft,
      graceActive: access.graceActive,
    },
  });
});

// ── POST /accounts/resend-verification ────────────────────────────
router.post("/accounts/resend-verification", requireAuth, rateLimiter(3, 15 * 60_000), (req, res) => {
  const accountId = req.user.sub || req.user.id;
  const account   = accounts.getById(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.emailVerified) return res.json({ success: true, message: "Email already verified." });

  const beta = _beta();
  if (!beta) return res.status(503).json({ error: "Email service unavailable" });
  try {
    beta.sendEmailVerification(account.id, account.email, account.name);
    res.json({ success: true, message: "Verification email sent." });
  } catch (e) {
    res.status(500).json({ error: e.message || "Could not send verification email" });
  }
});

// ── PATCH /accounts/me ────────────────────────────────────────────
router.patch("/accounts/me", requireAuth, (req, res) => {
  const accountId = req.user.sub || req.user.id || "operator";
  const { name }  = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = accounts.updateAccount(accountId, { name });
  if (!result.success) return res.status(404).json({ error: result.error });

  res.json({ success: true, account: result.account });
});

// ── GET /accounts — operator only ────────────────────────────────
router.get("/accounts", requireAuth, (req, res) => {
  if (req.user.role !== "operator") {
    return res.status(403).json({ error: "Operator access required" });
  }
  res.json({ success: true, accounts: accounts.listAccounts() });
});

// ── /api/* aliases — respond before ops.js requireAuth gate ─────────────────
router.post("/api/accounts/register", _registerRL, _handleRegister);

router.get("/api/accounts/me", requireAuth, (req, res) => {
  const accountId = req.user.sub || req.user.id || "operator";
  const account   = accounts.getById(accountId);
  const access    = billing.checkAccess(accountId);
  res.json({
    success: true,
    account: account || { id: accountId, role: req.user.role },
    billing: {
      plan:        access.status === "active" ? billing.getRecord(accountId).plan : "trial",
      status:      access.status,
      daysLeft:    access.daysLeft,
      graceActive: access.graceActive,
    },
  });
});

module.exports = router;
