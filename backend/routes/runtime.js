"use strict";
const router       = require("express").Router();
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const history      = require("../../agents/runtime/executionHistory.cjs");
const dlq          = require("../../agents/runtime/deadLetterQueue.cjs");
const execLog      = require("../utils/execLog.cjs");
const rateLimiter  = require("../middleware/rateLimiter");
const logger       = require("../utils/logger");

function _tryRequire(p) { try { return require(p); } catch { return null; } }
const governor = _tryRequire("../../agents/runtime/control/runtimeEmergencyGovernor.cjs");

// POST /runtime/dispatch — synchronous task dispatch
router.post("/runtime/dispatch", rateLimiter(30, 60_000), async (req, res) => {
    const input = (req.body.input || "").trim().slice(0, 2000);
    if (!input) return res.status(400).json({ success: false, error: "input required" });

    try {
        const result = await orchestrator.dispatch(input, {
            timeoutMs: parseInt(req.body.timeoutMs) || 30_000,
            retries:   parseInt(req.body.retries)   || 3,
        });
        return res.json(result);
    } catch (err) {
        logger.error("[Runtime Route] dispatch error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/queue — async background queuing
router.post("/runtime/queue", rateLimiter(60, 60_000), (req, res) => {
    const input    = (req.body.input    || "").trim().slice(0, 2000);
    const priority = parseInt(req.body.priority) || 1;   // 0=HIGH 1=NORMAL 2=LOW
    if (!input) return res.status(400).json({ success: false, error: "input required" });

    const id = orchestrator.queue(input, priority);
    return res.json({ success: true, queueId: id });
});

// GET /runtime/status — live diagnostics (includes SSE connection count)
router.get("/runtime/status", (req, res) => {
    const status = orchestrator.status();
    // Attach SSE metrics if available
    let sseMetrics = null;
    try {
        const stream = require("../../agents/runtime/runtimeStream.cjs");
        // runtimeStream exports the router; SSE state is accessible via the stream/status route
        // Directly read from the event bus metrics instead
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        sseMetrics = bus.metrics ? bus.metrics() : null;
    } catch { /* non-critical */ }
    return res.json({ ...status, sse: sseMetrics });
});

// GET /runtime/history — recent execution history
router.get("/runtime/history", (req, res) => {
    const n = Math.min(parseInt(req.query.n) || 20, 100);
    return res.json({ success: true, entries: history.recent(n) });
});

// GET /runtime/history/agent/:agentId
router.get("/runtime/history/agent/:agentId", (req, res) => {
    return res.json({ success: true, entries: history.byAgent(req.params.agentId) });
});

// GET /runtime/history/type/:taskType
router.get("/runtime/history/type/:taskType", (req, res) => {
    return res.json({ success: true, entries: history.byType(req.params.taskType) });
});

// POST /runtime/emergency/stop — halt all new executions
router.post("/runtime/emergency/stop", (req, res) => {
    if (!governor) return res.status(503).json({ success: false, error: "emergency governor unavailable" });
    try {
        const reason = (req.body.reason || "operator_initiated").slice(0, 200);
        const r = governor.declareEmergency({ authorityLevel: "governor", reason, level: "critical" });
        if (!r.declared && r.reason !== "emergency_already_active") {
            return res.status(400).json({ success: false, error: r.reason });
        }
        logger.warn(`[Runtime] EMERGENCY STOP — ${reason}`);
        return res.json({ success: true, emergencyId: r.emergencyId, alreadyActive: r.reason === "emergency_already_active" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/emergency/resume — re-allow executions
router.post("/runtime/emergency/resume", (req, res) => {
    if (!governor) return res.status(503).json({ success: false, error: "emergency governor unavailable" });
    try {
        const r = governor.resolveEmergency({ authorityLevel: "governor", resolution: "operator_resumed" });
        logger.info("[Runtime] Emergency resolved — resuming");
        return res.json({ success: r.resolved ?? true, ...r });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/health/deep — comprehensive runtime health check
router.get("/runtime/health/deep", (req, res) => {
    const status   = orchestrator.status();
    const mem      = process.memoryUsage();
    const heapMb   = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMb    = Math.round(mem.rss      / 1024 / 1024);

    const agentHealth = status.agents.map(a => ({
        id:          a.id,
        cbState:     a.cbState,
        active:      a.active,
        successRate: a.stats?.successRate ?? 1,
        healthy:     a.cbState === "closed",
    }));

    const degradedAgents  = agentHealth.filter(a => !a.healthy);
    const logInfo         = execLog.info();
    const dlqSize         = dlq.size();
    const histStats       = history.stats();

    const checks = {
        agents:        degradedAgents.length === 0,
        memory:        heapMb < 512,
        dlq:           dlqSize < 50,   // warn if DLQ growing
        logFile:       logInfo.exists || true,   // non-fatal if log dir missing
    };
    const healthy = Object.values(checks).every(Boolean);

    return res.status(healthy ? 200 : 207).json({
        healthy,
        checks,
        agents:   agentHealth,
        degraded: degradedAgents,
        memory:  { heapMb, rssMb },
        history: histStats,
        dlq:     { size: dlqSize },
        log:     logInfo,
        uptime:  Math.round(process.uptime()),
        ts:      new Date().toISOString(),
    });
});

// GET /runtime/dead-letter — list failed tasks
router.get("/runtime/dead-letter", (req, res) => {
    const n      = Math.min(parseInt(req.query.n) || 50, 500);
    const entries = dlq.list().slice(0, n);
    return res.json({ success: true, count: entries.length, total: dlq.size(), entries });
});

// DELETE /runtime/dead-letter/:taskId — remove one DLQ entry (manual cleanup)
router.delete("/runtime/dead-letter/:taskId", (req, res) => {
    const removed = dlq.remove(req.params.taskId);
    return res.json({ success: removed, taskId: req.params.taskId });
});

// GET /runtime/logs — tail persistent execution log
router.get("/runtime/logs", (req, res) => {
    const n = Math.min(parseInt(req.query.n) || 100, 500);
    return res.json({ success: true, entries: execLog.tail(n), ...execLog.info() });
});

module.exports = router;
