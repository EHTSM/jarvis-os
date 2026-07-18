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
// Per-account map: { [accountId]: { workspaceId, switchedAt } }. Previously a
// single flat { workspaceId } object with no account key at all — meaning any
// user's "switch workspace" click silently changed the active workspace for
// every other concurrent user/request that didn't pass an explicit
// workspaceId. Migrated to a per-account map; a bare legacy { workspaceId }
// shape (no accountId) is treated as having no accountId-scoped entries and
// falls through to "default" for everyone, which is safe (worst case: nobody
// has a saved preference yet, same as a fresh install).
function _readActiveMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACTIVE_WS_FILE, "utf8"));
    // Legacy shape guard: { workspaceId: "..." } has no accountId keys to read.
    if (raw && typeof raw.workspaceId === "string") return {};
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}
function _writeActiveMap(map) {
  fs.writeFileSync(ACTIVE_WS_FILE, JSON.stringify(map, null, 2));
}
function _readActive(accountId) {
  const map = _readActiveMap();
  return (accountId && map[accountId]) || { workspaceId: "default" };
}
function _writeActive(accountId, obj) {
  if (!accountId) return; // no account context — nothing safe to persist
  const map = _readActiveMap();
  map[accountId] = obj;
  _writeActiveMap(map);
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
 * Get the currently active workspace for a given account (or default).
 * accountId is required for a per-account result — omitting it always
 * resolves to "default" rather than silently reading another user's
 * selection.
 */
function getActiveWorkspace(accountId) {
  const { workspaceId } = _readActive(accountId);
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
  _writeActive(accountId, { workspaceId, switchedAt: Date.now() });
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
  return { token, email, role, expiresAt: inv.expiresAt, workspaceName: ws.name };
}

/**
 * Email the invite link. Separate from createInvitation so the token/record
 * creation (the part that must succeed for the invite to be real) never fails
 * because of an email provider hiccup — mirrors betaReadiness.sendEmailVerification's
 * split between token generation and best-effort delivery.
 */
function sendInvitationEmail({ email, token, role, workspaceName, invitedByName }) {
  let emailSvc = null;
  try { emailSvc = require("./emailService.cjs"); } catch { return { sent: false, reason: "emailService unavailable" }; }

  const base = (process.env.BASE_URL || "http://localhost:5050").replace(/\/$/, "");
  const link = `${base}/accept-invite?token=${token}`;
  try {
    emailSvc.sendEmail({
      to: email,
      subject: `${invitedByName || "Someone"} invited you to join ${workspaceName || "a workspace"} on Ooplix`,
      html: `<p>You've been invited to join <strong>${workspaceName || "a workspace"}</strong> as <strong>${role}</strong>.</p>
<p><a href="${link}">Accept invitation</a></p>
<p>This invitation expires in 7 days. If you don't have an Ooplix account yet, you'll be asked to create one.</p>`,
      text: `You've been invited to join ${workspaceName || "a workspace"} as ${role}. Accept: ${link}`,
    });
    return { sent: true, link };
  } catch (e) {
    return { sent: false, reason: e.message, link };
  }
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
 * Look up a pending invitation by token without consuming it — used to show
 * the invitee "You've been invited to join <workspace> as <role>" before
 * they've logged in/registered, since acceptInvitation requires an accountId
 * (the invitee may not have an account yet).
 */
function getInvitationByToken(token) {
  const all = _readAll();
  for (const ws of Object.values(all)) {
    const inv = (ws.invitations || []).find(i => i.token === token);
    if (!inv) continue;
    return {
      workspaceId: ws.id,
      workspaceName: ws.name,
      email: inv.email,
      role: inv.role,
      expired: inv.expiresAt < Date.now(),
      used: !!inv.usedAt,
    };
  }
  return null;
}

/**
 * Remove a member from a workspace. Requires Admin+ (same bar as inviting).
 * The workspace's last Owner cannot be removed — mirrors organizationService's
 * addMember/removeMember guard against leaving an ownerless org.
 */
function removeMember(workspaceId, targetAccountId, requestingAccountId) {
  const all = _ensureDefault();
  const ws = all[workspaceId];
  if (!ws) throw new Error("Workspace not found");
  const requester = ws.members.find(m => m.accountId === requestingAccountId);
  if (!requester || !_roleAtLeast(requester.role, "Admin")) throw new Error("Insufficient role");

  const target = ws.members.find(m => m.accountId === targetAccountId);
  if (!target) throw new Error("Member not found");
  if (target.role === "Owner" && ws.members.filter(m => m.role === "Owner").length <= 1) {
    throw new Error("Cannot remove the last Owner");
  }

  ws.members = ws.members.filter(m => m.accountId !== targetAccountId);
  _logActivity(ws, requestingAccountId, "member_removed", targetAccountId);
  _writeAll(all);
  return { removed: true, workspaceId, accountId: targetAccountId };
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
  sendInvitationEmail,
  getInvitationByToken,
  acceptInvitation,
  removeMember,
  getMembers,
  getActivity,
  getMemberRole,
  sanitize,
};
