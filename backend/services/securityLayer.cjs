"use strict";
/**
 * K2 — Enterprise Security Layer
 * Manages: active sessions, trusted devices, security audit log,
 *          workspace policies, API/PAT/service tokens.
 * Storage: data/security-layer.json (single file, keyed by workspaceId)
 * Emits events to runtimeEventBus for audit trail.
 * Reuses: workspaceService, accountService, authMiddleware shapes.
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../../data/security-layer.json");
const MAX_AUDIT_ROWS = 500;
const MAX_SESSIONS   = 200;
const MAX_DEVICES    = 100;

// ── Lazy deps ─────────────────────────────────────────────────────
let _bus = null;
function _evtBus() {
  if (!_bus) try { _bus = require("../../agents/runtime/runtimeEventBus.cjs"); } catch {}
  return _bus;
}

// ── Storage ───────────────────────────────────────────────────────
function _read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}
function _write(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function _ws(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) {
    all[workspaceId] = {
      sessions:  [],
      devices:   [],
      auditLog:  [],
      policies:  _defaultPolicies(),
      tokens:    [],
    };
    _write(all);
  }
  return { all, ws: all[workspaceId] };
}
function _save(all) { _write(all); }

function _defaultPolicies() {
  return {
    requireMfa:          false,
    sessionTimeoutHours: 24,
    maxSessionsPerUser:  5,
    ipAllowlist:         [],
    enforceDeviceTrust:  false,
    auditLogEnabled:     true,
    tokenExpiryDays:     90,
    passwordMinLength:   8,
    allowedDomains:      [],
  };
}

// ── Audit log helper ──────────────────────────────────────────────
function _audit(all, workspaceId, accountId, action, detail = "", outcome = "success") {
  const ws = all[workspaceId];
  if (!ws) return;
  if (!ws.auditLog) ws.auditLog = [];
  ws.auditLog.unshift({
    id:        crypto.randomBytes(6).toString("hex"),
    ts:        Date.now(),
    accountId,
    action,
    detail,
    outcome,
  });
  if (ws.auditLog.length > MAX_AUDIT_ROWS) ws.auditLog.length = MAX_AUDIT_ROWS;
  // Emit to runtime event bus for live ops panels
  try {
    _evtBus()?.emit("security_audit", { workspaceId, accountId, action, detail, outcome, _ts: Date.now() });
  } catch {}
}

// ── Security Score ────────────────────────────────────────────────
function _score(ws) {
  const p = ws.policies || {};
  let score = 40; // base
  if (p.requireMfa)          score += 20;
  if (p.auditLogEnabled)     score += 10;
  if (p.enforceDeviceTrust)  score += 10;
  if ((p.ipAllowlist || []).length > 0) score += 10;
  if ((ws.tokens || []).filter(t => !t.revokedAt && t.type === "service").length === 0) score += 5;
  if (p.sessionTimeoutHours <= 8) score += 5;
  return Math.min(score, 100);
}

// ── Sessions ──────────────────────────────────────────────────────

function getSessions(workspaceId) {
  const { ws } = _ws(workspaceId);
  return ws.sessions;
}

function registerSession(workspaceId, { accountId, userAgent = "", ip = "", deviceId = null }) {
  const { all, ws } = _ws(workspaceId);
  const sessionId = `sess_${crypto.randomBytes(8).toString("hex")}`;
  const session = {
    id: sessionId, accountId, userAgent, ip, deviceId,
    createdAt: Date.now(), lastSeenAt: Date.now(), active: true,
  };
  ws.sessions.unshift(session);
  if (ws.sessions.length > MAX_SESSIONS) ws.sessions.length = MAX_SESSIONS;
  _audit(all, workspaceId, accountId, "session.created", `ip=${ip}`, "success");
  _save(all);
  return session;
}

function touchSession(workspaceId, sessionId) {
  const { all, ws } = _ws(workspaceId);
  const s = ws.sessions.find(s => s.id === sessionId);
  if (s) { s.lastSeenAt = Date.now(); _save(all); }
}

function deleteSession(workspaceId, sessionId, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const idx = ws.sessions.findIndex(s => s.id === sessionId);
  if (idx === -1) throw new Error("Session not found");
  const s = ws.sessions[idx];
  ws.sessions.splice(idx, 1);
  _audit(all, workspaceId, requestingAccountId, "session.revoked", `sessionId=${sessionId} owner=${s.accountId}`, "success");
  _save(all);
}

// ── Devices ───────────────────────────────────────────────────────

function getDevices(workspaceId) {
  const { ws } = _ws(workspaceId);
  return ws.devices;
}

function registerDevice(workspaceId, { accountId, name = "Unknown Device", userAgent = "", fingerprint = null }) {
  const { all, ws } = _ws(workspaceId);
  const existing = fingerprint && ws.devices.find(d => d.fingerprint === fingerprint && d.accountId === accountId);
  if (existing) {
    existing.lastSeenAt = Date.now();
    _save(all);
    return existing;
  }
  const device = {
    id:          `dev_${crypto.randomBytes(8).toString("hex")}`,
    accountId, name, userAgent,
    fingerprint: fingerprint || crypto.randomBytes(12).toString("hex"),
    trusted:     false,
    createdAt:   Date.now(),
    lastSeenAt:  Date.now(),
  };
  ws.devices.unshift(device);
  if (ws.devices.length > MAX_DEVICES) ws.devices.length = MAX_DEVICES;
  _audit(all, workspaceId, accountId, "device.registered", `name=${name}`, "success");
  _save(all);
  return device;
}

function trustDevice(workspaceId, deviceId, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const d = ws.devices.find(d => d.id === deviceId);
  if (!d) throw new Error("Device not found");
  d.trusted = true;
  d.trustedAt = Date.now();
  d.trustedBy = requestingAccountId;
  _audit(all, workspaceId, requestingAccountId, "device.trusted", `deviceId=${deviceId}`, "success");
  _save(all);
  return d;
}

function deleteDevice(workspaceId, deviceId, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const idx = ws.devices.findIndex(d => d.id === deviceId);
  if (idx === -1) throw new Error("Device not found");
  ws.devices.splice(idx, 1);
  _audit(all, workspaceId, requestingAccountId, "device.removed", `deviceId=${deviceId}`, "success");
  _save(all);
}

// ── Audit Log ─────────────────────────────────────────────────────

function getAuditLog(workspaceId, { limit = 100, accountId, action } = {}) {
  const { ws } = _ws(workspaceId);
  let rows = ws.auditLog || [];
  if (accountId) rows = rows.filter(r => r.accountId === accountId);
  if (action)    rows = rows.filter(r => r.action.includes(action));
  return rows.slice(0, Math.min(limit, MAX_AUDIT_ROWS));
}

function addAuditEntry(workspaceId, accountId, action, detail, outcome = "success") {
  const { all } = _ws(workspaceId);
  _audit(all, workspaceId, accountId, action, detail, outcome);
  _save(all);
}

// ── Policies ──────────────────────────────────────────────────────

function getPolicies(workspaceId) {
  const { ws } = _ws(workspaceId);
  return ws.policies;
}

function updatePolicies(workspaceId, patch, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const ALLOWED_KEYS = Object.keys(_defaultPolicies());
  for (const key of Object.keys(patch)) {
    if (ALLOWED_KEYS.includes(key)) ws.policies[key] = patch[key];
  }
  _audit(all, workspaceId, requestingAccountId, "policy.updated", Object.keys(patch).join(", "), "success");
  _save(all);
  return ws.policies;
}

// ── Tokens (PAT + Service) ────────────────────────────────────────

function getTokens(workspaceId, accountId = null) {
  const { ws } = _ws(workspaceId);
  const tokens = (ws.tokens || []).filter(t => !t.revokedAt);
  if (accountId) return tokens.filter(t => t.createdBy === accountId);
  return tokens.map(t => ({ ...t, secret: undefined })); // strip secret from list
}

function createToken(workspaceId, { name, type = "pat", scopes = [], expiresInDays = 90, createdBy }) {
  if (!["pat", "service"].includes(type)) throw new Error("type must be pat or service");
  const { all, ws } = _ws(workspaceId);
  if (!ws.tokens) ws.tokens = [];
  const secret = `ooplix_${type}_${crypto.randomBytes(28).toString("hex")}`;
  const token = {
    id:        `tok_${crypto.randomBytes(8).toString("hex")}`,
    name:      name?.trim() || `${type} token`,
    type,
    scopes,
    secret,
    secretHint: `…${secret.slice(-6)}`,
    createdBy,
    createdAt:  Date.now(),
    expiresAt:  Date.now() + expiresInDays * 86400_000,
    lastUsedAt: null,
    revokedAt:  null,
  };
  ws.tokens.unshift(token);
  _audit(all, workspaceId, createdBy, "token.created", `name=${token.name} type=${type}`, "success");
  _save(all);
  // Return full secret only on creation
  return token;
}

function revokeToken(workspaceId, tokenId, requestingAccountId) {
  const { all, ws } = _ws(workspaceId);
  const t = (ws.tokens || []).find(t => t.id === tokenId);
  if (!t) throw new Error("Token not found");
  if (t.revokedAt) throw new Error("Token already revoked");
  t.revokedAt  = Date.now();
  t.revokedBy  = requestingAccountId;
  _audit(all, workspaceId, requestingAccountId, "token.revoked", `tokenId=${tokenId} name=${t.name}`, "success");
  _save(all);
}

function touchToken(workspaceId, tokenId) {
  const { all, ws } = _ws(workspaceId);
  const t = (ws.tokens || []).find(t => t.id === tokenId && !t.revokedAt);
  if (t) { t.lastUsedAt = Date.now(); _save(all); }
}

// ── Security Score ────────────────────────────────────────────────

function getSecurityScore(workspaceId) {
  const { ws } = _ws(workspaceId);
  const score = _score(ws);
  const activeSessions = (ws.sessions || []).filter(s => s.active).length;
  const trustedDevices = (ws.devices || []).filter(d => d.trusted).length;
  const activeTokens   = (ws.tokens  || []).filter(t => !t.revokedAt && t.expiresAt > Date.now()).length;
  return {
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D",
    factors: {
      mfa:          ws.policies?.requireMfa,
      auditLog:     ws.policies?.auditLogEnabled,
      deviceTrust:  ws.policies?.enforceDeviceTrust,
      ipAllowlist:  (ws.policies?.ipAllowlist || []).length > 0,
      shortSessions: ws.policies?.sessionTimeoutHours <= 8,
    },
    stats: { activeSessions, trustedDevices, activeTokens },
  };
}

module.exports = {
  getSessions, registerSession, touchSession, deleteSession,
  getDevices, registerDevice, trustDevice, deleteDevice,
  getAuditLog, addAuditEntry,
  getPolicies, updatePolicies,
  getTokens, createToken, revokeToken, touchToken,
  getSecurityScore,
};
