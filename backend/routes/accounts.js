"use strict";
/**
 * Account routes — registration, profile, account management.
 * Self-serve signup: POST /accounts/register
 */

const router   = require("express").Router();
const accounts = require("../services/accountService");
const billing  = require("../services/billingService");
const auditLog = require("../utils/auditLog.cjs");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

// ── POST /accounts/register ───────────────────────────────────────
// Self-serve signup — creates account + starts trial
router.post("/accounts/register",
  rateLimiter(5, 15 * 60_000), // 5 registrations per 15 min per IP
  (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const result = accounts.createAccount({ email, password, name, role: "user" });
    if (!result.success) {
      return res.status(409).json({ error: result.error });
    }

    // Trial already created by createAccount → billingService.createTrial
    auditLog.recordAuth({ action: "register", operator: result.account.id, method: "email" });
    res.status(201).json({
      success: true,
      account: result.account,
      message: "Account created. Your 7-day free trial starts now.",
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
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  const result = accounts.createAccount({ email, password, name, role: "user" });
  if (!result.success) {
    return res.status(409).json({ error: result.error });
  }
  auditLog.recordAuth({ action: "register", operator: result.account.id, method: "email" });
  res.status(201).json({
    success: true,
    account: result.account,
    message: "Account created. Your 7-day free trial starts now.",
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
