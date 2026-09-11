"use strict";
/**
 * V5 Global AI Organization Platform — Module 4: Cross-Organization
 * Collaboration
 * Prefix: /cross-org/*
 *
 * Same cross-org-authorization pattern as Modules 1-3: no attachOrg/
 * requireOrgMember (which never reads req.params.orgId) — every route
 * re-validates directly through crossOrgCollaboration's own
 * organizationService.hasPermission checks.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _collab = () => _try(() => require("../services/crossOrgCollaboration.cjs"));

router.use("/cross-org", requireAuth);

router.get("/cross-org/shareable-permissions", (req, res) => {
  res.json({ ok: true, permissions: _collab().SHAREABLE_PERMISSIONS });
});

router.post("/cross-org/propose", (req, res) => {
  const { fromOrgId, toOrgId, permissions } = req.body || {};
  try {
    res.json({ ok: true, collaboration: _collab().propose(fromOrgId, toOrgId, permissions, req.user.sub) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.post("/cross-org/:collaborationId/accept", (req, res) => {
  try {
    res.json({ ok: true, collaboration: _collab().accept(req.params.collaborationId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.post("/cross-org/:collaborationId/reject", (req, res) => {
  try {
    res.json({ ok: true, collaboration: _collab().reject(req.params.collaborationId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.post("/cross-org/:collaborationId/revoke", (req, res) => {
  try {
    res.json({ ok: true, collaboration: _collab().revoke(req.params.collaborationId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.get("/cross-org/:orgId", (req, res) => {
  try {
    res.json({ ok: true, collaborations: _collab().listForOrg(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
