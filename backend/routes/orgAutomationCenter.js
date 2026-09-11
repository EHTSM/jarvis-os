"use strict";
/**
 * V5 Global AI Organization Platform — Module 7: Organization Automation
 * Center
 * Prefix: /org-automation/:orgId/*
 *
 * Same cross-org-authorization pattern as every other V5 module.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _center = () => _try(() => require("../services/orgAutomationCenter.cjs"));

router.use("/org-automation", requireAuth);

router.get("/org-automation/:orgId", (req, res) => {
  try { res.json(_center().getFullCenter(req.params.orgId, req.user.sub)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-automation/:orgId/rules", (req, res) => {
  try { res.json({ ok: true, rules: _center().listRules(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.post("/org-automation/:orgId/rules", (req, res) => {
  try { res.json({ ok: true, rule: _center().createRule(req.params.orgId, req.user.sub, req.body || {}) }); }
  catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});

router.post("/org-automation/:orgId/rules/ai-triggered", (req, res) => {
  try { res.json({ ok: true, rule: _center().createAiTriggeredRule(req.params.orgId, req.user.sub, req.body || {}) }); }
  catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});

router.post("/org-automation/:orgId/rules/:ruleId/fire", async (req, res) => {
  // Phase B.13: `dryRun` was dropped here — only req.body.context was forwarded —
  // so a caller asking for a preview got a real execution. automationService's
  // fireRule() has always supported dryRun; it just never received it.
  try { res.json({ ok: true, result: await _center().fireRule(req.params.orgId, req.user.sub, req.params.ruleId, req.body?.context || {}, req.body?.dryRun === true) }); }
  catch (e) { res.status(e.status || 400).json({ ok: false, error: e.message }); }
});

router.get("/org-automation/:orgId/history", (req, res) => {
  try {
    const { limit, ruleId } = req.query;
    res.json({ ok: true, history: _center().getHistory(req.params.orgId, req.user.sub, { limit: limit ? +limit : undefined, ruleId }) });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-automation/:orgId/statistics", (req, res) => {
  try { res.json({ ok: true, statistics: _center().getStatistics(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-automation/:orgId/scheduler-status", (req, res) => {
  res.json({ ok: true, scheduler: _center().getSchedulerStatus() });
});

router.get("/org-automation/:orgId/ai-runs", (req, res) => {
  try {
    const { limit } = req.query;
    res.json({ ok: true, runs: _center().getAiAutomationRuns(req.params.orgId, req.user.sub, { limit: limit ? +limit : undefined }) });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

module.exports = router;
