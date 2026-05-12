"use strict";
/**
 * WhatsApp Business API Service.
 * Supports both token naming conventions from .env.
 */

const axios  = require("axios");
const logger = require("../utils/logger");

function _token()   { return process.env.WA_TOKEN   || process.env.WHATSAPP_TOKEN || ""; }
function _phoneId() { return process.env.WA_PHONE_ID || process.env.PHONE_NUMBER_ID || ""; }
function _version() { return process.env.WA_API_VERSION || "v19.0"; }

function _sanitizePhone(phone) {
    return String(phone).replace(/\D/g, "").replace(/^0+/, "");
}

// Auth cooldown — after a 401/403 we stop retrying for AUTH_COOLDOWN_MS to avoid log spam.
const AUTH_COOLDOWN_MS = 60 * 60 * 1000;  // 1 hour
let _authCooldownUntil = 0;

/** Reset the auth cooldown (call after updating WA_TOKEN in .env and reloading). */
function resetAuthCooldown() { _authCooldownUntil = 0; }

/**
 * Send a plain text WhatsApp message with retry.
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendMessage(phone, text, retries = 2) {
    const token   = _token();
    const phoneId = _phoneId();

    if (process.env.DISABLE_WHATSAPP === "true") {
        return { success: false, error: "WhatsApp disabled (DISABLE_WHATSAPP=true in .env)" };
    }

    if (!token || !phoneId) {
        logger.warn("[WA] Not configured — set WA_TOKEN and PHONE_NUMBER_ID in .env");
        return { success: false, error: "WhatsApp not configured" };
    }

    // Suppress retries during auth cooldown — token is known bad, no point spamming Meta.
    if (Date.now() < _authCooldownUntil) {
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
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;

            // Auth errors: set cooldown so automation stops hammering Meta for the next hour.
            if (status === 401 || status === 403) {
                _authCooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
                logger.error(`[WA] Auth error (${status}) — pausing WA sends for 1 hour. Regenerate token in Meta Business Manager > WhatsApp > Accounts.`);
                return { success: false, error: `Auth error: ${detail}` };
            }

            if (attempt < retries) {
                logger.warn(`[WA] Attempt ${attempt + 1} failed (${detail}), retrying in ${1500 * (attempt + 1)}ms...`);
                await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            } else {
                logger.error(`[WA] All attempts failed: ${detail}`);
                return { success: false, error: detail };
            }
        }
    }
    return { success: false, error: "Unknown error" };
}

/**
 * Verify WhatsApp webhook challenge (GET /whatsapp/webhook).
 */
function verifyWebhook(query) {
    const verifyToken = process.env.WA_VERIFY_TOKEN || process.env.VERIFY_TOKEN || "jarvis_verify";
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

module.exports = { sendMessage, verifyWebhook, parseIncomingMessage, resetAuthCooldown };
