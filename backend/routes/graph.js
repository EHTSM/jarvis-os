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
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");

function _kg()  { return require("../services/knowledgeGraph.cjs"); }
function _ok(res, data)         { res.json({ ok: true, ...data }); }
function _err(res, e, fallback) { res.status(e.status || fallback || 500).json({ ok: false, error: e.message }); }

router.use("/graph", requireAuth);

// Knowledge OS pass (2026-08-15): this route has NO per-org concept at all —
// it is the platform-wide graph every org's data gets indexed into (see the
// file header). requireAuth alone let any authenticated account of ANY org
// query any OTHER org's individual record content directly: GET
// /graph/node/lead/<real id> returned the target lead's name/email/status,
// and /graph/impact, /graph/traverse, /graph/related did the same for a
// whole connected subgraph. Live-reproduced with two real orgs — see
// reports/OS-KNOWLEDGE-SECURITY.md. There is no orgId to scope these routes
// by (unlike orgKnowledgeGraph.js's /org-graph/:orgId/* wrapper, which DOES
// have one and was fixed separately, same pass), so the correct minimal fix
// here is the same operator-only gate crm.js already uses for its own
// "cross-org operator view" routes (GET /crm, /crm-leads) — this is
// architecturally identical: a platform-wide view, now restricted to the
// role the platform already reserves for that. Aggregate/statistical routes
// below (schema, stats, the whole-platform reasoning views) disclose counts
// and top-N summaries, not individual record content, so they keep their
// existing requireAuth-only gate — same reasoning `/graph/reasoning`'s own
// callers (ExecutiveDashboard.jsx, BusinessOS.jsx) already rely on.
const _graphOperatorOnly = operatorOnly;

// ── Schema + stats ────────────────────────────────────────────────────────────
router.get("/graph/schema", (req, res) => {
    const kg = _kg();
    _ok(res, { nodeTypes: kg.NODE_TYPES, relations: kg.RELATIONS });
});

router.get("/graph/stats", (req, res) => {
    try { _ok(res, _kg().getStats()); }
    catch (e) { _err(res, e); }
});

// ── Export ────────────────────────────────────────────────────────────────────
// Enterprise Capability Expansion mission — real Knowledge Graph export.
// Confirmed genuinely absent before this: GET /graph/edges caps results at
// a 200-edge page (see above); there was no way to pull the complete
// graph in one call. Reuses getEdges() with no artificial cap plus the
// same getStats()/NODE_TYPES/RELATIONS already exposed by /graph/stats
// and /graph/schema — this route does not read the edge store directly,
// it composes the exact same service functions the other routes call.
router.get("/graph/export", _graphOperatorOnly, async (req, res) => {
    try {
        const kg = _kg();
        const { edges, total } = kg.getEdges({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
        const dump = {
            exportedAt: new Date().toISOString(),
            nodeTypes: kg.NODE_TYPES,
            relations: kg.RELATIONS,
            stats: kg.getStats(),
            edgeCount: total,
            edges,
        };
        const buffer = Buffer.from(JSON.stringify(dump, null, 2), "utf8");

        const exportFiles = require("../services/exportFileService.cjs");
        const result = await exportFiles.persist(buffer, {
            filename: `knowledge-graph-export-${Date.now()}.json`,
            mimeType: "application/json",
            orgId: null,
            accountId: req.user?.sub || req.user?.id || null,
            capability: "knowledge_graph_export",
            tags: ["knowledge-graph", "export"],
        });
        _ok(res, { ...result, edgeCount: total });
    } catch (e) { _err(res, e); }
});

// ── Indexing ──────────────────────────────────────────────────────────────────
// Graph / Knowledge API Authorization & Tenant-Isolation Audit (2026-08-21):
// both routes ran on requireAuth only, unlike every other mutation route in
// this file (edges POST/DELETE, /graph/export are already _graphOperatorOnly).
// indexAll() reindexes up to 2000 missions platform-wide with no orgId
// concept — any authenticated customer could trigger a full reindex
// (resource-exhaustion risk) or force-index an arbitrary missionId, INCLUDING
// another org's real mission. Live-reproduced: an unrelated customer indexed
// a real mission belonging to a different org by ID and the response body
// directly returned that mission's real orgId and its linked opportunity —
// genuine cross-tenant disclosure through a mutation route's own response,
// not merely a resource-cost issue. No real frontend code calls either route
// (confirmed via grep — the two BusinessOS.jsx references are help-text
// strings for someone using the API directly, not fetch() calls), so gating
// them operatorOnly, matching this file's own established pattern for every
// other platform-wide mutation/read, breaks no customer-facing feature.
router.post("/graph/index", _graphOperatorOnly, (req, res) => {
    try {
        const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";
        _ok(res, _kg().indexAll({ dryRun }));
    } catch (e) { _err(res, e); }
});

router.post("/graph/index/mission/:missionId", _graphOperatorOnly, (req, res) => {
    try {
        const edges = _kg().indexMission(req.params.missionId);
        _ok(res, { indexed: edges.length, edges });
    } catch (e) { _err(res, e); }
});

// ── Edges ─────────────────────────────────────────────────────────────────────
router.get("/graph/edges", _graphOperatorOnly, (req, res) => {
    try {
        const { fromType, fromId, toType, toId, relation, limit, offset } = req.query;
        _ok(res, _kg().getEdges({
            fromType, fromId, toType, toId, relation,
            limit:  limit  ? parseInt(limit, 10)  : 200,
            offset: offset ? parseInt(offset, 10) : 0,
        }));
    } catch (e) { _err(res, e); }
});

router.post("/graph/edges", _graphOperatorOnly, (req, res) => {
    try {
        const { fromType, fromId, relation, toType, toId, weight, metadata } = req.body || {};
        if (!fromType || !fromId || !relation || !toType || !toId) {
            return res.status(400).json({ ok: false, error: "fromType, fromId, relation, toType, toId required" });
        }
        _ok(res, { edge: _kg().addEdge(fromType, fromId, relation, toType, toId, { weight, metadata }) });
    } catch (e) { _err(res, e, 400); }
});

router.delete("/graph/edges/:edgeId", _graphOperatorOnly, (req, res) => {
    try { _ok(res, _kg().removeEdge(req.params.edgeId)); }
    catch (e) { _err(res, e, 404); }
});

// ── Node ──────────────────────────────────────────────────────────────────────
router.get("/graph/node/:type/:id", _graphOperatorOnly, (req, res) => {
    try { _ok(res, _kg().getNode(req.params.type, req.params.id)); }
    catch (e) { _err(res, e); }
});

// ── Traversal ─────────────────────────────────────────────────────────────────
router.get("/graph/traverse/:type/:id", _graphOperatorOnly, (req, res) => {
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

router.get("/graph/related/:type/:id", _graphOperatorOnly, (req, res) => {
    try {
        const { relation, depth } = req.query;
        const related = _kg().findRelated(req.params.type, req.params.id, relation, depth ? Math.min(3, parseInt(depth, 10)) : 1);
        _ok(res, { related, total: related.length });
    } catch (e) { _err(res, e); }
});

// ── Impact analysis ───────────────────────────────────────────────────────────
router.get("/graph/impact/:type/:id", _graphOperatorOnly, (req, res) => {
    try { _ok(res, _kg().impactAnalysis(req.params.type, req.params.id)); }
    catch (e) { _err(res, e); }
});

// ── Cross-domain convenience lookups ─────────────────────────────────────────
router.get("/graph/lookup/:type/:id/missions", _graphOperatorOnly, (req, res) => {
    try {
        const related = _kg().findRelated(req.params.type, req.params.id, null, 2)
            .filter(n => n.type === "mission");
        _ok(res, { missions: related, total: related.length });
    } catch (e) { _err(res, e); }
});

router.get("/graph/lookup/:type/:id/org", _graphOperatorOnly, (req, res) => {
    try {
        const related = _kg().findRelated(req.params.type, req.params.id, null, 3)
            .filter(n => n.type === "org");
        _ok(res, { orgs: related, total: related.length });
    } catch (e) { _err(res, e); }
});

router.get("/graph/lookup/mission/:missionId/team", _graphOperatorOnly, (req, res) => {
    try {
        const teams = _kg().findRelated("mission", req.params.missionId, "assigned_to", 1)
            .filter(n => n.type === "team");
        _ok(res, { teams, total: teams.length });
    } catch (e) { _err(res, e); }
});

// ── Q2-6 Reasoning routes ─────────────────────────────────────────────────────
function _re() { return require("../services/graphReasoningEngine.cjs"); }

// Graph / Knowledge API Authorization & Tenant-Isolation Audit (2026-08-21):
// these 4 routes ran on requireAuth only. graphReasoningEngine.cjs's
// functions have no orgId concept anywhere in their signatures — they
// compute over the whole platform graph and return real, individual
// leadId/missionId/rcaId/orgId values (not aggregates like /graph/stats),
// the exact same defect class already fixed for /graph/node, /graph/
// traverse, /graph/impact, etc. in this same file. Live-reproduced: an
// unrelated customer's GET /graph/reasoning returned another org's real
// highRiskOrgs entries (orgId + mission/failure counts) and named
// leadId/rcaId critical-dependency records platform-wide.
//
// All 4 routes ARE consumed by genuinely customer-facing dashboards
// (ExecutiveDashboard.jsx, BusinessOS.jsx, MissionControlV1.jsx,
// EngineeringIntelligencePane.jsx — each a plain, ungated tenant-facing tab,
// not an operator-only surface), which is why they were left off the
// original operatorOnly pass. Retrofitting real per-org scoping into 9
// platform-wide reasoning functions would be a genuine architecture
// expansion (explicitly out of scope for this mission). Gating operatorOnly
// is the same minimal, established mechanism used for the rest of this
// file; verified all 4 frontend consumers already check `.ok` before
// rendering and fall back to an honest "unavailable"/hidden empty state on
// a non-2xx response — no crash, no broken feature, just no longer
// displaying platform-wide data to an ordinary tenant. Flagged as DECISION
// REQUIRED whether these 4 dashboard sections should be removed/redesigned
// for ordinary customers now that they can no longer be populated — not
// silently decided here.
router.get("/graph/reasoning", _graphOperatorOnly, (req, res) => {
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

router.get("/graph/reasoning/critical", _graphOperatorOnly, (req, res) => {
    try {
        const re = _re();
        _ok(res, {
            criticalDependencies:  re.findCriticalDependencies({ limit: parseInt(req.query.limit)||10 }),
            singlePointsOfFailure: re.findSinglePointsOfFailure({ limit: parseInt(req.query.limit)||10 }),
        });
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/impact/:type/:id", _graphOperatorOnly, (req, res) => {
    try {
        const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth, 10) : 3;
        const scenario = req.query.scenario || undefined;
        _ok(res, _re().simulateImpact(req.params.type, req.params.id, { maxDepth, scenario }));
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/dependencies/:type/:id", _graphOperatorOnly, (req, res) => {
    try { _ok(res, _re().analyzeDependencies(req.params.type, req.params.id)); }
    catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/recommendations", _graphOperatorOnly, (req, res) => {
    try {
        const limit      = req.query.limit      ? parseInt(req.query.limit, 10)  : 10;
        const autoCreate = req.query.autoCreate === "true";
        _ok(res, _re().generateRecommendations({ limit, autoCreate }));
    } catch (e) { _err(res, e); }
});

router.get("/graph/reasoning/executive", _graphOperatorOnly, (req, res) => {
    try { _ok(res, _re().executeReasoning()); }
    catch (e) { _err(res, e); }
});

module.exports = router;
