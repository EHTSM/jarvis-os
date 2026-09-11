"use strict";
/**
 * V5 Global AI Organization Platform — Module 3: Organization Agents
 * Prefix: /org-agents/:orgId/*
 *
 * Same pattern as Modules 1/2: every route re-validates req.params.orgId
 * directly via orgAgents' own organizationService.hasPermission checks,
 * not attachOrg+requireOrgMember (which never reads req.params.orgId).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

const _try = fn => { try { return fn(); } catch { return null; } };
const _agents = () => _try(() => require("../services/orgAgents.cjs"));

// Agent execution is real work with real side effects (same class as
// Module 1's AI ask) — reuses the identical rate-limit shape, not a
// second limiter mechanism.
const _runRL = rateLimiter(30, 60_000, "org-agents-run");

router.use("/org-agents", requireAuth);

router.get("/org-agents/:orgId", (req, res) => {
  try {
    res.json({ ok: true, agents: _agents().listAgents(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/org-agents/:orgId/:agentId/run", _runRL, async (req, res) => {
  const { input, ...opts } = req.body || {};
  if (!input || typeof input !== "string") return res.status(400).json({ ok: false, error: "input string required" });
  try {
    const result = await _agents().runTask(req.params.orgId, req.user.sub, req.params.agentId, input, opts);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/org-agents/:orgId/history", (req, res) => {
  try {
    const { agentId, limit } = req.query;
    res.json({ ok: true, ..._agents().getHistory(req.params.orgId, req.user.sub, { agentId, limit: limit ? +limit : undefined }) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
