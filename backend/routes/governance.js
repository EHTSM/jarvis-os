"use strict";
/**
 * K4 — Enterprise Governance routes
 *
 * GET    /governance/policies          — list workspace policies
 * POST   /governance/policies          — create policy
 * PATCH  /governance/policies/:id      — update/archive policy
 * GET    /governance/templates         — list policy templates (built-in + custom)
 * POST   /governance/templates         — create custom template
 * GET    /governance/compliance        — compliance profile
 * PATCH  /governance/compliance        — update compliance profile
 * GET    /governance/reports           — governance report (aggregated, no new storage)
 * GET    /governance/risk              — risk matrix
 * PATCH  /governance/risk/:category    — update a risk matrix entry
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/governanceService.cjs");

router.use("/governance", requireAuth);
router.use(attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// ── Policies ──────────────────────────────────────────────────────

router.get("/governance/policies", (req, res) => {
  try {
    let policies = svc.getPolicies(_wsId(req));
    // Optional filters
    const { type, enforcement, status } = req.query;
    if (type)        policies = policies.filter(p => p.type === type);
    if (enforcement) policies = policies.filter(p => p.enforcement === enforcement);
    if (status)      policies = policies.filter(p => p.status === (status || "active"));
    else             policies = policies.filter(p => p.status !== "archived");
    res.json({ policies, total: policies.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/governance/policies", requireRole("Admin"), (req, res) => {
  try {
    const { name, type, enforcement, rules, description } = req.body;
    const policy = svc.createPolicy(_wsId(req), { name, type, enforcement, rules, description }, req.user.sub);
    res.json({ policy });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch("/governance/policies/:id", requireRole("Admin"), (req, res) => {
  try {
    const policy = svc.updatePolicy(_wsId(req), req.params.id, req.body, req.user.sub);
    res.json({ policy });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Templates ─────────────────────────────────────────────────────

router.get("/governance/templates", (req, res) => {
  try {
    const templates = svc.getTemplates(_wsId(req));
    const { category } = req.query;
    res.json({ templates: category ? templates.filter(t => t.category === category) : templates });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/governance/templates", requireRole("Admin"), (req, res) => {
  try {
    const { name, description, category, policies } = req.body;
    const tpl = svc.createTemplate(_wsId(req), { name, description, category, policies }, req.user.sub);
    res.json({ template: tpl });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Compliance ────────────────────────────────────────────────────

router.get("/governance/compliance", (req, res) => {
  try {
    res.json({ compliance: svc.getCompliance(_wsId(req)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/governance/compliance", requireRole("Admin"), (req, res) => {
  try {
    const compliance = svc.updateCompliance(_wsId(req), req.body, req.user.sub);
    res.json({ compliance });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Reports ───────────────────────────────────────────────────────

router.get("/governance/reports", (req, res) => {
  try {
    res.json(svc.getReports(_wsId(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Risk Matrix ───────────────────────────────────────────────────

router.get("/governance/risk", (req, res) => {
  try {
    res.json({ riskMatrix: svc.getRiskMatrix(_wsId(req)), categories: svc.RISK_CATEGORIES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/governance/risk/:category", requireRole("Admin"), (req, res) => {
  try {
    const { likelihood, impact, mitigation } = req.body;
    const entry = svc.updateRiskEntry(_wsId(req), req.params.category, { likelihood, impact, mitigation }, req.user.sub);
    res.json({ entry });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
