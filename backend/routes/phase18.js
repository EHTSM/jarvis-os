"use strict";
/**
 * Phase 18 routes — Runtime Execution Layer
 *
 * 18A  POST   /p18/actions/execute          execute action now
 *      POST   /p18/actions/queue            queue action async
 *      POST   /p18/actions/:id/retry        retry action
 *      DELETE /p18/actions/:id              cancel action
 *      GET    /p18/actions                  list actions
 *      GET    /p18/actions/:id              get action
 *      GET    /p18/actions/audit            audit trail (tail of execLog)
 *
 * 18B  POST   /p18/agents/:agentId/execute  execute task for agent
 *      POST   /p18/agents/runs/:runId/retry retry a run
 *      GET    /p18/agents                   list agents + stats
 *      GET    /p18/agents/:agentId          agent profile + history
 *      GET    /p18/agents/:agentId/history  run history
 *      GET    /p18/agents/failures          all failure records
 *
 * 18C  POST   /p18/memory                   save memory node
 *      GET    /p18/memory                   list nodes
 *      GET    /p18/memory/stats             stats
 *      GET    /p18/memory/search            keyword search
 *      GET    /p18/memory/recall            agent context recall
 *      GET    /p18/memory/:nodeId           load node
 *      PATCH  /p18/memory/:nodeId           update node
 *      DELETE /p18/memory/:nodeId           archive node
 *
 * 18D  POST   /p18/cycles                   start autonomous cycle
 *      GET    /p18/cycles                   list cycles
 *      GET    /p18/cycles/stats             stats
 *      GET    /p18/cycles/learning          learning log
 *      GET    /p18/cycles/:cycleId          get cycle
 *      DELETE /p18/cycles/:cycleId          cancel cycle
 */

const router     = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rae   = require("../services/runtimeActionEngine.cjs");
const aee   = require("../services/agentExecutionEngine.cjs");
const mpl   = require("../services/memoryPersistenceLayer.cjs");
const atl   = require("../services/autonomousTaskLoop.cjs");

router.use("/p18", requireAuth);

// ── 18A — Runtime Action Engine ──────────────────────────────────────────

router.post("/p18/actions/execute", async (req, res) => {
    const { input, type, timeoutMs, source } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    try {
        const result = await rae.execute(input.slice(0, 2000), { type, timeoutMs, source });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p18/actions/queue", (req, res) => {
    const { input, type, scheduledFor, recurringCron, maxRetries, source, metadata } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    try {
        res.json({ success: true, ...rae.queue(input.slice(0, 2000), { type, scheduledFor, recurringCron, maxRetries, source, metadata }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p18/actions/:id/retry", (req, res) => {
    try {
        res.json({ success: true, ...rae.retry(req.params.id) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.delete("/p18/actions/:id", (req, res) => {
    try {
        res.json({ success: true, ...rae.cancel(req.params.id) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/actions/audit", (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({ success: true, ...rae.getAuditTrail({ limit }) });
});

router.get("/p18/actions", (req, res) => {
    const { status, type, limit, offset } = req.query;
    res.json({ success: true, ...rae.listActions({ status, type, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.get("/p18/actions/:id", (req, res) => {
    const action = rae.getAction(req.params.id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    res.json({ success: true, action });
});

// ── 18B — Agent Execution Engine ─────────────────────────────────────────

router.post("/p18/agents/:agentId/execute", async (req, res) => {
    const { input, type, timeoutMs } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    try {
        const result = await aee.executeTask(req.params.agentId, input.slice(0, 2000), { type, timeoutMs });
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/p18/agents/runs/:runId/retry", async (req, res) => {
    try {
        const result = await aee.retryTask(req.params.runId);
        res.json({ success: true, ...result });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/agents/failures", (req, res) => {
    const { agentId, limit } = req.query;
    res.json({ success: true, ...aee.getFailures(agentId, { limit: parseInt(limit)||50 }) });
});

router.get("/p18/agents/:agentId/history", (req, res) => {
    const { status, limit, offset } = req.query;
    res.json({ success: true, ...aee.getHistory(req.params.agentId, { status, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

router.get("/p18/agents/:agentId", (req, res) => {
    const agent = aee.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json({ success: true, agent });
});

router.get("/p18/agents", (req, res) => {
    res.json({ success: true, agents: aee.listAgents() });
});

// ── 18C — Memory Persistence Layer ───────────────────────────────────────

router.post("/p18/memory", (req, res) => {
    const { key, value, type, tags, importance, confidence, agentIds, expiresAt } = req.body || {};
    if (!key) return res.status(400).json({ error: "key required" });
    try {
        res.json({ success: true, ...mpl.save({ key, value, type, tags, importance, confidence, agentIds, expiresAt }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p18/memory/stats", (req, res) => {
    res.json({ success: true, stats: mpl.stats() });
});

router.get("/p18/memory/search", (req, res) => {
    res.json({ success: true, ...mpl.search(req.query.q) });
});

router.get("/p18/memory/recall", (req, res) => {
    const { agentId, input, limit } = req.query;
    res.json({ success: true, ...mpl.recall({ agentId, input, limit: parseInt(limit)||10 }) });
});

router.get("/p18/memory/:nodeId", (req, res) => {
    const node = mpl.load(req.params.nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });
    res.json({ success: true, node });
});

router.patch("/p18/memory/:nodeId", (req, res) => {
    const updated = mpl.update(req.params.nodeId, req.body);
    if (!updated) return res.status(404).json({ error: "Node not found" });
    res.json({ success: true, node: updated });
});

router.delete("/p18/memory/:nodeId", (req, res) => {
    try {
        res.json({ success: true, ...mpl.archive(req.params.nodeId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/memory", (req, res) => {
    const { type, tag, minImportance, limit, offset, agentId } = req.query;
    res.json({ success: true, ...mpl.list({
        type, tag, agentId,
        minImportance: parseInt(minImportance)||0,
        limit:  parseInt(limit)||100,
        offset: parseInt(offset)||0,
    }) });
});

// ── 18D — Autonomous Task Loop ───────────────────────────────────────────

router.post("/p18/cycles", (req, res) => {
    const { goal, goalType, source } = req.body || {};
    if (!goal) return res.status(400).json({ error: "goal required" });
    try {
        res.json({ success: true, ...atl.startCycle(goal.slice(0, 500), { goalType, source }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/p18/cycles/stats", (req, res) => {
    res.json({ success: true, stats: atl.getStats() });
});

router.get("/p18/cycles/learning", (req, res) => {
    const { limit, agentId, event } = req.query;
    res.json({ success: true, ...atl.getLearningLog({ limit: parseInt(limit)||100, agentId, event }) });
});

router.get("/p18/cycles/:cycleId", (req, res) => {
    const cycle = atl.getCycle(req.params.cycleId);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });
    res.json({ success: true, cycle });
});

router.delete("/p18/cycles/:cycleId", (req, res) => {
    try {
        res.json({ success: true, ...atl.cancelCycle(req.params.cycleId) });
    } catch (e) { res.status(404).json({ error: e.message }); }
});

router.get("/p18/cycles", (req, res) => {
    const { status, goalType, limit, offset } = req.query;
    res.json({ success: true, ...atl.listCycles({ status, goalType, limit: parseInt(limit)||50, offset: parseInt(offset)||0 }) });
});

module.exports = router;
