"use strict";
/**
 * V5 Global AI Organization Platform — Module 2: Organization Knowledge Graph
 * Prefix: /org-graph/:orgId/*
 *
 * Every route re-validates req.params.orgId directly via
 * orgKnowledgeGraph's own organizationService.hasPermission checks — same
 * pattern as Module 1, deliberately not composing attachOrg+
 * requireOrgMember (which never reads req.params.orgId).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _graph = () => _try(() => require("../services/orgKnowledgeGraph.cjs"));

router.use("/org-graph", requireAuth);

router.post("/org-graph/:orgId/index", (req, res) => {
  try {
    res.json(_graph().indexOrg(req.params.orgId, req.user.sub));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/org-graph/:orgId", (req, res) => {
  try {
    const { maxDepth, maxNodes } = req.query;
    res.json(_graph().getOrgGraph(req.params.orgId, req.user.sub, { maxDepth: maxDepth ? +maxDepth : undefined, maxNodes: maxNodes ? +maxNodes : undefined }));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get("/org-graph/:orgId/impact/:type/:id", (req, res) => {
  try {
    res.json({ ok: true, ..._graph().getOrgImpact(req.params.orgId, req.user.sub, req.params.type, req.params.id) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
