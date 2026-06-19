"use strict";
/**
 * ACP-7 Composer Routes
 *
 * POST /composer/create         — compose a goal into a plan
 * POST /composer/:id/approve    — approve a plan for execution
 * POST /composer/:id/reject     — reject a plan
 * POST /composer/:id/execute    — execute an approved plan
 * POST /composer/:id/cancel     — cancel a plan / trigger rollback
 * POST /composer/benchmark      — run 10-scenario benchmark
 *
 * GET  /composer                — list plans
 * GET  /composer/stats          — aggregate stats
 * GET  /composer/history        — plan history (lightweight)
 * GET  /composer/:id            — get single plan
 */

const router = require("express").Router();
const logger = require("../utils/logger");
const { requireAuth } = require("../middleware/authMiddleware");

function _ce() {
    try { return require("../services/aiComposerEngine.cjs"); }
    catch (e) { logger.error(`[Composer] engine load: ${e.message}`); return null; }
}

// ── POST /composer/create ─────────────────────────────────────────────────────
router.post("/composer/create", requireAuth, async (req, res) => {
    try {
        const { goal, cwd, forceApproval } = req.body;
        if (!goal?.trim()) return res.status(400).json({ ok: false, error: "goal required" });

        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });

        const plan = await ce.composeGoal(goal, cwd, { forceApproval: !!forceApproval });
        res.json({ ok: true, plan });
    } catch (err) {
        logger.error(`[Composer/create] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /composer/benchmark ──────────────────────────────────────────────────
router.post("/composer/benchmark", requireAuth, async (req, res) => {
    try {
        const { scenarios, cwd } = req.body;
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });

        const report = await ce.runBenchmark(scenarios || [], cwd);
        res.json({ ok: true, report });
    } catch (err) {
        logger.error(`[Composer/benchmark] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /composer/:id/approve ────────────────────────────────────────────────
router.post("/composer/:id/approve", requireAuth, (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        const plan = ce.approvePlan(req.params.id);
        res.json({ ok: true, plan });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// ── POST /composer/:id/reject ─────────────────────────────────────────────────
router.post("/composer/:id/reject", requireAuth, (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        const plan = ce.rejectPlan(req.params.id, req.body?.reason || '');
        res.json({ ok: true, plan });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// ── POST /composer/:id/execute ────────────────────────────────────────────────
router.post("/composer/:id/execute", requireAuth, async (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        const result = await ce.executePlan(req.params.id);
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[Composer/execute] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /composer/:id/cancel ─────────────────────────────────────────────────
router.post("/composer/:id/cancel", requireAuth, (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        const plan = ce.cancelPlan(req.params.id);
        res.json({ ok: true, plan });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// ── GET /composer/stats ───────────────────────────────────────────────────────
router.get("/composer/stats", requireAuth, (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        res.json({ ok: true, stats: ce.getStats() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /composer/history ─────────────────────────────────────────────────────
router.get("/composer/history", requireAuth, (req, res) => {
    try {
        const { limit } = req.query;
        const ce        = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        res.json({ ok: true, history: ce.getHistory(limit ? Number(limit) : 20) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /composer ─────────────────────────────────────────────────────────────
router.get("/composer", requireAuth, (req, res) => {
    try {
        const { status, limit } = req.query;
        const ce                = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        const plans = ce.listPlans({ status, limit: limit ? Number(limit) : 20 });
        res.json({ ok: true, plans });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /composer/:id ─────────────────────────────────────────────────────────
router.get("/composer/:id", requireAuth, (req, res) => {
    try {
        const ce   = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "composer engine unavailable" });
        const plan = ce.getPlan(req.params.id);
        if (!plan) return res.status(404).json({ ok: false, error: "plan not found" });
        res.json({ ok: true, plan });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
