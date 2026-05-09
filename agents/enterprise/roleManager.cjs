/**
 * Role Manager — RBAC for enterprise tenants.
 * Roles: viewer < employee < manager < admin < superadmin
 */

const { loadGlobal, flushGlobal, getMember, setMember, hasRole, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const ROLES = ["viewer", "employee", "manager", "admin", "superadmin"];

const PERMISSIONS = {
    viewer:     ["read:own",  "view:dashboard"],
    employee:   ["read:own",  "write:own",  "view:dashboard", "use:tools"],
    manager:    ["read:team", "write:team", "view:analytics", "manage:members", "approve:requests"],
    admin:      ["read:all",  "write:all",  "manage:org",     "manage:billing", "view:audit"],
    superadmin: ["*"]
};

function assignRole({ tenantId, adminUserId, targetUserId, role, department = "", jobTitle = "" }) {
    const auth = requireAuth(tenantId, adminUserId, "admin");
    if (!auth.ok) return forbidden("roleManager", auth.error);
    if (!ROLES.includes(role)) return fail("roleManager", `Invalid role: ${role}. Use: ${ROLES.join(", ")}`);

    const member = setMember(tenantId, targetUserId, role, { department, jobTitle, assignedBy: adminUserId, assignedAt: NOW() });
    auditLog(tenantId, adminUserId, "role_assigned", { targetUserId, role, department });
    return { member, permissions: PERMISSIONS[role] || [] };
}

function revokeRole({ tenantId, adminUserId, targetUserId }) {
    const auth = requireAuth(tenantId, adminUserId, "admin");
    if (!auth.ok) return forbidden("roleManager", auth.error);

    const members = loadGlobal("members", {});
    const key     = `${tenantId}::${targetUserId}`;
    if (!members[key]) return fail("roleManager", "Member not found");

    delete members[key];
    flushGlobal("members", members);
    auditLog(tenantId, adminUserId, "role_revoked", { targetUserId });
    return { revoked: true, targetUserId };
}

function checkPermission({ tenantId, userId, permission }) {
    const member = getMember(tenantId, userId);
    if (!member) return { allowed: false, reason: "Not a member of this tenant" };

    const perms = PERMISSIONS[member.role] || [];
    const allowed = perms.includes("*") || perms.includes(permission);
    return { allowed, role: member.role, permissions: perms };
}

function listMembers(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "manager");
    if (!auth.ok) return forbidden("roleManager", auth.error);

    const members = loadGlobal("members", {});
    const tenantMembers = Object.values(members).filter(m => m.tenantId === tenantId);
    return { tenantId, members: tenantMembers, total: tenantMembers.length };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "assign_role")    data = assignRole(p);
        else if (task.type === "revoke_role")    data = revokeRole(p);
        else if (task.type === "check_permission") data = checkPermission(p);
        else                                     data = listMembers(p.tenantId, p.userId);

        if (data?.code === 403) return data;
        return ok("roleManager", data);
    } catch (err) { return fail("roleManager", err.message); }
}

module.exports = { assignRole, revokeRole, checkPermission, listMembers, ROLES, PERMISSIONS, run };
