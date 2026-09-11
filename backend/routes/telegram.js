"use strict";
/**
 * Telegram routes. Communication Ecosystem mission: /telegram/send had no
 * rate limiter (unlike its sibling sms.js/slack.js) and no org context at
 * all (telegramService.js's own credential resolution now supports it —
 * see that file's header). Same attachOrg + _requireOrgMemberIfOrgContext
 * pattern as every other messaging route in this codebase: attachOrg alone
 * resolves req.org with NO membership check on its own, so it is paired
 * with the membership gate. A solo caller with no org at all falls through
 * to the documented global TELEGRAM_TOKEN env fallback, unaffected.
 */
const router   = require("express").Router();
const telegram = require("../services/telegramService");
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");

function _requireOrgMemberIfOrgContext(req, res, next) {
    if (!req.org) return next();
    return requireOrgMember(req, res, next);
}

const _telegramRL = rateLimiter(15, 60_000, "telegram-send");

// POST /telegram/send  { chatId, message }
router.post("/telegram/send", requireAuth, attachOrg, _requireOrgMemberIfOrgContext, _telegramRL, async (req, res) => {
    const chatId  = req.body.chatId  || req.body.chat_id;
    const message = (req.body.message || req.body.text || "").trim();

    if (!chatId || !message) {
        return res.status(400).json({ success: false, error: "chatId and message required" });
    }

    const orgId = req.org?.id || null;
    if (!telegram.isConfigured(orgId)) {
        return res.status(503).json({ success: false, error: "Telegram not configured — set TELEGRAM_TOKEN in .env, or connect via /my-connectors/telegram" });
    }

    const result = await telegram.sendMessage(chatId, message, orgId);
    return res.json({ success: result.sent, ...result });
});

// GET /telegram/status
router.get("/telegram/status", attachOrg, (req, res) => {
    res.json({ configured: telegram.isConfigured(req.org?.id || null) });
});

module.exports = router;
