"use strict";
/**
 * Phase 19 routes — Autonomy Execution Layer
 *
 * 19A  ToolExecutionLayer
 *      GET    /p19/tools                              list tools + status
 *      GET    /p19/tools/status                       live status snapshot
 *      POST   /p19/tools/:toolId/execute              execute tool action
 *      GET    /p19/tools/:toolId/permissions          get permissions
 *      PUT    /p19/tools/:toolId/permissions/:action  set permission
 *      GET    /p19/tools/:toolId/usage                usage history
 *      GET    /p19/tools/failures                     failure records + patterns
 *
 * 19B  MultiAgentCoordinator
 *      POST   /p19/coord/handoff                      agent handoff
 *      POST   /p19/coord/delegate                     orchestrator delegation
 *      POST   /p19/coord/collaborate                  parallel collaboration
 *      GET    /p19/coord/sessions                     list sessions
 *      GET    /p19/coord/sessions/stats               coordination stats
 *      GET    /p19/coord/sessions/:sessionId          get session
 *
 * 19C  SelfHealingRuntime
 *      POST   /p19/heal/probe                         manual probe trigger
 *      POST   /p19/heal/task/:taskId                  heal specific task
 *      POST   /p19/heal/cycle/:cycleId                heal specific cycle
 *      POST   /p19/heal/circuit-break                 circuit-break a target
 *      GET    /p19/heal/history                       recovery history
 *      GET    /p19/heal/status                        probe status
 *
 * 19D  ContinuousLearningEngine
 *      POST   /p19/learn/analyze                      run full analysis
 *      POST   /p19/learn/analyze/failures             failures-only analysis
 *      POST   /p19/learn/analyze/successes            successes-only analysis
 *      POST   /p19/learn/lessons                      create manual lesson
 *      GET    /p19/learn/lessons                      list lessons
 *      GET    /p19/learn/recommendations              list recommendations
 *      PATCH  /p19/learn/recommendations/:recId       update recommendation
 *      GET    /p19/learn/stats                        learning stats
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const tel = require("../services/toolExecutionLayer.cjs");
const mac = require("../services/multiAgentCoordinator.cjs");
const shr = require("../services/selfHealingRuntime.cjs");
const cle = require("../services/continuousLearningEngine.cjs");

router.use(requireAuth);

// ── 19A Tool Execution Layer ──────────────────────────────────────────────

router.get("/p19/tools/status", (req, res) => {
    res.json({ success: true, status: tel.toolStatus() });
});

router.get("/p19/tools/failures", (req, res) => {
    const { toolId, limit } = req.query;
    res.json({ success: true, ...tel.getFailures({ toolId, limit: parseInt(limit) || 100 }) });
});

router.get("/p19/tools/:toolId/permissions", (req, res) => {
    try { res.json({ success: true, ...tel.getPermissions(req.params.toolId) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

router.put("/p19/tools/:toolId/permissions/:action", (req, res) => {
    const { allowed } = req.body || {};
    if (allowed === undefined) return res.status(400).json({ error: "allowed (boolean) required" });
    try {
        tel.setPermission(req.params.toolId, req.params.action, allowed);
        res.json({ success: true, toolId: req.params.toolId, action: req.params.action, allowed: !!allowed });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p19/tools/:toolId/execute", async (req, res) => {
    const { action, params, maxRetries, agentId, cycleId } = req.body || {};
    if (!action) return res.status(400).json({ error: "action required" });
    try {
        const result = await tel.execute(req.params.toolId, action, params || {}, { maxRetries, agentId, cycleId });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p19/tools/:toolId/usage", (req, res) => {
    const { action, limit } = req.query;
    res.json({ success: true, ...tel.getUsage(req.params.toolId, { action, limit: parseInt(limit) || 100 }) });
});

router.get("/p19/tools", (req, res) => {
    res.json({ success: true, tools: tel.listTools() });
});

// ── 19B Multi-Agent Coordinator ───────────────────────────────────────────

router.post("/p19/coord/handoff", async (req, res) => {
    const { fromAgentId, toAgentId, context, fromInput, chain, metadata } = req.body || {};
    if (!fromAgentId || !toAgentId) return res.status(400).json({ error: "fromAgentId and toAgentId required" });
    try {
        const r = await mac.handoff(fromAgentId, toAgentId, context || "", { fromInput, chain, metadata });
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/coord/delegate", async (req, res) => {
    const { orchestratorId, subtasks, failFast, metadata } = req.body || {};
    if (!orchestratorId || !Array.isArray(subtasks)) return res.status(400).json({ error: "orchestratorId and subtasks[] required" });
    try {
        const r = await mac.delegate(orchestratorId, subtasks, { failFast, metadata });
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/coord/collaborate", async (req, res) => {
    const { agentIds, sharedInput, metadata } = req.body || {};
    if (!Array.isArray(agentIds) || agentIds.length < 2) return res.status(400).json({ error: "agentIds[] with ≥2 agents required" });
    if (!sharedInput) return res.status(400).json({ error: "sharedInput required" });
    try {
        const r = await mac.collaborate(agentIds, sharedInput, { metadata });
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p19/coord/sessions/stats", (req, res) => {
    res.json({ success: true, stats: mac.getCoordinationStats() });
});

router.get("/p19/coord/sessions/:sessionId", (req, res) => {
    const s = mac.getSession(req.params.sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true, session: s });
});

router.get("/p19/coord/sessions", (req, res) => {
    const { pattern, status, agentId, limit, offset } = req.query;
    res.json({ success: true, ...mac.listSessions({ pattern, status, agentId, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

// ── 19C Self-Healing Runtime ──────────────────────────────────────────────

router.post("/p19/heal/probe", async (req, res) => {
    try {
        const result = await shr.probe();
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/heal/task/:taskId", async (req, res) => {
    try {
        const r = await shr.healTask(req.params.taskId, req.body || {});
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/heal/cycle/:cycleId", async (req, res) => {
    try {
        const r = await shr.healCycle(req.params.cycleId, req.body || {});
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/heal/circuit-break", (req, res) => {
    const { targetId, reason, durationMs } = req.body || {};
    if (!targetId) return res.status(400).json({ error: "targetId required" });
    try {
        const r = shr.circuitBreak(targetId, reason || "manual", durationMs);
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p19/heal/history", (req, res) => {
    const { strategy, targetType, limit, offset } = req.query;
    res.json({ success: true, ...shr.getHistory({ strategy, targetType, limit: parseInt(limit)||100, offset: parseInt(offset)||0 }) });
});

router.get("/p19/heal/status", (req, res) => {
    res.json({ success: true, ...shr.getStatus() });
});

// ── 19D Continuous Learning Engine ────────────────────────────────────────

router.post("/p19/learn/analyze", (req, res) => {
    try {
        const r = cle.runFullAnalysis();
        res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/learn/analyze/failures", (req, res) => {
    const { since, limit } = req.body || {};
    try {
        res.json({ success: true, ...cle.analyzeFailures({ since, limit }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/learn/analyze/successes", (req, res) => {
    const { since, limit } = req.body || {};
    try {
        res.json({ success: true, ...cle.analyzeSuccesses({ since, limit }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p19/learn/lessons", (req, res) => {
    const { type, title, detail, severity, recommendation, agentId, toolId, source } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    try {
        res.json({ success: true, ...cle.createLesson({ type, title, detail, severity, recommendation, agentId, toolId, source }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p19/learn/lessons", (req, res) => {
    const { type, severity, source, limit, offset } = req.query;
    res.json({ success: true, ...cle.getLessons({ type, severity, source, limit: parseInt(limit)||100, offset: parseInt(offset)||0 }) });
});

router.patch("/p19/learn/recommendations/:recId", (req, res) => {
    try {
        const r = cle.updateRecommendation(req.params.recId, req.body);
        res.json({ success: true, recommendation: r });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p19/learn/recommendations", (req, res) => {
    const { status, priority, limit, offset } = req.query;
    res.json({ success: true, ...cle.getRecommendations({ status, priority, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.get("/p19/learn/stats", (req, res) => {
    res.json({ success: true, stats: cle.getStats() });
});

module.exports = router;
