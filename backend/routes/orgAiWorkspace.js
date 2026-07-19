"use strict";
/**
 * V5 Global AI Organization Platform — Module 5: Global AI Workspace
 * Prefix: /org-workspace/:orgId/*
 *
 * Same cross-org-authorization pattern as every other V5 module: no
 * attachOrg/requireOrgMember — every route re-validates req.params.orgId
 * directly via orgAiWorkspace's own organizationService.hasPermission
 * checks (delegated through to Modules 1-4's own real permission checks).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _workspace = () => _try(() => require("../services/orgAiWorkspace.cjs"));

router.use("/org-workspace", requireAuth);

router.get("/org-workspace/:orgId", (req, res) => {
  try { res.json(_workspace().getFullWorkspace(req.params.orgId, req.user.sub)); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-workspace/:orgId/chat", (req, res) => {
  try { res.json({ ok: true, ..._workspace().getChatSummary(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-workspace/:orgId/memory", (req, res) => {
  try { res.json({ ok: true, ..._workspace().getMemorySummary(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-workspace/:orgId/agents", (req, res) => {
  try { res.json({ ok: true, ..._workspace().getAgentsSummary(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-workspace/:orgId/workflows", (req, res) => {
  try { res.json({ ok: true, ..._workspace().getWorkflowsSummary(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

router.get("/org-workspace/:orgId/collaboration", (req, res) => {
  try { res.json({ ok: true, ..._workspace().getCollaborationSummary(req.params.orgId, req.user.sub) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

module.exports = router;
