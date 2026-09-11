"use strict";
/**
 * V5 Global AI Organization Platform — Module 1: Organization AI Brain
 * Prefix: /org-ai/:orgId/*
 *
 * SECURITY NOTE (lesson carried forward from the Enterprise & Physical
 * Integration mission's Module 7/8 fix): orgMiddleware.cjs's attachOrg
 * only reads orgId from the X-Org-Id header / req.query.orgId /
 * req.body.orgId — never req.params.orgId. Every route here takes orgId
 * as a URL path param, so attachOrg+requireOrgMember would silently
 * check membership in the wrong org. Every route below instead passes
 * req.params.orgId straight into orgAiBrain's own functions, which
 * re-validate real membership/permission via organizationService.
 * hasPermission themselves — no reliance on that middleware pairing.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

const _try = fn => { try { return fn(); } catch { return null; } };
const _brain = () => _try(() => require("../services/orgAiBrain.cjs"));

// AI execution is real-cost, real-latency work — same class of protection
// as /auth/login's rate limiter, reused here rather than a second limiter.
const _askRL = rateLimiter(30, 60_000, "org-ai-ask");

router.use("/org-ai", requireAuth);

router.post("/org-ai/:orgId/ask", _askRL, async (req, res) => {
  const { messages, ...opts } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: "messages array required" });
  try {
    const result = await _brain().ask(req.params.orgId, req.user.sub, messages, opts);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code });
  }
});

// SSE streaming — same shape convention as other streaming endpoints in
// this codebase (Content-Type text/event-stream, one JSON chunk per event).
router.post("/org-ai/:orgId/ask-stream", _askRL, async (req, res) => {
  const { messages, ...opts } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: "messages array required" });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  try {
    const result = await _brain().askStream(req.params.orgId, req.user.sub, messages, opts, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: "chunk", chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: "done", ...result })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: "error", error: e.message, code: e.code })}\n\n`);
    res.end();
  }
});

router.get("/org-ai/:orgId/recommend/:capability", async (req, res) => {
  try {
    res.json({ ok: true, ...await _brain().recommend(req.params.orgId, req.user.sub, req.params.capability, req.query) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/org-ai/:orgId/history", (req, res) => {
  try {
    const { limit, since, capability, provider } = req.query;
    res.json({ ok: true, history: _brain().getHistory(req.params.orgId, req.user.sub, { limit: limit ? +limit : undefined, since, capability, provider }) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/org-ai/:orgId/usage", (req, res) => {
  try {
    res.json({ ok: true, ..._brain().getUsage(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// Express 5 (path-to-regexp v6+) dropped the ":param?" optional shorthand,
// so "all providers" vs "one provider" are two explicit routes.
router.get("/org-ai/:orgId/provider-health", async (req, res) => {
  try {
    res.json({ ok: true, health: await _brain().getProviderHealth(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/org-ai/:orgId/provider-health/:providerId", async (req, res) => {
  try {
    res.json({ ok: true, health: await _brain().getProviderHealth(req.params.orgId, req.user.sub, req.params.providerId) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
