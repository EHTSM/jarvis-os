"use strict";
/**
 * ACP-4 Decision Routes
 *
 * POST /coding/decisions/compute     — run smell scan + score + rank
 * GET  /coding/decisions             — load cached opportunities
 * GET  /coding/decisions/dashboard   — dashboard metrics + debt history
 * GET  /coding/decisions/history     — debt history snapshots
 * POST /coding/decisions/approve     — approve single opportunity
 * POST /coding/decisions/approve-top — approve top N
 * POST /coding/decisions/schedule    — schedule opportunity
 * POST /coding/decisions/ignore      — ignore opportunity
 * POST /coding/decisions/merge       — merge duplicate opportunities
 * POST /coding/decisions/convert     — convert opportunity → mission
 */

const router = require("express").Router();
const path   = require("path");
const logger = require("../utils/logger");
const { requireAuth } = require("../middleware/authMiddleware");

function _de() {
    try { return require("../services/engineeringDecisionEngine.cjs"); }
    catch { return null; }
}

// ── POST /coding/decisions/compute ────────────────────────────────────────────
router.post("/coding/decisions/compute", requireAuth, async (req, res) => {
    try {
        const { cwd } = req.body;
        const root    = cwd || path.join(__dirname, "../../");
        const de      = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });

        const result = de.computeOpportunities(root);
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[Decisions/compute] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/decisions ─────────────────────────────────────────────────────
router.get("/coding/decisions", requireAuth, (req, res) => {
    try {
        const de   = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const data = de.loadOpportunities();
        if (!data) return res.json({ ok: true, opportunities: [], summary: null, lastRun: null });
        res.json({ ok: true, ...data });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/decisions/dashboard ──────────────────────────────────────────
router.get("/coding/decisions/dashboard", requireAuth, (req, res) => {
    try {
        const de = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const metrics = de.getDashboardMetrics();
        res.json({ ok: true, metrics });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /coding/decisions/history ─────────────────────────────────────────────
router.get("/coding/decisions/history", requireAuth, (req, res) => {
    try {
        const { limit } = req.query;
        const de        = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        res.json({ ok: true, ...de.getDebtHistory(limit ? Number(limit) : 30) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/decisions/approve ────────────────────────────────────────────
router.post("/coding/decisions/approve", requireAuth, (req, res) => {
    try {
        const { id }  = req.body;
        if (!id) return res.status(400).json({ ok: false, error: "id required" });
        const de = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const result = de.approve(id);
        res.json({ ok: true, opportunity: result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/decisions/approve-top ───────────────────────────────────────
router.post("/coding/decisions/approve-top", requireAuth, (req, res) => {
    try {
        const { n } = req.body;
        const de    = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const result = de.approveTop(n ?? 5);
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/decisions/schedule ───────────────────────────────────────────
router.post("/coding/decisions/schedule", requireAuth, (req, res) => {
    try {
        const { id, when } = req.body;
        if (!id) return res.status(400).json({ ok: false, error: "id required" });
        const de = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const result = de.scheduleLater(id, when);
        res.json({ ok: true, opportunity: result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/decisions/ignore ─────────────────────────────────────────────
router.post("/coding/decisions/ignore", requireAuth, (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ ok: false, error: "id required" });
        const de = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const result = de.ignore(id);
        res.json({ ok: true, opportunity: result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/decisions/merge ──────────────────────────────────────────────
router.post("/coding/decisions/merge", requireAuth, (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || ids.length < 2) return res.status(400).json({ ok: false, error: "need at least 2 ids" });
        const de = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const result = de.mergeOpportunities(ids);
        res.json({ ok: true, merged: result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /coding/decisions/convert ────────────────────────────────────────────
router.post("/coding/decisions/convert", requireAuth, (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ ok: false, error: "id required" });
        const de = _de();
        if (!de) return res.status(503).json({ ok: false, error: "decision engine unavailable" });
        const mission = de.convertToMission(id);
        res.json({ ok: true, mission });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
