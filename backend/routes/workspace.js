"use strict";
/**
 * K1 — Workspace routes
 * GET    /workspace              — list workspaces for current user
 * POST   /workspace              — create workspace
 * PATCH  /workspace/:id          — update workspace
 * POST   /workspace/invite       — invite member (email + role)
 * POST   /workspace/switch       — switch active workspace
 * GET    /workspace/activity     — activity log for active/requested workspace
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/workspaceService.cjs");

// All workspace routes require auth
router.use("/workspace", requireAuth);
router.use(attachWorkspace);

// GET /workspace — list workspaces the caller is a member of
router.get("/workspace", (req, res) => {
  try {
    const accountId = req.user.sub;
    const workspaces = svc.listWorkspaces(accountId);
    res.json({ workspaces: workspaces.map(svc.sanitize), activeWorkspaceId: req.workspace?.id || "default" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /workspace — create a new workspace
router.post("/workspace", (req, res) => {
  try {
    const { name, description } = req.body;
    const ws = svc.createWorkspace({ name, description, creatorAccountId: req.user.sub });
    res.json({ workspace: svc.sanitize(ws) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /workspace/:id — update name/description/settings
router.patch("/workspace/:id", (req, res) => {
  try {
    const { name, description, settings } = req.body;
    const ws = svc.updateWorkspace(req.params.id, { name, description, settings }, req.user.sub);
    res.json({ workspace: svc.sanitize(ws) });
  } catch (e) {
    const status = e.message.includes("Insufficient") ? 403 : e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// POST /workspace/invite — invite a member by email
router.post("/workspace/invite", async (req, res) => {
  try {
    const { workspaceId, email, role } = req.body;
    const wsId = workspaceId || req.workspace?.id;
    if (!wsId) return res.status(400).json({ error: "workspaceId required" });
    const inv = svc.createInvitation(wsId, { email, role }, req.user.sub);
    res.json({ invitation: inv });
  } catch (e) {
    const status = e.message.includes("Insufficient") ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// POST /workspace/switch — switch active workspace
router.post("/workspace/switch", (req, res) => {
  try {
    const { workspaceId } = req.body;
    if (!workspaceId) return res.status(400).json({ error: "workspaceId required" });
    const result = svc.switchWorkspace(workspaceId, req.user.sub);
    res.json(result);
  } catch (e) {
    const status = e.message.includes("Not a member") ? 403 : e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// GET /workspace/activity — activity log
router.get("/workspace/activity", (req, res) => {
  try {
    const wsId = req.query.workspaceId || req.workspace?.id;
    if (!wsId) return res.status(400).json({ error: "workspaceId required" });
    const limit = parseInt(req.query.limit, 10) || 50;
    const activity = svc.getActivity(wsId, limit);
    res.json({ activity });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /workspace/:id/members — list members with account info
router.get("/workspace/:id/members", async (req, res) => {
  try {
    const members = await svc.getMembers(req.params.id);
    res.json({ members });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
