"use strict";
/**
 * unifiedMemoryIndex.js — exposes agents/runtime/unifiedMemoryEngine.cjs.
 *
 * Cross-product memory index: a read-through search/lookup/cross-reference
 * layer over data already recorded by other services (blueprints, features,
 * pipeline runs, incidents, RCAs, sessions, lifecycle reports, ...). Builds
 * and reads its own cache index (data/unified-memory-index.json); every
 * other read hits the live source files directly. No writes to any other
 * service's data.
 *
 * GET  /memory-index/summary              — counts + freshness per namespace
 * POST /memory-index/rebuild              — force-rebuild the cross-reference index
 * GET  /memory-index/search               — full-text search (?q, ?ns, ?types, ?blueprintId, ?limit)
 * GET  /memory-index/lookup/:type/:id     — fetch one record by type+id
 * GET  /memory-index/crossref/:entityId   — find all records referencing an entity
 * GET  /memory-index/project/:blueprintId — everything known about a product
 * GET  /memory-index/workflow             — recent workflow/pipeline/task activity
 * GET  /memory-index/incidents            — incident/RCA/fix-plan chain (?incidentId, ?blueprintId)
 * GET  /memory-index/decisions            — context history + sessions
 * GET  /memory-index/knowledge            — lifecycle reports, debt, learning patterns
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _ume() { return require("../../agents/runtime/unifiedMemoryEngine.cjs"); }
function _ok(res, data)         { res.json({ ok: true, ...data }); }
function _err(res, e, fallback) { res.status(e.status || fallback || 500).json({ ok: false, error: e.message }); }

router.use("/memory-index", requireAuth);

router.get("/memory-index/summary", (req, res) => {
    try { _ok(res, _ume().getSummary({ force: req.query.force === "true" })); }
    catch (e) { _err(res, e); }
});

router.post("/memory-index/rebuild", (req, res) => {
    try { _ok(res, _ume().index({ force: true })); }
    catch (e) { _err(res, e); }
});

router.get("/memory-index/search", (req, res) => {
    try {
        const { q, ns, types, blueprintId, limit } = req.query;
        const results = _ume().search(q || "", {
            ns:    ns    ? String(ns).split(",")    : undefined,
            types: types ? String(types).split(",") : undefined,
            blueprintId,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
        _ok(res, { results, count: results.length });
    } catch (e) { _err(res, e); }
});

router.get("/memory-index/lookup/:type/:id", (req, res) => {
    try {
        const record = _ume().lookup(req.params.type, req.params.id);
        if (!record) return res.status(404).json({ ok: false, error: "not_found" });
        _ok(res, { record });
    } catch (e) { _err(res, e); }
});

router.get("/memory-index/crossref/:entityId", (req, res) => {
    try {
        const results = _ume().crossRef(req.params.entityId);
        _ok(res, { results, count: results.length });
    } catch (e) { _err(res, e); }
});

// getProjectMemory() filters existing sources by blueprintId rather than
// looking up a single record — for an unknown blueprintId it returns a
// shaped object with empty arrays/null fields (never null/undefined for a
// non-empty id, which Express route params always are), so there is no
// "not found" case to 404 on here — 200 with empty content is correct.
router.get("/memory-index/project/:blueprintId", (req, res) => {
    try { _ok(res, { memory: _ume().getProjectMemory(req.params.blueprintId) }); }
    catch (e) { _err(res, e); }
});

router.get("/memory-index/workflow", (req, res) => {
    try { _ok(res, { memory: _ume().getWorkflowMemory({ limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined }) }); }
    catch (e) { _err(res, e); }
});

router.get("/memory-index/incidents", (req, res) => {
    try {
        const { incidentId, blueprintId, limit } = req.query;
        _ok(res, { memory: _ume().getIncidentMemory({ incidentId, blueprintId, limit: limit ? parseInt(limit, 10) : undefined }) });
    } catch (e) { _err(res, e); }
});

router.get("/memory-index/decisions", (req, res) => {
    try { _ok(res, { memory: _ume().getDecisionMemory({ limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined }) }); }
    catch (e) { _err(res, e); }
});

router.get("/memory-index/knowledge", (req, res) => {
    try {
        const { blueprintId, limit } = req.query;
        _ok(res, { memory: _ume().getKnowledgeMemory({ blueprintId, limit: limit ? parseInt(limit, 10) : undefined }) });
    } catch (e) { _err(res, e); }
});

module.exports = router;
