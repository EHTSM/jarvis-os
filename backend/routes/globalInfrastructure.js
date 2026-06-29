"use strict";
/**
 * globalInfrastructure.js — POST-Ω P19 Global Infrastructure Orchestrator
 * Routes: /infra/*
 *
 * Registry:      POST /infra/resources/register
 *                PUT  /infra/resources/:id/status
 *                DELETE /infra/resources/:id
 *                GET  /infra/resources, /infra/resources/:id
 *                GET  /infra/registry/stats
 *
 * Planner:       POST /infra/plan
 *                PUT  /infra/plans/:id/execute
 *                GET  /infra/plans, /infra/plans/:id
 *                GET  /infra/plan/stats
 *
 * Health:        POST /infra/health/scan
 *                GET  /infra/health, /infra/health/resource/:id
 *                GET  /infra/health/alerts
 *                POST /infra/health/alerts/:id/resolve
 *                GET  /infra/health/stats
 *
 * Recovery:      POST /infra/recovery/trigger
 *                POST /infra/recovery/auto
 *                GET  /infra/recoveries, /infra/recoveries/:id
 *                GET  /infra/recovery/stats
 *
 * Optimization:  POST /infra/optimize
 *                PUT  /infra/optimizations/:id/apply
 *                GET  /infra/optimizations, /infra/optimizations/:id
 *                GET  /infra/optimization/stats
 *
 * Dashboard:     GET  /infra/dashboard
 *                GET  /infra/pipeline
 *                GET  /infra/health-system
 *
 * Full Pipeline: POST /infra/pipeline/run
 */

const router = require("express").Router();

const reg  = () => require("../services/infrastructureRegistryEngine.cjs");
const plan = () => require("../services/infrastructurePlannerEngine.cjs");
const he   = () => require("../services/infrastructureHealthEngine.cjs");
const rec  = () => require("../services/infrastructureRecoveryEngine.cjs");
const opt  = () => require("../services/infrastructureOptimizationEngine.cjs");
const db   = () => require("../services/infrastructureDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Registry ──────────────────────────────────────────────────────────────────

router.post("/infra/resources/register", (req, res) => {
  const r = reg().register(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.put("/infra/resources/:id/status", (req, res) => {
  const { status, note } = req.body || {};
  if (!status) return err(res, "status is required");
  const r = reg().updateStatus(req.params.id, status, { note });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.delete("/infra/resources/:id", (req, res) => {
  const r = reg().deregister(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/infra/registry/stats", (req, res) => {
  ok(res, reg().getStats());
});

router.get("/infra/resources/:id", (req, res) => {
  const r = reg().getResource(req.params.id);
  if (!r) return err(res, "resource not found", 404);
  ok(res, { resource: r });
});

router.get("/infra/resources", (req, res) => {
  const { resourceType, environment, region, status, limit } = req.query;
  ok(res, reg().listResources({ resourceType, environment, region, status, limit: limit ? parseInt(limit) : 100 }));
});

// ── Planner ───────────────────────────────────────────────────────────────────

router.post("/infra/plan", (req, res) => {
  ok(res, plan().plan());
});

router.put("/infra/plans/:id/execute", (req, res) => {
  const r = plan().markExecuted(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/infra/plan/stats", (req, res) => {
  ok(res, plan().getStats());
});

router.get("/infra/plans/:id", (req, res) => {
  const p = plan().getPlan(req.params.id);
  if (!p) return err(res, "plan not found", 404);
  ok(res, { plan: p });
});

router.get("/infra/plans", (req, res) => {
  const { type, priority, status, limit } = req.query;
  ok(res, plan().listPlans({ type, priority, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Health ────────────────────────────────────────────────────────────────────

router.post("/infra/health/scan", (req, res) => {
  ok(res, he().scan());
});

router.get("/infra/health/stats", (req, res) => {
  ok(res, he().getStats());
});

router.get("/infra/health/resource/:id", (req, res) => {
  const r = he().getResourceHealth(req.params.id);
  if (!r) return err(res, "no health record for resource", 404);
  ok(res, { healthRecord: r });
});

router.get("/infra/health/alerts", (req, res) => {
  const { severity, resolved, limit } = req.query;
  const resolvedBool = resolved !== undefined ? resolved === "true" : undefined;
  ok(res, he().listAlerts({ severity, resolved: resolvedBool, limit: limit ? parseInt(limit) : 50 }));
});

router.post("/infra/health/alerts/:id/resolve", (req, res) => {
  const r = he().resolveAlert(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/infra/health", (req, res) => {
  const { level, resourceType, limit } = req.query;
  ok(res, he().listHealthRecords({ level, resourceType, limit: limit ? parseInt(limit) : 100 }));
});

// ── Recovery ──────────────────────────────────────────────────────────────────

router.post("/infra/recovery/trigger", async (req, res) => {
  const { resourceId, action, trigger, skipExecute } = req.body || {};
  if (!resourceId) return err(res, "resourceId is required");
  const r = await rec().recover(resourceId, { action, trigger, skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.post("/infra/recovery/auto", async (req, res) => {
  const { skipExecute } = req.body || {};
  ok(res, await rec().autoRecover({ skipExecute }));
});

router.get("/infra/recovery/stats", (req, res) => {
  ok(res, rec().getStats());
});

router.get("/infra/recoveries/:id", (req, res) => {
  const r = rec().getRecovery(req.params.id);
  if (!r) return err(res, "recovery not found", 404);
  ok(res, { recovery: r });
});

router.get("/infra/recoveries", (req, res) => {
  const { action, status, limit } = req.query;
  ok(res, rec().listRecoveries({ action, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Optimization ──────────────────────────────────────────────────────────────

router.post("/infra/optimize", (req, res) => {
  ok(res, opt().optimize());
});

router.put("/infra/optimizations/:id/apply", (req, res) => {
  const r = opt().applyOptimization(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/infra/optimization/stats", (req, res) => {
  ok(res, opt().getStats());
});

router.get("/infra/optimizations/:id", (req, res) => {
  const o = opt().getOptimization(req.params.id);
  if (!o) return err(res, "optimization not found", 404);
  ok(res, { optimization: o });
});

router.get("/infra/optimizations", (req, res) => {
  const { type, status, limit } = req.query;
  ok(res, opt().listOptimizations({ type, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/infra/dashboard", (req, res) => {
  ok(res, db().getDashboard());
});

router.get("/infra/pipeline", (req, res) => {
  ok(res, db().getPipelineView());
});

router.get("/infra/health-system", (req, res) => {
  ok(res, db().getInfrastructureSystemHealth());
});

// ── Full Pipeline ─────────────────────────────────────────────────────────────

router.post("/infra/pipeline/run", async (req, res) => {
  const { skipExecute } = req.body || {};
  const steps = [];

  // 1. Discover + Register (registry auto-seeds on load)
  const regStats = reg().getStats();
  steps.push({ step: "discover_register", ok: true, resources: regStats.total });

  // 2. Assess (health scan)
  const health = he().scan();
  steps.push({ step: "assess", ok: health.ok, scanned: health.scanned, avgScore: health.avgHealthScore });

  // 3. Plan
  const plans = plan().plan();
  steps.push({ step: "plan", ok: plans.ok, found: plans.found });

  // 4. Monitor (re-scan after plan)
  const monitor = he().scan();
  steps.push({ step: "monitor", ok: monitor.ok, alerts: monitor.alertCount });

  // 5. Optimize
  const optResult = opt().optimize();
  steps.push({ step: "optimize", ok: optResult.ok, found: optResult.found, savings: optResult.estimatedMonthlySavings });

  // 6. Recover (auto-recover any alerts)
  const recResult = await rec().autoRecover({ skipExecute });
  steps.push({ step: "recover", ok: recResult.ok, processed: recResult.processed });

  // 7. Dashboard
  const dashboard = db().getDashboard();
  steps.push({ step: "audit_learn", ok: dashboard.ok, infraHealth: dashboard.summary.infraHealth });

  ok(res, {
    pipeline:       "global_infrastructure",
    stepsCompleted: steps.filter(s => s.ok).length,
    totalSteps:     steps.length,
    steps,
    summary:        dashboard.summary,
  });
});

module.exports = router;
