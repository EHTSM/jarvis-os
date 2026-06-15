"use strict";
/**
 * mission.js — J1 Unified Mission Runtime routes
 *
 * Exposes the missionRuntime orchestration layer via HTTP.
 * Storage authority: missionMemory.cjs (data/missions.json)
 * Live events: runtimeEventBus.cjs (SSE — already at /runtime/stream)
 *
 * Routes:
 *   POST   /mission/runtime/start/:id        startMission
 *   POST   /mission/runtime/complete/:id     completeMission
 *   POST   /mission/runtime/fail/:id         failMission
 *   POST   /mission/runtime/cancel/:id       cancelMission
 *   PATCH  /mission/runtime/:id/subtask/:sid updateSubtaskStatus
 *   GET    /mission/runtime/status           runtimeStatus snapshot
 *   GET    /mission/runtime/active           active mission
 *
 *   GET    /mission/timeline/:id             getExecutionTimeline
 *   GET    /mission/graph/:id                getDependencyGraph
 *   GET    /mission/replay/:id               replayMission (from missionMemory)
 *   GET    /mission/state/:id                mission status + metrics
 */

const router  = require("express").Router();
const runtime = require("../../agents/runtime/missionRuntime.cjs");
const memory  = require("../services/missionMemory.cjs");
const logger  = require("../utils/logger");

function _send(res, fn) {
    try {
        const result = fn();
        res.json({ success: true, ...result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404
                     : err.message.includes("Invalid transition") ? 409
                     : 500;
        logger.warn(`[Mission API] ${err.message}`);
        res.status(status).json({ success: false, error: err.message });
    }
}

async function _sendAsync(res, fn) {
    try {
        const result = await fn();
        res.json({ success: true, ...result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404
                     : err.message.includes("Invalid transition") ? 409
                     : 500;
        logger.warn(`[Mission API] ${err.message}`);
        res.status(status).json({ success: false, error: err.message });
    }
}

// ── Mission Runtime API ───────────────────────────────────────────────────────

router.post("/mission/runtime/start/:id", (req, res) => {
    _send(res, () => ({ mission: runtime.startMission(req.params.id) }));
});

router.post("/mission/runtime/complete/:id", (req, res) => {
    const { summary } = req.body || {};
    _send(res, () => ({ mission: runtime.completeMission(req.params.id, { summary }) }));
});

router.post("/mission/runtime/fail/:id", (req, res) => {
    const { reason } = req.body || {};
    _send(res, () => ({ mission: runtime.failMission(req.params.id, reason) }));
});

router.post("/mission/runtime/cancel/:id", (req, res) => {
    const { reason } = req.body || {};
    _send(res, () => ({ mission: runtime.cancelMission(req.params.id, reason) }));
});

router.patch("/mission/runtime/:id/subtask/:sid", (req, res) => {
    const { status, output } = req.body || {};
    if (!status) return res.status(400).json({ success: false, error: "status required" });
    _send(res, () => ({
        mission: runtime.updateSubtaskStatus(req.params.id, req.params.sid, status, output ?? null),
    }));
});

router.get("/mission/runtime/status", (req, res) => {
    _send(res, () => ({ status: runtime.runtimeStatus() }));
});

router.get("/mission/runtime/active", (req, res) => {
    _send(res, () => ({ mission: runtime.getActiveMission() }));
});

// ── Mission Timeline API ──────────────────────────────────────────────────────

router.get("/mission/timeline/:id", (req, res) => {
    _send(res, () => ({ timeline: runtime.getExecutionTimeline(req.params.id) }));
});

// ── Mission Graph API ─────────────────────────────────────────────────────────

router.get("/mission/graph/:id", (req, res) => {
    _send(res, () => ({ graph: runtime.getDependencyGraph(req.params.id) }));
});

// ── Mission Replay API (delegates to missionMemory) ──────────────────────────

router.get("/mission/replay/:id", (req, res) => {
    _send(res, () => ({ replay: memory.replayMission(req.params.id) }));
});

// ── Mission State API ─────────────────────────────────────────────────────────

router.get("/mission/state/:id", (req, res) => {
    _send(res, () => {
        const mission = memory.getMission(req.params.id);
        if (!mission) throw new Error(`Mission not found: ${req.params.id}`);
        return {
            state: {
                id:          mission.id,
                objective:   mission.objective,
                status:      mission.status,
                priority:    mission.priority,
                createdAt:   mission.createdAt,
                startedAt:   mission.startedAt  || null,
                completedAt: mission.completedAt || null,
                metrics:     mission.metrics,
                subtaskCount: mission.subtasks.length,
                failureCount: (mission.failures || []).length,
            },
        };
    });
});

module.exports = router;
