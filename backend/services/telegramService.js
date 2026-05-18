"use strict";
const axios = require("axios");

const API = "https://api.telegram.org";

function _token() { return process.env.TELEGRAM_TOKEN || ""; }

function _isDisabled() { return !_token(); }

/**
 * Send a text message to a Telegram chat.
 * @param {string|number} chatId
 * @param {string} text
 */
async function sendMessage(chatId, text) {
    if (_isDisabled()) return { sent: false, reason: "TELEGRAM_TOKEN not set" };
    if (!chatId || !text) return { sent: false, reason: "chatId and text required" };

    try {
        const res = await axios.post(
            `${API}/bot${_token()}/sendMessage`,
            { chat_id: chatId, text: String(text).slice(0, 4096), parse_mode: "HTML" },
            { timeout: 10_000 }
        );
        return { sent: true, messageId: res.data?.result?.message_id };
    } catch (err) {
        const code = err.response?.status;
        const desc = err.response?.data?.description || err.message;
        console.warn(`[Telegram] sendMessage failed (${code}): ${desc}`);
        return { sent: false, reason: desc, status: code };
    }
}

function isConfigured() { return !!_token(); }

module.exports = { sendMessage, isConfigured };
