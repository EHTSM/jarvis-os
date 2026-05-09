/**
 * Notification Agent (infrastructure layer) — unified multi-channel delivery.
 * Reuses utils/whatsapp.cjs and automation/telegram.cjs — zero duplication.
 */

const { sendWhatsApp: _sendWA } = require("../../utils/whatsapp.cjs");
const { sendTelegram: _sendTG } = require("../../automation/telegram.cjs");

async function sendWhatsApp({ phone, message }) {
    if (!phone || !message) return { success: false, error: "phone and message are required" };

    try {
        await _sendWA(phone, message);
        return { success: true, channel: "whatsapp", phone, deliveredAt: new Date().toISOString() };
    } catch (err) {
        return { success: false, channel: "whatsapp", error: err.message };
    }
}

async function sendTelegram({ chatId, message }) {
    if (!chatId || !message) return { success: false, error: "chatId and message are required" };

    try {
        await _sendTG(chatId, message);
        return { success: true, channel: "telegram", chatId, deliveredAt: new Date().toISOString() };
    } catch (err) {
        return { success: false, channel: "telegram", error: err.message };
    }
}

async function sendBroadcast({ phone, chatId, message }) {
    if (!message) return { success: false, error: "message is required" };

    const results = {};
    if (phone)  results.whatsapp = await sendWhatsApp({ phone, message });
    if (chatId) results.telegram = await sendTelegram({ chatId, message });

    const anySuccess = Object.values(results).some(r => r.success);
    return { success: anySuccess, results };
}

module.exports = { sendWhatsApp, sendTelegram, sendBroadcast };
