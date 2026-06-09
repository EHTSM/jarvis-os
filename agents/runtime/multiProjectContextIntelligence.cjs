"use strict";
/**
 * Phase 696 — Multi-Project Context Intelligence
 *
 * Isolated execution memory, workflow continuity per project,
 * project-specific replay, interrupted environment restoration,
 * relevant operational context prioritization.
 * Bounded context memory. Replay-safe isolation. Stale-context cleanup.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/multi-project-ctx.json");
const MAX_PROJECTS = 20;
const MAX_CTX_PER  = 10;
const TTL_MS       = 48 * 60 * 60 * 1000;
const STALE_MS     = 8  * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { projects: {} }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    const keys = Object.keys(db.projects || {});
    keys.forEach(k => {
        db.projects[k].contexts = (db.projects[k].contexts || []).filter(c => c.ts > cutoff).slice(0, MAX_CTX_PER);
        if (db.projects[k].contexts.length === 0 && (Date.now() - db.projects[k].lastSeen) > TTL_MS) delete db.projects[k];
    });
    // Keep max projects
    const remaining = Object.keys(db.projects || {});
    if (remaining.length > MAX_PROJECTS) {
        const sorted = remaining.sort((a, b) => (db.projects[b].lastSeen || 0) - (db.projects[a].lastSeen || 0));
        sorted.slice(MAX_PROJECTS).forEach(k => delete db.projects[k]);
    }
}

// ── Project context isolation ─────────────────────────────────────────────────

function saveProjectContext(projectId, ctxKey, opts = {}) {
    if (!projectId || !ctxKey) return { ok: false, error: "projectId and ctxKey required" };
    const { type = "workflow", goal = "", replayId = null, state = null } = opts;

    const db = _load(); _prune(db);
    if (!db.projects[projectId]) db.projects[projectId] = { projectId, contexts: [], lastSeen: Date.now() };

    const proj = db.projects[projectId];
    proj.lastSeen = Date.now();

    const idx = proj.contexts.findIndex(c => c.ctxKey === ctxKey);
    const record = { ctxKey, type, goal: goal.slice(0, 200), replayId, state, ts: Date.now() };

    if (idx >= 0) { proj.contexts[idx] = record; }
    else          { proj.contexts.unshift(record); }

    _save(db);
    return { ok: true, projectId, ctxKey, type };
}

function getProjectContext(projectId, ctxKey = null) {
    const db   = _load(); _prune(db);
    const proj = db.projects[projectId];
    if (!proj) return { ok: false, error: `Project '${projectId}' not found` };

    if (ctxKey) {
        const ctx = proj.contexts.find(c => c.ctxKey === ctxKey);
        if (!ctx) return { ok: false, error: `Context '${ctxKey}' not found in project '${projectId}'` };
        const stale = (Date.now() - ctx.ts) > STALE_MS;
        return { ok: true, projectId, ctxKey, context: ctx, stale, warning: stale ? "Context stale (>8h)" : null };
    }

    return { ok: true, projectId, contexts: proj.contexts, count: proj.contexts.length };
}

// ── Workflow continuity ───────────────────────────────────────────────────────

function preserveProjectWorkflowContinuity(projectId, workflowId, opts = {}) {
    return saveProjectContext(projectId, `workflow:${workflowId}`, { type: "workflow", ...opts });
}

function restoreProjectWorkflowContinuity(projectId, workflowId) {
    return getProjectContext(projectId, `workflow:${workflowId}`);
}

// ── Project-specific replay ───────────────────────────────────────────────────

function persistProjectReplay(projectId, replayId, opts = {}) {
    if (!projectId || !replayId) return { ok: false, error: "projectId and replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup  = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`project-replay:${projectId}:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Project replay already in dedup window" };

    return saveProjectContext(projectId, `replay:${replayId}`, { type: "replay", ...opts, replayId });
}

function recallProjectReplays(projectId, goal = "") {
    const db   = _load(); _prune(db);
    const proj = db.projects[projectId];
    if (!proj) return { ok: true, projectId, replays: [] };

    const q = goal.toLowerCase().slice(0, 100);
    const replays = proj.contexts
        .filter(c => c.type === "replay" && (c.goal.toLowerCase().includes(q) || q === ""))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 5);

    return { ok: true, projectId, replays, count: replays.length };
}

// ── Interrupted environment restoration ──────────────────────────────────────

function restoreInterruptedProjectEnvironment(projectId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const db   = _load(); _prune(db);
    const proj = db.projects[projectId];
    if (!proj) return { ok: false, error: `Project '${projectId}' not found` };

    const interrupted = proj.contexts.filter(c => c.state?.interrupted || c.state?.status === "interrupted");

    return {
        ok:          true,
        projectId,
        interrupted,
        count:       interrupted.length,
        approvalRequired: true,
        detail:      interrupted.length > 0 ? `${interrupted.length} interrupted context(s) in '${projectId}'` : "No interrupted contexts",
    };
}

// ── Context prioritization ────────────────────────────────────────────────────

function prioritizeProjectContext(projectId, goal = "") {
    const db   = _load(); _prune(db);
    const proj = db.projects[projectId];
    if (!proj) return { ok: true, projectId, results: [], count: 0 };

    const q       = goal.toLowerCase().slice(0, 100);
    const cutoff  = Date.now() - STALE_MS;
    const results = proj.contexts
        .filter(c => c.ts > cutoff && (c.goal.toLowerCase().includes(q) || q === ""))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 5);

    return {
        ok:      true,
        projectId,
        goal,
        results,
        count:   results.length,
        primary: results[0] || null,
    };
}

// ── Stale context cleanup ─────────────────────────────────────────────────────

function cleanupStaleProjectContexts({ dryRun = true } = {}) {
    const db     = _load();
    const cutoff = Date.now() - STALE_MS;
    let staleCount = 0;

    Object.values(db.projects || {}).forEach(proj => {
        const stale = proj.contexts.filter(c => c.ts < cutoff);
        staleCount += stale.length;
        if (!dryRun) proj.contexts = proj.contexts.filter(c => c.ts >= cutoff);
    });

    if (!dryRun) _save(db);
    return { ok: true, staleCount, pruned: !dryRun, projectCount: Object.keys(db.projects || {}).length };
}

function listProjects() {
    const db = _load(); _prune(db);
    return Object.values(db.projects || {}).map(p => ({
        projectId: p.projectId,
        contextCount: p.contexts.length,
        lastSeen: p.lastSeen,
        ageMs: Date.now() - p.lastSeen,
    }));
}

module.exports = { saveProjectContext, getProjectContext, preserveProjectWorkflowContinuity, restoreProjectWorkflowContinuity, persistProjectReplay, recallProjectReplays, restoreInterruptedProjectEnvironment, prioritizeProjectContext, cleanupStaleProjectContexts, listProjects };
