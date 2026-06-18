"use strict";
/**
 * pipeline.js — Phase I7: Autonomous Engineering Pipeline routes
 *
 * Pipeline execution (I7-1 through I7-5):
 *   POST /pipeline/run              — run pipeline from a goal
 *   GET  /pipeline/:id              — get pipeline state
 *   GET  /pipeline                  — list pipelines
 *   POST /pipeline/:id/approve      — approve commit gate
 *   POST /pipeline/:id/cancel       — cancel pipeline
 *
 * Dashboard data (I7-6):
 *   GET  /pipeline/active           — active pipelines with stage detail
 *   GET  /pipeline/stats            — aggregate stats
 *
 * End-to-end validation (I7-7):
 *   POST /pipeline/validate         — run 10 real scenarios via benchmark
 *   GET  /pipeline/validation/last  — last validation report
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _pc() { return require("../services/engineeringPipelineCoordinator.cjs"); }
function _ok(res, data)     { res.json({ ok: true, ...data }); }
function _err(res, e, code) { res.status(code || 500).json({ ok: false, error: e?.message || String(e) }); }

router.use(requireAuth);

// Must register specific routes BEFORE /:id

// GET /pipeline/active — BEFORE /:id
router.get("/pipeline/active", (req, res) => {
    try {
        const pipelines = _pc().getActivePipelines();
        _ok(res, { pipelines, total: pipelines.length });
    } catch (e) { _err(res, e); }
});

// GET /pipeline/stats — BEFORE /:id
router.get("/pipeline/stats", (req, res) => {
    try {
        _ok(res, { stats: _pc().getStats() });
    } catch (e) { _err(res, e); }
});

// GET /pipeline/validation/last — BEFORE /:id
router.get("/pipeline/validation/last", (req, res) => {
    try {
        const bench = require("../services/engineeringBenchmark.cjs");
        const report = bench.getReport();
        if (!report) return res.status(404).json({ ok: false, error: "No validation report available. POST /pipeline/validate to run." });
        _ok(res, { report });
    } catch (e) { _err(res, e); }
});

// GET /pipeline — list all pipelines
router.get("/pipeline", (req, res) => {
    try {
        const opts = { status: req.query.status, limit: req.query.limit ? parseInt(req.query.limit, 10) : 50 };
        _ok(res, _pc().listPipelines(opts));
    } catch (e) { _err(res, e); }
});

// POST /pipeline/run — run a new pipeline
router.post("/pipeline/run", async (req, res) => {
    try {
        const { goal, patchSpec, requireApproval, priority } = req.body || {};
        if (!goal?.trim()) return _err(res, new Error("goal is required"), 400);
        // Run async — return pipeline ID immediately, client polls /pipeline/:id
        const pipelinePromise = _pc().runPipeline(goal, { patchSpec, requireApproval, priority });
        // Return the pipeline immediately as it starts
        pipelinePromise.catch(err => require("../utils/logger").warn(`[PipelineRoute] pipeline error: ${err.message}`));
        // Give the pipeline 50ms to initialise before we return
        await new Promise(r => setTimeout(r, 50));
        const active = _pc().getActivePipelines();
        const started = active[active.length - 1] || null;
        _ok(res, { message: "Pipeline started", pipeline: started });
    } catch (e) { _err(res, e); }
});

// POST /pipeline/validate — I7-7 end-to-end validation
router.post("/pipeline/validate", async (req, res) => {
    try {
        // Long-running — respond immediately with accepted, validation runs async
        res.json({ ok: true, message: "I7-7 validation started. GET /pipeline/validation/last for results when complete." });
        _pc().runValidation(req.body || {}).catch(err => require("../utils/logger").warn(`[PipelineRoute] validation error: ${err.message}`));
    } catch (e) { _err(res, e); }
});

// GET /pipeline/:id
router.get("/pipeline/:id", (req, res) => {
    try {
        const p = _pc().getPipeline(req.params.id);
        if (!p) return res.status(404).json({ ok: false, error: "Pipeline not found" });
        _ok(res, { pipeline: p });
    } catch (e) { _err(res, e); }
});

// POST /pipeline/:id/approve
router.post("/pipeline/:id/approve", (req, res) => {
    try {
        const p = _pc().approvePipeline(req.params.id);
        _ok(res, { pipeline: p });
    } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 400); }
});

// POST /pipeline/:id/cancel
router.post("/pipeline/:id/cancel", (req, res) => {
    try {
        const p = _pc().cancelPipeline(req.params.id);
        _ok(res, { pipeline: p });
    } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 400); }
});

module.exports = router;
