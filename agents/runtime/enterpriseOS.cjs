"use strict";
/**
 * Enterprise AI Operating System — organizations, departments, teams, roles,
 * permissions, governance policies, audit logging, enterprise summaries.
 *
 * Entry points:
 *
 * Organizations:
 *   createOrg(opts)               — register an organization
 *   updateOrg(orgId, patch)
 *   archiveOrg(orgId)
 *   getOrg(orgId)
 *   listOrgs(opts)
 *
 * Departments:
 *   createDept(opts)              — create a department within an org
 *   updateDept(deptId, patch)
 *   archiveDept(deptId)
 *   getDept(deptId)
 *   listDepts(opts)               — filter by orgId, status
 *
 * Teams:
 *   createTeam(opts)              — create a team within a dept/org
 *   updateTeam(teamId, patch)
 *   addMember(teamId, member)     — add member to team
 *   removeMember(teamId, memberId)
 *   archiveTeam(teamId)
 *   getTeam(teamId)
 *   listTeams(opts)               — filter by orgId, deptId, status
 *
 * Roles:
 *   createRole(opts)              — define a role within an org
 *   updateRole(roleId, patch)
 *   deprecateRole(roleId)
 *   getRole(roleId)
 *   listRoles(opts)               — filter by orgId, scope
 *
 * Permissions:
 *   grantPermission(opts)         — assign role+permissions to a member
 *   revokePermission(permId)      — revoke a grant
 *   updatePermission(permId, patch)
 *   getPermission(permId)
 *   listPermissions(opts)         — filter by memberId, roleId, orgId, resource
 *   checkPermission(memberId, resource, action) — true/false access check
 *
 * Governance Policies:
 *   createPolicy(opts)            — define a governance policy
 *   updatePolicy(policyId, patch)
 *   enforcePolicy(policyId, context) — evaluate policy against context
 *   archivePolicy(policyId)
 *   getPolicy(policyId)
 *   listPolicies(opts)            — filter by orgId, type, status
 *
 * Audit Logging:
 *   logAuditEvent(opts)           — append an immutable audit event
 *   listAuditLog(opts)            — filter by orgId, actorId, resource, action, dateFrom/To
 *   getAuditStats(opts)           — event counts by type, actor, resource
 *
 * Dashboard & Summaries:
 *   getEnterpriseDashboard()      — live snapshot
 *   getDailySummary(date)         — daily enterprise activity
 *   getWeeklySummary(weekStart)   — weekly roll-up
 *   getComplianceSummary(orgId)   — policy coverage + recent violations
 *
 * Stats:
 *   getStats()
 *
 * Reuses (all fail-safe):
 *   goalEngine.listGoals({ type: "operational" })  — org goals on dashboard
 *   goalEngine.getGoalSummary()
 *   unifiedMemoryEngine.search()                   — cross-namespace recall
 *   personalOS.getStats()                          — personal activity context
 *   businessOS.getStats()                          — business activity context
 *   developerOS.getStats()                         — dev activity context
 *   lifecycle-reports.json                         — system maturity in summaries
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Storage (all in data/):
 *   enterprise-orgs.json          — organizations (max 200)
 *   enterprise-depts.json         — departments (max 500)
 *   enterprise-teams.json         — teams (max 1000)
 *   enterprise-roles.json         — roles (max 500)
 *   enterprise-permissions.json   — permission grants (max 5000)
 *   enterprise-policies.json      — governance policies (max 500)
 *   enterprise-audit.json         — audit log (max 10000, append-only)
 *
 * Organization shape:
 *   { orgId, name, description, industry, plan, status, settings{},
 *     ownerId, tags[], createdAt, updatedAt, archivedAt? }
 *
 * Department shape:
 *   { deptId, orgId, name, description, headId?, status,
 *     tags[], createdAt, updatedAt, archivedAt? }
 *
 * Team shape:
 *   { teamId, orgId, deptId?, name, description, type,
 *     members[{memberId,name,email,role,joinedAt}],
 *     status, tags[], createdAt, updatedAt, archivedAt? }
 *
 * Role shape:
 *   { roleId, orgId, name, description, scope,
 *     permissions[], isSystem, status,
 *     createdAt, updatedAt, deprecatedAt? }
 *
 * Permission grant shape:
 *   { permId, orgId, memberId, memberName, roleId,
 *     resource, actions[], grantedBy, grantedAt,
 *     expiresAt?, revokedAt?, revokedBy?, active }
 *
 * Policy shape:
 *   { policyId, orgId, name, description, type,
 *     rules[], enforcement, status,
 *     createdAt, updatedAt, archivedAt?,
 *     lastEvaluatedAt?, lastViolation? }
 *
 * Audit event shape (immutable once written):
 *   { eventId, orgId, actorId, actorName, action,
 *     resource, resourceId, outcome, detail,
 *     ip?, ts }
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");

const ORGS_PATH    = path.join(DATA_DIR, "enterprise-orgs.json");
const DEPTS_PATH   = path.join(DATA_DIR, "enterprise-depts.json");
const TEAMS_PATH   = path.join(DATA_DIR, "enterprise-teams.json");
const ROLES_PATH   = path.join(DATA_DIR, "enterprise-roles.json");
const PERMS_PATH   = path.join(DATA_DIR, "enterprise-permissions.json");
const POLICIES_PATH= path.join(DATA_DIR, "enterprise-policies.json");
const AUDIT_PATH   = path.join(DATA_DIR, "enterprise-audit.json");

const MAX_ORGS     = 200;
const MAX_DEPTS    = 500;
const MAX_TEAMS    = 1000;
const MAX_ROLES    = 500;
const MAX_PERMS    = 5000;
const MAX_POLICIES = 500;
const MAX_AUDIT    = 10000;

// ── Lazy accessors ────────────────────────────────────────────────
function _ge()  { try { return require("./goalEngine.cjs");          } catch { return null; } }
function _ume() { try { return require("./unifiedMemoryEngine.cjs"); } catch { return null; } }
function _pos() { try { return require("./personalOS.cjs");          } catch { return null; } }
function _bos() { try { return require("./businessOS.cjs");          } catch { return null; } }
function _dos() { try { return require("./developerOS.cjs");         } catch { return null; } }

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
// ORGANIZATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.industry]    "tech"|"finance"|"healthcare"|"retail"|"education"|"other"
 * @param {string}  [opts.plan]        "free"|"starter"|"growth"|"enterprise"
 * @param {string}  [opts.ownerId]
 * @param {object}  [opts.settings]    arbitrary org-level settings
 * @param {string[]} [opts.tags]
 */
function createOrg({ name, description = "", industry = "other", plan = "free",
                      ownerId = "", settings = {}, tags = [] } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const org = {
        orgId:       _uid("org"),
        name:        name.slice(0, 200),
        description: description.slice(0, 500),
        industry,
        plan,
        status:      "active",   // active | suspended | archived
        settings,
        ownerId,
        tags,
        createdAt:   _now(),
        updatedAt:   _now(),
        archivedAt:  null,
    };
    const all = _load(ORGS_PATH);
    all.unshift(org);
    _save(ORGS_PATH, all, MAX_ORGS);
    _audit({ orgId: org.orgId, actorId: ownerId || "system", actorName: "system",
             action: "org.created", resource: "organization", resourceId: org.orgId,
             outcome: "success", detail: `Organization "${name}" created` });
    return org;
}

function updateOrg(orgId, patch = {}) {
    const all = _load(ORGS_PATH);
    const idx = all.findIndex(o => o.orgId === orgId);
    if (idx === -1) return { ok: false, error: "org_not_found" };
    const allowed = ["name","description","industry","plan","status","settings","ownerId","tags"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(ORGS_PATH, all, MAX_ORGS);
    return { ok: true, org: all[idx] };
}

function archiveOrg(orgId) {
    const all = _load(ORGS_PATH);
    const idx = all.findIndex(o => o.orgId === orgId);
    if (idx === -1) return { ok: false, error: "org_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(ORGS_PATH, all, MAX_ORGS);
    _audit({ orgId, actorId: "system", actorName: "system",
             action: "org.archived", resource: "organization", resourceId: orgId,
             outcome: "success", detail: `Organization archived` });
    return { ok: true, org: all[idx] };
}

function getOrg(orgId) {
    return _load(ORGS_PATH).find(o => o.orgId === orgId) || null;
}

function listOrgs({ status, plan, industry, limit = 50 } = {}) {
    let items = _load(ORGS_PATH);
    if (status)   items = items.filter(o => o.status   === status);
    if (plan)     items = items.filter(o => o.plan     === plan);
    if (industry) items = items.filter(o => o.industry === industry);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {string}  opts.orgId
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.headId]     member ID of department head
 * @param {string[]} [opts.tags]
 */
function createDept({ orgId, name, description = "", headId = "", tags = [] } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!name)  return { ok: false, error: "name required" };
    const dept = {
        deptId:      _uid("dept"),
        orgId,
        name:        name.slice(0, 200),
        description: description.slice(0, 500),
        headId,
        status:      "active",
        tags,
        createdAt:   _now(),
        updatedAt:   _now(),
        archivedAt:  null,
    };
    const all = _load(DEPTS_PATH);
    all.unshift(dept);
    _save(DEPTS_PATH, all, MAX_DEPTS);
    _audit({ orgId, actorId: headId || "system", actorName: headId || "system",
             action: "dept.created", resource: "department", resourceId: dept.deptId,
             outcome: "success", detail: `Department "${name}" created` });
    return dept;
}

function updateDept(deptId, patch = {}) {
    const all = _load(DEPTS_PATH);
    const idx = all.findIndex(d => d.deptId === deptId);
    if (idx === -1) return { ok: false, error: "dept_not_found" };
    const allowed = ["name","description","headId","status","tags"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(DEPTS_PATH, all, MAX_DEPTS);
    return { ok: true, dept: all[idx] };
}

function archiveDept(deptId) {
    const all = _load(DEPTS_PATH);
    const idx = all.findIndex(d => d.deptId === deptId);
    if (idx === -1) return { ok: false, error: "dept_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(DEPTS_PATH, all, MAX_DEPTS);
    return { ok: true, dept: all[idx] };
}

function getDept(deptId) {
    return _load(DEPTS_PATH).find(d => d.deptId === deptId) || null;
}

function listDepts({ orgId, status, limit = 50 } = {}) {
    let items = _load(DEPTS_PATH);
    if (orgId)  items = items.filter(d => d.orgId  === orgId);
    if (status) items = items.filter(d => d.status === status);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {string}  opts.orgId
 * @param {string}  opts.name
 * @param {string}  [opts.deptId]
 * @param {string}  [opts.description]
 * @param {string}  [opts.type]     "engineering"|"product"|"design"|"ops"|"sales"|"support"|"other"
 * @param {string[]} [opts.tags]
 */
function createTeam({ orgId, name, deptId, description = "", type = "other", tags = [] } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!name)  return { ok: false, error: "name required" };
    const team = {
        teamId:      _uid("team"),
        orgId,
        deptId:      deptId || null,
        name:        name.slice(0, 200),
        description: description.slice(0, 500),
        type,
        members:     [],
        status:      "active",
        tags,
        createdAt:   _now(),
        updatedAt:   _now(),
        archivedAt:  null,
    };
    const all = _load(TEAMS_PATH);
    all.unshift(team);
    _save(TEAMS_PATH, all, MAX_TEAMS);
    return team;
}

function updateTeam(teamId, patch = {}) {
    const all = _load(TEAMS_PATH);
    const idx = all.findIndex(t => t.teamId === teamId);
    if (idx === -1) return { ok: false, error: "team_not_found" };
    const allowed = ["name","description","deptId","type","status","tags"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(TEAMS_PATH, all, MAX_TEAMS);
    return { ok: true, team: all[idx] };
}

/**
 * Add a member to a team.
 * @param {string} teamId
 * @param {object} member  { memberId, name, email, role }
 */
function addMember(teamId, { memberId, name = "", email = "", role = "member" } = {}) {
    if (!memberId) return { ok: false, error: "memberId required" };
    const all = _load(TEAMS_PATH);
    const idx = all.findIndex(t => t.teamId === teamId);
    if (idx === -1) return { ok: false, error: "team_not_found" };
    if (all[idx].members.some(m => m.memberId === memberId)) {
        return { ok: false, error: "member_already_exists" };
    }
    all[idx].members.push({ memberId, name, email, role, joinedAt: _now() });
    all[idx].updatedAt = _now();
    _save(TEAMS_PATH, all, MAX_TEAMS);
    _audit({ orgId: all[idx].orgId, actorId: memberId, actorName: name,
             action: "team.member_added", resource: "team", resourceId: teamId,
             outcome: "success", detail: `${name || memberId} joined team` });
    return { ok: true, team: all[idx] };
}

function removeMember(teamId, memberId) {
    const all = _load(TEAMS_PATH);
    const idx = all.findIndex(t => t.teamId === teamId);
    if (idx === -1) return { ok: false, error: "team_not_found" };
    const before = all[idx].members.length;
    all[idx].members = all[idx].members.filter(m => m.memberId !== memberId);
    if (all[idx].members.length === before) return { ok: false, error: "member_not_found" };
    all[idx].updatedAt = _now();
    _save(TEAMS_PATH, all, MAX_TEAMS);
    _audit({ orgId: all[idx].orgId, actorId: memberId, actorName: memberId,
             action: "team.member_removed", resource: "team", resourceId: teamId,
             outcome: "success", detail: `Member ${memberId} removed from team` });
    return { ok: true, team: all[idx] };
}

function archiveTeam(teamId) {
    const all = _load(TEAMS_PATH);
    const idx = all.findIndex(t => t.teamId === teamId);
    if (idx === -1) return { ok: false, error: "team_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(TEAMS_PATH, all, MAX_TEAMS);
    return { ok: true, team: all[idx] };
}

function getTeam(teamId) {
    return _load(TEAMS_PATH).find(t => t.teamId === teamId) || null;
}

function listTeams({ orgId, deptId, status, type, limit = 50 } = {}) {
    let items = _load(TEAMS_PATH);
    if (orgId)  items = items.filter(t => t.orgId  === orgId);
    if (deptId) items = items.filter(t => t.deptId === deptId);
    if (status) items = items.filter(t => t.status === status);
    if (type)   items = items.filter(t => t.type   === type);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// ROLES
// ═══════════════════════════════════════════════════════════════════

/**
 * Define a role.
 * @param {object} opts
 * @param {string}  opts.orgId
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.scope]        "org"|"dept"|"team"|"global"
 * @param {string[]} [opts.permissions]  list of permission strings (e.g. "issues:write")
 * @param {boolean} [opts.isSystem]      true = built-in, not user-deletable
 */
function createRole({ orgId, name, description = "", scope = "org",
                       permissions = [], isSystem = false } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!name)  return { ok: false, error: "name required" };
    const role = {
        roleId:      _uid("role"),
        orgId,
        name:        name.slice(0, 100),
        description: description.slice(0, 500),
        scope,
        permissions,
        isSystem,
        status:      "active",   // active | deprecated
        createdAt:   _now(),
        updatedAt:   _now(),
        deprecatedAt: null,
    };
    const all = _load(ROLES_PATH);
    all.unshift(role);
    _save(ROLES_PATH, all, MAX_ROLES);
    return role;
}

function updateRole(roleId, patch = {}) {
    const all = _load(ROLES_PATH);
    const idx = all.findIndex(r => r.roleId === roleId);
    if (idx === -1) return { ok: false, error: "role_not_found" };
    if (all[idx].isSystem && patch.permissions !== undefined) {
        return { ok: false, error: "system_role_immutable" };
    }
    const allowed = ["name","description","scope","permissions"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(ROLES_PATH, all, MAX_ROLES);
    return { ok: true, role: all[idx] };
}

function deprecateRole(roleId) {
    const all = _load(ROLES_PATH);
    const idx = all.findIndex(r => r.roleId === roleId);
    if (idx === -1) return { ok: false, error: "role_not_found" };
    if (all[idx].isSystem) return { ok: false, error: "system_role_immutable" };
    all[idx].status       = "deprecated";
    all[idx].deprecatedAt = _now();
    all[idx].updatedAt    = _now();
    _save(ROLES_PATH, all, MAX_ROLES);
    return { ok: true, role: all[idx] };
}

function getRole(roleId) {
    return _load(ROLES_PATH).find(r => r.roleId === roleId) || null;
}

function listRoles({ orgId, scope, status, limit = 50 } = {}) {
    let items = _load(ROLES_PATH);
    if (orgId)  items = items.filter(r => r.orgId  === orgId);
    if (scope)  items = items.filter(r => r.scope  === scope);
    if (status) items = items.filter(r => r.status === status);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Grant permission to a member.
 * @param {object} opts
 * @param {string}  opts.orgId
 * @param {string}  opts.memberId
 * @param {string}  [opts.memberName]
 * @param {string}  opts.roleId
 * @param {string}  [opts.resource]    specific resource type or "*"
 * @param {string[]} [opts.actions]    ["read","write","delete","admin"] or ["*"]
 * @param {string}  [opts.grantedBy]
 * @param {string}  [opts.expiresAt]  ISO timestamp for expiry
 */
function grantPermission({ orgId, memberId, memberName = "", roleId, resource = "*",
                            actions = ["read"], grantedBy = "admin", expiresAt } = {}) {
    if (!orgId)    return { ok: false, error: "orgId required" };
    if (!memberId) return { ok: false, error: "memberId required" };
    if (!roleId)   return { ok: false, error: "roleId required" };
    const perm = {
        permId:     _uid("perm"),
        orgId,
        memberId,
        memberName,
        roleId,
        resource,
        actions,
        grantedBy,
        grantedAt:  _now(),
        expiresAt:  expiresAt || null,
        revokedAt:  null,
        revokedBy:  null,
        active:     true,
    };
    const all = _load(PERMS_PATH);
    all.unshift(perm);
    _save(PERMS_PATH, all, MAX_PERMS);
    _audit({ orgId, actorId: grantedBy, actorName: grantedBy,
             action: "permission.granted", resource, resourceId: memberId,
             outcome: "success", detail: `Role ${roleId} granted to ${memberName || memberId} on ${resource}` });
    return { ok: true, permission: perm };
}

function revokePermission(permId, { revokedBy = "admin" } = {}) {
    const all = _load(PERMS_PATH);
    const idx = all.findIndex(p => p.permId === permId);
    if (idx === -1) return { ok: false, error: "permission_not_found" };
    if (!all[idx].active) return { ok: false, error: "already_revoked" };
    all[idx].active    = false;
    all[idx].revokedAt = _now();
    all[idx].revokedBy = revokedBy;
    _save(PERMS_PATH, all, MAX_PERMS);
    _audit({ orgId: all[idx].orgId, actorId: revokedBy, actorName: revokedBy,
             action: "permission.revoked", resource: all[idx].resource, resourceId: all[idx].memberId,
             outcome: "success", detail: `Permission ${permId} revoked` });
    return { ok: true, permission: all[idx] };
}

function updatePermission(permId, patch = {}) {
    const all = _load(PERMS_PATH);
    const idx = all.findIndex(p => p.permId === permId);
    if (idx === -1) return { ok: false, error: "permission_not_found" };
    const allowed = ["actions","resource","expiresAt"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    _save(PERMS_PATH, all, MAX_PERMS);
    return { ok: true, permission: all[idx] };
}

function getPermission(permId) {
    return _load(PERMS_PATH).find(p => p.permId === permId) || null;
}

function listPermissions({ memberId, roleId, orgId, resource, active, limit = 50 } = {}) {
    let items = _load(PERMS_PATH);
    if (orgId)    items = items.filter(p => p.orgId    === orgId);
    if (memberId) items = items.filter(p => p.memberId === memberId);
    if (roleId)   items = items.filter(p => p.roleId   === roleId);
    if (resource) items = items.filter(p => p.resource === resource || p.resource === "*");
    if (active !== undefined) items = items.filter(p => p.active === active);
    // Exclude expired
    const now = _now();
    items = items.filter(p => !p.expiresAt || p.expiresAt > now);
    return items.slice(0, limit);
}

/**
 * Simple permission check: does memberId have `action` on `resource`?
 */
function checkPermission(memberId, resource, action) {
    const now = _now();
    const perms = _load(PERMS_PATH).filter(p =>
        p.memberId === memberId &&
        p.active &&
        (!p.expiresAt || p.expiresAt > now) &&
        (p.resource === "*" || p.resource === resource) &&
        (p.actions.includes("*") || p.actions.includes(action) || p.actions.includes("admin"))
    );
    return { allowed: perms.length > 0, matchedGrants: perms.length };
}

// ═══════════════════════════════════════════════════════════════════
// GOVERNANCE POLICIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a governance policy.
 * @param {object} opts
 * @param {string}  opts.orgId
 * @param {string}  opts.name
 * @param {string}  [opts.description]
 * @param {string}  [opts.type]        "access"|"data"|"security"|"compliance"|"operational"|"other"
 * @param {object[]} [opts.rules]       [{condition, action, severity}]
 * @param {string}  [opts.enforcement] "advisory"|"warn"|"block"
 */
function createPolicy({ orgId, name, description = "", type = "other",
                         rules = [], enforcement = "advisory" } = {}) {
    if (!orgId) return { ok: false, error: "orgId required" };
    if (!name)  return { ok: false, error: "name required" };
    const policy = {
        policyId:          _uid("pol"),
        orgId,
        name:              name.slice(0, 200),
        description:       description.slice(0, 1000),
        type,
        rules,
        enforcement,
        status:            "active",   // active | draft | archived
        createdAt:         _now(),
        updatedAt:         _now(),
        archivedAt:        null,
        lastEvaluatedAt:   null,
        lastViolation:     null,
        evaluationCount:   0,
        violationCount:    0,
    };
    const all = _load(POLICIES_PATH);
    all.unshift(policy);
    _save(POLICIES_PATH, all, MAX_POLICIES);
    _audit({ orgId, actorId: "system", actorName: "system",
             action: "policy.created", resource: "policy", resourceId: policy.policyId,
             outcome: "success", detail: `Policy "${name}" created (${type}, ${enforcement})` });
    return policy;
}

function updatePolicy(policyId, patch = {}) {
    const all = _load(POLICIES_PATH);
    const idx = all.findIndex(p => p.policyId === policyId);
    if (idx === -1) return { ok: false, error: "policy_not_found" };
    const allowed = ["name","description","type","rules","enforcement","status"];
    for (const k of allowed) {
        if (patch[k] !== undefined) all[idx][k] = patch[k];
    }
    all[idx].updatedAt = _now();
    _save(POLICIES_PATH, all, MAX_POLICIES);
    return { ok: true, policy: all[idx] };
}

/**
 * Evaluate a policy against a context object.
 * Context is matched against rule.condition strings (substring match).
 * Returns { passed, violations, enforcement }.
 */
function enforcePolicy(policyId, context = {}) {
    const all = _load(POLICIES_PATH);
    const idx = all.findIndex(p => p.policyId === policyId);
    if (idx === -1) return { ok: false, error: "policy_not_found" };

    const policy   = all[idx];
    const ctxStr   = JSON.stringify(context).toLowerCase();
    const violations = policy.rules.filter(r => {
        // A rule "fires" (violation) when its condition keyword is found in the context
        const cond = (r.condition || "").toLowerCase();
        return cond && ctxStr.includes(cond);
    });

    all[idx].lastEvaluatedAt = _now();
    all[idx].evaluationCount = (all[idx].evaluationCount || 0) + 1;

    const passed = violations.length === 0;
    if (!passed) {
        all[idx].violationCount = (all[idx].violationCount || 0) + 1;
        all[idx].lastViolation  = _now();
        _audit({ orgId: policy.orgId, actorId: "system", actorName: "system",
                 action: "policy.violation", resource: "policy", resourceId: policyId,
                 outcome: "violation", detail: `${violations.length} rule(s) triggered` });
    }
    _save(POLICIES_PATH, all, MAX_POLICIES);

    return {
        ok:          true,
        passed,
        violations,
        enforcement: policy.enforcement,
        blocked:     !passed && policy.enforcement === "block",
    };
}

function archivePolicy(policyId) {
    const all = _load(POLICIES_PATH);
    const idx = all.findIndex(p => p.policyId === policyId);
    if (idx === -1) return { ok: false, error: "policy_not_found" };
    all[idx].status     = "archived";
    all[idx].archivedAt = _now();
    all[idx].updatedAt  = _now();
    _save(POLICIES_PATH, all, MAX_POLICIES);
    return { ok: true, policy: all[idx] };
}

function getPolicy(policyId) {
    return _load(POLICIES_PATH).find(p => p.policyId === policyId) || null;
}

function listPolicies({ orgId, type, status, enforcement, limit = 50 } = {}) {
    let items = _load(POLICIES_PATH);
    if (orgId)       items = items.filter(p => p.orgId       === orgId);
    if (type)        items = items.filter(p => p.type        === type);
    if (status)      items = items.filter(p => p.status      === status);
    if (enforcement) items = items.filter(p => p.enforcement === enforcement);
    return items.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════════

/**
 * Internal append — called by other functions automatically.
 * External callers can also use logAuditEvent() directly.
 */
function _audit({ orgId = "", actorId = "", actorName = "", action = "",
                  resource = "", resourceId = "", outcome = "success",
                  detail = "", ip = "" } = {}) {
    const event = {
        eventId:    _uid("evt"),
        orgId,
        actorId,
        actorName,
        action,
        resource,
        resourceId,
        outcome,
        detail:     detail.slice(0, 500),
        ip,
        ts:         _now(),
    };
    const all = _load(AUDIT_PATH);
    all.unshift(event);   // newest first
    _save(AUDIT_PATH, all, MAX_AUDIT);
    return event;
}

function logAuditEvent(opts) {
    return _audit(opts);
}

function listAuditLog({ orgId, actorId, action, resource, outcome, dateFrom, dateTo, limit = 50 } = {}) {
    let items = _load(AUDIT_PATH);
    if (orgId)    items = items.filter(e => e.orgId    === orgId);
    if (actorId)  items = items.filter(e => e.actorId  === actorId);
    if (action)   items = items.filter(e => e.action   === action || e.action.startsWith(action));
    if (resource) items = items.filter(e => e.resource === resource);
    if (outcome)  items = items.filter(e => e.outcome  === outcome);
    if (dateFrom) items = items.filter(e => e.ts >= dateFrom);
    if (dateTo)   items = items.filter(e => e.ts <= dateTo);
    return items.slice(0, limit);
}

function getAuditStats({ orgId, dateFrom, dateTo } = {}) {
    let items = _load(AUDIT_PATH);
    if (orgId)    items = items.filter(e => e.orgId === orgId);
    if (dateFrom) items = items.filter(e => e.ts   >= dateFrom);
    if (dateTo)   items = items.filter(e => e.ts   <= dateTo);

    const byAction   = {};
    const byActor    = {};
    const byResource = {};
    const byOutcome  = {};

    for (const e of items) {
        byAction[e.action]     = (byAction[e.action]     || 0) + 1;
        byActor[e.actorId]     = (byActor[e.actorId]     || 0) + 1;
        byResource[e.resource] = (byResource[e.resource] || 0) + 1;
        byOutcome[e.outcome]   = (byOutcome[e.outcome]   || 0) + 1;
    }

    return { total: items.length, byAction, byActor, byResource, byOutcome };
}

// ═══════════════════════════════════════════════════════════════════
// COMPLIANCE SUMMARY
// ═══════════════════════════════════════════════════════════════════

function getComplianceSummary(orgId) {
    const policies   = listPolicies({ orgId, limit: 200 });
    const active     = policies.filter(p => p.status === "active");
    const withViol   = active.filter(p => p.violationCount > 0);
    const blockPols  = active.filter(p => p.enforcement === "block");
    const recentAudit= listAuditLog({ orgId, outcome: "violation", limit: 10 });

    const coverageTypes = [...new Set(active.map(p => p.type))];
    const missingTypes  = ["access","data","security","compliance","operational"].filter(t => !coverageTypes.includes(t));

    return {
        orgId,
        generatedAt:         _now(),
        totalPolicies:       policies.length,
        activePolicies:      active.length,
        policiesWithViolations: withViol.length,
        blockingPolicies:    blockPols.length,
        coverageTypes,
        missingCoverage:     missingTypes,
        recentViolations:    recentAudit.slice(0, 5),
        complianceScore:     active.length === 0 ? 0
            : Math.round((1 - withViol.length / active.length) * 100),
    };
}

// ═══════════════════════════════════════════════════════════════════
// ENTERPRISE DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function getEnterpriseDashboard() {
    const now = new Date().toISOString();

    const activeOrgs  = _load(ORGS_PATH).filter(o => o.status === "active");
    const activeDepts = _load(DEPTS_PATH).filter(d => d.status === "active");
    const activeTeams = _load(TEAMS_PATH).filter(t => t.status === "active");
    const totalMembers= activeTeams.reduce((s, t) => s + t.members.length, 0);

    const activeRoles = _load(ROLES_PATH).filter(r => r.status === "active");
    const activePerms = listPermissions({ active: true, limit: 5000 });

    // Policies
    const activePols  = _load(POLICIES_PATH).filter(p => p.status === "active");
    const violations  = activePols.filter(p => p.violationCount > 0);

    // Recent audit (last 10)
    const recentAudit = _load(AUDIT_PATH).slice(0, 10);

    // Goals (operational type)
    const ge       = _ge();
    const opGoals  = ge ? ge.listGoals({ type: "operational", status: "active", limit: 5 }) : [];
    const goalSum  = ge ? ge.getGoalSummary() : null;

    // Cross-OS stats
    const pos = _pos(); const bosStats = _bos(); const dosStats = _dos();
    const personalStats  = pos    ? pos.getStats()    : null;
    const businessStats  = bosStats ? bosStats.getStats()  : null;
    const developerStats = dosStats ? dosStats.getStats()  : null;

    // Lifecycle maturity
    const lifecycle = (_readJson("lifecycle-reports.json") || [])[0] || null;

    return {
        generatedAt: now,
        organization: {
            total:  _load(ORGS_PATH).length,
            active: activeOrgs.length,
            top:    activeOrgs.slice(0, 5),
        },
        departments: { total: _load(DEPTS_PATH).length, active: activeDepts.length },
        teams:        { total: _load(TEAMS_PATH).length, active: activeTeams.length, totalMembers },
        roles:        { total: activeRoles.length },
        permissions:  { active: activePerms.length },
        governance: {
            activePolicies:  activePols.length,
            violations:      violations.length,
            topViolated:     violations.sort((a,b) => b.violationCount - a.violationCount).slice(0, 3),
        },
        recentAudit,
        goals: {
            operational: opGoals.length,
            summary:     goalSum,
            top:         opGoals.slice(0, 3),
        },
        ecosystem: {
            personal:  personalStats,
            business:  businessStats,
            developer: developerStats,
        },
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

    const newOrgs    = _load(ORGS_PATH).filter(o => o.createdAt >= dayStart && o.createdAt <= dayEnd);
    const newTeams   = _load(TEAMS_PATH).filter(t => t.createdAt >= dayStart && t.createdAt <= dayEnd);
    const newPerms   = _load(PERMS_PATH).filter(p => p.grantedAt >= dayStart && p.grantedAt <= dayEnd);
    const auditToday = _load(AUDIT_PATH).filter(e => e.ts >= dayStart && e.ts <= dayEnd);
    const violations = auditToday.filter(e => e.outcome === "violation");

    const ge       = _ge();
    const opGoals  = ge ? ge.listGoals({ type: "operational", status: "active", limit: 10 }) : [];

    const highlights = [];
    if (newOrgs.length)    highlights.push(`${newOrgs.length} new organization(s)`);
    if (newTeams.length)   highlights.push(`${newTeams.length} new team(s)`);
    if (newPerms.length)   highlights.push(`${newPerms.length} permission(s) granted`);
    if (auditToday.length) highlights.push(`${auditToday.length} audit event(s) logged`);
    if (violations.length) highlights.push(`${violations.length} policy violation(s)`);
    if (opGoals.length)    highlights.push(`${opGoals.length} active operational goal(s)`);

    return {
        date:              target,
        generatedAt:       _now(),
        newOrgs:           newOrgs.length,
        newTeams:          newTeams.length,
        permissionsGranted:newPerms.length,
        auditEvents:       auditToday.length,
        violations:        violations.length,
        operationalGoals:  opGoals.length,
        goalList:          opGoals.slice(0, 3).map(g => ({ goalId: g.goalId, title: g.title, completionPct: g.completionPct })),
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

    const newOrgs    = _load(ORGS_PATH).filter(o => o.createdAt >= ws && o.createdAt < we);
    const newTeams   = _load(TEAMS_PATH).filter(t => t.createdAt >= ws && t.createdAt < we);
    const newPerms   = _load(PERMS_PATH).filter(p => p.grantedAt >= ws && p.grantedAt < we);
    const revPerms   = _load(PERMS_PATH).filter(p => p.revokedAt && p.revokedAt >= ws && p.revokedAt < we);
    const auditWeek  = _load(AUDIT_PATH).filter(e => e.ts >= ws && e.ts < we);
    const violations = auditWeek.filter(e => e.outcome === "violation");

    const ge        = _ge();
    const allGoals  = ge ? ge.listGoals({ limit: 50 }) : [];
    const goalsWon  = allGoals.filter(g =>
        g.type === "operational" && g.status === "completed" &&
        g.completedAt >= ws && g.completedAt < we
    );

    // Audit action breakdown
    const topActions = {};
    for (const e of auditWeek) {
        topActions[e.action] = (topActions[e.action] || 0) + 1;
    }
    const sortedActions = Object.entries(topActions)
        .sort(([,a],[,b]) => b - a).slice(0, 5)
        .map(([action, count]) => ({ action, count }));

    const highlights = [];
    if (newOrgs.length)    highlights.push(`${newOrgs.length} new organization(s)`);
    if (newTeams.length)   highlights.push(`${newTeams.length} new team(s)`);
    if (newPerms.length)   highlights.push(`${newPerms.length} permission grant(s)`);
    if (revPerms.length)   highlights.push(`${revPerms.length} permission revocation(s)`);
    if (violations.length) highlights.push(`${violations.length} policy violation(s)`);
    if (goalsWon.length)   highlights.push(`${goalsWon.length} operational goal(s) achieved`);

    return {
        weekStart:          start.toISOString().slice(0, 10),
        weekEnd:            end.toISOString().slice(0, 10),
        generatedAt:        _now(),
        newOrgs:            newOrgs.length,
        newTeams:           newTeams.length,
        permissionsGranted: newPerms.length,
        permissionsRevoked: revPerms.length,
        auditEvents:        auditWeek.length,
        violations:         violations.length,
        goalsAchieved:      goalsWon.length,
        topAuditActions:    sortedActions,
        highlights,
    };
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-STORE SEARCH
// ═══════════════════════════════════════════════════════════════════

function searchEnterprise(query, { limit = 20 } = {}) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];

    const orgHits  = _load(ORGS_PATH).filter(o => o.status !== "archived")
        .filter(o => o.name.toLowerCase().includes(q) || o.description.toLowerCase().includes(q))
        .slice(0, 3).map(o => ({ type: "org",    id: o.orgId,    title: o.name }));

    const deptHits = _load(DEPTS_PATH).filter(d => d.status !== "archived")
        .filter(d => d.name.toLowerCase().includes(q))
        .slice(0, 3).map(d => ({ type: "dept",   id: d.deptId,   title: d.name, orgId: d.orgId }));

    const teamHits = _load(TEAMS_PATH).filter(t => t.status !== "archived")
        .filter(t => t.name.toLowerCase().includes(q))
        .slice(0, 3).map(t => ({ type: "team",   id: t.teamId,   title: t.name, orgId: t.orgId }));

    const polHits  = _load(POLICIES_PATH).filter(p => p.status !== "archived")
        .filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
        .slice(0, 3).map(p => ({ type: "policy", id: p.policyId, title: p.name, enforcement: p.enforcement }));

    results.push(...orgHits, ...deptHits, ...teamHits, ...polHits);

    // Cross-namespace via UME
    const ume = _ume();
    if (ume) {
        try {
            const umeResults = ume.search(query, { limit: limit - results.length });
            results.push(...umeResults.map(r => ({ type: r.type, id: r.entityId, title: r.title, ns: r.ns })));
        } catch { /* non-fatal */ }
    }

    return results.slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────

function getStats() {
    return {
        orgs:       _load(ORGS_PATH).filter(o => o.status !== "archived").length,
        depts:      _load(DEPTS_PATH).filter(d => d.status !== "archived").length,
        teams:      _load(TEAMS_PATH).filter(t => t.status !== "archived").length,
        roles:      _load(ROLES_PATH).filter(r => r.status === "active").length,
        permissions:_load(PERMS_PATH).filter(p => p.active).length,
        policies:   _load(POLICIES_PATH).filter(p => p.status === "active").length,
        auditEvents:_load(AUDIT_PATH).length,
    };
}

module.exports = {
    // Orgs
    createOrg, updateOrg, archiveOrg, getOrg, listOrgs,
    // Depts
    createDept, updateDept, archiveDept, getDept, listDepts,
    // Teams
    createTeam, updateTeam, addMember, removeMember, archiveTeam, getTeam, listTeams,
    // Roles
    createRole, updateRole, deprecateRole, getRole, listRoles,
    // Permissions
    grantPermission, revokePermission, updatePermission, getPermission, listPermissions, checkPermission,
    // Policies
    createPolicy, updatePolicy, enforcePolicy, archivePolicy, getPolicy, listPolicies,
    // Audit
    logAuditEvent, listAuditLog, getAuditStats,
    // Compliance
    getComplianceSummary,
    // Dashboard & Summaries
    getEnterpriseDashboard, getDailySummary, getWeeklySummary,
    // Search & Stats
    searchEnterprise, getStats,
};
