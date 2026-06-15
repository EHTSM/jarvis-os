"use strict";
/**
 * K3 — Enterprise Administration routes
 *
 * GET    /admin/team                 — team directory (enriched members)
 * PATCH  /admin/member/:id           — update member (status, title, deptId)
 * POST   /admin/member/bulk          — bulk member action
 * GET    /admin/departments          — list departments
 * POST   /admin/departments          — create department
 * PATCH  /admin/departments/:id      — update/archive department
 * GET    /admin/profile              — organisation profile
 * PATCH  /admin/profile              — update organisation profile
 * GET    /admin/statistics           — workspace statistics
 * GET    /admin/quotas               — workspace quotas + usage
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/adminService.cjs");

router.use(requireAuth);
router.use(attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// ── Team ──────────────────────────────────────────────────────────

router.get("/admin/team", (req, res) => {
  try {
    const team = svc.getTeam(_wsId(req));
    // Optional filters
    const { status, deptId, search } = req.query;
    let result = team;
    if (status) result = result.filter(m => m.status === status);
    if (deptId) result = result.filter(m => m.deptId === deptId);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        (m.name  || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q) ||
        (m.title || "").toLowerCase().includes(q)
      );
    }
    res.json({ team: result, total: result.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/admin/member/:id", requireRole("Admin"), (req, res) => {
  try {
    const result = svc.updateMember(_wsId(req), req.params.id, req.body, req.user.sub);
    res.json({ member: result });
  } catch (e) {
    const status = e.message.includes("Invalid") ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

router.post("/admin/member/bulk", requireRole("Admin"), (req, res) => {
  try {
    const { accountIds, action, payload } = req.body;
    const results = svc.bulkMemberAction(_wsId(req), { accountIds, action, payload }, req.user.sub);
    res.json({ results, applied: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Departments ───────────────────────────────────────────────────

router.get("/admin/departments", (req, res) => {
  try {
    res.json({ departments: svc.getDepartments(_wsId(req)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/admin/departments", requireRole("Admin"), (req, res) => {
  try {
    const { name, description, headId } = req.body;
    const dept = svc.createDepartment(_wsId(req), { name, description, headId }, req.user.sub);
    res.json({ department: dept });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch("/admin/departments/:id", requireRole("Admin"), (req, res) => {
  try {
    const dept = svc.updateDepartment(_wsId(req), req.params.id, req.body, req.user.sub);
    res.json({ department: dept });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Profile ───────────────────────────────────────────────────────

router.get("/admin/profile", (req, res) => {
  try {
    res.json({ profile: svc.getProfile(_wsId(req)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/admin/profile", requireRole("Admin"), (req, res) => {
  try {
    const profile = svc.updateProfile(_wsId(req), req.body, req.user.sub);
    res.json({ profile });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Statistics ────────────────────────────────────────────────────

router.get("/admin/statistics", (req, res) => {
  try {
    res.json(svc.getStatistics(_wsId(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Quotas ────────────────────────────────────────────────────────

router.get("/admin/quotas", (req, res) => {
  try {
    res.json(svc.getQuotas(_wsId(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
