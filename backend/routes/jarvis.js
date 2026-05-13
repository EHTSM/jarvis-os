"use strict";
const router      = require("express").Router();
const controller  = require("../controllers/jarvisController");
const { optionalAuth } = require("../middleware/firebaseAuth");
const rateLimiter = require("../middleware/rateLimiter");

// POST /jarvis — main AI gateway (60 req/min per IP)
router.post("/jarvis", optionalAuth, rateLimiter(60, 60_000), controller.handleJarvis);

module.exports = router;
