"use strict";
/**
 * V6 Phase 3 — Docker Orchestration routes
 * Prefix: /computer/docker/*
 *
 * Read-only routes: requireAuth (matches /computer/terminal/* precedent —
 * dockerController.cjs's own reference-format validation + narrow op
 * surface is the real safety boundary, same discipline as terminalController).
 * Mutating routes (start/stop/restart/rm/exec/build/compose *): requireAuth +
 * operatorOnly — real infrastructure control, matching the same gate applied
 * to /dop2/vps/run and revenueOS.js's billing routes.
 */

const router = require("express").Router();

const _try = fn => { try { return fn(); } catch { return null; } };
const { requireAuth: _realRequireAuth, operatorOnly: _realOperatorOnly } = _try(() => require("../middleware/authMiddleware")) || {};
const requireAuth   = _realRequireAuth   || ((req, res) => res.status(500).json({ ok: false, error: "auth middleware unavailable" }));
const operatorOnly  = _realOperatorOnly  || ((req, res) => res.status(500).json({ ok: false, error: "auth middleware unavailable" }));

const _dkc = () => _try(() => require("../services/dockerController.cjs"));

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }
function _unavailable(res) { res.status(503).json({ ok: false, error: "dockerController unavailable" }); }

// ── Dashboard / health / stats ──────────────────────────────────────────────

router.get("/computer/docker/dashboard", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  _ok(res, svc.getDashboard());
});
router.get("/computer/docker/health", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.daemonHealth());
});
router.get("/computer/docker/stats", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  _ok(res, { stats: svc.getStats() });
});
router.get("/computer/docker/history", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { limit } = req.query;
  _ok(res, { history: svc.listHistory({ limit: limit ? +limit : 50 }) });
});

// ── Containers ───────────────────────────────────────────────────────────────

router.get("/computer/docker/containers", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { all } = req.query;
  res.json(svc.listContainers({ all: all === "true" || all === "1" }));
});
router.get("/computer/docker/containers/:ref/inspect", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.inspectContainer(req.params.ref));
});
router.get("/computer/docker/containers/:ref/logs", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.containerLogs(req.params.ref, { tail: req.query.tail }));
});
router.get("/computer/docker/containers/:ref/stats", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.containerStats(req.params.ref));
});
router.get("/computer/docker/containers/:ref/health", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.containerHealth(req.params.ref));
});

router.post("/computer/docker/containers/:ref/start", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.startContainer(req.params.ref));
});
router.post("/computer/docker/containers/:ref/stop", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.stopContainer(req.params.ref));
});
router.post("/computer/docker/containers/:ref/restart", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.restartContainer(req.params.ref));
});
router.delete("/computer/docker/containers/:ref", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { force } = req.query;
  res.json(svc.removeContainer(req.params.ref, { force: force === "true" || force === "1" }));
});
router.post("/computer/docker/containers/:ref/exec", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { cmd, args } = req.body || {};
  if (!cmd) return res.status(400).json({ ok: false, error: "cmd required" });
  res.json(svc.execInContainer(req.params.ref, cmd, Array.isArray(args) ? args : []));
});

// ── Images / build ────────────────────────────────────────────────────────────

router.get("/computer/docker/images", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.listImages());
});
router.post("/computer/docker/build", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { dockerfile, context, tag } = req.body || {};
  res.json(svc.buildImage({ dockerfile, context, tag }));
});

// ── Compose ────────────────────────────────────────────────────────────────────

router.get("/computer/docker/compose/status", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.composeStatus({ composeFile: req.query.composeFile }));
});
router.get("/computer/docker/compose/logs", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.composeLogs({ composeFile: req.query.composeFile, service: req.query.service, tail: req.query.tail }));
});
router.post("/computer/docker/compose/up", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { composeFile, services, detach } = req.body || {};
  res.json(svc.composeUp({ composeFile, services, detach: detach !== false }));
});
router.post("/computer/docker/compose/down", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  const { composeFile, removeVolumes } = req.body || {};
  res.json(svc.composeDown({ composeFile, removeVolumes: !!removeVolumes }));
});
router.post("/computer/docker/compose/rollback/:snapshotId", requireAuth, operatorOnly, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.composeRollback(req.params.snapshotId));
});

// ── Networks / volumes ────────────────────────────────────────────────────────

router.get("/computer/docker/networks", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.listNetworks());
});
router.get("/computer/docker/volumes", requireAuth, (req, res) => {
  const svc = _dkc(); if (!svc) return _unavailable(res);
  res.json(svc.listVolumes());
});

module.exports = router;
