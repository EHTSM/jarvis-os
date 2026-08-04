"use strict";
/**
 * V6 Phase 8 (Personal JARVIS: mobile) — Push notification routes
 * Prefix: /push/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _svc() { return require("../services/pushNotificationEngine.cjs"); }
function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 400).json({ ok: false, error: e?.message || String(e) }); }

router.post("/push/register", requireAuth, (req, res) => {
  const { token, platform } = req.body || {};
  const accountId = req.user.sub || req.user.id;
  const r = _svc().registerToken({ accountId, token, platform });
  if (!r.ok) return _err(res, new Error(r.error), 400);
  _ok(res, r);
});

router.post("/push/unregister", requireAuth, (req, res) => {
  const { token } = req.body || {};
  if (!token) return _err(res, new Error("token required"), 400);
  _ok(res, _svc().unregisterToken(token));
});

router.get("/push/readiness", requireAuth, async (req, res) => {
  try { _ok(res, await _svc().getReadiness()); }
  catch (e) { _err(res, e, 500); }
});

module.exports = router;
