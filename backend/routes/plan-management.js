"use strict";
/**
 * plan-management.js — /plan/* routes
 *
 * GET  /plan/current  — current plan details
 * POST /plan/upgrade  — upgrade plan
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg } = require("../middleware/orgMiddleware.cjs");

const _try = fn => { try { return fn(); } catch { return null; } };
const _crm = () => _try(() => require("../services/crmService"));

router.use("/plan", requireAuth, attachOrg);

// Mission 51 (2026-08-26): crm.getStats() called with zero args returned
// unfiltered platform-wide lead/revenue data to every authenticated
// customer — crmService.getStats(orgId) already supports scoping (used
// correctly elsewhere via business.js's _requireOrg pattern); this route
// just never passed it. attachOrg (added above) resolves req.org from the
// caller's own real membership — never a client-supplied value. When a
// caller has no resolvable org (attachOrg's own auto-resolve fallback finds
// none), req.org is undefined and crm.getStats(undefined) preserves the
// prior unscoped behavior for that edge case only, matching this file's
// existing "no org context recorded" shape rather than 404ing a route that
// never gated on org membership before.
router.get("/plan/current", (req, res) => {
  try {
    const crm  = _crm();
    const stats = crm ? crm.getStats(req.org?.id) : {};
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
