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
const { attachWorkspace, requireWorkspaceMember, requireRole } = require("../middleware/workspaceMiddleware.cjs");
const svc = require("../services/automationService.cjs");

router.use("/automation", requireAuth);
router.use("/automation", attachWorkspace);
// Same class of gap already found and fixed in governance.js (Organization OS
// pass): automationService.getRules()/getHistory()/getStatistics()/updateRule()
// perform NO membership check of their own — a direct call with any
// workspaceId string returns that workspace's automation rules unconditionally
// (confirmed: require("./services/automationService.cjs").getRules(anyId)
// returns real data with zero verification). This route's real isolation
// depends entirely on requireWorkspaceMember below.
//
// C.9 audit (2026-08-14): this file's own attachWorkspace/requireWorkspaceMember
// registration was itself missing the "/automation" path prefix (same bug as
// security.js/admin.js/governance.js) — router-level use(fn) with no path
// applies to every request reaching the router afterward, so this file was
// ALSO leaking its gate onto every route mounted later in routes/index.js
// (including all of /coding/*), on top of relying on security.js's leak for
// its own isolation. Both calls now scoped to "/automation".
router.use("/automation", requireWorkspaceMember);

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

// MASTER FINAL GAP CLOSURE (2026-08-15, C10-008): no delete route existed —
// the rule builder UI could create rules but never remove one. Same
// workspace-membership gate as every other route in this file.
router.delete("/automation/rules/:id", requireRole("Admin"), (req, res) => {
  try {
    const result = svc.deleteRule(_wsId(req), req.params.id, req.user.sub);
    res.json(result);
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

// MASTER FINAL GAP CLOSURE (2026-08-15, C10-008): dedicated manual-trigger
// route — previously the only way to actually execute a rule (not dry-run)
// was to wait for the (until now nonexistent) live loop. Goes through the
// same fireRule() the new event-loop dispatcher uses, so approval gates,
// condition evaluation, and history recording behave identically either way.
router.post("/automation/rules/:id/fire", requireRole("Operator"), async (req, res) => {
  try {
    const context = req.body?.context || {};
    const result = await svc.fireRule(_wsId(req), req.params.id, context, req.user.sub, false);
    res.json({ result });
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
