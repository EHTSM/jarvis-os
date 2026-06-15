"use strict";
/**
 * K3 — Enterprise Administration Service
 * Manages: departments, org profile, workspace quotas, member lifecycle,
 *          bulk member actions, workspace statistics.
 * Storage: data/admin-layer.json (keyed by workspaceId)
 * Member identity reuses accountService — no duplicate user storage.
 * Workspace membership reuses workspaceService — no duplicate role system.
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../../data/admin-layer.json");

// ── Lazy deps ─────────────────────────────────────────────────────
let _acctSvc = null, _wsSvc = null, _secSvc = null, _bus = null;
function _accounts()  { if (!_acctSvc) try { _acctSvc = require("./accountService"); }      catch {} return _acctSvc; }
function _workspace() { if (!_wsSvc)   try { _wsSvc   = require("./workspaceService.cjs"); } catch {} return _wsSvc; }
function _security()  { if (!_secSvc)  try { _secSvc  = require("./securityLayer.cjs"); }   catch {} return _secSvc; }
function _evtBus()    { if (!_bus)     try { _bus      = require("../../agents/runtime/runtimeEventBus.cjs"); } catch {} return _bus; }

// ── Default quota caps ────────────────────────────────────────────
const DEFAULT_QUOTAS = {
  maxMembers:      50,
  maxDepartments:  20,
  maxApiTokens:    25,
  maxActiveSessions: 200,
  storageGb:       10,
};

// ── Storage ───────────────────────────────────────────────────────
function _read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}
function _write(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function _ws(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) {
    all[workspaceId] = {
      departments: [],
      profile:     _defaultProfile(workspaceId),
      quotas:      { ...DEFAULT_QUOTAS },
      memberMeta:  {}, // accountId → { status, title, deptId, suspendedAt, archivedAt }
    };
    _write(all);
  }
  return { all, ws: all[workspaceId] };
}
function _save(all) { _write(all); }

function _defaultProfile(workspaceId) {
  return {
    workspaceId,
    displayName:  "",
    industry:     "",
    size:         "",
    website:      "",
    description:  "",
    country:      "",
    timezone:     "UTC",
    updatedAt:    null,
  };
}

// ── Emit helper ───────────────────────────────────────────────────
function _emit(event, payload) {
  try { _evtBus()?.emit(event, { ...payload, _ts: Date.now() }); } catch {}
}

// ── Departments ───────────────────────────────────────────────────

function getDepartments(workspaceId) {
  const { ws } = _ws(workspaceId);
  return (ws.departments || []).filter(d => d.status !== "archived");
}

function createDepartment(workspaceId, { name, description = "", headId = null }, requestingAccountId) {
  if (!name?.trim()) throw new Error("Department name required");
  const { all, ws } = _ws(workspaceId);
  const dept = {
    id:          `dept_${crypto.randomBytes(6).toString("hex")}`,
    name:        name.trim(),
    description: description.trim(),
    headId,
    status:      "active",
    memberCount: 0,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };
  ws.departments.push(dept);
  _emit("admin.dept_created", { workspaceId, deptId: dept.id, name: dept.name });
  _save(all);
  return dept;
}

function updateDepartment(workspaceId, deptId, patch, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const dept = ws.departments.find(d => d.id === deptId);
  if (!dept) throw new Error("Department not found");
  const ALLOWED = ["name", "description", "headId", "status"];
  for (const k of ALLOWED) { if (patch[k] !== undefined) dept[k] = patch[k]; }
  dept.updatedAt = Date.now();
  if (patch.status === "archived") dept.archivedAt = Date.now();
  _emit("admin.dept_updated", { workspaceId, deptId });
  _save(all);
  return dept;
}

// ── Member lifecycle ──────────────────────────────────────────────

const VALID_STATUSES = ["invited", "active", "suspended", "archived"];

function _memberMeta(ws, accountId) {
  if (!ws.memberMeta[accountId]) {
    ws.memberMeta[accountId] = { status: "active", title: "", deptId: null };
  }
  return ws.memberMeta[accountId];
}

function getTeam(workspaceId) {
  const { ws } = _ws(workspaceId);
  const wsSvc  = _workspace();
  const acctSvc = _accounts();

  const wsObj  = wsSvc ? wsSvc.getWorkspace(workspaceId) : null;
  const members = wsObj?.members || [];

  return members.map(m => {
    const meta    = _memberMeta(ws, m.accountId);
    const account = acctSvc ? acctSvc.getById(m.accountId) : null;
    return {
      accountId:  m.accountId,
      role:       m.role,
      joinedAt:   m.joinedAt,
      status:     meta.status || "active",
      title:      meta.title  || "",
      deptId:     meta.deptId || null,
      name:       account?.name  || m.accountId,
      email:      account?.email || null,
      lastLoginAt: account?.lastLoginAt || null,
    };
  });
}

function updateMember(workspaceId, accountId, patch, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const meta = _memberMeta(ws, accountId);

  if (patch.status) {
    if (!VALID_STATUSES.includes(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    meta.status = patch.status;
    if (patch.status === "suspended") meta.suspendedAt = Date.now();
    if (patch.status === "archived")  meta.archivedAt  = Date.now();
    if (patch.status === "active") { delete meta.suspendedAt; delete meta.archivedAt; }
  }
  if (patch.title  !== undefined) meta.title  = patch.title;
  if (patch.deptId !== undefined) meta.deptId = patch.deptId;

  // Update dept member counts
  if (patch.deptId !== undefined) {
    for (const d of ws.departments) {
      d.memberCount = Object.values(ws.memberMeta).filter(m => m.deptId === d.id && m.status === "active").length;
    }
  }

  _emit("admin.member_updated", { workspaceId, accountId, patch });
  _save(all);
  return { accountId, ...meta };
}

function bulkMemberAction(workspaceId, { accountIds, action, payload = {} }, requestingAccountId) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) throw new Error("accountIds required");
  const VALID_ACTIONS = ["set_status", "set_dept", "set_title"];
  if (!VALID_ACTIONS.includes(action)) throw new Error(`Invalid bulk action: ${action}`);

  const results = [];
  for (const accountId of accountIds) {
    try {
      let patch = {};
      if (action === "set_status") patch.status = payload.status;
      if (action === "set_dept")   patch.deptId = payload.deptId;
      if (action === "set_title")  patch.title  = payload.title;
      const r = updateMember(workspaceId, accountId, patch, requestingAccountId);
      results.push({ accountId, ok: true, ...r });
    } catch (e) {
      results.push({ accountId, ok: false, error: e.message });
    }
  }
  _emit("admin.bulk_action", { workspaceId, action, count: accountIds.length });
  return results;
}

// ── Organisation profile ──────────────────────────────────────────

function getProfile(workspaceId) {
  const { ws } = _ws(workspaceId);
  // Merge with workspace name from workspaceService
  const wsSvc = _workspace();
  const wsObj = wsSvc ? wsSvc.getWorkspace(workspaceId) : null;
  return { ...ws.profile, workspaceName: wsObj?.name || ws.profile.displayName };
}

function updateProfile(workspaceId, patch, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const ALLOWED = ["displayName", "industry", "size", "website", "description", "country", "timezone"];
  for (const k of ALLOWED) { if (patch[k] !== undefined) ws.profile[k] = patch[k]; }
  ws.profile.updatedAt = Date.now();
  _emit("admin.profile_updated", { workspaceId });
  _save(all);
  return ws.profile;
}

// ── Workspace Statistics ──────────────────────────────────────────

function getStatistics(workspaceId) {
  const { ws } = _ws(workspaceId);
  const wsSvc  = _workspace();
  const secSvc = _security();

  const wsObj      = wsSvc ? wsSvc.getWorkspace(workspaceId) : null;
  const members    = wsObj?.members || [];
  const memberMeta = ws.memberMeta || {};
  const depts      = (ws.departments || []).filter(d => d.status !== "archived");

  const byStatus = { invited: 0, active: 0, suspended: 0, archived: 0 };
  for (const m of members) {
    const status = memberMeta[m.accountId]?.status || "active";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  const pendingInvites = (wsObj?.invitations || []).filter(i => !i.usedAt && i.expiresAt > Date.now()).length;

  // Security stats from securityLayer
  let activeSessions = 0, activeTokens = 0, auditCount = 0;
  try {
    if (secSvc) {
      activeSessions = secSvc.getSessions(workspaceId).length;
      activeTokens   = secSvc.getTokens(workspaceId).length;
      auditCount     = secSvc.getAuditLog(workspaceId, { limit: 500 }).length;
    }
  } catch {}

  return {
    members:    { total: members.length, ...byStatus, pendingInvites },
    departments: { total: depts.length },
    security:   { activeSessions, activeTokens, auditEvents: auditCount },
    workspace:  {
      name:        wsObj?.name || "Default",
      createdAt:   wsObj?.createdAt || null,
      memberCount: members.length,
    },
  };
}

// ── Workspace Quotas ──────────────────────────────────────────────

function getQuotas(workspaceId) {
  const { ws } = _ws(workspaceId);
  const stats  = getStatistics(workspaceId);
  const quotas = ws.quotas || { ...DEFAULT_QUOTAS };
  return {
    quotas,
    usage: {
      members:     { used: stats.members.total,    limit: quotas.maxMembers },
      departments: { used: stats.departments.total, limit: quotas.maxDepartments },
      apiTokens:   { used: stats.security.activeTokens, limit: quotas.maxApiTokens },
      sessions:    { used: stats.security.activeSessions, limit: quotas.maxActiveSessions },
    },
  };
}

module.exports = {
  getDepartments, createDepartment, updateDepartment,
  getTeam, updateMember, bulkMemberAction,
  getProfile, updateProfile,
  getStatistics,
  getQuotas,
};
