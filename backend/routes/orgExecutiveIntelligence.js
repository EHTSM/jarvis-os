"use strict";
/**
 * V5 Global AI Organization Platform — Module 6: Executive Intelligence
 * Prefix: /org-executive/:orgId/*
 *
 * Same cross-org-authorization pattern as every other V5 module.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _exec = () => _try(() => require("../services/orgExecutiveIntelligence.cjs"));

router.use("/org-executive", requireAuth);

router.get("/org-executive/:orgId/insights", (req, res) => {
  try { res.json(_exec().getInsights(req.params.orgId, req.user.sub)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-executive/:orgId/recommendations", (req, res) => {
  try { res.json(_exec().getRecommendations(req.params.orgId, req.user.sub)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-executive/:orgId/forecast", (req, res) => {
  try {
    const { days } = req.query;
    res.json(_exec().getForecast(req.params.orgId, req.user.sub, { days: days ? +days : undefined }));
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-executive/:orgId/summary", (req, res) => {
  try { res.json(_exec().getOperationalSummary(req.params.orgId, req.user.sub)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

module.exports = router;
