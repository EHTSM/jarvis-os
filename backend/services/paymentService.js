"use strict";
/**
 * Payment Service — Razorpay payment link creation + webhook verification.
 */

const Razorpay = require("razorpay");
const crypto   = require("crypto");
const logger   = require("../utils/logger");

let _instance = null;

function _getInstance() {
    if (!_instance) {
        const key    = process.env.RAZORPAY_KEY;
        const secret = process.env.RAZORPAY_SECRET;
        if (!key || !secret) throw new Error("RAZORPAY_KEY / RAZORPAY_SECRET not set in .env");
        _instance = new Razorpay({ key_id: key, key_secret: secret });
    }
    return _instance;
}

/**
 * Create a Razorpay payment link.
 * @returns {Promise<{success:boolean, link?:string, error?:string}>}
 */
async function createPaymentLink({ amount = 999, name = "Customer", phone = null, description = "JARVIS Access" }) {
    try {
        const rz   = _getInstance();
        const body = {
            amount:      amount * 100,   // paise
            currency:    "INR",
            description,
            customer:    { name },
            notify:      { sms: !!phone, email: false },
            reminder_enable: true,
            callback_url:    `${process.env.BASE_URL || "http://localhost:5050"}/webhook/razorpay`,
            callback_method: "get"
        };

        if (phone) {
            const clean = String(phone).replace(/\D/g, "").replace(/^0+/, "");
            body.customer.contact = `+${clean}`;
        }

        const link = await rz.paymentLink.create(body);
        logger.info(`[Payment] Link created: ${link.short_url}`);
        return { success: true, link: link.short_url, id: link.id };

    } catch (err) {
        logger.error("[Payment] createPaymentLink failed:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Verify Razorpay webhook HMAC signature.
 * Returns true if valid (or if no secret configured — passes through).
 */
function verifyWebhookSignature(rawBody, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === "production") {
            logger.error("[Payment] RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook in production");
            return false;
        }
        logger.warn("[Payment] RAZORPAY_WEBHOOK_SECRET not set — accepting webhook (dev only)");
        return true;
    }

    const expected = crypto
        .createHmac("sha256", secret)
        .update(String(rawBody))
        .digest("hex");

    return expected === String(signature);
}

/**
 * Parse Razorpay webhook event body.
 * Returns { event, payment } or null.
 */
function parseWebhookEvent(body) {
    try {
        const payload = typeof body === "string" ? JSON.parse(body) : body;
        const event   = payload?.event;
        const payment = payload?.payload?.payment?.entity || null;
        return { event, payment };
    } catch {
        return null;
    }
}

module.exports = { createPaymentLink, verifyWebhookSignature, parseWebhookEvent };
