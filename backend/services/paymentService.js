"use strict";
/**
 * Payment Service — Razorpay payment link creation + webhook verification.
 *
 * Payments Ecosystem mission: refundPayment() added. Discovery confirmed
 * refunds previously never reached Razorpay's real gateway at all — the
 * only "refund" capability in this repo was an internal credit-note record
 * (revenueOS.cjs), and parseWebhookEvent() below already parsed real
 * refund.processed events but nothing ever created one. This is the
 * missing "actually refund" half — same relationship
 * createPaymentLink()/webhook already had before this mission's earlier
 * social-platform work established the "find the missing real API call,
 * wire it using the existing credential/org pattern" shape repeatedly.
 *
 * Idempotency: Razorpay's refund API accepts a client-supplied `receipt`
 * field specifically for de-duplication (its own documented mechanism —
 * a repeated refund() call with the same receipt against the same payment
 * is recognized as the same logical refund by Razorpay's servers, not a
 * client-side guess). This is combined with a local short-TTL dedup guard
 * (reusing socialPublishSupport.cjs's exact Map+TTL pattern, itself modeled
 * on whatsappService.js's webhook-replay dedup) as defense-in-depth against
 * a double-click/retry hitting this function twice before Razorpay's own
 * receipt-based dedup would even see the second request.
 */

const Razorpay = require("razorpay");
const crypto   = require("crypto");
const logger   = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

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
        // A.6 business-owner-journey finding: the Razorpay SDK's own error
        // normalizer (node_modules/razorpay/dist/api.js normalizeError())
        // throws a plain object — { statusCode, error: { code, description } }
        // — not an Error instance, so err.message here was always undefined.
        // logger.error printed "createPaymentLink failed: undefined" and the
        // route's res.json({ error: result.error }) serialized to a literal
        // "{}" body (JSON.stringify drops undefined values), which is why
        // the UI fell through to a bare "HTTP 500" with zero explanation —
        // confirmed live: real Razorpay live keys configured, a real
        // Contacts → Generate Payment Link submission, raw response body
        // was exactly "{}". Extract the real detail from whichever shape
        // the thrown value actually has, so a genuine Razorpay-side failure
        // (bad keys, disabled account, etc.) surfaces its real reason
        // instead of a blank message.
        const detail = err?.error?.description || err?.message || String(err);
        logger.error("[Payment] createPaymentLink failed:", detail);
        return { success: false, error: detail };
    }
}

/**
 * Refund a captured Razorpay payment via the real gateway API
 * (POST /payments/{id}/refund). Amount is optional — omitting it triggers
 * a full refund, matching Razorpay's own API default.
 *
 * @param {string} paymentId - Razorpay payment id (e.g. "pay_...")
 * @param {object} [opts]
 * @param {number} [opts.amount] - partial refund amount in the currency's
 *   smallest unit (paise for INR); omit for a full refund
 * @param {string|null} [opts.orgId] - org-scoped credential resolution,
 *   same as createPaymentLink()
 * @param {string|null} [opts.idempotencyKey] - caller-supplied key (e.g.
 *   the internal order/refund-request id) — a repeated call with the same
 *   key within the TTL window returns the original result instead of
 *   issuing a second refund
 * @returns {Promise<{success:boolean, refundId?:string, status?:string, error?:string}>}
 */
// In-flight reservation, closing the check-then-await-then-record race
// checkIdempotency()/recordIdempotency() alone cannot close on their own:
// two concurrent calls with the same idempotencyKey (e.g. a double-submit
// of the same approved refund request) could both pass checkIdempotency()
// before either finishes and calls recordIdempotency(). This mirrors the
// exact reasoning already established in this codebase for
// orgBudgets.reserveInFlight()/releaseInFlight() (aiOrchestrator.cjs) —
// a synchronous Set add/delete around the async call is atomic in Node's
// single-threaded event loop (no `await` occurs between the check and the
// reservation), unlike the check-then-record pair around it.
const _inFlightRefunds = new Set();

async function refundPayment(paymentId, { amount = null, orgId = null, idempotencyKey = null } = {}) {
    if (process.env.DISABLE_PAYMENTS === "true") {
        return { success: false, error: "Payments disabled (DISABLE_PAYMENTS=true in .env)" };
    }
    if (!paymentId || typeof paymentId !== "string") {
        return { success: false, error: "paymentId required" };
    }
    if (amount !== null && (typeof amount !== "number" || amount <= 0)) {
        return { success: false, error: "amount, if provided, must be a positive number" };
    }

    // Local dedup guard, in addition to Razorpay's own receipt-based
    // idempotency below — same TTL-map pattern used throughout this
    // codebase (whatsappService.js's webhook replay guard,
    // socialPublishSupport.cjs's publish dedup).
    const dedupKey = idempotencyKey ? `razorpay-refund:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    if (dedupKey) {
        if (_inFlightRefunds.has(dedupKey)) {
            return { success: false, error: "A refund for this request is already in progress — do not resubmit" };
        }
        _inFlightRefunds.add(dedupKey);
    }

    const rz = _getInstance(orgId);
    if (!rz) {
        if (dedupKey) _inFlightRefunds.delete(dedupKey);
        return { success: false, error: "Payments not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env, or connect via /my-connectors/razorpay" };
    }

    const result = await withRetry(async () => {
        try {
            const params = {};
            if (amount !== null) params.amount = amount;
            // Razorpay's own documented idempotency mechanism — a repeated
            // call with the same receipt against the same payment is
            // recognized server-side as the same logical refund, not
            // merely deduped on this process's own in-memory map.
            if (idempotencyKey) params.receipt = String(idempotencyKey).slice(0, 40); // Razorpay's real receipt field length limit

            const refund = await rz.payments.refund(paymentId, params);
            logger.info(`[Payment] Refund created for ${paymentId}: ${refund.id} (status=${refund.status})`);
            return { success: true, refundId: refund.id, status: refund.status };
        } catch (err) {
            // Same real SDK error-shape handling as createPaymentLink()'s
            // catch block above — normalizeError() throws a plain object,
            // not an Error instance.
            const detail = err?.error?.description || err?.message || String(err);
            const status = err?.statusCode;
            logger.error(`[Payment] refundPayment failed for ${paymentId}: ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) {
        recordIdempotency(dedupKey, result);
        _inFlightRefunds.delete(dedupKey);
    }
    return result;
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

module.exports = { createPaymentLink, refundPayment, verifyWebhookSignature, parseWebhookEvent, isEnabled };
