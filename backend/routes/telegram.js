"use strict";
const router   = require("express").Router();
const telegram = require("../services/telegramService");
const { requireAuth } = require("../middleware/authMiddleware");

// POST /telegram/send  { chatId, message }
router.post("/telegram/send", requireAuth, async (req, res) => {
    const chatId  = req.body.chatId  || req.body.chat_id;
    const message = (req.body.message || req.body.text || "").trim();

    if (!chatId || !message) {
        return res.status(400).json({ success: false, error: "chatId and message required" });
    }
    if (!telegram.isConfigured()) {
        return res.status(503).json({ success: false, error: "Telegram not configured — set TELEGRAM_TOKEN in .env" });
    }

    const result = await telegram.sendMessage(chatId, message);
    return res.json({ success: result.sent, ...result });
});

// GET /telegram/status
router.get("/telegram/status", (_req, res) => {
    res.json({ configured: telegram.isConfigured() });
});

module.exports = router;
