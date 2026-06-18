"use strict";
/**
 * organizationService.cjs — Phase M1: Organization Operating System Foundation
 *
 * Introduces Organizations as first-class citizens. Everything becomes org-aware.
 * Reuses:
 *   authMiddleware.cjs        → req.user.sub (account id), req.user.role
 *   workspaceService.cjs      → workspace → org mapping, member roles
 *   missionMemory.cjs         → mission metadata.orgId, teamId, deptId, ownerId
 *   continuousLearningEngine  → lesson recording
 *   operationsAlertingLayer   → notifications
 *
 * No duplicate user management. No duplicate permission engine.
 * No duplicate mission runtime.
 *
 * Hierarchy:
 *   Organization
 *     └─ Department(s)
 *          └─ Team(s)
 *               └─ Member(s)  [accountId + orgRole]
 *
 * RBAC roles (org-level, coarser than workspace roles):
 *   org_owner     — full control, can delete org, manage billing
 *   org_admin     — manage members, departments, teams; cannot delete org
 *   dept_lead     — manage their department and its teams
 *   team_lead     — manage their team members
 *   member        — create missions, work on tasks
 *   viewer        — read-only
 *
 * Storage: data/organizations.json
 *
 * Public API:
 *   createOrg(data, creatorAccountId)
 *   getOrg(orgId)
 *   listOrgs(accountId?)
 *   updateOrg(orgId, patch, requestingAccountId)
 *   deleteOrg(orgId, requestingAccountId)
 *
 *   addMember(orgId, { accountId, orgRole, deptId?, teamId? }, requestingAccountId)
 *   removeMember(orgId, accountId, requestingAccountId)
 *   updateMemberRole(orgId, accountId, newRole, requestingAccountId)
 *   listMembers(orgId, opts?)
 *   getMemberRole(orgId, accountId)
 *   hasPermission(orgId, accountId, action)
 *
 *   createDepartment(orgId, { name, description }, requestingAccountId)
 *   updateDepartment(orgId, deptId, patch, requestingAccountId)
 *   deleteDepartment(orgId, deptId, requestingAccountId)
 *   listDepartments(orgId)
 *
 *   createTeam(orgId, deptId, { name, description }, requestingAccountId)
 *   updateTeam(orgId, deptId, teamId, patch, requestingAccountId)
 *   deleteTeam(orgId, deptId, teamId, requestingAccountId)
 *   listTeams(orgId, deptId?)
 *   addTeamMember(orgId, deptId, teamId, accountId, requestingAccountId)
 *   removeTeamMember(orgId, deptId, teamId, accountId, requestingAccountId)
 *
 *   createMissionForOrg(orgId, missionData, requestingAccountId)
 *   listOrgMissions(orgId, opts?)
 *   assertMissionOwnership(missionId, accountId, orgId)
 *
 *   ORG_ROLES, ROLE_HIERARCHY, ACTIONS
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// ── Storage ───────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, "../../data");
const ORG_FILE  = path.join(DATA_DIR, "organizations.json");

function _read() {
    try { return JSON.parse(fs.readFileSync(ORG_FILE, "utf8")); }
    catch { return { orgs: [] }; }
}
function _write(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ORG_FILE, JSON.stringify(store, null, 2));
}

// ── ID helpers ────────────────────────────────────────────────────────────────
let _seq = 0;
function _id(prefix) { return `${prefix}_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Lazy loaders ──────────────────────────────────────────────────────────────
function _mm()    { try { return require("./missionMemory.cjs");           } catch { return null; } }
function _le()    { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _alert() { try { return require("./operationsAlertingLayer.cjs");  } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────────
// RBAC MODEL
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ROLES = ["org_owner", "org_admin", "dept_lead", "team_lead", "member", "viewer"];

// Lower index = higher privilege
const ROLE_HIERARCHY = {
    org_owner:  0,
    org_admin:  1,
    dept_lead:  2,
    team_lead:  3,
    member:     4,
    viewer:     5,
};

// What each role can do
const ACTIONS = {
    // Org-level
    delete_org:          ["org_owner"],
    update_org:          ["org_owner", "org_admin"],
    manage_members:      ["org_owner", "org_admin"],
    view_members:        ["org_owner", "org_admin", "dept_lead", "team_lead", "member", "viewer"],
    // Departments
    manage_departments:  ["org_owner", "org_admin"],
    view_departments:    ["org_owner", "org_admin", "dept_lead", "team_lead", "member", "viewer"],
    // Teams
    manage_teams:        ["org_owner", "org_admin", "dept_lead"],
    manage_own_team:     ["org_owner", "org_admin", "dept_lead", "team_lead"],
    view_teams:          ["org_owner", "org_admin", "dept_lead", "team_lead", "member", "viewer"],
    // Missions
    create_mission:      ["org_owner", "org_admin", "dept_lead", "team_lead", "member"],
    view_missions:       ["org_owner", "org_admin", "dept_lead", "team_lead", "member", "viewer"],
    assign_mission:      ["org_owner", "org_admin", "dept_lead", "team_lead"],
    // Billing / settings
    manage_billing:      ["org_owner"],
    view_analytics:      ["org_owner", "org_admin", "dept_lead"],
};

function hasPermission(orgId, accountId, action) {
    const role = getMemberRole(orgId, accountId);
    if (!role) return false;
    const allowed = ACTIONS[action];
    if (!allowed) return false;
    return allowed.includes(role);
}

function _assertPermission(orgId, accountId, action) {
    if (!hasPermission(orgId, accountId, action)) {
        throw Object.assign(new Error(`Forbidden — requires permission: ${action}`), { status: 403 });
    }
}

function _assertRoleAtLeast(orgId, accountId, minRole) {
    const role = getMemberRole(orgId, accountId);
    if (!role) throw Object.assign(new Error("Not a member of this organization"), { status: 403 });
    if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[minRole]) {
        throw Object.assign(new Error(`Requires ${minRole} or higher`), { status: 403 });
    }
}

// ── Sanitize for API responses ────────────────────────────────────────────────
function _sanitize(org) {
    if (!org) return null;
    return {
        id:           org.id,
        name:         org.name,
        description:  org.description || "",
        slug:         org.slug,
        plan:         org.plan || "free",
        createdAt:    org.createdAt,
        updatedAt:    org.updatedAt,
        memberCount:  (org.members || []).length,
        deptCount:    (org.departments || []).length,
    };
}

function _findOrg(store, orgId) {
    return store.orgs.find(o => o.id === orgId) || null;
}

function _slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZATION CRUD
// ─────────────────────────────────────────────────────────────────────────────

function createOrg({ name, description = "", plan = "free" }, creatorAccountId) {
    if (!name?.trim()) throw new Error("name is required");
    if (!creatorAccountId) throw new Error("creatorAccountId is required");

    const store = _read();
    const slug  = _slugify(name);
    if (store.orgs.find(o => o.slug === slug)) {
        throw Object.assign(new Error(`Organization with slug "${slug}" already exists`), { status: 409 });
    }

    const org = {
        id:          _id("org"),
        name:        name.trim(),
        description,
        slug,
        plan,
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        members:     [{ accountId: creatorAccountId, orgRole: "org_owner", joinedAt: new Date().toISOString() }],
        departments: [],
        settings:    {},
    };
    store.orgs.push(org);
    _write(store);

    try { _le()?.createLesson({ type: "org_created", title: `Org created: ${name}`, source: "organizationService" }); } catch {}
    logger.info(`[OrgService] Created org ${org.id}: ${name} (owner: ${creatorAccountId})`);
    return { ..._sanitize(org), members: org.members };
}

function getOrg(orgId) {
    if (!orgId) throw new Error("orgId required");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) return null;
    return { ..._sanitize(org), departments: org.departments, members: org.members };
}

function listOrgs(accountId) {
    const store = _read();
    const orgs  = accountId
        ? store.orgs.filter(o => o.members?.some(m => m.accountId === accountId))
        : store.orgs;
    return { orgs: orgs.map(_sanitize), total: orgs.length };
}

function updateOrg(orgId, patch, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "update_org");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    if (patch.name)        org.name        = patch.name.trim();
    if (patch.description !== undefined) org.description = patch.description;
    if (patch.plan)        org.plan        = patch.plan;
    if (patch.settings)    org.settings    = { ...org.settings, ...patch.settings };
    org.updatedAt = new Date().toISOString();
    _write(store);
    return _sanitize(org);
}

function deleteOrg(orgId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "delete_org");
    const store = _read();
    const idx   = store.orgs.findIndex(o => o.id === orgId);
    if (idx < 0) throw Object.assign(new Error("Organization not found"), { status: 404 });
    store.orgs.splice(idx, 1);
    _write(store);
    logger.info(`[OrgService] Deleted org ${orgId} by ${requestingAccountId}`);
    return { deleted: true, orgId };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMBERSHIP
// ─────────────────────────────────────────────────────────────────────────────

function getMemberRole(orgId, accountId) {
    if (!orgId || !accountId) return null;
    try {
        const store = _read();
        const org   = _findOrg(store, orgId);
        if (!org) return null;
        const m = org.members?.find(m => m.accountId === accountId);
        return m?.orgRole || null;
    } catch { return null; }
}

function listMembers(orgId, { deptId, teamId } = {}) {
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    let members = org.members || [];
    if (deptId) members = members.filter(m => m.deptId === deptId);
    if (teamId) members = members.filter(m => m.teamId === teamId);
    return { members, total: members.length };
}

function addMember(orgId, { accountId, orgRole = "member", deptId, teamId }, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_members");
    if (!ORG_ROLES.includes(orgRole)) throw new Error(`Invalid orgRole: ${orgRole}`);
    if (orgRole === "org_owner") throw new Error("Cannot assign org_owner via addMember — transfer ownership instead");

    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    if (org.members.find(m => m.accountId === accountId)) {
        throw Object.assign(new Error("Account is already a member"), { status: 409 });
    }
    org.members.push({ accountId, orgRole, deptId: deptId || null, teamId: teamId || null, joinedAt: new Date().toISOString() });
    org.updatedAt = new Date().toISOString();
    _write(store);
    logger.info(`[OrgService] Added member ${accountId} to org ${orgId} as ${orgRole}`);
    return { added: true, accountId, orgRole };
}

function removeMember(orgId, accountId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_members");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const target = org.members.find(m => m.accountId === accountId);
    if (!target) throw Object.assign(new Error("Member not found"), { status: 404 });
    if (target.orgRole === "org_owner") throw new Error("Cannot remove the org owner — transfer ownership first");
    org.members = org.members.filter(m => m.accountId !== accountId);
    org.updatedAt = new Date().toISOString();
    _write(store);
    return { removed: true, accountId };
}

function updateMemberRole(orgId, accountId, newRole, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_members");
    if (!ORG_ROLES.includes(newRole)) throw new Error(`Invalid orgRole: ${newRole}`);
    if (newRole === "org_owner") throw new Error("Use transferOwnership to assign org_owner");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const m = org.members.find(m => m.accountId === accountId);
    if (!m) throw Object.assign(new Error("Member not found"), { status: 404 });
    m.orgRole   = newRole;
    org.updatedAt = new Date().toISOString();
    _write(store);
    return { updated: true, accountId, orgRole: newRole };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPARTMENTS
// ─────────────────────────────────────────────────────────────────────────────

function createDepartment(orgId, { name, description = "", leadAccountId }, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_departments");
    if (!name?.trim()) throw new Error("Department name is required");

    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });

    const dept = {
        id:            _id("dept"),
        name:          name.trim(),
        description,
        leadAccountId: leadAccountId || null,
        createdAt:     new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
        teams:         [],
    };
    if (!org.departments) org.departments = [];
    org.departments.push(dept);
    org.updatedAt = new Date().toISOString();
    _write(store);
    logger.info(`[OrgService] Created dept ${dept.id} in org ${orgId}`);
    return { ...dept };
}

function updateDepartment(orgId, deptId, patch, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_departments");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const dept  = org.departments?.find(d => d.id === deptId);
    if (!dept) throw Object.assign(new Error("Department not found"), { status: 404 });
    if (patch.name)        dept.name        = patch.name.trim();
    if (patch.description !== undefined) dept.description = patch.description;
    if (patch.leadAccountId !== undefined) dept.leadAccountId = patch.leadAccountId;
    dept.updatedAt = new Date().toISOString();
    org.updatedAt  = new Date().toISOString();
    _write(store);
    return { ...dept };
}

function deleteDepartment(orgId, deptId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_departments");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const idx   = (org.departments || []).findIndex(d => d.id === deptId);
    if (idx < 0) throw Object.assign(new Error("Department not found"), { status: 404 });
    org.departments.splice(idx, 1);
    org.updatedAt = new Date().toISOString();
    _write(store);
    return { deleted: true, deptId };
}

function listDepartments(orgId) {
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    return { departments: org.departments || [], total: (org.departments || []).length };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS
// ─────────────────────────────────────────────────────────────────────────────

function _findDept(org, deptId) {
    return (org.departments || []).find(d => d.id === deptId) || null;
}

function createTeam(orgId, deptId, { name, description = "", leadAccountId }, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_teams");
    if (!name?.trim()) throw new Error("Team name is required");

    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const dept  = _findDept(org, deptId);
    if (!dept) throw Object.assign(new Error("Department not found"), { status: 404 });

    const team = {
        id:            _id("team"),
        name:          name.trim(),
        description,
        leadAccountId: leadAccountId || null,
        createdAt:     new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
        memberIds:     [],
    };
    if (!dept.teams) dept.teams = [];
    dept.teams.push(team);
    org.updatedAt = new Date().toISOString();
    _write(store);
    logger.info(`[OrgService] Created team ${team.id} in dept ${deptId} org ${orgId}`);
    return { ...team };
}

function updateTeam(orgId, deptId, teamId, patch, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_own_team");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const dept  = _findDept(org, deptId);
    if (!dept) throw Object.assign(new Error("Department not found"), { status: 404 });
    const team  = (dept.teams || []).find(t => t.id === teamId);
    if (!team) throw Object.assign(new Error("Team not found"), { status: 404 });
    if (patch.name)        team.name        = patch.name.trim();
    if (patch.description !== undefined) team.description = patch.description;
    if (patch.leadAccountId !== undefined) team.leadAccountId = patch.leadAccountId;
    team.updatedAt = new Date().toISOString();
    org.updatedAt  = new Date().toISOString();
    _write(store);
    return { ...team };
}

function deleteTeam(orgId, deptId, teamId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_teams");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const dept  = _findDept(org, deptId);
    if (!dept) throw Object.assign(new Error("Department not found"), { status: 404 });
    const idx   = (dept.teams || []).findIndex(t => t.id === teamId);
    if (idx < 0) throw Object.assign(new Error("Team not found"), { status: 404 });
    dept.teams.splice(idx, 1);
    org.updatedAt = new Date().toISOString();
    _write(store);
    return { deleted: true, teamId };
}

function listTeams(orgId, deptId) {
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    if (deptId) {
        const dept = _findDept(org, deptId);
        if (!dept) throw Object.assign(new Error("Department not found"), { status: 404 });
        return { teams: dept.teams || [], total: (dept.teams || []).length };
    }
    // All teams across all departments
    const all = (org.departments || []).flatMap(d => (d.teams || []).map(t => ({ ...t, deptId: d.id, deptName: d.name })));
    return { teams: all, total: all.length };
}

function addTeamMember(orgId, deptId, teamId, accountId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_own_team");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const dept  = _findDept(org, deptId);
    const team  = (dept?.teams || []).find(t => t.id === teamId);
    if (!team) throw Object.assign(new Error("Team not found"), { status: 404 });
    if (!team.memberIds) team.memberIds = [];
    if (team.memberIds.includes(accountId)) throw Object.assign(new Error("Already a team member"), { status: 409 });
    team.memberIds.push(accountId);
    org.updatedAt = new Date().toISOString();
    _write(store);
    return { added: true, accountId, teamId };
}

function removeTeamMember(orgId, deptId, teamId, accountId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_own_team");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const dept  = _findDept(org, deptId);
    const team  = (dept?.teams || []).find(t => t.id === teamId);
    if (!team) throw Object.assign(new Error("Team not found"), { status: 404 });
    team.memberIds = (team.memberIds || []).filter(id => id !== accountId);
    org.updatedAt  = new Date().toISOString();
    _write(store);
    return { removed: true, accountId, teamId };
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSION OWNERSHIP
// Missions already stored in missionMemory.cjs — we stamp org ownership via
// metadata: { orgId, deptId, teamId, ownerId } on creation.
// No data duplication — org is the lens on top of mission data.
// ─────────────────────────────────────────────────────────────────────────────

function createMissionForOrg(orgId, missionData, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "create_mission");
    const mm = _mm();
    if (!mm) throw new Error("missionMemory unavailable");

    const mission = mm.createMission({
        ...missionData,
        metadata: {
            ...missionData.metadata,
            orgId,
            deptId:  missionData.deptId  || missionData.metadata?.deptId  || null,
            teamId:  missionData.teamId  || missionData.metadata?.teamId  || null,
            ownerId: missionData.ownerId || missionData.metadata?.ownerId || requestingAccountId,
            domain:  missionData.metadata?.domain || "org",
        },
    });

    try {
        _le()?.createLesson({ type: "org_mission_created", title: `[Org] Mission: ${missionData.objective?.slice(0, 60)}`, source: "organizationService" });
    } catch {}

    logger.info(`[OrgService] Mission ${mission.id} created for org ${orgId} by ${requestingAccountId}`);
    return mission;
}

function listOrgMissions(orgId, opts = {}) {
    const mm = _mm();
    if (!mm) throw new Error("missionMemory unavailable");
    const all = mm.listMissions({ limit: 1000, ...opts });
    const filtered = (all.missions || []).filter(m => m.metadata?.orgId === orgId);
    if (opts.deptId) return { missions: filtered.filter(m => m.metadata?.deptId === opts.deptId), total: filtered.length };
    if (opts.teamId) return { missions: filtered.filter(m => m.metadata?.teamId === opts.teamId), total: filtered.length };
    if (opts.ownerId) return { missions: filtered.filter(m => m.metadata?.ownerId === opts.ownerId), total: filtered.length };
    return { missions: filtered.slice(0, opts.limit || 100), total: filtered.length };
}

function assertMissionOwnership(missionId, accountId, orgId) {
    const mm = _mm();
    const mission = mm?.getMission(missionId);
    if (!mission) throw Object.assign(new Error("Mission not found"), { status: 404 });
    if (orgId && mission.metadata?.orgId !== orgId) {
        throw Object.assign(new Error("Mission does not belong to this organization"), { status: 403 });
    }
    const isOwner = mission.metadata?.ownerId === accountId;
    const role    = getMemberRole(orgId, accountId);
    const canManage = role && ["org_owner", "org_admin", "dept_lead"].includes(role);
    if (!isOwner && !canManage) {
        throw Object.assign(new Error("You do not own this mission and lack sufficient role"), { status: 403 });
    }
    return { owned: true, role };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT RESOLVER — given accountId, resolve all orgs/depts/teams they're in
// ─────────────────────────────────────────────────────────────────────────────

function resolveContext(accountId) {
    if (!accountId) return { orgs: [], primaryOrg: null };
    const store = _read();
    const result = [];

    for (const org of store.orgs) {
        const m = (org.members || []).find(m => m.accountId === accountId);
        if (!m) continue;

        // Find their teams
        const myTeams = [];
        for (const dept of org.departments || []) {
            for (const team of dept.teams || []) {
                if ((team.memberIds || []).includes(accountId)) {
                    myTeams.push({ teamId: team.id, teamName: team.name, deptId: dept.id, deptName: dept.name });
                }
            }
        }

        result.push({
            orgId:   org.id,
            orgName: org.name,
            orgRole: m.orgRole,
            deptId:  m.deptId || null,
            teamId:  m.teamId || null,
            teams:   myTeams,
            permissions: Object.keys(ACTIONS).filter(a => hasPermission(org.id, accountId, a)),
        });
    }

    return { orgs: result, primaryOrg: result[0] || null };
}

module.exports = {
    // Org CRUD
    createOrg,
    getOrg,
    listOrgs,
    updateOrg,
    deleteOrg,
    // Members
    addMember,
    removeMember,
    updateMemberRole,
    listMembers,
    getMemberRole,
    hasPermission,
    resolveContext,
    // Departments
    createDepartment,
    updateDepartment,
    deleteDepartment,
    listDepartments,
    // Teams
    createTeam,
    updateTeam,
    deleteTeam,
    listTeams,
    addTeamMember,
    removeTeamMember,
    // Missions
    createMissionForOrg,
    listOrgMissions,
    assertMissionOwnership,
    // RBAC constants
    ORG_ROLES,
    ROLE_HIERARCHY,
    ACTIONS,
};
