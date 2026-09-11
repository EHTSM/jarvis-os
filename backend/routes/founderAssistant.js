"use strict";
/**
 * V6 Phase 8 (Personal JARVIS) — Founder Assistant conversational entrypoint
 * Prefix: /assistant/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");
const billing = require("../services/billingService");

function _svc() { return require("../services/founderAssistantEngine.cjs"); }

router.post("/assistant/ask", requireAuth, rateLimiter(30, 60_000), billing.requireUsageQuota, async (req, res) => {
  try {
    const { prompt, history } = req.body || {};
    if (!prompt) return res.status(400).json({ ok: false, error: "prompt required" });
    const result = await _svc().ask(prompt, { history });
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json(result);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/assistant/briefing", requireAuth, (req, res) => {
  try { res.json(_svc().getBriefing()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
