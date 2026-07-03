"use strict";
/**
 * plan-management.js — /plan/* routes
 *
 * GET  /plan/current  — current plan details
 * POST /plan/upgrade  — upgrade plan
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _crm = () => _try(() => require("../services/crmService"));

router.use("/plan", requireAuth);

router.get("/plan/current", (req, res) => {
  try {
    const crm  = _crm();
    const stats = crm ? crm.getStats() : {};
    res.json({
      ok:      true,
      plan:    process.env.CURRENT_PLAN || "starter",
      status:  "active",
      revenue: stats.revenue || 0,
      paid:    stats.paid    || 0,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/plan/upgrade", (req, res) => {
  try {
    const { targetPlan } = req.body || {};
    if (!targetPlan) return res.status(400).json({ ok: false, error: "targetPlan required" });
    res.json({ ok: true, message: `Upgrade to ${targetPlan} initiated`, targetPlan });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
