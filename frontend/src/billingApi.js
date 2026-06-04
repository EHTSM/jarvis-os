/**
 * Billing API — wraps /billing/* routes.
 * All calls are soft-fail safe (return null on error, never throw).
 */
import { _fetch } from "./_client";

/** Fetch current trial/subscription status for the authenticated account. */
export async function getBillingStatus() {
  try { return await _fetch("/billing/status"); }
  catch { return null; }
}

/**
 * Initiate a plan upgrade.
 * Returns { success, paymentUrl, subscriptionId, mode, message } or null.
 */
export async function upgradePlan(plan) {
  try {
    return await _fetch("/billing/upgrade", {
      method: "POST",
      body:   JSON.stringify({ plan }),
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Cancel the current subscription. */
export async function cancelSubscription() {
  try {
    return await _fetch("/billing/cancel", { method: "POST" });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Plan catalogue (mirrors billingService.js) ───────────────────────
export const PLAN_PRICES = { starter: 999, growth: 2499, scale: null };

export const PLANS = [
  {
    id:       "starter",
    name:     "Starter",
    price:    "₹999",
    period:   "/month",
    tagline:  "For freelancers and solo operators",
    featured: false,
    features: [
      "Up to 100 leads",
      "WhatsApp follow-up sequences (4 tiers)",
      "Payment link generation",
      "Pipeline & revenue dashboard",
      "7-day message history",
      "Email support",
    ],
    limits: "100 leads · 500 messages/month",
  },
  {
    id:       "growth",
    name:     "Growth",
    price:    "₹2,499",
    period:   "/month",
    tagline:  "For growing businesses and small teams",
    featured: true,
    badge:    "Most Popular",
    features: [
      "Up to 1,000 leads",
      "WhatsApp follow-up sequences (6 tiers)",
      "Payment links + bulk messaging",
      "Full pipeline & revenue analytics",
      "Activity timeline (90 days)",
      "Control Room — task execution",
      "Developer & Business OS modules",
      "Priority support",
    ],
    limits: "1,000 leads · 5,000 messages/month",
  },
  {
    id:       "scale",
    name:     "Scale",
    price:    "Custom",
    period:   "",
    tagline:  "For agencies and high-volume operators",
    featured: false,
    features: [
      "Unlimited leads",
      "Custom automation sequences",
      "White-label options",
      "Dedicated onboarding",
      "SLA-backed uptime",
      "Enterprise OS + audit log",
      "Custom integrations",
      "Dedicated account manager",
    ],
    limits: "Unlimited",
  },
];
