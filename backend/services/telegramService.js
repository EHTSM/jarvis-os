"use strict";
/**
 * Communication Ecosystem mission (M76 resume): Telegram's real send path
 * (sendMessage) already existed and is LIVE AUTH VERIFIED (per this
 * mission's own instruction, not re-tested here) — the genuine gap was
 * org-scoped credential resolution, which every sibling adapter (Twilio,
 * WhatsApp, Discord, Slack) already has and Telegram alone lacked. Adds
 * the same vault-then-env pattern, orgId-scoped auth cooldown, and
 * DISABLE_TELEGRAM kill-switch already established elsewhere — sendMessage
 * itself (the real API call) is unchanged.
 */
const axios  = require("axios");
const logger = require("../utils/logger");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

const API = "https://api.telegram.org";
const CONNECTOR_ID = "msg:telegram";

function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "api_key", orgId));
        if (v) return v;
    }
    return process.env.TELEGRAM_TOKEN || "";
}

function isConfigured(orgId = null) { return !!_token(orgId); }

// Auth cooldown — same reasoning and shape as twilioService.js/
// whatsappService.js/slackService.js: after a real 401/403/404 (bad/revoked
// bot token, or a chat the bot cannot message), stop retrying for
// AUTH_COOLDOWN_MS. Keyed per-scope so one org's bad token doesn't cool
// down sends for every other tenant using their own connected bot.
const AUTH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const _authCooldownUntil = new Map();

/** Reset the auth cooldown (call after updating credentials and reloading, or per-org after re-connecting). */
function resetAuthCooldown(orgId = "global") { _authCooldownUntil.delete(orgId); }

/**
 * Send a text message to a Telegram chat.
 * @param {string|number} chatId
 * @param {string} text
 * @param {string|null} [orgId] - when set, resolves this org's own
 *   vault-stored Telegram bot token first; omit to use the founder's
 *   global env-configured bot (prior behavior, unaffected).
 */
async function sendMessage(chatId, text, orgId = null) {
    const scope = orgId || "global";
    const token = _token(orgId);

    if (process.env.DISABLE_TELEGRAM === "true") {
        return { sent: false, reason: "Telegram disabled (DISABLE_TELEGRAM=true in .env)" };
    }
    if (!token) return { sent: false, reason: "TELEGRAM_TOKEN not set" };
    if (!chatId || !text) return { sent: false, reason: "chatId and text required" };

    if (Date.now() < (_authCooldownUntil.get(scope) || 0)) {
        return { sent: false, reason: "Telegram auth failed — check your bot token in @BotFather" };
    }

    try {
        const res = await axios.post(
            `${API}/bot${token}/sendMessage`,
            { chat_id: chatId, text: String(text).slice(0, 4096), parse_mode: "HTML" },
            { timeout: 10_000 }
        );
        return { sent: true, messageId: res.data?.result?.message_id };
    } catch (err) {
        const code = err.response?.status;
        const desc = err.response?.data?.description || err.message;
        if (code === 401 || code === 403 || code === 404) {
            _authCooldownUntil.set(scope, Date.now() + AUTH_COOLDOWN_MS);
            logger.error(`[Telegram] Auth/config error (${code}) for scope=${scope}: ${desc} — pausing Telegram sends for this scope for 1 hour.`);
        } else {
            logger.warn(`[Telegram] sendMessage failed (${code}): ${desc}`);
        }
        return { sent: false, reason: desc, status: code };
    }
}

module.exports = { sendMessage, isConfigured, resetAuthCooldown };
