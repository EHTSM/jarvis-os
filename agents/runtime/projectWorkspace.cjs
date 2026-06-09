"use strict";
/**
 * Phase 470 — Project Workspace System
 *
 * Multiple engineering workspaces with isolated runtime state,
 * project-specific memory, deployment presets, and workflow collections.
 *
 * A workspace is a named context that binds together:
 *   - an engineering profile
 *   - a runtime mode
 *   - a set of pinned templates
 *   - project-specific memory (key-value, max 50 entries, 256-char values)
 *   - last-used session IDs
 *
 * Storage: data/workspaces.json
 * Max 10 workspaces.
 * Active workspace: data/active-workspace.json
 */

const fs   = require("fs");
const path = require("path");

const WS_PATH     = path.join(__dirname, "../../data/workspaces.json");
const ACTIVE_PATH = path.join(__dirname, "../../data/active-workspace.json");
const MAX_WS      = 10;

const BUILTIN_WS = {
    "default": {
        name:           "default",
        label:          "Default Workspace",
        description:    "General-purpose engineering workspace",
        profile:        "jarvis-os-dev",
        mode:           "development",
        pinnedTemplates: [],
        memory:         {},
        recentSessions: [],
        createdAt:      0,
        builtin:        true,
    },
};

function _load() {
    try { return JSON.parse(fs.readFileSync(WS_PATH, "utf8")); }
    catch { return {}; }
}

function _save(ws) {
    try {
        const dir = path.dirname(WS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(WS_PATH, JSON.stringify(ws, null, 2));
    } catch {}
}

function _getActiveId() {
    try { return JSON.parse(fs.readFileSync(ACTIVE_PATH, "utf8")).workspaceId || "default"; }
    catch { return "default"; }
}

function _setActiveId(id) {
    try { fs.writeFileSync(ACTIVE_PATH, JSON.stringify({ workspaceId: id, switchedAt: Date.now() }, null, 2)); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new workspace. */
function createWorkspace(name, opts = {}) {
    if (!name) throw new Error("name required");
    name = name.slice(0, 40).trim().replace(/[^a-zA-Z0-9_-]/g, "-");
    if (BUILTIN_WS[name]) return { created: false, error: "name conflicts with builtin workspace" };
    const custom = _load();
    if (Object.keys(custom).length >= MAX_WS) return { created: false, error: "workspace limit reached (10)" };
    if (custom[name]) return { created: false, error: "workspace already exists" };
    custom[name] = {
        name,
        label:           (opts.label || name).slice(0, 60),
        description:     (opts.description || "").slice(0, 200),
        profile:         opts.profile  || "jarvis-os-dev",
        mode:            opts.mode     || "development",
        pinnedTemplates: opts.pinnedTemplates || [],
        memory:          {},
        recentSessions:  [],
        createdAt:       Date.now(),
    };
    _save(custom);
    return { created: true, workspace: custom[name] };
}

/** Get a workspace by name. */
function getWorkspace(name) {
    if (BUILTIN_WS[name]) return BUILTIN_WS[name];
    return _load()[name] || null;
}

/** List all workspaces. */
function listWorkspaces() {
    const custom   = _load();
    const activeId = _getActiveId();
    const all      = { ...BUILTIN_WS, ...custom };
    return Object.values(all).map(w => ({
        name:            w.name,
        label:           w.label,
        profile:         w.profile,
        mode:            w.mode,
        active:          w.name === activeId,
        builtin:         !!w.builtin,
        pinnedCount:     (w.pinnedTemplates || []).length,
        recentCount:     (w.recentSessions  || []).length,
        memoryEntries:   Object.keys(w.memory || {}).length,
    }));
}

/** Get the active workspace. */
function getActiveWorkspace() {
    return getWorkspace(_getActiveId()) || BUILTIN_WS.default;
}

/** Switch active workspace. */
function switchWorkspace(name) {
    const ws = getWorkspace(name);
    if (!ws) return { ok: false, error: `workspace not found: ${name}` };
    _setActiveId(name);
    return { ok: true, current: name, workspace: ws };
}

/** Delete a workspace (non-builtin only). */
function deleteWorkspace(name) {
    if (BUILTIN_WS[name]) return false;
    const custom = _load();
    if (!custom[name]) return false;
    delete custom[name];
    _save(custom);
    if (_getActiveId() === name) _setActiveId("default");
    return true;
}

/** Set a workspace memory value. */
function setMemory(workspaceName, key, value) {
    if (BUILTIN_WS[workspaceName]) return false; // builtins are read-only
    const custom = _load();
    const ws = custom[workspaceName];
    if (!ws) return false;
    const k = key.slice(0, 60);
    const v = String(value).slice(0, 256);
    const current = ws.memory || {};
    if (!current[k] && Object.keys(current).length >= 50) return false; // limit 50 keys
    ws.memory = { ...current, [k]: v };
    _save(custom);
    return true;
}

/** Get workspace memory. */
function getMemory(workspaceName) {
    return getWorkspace(workspaceName)?.memory || {};
}

/** Record a session as recently used in this workspace. */
function recordSessionUsage(workspaceName, sessionId) {
    if (BUILTIN_WS[workspaceName]) return;
    const custom = _load();
    const ws = custom[workspaceName];
    if (!ws) return;
    ws.recentSessions = [sessionId, ...(ws.recentSessions || []).filter(id => id !== sessionId)].slice(0, 20);
    _save(custom);
}

/** Pin/unpin a template to a workspace. */
function togglePin(workspaceName, templateName) {
    if (BUILTIN_WS[workspaceName]) return false;
    const custom = _load();
    const ws = custom[workspaceName];
    if (!ws) return false;
    const pinned = ws.pinnedTemplates || [];
    const idx    = pinned.indexOf(templateName);
    if (idx >= 0) pinned.splice(idx, 1);
    else if (pinned.length < 20) pinned.push(templateName);
    ws.pinnedTemplates = pinned;
    _save(custom);
    return true;
}

module.exports = { createWorkspace, getWorkspace, listWorkspaces, getActiveWorkspace, switchWorkspace, deleteWorkspace, setMemory, getMemory, recordSessionUsage, togglePin };
