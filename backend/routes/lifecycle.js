"use strict";
/**
 * lifecycle.js — J3 Unified Autonomous Execution Loop routes
 *
 * All routes gated by requireAuth via barrel position in routes/index.js.
 *
 * Routes:
 *   GET  /runtime/lifecycle/:missionId   — full lifecycle state
 *   GET  /runtime/stage/:missionId       — current stage + confidence
 *   GET  /runtime/events/:missionId      — lifecycle event stream (poll)
 *   POST /runtime/pause/:missionId       — pause the lifecycle loop
 *   POST /runtime/resume/:missionId      — resume a paused loop
 *   POST /runtime/retry/:missionId       — retry the current failed stage
 *
 * Additional:
 *   POST /runtime/lifecycle/start/:missionId — attach lifecycle to a mission
 *   POST /runtime/lifecycle/tick/:missionId  — advance one stage (manual / for tests)
 */

const router    = require("express").Router();
const lifecycle = require("../../agents/runtime/lifecycleRuntime.cjs");
const logger    = require("../utils/logger");

function _ok(res, data) {
    res.json({ success: true, ...data });
}

function _err(res, err) {
    const status = err.message.includes("not found") ? 404 : 400;
    logger.warn(`[Lifecycle API] ${err.message}`);
    res.status(status).json({ success: false, error: err.message });
}

// ── GET /runtime/lifecycle/:missionId ────────────────────────────────────────
router.get("/runtime/lifecycle/:missionId", (req, res) => {
    try {
        _ok(res, lifecycle.getLifecycle(req.params.missionId));
    } catch (err) { _err(res, err); }
});

// ── GET /runtime/stage/:missionId ────────────────────────────────────────────
router.get("/runtime/stage/:missionId", (req, res) => {
    try {
        _ok(res, { stage: lifecycle.getCurrentStage(req.params.missionId) });
    } catch (err) { _err(res, err); }
});

// ── GET /runtime/events/:missionId ───────────────────────────────────────────
router.get("/runtime/events/:missionId", (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const result = lifecycle.getLifecycleEvents(req.params.missionId);
        const events = result.events.slice(
            Math.max(0, result.events.length - Number(limit) - Number(offset)),
            result.events.length - Number(offset) || undefined
        );
        _ok(res, { events, total: result.total, currentStage: result.currentStage, status: result.status });
    } catch (err) { _err(res, err); }
});

// ── POST /runtime/pause/:missionId ───────────────────────────────────────────
router.post("/runtime/pause/:missionId", (req, res) => {
    try {
        _ok(res, lifecycle.pauseLifecycle(req.params.missionId));
    } catch (err) { _err(res, err); }
});

// ── POST /runtime/resume/:missionId ──────────────────────────────────────────
router.post("/runtime/resume/:missionId", (req, res) => {
    try {
        _ok(res, lifecycle.resumeLifecycle(req.params.missionId));
    } catch (err) { _err(res, err); }
});

// ── POST /runtime/retry/:missionId ───────────────────────────────────────────
router.post("/runtime/retry/:missionId", (req, res) => {
    try {
        _ok(res, lifecycle.retryStage(req.params.missionId));
    } catch (err) { _err(res, err); }
});

// ── POST /runtime/lifecycle/start/:missionId ─────────────────────────────────
router.post("/runtime/lifecycle/start/:missionId", (req, res) => {
    try {
        _ok(res, lifecycle.startLifecycle(req.params.missionId, req.body || {}));
    } catch (err) { _err(res, err); }
});

// ── POST /runtime/lifecycle/tick/:missionId (manual advance) ─────────────────
router.post("/runtime/lifecycle/tick/:missionId", async (req, res) => {
    try {
        const result = await lifecycle.tick(req.params.missionId);
        _ok(res, { tick: result });
    } catch (err) { _err(res, err); }
});

module.exports = router;
