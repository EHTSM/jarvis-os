"use strict";
/**
 * Phase 753 — Engineering Workspace Experience
 *
 * Fast workspace restoration, replay-linked env continuity, multi-project
 * switching, debugging/deployment-session restoration.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE   = path.join(__dirname, "../../data/engineering-workspace-experience.json");
const MAX_WS      = 20;
const STALE_MS    = 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { workspaces: [], activeId: null }; }
}
function _save(db) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} }

function saveWorkspaceSnapshot(workspaceId, snapshot = {}) {
    if (!workspaceId) return { ok: false, error: "workspaceId required" };
    const db  = _load();
    const now = Date.now();
    const existing = db.workspaces.find(w => w.workspaceId === workspaceId);
    if (existing) {
        existing.snapshot  = snapshot;
        existing.savedAt   = now;
    } else {
        db.workspaces.push({ workspaceId, snapshot, savedAt: now, createdAt: now });
        if (db.workspaces.length > MAX_WS) db.workspaces = db.workspaces.slice(-MAX_WS);
    }
    _save(db);
    return { ok: true, workspaceId };
}

function restoreWorkspace(workspaceId) {
    const db  = _load();
    const now = Date.now();
    const ws  = db.workspaces.find(w => w.workspaceId === workspaceId);
    if (!ws) return { ok: false, error: "workspace not found" };
    if (now - ws.savedAt > STALE_MS) return { ok: false, error: "workspace snapshot stale (>24h)", stale: true };

    db.activeId = workspaceId;
    _save(db);
    return { ok: true, workspaceId, snapshot: ws.snapshot, age: now - ws.savedAt };
}

function switchWorkspace(toWorkspaceId) {
    const db  = _load();
    const ws  = db.workspaces.find(w => w.workspaceId === toWorkspaceId);
    if (!ws) return { ok: false, error: "workspace not found" };
    const now = Date.now();
    if (now - ws.savedAt > STALE_MS) return { ok: false, error: "workspace stale — re-save first", stale: true };

    const prev       = db.activeId;
    db.activeId      = toWorkspaceId;
    _save(db);
    return { ok: true, from: prev, to: toWorkspaceId, project: ws.snapshot?.project || "unknown" };
}

function getActiveWorkspace() {
    const db = _load();
    if (!db.activeId) return { ok: true, active: false };
    const ws  = db.workspaces.find(w => w.workspaceId === db.activeId);
    const now = Date.now();
    if (!ws || now - ws.savedAt > STALE_MS) return { ok: true, active: false, stale: true };
    return { ok: true, active: true, workspaceId: db.activeId, snapshot: ws.snapshot, age: now - ws.savedAt };
}

function workspaceExperienceSummary() {
    const db  = _load();
    const now = Date.now();
    const fresh = db.workspaces.filter(w => now - w.savedAt <= STALE_MS).length;

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    let restorationReady = false;
    if (iwr) { try { restorationReady = true; } catch {} }

    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    let projectCount = 0;
    if (mpem) { try { projectCount = mpem.listProjects().length; } catch {} }

    return {
        ok: true,
        totalWorkspaces: db.workspaces.length,
        freshWorkspaces: fresh,
        activeId: db.activeId,
        restorationReady,
        projectCount,
        summary: `Workspace experience: ${fresh}/${db.workspaces.length} fresh, active=${db.activeId || "none"}, projects=${projectCount}`,
    };
}

module.exports = { saveWorkspaceSnapshot, restoreWorkspace, switchWorkspace, getActiveWorkspace, workspaceExperienceSummary };
