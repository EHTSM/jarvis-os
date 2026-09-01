"use strict";
/**
 * Twilio SMS Service — real Twilio REST API SMS sending.
 *
 * Communication Ecosystem mission: M76's discovery confirmed Twilio had a
 * real, working authentication health-probe (integrationConnectors.cjs's
 * connectTwilio(), Basic Auth against the real Accounts.json endpoint) but
 * zero send capability anywhere in the repo — no smsService/twilioService
 * file, no `messages.create` call, despite all 3 Twilio env vars already
 * being templated in .env.example. This is the missing "actually send"
 * half, following the exact sibling shape whatsappService.js/
 * telegramService.js already established: org-scoped vault-then-env
 * credential resolution, retry with an auth cooldown to stop hammering
 * Twilio after a real 401/403, a DISABLE_TWILIO kill-switch, and an
 * honest {success, error} result — never a fabricated success.
 *
 * Real API: POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 * (form-encoded, HTTP Basic Auth — the exact same auth mechanism
 * connectTwilio()'s own health-probe already uses and verifies).
 */

const axios  = require("axios");
const logger = require("../utils/logger");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

// Twilio's real API base — Account SID is part of the URL path itself,
// unlike WhatsApp/Telegram where the credential is only in a header.
const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const CONNECTOR_ID = "msg:twilio";

// Connector Secret Isolation: same pattern already established for
// WhatsApp/Telegram/social platforms — an org's own connected Twilio
// account (via /my-connectors/twilio, once added) resolves first; the
// founder's global env vars remain the fallback for orgId=null or an org
// with no connected account, so single-tenant use is unaffected.
function _accountSid(orgId) {
    if (orgId) {
        // Reuses the existing "webhook_secret" vault slot for the second
        // credential field, same reuse-an-existing-slot convention
        // whatsappService.js already uses for its own second field
        // (Phone Number ID) and myConnectors.js documents for Razorpay's
        // Key Secret — the vault's CRED_TYPES enum has no dedicated
        // "account_sid" type, and adding one for a single field would
        // expand the vault's type set rather than reuse it.
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "webhook_secret", orgId));
        if (v) return v;
    }
    return process.env.TWILIO_ACCOUNT_SID || "";
}
function _authToken(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "api_key", orgId));
        if (v) return v;
    }
    return process.env.TWILIO_AUTH_TOKEN || "";
}
function _fromNumber(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "smtp_credentials", orgId));
        if (v) return v;
    }
    return process.env.TWILIO_PHONE_NUMBER || "";
}

function isConfigured(orgId = null) {
    return !!(_accountSid(orgId) && _authToken(orgId) && _fromNumber(orgId));
}

// Auth cooldown — same reasoning and shape as whatsappService.js's: after
// a real 401/403 (bad/revoked credentials), stop retrying for
// AUTH_COOLDOWN_MS to avoid hammering Twilio and spamming logs. Keyed
// per-scope (org id, or "global") so one org's bad token doesn't cool
// down sends for every other tenant using their own connected account.
const AUTH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const _authCooldownUntil = new Map();

/** Reset the auth cooldown (call after updating credentials and reloading, or per-org after re-connecting). */
function resetAuthCooldown(orgId = "global") { _authCooldownUntil.delete(orgId); }

function _sanitizePhone(phone) {
    return String(phone).replace(/[^\d+]/g, "");
}

const MAX_SMS_LENGTH = 1600; // Twilio's real documented long-SMS concatenation cap

/**
 * Send a plain-text SMS with retry.
 * @param {string} to - destination phone number, E.164 format preferred
 * @param {string} text - SMS body, max 1600 chars (Twilio's real concatenation limit)
 * @param {number} retries
 * @param {string|null} orgId - when set, resolves this org's own vault-stored
 *   Twilio credentials first; omit to use the founder's global env-configured account.
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSMS(to, text, retries = 2, orgId = null) {
    const scope       = orgId || "global";
    const accountSid  = _accountSid(orgId);
    const authToken   = _authToken(orgId);
    const fromNumber  = _fromNumber(orgId);

    if (process.env.DISABLE_TWILIO === "true") {
        return { success: false, error: "Twilio disabled (DISABLE_TWILIO=true in .env)" };
    }
    if (typeof text !== "string" || !text.trim()) {
        return { success: false, error: "text required" };
    }
    if (text.length > MAX_SMS_LENGTH) {
        return { success: false, error: `text exceeds Twilio's ${MAX_SMS_LENGTH} character concatenation limit (${text.length} chars)` };
    }
    if (!accountSid || !authToken || !fromNumber) {
        logger.warn(`[Twilio] Not configured for scope=${scope} — set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER in .env or connect via /my-connectors/twilio`);
        return { success: false, error: "Twilio not configured" };
    }

    if (Date.now() < (_authCooldownUntil.get(scope) || 0)) {
        return { success: false, error: "Twilio auth failed — check your Account SID/Auth Token in the Twilio Console" };
    }

    const toNumber = _sanitizePhone(to);
    if (!toNumber || toNumber.replace(/\D/g, "").length < 7) return { success: false, error: "Invalid phone number" };

    const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const body  = new URLSearchParams({ To: toNumber, From: fromNumber, Body: text }).toString();

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await axios.post(
                `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`,
                body,
                {
                    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
                    timeout: 12000,
                }
            );
            const messageId = res.data?.sid || null;
            logger.info(`[Twilio] SMS sent to ${toNumber}${messageId ? ` (${messageId})` : ""}`);
            return { success: true, messageId };
        } catch (err) {
            const detail = err.response?.data?.message || err.message;
            const status = err.response?.status;

            if (status === 400 || status === 401 || status === 403 || status === 404) {
                _authCooldownUntil.set(scope, Date.now() + AUTH_COOLDOWN_MS);
                logger.error(`[Twilio] Permanent/Config error (${status}) for scope=${scope}: ${detail} — pausing Twilio sends for this scope for 1 hour.`);
                return { success: false, error: "Twilio send failed — configuration error, please contact support" };
            }

            if (attempt < retries) {
                logger.warn(`[Twilio] Attempt ${attempt + 1} failed (${detail}), retrying in ${1500 * (attempt + 1)}ms...`);
                await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            } else {
                logger.error(`[Twilio] All attempts failed: ${detail}`);
                return { success: false, error: "Twilio SMS send failed after multiple attempts" };
            }
        }
    }
    return { success: false, error: "Unknown error" };
}

module.exports = { sendSMS, isConfigured, resetAuthCooldown };
