"use strict";
/**
 * organizations.js — Phase M1: Organization OS routes
 *
 * Organization hierarchy:
 *   Organization → Department → Team → Member
 *
 * RBAC:
 *   org_owner > org_admin > dept_lead > team_lead > member > viewer
 *
 * All routes require auth (JWT). Org-scope routes require org membership.
 *
 * Routes:
 *   Org CRUD:
 *     POST   /orgs                            — create org
 *     GET    /orgs                            — list my orgs
 *     GET    /orgs/:orgId                     — get org
 *     PATCH  /orgs/:orgId                     — update org
 *     DELETE /orgs/:orgId                     — delete org (org_owner only)
 *
 *   Members:
 *     GET    /orgs/:orgId/members             — list members
 *     POST   /orgs/:orgId/members             — add member
 *     PATCH  /orgs/:orgId/members/:accountId  — update member role
 *     DELETE /orgs/:orgId/members/:accountId  — remove member
 *
 *   Departments:
 *     GET    /orgs/:orgId/departments         — list depts
 *     POST   /orgs/:orgId/departments         — create dept
 *     PATCH  /orgs/:orgId/departments/:deptId — update dept
 *     DELETE /orgs/:orgId/departments/:deptId — delete dept
 *
 *   Teams:
 *     GET    /orgs/:orgId/teams               — all teams (across depts)
 *     GET    /orgs/:orgId/departments/:deptId/teams           — teams in dept
 *     POST   /orgs/:orgId/departments/:deptId/teams           — create team
 *     PATCH  /orgs/:orgId/departments/:deptId/teams/:teamId   — update team
 *     DELETE /orgs/:orgId/departments/:deptId/teams/:teamId   — delete team
 *     POST   /orgs/:orgId/departments/:deptId/teams/:teamId/members          — add member
 *     DELETE /orgs/:orgId/departments/:deptId/teams/:teamId/members/:accountId — remove member
 *
 *   Missions (org-scoped):
 *     POST   /orgs/:orgId/missions            — create mission for org
 *     GET    /orgs/:orgId/missions            — list org missions
 *     GET    /orgs/:orgId/missions/:missionId/ownership — verify ownership
 *
 *   Context + RBAC:
 *     GET    /orgs/me/context                 — my org memberships + permissions
 *     GET    /orgs/roles                      — RBAC role definitions
 *     GET    /orgs/actions                    — all defined permission actions
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember, requireOrgPermission } = require("../middleware/orgMiddleware.cjs");

function _svc() { return require("../services/organizationService.cjs"); }
function _ok(res, data)            { res.json({ ok: true, ...data }); }
function _err(res, e, fallback)    { res.status(e.status || fallback || 500).json({ ok: false, error: e.message }); }

// All org routes require auth
router.use("/orgs", requireAuth);

// attachOrg() resolves req.org/req.orgRole from the X-Org-Id header, query,
// or body — it does not read Express route params. Every /orgs/:orgId/* route
// carries the org id as a URL param, so forward it into req.query.orgId (the
// param attachOrg already knows how to read) before delegating, unchanged, to
// the existing middleware.
function _attachOrgFromParam(req, res, next) {
    if (req.params.orgId && !req.query.orgId) req.query.orgId = req.params.orgId;
    return attachOrg(req, res, next);
}
router.use("/orgs/:orgId", _attachOrgFromParam);

// ── RBAC metadata (no org needed) ────────────────────────────────────────────
router.get("/orgs/roles", (req, res) => {
    const svc = _svc();
    _ok(res, { roles: svc.ORG_ROLES, hierarchy: svc.ROLE_HIERARCHY });
});

router.get("/orgs/actions", (req, res) => {
    _ok(res, { actions: _svc().ACTIONS });
});

// ── My context (all orgs I'm in) ─────────────────────────────────────────────
router.get("/orgs/me/context", (req, res) => {
    try { _ok(res, _svc().resolveContext(req.user.sub)); }
    catch (e) { _err(res, e); }
});

// ── Org CRUD ──────────────────────────────────────────────────────────────────
router.post("/orgs", (req, res) => {
    try {
        const { name, description, plan } = req.body || {};
        _ok(res, _svc().createOrg({ name, description, plan }, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

router.get("/orgs", (req, res) => {
    try { _ok(res, _svc().listOrgs(req.user.sub)); }
    catch (e) { _err(res, e); }
});

router.get("/orgs/:orgId", requireOrgMember, (req, res) => {
    try {
        const org = _svc().getOrg(req.params.orgId);
        if (!org) return res.status(404).json({ ok: false, error: "Organization not found" });
        _ok(res, { org });
    } catch (e) { _err(res, e); }
});

router.patch("/orgs/:orgId", requireOrgPermission("update_org"), (req, res) => {
    try {
        _ok(res, { org: _svc().updateOrg(req.params.orgId, req.body || {}, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.delete("/orgs/:orgId", requireOrgPermission("delete_org"), (req, res) => {
    try {
        _ok(res, _svc().deleteOrg(req.params.orgId, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

// ── Members ───────────────────────────────────────────────────────────────────
router.get("/orgs/:orgId/members", requireOrgPermission("view_members"), (req, res) => {
    try {
        const { deptId, teamId } = req.query;
        _ok(res, _svc().listMembers(req.params.orgId, { deptId, teamId }));
    } catch (e) { _err(res, e); }
});

router.post("/orgs/:orgId/members", requireOrgPermission("manage_members"), (req, res) => {
    try {
        const { accountId, orgRole, deptId, teamId } = req.body || {};
        if (!accountId) return res.status(400).json({ ok: false, error: "accountId required" });
        _ok(res, _svc().addMember(req.params.orgId, { accountId, orgRole, deptId, teamId }, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

router.patch("/orgs/:orgId/members/:accountId", requireOrgPermission("manage_members"), (req, res) => {
    try {
        const { orgRole } = req.body || {};
        if (!orgRole) return res.status(400).json({ ok: false, error: "orgRole required" });
        _ok(res, _svc().updateMemberRole(req.params.orgId, req.params.accountId, orgRole, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

router.delete("/orgs/:orgId/members/:accountId", requireOrgPermission("manage_members"), (req, res) => {
    try {
        _ok(res, _svc().removeMember(req.params.orgId, req.params.accountId, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

// ── Departments ───────────────────────────────────────────────────────────────
router.get("/orgs/:orgId/departments", requireOrgPermission("view_departments"), (req, res) => {
    try { _ok(res, _svc().listDepartments(req.params.orgId)); }
    catch (e) { _err(res, e); }
});

router.post("/orgs/:orgId/departments", requireOrgPermission("manage_departments"), (req, res) => {
    try {
        const { name, description, leadAccountId } = req.body || {};
        _ok(res, { department: _svc().createDepartment(req.params.orgId, { name, description, leadAccountId }, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/orgs/:orgId/departments/:deptId", requireOrgPermission("manage_departments"), (req, res) => {
    try {
        _ok(res, { department: _svc().updateDepartment(req.params.orgId, req.params.deptId, req.body || {}, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.delete("/orgs/:orgId/departments/:deptId", requireOrgPermission("manage_departments"), (req, res) => {
    try {
        _ok(res, _svc().deleteDepartment(req.params.orgId, req.params.deptId, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

// ── Teams ─────────────────────────────────────────────────────────────────────
router.get("/orgs/:orgId/teams", requireOrgPermission("view_teams"), (req, res) => {
    try { _ok(res, _svc().listTeams(req.params.orgId)); }
    catch (e) { _err(res, e); }
});

router.get("/orgs/:orgId/departments/:deptId/teams", requireOrgPermission("view_teams"), (req, res) => {
    try { _ok(res, _svc().listTeams(req.params.orgId, req.params.deptId)); }
    catch (e) { _err(res, e); }
});

router.post("/orgs/:orgId/departments/:deptId/teams", requireOrgPermission("manage_teams"), (req, res) => {
    try {
        const { name, description, leadAccountId } = req.body || {};
        _ok(res, { team: _svc().createTeam(req.params.orgId, req.params.deptId, { name, description, leadAccountId }, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.patch("/orgs/:orgId/departments/:deptId/teams/:teamId", requireOrgPermission("manage_own_team"), (req, res) => {
    try {
        _ok(res, { team: _svc().updateTeam(req.params.orgId, req.params.deptId, req.params.teamId, req.body || {}, req.user.sub) });
    } catch (e) { _err(res, e, 400); }
});

router.delete("/orgs/:orgId/departments/:deptId/teams/:teamId", requireOrgPermission("manage_teams"), (req, res) => {
    try {
        _ok(res, _svc().deleteTeam(req.params.orgId, req.params.deptId, req.params.teamId, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

router.post("/orgs/:orgId/departments/:deptId/teams/:teamId/members", requireOrgPermission("manage_own_team"), (req, res) => {
    try {
        const { accountId } = req.body || {};
        if (!accountId) return res.status(400).json({ ok: false, error: "accountId required" });
        _ok(res, _svc().addTeamMember(req.params.orgId, req.params.deptId, req.params.teamId, accountId, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

router.delete("/orgs/:orgId/departments/:deptId/teams/:teamId/members/:accountId", requireOrgPermission("manage_own_team"), (req, res) => {
    try {
        _ok(res, _svc().removeTeamMember(req.params.orgId, req.params.deptId, req.params.teamId, req.params.accountId, req.user.sub));
    } catch (e) { _err(res, e, 400); }
});

// ── Org-scoped missions ───────────────────────────────────────────────────────
router.post("/orgs/:orgId/missions", requireOrgPermission("create_mission"), (req, res) => {
    try {
        const { objective, priority, subtasks, deptId, teamId, ownerId, metadata } = req.body || {};
        if (!objective) return res.status(400).json({ ok: false, error: "objective required" });
        _ok(res, _svc().createMissionForOrg(
            req.params.orgId,
            { objective, priority, subtasks, deptId, teamId, ownerId, metadata },
            req.user.sub
        ));
    } catch (e) { _err(res, e, 400); }
});

router.get("/orgs/:orgId/missions", requireOrgPermission("view_missions"), (req, res) => {
    try {
        const { deptId, teamId, ownerId, status, limit } = req.query;
        _ok(res, _svc().listOrgMissions(req.params.orgId, { deptId, teamId, ownerId, status, limit: limit ? parseInt(limit, 10) : 100 }));
    } catch (e) { _err(res, e); }
});

router.get("/orgs/:orgId/missions/:missionId/ownership", requireOrgMember, (req, res) => {
    try {
        _ok(res, _svc().assertMissionOwnership(req.params.missionId, req.user.sub, req.params.orgId));
    } catch (e) { _err(res, e, 403); }
});

module.exports = router;
