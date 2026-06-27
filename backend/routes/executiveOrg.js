"use strict";
/**
 * Executive Operating System — Routes (LEVEL 6)
 * Base: /eos/* management, /eos/v6/* CRUD + workflow triggers
 */
const router = require("express").Router();

function _org() { return require("../services/executiveOrg.cjs"); }
function _st()  { return require("../services/executiveState.cjs"); }
function _wf()  { return require("../services/executiveWorkflow.cjs"); }

// ── Management ────────────────────────────────────────────────────────────────
router.get("/eos/status",       (req, res) => res.json(_org().getOrgStatus()));
router.get("/eos/summary",      (req, res) => res.json(_org().getOrgSummary()));
router.get("/eos/agents/:id",   (req, res) => {
  const a = _org().getOrgStatus().find(x => x.id === req.params.id);
  return a ? res.json(a) : res.status(404).json({ error: "Agent not found" });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/eos/v6/dashboard", (req, res) => res.json(_st().getDashboard()));
router.get("/eos/v6/health",    (req, res) => res.json(_st().getGlobalHealth()));
router.get("/eos/v6/context",   (req, res) => res.json(_st().syncOrgStatus()));

// ── Goals ─────────────────────────────────────────────────────────────────────
router.get("/eos/v6/goals",     (req, res) => res.json(_st().listGoals(req.query)));
router.post("/eos/v6/goals",    (req, res) => {
  const r = _st().createGoal(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.get("/eos/v6/goals/:id", (req, res) => {
  const g = _st().getGoal(req.params.id);
  return g ? res.json(g) : res.status(404).json({ error: "Goal not found" });
});
router.patch("/eos/v6/goals/:id", (req, res) => res.json(_st().updateGoal(req.params.id, req.body)));

// ── Strategies ────────────────────────────────────────────────────────────────
router.get("/eos/v6/strategies",    (req, res) => res.json(_st().listStrategies(req.query)));
router.post("/eos/v6/strategies",   (req, res) => {
  const r = _st().createStrategy(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.patch("/eos/v6/strategies/:id", (req, res) => res.json(_st().updateStrategy(req.params.id, req.body)));

// ── Executive Missions ────────────────────────────────────────────────────────
router.get("/eos/v6/missions",       (req, res) => res.json(_st().listExecMissions(req.query)));
router.post("/eos/v6/missions",      (req, res) => {
  const r = _st().createExecMission(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.get("/eos/v6/missions/:id",   (req, res) => {
  const m = _st().getExecMission(req.params.id);
  return m ? res.json(m) : res.status(404).json({ error: "Mission not found" });
});
router.patch("/eos/v6/missions/:id", (req, res) => res.json(_st().updateExecMission(req.params.id, req.body)));

// ── Decisions ─────────────────────────────────────────────────────────────────
router.get("/eos/v6/decisions",  (req, res) => res.json(_st().listDecisions(req.query)));
router.post("/eos/v6/decisions", (req, res) => {
  const r = _st().recordDecision(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── Approvals ─────────────────────────────────────────────────────────────────
router.get("/eos/v6/approvals",              (req, res) => res.json(_st().listApprovals(req.query)));
router.post("/eos/v6/approvals",             (req, res) => {
  const r = _st().requestApproval(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/eos/v6/approvals/:id/resolve", (req, res) => res.json(_st().resolveApproval(req.params.id, req.body)));

// ── Risks ─────────────────────────────────────────────────────────────────────
router.get("/eos/v6/risks",              (req, res) => res.json(_st().listRisks(req.query)));
router.post("/eos/v6/risks",             (req, res) => {
  const r = _st().raiseRisk(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/eos/v6/risks/:id/resolve", (req, res) => res.json(_st().resolveRisk(req.params.id, req.body)));

// ── Timelines ─────────────────────────────────────────────────────────────────
router.get("/eos/v6/timelines",                          (req, res) => res.json(_st().listTimelines(req.query)));
router.post("/eos/v6/timelines",                         (req, res) => {
  const r = _st().createTimeline(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/eos/v6/timelines/:id/advance/:phaseId",    (req, res) => res.json(_st().advanceTimeline(req.params.id, req.params.phaseId)));

// ── Policies ──────────────────────────────────────────────────────────────────
router.get("/eos/v6/policies",          (req, res) => res.json(_st().listPolicies(req.query)));
router.post("/eos/v6/policies",         (req, res) => {
  const r = _st().createPolicy(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/eos/v6/policies/evaluate",(req, res) => res.json(_st().evaluatePolicy(req.body)));

// ── Budgets ───────────────────────────────────────────────────────────────────
router.get("/eos/v6/budgets",                   (req, res) => res.json(_st().listBudgets(req.query)));
router.post("/eos/v6/budgets",                  (req, res) => {
  const r = _st().createBudget(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/eos/v6/budgets/:id/allocate",     (req, res) => res.json(_st().allocateBudget(req.params.id, req.body)));

// ── Allocations ───────────────────────────────────────────────────────────────
router.get("/eos/v6/allocations",       (req, res) => res.json(_st().listAllocations(req.query)));
router.post("/eos/v6/allocations",      (req, res) => {
  const r = _st().allocateResource(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/eos/v6/allocations/:id/release", (req, res) => res.json(_st().releaseResource(req.params.id)));

// ── KPIs ──────────────────────────────────────────────────────────────────────
router.get("/eos/v6/kpis",         (req, res) => res.json(_st().getAllKpis()));
router.get("/eos/v6/kpis/:deptId", (req, res) => res.json(_st().getKpi(req.params.deptId)));

// ── Memory ────────────────────────────────────────────────────────────────────
router.get("/eos/v6/memory",  (req, res) => res.json(_st().listMemory(req.query)));
router.post("/eos/v6/memory", (req, res) => {
  const r = _st().addMemory(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get("/eos/v6/reports",  (req, res) => res.json(_st().listReports(req.query)));
router.post("/eos/v6/reports", (req, res) => {
  const r = _st().createReport(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── Recoveries ────────────────────────────────────────────────────────────────
router.get("/eos/v6/recoveries",              (req, res) => res.json(_st().listRecoveries(req.query)));
router.post("/eos/v6/recoveries/:id/resolve", (req, res) => res.json(_st().resolveRecovery(req.params.id, req.body)));

// ── Capabilities ──────────────────────────────────────────────────────────────
router.get("/eos/v6/capabilities",    (req, res) => res.json(_st().listCapabilities(req.query)));
router.post("/eos/v6/capabilities",   (req, res) => {
  const r = _st().registerCapability(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow triggers
// ═══════════════════════════════════════════════════════════════════════════════

// POST /eos/v6/command  { command, priority, kpis, deadline }
router.post("/eos/v6/command", async (req, res) => {
  const { command, priority, kpis, deadline } = req.body || {};
  if (!command) return res.status(400).json({ error: "command required" });
  const r = await _wf().runFullPipeline(command, { priority, kpis, deadline });
  return res.status(r.ok ? 200 : 400).json(r);
});

// POST /eos/v6/workflow/goal
router.post("/eos/v6/workflow/goal", (req, res) => {
  const r = _wf().processCommand(req.body.command || req.body.title, req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// POST /eos/v6/workflow/strategy { goalId }
router.post("/eos/v6/workflow/strategy", (req, res) => {
  const r = _wf().buildStrategy(req.body.goalId);
  return res.status(r.ok ? 200 : 400).json(r);
});

// POST /eos/v6/workflow/dispatch/:org { goalId }
router.post("/eos/v6/workflow/dispatch/:org", (req, res) => {
  const { goalId } = req.body || {};
  if (!goalId) return res.status(400).json({ error: "goalId required" });
  const dispatch = {
    engineering: () => _wf().dispatchToEngineering(goalId),
    business:    () => _wf().dispatchToBusiness(goalId),
    knowledge:   () => _wf().dispatchToKnowledge(goalId),
    evolution:   () => _wf().dispatchToEvolution(goalId),
    odi:         () => _wf().dispatchToODI(goalId),
  };
  const fn = dispatch[req.params.org];
  if (!fn) return res.status(400).json({ error: `Unknown org: ${req.params.org}` });
  return res.json(fn());
});

// POST /eos/v6/workflow/validate { goalId }
router.post("/eos/v6/workflow/validate", (req, res) => res.json(_wf().validateOutcomes(req.body.goalId)));

// POST /eos/v6/workflow/report { goalId }
router.post("/eos/v6/workflow/report", (req, res) => {
  _wf().learnFromGoal(req.body.goalId);
  return res.json(_wf().generateReport(req.body.goalId));
});

// POST /eos/v6/workflow/sync
router.post("/eos/v6/workflow/sync", (req, res) => res.json(_wf().coordinatorSync()));

// POST /eos/v6/workflow/prioritize
router.post("/eos/v6/workflow/prioritize", (req, res) => res.json(_wf().prioritizeGoals()));

// POST /eos/v6/workflow/recover { goalId, missionId, failedOrg, reason }
router.post("/eos/v6/workflow/recover", (req, res) => res.json(_wf().recoverOrg(req.body)));

module.exports = router;
