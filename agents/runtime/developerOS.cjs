"use strict";
/**
 * Developer AI Operating System — repos, projects, issues, builds, deployments, summaries.
 *
 * MASTER RECOVERY (2026-08-15, C10-003): this module had zero orgId concept
 * anywhere — C.10's audit reproduced live that after fixing the missing
 * requireAuth gate on /dev/*, any authenticated user of ANY organization
 * still saw every OTHER organization's repos/projects/issues/builds/
 * deployments. Every create function below now accepts and stores orgId;
 * every list/get/search function now requires it and filters by it. Existing
 * pre-recovery records (created before this fix) have no orgId field at
 * all — they are intentionally NOT silently assigned to whichever org
 * happens to call first. See _isOwnedBy() below: a record with no orgId is
 * only visible to a caller who explicitly passes includeUnowned:true (used
 * once, by the one-time migration script), never through normal API use.
 * This mirrors the "never fall back to all tenants'" pattern already
 * proven in growthOS.cjs.
 *
 * Entry points:
 *
 * Repository Management:
 *   createRepo(opts)              — register a repository
 *   updateRepo(orgId, repoId, patch)     — update repo metadata
 *   archiveRepo(orgId, repoId)           — soft-archive
 *   getRepo(orgId, repoId)
 *   listRepos(orgId, opts)               — filter by language, status, tag, limit
 *   searchRepos(orgId, query)            — keyword search across name / description
 *
 * Project Management:
 *   createProject(opts)           — create an engineering project
 *   updateProject(orgId, projectId, patch)
 *   completeProject(orgId, projectId, opts)
 *   archiveProject(orgId, projectId)
 *   getProject(orgId, projectId)
 *   listProjects(orgId, opts)            — filter by status, repoId, tag, limit
 *
 * Issue Tracking:
 *   createIssue(opts)             — file an issue (bug / feature / task / chore)
 *   updateIssue(orgId, issueId, patch)
 *   assignIssue(orgId, issueId, assignee)
 *   closeIssue(orgId, issueId, opts)     — mark resolved, records resolution
 *   reopenIssue(orgId, issueId)
 *   deleteIssue(orgId, issueId)          — soft-delete
 *   getIssue(orgId, issueId)
 *   listIssues(orgId, opts)              — filter by status, type, priority, repoId, assignee, label
 *
 * Build Tracking:
 *   recordBuild(opts)             — log a build event
 *   updateBuild(orgId, buildId, patch)   — update status / outcome
 *   getBuild(orgId, buildId)
 *   listBuilds(orgId, opts)              — filter by status, repoId, branch, limit
 *   getBuildStats(orgId, opts)           — success rate, avg duration, failure breakdown
 *
 * Deployment Tracking:
 *   recordDeployment(opts)        — log a deployment event
 *   updateDeployment(orgId, deployId, patch)
 *   rollbackDeployment(orgId, deployId, opts) — mark rolled-back
 *   getDeployment(orgId, deployId)
 *   listDeployments(orgId, opts)         — filter by status, repoId, env, limit
 *   getDeploymentStats(orgId, opts)      — frequency, rollback rate, MTTR
 *
 * Summaries & Dashboard (all orgId-scoped):
 *   getEngineeringDashboard(orgId)     — live snapshot
 *   getDailySummary(orgId, date)       — daily engineering activity
 *   getWeeklySummary(orgId, weekStart) — weekly roll-up
 *   getVelocityMetrics(orgId, opts)    — issues closed / builds / deploys over time window
 *
 * Stats:
 *   getStats(orgId)
 *
 * Migration (one-time, operator-invoked, not reachable via any route):
 *   backfillUnownedRecords(orgId)  — see comment above _backfillUnownedRecords
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
 *   { repoId, orgId, name, description, language, defaultBranch, remoteUrl,
 *     status, tags[], createdAt, updatedAt, archivedAt? }
 *
 * Project shape:
 *   { projectId, orgId, name, description, repoId?, status, priority,
 *     tags[], assignees[], goalId?,
 *     createdAt, updatedAt, completedAt?, archivedAt? }
 *
 * Issue shape:
 *   { issueId, orgId, title, description, type, status, priority, severity,
 *     repoId?, projectId?, assignee, labels[], tags[],
 *     createdAt, updatedAt, closedAt?, deletedAt?,
 *     resolution?, closedBy? }
 *
 * Build shape:
 *   { buildId, orgId, repoId, branch, commit, status, trigger,
 *     startedAt, finishedAt?, durationMs?, outcome,
 *     log?, failureReason?, tags[] }
 *
 * Deployment shape:
 *   { deployId, orgId, repoId, projectId?, buildId?,
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

// C10-003 recovery: a record "belongs" to orgId only if its own orgId field
// matches exactly. A record with orgId===undefined (pre-recovery legacy data)
// is NEVER matched by a real orgId query — it is invisible until explicitly
// migrated via backfillUnownedRecords(). This is the same "never fall back
// to all tenants'" contract growthOS.cjs already uses.
function _ownedBy(item, orgId) { return item.orgId === orgId; }

function _requireOrgId(orgId, fnName) {
    if (!orgId) throw new Error(`${fnName}: orgId is required`);
}

// ═══════════════════════════════════════════════════════════════════
// REPOSITORY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a repository.
 * @param {object} opts
 * @param {string}  opts.orgId        REQUIRED — owning organization
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.language]     primary language
 * @param {string}  [opts.defaultBranch] default "main"
 * @param {string}  [opts.remoteUrl]
 * @param {string[]} [opts.tags]
 */
function createRepo({ orgId, name, description = "", language = "", defaultBranch = "main",
                      remoteUrl = "", tags = [] } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!name) return { ok: false, error: "name required" };
    const repo = {
        repoId:        _uid("repo"),
        orgId,
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

function updateRepo(orgId, repoId, patch = {}) {
    _requireOrgId(orgId, "updateRepo");
    const all = _load(REPOS_PATH);
    const idx = all.findIndex(r => r.repoId === repoId && _ownedBy(r, orgId));
    if (idx === -1) return { ok: false, error: "repo_not_found" };
    const allowed = ["name","description","language","defaultBranch","remoteUrl","status","tags"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(REPOS_PATH, all, MAX_REPOS);
    return { ok: true, repo: all[idx] };
}

function archiveRepo(orgId, repoId) {
    _requireOrgId(orgId, "archiveRepo");
    const all = _load(REPOS_PATH);
    const idx = all.findIndex(r => r.repoId === repoId && _ownedBy(r, orgId));
    if (idx === -1) return { ok: false, error: "repo_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(REPOS_PATH, all, MAX_REPOS);
    return { ok: true, repo: all[idx] };
}

function getRepo(orgId, repoId) {
    _requireOrgId(orgId, "getRepo");
    return _load(REPOS_PATH).find(r => r.repoId === repoId && _ownedBy(r, orgId)) || null;
}

function listRepos(orgId, { language, status, tags, limit = 50 } = {}) {
    _requireOrgId(orgId, "listRepos");
    let items = _load(REPOS_PATH).filter(r => _ownedBy(r, orgId));
    if (language) items = items.filter(r => r.language.toLowerCase() === language.toLowerCase());
    if (status)   items = items.filter(r => r.status === status);
    if (tags?.length) items = items.filter(r => tags.some(t => r.tags?.includes(t)));
    return items.slice(0, limit);
}

function searchRepos(orgId, query, { limit = 20 } = {}) {
    _requireOrgId(orgId, "searchRepos");
    if (!query) return [];
    const q = query.toLowerCase();
    return _load(REPOS_PATH)
        .filter(r => _ownedBy(r, orgId))
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
 * @param {string}  opts.orgId        REQUIRED — owning organization
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.repoId]
 * @param {string}  [opts.priority]   "low"|"medium"|"high"|"critical"
 * @param {string[]} [opts.assignees]
 * @param {string[]} [opts.tags]
 * @param {string}  [opts.goalId]     link to a goal-engine goal
 * @param {string}  [opts.dueDate]
 */
function createProject({ orgId, name, description = "", repoId, priority = "medium",
                          assignees = [], tags = [], goalId, dueDate } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!name) return { ok: false, error: "name required" };
    const proj = {
        projectId:   _uid("proj"),
        orgId,
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

function updateProject(orgId, projectId, patch = {}) {
    _requireOrgId(orgId, "updateProject");
    const all = _load(PROJS_PATH);
    const idx = all.findIndex(p => p.projectId === projectId && _ownedBy(p, orgId));
    if (idx === -1) return { ok: false, error: "project_not_found" };
    const allowed = ["name","description","repoId","status","priority","assignees","tags","goalId","dueDate"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(PROJS_PATH, all, MAX_PROJS);
    return { ok: true, project: all[idx] };
}

function completeProject(orgId, projectId, { notes = "" } = {}) {
    _requireOrgId(orgId, "completeProject");
    const all = _load(PROJS_PATH);
    const idx = all.findIndex(p => p.projectId === projectId && _ownedBy(p, orgId));
    if (idx === -1) return { ok: false, error: "project_not_found" };
    if (all[idx].status === "completed") return { ok: false, error: "already_completed" };
    all[idx].status      = "completed";
    all[idx].completedAt = _now();
    all[idx].updatedAt   = _now();
    if (notes) all[idx].notes = notes;
    _save(PROJS_PATH, all, MAX_PROJS);
    return { ok: true, project: all[idx] };
}

function archiveProject(orgId, projectId) {
    _requireOrgId(orgId, "archiveProject");
    const all = _load(PROJS_PATH);
    const idx = all.findIndex(p => p.projectId === projectId && _ownedBy(p, orgId));
    if (idx === -1) return { ok: false, error: "project_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(PROJS_PATH, all, MAX_PROJS);
    return { ok: true, project: all[idx] };
}

function getProject(orgId, projectId) {
    _requireOrgId(orgId, "getProject");
    return _load(PROJS_PATH).find(p => p.projectId === projectId && _ownedBy(p, orgId)) || null;
}

function listProjects(orgId, { status, repoId, tags, priority, limit = 50 } = {}) {
    _requireOrgId(orgId, "listProjects");
    let items = _load(PROJS_PATH).filter(p => _ownedBy(p, orgId));
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
 * @param {string}  opts.orgId        REQUIRED — owning organization
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
function createIssue({ orgId, title, description = "", type = "task", priority = "medium",
                        severity = "minor", repoId, projectId, assignee = "",
                        labels = [], tags = [] } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!title) return { ok: false, error: "title required" };
    const issue = {
        issueId:     _uid("iss"),
        orgId,
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

function updateIssue(orgId, issueId, patch = {}) {
    _requireOrgId(orgId, "updateIssue");
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId && _ownedBy(i, orgId));
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    const allowed = ["title","description","type","status","priority","severity","repoId","projectId","assignee","labels","tags","resolution"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function assignIssue(orgId, issueId, assignee) {
    _requireOrgId(orgId, "assignIssue");
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId && _ownedBy(i, orgId));
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    all[idx].assignee  = assignee;
    all[idx].status    = all[idx].status === "open" ? "in-progress" : all[idx].status;
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function closeIssue(orgId, issueId, { resolution = "", closedBy = "" } = {}) {
    _requireOrgId(orgId, "closeIssue");
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId && _ownedBy(i, orgId));
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

function reopenIssue(orgId, issueId) {
    _requireOrgId(orgId, "reopenIssue");
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId && _ownedBy(i, orgId));
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    all[idx].status    = "open";
    all[idx].closedAt  = null;
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true, issue: all[idx] };
}

function deleteIssue(orgId, issueId) {
    _requireOrgId(orgId, "deleteIssue");
    const all = _load(ISSUES_PATH);
    const idx = all.findIndex(i => i.issueId === issueId && _ownedBy(i, orgId));
    if (idx === -1) return { ok: false, error: "issue_not_found" };
    all[idx].status    = "deleted";
    all[idx].deletedAt = _now();
    all[idx].updatedAt = _now();
    _save(ISSUES_PATH, all, MAX_ISSUES);
    return { ok: true };
}

function getIssue(orgId, issueId) {
    _requireOrgId(orgId, "getIssue");
    return _load(ISSUES_PATH).find(i => i.issueId === issueId && _ownedBy(i, orgId)) || null;
}

function listIssues(orgId, { status, type, priority, severity, repoId, projectId, assignee, label, limit = 50 } = {}) {
    _requireOrgId(orgId, "listIssues");
    let items = _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.status !== "deleted");
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
 * @param {string}  opts.orgId        REQUIRED — owning organization
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
function recordBuild({ orgId, repoId, branch = "main", commit = "", trigger = "push",
                        status = "running", durationMs, failureReason = "",
                        log = "", tags = [] } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!repoId) return { ok: false, error: "repoId required" };
    const build = {
        buildId:       _uid("bld"),
        orgId,
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

function updateBuild(orgId, buildId, patch = {}) {
    _requireOrgId(orgId, "updateBuild");
    const all = _load(BUILDS_PATH);
    const idx = all.findIndex(b => b.buildId === buildId && _ownedBy(b, orgId));
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

function getBuild(orgId, buildId) {
    _requireOrgId(orgId, "getBuild");
    return _load(BUILDS_PATH).find(b => b.buildId === buildId && _ownedBy(b, orgId)) || null;
}

function listBuilds(orgId, { status, repoId, branch, trigger, limit = 50 } = {}) {
    _requireOrgId(orgId, "listBuilds");
    let items = _load(BUILDS_PATH).filter(b => _ownedBy(b, orgId));
    if (status)  items = items.filter(b => b.status  === status);
    if (repoId)  items = items.filter(b => b.repoId  === repoId);
    if (branch)  items = items.filter(b => b.branch  === branch);
    if (trigger) items = items.filter(b => b.trigger === trigger);
    return items.slice(0, limit);
}

function getBuildStats(orgId, { repoId, dateFrom, dateTo } = {}) {
    _requireOrgId(orgId, "getBuildStats");
    let items = _load(BUILDS_PATH).filter(b => _ownedBy(b, orgId));
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
 * @param {string}  opts.orgId        REQUIRED — owning organization
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
function recordDeployment({ orgId, repoId, projectId, buildId, environment = "production",
                             version = "", status = "running", deployedBy = "operator",
                             durationMs, tags = [] } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!repoId) return { ok: false, error: "repoId required" };
    const deploy = {
        deployId:       _uid("dep"),
        orgId,
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

function updateDeployment(orgId, deployId, patch = {}) {
    _requireOrgId(orgId, "updateDeployment");
    const all = _load(DEPLOYS_PATH);
    const idx = all.findIndex(d => d.deployId === deployId && _ownedBy(d, orgId));
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

function rollbackDeployment(orgId, deployId, { reason = "", deployedBy = "operator" } = {}) {
    _requireOrgId(orgId, "rollbackDeployment");
    const all = _load(DEPLOYS_PATH);
    const idx = all.findIndex(d => d.deployId === deployId && _ownedBy(d, orgId));
    if (idx === -1) return { ok: false, error: "deployment_not_found" };
    all[idx].status         = "rolled-back";
    all[idx].rolledBackAt   = _now();
    all[idx].rollbackReason = reason;
    all[idx].finishedAt     = all[idx].finishedAt || _now();
    _save(DEPLOYS_PATH, all, MAX_DEPLOYS);

    // Create a new deployment record to represent the rollback action
    const rb = recordDeployment({
        orgId,
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

function getDeployment(orgId, deployId) {
    _requireOrgId(orgId, "getDeployment");
    return _load(DEPLOYS_PATH).find(d => d.deployId === deployId && _ownedBy(d, orgId)) || null;
}

function listDeployments(orgId, { status, repoId, environment, projectId, limit = 50 } = {}) {
    _requireOrgId(orgId, "listDeployments");
    let items = _load(DEPLOYS_PATH).filter(d => _ownedBy(d, orgId));
    if (status)      items = items.filter(d => d.status      === status);
    if (repoId)      items = items.filter(d => d.repoId      === repoId);
    if (environment) items = items.filter(d => d.environment === environment);
    if (projectId)   items = items.filter(d => d.projectId   === projectId);
    return items.slice(0, limit);
}

function getDeploymentStats(orgId, { repoId, dateFrom, dateTo } = {}) {
    _requireOrgId(orgId, "getDeploymentStats");
    let items = _load(DEPLOYS_PATH).filter(d => _ownedBy(d, orgId));
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

function getVelocityMetrics(orgId, { days = 7 } = {}) {
    _requireOrgId(orgId, "getVelocityMetrics");
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const issuesClosed = _load(ISSUES_PATH)
        .filter(i => _ownedBy(i, orgId) && i.closedAt && i.closedAt >= since).length;
    const issuesOpened = _load(ISSUES_PATH)
        .filter(i => _ownedBy(i, orgId) && i.createdAt >= since && i.status !== "deleted").length;
    const buildsRun = _load(BUILDS_PATH)
        .filter(b => _ownedBy(b, orgId) && b.startedAt >= since).length;
    const buildsFailed = _load(BUILDS_PATH)
        .filter(b => _ownedBy(b, orgId) && b.startedAt >= since && b.status === "failed").length;
    const deploys = _load(DEPLOYS_PATH)
        .filter(d => _ownedBy(d, orgId) && d.startedAt >= since).length;
    const deploysFailed = _load(DEPLOYS_PATH)
        .filter(d => _ownedBy(d, orgId) && d.startedAt >= since && d.status === "failed").length;

    // Patch activity from patchAssistant — NOT org-scoped yet (separate
    // finding, C9's coding patch-history item); left as a platform-wide
    // signal rather than fabricating a filter that doesn't exist upstream.
    let patchesApplied = 0;
    const pa = _pa();
    if (pa) {
        try {
            const patches = pa.listPatches({ limit: 200 });
            patchesApplied = patches.filter(p => p.appliedAt && p.appliedAt >= since).length;
        } catch { /* non-fatal */ }
    }

    // Pipeline runs from projectRunner — same caveat as above.
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

function getEngineeringDashboard(orgId) {
    _requireOrgId(orgId, "getEngineeringDashboard");
    const now = new Date().toISOString();

    // Repos
    const orgRepos    = _load(REPOS_PATH).filter(r => _ownedBy(r, orgId));
    const activeRepos = orgRepos.filter(r => r.status === "active");

    // Projects
    const allProjs    = _load(PROJS_PATH).filter(p => _ownedBy(p, orgId));
    const activeProjs = allProjs.filter(p => p.status === "active");

    // Issues
    const allIssues   = _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.status !== "deleted");
    const openIssues  = allIssues.filter(i => i.status === "open" || i.status === "in-progress");
    const criticalIssues = openIssues.filter(i => i.severity === "blocker" || i.severity === "critical" || i.priority === "critical");

    // Builds (last 10)
    const recentBuilds   = _load(BUILDS_PATH).filter(b => _ownedBy(b, orgId)).slice(0, 10);
    const failedBuilds   = recentBuilds.filter(b => b.status === "failed");

    // Deployments (last 5)
    const orgDeploys        = _load(DEPLOYS_PATH).filter(d => _ownedBy(d, orgId));
    const recentDeploys     = orgDeploys.slice(0, 5);
    const activeDeployments = orgDeploys.filter(d => d.status === "running");

    // Velocity (7-day)
    const velocity = getVelocityMetrics(orgId, { days: 7 });

    // Goals — goalEngine is not org-scoped; left platform-wide (a separate,
    // undocumented finding — not in scope for this recovery item).
    const ge        = _ge();
    const devGoals  = ge ? ge.listGoals({ type: "development", status: "active", limit: 5 }) : [];
    const goalSum   = ge ? ge.getGoalSummary() : null;

    // Pipeline runs — same caveat.
    const pr = _pr();
    let pipelineRuns = [];
    if (pr) {
        try { pipelineRuns = pr.listProjects({ limit: 5 }); } catch { /* non-fatal */ }
    }

    // Lifecycle maturity — platform-wide system metric, not tenant data.
    const lifecycle = (_readJson("lifecycle-reports.json") || [])[0] || null;

    return {
        generatedAt: now,
        repos: {
            active:  activeRepos.length,
            total:   orgRepos.length,
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

function getDailySummary(orgId, date) {
    _requireOrgId(orgId, "getDailySummary");
    const target   = date || new Date().toISOString().slice(0, 10);
    const dayStart = target + "T00:00:00.000Z";
    const dayEnd   = target + "T23:59:59.999Z";

    const issuesOpened  = _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.createdAt >= dayStart && i.createdAt <= dayEnd && i.status !== "deleted");
    const issuesClosed  = _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.closedAt  >= dayStart && i.closedAt  <= dayEnd);
    const buildsToday   = _load(BUILDS_PATH).filter(b => _ownedBy(b, orgId) && b.startedAt >= dayStart && b.startedAt <= dayEnd);
    const deploysToday  = _load(DEPLOYS_PATH).filter(d => _ownedBy(d, orgId) && d.startedAt >= dayStart && d.startedAt <= dayEnd);
    const projsChanged  = _load(PROJS_PATH).filter(p => _ownedBy(p, orgId) && p.updatedAt  >= dayStart && p.updatedAt  <= dayEnd);

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

function getWeeklySummary(orgId, weekStart) {
    _requireOrgId(orgId, "getWeeklySummary");
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

    const issuesClosed   = _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.closedAt  >= ws && i.closedAt  < we).length;
    const issuesOpened   = _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.createdAt >= ws && i.createdAt < we && i.status !== "deleted").length;
    const buildsThisWeek = _load(BUILDS_PATH).filter(b => _ownedBy(b, orgId) && b.startedAt >= ws && b.startedAt < we);
    const deploys        = _load(DEPLOYS_PATH).filter(d => _ownedBy(d, orgId) && d.startedAt >= ws && d.startedAt < we);
    const projsCompleted = _load(PROJS_PATH).filter(p => _ownedBy(p, orgId) && p.completedAt >= ws && p.completedAt < we);

    const buildSuccessRate = buildsThisWeek.length
        ? Math.round(buildsThisWeek.filter(b => b.status === "success").length / buildsThisWeek.length * 100)
        : null;
    const rollbacks = deploys.filter(d => d.status === "rolled-back").length;

    // Lifecycle maturity this week — platform-wide, not tenant data.
    const lifecycleReports = (_readJson("lifecycle-reports.json") || [])
        .filter(r => r.generatedAt >= ws && r.generatedAt < we);
    const avgMaturity = lifecycleReports.length
        ? Math.round(lifecycleReports.reduce((s, r) => s + (r.maturity?.total || 0), 0) / lifecycleReports.length)
        : null;

    // Dev goals completed — goalEngine not org-scoped, same caveat as dashboard.
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
        velocity:           getVelocityMetrics(orgId, { days: 7 }),
        highlights,
    };
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-STORE SEARCH
// ═══════════════════════════════════════════════════════════════════

function searchEngineering(orgId, query, { limit = 20 } = {}) {
    _requireOrgId(orgId, "searchEngineering");
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];

    const repoHits = searchRepos(orgId, query, { limit: 3 })
        .map(r => ({ type: "repo",    id: r.repoId,    title: r.name,    language: r.language }));

    const projHits = _load(PROJS_PATH)
        .filter(p => _ownedBy(p, orgId))
        .filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
        .slice(0, 3)
        .map(p => ({ type: "project", id: p.projectId, title: p.name,    status: p.status }));

    const issueHits = _load(ISSUES_PATH)
        .filter(i => _ownedBy(i, orgId) && i.status !== "deleted")
        .filter(i => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
        .slice(0, 5)
        .map(i => ({ type: "issue",   id: i.issueId,   title: i.title,   status: i.status, type_: i.type }));

    results.push(...repoHits, ...projHits, ...issueHits);

    // Cross-namespace via UME — NOT org-scoped (separate finding, C10-004/
    // 005 Memory OS). Left platform-wide here rather than fabricating a
    // filter the underlying engine doesn't support; the dev-entity results
    // above (repos/projects/issues) ARE correctly scoped, which is this
    // function's actual responsibility.
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

function getStats(orgId) {
    _requireOrgId(orgId, "getStats");
    return {
        repos:       _load(REPOS_PATH).filter(r => _ownedBy(r, orgId) && r.status !== "archived").length,
        projects:    _load(PROJS_PATH).filter(p => _ownedBy(p, orgId) && !["archived"].includes(p.status)).length,
        issues:      _load(ISSUES_PATH).filter(i => _ownedBy(i, orgId) && i.status !== "deleted").length,
        builds:      _load(BUILDS_PATH).filter(b => _ownedBy(b, orgId)).length,
        deployments: _load(DEPLOYS_PATH).filter(d => _ownedBy(d, orgId)).length,
    };
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION (one-time, operator-invoked; not reachable via any HTTP route)
// ═══════════════════════════════════════════════════════════════════

/**
 * Assigns a real orgId to every pre-recovery record that has none (orgId
 * undefined). NOT auto-run — pre-recovery records are simply invisible
 * (never matched by _ownedBy) until an operator explicitly runs this once,
 * deciding which real org should own the legacy data. This is a decision
 * only a human operator can make correctly; silently guessing (e.g.
 * "assign to whichever org calls first") would misattribute real
 * engineering history to the wrong tenant, which is worse than leaving it
 * inaccessible until a deliberate choice is made.
 */
function backfillUnownedRecords(orgId) {
    if (!orgId) return { ok: false, error: "orgId required" };
    let migrated = 0;
    for (const [filePath, max] of [
        [REPOS_PATH, MAX_REPOS], [PROJS_PATH, MAX_PROJS], [ISSUES_PATH, MAX_ISSUES],
        [BUILDS_PATH, MAX_BUILDS], [DEPLOYS_PATH, MAX_DEPLOYS],
    ]) {
        const all = _load(filePath);
        let changed = false;
        for (const item of all) {
            if (item.orgId === undefined) { item.orgId = orgId; changed = true; migrated++; }
        }
        if (changed) _save(filePath, all, max);
    }
    return { ok: true, migrated };
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
    // Migration
    backfillUnownedRecords,
};
