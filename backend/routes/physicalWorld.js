"use strict";
/**
 * physicalWorld.js — POST-Ω P17 Physical World Integration
 * Routes: /physical/*
 *
 * Registry:      POST /physical/devices/register
 *                POST /physical/devices/:id/verify
 *                PUT  /physical/devices/:id/status
 *                GET  /physical/devices, /physical/devices/:id
 *                DELETE /physical/devices/:id
 *                GET  /physical/devices/adapter/:type
 *                GET  /physical/registry/stats
 *
 * Orchestration: POST /physical/orchestrate
 *                GET  /physical/orchestrations, /physical/orchestration/:id
 *                GET  /physical/orchestration/stats
 *
 * Scenarios:     POST /physical/scenarios
 *                POST /physical/scenarios/:id/execute
 *                GET  /physical/scenarios, /physical/scenarios/:id
 *                GET  /physical/executions, /physical/execution/:id
 *                GET  /physical/scenario/stats
 *
 * Health:        POST /physical/health/scan
 *                GET  /physical/health, /physical/health/device/:deviceId
 *                GET  /physical/health/alerts
 *                POST /physical/health/alert/:id/resolve
 *                GET  /physical/health/stats
 *
 * Workflow:      POST /physical/workflow/run
 *                GET  /physical/workflows, /physical/workflow/:id
 *                GET  /physical/workflow/stats
 *
 * Dashboard:     GET  /physical/dashboard
 *                GET  /physical/pipeline
 *                GET  /physical/health-system
 */

const router = require("express").Router();

const dreg  = () => require("../services/deviceRegistryEngine.cjs");
const dorch = () => require("../services/deviceOrchestrationEngine.cjs");
const ase   = () => require("../services/automationScenarioEngine.cjs");
const dhe   = () => require("../services/deviceHealthEngine.cjs");
const pwf   = () => require("../services/physicalWorkflowEngine.cjs");
const pdb   = () => require("../services/physicalWorldDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Device Registry ───────────────────────────────────────────────────────────

router.post("/physical/devices/register", (req, res) => {
  const r = dreg().register(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.post("/physical/devices/:id/verify", (req, res) => {
  const r = dreg().verify(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.put("/physical/devices/:id/status", (req, res) => {
  const { status } = req.body || {};
  const r = dreg().updateStatus(req.params.id, status);
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/physical/registry/stats", (req, res) => {
  ok(res, dreg().getStats());
});

router.get("/physical/devices/adapter/:type", (req, res) => {
  ok(res, dreg().listDevices({ adapterType: req.params.type }));
});

router.get("/physical/devices/:id", (req, res) => {
  const d = dreg().getDevice(req.params.id);
  if (!d) return err(res, "device not found", 404);
  ok(res, { device: d });
});

router.get("/physical/devices", (req, res) => {
  const { adapterType, status, limit } = req.query;
  ok(res, dreg().listDevices({ adapterType, status, limit: limit ? parseInt(limit) : 100 }));
});

router.delete("/physical/devices/:id", (req, res) => {
  const r = dreg().deregister(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

// ── Orchestration ─────────────────────────────────────────────────────────────

router.post("/physical/orchestrate", async (req, res) => {
  const { deviceIds, commands, mode, skipExecute } = req.body || {};
  const r = await dorch().orchestrate({ deviceIds, commands, mode, skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/physical/orchestration/stats", (req, res) => {
  ok(res, dorch().getStats());
});

router.get("/physical/orchestration/:id", (req, res) => {
  const o = dorch().getOrchestration(req.params.id);
  if (!o) return err(res, "orchestration not found", 404);
  ok(res, { orchestration: o });
});

router.get("/physical/orchestrations", (req, res) => {
  const { mode, status, limit } = req.query;
  ok(res, dorch().listOrchestrations({ mode, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Automation Scenarios ──────────────────────────────────────────────────────

router.post("/physical/scenarios", (req, res) => {
  const r = ase().createScenario(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.post("/physical/scenarios/:id/execute", async (req, res) => {
  const r = await ase().executeScenario(req.params.id, req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/physical/scenario/stats", (req, res) => {
  ok(res, ase().getStats());
});

router.get("/physical/scenarios/:id", (req, res) => {
  const s = ase().getScenario(req.params.id);
  if (!s) return err(res, "scenario not found", 404);
  ok(res, { scenario: s });
});

router.get("/physical/scenarios", (req, res) => {
  const { trigger, limit } = req.query;
  ok(res, ase().listScenarios({ trigger, limit: limit ? parseInt(limit) : 50 }));
});

router.get("/physical/execution/:id", (req, res) => {
  const e = ase().getExecution(req.params.id);
  if (!e) return err(res, "execution not found", 404);
  ok(res, { execution: e });
});

router.get("/physical/executions", (req, res) => {
  const { scenarioId, limit } = req.query;
  ok(res, ase().listExecutions({ scenarioId, limit: limit ? parseInt(limit) : 50 }));
});

// ── Device Health ─────────────────────────────────────────────────────────────

router.post("/physical/health/scan", (req, res) => {
  ok(res, dhe().scan());
});

router.get("/physical/health/stats", (req, res) => {
  ok(res, dhe().getStats());
});

router.get("/physical/health/device/:deviceId", (req, res) => {
  const r = dhe().getDeviceHealth(req.params.deviceId);
  if (!r) return err(res, "no health record for device", 404);
  ok(res, { healthRecord: r });
});

router.get("/physical/health/alerts", (req, res) => {
  const { resolved, limit } = req.query;
  ok(res, dhe().listAlerts({ resolved: resolved === "true", limit: limit ? parseInt(limit) : 50 }));
});

router.post("/physical/health/alert/:id/resolve", (req, res) => {
  const r = dhe().resolveAlert(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/physical/health", (req, res) => {
  const { level, adapterType, limit } = req.query;
  ok(res, dhe().listHealthRecords({ level, adapterType, limit: limit ? parseInt(limit) : 100 }));
});

// ── Physical Workflow ─────────────────────────────────────────────────────────

router.post("/physical/workflow/run", async (req, res) => {
  const r = await pwf().runWorkflow(req.body || {});
  ok(res, r);
});

router.get("/physical/workflow/stats", (req, res) => {
  ok(res, pwf().getStats());
});

router.get("/physical/workflow/:id", (req, res) => {
  const w = pwf().getWorkflow(req.params.id);
  if (!w) return err(res, "workflow not found", 404);
  ok(res, { workflow: w });
});

router.get("/physical/workflows", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pwf().listWorkflows({ status, limit: limit ? parseInt(limit) : 20 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/physical/dashboard", (req, res) => {
  ok(res, pdb().getDashboard());
});

router.get("/physical/pipeline", (req, res) => {
  ok(res, pdb().getPipelineView());
});

router.get("/physical/health-system", (req, res) => {
  ok(res, pdb().getPhysicalSystemHealth());
});

module.exports = router;
