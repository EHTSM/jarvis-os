"use strict";
const router = require("express").Router();
const ai     = require("../services/aiService");
const connectorTools = require("../services/connectorToolBridge.cjs");
const usageMetering  = require("../services/usageMetering.cjs");
const billing        = require("../services/billingService");
const { requireAuth } = require("../middleware/authMiddleware");
// Phase B.14: attachOrg is the existing org-resolution middleware used across the
// org-scoped surfaces. /ai routes never mounted it, so req.org was always undefined
// and every usageMetering.record() below wrote orgId:null — see the block comment on
// the /ai/chat handler for the reproduction.
const { attachOrg } = require("../middleware/orgMiddleware.cjs");
const rateLimiter    = require("../middleware/rateLimiter");

// Phase B.14: every usageMetering.record() on these routes wrote orgId:null, so
// org-level AI spend reporting was always zero. Reproduced live: the usage ledger
// held 636 events, 252 for the test account, and 0 tagged with its orgId — while
// GET /enterprise/monitoring/:orgId/ai-usage reported requestsLast1000=0 and
// totalCostUsdSampled=0 against $8.24 of real recorded spend. Confirmed by sending
// X-Org-Id on a call from an account with quota remaining: the ledger row still
// carried orgId=None.
//
// usageMetering.record() has always accepted orgId (usageMetering.cjs:87) and
// jarvisController already passes req.org?.id (jarvisController.js:357). These routes
// simply never mounted attachOrg, so req.org was undefined. Mounting the existing
// middleware and forwarding the existing field — no new service, no new model.
router.post("/ai/chat", requireAuth, attachOrg, rateLimiter(30, 60_000), billing.requireUsageQuota, async (req, res) => {
    const t0 = Date.now();
    try {
        const { prompt, system, history, provider, model } = req.body;
        if (!prompt) return res.status(400).json({ error: "prompt required" });
        const reply = await ai.callAI(prompt, { system, history, provider, model });

        // A.10 fix: callAI() does not throw when every provider fails — it
        // resolves to the sentinel string below (aiService.js's last line).
        // This route used to return it as { success: true, reply }, so a
        // total provider outage was rendered to the founder as if the AI had
        // replied with that sentence, and was recorded in usage metering as a
        // successful call. Detect it the same way creativeStudio.js already
        // does (A.7 fix) and surface the real failure instead.
        if (typeof reply !== "string" || !reply.trim() || reply.startsWith("AI backend unavailable")) {
            usageMetering.record({
                accountId: req.user?.sub || req.user?.id, orgId: req.org?.id || null, workspaceId: req.workspace?.id || undefined, provider: provider || "unknown",
                model: model || "unknown", requestType: "chat", latencyMs: Date.now() - t0,
                success: false, errorCode: "all_providers_failed",
            });
            return res.status(502).json({
                error: reply || "AI generation returned no content. Check provider API keys in your .env file.",
            });
        }

        usageMetering.record({
            accountId: req.user?.sub || req.user?.id, orgId: req.org?.id || null, workspaceId: req.workspace?.id || undefined, provider: provider || "unknown",
            model: model || "unknown", requestType: "chat", latencyMs: Date.now() - t0, success: true,
        });
        res.json({ success: true, reply });
    } catch (err) {
        usageMetering.record({
            accountId: req.user?.sub || req.user?.id, orgId: req.org?.id || null, workspaceId: req.workspace?.id || undefined, provider: req.body?.provider || "unknown",
            latencyMs: Date.now() - t0, success: false, errorCode: err.message,
        });
        res.status(500).json({ error: err.message });
    }
});

// POST /ai/chat-with-tools — agent chat with connector tool-calling.
// Executes any tool calls the model requests (connector status/connect-url/
// list-connections — see connectorToolBridge.cjs) and returns both the
// model's tool call(s) and their real execution results.
router.post("/ai/chat-with-tools", requireAuth, attachOrg, rateLimiter(30, 60_000), billing.requireUsageQuota, async (req, res) => {
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
            accountId: userId, orgId: req.org?.id || null, workspaceId: req.workspace?.id || undefined, provider: result.provider, model: result.model,
            requestType: "chat_with_tools", latencyMs: Date.now() - t0, success: true,
        });
        res.json({ success: true, text: result.text, toolCalls: executed, provider: result.provider, model: result.model });
    } catch (err) {
        usageMetering.record({
            accountId: req.user?.sub || req.user?.id, orgId: req.org?.id || null, workspaceId: req.workspace?.id || undefined, provider: req.body?.provider || "unknown",
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
