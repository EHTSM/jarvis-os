"use strict";
/**
 * Plan Management — billing plan operations.
 * Thin wrapper over billingService; reuses existing commercial route patterns.
 */
const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const billing         = require("../services/billingService.js");

router.use(requireAuth);

function _account(req) { return req.user?.accountId || req.user?.id || "unknown"; }

router.get("/plan/current", (req, res) => {
  try {
    const record = billing.getRecord(_account(req));
    res.json({ ok: true, plan: record });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/plan/upgrade", (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!plan) return res.status(400).json({ error: "plan required" });
    const record = billing.activatePlan(_account(req), plan, { manual: true });
    res.json({ ok: true, record });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
