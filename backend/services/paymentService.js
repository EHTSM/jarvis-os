"use strict";
/**
 * Payment Service — Razorpay payment link creation + webhook verification.
 */

const Razorpay = require("razorpay");
const crypto   = require("crypto");
const logger   = require("../utils/logger");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

// Accept both naming conventions: RAZORPAY_KEY or RAZORPAY_KEY_ID
const _rzKey    = process.env.RAZORPAY_KEY    || process.env.RAZORPAY_KEY_ID    || "";
const _rzSecret = process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET || "";
const _paymentsEnabled = !!(_rzKey && _rzSecret);

if (!_paymentsEnabled) {
    logger.warn("[Payment] RAZORPAY_KEY / RAZORPAY_SECRET not set — payment link creation disabled");
}

// Connector Secret Isolation: previously a single Razorpay instance was
// built once at module load from the founder's global env keys, so an org
// that connected its OWN Razorpay account via myConnectors.js (vault
// connectorId "pay:razorpay") had its stored credentials silently ignored —
// every payment link, for every org, was created under the founder's
// account. _resolveCreds(orgId) now checks that org's own vault-stored
// key/secret first; the global instance (cached, as before) remains the
// fallback for orgId=null or an org with no connected Razorpay account, so
// existing single-tenant behavior is completely unaffected.
let _globalInstance = null;
const _orgInstances = new Map();

function _resolveCreds(orgId) {
    if (orgId) {
        const vault  = _vault();
        const keyId  = _try(() => vault?.getSecret?.("pay:razorpay", "api_key", orgId));
        const secret = _try(() => vault?.getSecret?.("pay:razorpay", "webhook_secret", orgId));
        if (keyId && secret) return { keyId, secret, scope: orgId };
    }
    return { keyId: _rzKey, secret: _rzSecret, scope: "global" };
}

function _getInstance(orgId = null) {
    const { keyId, secret, scope } = _resolveCreds(orgId);
    if (!keyId || !secret) return null;

    if (scope === "global") {
        if (!_globalInstance) _globalInstance = new Razorpay({ key_id: keyId, key_secret: secret });
        return _globalInstance;
    }
    if (!_orgInstances.has(scope)) {
        _orgInstances.set(scope, new Razorpay({ key_id: keyId, key_secret: secret }));
    }
    return _orgInstances.get(scope);
}

function isEnabled(orgId = null) {
    if (orgId) {
        const { keyId, secret } = _resolveCreds(orgId);
        if (keyId && secret) return true;
    }
    return _paymentsEnabled;
}

/**
 * Create a Razorpay payment link.
 * @returns {Promise<{success:boolean, link?:string, error?:string}>}
 */
async function createPaymentLink({ amount = 999, name = "Customer", phone = null, description = "JARVIS Access", accountId = null, orgId = null }) {
    if (process.env.DISABLE_PAYMENTS === "true") {
        return { success: false, error: "Payments disabled (DISABLE_PAYMENTS=true in .env)" };
    }
    const rz = _getInstance(orgId);
    if (!rz) {
        return { success: false, error: "Payments not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env, or connect via /my-connectors/razorpay" };
    }

    // Guard: refuse to create live payment links with a localhost callback URL.
    // Payment confirmations will never reach the server if BASE_URL is localhost.
    const _baseUrl = process.env.BASE_URL || "";
    if (!_baseUrl || _baseUrl.includes("localhost") || _baseUrl.includes("127.0.0.1")) {
        const msg = "BASE_URL is not set to a public domain. Set BASE_URL=https://yourdomain.com in .env so Razorpay can deliver payment webhooks.";
        logger.error("[Payment] " + msg);
        return { success: false, error: msg };
    }

    try {
        const body = {
            amount:      amount * 100,   // paise
            currency:    "INR",
            description,
            customer:    { name },
            notify:      { sms: !!phone, email: false },
            reminder_enable: true,
            callback_url:    `${_baseUrl}/webhook/razorpay`,
            callback_method: "get",
            notes:       { accountId: accountId || "" },
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

    const expBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(String(signature));
    // Constant-time comparison prevents timing attacks on HMAC verification
    return expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
}

/**
 * Parse Razorpay webhook event body.
 * Returns { event, payment } or null.
 */
function parseWebhookEvent(body) {
    try {
        const payload  = typeof body === "string" ? JSON.parse(body) : body;
        const event    = payload?.event;
        const payment  = payload?.payload?.payment?.entity              || null;
        const sub      = payload?.payload?.subscription?.entity         || null;
        const order    = payload?.payload?.order?.entity                || null;
        const refund   = payload?.payload?.refund?.entity               || null;
        return { event, payment, subscription: sub, order, refund, raw: payload };
    } catch {
        return null;
    }
}

module.exports = { createPaymentLink, verifyWebhookSignature, parseWebhookEvent, isEnabled };
