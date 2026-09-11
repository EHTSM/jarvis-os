"use strict";
/**
 * ACP-8 Autonomous Engineering Agent Routes
 *
 * POST /autonomous/start               — start a mission from a composer planId
 * POST /autonomous/:id/pause           — request pause
 * POST /autonomous/:id/resume          — resume a paused mission
 * POST /autonomous/:id/cancel          — cancel + auto-rollback
 * POST /autonomous/:id/retry           — retry a failed/cancelled mission
 * POST /autonomous/benchmark           — run 10-scenario benchmark
 *
 * GET  /autonomous                     — list missions (all or by status)
 * GET  /autonomous/stats               — aggregate stats
 * GET  /autonomous/:id                 — get single mission with full timeline
 */

const router = require("express").Router();
const logger = require("../utils/logger");
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg } = require("../middleware/orgMiddleware.cjs");
const { assertOwnable } = require("../services/resourceOwnership.cjs");

function _ae() {
    try { return require("../services/autonomousEngineeringAgent.cjs"); }
    catch (e) { logger.error(`[AutonomousAgent] engine load: ${e.message}`); return null; }
}

// Mission 51 (2026-08-26): attachOrg must run AFTER requireAuth (its
// auto-resolve path needs req.user) — each route below already composes its
// own requireAuth individually rather than a single router.use, so attachOrg
// is composed the same way per-route rather than at a file-level router.use
// that would run before requireAuth.

// ── POST /autonomous/start ────────────────────────────────────────────────────
router.post("/autonomous/start", requireAuth, attachOrg, async (req, res) => {
    try {
        const { planId } = req.body;
        if (!planId?.trim()) return res.status(400).json({ ok: false, error: "planId required" });

        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });

        // Run async — respond when terminal state reached
        const mission = await ae.startMission(planId, req.org?.id);
        res.json({ ok: true, mission });
    } catch (err) {
        logger.error(`[Autonomous/start] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /autonomous/benchmark ────────────────────────────────────────────────
router.post("/autonomous/benchmark", requireAuth, async (req, res) => {
    try {
        const { goals, cwd } = req.body;
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });

        const report = await ae.runBenchmark(goals || [], cwd);
        res.json({ ok: true, report });
    } catch (err) {
        logger.error(`[Autonomous/benchmark] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Mission 51 (2026-08-26): cross-tenant IDOR on pause/resume/cancel/retry —
// caller-supplied :id, no ownership check. assertOwnable() allows
// orgId-less agent missions (unchanged, existing default) and denies only
// when the mission has a real orgId the caller doesn't belong to.

// ── POST /autonomous/:id/pause ────────────────────────────────────────────────
router.post("/autonomous/:id/pause", requireAuth, attachOrg, (req, res) => {
    try {
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        assertOwnable(req, ae.getMissionStatus(req.params.id), "mission not found");
        const mission = ae.pauseMission(req.params.id);
        res.json({ ok: true, mission });
    } catch (err) {
        res.status(err.message?.includes("not found") ? 404 : 400).json({ ok: false, error: err.message });
    }
});

// ── POST /autonomous/:id/resume ───────────────────────────────────────────────
router.post("/autonomous/:id/resume", requireAuth, attachOrg, async (req, res) => {
    try {
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        assertOwnable(req, ae.getMissionStatus(req.params.id), "mission not found");
        const mission = await ae.resumeMission(req.params.id);
        res.json({ ok: true, mission });
    } catch (err) {
        logger.error(`[Autonomous/resume] ${err.message}`);
        res.status(err.message?.includes("not found") ? 404 : 500).json({ ok: false, error: err.message });
    }
});

// ── POST /autonomous/:id/cancel ───────────────────────────────────────────────
router.post("/autonomous/:id/cancel", requireAuth, attachOrg, (req, res) => {
    try {
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        assertOwnable(req, ae.getMissionStatus(req.params.id), "mission not found");
        const mission = ae.cancelMission(req.params.id);
        res.json({ ok: true, mission });
    } catch (err) {
        res.status(err.message?.includes("not found") ? 404 : 400).json({ ok: false, error: err.message });
    }
});

// ── POST /autonomous/:id/retry ────────────────────────────────────────────────
router.post("/autonomous/:id/retry", requireAuth, attachOrg, async (req, res) => {
    try {
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        assertOwnable(req, ae.getMissionStatus(req.params.id), "mission not found");
        const mission = await ae.retryMission(req.params.id);
        res.json({ ok: true, mission });
    } catch (err) {
        logger.error(`[Autonomous/retry] ${err.message}`);
        res.status(err.message?.includes("not found") ? 404 : 500).json({ ok: false, error: err.message });
    }
});

// ── GET /autonomous/stats ─────────────────────────────────────────────────────
router.get("/autonomous/stats", requireAuth, (req, res) => {
    try {
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        res.json({ ok: true, stats: ae.getStatistics() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /autonomous ───────────────────────────────────────────────────────────
router.get("/autonomous", requireAuth, (req, res) => {
    try {
        const { status, limit } = req.query;
        const ae                = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        const missions = ae.listRunning({ status, limit: limit ? Number(limit) : 20 });
        res.json({ ok: true, missions });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /autonomous/:id ───────────────────────────────────────────────────────
router.get("/autonomous/:id", requireAuth, attachOrg, (req, res) => {
    try {
        const ae = _ae();
        if (!ae) return res.status(503).json({ ok: false, error: "autonomous agent engine unavailable" });
        const mission = ae.getMissionStatus(req.params.id);
        if (!mission) return res.status(404).json({ ok: false, error: "mission not found" });
        assertOwnable(req, mission, "mission not found");
        res.json({ ok: true, mission });
    } catch (err) {
        res.status(err.message?.includes("not found") ? 404 : 500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
