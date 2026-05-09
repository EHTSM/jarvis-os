/**
 * Organization Manager — departments, teams, and org structure per tenant.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function createDepartment({ tenantId, userId, name, head = "", budget = 0, parentDept = null }) {
    const auth = requireAuth(tenantId, userId, "admin");
    if (!auth.ok) return forbidden("organizationManager", auth.error);

    const depts = load(tenantId, "departments", []);
    if (depts.some(d => d.name.toLowerCase() === name.toLowerCase())) {
        return fail("organizationManager", `Department "${name}" already exists`);
    }

    const dept = { id: uid("dept"), tenantId, name, head, budget, parentDept, members: [], createdAt: NOW() };
    depts.push(dept);
    flush(tenantId, "departments", depts);
    auditLog(tenantId, userId, "department_created", { name });
    return dept;
}

function createTeam({ tenantId, userId, name, departmentId, leadUserId, members = [] }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("organizationManager", auth.error);

    const teams = load(tenantId, "teams", []);
    const team  = { id: uid("team"), tenantId, name, departmentId, leadUserId, members: [...new Set(members)], createdAt: NOW() };
    teams.push(team);
    flush(tenantId, "teams", teams);
    auditLog(tenantId, userId, "team_created", { name, departmentId });
    return team;
}

function addMemberToTeam({ tenantId, userId, teamId, memberId }) {
    const auth = requireAuth(tenantId, userId, "manager");
    if (!auth.ok) return forbidden("organizationManager", auth.error);

    const teams = load(tenantId, "teams", []);
    const team  = teams.find(t => t.id === teamId);
    if (!team) return fail("organizationManager", "Team not found");
    if (!team.members.includes(memberId)) team.members.push(memberId);
    flush(tenantId, "teams", teams);
    auditLog(tenantId, userId, "team_member_added", { teamId, memberId });
    return team;
}

function getOrgChart(tenantId, requesterId) {
    const auth  = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("organizationManager", auth.error);

    const depts = load(tenantId, "departments", []);
    const teams = load(tenantId, "teams", []);

    return {
        tenantId,
        departments: depts.map(d => ({
            ...d,
            teams: teams.filter(t => t.departmentId === d.id)
        })),
        totalDepartments: depts.length,
        totalTeams:       teams.length
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "create_department")     data = createDepartment(p);
        else if (task.type === "create_team")      data = createTeam(p);
        else if (task.type === "add_team_member")  data = addMemberToTeam(p);
        else                                       data = getOrgChart(p.tenantId, p.userId);
        if (data?.code === 403) return data;
        return ok("organizationManager", data);
    } catch (err) { return fail("organizationManager", err.message); }
}

module.exports = { createDepartment, createTeam, addMemberToTeam, getOrgChart, run };
