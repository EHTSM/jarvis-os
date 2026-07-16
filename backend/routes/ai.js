"use strict";
const router = require("express").Router();
const ai     = require("../services/aiService");
const connectorTools = require("../services/connectorToolBridge.cjs");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/ai/chat", requireAuth, async (req, res) => {
    try {
        const { prompt, system, history, provider, model } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });
        const reply = await ai.callAI(prompt, { system, history, provider, model });
        res.json({ success: true, reply });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /ai/chat-with-tools — agent chat with connector tool-calling.
// Executes any tool calls the model requests (connector status/connect-url/
// list-connections — see connectorToolBridge.cjs) and returns both the
// model's tool call(s) and their real execution results.
router.post("/ai/chat-with-tools", requireAuth, async (req, res) => {
    try {
        const { prompt, system, history, provider, model } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });

        const messages = [
            { role: "system", content: system || "You are JARVIS. Use tools when the user asks about connected services or wants to connect a new one." },
            ...(Array.isArray(history) ? history : []),
            { role: "user", content: prompt },
        ];

        const tools  = connectorTools.getConnectorTools();
        const userId = req.user?.sub || req.user?.id || "default";
        const result = await ai.chatWithTools(messages, tools, { provider, model });

        const executed = result.toolCalls.map(call => {
            try {
                return { ...call, result: connectorTools.executeConnectorTool(call.name, call.arguments, userId) };
            } catch (e) {
                return { ...call, error: e.message };
            }
        });

        res.json({ success: true, text: result.text, toolCalls: executed, provider: result.provider, model: result.model });
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
