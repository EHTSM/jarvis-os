const axios = require("axios");

async function sendTelegram(chatId, text) {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
        console.warn("TELEGRAM_TOKEN not set");
        return;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text
        });
    } catch (err) {
        console.error("Telegram error:", err.message);
    }
}

module.exports = { sendTelegram };
