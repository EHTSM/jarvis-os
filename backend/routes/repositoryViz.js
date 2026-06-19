"use strict";
/**
 * Repository Visualization Routes — ACP-9
 * Exposes the repositoryVisualizationEngine API over HTTP.
 */

const router  = require("express").Router();
const engine  = require("../services/repositoryVisualizationEngine.cjs");
const path    = require("path");

const ROOT = path.resolve(__dirname, "../../");

function ok(res, data)   { res.json({ ok: true, ...data }); }
function err(res, e, code = 500) { res.status(code).json({ ok: false, error: e?.message || String(e) }); }

// Build full repository map (expensive — cached for 5 min)
router.post("/repo-viz/map", async (req, res) => {
    try {
        const cwd = req.body?.cwd || ROOT;
        const map = await engine.buildRepositoryMap(cwd);
        ok(res, { map });
    } catch (e) { err(res, e); }
});

// Return cached map stats without rebuilding
router.get("/repo-viz/stats", (_req, res) => {
    try { ok(res, { stats: engine.getStatistics() }); }
    catch (e) { err(res, e); }
});

// Module-level dependency graph
router.get("/repo-viz/module-graph", (_req, res) => {
    try { ok(res, engine.buildModuleGraph()); }
    catch (e) { err(res, e); }
});

// File-level dependency graph (top N by connectivity)
router.get("/repo-viz/dep-graph", (req, res) => {
    try {
        const maxNodes = Number(req.query.maxNodes) || 80;
        ok(res, engine.buildDependencyGraph(maxNodes));
    } catch (e) { err(res, e); }
});

// Call graph for a specific file
router.get("/repo-viz/call-graph", (req, res) => {
    try {
        const filePath = req.query.file;
        if (!filePath) return res.status(400).json({ ok: false, error: "file param required" });
        ok(res, engine.buildCallGraph(filePath));
    } catch (e) { err(res, e); }
});

// Ownership graph (missions + type ownership)
router.get("/repo-viz/ownership", (_req, res) => {
    try { ok(res, engine.buildOwnershipGraph()); }
    catch (e) { err(res, e); }
});

// Impact graph for a node
router.get("/repo-viz/impact/:nodeId", (req, res) => {
    try { ok(res, engine.buildImpactGraph(req.params.nodeId)); }
    catch (e) { err(res, e); }
});

// Critical paths
router.get("/repo-viz/critical-paths", (_req, res) => {
    try { ok(res, engine.findCriticalPaths()); }
    catch (e) { err(res, e); }
});

// Hotspots
router.get("/repo-viz/hotspots", (_req, res) => {
    try { ok(res, engine.findHotspots()); }
    catch (e) { err(res, e); }
});

// Node detail (click a node)
router.get("/repo-viz/node/:nodeId", async (req, res) => {
    try { ok(res, await engine.getNodeDetail(req.params.nodeId)); }
    catch (e) { err(res, e); }
});

// AI navigation — "show me auth"
router.post("/repo-viz/ai-nav", async (req, res) => {
    try {
        const { query, cwd } = req.body || {};
        if (!query) return res.status(400).json({ ok: false, error: "query required" });
        const result = await engine.aiNavigate(query, cwd || ROOT);
        ok(res, result);
    } catch (e) { err(res, e); }
});

// Benchmark — runs all 10 scenarios
router.post("/repo-viz/benchmark", async (req, res) => {
    try {
        const result = await engine.runBenchmark(req.body?.cwd || ROOT);
        ok(res, { benchmark: result });
    } catch (e) { err(res, e); }
});

module.exports = router;
