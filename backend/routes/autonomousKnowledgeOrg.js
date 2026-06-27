"use strict";
/**
 * Autonomous Knowledge Organization — Level 4 routes
 *
 * Agent management:
 * GET  /ako/status               — full org status (20 departments)
 * GET  /ako/summary              — compact summary with knowledge dashboard
 * GET  /ako/agents/:id           — single department status
 * POST /ako/agents/:id/tick      — force immediate tick
 * POST /ako/agents/:id/enable    — enable department
 * POST /ako/agents/:id/disable   — disable department
 *
 * Knowledge state:
 * GET  /ako/v4/dashboard         — full knowledge dashboard
 * GET  /ako/v4/objectives        — quarterly objectives
 * POST /ako/v4/objectives        — create objective (CKO)
 * GET  /ako/v4/items             — knowledge items (filterable)
 * POST /ako/v4/items             — ingest new knowledge item
 * GET  /ako/v4/items/:id         — get single item
 * POST /ako/v4/items/:id/validate — validate item
 * POST /ako/v4/items/:id/reject  — reject item
 * GET  /ako/v4/playbooks         — list playbooks
 * POST /ako/v4/playbooks         — create playbook
 * POST /ako/v4/playbooks/:id/use — mark playbook used
 * GET  /ako/v4/tasks             — work queue (filterable)
 * POST /ako/v4/tasks             — create task
 * POST /ako/v4/tasks/:id/claim   — claim task
 * POST /ako/v4/tasks/:id/complete— complete task
 * GET  /ako/v4/backlogs/:id      — department backlog
 * GET  /ako/v4/kpis              — all dept KPIs
 * GET  /ako/v4/kpis/:id          — single dept KPI
 * GET  /ako/v4/memory            — department memory
 * GET  /ako/v4/reports           — knowledge reports
 * GET  /ako/v4/contradictions    — open contradictions
 * GET  /ako/v4/graph             — knowledge graph stats + reasoning
 *
 * Workflow triggers:
 * POST /ako/v4/search            — semantic knowledge search
 * POST /ako/v4/pipeline          — run full knowledge pipeline on input
 * POST /ako/v4/workflow/objective — CKO creates objective → cascade
 * POST /ako/v4/workflow/capture  — capture + run full pipeline
 * POST /ako/v4/workflow/sync     — coordinator sync
 * POST /ako/v4/workflow/validate — auto-validate pending items
 * POST /ako/v4/workflow/playbook — generate playbook from problem
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _org() { return require("../services/autonomousKnowledgeOrg.cjs"); }
function _sup() { return require("../services/agentRuntimeSupervisor.cjs"); }
function _st()  { try { return require("../services/akoState.cjs");         } catch { return null; } }
function _wf()  { try { return require("../services/akoWorkflow.cjs");      } catch { return null; } }

// ── Agent management ──────────────────────────────────────────────────────────

router.get("/ako/status", requireAuth, (req, res) => {
  try { return res.json({ success: true, count: 20, departments: _org().getOrgStatus() }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/summary", requireAuth, (req, res) => {
  try { return res.json({ success: true, ..._org().getOrgSummary() }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/agents/:id", requireAuth, (req, res) => {
  try {
    const agent = _sup().getAgentStatus(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: "Agent not found" });
    return res.json({ success: true, agent });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/agents/:id/tick", requireAuth, async (req, res) => {
  try {
    const result = await _sup().triggerTick(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/agents/:id/enable", requireAuth, (req, res) => {
  try {
    const result = _sup().enableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/agents/:id/disable", requireAuth, (req, res) => {
  try {
    const result = _sup().disableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ── V4 State ──────────────────────────────────────────────────────────────────

router.get("/ako/v4/dashboard", requireAuth, (req, res) => {
  try { return res.json({ success: true, dashboard: _st().getDashboard() }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/objectives", requireAuth, (req, res) => {
  try {
    const { quarter, deptId, status } = req.query;
    return res.json({ success: true, objectives: _st().listObjectives({ quarter, deptId, status }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/objectives", requireAuth, (req, res) => {
  try {
    const { title, description, kpis } = req.body;
    const r = _wf().ckoCreateObjective({ title, description, kpis });
    if (!r) return res.status(409).json({ success: false, error: "Objective already active or invalid" });
    return res.json({ success: true, objective: r });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/items", requireAuth, (req, res) => {
  try {
    const { type, deptId, status, limit } = req.query;
    const tags = req.query.tags ? req.query.tags.split(",") : undefined;
    return res.json({ success: true, items: _st().listItems({ type, deptId, status, tags, limit: parseInt(limit)||100 }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/items", requireAuth, (req, res) => {
  try {
    const { title, content, type, source, confidence, tags, objectiveId, deptId } = req.body;
    const r = _st().createItem({ title, content, type, source, confidence, tags, objectiveId, deptId });
    return res.json({ success: r.ok, item: r.item, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/items/:id", requireAuth, (req, res) => {
  try {
    const item = _st().getItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Item not found" });
    return res.json({ success: true, item });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/items/:id/validate", requireAuth, (req, res) => {
  try {
    const { confidence, notes } = req.body;
    const r = _wf().validateKnowledge(req.params.id, { confidence, notes });
    return res.json({ success: r.ok, item: r.item, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/items/:id/reject", requireAuth, (req, res) => {
  try {
    const { reason } = req.body;
    const r = _wf().rejectKnowledge(req.params.id, reason);
    return res.json({ success: r.ok, item: r.item, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/playbooks", requireAuth, (req, res) => {
  try {
    const { type, deptId, limit } = req.query;
    const tags = req.query.tags ? req.query.tags.split(",") : undefined;
    return res.json({ success: true, playbooks: _st().listPlaybooks({ type, deptId, tags, limit: parseInt(limit)||50 }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/playbooks", requireAuth, (req, res) => {
  try {
    const { title, problem, solution, steps, type, confidence, tags } = req.body;
    const r = _st().createPlaybook({ title, problem, solution, steps, type, confidence, tags });
    return res.json({ success: r.ok, playbook: r.playbook, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/playbooks/:id/use", requireAuth, (req, res) => {
  try {
    const r = _st().usePlaybook(req.params.id);
    return res.json({ success: r.ok, playbook: r.playbook, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/tasks", requireAuth, (req, res) => {
  try {
    const { deptId, status, type, limit } = req.query;
    return res.json({ success: true, tasks: _st().listTasks({ deptId, status, type, limit: parseInt(limit)||100 }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/tasks", requireAuth, (req, res) => {
  try {
    const { title, description, deptId, type, priority, objectiveId, itemId } = req.body;
    const r = _st().createTask({ title, description, deptId, type, priority, objectiveId, itemId });
    return res.json({ success: r.ok, task: r.task, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/tasks/:id/claim", requireAuth, (req, res) => {
  try {
    const { deptId } = req.body;
    if (!deptId) return res.status(400).json({ success: false, error: "deptId required" });
    const r = _st().claimTask(deptId, req.params.id);
    return res.json({ success: r.ok, task: r.task, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/tasks/:id/complete", requireAuth, (req, res) => {
  try {
    const { completedBy, outcome } = req.body;
    const r = _st().completeTask(req.params.id, { completedBy, outcome });
    return res.json({ success: r.ok, task: r.task, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/backlogs/:id", requireAuth, (req, res) => {
  try { return res.json({ success: true, deptId: req.params.id, backlog: _st().getBacklog(req.params.id) }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/kpis", requireAuth, (req, res) => {
  try { return res.json({ success: true, kpis: _st().getAllKpis() }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/kpis/:id", requireAuth, (req, res) => {
  try { return res.json({ success: true, kpi: _st().getKpi(req.params.id) }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/memory", requireAuth, (req, res) => {
  try {
    const { deptId, type, limit } = req.query;
    const tags = req.query.tags ? req.query.tags.split(",") : undefined;
    return res.json({ success: true, memory: _st().getMemory({ deptId, type, tags, limit: parseInt(limit)||50 }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/reports", requireAuth, (req, res) => {
  try {
    const { deptId, type, limit } = req.query;
    return res.json({ success: true, reports: _st().listReports({ deptId, type, limit: parseInt(limit)||20 }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/contradictions", requireAuth, (req, res) => {
  try {
    const state = _st();
    // Access contradictions via getDashboard
    const dash = state.getDashboard();
    // Direct state access for contradictions list
    const items = state.listItems({ status: "validated" });
    // Recompute contradictions by scanning recent items
    const contradictions = [];
    for (const item of items.slice(0, 20)) {
      const found = state.detectContradictions(item.id);
      contradictions.push(...found);
    }
    return res.json({ success: true, open: dash.contradictions.open, contradictions });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/ako/v4/graph", requireAuth, (req, res) => {
  try {
    const analysis = _wf().analyzeKnowledgeGraph();
    return res.json({ success: true, graph: analysis });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ── Workflow triggers ─────────────────────────────────────────────────────────

router.post("/ako/v4/search", requireAuth, (req, res) => {
  try {
    const { query, limit, type } = req.body;
    if (!query) return res.status(400).json({ success: false, error: "query required" });
    const results = _wf().retrieveKnowledge(query, { limit: parseInt(limit)||20, type });
    return res.json({ success: true, query, count: results.length, results });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/pipeline", requireAuth, async (req, res) => {
  try {
    const { title, content, type, source, confidence, tags, objectiveId } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, error: "title and content required" });
    const result = await _wf().runKnowledgePipeline({ title, content, type, source, confidence, tags, objectiveId });
    return res.json({ success: result.ok, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/workflow/objective", requireAuth, (req, res) => {
  try {
    const { title, description, kpis } = req.body;
    const r = _wf().ckoCreateObjective({ title, description, kpis });
    if (!r) return res.status(409).json({ success: false, error: "Objective already active or invalid" });
    return res.json({ success: true, objective: r, message: "Cascade: Research tasks created across all dept" });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/workflow/capture", requireAuth, async (req, res) => {
  try {
    const { title, content, type = "observation", source = "api", confidence = 70, tags = [] } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, error: "title and content required" });
    const result = await _wf().runKnowledgePipeline({ title, content, type, source, confidence, tags });
    return res.json({ success: result.ok, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/workflow/sync", requireAuth, (req, res) => {
  try {
    const result = _wf().coordinatorSync();
    return res.json({ success: result.ok, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/workflow/validate", requireAuth, (req, res) => {
  try {
    const minConfidence = parseInt(req.body.minConfidence) || 65;
    const result = _wf().autoValidatePending(minConfidence);
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/ako/v4/workflow/playbook", requireAuth, (req, res) => {
  try {
    const { problem, type = "engineering" } = req.body;
    if (!problem) return res.status(400).json({ success: false, error: "problem required" });
    const pb = _wf().generatePlaybook({ problem, type });
    if (!pb) return res.status(422).json({ success: false, error: "No related knowledge found to build playbook" });
    return res.json({ success: true, playbook: pb });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
