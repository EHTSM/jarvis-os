"use strict";
/**
 * Phase 541 — Persistent Engineering Workspaces
 *
 * Persistent workspace identity, project-scoped operational memory,
 * deployment-specific state, debugging-session restoration,
 * reconnect-safe continuity.
 *
 * Bounded, replay-safe, file-backed.
 * data/persistent-workspaces.json — max 20 workspaces, 60-day TTL
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STORE_PATH   = path.join(__dirname, "../../data/persistent-workspaces.json");
const MAX_WS       = 20;
const TTL_MS       = 60 * 24 * 60 * 60 * 1000;
const MAX_EVENTS   = 50;   // per workspace operational log

function _load() {
    try {
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
        const now = Date.now();
        return raw.filter(w => now - w.createdAt < TTL_MS);
    } catch { return []; }
}

function _save(list) {
    try { fs.writeFileSync(STORE_PATH, JSON.stringify(list.slice(-MAX_WS), null, 2)); } catch {}
}

function _id() { return `pw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// ── Create / upsert ───────────────────────────────────────────────────────────

function upsertWorkspace(name, opts = {}) {
    if (!name) return { ok: false, error: "name required" };
    const list = _load();
    const existing = list.find(w => w.name === name && (!opts.operatorId || w.operatorId === opts.operatorId));

    if (existing) {
        existing.updatedAt    = Date.now();
        existing.description  = opts.description  ?? existing.description;
        existing.projectPath  = opts.projectPath  ?? existing.projectPath;
        existing.tags         = opts.tags         ?? existing.tags;
        _save(list);
        return { ok: true, created: false, workspace: existing };
    }

    const ws = {
        id:          _id(),
        name,
        operatorId:  opts.operatorId  || "default",
        description: opts.description || "",
        projectPath: opts.projectPath || null,
        tags:        opts.tags        || [],
        deploymentState: {},
        debuggingContext: null,
        operationalLog: [],
        createdAt:   Date.now(),
        updatedAt:   Date.now(),
    };
    list.push(ws);
    _save(list);
    return { ok: true, created: true, workspace: ws };
}

// ── Deployment state ──────────────────────────────────────────────────────────

function setDeploymentState(workspaceId, pipelineName, state) {
    const list = _load();
    const ws = list.find(w => w.id === workspaceId);
    if (!ws) return { ok: false, error: "workspace not found" };
    ws.deploymentState[pipelineName] = { ...state, updatedAt: Date.now() };
    ws.updatedAt = Date.now();
    _save(list);
    return { ok: true };
}

function getDeploymentState(workspaceId, pipelineName) {
    const ws = _load().find(w => w.id === workspaceId);
    if (!ws) return null;
    return pipelineName ? (ws.deploymentState[pipelineName] || null) : ws.deploymentState;
}

// ── Debugging context ─────────────────────────────────────────────────────────

function saveDebuggingContext(workspaceId, context) {
    const list = _load();
    const ws = list.find(w => w.id === workspaceId);
    if (!ws) return { ok: false, error: "workspace not found" };
    ws.debuggingContext = { ...context, savedAt: Date.now() };
    ws.updatedAt = Date.now();
    _save(list);
    return { ok: true };
}

function restoreDebuggingContext(workspaceId) {
    const ws = _load().find(w => w.id === workspaceId);
    if (!ws || !ws.debuggingContext) return { available: false };
    const ageMs = Date.now() - (ws.debuggingContext.savedAt || 0);
    return {
        available: true,
        context:   ws.debuggingContext,
        ageMins:   Math.round(ageMs / 60_000),
        stale:     ageMs > 4 * 60 * 60_000, // > 4h = stale
    };
}

// ── Operational log ───────────────────────────────────────────────────────────

function logEvent(workspaceId, eventType, meta = {}) {
    const list = _load();
    const ws = list.find(w => w.id === workspaceId);
    if (!ws) return { ok: false, error: "workspace not found" };
    ws.operationalLog = ws.operationalLog || [];
    ws.operationalLog.push({ eventType, ts: Date.now(), ...Object.fromEntries(Object.entries(meta).slice(0, 5)) });
    if (ws.operationalLog.length > MAX_EVENTS) ws.operationalLog = ws.operationalLog.slice(-MAX_EVENTS);
    ws.updatedAt = Date.now();
    _save(list);
    return { ok: true };
}

// ── Reconnect continuity ──────────────────────────────────────────────────────

function reconnect(workspaceId) {
    const ws = _load().find(w => w.id === workspaceId);
    if (!ws) return { ok: false, error: "workspace not found" };

    const pressure = _tryRequire("./runtimePressureMonitor.cjs");
    const modes    = _tryRequire("./runtimeModes.cjs");
    const session  = _tryRequire("./engineeringSession.cjs");

    const pres     = pressure ? pressure.computePressure() : { level: "nominal", score: 0 };
    const mode     = modes    ? modes.getActiveMode().name  : "unknown";

    const recentLog = (ws.operationalLog || []).slice(-5);
    const debugCtx  = ws.debuggingContext;
    const deployState = Object.keys(ws.deploymentState || {}).map(k => ({
        pipeline: k, ...ws.deploymentState[k],
    }));

    const hints = [];
    if (debugCtx && !debugCtx.resolved) hints.push("Unresolved debugging context available — restore to continue");
    const unresolvedDeploys = deployState.filter(d => d.status === "in-progress");
    if (unresolvedDeploys.length) hints.push(`${unresolvedDeploys.length} deployment(s) in-progress at disconnect`);
    if (pres.level !== "nominal") hints.push(`Runtime pressure: ${pres.level} — resolve before resuming heavy work`);

    return {
        ok: true,
        workspaceId,
        name:         ws.name,
        mode,
        pressureLevel: pres.level,
        debuggingContextAvailable: !!debugCtx && !debugCtx.resolved,
        deploymentStateCount: deployState.length,
        recentLog,
        hints,
        reconnectedAt: new Date().toISOString(),
    };
}

// ── List / get / delete ───────────────────────────────────────────────────────

function listWorkspaces({ operatorId } = {}) {
    const list = _load();
    return operatorId ? list.filter(w => w.operatorId === operatorId) : list;
}

function getWorkspace(id) {
    return _load().find(w => w.id === id) || null;
}

function deleteWorkspace(id) {
    const list = _load();
    const idx  = list.findIndex(w => w.id === id);
    if (idx < 0) return { ok: false, error: "not found" };
    list.splice(idx, 1);
    _save(list);
    return { ok: true };
}

module.exports = {
    upsertWorkspace, setDeploymentState, getDeploymentState,
    saveDebuggingContext, restoreDebuggingContext,
    logEvent, reconnect, listWorkspaces, getWorkspace, deleteWorkspace,
};
