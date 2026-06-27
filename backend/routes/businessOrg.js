"use strict";
/**
 * Business Organization — Level 3 routes
 *
 * Department agent routes:
 * GET  /bizorg/status             — full org status (all 20 departments)
 * GET  /bizorg/summary            — compact summary with business dashboard
 * GET  /bizorg/agents/:id         — single department agent status
 * POST /bizorg/agents/:id/tick    — force immediate tick
 * POST /bizorg/agents/:id/enable  — enable department
 * POST /bizorg/agents/:id/disable — disable department
 *
 * V3 Business State routes:
 * GET  /bizorg/v3/dashboard       — full business dashboard
 * GET  /bizorg/v3/objectives      — quarterly objectives
 * POST /bizorg/v3/objectives      — create objective (CEO)
 * GET  /bizorg/v3/campaigns       — marketing campaigns
 * POST /bizorg/v3/campaigns       — create campaign
 * GET  /bizorg/v3/pipeline        — CRM pipeline stats
 * GET  /bizorg/v3/deals           — deal list (filterable)
 * POST /bizorg/v3/deals           — create deal
 * POST /bizorg/v3/deals/:id/advance — advance deal stage
 * GET  /bizorg/v3/tasks           — task list (filterable)
 * POST /bizorg/v3/tasks           — create task
 * POST /bizorg/v3/tasks/:id/claim — claim task for dept
 * GET  /bizorg/v3/backlogs/:id    — department backlog
 * GET  /bizorg/v3/kpis            — all dept KPIs
 * GET  /bizorg/v3/kpis/:id        — single dept KPI
 * GET  /bizorg/v3/memory          — business memory (filterable)
 * GET  /bizorg/v3/reports         — executive reports
 * GET  /bizorg/v3/blockers        — active blockers
 * GET  /bizorg/v3/handoffs        — handoffs (filterable)
 * POST /bizorg/v3/workflow/objective — CEO creates objective → triggers cascade
 * POST /bizorg/v3/workflow/lead      — capture a lead → runs full deal pipeline
 * POST /bizorg/v3/workflow/sync      — coordinator sync
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _org()  { return require("../services/businessOrg.cjs"); }
function _sup()  { return require("../services/agentRuntimeSupervisor.cjs"); }
function _st()   { try { return require("../services/businessOrgState.cjs");    } catch { return null; } }
function _wf()   { try { return require("../services/businessOrgWorkflow.cjs"); } catch { return null; } }

// ── Agent management ──────────────────────────────────────────────────────────

router.get("/bizorg/status", requireAuth, (req, res) => {
  try {
    const status = _org().getOrgStatus();
    return res.json({ success: true, count: status.length, departments: status });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/summary", requireAuth, (req, res) => {
  try {
    const summary = _org().getOrgSummary();
    return res.json({ success: true, ...summary });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/agents/:id", requireAuth, (req, res) => {
  try {
    const agent = _sup().getAgentStatus(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: "Agent not found" });
    return res.json({ success: true, agent });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/agents/:id/tick", requireAuth, async (req, res) => {
  try {
    const result = await _sup().triggerTick(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/agents/:id/enable", requireAuth, (req, res) => {
  try {
    const result = _sup().enableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/agents/:id/disable", requireAuth, (req, res) => {
  try {
    const result = _sup().disableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ── V3 Business State ─────────────────────────────────────────────────────────

router.get("/bizorg/v3/dashboard", requireAuth, (req, res) => {
  try {
    const dash = _st().getDashboard();
    const kpis = _st().getAllKpis();
    return res.json({ success: true, dashboard: dash, kpiCount: kpis.length });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/objectives", requireAuth, (req, res) => {
  try {
    const { quarter, deptId, status } = req.query;
    return res.json({ success: true, objectives: _st().listObjectives({ quarter, deptId, status }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/objectives", requireAuth, (req, res) => {
  try {
    const { title, description, kpis, target } = req.body;
    const r = _wf().ceoCreateObjective({ title, description, kpis, target });
    if (!r) return res.status(409).json({ success: false, error: "Objective already exists or invalid" });
    return res.json({ success: true, objective: r });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/campaigns", requireAuth, (req, res) => {
  try {
    const { objectiveId, status, channel } = req.query;
    return res.json({ success: true, campaigns: _st().listCampaigns({ objectiveId, status, channel }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/campaigns", requireAuth, (req, res) => {
  try {
    const { title, description, objectiveId, channel, budget, targetLeads } = req.body;
    const r = _wf().marketingLaunchCampaign({ objectiveId, title, channel, targetLeads });
    if (!r) return res.status(409).json({ success: false, error: "Campaign already exists or invalid" });
    return res.json({ success: true, campaign: r });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/pipeline", requireAuth, (req, res) => {
  try {
    return res.json({ success: true, pipeline: _st().getPipelineStats() });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/deals", requireAuth, (req, res) => {
  try {
    const { stage, deptId, campaignId } = req.query;
    const limit = parseInt(req.query.limit) || 50;
    return res.json({ success: true, deals: _st().listDeals({ stage, deptId, campaignId, limit }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/deals", requireAuth, (req, res) => {
  try {
    const { title, company, contactEmail, value, stage, campaignId, leadSource } = req.body;
    const r = _st().createDeal({ title, company, contactEmail, value, stage, campaignId, leadSource });
    return res.json({ success: r.ok, deal: r.deal, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/deals/:id/advance", requireAuth, (req, res) => {
  try {
    const { toStage, notes } = req.body;
    if (!toStage) return res.status(400).json({ success: false, error: "toStage required" });
    const r = _wf().salesAdvanceDeal(req.params.id, { toStage, notes });
    return res.json({ success: r.ok, deal: r.deal, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/tasks", requireAuth, (req, res) => {
  try {
    const { deptId, status, type, priority } = req.query;
    const limit = parseInt(req.query.limit) || 100;
    return res.json({ success: true, tasks: _st().listTasks({ deptId, status, type, priority, limit }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/tasks", requireAuth, (req, res) => {
  try {
    const { title, description, deptId, priority, type, objectiveId, campaignId, dealId } = req.body;
    const r = _st().createTask({ title, description, deptId, priority, type, objectiveId, campaignId, dealId });
    return res.json({ success: r.ok, task: r.task, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/tasks/:id/claim", requireAuth, (req, res) => {
  try {
    const { deptId } = req.body;
    if (!deptId) return res.status(400).json({ success: false, error: "deptId required" });
    const r = _st().claimTask(deptId, req.params.id);
    return res.json({ success: r.ok, task: r.task, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/backlogs/:id", requireAuth, (req, res) => {
  try {
    return res.json({ success: true, deptId: req.params.id, backlog: _st().getBacklog(req.params.id) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/kpis", requireAuth, (req, res) => {
  try { return res.json({ success: true, kpis: _st().getAllKpis() }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/kpis/:id", requireAuth, (req, res) => {
  try { return res.json({ success: true, kpi: _st().getKpi(req.params.id) }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/memory", requireAuth, (req, res) => {
  try {
    const { deptId, type } = req.query;
    const limit = parseInt(req.query.limit) || 50;
    return res.json({ success: true, memory: _st().getMemory({ deptId, type, limit }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/reports", requireAuth, (req, res) => {
  try {
    const { deptId, type } = req.query;
    const limit = parseInt(req.query.limit) || 20;
    return res.json({ success: true, reports: _st().listReports({ deptId, type, limit }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/blockers", requireAuth, (req, res) => {
  try {
    const resolved = req.query.resolved === "true";
    return res.json({ success: true, blockers: _st().listBlockers({ resolved }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/bizorg/v3/handoffs", requireAuth, (req, res) => {
  try {
    const pending  = req.query.pending === "true";
    const { deptId } = req.query;
    return res.json({ success: true, handoffs: _st().listHandoffs({ deptId, pending }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ── V3 Workflow triggers ──────────────────────────────────────────────────────

router.post("/bizorg/v3/workflow/objective", requireAuth, (req, res) => {
  try {
    const { title, description, kpis, target } = req.body;
    const r = _wf().ceoCreateObjective({ title, description, kpis, target });
    if (!r) return res.status(409).json({ success: false, error: "Objective already active or invalid title" });
    return res.json({ success: true, objective: r, message: "Cascade triggered: COO plan → Marketing campaigns → Lead capture" });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/workflow/lead", requireAuth, async (req, res) => {
  try {
    const { company, contactEmail, value, campaignId, source } = req.body;
    if (!company) return res.status(400).json({ success: false, error: "company required" });
    const deal = _wf().growthCaptureLead({ company, contactEmail, value: value || 2400, campaignId, source });
    if (!deal) return res.status(400).json({ success: false, error: "Could not create deal" });
    const result = await _wf().runDealPipeline(deal.id);
    return res.json({ success: true, deal, pipeline: result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/bizorg/v3/workflow/sync", requireAuth, (req, res) => {
  try {
    const result = _wf().coordinatorSync();
    return res.json({ success: result.ok, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
