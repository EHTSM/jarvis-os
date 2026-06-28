"use strict";
/**
 * Autonomous Civilization Routes (LEVEL 10)
 * Base: /auto/* and /auto/v10/*
 *
 * Serves all 10 control surfaces:
 *   - Civilization Control Center
 *   - Global Autonomous Timeline
 *   - Global Opportunity Map
 *   - Global Threat Map
 *   - Autonomous Decision Ledger
 *   - Autonomous Experiment Ledger
 *   - Autonomous Evolution Timeline
 *   - Global Explainability Dashboard
 *   - Global Confidence Dashboard
 *   - Global AI Operating Dashboard
 */

const router = require("express").Router();
const _st    = () => require("../services/autonomousState.cjs");
const _lp    = () => require("../services/autonomousLoop.cjs");
const _org   = () => require("../services/autonomousOrg.cjs");

const ok  = (res, data)       => res.json({ ok: true,  ...data });
const err = (res, msg, code)  => res.status(code || 400).json({ ok: false, error: msg });

// ── Status / Summary ──────────────────────────────────────────────────────────
router.get("/auto/status",  (req, res) => ok(res, { agents: _org().getOrgStatus() }));
router.get("/auto/summary", (req, res) => ok(res, _org().getOrgSummary()));
router.get("/auto/agents/:id", (req, res) => {
  const agent = _org().getOrgStatus().find(a => a.id === req.params.id);
  return agent ? ok(res, agent) : err(res, "Agent not found", 404);
});

// ── CIVILIZATION CONTROL CENTER ───────────────────────────────────────────────
router.get("/auto/v10/control",      (req, res) => ok(res, { control: _st().getControlState() }));
router.patch("/auto/v10/control",    (req, res) => ok(res, { control: _st().updateControlState(req.body).control }));
router.post("/auto/v10/control/mode",(req, res) => {
  const r = _st().setMode(req.body.mode);
  return r.ok ? ok(res, r) : err(res, r.error);
});
router.post("/auto/v10/control/autonomy", (req, res) => {
  const r = _st().setAutonomyLevel(req.body.level ?? 1.0);
  return ok(res, r);
});

// ── GLOBAL AI OPERATING DASHBOARD ─────────────────────────────────────────────
router.get("/auto/v10/dashboard", (req, res) => ok(res, { dashboard: _st().getGlobalDashboard() }));
router.get("/auto/v10/health",    (req, res) => ok(res, { health: _st().getGlobalHealthSnapshot() }));

// ── EXPLAINABILITY DASHBOARD ──────────────────────────────────────────────────
router.get("/auto/v10/explain",       (req, res) => ok(res, _st().getExplainabilityDashboard()));
router.get("/auto/v10/explain/:id",   (req, res) => ok(res, _st().getExplainabilityDashboard({ decisionId: req.params.id })));

// ── CONFIDENCE DASHBOARD ──────────────────────────────────────────────────────
router.get("/auto/v10/confidence", (req, res) => ok(res, { confidence: _st().getConfidenceDashboard() }));

// ── GLOBAL AUTONOMOUS TIMELINE (loop cycle history) ───────────────────────────
router.get("/auto/v10/timeline",       (req, res) => ok(res, { history: _st().getCycleHistory({ limit: parseInt(req.query.limit)||30 }), loop: _st().getLoopState() }));
router.get("/auto/v10/timeline/loop",  (req, res) => ok(res, { loop: _st().getLoopState() }));

// ── AUTONOMOUS DECISION LEDGER ────────────────────────────────────────────────
router.get("/auto/v10/decisions",      (req, res) => ok(res, { decisions: _st().listDecisions({ type: req.query.type, status: req.query.status, layer: req.query.layer, domain: req.query.domain, minConfidence: req.query.minConfidence ? parseFloat(req.query.minConfidence) : undefined, limit: parseInt(req.query.limit)||50 }) }));
router.get("/auto/v10/decisions/stats",(req, res) => ok(res, { stats: _st().getDecisionStats() }));
router.get("/auto/v10/decisions/:id",  (req, res) => {
  const d = _st().getDecision(req.params.id);
  return d ? ok(res, { decision: d }) : err(res, "Decision not found", 404);
});
router.post("/auto/v10/decisions",     (req, res) => {
  const r = _st().recordDecision(req.body);
  return r.ok ? ok(res, { decision: r.decision }) : err(res, r.error);
});
router.patch("/auto/v10/decisions/:id/resolve", (req, res) => {
  const r = _st().resolveDecision(req.params.id, req.body);
  return r.ok ? ok(res, { decision: r.decision }) : err(res, r.error);
});

// ── AUTONOMOUS EXPERIMENT LEDGER ──────────────────────────────────────────────
router.get("/auto/v10/experiments",         (req, res) => ok(res, { experiments: _st().listExperiments({ type: req.query.type, status: req.query.status, domain: req.query.domain, limit: parseInt(req.query.limit)||50 }) }));
router.post("/auto/v10/experiments",        (req, res) => {
  const r = _st().createExperiment(req.body);
  return r.ok ? ok(res, { experiment: r.experiment }) : err(res, r.error);
});
router.post("/auto/v10/experiments/:id/start",   (req, res) => {
  const r = _st().startExperiment(req.params.id);
  return r.ok ? ok(res, { experiment: r.experiment }) : err(res, r.error);
});
router.post("/auto/v10/experiments/:id/observe", (req, res) => {
  const r = _st().addExperimentObservation(req.params.id, req.body);
  return r.ok ? ok(res, { experiment: r.experiment }) : err(res, r.error);
});
router.post("/auto/v10/experiments/:id/conclude",(req, res) => {
  const r = _st().concludeExperiment(req.params.id, req.body);
  return r.ok ? ok(res, { experiment: r.experiment }) : err(res, r.error);
});
router.post("/auto/v10/experiment/run", (req, res) => {
  const r = _lp().runExperiment(req.body);
  return r.ok ? ok(res, { experiment: r.experiment }) : err(res, r.error);
});

// ── AUTONOMOUS EVOLUTION TIMELINE ─────────────────────────────────────────────
router.get("/auto/v10/evolution",              (req, res) => ok(res, { evolution: _st().listEvolution({ type: req.query.type, status: req.query.status, targetDomain: req.query.domain, limit: parseInt(req.query.limit)||50 }) }));
router.get("/auto/v10/evolution/org-lifecycle",(req, res) => ok(res, { lifecycle: _st().listOrgLifecycle({ action: req.query.action, limit: parseInt(req.query.limit)||50 }) }));
router.post("/auto/v10/evolution",             (req, res) => {
  const r = _st().recordEvolution(req.body);
  return r.ok ? ok(res, { evolution: r.evolution }) : err(res, r.error);
});
router.patch("/auto/v10/evolution/:id",        (req, res) => {
  const r = _st().implementEvolution(req.params.id, req.body);
  return r.ok ? ok(res, { evolution: r.evolution }) : err(res, r.error);
});
router.post("/auto/v10/evolution/org",         (req, res) => {
  const r = _st().recordOrgLifecycle(req.body);
  return r.ok ? ok(res, { event: r.event }) : err(res, r.error);
});

// ── GLOBAL OPPORTUNITY MAP ────────────────────────────────────────────────────
router.get("/auto/v10/opportunities",         (req, res) => ok(res, { opportunities: _st().listOpportunities({ status: req.query.status, domain: req.query.domain, layer: req.query.layer, priority: req.query.priority, limit: parseInt(req.query.limit)||50 }) }));
router.post("/auto/v10/opportunities",        (req, res) => {
  const r = _st().discoverOpportunity(req.body);
  return r.ok ? ok(res, { opportunity: r.opportunity }) : err(res, r.error);
});
router.post("/auto/v10/opportunities/:id/act",(req, res) => {
  const r = _st().actOnOpportunity(req.params.id, req.body);
  return r.ok ? ok(res, { opportunity: r.opportunity }) : err(res, r.error);
});
router.post("/auto/v10/opportunities/:id/close",(req, res) => {
  const r = _st().closeOpportunity(req.params.id, req.body);
  return r.ok ? ok(res, { opportunity: r.opportunity }) : err(res, r.error);
});

// ── GLOBAL THREAT MAP ─────────────────────────────────────────────────────────
router.get("/auto/v10/threats",              (req, res) => ok(res, { threats: _st().listThreats({ status: req.query.status, severity: req.query.severity, domain: req.query.domain, layer: req.query.layer, limit: parseInt(req.query.limit)||50 }) }));
router.post("/auto/v10/threats",             (req, res) => {
  const r = _st().detectThreat(req.body);
  return r.ok ? ok(res, { threat: r.threat }) : err(res, r.error);
});
router.post("/auto/v10/threats/:id/mitigate",(req, res) => {
  const r = _st().mitigateThreat(req.params.id, req.body);
  return r.ok ? ok(res, { threat: r.threat }) : err(res, r.error);
});

// ── GLOBAL PLANNING ───────────────────────────────────────────────────────────
router.get("/auto/v10/planning/global",     (req, res) => ok(res, { plan: _st().getGlobalPlan() }));
router.post("/auto/v10/planning/global",    (req, res) => {
  const r = _st().createGlobalPlan(req.body);
  return r.ok ? ok(res, { plan: r.plan }) : err(res, r.error);
});
router.get("/auto/v10/planning/multiyear",  (req, res) => ok(res, { plan: _st().getMultiYearPlan() }));
router.post("/auto/v10/planning/multiyear", (req, res) => {
  const r = _st().createMultiYearPlan(req.body);
  return r.ok ? ok(res, { plan: r.plan }) : err(res, r.error);
});
router.get("/auto/v10/planning/schedule",   (req, res) => ok(res, { schedule: _st().getSchedule({ status: req.query.status, limit: parseInt(req.query.limit)||100 }) }));
router.post("/auto/v10/planning/schedule",  (req, res) => {
  const r = _st().scheduleAction(req.body);
  return r.ok ? ok(res, { action: r.action }) : err(res, r.error);
});
router.post("/auto/v10/planning/execute-due", (req, res) => ok(res, _st().executeDueActions()));

// ── OPTIMIZATIONS ─────────────────────────────────────────────────────────────
router.get("/auto/v10/optimizations",              (req, res) => ok(res, { optimizations: _st().listOptimizations({ type: req.query.type, domain: req.query.domain, limit: parseInt(req.query.limit)||50 }) }));
router.post("/auto/v10/optimizations/budget",      (req, res) => {
  const r = _st().recordBudgetOptimization(req.body);
  return r.ok ? ok(res, { optimization: r.optimization }) : err(res, r.error);
});
router.post("/auto/v10/optimizations/resource",    (req, res) => {
  const r = _st().recordResourceOptimization(req.body);
  return r.ok ? ok(res, { optimization: r.optimization }) : err(res, r.error);
});
router.post("/auto/v10/optimizations/capability",  (req, res) => {
  const r = _st().recordCapabilityEvolution(req.body);
  return r.ok ? ok(res, { optimization: r.optimization }) : err(res, r.error);
});

// ── GLOBAL REPORTS ────────────────────────────────────────────────────────────
router.get("/auto/v10/reports",  (req, res) => ok(res, { reports: _st().listAutonomousReports({ type: req.query.type, limit: parseInt(req.query.limit)||20 }) }));
router.post("/auto/v10/reports", (req, res) => {
  const r = _st().createAutonomousReport(req.body);
  return r.ok ? ok(res, { report: r.report }) : err(res, r.error);
});

// ── AUTONOMOUS LOOP CONTROL ───────────────────────────────────────────────────
router.post("/auto/v10/loop/cycle",    async (req, res) => {
  try {
    const r = await _lp().runCycle();
    return ok(res, r);
  } catch (e) { return err(res, e.message, 500); }
});
router.post("/auto/v10/loop/audit",    (req, res) => {
  try { return ok(res, _lp().selfAudit()); }
  catch (e) { return err(res, e.message, 500); }
});
router.post("/auto/v10/loop/recover",  async (req, res) => {
  try {
    const r = await _lp().triggerRecovery(req.body);
    return ok(res, r);
  } catch (e) { return err(res, e.message, 500); }
});

// ── INDIVIDUAL LOOP PHASES (for inspection/testing) ───────────────────────────
router.post("/auto/v10/loop/observe",   (req, res) => { try { return ok(res, { observation: _lp().observe() }); } catch(e) { return err(res, e.message, 500); } });
router.post("/auto/v10/loop/detect",    (req, res) => {
  try {
    const obs = _lp().observe();
    return ok(res, { detected: _lp().detect(obs) });
  } catch(e) { return err(res, e.message, 500); }
});
router.post("/auto/v10/loop/plan",      (req, res) => {
  try {
    const obs = _lp().observe();
    const det = _lp().detect(obs);
    return ok(res, { decisions: _lp().plan(obs, det) });
  } catch(e) { return err(res, e.message, 500); }
});

// ── WORKFLOW COMMAND ──────────────────────────────────────────────────────────
router.post("/auto/v10/command", async (req, res) => {
  const { command, mode, autonomyLevel } = req.body;
  if (!command) return err(res, "command required");
  if (mode) _st().setMode(mode);
  if (autonomyLevel !== undefined) _st().setAutonomyLevel(autonomyLevel);
  try {
    const cycle = await _lp().runCycle();
    return ok(res, { command, cycle });
  } catch (e) { return err(res, e.message, 500); }
});

module.exports = router;
