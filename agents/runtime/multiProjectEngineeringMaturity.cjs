"use strict";
/**
 * Phase 730 — Multi-Project Engineering Maturity
 *
 * Project isolation, cross-project switching, environment restoration,
 * replay separation, deployment continuity, workflow survivability.
 * PREVENTS: shared-state corruption, replay crossover, workflow contamination.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH     = path.join(__dirname, "../../data/multi-project-maturity.json");
const TTL_MS         = 48 * 60 * 60 * 1000;
const STALE_MS       = 8  * 60 * 60 * 1000;
const MAX_PROJECTS   = 20;
const MAX_REPLAYS    = 10;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { projects: {}, activeProject: null }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    Object.keys(db.projects || {}).forEach(pid => {
        const p = db.projects[pid];
        if (p.ts < cut) { delete db.projects[pid]; return; }
        p.replays = (p.replays || []).filter(r => r.ts > cut).slice(0, MAX_REPLAYS);
    });
    const keys = Object.keys(db.projects || {});
    if (keys.length > MAX_PROJECTS) {
        const sorted = keys.sort((a, b) => db.projects[b].ts - db.projects[a].ts);
        sorted.slice(MAX_PROJECTS).forEach(k => delete db.projects[k]);
    }
}

// ── Project registration + isolation ─────────────────────────────────────────

function registerProject(projectId, { name = "", env = "default", repoPath = "" } = {}) {
    if (!projectId) return { ok: false, error: "projectId required" };
    const db = _load(); _prune(db);
    db.projects[projectId] = { ...(db.projects[projectId] || {}), projectId, name, env, repoPath, ts: Date.now(), replays: db.projects[projectId]?.replays || [] };
    _save(db);
    return { ok: true, projectId, name, env };
}

// ── Cross-project switching ───────────────────────────────────────────────────

function switchProject(projectId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load();
    const p   = db.projects[projectId];
    if (!p) return { ok: false, error: `Project '${projectId}' not registered` };

    const previous = db.activeProject;
    db.activeProject = projectId;
    _save(db);

    // Restore project context from MPCI
    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    let ctx = null;
    if (mpci) { try { ctx = mpci.getProjectContext(projectId, "workflow:active"); } catch {} }

    return { ok: true, projectId, previous, name: p.name, env: p.env, contextRestored: ctx?.ok || false };
}

function getActiveProject() {
    const db = _load();
    if (!db.activeProject) return { ok: false, error: "No active project" };
    const p = db.projects[db.activeProject];
    return { ok: true, projectId: db.activeProject, name: p?.name, env: p?.env };
}

// ── Environment restoration per project ──────────────────────────────────────

function restoreProjectEnvironment(projectId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db = _load();
    const p  = db.projects[projectId];
    if (!p) return { ok: false, error: `Project '${projectId}' not registered` };

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    let restored = false;
    if (mpci) {
        try { const r = mpci.restoreProjectWorkflowContinuity(projectId); restored = r.ok; } catch {}
    }

    return { ok: true, projectId, env: p.env, contextRestored: restored, detail: `Project env restored: ${projectId}` };
}

// ── Replay separation (prevent crossover) ────────────────────────────────────

function saveProjectReplay(projectId, replayId, data = {}) {
    if (!projectId || !replayId) return { ok: false, error: "projectId and replayId required" };
    const db = _load(); _prune(db);
    if (!db.projects[projectId]) return { ok: false, error: `Project '${projectId}' not registered` };

    const replays = db.projects[projectId].replays || [];
    // Isolation: reject replayId already belonging to a different project
    const owner = Object.keys(db.projects).find(pid => pid !== projectId && (db.projects[pid].replays || []).some(r => r.replayId === replayId));
    if (owner) return { ok: false, error: `Replay '${replayId}' belongs to project '${owner}' — crossover prevented`, crossover: true };

    const idx = replays.findIndex(r => r.replayId === replayId);
    const record = { replayId, data, ts: Date.now() };
    if (idx >= 0) { replays[idx] = record; } else { replays.unshift(record); }
    db.projects[projectId].replays = replays.slice(0, MAX_REPLAYS);
    _save(db);
    return { ok: true, projectId, replayId };
}

function getProjectReplays(projectId) {
    const db = _load();
    const p  = db.projects[projectId];
    if (!p) return { ok: false, error: `Project '${projectId}' not registered` };
    return { ok: true, projectId, replays: (p.replays || []).map(r => ({ replayId: r.replayId, ts: r.ts })), count: p.replays?.length || 0 };
}

// ── Deployment continuity per project ────────────────────────────────────────

function persistProjectDeploymentSession(projectId, deploymentId, state = {}) {
    if (!projectId || !deploymentId) return { ok: false, error: "projectId and deploymentId required" };
    const db = _load();
    if (!db.projects[projectId]) return { ok: false, error: `Project '${projectId}' not registered` };
    db.projects[projectId].lastDeployment = { deploymentId, state, ts: Date.now() };
    _save(db);
    return { ok: true, projectId, deploymentId };
}

// ── Workflow survivability ────────────────────────────────────────────────────

function projectWorkflowSurvivability(projectId) {
    const db = _load();
    const p  = db.projects[projectId];
    if (!p) return { ok: false, error: `Project '${projectId}' not registered` };

    const ageMs  = Date.now() - p.ts;
    const stale  = ageMs > STALE_MS;
    const deplAge = p.lastDeployment ? Date.now() - p.lastDeployment.ts : null;
    const deployStale = deplAge ? deplAge > 48 * 60 * 60 * 1000 : null;

    return {
        ok:            !stale,
        projectId,
        stale,
        ageMs,
        replayCount:   p.replays?.length || 0,
        hasDeployment: !!p.lastDeployment,
        deployStale,
        summary:       `Project ${projectId}: stale=${stale} replays=${p.replays?.length || 0} deploy=${p.lastDeployment ? "present" : "none"}`,
    };
}

// ── Contamination check ───────────────────────────────────────────────────────

function checkWorkflowContamination(projectId) {
    const db     = _load();
    const issues = [];

    // Check replay crossover
    const myReplays = new Set((db.projects[projectId]?.replays || []).map(r => r.replayId));
    Object.keys(db.projects).forEach(pid => {
        if (pid === projectId) return;
        (db.projects[pid].replays || []).forEach(r => {
            if (myReplays.has(r.replayId)) issues.push({ issue: `replay-crossover:${r.replayId}`, otherProject: pid, severity: "critical" });
        });
    });

    return { ok: issues.length === 0, issues, contaminated: issues.length > 0, projectId };
}

function listProjects() {
    const db = _load(); _prune(db);
    return Object.values(db.projects).map(p => ({ projectId: p.projectId, name: p.name, env: p.env, replayCount: p.replays?.length || 0, ageMs: Date.now() - p.ts }));
}

module.exports = { registerProject, switchProject, getActiveProject, restoreProjectEnvironment, saveProjectReplay, getProjectReplays, persistProjectDeploymentSession, projectWorkflowSurvivability, checkWorkflowContamination, listProjects };
