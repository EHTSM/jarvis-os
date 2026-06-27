"use strict";
/**
 * Autonomous Evolution Organization — Routes (LEVEL 5)
 * Base: /aeo/* management, /aeo/v5/* CRUD + workflow triggers
 */
const router = require("express").Router();

function _org()  { return require("../services/autonomousEvolutionOrg.cjs"); }
function _st()   { return require("../services/aeoState.cjs"); }
function _wf()   { return require("../services/aeoWorkflow.cjs"); }

// ── Management ────────────────────────────────────────────────────────────────
router.get("/aeo/status",           (req, res) => res.json(_org().getOrgStatus()));
router.get("/aeo/summary",          (req, res) => res.json(_org().getOrgSummary()));
router.get("/aeo/agents/:id",       (req, res) => {
  const all = _org().getOrgStatus();
  const a   = all.find(x => x.id === req.params.id);
  return a ? res.json(a) : res.status(404).json({ error: "Agent not found" });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/aeo/v5/dashboard",     (req, res) => res.json(_st().getDashboard()));

// ── Objectives ────────────────────────────────────────────────────────────────
router.get("/aeo/v5/objectives",    (req, res) => res.json(_st().listObjectives(req.query)));
router.post("/aeo/v5/objectives",   (req, res) => {
  const r = _st().createObjective(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── Evolutions ────────────────────────────────────────────────────────────────
router.get("/aeo/v5/evolutions",    (req, res) => res.json(_st().listEvolutions(req.query)));
router.post("/aeo/v5/evolutions",   (req, res) => {
  const r = _st().proposeEvolution(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.get("/aeo/v5/evolutions/:id",  (req, res) => {
  const e = _st().getEvolution(req.params.id);
  return e ? res.json(e) : res.status(404).json({ error: "Evolution not found" });
});
router.post("/aeo/v5/evolutions/:id/validate", (req, res) => {
  const r = _wf().validateEvolution(req.params.id, req.body);
  return res.json(r);
});
router.post("/aeo/v5/evolutions/:id/approve", (req, res) => {
  const r = _st().updateEvolution(req.params.id, { status: "approved", approvedBy: req.body.approvedBy || "api" });
  return res.json({ ok: !!r, evolution: r });
});
router.post("/aeo/v5/evolutions/:id/apply",   (req, res) => res.json(_wf().applyEvolution(req.params.id)));
router.post("/aeo/v5/evolutions/:id/measure", (req, res) => res.json(_wf().measureEvolution(req.params.id)));
router.post("/aeo/v5/evolutions/:id/revert",  (req, res) => {
  const r = _st().revertEvolution(req.params.id, req.body);
  return res.json(r);
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get("/aeo/v5/tasks",        (req, res) => res.json(_st().listTasks(req.query)));
router.post("/aeo/v5/tasks",       (req, res) => {
  const r = _st().createTask(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});
router.post("/aeo/v5/tasks/:id/claim",    (req, res) => res.json(_st().claimTask(req.params.id, req.body.deptId)));
router.post("/aeo/v5/tasks/:id/complete", (req, res) => res.json(_st().completeTask(req.params.id, req.body)));

// ── Experiments ───────────────────────────────────────────────────────────────
router.get("/aeo/v5/experiments",   (req, res) => res.json(_st().listExperiments(req.query)));
router.post("/aeo/v5/experiments",  (req, res) => {
  const r = _st().runExperiment(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── KPIs ──────────────────────────────────────────────────────────────────────
router.get("/aeo/v5/kpis",         (req, res) => res.json(_st().getAllKpis()));
router.get("/aeo/v5/kpis/:deptId", (req, res) => res.json(_st().getKpi(req.params.deptId)));

// ── Memory ────────────────────────────────────────────────────────────────────
router.get("/aeo/v5/memory",       (req, res) => res.json(_st().listMemory(req.query)));
router.post("/aeo/v5/memory",      (req, res) => {
  const r = _st().addMemory(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── Reports ───────────────────────────────────────────────────────────────────
router.get("/aeo/v5/reports",      (req, res) => res.json(_st().listReports(req.query)));
router.post("/aeo/v5/reports",     (req, res) => {
  const r = _st().createReport(req.body);
  return res.status(r.ok ? 201 : 400).json(r);
});

// ── History ───────────────────────────────────────────────────────────────────
router.get("/aeo/v5/history",      (req, res) => res.json(_st().getHistory()));

// ── Weaknesses ────────────────────────────────────────────────────────────────
router.get("/aeo/v5/weaknesses",   (req, res) => res.json(_wf().observeWeaknesses()));
router.get("/aeo/v5/patterns",     (req, res) => res.json(_wf().analyzePatterns()));

// ── Workflow triggers ─────────────────────────────────────────────────────────
router.post("/aeo/v5/workflow/objective", (req, res) => {
  const r = _wf().ceoCreateObjective(req.body);
  return r ? res.status(201).json({ ok: true, objective: r }) : res.status(400).json({ ok: false, error: "Objective already active or creation failed" });
});

router.post("/aeo/v5/workflow/observe", (req, res) => {
  const weaknesses = _wf().observeWeaknesses(req.body?.objectiveId);
  return res.json({ ok: true, count: weaknesses.length, weaknesses });
});

router.post("/aeo/v5/workflow/propose", (req, res) => {
  const { weakness, objectiveId } = req.body || {};
  if (!weakness) return res.status(400).json({ error: "weakness required" });
  const r = _wf().proposeFromWeakness(weakness, objectiveId);
  return r ? res.status(201).json({ ok: true, evolution: r }) : res.status(400).json({ ok: false });
});

router.post("/aeo/v5/workflow/validate", (req, res) => {
  const r = _wf().autoValidateProposed(req.body);
  return res.json({ ok: true, ...r });
});

router.post("/aeo/v5/workflow/approve", (req, res) => {
  const r = _wf().approveEvolutions(req.body);
  return res.json({ ok: true, ...r });
});

router.post("/aeo/v5/workflow/pipeline", async (req, res) => {
  const { objectiveId } = req.body || {};
  const obj = objectiveId ? _st().listObjectives({ id: objectiveId })[0] : _st().listObjectives({ status: "active" })[0];
  if (!obj) return res.status(400).json({ error: "No active objective. POST /aeo/v5/workflow/objective first." });
  const r = await _wf().runEvolutionPipeline(obj.id);
  return res.json(r);
});

router.post("/aeo/v5/workflow/sync", (req, res) => {
  const r = _wf().coordinatorSync();
  return res.json(r);
});

router.post("/aeo/v5/workflow/learn/:evoId", (req, res) => {
  _wf().recordEvolutionLesson(req.params.evoId);
  return res.json({ ok: true });
});

module.exports = router;
