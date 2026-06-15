"use strict";
/**
 * K2 — Enterprise Security routes
 *
 * GET    /security/sessions          — active sessions for workspace
 * DELETE /security/session/:id       — revoke a session
 * GET    /security/devices           — trusted devices for workspace
 * DELETE /security/device/:id        — remove a device
 * GET    /security/audit             — security audit log
 * GET    /security/policies          — workspace security policies
 * PATCH  /security/policies          — update policies (Admin+)
 * GET    /security/tokens            — list PAT + service tokens
 * POST   /security/tokens            — create a new token
 * DELETE /security/tokens/:id        — revoke a token
 * GET    /security/score             — security score for workspace
 */
const router = require("express").Router();
const { requireAuth }      = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/securityLayer.cjs");
const wsSvc = require("../services/workspaceService.cjs");

router.use(requireAuth);
router.use(attachWorkspace);

// Helper: resolve workspaceId from req (active or query param)
function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// ── Sessions ──────────────────────────────────────────────────────

router.get("/security/sessions", (req, res) => {
  try {
    const wsId = _wsId(req);
    const sessions = svc.getSessions(wsId);
    // Enrich — mark caller's session
    const callerSub = req.user.sub;
    const enriched = sessions.map(s => ({ ...s, isCurrent: s.accountId === callerSub }));
    res.json({ sessions: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/security/session/:id", (req, res) => {
  try {
    const wsId = _wsId(req);
    svc.deleteSession(wsId, req.params.id, req.user.sub);
    res.json({ ok: true });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

// ── Devices ───────────────────────────────────────────────────────

router.get("/security/devices", (req, res) => {
  try {
    const wsId = _wsId(req);
    res.json({ devices: svc.getDevices(wsId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/security/device/:id/trust", (req, res) => {
  try {
    const wsId = _wsId(req);
    const device = svc.trustDevice(wsId, req.params.id, req.user.sub);
    res.json({ device });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

router.delete("/security/device/:id", (req, res) => {
  try {
    const wsId = _wsId(req);
    svc.deleteDevice(wsId, req.params.id, req.user.sub);
    res.json({ ok: true });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: e.message });
  }
});

// ── Audit Log ─────────────────────────────────────────────────────

router.get("/security/audit", (req, res) => {
  try {
    const wsId    = _wsId(req);
    const limit   = parseInt(req.query.limit, 10) || 100;
    const { accountId, action } = req.query;
    const log = svc.getAuditLog(wsId, { limit, accountId, action });
    res.json({ audit: log });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Policies ──────────────────────────────────────────────────────

router.get("/security/policies", (req, res) => {
  try {
    const wsId = _wsId(req);
    res.json({ policies: svc.getPolicies(wsId), score: svc.getSecurityScore(wsId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/security/policies", requireRole("Admin"), (req, res) => {
  try {
    const wsId = _wsId(req);
    const updated = svc.updatePolicies(wsId, req.body, req.user.sub);
    res.json({ policies: updated });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Tokens ────────────────────────────────────────────────────────

router.get("/security/tokens", (req, res) => {
  try {
    const wsId = _wsId(req);
    const mine = req.query.mine === "true";
    const tokens = svc.getTokens(wsId, mine ? req.user.sub : null);
    res.json({ tokens });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/security/tokens", (req, res) => {
  try {
    const wsId = _wsId(req);
    const { name, type, scopes, expiresInDays } = req.body;
    const token = svc.createToken(wsId, { name, type, scopes, expiresInDays, createdBy: req.user.sub });
    res.json({ token }); // includes full secret — only shown once
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete("/security/tokens/:id", (req, res) => {
  try {
    const wsId = _wsId(req);
    svc.revokeToken(wsId, req.params.id, req.user.sub);
    res.json({ ok: true });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Security Score ────────────────────────────────────────────────

router.get("/security/score", (req, res) => {
  try {
    const wsId = _wsId(req);
    res.json(svc.getSecurityScore(wsId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
