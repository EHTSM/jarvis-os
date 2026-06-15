"use strict";
/**
 * K5 — Enterprise Automation routes
 *
 * GET    /automation/rules          — list workspace automation rules
 * POST   /automation/rules          — create a rule
 * PATCH  /automation/rules/:id      — update / enable / disable / archive
 * GET    /automation/templates      — list templates (built-in + custom)
 * POST   /automation/templates      — create custom template
 * GET    /automation/history        — execution history (filterable by ruleId)
 * GET    /automation/statistics     — rule run stats
 * POST   /automation/dry-run        — simulate a rule without execution
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachWorkspace, requireRole } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/automationService.cjs");

router.use(requireAuth);
router.use(attachWorkspace);

function _wsId(req) {
  return req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default";
}

// ── Rules ─────────────────────────────────────────────────────────

router.get("/automation/rules", (req, res) => {
  try {
    let rules = svc.getRules(_wsId(req));
    const { enabled, triggerType, status } = req.query;
    if (enabled !== undefined) rules = rules.filter(r => String(r.enabled) === enabled);
    if (triggerType)           rules = rules.filter(r => r.trigger?.type === triggerType);
    if (status)                rules = rules.filter(r => r.status === status);
    else                       rules = rules.filter(r => r.status !== "archived");
    res.json({ rules, total: rules.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/automation/rules", requireRole("Admin"), (req, res) => {
  try {
    const { name, description, trigger, conditions, action, approvalGate, escalation, enabled } = req.body;
    const rule = svc.createRule(_wsId(req), { name, description, trigger, conditions, action, approvalGate, escalation, enabled }, req.user.sub);
    res.json({ rule });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch("/automation/rules/:id", requireRole("Admin"), (req, res) => {
  try {
    const rule = svc.updateRule(_wsId(req), req.params.id, req.body, req.user.sub);
    res.json({ rule });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// ── Templates ─────────────────────────────────────────────────────

router.get("/automation/templates", (req, res) => {
  try {
    const templates = svc.getTemplates(_wsId(req));
    const { category } = req.query;
    res.json({ templates: category ? templates.filter(t => t.category === category) : templates });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/automation/templates", requireRole("Admin"), (req, res) => {
  try {
    const { name, description, category, rule } = req.body;
    const tpl = svc.createTemplate(_wsId(req), { name, description, category, rule }, req.user.sub);
    res.json({ template: tpl });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── History ───────────────────────────────────────────────────────

router.get("/automation/history", (req, res) => {
  try {
    const limit  = parseInt(req.query.limit, 10) || 100;
    const ruleId = req.query.ruleId;
    const history = svc.getHistory(_wsId(req), { limit, ruleId });
    res.json({ history, total: history.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Statistics ────────────────────────────────────────────────────

router.get("/automation/statistics", (req, res) => {
  try {
    res.json(svc.getStatistics(_wsId(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dry Run ───────────────────────────────────────────────────────

router.post("/automation/dry-run", requireRole("Operator"), async (req, res) => {
  try {
    const { ruleId, ruleData, context } = req.body;
    const result = await svc.dryRun(_wsId(req), { ruleId, ruleData, context: context || {} }, req.user.sub);
    res.json({ result, dryRun: true });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
