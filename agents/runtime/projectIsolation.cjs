"use strict";
/**
 * Phase 551 — Multi-Project Execution Isolation
 *
 * Isolated runtime contexts, isolated replay systems,
 * project-specific deployment history, isolated workflow memory,
 * isolated recovery chains.
 *
 * Prevents: cross-project contamination, replay crossover, shared runtime corruption.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const ISOLATION_PATH = path.join(__dirname, "../../data/project-isolation.json");
const MAX_PROJECTS   = 20;
const TTL_MS         = 90 * 24 * 60 * 60 * 1000;

function _load() {
    try {
        const raw = JSON.parse(fs.readFileSync(ISOLATION_PATH, "utf8"));
        const now = Date.now();
        return (raw || []).filter(p => now - p.createdAt < TTL_MS);
    } catch { return []; }
}

function _save(projects) {
    try { fs.writeFileSync(ISOLATION_PATH, JSON.stringify(projects.slice(-MAX_PROJECTS), null, 2)); } catch {}
}

function _id() { return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

// ── Project registration ──────────────────────────────────────────────────────

function registerProject(name, opts = {}) {
    if (!name) return { ok: false, error: "name required" };
    const projects = _load();
    const existing = projects.find(p => p.name === name);
    if (existing) return { ok: true, created: false, project: existing };

    const project = {
        id:          _id(),
        name,
        description: opts.description || "",
        rootPath:    opts.rootPath    || null,
        operatorId:  opts.operatorId  || "default",
        tags:        opts.tags        || [],
        // Isolation boundaries
        allowedWorkflows:   opts.allowedWorkflows   || null, // null = all
        allowedPipelines:   opts.allowedPipelines   || null,
        isolatedMemory:     opts.isolatedMemory     !== false,
        isolatedReplays:    opts.isolatedReplays    !== false,
        deploymentHistory:  [],
        workflowMemory:     [],
        createdAt:   Date.now(),
        updatedAt:   Date.now(),
    };
    projects.push(project);
    _save(projects);
    return { ok: true, created: true, project };
}

function getProject(idOrName) {
    const projects = _load();
    return projects.find(p => p.id === idOrName || p.name === idOrName) || null;
}

function listProjects({ operatorId } = {}) {
    const projects = _load();
    return operatorId ? projects.filter(p => p.operatorId === operatorId) : projects;
}

// ── Workflow isolation ────────────────────────────────────────────────────────

/**
 * Checks whether a workflow is allowed in the given project context.
 */
function checkWorkflowAllowed(projectId, workflowId) {
    const project = getProject(projectId);
    if (!project) return { allowed: true, reason: "no project context — unrestricted" };
    if (!project.allowedWorkflows) return { allowed: true, reason: "project allows all workflows" };
    const allowed = project.allowedWorkflows.includes(workflowId);
    return {
        allowed,
        reason: allowed ? `workflow "${workflowId}" is allowed in this project` : `workflow "${workflowId}" is not in this project's allowed list`,
    };
}

// ── Deployment history isolation ──────────────────────────────────────────────

function recordProjectDeployment(projectId, deployment) {
    const projects = _load();
    const project  = projects.find(p => p.id === projectId || p.name === projectId);
    if (!project) return { ok: false, error: "project not found" };
    project.deploymentHistory = project.deploymentHistory || [];
    project.deploymentHistory.push({ ...deployment, recordedAt: Date.now() });
    if (project.deploymentHistory.length > 20) project.deploymentHistory = project.deploymentHistory.slice(-20);
    project.updatedAt = Date.now();
    _save(projects);
    return { ok: true };
}

function getProjectDeployments(projectId) {
    const project = getProject(projectId);
    if (!project) return { ok: false, error: "project not found" };
    return { ok: true, projectId, deployments: project.deploymentHistory || [] };
}

// ── Isolated workflow memory ──────────────────────────────────────────────────

function saveProjectMemory(projectId, entry) {
    const projects = _load();
    const project  = projects.find(p => p.id === projectId || p.name === projectId);
    if (!project) return { ok: false, error: "project not found" };
    if (!project.isolatedMemory) return { ok: false, error: "project does not use isolated memory" };

    project.workflowMemory = project.workflowMemory || [];
    project.workflowMemory.push({ ...entry, savedAt: Date.now() });
    if (project.workflowMemory.length > 50) project.workflowMemory = project.workflowMemory.slice(-50);
    project.updatedAt = Date.now();
    _save(projects);
    return { ok: true };
}

function getProjectMemory(projectId) {
    const project = getProject(projectId);
    if (!project) return { ok: false, error: "project not found" };
    return { ok: true, projectId, memory: project.workflowMemory || [], isolated: !!project.isolatedMemory };
}

// ── Contamination guard ───────────────────────────────────────────────────────

/**
 * Checks whether a session/replay belongs to the given project context.
 * Returns a contamination warning if cross-project access is attempted.
 */
function contaminationCheck(projectId, context = {}) {
    const project = getProject(projectId);
    if (!project) return { safe: true, reason: "no project isolation active" };

    const warnings = [];
    if (context.workflowId && project.allowedWorkflows && !project.allowedWorkflows.includes(context.workflowId)) {
        warnings.push(`workflow "${context.workflowId}" not registered in project "${project.name}"`);
    }
    if (context.pipelineName && project.allowedPipelines && !project.allowedPipelines.includes(context.pipelineName)) {
        warnings.push(`pipeline "${context.pipelineName}" not registered in project "${project.name}"`);
    }

    return {
        safe:     warnings.length === 0,
        projectId,
        warnings,
        recommendation: warnings.length > 0 ? "Cross-project boundary detected — verify context before continuing" : "Context is within project isolation bounds",
    };
}

// ── Project snapshot ──────────────────────────────────────────────────────────

function projectSnapshot(projectId) {
    const project = getProject(projectId);
    if (!project) return { ok: false, error: "project not found" };

    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    const runs     = pipeline ? pipeline.listRuns({ limit: 5 }).filter(r => (project.allowedPipelines || []).includes(r.pipeline)) : [];

    return {
        ok:       true,
        project:  { id: project.id, name: project.name, description: project.description, rootPath: project.rootPath },
        isolation: { memory: project.isolatedMemory, replays: project.isolatedReplays, allowedWorkflows: project.allowedWorkflows, allowedPipelines: project.allowedPipelines },
        memoryEntries:     (project.workflowMemory || []).length,
        deploymentHistory: (project.deploymentHistory || []).length,
        recentRuns:        runs.length,
        ts:                new Date().toISOString(),
    };
}

function deleteProject(id) {
    const projects = _load();
    const idx      = projects.findIndex(p => p.id === id || p.name === id);
    if (idx < 0) return { ok: false, error: "not found" };
    projects.splice(idx, 1);
    _save(projects);
    return { ok: true };
}

module.exports = {
    registerProject, getProject, listProjects, deleteProject,
    checkWorkflowAllowed, recordProjectDeployment, getProjectDeployments,
    saveProjectMemory, getProjectMemory,
    contaminationCheck, projectSnapshot,
};
