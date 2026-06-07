"use strict";
const router = require("express").Router();
const ai     = require("../services/aiService");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/ai/chat", requireAuth, async (req, res) => {
    try {
        const { prompt, system, history, provider, model } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });
        const reply = await ai.callAI(prompt, { system, history, provider, model });
        res.json({ success: true, reply });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /ai/status — live provider health, active provider, failure log
// Auth required so this doesn't leak API key presence to the public
router.get("/ai/status", requireAuth, async (req, res) => {
    try {
        const status = await ai.getAIStatus();
        res.json({ success: true, ...status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
