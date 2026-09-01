"use strict";
/**
 * Stripe Service — webhook signature verification + event parsing.
 *
 * ERA-2 Mission 76: closes roadmap item P10 ("design and build a Stripe
 * webhook route" — STRIPE_WEBHOOK_SECRET was templated in .env.example and
 * vault-wired in secretVault.cjs's pay:stripe entry, but no route existed
 * to receive events at all, confirmed by the Payments Ecosystem mission's
 * discovery pass). Scope is deliberately narrow: Razorpay remains the sole
 * working payment gateway (createPaymentLink/refundPayment/subscriptions);
 * this file does NOT add Stripe checkout, subscriptions, or refunds — that
 * is a separate, much larger initiative (a real Stripe SDK integration)
 * this mission's own scope rules classify as out of bounds without a
 * founder "build Stripe checkout" decision. What IS safe to build without
 * that decision: the webhook receiving/verification path itself, following
 * Stripe's own publicly documented signature scheme
 * (https://stripe.com/docs/webhooks/signatures) with Node's built-in
 * `crypto` — no `stripe` npm dependency needed, mirroring this codebase's
 * existing Razorpay webhook verification style exactly (HMAC-SHA256,
 * constant-time compare, dev-mode pass-through, prod-mode hard reject when
 * unconfigured).
 *
 * Once wired, this makes STRIPE_WEBHOOK_SECRET provisioning
 * (12_ROADMAP.md P10) a pure credential-provisioning step later, with no
 * further code required to receive and verify a real Stripe event.
 */

const crypto = require("crypto");
const https  = require("https");
const logger = require("../utils/logger");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

const _skGlobal  = process.env.STRIPE_SECRET_KEY     || "";
const _whsGlobal = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_API_BASE = "api.stripe.com";
const STRIPE_API_VERSION = "2024-06-20";

// Stripe recommends rejecting events whose timestamp is too far from "now"
// to prevent replay of a captured (even validly-signed) request — same
// concern class as paymentService.js's HMAC check, extended here because
// Stripe's own scheme includes a timestamp specifically for this purpose
// (Razorpay's does not, so the sibling file has no equivalent).
const _TOLERANCE_SECONDS = 5 * 60;

function _resolveWebhookSecret(orgId) {
    if (orgId) {
        const secret = _try(() => _vault()?.getSecret?.("pay:stripe", "webhook_secret", orgId));
        if (secret) return secret;
    }
    return _whsGlobal;
}

// Same org-first/global-fallback resolution as paymentService.js's
// _resolveCreds(orgId) for Razorpay — an org with its own connected Stripe
// account (vault connectorId "pay:stripe") uses its own secret key; the
// founder's global env key remains the fallback for orgId=null or an org
// with nothing connected, so single-tenant behavior is unaffected.
function _resolveSecretKey(orgId) {
    if (orgId) {
        const key = _try(() => _vault()?.getSecret?.("pay:stripe", "api_key", orgId));
        if (key) return key;
    }
    return _skGlobal;
}

function isEnabled(orgId = null) {
    if (orgId) {
        const secret = _try(() => _vault()?.getSecret?.("pay:stripe", "webhook_secret", orgId));
        if (secret) return true;
    }
    return !!(_skGlobal && _whsGlobal);
}

/**
 * Parse Stripe's `Stripe-Signature` header into its `t`/`v1` components.
 * Format: "t=1614556800,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd,v0=..."
 * Multiple v1 values can appear (secret rotation) — any matching one is valid.
 */
function _parseSignatureHeader(header) {
    const parts = String(header || "").split(",").map(p => p.trim());
    let timestamp = null;
    const v1 = [];
    for (const part of parts) {
        const [k, v] = part.split("=");
        if (k === "t") timestamp = v;
        else if (k === "v1") v1.push(v);
    }
    return { timestamp, v1 };
}

/**
 * Verify a Stripe webhook signature per Stripe's documented scheme:
 * signed payload = `${timestamp}.${rawBody}`, HMAC-SHA256 with the webhook
 * secret, compared against the header's v1 signature(s) in constant time.
 * Same dev-mode/prod-mode posture as paymentService.js's Razorpay check:
 * unconfigured passes through with a warning in dev, hard-rejects in
 * production.
 *
 * @param {string} rawBody - the exact raw request body Stripe sent
 * @param {string} signatureHeader - the `Stripe-Signature` header value
 * @param {string|null} [orgId] - org-scoped secret resolution, same
 *   pattern as paymentService.js
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signatureHeader, orgId = null) {
    const secret = _resolveWebhookSecret(orgId);
    if (!secret) {
        if (process.env.NODE_ENV === "production") {
            logger.error("[Stripe] STRIPE_WEBHOOK_SECRET not set — rejecting webhook in production");
            return false;
        }
        logger.warn("[Stripe] STRIPE_WEBHOOK_SECRET not set — accepting webhook (dev only)");
        return true;
    }

    const { timestamp, v1 } = _parseSignatureHeader(signatureHeader);
    if (!timestamp || v1.length === 0) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Date.now() / 1000 - ts) > _TOLERANCE_SECONDS) {
        logger.warn("[Stripe] webhook signature timestamp outside tolerance — rejected (possible replay)");
        return false;
    }

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${String(rawBody)}`)
        .digest("hex");
    const expBuf = Buffer.from(expected, "hex");

    return v1.some(sig => {
        const sigBuf = _try(() => Buffer.from(sig, "hex"));
        return !!sigBuf && expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
    });
}

/**
 * Parse a Stripe webhook event body into { event, data, raw }.
 * Returns null on malformed JSON, matching paymentService.js's
 * parseWebhookEvent() contract.
 */
function parseWebhookEvent(body) {
    try {
        const payload = typeof body === "string" ? JSON.parse(body) : body;
        const event = payload?.type || null;
        const data  = payload?.data?.object || null;
        return { event, data, raw: payload };
    } catch {
        return null;
    }
}

// ── Checkout Session creation ───────────────────────────────────────────
//
// ERA-2 Mission 76 (P10 continuation): the webhook receiving/verification
// half above was already real; this is the missing "actually create a
// checkout" half — same relationship paymentService.js's
// createPaymentLink()/verifyWebhookSignature() already have. Founder
// decision (2026-08-31): implement Stripe's REST API directly over Node's
// built-in `https`, the same no-SDK approach this file's own header
// comment already established for webhook verification — the `stripe`
// npm package is not installed (only `razorpay` is a project dependency)
// and CLAUDE.md/mission instructions require an explicit decision before
// adding a new one; raw HTTPS avoids that decision entirely and keeps this
// file's existing style (Stripe's REST API is stable and documented, same
// as the GitHub/other raw-https integrations already in this codebase —
// see gitHubEngineeringAgent.cjs's _httpJson()).
//
// Stripe's Checkout Sessions API is form-urlencoded, not JSON (this is
// Stripe's actual, documented request contract — not invented here), and
// supports nested params via repeated bracketed keys
// (line_items[0][price]=..., line_items[0][quantity]=...).

function _encodeStripeParams(obj, prefix = "") {
    const pairs = [];
    for (const [key, val] of Object.entries(obj)) {
        if (val === undefined || val === null) continue;
        const fullKey = prefix ? `${prefix}[${key}]` : key;
        if (Array.isArray(val)) {
            val.forEach((item, i) => {
                if (item !== null && typeof item === "object") {
                    pairs.push(..._encodeStripeParams(item, `${fullKey}[${i}]`));
                } else {
                    pairs.push([`${fullKey}[${i}]`, item]);
                }
            });
        } else if (typeof val === "object") {
            pairs.push(..._encodeStripeParams(val, fullKey));
        } else {
            pairs.push([fullKey, val]);
        }
    }
    return pairs;
}

function _toFormBody(obj) {
    return _encodeStripeParams(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&");
}

/**
 * Low-level Stripe REST API POST call. Returns { status, body } on any
 * HTTP response (including 4xx/5xx — callers distinguish those), or
 * throws only on network-level failure (DNS, connection refused, timeout)
 * — same success/status-carrying-error shape as gitHubEngineeringAgent.cjs's
 * _httpJson(), so callers can apply the transient/permanent distinction
 * consistently with the rest of this codebase.
 */
function _stripePost(path_, secretKey, formBody, idempotencyKey) {
    return new Promise((resolve, reject) => {
        const data = formBody;
        const headers = {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(data),
            "Stripe-Version": STRIPE_API_VERSION,
        };
        if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

        const req = https.request({
            hostname: STRIPE_API_BASE,
            port: 443,
            path: path_,
            method: "POST",
            headers,
        }, res => {
            let raw = "";
            res.on("data", d => raw += d);
            res.on("end", () => {
                let parsed;
                try { parsed = JSON.parse(raw); } catch { parsed = null; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on("error", err => reject(err));
        req.setTimeout(15000, () => req.destroy(new Error("Stripe API request timed out")));
        req.write(data);
        req.end();
    });
}

/**
 * Create a real Stripe Checkout Session via Stripe's documented REST API
 * (POST /v1/checkout/sessions — https://stripe.com/docs/api/checkout/sessions/create).
 *
 * This function does NOT perform authentication, tenant authorization, or
 * price/amount validation — those are the caller's (route handler's)
 * responsibility, exactly like paymentService.js's createPaymentLink()
 * leaves auth/org-membership to payment.js. This function's only job is
 * the real external API call, with retry/error-shape handling.
 *
 * Success here means "Stripe accepted the session creation request" —
 * it does NOT mean payment succeeded. Callers must never treat a
 * successful session creation as a completed payment; only a verified
 * `checkout.session.completed` / `payment_intent.succeeded` webhook event
 * establishes that.
 *
 * @param {object} opts
 * @param {string} opts.priceId - a pre-existing Stripe Price id (price_...)
 *   OR opts.amount+opts.currency for an ad hoc line item. A Price id is
 *   preferred (Stripe's own recommended pattern) since it keeps pricing
 *   server-side/Stripe-side rather than trusting a client-supplied amount.
 * @param {number} [opts.amount] - minor-unit amount (e.g. cents) for an ad
 *   hoc price_data line item, used only when priceId is not supplied
 * @param {string} [opts.currency] - required when opts.amount is used
 * @param {string} [opts.productName] - line item display name for ad hoc pricing
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @param {string} [opts.customerEmail]
 * @param {object} [opts.metadata] - server-derived only (accountId, orgId,
 *   internal reference) — never pass through arbitrary client-supplied
 *   metadata verbatim
 * @param {string} [opts.mode] - "payment" (default) or "subscription"
 * @param {string|null} [opts.orgId] - org-scoped credential resolution
 * @param {string|null} [opts.idempotencyKey] - caller-supplied key; passed
 *   to Stripe as the real `Idempotency-Key` header (Stripe's own documented
 *   dedup mechanism: https://stripe.com/docs/api/idempotent_requests) —
 *   a repeated call with the same key returns Stripe's original response
 *   instead of creating a second session
 * @returns {Promise<{success:boolean, sessionId?:string, url?:string, error?:string, status?:number, retryable?:boolean}>}
 */
async function createCheckoutSession({
    priceId = null,
    amount = null,
    currency = "usd",
    productName = "Ooplix",
    successUrl,
    cancelUrl,
    customerEmail = null,
    metadata = {},
    mode = "payment",
    orgId = null,
    idempotencyKey = null,
} = {}) {
    if (process.env.DISABLE_PAYMENTS === "true") {
        return { success: false, error: "Payments disabled (DISABLE_PAYMENTS=true in .env)" };
    }
    if (!successUrl || !cancelUrl) {
        return { success: false, error: "successUrl and cancelUrl are required" };
    }
    if (!priceId && !(amount && currency)) {
        return { success: false, error: "Either priceId, or amount+currency, is required" };
    }
    if (!["payment", "subscription"].includes(mode)) {
        return { success: false, error: "mode must be 'payment' or 'subscription'" };
    }

    const secretKey = _resolveSecretKey(orgId);
    if (!secretKey) {
        return { success: false, error: "Payments not configured — set STRIPE_SECRET_KEY in .env, or connect via /my-connectors/stripe" };
    }

    const lineItem = priceId
        ? { price: priceId, quantity: 1 }
        : {
            price_data: {
                currency,
                product_data: { name: productName },
                unit_amount: amount,
            },
            quantity: 1,
        };

    // Subscription mode requires a real recurring Price — an ad hoc
    // price_data line item cannot carry a `recurring` interval through
    // Stripe's Checkout API for subscription mode, so ad hoc pricing is
    // only valid in "payment" mode. Reject early rather than letting
    // Stripe's 400 surface as an opaque generic error.
    if (mode === "subscription" && !priceId) {
        return { success: false, error: "subscription mode requires priceId (a pre-created recurring Stripe Price) — ad hoc pricing only supports mode:'payment'" };
    }

    const params = {
        mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [lineItem],
        metadata,
    };
    if (customerEmail) params.customer_email = customerEmail;

    const body = _toFormBody(params);

    const attempt = async () => {
        try {
            const res = await _stripePost("/v1/checkout/sessions", secretKey, body, idempotencyKey);
            if (res.status >= 200 && res.status < 300 && res.body?.id) {
                logger.info(`[Stripe] Checkout session created: ${res.body.id}`);
                return { success: true, status: res.status, sessionId: res.body.id, url: res.body.url };
            }
            return { success: false, status: res.status, stripeError: res.body?.error };
        } catch (err) {
            // Network-level failure (DNS/connection/timeout) — no status at all
            logger.error(`[Stripe] createCheckoutSession network error: ${err.message}`);
            return { success: false, status: null, networkError: err.message };
        }
    };

    let result = await attempt();
    // Retry only genuinely transient failures — a network error (no status)
    // or a 429/5xx — same transient/permanent split as
    // socialPublishSupport.cjs's withRetry() and this file's sibling
    // gitHubEngineeringAgent.cjs error mapping. 4xx (bad request, auth,
    // not found) is never retried since retrying it wastes an Idempotency-Key
    // slot for no benefit — Stripe will return the identical error.
    let attempts = 1;
    const maxRetries = 2;
    while (!result.success && attempts <= maxRetries) {
        const transient = !result.status || result.status === 429 || (result.status >= 500 && result.status < 600);
        if (!transient) break;
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempts - 1)));
        result = await attempt();
        attempts++;
    }

    if (result.success) return { success: true, sessionId: result.sessionId, url: result.url };

    // Never surface Stripe's raw error object (may include request ids,
    // internal codes) beyond a sanitized message — same posture as
    // paymentService.js's Razorpay error handling, which extracts only
    // `.description`/`.message`, never the full thrown value.
    if (result.networkError) {
        return { success: false, error: "Stripe API unreachable — network or timeout error", retryable: true };
    }
    const status = result.status;
    const stripeMsg = result.stripeError?.message;
    if (status === 401 || status === 403) {
        logger.error(`[Stripe] createCheckoutSession auth failure (status=${status})`);
        return { success: false, error: "Stripe authentication failed — check STRIPE_SECRET_KEY", status, retryable: false };
    }
    if (status === 429) {
        return { success: false, error: "Stripe rate limit exceeded — try again shortly", status, retryable: true };
    }
    if (status >= 500) {
        return { success: false, error: "Stripe service error — try again shortly", status, retryable: true };
    }
    // 4xx (400/404/etc) — sanitized version of Stripe's own message is safe
    // to return (it describes the malformed request, e.g. "invalid price id"),
    // unlike 401/403 where even acknowledging auth details is undesirable.
    return { success: false, error: stripeMsg || `Stripe request failed (status ${status})`, status, retryable: false };
}

module.exports = { isEnabled, verifyWebhookSignature, parseWebhookEvent, createCheckoutSession };
