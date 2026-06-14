"use strict";
/**
 * Phase 26 routes — Track D: Autonomous Intelligence
 *
 * D1  Multi-Agent Task Graph
 *     POST   /p26/graph                        create + execute a new task graph
 *     POST   /p26/graph/:id/execute            execute an existing graph
 *     GET    /p26/graph/:id                    get graph state
 *     GET    /p26/graph                        list graphs
 *     DELETE /p26/graph/:id                    cancel graph
 *     GET    /p26/graph/stats                  execution statistics
 *
 * D2  Semantic Memory Search + Taxonomy
 *     POST   /p26/memory/typed                 save a typed memory (failure/success/decision/knowledge)
 *     POST   /p26/memory/search                semantic TF-IDF search
 *     GET    /p26/memory/failures              search failure memories
 *     GET    /p26/memory/successes             search success memories
 *     GET    /p26/memory/decisions             search decision memories
 *     POST   /p26/memory/cross-project         cross-project semantic search
 *     GET    /p26/memory/knowledge-graph       knowledge graph (nodes + edges)
 *     POST   /p26/memory/evolve                evolve low-confidence memories
 *
 * D3  Reasoning Engine
 *     GET    /p26/reason/:recId                explain a recommendation
 *     POST   /p26/reason/confidence            score confidence for data
 *     POST   /p26/reason/risk                  analyze risk for a recommendation
 *     POST   /p26/reason/rollback              generate rollback plan
 *     POST   /p26/reason/root-cause            analyze root cause of a failure
 *     POST   /p26/reason/batch                 batch-explain all recommendations
 *     GET    /p26/reason/cached/:recId         get previously computed reasoning
 *
 * D4  Background Runtime Observer
 *     POST   /p26/observer/start               start all observers
 *     POST   /p26/observer/stop                stop all observers
 *     GET    /p26/observer/status              observer status
 *     GET    /p26/observer/recommendations     proactive recommendations
 *     POST   /p26/observer/trigger/:name       trigger a specific observer now
 *     DELETE /p26/observer/recommendations     clear old acknowledged recommendations
 *
 * D5  Plugin SDK + Capability Registry + API Manifest
 *     POST   /p26/plugins                      register a plugin
 *     DELETE /p26/plugins/:id                  unregister a plugin
 *     GET    /p26/plugins/:id                  get plugin
 *     GET    /p26/plugins                      list plugins
 *     POST   /p26/plugins/hook                 execute a hook across all plugins
 *     GET    /p26/capabilities                 list all capabilities
 *     GET    /p26/capabilities/map             capability → provider map
 *     GET    /p26/capabilities/find            find providers for a capability name
 *     POST   /p26/capabilities                 register a new capability
 *     GET    /p26/manifest                     full API manifest
 *     GET    /p26/manifest/search              search endpoints
 *     POST   /p26/templates                    register a template
 *     GET    /p26/templates                    list templates
 *     POST   /p26/templates/:id/instantiate    instantiate a template with vars
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const tg  = require("../services/taskGraph.cjs");
const sms = require("../services/semanticMemorySearch.cjs");
const re  = require("../services/reasoningEngine.cjs");
const br  = require("../services/backgroundRuntime.cjs");
const sdk = require("../services/pluginSDK.cjs");

router.use(requireAuth);

// ── D1 Multi-Agent Task Graph ─────────────────────────────────────────────────

// Create graph (and optionally execute immediately)
router.post("/p26/graph", async (req, res) => {
    try {
        const { goal, execute = true, skipAgents, steps } = req.body;
        if (!goal) return res.status(400).json({ success: false, error: "goal required" });
        const graph = tg.createGraph(goal, { skipAgents, steps });
        if (execute) {
            // Run async — don't block response
            tg.executeGraph(graph.graphId).catch(() => {});
        }
        res.json({ success: true, graph: tg.getGraph(graph.graphId) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p26/graph/:id/execute", async (req, res) => {
    try {
        const result = await tg.executeGraph(req.params.id);
        res.json({ success: true, ...result });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p26/graph/stats", (_req, res) => {
    try { res.json({ success: true, stats: tg.getGraphStats() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/graph/:id", (req, res) => {
    try {
        const graph = tg.getGraph(req.params.id);
        if (!graph) return res.status(404).json({ success: false, error: "Graph not found" });
        res.json({ success: true, graph });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/graph", (req, res) => {
    try {
        const { status, limit, offset } = req.query;
        res.json({ success: true, ...tg.listGraphs({ status, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete("/p26/graph/:id", (req, res) => {
    try { res.json({ success: true, ...tg.cancelGraph(req.params.id) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

// ── D2 Semantic Memory ────────────────────────────────────────────────────────

router.post("/p26/memory/typed", async (req, res) => {
    try {
        const { type, data, opts } = req.body;
        if (!type || !data) return res.status(400).json({ success: false, error: "type and data required" });
        res.json({ success: true, ...(await sms.saveTypedMemory(type, data, opts || {})) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p26/memory/search", (req, res) => {
    try {
        const { query, type, minScore, limit, projectId } = req.body;
        if (!query) return res.status(400).json({ success: false, error: "query required" });
        res.json({ success: true, ...sms.semanticSearch(query, { type, minScore, limit, projectId }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/memory/failures", (req, res) => {
    try {
        const { q, limit } = req.query;
        if (!q) return res.status(400).json({ success: false, error: "q required" });
        res.json({ success: true, ...sms.searchFailures(q, { limit: parseInt(limit) || 20 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/memory/successes", (req, res) => {
    try {
        const { q, limit } = req.query;
        if (!q) return res.status(400).json({ success: false, error: "q required" });
        res.json({ success: true, ...sms.searchSuccesses(q, { limit: parseInt(limit) || 20 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/memory/decisions", (req, res) => {
    try {
        const { q, limit } = req.query;
        if (!q) return res.status(400).json({ success: false, error: "q required" });
        res.json({ success: true, ...sms.searchDecisions(q, { limit: parseInt(limit) || 20 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p26/memory/cross-project", (req, res) => {
    try {
        const { query, limit } = req.body;
        if (!query) return res.status(400).json({ success: false, error: "query required" });
        res.json({ success: true, ...sms.crossProjectSearch(query, { limit }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/memory/knowledge-graph", (req, res) => {
    try {
        const { maxNodes, edgeThreshold } = req.query;
        res.json({ success: true, ...sms.getKnowledgeGraph({ maxNodes: parseInt(maxNodes) || 200, edgeThreshold: parseFloat(edgeThreshold) || 0.3 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p26/memory/evolve", (req, res) => {
    try {
        const { recurrenceThreshold, confidenceCap, dryRun } = req.body;
        res.json({ success: true, ...sms.evolveKnowledge({ recurrenceThreshold, confidenceCap, dryRun }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── D3 Reasoning Engine ───────────────────────────────────────────────────────

router.get("/p26/reason/cached/:recId", (req, res) => {
    try {
        const r = re.getReasoning(req.params.recId);
        if (!r) return res.status(404).json({ success: false, error: "No cached reasoning" });
        res.json({ success: true, reasoning: r });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/reason/:recId", async (req, res) => {
    try {
        res.json({ success: true, ...(await re.explainRecommendation(req.params.recId, req.query)) });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.post("/p26/reason/confidence", (req, res) => {
    try {
        if (!req.body || typeof req.body !== "object") return res.status(400).json({ success: false, error: "data object required" });
        res.json({ success: true, confidence: re.scoreConfidence(req.body) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p26/reason/risk", (req, res) => {
    try {
        const { recommendation, context } = req.body;
        if (!recommendation) return res.status(400).json({ success: false, error: "recommendation required" });
        res.json({ success: true, risk: re.analyzeRisk(recommendation, context || {}) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p26/reason/rollback", (req, res) => {
    try {
        const { recommendation } = req.body;
        if (!recommendation) return res.status(400).json({ success: false, error: "recommendation required" });
        res.json({ success: true, rollback: re.planRollback(recommendation) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p26/reason/root-cause", (req, res) => {
    try {
        const { failureContext } = req.body;
        if (!failureContext) return res.status(400).json({ success: false, error: "failureContext required" });
        res.json({ success: true, ...re.analyzeRootCause(failureContext) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post("/p26/reason/batch", async (req, res) => {
    try {
        res.json({ success: true, ...(await re.batchExplain(req.body || {})) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── D4 Background Runtime Observer ───────────────────────────────────────────

router.post("/p26/observer/start", (_req, res) => {
    try { res.json({ success: true, ...br.start() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p26/observer/stop", (_req, res) => {
    try { br.stop(); res.json({ success: true, stopped: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/observer/status", (_req, res) => {
    try { res.json({ success: true, ...br.getStatus() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/observer/recommendations", (req, res) => {
    try {
        const { source, priority, limit } = req.query;
        res.json({ success: true, ...br.getRecommendations({ source, priority, limit: parseInt(limit) || 100 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p26/observer/trigger/:name", async (req, res) => {
    try {
        const result = await br.triggerObserver(req.params.name);
        res.json({ success: true, result });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete("/p26/observer/recommendations", (_req, res) => {
    try { res.json({ success: true, ...br.clearRecommendations() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── D5 Plugin SDK ─────────────────────────────────────────────────────────────

router.post("/p26/plugins", (req, res) => {
    try {
        const plugin = req.body;
        if (!plugin || !plugin.id || !plugin.name) return res.status(400).json({ success: false, error: "plugin.id and plugin.name required" });
        res.json({ success: true, ...sdk.registerPlugin(plugin) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete("/p26/plugins/:id", (req, res) => {
    try { res.json({ success: true, ...sdk.unregisterPlugin(req.params.id) }); }
    catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

router.get("/p26/plugins/:id", (req, res) => {
    try {
        const p = sdk.getPlugin(req.params.id);
        if (!p) return res.status(404).json({ success: false, error: "Plugin not found" });
        res.json({ success: true, plugin: p });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/plugins", (req, res) => {
    try {
        const { category, limit } = req.query;
        res.json({ success: true, ...sdk.listPlugins({ category, limit: parseInt(limit) || 100 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p26/plugins/hook", async (req, res) => {
    try {
        const { hook, args } = req.body;
        if (!hook) return res.status(400).json({ success: false, error: "hook required" });
        const results = await sdk.executeHook(hook, ...(args || []));
        res.json({ success: true, results });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ── D5 Capability Registry ────────────────────────────────────────────────────

router.post("/p26/capabilities", (req, res) => {
    try {
        const { id, ...meta } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id required" });
        res.json({ success: true, ...sdk.registerCapability(id, meta) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p26/capabilities/map", (_req, res) => {
    try { res.json({ success: true, map: sdk.getCapabilityMap() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/capabilities/find", (req, res) => {
    try {
        const { capability } = req.query;
        if (!capability) return res.status(400).json({ success: false, error: "capability required" });
        res.json({ success: true, ...sdk.findByCapability(capability) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/capabilities", (req, res) => {
    try {
        const { category, providedBy, limit } = req.query;
        res.json({ success: true, ...sdk.listCapabilities({ category, providedBy, limit: parseInt(limit) || 200 }) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── D5 API Manifest ───────────────────────────────────────────────────────────

router.get("/p26/manifest/search", (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ success: false, error: "q required" });
        res.json({ success: true, ...sdk.searchEndpoints(q) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/p26/manifest", (_req, res) => {
    try { res.json({ success: true, manifest: sdk.getManifest() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── D5 Template System ────────────────────────────────────────────────────────

router.post("/p26/templates", (req, res) => {
    try {
        const tpl = req.body;
        if (!tpl || !tpl.id || !tpl.name) return res.status(400).json({ success: false, error: "template.id and template.name required" });
        res.json({ success: true, ...sdk.registerTemplate(tpl) });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get("/p26/templates", (req, res) => {
    try { res.json({ success: true, templates: sdk.listTemplates(req.query.category) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post("/p26/templates/:id/instantiate", (req, res) => {
    try {
        const result = sdk.instantiateTemplate(req.params.id, req.body.vars || {});
        res.json({ success: true, template: result });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

module.exports = router;
