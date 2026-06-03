import { _fetch } from "./_client";

function _buildQuery(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            query.set(key, String(value));
        }
    });
    const qs = query.toString();
    return qs ? `?${qs}` : "";
}

async function _safeFetch(path, fallback = {}) {
    try {
        return await _fetch(path);
    } catch (err) {
        return { success: false, error: err.message, ...fallback };
    }
}

// ── Dashboard and summaries
export async function getEnterpriseDashboard() {
    return await _safeFetch("/enterprise/dashboard");
}

export async function getEnterpriseDailySummary(date) {
    return await _safeFetch(`/enterprise/summary/daily${_buildQuery({ date })}`);
}

export async function getEnterpriseWeeklySummary(weekStart) {
    return await _safeFetch(`/enterprise/summary/weekly${_buildQuery({ weekStart })}`);
}

export async function getEnterpriseComplianceSummary(orgId) {
    if (!orgId) return { success: false, error: "orgId required" };
    return await _safeFetch(`/enterprise/compliance/${orgId}`);
}

export async function getEnterpriseStats() {
    return await _safeFetch("/enterprise/stats");
}

export async function searchEnterprise(q, { limit = 20 } = {}) {
    if (!q) return { success: false, error: "query required", results: [] };
    return await _safeFetch(`/enterprise/search${_buildQuery({ q, limit })}`, { results: [] });
}

// ── Organizations
export async function getEnterpriseOrgs({ status, plan, industry, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/orgs${_buildQuery({ status, plan, industry, limit })}`, { orgs: [] });
}

export async function getEnterpriseOrg(orgId) {
    if (!orgId) return { success: false, error: "orgId required", org: null };
    return await _safeFetch(`/enterprise/orgs/${orgId}`);
}

export async function createEnterpriseOrg(payload = {}) {
    try {
        return await _fetch("/enterprise/orgs", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateEnterpriseOrg(orgId, payload = {}) {
    if (!orgId) return { success: false, error: "orgId required" };
    try {
        return await _fetch(`/enterprise/orgs/${orgId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function archiveEnterpriseOrg(orgId) {
    if (!orgId) return { success: false, error: "orgId required" };
    try {
        return await _fetch(`/enterprise/orgs/${orgId}/archive`, { method: "POST" });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Departments
export async function getEnterpriseDepts({ orgId, status, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/depts${_buildQuery({ orgId, status, limit })}`, { depts: [] });
}

export async function getEnterpriseDept(deptId) {
    if (!deptId) return { success: false, error: "deptId required", dept: null };
    return await _safeFetch(`/enterprise/depts/${deptId}`);
}

export async function createEnterpriseDept(payload = {}) {
    try {
        return await _fetch("/enterprise/depts", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateEnterpriseDept(deptId, payload = {}) {
    if (!deptId) return { success: false, error: "deptId required" };
    try {
        return await _fetch(`/enterprise/depts/${deptId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function archiveEnterpriseDept(deptId) {
    if (!deptId) return { success: false, error: "deptId required" };
    try {
        return await _fetch(`/enterprise/depts/${deptId}/archive`, { method: "POST" });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Teams
export async function getEnterpriseTeams({ orgId, deptId, status, type, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/teams${_buildQuery({ orgId, deptId, status, type, limit })}`, { teams: [] });
}

export async function getEnterpriseTeam(teamId) {
    if (!teamId) return { success: false, error: "teamId required", team: null };
    return await _safeFetch(`/enterprise/teams/${teamId}`);
}

export async function createEnterpriseTeam(payload = {}) {
    try {
        return await _fetch("/enterprise/teams", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateEnterpriseTeam(teamId, payload = {}) {
    if (!teamId) return { success: false, error: "teamId required" };
    try {
        return await _fetch(`/enterprise/teams/${teamId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function addEnterpriseTeamMember(teamId, payload = {}) {
    if (!teamId) return { success: false, error: "teamId required" };
    try {
        return await _fetch(`/enterprise/teams/${teamId}/members`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function removeEnterpriseTeamMember(teamId, memberId) {
    if (!teamId || !memberId) return { success: false, error: "teamId and memberId required" };
    try {
        return await _fetch(`/enterprise/teams/${teamId}/members/${memberId}`, { method: "DELETE" });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function archiveEnterpriseTeam(teamId) {
    if (!teamId) return { success: false, error: "teamId required" };
    try {
        return await _fetch(`/enterprise/teams/${teamId}/archive`, { method: "POST" });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Roles
export async function getEnterpriseRoles({ orgId, scope, status, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/roles${_buildQuery({ orgId, scope, status, limit })}`, { roles: [] });
}

export async function getEnterpriseRole(roleId) {
    if (!roleId) return { success: false, error: "roleId required", role: null };
    return await _safeFetch(`/enterprise/roles/${roleId}`);
}

export async function createEnterpriseRole(payload = {}) {
    try {
        return await _fetch("/enterprise/roles", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateEnterpriseRole(roleId, payload = {}) {
    if (!roleId) return { success: false, error: "roleId required" };
    try {
        return await _fetch(`/enterprise/roles/${roleId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function deprecateEnterpriseRole(roleId) {
    if (!roleId) return { success: false, error: "roleId required" };
    try {
        return await _fetch(`/enterprise/roles/${roleId}/deprecate`, { method: "POST" });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Permissions
export async function getEnterprisePermissions({ memberId, roleId, orgId, resource, active, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/permissions${_buildQuery({ memberId, roleId, orgId, resource, active, limit })}`, { permissions: [] });
}

export async function getEnterprisePermission(permId) {
    if (!permId) return { success: false, error: "permId required", permission: null };
    return await _safeFetch(`/enterprise/permissions/${permId}`);
}

export async function grantEnterprisePermission(payload = {}) {
    try {
        return await _fetch("/enterprise/permissions", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateEnterprisePermission(permId, payload = {}) {
    if (!permId) return { success: false, error: "permId required" };
    try {
        return await _fetch(`/enterprise/permissions/${permId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function revokeEnterprisePermission(permId, payload = {}) {
    if (!permId) return { success: false, error: "permId required" };
    try {
        return await _fetch(`/enterprise/permissions/${permId}/revoke`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function checkEnterprisePermission({ memberId, resource, action } = {}) {
    if (!memberId || !resource || !action) return { success: false, error: "memberId, resource, action required" };
    return await _safeFetch(`/enterprise/permissions/check${_buildQuery({ memberId, resource, action })}`);
}

// ── Policies
export async function getEnterprisePolicies({ orgId, type, status, enforcement, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/policies${_buildQuery({ orgId, type, status, enforcement, limit })}`, { policies: [] });
}

export async function getEnterprisePolicy(policyId) {
    if (!policyId) return { success: false, error: "policyId required", policy: null };
    return await _safeFetch(`/enterprise/policies/${policyId}`);
}

export async function createEnterprisePolicy(payload = {}) {
    try {
        return await _fetch("/enterprise/policies", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function updateEnterprisePolicy(policyId, payload = {}) {
    if (!policyId) return { success: false, error: "policyId required" };
    try {
        return await _fetch(`/enterprise/policies/${policyId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function enforceEnterprisePolicy(policyId, context = {}) {
    if (!policyId) return { success: false, error: "policyId required" };
    try {
        return await _fetch(`/enterprise/policies/${policyId}/enforce`, {
            method: "POST",
            body: JSON.stringify(context),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function archiveEnterprisePolicy(policyId) {
    if (!policyId) return { success: false, error: "policyId required" };
    try {
        return await _fetch(`/enterprise/policies/${policyId}/archive`, { method: "POST" });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Audit
export async function logEnterpriseAuditEvent(payload = {}) {
    try {
        return await _fetch("/enterprise/audit", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

export async function getEnterpriseAuditEvents({ orgId, actorId, action, resource, outcome, dateFrom, dateTo, limit = 50 } = {}) {
    return await _safeFetch(`/enterprise/audit${_buildQuery({ orgId, actorId, action, resource, outcome, dateFrom, dateTo, limit })}`, { events: [] });
}

export async function getEnterpriseAuditStats({ orgId, dateFrom, dateTo } = {}) {
    return await _safeFetch(`/enterprise/audit/stats${_buildQuery({ orgId, dateFrom, dateTo })}`);
}
