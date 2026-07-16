"use strict";
const router = require("express").Router();
const ai     = require("../services/aiService");
const connectorTools = require("../services/connectorToolBridge.cjs");
const usageMetering  = require("../services/usageMetering.cjs");
const billing        = require("../services/billingService");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/ai/chat", requireAuth, billing.requireUsageQuota, async (req, res) => {
    const t0 = Date.now();
    try {
        const { prompt, system, history, provider, model } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });
        const reply = await ai.callAI(prompt, { system, history, provider, model });
        usageMetering.record({
            accountId: req.user?.sub || req.user?.id, provider: provider || "unknown",
            model: model || "unknown", requestType: "chat", latencyMs: Date.now() - t0, success: true,
        });
        res.json({ success: true, reply });
    } catch (err) {
        usageMetering.record({
            accountId: req.user?.sub || req.user?.id, provider: req.body?.provider || "unknown",
            latencyMs: Date.now() - t0, success: false, errorCode: err.message,
        });
        res.status(500).json({ error: err.message });
    }
});

// POST /ai/chat-with-tools — agent chat with connector tool-calling.
// Executes any tool calls the model requests (connector status/connect-url/
// list-connections — see connectorToolBridge.cjs) and returns both the
// model's tool call(s) and their real execution results.
router.post("/ai/chat-with-tools", requireAuth, billing.requireUsageQuota, async (req, res) => {
    const t0 = Date.now();
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

        usageMetering.record({
            accountId: userId, provider: result.provider, model: result.model,
            requestType: "chat_with_tools", latencyMs: Date.now() - t0, success: true,
        });
        res.json({ success: true, text: result.text, toolCalls: executed, provider: result.provider, model: result.model });
    } catch (err) {
        usageMetering.record({
            accountId: req.user?.sub || req.user?.id, provider: req.body?.provider || "unknown",
            requestType: "chat_with_tools", latencyMs: Date.now() - t0, success: false, errorCode: err.message,
        });
        res.status(500).json({ error: err.message });
    }
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
