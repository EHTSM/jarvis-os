/**
 * Notification Agent — delivers output to WhatsApp and/or Telegram.
 * Uses existing utils/whatsapp.cjs and automation/telegram.cjs.
 * skipWhatsApp flag prevents double-sending when moneyFlow already sent.
 */
const { sendWhatsApp }  = require("../../utils/whatsapp.cjs");
const { sendTelegram }  = require("../../automation/telegram.cjs");

async function send(phone, message, options = {}) {
    const results = { whatsapp: false, telegram: false };

    // WhatsApp delivery
    if (phone && !options.skipWhatsApp) {
        try {
            await sendWhatsApp(phone, message);
            results.whatsapp = true;
        } catch (err) {
            console.error("📵 Notification WA error:", err.message);
        }
    }

    // Telegram delivery (optional — pass telegramChatId)
    if (options.telegramChatId) {
        try {
            await sendTelegram(options.telegramChatId, message);
            results.telegram = true;
        } catch (err) {
            console.error("📵 Notification TG error:", err.message);
        }
    }

    return results;
}

module.exports = { send };
