"use strict";
/**
 * Developer AI Operating System — repos, projects, issues, builds, deployments, summaries.
 *
 * Entry points:
 *
 * Repository Management:
 *   createRepo(opts)              — register a repository
 *   updateRepo(repoId, patch)     — update repo metadata
 *   archiveRepo(repoId)           — soft-archive
 *   getRepo(repoId)
 *   listRepos(opts)               — filter by language, status, tag, limit
 *   searchRepos(query)            — keyword search across name / description
 *
 * Project Management:
 *   createProject(opts)           — create an engineering project
 *   updateProject(projectId, patch)
 *   completeProject(projectId, opts)
 *   archiveProject(projectId)
 *   getProject(projectId)
 *   listProjects(opts)            — filter by status, repoId, tag, limit
 *
 * Issue Tracking:
 *   createIssue(opts)             — file an issue (bug / feature / task / chore)
 *   updateIssue(issueId, patch)
 *   assignIssue(issueId, assignee)
 *   closeIssue(issueId, opts)     — mark resolved, records resolution
 *   reopenIssue(issueId)
 *   deleteIssue(issueId)          — soft-delete
 *   getIssue(issueId)
 *   listIssues(opts)              — filter by status, type, priority, repoId, assignee, label
 *
 * Build Tracking:
 *   recordBuild(opts)             — log a build event
 *   updateBuild(buildId, patch)   — update status / outcome
 *   getBuild(buildId)
 *   listBuilds(opts)              — filter by status, repoId, branch, limit
 *   getBuildStats(opts)           — success rate, avg duration, failure breakdown
 *
 * Deployment Tracking:
 *   recordDeployment(opts)        — log a deployment event
 *   updateDeployment(deployId, patch)
 *   rollbackDeployment(deployId, opts) — mark rolled-back
 *   getDeployment(deployId)
 *   listDeployments(opts)         — filter by status, repoId, env, limit
 *   getDeploymentStats(opts)      — frequency, rollback rate, MTTR
 *
 * Summaries & Dashboard:
 *   getEngineeringDashboard()     — live snapshot
 *   getDailySummary(date)         — daily engineering activity
 *   getWeeklySummary(weekStart)   — weekly roll-up
 *   getVelocityMetrics(opts)      — issues closed / builds / deploys over time window
 *
 * Stats:
 *   getStats()
 *
 * Reuses (all fail-safe):
 *   goalEngine.listGoals({ type: "development" })  — engineering goals on dashboard
 *   goalEngine.getGoalSummary()
 *   unifiedMemoryEngine.search()                   — cross-namespace recall
 *   unifiedMemoryEngine.getWorkflowMemory()        — recent pipeline / task runs
 *   projectRunner.listProjects()                   — pipeline project runs
 *   patchAssistant.listPatches()                   — recent patches
 *   lifecycle-reports.json                         — system maturity in summaries
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Storage (all in data/):
 *   dev-repos.json          — repositories (max 500)
 *   dev-projects.json       — engineering projects (max 500)
 *   dev-issues.json         — issue tracker (max 2000)
 *   dev-builds.json         — build records (max 1000)
 *   dev-deployments.json    — deployment records (max 1000)
 *
 * Repo shape:
 *   { repoId, name, description, language, defaultBranch, remoteUrl,
 *     status, tags[], createdAt, updatedAt, archivedAt? }
 *
 * Project shape:
 *   { projectId, name, description, repoId?, status, priority,
 *     tags[], assignees[], goalId?,
 *     createdAt, updatedAt, completedAt?, archivedAt? }
 *
 * Issue shape:
 *   { issueId, title, description, type, status, priority, severity,
 *     repoId?, projectId?, assignee, labels[], tags[],
 *     createdAt, updatedAt, closedAt?, deletedAt?,
 *     resolution?, closedBy? }
 *
 * Build shape:
 *   { buildId, repoId, branch, commit, status, trigger,
 *     startedAt, finishedAt?, durationMs?, outcome,
 *     log?, failureReason?, tags[] }
 *
 * Deployment shape:
 *   { deployId, repoId, projectId?, buildId?,
 *     environment, version, status, deployedBy,
 *     startedAt, finishedAt?, durationMs?,
 *     rollbackOf?, rolledBackAt?, rollbackReason?,
 *     tags[] }
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");

const REPOS_PATH   = path.join(DATA_DIR, "dev-repos.json");
const PROJS_PATH   = path.join(DATA_DIR, "dev-projects.json");
const ISSUES_PATH  = path.join(DATA_DIR, "dev-issues.json");
const BUILDS_PATH  = path.join(DATA_DIR, "dev-builds.json");
const DEPLOYS_PATH = path.join(DATA_DIR, "dev-deployments.json");

const MAX_REPOS   = 500;
const MAX_PROJS   = 500;
const MAX_ISSUES  = 2000;
const MAX_BUILDS  = 1000;
const MAX_DEPLOYS = 1000;

// ── Lazy accessors ────────────────────────────────────────────────
function _ge()  { try { return require("./goalEngine.cjs");           } catch { return null; } }
function _ume() { try { return require("./unifiedMemoryEngine.cjs");  } catch { return null; } }
function _pr()  { try { return require("../dev/projectRunner.cjs");   } catch { return null; } }
function _pa()  { try { return require("./patchAssistant.cjs");       } catch { return null; } }

// ── Generic store helpers ─────────────────────────────────────────
function _load(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const d   = JSON.parse(raw);
        return Array.isArray(d) ? d : [];
    } catch { return []; }
}

function _save(filePath, items, max) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(items.slice(0, max), null, 2));
    fs.renameSync(tmp, filePath);
}

let _idCtr = Date.now();
function _uid(prefix) { return `${prefix}_${++_idCtr}`; }
function _now() { return new Date().toISOString(); }

function _readJson(name) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8")); }
    catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// REPOSITORY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a repository.
 * @param {object} opts
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.language]     primary language
 * @param {string}  [opts.defaultBranch] default "main"
 * @param {string}  [opts.remoteUrl]
 * @param {string[]} [opts.tags]
 */
function createRepo({ name, description = "", language = "", defaultBranch = "main",
                      remoteUrl = "", tags = [] } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const repo = {
        repoId:        _uid("repo"),
        name:          name.slice(0, 200),
        description:   description.slice(0, 500),
        language,
        defaultBranch,
        remoteUrl,
        status:        "active",   // active | archived
        tags,
        createdAt:     _now(),
        updatedAt:     _now(),
        archivedAt:    null,
    };
    const all = _load(REPOS_PATH);
    all.unshift(repo);
    _save(REPOS_PATH, all, MAX_REPOS);
    return repo;
}

function updateRepo(repoId, patch = {}) {
    const all = _load(REPOS_PATH);
    const idx = all.findIndex(r => r.repoId === repoId);
    if (idx === -1) return { ok: false, error: "repo_not_found" };
    const allowed = ["name","description","language","defaultBranch","remoteUrl","status","tags"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(REPOS_PATH, all, MAX_REPOS);
    return { ok: true, repo: all[idx] };
}

function archiveRepo(repoId) {
    const all = _load(REPOS_PATH);
    const idx = all.findIndex(r => r.repoId === repoId);
    if (idx === -1) return { ok: false, error: "repo_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(REPOS_PATH, all, MAX_REPOS);
    return { ok: true, repo: all[idx] };
}

function getRepo(repoId) {
    return _load(REPOS_PATH).find(r => r.repoId === repoId) || null;
}

function listRepos({ language, status, tags, limit = 50 } = {}) {
    let items = _load(REPOS_PATH);
    if (language) items = items.filter(r => r.language.toLowerCase() === language.toLowerCase());
    if (status)   items = items.filter(r => r.status === status);
    if (tags?.length) items = items.filter(r => tags.some(t => r.tags?.includes(t)));
    return items.slice(0, limit);
}

function searchRepos(query, { limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    return _load(REPOS_PATH)
        .filter(r => r.status !== "archived")
        .filter(r =>
            r.name.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.language.toLowerCase().includes(q)
        )
        .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// PROJECT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Create an engineering project.
 * @param {object} opts
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.repoId]
 * @param {string}  [opts.priority]   "low"|"medium"|"high"|"critical"
 * @param {string[]} [opts.assignees]
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.goalId]     link to a goal-engine goal
 * @param {string}  [opts.dueDate]
 */
function createProject({ name, description = "", repoId, priority = "medium",
                          assignees = [], tags = [], goalId, dueDate } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const proj = {
        projectId:   _uid("proj"),
        name:        name.slice(0, 200),
        description: description.slice(0, 1000),
        repoId:      repoId    || null,
        status:      "active",   // active | completed | archived | on-hold
        priority,
        assignees,
        tags,
        goalId:      goalId    || null,
        dueDate:     dueDate   || null,
        createdAt:   _now(),
        updatedAt:   _now(),
        completedAt: null,
        archivedAt:  null,
    };
    const all = _load(PROJS_PATH);
    all.unshift(proj);
    _save(PROJS_PATH, all, MAX_PROJS);
    return proj;
}

function updateProject(projectId, patch = {}) {
    const all = _load(PROJS_PATH);
    const idx = all.findIndex(p => p.projectId === projectId);
    if (idx === -1) return { ok: false, error: "project_not_found" };
    const allowed = ["name","description","repoId","status","priority","assignees","tags","goalId","dueDate"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(PROJS_PATH, all, MAX_PROJS);
    return { ok: true, project: all[idx] };
}

function completeProject(projectId, { notes = "" } = {}) {
    const all = _load(PROJS_PATH);
    const idx = all.findIndex(p => p.projectId === projectId);
    if (idx === -1) return { ok: false, error: "project_not_found" };
    if (all[idx].status === "completed") return { ok: false, error: "already_completed" };
    all[idx].status      = "completed";
    all[idx].completedAt = _now();
    all[idx].updatedAt   = _now();
    if (notes) all[idx].notes = notes;
    _save(PROJS_PATH, all, MAX_PROJS);
    return { ok: true, project: all[idx] };
}

function archiveProject(projectId) {
    const all = _load(PROJS_PATH);
    const idx = all.findIndex(p => p.projectId === projectId);
    if (idx === -1) return { ok: false, error: "project_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(PROJS_PATH, all, MAX_PROJS);
    return { ok: true, project: all[idx] };
}

function getProject(projectId) {
    return _load(PROJS_PATH).find(p => p.projectId === projectId) || null;
}

function listProjects({ status, repoId, tags, priority, limit = 50 } = {}) {
    let items = _load(PROJS_PATH);
    if (status)   items = items.filter(p => p.status === status);
    if (repoId)   items = items.filter(p => p.repoId === repoId);
    if (priority) items = items.filter(p => p.priority === priority);
    if (tags?.length) items = items.filter(p => tags.some(t => p.tags?.includes(t)));
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// ISSUE TRACKING
// ═══════════════════════════════════════════════════════════════════

/**
 * File an issue.
 * @param {object} opts
 * @param {string}  opts.title
 * @param {string}  [opts.description]
 * @param {string}  [opts.type]       "bug"|"feature"|"task"|"chore"|"incident"
 * @param {string}  [opts.priority]   "low"|"medium"|"high"|"critical"
 * @param {string}  [opts.severity]   "minor"|"major"|"critical"|"blocker"  (bugs)
 * @param {string}  [opts.repoId]
 * @param {string}  [opts.projectId]
 * @param {string}  [opts.assignee]
 * @param {string[]} [opts.labels]
 * @param {string[]} [opts.tags]
 */
function createIssue({ title, description = "", type = "task", priority = "medium",
                        severity = "minor", repoId, projectId, assignee = "",
                        labels = [], tags = [] } = {}) {
    if (!title) return { ok: false, error: "title required" };
    const issue = {
        issueId:     _uid("iss"),
        title:       title.slice(0, 300),
        description: description.slice(0, 2000),
        type,
        status:      "open",   // open | in-progress | resolved | closed | deleted
        priority,
        severity,
        repoId:      repoId     || null,
        projectId:   projectId  || null,
        assignee,
        labels,
        tags,
        createdAt:   _now(),
        updatedAt:   _now(),
        closedAt:    null,
        deletedAt:   null,
        resolution:  null,
        closedBy:    null,
    };
    const all = _load(ISSUES_PATH);
    all.unshift(issue);
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return issue;
}

function updateIssue(issueId, patch = {}) {
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId);
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    const allowed = ["title","description","type","status","priority","severity","repoId","projectId","assignee","labels","tags","resolution"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function assignIssue(issueId, assignee) {
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId);
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    all[idx].assignee  = assignee;
    all[idx].status    = all[idx].status === "open" ? "in-progress" : all[idx].status;
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function closeIssue(issueId, { resolution = "", closedBy = "" } = {}) {
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId);
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    if (all[idx].status === "closed") return { ok: false, error: "already_closed" };
    all[idx].status     = "closed";
    all[idx].closedAt   = _now();
    all[idx].updatedAt  = _now();
    all[idx].resolution = resolution;
    all[idx].closedBy   = closedBy;
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function reopenIssue(issueId) {
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId);
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    all[idx].status    = "open";
    all[idx].closedAt  = null;
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function deleteIssue(issueId) {
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId);
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    all[idx].status    = "deleted";
    all[idx].deletedAt = _now();
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true };
}

function getIssue(issueId) {
    return _load(ISSUES_PATH).find(i => i.issueId === issueId) || null;
}

function listIssues({ status, type, priority, severity, repoId, projectId, assignee, label, limit = 50 } = {}) {
    let items = _load(ISSUES_PATH).filter(i => i.status !== "deleted");
    if (status)    items = items.filter(i => i.status    === status);
    if (type)      items = items.filter(i => i.type      === type);
    if (priority)  items = items.filter(i => i.priority  === priority);
    if (severity)  items = items.filter(i => i.severity  === severity);
    if (repoId)    items = items.filter(i => i.repoId    === repoId);
    if (projectId) items = items.filter(i => i.projectId === projectId);
    if (assignee)  items = items.filter(i => i.assignee  === assignee);
    if (label)     items = items.filter(i => i.labels?.includes(label));
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// BUILD TRACKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Record a build event.
 * @param {object} opts
 * @param {string}  opts.repoId
 * @param {string}  [opts.branch]
 * @param {string}  [opts.commit]    short SHA
 * @param {string}  [opts.trigger]   "push"|"pr"|"manual"|"schedule"|"api"
 * @param {string}  [opts.status]    "running"|"success"|"failed"|"cancelled"
 * @param {number}  [opts.durationMs]
 * @param {string}  [opts.failureReason]
 * @param {string}  [opts.log]        short excerpt
 * @param {string[]} [opts.tags]
 */
function recordBuild({ repoId, branch = "main", commit = "", trigger = "push",
                        status = "running", durationMs, failureReason = "",
                        log = "", tags = [] } = {}) {
    if (!repoId) return { ok: false, error: "repoId required" };
    const build = {
        buildId:       _uid("bld"),
        repoId,
        branch,
        commit:        commit.slice(0, 40),
        trigger,
        status,
        outcome:       status === "success" ? "pass" : status === "failed" ? "fail" : "pending",
        startedAt:     _now(),
        finishedAt:    ["success","failed","cancelled"].includes(status) ? _now() : null,
        durationMs:    durationMs || null,
        failureReason: failureReason.slice(0, 500),
        log:           log.slice(0, 2000),
        tags,
    };
    const all = _load(BUILDS_PATH);
    all.unshift(build);
    _save(BUILDS_PATH, all, MAX_BUILDS);
    return { ok: true, build };
}

function updateBuild(buildId, patch = {}) {
    const all = _load(BUILDS_PATH);
    const idx = all.findIndex(b => b.buildId === buildId);
    if (idx === -1) return { ok: false, error: "build_not_found" };
    const allowed = ["status","outcome","finishedAt","durationMs","failureReason","log"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    if (patch.status && ["success","failed","cancelled"].includes(patch.status) && !all[idx].finishedAt) {
        all[idx].finishedAt = _now();
        all[idx].outcome = patch.status === "success" ? "pass" : "fail";
    }
    _save(BUILDS_PATH, all, MAX_BUILDS);
    return { ok: true, build: all[idx] };
}

function getBuild(buildId) {
    return _load(BUILDS_PATH).find(b => b.buildId === buildId) || null;
}

function listBuilds({ status, repoId, branch, trigger, limit = 50 } = {}) {
    let items = _load(BUILDS_PATH);
    if (status)  items = items.filter(b => b.status  === status);
    if (repoId)  items = items.filter(b => b.repoId  === repoId);
    if (branch)  items = items.filter(b => b.branch  === branch);
    if (trigger) items = items.filter(b => b.trigger === trigger);
    return items.slice(0, limit);
}

function getBuildStats({ repoId, dateFrom, dateTo } = {}) {
    let items = _load(BUILDS_PATH);
    if (repoId)   items = items.filter(b => b.repoId === repoId);
    if (dateFrom) items = items.filter(b => b.startedAt >= dateFrom);
    if (dateTo)   items = items.filter(b => b.startedAt <= dateTo);

    const total    = items.length;
    const success  = items.filter(b => b.status === "success").length;
    const failed   = items.filter(b => b.status === "failed").length;
    const running  = items.filter(b => b.status === "running").length;
    const successRate = total > 0 ? Math.round(success / total * 100) : null;

    const durations = items.filter(b => b.durationMs).map(b => b.durationMs);
    const avgDuration = durations.length
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : null;

    // Failure breakdown by reason keyword
    const failureMap = {};
    for (const b of items.filter(b => b.status === "failed" && b.failureReason)) {
        const key = b.failureReason.slice(0, 50);
        failureMap[key] = (failureMap[key] || 0) + 1;
    }

    return { total, success, failed, running, successRate, avgDurationMs: avgDuration, failureBreakdown: failureMap };
}

// ═══════════════════════════════════════════════════════════════════
// DEPLOYMENT TRACKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Record a deployment event.
 * @param {object} opts
 * @param {string}  opts.repoId
 * @param {string}  [opts.projectId]
 * @param {string}  [opts.buildId]
 * @param {string}  [opts.environment]  "development"|"staging"|"production"|"canary"
 * @param {string}  [opts.version]      semver or commit SHA
 * @param {string}  [opts.status]       "running"|"success"|"failed"|"rolled-back"
 * @param {string}  [opts.deployedBy]
 * @param {number}  [opts.durationMs]
 * @param {string[]} [opts.tags]
 */
function recordDeployment({ repoId, projectId, buildId, environment = "production",
                             version = "", status = "running", deployedBy = "operator",
                             durationMs, tags = [] } = {}) {
    if (!repoId) return { ok: false, error: "repoId required" };
    const deploy = {
        deployId:       _uid("dep"),
        repoId,
        projectId:      projectId  || null,
        buildId:        buildId    || null,
        environment,
        version:        version.slice(0, 100),
        status,
        deployedBy,
        startedAt:      _now(),
        finishedAt:     ["success","failed","rolled-back"].includes(status) ? _now() : null,
        durationMs:     durationMs || null,
        rollbackOf:     null,
        rolledBackAt:   null,
        rollbackReason: null,
        tags,
    };
    const all = _load(DEPLOYS_PATH);
    all.unshift(deploy);
    _save(DEPLOYS_PATH, all, MAX_DEPLOYS);
    return { ok: true, deployment: deploy };
}

function updateDeployment(deployId, patch = {}) {
    const all = _load(DEPLOYS_PATH);
    const idx = all.findIndex(d => d.deployId === deployId);
    if (idx === -1) return { ok: false, error: "deployment_not_found" };
    const allowed = ["status","version","finishedAt","durationMs","deployedBy"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    if (patch.status && ["success","failed","rolled-back"].includes(patch.status) && !all[idx].finishedAt) {
        all[idx].finishedAt = _now();
    }
    _save(DEPLOYS_PATH, all, MAX_DEPLOYS);
    return { ok: true, deployment: all[idx] };
}

function rollbackDeployment(deployId, { reason = "", deployedBy = "operator" } = {}) {
    const all = _load(DEPLOYS_PATH);
    const idx = all.findIndex(d => d.deployId === deployId);
    if (idx === -1) return { ok: false, error: "deployment_not_found" };
    all[idx].status         = "rolled-back";
    all[idx].rolledBackAt   = _now();
    all[idx].rollbackReason = reason;
    all[idx].finishedAt     = all[idx].finishedAt || _now();
    _save(DEPLOYS_PATH, all, MAX_DEPLOYS);

    // Create a new deployment record to represent the rollback action
    const rb = recordDeployment({
        repoId:      all[idx].repoId,
        projectId:   all[idx].projectId,
        environment: all[idx].environment,
        version:     all[idx].version + "-rollback",
        status:      "success",
        deployedBy,
        tags:        ["rollback"],
    });
    if (rb.ok) rb.deployment.rollbackOf = deployId;

    return { ok: true, deployment: all[idx], rollbackDeployment: rb.deployment || null };
}

function getDeployment(deployId) {
    return _load(DEPLOYS_PATH).find(d => d.deployId === deployId) || null;
}

function listDeployments({ status, repoId, environment, projectId, limit = 50 } = {}) {
    let items = _load(DEPLOYS_PATH);
    if (status)      items = items.filter(d => d.status      === status);
    if (repoId)      items = items.filter(d => d.repoId      === repoId);
    if (environment) items = items.filter(d => d.environment === environment);
    if (projectId)   items = items.filter(d => d.projectId   === projectId);
    return items.slice(0, limit);
}

function getDeploymentStats({ repoId, dateFrom, dateTo } = {}) {
    let items = _load(DEPLOYS_PATH);
    if (repoId)   items = items.filter(d => d.repoId === repoId);
    if (dateFrom) items = items.filter(d => d.startedAt >= dateFrom);
    if (dateTo)   items = items.filter(d => d.startedAt <= dateTo);

    const total      = items.length;
    const success    = items.filter(d => d.status === "success").length;
    const failed     = items.filter(d => d.status === "failed").length;
    const rolledBack = items.filter(d => d.status === "rolled-back").length;
    const rollbackRate = total > 0 ? Math.round(rolledBack / total * 100) : null;

    // Deployment frequency: deploys per day
    const byEnv = {};
    for (const d of items) {
        byEnv[d.environment] = (byEnv[d.environment] || 0) + 1;
    }

    // MTTR: avg time between failed and next success in same repo+env
    const durations = items.filter(d => d.durationMs).map(d => d.durationMs);
    const avgDuration = durations.length
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : null;

    return { total, success, failed, rolledBack, rollbackRate, avgDurationMs: avgDuration, byEnvironment: byEnv };
}

// ═══════════════════════════════════════════════════════════════════
// VELOCITY METRICS
// ═══════════════════════════════════════════════════════════════════

function getVelocityMetrics({ days = 7 } = {}) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const issuesClosed = _load(ISSUES_PATH)
        .filter(i => i.closedAt && i.closedAt >= since).length;
    const issuesOpened = _load(ISSUES_PATH)
        .filter(i => i.createdAt >= since && i.status !== "deleted").length;
    const buildsRun = _load(BUILDS_PATH)
        .filter(b => b.startedAt >= since).length;
    const buildsFailed = _load(BUILDS_PATH)
        .filter(b => b.startedAt >= since && b.status === "failed").length;
    const deploys = _load(DEPLOYS_PATH)
        .filter(d => d.startedAt >= since).length;
    const deploysFailed = _load(DEPLOYS_PATH)
        .filter(d => d.startedAt >= since && d.status === "failed").length;

    // Patch activity from patchAssistant
    let patchesApplied = 0;
    const pa = _pa();
    if (pa) {
        try {
            const patches = pa.listPatches({ limit: 200 });
            patchesApplied = patches.filter(p => p.appliedAt && p.appliedAt >= since).length;
        } catch { /* non-fatal */ }
    }

    // Pipeline runs from projectRunner
    let pipelineRuns = 0;
    const pr = _pr();
    if (pr) {
        try {
            const runs = pr.listProjects({ limit: 100 });
            pipelineRuns = runs.filter(r => r.startedAt && r.startedAt >= since).length;
        } catch { /* non-fatal */ }
    }

    return {
        windowDays:     days,
        since,
        issuesOpened,
        issuesClosed,
        issueVelocity:  issuesClosed - issuesOpened,
        buildsRun,
        buildsFailed,
        buildSuccessRate: buildsRun > 0 ? Math.round((buildsRun - buildsFailed) / buildsRun * 100) : null,
        deploys,
        deploysFailed,
        patchesApplied,
        pipelineRuns,
    };
}

// ═══════════════════════════════════════════════════════════════════
// ENGINEERING DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function getEngineeringDashboard() {
    const now = new Date().toISOString();

    // Repos
    const activeRepos = _load(REPOS_PATH).filter(r => r.status === "active");

    // Projects
    const allProjs    = _load(PROJS_PATH);
    const activeProjs = allProjs.filter(p => p.status === "active");

    // Issues
    const allIssues   = _load(ISSUES_PATH).filter(i => i.status !== "deleted");
    const openIssues  = allIssues.filter(i => i.status === "open" || i.status === "in-progress");
    const criticalIssues = openIssues.filter(i => i.severity === "blocker" || i.severity === "critical" || i.priority === "critical");

    // Builds (last 10)
    const recentBuilds   = _load(BUILDS_PATH).slice(0, 10);
    const failedBuilds   = recentBuilds.filter(b => b.status === "failed");

    // Deployments (last 5)
    const recentDeploys  = _load(DEPLOYS_PATH).slice(0, 5);
    const activeDeployments = _load(DEPLOYS_PATH).filter(d => d.status === "running");

    // Velocity (7-day)
    const velocity = getVelocityMetrics({ days: 7 });

    // Goals
    const ge        = _ge();
    const devGoals  = ge ? ge.listGoals({ type: "development", status: "active", limit: 5 }) : [];
    const goalSum   = ge ? ge.getGoalSummary() : null;

    // Pipeline runs
    const pr = _pr();
    let pipelineRuns = [];
    if (pr) {
        try { pipelineRuns = pr.listProjects({ limit: 5 }); } catch { /* non-fatal */ }
    }

    // Lifecycle maturity
    const lifecycle = (_readJson("lifecycle-reports.json") || [])[0] || null;

    return {
        generatedAt: now,
        repos: {
            active:  activeRepos.length,
            total:   _load(REPOS_PATH).length,
            topActive: activeRepos.slice(0, 5),
        },
        projects: {
            active:  activeProjs.length,
            total:   allProjs.length,
            topActive: activeProjs.slice(0, 5),
        },
        issues: {
            open:     openIssues.length,
            critical: criticalIssues.length,
            topCritical: criticalIssues.slice(0, 5),
        },
        builds: {
            recent:  recentBuilds.length,
            failed:  failedBuilds.length,
            top:     recentBuilds.slice(0, 5),
        },
        deployments: {
            active:  activeDeployments.length,
            recent:  recentDeploys,
        },
        velocity,
        goals: {
            development: devGoals.length,
            summary:     goalSum,
            top:         devGoals.slice(0, 3),
        },
        pipelineRuns: pipelineRuns.slice(0, 3),
        systemMaturity: lifecycle ? lifecycle.maturity?.total : null,
    };
}

// ═══════════════════════════════════════════════════════════════════
// DAILY SUMMARY
// ═══════════════════════════════════════════════════════════════════

function getDailySummary(date) {
    const target   = date || new Date().toISOString().slice(0, 10);
    const dayStart = target + "T00:00:00.000Z";
    const dayEnd   = target + "T23:59:59.999Z";

    const issuesOpened  = _load(ISSUES_PATH).filter(i => i.createdAt >= dayStart && i.createdAt <= dayEnd && i.status !== "deleted");
    const issuesClosed  = _load(ISSUES_PATH).filter(i => i.closedAt  >= dayStart && i.closedAt  <= dayEnd);
    const buildsToday   = _load(BUILDS_PATH).filter(b => b.startedAt >= dayStart && b.startedAt <= dayEnd);
    const deploysToday  = _load(DEPLOYS_PATH).filter(d => d.startedAt >= dayStart && d.startedAt <= dayEnd);
    const projsChanged  = _load(PROJS_PATH).filter(p => p.updatedAt  >= dayStart && p.updatedAt  <= dayEnd);

    const buildsFailed  = buildsToday.filter(b => b.status === "failed").length;
    const deploysSuccess = deploysToday.filter(d => d.status === "success").length;

    const ge       = _ge();
    const devGoals = ge ? ge.listGoals({ type: "development", status: "active", limit: 10 }) : [];

    const highlights = [];
    if (issuesOpened.length)  highlights.push(`${issuesOpened.length} issue(s) opened`);
    if (issuesClosed.length)  highlights.push(`${issuesClosed.length} issue(s) closed`);
    if (buildsToday.length)   highlights.push(`${buildsToday.length} build(s) — ${buildsFailed} failed`);
    if (deploysToday.length)  highlights.push(`${deploysToday.length} deployment(s) — ${deploysSuccess} succeeded`);
    if (projsChanged.length)  highlights.push(`${projsChanged.length} project(s) updated`);
    if (devGoals.length)      highlights.push(`${devGoals.length} active dev goal(s)`);

    return {
        date:             target,
        generatedAt:      new Date().toISOString(),
        issuesOpened:     issuesOpened.length,
        issuesClosed:     issuesClosed.length,
        buildsRun:        buildsToday.length,
        buildsFailed,
        deploymentsRun:   deploysToday.length,
        deploymentsSuccess: deploysSuccess,
        projectsUpdated:  projsChanged.length,
        devGoals:         devGoals.length,
        goalList:         devGoals.slice(0, 3).map(g => ({ goalId: g.goalId, title: g.title, completionPct: g.completionPct })),
        highlights,
    };
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY SUMMARY
// ═══════════════════════════════════════════════════════════════════

function getWeeklySummary(weekStart) {
    const now = new Date();
    let start;
    if (weekStart) {
        start = new Date(weekStart + "T00:00:00.000Z");
    } else {
        start = new Date(now);
        const day = start.getUTCDay();
        start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
        start.setUTCHours(0, 0, 0, 0);
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const ws = start.toISOString();
    const we = end.toISOString();

    const issuesClosed   = _load(ISSUES_PATH).filter(i => i.closedAt  >= ws && i.closedAt  < we).length;
    const issuesOpened   = _load(ISSUES_PATH).filter(i => i.createdAt >= ws && i.createdAt < we && i.status !== "deleted").length;
    const buildsThisWeek = _load(BUILDS_PATH).filter(b => b.startedAt >= ws && b.startedAt < we);
    const deploys        = _load(DEPLOYS_PATH).filter(d => d.startedAt >= ws && d.startedAt < we);
    const projsCompleted = _load(PROJS_PATH).filter(p => p.completedAt >= ws && p.completedAt < we);

    const buildSuccessRate = buildsThisWeek.length
        ? Math.round(buildsThisWeek.filter(b => b.status === "success").length / buildsThisWeek.length * 100)
        : null;
    const rollbacks = deploys.filter(d => d.status === "rolled-back").length;

    // Lifecycle maturity this week
    const lifecycleReports = (_readJson("lifecycle-reports.json") || [])
        .filter(r => r.generatedAt >= ws && r.generatedAt < we);
    const avgMaturity = lifecycleReports.length
        ? Math.round(lifecycleReports.reduce((s, r) => s + (r.maturity?.total || 0), 0) / lifecycleReports.length)
        : null;

    // Dev goals completed
    const ge         = _ge();
    const allGoals   = ge ? ge.listGoals({ limit: 50 }) : [];
    const goalsWon   = allGoals.filter(g =>
        g.type === "development" && g.status === "completed" && g.completedAt >= ws && g.completedAt < we
    );

    const highlights = [];
    if (issuesClosed)         highlights.push(`${issuesClosed} issue(s) closed`);
    if (issuesOpened)         highlights.push(`${issuesOpened} issue(s) opened`);
    if (buildsThisWeek.length) highlights.push(`${buildsThisWeek.length} build(s) — ${buildSuccessRate}% pass rate`);
    if (deploys.length)       highlights.push(`${deploys.length} deployment(s)${rollbacks ? `, ${rollbacks} rollback(s)` : ""}`);
    if (projsCompleted.length) highlights.push(`${projsCompleted.length} project(s) completed`);
    if (goalsWon.length)      highlights.push(`${goalsWon.length} dev goal(s) achieved`);
    if (avgMaturity !== null)  highlights.push(`System maturity: ${avgMaturity}/100`);

    return {
        weekStart:          start.toISOString().slice(0, 10),
        weekEnd:            end.toISOString().slice(0, 10),
        generatedAt:        new Date().toISOString(),
        issuesClosed,
        issuesOpened,
        netIssues:          issuesClosed - issuesOpened,
        buildsRun:          buildsThisWeek.length,
        buildSuccessRate,
        deployments:        deploys.length,
        rollbacks,
        projectsCompleted:  projsCompleted.length,
        goalsAchieved:      goalsWon.length,
        systemMaturity:     avgMaturity,
        velocity:           getVelocityMetrics({ days: 7 }),
        highlights,
    };
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-STORE SEARCH
// ═══════════════════════════════════════════════════════════════════

function searchEngineering(query, { limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];

    const repoHits = searchRepos(query, { limit: 3 })
        .map(r => ({ type: "repo",    id: r.repoId,    title: r.name,    language: r.language }));

    const projHits = _load(PROJS_PATH)
        .filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
        .slice(0, 3)
        .map(p => ({ type: "project", id: p.projectId, title: p.name,    status: p.status }));

    const issueHits = _load(ISSUES_PATH)
        .filter(i => i.status !== "deleted")
        .filter(i => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
        .slice(0, 5)
        .map(i => ({ type: "issue",   id: i.issueId,   title: i.title,   status: i.status, type_: i.type }));

    results.push(...repoHits, ...projHits, ...issueHits);

    // Cross-namespace via UME
    const ume = _ume();
    if (ume) {
        try {
            const umeResults = ume.search(query, { limit: limit - results.length });
            results.push(...umeResults.map(r => ({
                type:    r.type,
                id:      r.entityId,
                title:   r.title,
                ns:      r.ns,
                summary: r.summary,
            })));
        } catch { /* non-fatal */ }
    }

    return results.slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────

function getStats() {
    return {
        repos:       _load(REPOS_PATH).filter(r => r.status !== "archived").length,
        projects:    _load(PROJS_PATH).filter(p => !["archived"].includes(p.status)).length,
        issues:      _load(ISSUES_PATH).filter(i => i.status !== "deleted").length,
        builds:      _load(BUILDS_PATH).length,
        deployments: _load(DEPLOYS_PATH).length,
    };
}

module.exports = {
    // Repos
    createRepo, updateRepo, archiveRepo, getRepo, listRepos, searchRepos,
    // Projects
    createProject, updateProject, completeProject, archiveProject, getProject, listProjects,
    // Issues
    createIssue, updateIssue, assignIssue, closeIssue, reopenIssue, deleteIssue, getIssue, listIssues,
    // Builds
    recordBuild, updateBuild, getBuild, listBuilds, getBuildStats,
    // Deployments
    recordDeployment, updateDeployment, rollbackDeployment, getDeployment, listDeployments, getDeploymentStats,
    // Velocity
    getVelocityMetrics,
    // Summaries
    getEngineeringDashboard, getDailySummary, getWeeklySummary,
    // Search & Stats
    searchEngineering, getStats,
};
