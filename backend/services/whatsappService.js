"use strict";
/**
 * WhatsApp Business API Service.
 * Supports both token naming conventions from .env.
 */

const crypto = require("crypto");
const axios  = require("axios");
const logger = require("../utils/logger");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

// Connector Secret Isolation: this service used to read only the founder's
// global process.env WA_TOKEN, ignoring any per-org WhatsApp credential a
// customer stored via myConnectors.js (vault connectorId "msg:whatsapp").
// sendMessage() now accepts an optional orgId and, when present, resolves
// that org's own vault-stored token/phoneId FIRST, falling back to the
// global env only if the org has none configured — so an org that has
// connected its own WhatsApp account actually sends through it, and never
// silently uses (or is silently blocked by) another tenant's credentials.
// Omitting orgId preserves the exact prior global-env-only behavior.
function _token(orgId)   {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.("msg:whatsapp", "api_key", orgId));
        if (v) return v;
    }
    return process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN || "";
}
function _phoneId(orgId) {
    if (orgId) {
        // Phone Number ID is stored under credential type "webhook_secret" —
        // matches myConnectors.js's PROVIDERS.whatsapp field mapping (the
        // vault only supports a fixed CRED_TYPES enum; this reuses an
        // existing slot rather than expanding the vault's type set for one
        // field, same convention already used for Razorpay's Key Secret).
        const v = _try(() => _vault()?.getSecret?.("msg:whatsapp", "webhook_secret", orgId));
        if (v) return v;
    }
    return process.env.WA_PHONE_ID || process.env.PHONE_NUMBER_ID || "";
}
function _version() { return process.env.WA_API_VERSION || "v19.0"; }

function _webhookSecret() {
    return process.env.WA_WEBHOOK_SECRET
        || process.env.WHATSAPP_WEBHOOK_SECRET
        || process.env.WA_APP_SECRET
        || process.env.WHATSAPP_APP_SECRET
        || "";
}

const _REPLAY_TTL_MS = 10 * 60_000; // 10 minutes
const _recentWebhookKeys = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of _recentWebhookKeys) {
        if (now - ts > _REPLAY_TTL_MS) _recentWebhookKeys.delete(key);
    }
}, 60_000).unref();

function _normalizeSignature(signature) {
    if (!signature || typeof signature !== "string") return "";
    const prefix = "sha256=";
    return signature.trim().startsWith(prefix)
        ? signature.trim().slice(prefix.length).trim()
        : signature.trim();
}

function verifyWebhookSignature(rawBody, signature) {
    const secret = _webhookSecret();
    if (!secret) {
        if (process.env.NODE_ENV !== "production") return true;
        return false;
    }

    const provided = _normalizeSignature(signature);
    if (!provided) return false;

    try {
        const expected = crypto.createHmac("sha256", secret)
            .update(String(rawBody))
            .digest("hex");
        const expectedBuf = Buffer.from(expected, "hex");
        const providedBuf = Buffer.from(provided, "hex");
        if (providedBuf.length !== expectedBuf.length) return false;
        return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
        return false;
    }
}

function registerWebhookEvent(body) {
    const msg = parseIncomingMessage(body);
    const key = msg?.msgId
        ? `msg:${msg.msgId}`
        : `body:${crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;

    if (_recentWebhookKeys.has(key)) return false;
    _recentWebhookKeys.set(key, Date.now());
    return true;
}

function _sanitizePhone(phone) {
    return String(phone).replace(/\D/g, "").replace(/^0+/, "");
}

// Auth cooldown — after a 401/403 we stop retrying for AUTH_COOLDOWN_MS to avoid log spam.
// Keyed per-scope (org id, or "global" for the founder's own credentials) so
// one org's bad/expired token doesn't cool down sends for every other
// tenant using their own connected WhatsApp account.
const AUTH_COOLDOWN_MS = 60 * 60 * 1000;  // 1 hour
const _authCooldownUntil = new Map();

/** Reset the auth cooldown (call after updating WA_TOKEN in .env and reloading, or per-org after re-connecting). */
function resetAuthCooldown(orgId = "global") { _authCooldownUntil.delete(orgId); }

/**
 * Send a plain text WhatsApp message with retry.
 * @param {string} phone
 * @param {string} text
 * @param {number} retries
 * @param {string|null} orgId - when set, resolves this org's own vault-stored
 *   WhatsApp credential first (see _token/_phoneId above); omit to use the
 *   founder's global env-configured account (prior behavior, unaffected).
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendMessage(phone, text, retries = 2, orgId = null) {
    const scope   = orgId || "global";
    const token   = _token(orgId);
    const phoneId = _phoneId(orgId);

    if (process.env.DISABLE_WHATSAPP === "true") {
        return { success: false, error: "WhatsApp disabled (DISABLE_WHATSAPP=true in .env)" };
    }

    if (!token || !phoneId) {
        logger.warn(`[WA] Not configured for scope=${scope} — set WA_TOKEN/PHONE_NUMBER_ID in .env or connect via /my-connectors/whatsapp`);
        return { success: false, error: "WhatsApp not configured" };
    }

    // Suppress retries during auth cooldown — token is known bad, no point spamming Meta.
    if (Date.now() < (_authCooldownUntil.get(scope) || 0)) {
        return { success: false, error: "WhatsApp auth failed — regenerate token in Meta Business Manager" };
    }

    const to = _sanitizePhone(phone);
    if (!to || to.length < 7) return { success: false, error: "Invalid phone number" };

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await axios.post(
                `https://graph.facebook.com/${_version()}/${phoneId}/messages`,
                {
                    messaging_product: "whatsapp",
                    to,
                    type: "text",
                    text: { body: String(text) }
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 12000
                }
            );

            const msgId = res.data?.messages?.[0]?.id || null;
            logger.info(`[WA] Sent to ${to}${msgId ? ` (${msgId})` : ""}`);
            return { success: true, messageId: msgId };

        } catch (err) {
            // Client Error / Failure-Honesty Leakage Audit (2026-08-21):
            // `detail` is Meta's raw Graph API error body — live-reproduced,
            // it can contain real internal identifiers (e.g. the configured
            // WA_PHONE_ID value) verbatim in the message text, not just
            // generic wording. This flowed straight through to the customer
            // via POST /whatsapp/send and POST /payment/link (phone-notify
            // path). Full detail is still logged server-side (unchanged);
            // only the client-facing value is now a fixed, safe string.
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;

            // Auth/Config errors: set cooldown so automation stops hammering Meta for the next hour.
            if (status === 400 || status === 401 || status === 403 || status === 404) {
                _authCooldownUntil.set(scope, Date.now() + AUTH_COOLDOWN_MS);
                logger.error(`[WA] Permanent/Config error (${status}) for scope=${scope}: ${detail} — pausing WA sends for this scope for 1 hour.`);
                return { success: false, error: "WhatsApp send failed — configuration error, please contact support" };
            }

            if (attempt < retries) {
                logger.warn(`[WA] Attempt ${attempt + 1} failed (${detail}), retrying in ${1500 * (attempt + 1)}ms...`);
                await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            } else {
                logger.error(`[WA] All attempts failed: ${detail}`);
                return { success: false, error: "WhatsApp send failed after multiple attempts" };
            }
        }
    }
    return { success: false, error: "Unknown error" };
}

/**
 * Verify WhatsApp webhook challenge (GET /whatsapp/webhook).
 */
function verifyWebhook(query) {
    const verifyToken = process.env.WA_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
    if (!verifyToken) {
        logger.error("[WA] WA_VERIFY_TOKEN not set — webhook verification will always fail. Set it in .env and on the Meta dashboard.");
        return { valid: false };
    }
    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === verifyToken) {
        return { valid: true, challenge: query["hub.challenge"] };
    }
    return { valid: false };
}

/**
 * Parse incoming WhatsApp webhook payload.
 * Returns { phone, text } or null.
 */
function parseIncomingMessage(body) {
    try {
        const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!msg) return null;
        return {
            phone:   msg.from,
            text:    msg.text?.body || "",
            type:    msg.type,
            msgId:   msg.id,
            timestamp: msg.timestamp
        };
    } catch {
        return null;
    }
}

module.exports = {
    sendMessage,
    verifyWebhook,
    verifyWebhookSignature,
    registerWebhookEvent,
    parseIncomingMessage,
    resetAuthCooldown
};
