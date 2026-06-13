"use strict";
/**
 * Webhook Controller — Razorpay payment webhook.
 * Extracted from jarvisController (no dependency on the AI pipeline).
 *
 * WhatsApp incoming webhook is NOT here — it reuses the sales/execution
 * pipelines defined in jarvisController and stays there to avoid coupling.
 */

const logger     = require("../utils/logger");
const errTracker = require("../utils/errorTracker");
const payment    = require("../services/paymentService");
const crm        = require("../services/crmService");
const automation = require("../services/automationService");
const billing    = require("../services/billingService");

/**
 * POST /webhook/razorpay  and  POST /razorpay-webhook
 * HMAC verify → CRM update → triggerFulfillment
 */
async function handleRazorpayWebhook(req, res) {
    try {
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const sig     = req.headers["x-razorpay-signature"] || "";

        if (!payment.verifyWebhookSignature(rawBody, sig)) {
            logger.warn("[Webhook] Razorpay signature mismatch — rejected");
            return res.status(400).json({ error: "Invalid signature" });
        }

        const parsed = payment.parseWebhookEvent(rawBody);
        if (!parsed) return res.json({ status: "ignored" });

        const { event, payment: p } = parsed;
        logger.info(`[Webhook] Event: ${event}`);

        if (event === "payment.captured" && p) {
            const phone     = p.contact || "";
            const name      = p.customer_details?.name || "";
            const accountId = p.notes?.accountId || parsed.raw?.payload?.payment_link?.entity?.notes?.accountId || null;

            logger.info(`[Webhook] Payment captured — phone=${phone} id=${p.id} accountId=${accountId || "unknown"}`);

            // CRM: mark lead paid and trigger WhatsApp onboarding message
            const identifier = String(phone).replace(/\D/g, "");
            if (identifier) {
                crm.updateLead(identifier, {
                    status:        "paid",
                    paymentStatus: "paid",
                    paymentId:     p.id,
                    paidAt:        new Date().toISOString()
                });
                await automation.triggerFulfillment(identifier, name);
            }

            // Billing: activate the account that initiated the payment
            if (accountId) {
                billing.activatePlan(accountId, "starter", null);
                logger.info(`[Webhook] Billing activated via payment.captured: ${accountId} → starter`);
            } else {
                logger.warn(`[Webhook] payment.captured has no notes.accountId — billing not auto-activated. Payment id=${p.id}`);
            }
        }

        // Subscription events — activate/cancel Ooplix billing
        if (event === "subscription.activated") {
            const sub       = parsed.subscription;
            const subId     = sub?.id;
            const planId    = sub?.plan_id;
            // Map Razorpay plan ID → our plan name via env vars
            const planName  = planId === process.env.RAZORPAY_PLAN_ID_GROWTH ? "growth"
                            : planId === process.env.RAZORPAY_PLAN_ID_SCALE  ? "scale"
                            : "starter";
            const accountId = sub?.notes?.accountId || "operator";
            billing.activatePlan(accountId, planName, subId);
            logger.info(`[Webhook] Subscription activated: ${accountId} → ${planName} (${subId})`);
        }

        if (event === "subscription.cancelled" || event === "subscription.completed") {
            const sub       = parsed.subscription;
            const accountId = sub?.notes?.accountId || "operator";
            billing.cancelPlan(accountId);
            logger.info(`[Webhook] Subscription ended: ${accountId} (${event})`);
        }

        // payment.failed — log for retry tracking
        if (event === "payment.failed") {
            const p = parsed.payment;
            logger.warn(`[Webhook] Payment failed: id=${p?.id} reason=${p?.error_reason || "unknown"}`);
        }

        // refund.processed
        if (event === "refund.processed") {
            const r = parsed.refund;
            logger.info(`[Webhook] Refund processed: id=${r?.id} amount=₹${(r?.amount || 0) / 100}`);
        }

        res.json({ status: "ok" });
    } catch (err) {
        errTracker.record("razorpay_webhook", err.message);
        logger.error("[Webhook] Razorpay error:", err.message);
        res.sendStatus(500);
    }
}

module.exports = { handleRazorpayWebhook };
