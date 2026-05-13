"use strict";
const router = require("express").Router();
const ai     = require("../services/aiService");

router.post("/ai/chat", async (req, res) => {
    try {
        const { prompt, system, history } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });
        const reply = await ai.callAI(prompt, { system, history });
        res.json({ success: true, reply });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
