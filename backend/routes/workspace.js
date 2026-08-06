"use strict";
/**
 * K1 — Workspace routes
 * GET    /workspace                        — list workspaces for current user
 * POST   /workspace                        — create workspace
 * PATCH  /workspace/:id                    — update workspace
 * POST   /workspace/invite                 — invite member (email + role), emails the link
 * GET    /invite-preview/:token            — public: preview an invite before accepting
 * POST   /workspace/accept-invite          — consume a token, join the workspace
 * DELETE /workspace/:id/members/:accountId — remove a member
 * POST   /workspace/switch                 — switch active workspace
 * GET    /workspace/activity               — activity log for active/requested workspace
 * GET    /workspace/:id/members            — list members with account info
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireWorkspaceMember } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/workspaceService.cjs");

// GET /invite-preview/:token — preview an invitation before accepting.
// Deliberately public (no requireAuth, no /workspace prefix) — the invitee
// may not have an account or session yet when they first open the emailed
// link, and needs to see "You've been invited to join <workspace>" before
// being asked to sign up or log in.
router.get("/invite-preview/:token", (req, res) => {
  const info = svc.getInvitationByToken(req.params.token);
  if (!info) return res.status(404).json({ error: "Invitation not found" });
  res.json({ invitation: info });
});

// All workspace routes require auth
router.use("/workspace", requireAuth);
router.use(attachWorkspace);

// POST /workspace/accept-invite — consume a token, join the workspace.
// Requires auth: the invitee must be logged in (or have just registered) —
// acceptInvitation needs a real accountId to add as a member.
router.post("/workspace/accept-invite", (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });
    const result = svc.acceptInvitation(token, req.user.sub);
    res.json({ success: true, ...result });
  } catch (e) {
    const status = e.message.includes("expired") || e.message.includes("Invalid") ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

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

// POST /workspace/invite — invite a member by email. Creates the token
// record (must succeed for the invite to exist) then best-effort emails it —
// createInvitation previously returned the raw token to the caller with no
// delivery mechanism at all, so an invited teammate had no way to receive it.
router.post("/workspace/invite", async (req, res) => {
  try {
    const { workspaceId, email, role } = req.body;
    const wsId = workspaceId || req.workspace?.id;
    if (!wsId) return res.status(400).json({ error: "workspaceId required" });
    if (!email) return res.status(400).json({ error: "email required" });
    const inv = svc.createInvitation(wsId, { email, role }, req.user.sub);

    let inviterName = req.user.email || req.user.sub;
    try {
      const acctSvc = require("../services/accountService");
      const inviter = acctSvc.getById(req.user.sub);
      if (inviter?.name) inviterName = inviter.name;
    } catch { /* non-fatal */ }

    // A.6 fix: sendInvitationEmail is now genuinely async (see
    // workspaceService.cjs) — must be awaited for `delivery.sent` /
    // `delivery.reason` to reflect the real send outcome instead of a
    // value computed before the send even started.
    const delivery = await svc.sendInvitationEmail({
      email: inv.email, token: inv.token, role: inv.role,
      workspaceName: inv.workspaceName, invitedByName: inviterName,
    });

    res.json({
      invitation: { email: inv.email, role: inv.role, expiresAt: inv.expiresAt },
      emailSent:  delivery.sent,
      emailError: delivery.sent ? undefined : delivery.reason,
    });
  } catch (e) {
    const status = e.message.includes("Insufficient") ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
});

// DELETE /workspace/:id/members/:accountId — remove a member
router.delete("/workspace/:id/members/:accountId",
  (req, res, next) => {
    req.body = req.body || {};
    if (req.params.id && !req.body.workspaceId) req.body.workspaceId = req.params.id;
    return attachWorkspace(req, res, next);
  },
  (req, res) => {
    try {
      const result = svc.removeMember(req.params.id, req.params.accountId, req.user.sub);
      res.json({ success: true, ...result });
    } catch (e) {
      const status = e.message.includes("Insufficient") ? 403 : e.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  }
);

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
// attachWorkspace() resolves req.workspace/req.workspaceRole from
// query/body/header only, not the :id route param, so forward it into
// req.body.workspaceId (the field attachWorkspace already reads) before
// delegating to the existing middleware, then require real membership —
// previously this route had no membership check at all and would return
// any workspace's member list (including emails) to any authenticated user.
// NOTE: req.query is a getter in Express 5 — assigning to it does not
// persist across middleware, so req.body is used instead (initialized here
// since express.json() leaves req.body undefined, not {}, on a bodyless GET).
router.get("/workspace/:id/members",
  (req, res, next) => {
    req.body = req.body || {};
    if (req.params.id && !req.body.workspaceId) req.body.workspaceId = req.params.id;
    return attachWorkspace(req, res, next);
  },
  requireWorkspaceMember,
  async (req, res) => {
    try {
      const members = await svc.getMembers(req.params.id);
      res.json({ members });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

module.exports = router;
