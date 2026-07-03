"use strict";
/**
 * Phase 20 routes — Agent Factory, Memory Intelligence,
 *                   Improvement Loop, Ooplix Autonomy
 *
 * 20A  AgentFactoryAutomation
 *      POST   /p20/agents                         create agent
 *      POST   /p20/agents/:agentId/clone          clone agent
 *      PUT    /p20/agents/:agentId/tools          assign tools
 *      PUT    /p20/agents/:agentId/permissions    set permissions
 *      PUT    /p20/agents/:agentId/memory         register memory nodes
 *      DELETE /p20/agents/:agentId                retire agent
 *      GET    /p20/agents/:agentId                get agent
 *      GET    /p20/agents                         list agents
 *      GET    /p20/agents/registry                full registry
 *
 * 20B  MemoryIntelligenceEngine
 *      GET    /p20/memory/rank                    rank memories by score
 *      POST   /p20/memory/merge                   merge duplicates
 *      GET    /p20/memory/conflicts               detect conflicts
 *      POST   /p20/memory/archive-stale           archive stale nodes
 *      POST   /p20/memory/improve-recall          improve recall for agent+query
 *      POST   /p20/memory/maintenance             full maintenance run
 *      GET    /p20/memory/report                  last intelligence report
 *
 * 20C  ImprovementLoopEngine
 *      POST   /p20/improve/apply                  apply a change trial
 *      POST   /p20/improve/:trialId/measure       measure outcome
 *      POST   /p20/improve/:trialId/keep          keep change permanently
 *      POST   /p20/improve/:trialId/revert        revert change
 *      POST   /p20/improve/:trialId/record        add learning note
 *      GET    /p20/improve/:trialId               get trial
 *      GET    /p20/improve                        list trials
 *      GET    /p20/improve/stats                  stats
 *
 * 20D  OoplixAutonomyEngine
 *      POST   /p20/ooplix/tasks                   create task
 *      POST   /p20/ooplix/dispatch                dispatch pending tasks
 *      POST   /p20/ooplix/schedule                schedule recurring tasks
 *      POST   /p20/ooplix/cycle                   run full autonomous cycle
 *      POST   /p20/ooplix/tasks/:taskId/influence record influence
 *      GET    /p20/ooplix/tasks/:taskId           get task
 *      GET    /p20/ooplix/tasks                   list tasks
 *      GET    /p20/ooplix/influence               influence report
 *      GET    /p20/ooplix/templates               available task templates
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const afa = require("../services/agentFactoryAutomation.cjs");
const mie = require("../services/memoryIntelligenceEngine.cjs");
const ile = require("../services/improvementLoopEngine.cjs");
const oae = require("../services/ooplixAutonomyEngine.cjs");

router.use("/p20", requireAuth);

// ── 20A Agent Factory Automation ──────────────────────────────────────────

router.post("/p20/agents", (req, res) => {
    try {
        const agent = afa.createAgent(req.body || {});
        res.json({ success: true, agent });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p20/agents/:agentId/clone", (req, res) => {
    try {
        const agent = afa.cloneAgent(req.params.agentId, req.body || {});
        res.json({ success: true, agent });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.put("/p20/agents/:agentId/tools", (req, res) => {
    const { tools } = req.body || {};
    if (!Array.isArray(tools)) return res.status(400).json({ error: "tools[] required" });
    try {
        const agent = afa.assignTools(req.params.agentId, tools);
        res.json({ success: true, agent });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.put("/p20/agents/:agentId/permissions", (req, res) => {
    if (!req.body || typeof req.body !== "object") return res.status(400).json({ error: "permissions object required" });
    try {
        const agent = afa.setPermissions(req.params.agentId, req.body);
        res.json({ success: true, agent });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.put("/p20/agents/:agentId/memory", (req, res) => {
    const { nodeIds } = req.body || {};
    if (!Array.isArray(nodeIds)) return res.status(400).json({ error: "nodeIds[] required" });
    try {
        const agent = afa.registerMemory(req.params.agentId, nodeIds);
        res.json({ success: true, agent });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.delete("/p20/agents/:agentId", (req, res) => {
    try {
        const agent = afa.retireAgent(req.params.agentId);
        res.json({ success: true, agent });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p20/agents/registry", (req, res) => {
    res.json({ success: true, ...afa.getRegistry() });
});

router.get("/p20/agents/:agentId", (req, res) => {
    const agent = afa.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json({ success: true, agent });
});

router.get("/p20/agents", (req, res) => {
    const { status, type, limit, offset } = req.query;
    res.json({ success: true, ...afa.listAgents({ status, type, limit: parseInt(limit)||100, offset: parseInt(offset)||0 }) });
});

// ── 20B Memory Intelligence Engine ────────────────────────────────────────

router.get("/p20/memory/rank", (req, res) => {
    const { type, minScore, limit } = req.query;
    res.json({ success: true, ...mie.rankMemories({ type, minScore: parseInt(minScore)||0, limit: parseInt(limit)||100 }) });
});

router.post("/p20/memory/merge", (req, res) => {
    const { threshold, dryRun } = req.body || {};
    try {
        res.json({ success: true, ...mie.mergeDuplicates({ threshold: parseFloat(threshold)||0.70, dryRun: !!dryRun }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p20/memory/conflicts", (req, res) => {
    try {
        res.json({ success: true, ...mie.detectConflicts() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p20/memory/archive-stale", (req, res) => {
    const { staleDays, maxImportance, dryRun, limit } = req.body || {};
    try {
        res.json({ success: true, ...mie.archiveStale({ staleDays: parseInt(staleDays)||60, maxImportance: parseInt(maxImportance)||40, dryRun: !!dryRun, limit: parseInt(limit)||200 }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p20/memory/improve-recall", (req, res) => {
    const { agentId, input, limit } = req.body || {};
    if (!agentId) return res.status(400).json({ error: "agentId required" });
    try {
        res.json({ success: true, ...mie.improveRecall(agentId, input || "", parseInt(limit)||10) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p20/memory/maintenance", (req, res) => {
    const { dryRun } = req.body || {};
    try {
        res.json({ success: true, ...mie.runFullMaintenance({ dryRun: !!dryRun }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p20/memory/report", (req, res) => {
    const report = mie.getIntelligenceReport();
    if (!report) return res.status(404).json({ error: "No report yet — run POST /p20/memory/maintenance first" });
    res.json({ success: true, report });
});

// ── 20C Improvement Loop Engine ───────────────────────────────────────────

router.post("/p20/improve/apply", async (req, res) => {
    const { recId, change } = req.body || {};
    if (!change) return res.status(400).json({ error: "change object required" });
    try {
        const result = await ile.apply(recId, change);
        res.json({ success: true, ...result });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/p20/improve/stats", (req, res) => {
    res.json({ success: true, stats: ile.getStats() });
});

router.post("/p20/improve/:trialId/measure", (req, res) => {
    try {
        res.json({ success: true, ...ile.measure(req.params.trialId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.post("/p20/improve/:trialId/keep", async (req, res) => {
    try {
        const r = await ile.keep(req.params.trialId);
        res.json({ success: true, trial: r });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.post("/p20/improve/:trialId/revert", async (req, res) => {
    try {
        const r = await ile.revert(req.params.trialId);
        res.json({ success: true, trial: r });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.post("/p20/improve/:trialId/record", (req, res) => {
    const { notes } = req.body || {};
    if (!notes) return res.status(400).json({ error: "notes required" });
    try {
        res.json({ success: true, trial: ile.record(req.params.trialId, notes) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p20/improve/:trialId", (req, res) => {
    const trial = ile.getTrial(req.params.trialId);
    if (!trial) return res.status(404).json({ error: "Trial not found" });
    res.json({ success: true, trial });
});

router.get("/p20/improve", (req, res) => {
    const { status, target, limit, offset } = req.query;
    res.json({ success: true, ...ile.listTrials({ status, target, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

// ── 20D Ooplix Autonomy Engine ────────────────────────────────────────────

router.post("/p20/ooplix/tasks", (req, res) => {
    const { type, ...spec } = req.body || {};
    if (!type) return res.status(400).json({ error: "type required: content|seo|support|marketing" });
    try {
        const task = oae.createTask(type, spec);
        res.json({ success: true, task });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p20/ooplix/dispatch", async (req, res) => {
    const { limit, type } = req.body || {};
    try {
        const result = await oae.dispatchPending({ limit: parseInt(limit)||10, type });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p20/ooplix/schedule", (req, res) => {
    const { type, cronSpec } = req.body || {};
    if (!type || !cronSpec) return res.status(400).json({ error: "type and cronSpec required" });
    try {
        res.json({ success: true, ...oae.scheduleRecurring(type, cronSpec) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/p20/ooplix/cycle", async (req, res) => {
    try {
        const result = await oae.runAutonomousCycle();
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p20/ooplix/tasks/:taskId/influence", (req, res) => {
    try {
        const rec = oae.recordInfluence(req.params.taskId, req.body || {});
        res.json({ success: true, influence: rec });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p20/ooplix/influence", (req, res) => {
    const { type, since, limit } = req.query;
    res.json({ success: true, ...oae.getInfluenceReport({ type, since, limit: parseInt(limit)||200 }) });
});

router.get("/p20/ooplix/templates", (req, res) => {
    res.json({ success: true, templates: oae.TASK_SPECS });
});

router.get("/p20/ooplix/tasks/:taskId", (req, res) => {
    const task = oae.getTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true, task });
});

router.get("/p20/ooplix/tasks", (req, res) => {
    const { type, status, limit, offset } = req.query;
    res.json({ success: true, ...oae.listTasks({ type, status, limit: parseInt(limit)||100, offset: parseInt(offset)||0 }) });
});

module.exports = router;
