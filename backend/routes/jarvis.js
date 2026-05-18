"use strict";
const router      = require("express").Router();
const controller  = require("../controllers/jarvisController");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

// POST /jarvis — main AI gateway; operator auth required + rate limit
router.post("/jarvis", requireAuth, rateLimiter(60, 60_000), controller.handleJarvis);

module.exports = router;
