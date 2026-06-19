"use strict";
/**
 * Self-Improvement Routes — ACP-11
 * Exposes selfImprovementEngine over HTTP.
 */

const router = require("express").Router();
const engine = require("../services/selfImprovementEngine.cjs");

function ok(res, data)        { res.json({ ok: true, ...data }); }
function err(res, e, code=500){ res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// Analyze recent executions (7-day window)
router.get("/improvement/analyze", async (req, res) => {
    try { ok(res, await engine.analyzeRecentExecutions()); }
    catch (e) { err(res, e); }
});

// Discover patterns
router.get("/improvement/patterns", (req, res) => {
    try { ok(res, engine.discoverPatterns()); }
    catch (e) { err(res, e); }
});

// Generate rule candidates (preview before promotion)
router.get("/improvement/candidates", (req, res) => {
    try { ok(res, engine.generateRules()); }
    catch (e) { err(res, e); }
});

// Promote successful patterns as new rules
router.post("/improvement/promote", async (req, res) => {
    try { ok(res, await engine.promoteSuccessfulPatterns()); }
    catch (e) { err(res, e); }
});

// Retire weak rules (advisory — records lesson, no hard delete)
router.post("/improvement/retire", async (req, res) => {
    try { ok(res, await engine.retireWeakRules()); }
    catch (e) { err(res, e); }
});

// Confidence calibration
router.get("/improvement/confidence", async (req, res) => {
    try { ok(res, await engine.improveConfidence()); }
    catch (e) { err(res, e); }
});

// Architecture change recommendations
router.get("/improvement/architecture", async (req, res) => {
    try { ok(res, await engine.recommendArchitectureChanges()); }
    catch (e) { err(res, e); }
});

// Measure improvement scores
router.get("/improvement/measure", (req, res) => {
    try { ok(res, engine.measureImprovement()); }
    catch (e) { err(res, e); }
});

// Run full evolution cycle
router.post("/improvement/evolve", async (req, res) => {
    try { ok(res, await engine.runEvolutionCycle()); }
    catch (e) { err(res, e); }
});

// Statistics + recent cycles
router.get("/improvement/stats", (req, res) => {
    try { ok(res, engine.getStatistics()); }
    catch (e) { err(res, e); }
});

// Benchmark
router.post("/improvement/benchmark", async (req, res) => {
    try { ok(res, { benchmark: await engine.runBenchmark() }); }
    catch (e) { err(res, e); }
});

module.exports = router;
