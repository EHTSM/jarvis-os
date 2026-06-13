"use strict";
/**
 * Billing routes — subscription management, trial status, upgrade.
 */

const router  = require("express").Router();
const billing = require("../services/billingService");
const auditLog = require("../utils/auditLog.cjs");
const { requireAuth } = require("../middleware/authMiddleware");

// ── GET /billing/status ───────────────────────────────────────────
// Returns current trial/subscription state for the authenticated account
router.get("/billing/status", requireAuth, (req, res) => {
  const accountId = req.user.sub || req.user.id || "operator";
  const record    = billing.getRecord(accountId);
  const access    = billing.checkAccess(accountId);

  res.json({
    success:     true,
    accountId,
    plan:        record.plan,
    status:      record.status,
    allowed:     access.allowed,
    daysLeft:    access.daysLeft,
    graceActive: access.graceActive,
    trialEnd:    record.trialEnd,
    activatedAt: record.activatedAt,
    prices:      billing.PLAN_PRICES,
  });
});

// ── POST /billing/upgrade ─────────────────────────────────────────
// Initiates a plan upgrade — creates Razorpay subscription or returns payment link
router.post("/billing/upgrade", requireAuth, async (req, res) => {
  const { plan } = req.body || {};
  if (!["starter", "growth", "scale"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Choose: starter, growth, scale" });
  }

  const accountId = req.user.sub || req.user.id || "operator";
  const email     = req.user.email || null;

  const result = await billing.createRazorpaySubscription(accountId, plan, email);

  if (result.success) {
    auditLog.recordAuth({ action: "billing_upgrade_initiated", operator: req.user, method: plan });
    return res.json({
      success:        true,
      subscriptionId: result.subscriptionId,
      paymentUrl:     result.shortUrl,
      message:        `Subscription for ${plan} plan initiated. Complete payment at the URL provided.`,
    });
  }

  if (result.fallback) {
    // No Razorpay plan configured — use one-time payment link as fallback
    const payment = require("../services/paymentService");
    const link = await payment.createPaymentLink({
      amount:      result.amount,
      name:        accountId,
      description: `Ooplix ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan — Monthly`,
      accountId,
    });

    if (link.success) {
      auditLog.recordAuth({ action: "billing_upgrade_fallback", operator: req.user, method: plan });
      return res.json({
        success:    true,
        paymentUrl: link.link,
        mode:       "payment_link",
        message:    `Payment link created for ${plan} plan. Configure RAZORPAY_PLAN_ID_${plan.toUpperCase()} in .env for auto-renewing subscriptions.`,
      });
    }
  }

  res.status(500).json({ error: result.error || "Failed to initiate upgrade" });
});

// ── POST /billing/activate ────────────────────────────────────────
// Internal: called from Razorpay webhook on subscription.activated
router.post("/billing/activate", requireAuth, (req, res) => {
  const { accountId, plan, razorpaySubId } = req.body || {};
  if (!accountId || !plan) {
    return res.status(400).json({ error: "accountId and plan required" });
  }
  const record = billing.activatePlan(accountId, plan, razorpaySubId);
  auditLog.recordAuth({ action: "billing_activated", operator: req.user, method: plan });
  res.json({ success: true, record });
});

// ── POST /billing/cancel ──────────────────────────────────────────
router.post("/billing/cancel", requireAuth, (req, res) => {
  const accountId = req.user.sub || req.user.id || "operator";
  billing.cancelPlan(accountId);
  auditLog.recordAuth({ action: "billing_cancelled", operator: req.user });
  res.json({ success: true, message: "Subscription cancelled. Access continues until end of billing period." });
});

module.exports = router;
