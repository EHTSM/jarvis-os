"use strict";
/**
 * MultiRepoEngineeringEngine
 *
 * Capabilities:
 *   - Manage multiple repository registrations
 *   - Shared task coordination across repos
 *   - Cross-repo dependency tracking
 *   - Cross-repo release planning
 *
 * Persistence: data/multi-repo.json
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STORE_PATH = path.join(__dirname, "../../data/multi-repo.json");

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
    catch { return { repos: {}, tasks: {}, deps: {}, releases: {}, seq: 0 }; }
}
function _save(d) { fs.writeFileSync(STORE_PATH, JSON.stringify(d, null, 2)); }
function _id(prefix, store) { store.seq = (store.seq || 0) + 1; return `${prefix}-${store.seq}`; }

// ── Repo management ───────────────────────────────────────────────────────────

function registerRepo(repoId, localPath, meta = {}) {
    const store = _load();
    const abs   = path.resolve(localPath);
    if (!fs.existsSync(abs)) throw new Error(`Path not found: ${abs}`);

    // Collect git info if available
    let gitInfo = {};
    try {
        const remote = execSync(`git -C ${JSON.stringify(abs)} remote get-url origin 2>/dev/null`, { encoding: "utf8" }).trim();
        const branch = execSync(`git -C ${JSON.stringify(abs)} branch --show-current 2>/dev/null`, { encoding: "utf8" }).trim();
        const lastCommit = execSync(`git -C ${JSON.stringify(abs)} log -1 --format="%H %s" 2>/dev/null`, { encoding: "utf8" }).trim();
        gitInfo = { remote, branch, lastCommit };
    } catch { /* not a git repo — still register */ }

    let pkgMeta = {};
    const pkgPath = path.join(abs, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            pkgMeta = { name: pkg.name, version: pkg.version, description: pkg.description };
        } catch { /* ignore */ }
    }

    store.repos[repoId] = {
        repoId,
        localPath: abs,
        registeredAt: new Date().toISOString(),
        git:  gitInfo,
        pkg:  pkgMeta,
        tags: meta.tags || [],
        env:  meta.env  || "unknown",
        ...meta,
    };
    _save(store);
    return store.repos[repoId];
}

function unregisterRepo(repoId) {
    const store = _load();
    if (!store.repos[repoId]) throw new Error("Repo not registered");
    delete store.repos[repoId];
    _save(store);
    return { removed: repoId };
}

function listRepos() {
    return Object.values(_load().repos);
}

function getRepo(repoId) {
    const r = _load().repos[repoId];
    if (!r) throw new Error("Repo not found");
    return r;
}

// ── Shared task coordination ──────────────────────────────────────────────────

function createSharedTask(title, repoIds, opts = {}) {
    const store  = _load();
    const taskId = _id("mtask", store);
    // validate repos exist
    for (const rid of repoIds) {
        if (!store.repos[rid]) throw new Error(`Repo ${rid} not registered`);
    }
    store.tasks[taskId] = {
        taskId,
        title,
        repoIds,
        status:       "open",
        priority:     opts.priority || "medium",
        assignee:     opts.assignee || null,
        notes:        opts.notes    || "",
        repoStatuses: Object.fromEntries(repoIds.map(r => [r, "pending"])),
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
    };
    _save(store);
    return store.tasks[taskId];
}

function updateTaskStatus(taskId, repoId, status, note = "") {
    const store = _load();
    const task  = store.tasks[taskId];
    if (!task) throw new Error("Task not found");
    if (repoId) {
        if (!task.repoStatuses[repoId]) throw new Error("Repo not part of this task");
        task.repoStatuses[repoId] = status;
    } else {
        task.status = status;
    }
    if (note) task.notes = (task.notes ? task.notes + "\n" : "") + note;
    task.updatedAt = new Date().toISOString();
    // auto-complete task when all repos done
    const allDone = Object.values(task.repoStatuses).every(s => s === "done");
    if (allDone) task.status = "done";
    _save(store);
    return task;
}

function listTasks(repoId) {
    const tasks = Object.values(_load().tasks);
    return repoId ? tasks.filter(t => t.repoIds.includes(repoId)) : tasks;
}

function getTask(taskId) {
    const t = _load().tasks[taskId];
    if (!t) throw new Error("Task not found");
    return t;
}

// ── Cross-repo dependency tracking ───────────────────────────────────────────

function addDependency(fromRepoId, toRepoId, opts = {}) {
    const store = _load();
    if (!store.repos[fromRepoId]) throw new Error(`Repo ${fromRepoId} not registered`);
    if (!store.repos[toRepoId])   throw new Error(`Repo ${toRepoId} not registered`);

    const depId = `dep-${fromRepoId}-${toRepoId}`;
    store.deps[depId] = {
        depId,
        from:       fromRepoId,
        to:         toRepoId,
        type:       opts.type    || "runtime",   // runtime | devDependency | peer
        version:    opts.version || "*",
        notes:      opts.notes   || "",
        addedAt:    new Date().toISOString(),
    };
    _save(store);
    return store.deps[depId];
}

function removeDependency(depId) {
    const store = _load();
    if (!store.deps[depId]) throw new Error("Dependency not found");
    delete store.deps[depId];
    _save(store);
    return { removed: depId };
}

function getDependencyGraph() {
    const store  = _load();
    const nodes  = Object.keys(store.repos).map(id => ({
        id,
        label: store.repos[id].pkg?.name || id,
        env:   store.repos[id].env,
    }));
    const edges  = Object.values(store.deps).map(d => ({
        from:    d.from,
        to:      d.to,
        type:    d.type,
        version: d.version,
    }));
    // detect cycles
    const cycles = _detectCycles(nodes.map(n => n.id), edges);
    return { nodes, edges, cycles };
}

function _detectCycles(nodeIds, edges) {
    const adj = {};
    for (const id of nodeIds) adj[id] = [];
    for (const e of edges) {
        if (adj[e.from]) adj[e.from].push(e.to);
    }
    const visited = new Set();
    const stack   = new Set();
    const cycles  = [];

    function dfs(node, path) {
        if (stack.has(node)) { cycles.push([...path, node]); return; }
        if (visited.has(node)) return;
        visited.add(node);
        stack.add(node);
        for (const nb of (adj[node] || [])) dfs(nb, [...path, node]);
        stack.delete(node);
    }
    for (const id of nodeIds) dfs(id, []);
    return cycles;
}

function getDependents(repoId) {
    const store = _load();
    return Object.values(store.deps).filter(d => d.to === repoId);
}

// ── Cross-repo release planning ───────────────────────────────────────────────

function planRelease(releaseId, repoIds, opts = {}) {
    const store = _load();
    for (const rid of repoIds) {
        if (!store.repos[rid]) throw new Error(`Repo ${rid} not registered`);
    }

    const depGraph = getDependencyGraph();
    // topological sort: build order respects dependencies
    const order = _topoSort(repoIds, depGraph.edges.filter(e =>
        repoIds.includes(e.from) && repoIds.includes(e.to)
    ));

    const plan = {
        releaseId,
        repoIds,
        buildOrder:   order,
        version:      opts.version   || "patch",
        targetDate:   opts.targetDate || null,
        status:       "planned",
        checklist: [
            { step: "Run tests for all repos",        done: false },
            { step: "Bump versions",                  done: false },
            { step: "Build artifacts",                done: false },
            { step: "Deploy in build order",          done: false },
            { step: "Smoke test each service",        done: false },
            { step: "Tag releases in git",            done: false },
            { step: "Update shared dependency locks", done: false },
        ],
        repoVersions: Object.fromEntries(repoIds.map(rid => [rid, store.repos[rid].pkg?.version || "0.0.0"])),
        cycles:       depGraph.cycles,
        notes:        opts.notes || "",
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
    };

    store.releases[releaseId] = plan;
    _save(store);
    return plan;
}

function updateRelease(releaseId, update) {
    const store   = _load();
    const release = store.releases[releaseId];
    if (!release) throw new Error("Release not found");
    Object.assign(release, update, { updatedAt: new Date().toISOString() });
    _save(store);
    return release;
}

function listReleases() { return Object.values(_load().releases); }
function getRelease(id) {
    const r = _load().releases[id];
    if (!r) throw new Error("Release not found");
    return r;
}

function _topoSort(nodeIds, edges) {
    const adj = {};
    const indegree = {};
    for (const id of nodeIds) { adj[id] = []; indegree[id] = 0; }
    for (const e of edges) {
        if (adj[e.from] && indegree[e.to] !== undefined) {
            adj[e.from].push(e.to);
            indegree[e.to]++;
        }
    }
    const queue  = nodeIds.filter(id => indegree[id] === 0);
    const result = [];
    while (queue.length) {
        const node = queue.shift();
        result.push(node);
        for (const nb of adj[node]) {
            indegree[nb]--;
            if (indegree[nb] === 0) queue.push(nb);
        }
    }
    // add any remaining (cycle nodes)
    for (const id of nodeIds) if (!result.includes(id)) result.push(id);
    return result;
}

module.exports = {
    registerRepo, unregisterRepo, listRepos, getRepo,
    createSharedTask, updateTaskStatus, listTasks, getTask,
    addDependency, removeDependency, getDependencyGraph, getDependents,
    planRelease, updateRelease, listReleases, getRelease,
};
