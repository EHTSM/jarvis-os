// Developer OS API — connects Developer OS routes via /dev/* endpoints.
import { _fetch } from "./_client";

function _buildQuery(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    });
    const qs = q.toString();
    return qs ? `?${qs}` : "";
}

// ── Repositories ─────────────────────────────────────────────────
export async function getDevRepos({ status, language, search, limit = 50 } = {}) {
    try {
        return await _fetch(`/dev/repos${_buildQuery({ status, language, search, limit })}`);
    } catch (err) { return { success: false, error: err.message, repos: [] }; }
}

export async function getDevRepo(repoId) {
    try {
        return await _fetch(`/dev/repos/${repoId}`);
    } catch (err) { return { success: false, error: err.message, repo: null }; }
}

export async function createDevRepo(payload = {}) {
    try {
        return await _fetch("/dev/repos", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function updateDevRepo(repoId, payload = {}) {
    try {
        return await _fetch(`/dev/repos/${repoId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function archiveDevRepo(repoId) {
    try {
        return await _fetch(`/dev/repos/${repoId}/archive`, { method: "POST" });
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Projects ───────────────────────────────────────────────────────
export async function getDevProjects({ status, repoId, priority, limit = 50 } = {}) {
    try {
        return await _fetch(`/dev/projects${_buildQuery({ status, repoId, priority, limit })}`);
    } catch (err) { return { success: false, error: err.message, projects: [] }; }
}

export async function getDevProject(projectId) {
    try {
        return await _fetch(`/dev/projects/${projectId}`);
    } catch (err) { return { success: false, error: err.message, project: null }; }
}

export async function createDevProject(payload = {}) {
    try {
        return await _fetch("/dev/projects", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function updateDevProject(projectId, payload = {}) {
    try {
        return await _fetch(`/dev/projects/${projectId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function completeDevProject(projectId, payload = {}) {
    try {
        return await _fetch(`/dev/projects/${projectId}/complete`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function archiveDevProject(projectId) {
    try {
        return await _fetch(`/dev/projects/${projectId}/archive`, { method: "POST" });
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Issues ─────────────────────────────────────────────────────────
export async function getDevIssues({ status, type, priority, repoId, projectId, assignee, label, limit = 50 } = {}) {
    try {
        return await _fetch(`/dev/issues${_buildQuery({ status, type, priority, repoId, projectId, assignee, label, limit })}`);
    } catch (err) { return { success: false, error: err.message, issues: [] }; }
}

export async function getDevIssue(issueId) {
    try {
        return await _fetch(`/dev/issues/${issueId}`);
    } catch (err) { return { success: false, error: err.message, issue: null }; }
}

export async function createDevIssue(payload = {}) {
    try {
        return await _fetch("/dev/issues", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function updateDevIssue(issueId, payload = {}) {
    try {
        return await _fetch(`/dev/issues/${issueId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function assignDevIssue(issueId, assignee = "") {
    try {
        return await _fetch(`/dev/issues/${issueId}/assign`, {
            method: "POST",
            body: JSON.stringify({ assignee }),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function closeDevIssue(issueId, payload = {}) {
    try {
        return await _fetch(`/dev/issues/${issueId}/close`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function reopenDevIssue(issueId) {
    try {
        return await _fetch(`/dev/issues/${issueId}/reopen`, { method: "POST" });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function deleteDevIssue(issueId) {
    try {
        return await _fetch(`/dev/issues/${issueId}`, { method: "DELETE" });
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Builds ─────────────────────────────────────────────────────────
export async function recordDevBuild(payload = {}) {
    try {
        return await _fetch("/dev/builds", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function getDevBuilds({ status, repoId, branch, trigger, limit = 50 } = {}) {
    try {
        return await _fetch(`/dev/builds${_buildQuery({ status, repoId, branch, trigger, limit })}`);
    } catch (err) { return { success: false, error: err.message, builds: [] }; }
}

export async function getDevBuildStats({ repoId, dateFrom, dateTo } = {}) {
    try {
        return await _fetch(`/dev/builds/stats${_buildQuery({ repoId, dateFrom, dateTo })}`);
    } catch (err) { return { success: false, error: err.message, stats: {} }; }
}

export async function getDevBuild(buildId) {
    try {
        return await _fetch(`/dev/builds/${buildId}`);
    } catch (err) { return { success: false, error: err.message, build: null }; }
}

export async function updateDevBuild(buildId, payload = {}) {
    try {
        return await _fetch(`/dev/builds/${buildId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Deployments ───────────────────────────────────────────────────
export async function recordDevDeployment(payload = {}) {
    try {
        return await _fetch("/dev/deployments", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function getDevDeployments({ status, repoId, environment, projectId, limit = 50 } = {}) {
    try {
        return await _fetch(`/dev/deployments${_buildQuery({ status, repoId, environment, projectId, limit })}`);
    } catch (err) { return { success: false, error: err.message, deployments: [] }; }
}

export async function getDevDeploymentStats({ repoId, dateFrom, dateTo } = {}) {
    try {
        return await _fetch(`/dev/deployments/stats${_buildQuery({ repoId, dateFrom, dateTo })}`);
    } catch (err) { return { success: false, error: err.message, stats: {} }; }
}

export async function getDevDeployment(deploymentId) {
    try {
        return await _fetch(`/dev/deployments/${deploymentId}`);
    } catch (err) { return { success: false, error: err.message, deployment: null }; }
}

export async function updateDevDeployment(deploymentId, payload = {}) {
    try {
        return await _fetch(`/dev/deployments/${deploymentId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

export async function rollbackDevDeployment(deploymentId, payload = {}) {
    try {
        return await _fetch(`/dev/deployments/${deploymentId}/rollback`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Engineering dashboard + summaries ─────────────────────────────
export async function getDeveloperDashboard() {
    try {
        return await _fetch("/dev/dashboard");
    } catch (err) { return { success: false, error: err.message }; }
}

export async function getDeveloperDailySummary(date) {
    try {
        return await _fetch(`/dev/summary/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`);
    } catch (err) { return { success: false, error: err.message }; }
}

export async function getDeveloperWeeklySummary(weekStart) {
    try {
        return await _fetch(`/dev/summary/weekly${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ""}`);
    } catch (err) { return { success: false, error: err.message }; }
}

export async function getDeveloperVelocity(days = 7) {
    try {
        return await _fetch(`/dev/velocity?days=${encodeURIComponent(String(days))}`);
    } catch (err) { return { success: false, error: err.message }; }
}

export async function searchDeveloper(query, limit = 20) {
    try {
        if (!query) return { success: false, error: "Query required", results: [] };
        return await _fetch(`/dev/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`);
    } catch (err) { return { success: false, error: err.message, results: [] }; }
}

export async function getDeveloperStats() {
    try {
        return await _fetch("/dev/stats");
    } catch (err) { return { success: false, error: err.message }; }
}
