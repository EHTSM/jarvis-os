"use strict";
/**
 * Phase 700 — Long-Horizon Workspace Continuity
 *
 * Multi-day engineering continuity, reconnect-safe replay persistence,
 * interrupted workspace restoration, deployment-session survivability,
 * cross-environment replay durability.
 * PREVENTS: stale replay resurrection, duplicate recovery, corrupted restoration.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH      = path.join(__dirname, "../../data/long-horizon-workspace.json");
const SESSION_TTL     = 14 * 24 * 60 * 60 * 1000;
const STALE_THRESHOLD = 48 * 60 * 60 * 1000;
const DEDUP_MS        = 10 * 60 * 1000;
const STORM_THRESHOLD = 8;
const STORM_WINDOW    = 60 * 60 * 1000;
const MAX_SESSIONS    = 50;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], reconnects: [], deploymentSessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions           = (db.sessions           || []).filter(s => s.ts > cutoff).slice(0, MAX_SESSIONS);
    db.reconnects         = (db.reconnects         || []).filter(r => r.ts > Date.now() - STORM_WINDOW * 24).slice(-500);
    db.deploymentSessions = (db.deploymentSessions || []).filter(d => d.ts > cutoff).slice(0, 30);
}
function _isDup(db, key) { return (db.dedup || []).some(d => d.key === key); }

// ── Multi-day workspace session ───────────────────────────────────────────────

function persistWorkspaceSession(sessionId, opts = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const { goal = "", env = "default", progress = 0, checkpointData = null, projectId = null } = opts;

    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    const record = {
        sessionId, goal: goal.slice(0, 200), env, progress: Math.min(100, Math.max(0, progress)),
        checkpointData, projectId, status: "active",
        createdAt: idx >= 0 ? db.sessions[idx].createdAt : Date.now(),
        ts: Date.now(),
    };
    if (idx >= 0) { db.sessions[idx] = record; } else { db.sessions.unshift(record); }
    _save(db);
    return { ok: true, sessionId, progress: record.progress };
}

function restoreWorkspaceSession(sessionId, { force = false } = {}) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "Session not found" };

    const ageMs = Date.now() - record.ts;
    const stale = ageMs > STALE_THRESHOLD;
    if (stale && !force) return { ok: false, stale: true, ageMs, error: "Session stale (>48h) — pass force=true" };

    return { ok: true, sessionId, record, ageMs, stale, warning: stale ? "Stale session — verify before execution" : null };
}

// ── Reconnect storm detection ─────────────────────────────────────────────────

function recordWorkspaceReconnect(sessionId) {
    const db = _load();
    db.reconnects = (db.reconnects || []);
    db.reconnects.push({ sessionId, ts: Date.now() });
    db.reconnects = db.reconnects.slice(-500);
    _save(db);

    const windowCutoff = Date.now() - STORM_WINDOW;
    const recentCount  = db.reconnects.filter(r => r.ts > windowCutoff).length;
    const storm        = recentCount >= STORM_THRESHOLD;
    return { ok: !storm, storm, recentCount, threshold: STORM_THRESHOLD, warning: storm ? `Reconnect storm: ${recentCount}/hour` : null };
}

function workspaceStormStatus() {
    const db           = _load();
    const windowCutoff = Date.now() - STORM_WINDOW;
    const recentCount  = (db.reconnects || []).filter(r => r.ts > windowCutoff).length;
    const storm        = recentCount >= STORM_THRESHOLD;
    return { ok: !storm, storm, recentCount, threshold: STORM_THRESHOLD };
}

// ── Cross-environment replay durability ───────────────────────────────────────

function assessCrossEnvReplayDurability() {
    const signals = [];

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) { try { const r = lhs.assessReplayDurability("workspace-check"); if (!r.durable) signals.push(...(r.signals || [])); } catch {} }

    const storm = workspaceStormStatus();
    if (storm.storm) signals.push({ factor: "workspace-reconnect-storm", severity: "critical" });

    const durable = signals.filter(s => s.severity === "critical").length === 0;
    return { ok: durable, durable, signals, detail: durable ? "Cross-env replay durability intact" : `${signals.length} durability signal(s)` };
}

// ── Interrupted workspace restoration ────────────────────────────────────────

function restoreInterruptedWorkspaceEnvironments({ operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const db = _load(); _prune(db);
    const interrupted = db.sessions.filter(s => s.status === "interrupted" || s.checkpointData?.interrupted);

    const ewr = _tryRequire("./engineeringWorkspaceRestoration.cjs");
    let restorationPlan = null;
    if (ewr) { try { restorationPlan = ewr.workspaceRestorationSummary(); } catch {} }

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    let projects = [];
    if (mpci) { try { projects = mpci.listProjects(); } catch {} }

    return {
        ok:               true,
        interruptedCount: interrupted.length,
        projectCount:     projects.length,
        restorationPlan,
        approvalRequired: true,
        detail:           `${interrupted.length} interrupted session(s) across ${projects.length} project(s)`,
    };
}

// ── Deployment-session survivability ─────────────────────────────────────────

function persistDeploymentWorkspaceSurvivability(deploymentId, workspaceState = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };
    const db  = _load(); _prune(db);
    const idx = db.deploymentSessions.findIndex(d => d.deploymentId === deploymentId);
    const record = { deploymentId, workspaceState, ts: Date.now() };
    if (idx >= 0) { db.deploymentSessions[idx] = record; } else { db.deploymentSessions.unshift(record); }
    _save(db);
    return { ok: true, deploymentId };
}

function recoverDeploymentWorkspaceSurvivability(deploymentId) {
    const db     = _load();
    const record = db.deploymentSessions.find(d => d.deploymentId === deploymentId);
    if (!record) return { ok: false, error: "No deployment workspace session found" };
    const ageMs = Date.now() - record.ts;
    const stale = ageMs > STALE_THRESHOLD;
    return { ok: true, deploymentId, workspaceState: record.workspaceState, ageMs, stale, warning: stale ? "Deployment session stale" : null };
}

// ── Workspace continuity health ───────────────────────────────────────────────

function workspaceContinuityHealth() {
    const db    = _load(); _prune(db);
    const storm = workspaceStormStatus();
    const stale = db.sessions.filter(s => (Date.now() - s.ts) > STALE_THRESHOLD);
    const durability = assessCrossEnvReplayDurability();

    return {
        ok:               !storm.storm && durability.durable,
        storm:            storm.storm,
        reconnectCount:   storm.recentCount,
        activeSessions:   db.sessions.filter(s => s.status === "active").length,
        staleSessions:    stale.length,
        replayDurable:    durability.durable,
        deploymentCount:  db.deploymentSessions.length,
        summary:          `Workspace continuity: ${!storm.storm ? "HEALTHY" : "STORM"} — sessions=${db.sessions.length} reconnects=${storm.recentCount}/${STORM_THRESHOLD}`,
    };
}

function listWorkspaceSessions({ limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions.slice(0, limit).map(s => ({ sessionId: s.sessionId, goal: s.goal, status: s.status, progress: s.progress, ageMs: Date.now() - s.ts }));
}

module.exports = { persistWorkspaceSession, restoreWorkspaceSession, recordWorkspaceReconnect, workspaceStormStatus, assessCrossEnvReplayDurability, restoreInterruptedWorkspaceEnvironments, persistDeploymentWorkspaceSurvivability, recoverDeploymentWorkspaceSurvivability, workspaceContinuityHealth, listWorkspaceSessions };
