"use strict";
/**
 * Account routes — registration, profile, account management.
 *
 * Closed Beta gate (Mission 6): Registration requires a valid invite code
 * and enforces a hard cap of 50 beta users. Email verification is sent on
 * successful registration.
 */

const router   = require("express").Router();
const accounts = require("../services/accountService");
const billing  = require("../services/billingService");
const auditLog = require("../utils/auditLog.cjs");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

// Lazy-load betaReadiness to avoid circular-require at startup
const _beta = () => { try { return require("../services/betaReadiness.cjs"); } catch { return null; } };

// ── POST /accounts/register ───────────────────────────────────────
// Closed-beta registration — requires inviteCode, enforces 50-user cap,
// sends email verification on success.
router.post("/accounts/register",
  rateLimiter(5, 15 * 60_000), // 5 registrations per 15 min per IP
  (req, res) => {
    const { email, password, name, inviteCode } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    // Beta gate: invite code required + hard cap of 50 users
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

    auditLog.recordAuth({ action: "register", operator: result.account.id, method: "email" });
    res.status(201).json({
      success: true,
      account: result.account,
      message: "Account created. Check your email to verify your address.",
    });
  }
);

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
const _registerRL = rateLimiter(5, 15 * 60_000);

function _handleRegister(req, res) {
  const { email, password, name, inviteCode } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const beta = _beta();
  if (beta) {
    const gate = beta.checkBetaGate(inviteCode);
    if (!gate.allowed) return res.status(403).json({ error: gate.reason });
  }

  const result = accounts.createAccount({ email, password, name, role: "user" });
  if (!result.success) {
    return res.status(409).json({ error: result.error });
  }

  if (beta && inviteCode) beta.markInviteCodeUsed(inviteCode, result.account.id);
  if (beta) {
    try { beta.sendEmailVerification(result.account.id, result.account.email, name); }
    catch { /* non-fatal */ }
  }

  auditLog.recordAuth({ action: "register", operator: result.account.id, method: "email" });
  res.status(201).json({
    success: true,
    account: result.account,
    message: "Account created. Check your email to verify your address.",
  });
}

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
