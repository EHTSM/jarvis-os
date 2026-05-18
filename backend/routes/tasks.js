"use strict";
/**
 * Task queue routes — operational task management.
 *
 * All routes require operator authentication (gated via
 * router.use("/runtime", requireAuth) in routes/index.js, or
 * the explicit requireAuth guard added at mount time in index.js).
 *
 * GET  /tasks            — list all tasks
 * POST /tasks            — add a task to the autonomous queue
 * DELETE /tasks/:id      — cancel a task
 * GET  /scheduler/status — diagnostic: queue depth + status counts
 * GET  /queue/status     — diagnostic: metrics-collector queue snapshot
 */

const express   = require("express");
const router    = express.Router();
const path      = require("path");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);

// ── Module loaders ────────────────────────────────────────────────
const ROOT_AGENTS  = path.join(__dirname, "../../agents/");
const autonomousLoop = (() => { try { return require(ROOT_AGENTS + "autonomousLoop.cjs"); } catch { return null; } })();
const taskQueueMod   = (() => { try { return require(ROOT_AGENTS + "taskQueue.cjs");     } catch { return null; } })();

const MC_PATH = path.join(ROOT_AGENTS, "metrics/metricsCollector.cjs");
let _mc = null;
function _getMC() {
    if (!_mc) { try { _mc = require(MC_PATH); } catch { _mc = null; } }
    return _mc;
}

// ── GET /tasks — list all queued tasks ────────────────────────────
router.get("/tasks", (req, res) => {
    if (!taskQueueMod) return res.status(503).json({ error: "Task queue unavailable" });
    try {
        const tasks = taskQueueMod.getAll();
        res.json({ success: true, count: tasks.length, tasks });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /tasks — add a task to the autonomous queue ──────────────
router.post("/tasks", (req, res) => {
    if (!autonomousLoop) return res.status(503).json({ error: "Autonomous loop unavailable" });
    const { input, scheduledFor, recurringCron, type } = req.body || {};
    if (!input) return res.status(400).json({ error: "input is required" });
    try {
        const task = autonomousLoop.addTask({ input, scheduledFor, recurringCron, type });
        res.json({ success: true, task });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /tasks/:id — cancel a task ────────────────────────────
router.delete("/tasks/:id", (req, res) => {
    if (!taskQueueMod) return res.status(503).json({ error: "Task queue unavailable" });
    try {
        const updated = taskQueueMod.update(req.params.id, { status: "cancelled" });
        if (!updated) return res.status(404).json({ error: "Task not found" });
        res.json({ success: true, task: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /scheduler/status — diagnostic ───────────────────────────
router.get("/scheduler/status", (req, res) => {
    try {
        const all     = taskQueueMod ? taskQueueMod.getAll() : [];
        const pending = all.filter(t => t.status === "pending").length;
        const running = all.filter(t => t.status === "running").length;
        res.json({ success: true, status: "active", mode: "taskQueue", pending, running, total: all.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /queue/status — metrics snapshot ─────────────────────────
router.get("/queue/status", (req, res) => {
    const mc = _getMC();
    if (!mc) return res.status(503).json({ error: "Metrics collector unavailable" });
    try {
        res.json({ success: true, ...mc.queueStatus() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
