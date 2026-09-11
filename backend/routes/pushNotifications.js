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
  // Notifications Ecosystem mission fix: accountId is server-resolved from
  // the verified session (matching /push/register's own pattern just
  // above), never taken from the request body — a caller may only
  // unregister their own device tokens, never another account's by
  // guessing/knowing the token string.
  const accountId = req.user.sub || req.user.id;
  _ok(res, _svc().unregisterToken(token, accountId));
});

router.get("/push/readiness", requireAuth, async (req, res) => {
  try { _ok(res, await _svc().getReadiness()); }
  catch (e) { _err(res, e, 500); }
});

module.exports = router;
