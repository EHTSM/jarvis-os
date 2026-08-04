"use strict";
/**
 * V6 Phase 8 (Personal JARVIS) — Daily Planning routes
 * Prefix: /planning/*
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _svc() { return require("../services/dailyPlanningEngine.cjs"); }
function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 400).json({ ok: false, error: e?.message || String(e) }); }

router.get("/planning/agenda", requireAuth, (req, res) => {
  try { _ok(res, _svc().getAgenda()); } catch (e) { _err(res, e, 500); }
});

router.get("/planning/tasks", requireAuth, (req, res) => {
  const { done, priority, dueBefore, limit } = req.query;
  _ok(res, { tasks: _svc().listTasks({ done, priority, dueBefore, limit: limit ? +limit : 100 }) });
});

router.post("/planning/tasks", requireAuth, (req, res) => {
  const { title, dueDate, priority, notes, source } = req.body || {};
  const r = _svc().createTask({ title, dueDate, priority, notes, source });
  if (!r.ok) return _err(res, new Error(r.error), 400);
  _ok(res, r);
});

router.post("/planning/tasks/:id/complete", requireAuth, (req, res) => {
  const r = _svc().completeTask(req.params.id);
  if (!r.ok) return _err(res, new Error(r.error), 404);
  _ok(res, r);
});

router.delete("/planning/tasks/:id", requireAuth, (req, res) => {
  const r = _svc().deleteTask(req.params.id);
  if (!r.ok) return _err(res, new Error(r.error), 404);
  _ok(res, r);
});

router.get("/planning/stats", requireAuth, (req, res) => {
  _ok(res, { stats: _svc().getStats() });
});

module.exports = router;
