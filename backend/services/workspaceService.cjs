"use strict";
/**
 * K1 — Enterprise Workspace Foundation
 * Manages workspaces, membership, roles, invitations, and activity log.
 * Storage: data/workspaces.json (keyed by workspaceId)
 * Active workspace pointer: data/active-workspace.json
 * Member lookups reuse accountService — no duplicate user storage.
 */
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const WORKSPACES_FILE   = path.join(__dirname, "../../data/workspaces.json");
const ACTIVE_WS_FILE    = path.join(__dirname, "../../data/active-workspace.json");
const MAX_ACTIVITY_ROWS = 200;

// Valid roles — ordered from most to least privileged
const ROLES = ["Owner", "Admin", "Operator", "Developer", "Viewer"];

// ── Lazy dep: accountService ─────────────────────────────────────
let _acctSvc = null;
function _accounts() {
  if (!_acctSvc) try { _acctSvc = require("./accountService"); } catch {}
  return _acctSvc;
}

// ── Storage helpers ───────────────────────────────────────────────
function _readAll() {
  try { return JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf8")); } catch { return {}; }
}
function _writeAll(data) {
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(data, null, 2));
}
function _readActive() {
  try { return JSON.parse(fs.readFileSync(ACTIVE_WS_FILE, "utf8")); } catch { return { workspaceId: "default" }; }
}
function _writeActive(obj) {
  fs.writeFileSync(ACTIVE_WS_FILE, JSON.stringify(obj, null, 2));
}

// ── Bootstrap default workspace if missing ────────────────────────
function _ensureDefault() {
  const all = _readAll();
  if (all["default"]) return all;
  all["default"] = {
    id: "default",
    name: "Default Workspace",
    description: "Primary workspace",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    members: [],          // [{ accountId, role, joinedAt, invitedBy }]
    invitations: [],      // [{ token, email, role, invitedBy, expiresAt, usedAt }]
    activity: [],         // [{ ts, accountId, action, detail }]
    settings: { visibility: "private", defaultRole: "Operator" },
  };
  _writeAll(all);
  return all;
}

// ── Activity logger ───────────────────────────────────────────────
function _logActivity(ws, accountId, action, detail = "") {
  if (!ws.activity) ws.activity = [];
  ws.activity.unshift({ ts: Date.now(), accountId, action, detail });
  if (ws.activity.length > MAX_ACTIVITY_ROWS) ws.activity.length = MAX_ACTIVITY_ROWS;
}

// ── Role check helper ─────────────────────────────────────────────
function _roleAtLeast(memberRole, required) {
  return ROLES.indexOf(memberRole) <= ROLES.indexOf(required);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * List all workspaces the given accountId is a member of (or all, if no filter).
 */
function listWorkspaces(accountId) {
  const all = _ensureDefault();
  return Object.values(all).filter(ws =>
    !accountId || ws.members.some(m => m.accountId === accountId)
  );
}

/**
 * Get a single workspace by id. Returns null if not found.
 */
function getWorkspace(workspaceId) {
  const all = _ensureDefault();
  return all[workspaceId] || null;
}

/**
 * Get the currently active workspace (or default).
 */
function getActiveWorkspace() {
  const { workspaceId } = _readActive();
  return getWorkspace(workspaceId) || getWorkspace("default");
}

/**
 * Create a new workspace. Creator is automatically Owner.
 */
function createWorkspace({ name, description = "", creatorAccountId }) {
  if (!name || !creatorAccountId) throw new Error("name and creatorAccountId required");
  const all = _ensureDefault();
  const id = `ws_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const ws = {
    id,
    name: name.trim(),
    description: description.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    members: [{ accountId: creatorAccountId, role: "Owner", joinedAt: Date.now(), invitedBy: null }],
    invitations: [],
    activity: [],
    settings: { visibility: "private", defaultRole: "Operator" },
  };
  _logActivity(ws, creatorAccountId, "workspace_created", name);
  all[id] = ws;
  _writeAll(all);
  return ws;
}

/**
 * Update workspace metadata. Requires Admin or Owner role.
 */
function updateWorkspace(workspaceId, { name, description, settings }, requestingAccountId) {
  const all = _ensureDefault();
  const ws = all[workspaceId];
  if (!ws) throw new Error("Workspace not found");
  const member = ws.members.find(m => m.accountId === requestingAccountId);
  if (!member || !_roleAtLeast(member.role, "Admin")) throw new Error("Insufficient role");
  if (name !== undefined) ws.name = name.trim();
  if (description !== undefined) ws.description = description.trim();
  if (settings !== undefined) ws.settings = { ...ws.settings, ...settings };
  ws.updatedAt = Date.now();
  _logActivity(ws, requestingAccountId, "workspace_updated", `name=${ws.name}`);
  _writeAll(all);
  return ws;
}

/**
 * Switch active workspace. Validates membership.
 */
function switchWorkspace(workspaceId, accountId) {
  const all = _ensureDefault();
  const ws = all[workspaceId];
  if (!ws) throw new Error("Workspace not found");
  const member = ws.members.find(m => m.accountId === accountId);
  if (!member) throw new Error("Not a member of this workspace");
  _writeActive({ workspaceId, switchedAt: Date.now() });
  _logActivity(ws, accountId, "workspace_switched", workspaceId);
  _writeAll(all);
  return { workspaceId, workspace: ws };
}

/**
 * Create an invitation token for an email + role. Requires Admin or Owner.
 */
function createInvitation(workspaceId, { email, role = "Operator" }, requestingAccountId) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const all = _ensureDefault();
  const ws = all[workspaceId];
  if (!ws) throw new Error("Workspace not found");
  const member = ws.members.find(m => m.accountId === requestingAccountId);
  if (!member || !_roleAtLeast(member.role, "Admin")) throw new Error("Insufficient role");
  // Remove stale invitation for same email
  ws.invitations = ws.invitations.filter(i => i.email !== email || i.usedAt);
  const token = crypto.randomBytes(24).toString("hex");
  const inv = {
    token,
    email: email.toLowerCase().trim(),
    role,
    invitedBy: requestingAccountId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    usedAt: null,
  };
  ws.invitations.push(inv);
  _logActivity(ws, requestingAccountId, "invitation_created", `${email} as ${role}`);
  _writeAll(all);
  return { token, email, role, expiresAt: inv.expiresAt };
}

/**
 * Accept an invitation token. Adds account as member.
 */
function acceptInvitation(token, accountId) {
  const all = _ensureDefault();
  for (const ws of Object.values(all)) {
    const inv = ws.invitations.find(i => i.token === token && !i.usedAt);
    if (!inv) continue;
    if (inv.expiresAt < Date.now()) throw new Error("Invitation expired");
    // Upsert membership
    const existing = ws.members.find(m => m.accountId === accountId);
    if (existing) {
      existing.role = inv.role;
    } else {
      ws.members.push({ accountId, role: inv.role, joinedAt: Date.now(), invitedBy: inv.invitedBy });
    }
    inv.usedAt = Date.now();
    _logActivity(ws, accountId, "invitation_accepted", `role=${inv.role}`);
    _writeAll(all);
    return { workspaceId: ws.id, role: inv.role };
  }
  throw new Error("Invalid or expired invitation token");
}

/**
 * Get members of a workspace, enriched with account info.
 */
async function getMembers(workspaceId) {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("Workspace not found");
  const acctSvc = _accounts();
  const members = await Promise.all(ws.members.map(async m => {
    let account = null;
    try { account = acctSvc ? await acctSvc.getById(m.accountId) : null; } catch {}
    return {
      accountId: m.accountId,
      role: m.role,
      joinedAt: m.joinedAt,
      name: account?.name || account?.email || m.accountId,
      email: account?.email || null,
    };
  }));
  return members;
}

/**
 * Get activity log for a workspace.
 */
function getActivity(workspaceId, limit = 50) {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("Workspace not found");
  return (ws.activity || []).slice(0, Math.min(limit, MAX_ACTIVITY_ROWS));
}

/**
 * Get the role of an account in a workspace. Returns null if not a member.
 */
function getMemberRole(workspaceId, accountId) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;
  return ws.members.find(m => m.accountId === accountId)?.role || null;
}

/**
 * Enrich a workspace object for API responses (strips invitation tokens).
 */
function sanitize(ws) {
  if (!ws) return null;
  return {
    ...ws,
    invitations: (ws.invitations || []).map(i => ({
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      invitedBy: i.invitedBy,
      // token omitted from API response
    })),
  };
}

module.exports = {
  ROLES,
  listWorkspaces,
  getWorkspace,
  getActiveWorkspace,
  createWorkspace,
  updateWorkspace,
  switchWorkspace,
  createInvitation,
  acceptInvitation,
  getMembers,
  getActivity,
  getMemberRole,
  sanitize,
};
