"use strict";
/**
 * workspaceRegistry.cjs — POST-Ω Sprint P9 Autonomous Workspace Mesh
 *
 * Maintains a registry of every active workspace across all environments.
 * Workspaces: local, electron, browser, vscode, terminal, github,
 *             vps, docker, firebase, supabase, cloudflare, google_cloud.
 *
 * Storage: data/workspace-registry.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "workspace-registry.json");

function _ts() { return new Date().toISOString(); }
function _id() { return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Workspace type definitions ────────────────────────────────────────────────

const WORKSPACE_TYPES = {
  local:        { id: "local",        name: "Local Workspace",   category: "local",  capabilities: ["files","editor","terminal","git","build"] },
  electron:     { id: "electron",     name: "Electron App",      category: "local",  capabilities: ["desktop","ipc","native","menu","tray"] },
  browser:      { id: "browser",      name: "Browser",           category: "remote", capabilities: ["tabs","dom","screenshot","auth","forms"] },
  vscode:       { id: "vscode",       name: "VS Code",           category: "local",  capabilities: ["editor","extensions","debugger","tasks","git"] },
  terminal:     { id: "terminal",     name: "Terminal",          category: "local",  capabilities: ["shell","scripts","processes","env","pipes"] },
  github:       { id: "github",       name: "GitHub",            category: "remote", capabilities: ["repos","prs","issues","actions","releases"] },
  vps:          { id: "vps",          name: "VPS / Server",      category: "remote", capabilities: ["ssh","deployment","nginx","processes","logs"] },
  docker:       { id: "docker",       name: "Docker",            category: "local",  capabilities: ["containers","images","compose","registry","networks"] },
  firebase:     { id: "firebase",     name: "Firebase",          category: "cloud",  capabilities: ["auth","firestore","storage","functions","hosting"] },
  supabase:     { id: "supabase",     name: "Supabase",          category: "cloud",  capabilities: ["postgres","auth","realtime","storage","edge_functions"] },
  cloudflare:   { id: "cloudflare",   name: "Cloudflare",        category: "cloud",  capabilities: ["workers","pages","kv","r2","dns"] },
  google_cloud: { id: "google_cloud", name: "Google Cloud",      category: "cloud",  capabilities: ["gcs","run","functions","pub_sub","bigquery"] },
};

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      workspaces: [],
      stats: { registered: 0, active: 0, failed: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Registration ──────────────────────────────────────────────────────────────

function register({ type, label, config = {}, metadata = {} } = {}) {
  if (!type) return { ok: false, error: "type required" };
  if (!WORKSPACE_TYPES[type]) return { ok: false, error: `unknown type: ${type}` };

  const d    = _load();
  const existing = d.workspaces.find(w => w.type === type && w.label === (label || type));

  if (existing) {
    existing.status    = "active";
    existing.config    = { ...existing.config, ...config };
    existing.metadata  = { ...existing.metadata, ...metadata };
    existing.updatedAt = _ts();
    _save(d);
    return { ok: true, workspace: existing, registered: false };
  }

  const ws = {
    id:           _id(),
    type,
    label:        label || WORKSPACE_TYPES[type].name,
    category:     WORKSPACE_TYPES[type].category,
    capabilities: [...WORKSPACE_TYPES[type].capabilities],
    config,
    metadata,
    status:       "active",
    health:       100,
    missions:     [],
    lastSeen:     _ts(),
    registeredAt: _ts(),
    updatedAt:    _ts(),
  };

  d.workspaces.push(ws);
  d.stats.registered++;
  d.stats.active++;
  _save(d);
  return { ok: true, workspace: ws, registered: true };
}

function deregister(id) {
  const d  = _load();
  const ws = d.workspaces.find(w => w.id === id);
  if (!ws) return { ok: false, error: "workspace not found" };
  ws.status    = "offline";
  ws.updatedAt = _ts();
  d.stats.active = Math.max(0, d.stats.active - 1);
  _save(d);
  return { ok: true };
}

function setStatus(id, status, health) {
  const d  = _load();
  const ws = d.workspaces.find(w => w.id === id);
  if (!ws) return { ok: false, error: "not found" };
  ws.status    = status;
  ws.lastSeen  = _ts();
  ws.updatedAt = _ts();
  if (health !== undefined) ws.health = health;
  d.stats.active = d.workspaces.filter(w => w.status === "active").length;
  d.stats.failed = d.workspaces.filter(w => w.status === "failed").length;
  _save(d);
  return { ok: true, workspace: ws };
}

function get(id) {
  return _load().workspaces.find(w => w.id === id) || null;
}

function getByType(type) {
  return _load().workspaces.filter(w => w.type === type);
}

function list({ status, category, type, capability } = {}) {
  let list = _load().workspaces;
  if (status)     list = list.filter(w => w.status === status);
  if (category)   list = list.filter(w => w.category === category);
  if (type)       list = list.filter(w => w.type === type);
  if (capability) list = list.filter(w => w.capabilities.includes(capability));
  return list;
}

function assignMission(workspaceId, missionId) {
  const d  = _load();
  const ws = d.workspaces.find(w => w.id === workspaceId);
  if (!ws) return { ok: false, error: "not found" };
  if (!ws.missions.includes(missionId)) ws.missions.push(missionId);
  ws.updatedAt = _ts();
  _save(d);
  return { ok: true };
}

function removeMission(workspaceId, missionId) {
  const d  = _load();
  const ws = d.workspaces.find(w => w.id === workspaceId);
  if (!ws) return { ok: false, error: "not found" };
  ws.missions  = ws.missions.filter(m => m !== missionId);
  ws.updatedAt = _ts();
  _save(d);
  return { ok: true };
}

function getStats() {
  const d = _load();
  const byType = {};
  for (const ws of d.workspaces) byType[ws.type] = (byType[ws.type] || 0) + 1;
  return { ...d.stats, total: d.workspaces.length, byType, updatedAt: d.updatedAt };
}

module.exports = {
  WORKSPACE_TYPES,
  register,
  deregister,
  setStatus,
  get,
  getByType,
  list,
  assignMission,
  removeMission,
  getStats,
};
