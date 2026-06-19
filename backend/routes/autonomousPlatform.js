"use strict";
/**
 * Autonomous Engineering Platform Routes — ACP-12
 * All endpoints delegate to autonomousEngineeringPlatform.cjs.
 */

const router   = require("express").Router();
const platform = require("../services/autonomousEngineeringPlatform.cjs");

function ok(res, data)         { res.json({ ok: true,  ...data }); }
function err(res, e, code=500) { res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// ── Analysis & context ────────────────────────────────────────────────────────

// Analyze a goal before committing to execution
router.post("/platform/analyze", async (req, res) => {
    const { goal } = req.body || {};
    if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
    try { ok(res, await platform.analyzeGoal(goal)); }
    catch (e) { err(res, e); }
});

// Collect repository + memory context for a goal
router.post("/platform/context", async (req, res) => {
    const { goal } = req.body || {};
    if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
    try { ok(res, await platform.collectContext(goal)); }
    catch (e) { err(res, e); }
});

// ── Full goal execution ───────────────────────────────────────────────────────

// Submit a goal for autonomous end-to-end execution
router.post("/platform/run", async (req, res) => {
    const { goal, opts } = req.body || {};
    if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
    try { ok(res, await platform.runGoal(goal, opts || {})); }
    catch (e) { err(res, e); }
});

// ── Run history & inspection ──────────────────────────────────────────────────

// List recent platform runs
router.get("/platform/runs", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    try { ok(res, platform.getRunHistory(limit)); }
    catch (e) { err(res, e); }
});

// Get a single run by ID (full details + executive report)
router.get("/platform/runs/:runId", (req, res) => {
    try {
        const run = platform.getRun(req.params.runId);
        if (!run) return res.status(404).json({ ok: false, error: "run not found" });
        ok(res, { run });
    } catch (e) { err(res, e); }
});

// ── Executive report ──────────────────────────────────────────────────────────

// Generate / re-generate an executive report for a run
router.get("/platform/report/:runId", (req, res) => {
    try {
        const run = platform.getRun(req.params.runId);
        if (!run) return res.status(404).json({ ok: false, error: "run not found" });
        ok(res, { report: platform.generateExecutiveReport(run) });
    } catch (e) { err(res, e); }
});

// ── Benchmark & audit ─────────────────────────────────────────────────────────

// 10-scenario benchmark + architecture audit
router.post("/platform/benchmark", async (req, res) => {
    try { ok(res, { benchmark: await platform.benchmark() }); }
    catch (e) { err(res, e); }
});

module.exports = router;
