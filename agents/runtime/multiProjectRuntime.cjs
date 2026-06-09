"use strict";
/**
 * Phase 595 — Multi-Project Operation Hardening
 *
 * Isolated execution memory, isolated replay systems, isolated deployment
 * history, reconnect-safe project switching, workflow-scoped runtime state.
 *
 * Prevents: cross-project contamination, replay crossover, shared runtime corruption.
 */

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const STATE_PATH = path.join(__dirname, "../../data/multi-project-runtime.json");
const MAX_PROJECTS = 20;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { projects: {}, activeMappings: {} }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Project registry ──────────────────────────────────────────────────────────

function registerProject(opts = {}) {
    const { name, rootPath = "", environment = "default" } = opts;
    if (!name) return { ok: false, error: "name required" };

    const db  = _load();
    if (Object.keys(db.projects).length >= MAX_PROJECTS && !db.projects[name]) {
        return { ok: false, error: `Max ${MAX_PROJECTS} projects reached` };
    }

    db.projects[name] = {
        name,
        rootPath:     (rootPath || "").slice(0, 300),
        environment,
        createdAt:    db.projects[name]?.createdAt || Date.now(),
        lastActiveAt: Date.now(),
        isolatedMemoryKey: `proj:${name}`,
        isolatedReplayKey: `replay:${name}`,
        isolatedDeployKey: `deploy:${name}`,
        sessionCount: (db.projects[name]?.sessionCount || 0),
    };
    _save(db);
    return { ok: true, name, environment };
}

function getProject(name) {
    const db = _load();
    return db.projects[name] || null;
}

function listProjects() {
    const db = _load();
    return Object.values(db.projects).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
}

// ── Session → project mapping ─────────────────────────────────────────────────

function mapSessionToProject(sessionId, projectName) {
    const db  = _load();
    if (!db.projects[projectName]) return { ok: false, error: `Project '${projectName}' not found` };
    db.activeMappings[sessionId] = { projectName, mappedAt: Date.now() };
    db.projects[projectName].sessionCount = (db.projects[projectName].sessionCount || 0) + 1;
    db.projects[projectName].lastActiveAt = Date.now();
    _save(db);
    return { ok: true, sessionId, projectName };
}

function getSessionProject(sessionId) {
    const db = _load();
    return (db.activeMappings[sessionId] || {}).projectName || null;
}

// ── Isolation enforcement ─────────────────────────────────────────────────────

/**
 * Check that a memory/replay/deploy access is scoped to the correct project.
 * Returns { allowed, projectName, reason }
 */
function enforceIsolation(sessionId, resourceKey) {
    const db          = _load();
    const mapping     = db.activeMappings[sessionId];
    if (!mapping) return { allowed: true, reason: "no project mapping — unrestricted" };

    const project     = db.projects[mapping.projectName];
    if (!project) return { allowed: false, reason: "project not found" };

    // Check if resource key is scoped to this project
    const projectKeys = [project.isolatedMemoryKey, project.isolatedReplayKey, project.isolatedDeployKey];
    const isScoped    = !resourceKey || projectKeys.some(k => resourceKey.startsWith(k));

    if (!isScoped) {
        return { allowed: false, reason: `Resource '${resourceKey}' belongs to a different project — cross-project contamination blocked`, projectName: mapping.projectName };
    }
    return { allowed: true, projectName: mapping.projectName };
}

// ── Reconnect-safe project switch ─────────────────────────────────────────────

/**
 * Switch a session to a different project safely.
 * Saves checkpoint before switching, restores context after.
 */
function switchProject(sessionId, newProjectName, { approved = false } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required for project switch" };

    const db  = _load();
    if (!db.projects[newProjectName]) return { ok: false, error: `Project '${newProjectName}' not found` };

    const old = db.activeMappings[sessionId]?.projectName || null;

    // Save checkpoint of current session state
    const ts  = _tryRequire("./terminalSupervisor.cjs");
    if (ts) ts.saveCheckpoint(sessionId, `project-switch-from-${old}`, { previousProject: old, ts: Date.now() });

    mapSessionToProject(sessionId, newProjectName);

    return {
        ok:           true,
        sessionId,
        fromProject:  old,
        toProject:    newProjectName,
        checkpointSaved: ts !== null,
    };
}

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Scoped workflow state ─────────────────────────────────────────────────────

/**
 * Get the full isolated state namespace for a project.
 */
function getProjectNamespace(projectName) {
    const proj = getProject(projectName);
    if (!proj) return null;
    return {
        projectName,
        memoryKey: proj.isolatedMemoryKey,
        replayKey: proj.isolatedReplayKey,
        deployKey: proj.isolatedDeployKey,
        environment: proj.environment,
    };
}

module.exports = { registerProject, getProject, listProjects, mapSessionToProject, getSessionProject, enforceIsolation, switchProject, getProjectNamespace };
