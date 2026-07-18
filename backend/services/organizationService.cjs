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
// Per-account "which org am I currently working in" preference. Deliberately a
// separate small store, not a field on the org record or the account record —
// it's neither org data (many accounts, one org) nor identity data (one account,
// many orgs); it's the N:M join's per-account cursor. Keyed by accountId so two
// concurrent users never see or affect each other's selection (see CONTEXT_FILE
// below for the same fix applied to the pre-existing global-pointer bug).
const CONTEXT_FILE = path.join(DATA_DIR, "org-context.json");
// Explicit cross-org access grants (Module 6). A grant lets one account act
// within an org it is NOT a member of, without joining the org's member list
// or department/team hierarchy — e.g. an agency account viewing a client org's
// missions. Distinct from org membership on purpose: grants are narrower
// (a fixed permission list, optionally time-boxed) and don't show up in
// listMembers/org headcount.
const GRANTS_FILE = path.join(DATA_DIR, "org-grants.json");

function _read() {
    try { return JSON.parse(fs.readFileSync(ORG_FILE, "utf8")); }
    catch { return { orgs: [] }; }
}
function _write(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ORG_FILE, JSON.stringify(store, null, 2));
}

function _readContext() {
    try { return JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf8")); }
    catch { return {}; }
}
function _writeContext(map) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONTEXT_FILE, JSON.stringify(map, null, 2));
}

function _readGrants() {
    try { return JSON.parse(fs.readFileSync(GRANTS_FILE, "utf8")); }
    catch { return { grants: [] }; }
}
function _writeGrants(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(GRANTS_FILE, JSON.stringify(store, null, 2));
}

// ── ID helpers ────────────────────────────────────────────────────────────────
let _seq = 0;
function _id(prefix) { return `${prefix}_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Lazy loaders ──────────────────────────────────────────────────────────────
function _mm()      { try { return require("./missionMemory.cjs");           } catch { return null; } }
function _le()      { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _alert()   { try { return require("./operationsAlertingLayer.cjs");  } catch { return null; } }
function _billing() { try { return require("./billingService.js");           } catch { return null; } }
function _accounts() { try { return require("./accountService.js");          } catch { return null; } }

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
    // Enterprise — SSO/SCIM/policy control who can even reach this org, so
    // these are org_owner-only, same bar as delete_org/manage_billing.
    manage_sso:          ["org_owner"],
    manage_scim:         ["org_owner"],
    manage_policy:       ["org_owner"],
    view_audit_log:      ["org_owner", "org_admin"],
};

// ── Global (platform-level) roles — Module 6 ───────────────────────────────────
// Distinct from ORG_ROLES: these are account-level, not org-membership-level,
// and stored on the account record itself (accountService's free-form `role`
// field), not inside any org. Recognized values beyond the pre-existing
// "operator"/"user":
//   enterprise_admin — full implicit access to every org and every action, for
//                      platform operations. Never needs a grant.
//   portfolio_owner  — no implicit access by itself; it's the conventional
//                      label for accounts that hold cross-org grants (below).
//                      Kept as an account role (rather than just "anyone with
//                      a grant") so the UI/reporting can identify these users.
const GLOBAL_ROLES = ["enterprise_admin", "portfolio_owner"];

function _globalRole(accountId) {
    if (!accountId) return null;
    try {
        const acc = _accounts()?.getById(accountId);
        return (acc && GLOBAL_ROLES.includes(acc.role)) ? acc.role : null;
    } catch { return null; }
}

function isEnterpriseAdmin(accountId) {
    return _globalRole(accountId) === "enterprise_admin";
}

// ── Cross-org grants — Module 6 ─────────────────────────────────────────────────
// A grant gives one account a fixed set of ACTIONS-keys within one org, without
// making them a member (they won't appear in listMembers, headcount, or team
// rosters). Used for cross-org access like a portfolio owner or agency account
// viewing/managing a client org they don't belong to.
function grantOrgAccess(orgId, granteeAccountId, permissions, requestingAccountId) {
    if (!orgId) throw new Error("orgId required");
    if (!granteeAccountId) throw new Error("granteeAccountId required");
    if (!Array.isArray(permissions) || !permissions.length) throw new Error("permissions must be a non-empty array");
    const unknown = permissions.filter(p => !ACTIONS[p]);
    if (unknown.length) throw new Error(`Unknown permission(s): ${unknown.join(", ")}`);

    // Only an org_owner of the target org, or a global enterprise_admin, may grant access to it.
    if (!isEnterpriseAdmin(requestingAccountId)) {
        _assertPermission(orgId, requestingAccountId, "delete_org"); // org_owner-only action, reused as the "owns this org" check
    }
    const store = _read();
    if (!_findOrg(store, orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });

    const grants = _readGrants();
    const existing = grants.grants.find(g => g.orgId === orgId && g.granteeAccountId === granteeAccountId);
    const record = existing || {
        id:        _id("grant"),
        orgId,
        granteeAccountId,
        grantedBy: requestingAccountId,
        grantedAt: new Date().toISOString(),
    };
    record.permissions = permissions;
    record.updatedAt   = new Date().toISOString();
    if (!existing) grants.grants.push(record);
    _writeGrants(grants);

    logger.info(`[OrgService] Granted ${granteeAccountId} [${permissions.join(",")}] on org ${orgId} by ${requestingAccountId}`);
    return record;
}

function revokeOrgAccess(orgId, granteeAccountId, requestingAccountId) {
    if (!isEnterpriseAdmin(requestingAccountId)) {
        _assertPermission(orgId, requestingAccountId, "delete_org");
    }
    const grants = _readGrants();
    const before  = grants.grants.length;
    grants.grants = grants.grants.filter(g => !(g.orgId === orgId && g.granteeAccountId === granteeAccountId));
    _writeGrants(grants);
    logger.info(`[OrgService] Revoked grant for ${granteeAccountId} on org ${orgId} by ${requestingAccountId}`);
    return { revoked: before !== grants.grants.length, orgId, granteeAccountId };
}

function listOrgGrants(orgId) {
    const grants = _readGrants();
    return grants.grants.filter(g => g.orgId === orgId);
}

function listGrantsForAccount(accountId) {
    const grants = _readGrants();
    return grants.grants.filter(g => g.granteeAccountId === accountId);
}

function _grantedPermissions(orgId, accountId) {
    if (!orgId || !accountId) return [];
    const grants = _readGrants();
    const g = grants.grants.find(x => x.orgId === orgId && x.granteeAccountId === accountId);
    if (!g) return [];
    if (g.expiresAt && new Date(g.expiresAt).getTime() < Date.now()) return [];
    return g.permissions || [];
}

function hasPermission(orgId, accountId, action) {
    if (isEnterpriseAdmin(accountId)) return true;
    const role = getMemberRole(orgId, accountId);
    if (role) {
        const allowed = ACTIONS[action];
        if (allowed && allowed.includes(role)) return true;
    }
    return _grantedPermissions(orgId, accountId).includes(action);
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
        status:       org.status || "active",
        archivedAt:   org.archivedAt || null,
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
        status:      "active",
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

function listOrgs(accountId, { includeArchived = false } = {}) {
    const store = _read();
    let orgs;
    if (!accountId) {
        orgs = store.orgs;
    } else if (isEnterpriseAdmin(accountId)) {
        orgs = store.orgs; // platform-wide visibility
    } else {
        const grantedOrgIds = new Set(listGrantsForAccount(accountId).map(g => g.orgId));
        orgs = store.orgs.filter(o => o.members?.some(m => m.accountId === accountId) || grantedOrgIds.has(o.id));
    }
    if (!includeArchived) orgs = orgs.filter(o => (o.status || "active") !== "archived");
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

// Best-effort count of records elsewhere tagged with this orgId, so callers see
// the blast radius before archiving/purging. Never throws — missing services
// or unreadable stores just yield a 0 for that category.
function _cascadeCounts(orgId) {
    const counts = { missions: 0, crmRecords: 0 };
    try {
        const mm = _mm();
        if (mm?.listMissions) {
            const { missions } = mm.listMissions({ limit: Number.MAX_SAFE_INTEGER });
            counts.missions = (missions || []).filter(m => m?.metadata?.orgId === orgId).length;
        }
    } catch {}
    try {
        const bds = require("./businessDataService.cjs");
        const totals = [
            bds.listLeads?.({ orgId, limit: 1 })?.total,
            bds.listContacts?.({ orgId, limit: 1 })?.total,
            bds.listOpportunities?.({ orgId, limit: 1 })?.total,
            bds.listCampaigns?.({ orgId, limit: 1 })?.total,
        ];
        counts.crmRecords = totals.reduce((sum, n) => sum + (n || 0), 0);
    } catch {}
    return counts;
}

// Soft-delete (default, safe path): flips status to "archived". The org and all
// its data (CRM records, missions, vault secrets, billing links) remain intact
// and can be restored. Archived orgs are hidden from listOrgs/resolveContext.
function archiveOrg(orgId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "delete_org");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    if (org.status === "archived") return { archived: true, orgId, alreadyArchived: true };

    const cascade = _cascadeCounts(orgId);
    org.status     = "archived";
    org.archivedAt = new Date().toISOString();
    org.archivedBy = requestingAccountId;
    org.updatedAt  = new Date().toISOString();
    _write(store);

    try { _le()?.createLesson({ type: "org_archived", title: `Org archived: ${org.name}`, source: "organizationService" }); } catch {}
    logger.info(`[OrgService] Archived org ${orgId} by ${requestingAccountId} (cascade: ${JSON.stringify(cascade)})`);
    return { archived: true, orgId, cascade };
}

function restoreOrg(orgId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "delete_org");
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    if ((org.status || "active") !== "archived") {
        throw Object.assign(new Error("Organization is not archived"), { status: 400 });
    }
    org.status     = "active";
    org.restoredAt = new Date().toISOString();
    org.updatedAt  = new Date().toISOString();
    _write(store);
    logger.info(`[OrgService] Restored org ${orgId} by ${requestingAccountId}`);
    return { restored: true, orgId };
}

// Hard delete (irreversible). Only permitted on an org that is already archived,
// and only when the caller supplies a confirmation token equal to the org's slug
// — a deliberate extra step so this can't be triggered by the same one-click flow
// as archive. Underlying CRM/mission/vault records are NOT cascade-deleted; they
// remain orphaned under the (now-freed) orgId, matching this mission's scope of
// not touching those services' delete paths.
function purgeOrg(orgId, requestingAccountId, confirmToken) {
    _assertPermission(orgId, requestingAccountId, "delete_org");
    const store = _read();
    const idx   = store.orgs.findIndex(o => o.id === orgId);
    if (idx < 0) throw Object.assign(new Error("Organization not found"), { status: 404 });
    const org = store.orgs[idx];

    if ((org.status || "active") !== "archived") {
        throw Object.assign(new Error("Organization must be archived before it can be permanently deleted"), { status: 409 });
    }
    if (!confirmToken || confirmToken !== org.slug) {
        throw Object.assign(new Error("Confirmation token mismatch — pass the organization's slug to confirm permanent deletion"), { status: 400 });
    }

    const cascade = _cascadeCounts(orgId);
    store.orgs.splice(idx, 1);
    _write(store);
    logger.info(`[OrgService] Permanently deleted org ${orgId} by ${requestingAccountId} (orphaned records: ${JSON.stringify(cascade)})`);
    return { deleted: true, orgId, orphaned: cascade };
}

// Back-compat alias: existing callers of deleteOrg now get the safe (soft-delete)
// behavior instead of the previous unprotected hard delete.
function deleteOrg(orgId, requestingAccountId) {
    return archiveOrg(orgId, requestingAccountId);
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
    return _addMemberRecord(orgId, { accountId, orgRole, deptId, teamId });
}

// Internal, not permission-gated by design: the caller (e.g. a JIT SSO login)
// is itself the authorization — the org's own manage_sso-gated SSO
// configuration is what decided this identity should become a member, not
// the new member's own permissions (which don't exist yet). Never expose
// this directly on a route; only addMember() (user-driven, gated) and
// ssoService.cjs's JIT-provisioning path (system-driven, pre-authorized by
// the org's SSO config) call into org membership mutation.
function _addMemberRecord(orgId, { accountId, orgRole = "member", deptId, teamId }) {
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

/**
 * Add a member as a direct, pre-authorized consequence of a successful SSO
 * login — the org already opted into this via its own manage_sso-gated
 * config (jitProvisioning: true), so no separate manage_members check
 * applies here. Idempotent: returns { added: false } instead of throwing if
 * the account is already a member (a returning SSO user on every login).
 */
function addMemberViaSso(orgId, accountId, orgRole = "member") {
    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });
    if (org.members.find(m => m.accountId === accountId)) return { added: false, accountId, alreadyMember: true };
    return _addMemberRecord(orgId, { accountId, orgRole });
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
// BILLING OVERVIEW — read-only aggregation across an org's members.
//
// billingService.js has no org concept and is NOT modified by this function —
// every member's subscription (trial/paid/cancelled, Razorpay sub id, quota
// usage) remains fully independent; who gets charged and how access is gated
// (checkAccess()) is completely unchanged. This is purely a reporting lens
// for an org_owner/org_admin to see their team's billing state in one place,
// the same way listOrgMissions() is a lens over missionMemory.cjs without
// duplicating mission storage. No new billing state is created or written.
// ─────────────────────────────────────────────────────────────────────────────

function getOrgBillingOverview(orgId, requestingAccountId) {
    _assertPermission(orgId, requestingAccountId, "manage_billing");
    const billing = _billing();
    if (!billing) throw new Error("billingService unavailable");

    const store = _read();
    const org   = _findOrg(store, orgId);
    if (!org) throw Object.assign(new Error("Organization not found"), { status: 404 });

    const members = (org.members || []).map(m => {
        const record = billing.getRecord(m.accountId);
        const quota  = billing.checkUsageQuota(m.accountId);
        return {
            accountId: m.accountId,
            orgRole:   m.orgRole,
            plan:      record.plan,
            status:    record.status,
            trialEnd:  record.trialEnd,
            usage:     { used: quota.used, limit: quota.limit, remaining: quota.remaining },
        };
    });

    const byPlan   = {};
    const byStatus = {};
    for (const m of members) {
        byPlan[m.plan]     = (byPlan[m.plan]     || 0) + 1;
        byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    }

    return {
        orgId,
        orgName:     org.name,
        memberCount: members.length,
        byPlan,
        byStatus,
        members,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT RESOLVER — given accountId, resolve all orgs/depts/teams they're in
// ─────────────────────────────────────────────────────────────────────────────

function resolveContext(accountId) {
    if (!accountId) return { orgs: [], primaryOrg: null };
    const store = _read();
    const result = [];

    for (const org of store.orgs) {
        if ((org.status || "active") === "archived") continue;
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

    // Prefer the account's persisted "current org" selection over array order,
    // so which org a request auto-resolves to is a deliberate choice the user
    // made (via setCurrentOrg / POST /orgs/switch), not an accident of which
    // org they happened to join first.
    const preferredOrgId = getCurrentOrg(accountId);
    const preferred = preferredOrgId ? result.find(r => r.orgId === preferredOrgId) : null;

    return { orgs: result, primaryOrg: preferred || result[0] || null };
}

// ── Current-org preference (per account, not global — see CONTEXT_FILE) ──────

function getCurrentOrg(accountId) {
    if (!accountId) return null;
    const map = _readContext();
    return map[accountId] || null;
}

function setCurrentOrg(accountId, orgId) {
    if (!accountId) throw new Error("accountId required");
    if (!orgId) throw new Error("orgId required");
    // Must actually be a member — otherwise this becomes a way to force
    // resolveContext() to leak org existence/membership status to a non-member.
    const role = getMemberRole(orgId, accountId);
    if (!role) throw Object.assign(new Error("Not a member of this organization"), { status: 403 });
    const map = _readContext();
    map[accountId] = orgId;
    _writeContext(map);
    logger.info(`[OrgService] ${accountId} switched current org to ${orgId}`);
    return { switched: true, orgId };
}

module.exports = {
    // Org CRUD
    createOrg,
    getOrg,
    listOrgs,
    updateOrg,
    deleteOrg,
    archiveOrg,
    restoreOrg,
    purgeOrg,
    // Members
    addMember,
    addMemberViaSso,
    removeMember,
    updateMemberRole,
    listMembers,
    getMemberRole,
    hasPermission,
    resolveContext,
    getCurrentOrg,
    setCurrentOrg,
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
    // Billing (read-only overview — see comment above getOrgBillingOverview)
    getOrgBillingOverview,
    // Cross-org grants + global roles (Module 6)
    isEnterpriseAdmin,
    grantOrgAccess,
    revokeOrgAccess,
    listOrgGrants,
    listGrantsForAccount,
    // RBAC constants
    ORG_ROLES,
    ROLE_HIERARCHY,
    ACTIONS,
    GLOBAL_ROLES,
};
