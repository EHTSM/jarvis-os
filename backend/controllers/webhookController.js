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
            const phone  = p.contact || "";
            const userId = p.customer_details?.contact || phone;
            const name   = p.customer_details?.name    || "";

            logger.info(`[Webhook] Payment captured — phone=${phone} id=${p.id}`);

            const identifier = phone || userId;
            if (identifier) {
                crm.updateLead(identifier, {
                    status:        "paid",
                    paymentStatus: "paid",
                    paymentId:     p.id,
                    paidAt:        new Date().toISOString()
                });
                await automation.triggerFulfillment(identifier, name);
            }
        }

        res.json({ status: "ok" });
    } catch (err) {
        errTracker.record("razorpay_webhook", err.message);
        logger.error("[Webhook] Razorpay error:", err.message);
        res.sendStatus(500);
    }
}

module.exports = { handleRazorpayWebhook };
