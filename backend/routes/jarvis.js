"use strict";
const router      = require("express").Router();
const controller  = require("../controllers/jarvisController");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");
const billing     = require("../services/billingService");

// POST /jarvis — main AI gateway (the primary "AI Chat" tab's input for every
// account, customer and operator alike — despite the old comment here saying
// "operator auth required", requireAuth only checks for a session, not a
// role). This previously had no usage-quota enforcement at all, while the
// less-used /ai/chat and /ai/chat-with-tools routes did — meaning a
// customer's real AI usage (the main chat) was completely unmetered even
// though the plan's AI-action quota is shown to them on the dashboard.
router.post("/jarvis", requireAuth, rateLimiter(60, 60_000), billing.requireUsageQuota, controller.handleJarvis);

module.exports = router;
