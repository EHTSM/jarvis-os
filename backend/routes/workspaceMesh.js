"use strict";
/**
 * routes/workspaceMesh.js — POST-Ω Sprint P9 Autonomous Workspace Mesh
 * Routes at /workspace-mesh/*
 */

const router = require("express").Router();

const mesh    = require("../services/workspaceMesh.cjs");
const reg     = require("../services/workspaceRegistry.cjs");
const coord   = require("../services/workspaceCoordinator.cjs");
const sync    = require("../services/workspaceSynchronization.cjs");
const health  = require("../services/workspaceHealth.cjs");
const dash    = require("../services/workspaceDashboard.cjs");

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get( "/workspace-mesh/dashboard",       (req, res) => res.json(dash.getDashboard()));
router.get( "/workspace-mesh/summary",         (req, res) => res.json(dash.getMeshSummary()));
router.get( "/workspace-mesh/status",          (req, res) => res.json(mesh.getStatus()));
router.get( "/workspace-mesh/stats",           (req, res) => res.json(mesh.getStats()));

// ── Bootstrap & Execute ───────────────────────────────────────────────────────
router.post("/workspace-mesh/bootstrap",       (req, res) => res.json(mesh.bootstrap(req.body || {})));
router.post("/workspace-mesh/execute",         async (req, res) => {
  const { command, missionId, founder, skipApproval, parallel } = req.body || {};
  res.json(await mesh.execute(command, { missionId, founder, skipApproval, parallel }));
});
router.post("/workspace-mesh/route",           async (req, res) => {
  const { capability, command, missionId } = req.body || {};
  res.json(await mesh.routeToWorkspace(capability, command, { missionId }));
});
router.post("/workspace-mesh/recover/:id",     async (req, res) => res.json(await mesh.recover(req.params.id)));
router.get( "/workspace-mesh/executions",      (req, res) => res.json(mesh.listExecutions(req.query)));

// ── Registry ──────────────────────────────────────────────────────────────────
router.post("/workspace-mesh/workspaces",      (req, res) => res.json(reg.register(req.body || {})));
router.get( "/workspace-mesh/workspaces",      (req, res) => res.json({ ok: true, workspaces: reg.list(req.query) }));
router.get( "/workspace-mesh/workspaces/types",(req, res) => res.json({ ok: true, types: reg.WORKSPACE_TYPES }));
router.get( "/workspace-mesh/workspaces/stats",(req, res) => res.json(reg.getStats()));
router.get( "/workspace-mesh/workspaces/:id",  (req, res) => {
  const ws = reg.get(req.params.id);
  res.json(ws ? { ok: true, workspace: ws } : { ok: false, error: "not found" });
});
router.get( "/workspace-mesh/workspaces/:id/detail", (req, res) => res.json(dash.getWorkspaceDetail(req.params.id)));
router.patch("/workspace-mesh/workspaces/:id/status", (req, res) => {
  const { status, health: h } = req.body || {};
  res.json(reg.setStatus(req.params.id, status, h));
});
router.delete("/workspace-mesh/workspaces/:id", (req, res) => res.json(reg.deregister(req.params.id)));
router.post("/workspace-mesh/workspaces/:id/mission", (req, res) => {
  const { missionId } = req.body || {};
  res.json(reg.assignMission(req.params.id, missionId));
});

// ── Coordinator ───────────────────────────────────────────────────────────────
router.post("/workspace-mesh/coord/run",       async (req, res) => res.json(await coord.run(req.body || {})));
router.get( "/workspace-mesh/coord/runs",      (req, res) => res.json(coord.listRuns(req.query)));
router.get( "/workspace-mesh/coord/runs/:id",  (req, res) => {
  const run = coord.getRun(req.params.id);
  res.json(run ? { ok: true, run } : { ok: false, error: "not found" });
});
router.get( "/workspace-mesh/coord/runs/:id/graph", (req, res) => res.json(coord.getExecutionGraph(req.params.id)));
router.get( "/workspace-mesh/coord/stats",     (req, res) => res.json(coord.getStats()));
router.get( "/workspace-mesh/coord/routing",   (req, res) => res.json({ ok: true, domainRouting: coord.DOMAIN_ROUTING, capabilityMap: coord.CAPABILITY_MAP }));

// ── Synchronization ───────────────────────────────────────────────────────────
router.post("/workspace-mesh/sync/context",    (req, res) => res.json(sync.propagateContext(req.body || {})));
router.post("/workspace-mesh/sync/artifact",   (req, res) => res.json(sync.syncArtifact(req.body || {})));
router.post("/workspace-mesh/sync/env",        (req, res) => res.json(sync.syncEnv(req.body || {})));
router.post("/workspace-mesh/sync/mesh",       async (req, res) => res.json(await sync.syncMesh(req.body || {})));
router.get( "/workspace-mesh/sync/history",    (req, res) => res.json(sync.getSyncHistory(req.query)));
router.get( "/workspace-mesh/sync/snapshot/:id", (req, res) => {
  const s = sync.getSnapshot(req.params.id);
  res.json(s ? { ok: true, snapshot: s } : { ok: false, error: "not found" });
});
router.post("/workspace-mesh/sync/snapshot/:id", (req, res) => res.json(sync.setSnapshot(req.params.id, req.body || {})));
router.post("/workspace-mesh/sync/conflict",   (req, res) => res.json(sync.recordConflict(req.body || {})));
router.post("/workspace-mesh/sync/conflict/:id/resolve", (req, res) => res.json(sync.resolveConflict(req.params.id, req.body || {})));
router.get( "/workspace-mesh/sync/stats",      (req, res) => res.json(sync.getStats()));

// ── Health ────────────────────────────────────────────────────────────────────
router.post("/workspace-mesh/health/heartbeat/:id", (req, res) => res.json(health.heartbeat(req.params.id, req.body || {})));
router.get( "/workspace-mesh/health/check",    (req, res) => res.json(health.checkMesh()));
router.get( "/workspace-mesh/health/bottlenecks", (req, res) => res.json(health.detectBottlenecks()));
router.get( "/workspace-mesh/health/alerts",   (req, res) => res.json(health.getAlerts(req.query)));
router.post("/workspace-mesh/health/alerts/:id/ack", (req, res) => res.json(health.acknowledgeAlert(req.params.id)));
router.get( "/workspace-mesh/health/:id",      (req, res) => res.json(health.getWorkspaceMetrics(req.params.id)));
router.get( "/workspace-mesh/health/stats",    (req, res) => res.json(health.getStats()));

module.exports = router;
