"use strict";
/**
 * Billing Service — Ooplix SaaS subscription + trial management.
 *
 * Storage: data/billing.json (per-account billing state)
 * Schema:  { [accountId]: BillingRecord }
 *
 * BillingRecord: {
 *   accountId:    string
 *   plan:         "trial" | "starter" | "growth" | "scale" | "cancelled"
 *   status:       "trialing" | "active" | "expired" | "cancelled"
 *   trialStart:   ISO string
 *   trialEnd:     ISO string  (trialStart + 7 days)
 *   activatedAt:  ISO string | null
 *   cancelledAt:  ISO string | null
 *   razorpaySubId: string | null
 *   updatedAt:    ISO string
 * }
 *
 * Trial rules:
 *   - 7 days from account creation
 *   - Full access during trial
 *   - Grace period: 24h after expiry (API still works, banner shown)
 *   - Hard block: >24h post-expiry on paid-only routes
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const BILLING_FILE  = path.join(__dirname, "../../data/billing.json");
const TRIAL_DAYS    = 7;
const GRACE_HOURS   = 24;
const PLAN_PRICES   = { starter: 999, growth: 2499, scale: 0 }; // INR / month

function _load() {
  try { return JSON.parse(fs.readFileSync(BILLING_FILE, "utf8")); }
  catch { return {}; }
}

function _save(data) {
  try {
    fs.mkdirSync(path.dirname(BILLING_FILE), { recursive: true });
    fs.writeFileSync(BILLING_FILE, JSON.stringify(data, null, 2));
  } catch (e) { logger.error("[Billing] persist failed:", e.message); }
}

// ── Trial creation ────────────────────────────────────────────────

/**
 * Create a trial record for a new account.
 * Idempotent — calling twice for the same accountId is safe.
 */
function createTrial(accountId) {
  const records = _load();
  if (records[accountId]) return records[accountId]; // already exists

  const now        = new Date();
  const trialEnd   = new Date(now.getTime() + TRIAL_DAYS * 24 * 3600_000);
  const record = {
    accountId,
    plan:          "trial",
    status:        "trialing",
    trialStart:    now.toISOString(),
    trialEnd:      trialEnd.toISOString(),
    activatedAt:   null,
    cancelledAt:   null,
    razorpaySubId: null,
    updatedAt:     now.toISOString(),
  };

  records[accountId] = record;
  _save(records);
  logger.info(`[Billing] Trial started for ${accountId} — expires ${trialEnd.toDateString()}`);
  return record;
}

// ── Status checks ─────────────────────────────────────────────────

/**
 * Get billing record for an account. Creates a trial if none exists.
 */
function getRecord(accountId) {
  const records = _load();
  if (!records[accountId]) return createTrial(accountId);
  return records[accountId];
}

/**
 * Returns { allowed, status, daysLeft, graceActive, plan }
 * allowed=true means the account can use the product.
 */
function checkAccess(accountId) {
  const r   = getRecord(accountId);
  const now = Date.now();

  if (r.status === "active") {
    return { allowed: true, status: "active", plan: r.plan, daysLeft: null, graceActive: false };
  }

  if (r.status === "trialing") {
    const trialEndMs = new Date(r.trialEnd).getTime();
    const daysLeft   = Math.max(0, Math.ceil((trialEndMs - now) / 86_400_000));

    if (now <= trialEndMs) {
      return { allowed: true, status: "trialing", plan: "trial", daysLeft, graceActive: false };
    }

    // Trial expired — check grace period
    const graceEnd = trialEndMs + GRACE_HOURS * 3_600_000;
    if (now <= graceEnd) {
      return { allowed: true, status: "expired", plan: "trial", daysLeft: 0, graceActive: true };
    }

    // Hard block
    return { allowed: false, status: "expired", plan: "trial", daysLeft: 0, graceActive: false };
  }

  if (r.status === "cancelled" || r.status === "expired") {
    return { allowed: false, status: r.status, plan: r.plan, daysLeft: 0, graceActive: false };
  }

  // Unknown status — allow with warning
  logger.warn(`[Billing] Unknown status '${r.status}' for ${accountId} — allowing`);
  return { allowed: true, status: r.status, plan: r.plan, daysLeft: null, graceActive: false };
}

// ── Subscription activation ───────────────────────────────────────

/**
 * Activate a paid plan (called from Razorpay webhook or manual upgrade).
 */
function activatePlan(accountId, plan, razorpaySubId = null) {
  const records = _load();
  const existing = records[accountId] || {};
  records[accountId] = {
    ...existing,
    accountId,
    plan,
    status:        "active",
    activatedAt:   new Date().toISOString(),
    cancelledAt:   null,
    razorpaySubId: razorpaySubId || existing.razorpaySubId || null,
    updatedAt:     new Date().toISOString(),
  };
  _save(records);
  logger.info(`[Billing] Plan activated: ${accountId} → ${plan}`);
  return records[accountId];
}

/**
 * Cancel a subscription.
 */
function cancelPlan(accountId) {
  const records = _load();
  if (!records[accountId]) return null;
  records[accountId] = {
    ...records[accountId],
    status:      "cancelled",
    cancelledAt: new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  _save(records);
  logger.info(`[Billing] Plan cancelled: ${accountId}`);
  return records[accountId];
}

// ── Razorpay subscription creation ───────────────────────────────

/**
 * Create a Razorpay subscription for a plan.
 * Requires RAZORPAY_PLAN_ID_STARTER or RAZORPAY_PLAN_ID_GROWTH in .env.
 * Returns { success, subscriptionId, shortUrl } or { success: false, error }.
 */
async function createRazorpaySubscription(accountId, plan, customerEmail) {
  const Razorpay = require("razorpay");
  const key    = process.env.RAZORPAY_KEY_ID    || process.env.RAZORPAY_KEY    || "";
  const secret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || "";

  if (!key || !secret) {
    return { success: false, error: "Razorpay not configured" };
  }

  const planEnvKey = `RAZORPAY_PLAN_ID_${plan.toUpperCase()}`;
  const planId     = process.env[planEnvKey];

  if (!planId) {
    // No Razorpay plan ID configured — fall back to payment link for manual upgrade
    return {
      success:  false,
      error:    `Razorpay plan ID not configured. Set ${planEnvKey} in .env.`,
      fallback: true,
      amount:   PLAN_PRICES[plan] || 999,
    };
  }

  try {
    const rz = new Razorpay({ key_id: key, key_secret: secret });
    const sub = await rz.subscriptions.create({
      plan_id:       planId,
      total_count:   120,  // 10 years max — effectively unlimited
      quantity:      1,
      customer_notify: 1,
      notify_info: customerEmail ? { notify_email: customerEmail } : undefined,
    });

    logger.info(`[Billing] Razorpay subscription created: ${sub.id} for ${accountId}`);
    return {
      success:        true,
      subscriptionId: sub.id,
      shortUrl:       sub.short_url,
    };
  } catch (err) {
    logger.error("[Billing] Razorpay subscription failed:", err.message);
    return { success: false, error: err.message };
  }
}

// ── Billing middleware ────────────────────────────────────────────

/**
 * Express middleware — blocks requests if account is expired and past grace period.
 * Attaches billing state to req.billing for use in routes.
 * Skips for: /health, /auth/*, /settings/*, /webhook/*
 */
function requireActiveAccount(req, res, next) {
  // Billing check only applies to authenticated requests
  if (!req.user) return next();

  const accountId = req.user.sub || req.user.id || "operator";
  const access    = checkAccess(accountId);

  req.billing = access;

  if (!access.allowed) {
    return res.status(402).json({
      error:         "subscription_required",
      message:       "Your trial has expired. Upgrade to continue using Ooplix.",
      status:        access.status,
      upgradeUrl:    `${process.env.BASE_URL || ""}/pricing`,
    });
  }

  next();
}

module.exports = {
  createTrial,
  getRecord,
  checkAccess,
  activatePlan,
  cancelPlan,
  createRazorpaySubscription,
  requireActiveAccount,
  PLAN_PRICES,
};
