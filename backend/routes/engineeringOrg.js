"use strict";
/**
 * Level 2 Engineering Organization routes
 *
 * GET  /engorg/status           — full org status (all 20 engineers)
 * GET  /engorg/summary          — compact summary (counts + health)
 * GET  /engorg/agents/:id       — single engineer status
 * POST /engorg/agents/:id/tick  — force immediate tick
 * POST /engorg/agents/:id/enable  — enable disabled engineer
 * POST /engorg/agents/:id/disable — disable running engineer
 * GET  /engorg/missions         — missions created by engineering org
 *
 * V2 Engineering Workflow Dashboard
 * GET  /engorg/v2/dashboard     — org-level dashboard (workItems, blockers, approvals, velocity)
 * GET  /engorg/v2/objectives    — quarterly objectives list
 * GET  /engorg/v2/epics         — epic list (optionally filtered by objectiveId)
 * GET  /engorg/v2/work-items    — work item list (optionally filtered by status/assignedTo/domain)
 * GET  /engorg/v2/backlogs/:id  — engineer's backlog
 * GET  /engorg/v2/kpis          — all engineer KPIs
 * GET  /engorg/v2/kpis/:id      — single engineer KPI
 * GET  /engorg/v2/blockers      — active blockers
 * GET  /engorg/v2/handoffs      — handoff log (optionally filtered)
 * GET  /engorg/v2/approvals     — approval queue
 * GET  /engorg/v2/reviews       — review queue
 * GET  /engorg/v2/memory        — engineering memory (optionally filtered by engineerId)
 * POST /engorg/v2/objectives    — create quarterly objective (CTO)
 * POST /engorg/v2/epics         — create epic (EM)
 * POST /engorg/v2/work-items    — create work item (Architect)
 * POST /engorg/v2/work-items/:id/claim   — engineer claims a work item
 * POST /engorg/v2/work-items/:id/complete — mark work item complete → triggers review pipeline
 * POST /engorg/v2/blockers/:id/resolve   — resolve a blocker
 * POST /engorg/v2/handoffs/:id/accept    — accept a handoff
 * POST /engorg/v2/approvals/:id/decide   — record approval decision
 * POST /engorg/v2/workflow/sync          — trigger coordinator sync
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _org()  { return require("../services/engineeringOrg.cjs"); }
function _sup()  { return require("../services/agentRuntimeSupervisor.cjs"); }
function _mm()   { try { return require("../services/missionMemory.cjs"); } catch { return null; } }
function _st()   { try { return require("../services/engineeringOrgState.cjs"); } catch { return null; } }
function _wf()   { try { return require("../services/engineeringOrgWorkflow.cjs"); } catch { return null; } }

router.get("/engorg/status", requireAuth, (req, res) => {
  try {
    const status = _org().getOrgStatus();
    return res.json({ success: true, count: status.length, engineers: status });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/summary", requireAuth, (req, res) => {
  try {
    const summary = _org().getOrgSummary();
    return res.json({ success: true, ...summary });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/agents/:id", requireAuth, (req, res) => {
  try {
    const agent = _sup().getAgentStatus(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: "Agent not found" });
    return res.json({ success: true, agent });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/agents/:id/tick", requireAuth, async (req, res) => {
  try {
    const result = await _sup().triggerTick(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/agents/:id/enable", requireAuth, (req, res) => {
  try {
    const result = _sup().enableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/agents/:id/disable", requireAuth, (req, res) => {
  try {
    const result = _sup().disableAgent(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/missions", requireAuth, (req, res) => {
  try {
    const limit  = parseInt(req.query.limit) || 50;
    const all    = _mm()?.listMissions({ limit: 500 }) || { missions: [] };
    const orgIds = new Set(require("../services/engineeringOrg.cjs").ENGINEERING_ORG.map(e => e.id));
    const missions = (all.missions || [])
      .filter(m => orgIds.has(m.metadata?.autoCreatedBy))
      .slice(0, limit);
    return res.json({ success: true, count: missions.length, missions });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ── V2 Engineering Workflow Dashboard ─────────────────────────────────────────

router.get("/engorg/v2/dashboard", requireAuth, (req, res) => {
  try {
    const dash = _st().getDashboard();
    const kpis = _st().getAllKpis();
    const avgQ = kpis.length ? Math.round(kpis.reduce((s, k) => s + (k.qualityScore || 100), 0) / kpis.length) : 100;
    return res.json({ success: true, dashboard: dash, avgQualityScore: avgQ, engineerCount: kpis.length });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/objectives", requireAuth, (req, res) => {
  try {
    const { quarter, status } = req.query;
    return res.json({ success: true, objectives: _st().listObjectives({ quarter, status }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/objectives", requireAuth, (req, res) => {
  try {
    const { title, description, kpis } = req.body;
    const result = _wf().ctoCreateObjective({ title, description, kpis: kpis || [] });
    if (!result) return res.status(409).json({ success: false, error: "Objective already exists or invalid" });
    return res.json({ success: true, objective: result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/epics", requireAuth, (req, res) => {
  try {
    const { objectiveId, status, priority } = req.query;
    return res.json({ success: true, epics: _st().listEpics({ objectiveId, status, priority }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/epics", requireAuth, (req, res) => {
  try {
    const { title, description, objectiveId, priority, estimatedDays } = req.body;
    const result = _wf().emCreateEpic({ title, description, objectiveId, priority, estimatedDays });
    if (!result) return res.status(409).json({ success: false, error: "Epic already exists or invalid" });
    return res.json({ success: true, epic: result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/work-items", requireAuth, (req, res) => {
  try {
    const { status, assignedTo, domain, epicId, priority } = req.query;
    const limit = parseInt(req.query.limit) || 100;
    return res.json({ success: true, workItems: _st().listWorkItems({ status, assignedTo, domain, epicId, priority, limit }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/work-items", requireAuth, (req, res) => {
  try {
    const { title, description, epicId, domain, priority, estimatedHours, tags } = req.body;
    const r = _st().createWorkItem({ title, description, epicId, domain, priority, estimatedHours, tags });
    return res.json({ success: r.ok, workItem: r.workItem, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/work-items/:id", requireAuth, (req, res) => {
  try {
    const item = _st().getWorkItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: "Work item not found" });
    return res.json({ success: true, workItem: item });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/work-items/:id/claim", requireAuth, (req, res) => {
  try {
    const { engineerId } = req.body;
    if (!engineerId) return res.status(400).json({ success: false, error: "engineerId required" });
    const r = _st().claimWorkItem(engineerId, req.params.id);
    return res.json({ success: r.ok, workItem: r.workItem, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/work-items/:id/complete", requireAuth, (req, res) => {
  try {
    const { completedBy, notes } = req.body;
    if (!completedBy) return res.status(400).json({ success: false, error: "completedBy required" });
    const r = _wf().completeWork(req.params.id, { completedBy, notes });
    return res.json({ success: r.ok, reviewId: r.reviewId, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/backlogs/:id", requireAuth, (req, res) => {
  try {
    return res.json({ success: true, engineerId: req.params.id, backlog: _st().getBacklog(req.params.id) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/kpis", requireAuth, (req, res) => {
  try {
    return res.json({ success: true, kpis: _st().getAllKpis() });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/kpis/:id", requireAuth, (req, res) => {
  try {
    return res.json({ success: true, kpi: _st().getKpi(req.params.id) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/blockers", requireAuth, (req, res) => {
  try {
    const resolved = req.query.resolved === "true";
    return res.json({ success: true, blockers: _st().listBlockers({ resolved }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/blockers/:id/resolve", requireAuth, (req, res) => {
  try {
    const { resolvedBy } = req.body;
    const r = _st().resolveBlocker(req.params.id, { resolvedBy });
    return res.json({ success: r.ok, blocker: r.blocker, workItemStatus: r.workItemStatus, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/handoffs", requireAuth, (req, res) => {
  try {
    const pending = req.query.pending === "true";
    const { engineerId } = req.query;
    return res.json({ success: true, handoffs: _st().listHandoffs({ engineerId, pending }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/handoffs/:id/accept", requireAuth, (req, res) => {
  try {
    const r = _st().acceptHandoff(req.params.id, { engineerId: req.body.engineerId });
    return res.json({ success: r.ok, handoff: r.handoff, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/approvals", requireAuth, (req, res) => {
  try {
    const { status, workItemId } = req.query;
    return res.json({ success: true, approvals: _st().listApprovals({ status, workItemId }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/approvals/:id/decide", requireAuth, (req, res) => {
  try {
    const { engineerId, decision, comment } = req.body;
    if (!engineerId || !decision) return res.status(400).json({ success: false, error: "engineerId and decision required" });
    const r = _st().recordApprovalDecision(req.params.id, { engineerId, decision, comment });
    return res.json({ success: r.ok, approval: r.approval, error: r.error });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/reviews", requireAuth, (req, res) => {
  try {
    const { status, type } = req.query;
    return res.json({ success: true, reviews: _st().listReviews({ status, type }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/engorg/v2/memory", requireAuth, (req, res) => {
  try {
    const { engineerId, type } = req.query;
    const limit = parseInt(req.query.limit) || 50;
    return res.json({ success: true, memory: _st().getMemory({ engineerId, type, limit }) });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/engorg/v2/workflow/sync", requireAuth, (req, res) => {
  try {
    const result = _wf().coordinatorSync();
    return res.json({ success: result.ok, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
