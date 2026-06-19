"use strict";
/**
 * Engineering Memory Routes — ACP-10
 * Exposes engineeringMemoryEngine over HTTP.
 */

const router = require("express").Router();
const engine = require("../services/engineeringMemoryEngine.cjs");

function ok(res, data)        { res.json({ ok: true, ...data }); }
function err(res, e, code=500){ res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// Remember — proxy to existing stores
router.post("/memory/remember", async (req, res) => {
    try {
        const { type, missionId, data, metadata } = req.body || {};
        if (!type) return res.status(400).json({ ok: false, error: "type required" });
        ok(res, await engine.remember({ type, missionId, data, metadata }));
    } catch (e) { err(res, e); }
});

// Unified recall
router.post("/memory/recall", async (req, res) => {
    try {
        const { query, limit, sources } = req.body || {};
        if (!query) return res.status(400).json({ ok: false, error: "query required" });
        ok(res, await engine.recall({ query, limit: limit || 20, sources: sources || ["all"] }));
    } catch (e) { err(res, e); }
});

// Similar problems
router.post("/memory/similar-problems", (req, res) => {
    try {
        const { description, limit } = req.body || {};
        if (!description) return res.status(400).json({ ok: false, error: "description required" });
        ok(res, engine.findSimilarProblems(description, limit || 10));
    } catch (e) { err(res, e); }
});

// Similar patches
router.post("/memory/similar-patches", (req, res) => {
    try {
        const { targetFile, reasonHint, limit } = req.body || {};
        ok(res, engine.findSimilarPatches(targetFile || "", reasonHint || "", limit || 10));
    } catch (e) { err(res, e); }
});

// Successful strategies
router.post("/memory/successful-strategies", (req, res) => {
    try {
        const { goal, limit } = req.body || {};
        if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
        ok(res, engine.findSuccessfulStrategies(goal, limit || 10));
    } catch (e) { err(res, e); }
});

// Predict best solution
router.post("/memory/predict-solution", (req, res) => {
    try {
        const { goal } = req.body || {};
        if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
        ok(res, engine.predictBestSolution(goal));
    } catch (e) { err(res, e); }
});

// Predict failure risk
router.post("/memory/predict-risk", async (req, res) => {
    try {
        const { goal, files } = req.body || {};
        if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
        ok(res, await engine.predictFailureRisk(goal, files || []));
    } catch (e) { err(res, e); }
});

// Compare with history
router.post("/memory/compare-history", (req, res) => {
    try {
        const { goal, metrics } = req.body || {};
        if (!goal) return res.status(400).json({ ok: false, error: "goal required" });
        ok(res, engine.compareWithHistory(goal, metrics || {}));
    } catch (e) { err(res, e); }
});

// Evolve knowledge (trigger full learning + RCA + backfill)
router.post("/memory/evolve", async (req, res) => {
    try { ok(res, await engine.evolveKnowledge()); }
    catch (e) { err(res, e); }
});

// Statistics
router.get("/memory/stats", (_req, res) => {
    try { ok(res, { stats: engine.getStatistics() }); }
    catch (e) { err(res, e); }
});

// Timeline
router.get("/memory/timeline", (req, res) => {
    try {
        const limit = Number(req.query.limit) || 60;
        ok(res, engine.getTimeline(limit));
    } catch (e) { err(res, e); }
});

// Knowledge growth (for chart)
router.get("/memory/growth", (_req, res) => {
    try { ok(res, engine.getKnowledgeGrowth()); }
    catch (e) { err(res, e); }
});

// Benchmark
router.post("/memory/benchmark", async (req, res) => {
    try { ok(res, { benchmark: await engine.runBenchmark() }); }
    catch (e) { err(res, e); }
});

module.exports = router;
