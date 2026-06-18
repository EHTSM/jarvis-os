"use strict";
/**
 * graph.js — Phase Q1: Unified Knowledge Graph routes
 *
 * GET  /graph/stats                           — edge/node counts by type
 * GET  /graph/schema                          — NODE_TYPES and RELATIONS constants
 * POST /graph/index                           — (re)index all domains
 * POST /graph/index/mission/:missionId        — index one mission
 *
 * Edges:
 * GET  /graph/edges                           — query edges (?fromType, ?fromId, ?toType, ?toId, ?relation, ?limit)
 * POST /graph/edges                           — add edge manually
 * DELETE /graph/edges/:edgeId                 — remove edge
 *
 * Nodes:
 * GET  /graph/node/:type/:id                  — get node with its live data + all edges
 *
 * Traversal:
 * GET  /graph/traverse/:type/:id              — BFS subgraph (?maxDepth, ?relation, ?direction, ?maxNodes)
 * GET  /graph/related/:type/:id               — direct 1-hop neighbours (?relation, ?depth)
 *
 * Impact:
 * GET  /graph/impact/:type/:id                — impact analysis (what does this affect?)
 *
 * Cross-domain lookup:
 * GET  /graph/lookup/:type/:id/missions       — missions linked to any node
 * GET  /graph/lookup/:type/:id/org            — org linked to any node
 * GET  /graph/lookup/mission/:missionId/team  — team assigned to a mission
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _kg()  { return require("../services/knowledgeGraph.cjs"); }
function _ok(res, data)         { res.json({ ok: true, ...data }); }
function _err(res, e, fallback) { res.status(e.status || fallback || 500).json({ ok: false, error: e.message }); }

router.use(requireAuth);

// ── Schema + stats ────────────────────────────────────────────────────────────
router.get("/graph/schema", (req, res) => {
    const kg = _kg();
    _ok(res, { nodeTypes: kg.NODE_TYPES, relations: kg.RELATIONS });
});

router.get("/graph/stats", (req, res) => {
    try { _ok(res, _kg().getStats()); }
    catch (e) { _err(res, e); }
});

// ── Indexing ──────────────────────────────────────────────────────────────────
router.post("/graph/index", (req, res) => {
    try {
        const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";
        _ok(res, _kg().indexAll({ dryRun }));
    } catch (e) { _err(res, e); }
});

router.post("/graph/index/mission/:missionId", (req, res) => {
    try {
        const edges = _kg().indexMission(req.params.missionId);
        _ok(res, { indexed: edges.length, edges });
    } catch (e) { _err(res, e); }
});

// ── Edges ─────────────────────────────────────────────────────────────────────
router.get("/graph/edges", (req, res) => {
    try {
        const { fromType, fromId, toType, toId, relation, limit, offset } = req.query;
        _ok(res, _kg().getEdges({
            fromType, fromId, toType, toId, relation,
            limit:  limit  ? parseInt(limit, 10)  : 200,
            offset: offset ? parseInt(offset, 10) : 0,
        }));
    } catch (e) { _err(res, e); }
});

router.post("/graph/edges", (req, res) => {
    try {
        const { fromType, fromId, relation, toType, toId, weight, metadata } = req.body || {};
        if (!fromType || !fromId || !relation || !toType || !toId) {
            return res.status(400).json({ ok: false, error: "fromType, fromId, relation, toType, toId required" });
        }
        _ok(res, { edge: _kg().addEdge(fromType, fromId, relation, toType, toId, { weight, metadata }) });
    } catch (e) { _err(res, e, 400); }
});

router.delete("/graph/edges/:edgeId", (req, res) => {
    try { _ok(res, _kg().removeEdge(req.params.edgeId)); }
    catch (e) { _err(res, e, 404); }
});

// ── Node ──────────────────────────────────────────────────────────────────────
router.get("/graph/node/:type/:id", (req, res) => {
    try { _ok(res, _kg().getNode(req.params.type, req.params.id)); }
    catch (e) { _err(res, e); }
});

// ── Traversal ─────────────────────────────────────────────────────────────────
router.get("/graph/traverse/:type/:id", (req, res) => {
    try {
        const { maxDepth, relation, direction, maxNodes } = req.query;
        _ok(res, _kg().traverse(req.params.type, req.params.id, {
            maxDepth:  maxDepth  ? Math.min(5, parseInt(maxDepth, 10))  : 2,
            maxNodes:  maxNodes  ? Math.min(200, parseInt(maxNodes, 10)) : 50,
            relation,
            direction: direction || "both",
        }));
    } catch (e) { _err(res, e); }
});

router.get("/graph/related/:type/:id", (req, res) => {
    try {
        const { relation, depth } = req.query;
        const related = _kg().findRelated(req.params.type, req.params.id, relation, depth ? Math.min(3, parseInt(depth, 10)) : 1);
        _ok(res, { related, total: related.length });
    } catch (e) { _err(res, e); }
});

// ── Impact analysis ───────────────────────────────────────────────────────────
router.get("/graph/impact/:type/:id", (req, res) => {
    try { _ok(res, _kg().impactAnalysis(req.params.type, req.params.id)); }
    catch (e) { _err(res, e); }
});

// ── Cross-domain convenience lookups ─────────────────────────────────────────
router.get("/graph/lookup/:type/:id/missions", (req, res) => {
    try {
        const related = _kg().findRelated(req.params.type, req.params.id, null, 2)
            .filter(n => n.type === "mission");
        _ok(res, { missions: related, total: related.length });
    } catch (e) { _err(res, e); }
});

router.get("/graph/lookup/:type/:id/org", (req, res) => {
    try {
        const related = _kg().findRelated(req.params.type, req.params.id, null, 3)
            .filter(n => n.type === "org");
        _ok(res, { orgs: related, total: related.length });
    } catch (e) { _err(res, e); }
});

router.get("/graph/lookup/mission/:missionId/team", (req, res) => {
    try {
        const teams = _kg().findRelated("mission", req.params.missionId, "assigned_to", 1)
            .filter(n => n.type === "team");
        _ok(res, { teams, total: teams.length });
    } catch (e) { _err(res, e); }
});

// ── Q2-6 Reasoning routes ─────────────────────────────────────────────────────
function _re() { return require("../services/graphReasoningEngine.cjs"); }

router.get("/graph/reasoning", (req, res) => {
    try {
        const re = _re();
        _ok(res, {
            criticalDependencies:  re.findCriticalDependencies({ limit: parseInt(req.query.limit)||10 }),
            singlePointsOfFailure: re.findSinglePointsOfFailure({ limit: 5 }),
            blockedMissions:       re.findBlockedMissions({ limit: parseInt(req.query.limit)||10 }),
            missionClusters:       re.findMissionClusters({ limit: 5 }),
            highRiskOwners:        re.findHighRiskOwners({ limit: 5 }),
            highRiskOrgs:          re.findHighRiskOrganizations({ limit: 5 }),
            knowledgeGaps:         re.findKnowledgeGaps({ limit: parseInt(req.query.limit)||10 }),
            duplicateWork:         re.findDuplicateWork({ limit: 5 }),
        });
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/critical", (req, res) => {
    try {
        const re = _re();
        _ok(res, {
            criticalDependencies:  re.findCriticalDependencies({ limit: parseInt(req.query.limit)||10 }),
            singlePointsOfFailure: re.findSinglePointsOfFailure({ limit: parseInt(req.query.limit)||10 }),
        });
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/impact/:type/:id", (req, res) => {
    try {
        const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth, 10) : 3;
        const scenario = req.query.scenario || undefined;
        _ok(res, _re().simulateImpact(req.params.type, req.params.id, { maxDepth, scenario }));
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/dependencies/:type/:id", (req, res) => {
    try { _ok(res, _re().analyzeDependencies(req.params.type, req.params.id)); }
    catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/recommendations", (req, res) => {
    try {
        const limit      = req.query.limit      ? parseInt(req.query.limit, 10)  : 10;
        const autoCreate = req.query.autoCreate === "true";
        _ok(res, _re().generateRecommendations({ limit, autoCreate }));
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/executive", (req, res) => {
    try { _ok(res, _re().executeReasoning()); }
    catch (e) { _err(res, e); }
});

module.exports = router;
