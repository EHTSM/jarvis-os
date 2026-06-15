"use strict";
/**
 * K1 — Workspace isolation middleware.
 * Reads req.user.sub (set by authMiddleware), resolves active workspace,
 * validates membership, and attaches req.workspace + req.workspaceRole.
 * Routes that require a specific role should call requireRole() after this.
 */
let _wsSvc = null;
function _ws() {
  if (!_wsSvc) _wsSvc = require("../services/workspaceService.cjs");
  return _wsSvc;
}

/**
 * Attaches req.workspace and req.workspaceRole.
 * Non-blocking — if workspace resolution fails, req.workspace is null.
 * Use requireWorkspaceMember() for strict enforcement.
 */
function attachWorkspace(req, res, next) {
  try {
    const accountId = req.user?.sub;
    const svc = _ws();
    // Use workspaceId from query/body/header, or fall back to active
    const requestedId = req.query.workspaceId || req.body?.workspaceId || req.headers["x-workspace-id"];
    const ws = requestedId ? svc.getWorkspace(requestedId) : svc.getActiveWorkspace();
    req.workspace = ws;
    req.workspaceRole = accountId && ws ? svc.getMemberRole(ws.id, accountId) : null;
  } catch {
    req.workspace = null;
    req.workspaceRole = null;
  }
  next();
}

/**
 * Requires the requester to be a member of the active/requested workspace.
 */
function requireWorkspaceMember(req, res, next) {
  if (!req.workspace) return res.status(404).json({ error: "Workspace not found" });
  if (!req.workspaceRole) return res.status(403).json({ error: "Not a member of this workspace" });
  next();
}

/**
 * Returns middleware that requires a minimum role.
 * Role order: Owner > Admin > Operator > Developer > Viewer
 */
function requireRole(minRole) {
  const ROLES = ["Owner", "Admin", "Operator", "Developer", "Viewer"];
  return (req, res, next) => {
    const role = req.workspaceRole;
    if (!role) return res.status(403).json({ error: "Not a member of this workspace" });
    if (ROLES.indexOf(role) > ROLES.indexOf(minRole)) {
      return res.status(403).json({ error: `Requires ${minRole} or higher` });
    }
    next();
  };
}

module.exports = { attachWorkspace, requireWorkspaceMember, requireRole };
