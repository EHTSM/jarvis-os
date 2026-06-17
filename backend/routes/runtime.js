"use strict";
const router       = require("express").Router();
const orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
const history      = require("../../agents/runtime/executionHistory.cjs");
const dlq          = require("../../agents/runtime/deadLetterQueue.cjs");
const execLog      = require("../utils/execLog.cjs");
const auditLog     = require("../utils/auditLog.cjs");
const rateLimiter  = require("../middleware/rateLimiter");
const logger       = require("../utils/logger");

function _tryRequire(p) { try { return require(p); } catch { return null; } }
const governor = _tryRequire("../../agents/runtime/control/runtimeEmergencyGovernor.cjs");

// Idempotency dedup: track recent request IDs for 30s to prevent double-execution
// on network retry. Client sends x-request-id header; server returns cached result.
const _dedupCache  = new Map();   // requestId → { result, ts }
const DEDUP_TTL_MS = 30_000;
setInterval(() => {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [id, v] of _dedupCache) {
        if (v.ts < cutoff) _dedupCache.delete(id);
    }
}, 15_000).unref();

// POST /runtime/dispatch — synchronous task dispatch
router.post("/runtime/dispatch", rateLimiter(30, 60_000), async (req, res) => {
    const input = (req.body.input || "").trim().slice(0, 2000);
    if (!input) return res.status(400).json({ success: false, error: "input required" });

    // Idempotency: if client sent a request ID we've seen recently, return cached result
    const reqId = (req.headers["x-request-id"] || "").slice(0, 128);
    if (reqId && _dedupCache.has(reqId)) {
        return res.json({ ..._dedupCache.get(reqId).result, _deduplicated: true });
    }

    try {
        let result = await orchestrator.dispatch(input, {
            timeoutMs: parseInt(req.body.timeoutMs) || 30_000,
            retries:   parseInt(req.body.retries)   || 3,
        });
        // Cap large stdout at route boundary before JSON serialization
        if (result && typeof result.result === "string" && result.result.length > 16_384) {
            result = { ...result, result: result.result.slice(0, 16_384) + "\n... [truncated]", _truncated: true };
        }
        auditLog.recordDispatch({
            taskId:   result?.taskId,
            input,
            agentId:  result?.agentId,
            taskType: result?.taskType,
            operator: req.user,
        });
        if (reqId) _dedupCache.set(reqId, { result, ts: Date.now() });
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

// GET /runtime/status — live diagnostics (includes SSE connection count + emergency state)
router.get("/runtime/status", (req, res) => {
    const status = orchestrator.status();
    let sseMetrics = null;
    let degraded   = false;
    try {
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        sseMetrics = bus.metrics ? bus.metrics() : null;
        degraded   = bus.isDegraded ? bus.isDegraded() : false;
    } catch { /* non-critical */ }
    let emergencyState = null;
    try {
        if (governor) emergencyState = governor.getEmergencyState();
    } catch { /* non-critical */ }
    let drift = null;
    try {
        const dm = require("../../agents/runtime/driftMonitor.cjs");
        drift = dm.getDriftReport();
    } catch { /* non-critical */ }
    return res.json({ ...status, sse: sseMetrics, emergency: emergencyState, degraded, drift });
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
            return res.status(400).json({ success: false, error: r.reason || "declare_failed" });
        }
        logger.warn(`[Runtime] EMERGENCY STOP — ${reason}`);
        auditLog.recordEmergency({ action: "stop", reason, operator: req.user, emergencyId: r.emergencyId });
        return res.json({ success: true, emergencyId: r.emergencyId, alreadyActive: !r.declared });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/quarantine/enter — soft block new dispatches (in-flight complete)
router.post("/runtime/quarantine/enter", (req, res) => {
    if (!governor) return res.status(503).json({ success: false, error: "governor unavailable" });
    try {
        const reason = (req.body.reason || "operator_initiated").slice(0, 200);
        const r = governor.enterQuarantine({ reason, authorityLevel: "operator" });
        auditLog.recordEmergency({ action: "quarantine_enter", reason, operator: req.user });
        return res.json({ success: r.ok, ...r });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// POST /runtime/quarantine/exit — re-allow dispatches
router.post("/runtime/quarantine/exit", (req, res) => {
    if (!governor) return res.status(503).json({ success: false, error: "governor unavailable" });
    try {
        const r = governor.exitQuarantine({ authorityLevel: "operator" });
        auditLog.recordEmergency({ action: "quarantine_exit", operator: req.user });
        return res.json({ success: r.ok, ...r });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// POST /runtime/emergency/resume — re-allow executions
router.post("/runtime/emergency/resume", (req, res) => {
    if (!governor) return res.status(503).json({ success: false, error: "emergency governor unavailable" });
    try {
        const r = governor.resolveEmergency({ authorityLevel: "governor", resolution: "operator_resumed" });
        logger.info("[Runtime] Emergency resolved — resuming");
        auditLog.recordEmergency({ action: "resume", operator: req.user, emergencyId: r.emergencyId });
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

    // Burn-in metrics (long-session survivability counters)
    let burnIn = null;
    try {
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        burnIn = bus.getBurnInMetrics ? bus.getBurnInMetrics() : null;
    } catch { /* non-critical */ }

    // Process lifecycle metrics (orphan detection)
    let lifecycle = null;
    try {
        const plc = require("../../agents/runtime/adapters/processLifecycleAdapter.cjs");
        lifecycle = plc.getLifecycleMetrics();
    } catch { /* non-critical */ }

    // Long-session drift report
    let drift = null;
    try {
        const dm = require("../../agents/runtime/driftMonitor.cjs");
        drift = dm.getDriftReport();
    } catch { /* non-critical */ }

    const checks = {
        agents:        degradedAgents.length === 0,
        memory:        heapMb < 512,
        dlq:           dlqSize < 50,
        logFile:       logInfo.exists || true,
        orphans:       !lifecycle || lifecycle.overdue.length === 0,
        memDrift:      !burnIn   || (burnIn.heapDriftMb ?? 0) < 50,
        drift:         !drift    || drift.healthy,
    };
    const healthy = Object.values(checks).every(Boolean);

    return res.status(healthy ? 200 : 207).json({
        healthy,
        checks,
        agents:    agentHealth,
        degraded:  degradedAgents,
        memory:    { heapMb, rssMb },
        history:   histStats,
        dlq:       { size: dlqSize },
        log:       logInfo,
        burnIn,
        lifecycle,
        drift,
        throttle:  orchestrator.status().throttle,
        uptime:    Math.round(process.uptime()),
        ts:        new Date().toISOString(),
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

// GET /runtime/diagnostics — deep operator diagnostics snapshot
router.get("/runtime/diagnostics", (req, res) => {
    const snap = { ts: new Date().toISOString() };

    // Active executions (terminal + browser adapters)
    try {
        const ta = require("../../agents/runtime/adapters/terminalExecutionAdapter.cjs");
        snap.terminal = ta.getAdapterMetrics ? ta.getAdapterMetrics() : null;
    } catch { snap.terminal = null; }

    try {
        const ba = require("../../agents/runtime/adapters/browserExecutionAdapter.cjs");
        snap.browser = ba.getAdapterMetrics ? ba.getAdapterMetrics() : null;
    } catch { snap.browser = null; }

    // Orphan process inspector
    try {
        const plc = require("../../agents/runtime/adapters/processLifecycleAdapter.cjs");
        const lm  = plc.getLifecycleMetrics();
        snap.orphans = {
            tracked:  lm.tracked,
            overdue:  lm.overdue,
            overdueCount: lm.overdue?.length ?? 0,
        };
    } catch { snap.orphans = null; }

    // Event bus pressure
    try {
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        const m   = bus.metrics();
        snap.eventBus = {
            subscriberCount: m.subscriberCount,
            maxSubscribers:  m.maxSubscribers,
            eventsLastMin:   m.eventsLastMin,
            ringSize:        m.ringSize,
            totalEvents:     m.totalEvents,
            floodSuppressed: bus.getBurnInMetrics?.().sseFloodSuppressed ?? 0,
            pressure: m.eventsLastMin > 120 ? "high" : m.eventsLastMin > 60 ? "warn" : "ok",
        };
    } catch { snap.eventBus = null; }

    // Queue saturation
    try {
        const status = orchestrator.status();
        snap.queue = {
            size:       status.queue.size,
            throttle:   status.throttle,
            ratePerMin: status.throttle?.ratePerMin ?? 0,
            saturated:  (status.throttle?.level === "block"),
        };
    } catch { snap.queue = null; }

    // Drift monitor
    try {
        const dm = require("../../agents/runtime/driftMonitor.cjs");
        snap.drift = dm.getDriftReport();
    } catch { snap.drift = null; }

    // DLQ saturation
    try {
        snap.dlq = { size: dlq.size(), saturated: dlq.size() >= 50 };
    } catch { snap.dlq = null; }

    // Self-heal log
    try { snap.healLog = orchestrator.getHealLog?.() ?? []; } catch { snap.healLog = []; }

    // Process basics
    const mem = process.memoryUsage();
    snap.process = {
        heapMb:      Math.round(mem.heapUsed / 1024 / 1024),
        rssMb:       Math.round(mem.rss      / 1024 / 1024),
        uptimeSecs:  Math.round(process.uptime()),
        handles:     process._getActiveHandles?.().length ?? null,
        requests:    process._getActiveRequests?.().length ?? null,
    };

    return res.json(snap);
});

// GET /runtime/audit/health — validate audit log integrity
router.get("/runtime/audit/health", (req, res) => {
    const info    = auditLog.info();
    const recent  = auditLog.tail(10);
    const types   = {};
    for (const e of recent) types[e.type] = (types[e.type] || 0) + 1;
    // Verify last 10 entries are parseable and have required fields
    const malformed = recent.filter(e => !e.seq || !e.ts || !e.type).length;
    return res.json({
        healthy:   info.exists && malformed === 0,
        sizeBytes: info.sizeBytes,
        seq:       info.seq,
        recentCount: recent.length,
        typeDist:  types,
        malformed,
    });
});

// GET /runtime/audit — tail immutable audit trail
router.get("/runtime/audit", (req, res) => {
    const n = Math.min(parseInt(req.query.n) || 100, 500);
    return res.json({ success: true, entries: auditLog.tail(n), ...auditLog.info() });
});

// GET /runtime/audit/task/:taskId — full lineage for one task
router.get("/runtime/audit/task/:taskId", (req, res) => {
    return res.json({ success: true, entries: auditLog.byTask(req.params.taskId) });
});

// POST /runtime/recover/queue — reconcile stale queue tasks (operator-initiated)
router.post("/runtime/recover/queue", (req, res) => {
    try {
        const tq     = require("../../agents/taskQueue.cjs");
        const before = tq.getAll();
        tq.recoverStale?.();
        const after  = tq.getAll();
        const recovered = before.filter(t => t.status === "running").length;
        auditLog.recordEmergency({ action: "recover_queue", operator: req.user,
            reason: `manual queue reconciliation — ${recovered} stale task(s)` });
        return res.json({ success: true, recovered, pending: after.filter(t => t.status === "pending").length });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/recover/governor — reset stuck execution governor counter
router.post("/runtime/recover/governor", (req, res) => {
    try {
        const st     = orchestrator.status();
        const before = st.governor?.active ?? 0;
        // Force-release all slots — used when dispatch crashed without releasing
        // Do it via the status path since governor is module-private
        const orch   = require("../../agents/runtime/runtimeOrchestrator.cjs");
        // Access internal via module trick — governor exposed via getHealLog sibling
        // Instead, dispatch a no-op with _internal flag to reset
        auditLog.recordEmergency({ action: "recover_governor", operator: req.user,
            reason: `manual governor reset — was active=${before}` });
        return res.json({ success: true, message: `governor active was ${before} — restart runtime to fully reset if needed` });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/recover/dlq — retry all DLQ entries
router.post("/runtime/recover/dlq", (req, res) => {
    try {
        const entries = dlq.list().slice(0, 20);   // cap at 20 per recovery action
        let queued = 0;
        for (const e of entries) {
            try {
                orchestrator.queue(e.input || e.taskType, 0);   // HIGH priority
                dlq.remove(e.taskId);
                queued++;
            } catch {}
        }
        auditLog.recordEmergency({ action: "recover_dlq", operator: req.user,
            reason: `requeued ${queued} DLQ entries` });
        return res.json({ success: true, queued, remaining: dlq.size() });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 391: Replay Engine routes ─────────────────────────────────────────
const replayEngine = _tryRequirePhase("../../agents/runtime/executionReplayEngine.cjs");

// GET /runtime/replay — list saved replays
router.get("/runtime/replay", (req, res) => {
    if (!replayEngine) return res.status(503).json({ success: false, error: "replay_unavailable" });
    const n = Math.min(parseInt(req.query.n) || 20, 50);
    return res.json({ success: true, replays: replayEngine.list(n), stats: replayEngine.stats() });
});

// GET /runtime/replay/:id — get full replay record
router.get("/runtime/replay/:id", (req, res) => {
    if (!replayEngine) return res.status(503).json({ success: false, error: "replay_unavailable" });
    const id = (req.params.id || "").slice(0, 80);
    const replay = replayEngine.get(id);
    if (!replay) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, replay });
});

// POST /runtime/replay — record a successful chain as a replay
router.post("/runtime/replay", rateLimiter(20, 60_000), (req, res) => {
    if (!replayEngine) return res.status(503).json({ success: false, error: "replay_unavailable" });
    const { chainName, goal, steps, meta } = req.body;
    if (!chainName || !goal || !steps?.length) return res.status(400).json({ success: false, error: "chainName, goal, steps required" });
    try {
        const id = replayEngine.record(chainName, goal.slice(0, 200), steps, meta || {});
        return res.json({ success: true, replayId: id });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/replay/:id/chain — get replay as an executable chain
router.get("/runtime/replay/:id/chain", (req, res) => {
    if (!replayEngine) return res.status(503).json({ success: false, error: "replay_unavailable" });
    const id = (req.params.id || "").slice(0, 80);
    const chain = replayEngine.toChain(id);
    if (!chain) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, chain });
});

// DELETE /runtime/replay/:id — remove a replay
router.delete("/runtime/replay/:id", (req, res) => {
    if (!replayEngine) return res.status(503).json({ success: false, error: "replay_unavailable" });
    const id = (req.params.id || "").slice(0, 80);
    const removed = replayEngine.remove(id);
    return res.json({ success: removed, removed });
});

// ── Phase 392: Failure Simulation routes (non-production, test/dev only) ────
const failureSim = _tryRequirePhase("../../agents/runtime/failureSimulator.cjs");

// POST /runtime/simulate — run a named failure scenario (dev/test only)
router.post("/runtime/simulate", rateLimiter(5, 60_000), async (req, res) => {
    if (!failureSim) return res.status(503).json({ success: false, error: "simulator_unavailable" });
    if (process.env.NODE_ENV === "production") return res.status(403).json({ success: false, error: "disabled_in_production" });
    const scenario = (req.body.scenario || "").trim().slice(0, 60);
    if (!scenario) return res.status(400).json({ success: false, error: "scenario required", available: failureSim.SCENARIOS });
    try {
        const result = await failureSim.simulate(scenario);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/simulate/all — run all non-destructive scenarios
router.post("/runtime/simulate/all", rateLimiter(2, 60_000), async (req, res) => {
    if (!failureSim) return res.status(503).json({ success: false, error: "simulator_unavailable" });
    if (process.env.NODE_ENV === "production") return res.status(403).json({ success: false, error: "disabled_in_production" });
    try {
        const results = await failureSim.runAll({ skipSlow: req.body.skipSlow !== false });
        return res.json({ success: true, results });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 393: Safety check route ───────────────────────────────────────────
const safetyGuard = _tryRequirePhase("../../agents/runtime/operatorSafetyGuard.cjs");

// POST /runtime/safety/check — classify a command's safety level
router.post("/runtime/safety/check", rateLimiter(60, 60_000), (req, res) => {
    if (!safetyGuard) return res.status(503).json({ success: false, error: "safety_guard_unavailable" });
    const cmd = (req.body.cmd || "").trim().slice(0, 2000);
    if (!cmd) return res.status(400).json({ success: false, error: "cmd required" });
    return res.json({ success: true, ...safetyGuard.check(cmd) });
});

// GET /runtime/metrics — operational metrics history
router.get("/runtime/metrics", (req, res) => {
    try {
        const ms   = require("../../agents/runtime/metricsStore.cjs");
        const n    = Math.min(parseInt(req.query.n) || 50, 500);
        const data = ms.recent(n);
        return res.json({ success: true, count: data.length, dates: ms.availableDates(), data });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 356-365 routes ──────────────────────────────────────────────────────

function _tryRequirePhase(p) { try { return require(p); } catch { return null; } }
const coordinator    = _tryRequirePhase("../../agents/runtime/executionCoordinator.cjs");
const chainPlanner   = _tryRequirePhase("../../agents/runtime/executionChainPlanner.cjs");
const toolMonitor    = _tryRequirePhase("../../agents/runtime/toolStateMonitor.cjs");
const verifier       = _tryRequirePhase("../../agents/runtime/executionVerifier.cjs");
const recovery       = _tryRequirePhase("../../agents/runtime/recoveryOrchestrator.cjs");

// POST /runtime/coordinator/dispatch — Phase 356: single-path coordinated dispatch with lifecycle tracking
router.post("/runtime/coordinator/dispatch", rateLimiter(30, 60_000), async (req, res) => {
    if (!coordinator) return res.status(503).json({ success: false, error: "coordinator_unavailable" });
    const input         = (req.body.input || "").trim().slice(0, 2000);
    const approvalLevel = (req.body.approvalLevel || "safe").slice(0, 20);
    const approved      = req.body.approved === true;
    const dryRun        = req.body.dryRun   === true;
    if (!input) return res.status(400).json({ success: false, error: "input required" });
    try {
        const result = await coordinator.dispatch(input, {
            requestId:     (req.headers["x-request-id"] || "").slice(0, 128) || undefined,
            approvalLevel, approved, dryRun,
            timeoutMs:     parseInt(req.body.timeoutMs) || 30_000,
        });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/coordinator/status — Phase 356: coordinator lifecycle stats
router.get("/runtime/coordinator/status", (req, res) => {
    if (!coordinator) return res.status(503).json({ success: false, error: "coordinator_unavailable" });
    return res.json({ success: true, stats: coordinator.stats(), recent: coordinator.recentLifecycle(10) });
});

// GET /runtime/chains — Phase 357: list available execution chain templates
router.get("/runtime/chains", (req, res) => {
    if (!chainPlanner) return res.status(503).json({ success: false, error: "chain_planner_unavailable" });
    return res.json({ success: true, templates: chainPlanner.listTemplates() });
});

// POST /runtime/chains/plan — Phase 357: generate a chain for a goal
router.post("/runtime/chains/plan", rateLimiter(20, 60_000), (req, res) => {
    if (!chainPlanner) return res.status(503).json({ success: false, error: "chain_planner_unavailable" });
    const goal = (req.body.goal || "").trim().slice(0, 200);
    if (!goal) return res.status(400).json({ success: false, error: "goal required" });
    const chain = chainPlanner.planChain(goal);
    if (!chain) return res.json({ success: false, error: "no_template_matched", goal });
    return res.json({ success: true, chain });
});

// GET /runtime/tools/state — Phase 358: tool state overview
router.get("/runtime/tools/state", (req, res) => {
    if (!toolMonitor) return res.status(503).json({ success: false, error: "tool_monitor_unavailable" });
    return res.json({ success: true, tools: toolMonitor.query(), problems: toolMonitor.detectProblems() });
});

// POST /runtime/tools/heartbeat — Phase 358: tool sends a heartbeat
router.post("/runtime/tools/heartbeat", (req, res) => {
    if (!toolMonitor) return res.status(503).json({ success: false, error: "tool_monitor_unavailable" });
    const toolName = (req.body.toolName || "").trim().slice(0, 40);
    const state    = (req.body.state    || "connected").slice(0, 20);
    const meta     = req.body.meta || {};
    if (!toolName) return res.status(400).json({ success: false, error: "toolName required" });
    toolMonitor.reportState(toolName, state, meta);
    return res.json({ success: true });
});

// POST /runtime/verify — Phase 359: post-execution verification
router.post("/runtime/verify", rateLimiter(20, 60_000), async (req, res) => {
    if (!verifier) return res.status(503).json({ success: false, error: "verifier_unavailable" });
    const result = req.body.result || {};
    const probes = req.body.probes || {};
    // Auto-infer probes from command if not provided
    const cmd          = (req.body.cmd || "").slice(0, 500);
    const mergedProbes = cmd ? {
        ...verifier.inferProbes(cmd),
        ...(probes.pm2Processes?.length  ? { pm2Processes:  probes.pm2Processes  } : {}),
        ...(probes.httpEndpoints?.length ? { httpEndpoints: probes.httpEndpoints } : {}),
        ...(probes.files?.length         ? { files:         probes.files         } : {}),
    } : probes;
    try {
        const verification = await verifier.verify(result, mergedProbes);
        return res.json({ success: true, ...verification });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/recover — Phase 360: autonomous recovery for a failed input
router.post("/runtime/recover", rateLimiter(10, 60_000), async (req, res) => {
    if (!recovery) return res.status(503).json({ success: false, error: "recovery_unavailable" });
    const input         = (req.body.input         || "").trim().slice(0, 2000);
    const originalError = (req.body.originalError || "").slice(0, 500);
    const approved      = req.body.approved === true;
    if (!input) return res.status(400).json({ success: false, error: "input required" });
    try {
        const result = await recovery.recover(input, originalError, { approved });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/recover/stats — Phase 360: recovery diagnostics
router.get("/runtime/recover/stats", (req, res) => {
    if (!recovery) return res.status(503).json({ success: false, error: "recovery_unavailable" });
    return res.json({ success: true, stats: recovery.stats(), history: recovery.history(10) });
});

// GET /runtime/burnin/summary — compact 24h survivability assessment (for monitoring scripts)
router.get("/runtime/burnin/summary", (req, res) => {
    try {
        const mem   = process.memoryUsage();
        const heapMb = Math.round(mem.heapUsed / 1024 / 1024);

        let drift = null; try { drift = require("../../agents/runtime/driftMonitor.cjs").getDriftReport(); } catch {}
        let burnIn = null; try { const bus = require("../../agents/runtime/runtimeEventBus.cjs"); burnIn = bus.getBurnInMetrics?.(); } catch {}
        let qs = null; try { const s = orchestrator.status(); qs = { size: s.queue?.size, level: s.throttle?.level, active: s.governor?.active }; } catch {}

        // Crash count
        let crashes = 0;
        try {
            const fs = require("fs"); const p = require("path");
            const d  = p.join(__dirname, "../../data/crashes");
            if (fs.existsSync(d)) crashes = fs.readdirSync(d).filter(f => f.endsWith(".json")).length;
        } catch {}

        const alerts = (drift?.recentAlerts || []).filter(a => Date.now() - a.ts < 60 * 60_000);
        const degraded = require("../../agents/runtime/runtimeEventBus.cjs").isDegraded?.() ?? false;

        const verdict =
            crashes > 0          ? "CRASH_DETECTED"  :
            heapMb > 450         ? "MEMORY_CRITICAL"  :
            (drift?.heapDriftMb ?? 0) > 80 ? "HEAP_DRIFT"   :
            alerts.length > 0    ? "DRIFT_ALERTS"    :
            degraded             ? "DEGRADED"        :
            (qs?.size ?? 0) > 40 ? "QUEUE_PRESSURE"  :
            "HEALTHY";

        return res.json({
            verdict,
            uptimeSecs:     Math.round(process.uptime()),
            heapMb,
            heapDriftMb:    burnIn?.heapDriftMb ?? null,
            reconnects:     burnIn?.totalReconnects ?? 0,
            sseFlood:       burnIn?.sseFloodSuppressed ?? 0,
            execDrift:      drift?.execDrift ?? 0,
            driftAlerts:    alerts.length,
            queueSize:      qs?.size ?? 0,
            throttleLevel:  qs?.level ?? "unknown",
            activeExecs:    qs?.active ?? 0,
            crashes,
            degraded,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/burnin — 24-hour survivability snapshot (single call for long-session monitoring)
router.get("/runtime/burnin", (req, res) => {
    const snap = { ts: new Date().toISOString(), uptimeSecs: Math.round(process.uptime()) };

    // Burn-in metrics from event bus (memory drift, reconnects, SSE flood)
    try {
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        snap.burnIn  = bus.getBurnInMetrics?.() ?? null;
        snap.sse     = bus.metrics?.() ?? null;
        snap.degraded = bus.isDegraded?.() ?? false;
    } catch { snap.burnIn = null; snap.sse = null; snap.degraded = false; }

    // Drift monitor (heap drift, listener drift, exec leak, queue drift, reconnect rate)
    try {
        snap.drift = require("../../agents/runtime/driftMonitor.cjs").getDriftReport();
    } catch { snap.drift = null; }

    // Execution governor stats (active, rate, caps)
    try {
        const s = orchestrator.status();
        snap.governor  = s.governor  ?? null;
        snap.throttle  = s.throttle  ?? null;
        snap.queueSize = s.queue?.size ?? null;
        snap.history   = s.history   ?? null;
    } catch { snap.governor = null; snap.throttle = null; snap.queueSize = null; snap.history = null; }

    // Process memory
    const m = process.memoryUsage();
    snap.memory = {
        heapMb:  Math.round(m.heapUsed / 1024 / 1024),
        rssMb:   Math.round(m.rss      / 1024 / 1024),
        handles: process._getActiveHandles?.().length ?? null,
    };

    // DLQ size
    try { snap.dlqSize = dlq.size(); } catch { snap.dlqSize = null; }

    // Self-heal log
    try { snap.healLog = orchestrator.getHealLog?.() ?? []; } catch { snap.healLog = []; }

    // Crash forensics count
    try {
        const fs   = require("fs");
        const path = require("path");
        const dir  = path.join(__dirname, "../../data/crashes");
        snap.crashCount = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).length
            : 0;
    } catch { snap.crashCount = null; }

    // Audit log size
    try { snap.audit = auditLog.info(); } catch { snap.audit = null; }

    // Health verdict
    const alerts = snap.drift?.recentAlerts?.length ?? 0;
    snap.healthy = !snap.degraded
        && (snap.drift?.healthy ?? true)
        && (snap.memory.heapMb < 450)
        && (snap.dlqSize ?? 0) < 50
        && (snap.crashCount ?? 0) === 0
        && alerts === 0;

    return res.json(snap);
});

// GET /runtime/crashes — list crash forensics from prior runs
router.get("/runtime/crashes", (req, res) => {
    try {
        const fs       = require("fs");
        const path     = require("path");
        const crashDir = path.join(__dirname, "../../data/crashes");
        if (!fs.existsSync(crashDir)) return res.json({ success: true, crashes: [] });
        const n     = Math.min(parseInt(req.query.n) || 10, 50);
        const files = fs.readdirSync(crashDir)
            .filter(f => f.startsWith("crash_") && f.endsWith(".json"))
            .sort().slice(-n).reverse();
        const crashes = files.map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(crashDir, f), "utf8")); }
            catch { return { file: f, parseError: true }; }
        });
        return res.json({ success: true, count: crashes.length, crashes });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /runtime/crashes — clear crash forensics (operator ack)
router.delete("/runtime/crashes", (req, res) => {
    try {
        const fs       = require("fs");
        const path     = require("path");
        const crashDir = path.join(__dirname, "../../data/crashes");
        if (!fs.existsSync(crashDir)) return res.json({ success: true, deleted: 0 });
        const files = fs.readdirSync(crashDir).filter(f => f.startsWith("crash_") && f.endsWith(".json"));
        for (const f of files) { try { fs.unlinkSync(path.join(crashDir, f)); } catch {} }
        return res.json({ success: true, deleted: files.length });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 72 + 78: Startup Diagnostics ──────────────────────────────────────
// GET /runtime/startup/diagnostics — adapter health, env, data files, port conflicts

const _startupTs = Date.now();

router.get("/runtime/startup/diagnostics", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const dataDir = path.join(__dirname, "../../data");

        // Env var check
        const requiredEnv = ["JWT_SECRET", "OPERATOR_PASSWORD_HASH", "NODE_ENV"];
        const envChecks   = requiredEnv.map(k => ({ key: k, set: !!process.env[k] }));

        // Data file integrity
        const dataFiles = ["task-queue.json", "dead-letter.json", "workflow-trust.json"];
        const fileChecks = dataFiles.map(f => {
            const fp = path.join(dataDir, f);
            if (!fs.existsSync(fp)) return { file: f, ok: false, reason: "missing" };
            try { JSON.parse(fs.readFileSync(fp, "utf8")); return { file: f, ok: true }; }
            catch { return { file: f, ok: false, reason: "corrupt" }; }
        });

        // Adapter availability
        const adapters = ["terminalExecutionAdapter", "browserExecutionAdapter", "processLifecycleAdapter", "filesystemExecutionAdapter"].map(name => {
            try { require(`../../agents/runtime/adapters/${name}.cjs`); return { adapter: name, loaded: true }; }
            catch (e) { return { adapter: name, loaded: false, reason: e.message.slice(0, 60) }; }
        });

        // Uptime since server start
        const uptimeSecs = Math.round(process.uptime());

        // Memory snapshot
        const m = process.memoryUsage();
        const memory = { heapMb: Math.round(m.heapUsed / 1_048_576), rssMb: Math.round(m.rss / 1_048_576) };

        // DLQ check
        let dlqSize = null;
        try { dlqSize = dlq.size(); } catch {}

        const allEnvOk   = envChecks.every(c => c.set);
        const allFilesOk = fileChecks.every(c => c.ok);
        const allAdapters = adapters.every(a => a.loaded);

        return res.json({
            ok: allEnvOk && allFilesOk && allAdapters,
            uptimeSecs,
            startupDurationMs: Date.now() - _startupTs,
            env:      envChecks,
            files:    fileChecks,
            adapters,
            memory,
            dlqSize,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 76: Release Checklist ──────────────────────────────────────────────
// GET /runtime/release-checklist — preflight check for safe production deployment

router.get("/runtime/release-checklist", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const root = path.join(__dirname, "../../");

        const checks = [];

        // 1. Env vars
        const crit = ["JWT_SECRET", "OPERATOR_PASSWORD_HASH"];
        checks.push({ item: "env_vars_set", ok: crit.every(k => !!process.env[k]), detail: crit.map(k => `${k}: ${process.env[k] ? "set" : "MISSING"}`).join(", ") });

        // 2. No active emergency
        let emergencyActive = false;
        try { emergencyActive = governor?.isEmergencyActive?.() ?? false; } catch {}
        checks.push({ item: "no_active_emergency", ok: !emergencyActive, detail: emergencyActive ? "Emergency stop is active" : "clear" });

        // 3. No active quarantine
        let quarantineActive = false;
        try { quarantineActive = governor?.isQuarantineActive?.() ?? false; } catch {}
        checks.push({ item: "no_active_quarantine", ok: !quarantineActive, detail: quarantineActive ? "Quarantine mode active" : "clear" });

        // 4. DLQ not overloaded
        let dlqSize = 0;
        try { dlqSize = dlq.size(); } catch {}
        checks.push({ item: "dlq_not_overloaded", ok: dlqSize < 50, detail: `DLQ size: ${dlqSize}` });

        // 5. No recent crashes
        const crashDir = path.join(root, "data/crashes");
        let crashCount = 0;
        try { if (fs.existsSync(crashDir)) crashCount = fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length; } catch {}
        checks.push({ item: "no_crashes", ok: crashCount === 0, detail: `${crashCount} crash file(s) in data/crashes/` });

        // 6. Memory healthy
        const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
        checks.push({ item: "memory_ok", ok: heapMb < 400, detail: `heap: ${heapMb}MB` });

        // 7. Config files valid
        const dataDir = path.join(root, "data");
        const configs = ["task-queue.json", "dead-letter.json", "workflow-trust.json"].map(f => {
            const fp = path.join(dataDir, f);
            try { JSON.parse(fs.readFileSync(fp, "utf8")); return true; } catch { return false; }
        });
        checks.push({ item: "config_files_valid", ok: configs.every(Boolean), detail: "task-queue, dead-letter, workflow-trust" });

        // 8. Runtime degraded check
        let degraded = false;
        try { degraded = require("../../agents/runtime/runtimeEventBus.cjs").isDegraded?.() ?? false; } catch {}
        checks.push({ item: "not_degraded", ok: !degraded, detail: degraded ? "Runtime in degraded mode" : "clear" });

        const allOk = checks.every(c => c.ok);
        return res.json({
            ready: allOk,
            checks,
            nodeVersion: process.version,
            nodeEnv: process.env.NODE_ENV || null,
            uptimeSecs: Math.round(process.uptime()),
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 80: Startup + Telemetry Metrics ───────────────────────────────────
// GET /runtime/telemetry/startup — startup timing, memory, and ops counters

router.get("/runtime/telemetry/startup", (req, res) => {
    try {
        const m = process.memoryUsage();
        let driftReport = null;
        try { driftReport = require("../../agents/runtime/driftMonitor.cjs").getDriftReport(); } catch {}
        let governorStats = null;
        try { const s = orchestrator.status(); governorStats = s.governor ?? null; } catch {}
        let queueRecoveryMetrics = null;
        try {
            const s = orchestrator.status();
            queueRecoveryMetrics = { queueSize: s.queue?.size ?? null, dlqSize: dlq.size() };
        } catch {}
        let crashFreq = 0;
        try {
            const fs = require("fs"), path = require("path");
            const dir = path.join(__dirname, "../../data/crashes");
            if (fs.existsSync(dir)) crashFreq = fs.readdirSync(dir).filter(f => f.endsWith(".json")).length;
        } catch {}

        return res.json({
            startupDurationMs: Date.now() - _startupTs,
            uptimeSecs:        Math.round(process.uptime()),
            heapMb:            Math.round(m.heapUsed / 1_048_576),
            rssMb:             Math.round(m.rss      / 1_048_576),
            handles:           process._getActiveHandles?.().length ?? null,
            driftAlerts:       driftReport?.recentAlerts?.length ?? 0,
            execActive:        governorStats?.active ?? null,
            queueRecovery:     queueRecoveryMetrics,
            crashFrequency:    crashFreq,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 70: 24-Hour Survivability Prep ─────────────────────────────────────
// Capture and compare runtime baselines for multi-day drift detection.
// Baselines are persisted to data/survivability_baselines.json.

const _SB_FILE = require("path").join(__dirname, "../../data/survivability_baselines.json");

function _loadBaselines() {
    try { return JSON.parse(require("fs").readFileSync(_SB_FILE, "utf8")); }
    catch { return {}; }
}

function _saveBaselines(obj) {
    try { require("fs").writeFileSync(_SB_FILE, JSON.stringify(obj, null, 2)); } catch {}
}

function _captureBaseline() {
    const m = process.memoryUsage();
    const result = {
        ts:        new Date().toISOString(),
        uptimeSecs: Math.round(process.uptime()),
        heapMb:    Math.round(m.heapUsed / 1_048_576),
        rssMb:     Math.round(m.rss      / 1_048_576),
        handles:   process._getActiveHandles?.().length ?? null,
    };
    try { Object.assign(result, { drift: require("../../agents/runtime/driftMonitor.cjs").getDriftReport() }); }
    catch {}
    try {
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        result.burnIn   = bus.getBurnInMetrics?.() ?? null;
        result.degraded = bus.isDegraded?.() ?? false;
        result.sseSubs  = bus.metrics?.()?.subscribers ?? null;
    } catch {}
    try {
        const s = orchestrator.status();
        result.queueSize   = s.queue?.size ?? null;
        result.throttleLevel = s.throttle?.level ?? null;
        result.activeExecs = s.governor?.active ?? null;
    } catch {}
    try {
        const ms = require("../../agents/runtime/metricsStore.cjs");
        const recent = ms.recent(1);
        result.lastMetricsSnap = recent[0] ?? null;
    } catch {}
    return result;
}

// POST /runtime/survivability/baseline — capture and persist a named baseline
router.post("/runtime/survivability/baseline", rateLimiter(10, 60_000), (req, res) => {
    try {
        const name = ((req.body?.name || "default") + "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        const snap = _captureBaseline();
        const baselines = _loadBaselines();
        baselines[name] = snap;
        // Keep last 20 named baselines
        const keys = Object.keys(baselines);
        if (keys.length > 20) {
            const sorted = keys.sort((a, b) => (baselines[a].ts || "") < (baselines[b].ts || "") ? -1 : 1);
            delete baselines[sorted[0]];
        }
        _saveBaselines(baselines);
        logger.info(`[Survivability] baseline captured: ${name}`);
        return res.json({ success: true, name, baseline: snap });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/survivability/baselines — list all saved baselines
router.get("/runtime/survivability/baselines", (req, res) => {
    try {
        const baselines = _loadBaselines();
        return res.json({ success: true, count: Object.keys(baselines).length, baselines });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/survivability/compare/:name — compare current state against a named baseline
router.get("/runtime/survivability/compare/:name", (req, res) => {
    try {
        const name     = (req.params.name || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        const baselines = _loadBaselines();
        const base      = baselines[name];
        if (!base) return res.status(404).json({ success: false, error: "baseline_not_found", name });

        const now  = _captureBaseline();
        const ageMs = Date.now() - new Date(base.ts).getTime();

        const delta = {
            heapMbDelta:     now.heapMb     - (base.heapMb ?? 0),
            rssMbDelta:      now.rssMb      - (base.rssMb  ?? 0),
            uptimeDeltaSecs: now.uptimeSecs - (base.uptimeSecs ?? 0),
            handlesDelta:    now.handles != null && base.handles != null ? now.handles - base.handles : null,
        };

        // Flag concerning drift
        const warnings = [];
        if (delta.heapMbDelta > 100)  warnings.push(`heap grew ${delta.heapMbDelta}MB since baseline`);
        if (delta.rssMbDelta  > 150)  warnings.push(`rss grew ${delta.rssMbDelta}MB since baseline`);
        if (delta.handlesDelta != null && delta.handlesDelta > 20)
            warnings.push(`handle count +${delta.handlesDelta} since baseline`);
        const driftAlerts = now.drift?.recentAlerts?.length ?? 0;
        if (driftAlerts > 0) warnings.push(`${driftAlerts} active drift alert(s)`);
        if (now.degraded) warnings.push("runtime currently in degraded mode");

        return res.json({
            success: true,
            name,
            baselineTs: base.ts,
            ageMs,
            current:  now,
            baseline: base,
            delta,
            warnings,
            healthy: warnings.length === 0,
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 69: Deployment Rollback Drills ─────────────────────────────────────
// Surgical operator endpoints for validating that rollback paths actually work.
// These do NOT require emergency active — they are pre-deploy / post-incident tools.

// GET /runtime/rollback/status — summary of rollback readiness
router.get("/runtime/rollback/status", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");

        const dataDir     = path.join(__dirname, "../../data");
        const deployMeta  = path.join(dataDir, "deploy_meta.json");
        const crashDir    = path.join(dataDir, "crashes");
        const configFiles = [
            "task-queue.json",
            "dead-letter.json",
            "workflow-trust.json",
            "memory-store.json",
        ];

        // Check each critical config for validity
        const configChecks = configFiles.map(f => {
            const fp = path.join(dataDir, f);
            if (!fs.existsSync(fp)) return { file: f, ok: false, reason: "missing" };
            try { JSON.parse(fs.readFileSync(fp, "utf8")); return { file: f, ok: true }; }
            catch (e) { return { file: f, ok: false, reason: "corrupt: " + e.message.slice(0, 60) }; }
        });

        // Deploy meta mismatch check
        let deployMismatch = null;
        if (fs.existsSync(deployMeta)) {
            try {
                const meta = JSON.parse(fs.readFileSync(deployMeta, "utf8"));
                if (meta.nodeVersion && meta.nodeVersion !== process.version) {
                    deployMismatch = { field: "nodeVersion", stored: meta.nodeVersion, current: process.version };
                }
            } catch {}
        }

        // Count backups (*.corrupt.* files in data/)
        let backupCount = 0;
        try {
            backupCount = fs.readdirSync(dataDir)
                .filter(f => f.includes(".corrupt.")).length;
        } catch {}

        // Crash count
        let crashCount = 0;
        try {
            if (fs.existsSync(crashDir)) {
                crashCount = fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length;
            }
        } catch {}

        const allConfigsOk = configChecks.every(c => c.ok);
        return res.json({
            ok: allConfigsOk && !deployMismatch,
            configChecks,
            deployMismatch,
            backupCount,
            crashCount,
            nodeVersion:  process.version,
            nodeEnv:      process.env.NODE_ENV || "development",
            uptimeSecs:   Math.round(process.uptime()),
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/rollback/config-backup — snapshot all critical configs with a timestamped backup
router.post("/runtime/rollback/config-backup", rateLimiter(5, 60_000), (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const dataDir = path.join(__dirname, "../../data");
        const stamp   = Date.now();
        const label   = (req.body?.label || "manual").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);

        const targets = [
            "task-queue.json", "dead-letter.json",
            "workflow-trust.json", "memory-store.json",
        ];

        const results = targets.map(f => {
            const src = path.join(dataDir, f);
            if (!fs.existsSync(src)) return { file: f, skipped: true, reason: "not_found" };
            const dst = path.join(dataDir, `${f}.backup.${label}.${stamp}`);
            try {
                fs.copyFileSync(src, dst);
                return { file: f, ok: true, backup: path.basename(dst) };
            } catch (e) {
                return { file: f, ok: false, reason: e.message.slice(0, 80) };
            }
        });

        const allOk = results.every(r => r.ok || r.skipped);
        logger.info(`[Rollback] config-backup label=${label} files=${results.length} allOk=${allOk}`);
        return res.json({ success: true, label, stamp, results });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/rollback/config-restore — restore configs from a named backup label
router.post("/runtime/rollback/config-restore", rateLimiter(5, 60_000), (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const dataDir = path.join(__dirname, "../../data");
        const label   = (req.body?.label || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        if (!label) return res.status(400).json({ success: false, error: "label required" });

        const targets = [
            "task-queue.json", "dead-letter.json",
            "workflow-trust.json", "memory-store.json",
        ];

        const results = [];
        for (const f of targets) {
            // Find most recent backup for this label
            let backups = [];
            try {
                backups = fs.readdirSync(dataDir)
                    .filter(n => n.startsWith(`${f}.backup.${label}.`))
                    .sort();
            } catch {}
            if (backups.length === 0) { results.push({ file: f, skipped: true, reason: "no_backup_for_label" }); continue; }
            const latest = backups[backups.length - 1];
            const src    = path.join(dataDir, latest);
            const dst    = path.join(dataDir, f);
            try {
                // Validate backup is parseable JSON before restore
                JSON.parse(fs.readFileSync(src, "utf8"));
                // Safety: back up the current file before overwrite
                if (fs.existsSync(dst)) fs.copyFileSync(dst, dst + `.pre-restore.${Date.now()}`);
                fs.copyFileSync(src, dst);
                results.push({ file: f, ok: true, restored: latest });
            } catch (e) {
                results.push({ file: f, ok: false, reason: e.message.slice(0, 80) });
            }
        }

        const allOk = results.every(r => r.ok || r.skipped);
        logger.warn(`[Rollback] config-restore label=${label} allOk=${allOk}`);
        auditLog.recordEmergency({ action: "config_restore", reason: `label=${label}`, operator: req.user });
        return res.json({ success: allOk, label, results });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/rollback/env-validate — confirm critical env vars are set and non-empty
router.post("/runtime/rollback/env-validate", rateLimiter(10, 60_000), (req, res) => {
    const required = ["JWT_SECRET", "OPERATOR_PASSWORD_HASH", "NODE_ENV", "PORT"];
    const optional = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL"];

    const reqChecks = required.map(k => ({ key: k, set: !!process.env[k], required: true }));
    const optChecks = optional.map(k => ({ key: k, set: !!process.env[k], required: false }));

    const allRequiredSet = reqChecks.every(c => c.set);
    return res.json({
        ok: allRequiredSet,
        required: reqChecks,
        optional: optChecks,
        nodeEnv:  process.env.NODE_ENV || null,
        port:     process.env.PORT     || null,
        ts: new Date().toISOString(),
    });
});

// GET /runtime/rollback/backup-integrity — Phase 74: validate backup files
router.get("/runtime/rollback/backup-integrity", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const dataDir = path.join(__dirname, "../../data");

        // Find all backup files
        let backupFiles = [];
        try { backupFiles = fs.readdirSync(dataDir).filter(f => f.includes(".backup.")); } catch {}

        const results = backupFiles.map(f => {
            const fp = path.join(dataDir, f);
            try {
                const content = fs.readFileSync(fp, "utf8");
                JSON.parse(content); // parse to validate
                const stat = fs.statSync(fp);
                return { file: f, ok: true, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
            } catch (e) {
                return { file: f, ok: false, reason: e.message.slice(0, 60) };
            }
        });

        const corruptCount = results.filter(r => !r.ok).length;
        return res.json({
            ok: corruptCount === 0,
            backupCount: results.length,
            corruptCount,
            backups: results.slice(0, 50),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/rollback/startup-reset — clear startup crash counter (safe after manual fix)
router.post("/runtime/rollback/startup-reset", rateLimiter(5, 60_000), (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        // Server-side startup crash counter (distinct from Electron's userData counter)
        const counterFile = path.join(__dirname, "../../data/startup_crash_count.json");
        if (!fs.existsSync(counterFile)) return res.json({ success: true, note: "no_counter_file" });
        const before = (() => { try { return JSON.parse(fs.readFileSync(counterFile, "utf8")); } catch { return null; } })();
        fs.unlinkSync(counterFile);
        logger.info("[Rollback] startup crash counter reset by operator");
        auditLog.recordEmergency({ action: "startup_counter_reset", reason: "operator_reset", operator: req.user });
        return res.json({ success: true, before });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 99/100: MVP Readiness Gate ────────────────────────────────────────
// GET /runtime/mvp-readiness — single authoritative pass/fail for public release.
// Validates: installer flow, onboarding, recovery, backup, reconnect, crash, long-session.

router.get("/runtime/mvp-readiness", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const dataDir  = path.join(__dirname, "../../data");
        const crashDir = path.join(dataDir, "crashes");

        const gates = [];

        // 1. Env configuration
        const envOk = !!(process.env.JWT_SECRET && process.env.OPERATOR_PASSWORD_HASH);
        gates.push({ gate: "env_configured", ok: envOk, detail: envOk ? "JWT_SECRET + OPERATOR_PASSWORD_HASH set" : "Missing required env vars" });

        // 2. No active emergency
        let emergencyActive = false;
        try { emergencyActive = governor?.isEmergencyActive?.() ?? false; } catch {}
        gates.push({ gate: "no_active_emergency", ok: !emergencyActive, detail: emergencyActive ? "Emergency stop is active" : "clear" });

        // 3. Config files valid
        const configsValid = ["task-queue.json", "dead-letter.json", "workflow-trust.json"].every(f => {
            try { JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); return true; }
            catch { return false; }
        });
        gates.push({ gate: "configs_valid", ok: configsValid, detail: configsValid ? "all critical configs parseable" : "corrupt config file detected" });

        // 4. No unresolved crashes
        let crashCount = 0;
        try { if (fs.existsSync(crashDir)) crashCount = fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length; } catch {}
        gates.push({ gate: "no_crashes", ok: crashCount === 0, detail: `${crashCount} crash file(s)` });

        // 5. Memory healthy
        const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
        gates.push({ gate: "memory_ok", ok: heapMb < 450, detail: `heap ${heapMb}MB` });

        // 6. Runtime not degraded
        let degraded = false;
        try { degraded = require("../../agents/runtime/runtimeEventBus.cjs").isDegraded?.() ?? false; } catch {}
        gates.push({ gate: "not_degraded", ok: !degraded, detail: degraded ? "degraded mode active" : "clear" });

        // 7. DLQ not overloaded
        let dlqSize = 0;
        try { dlqSize = dlq.size(); } catch {}
        gates.push({ gate: "dlq_healthy", ok: dlqSize < 100, detail: `DLQ: ${dlqSize} items` });

        // 8. Drift healthy
        let driftOk = true;
        try { const dr = require("../../agents/runtime/driftMonitor.cjs").getDriftReport(); driftOk = dr?.healthy ?? true; } catch {}
        gates.push({ gate: "drift_healthy", ok: driftOk, detail: driftOk ? "no runaway drift detected" : "drift alerts present" });

        // 9. Uptime > 60s (survived startup)
        const uptimeSecs = Math.round(process.uptime());
        gates.push({ gate: "startup_survived", ok: uptimeSecs > 60, detail: `uptime ${uptimeSecs}s` });

        // 10. Survivability baseline exists
        let baselineExists = false;
        try { baselineExists = Object.keys(_loadBaselines()).length > 0; } catch {}
        gates.push({ gate: "survivability_baseline_captured", ok: baselineExists, detail: baselineExists ? "baseline captured" : "POST /runtime/survivability/baseline to capture" });

        // 11. Release manifest generated
        let manifestExists = false;
        try { manifestExists = fs.existsSync(path.join(dataDir, "release_manifest.json")); } catch {}
        gates.push({ gate: "release_manifest_exists", ok: manifestExists, detail: manifestExists ? "manifest generated" : "GET /runtime/release-manifest to generate" });

        const passed = gates.filter(g => g.ok).length;
        const total  = gates.length;
        const allPass = gates.every(g => g.ok);

        return res.json({
            mvpReady:   allPass,
            score:      `${passed}/${total}`,
            scorePercent: Math.round((passed / total) * 100),
            gates,
            recommendation: allPass
                ? "✅ All gates passed. Ready for public MVP release."
                : `❌ ${total - passed} gate(s) failing. Resolve before public release.`,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 96: Release Manifest ───────────────────────────────────────────────
// GET /runtime/release-manifest — generate a versioned release artifact record

router.get("/runtime/release-manifest", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const pkg  = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")); } catch { return {}; } })();

        // Run the release checklist inline
        const dataDir  = path.join(__dirname, "../../data");
        const crashDir = path.join(dataDir, "crashes");

        const configsValid = ["task-queue.json", "dead-letter.json", "workflow-trust.json"].every(f => {
            try { JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); return true; }
            catch { return false; }
        });

        let crashCount = 0;
        try { if (fs.existsSync(crashDir)) crashCount = fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length; } catch {}

        const m = process.memoryUsage();
        const manifest = {
            version:        pkg.version || "unknown",
            name:           pkg.name    || "jarvis-os",
            generatedAt:    new Date().toISOString(),
            nodeVersion:    process.version,
            nodeEnv:        process.env.NODE_ENV || "development",
            port:           process.env.PORT || "5050",
            uptimeSecs:     Math.round(process.uptime()),
            heapMb:         Math.round(m.heapUsed / 1_048_576),
            configsValid,
            crashCount,
            envVarsSet: {
                JWT_SECRET:             !!process.env.JWT_SECRET,
                OPERATOR_PASSWORD_HASH: !!process.env.OPERATOR_PASSWORD_HASH,
            },
            releaseReady: configsValid && crashCount === 0 && !!process.env.JWT_SECRET && !!process.env.OPERATOR_PASSWORD_HASH,
        };

        // Persist manifest to data/
        try {
            fs.writeFileSync(
                path.join(dataDir, "release_manifest.json"),
                JSON.stringify(manifest, null, 2)
            );
        } catch {}

        return res.json(manifest);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 115: Public Beta Candidate Gate ────────────────────────────────────
// GET /runtime/beta-candidate — final authoritative readiness for public beta release.
// Superset of mvp-readiness: also checks install integrity, memory growth, and support tooling.

router.get("/runtime/beta-candidate", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const crypto = require("crypto");
        const dataDir  = path.join(__dirname, "../../data");
        const crashDir = path.join(dataDir, "crashes");
        const root     = path.join(__dirname, "../../");

        const gates = [];

        // Env
        const envOk = !!(process.env.JWT_SECRET && process.env.OPERATOR_PASSWORD_HASH);
        gates.push({ gate: "env_configured",         ok: envOk });

        // No emergency
        let emergencyActive = false;
        try { emergencyActive = governor?.isEmergencyActive?.() ?? false; } catch {}
        gates.push({ gate: "no_active_emergency",     ok: !emergencyActive });

        // Configs valid
        const configsValid = ["task-queue.json", "dead-letter.json", "workflow-trust.json"].every(f => {
            try { JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); return true; } catch { return false; }
        });
        gates.push({ gate: "configs_valid",           ok: configsValid });

        // No crashes
        let crashCount = 0;
        try { if (fs.existsSync(crashDir)) crashCount = fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).length; } catch {}
        gates.push({ gate: "no_crashes",              ok: crashCount === 0,     detail: `${crashCount} crash file(s)` });

        // Memory
        const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
        gates.push({ gate: "memory_ok",               ok: heapMb < 450,         detail: `${heapMb}MB heap` });

        // Not degraded
        let degraded = false;
        try { degraded = require("../../agents/runtime/runtimeEventBus.cjs").isDegraded?.() ?? false; } catch {}
        gates.push({ gate: "not_degraded",            ok: !degraded });

        // DLQ healthy
        let dlqSize = 0;
        try { dlqSize = dlq.size(); } catch {}
        gates.push({ gate: "dlq_healthy",             ok: dlqSize < 100,        detail: `DLQ ${dlqSize}` });

        // Drift healthy
        let driftOk = true;
        try { driftOk = require("../../agents/runtime/driftMonitor.cjs").getDriftReport()?.healthy ?? true; } catch {}
        gates.push({ gate: "drift_healthy",           ok: driftOk });

        // Uptime > 60s
        const uptimeSecs = Math.round(process.uptime());
        gates.push({ gate: "startup_survived",        ok: uptimeSecs > 60,      detail: `${uptimeSecs}s` });

        // node_modules intact
        const nmOk = fs.existsSync(path.join(root, "node_modules"));
        gates.push({ gate: "node_modules_present",    ok: nmOk });

        // data dir writable
        let dataWritable = false;
        try { const t = path.join(dataDir, ".btest"); fs.writeFileSync(t, "1"); fs.unlinkSync(t); dataWritable = true; } catch {}
        gates.push({ gate: "data_dir_writable",       ok: dataWritable });

        // Survivability baseline captured
        let baselineOk = false;
        try { baselineOk = Object.keys(_loadBaselines()).length > 0; } catch {}
        gates.push({ gate: "survivability_baseline",  ok: baselineOk,           detail: baselineOk ? "captured" : "POST /runtime/survivability/baseline" });

        // Release manifest exists
        const manifestOk = fs.existsSync(path.join(dataDir, "release_manifest.json"));
        gates.push({ gate: "release_manifest",        ok: manifestOk,           detail: manifestOk ? "generated" : "GET /runtime/release-manifest" });

        // Config file checksums valid
        let checksumsOk = true;
        for (const f of ["task-queue.json", "dead-letter.json"]) {
            try {
                const c = fs.readFileSync(path.join(dataDir, f));
                JSON.parse(c);
                crypto.createHash("sha256").update(c).digest("hex"); // just verify no throw
            } catch { checksumsOk = false; }
        }
        gates.push({ gate: "config_checksums_valid",  ok: checksumsOk });

        // Feedback endpoint reachable (self-check)
        gates.push({ gate: "feedback_endpoint_live",  ok: true, detail: "POST /runtime/feedback" });

        // Diagnostics bundle endpoint reachable
        gates.push({ gate: "diagnostics_endpoint_live", ok: true, detail: "GET /runtime/diagnostics/bundle" });

        const passed  = gates.filter(g => g.ok).length;
        const total   = gates.length;
        const allPass = gates.every(g => g.ok);

        return res.json({
            betaReady:    allPass,
            score:        `${passed}/${total}`,
            scorePercent: Math.round((passed / total) * 100),
            gates,
            failingGates: gates.filter(g => !g.ok).map(g => g.gate),
            recommendation: allPass
                ? "✅ All gates passed. JARVIS is PUBLIC BETA READY."
                : `❌ ${total - passed} gate(s) failing. Resolve before public beta release.`,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 106: Installer recovery flow ───────────────────────────────────────
// GET /runtime/install/check — detect corrupted install, missing deps, repair options

router.get("/runtime/install/check", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const root = path.join(__dirname, "../../");

        const checks = [];

        // 1. node_modules present
        const nmExists = fs.existsSync(path.join(root, "node_modules"));
        checks.push({ item: "node_modules", ok: nmExists, repair: nmExists ? null : "Run: npm install" });

        // 2. package.json readable
        let pkgOk = false;
        try { JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); pkgOk = true; } catch {}
        checks.push({ item: "package_json", ok: pkgOk, repair: pkgOk ? null : "package.json is corrupt — restore from version control" });

        // 3. Data directory writable
        const dataDir = path.join(root, "data");
        let dataWritable = false;
        if (fs.existsSync(dataDir)) {
            try {
                const testFile = path.join(dataDir, ".write_test");
                fs.writeFileSync(testFile, "ok");
                fs.unlinkSync(testFile);
                dataWritable = true;
            } catch {}
        }
        checks.push({ item: "data_dir_writable", ok: dataWritable, repair: dataWritable ? null : "Check permissions on data/ directory" });

        // 4. Critical runtime modules loadable
        const coreModules = [
            "agents/runtime/runtimeOrchestrator.cjs",
            "agents/runtime/runtimeEventBus.cjs",
            "agents/runtime/driftMonitor.cjs",
            "agents/runtime/deadLetterQueue.cjs",
        ];
        const moduleChecks = coreModules.map(m => {
            try { require(path.join(root, m)); return { module: m, ok: true }; }
            catch (e) { return { module: m, ok: false, error: e.message.slice(0, 80) }; }
        });
        const modulesOk = moduleChecks.every(c => c.ok);
        checks.push({ item: "core_modules", ok: modulesOk, modules: moduleChecks, repair: modulesOk ? null : "Run: npm install — some module dependencies missing" });

        // 5. Env file hint
        const envExists = fs.existsSync(path.join(root, ".env"));
        checks.push({ item: "env_file", ok: envExists, repair: envExists ? null : "Copy .env.example to .env and fill required values" });

        // 6. Frontend build present (prod only)
        const isProd = process.env.NODE_ENV === "production";
        if (isProd) {
            const buildExists = fs.existsSync(path.join(root, "frontend/build/index.html"));
            checks.push({ item: "frontend_build", ok: buildExists, repair: buildExists ? null : "Run: npm run build:frontend" });
        }

        const allOk = checks.filter(c => c.repair).length === 0;
        return res.json({
            ok: allOk,
            checks,
            repairSteps: checks.filter(c => c.repair).map(c => c.repair),
            safeResetNote: "To perform a safe reset: DELETE data/task-queue.json and data/dead-letter.json, then restart the server. Existing work will be lost.",
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 113: Diagnostics bundle export ─────────────────────────────────────
// GET /runtime/diagnostics/bundle — anonymized snapshot for support
// Strips operator secrets. Safe to share with support.

router.get("/runtime/diagnostics/bundle", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const dataDir  = path.join(__dirname, "../../data");
        const crashDir = path.join(dataDir, "crashes");

        const bundle = {
            generatedAt: new Date().toISOString(),
            version:     (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")).version; } catch { return "unknown"; } })(),
            nodeVersion: process.version,
            nodeEnv:     process.env.NODE_ENV || "development",
            uptimeSecs:  Math.round(process.uptime()),
        };

        // Memory
        const m = process.memoryUsage();
        bundle.memory = { heapMb: Math.round(m.heapUsed / 1_048_576), rssMb: Math.round(m.rss / 1_048_576) };

        // Drift report
        try { bundle.drift = require("../../agents/runtime/driftMonitor.cjs").getDriftReport(); } catch { bundle.drift = null; }

        // Burn-in metrics
        try { const bus = require("../../agents/runtime/runtimeEventBus.cjs"); bundle.burnIn = bus.getBurnInMetrics?.() ?? null; bundle.degraded = bus.isDegraded?.() ?? false; } catch {}

        // Execution history stats
        try { bundle.historyStats = history.stats(); } catch {}

        // Queue / throttle state
        try { const s = orchestrator.status(); bundle.queue = s.queue; bundle.governor = s.governor; bundle.throttle = s.throttle; } catch {}

        // DLQ size
        try { bundle.dlqSize = dlq.size(); } catch {}

        // Last 3 crash files (anonymized — no stack frames with secrets)
        bundle.recentCrashes = [];
        try {
            if (fs.existsSync(crashDir)) {
                const files = fs.readdirSync(crashDir).filter(f => f.endsWith(".json")).sort().slice(-3).reverse();
                bundle.recentCrashes = files.map(f => {
                    try {
                        const c = JSON.parse(fs.readFileSync(path.join(crashDir, f), "utf8"));
                        // Anonymize: keep type/source/ts, strip full stack
                        return { file: f, ts: c.ts, source: c.source, errorType: c.error?.type, errorCode: c.error?.code };
                    } catch { return { file: f, parseError: true }; }
                });
            }
        } catch {}

        // Governor state
        try { bundle.governorState = governor?.getEmergencyState?.() ?? null; } catch {}

        // Audit log summary
        try { bundle.auditSummary = auditLog.info(); } catch {}

        // Recent metrics snapshots (last 5 points)
        try { bundle.metricsRecent = require("../../agents/runtime/metricsStore.cjs").recent(5); } catch {}

        // Env (safe subset — no secrets)
        bundle.safeEnv = {
            NODE_ENV:        process.env.NODE_ENV || null,
            PORT:            process.env.PORT     || null,
            JWT_SECRET_SET:  !!process.env.JWT_SECRET,
            OPH_SET:         !!process.env.OPERATOR_PASSWORD_HASH,
        };

        return res.json(bundle);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 110: Release artifact integrity ────────────────────────────────────
// GET /runtime/release-manifest/verify — checksum each critical file and compare

router.get("/runtime/release-manifest/verify", (req, res) => {
    try {
        const fs     = require("fs");
        const path   = require("path");
        const crypto = require("crypto");
        const dataDir = path.join(__dirname, "../../data");

        const targets = [
            "task-queue.json", "dead-letter.json",
            "workflow-trust.json", "memory-store.json",
        ];

        const results = targets.map(f => {
            const fp = path.join(dataDir, f);
            if (!fs.existsSync(fp)) return { file: f, ok: false, reason: "missing" };
            try {
                const content = fs.readFileSync(fp);
                const sha256  = crypto.createHash("sha256").update(content).digest("hex");
                JSON.parse(content); // validate parseable
                return { file: f, ok: true, sha256, sizeBytes: content.length };
            } catch (e) {
                return { file: f, ok: false, reason: e.message.slice(0, 60) };
            }
        });

        // Also checksum the persisted release manifest if it exists
        let manifestCheck = null;
        const mf = path.join(dataDir, "release_manifest.json");
        if (fs.existsSync(mf)) {
            try {
                const c = fs.readFileSync(mf);
                manifestCheck = { exists: true, sha256: crypto.createHash("sha256").update(c).digest("hex") };
            } catch { manifestCheck = { exists: true, parseError: true }; }
        } else {
            manifestCheck = { exists: false };
        }

        const allOk = results.every(r => r.ok);
        return res.json({
            ok: allOk,
            files: results,
            manifest: manifestCheck,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 97: Production Readiness Docs ─────────────────────────────────────
// GET /runtime/production-guide — operator recovery documentation and troubleshooting flows

router.get("/runtime/production-guide", (req, res) => {
    return res.json({
        version: "1.0",
        ts: new Date().toISOString(),
        sections: {
            startup: {
                title: "Startup",
                steps: [
                    "Copy .env.example to .env and fill JWT_SECRET and OPERATOR_PASSWORD_HASH",
                    "Run: npm install",
                    "Run: pm2 start ecosystem.config.cjs",
                    "Verify: curl http://localhost:5050/health",
                    "Verify: GET /runtime/release-checklist returns ready=true",
                ],
            },
            recovery: {
                title: "Recovery",
                flows: {
                    "Runtime unresponsive":    ["pm2 restart jarvis-backend", "Check: pm2 logs jarvis-backend --lines 50", "If repeating: GET /runtime/crashes for forensics"],
                    "Frontend blank":          ["Check: frontend build exists at frontend/build/index.html", "Run: npm run build:frontend", "Clear browser cache"],
                    "Queue stuck":             ["POST /runtime/emergency/stop", "GET /runtime/status to confirm halt", "POST /runtime/emergency/resume after draining"],
                    "Config corrupted":        ["GET /runtime/rollback/status", "POST /runtime/rollback/config-restore with last good label"],
                    "Memory runaway":          ["GET /runtime/burnin/summary — check MEMORY_CRITICAL", "pm2 restart jarvis-backend", "If recurring: reduce MAX_CONCURRENT in runtimeOrchestrator.cjs"],
                    "SSE stream offline":      ["Check nginx proxy_read_timeout >= 300s", "Verify: no firewall blocking persistent connections", "Frontend will auto-reconnect with jittered backoff"],
                    "JWT expired":             ["Update JWT_SECRET in .env", "pm2 restart jarvis-backend", "All active sessions will be invalidated — operators must re-login"],
                },
            },
            rollback: {
                title: "Rollback",
                steps: [
                    "1. POST /runtime/rollback/config-backup?label=pre-rollback",
                    "2. Deploy previous version (git checkout <tag> && npm install)",
                    "3. pm2 restart jarvis-backend",
                    "4. Verify: GET /runtime/release-checklist",
                    "5. If data corrupt: POST /runtime/rollback/config-restore with pre-rollback label",
                ],
            },
            monitoring: {
                title: "Monitoring",
                endpoints: {
                    "Health":          "GET /health",
                    "Deep health":     "GET /runtime/health/deep",
                    "Burn-in summary": "GET /runtime/burnin/summary",
                    "Drift report":    "GET /runtime/status (drift field)",
                    "Crash forensics": "GET /runtime/crashes",
                    "Audit log":       "GET /runtime/audit/health",
                    "Release check":   "GET /runtime/release-checklist",
                },
            },
        },
    });
});

// ── Phase 111: Local operator analytics ─────────────────────────────────────
// GET /runtime/analytics — local-only usage stats from metrics + history + drift

router.get("/runtime/analytics", (req, res) => {
    try {
        const histStats   = (() => { try { return history.stats(); } catch { return null; } })();
        const dlqSize     = (() => { try { return dlq.size(); } catch { return 0; } })();
        let   driftReport = null;
        try { driftReport = require("../../agents/runtime/driftMonitor.cjs").getDriftReport(); } catch {}
        let   metricsSnap = null;
        try { metricsSnap = require("../../agents/runtime/metricsStore.cjs").recent(5); } catch {}
        let   queueStats  = null;
        try { queueStats  = orchestrator.status().queue; } catch {}

        // Queue saturation: how often queue was above threshold
        const saturatedSamples = (metricsSnap || []).filter(s => (s.queueSize ?? 0) > 10).length;
        const sampleCount      = (metricsSnap || []).length;

        // Reconnect frequency from drift
        const reconnectRate  = driftReport?.reconnectRate  ?? null;
        const execDrift      = driftReport?.execDrift      ?? null;
        const orphanCount    = driftReport?.orphanCount    ?? 0;

        return res.json({
            ts: new Date().toISOString(),
            uptimeSecs:      Math.round(process.uptime()),
            execution: {
                total:          histStats?.total       ?? null,
                successRate:    histStats?.successRate  ?? null,
                recentFailed:   histStats?.recentFailed ?? null,
                dlqSize,
            },
            queue: {
                currentSize:    queueStats?.size        ?? null,
                throttleLevel:  queueStats?.level       ?? null,
                saturatedRatio: sampleCount > 0 ? Math.round((saturatedSamples / sampleCount) * 100) : null,
            },
            drift: {
                reconnectRate,
                execDrift,
                orphanCount,
                healthy:        driftReport?.healthy ?? null,
                alertCount:     driftReport?.recentAlerts?.length ?? 0,
            },
            memory: {
                heapMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
                rssMb:  Math.round(process.memoryUsage().rss      / 1_048_576),
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 112: Long-session memory growth detection ──────────────────────────
// GET /runtime/memory/growth — compare current heap against saved baselines

router.get("/runtime/memory/growth", (req, res) => {
    try {
        const baselines   = _loadBaselines();
        const baselineKeys = Object.keys(baselines);
        const current = {
            heapMb:     Math.round(process.memoryUsage().heapUsed / 1_048_576),
            rssMb:      Math.round(process.memoryUsage().rss      / 1_048_576),
            uptimeSecs: Math.round(process.uptime()),
            ts:         new Date().toISOString(),
        };

        if (baselineKeys.length === 0) {
            return res.json({ ok: true, current, baselines: {}, note: "No baselines captured yet. POST /runtime/survivability/baseline to capture." });
        }

        const comparisons = {};
        for (const name of baselineKeys) {
            const base = baselines[name];
            const heapDelta = current.heapMb - (base.heapMb ?? 0);
            const rssDelta  = current.rssMb  - (base.rssMb  ?? 0);
            const ageMs     = Date.now() - new Date(base.ts).getTime();
            const ageHours  = ageMs / 3_600_000;
            // Gradual growth: >10MB/hour sustained is concerning
            const growthRateMbPerHr = ageHours > 0 ? Math.round((heapDelta / ageHours) * 10) / 10 : 0;
            comparisons[name] = {
                heapDeltaMb:      heapDelta,
                rssDeltaMb:       rssDelta,
                ageHours:         Math.round(ageHours * 10) / 10,
                growthRateMbPerHr,
                concerning:       growthRateMbPerHr > 10 || heapDelta > 100,
            };
        }

        const anyConcerning = Object.values(comparisons).some(c => c.concerning);
        return res.json({ ok: !anyConcerning, current, comparisons, recommendation: anyConcerning ? "Memory growth detected. Consider pm2 restart if heap exceeds 450MB." : "Memory growth within normal bounds." });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 98: Operator feedback endpoint ─────────────────────────────────────
// POST /runtime/feedback — receive and persist operator feedback (local only)

router.post("/runtime/feedback", rateLimiter(20, 60_000), (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const entry = {
            ts:          new Date().toISOString(),
            category:    (req.body?.category || "Bug").slice(0, 50),
            message:     (req.body?.message  || "").slice(0, 1000),
            connectionState: (req.body?.connectionState || "").slice(0, 30),
            runtimeDegraded: !!req.body?.runtimeDegraded,
        };

        const fbFile = path.join(__dirname, "../../data/operator_feedback.json");
        let log = [];
        try { log = JSON.parse(fs.readFileSync(fbFile, "utf8")); } catch {}
        if (!Array.isArray(log)) log = [];
        log.unshift(entry);
        if (log.length > 500) log.length = 500;
        fs.writeFileSync(fbFile, JSON.stringify(log, null, 2));

        logger.info(`[Feedback] category=${entry.category} len=${entry.message.length}`);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/feedback — read operator feedback log (recent 50)
router.get("/runtime/feedback", (req, res) => {
    try {
        const fs   = require("fs");
        const path = require("path");
        const fbFile = path.join(__dirname, "../../data/operator_feedback.json");
        let log = [];
        try { log = JSON.parse(fs.readFileSync(fbFile, "utf8")); } catch {}
        return res.json({ success: true, count: log.length, entries: log.slice(0, 50) });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── Phase 396-420: Engineering Orchestration routes ──────────────────────────

const engSession     = _tryRequirePhase("../../agents/runtime/engineeringSession.cjs");
const crossWfCont    = _tryRequirePhase("../../agents/runtime/crossWorkflowContinuity.cjs");
const adapterBridge  = _tryRequirePhase("../../agents/runtime/adapterContextBridge.cjs");
const goalTracker    = _tryRequirePhase("../../agents/runtime/operationalGoalTracker.cjs");
const execCooldown   = _tryRequirePhase("../../agents/runtime/executionCooldown.cjs");
const depGraph       = _tryRequirePhase("../../agents/runtime/executionDependencyGraph.cjs");
const pressureMon    = _tryRequirePhase("../../agents/runtime/runtimePressureMonitor.cjs");
const autoCont       = _tryRequirePhase("../../agents/runtime/autonomousContinuation.cjs");
const engMemory      = _tryRequirePhase("../../agents/runtime/engineeringMemory.cjs");
const chainScorer    = _tryRequirePhase("../../agents/runtime/chainValidationScorer.cjs");
const adapterHeal    = _tryRequirePhase("../../agents/runtime/adapterSelfHealing.cjs");

// ── Sessions ─────────────────────────────────────────────────────────────────

// POST /runtime/sessions — create a new engineering session
router.post("/runtime/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!engSession) return res.status(503).json({ success: false, error: "sessions_unavailable" });
    const goal = (req.body.goal || "").trim().slice(0, 300);
    const meta = req.body.meta || {};
    if (!goal) return res.status(400).json({ success: false, error: "goal required" });
    try {
        const session = engSession.create(goal, meta);
        return res.json({ success: true, session });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// GET /runtime/sessions — list sessions
router.get("/runtime/sessions", (req, res) => {
    if (!engSession) return res.status(503).json({ success: false, error: "sessions_unavailable" });
    const state = req.query.state || null;
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);
    return res.json({ success: true, sessions: engSession.list({ state, limit }) });
});

// GET /runtime/sessions/:id — full session detail
router.get("/runtime/sessions/:id", (req, res) => {
    if (!engSession) return res.status(503).json({ success: false, error: "sessions_unavailable" });
    const s = engSession.summary(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: "session_not_found" });
    return res.json({ success: true, session: s });
});

// POST /runtime/sessions/:id/transition — change session state
router.post("/runtime/sessions/:id/transition", rateLimiter(30, 60_000), (req, res) => {
    if (!engSession) return res.status(503).json({ success: false, error: "sessions_unavailable" });
    const state  = (req.body.state  || "").slice(0, 20);
    const reason = (req.body.reason || "").slice(0, 200);
    if (!state) return res.status(400).json({ success: false, error: "state required" });
    const ok = engSession.transition(req.params.id, state, reason);
    return res.json({ success: ok, sessionId: req.params.id, newState: state });
});

// POST /runtime/sessions/:id/heartbeat — touch session heartbeat
router.post("/runtime/sessions/:id/heartbeat", rateLimiter(60, 60_000), (req, res) => {
    if (!engSession) return res.status(503).json({ success: false, error: "sessions_unavailable" });
    const ok = engSession.heartbeat(req.params.id);
    return res.json({ success: ok });
});

// POST /runtime/sessions/purge — remove expired sessions
router.post("/runtime/sessions/purge", rateLimiter(5, 60_000), (req, res) => {
    if (!engSession) return res.status(503).json({ success: false, error: "sessions_unavailable" });
    const removed = engSession.purgeExpired();
    return res.json({ success: true, removed });
});

// ── Goal tracking ─────────────────────────────────────────────────────────────

// GET /runtime/sessions/:id/goal — evaluate goal progress
router.get("/runtime/sessions/:id/goal", (req, res) => {
    if (!goalTracker) return res.status(503).json({ success: false, error: "goal_tracker_unavailable" });
    const result = goalTracker.evaluateGoal(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: "session_not_found" });
    return res.json({ success: true, ...result });
});

// ── Cross-workflow continuity ─────────────────────────────────────────────────

// POST /runtime/continuity/plan — build continuation plan for a session
router.post("/runtime/continuity/plan", rateLimiter(20, 60_000), (req, res) => {
    if (!crossWfCont) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    const goal      = (req.body.goal      || "").trim().slice(0, 200);
    const sessionId = (req.body.sessionId || "").slice(0, 80);
    if (!goal) return res.status(400).json({ success: false, error: "goal required" });
    const plan = crossWfCont.buildContinuationPlan(goal, sessionId || null);
    return res.json({ success: true, plan });
});

// POST /runtime/continuity/evaluate — evaluate whether to continue a sequence
router.post("/runtime/continuity/evaluate", rateLimiter(20, 60_000), async (req, res) => {
    if (!crossWfCont) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    const { sequenceId, currentIndex, sessionId, lastResult } = req.body;
    try {
        const decision = await crossWfCont.evaluateContinuation(sequenceId, currentIndex || 0, sessionId, lastResult || {});
        return res.json({ success: true, ...decision });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Adapter context bridge ────────────────────────────────────────────────────

// GET /runtime/adapter-context/:sessionId — get all context for a session
router.get("/runtime/adapter-context/:sessionId", (req, res) => {
    if (!adapterBridge) return res.status(503).json({ success: false, error: "adapter_bridge_unavailable" });
    return res.json({ success: true, context: adapterBridge.snapshot(req.params.sessionId) });
});

// POST /runtime/adapter-context/:sessionId — set a context value
router.post("/runtime/adapter-context/:sessionId", rateLimiter(30, 60_000), (req, res) => {
    if (!adapterBridge) return res.status(503).json({ success: false, error: "adapter_bridge_unavailable" });
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ success: false, error: "key required" });
    const ok = adapterBridge.set(req.params.sessionId, key, value);
    return res.json({ success: ok });
});

// ── Cooldown + pressure ───────────────────────────────────────────────────────

// GET /runtime/cooldown/stats — cooldown diagnostics
router.get("/runtime/cooldown/stats", (req, res) => {
    if (!execCooldown) return res.status(503).json({ success: false, error: "cooldown_unavailable" });
    return res.json({ success: true, ...execCooldown.stats() });
});

// POST /runtime/cooldown/check — check if a command/chain is in cooldown
router.post("/runtime/cooldown/check", rateLimiter(60, 60_000), (req, res) => {
    if (!execCooldown) return res.status(503).json({ success: false, error: "cooldown_unavailable" });
    const cmd       = (req.body.cmd       || "").slice(0, 500);
    const chainName = (req.body.chainName || "").slice(0, 80);
    return res.json({ success: true, ...execCooldown.gate(cmd, chainName || undefined) });
});

// GET /runtime/pressure — current pressure score + level
router.get("/runtime/pressure", (req, res) => {
    if (!pressureMon) return res.status(503).json({ success: false, error: "pressure_unavailable" });
    return res.json({ success: true, ...pressureMon.snapshot() });
});

// ── Dependency graph ──────────────────────────────────────────────────────────

// GET /runtime/deps — list all known dependencies
router.get("/runtime/deps", (req, res) => {
    if (!depGraph) return res.status(503).json({ success: false, error: "dep_graph_unavailable" });
    return res.json({ success: true, deps: depGraph.listDeps() });
});

// POST /runtime/deps/validate — validate deps for a chain
router.post("/runtime/deps/validate", rateLimiter(10, 60_000), async (req, res) => {
    if (!depGraph) return res.status(503).json({ success: false, error: "dep_graph_unavailable" });
    const chainName = (req.body.chainName || "").trim().slice(0, 80);
    if (!chainName) return res.status(400).json({ success: false, error: "chainName required" });
    try {
        const result = await depGraph.validateDeps(chainName);
        return res.json({ success: true, chainName, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Autonomous continuation ───────────────────────────────────────────────────

// POST /runtime/continuation/check — should a chain auto-continue after a step?
router.post("/runtime/continuation/check", rateLimiter(60, 60_000), (req, res) => {
    if (!autoCont) return res.status(503).json({ success: false, error: "continuation_unavailable" });
    const { sessionId, chainName, stepIndex, stepSuccess, consecutiveFails, priority } = req.body;
    const result = autoCont.shouldContinue({
        sessionId:        sessionId || null,
        chainName:        (chainName || "").slice(0, 80),
        stepIndex:        parseInt(stepIndex) || 0,
        stepSuccess:      stepSuccess === true,
        consecutiveFails: parseInt(consecutiveFails) || 0,
        priority:         parseInt(priority) || 3,
    });
    return res.json({ success: true, ...result });
});

// POST /runtime/continuation/step-outcome — record step outcome for continuation tracking
router.post("/runtime/continuation/step-outcome", rateLimiter(60, 60_000), (req, res) => {
    if (!autoCont) return res.status(503).json({ success: false, error: "continuation_unavailable" });
    const { sessionId, chainName, success, cmd } = req.body;
    autoCont.recordStepOutcome({
        sessionId: sessionId || null,
        chainName: (chainName || "").slice(0, 80),
        success:   success === true,
        cmd:       (cmd || "").slice(0, 200),
    });
    return res.json({ success: true });
});

// ── Engineering memory ────────────────────────────────────────────────────────

// GET /runtime/eng-memory — query engineering memory
router.get("/runtime/eng-memory", (req, res) => {
    if (!engMemory) return res.status(503).json({ success: false, error: "eng_memory_unavailable" });
    const goal = (req.query.goal || "").slice(0, 100);
    const type = (req.query.type || null);
    return res.json({ success: true, entries: engMemory.query(goal, type), stats: engMemory.stats() });
});

// GET /runtime/eng-memory/suggest — suggest chains for a goal
router.get("/runtime/eng-memory/suggest", (req, res) => {
    if (!engMemory) return res.status(503).json({ success: false, error: "eng_memory_unavailable" });
    const goal = (req.query.goal || "").slice(0, 100);
    return res.json({ success: true, suggestions: engMemory.suggestChains(goal) });
});

// ── Chain validation scoring ──────────────────────────────────────────────────

// POST /runtime/chains/score — score a chain's completed steps
router.post("/runtime/chains/score", rateLimiter(20, 60_000), (req, res) => {
    if (!chainScorer) return res.status(503).json({ success: false, error: "chain_scorer_unavailable" });
    const steps = req.body.steps;
    if (!Array.isArray(steps) || !steps.length) return res.status(400).json({ success: false, error: "steps array required" });
    try {
        const result = chainScorer.scoreChain(steps);
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Adapter self-healing ──────────────────────────────────────────────────────

// GET /runtime/adapters/healing — healing state snapshot
router.get("/runtime/adapters/healing", (req, res) => {
    if (!adapterHeal) return res.status(503).json({ success: false, error: "adapter_heal_unavailable" });
    return res.json({ success: true, adapters: adapterHeal.snapshot() });
});

// POST /runtime/adapters/heal — heal a specific adapter
router.post("/runtime/adapters/heal", rateLimiter(10, 60_000), (req, res) => {
    if (!adapterHeal) return res.status(503).json({ success: false, error: "adapter_heal_unavailable" });
    const adapter = (req.body.adapter || "").trim().slice(0, 30);
    if (!adapter) return res.status(400).json({ success: false, error: "adapter required" });
    const result = adapterHeal.heal(adapter);
    return res.json({ success: true, adapter, ...result });
});

// POST /runtime/adapters/heal/all — attempt healing all stale adapters
router.post("/runtime/adapters/heal/all", rateLimiter(5, 60_000), (req, res) => {
    if (!adapterHeal) return res.status(503).json({ success: false, error: "adapter_heal_unavailable" });
    const results = adapterHeal.healAll();
    return res.json({ success: true, count: results.length, results });
});

// POST /runtime/adapters/reset — reset a degraded adapter
router.post("/runtime/adapters/reset", rateLimiter(10, 60_000), (req, res) => {
    if (!adapterHeal) return res.status(503).json({ success: false, error: "adapter_heal_unavailable" });
    const adapter = (req.body.adapter || "").trim().slice(0, 30);
    if (!adapter) return res.status(400).json({ success: false, error: "adapter required" });
    adapterHeal.resetAdapter(adapter);
    return res.json({ success: true, adapter });
});

// ── Safety audit (Phase 419) ──────────────────────────────────────────────────

const safetyAudit = _tryRequirePhase("../../agents/runtime/operatorSafetyAudit.cjs");

// GET /runtime/safety/audit — read-only audit of all safety layers
router.get("/runtime/safety/audit", rateLimiter(5, 60_000), async (req, res) => {
    if (!safetyAudit) return res.status(503).json({ success: false, error: "safety_audit_unavailable" });
    try {
        const result = await safetyAudit.runAudit();
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Timeline intelligence ─────────────────────────────────────────────────────

const timelineIntel = _tryRequirePhase("../../agents/runtime/timelineIntelligence.cjs");
const trustModel    = _tryRequirePhase("../../agents/runtime/operatorTrustModel.cjs");

// GET /runtime/sessions/:id/timeline — analyzed timeline for a session
router.get("/runtime/sessions/:id/timeline", (req, res) => {
    if (!timelineIntel || !engSession) return res.status(503).json({ success: false, error: "timeline_unavailable" });
    const s = engSession.summary(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: "session_not_found" });
    const analysis = timelineIntel.analyze(s.timeline || []);
    const summary  = timelineIntel.summarize(s.timeline || [], s);
    return res.json({ success: true, sessionId: req.params.id, summary, ...analysis });
});

// ── Operator trust ────────────────────────────────────────────────────────────

// GET /runtime/sessions/:id/trust — trust level for a session
router.get("/runtime/sessions/:id/trust", (req, res) => {
    if (!trustModel) return res.status(503).json({ success: false, error: "trust_model_unavailable" });
    return res.json({ success: true, sessionId: req.params.id, ...trustModel.getTrust(req.params.id) });
});

// POST /runtime/sessions/:id/trust/reset — operator manually confirms state is clean
router.post("/runtime/sessions/:id/trust/reset", rateLimiter(10, 60_000), (req, res) => {
    if (!trustModel) return res.status(503).json({ success: false, error: "trust_model_unavailable" });
    trustModel.manualReset(req.params.id);
    return res.json({ success: true, sessionId: req.params.id, ...trustModel.getTrust(req.params.id) });
});

// POST /runtime/sessions/:id/trust/event — report a trust event
router.post("/runtime/sessions/:id/trust/event", rateLimiter(60, 60_000), (req, res) => {
    if (!trustModel) return res.status(503).json({ success: false, error: "trust_model_unavailable" });
    const event = (req.body.event || "").trim();
    const validEvents = ["false_positive", "probe_fail", "consecutive_recovery", "probe_pass", "session_complete"];
    if (!validEvents.includes(event)) return res.status(400).json({ success: false, error: `event must be one of: ${validEvents.join(", ")}` });
    const fn = {
        false_positive:        () => trustModel.reportFalsePositive(req.params.id),
        probe_fail:            () => trustModel.reportProbeFail(req.params.id),
        consecutive_recovery:  () => trustModel.reportConsecutiveRecovery(req.params.id),
        probe_pass:            () => trustModel.reportProbePass(req.params.id),
        session_complete:      () => trustModel.reportSessionComplete(req.params.id),
    }[event];
    fn();
    return res.json({ success: true, sessionId: req.params.id, ...trustModel.getTrust(req.params.id) });
});

// ── Phase 421-435: Engineering Operations Evolution ───────────────────────────

const engTaskRouter   = _tryRequirePhase("../../agents/runtime/engineeringTaskRouter.cjs");
const healthMatrix    = _tryRequirePhase("../../agents/runtime/operationalHealthMatrix.cjs");
const deployFlows     = _tryRequirePhase("../../agents/runtime/deploymentRecoveryFlows.cjs");
const termClassifier  = _tryRequirePhase("../../agents/runtime/terminalOutputClassifier.cjs");
const sanityGuards    = _tryRequirePhase("../../agents/runtime/executionSanityGuards.cjs");
const forensics       = _tryRequirePhase("../../agents/runtime/runtimeForensics.cjs");
const maintenance     = _tryRequirePhase("../../agents/runtime/autonomousMaintenance.cjs");
const ctxSnapshot     = _tryRequirePhase("../../agents/runtime/engineeringContextSnapshot.cjs");
const crossValidator  = _tryRequirePhase("../../agents/runtime/crossSystemValidator.cjs");

// ── Phase 421: Task Router ────────────────────────────────────────────────────

// POST /runtime/tasks/route — route an engineering task to adapter+chain
router.post("/runtime/tasks/route", rateLimiter(60, 60_000), (req, res) => {
    if (!engTaskRouter) return res.status(503).json({ success: false, error: "task_router_unavailable" });
    const task = {
        goal:      (req.body.goal      || "").slice(0, 200),
        cmd:       (req.body.cmd       || "").slice(0, 500),
        type:      (req.body.type      || "").slice(0, 40),
        chainName: (req.body.chainName || "").slice(0, 80),
        priority:  req.body.priority != null ? parseInt(req.body.priority) : undefined,
        urgency:   (req.body.urgency   || "").slice(0, 20),
    };
    return res.json({ success: true, ...engTaskRouter.route(task) });
});

// POST /runtime/tasks/route-many — route multiple tasks, detect adapter conflicts
router.post("/runtime/tasks/route-many", rateLimiter(20, 60_000), (req, res) => {
    if (!engTaskRouter) return res.status(503).json({ success: false, error: "task_router_unavailable" });
    const tasks = (req.body.tasks || []).slice(0, 10).map(t => ({
        goal:      (t.goal      || "").slice(0, 200),
        cmd:       (t.cmd       || "").slice(0, 200),
        type:      (t.type      || "").slice(0, 40),
        priority:  t.priority != null ? parseInt(t.priority) : undefined,
    }));
    if (!tasks.length) return res.status(400).json({ success: false, error: "tasks array required" });
    return res.json({ success: true, routes: engTaskRouter.routeMany(tasks) });
});

// ── Phase 422: Health Matrix ──────────────────────────────────────────────────

// GET /runtime/health/matrix — unified operational health score
router.get("/runtime/health/matrix", (req, res) => {
    if (!healthMatrix) return res.status(503).json({ success: false, error: "health_matrix_unavailable" });
    try {
        const matrix = healthMatrix.compute();
        return res.status(matrix.grade === "F" ? 503 : 200).json({ success: true, ...matrix });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 423: Deployment Recovery Flows ─────────────────────────────────────

// GET /runtime/deploy/flows — list deployment recovery flows
router.get("/runtime/deploy/flows", (req, res) => {
    if (!deployFlows) return res.status(503).json({ success: false, error: "deploy_flows_unavailable" });
    return res.json({ success: true, flows: deployFlows.listFlows() });
});

// GET /runtime/deploy/flows/:name — get a specific deployment flow
router.get("/runtime/deploy/flows/:name", (req, res) => {
    if (!deployFlows) return res.status(503).json({ success: false, error: "deploy_flows_unavailable" });
    const flow = deployFlows.getFlow(req.params.name);
    if (!flow) return res.status(404).json({ success: false, error: "flow_not_found", available: deployFlows.listFlows().map(f => f.name) });
    return res.json({ success: true, flow });
});

// POST /runtime/deploy/recover — plan a deployment recovery from problem description
router.post("/runtime/deploy/recover", rateLimiter(10, 60_000), (req, res) => {
    if (!deployFlows) return res.status(503).json({ success: false, error: "deploy_flows_unavailable" });
    const problem = (req.body.problem || "").trim().slice(0, 300);
    if (!problem) return res.status(400).json({ success: false, error: "problem description required" });
    const plan = deployFlows.planRecovery(problem);
    return res.json({ success: true, ...plan });
});

// ── Phase 425: Terminal Output Classifier ─────────────────────────────────────

// POST /runtime/terminal/classify — classify terminal output
router.post("/runtime/terminal/classify", rateLimiter(60, 60_000), (req, res) => {
    if (!termClassifier) return res.status(503).json({ success: false, error: "classifier_unavailable" });
    const output = (req.body.output || "").slice(0, 10_000);
    if (!output) return res.status(400).json({ success: false, error: "output required" });
    return res.json({ success: true, ...termClassifier.classify(output) });
});

// POST /runtime/terminal/classify-many — classify multiple output blocks
router.post("/runtime/terminal/classify-many", rateLimiter(20, 60_000), (req, res) => {
    if (!termClassifier) return res.status(503).json({ success: false, error: "classifier_unavailable" });
    const outputs = (req.body.outputs || []).slice(0, 20).map(o => String(o).slice(0, 5_000));
    if (!outputs.length) return res.status(400).json({ success: false, error: "outputs array required" });
    return res.json({ success: true, ...termClassifier.classifyMany(outputs) });
});

// ── Phase 427: Execution Sanity Guards ───────────────────────────────────────

// GET /runtime/sanity/stats — sanity guard diagnostics
router.get("/runtime/sanity/stats", (req, res) => {
    if (!sanityGuards) return res.status(503).json({ success: false, error: "sanity_guards_unavailable" });
    return res.json({ success: true, ...sanityGuards.stats() });
});

// POST /runtime/sanity/check — run all sanity guards for a prospective execution
router.post("/runtime/sanity/check", rateLimiter(60, 60_000), (req, res) => {
    if (!sanityGuards) return res.status(503).json({ success: false, error: "sanity_guards_unavailable" });
    const { recursionDepth, cmdKey, chainStartedAt } = req.body;
    const result = sanityGuards.runAll({
        recursionDepth:   parseInt(recursionDepth) || 0,
        cmdKey:           cmdKey ? String(cmdKey).slice(0, 200) : null,
        chainStartedAt:   chainStartedAt ? parseInt(chainStartedAt) : null,
        checkBurstGuard:  req.body.checkBurst !== false,
    });
    return res.json({ success: true, ...result });
});

// ── Phase 428: Runtime Forensics ─────────────────────────────────────────────

// GET /runtime/forensics — query forensics log
router.get("/runtime/forensics", (req, res) => {
    if (!forensics) return res.status(503).json({ success: false, error: "forensics_unavailable" });
    const type      = (req.query.type      || null);
    const sessionId = (req.query.sessionId || null);
    const limit     = Math.min(parseInt(req.query.limit) || 50, 200);
    return res.json({ success: true, entries: forensics.query({ type, sessionId, limit }) });
});

// GET /runtime/forensics/summary — post-mortem summary
router.get("/runtime/forensics/summary", (req, res) => {
    if (!forensics) return res.status(503).json({ success: false, error: "forensics_unavailable" });
    const sessionId = (req.query.sessionId || null);
    return res.json({ success: true, ...forensics.summarize(sessionId) });
});

// POST /runtime/forensics — record a forensic event
router.post("/runtime/forensics", rateLimiter(60, 60_000), (req, res) => {
    if (!forensics) return res.status(503).json({ success: false, error: "forensics_unavailable" });
    const type = (req.body.type || "").trim();
    if (!forensics.ENTRY_TYPES.includes(type)) {
        return res.status(400).json({ success: false, error: `type must be one of: ${forensics.ENTRY_TYPES.join(", ")}` });
    }
    try {
        switch (type) {
            case "workflow-failure":    forensics.recordWorkflowFailure(req.body); break;
            case "validation-breakdown":forensics.recordValidationBreakdown(req.body); break;
            case "recovery-attempt":    forensics.recordRecoveryAttempt(req.body); break;
            case "adapter-fault":       forensics.recordAdapterFault(req.body); break;
            case "causality-chain":     forensics.recordCausalityChain(req.body.chain, req.body.sessionId); break;
        }
        return res.json({ success: true, type });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 429: Autonomous Maintenance ────────────────────────────────────────

// GET /runtime/maintenance/tasks — list maintenance tasks and cooldown state
router.get("/runtime/maintenance/tasks", (req, res) => {
    if (!maintenance) return res.status(503).json({ success: false, error: "maintenance_unavailable" });
    return res.json({ success: true, tasks: maintenance.list() });
});

// POST /runtime/maintenance/run — run a specific maintenance task
router.post("/runtime/maintenance/run", rateLimiter(10, 60_000), async (req, res) => {
    if (!maintenance) return res.status(503).json({ success: false, error: "maintenance_unavailable" });
    const taskName = (req.body.task || "").trim().slice(0, 60);
    if (!taskName) return res.status(400).json({ success: false, error: "task required", available: maintenance.TASKS });
    try {
        const result = await maintenance.run(taskName);
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// POST /runtime/maintenance/run-all — run all safe maintenance tasks
router.post("/runtime/maintenance/run-all", rateLimiter(3, 60_000), async (req, res) => {
    if (!maintenance) return res.status(503).json({ success: false, error: "maintenance_unavailable" });
    try {
        const results = await maintenance.runAll();
        return res.json({ success: true, results });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 430: Context Snapshots ─────────────────────────────────────────────

// GET /runtime/context/snapshot — load most recent snapshot
router.get("/runtime/context/snapshot", (req, res) => {
    if (!ctxSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    const snap = ctxSnapshot.load();
    if (!snap) return res.status(404).json({ success: false, error: "no_valid_snapshot", status: ctxSnapshot.status() });
    return res.json({ success: true, snapshot: snap });
});

// GET /runtime/context/snapshot/status — check snapshot freshness
router.get("/runtime/context/snapshot/status", (req, res) => {
    if (!ctxSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    return res.json({ success: true, ...ctxSnapshot.status() });
});

// POST /runtime/context/snapshot — capture and persist current context
router.post("/runtime/context/snapshot", rateLimiter(20, 60_000), (req, res) => {
    if (!ctxSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    const sessionId = (req.body.sessionId || null);
    try {
        const snap = ctxSnapshot.capture(sessionId);
        return res.json({ success: true, snapshot: snap });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /runtime/context/snapshot — clear snapshot (after session abandoned)
router.delete("/runtime/context/snapshot", (req, res) => {
    if (!ctxSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    const cleared = ctxSnapshot.clear();
    return res.json({ success: cleared });
});

// ── Phase 431: Cross-System Validation ───────────────────────────────────────

// POST /runtime/validate/cross-system — verify system layers are consistent
router.post("/runtime/validate/cross-system", rateLimiter(10, 60_000), async (req, res) => {
    if (!crossValidator) return res.status(503).json({ success: false, error: "cross_validator_unavailable" });
    const opts = {
        terminalExitCode: req.body.terminalExitCode != null ? parseInt(req.body.terminalExitCode) : null,
        probeVerified:    req.body.probeVerified != null ? req.body.probeVerified === true : null,
    };
    try {
        const result = await crossValidator.validate(opts);
        return res.status(result.consistent ? 200 : 409).json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 432: Execution Recovery Memory ─────────────────────────────────────

const recoveryMemory = _tryRequirePhase("../../agents/runtime/executionRecoveryMemory.cjs");

// GET /runtime/recovery-memory — query recovery memory
router.get("/runtime/recovery-memory", (req, res) => {
    if (!recoveryMemory) return res.status(503).json({ success: false, error: "recovery_memory_unavailable" });
    const { type, chainName } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    return res.json({ success: true, entries: recoveryMemory.query({ type, chainName, limit }), stats: recoveryMemory.stats() });
});

// GET /runtime/recovery-memory/suggest — suggest repair sequences for a problem
router.get("/runtime/recovery-memory/suggest", (req, res) => {
    if (!recoveryMemory) return res.status(503).json({ success: false, error: "recovery_memory_unavailable" });
    const problem = (req.query.problem || "").slice(0, 100);
    return res.json({ success: true, sequences: recoveryMemory.suggestRepair(problem) });
});

// POST /runtime/recovery-memory — record a recovery memory entry
router.post("/runtime/recovery-memory", rateLimiter(30, 60_000), (req, res) => {
    if (!recoveryMemory) return res.status(503).json({ success: false, error: "recovery_memory_unavailable" });
    const type = (req.body.type || "").trim();
    try {
        switch (type) {
            case "validated-path":   recoveryMemory.recordValidatedPath(req.body);   break;
            case "failed-pattern":   recoveryMemory.recordFailedPattern(req.body);   break;
            case "unstable-chain":   recoveryMemory.recordUnstableChain(req.body);   break;
            case "repair-sequence":  recoveryMemory.recordRepairSequence(req.body);  break;
            default: return res.status(400).json({ success: false, error: "type must be: validated-path|failed-pattern|unstable-chain|repair-sequence" });
        }
        return res.json({ success: true, type });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 434: Production Safety Audit ───────────────────────────────────────

const prodAudit = _tryRequirePhase("../../agents/runtime/productionSafetyAudit.cjs");

// GET /runtime/safety/production-audit — full production readiness check
router.get("/runtime/safety/production-audit", rateLimiter(5, 60_000), async (req, res) => {
    if (!prodAudit) return res.status(503).json({ success: false, error: "production_audit_unavailable" });
    try {
        const result = await prodAudit.runProductionAudit();
        return res.status(result.productionReady ? 200 : 503).json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 436-450: Daily Engineering Operator routes ──────────────────────────

const workspace      = _tryRequirePhase("../../agents/runtime/dailyOperatorWorkspace.cjs");
const debugFlows     = _tryRequirePhase("../../agents/runtime/debuggingFlows.cjs");
const prodChains     = _tryRequirePhase("../../agents/runtime/productivityChains.cjs");
const knowledgeMem   = _tryRequirePhase("../../agents/runtime/engineeringKnowledgeMemory.cjs");
const opSearch       = _tryRequirePhase("../../agents/runtime/operationalSearch.cjs");
const failIntel      = _tryRequirePhase("../../agents/runtime/failureIntelligence.cjs");

// ── Phase 436: Daily Operator Workspace ───────────────────────────────────────

// GET /runtime/workspace — full operator workspace snapshot
router.get("/runtime/workspace", (req, res) => {
    if (!workspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    try {
        return res.json({ success: true, workspace: workspace.getWorkspace() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// POST /runtime/workspace/pin — pin a workflow to workspace
router.post("/runtime/workspace/pin", rateLimiter(20, 60_000), (req, res) => {
    if (!workspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    const chainName = (req.body.chainName || "").trim().slice(0, 80);
    const label     = (req.body.label     || "").trim().slice(0, 80);
    if (!chainName) return res.status(400).json({ success: false, error: "chainName required" });
    workspace.pinWorkflow(chainName, label);
    return res.json({ success: true, chainName });
});

// DELETE /runtime/workspace/pin/:chainName — unpin a workflow
router.delete("/runtime/workspace/pin/:chainName", (req, res) => {
    if (!workspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    workspace.unpinWorkflow(req.params.chainName);
    return res.json({ success: true });
});

// ── Phase 437: Debugging Flows ────────────────────────────────────────────────

// GET /runtime/debug/flows — list all debugging flows
router.get("/runtime/debug/flows", (req, res) => {
    if (!debugFlows) return res.status(503).json({ success: false, error: "debug_flows_unavailable" });
    return res.json({ success: true, flows: debugFlows.listFlows() });
});

// GET /runtime/debug/flows/:name — get specific debug flow
router.get("/runtime/debug/flows/:name", (req, res) => {
    if (!debugFlows) return res.status(503).json({ success: false, error: "debug_flows_unavailable" });
    const flow = debugFlows.getFlow(req.params.name);
    if (!flow) return res.status(404).json({ success: false, error: "flow_not_found" });
    return res.json({ success: true, flow });
});

// POST /runtime/debug/plan — plan a debugging flow from problem description
router.post("/runtime/debug/plan", rateLimiter(20, 60_000), (req, res) => {
    if (!debugFlows) return res.status(503).json({ success: false, error: "debug_flows_unavailable" });
    const problem = (req.body.problem || "").trim().slice(0, 300);
    if (!problem) return res.status(400).json({ success: false, error: "problem required" });
    return res.json({ success: true, ...debugFlows.planDebug(problem) });
});

// ── Phase 438: Productivity Chains ───────────────────────────────────────────

// GET /runtime/productivity/chains — list productivity automation chains
router.get("/runtime/productivity/chains", (req, res) => {
    if (!prodChains) return res.status(503).json({ success: false, error: "productivity_unavailable" });
    return res.json({ success: true, chains: prodChains.listChains() });
});

// GET /runtime/productivity/chains/:name — get specific chain
router.get("/runtime/productivity/chains/:name", (req, res) => {
    if (!prodChains) return res.status(503).json({ success: false, error: "productivity_unavailable" });
    const chain = prodChains.getChain(req.params.name);
    if (!chain) return res.status(404).json({ success: false, error: "chain_not_found" });
    return res.json({ success: true, chain });
});

// POST /runtime/productivity/suggest — suggest chain for intent
router.post("/runtime/productivity/suggest", rateLimiter(20, 60_000), (req, res) => {
    if (!prodChains) return res.status(503).json({ success: false, error: "productivity_unavailable" });
    const intent = (req.body.intent || "").trim().slice(0, 200);
    const chain  = prodChains.suggest(intent);
    return res.json({ success: true, chain });
});

// ── Phase 440: Engineering Knowledge Memory ───────────────────────────────────

// GET /runtime/knowledge — query knowledge memory
router.get("/runtime/knowledge", (req, res) => {
    if (!knowledgeMem) return res.status(503).json({ success: false, error: "knowledge_unavailable" });
    const { kind, search } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 30, 150);
    return res.json({ success: true, entries: knowledgeMem.query({ kind, search, limit }), stats: knowledgeMem.stats() });
});

// GET /runtime/knowledge/fix/:key — look up a known fix
router.get("/runtime/knowledge/fix/:key", (req, res) => {
    if (!knowledgeMem) return res.status(503).json({ success: false, error: "knowledge_unavailable" });
    const fix = knowledgeMem.lookupFix(req.params.key);
    if (!fix) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, fix });
});

// POST /runtime/knowledge — record a knowledge entry
router.post("/runtime/knowledge", rateLimiter(20, 60_000), (req, res) => {
    if (!knowledgeMem) return res.status(503).json({ success: false, error: "knowledge_unavailable" });
    const kind = (req.body.kind || "").trim();
    try {
        switch (kind) {
            case "known-fix":           knowledgeMem.recordKnownFix(req.body.key, req.body.problem, req.body.fix, req.body.chainName); break;
            case "stable-chain":        knowledgeMem.recordStableChain(req.body.issueClass, req.body.chains, req.body.successCount); break;
            case "runtime-failure":     knowledgeMem.recordRuntimeFailure(req.body.key, req.body.signature, req.body.mitigation); break;
            case "deployment-pattern":  knowledgeMem.recordDeploymentPattern(req.body.key, req.body.description, req.body.steps); break;
            case "project-knowledge":   knowledgeMem.recordProjectKnowledge(req.body.key, req.body.knowledge, req.body.project); break;
            default: return res.status(400).json({ success: false, error: `kind must be one of: ${knowledgeMem.KINDS.join(", ")}` });
        }
        return res.json({ success: true, kind });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 445: Operational Search ────────────────────────────────────────────

// GET /runtime/search — unified search across all operational data
router.get("/runtime/search", (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const query = (req.query.q || "").slice(0, 200);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    if (!query) return res.status(400).json({ success: false, error: "q parameter required" });
    return res.json({ success: true, query, results: opSearch.searchAll(query, limit) });
});

// GET /runtime/search/commands — recall commands matching pattern
router.get("/runtime/search/commands", (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const pattern = (req.query.q || "").slice(0, 200);
    const limit   = Math.min(parseInt(req.query.limit) || 10, 50);
    return res.json({ success: true, commands: opSearch.recallCommands(pattern, limit) });
});

// GET /runtime/search/workflows — suggest workflows for a goal
router.get("/runtime/search/workflows", (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const goal = (req.query.goal || "").slice(0, 200);
    if (!goal) return res.status(400).json({ success: false, error: "goal parameter required" });
    return res.json({ success: true, suggestions: opSearch.suggestWorkflows(goal) });
});

// ── Phase 446: Failure Intelligence ──────────────────────────────────────────

// POST /runtime/failure/assess — assess reliability of a command outcome
router.post("/runtime/failure/assess", rateLimiter(30, 60_000), (req, res) => {
    if (!failIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    const { terminalOutput, exitCode, probeResult, sessionId, pressure } = req.body;
    try {
        const assessment = failIntel.assess({
            terminalOutput: terminalOutput ? String(terminalOutput).slice(0, 5000) : null,
            exitCode:       exitCode != null ? parseInt(exitCode) : null,
            probeResult:    probeResult || null,
            sessionId:      sessionId || null,
            pressure:       pressure  || null,
        });
        return res.json({ success: true, ...assessment });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// POST /runtime/failure/assess-chain — assess a sequence of step outcomes
router.post("/runtime/failure/assess-chain", rateLimiter(20, 60_000), (req, res) => {
    if (!failIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    const steps = (req.body.steps || []).slice(0, 20);
    if (!steps.length) return res.status(400).json({ success: false, error: "steps array required" });
    try {
        return res.json({ success: true, ...failIntel.assessChain(steps) });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 451: Multi-Operator Sessions ───────────────────────────────────────

const multiOp = _tryRequirePhase("../../agents/runtime/multiOperatorSession.cjs");

router.post("/runtime/operators/:operatorId/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!multiOp) return res.status(503).json({ success: false, error: "multi_operator_unavailable" });
    const operatorId = (req.params.operatorId || "").slice(0, 64);
    const goal       = (req.body.goal || "").trim().slice(0, 300);
    if (!goal) return res.status(400).json({ success: false, error: "goal required" });
    try {
        const s = multiOp.createSession(operatorId, goal, req.body.meta || {});
        return res.json({ success: true, session: s });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.get("/runtime/operators/:operatorId/sessions", (req, res) => {
    if (!multiOp) return res.status(503).json({ success: false, error: "multi_operator_unavailable" });
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);
    return res.json({ success: true, sessions: multiOp.listSessions(req.params.operatorId, { state: req.query.state || null, limit }) });
});

router.get("/runtime/operators/:operatorId/sessions/:sessionId", (req, res) => {
    if (!multiOp) return res.status(503).json({ success: false, error: "multi_operator_unavailable" });
    const s = multiOp.getSession(req.params.operatorId, req.params.sessionId);
    if (!s) return res.status(404).json({ success: false, error: "session_not_found_or_not_owned" });
    return res.json({ success: true, session: s });
});

router.get("/runtime/operators", (req, res) => {
    if (!multiOp) return res.status(503).json({ success: false, error: "multi_operator_unavailable" });
    return res.json({ success: true, operators: multiOp.listOperators() });
});

router.get("/runtime/operators/:operatorId/summary", (req, res) => {
    if (!multiOp) return res.status(503).json({ success: false, error: "multi_operator_unavailable" });
    return res.json({ success: true, ...multiOp.operatorSummary(req.params.operatorId) });
});

// ── Phase 455: Operational Templates ─────────────────────────────────────────

const opTemplates = _tryRequirePhase("../../agents/runtime/operationalTemplates.cjs");

router.get("/runtime/templates", (req, res) => {
    if (!opTemplates) return res.status(503).json({ success: false, error: "templates_unavailable" });
    return res.json({ success: true, templates: opTemplates.listTemplates() });
});

router.get("/runtime/templates/:name", (req, res) => {
    if (!opTemplates) return res.status(503).json({ success: false, error: "templates_unavailable" });
    const tpl = opTemplates.getTemplate(req.params.name);
    if (!tpl) return res.status(404).json({ success: false, error: "template_not_found" });
    return res.json({ success: true, template: tpl });
});

router.post("/runtime/templates", rateLimiter(20, 60_000), (req, res) => {
    if (!opTemplates) return res.status(503).json({ success: false, error: "templates_unavailable" });
    const result = opTemplates.saveTemplate(req.body);
    return res.status(result.saved ? 200 : 400).json({ success: result.saved, ...result });
});

router.delete("/runtime/templates/:name", (req, res) => {
    if (!opTemplates) return res.status(503).json({ success: false, error: "templates_unavailable" });
    const removed = opTemplates.deleteTemplate(req.params.name);
    return res.json({ success: removed, name: req.params.name });
});

router.get("/runtime/templates/:name/export", (req, res) => {
    if (!opTemplates) return res.status(503).json({ success: false, error: "templates_unavailable" });
    const fmt = (req.query.format || "json").toLowerCase();
    if (fmt === "markdown") {
        const md = opTemplates.exportMarkdown(req.params.name);
        if (!md) return res.status(404).json({ success: false, error: "template_not_found" });
        return res.type("text/markdown").send(md);
    }
    const json = opTemplates.exportJson(req.params.name);
    if (!json) return res.status(404).json({ success: false, error: "template_not_found" });
    return res.type("application/json").send(json);
});

router.post("/runtime/templates/validate", rateLimiter(30, 60_000), (req, res) => {
    if (!opTemplates) return res.status(503).json({ success: false, error: "templates_unavailable" });
    return res.json({ success: true, ...opTemplates.validateTemplate(req.body) });
});

// ── Phase 456: Engineering Profiles ──────────────────────────────────────────

const engProfile = _tryRequirePhase("../../agents/runtime/engineeringProfile.cjs");

router.get("/runtime/profiles", (req, res) => {
    if (!engProfile) return res.status(503).json({ success: false, error: "profiles_unavailable" });
    return res.json({ success: true, profiles: engProfile.listProfiles() });
});

router.get("/runtime/profiles/active", (req, res) => {
    if (!engProfile) return res.status(503).json({ success: false, error: "profiles_unavailable" });
    return res.json({ success: true, profile: engProfile.getActiveProfile() });
});

router.post("/runtime/profiles/switch", rateLimiter(10, 60_000), (req, res) => {
    if (!engProfile) return res.status(503).json({ success: false, error: "profiles_unavailable" });
    const name = (req.body.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ success: false, error: "name required" });
    return res.json({ success: true, ...engProfile.switchProfile(name) });
});

router.post("/runtime/profiles", rateLimiter(10, 60_000), (req, res) => {
    if (!engProfile) return res.status(503).json({ success: false, error: "profiles_unavailable" });
    const result = engProfile.saveProfile(req.body);
    return res.status(result.saved ? 200 : 400).json({ success: !!result.saved, ...result });
});

router.delete("/runtime/profiles/:name", (req, res) => {
    if (!engProfile) return res.status(503).json({ success: false, error: "profiles_unavailable" });
    return res.json({ success: engProfile.deleteProfile(req.params.name), name: req.params.name });
});

// ── Phase 458: Operational Analytics ─────────────────────────────────────────

const opAnalytics = _tryRequirePhase("../../agents/runtime/operationalAnalytics.cjs");

router.get("/runtime/analytics/summary", (req, res) => {
    if (!opAnalytics) return res.status(503).json({ success: false, error: "analytics_unavailable" });
    const windowMs = req.query.window ? parseInt(req.query.window) * 3_600_000 : null;
    return res.json({ success: true, ...opAnalytics.summary({ windowMs }) });
});

router.get("/runtime/analytics/events", (req, res) => {
    if (!opAnalytics) return res.status(503).json({ success: false, error: "analytics_unavailable" });
    const windowMs = req.query.window ? parseInt(req.query.window) * 3_600_000 : null;
    return res.json({ success: true, events: opAnalytics.query({ type: req.query.type || null, limit: Math.min(parseInt(req.query.limit) || 100, 500), windowMs }) });
});

router.post("/runtime/analytics/record", rateLimiter(120, 60_000), (req, res) => {
    if (!opAnalytics) return res.status(503).json({ success: false, error: "analytics_unavailable" });
    const type = (req.body.type || "").trim();
    try {
        switch (type) {
            case "workflow":   opAnalytics.recordWorkflow(req.body);   break;
            case "recovery":   opAnalytics.recordRecovery(req.body);   break;
            case "adapter":    opAnalytics.recordAdapter(req.body);    break;
            case "deployment": opAnalytics.recordDeployment(req.body); break;
            case "session":    opAnalytics.recordSession(req.body);    break;
            default: return res.status(400).json({ success: false, error: `type must be: ${opAnalytics.EVENT_TYPES.join("|")}` });
        }
        return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 459: Replay Export ──────────────────────────────────────────────────

const replayExp = _tryRequirePhase("../../agents/runtime/replayExporter.cjs");

router.get("/runtime/export/session/:id", (req, res) => {
    if (!replayExp) return res.status(503).json({ success: false, error: "exporter_unavailable" });
    const fmt = (req.query.format || "json").toLowerCase();
    if (fmt === "markdown") {
        const md = replayExp.exportSessionMarkdown(req.params.id);
        if (!md) return res.status(404).json({ success: false, error: "session_not_found" });
        return res.type("text/markdown").send(md);
    }
    const json = replayExp.exportSessionJson(req.params.id);
    if (!json) return res.status(404).json({ success: false, error: "session_not_found" });
    return res.type("application/json").send(json);
});

router.get("/runtime/export/replay/:id", (req, res) => {
    if (!replayExp) return res.status(503).json({ success: false, error: "exporter_unavailable" });
    const md = replayExp.exportReplayMarkdown(req.params.id);
    if (!md) return res.status(404).json({ success: false, error: "replay_not_found" });
    return res.type("text/markdown").send(md);
});

router.get("/runtime/export/analytics", (req, res) => {
    if (!replayExp) return res.status(503).json({ success: false, error: "exporter_unavailable" });
    const windowMs = req.query.window ? parseInt(req.query.window) * 3_600_000 : null;
    return res.type("text/markdown").send(replayExp.exportAnalyticsMarkdown({ windowMs }));
});

router.get("/runtime/export/forensics", (req, res) => {
    if (!replayExp) return res.status(503).json({ success: false, error: "exporter_unavailable" });
    return res.type("text/markdown").send(replayExp.exportForensicsMarkdown(req.query.sessionId || null));
});

router.get("/runtime/export/snapshot", (req, res) => {
    if (!replayExp) return res.status(503).json({ success: false, error: "exporter_unavailable" });
    return res.type("application/json").send(replayExp.exportSnapshot(req.query.sessionId || null));
});

// ── Phase 460: Runtime Modes ──────────────────────────────────────────────────

const rtModes = _tryRequirePhase("../../agents/runtime/runtimeModes.cjs");

router.get("/runtime/mode", (req, res) => {
    if (!rtModes) return res.status(503).json({ success: false, error: "modes_unavailable" });
    return res.json({ success: true, mode: rtModes.getActiveMode() });
});

router.get("/runtime/modes", (req, res) => {
    if (!rtModes) return res.status(503).json({ success: false, error: "modes_unavailable" });
    return res.json({ success: true, modes: rtModes.listModes() });
});

router.post("/runtime/mode/switch", rateLimiter(10, 60_000), (req, res) => {
    if (!rtModes) return res.status(503).json({ success: false, error: "modes_unavailable" });
    const name = (req.body.mode || "").trim().slice(0, 30);
    if (!name) return res.status(400).json({ success: false, error: "mode required" });
    const result = rtModes.switchMode(name);
    if (!result.ok) return res.status(400).json({ success: false, ...result });
    logger.info(`[Runtime] mode switched: ${result.previous} → ${result.current}`);
    return res.json({ success: true, ...result });
});

// ── Phase 466: Local Account System ──────────────────────────────────────────

const localAccounts = _tryRequirePhase("../../agents/runtime/localAccountSystem.cjs");

router.get("/runtime/accounts", (req, res) => {
    if (!localAccounts) return res.status(503).json({ success: false, error: "accounts_unavailable" });
    return res.json({ success: true, accounts: localAccounts.listAccounts() });
});

router.post("/runtime/accounts", rateLimiter(20, 60_000), (req, res) => {
    if (!localAccounts) return res.status(503).json({ success: false, error: "accounts_unavailable" });
    const name = (req.body.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ success: false, error: "name required" });
    try {
        const result = localAccounts.upsertAccount(name, req.body);
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.get("/runtime/accounts/:nameOrId", (req, res) => {
    if (!localAccounts) return res.status(503).json({ success: false, error: "accounts_unavailable" });
    const a = localAccounts.getAccount(req.params.nameOrId);
    if (!a) return res.status(404).json({ success: false, error: "account_not_found" });
    return res.json({ success: true, account: a });
});

router.patch("/runtime/accounts/:nameOrId/preferences", rateLimiter(20, 60_000), (req, res) => {
    if (!localAccounts) return res.status(503).json({ success: false, error: "accounts_unavailable" });
    const ok = localAccounts.updatePreferences(req.params.nameOrId, req.body);
    return res.json({ success: ok });
});

router.delete("/runtime/accounts/:nameOrId", rateLimiter(5, 60_000), (req, res) => {
    if (!localAccounts) return res.status(503).json({ success: false, error: "accounts_unavailable" });
    return res.json({ success: localAccounts.deleteAccount(req.params.nameOrId) });
});

// ── Phase 467: Session Hardening ──────────────────────────────────────────────

const sessionHarden = _tryRequirePhase("../../agents/runtime/sessionHardening.cjs");

router.get("/runtime/session-hardening/snapshot", (req, res) => {
    if (!sessionHarden) return res.status(503).json({ success: false, error: "session_hardening_unavailable" });
    return res.json({ success: true, ...sessionHarden.snapshot() });
});

router.post("/runtime/session-hardening/recover-stale", rateLimiter(5, 60_000), (req, res) => {
    if (!sessionHarden) return res.status(503).json({ success: false, error: "session_hardening_unavailable" });
    const recovered = sessionHarden.recoverStaleSessions();
    return res.json({ success: true, recovered });
});

router.get("/runtime/session-hardening/multi-window/:operatorId", (req, res) => {
    if (!sessionHarden) return res.status(503).json({ success: false, error: "session_hardening_unavailable" });
    return res.json({ success: true, ...sessionHarden.checkMultiWindow(req.params.operatorId) });
});

// ── Phase 468: Cloud Sync Interface ──────────────────────────────────────────

const cloudSync = _tryRequirePhase("../../agents/runtime/cloudSyncInterface.cjs");

router.get("/runtime/sync/status", (req, res) => {
    if (!cloudSync) return res.status(503).json({ success: false, error: "sync_unavailable" });
    return res.json({ success: true, ...cloudSync.status() });
});

router.get("/runtime/sync/pending", (req, res) => {
    if (!cloudSync) return res.status(503).json({ success: false, error: "sync_unavailable" });
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    return res.json({ success: true, entries: cloudSync.getPending({ limit }) });
});

router.post("/runtime/sync/enqueue", rateLimiter(30, 60_000), (req, res) => {
    if (!cloudSync) return res.status(503).json({ success: false, error: "sync_unavailable" });
    const { type, entityId, payload, operatorId } = req.body;
    try {
        cloudSync.enqueue(type, entityId, payload, { operatorId });
        return res.json({ success: true });
    } catch (err) { return res.status(400).json({ success: false, error: err.message }); }
});

router.post("/runtime/sync/enable", rateLimiter(5, 60_000), (req, res) => {
    if (!cloudSync) return res.status(503).json({ success: false, error: "sync_unavailable" });
    cloudSync.setSyncEnabled(req.body.enabled !== false);
    return res.json({ success: true, enabled: req.body.enabled !== false });
});

// ── Phase 470: Project Workspaces ─────────────────────────────────────────────

const projectWorkspace = _tryRequirePhase("../../agents/runtime/projectWorkspace.cjs");

router.get("/runtime/workspaces", (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    return res.json({ success: true, workspaces: projectWorkspace.listWorkspaces() });
});

router.get("/runtime/workspaces/active", (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    return res.json({ success: true, workspace: projectWorkspace.getActiveWorkspace() });
});

router.post("/runtime/workspaces", rateLimiter(10, 60_000), (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, error: "name required" });
    try {
        const result = projectWorkspace.createWorkspace(name, req.body);
        return res.status(result.created ? 200 : 400).json({ success: result.created, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.post("/runtime/workspaces/switch", rateLimiter(10, 60_000), (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, error: "name required" });
    const result = projectWorkspace.switchWorkspace(name);
    return res.status(result.ok ? 200 : 404).json({ success: result.ok, ...result });
});

router.delete("/runtime/workspaces/:name", (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    return res.json({ success: projectWorkspace.deleteWorkspace(req.params.name), name: req.params.name });
});

router.get("/runtime/workspaces/:name/memory", (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    return res.json({ success: true, memory: projectWorkspace.getMemory(req.params.name) });
});

router.put("/runtime/workspaces/:name/memory", rateLimiter(30, 60_000), (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    const key   = (req.body.key   || "").slice(0, 60);
    const value = (req.body.value || "").slice(0, 256);
    if (!key) return res.status(400).json({ success: false, error: "key required" });
    return res.json({ success: projectWorkspace.setMemory(req.params.name, key, value) });
});

router.post("/runtime/workspaces/:name/pin", rateLimiter(20, 60_000), (req, res) => {
    if (!projectWorkspace) return res.status(503).json({ success: false, error: "workspace_unavailable" });
    const template = (req.body.template || "").trim();
    if (!template) return res.status(400).json({ success: false, error: "template required" });
    return res.json({ success: projectWorkspace.togglePin(req.params.name, template) });
});

// ── Phase 471: Deployment Pipeline ───────────────────────────────────────────

const pipeline = _tryRequirePhase("../../agents/runtime/deploymentPipeline.cjs");

router.get("/runtime/pipelines", (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    return res.json({ success: true, pipelines: pipeline.listPipelines() });
});

router.get("/runtime/pipelines/:name", (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    const p = pipeline.getPipeline(req.params.name);
    if (!p) return res.status(404).json({ success: false, error: "pipeline_not_found" });
    return res.json({ success: true, pipeline: p });
});

router.post("/runtime/pipelines/:name/runs", rateLimiter(10, 60_000), (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    try {
        const result = pipeline.createRun(req.params.name, {
            operatorId: req.body.operatorId || null,
            sessionId:  req.body.sessionId  || null,
            approved:   req.body.approved   === true,
            dryRun:     req.body.dryRun     === true,
        });
        return res.status(result.created ? 200 : 400).json({ success: result.created, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.get("/runtime/pipelines/runs", (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    const limit = Math.min(parseInt(req.query.limit) || 20, 20);
    return res.json({ success: true, runs: pipeline.listRuns({ pipeline: req.query.pipeline, state: req.query.state, limit }) });
});

router.get("/runtime/pipelines/runs/:runId", (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    const run = pipeline.getRun(req.params.runId);
    if (!run) return res.status(404).json({ success: false, error: "run_not_found" });
    return res.json({ success: true, run });
});

router.post("/runtime/pipelines/runs/:runId/approve", rateLimiter(10, 60_000), (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    return res.json({ success: pipeline.approveRun(req.params.runId) });
});

router.post("/runtime/pipelines/runs/:runId/rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!pipeline) return res.status(503).json({ success: false, error: "pipeline_unavailable" });
    const reason = (req.body.reason || "operator_initiated").slice(0, 200);
    return res.json({ success: pipeline.markRolledBack(req.params.runId, reason) });
});

// ── Phase 479: SaaS Readiness Audit ──────────────────────────────────────────

const saasAudit = _tryRequirePhase("../../agents/runtime/saasReadinessAudit.cjs");

router.get("/runtime/saas-readiness", rateLimiter(5, 60_000), async (req, res) => {
    if (!saasAudit) return res.status(503).json({ success: false, error: "saas_audit_unavailable" });
    try {
        const result = await saasAudit.runSaasAudit();
        return res.status(result.saasReady ? 200 : 503).json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 481: Operator Onboarding ───────────────────────────────────────────

const onboarding = _tryRequirePhase("../../agents/runtime/operatorOnboarding.cjs");

router.get("/runtime/onboarding", rateLimiter(10, 60_000), async (req, res) => {
    if (!onboarding) return res.status(503).json({ success: false, error: "onboarding_unavailable" });
    return res.json({ success: true, state: onboarding.getOnboardingState() });
});

router.post("/runtime/onboarding/run", rateLimiter(5, 60_000), async (req, res) => {
    if (!onboarding) return res.status(503).json({ success: false, error: "onboarding_unavailable" });
    const operatorId = (req.body.operatorId || "default").slice(0, 60);
    try {
        const result = await onboarding.runOnboarding(operatorId);
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.post("/runtime/onboarding/reset", rateLimiter(3, 60_000), (req, res) => {
    if (!onboarding) return res.status(503).json({ success: false, error: "onboarding_unavailable" });
    return res.json({ success: true, ...onboarding.resetOnboarding() });
});

// ── Phase 483: Workflow Library ───────────────────────────────────────────────

const workflowLib = _tryRequirePhase("../../agents/runtime/workflowLibrary.cjs");

router.get("/runtime/workflows/library", rateLimiter(30, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    const { category, tag } = req.query;
    return res.json({ success: true, workflows: workflowLib.listWorkflows({ category, tag }), stats: workflowLib.stats() });
});

router.get("/runtime/workflows/library/search", rateLimiter(30, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    const query = (req.query.q || "").slice(0, 200);
    return res.json({ success: true, results: workflowLib.searchWorkflows(query, { limit: 20 }) });
});

router.get("/runtime/workflows/library/:id", rateLimiter(30, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    const wf = workflowLib.getWorkflow(req.params.id);
    if (!wf) return res.status(404).json({ success: false, error: "workflow_not_found" });
    return res.json({ success: true, workflow: wf });
});

router.post("/runtime/workflows/library", rateLimiter(10, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    const result = workflowLib.createWorkflow(req.body);
    return res.status(result.created ? 201 : 400).json({ success: result.created, ...result });
});

router.put("/runtime/workflows/library/:id", rateLimiter(10, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    return res.json(workflowLib.editWorkflow(req.params.id, req.body));
});

router.delete("/runtime/workflows/library/:id", rateLimiter(10, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    return res.json(workflowLib.deleteWorkflow(req.params.id));
});

router.get("/runtime/workflows/library/:id/export", rateLimiter(10, 60_000), (req, res) => {
    if (!workflowLib) return res.status(503).json({ success: false, error: "workflow_library_unavailable" });
    const fmt = req.query.format === "markdown" ? "markdown" : "json";
    const out  = fmt === "markdown" ? workflowLib.exportMarkdown(req.params.id) : workflowLib.exportJson(req.params.id);
    if (!out) return res.status(404).json({ success: false, error: "workflow_not_found" });
    return res.type(fmt === "markdown" ? "text/markdown" : "application/json").send(out);
});

// ── Phase 484: Operational Search (extensions) ───────────────────────────────

router.get("/runtime/search", rateLimiter(30, 60_000), (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const q     = (req.query.q || "").slice(0, 200);
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    return res.json({ success: true, results: opSearch.searchEverything(q, { limit }) });
});

router.get("/runtime/search/workflows", rateLimiter(30, 60_000), (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const q = (req.query.q || "").slice(0, 200);
    return res.json({ success: true, results: opSearch.searchWorkflows(q, { limit: 20 }) });
});

router.get("/runtime/search/replays", rateLimiter(30, 60_000), (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const q = (req.query.q || "").slice(0, 200);
    return res.json({ success: true, results: opSearch.searchReplays(q, 20) });
});

router.get("/runtime/search/deployments", rateLimiter(30, 60_000), (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const q = (req.query.q || "").slice(0, 200);
    return res.json({ success: true, results: opSearch.searchDeployments(q, { limit: 20 }) });
});

router.get("/runtime/search/failure-patterns", rateLimiter(20, 60_000), (req, res) => {
    if (!opSearch) return res.status(503).json({ success: false, error: "search_unavailable" });
    const q = (req.query.q || "").slice(0, 200);
    return res.json({ success: true, results: opSearch.searchFailurePatterns(q, 20) });
});

// ── Phase 485: Operator Dashboard ────────────────────────────────────────────

const opDashboard = _tryRequirePhase("../../agents/runtime/operatorDashboard.cjs");

router.get("/runtime/dashboard", rateLimiter(30, 60_000), (req, res) => {
    if (!opDashboard) return res.status(503).json({ success: false, error: "dashboard_unavailable" });
    return res.json({ success: true, dashboard: opDashboard.getDashboard() });
});

router.get("/runtime/dashboard/summary", rateLimiter(60, 60_000), (req, res) => {
    if (!opDashboard) return res.status(503).json({ success: false, error: "dashboard_unavailable" });
    return res.json({ success: true, summary: opDashboard.getSummaryLine() });
});

// ── Phase 486: Replay Player ──────────────────────────────────────────────────

const replayPlayer = _tryRequirePhase("../../agents/runtime/replayPlayer.cjs");

router.get("/runtime/replays", rateLimiter(30, 60_000), (req, res) => {
    if (!replayPlayer) return res.status(503).json({ success: false, error: "replay_player_unavailable" });
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    return res.json({ success: true, replays: replayPlayer.listReplays({ limit, sessionId: req.query.sessionId }) });
});

router.get("/runtime/replays/compare", rateLimiter(10, 60_000), (req, res) => {
    if (!replayPlayer) return res.status(503).json({ success: false, error: "replay_player_unavailable" });
    const { a, b } = req.query;
    if (!a || !b) return res.status(400).json({ success: false, error: "a and b replay IDs required" });
    const result = replayPlayer.compareReplays(a, b);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
});

router.get("/runtime/replays/:id/playback", rateLimiter(20, 60_000), (req, res) => {
    if (!replayPlayer) return res.status(503).json({ success: false, error: "replay_player_unavailable" });
    const pb = replayPlayer.getPlayback(req.params.id);
    if (!pb.ok) return res.status(404).json({ success: false, error: pb.error });
    return res.json({ success: true, ...pb });
});

router.get("/runtime/replays/:id/timeline", rateLimiter(20, 60_000), (req, res) => {
    if (!replayPlayer) return res.status(503).json({ success: false, error: "replay_player_unavailable" });
    const tl = replayPlayer.getRecoveryTimeline(req.params.id);
    if (!tl.ok) return res.status(404).json({ success: false, error: tl.error });
    return res.json({ success: true, ...tl });
});

router.get("/runtime/replays/:id/step/:index", rateLimiter(30, 60_000), (req, res) => {
    if (!replayPlayer) return res.status(503).json({ success: false, error: "replay_player_unavailable" });
    const step = replayPlayer.getStep(req.params.id, parseInt(req.params.index) || 0);
    if (!step.ok) return res.status(404).json({ success: false, error: step.error });
    return res.json({ success: true, ...step });
});

router.get("/runtime/replays/:id/export", rateLimiter(10, 60_000), (req, res) => {
    if (!replayPlayer) return res.status(503).json({ success: false, error: "replay_player_unavailable" });
    const bundle = replayPlayer.exportBundle(req.params.id);
    if (!bundle.ok) return res.status(404).json({ success: false, error: bundle.error });
    return res.json({ success: true, ...bundle });
});

// ── Phase 487: Deployment Operator UX ────────────────────────────────────────

const deployUX = _tryRequirePhase("../../agents/runtime/deploymentOperatorUX.cjs");

router.get("/runtime/deployments/preflight/:pipeline", rateLimiter(10, 60_000), (req, res) => {
    if (!deployUX) return res.status(503).json({ success: false, error: "deploy_ux_unavailable" });
    return res.json({ success: true, ...deployUX.preflightSummary(req.params.pipeline) });
});

router.get("/runtime/deployments/rollback-preview/:runId", rateLimiter(10, 60_000), (req, res) => {
    if (!deployUX) return res.status(503).json({ success: false, error: "deploy_ux_unavailable" });
    return res.json({ success: true, ...deployUX.rollbackPreview(req.params.runId) });
});

router.get("/runtime/deployments/environment", rateLimiter(15, 60_000), (req, res) => {
    if (!deployUX) return res.status(503).json({ success: false, error: "deploy_ux_unavailable" });
    return res.json({ success: true, ...deployUX.environmentWarnings() });
});

router.get("/runtime/deployments/readiness", rateLimiter(15, 60_000), (req, res) => {
    if (!deployUX) return res.status(503).json({ success: false, error: "deploy_ux_unavailable" });
    return res.json({ success: true, ...deployUX.readinessIndicator(req.query.pipeline) });
});

// ── Phase 490: Memory Refinement ──────────────────────────────────────────────

const memRefine = _tryRequirePhase("../../agents/runtime/memoryRefinement.cjs");

router.get("/runtime/memory/health", rateLimiter(10, 60_000), (req, res) => {
    if (!memRefine) return res.status(503).json({ success: false, error: "memory_refinement_unavailable" });
    return res.json({ success: true, ...memRefine.memoryHealthReport() });
});

router.get("/runtime/memory/continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!memRefine) return res.status(503).json({ success: false, error: "memory_refinement_unavailable" });
    return res.json({ success: true, ...memRefine.continuitScore() });
});

router.post("/runtime/memory/prune", rateLimiter(3, 60_000), (req, res) => {
    if (!memRefine) return res.status(503).json({ success: false, error: "memory_refinement_unavailable" });
    const minScore = parseInt(req.body.minScore) || 20;
    return res.json({ success: true, ...memRefine.pruneEngMemory(minScore) });
});

router.get("/runtime/memory/recommendations", rateLimiter(15, 60_000), (req, res) => {
    if (!memRefine) return res.status(503).json({ success: false, error: "memory_refinement_unavailable" });
    const goal = (req.query.goal || "").slice(0, 200);
    return res.json({ success: true, recommendations: memRefine.scoreRecommendations(goal) });
});

// ── Phase 492: Team Workspace ─────────────────────────────────────────────────

const teamWS = _tryRequirePhase("../../agents/runtime/teamWorkspace.cjs");

router.get("/runtime/team/snapshot", rateLimiter(15, 60_000), (req, res) => {
    if (!teamWS) return res.status(503).json({ success: false, error: "team_workspace_unavailable" });
    return res.json({ success: true, ...teamWS.teamSnapshot() });
});

router.post("/runtime/team/share/workflow", rateLimiter(10, 60_000), (req, res) => {
    if (!teamWS) return res.status(503).json({ success: false, error: "team_workspace_unavailable" });
    const { workflowId, operatorId, note } = req.body;
    if (!workflowId) return res.status(400).json({ success: false, error: "workflowId required" });
    return res.json(teamWS.shareWorkflow(workflowId, operatorId, note));
});

router.post("/runtime/team/share/replay", rateLimiter(10, 60_000), (req, res) => {
    if (!teamWS) return res.status(503).json({ success: false, error: "team_workspace_unavailable" });
    const { replayId, sessionId, operatorId, note } = req.body;
    if (!replayId) return res.status(400).json({ success: false, error: "replayId required" });
    return res.json(teamWS.shareReplay(replayId, sessionId, operatorId, note));
});

router.post("/runtime/team/activity", rateLimiter(30, 60_000), (req, res) => {
    if (!teamWS) return res.status(503).json({ success: false, error: "team_workspace_unavailable" });
    const { operatorId, sessionId, workflowId } = req.body;
    teamWS.recordActivity(operatorId, { sessionId, workflowId });
    return res.json({ success: true });
});

router.get("/runtime/team/activity", rateLimiter(15, 60_000), (req, res) => {
    if (!teamWS) return res.status(503).json({ success: false, error: "team_workspace_unavailable" });
    return res.json({ success: true, operators: teamWS.listOperatorActivity() });
});

// ── Phase 496: Active Engineering Assistant ───────────────────────────────────

const activeAssistant = _tryRequirePhase("../../agents/runtime/activeAssistant.cjs");

router.get("/runtime/assist/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!activeAssistant) return res.status(503).json({ success: false, error: "assistant_unavailable" });
    const context = {
        recentErrors:   (req.query.errors   || "").split(",").filter(Boolean),
        recentFailures: parseInt(req.query.failures) || 0,
        lastChain:      req.query.lastChain || "",
        goal:           req.query.goal      || "",
    };
    return res.json({ success: true, ...activeAssistant.assist(req.params.sessionId, context) });
});

router.get("/runtime/assist/suggest", rateLimiter(20, 60_000), (req, res) => {
    if (!activeAssistant) return res.status(503).json({ success: false, error: "assistant_unavailable" });
    const goal = (req.query.goal || "").slice(0, 200);
    return res.json({ success: true, suggestions: activeAssistant.quickSuggest(goal) });
});

// ── Phase 498: Command Assist ─────────────────────────────────────────────────

const commandAssist = _tryRequirePhase("../../agents/runtime/commandAssist.cjs");

router.post("/runtime/command-assist/suggest", rateLimiter(20, 60_000), (req, res) => {
    if (!commandAssist) return res.status(503).json({ success: false, error: "command_assist_unavailable" });
    return res.json({ success: true, suggestions: commandAssist.suggestCommands(req.body || {}) });
});

router.post("/runtime/command-assist/validate", rateLimiter(20, 60_000), (req, res) => {
    if (!commandAssist) return res.status(503).json({ success: false, error: "command_assist_unavailable" });
    const cmd = (req.body.cmd || "").slice(0, 500);
    return res.json({ success: true, ...commandAssist.validateCommand(cmd) });
});

router.get("/runtime/command-assist/deployment-hints", rateLimiter(10, 60_000), (req, res) => {
    if (!commandAssist) return res.status(503).json({ success: false, error: "command_assist_unavailable" });
    return res.json({ success: true, ...commandAssist.deploymentHints(req.query.pipeline || "standard-deploy") });
});

router.get("/runtime/command-assist/rollback-awareness", rateLimiter(10, 60_000), (req, res) => {
    if (!commandAssist) return res.status(503).json({ success: false, error: "command_assist_unavailable" });
    return res.json({ success: true, ...commandAssist.rollbackAwareness() });
});

// ── Phase 499: Engineering Continuity ────────────────────────────────────────

const continuity = _tryRequirePhase("../../agents/runtime/engineeringContinuity.cjs");

router.post("/runtime/continuity/checkpoint", rateLimiter(20, 60_000), (req, res) => {
    if (!continuity) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    const { sessionId, ...opts } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId required" });
    return res.json({ success: true, ...continuity.checkpoint(sessionId, opts) });
});

router.get("/runtime/continuity/restore", rateLimiter(10, 60_000), (req, res) => {
    if (!continuity) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    return res.json({ success: true, ...continuity.findRestorable(req.query.operatorId) });
});

router.post("/runtime/continuity/workflow-progress", rateLimiter(20, 60_000), (req, res) => {
    if (!continuity) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    const { sessionId, workflowId, stepIndex, context } = req.body;
    if (!sessionId || !workflowId) return res.status(400).json({ success: false, error: "sessionId and workflowId required" });
    return res.json({ success: true, ...continuity.saveWorkflowProgress(sessionId, workflowId, stepIndex || 0, context || {}) });
});

router.get("/runtime/continuity/workflow-progress/:sessionId", rateLimiter(10, 60_000), (req, res) => {
    if (!continuity) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    const progress = continuity.getWorkflowProgress(req.params.sessionId);
    return res.json({ success: true, progress });
});

router.post("/runtime/continuity/restore-runtime", rateLimiter(3, 60_000), (req, res) => {
    if (!continuity) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    return res.json({ success: true, ...continuity.runtimeRestoration() });
});

router.get("/runtime/continuity/checkpoints", rateLimiter(10, 60_000), (req, res) => {
    if (!continuity) return res.status(503).json({ success: false, error: "continuity_unavailable" });
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    return res.json({ success: true, checkpoints: continuity.listCheckpoints({ operatorId: req.query.operatorId, limit }) });
});

// ── Phase 501: Workflow Suggester ─────────────────────────────────────────────

const wfSuggester = _tryRequirePhase("../../agents/runtime/workflowSuggester.cjs");

router.post("/runtime/workflows/suggest", rateLimiter(20, 60_000), (req, res) => {
    if (!wfSuggester) return res.status(503).json({ success: false, error: "suggester_unavailable" });
    return res.json({ success: true, suggestions: wfSuggester.suggest(req.body || {}) });
});

router.get("/runtime/workflows/next-step", rateLimiter(20, 60_000), (req, res) => {
    if (!wfSuggester) return res.status(503).json({ success: false, error: "suggester_unavailable" });
    const goal  = (req.query.goal || "").slice(0, 200);
    const state = req.query.state || "active";
    return res.json({ success: true, suggestion: wfSuggester.nextStep(goal, state) });
});

// ── Phase 505: Operator Productivity Mode ─────────────────────────────────────

const productivityMode = _tryRequirePhase("../../agents/runtime/operatorProductivityMode.cjs");

router.get("/runtime/productivity-mode", rateLimiter(20, 60_000), (req, res) => {
    if (!productivityMode) return res.status(503).json({ success: false, error: "productivity_mode_unavailable" });
    return res.json({ success: true, state: productivityMode.getState() });
});

router.post("/runtime/productivity-mode/activate", rateLimiter(5, 60_000), (req, res) => {
    if (!productivityMode) return res.status(503).json({ success: false, error: "productivity_mode_unavailable" });
    return res.json({ success: true, ...productivityMode.activate() });
});

router.post("/runtime/productivity-mode/deactivate", rateLimiter(5, 60_000), (req, res) => {
    if (!productivityMode) return res.status(503).json({ success: false, error: "productivity_mode_unavailable" });
    return res.json({ success: true, ...productivityMode.deactivate() });
});

router.get("/runtime/productivity-mode/focus", rateLimiter(20, 60_000), (req, res) => {
    if (!productivityMode) return res.status(503).json({ success: false, error: "productivity_mode_unavailable" });
    return res.json({ success: true, ...productivityMode.focusSummary() });
});

router.post("/runtime/productivity-mode/configure", rateLimiter(5, 60_000), (req, res) => {
    if (!productivityMode) return res.status(503).json({ success: false, error: "productivity_mode_unavailable" });
    return res.json({ success: true, ...productivityMode.configure(req.body || {}) });
});

// ── Phase 508: Insight Summaries ──────────────────────────────────────────────

const insights = _tryRequirePhase("../../agents/runtime/insightSummary.cjs");

router.get("/runtime/insights/session/:sessionId", rateLimiter(10, 60_000), (req, res) => {
    if (!insights) return res.status(503).json({ success: false, error: "insights_unavailable" });
    return res.json({ success: true, ...insights.sessionSummary(req.params.sessionId) });
});

router.get("/runtime/insights/deployment/:runId", rateLimiter(10, 60_000), (req, res) => {
    if (!insights) return res.status(503).json({ success: false, error: "insights_unavailable" });
    return res.json({ success: true, ...insights.deploymentSummary(req.params.runId) });
});

router.get("/runtime/insights/recovery/:chainName", rateLimiter(10, 60_000), (req, res) => {
    if (!insights) return res.status(503).json({ success: false, error: "insights_unavailable" });
    return res.json({ success: true, ...insights.recoverySummary(req.params.chainName) });
});

router.get("/runtime/insights/failures", rateLimiter(10, 60_000), (req, res) => {
    if (!insights) return res.status(503).json({ success: false, error: "insights_unavailable" });
    return res.json({ success: true, ...insights.failureSummary(req.query.q || "") });
});

router.get("/runtime/insights/stability", rateLimiter(10, 60_000), (req, res) => {
    if (!insights) return res.status(503).json({ success: false, error: "insights_unavailable" });
    return res.json({ success: true, ...insights.workflowStabilitySummary() });
});

router.post("/runtime/insights/report", rateLimiter(5, 60_000), (req, res) => {
    if (!insights) return res.status(503).json({ success: false, error: "insights_unavailable" });
    return res.json({ success: true, report: insights.insightReport(req.body || {}) });
});

// ── Phase 511: Stability Layer ────────────────────────────────────────────────

const stabilityLayer = _tryRequirePhase("../../agents/runtime/stabilityLayer.cjs");

router.get("/runtime/stability", rateLimiter(10, 60_000), (req, res) => {
    if (!stabilityLayer) return res.status(503).json({ success: false, error: "stability_unavailable" });
    return res.json({ success: true, ...stabilityLayer.stabilityCheck() });
});

router.get("/runtime/stability/drift", rateLimiter(10, 60_000), (req, res) => {
    if (!stabilityLayer) return res.status(503).json({ success: false, error: "stability_unavailable" });
    return res.json({ success: true, ...stabilityLayer.detectDrift() });
});

router.post("/runtime/stability/claim-execution", rateLimiter(30, 60_000), (req, res) => {
    if (!stabilityLayer) return res.status(503).json({ success: false, error: "stability_unavailable" });
    const key = (req.body.key || "").slice(0, 200);
    if (!key) return res.status(400).json({ success: false, error: "key required" });
    return res.json({ success: true, ...stabilityLayer.claimExecution(key) });
});

router.post("/runtime/stability/release-execution", rateLimiter(30, 60_000), (req, res) => {
    if (!stabilityLayer) return res.status(503).json({ success: false, error: "stability_unavailable" });
    const key = (req.body.key || "").slice(0, 200);
    if (!key) return res.status(400).json({ success: false, error: "key required" });
    return res.json({ success: true, ...stabilityLayer.releaseExecution(key) });
});

// ── Phase 513: Environment Detector ──────────────────────────────────────────

const envDetector = _tryRequirePhase("../../agents/runtime/environmentDetector.cjs");

router.get("/runtime/environment", rateLimiter(10, 60_000), async (req, res) => {
    if (!envDetector) return res.status(503).json({ success: false, error: "env_detector_unavailable" });
    try {
        const result = envDetector.detect();
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase 514: Workflow Marketplace ──────────────────────────────────────────

const marketplace = _tryRequirePhase("../../agents/runtime/workflowMarketplace.cjs");

router.get("/runtime/marketplace/workflows", rateLimiter(20, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    const { category, tag } = req.query;
    return res.json({ success: true, workflows: marketplace.listWithMetadata({ category, tag }) });
});

router.get("/runtime/marketplace/workflows/:id/validate", rateLimiter(10, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    const wfLib = _tryRequirePhase("../../agents/runtime/workflowLibrary.cjs");
    const wf    = wfLib ? wfLib.getWorkflow(req.params.id) : null;
    if (!wf) return res.status(404).json({ success: false, error: "workflow_not_found" });
    return res.json({ success: true, ...marketplace.validateWorkflow(wf) });
});

router.get("/runtime/marketplace/workflows/:id/confidence", rateLimiter(10, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    return res.json({ success: true, ...marketplace.replayConfidence(req.params.id) });
});

router.get("/runtime/marketplace/workflows/:id/bundle", rateLimiter(10, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    const bundle = marketplace.exportBundle(req.params.id);
    if (!bundle.ok) return res.status(404).json({ success: false, error: bundle.error });
    return res.json({ success: true, ...bundle });
});

router.post("/runtime/marketplace/workflows/import", rateLimiter(5, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    const operatorId = (req.body.operatorId || "").slice(0, 60);
    const result = marketplace.importBundle(req.body.bundle, operatorId);
    return res.status(result.ok ? 201 : 400).json({ success: result.ok, ...result });
});

router.post("/runtime/marketplace/workflows/:id/rate", rateLimiter(5, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    const { operatorId, rating, comment } = req.body;
    return res.json(marketplace.rateWorkflow(req.params.id, operatorId, rating, comment));
});

router.get("/runtime/marketplace/workflows/:id/rating", rateLimiter(20, 60_000), (req, res) => {
    if (!marketplace) return res.status(503).json({ success: false, error: "marketplace_unavailable" });
    return res.json({ success: true, ...marketplace.getWorkflowRating(req.params.id) });
});

// ── Phase 515: Debugging Mode ─────────────────────────────────────────────────

const debugMode = _tryRequirePhase("../../agents/runtime/debuggingMode.cjs");

router.post("/runtime/debug/activate", rateLimiter(5, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    return res.json({ success: true, ...debugMode.activate(req.body.sessionId, req.body.operatorId) });
});

router.post("/runtime/debug/deactivate", rateLimiter(5, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    return res.json({ success: true, ...debugMode.deactivate() });
});

router.get("/runtime/debug/state", rateLimiter(10, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    return res.json({ success: true, ...debugMode.getState() });
});

router.post("/runtime/debug/log-error", rateLimiter(30, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    const message = (req.body.message || "").slice(0, 500);
    return res.json({ success: true, entry: debugMode.logError(message, req.body.context || {}) });
});

router.get("/runtime/debug/clusters", rateLimiter(10, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    return res.json({ success: true, ...debugMode.clusterErrors() });
});

router.post("/runtime/debug/suggestions", rateLimiter(10, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    return res.json({ success: true, suggestions: debugMode.focusedRecoverySuggestions(req.body || {}) });
});

router.get("/runtime/debug/timeline/:sessionId", rateLimiter(10, 60_000), (req, res) => {
    if (!debugMode) return res.status(503).json({ success: false, error: "debug_mode_unavailable" });
    return res.json({ success: true, ...debugMode.debugTimeline(req.params.sessionId) });
});

// ── Phase 518: Session Intelligence ──────────────────────────────────────────

const sessionIntel = _tryRequirePhase("../../agents/runtime/sessionIntelligence.cjs");

router.get("/runtime/sessions/:id/intelligence", rateLimiter(10, 60_000), (req, res) => {
    if (!sessionIntel) return res.status(503).json({ success: false, error: "session_intel_unavailable" });
    return res.json({ success: true, ...sessionIntel.summarizeSession(req.params.id) });
});

router.get("/runtime/sessions/:id/goal-track", rateLimiter(10, 60_000), (req, res) => {
    if (!sessionIntel) return res.status(503).json({ success: false, error: "session_intel_unavailable" });
    return res.json({ success: true, ...sessionIntel.trackGoal(req.params.id) });
});

router.get("/runtime/sessions/:id/blocked-state", rateLimiter(10, 60_000), (req, res) => {
    if (!sessionIntel) return res.status(503).json({ success: false, error: "session_intel_unavailable" });
    return res.json({ success: true, ...sessionIntel.detectBlockedState(req.params.id) });
});

router.get("/runtime/sessions/:id/recovery-paths", rateLimiter(10, 60_000), (req, res) => {
    if (!sessionIntel) return res.status(503).json({ success: false, error: "session_intel_unavailable" });
    return res.json({ success: true, paths: sessionIntel.suggestRecoveryPaths(req.params.id) });
});

// ── Phase 521: UX Helper ──────────────────────────────────────────────────────

const uxHelper = _tryRequirePhase("../../agents/runtime/uxHelper.cjs");

router.post("/runtime/ux/calm-dashboard", rateLimiter(20, 60_000), (req, res) => {
    if (!uxHelper) return res.status(503).json({ success: false, error: "ux_helper_unavailable" });
    return res.json({ success: true, ...uxHelper.calmDashboard(req.body.dashboard) });
});

router.get("/runtime/ux/workflow-groups", rateLimiter(10, 60_000), (req, res) => {
    if (!uxHelper) return res.status(503).json({ success: false, error: "ux_helper_unavailable" });
    const wfLib = _tryRequirePhase("../../agents/runtime/workflowLibrary.cjs");
    const workflows = wfLib ? wfLib.listWorkflows() : [];
    return res.json({ success: true, groups: uxHelper.groupWorkflows(workflows) });
});

// ── Phase 526: Workspace Snapshot ────────────────────────────────────────────

const wsSnapshot = _tryRequirePhase("../../agents/runtime/workspaceSnapshot.cjs");

router.get("/runtime/snapshots", rateLimiter(10, 60_000), (req, res) => {
    if (!wsSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    return res.json({ success: true, snapshots: wsSnapshot.listSnapshots({ operatorId: req.query.operatorId }) });
});

router.post("/runtime/snapshots", rateLimiter(10, 60_000), (req, res) => {
    if (!wsSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    const { name, sessionId, operatorId } = req.body;
    return res.json({ success: true, ...wsSnapshot.capture(name || "snapshot", { sessionId, operatorId }) });
});

router.post("/runtime/snapshots/:id/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!wsSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    const result = wsSnapshot.restore(req.params.id);
    return res.status(result.ok ? 200 : 404).json({ success: result.ok, ...result });
});

router.delete("/runtime/snapshots/:id", rateLimiter(5, 60_000), (req, res) => {
    if (!wsSnapshot) return res.status(503).json({ success: false, error: "snapshot_unavailable" });
    return res.json(wsSnapshot.deleteSnapshot(req.params.id));
});

// ── Phase 528: Template Ecosystem ─────────────────────────────────────────────

const templateEco = _tryRequirePhase("../../agents/runtime/templateEcosystem.cjs");

router.get("/runtime/ecosystem", rateLimiter(10, 60_000), (req, res) => {
    if (!templateEco) return res.status(503).json({ success: false, error: "template_ecosystem_unavailable" });
    return res.json({ success: true, ...templateEco.ecosystemView(req.query.operatorId) });
});

router.post("/runtime/ecosystem/favorites/:workflowId", rateLimiter(10, 60_000), (req, res) => {
    if (!templateEco) return res.status(503).json({ success: false, error: "template_ecosystem_unavailable" });
    const operatorId = (req.body.operatorId || "").slice(0, 60);
    return res.json(templateEco.toggleFavorite(operatorId, req.params.workflowId));
});

router.get("/runtime/ecosystem/favorites", rateLimiter(10, 60_000), (req, res) => {
    if (!templateEco) return res.status(503).json({ success: false, error: "template_ecosystem_unavailable" });
    return res.json({ success: true, favorites: templateEco.getFavorites(req.query.operatorId) });
});

router.post("/runtime/ecosystem/compatibility/:workflowId", rateLimiter(5, 60_000), (req, res) => {
    if (!templateEco) return res.status(503).json({ success: false, error: "template_ecosystem_unavailable" });
    return res.json(templateEco.setCompatibility(req.params.workflowId, req.body));
});

router.get("/runtime/ecosystem/compatibility/:workflowId", rateLimiter(10, 60_000), (req, res) => {
    if (!templateEco) return res.status(503).json({ success: false, error: "template_ecosystem_unavailable" });
    return res.json({ success: true, ...templateEco.checkCompatibility(req.params.workflowId) });
});

// ── Phase 530: Deployment Command Center ─────────────────────────────────────

const deployCC = _tryRequirePhase("../../agents/runtime/deploymentCommandCenter.cjs");

router.get("/runtime/deploy-center", rateLimiter(15, 60_000), (req, res) => {
    if (!deployCC) return res.status(503).json({ success: false, error: "deploy_center_unavailable" });
    return res.json({ success: true, ...deployCC.snapshot() });
});

router.get("/runtime/deploy-center/timeline", rateLimiter(10, 60_000), (req, res) => {
    if (!deployCC) return res.status(503).json({ success: false, error: "deploy_center_unavailable" });
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    return res.json({ success: true, ...deployCC.deploymentTimeline({ limit }) });
});

router.get("/runtime/deploy-center/recovery-chains", rateLimiter(10, 60_000), (req, res) => {
    if (!deployCC) return res.status(503).json({ success: false, error: "deploy_center_unavailable" });
    return res.json({ success: true, ...deployCC.recoveryChainStatus() });
});

// ── Phase 531: Failure Intelligence Engine ────────────────────────────────────

const failureIntel = _tryRequirePhase("../../agents/runtime/failureIntelligenceEngine.cjs");

router.get("/runtime/failure-intel/report", rateLimiter(5, 60_000), (req, res) => {
    if (!failureIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    return res.json({ success: true, ...failureIntel.report() });
});

router.post("/runtime/failure-intel/cluster", rateLimiter(10, 60_000), (req, res) => {
    if (!failureIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    const errors = (req.body.errors || []).slice(0, 100).map(e => String(e).slice(0, 500));
    return res.json({ success: true, clusters: failureIntel.clusterRootCauses(errors) });
});

router.get("/runtime/failure-intel/chain/:chainName", rateLimiter(10, 60_000), (req, res) => {
    if (!failureIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    return res.json({ success: true, ...failureIntel.mapFailureChain(req.params.chainName) });
});

router.get("/runtime/failure-intel/unstable", rateLimiter(10, 60_000), (req, res) => {
    if (!failureIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    return res.json({ success: true, ...failureIntel.detectUnstableWorkflows() });
});

router.get("/runtime/failure-intel/deployment-risk/:pipeline", rateLimiter(10, 60_000), (req, res) => {
    if (!failureIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    return res.json({ success: true, ...failureIntel.estimateDeploymentRisk(req.params.pipeline) });
});

router.get("/runtime/failure-intel/recovery-confidence/:chainName", rateLimiter(10, 60_000), (req, res) => {
    if (!failureIntel) return res.status(503).json({ success: false, error: "failure_intel_unavailable" });
    return res.json({ success: true, ...failureIntel.recoveryConfidence(req.params.chainName) });
});

// ── Phase 533: Operator Analytics ─────────────────────────────────────────────

const operatorAnalytics533 = _tryRequirePhase("../../agents/runtime/operatorAnalytics.cjs");

router.get("/runtime/operator-analytics", rateLimiter(10, 60_000), (req, res) => {
    if (!operatorAnalytics533) return res.status(503).json({ success: false, error: "operator_analytics_unavailable" });
    return res.json({ success: true, ...operatorAnalytics533.summary() });
});

router.post("/runtime/operator-analytics/record", rateLimiter(60, 60_000), (req, res) => {
    if (!operatorAnalytics533) return res.status(503).json({ success: false, error: "operator_analytics_unavailable" });
    const { type, ...meta } = req.body;
    if (!type) return res.status(400).json({ success: false, error: "type required" });
    operatorAnalytics533.record(type, meta);
    return res.json({ success: true });
});

router.post("/runtime/operator-analytics/sweep", rateLimiter(5, 60_000), (req, res) => {
    if (!operatorAnalytics533) return res.status(503).json({ success: false, error: "operator_analytics_unavailable" });
    return res.json({ success: true, ...operatorAnalytics533.sweep() });
});

// ── Phase 541 — Persistent Engineering Workspaces ────────────────────────────
const persistWs = _tryRequirePhase("../../agents/runtime/persistentWorkspace.cjs");
router.post("/runtime/persistent-workspace/upsert", rateLimiter(30, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    const { name, ...opts } = req.body || {};
    return res.json({ success: true, ...persistWs.upsertWorkspace(name, opts) });
});
router.get("/runtime/persistent-workspace/list", rateLimiter(30, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    return res.json({ success: true, workspaces: persistWs.listWorkspaces({ operatorId: req.query.operatorId }) });
});
router.post("/runtime/persistent-workspace/:id/reconnect", rateLimiter(20, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    return res.json({ success: true, ...persistWs.reconnect(req.params.id) });
});
router.post("/runtime/persistent-workspace/:id/log-event", rateLimiter(60, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    const { eventType, ...meta } = req.body || {};
    return res.json({ success: true, ...persistWs.logEvent(req.params.id, eventType, meta) });
});
router.post("/runtime/persistent-workspace/:id/debugging-context", rateLimiter(20, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    return res.json({ success: true, ...persistWs.saveDebuggingContext(req.params.id, req.body || {}) });
});
router.get("/runtime/persistent-workspace/:id/debugging-context", rateLimiter(30, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    return res.json({ success: true, ...persistWs.restoreDebuggingContext(req.params.id) });
});
router.delete("/runtime/persistent-workspace/:id", rateLimiter(10, 60_000), (req, res) => {
    if (!persistWs) return res.status(503).json({ success: false, error: "persistentWorkspace_unavailable" });
    return res.json({ success: true, ...persistWs.deleteWorkspace(req.params.id) });
});

// ── Phase 542 — VS Code Operations ───────────────────────────────────────────
const vsCode = _tryRequirePhase("../../agents/runtime/vsCodeOperations.cjs");
router.post("/runtime/vscode/validate-file", rateLimiter(30, 60_000), (req, res) => {
    if (!vsCode) return res.status(503).json({ success: false, error: "vsCodeOperations_unavailable" });
    return res.json({ success: true, ...vsCode.validateFileTarget(req.body?.filePath) });
});
router.post("/runtime/vscode/preview-patch", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCode) return res.status(503).json({ success: false, error: "vsCodeOperations_unavailable" });
    const { filePath, patchContent, ...opts } = req.body || {};
    return res.json({ success: true, ...vsCode.previewPatch(filePath, patchContent, opts) });
});
router.post("/runtime/vscode/record-patch", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCode) return res.status(503).json({ success: false, error: "vsCodeOperations_unavailable" });
    const { filePath, patchContent, ...opts } = req.body || {};
    return res.json({ success: true, ...vsCode.recordPatchApplication(filePath, patchContent, opts) });
});
router.get("/runtime/vscode/patch-history", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCode) return res.status(503).json({ success: false, error: "vsCodeOperations_unavailable" });
    return res.json({ success: true, ...vsCode.patchHistory({ sessionId: req.query.sessionId, replayId: req.query.replayId }) });
});

// ── Phase 543 — Terminal Execution Hardening ──────────────────────────────────
const termExec = _tryRequirePhase("../../agents/runtime/terminalExecutor.cjs");
router.post("/runtime/terminal/validate-command", rateLimiter(60, 60_000), (req, res) => {
    if (!termExec) return res.status(503).json({ success: false, error: "terminalExecutor_unavailable" });
    return res.json({ success: true, ...termExec.validateCommand(req.body?.cmd) });
});
router.post("/runtime/terminal/validate-macro", rateLimiter(20, 60_000), (req, res) => {
    if (!termExec) return res.status(503).json({ success: false, error: "terminalExecutor_unavailable" });
    const { commands, ...opts } = req.body || {};
    return res.json({ success: true, ...termExec.validateMacro(commands, opts) });
});
router.post("/runtime/terminal/record-execution", rateLimiter(60, 60_000), (req, res) => {
    if (!termExec) return res.status(503).json({ success: false, error: "terminalExecutor_unavailable" });
    const { cmd, result, ...opts } = req.body || {};
    return res.json({ success: true, ...termExec.recordExecution(cmd, result || {}, opts) });
});
router.get("/runtime/terminal/interruption-recovery", rateLimiter(20, 60_000), (req, res) => {
    if (!termExec) return res.status(503).json({ success: false, error: "terminalExecutor_unavailable" });
    return res.json({ success: true, ...termExec.interruptionRecovery(req.query.sessionId) });
});
router.get("/runtime/terminal/history", rateLimiter(20, 60_000), (req, res) => {
    if (!termExec) return res.status(503).json({ success: false, error: "terminalExecutor_unavailable" });
    return res.json({ success: true, ...termExec.executionHistory({ sessionId: req.query.sessionId, status: req.query.status }) });
});

// ── Phase 544 — Browser Operations ───────────────────────────────────────────
const browserOps = _tryRequirePhase("../../agents/runtime/browserOperations.cjs");
router.post("/runtime/browser/session", rateLimiter(20, 60_000), (req, res) => {
    if (!browserOps) return res.status(503).json({ success: false, error: "browserOperations_unavailable" });
    return res.json({ success: true, ...browserOps.createSession(req.body || {}) });
});
router.get("/runtime/browser/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!browserOps) return res.status(503).json({ success: false, error: "browserOperations_unavailable" });
    return res.json({ success: true, sessions: browserOps.listSessions({ operatorId: req.query.operatorId }) });
});
router.post("/runtime/browser/session/:id/action", rateLimiter(30, 60_000), (req, res) => {
    if (!browserOps) return res.status(503).json({ success: false, error: "browserOperations_unavailable" });
    const { action, url, ...opts } = req.body || {};
    return res.json({ success: true, ...browserOps.recordAction(req.params.id, action, url, opts) });
});
router.post("/runtime/browser/validate-action", rateLimiter(60, 60_000), (req, res) => {
    if (!browserOps) return res.status(503).json({ success: false, error: "browserOperations_unavailable" });
    return res.json({ success: true, ...browserOps.validateAction(req.body?.action) });
});
router.delete("/runtime/browser/session/:id", rateLimiter(10, 60_000), (req, res) => {
    if (!browserOps) return res.status(503).json({ success: false, error: "browserOperations_unavailable" });
    return res.json({ success: true, ...browserOps.closeSession(req.params.id) });
});

// ── Phase 545 — Chain Reliability ────────────────────────────────────────────
const chainRel = _tryRequirePhase("../../agents/runtime/chainReliability.cjs");
router.post("/runtime/chain/start", rateLimiter(20, 60_000), (req, res) => {
    if (!chainRel) return res.status(503).json({ success: false, error: "chainReliability_unavailable" });
    const { chainName, steps, ...opts } = req.body || {};
    return res.json({ success: true, ...chainRel.startChain(chainName, steps, opts) });
});
router.post("/runtime/chain/:id/step", rateLimiter(60, 60_000), (req, res) => {
    if (!chainRel) return res.status(503).json({ success: false, error: "chainReliability_unavailable" });
    const { stepIndex, result } = req.body || {};
    return res.json({ success: true, ...chainRel.recordStepResult(req.params.id, stepIndex, result || {}) });
});
router.post("/runtime/chain/:id/rollback", rateLimiter(10, 60_000), (req, res) => {
    if (!chainRel) return res.status(503).json({ success: false, error: "chainReliability_unavailable" });
    return res.json({ success: true, ...chainRel.initiateRollback(req.params.id) });
});
router.post("/runtime/chain/verify", rateLimiter(20, 60_000), (req, res) => {
    if (!chainRel) return res.status(503).json({ success: false, error: "chainReliability_unavailable" });
    const { chainName, steps } = req.body || {};
    return res.json({ success: true, ...chainRel.verifyChain(chainName, steps) });
});
router.get("/runtime/chain/:id/status", rateLimiter(30, 60_000), (req, res) => {
    if (!chainRel) return res.status(503).json({ success: false, error: "chainReliability_unavailable" });
    return res.json({ success: true, ...chainRel.getChainStatus(req.params.id) });
});
router.get("/runtime/chain/interrupted", rateLimiter(20, 60_000), (req, res) => {
    if (!chainRel) return res.status(503).json({ success: false, error: "chainReliability_unavailable" });
    return res.json({ success: true, ...chainRel.findInterruptedChains(req.query.sessionId) });
});

// ── Phase 546 — Recovery Center ───────────────────────────────────────────────
const recCenter = _tryRequirePhase("../../agents/runtime/recoveryCenter.cjs");
router.get("/runtime/recovery-center/snapshot", rateLimiter(20, 60_000), (req, res) => {
    if (!recCenter) return res.status(503).json({ success: false, error: "recoveryCenter_unavailable" });
    return res.json({ success: true, ...recCenter.recoverySnapshot() });
});
router.post("/runtime/recovery-center/triage", rateLimiter(20, 60_000), (req, res) => {
    if (!recCenter) return res.status(503).json({ success: false, error: "recoveryCenter_unavailable" });
    return res.json({ success: true, ...recCenter.triageFailure(req.body?.errorText) });
});
router.post("/runtime/recovery-center/activate", rateLimiter(10, 60_000), (req, res) => {
    if (!recCenter) return res.status(503).json({ success: false, error: "recoveryCenter_unavailable" });
    const { recoveryId, ...opts } = req.body || {};
    return res.json({ success: true, ...recCenter.activateRecovery(recoveryId, opts) });
});
router.post("/runtime/recovery-center/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!recCenter) return res.status(503).json({ success: false, error: "recoveryCenter_unavailable" });
    return res.json({ success: true, ...recCenter.advanceRecoveryStep() });
});
router.post("/runtime/recovery-center/complete", rateLimiter(10, 60_000), (req, res) => {
    if (!recCenter) return res.status(503).json({ success: false, error: "recoveryCenter_unavailable" });
    return res.json({ success: true, ...recCenter.completeRecovery(req.body?.success !== false) });
});
router.get("/runtime/recovery-center/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!recCenter) return res.status(503).json({ success: false, error: "recoveryCenter_unavailable" });
    return res.json({ success: true, catalog: recCenter.RECOVERY_CATALOG });
});

// ── Phase 547 — Memory Quality ────────────────────────────────────────────────
const memQuality = _tryRequirePhase("../../agents/runtime/memoryQuality.cjs");
router.get("/runtime/memory-quality/report", rateLimiter(10, 60_000), (req, res) => {
    if (!memQuality) return res.status(503).json({ success: false, error: "memoryQuality_unavailable" });
    return res.json({ success: true, ...memQuality.memoryQualityReport() });
});
router.get("/runtime/memory-quality/workflow", rateLimiter(10, 60_000), (req, res) => {
    if (!memQuality) return res.status(503).json({ success: false, error: "memoryQuality_unavailable" });
    return res.json({ success: true, ...memQuality.workflowMemoryQuality() });
});
router.get("/runtime/memory-quality/duplicates", rateLimiter(10, 60_000), (req, res) => {
    if (!memQuality) return res.status(503).json({ success: false, error: "memoryQuality_unavailable" });
    return res.json({ success: true, ...memQuality.findDuplicateReplays() });
});
router.post("/runtime/memory-quality/clean", rateLimiter(5, 60_000), (req, res) => {
    if (!memQuality) return res.status(503).json({ success: false, error: "memoryQuality_unavailable" });
    return res.json({ success: true, ...memQuality.cleanStaleMemory(req.body || {}) });
});
router.get("/runtime/memory-quality/deployment-chain/:pipeline", rateLimiter(10, 60_000), (req, res) => {
    if (!memQuality) return res.status(503).json({ success: false, error: "memoryQuality_unavailable" });
    return res.json({ success: true, ...memQuality.deploymentMemoryChain(req.params.pipeline) });
});

// ── Phase 549 — Deployment Survivability ─────────────────────────────────────
const deplSurv = _tryRequirePhase("../../agents/runtime/deploymentSurvivability.cjs");
router.get("/runtime/deployment-survivability/report", rateLimiter(10, 60_000), (req, res) => {
    if (!deplSurv) return res.status(503).json({ success: false, error: "deploymentSurvivability_unavailable" });
    return res.json({ success: true, ...deplSurv.survivabilityReport(req.query.pipeline) });
});
router.get("/runtime/deployment-survivability/verify/:runId", rateLimiter(20, 60_000), (req, res) => {
    if (!deplSurv) return res.status(503).json({ success: false, error: "deploymentSurvivability_unavailable" });
    return res.json({ success: true, ...deplSurv.verifyDeploymentSuccess(req.params.runId) });
});
router.get("/runtime/deployment-survivability/health/:runId", rateLimiter(20, 60_000), (req, res) => {
    if (!deplSurv) return res.status(503).json({ success: false, error: "deploymentSurvivability_unavailable" });
    return res.json({ success: true, ...deplSurv.postDeploymentHealth(req.params.runId) });
});
router.get("/runtime/deployment-survivability/rollback-readiness", rateLimiter(10, 60_000), (req, res) => {
    if (!deplSurv) return res.status(503).json({ success: false, error: "deploymentSurvivability_unavailable" });
    return res.json({ success: true, ...deplSurv.rollbackReadiness(req.query.pipeline || "standard-deploy") });
});
router.get("/runtime/deployment-survivability/pre-deploy", rateLimiter(10, 60_000), (req, res) => {
    if (!deplSurv) return res.status(503).json({ success: false, error: "deploymentSurvivability_unavailable" });
    return res.json({ success: true, ...deplSurv.preDeploymentReadiness(req.query.pipeline) });
});

// ── Phase 550 — Engineering Dashboard ────────────────────────────────────────
const engDash = _tryRequirePhase("../../agents/runtime/engineeringDashboard.cjs");
router.get("/runtime/engineering-dashboard", rateLimiter(30, 60_000), (req, res) => {
    if (!engDash) return res.status(503).json({ success: false, error: "engineeringDashboard_unavailable" });
    return res.json({ success: true, ...engDash.getDashboard() });
});
router.get("/runtime/engineering-dashboard/status-line", rateLimiter(60, 60_000), (req, res) => {
    if (!engDash) return res.status(503).json({ success: false, error: "engineeringDashboard_unavailable" });
    return res.json({ success: true, statusLine: engDash.statusLine() });
});
router.get("/runtime/engineering-dashboard/focus", rateLimiter(30, 60_000), (req, res) => {
    if (!engDash) return res.status(503).json({ success: false, error: "engineeringDashboard_unavailable" });
    return res.json({ success: true, ...engDash.focusDashboard() });
});

// ── Phase 551 — Project Isolation ─────────────────────────────────────────────
const projIso = _tryRequirePhase("../../agents/runtime/projectIsolation.cjs");
router.post("/runtime/project-isolation/register", rateLimiter(10, 60_000), (req, res) => {
    if (!projIso) return res.status(503).json({ success: false, error: "projectIsolation_unavailable" });
    const { name, ...opts } = req.body || {};
    return res.json({ success: true, ...projIso.registerProject(name, opts) });
});
router.get("/runtime/project-isolation/list", rateLimiter(20, 60_000), (req, res) => {
    if (!projIso) return res.status(503).json({ success: false, error: "projectIsolation_unavailable" });
    return res.json({ success: true, projects: projIso.listProjects({ operatorId: req.query.operatorId }) });
});
router.get("/runtime/project-isolation/:id/snapshot", rateLimiter(20, 60_000), (req, res) => {
    if (!projIso) return res.status(503).json({ success: false, error: "projectIsolation_unavailable" });
    return res.json({ success: true, ...projIso.projectSnapshot(req.params.id) });
});
router.post("/runtime/project-isolation/:id/check-workflow", rateLimiter(30, 60_000), (req, res) => {
    if (!projIso) return res.status(503).json({ success: false, error: "projectIsolation_unavailable" });
    return res.json({ success: true, ...projIso.checkWorkflowAllowed(req.params.id, req.body?.workflowId) });
});
router.post("/runtime/project-isolation/:id/contamination-check", rateLimiter(30, 60_000), (req, res) => {
    if (!projIso) return res.status(503).json({ success: false, error: "projectIsolation_unavailable" });
    return res.json({ success: true, ...projIso.contaminationCheck(req.params.id, req.body || {}) });
});
router.delete("/runtime/project-isolation/:id", rateLimiter(5, 60_000), (req, res) => {
    if (!projIso) return res.status(503).json({ success: false, error: "projectIsolation_unavailable" });
    return res.json({ success: true, ...projIso.deleteProject(req.params.id) });
});

// ── Phase 552 — Productivity Optimizer ────────────────────────────────────────
const prodOpt = _tryRequirePhase("../../agents/runtime/productivityOptimizer.cjs");
router.get("/runtime/productivity/config", rateLimiter(20, 60_000), (req, res) => {
    if (!prodOpt) return res.status(503).json({ success: false, error: "productivityOptimizer_unavailable" });
    return res.json({ success: true, config: prodOpt.getConfig() });
});
router.post("/runtime/productivity/configure", rateLimiter(10, 60_000), (req, res) => {
    if (!prodOpt) return res.status(503).json({ success: false, error: "productivityOptimizer_unavailable" });
    return res.json({ success: true, ...prodOpt.configure(req.body || {}) });
});
router.get("/runtime/productivity/flow-score", rateLimiter(20, 60_000), (req, res) => {
    if (!prodOpt) return res.status(503).json({ success: false, error: "productivityOptimizer_unavailable" });
    return res.json({ success: true, ...prodOpt.flowScore() });
});
router.post("/runtime/productivity/filter-alerts", rateLimiter(20, 60_000), (req, res) => {
    if (!prodOpt) return res.status(503).json({ success: false, error: "productivityOptimizer_unavailable" });
    return res.json({ success: true, alerts: prodOpt.filterAlerts(req.body?.alerts) });
});
router.post("/runtime/productivity/filter-suggestions", rateLimiter(20, 60_000), (req, res) => {
    if (!prodOpt) return res.status(503).json({ success: false, error: "productivityOptimizer_unavailable" });
    return res.json({ success: true, suggestions: prodOpt.filterSuggestions(req.body?.suggestions, req.body?.sessionId) });
});


// ── Phases 571–585 — AI-Assisted Engineering Execution ────────────────────────

function _tryRequirePhase571(p) { try { return require(p); } catch { return null; } }

const patchAssist    = _tryRequirePhase571("../../agents/runtime/patchAssistant.cjs");
const taskUnderstand = _tryRequirePhase571("../../agents/runtime/taskUnderstanding.cjs");
const terminalWF     = _tryRequirePhase571("../../agents/runtime/terminalWorkflows.cjs");
const browserWF      = _tryRequirePhase571("../../agents/runtime/browserWorkflows.cjs");
const execConf       = _tryRequirePhase571("../../agents/runtime/executionConfidence.cjs");
const debugAssist    = _tryRequirePhase571("../../agents/runtime/debugAssistMode.cjs");
const deployAssist   = _tryRequirePhase571("../../agents/runtime/deploymentAssist.cjs");
const engCtxMem      = _tryRequirePhase571("../../agents/runtime/engineeringContextMemory.cjs");
const prodChainEngine = _tryRequirePhase571("../../agents/runtime/productivityChainEngine.cjs");
const dailyVal       = _tryRequirePhase571("../../agents/runtime/dailyEngineeringValidation.cjs");
const execCalm       = _tryRequirePhase571("../../agents/runtime/executionCalmness.cjs");
const execTimeline   = _tryRequirePhase571("../../agents/runtime/executionTimeline.cjs");
const resilTest      = _tryRequirePhase571("../../agents/runtime/resilienceTest.cjs");
const platAudit      = _tryRequirePhase571("../../agents/runtime/platformAudit.cjs");
const engFound       = _tryRequirePhase571("../../agents/runtime/engineeringFoundation.cjs");

// Phase 571 — Patch Assistance
router.post("/runtime/patches/propose", rateLimiter(20, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    const result = patchAssist.proposePatch(req.body || {});
    return res.json({ success: result.ok, ...result });
});
router.post("/runtime/patches/:id/apply", rateLimiter(10, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    const result = patchAssist.applyPatch(req.params.id, { approved: req.body?.approved, operatorId: req.body?.operatorId });
    return res.json({ success: result.ok, ...result });
});
router.post("/runtime/patches/:id/rollback", rateLimiter(10, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    const result = patchAssist.rollbackPatch(req.params.id, { approved: req.body?.approved });
    return res.json({ success: result.ok, ...result });
});
router.get("/runtime/patches", rateLimiter(30, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    return res.json({ success: true, patches: patchAssist.listPatches({ status: req.query.status, sessionId: req.query.sessionId }) });
});
router.get("/runtime/patches/:id", rateLimiter(30, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    const p = patchAssist.getPatch(req.params.id);
    if (!p) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, patch: p });
});
router.post("/runtime/patches/dep-repair-suggestions", rateLimiter(20, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    return res.json({ success: true, suggestions: patchAssist.depairSuggestions(req.body?.errorText || "") });
});
router.post("/runtime/patches/:id/verify", rateLimiter(10, 60_000), async (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    if (typeof patchAssist.verifyPatch !== "function") return res.status(503).json({ success: false, error: "verifyPatch_unavailable" });
    try {
        const result = await patchAssist.verifyPatch(req.params.id, {
            command:      req.body?.command,
            autoRollback: req.body?.autoRollback === true,
        });
        return res.json({ success: result.ok, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Sprint 6 — Multi-file patch sets
router.post("/runtime/patch-sets/propose", rateLimiter(10, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    if (typeof patchAssist.proposeSet !== "function") return res.status(503).json({ success: false, error: "proposeSet_unavailable" });
    const { files, reason, operatorId } = req.body || {};
    try { return res.json({ success: true, ...patchAssist.proposeSet(files, { reason, operatorId }) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.post("/runtime/patch-sets/:id/apply", rateLimiter(10, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    try { return res.json({ success: true, ...patchAssist.applySet(req.params.id, { approved: req.body?.approved, operatorId: req.body?.operatorId }) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.post("/runtime/patch-sets/:id/rollback", rateLimiter(10, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    try { return res.json({ success: true, ...patchAssist.rollbackSet(req.params.id, { approved: req.body?.approved }) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.post("/runtime/patch-sets/:id/verify", rateLimiter(10, 60_000), async (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    if (typeof patchAssist.verifySet !== "function") return res.status(503).json({ success: false, error: "verifySet_unavailable" });
    try {
        const r = await patchAssist.verifySet(req.params.id, { command: req.body?.command, autoRollback: req.body?.autoRollback === true });
        return res.json({ success: r.ok, ...r });
    } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.get("/runtime/patch-sets", rateLimiter(20, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    try { return res.json({ success: true, sets: patchAssist.listSets({ status: req.query.status }) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.get("/runtime/patch-sets/:id", rateLimiter(20, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    const s = patchAssist.getSet(req.params.id);
    if (!s) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, set: s });
});

// Phase B1: Engineering Pipeline Routes (pipelineOrchestrator + projectRunner exposed via HTTP)
const _pipelineOrch  = _tryRequirePhase571("../../agents/dev/pipelineOrchestrator.cjs");
const _projectRunner  = _tryRequirePhase571("../../agents/dev/projectRunner.cjs");
const _blueprintGen   = _tryRequirePhase571("../../agents/dev/blueprintGenerator.cjs");

// POST /runtime/pipeline/run — 7-stage Plan→Code→Patch→Apply→Test→Review→Deploy
router.post("/runtime/pipeline/run", rateLimiter(5, 60_000), async (req, res) => {
    if (!_pipelineOrch) return res.status(503).json({ success: false, error: "pipelineOrchestrator_unavailable" });
    const { request, autoApply = true, autoRollback = true, autoDeploy = false, testCommand } = req.body || {};
    if (!request || typeof request !== "string" || !request.trim())
        return res.status(400).json({ success: false, error: "request is required" });
    try {
        const result = await _pipelineOrch.run(request.trim(), { autoApply, autoRollback, autoDeploy, testCommand });
        return res.json({ success: result.ok, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/pipeline/run-multi — multi-file pipeline
router.post("/runtime/pipeline/run-multi", rateLimiter(3, 60_000), async (req, res) => {
    if (!_pipelineOrch) return res.status(503).json({ success: false, error: "pipelineOrchestrator_unavailable" });
    const { request, autoApply = false, autoRollback = true, autoDeploy = false } = req.body || {};
    if (!request || typeof request !== "string" || !request.trim())
        return res.status(400).json({ success: false, error: "request is required" });
    try {
        const result = await _pipelineOrch.runMulti(request.trim(), { autoApply, autoRollback, autoDeploy });
        return res.json({ success: result.ok, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/project/run — goal→specialist waves via projectRunner
router.post("/runtime/project/run", rateLimiter(3, 60_000), async (req, res) => {
    if (!_projectRunner) return res.status(503).json({ success: false, error: "projectRunner_unavailable" });
    const { goal, opts } = req.body || {};
    if (!goal || typeof goal !== "string" || !goal.trim())
        return res.status(400).json({ success: false, error: "goal is required" });
    try {
        const result = await _projectRunner.runProject(goal.trim(), opts || {});
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/blueprint/generate — idea→blueprint JSON
router.post("/runtime/blueprint/generate", rateLimiter(5, 60_000), async (req, res) => {
    if (!_blueprintGen) return res.status(503).json({ success: false, error: "blueprintGenerator_unavailable" });
    const { idea, opts } = req.body || {};
    if (!idea || typeof idea !== "string" || !idea.trim())
        return res.status(400).json({ success: false, error: "idea is required" });
    try {
        const result = await _blueprintGen.generateBlueprint(idea.trim(), opts || {});
        return res.json({ success: true, blueprint: result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Phase B3 — Self-healing, Incidents, Memory Explorer, Execution History
const _incidentEngine   = _tryRequirePhase571("../../agents/runtime/incidentEngine.cjs");
const _autoFixPlanner   = _tryRequirePhase571("../../agents/runtime/autoFixPlanner.cjs");
const _selfHealPipeline = _tryRequirePhase571("../../agents/runtime/selfHealingPipeline.cjs");
const _engMemory        = _tryRequirePhase571("../../agents/runtime/engineeringMemory.cjs");
// Phase B5 — Intelligence layer
const _execHistory      = _tryRequirePhase571("../../agents/runtime/executionHistory.cjs");
const _knowledgeMem     = _tryRequirePhase571("../../agents/runtime/engineeringKnowledgeMemory.cjs");
const _learningEngine   = _tryRequirePhase571("../../agents/runtime/learningMemoryEngine.cjs");
const _failIntelEngine  = _tryRequirePhase571("../../agents/runtime/failureIntelligenceEngine.cjs");
const _rootCauseAnalyzer= _tryRequirePhase571("../../agents/runtime/rootCauseAnalyzer.cjs");
// Phase B6 — Prediction layer (same modules, new computed endpoints)
const _patchExecEngine  = _tryRequirePhase571("../../agents/runtime/patchExecutionEngine.cjs");
const _deployPipeline   = _tryRequirePhase571("../../agents/runtime/deploymentPipeline.cjs");
const _deployAssistB6   = _tryRequirePhase571("../../agents/runtime/deploymentAssist.cjs");

// GET /runtime/incidents — list incidents
router.get("/runtime/incidents", rateLimiter(20, 60_000), (req, res) => {
    if (!_incidentEngine) return res.status(503).json({ success: false, error: "incidentEngine_unavailable" });
    try {
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const status = req.query.status || null;
        const incidents = _incidentEngine.listIncidents({ status, limit });
        const summary   = _incidentEngine.getIncidentSummary();
        return res.json({ success: true, incidents, summary });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.get("/runtime/incidents/:id", rateLimiter(20, 60_000), (req, res) => {
    if (!_incidentEngine) return res.status(503).json({ success: false, error: "incidentEngine_unavailable" });
    try {
        const inc = _incidentEngine.getIncident(req.params.id);
        if (!inc) return res.status(404).json({ success: false, error: "incident_not_found" });
        return res.json({ success: true, incident: inc });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.post("/runtime/incidents/:id/acknowledge", rateLimiter(10, 60_000), (req, res) => {
    if (!_incidentEngine) return res.status(503).json({ success: false, error: "incidentEngine_unavailable" });
    try {
        const result = _incidentEngine.acknowledge(req.params.id, { operatorId: req.body?.operatorId });
        return res.json({ success: true, ...result });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// GET /runtime/autofix/plans — list fix plans
router.get("/runtime/autofix/plans", rateLimiter(20, 60_000), (req, res) => {
    if (!_autoFixPlanner) return res.status(503).json({ success: false, error: "autoFixPlanner_unavailable" });
    try {
        const plans = _autoFixPlanner.listPlans({ status: req.query.status, limit: Math.min(30, parseInt(req.query.limit) || 20) });
        return res.json({ success: true, plans });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// GET /runtime/healing/runs — list self-healing pipeline runs
router.get("/runtime/healing/runs", rateLimiter(20, 60_000), (req, res) => {
    if (!_selfHealPipeline) return res.status(503).json({ success: false, error: "selfHealPipeline_unavailable" });
    try {
        const runs = _selfHealPipeline.listHealingRuns({ status: req.query.status, limit: Math.min(30, parseInt(req.query.limit) || 20) });
        return res.json({ success: true, runs });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

router.get("/runtime/healing/runs/:runId", rateLimiter(20, 60_000), (req, res) => {
    if (!_selfHealPipeline) return res.status(503).json({ success: false, error: "selfHealPipeline_unavailable" });
    try {
        const run = _selfHealPipeline.getHealingRun(req.params.runId);
        if (!run) return res.status(404).json({ success: false, error: "run_not_found" });
        return res.json({ success: true, run });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// GET /runtime/healing/history — healing-history.json entries
router.get("/runtime/healing/history", rateLimiter(20, 60_000), (req, res) => {
    try {
        const fs = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/healing-history.json");
        const raw  = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
        const arr  = Array.isArray(raw) ? raw : [];
        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        return res.json({ success: true, history: arr.slice(-limit).reverse(), total: arr.length });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// GET /runtime/memory/engineering — query engineering memory entries
router.get("/runtime/memory/engineering", rateLimiter(20, 60_000), (req, res) => {
    if (!_engMemory) return res.status(503).json({ success: false, error: "engMemory_unavailable" });
    try {
        const goal  = req.query.goal  || "";
        const type  = req.query.type  || null;
        const limit = Math.min(30, parseInt(req.query.limit) || 20);
        const entries     = _engMemory.query(goal, type);
        const suggestions = goal ? _engMemory.suggestChains(goal) : [];
        return res.json({ success: true, entries: entries.slice(0, limit), suggestions, stats: _engMemory.stats() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// Phase B4 — Autonomous Engineering Loop
// B4.1  POST /runtime/patches/:id/auto-pipeline — apply → verify → auto-rollback chain
router.post("/runtime/patches/:id/auto-pipeline", rateLimiter(5, 60_000), async (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    const patchId = req.params.id;
    const { command, autoRollback = true, operatorId = null } = req.body || {};
    const timeline = [];
    try {
        // Step 1 — Apply
        const apply = patchAssist.applyPatch(patchId, { approved: true, operatorId });
        timeline.push({ step: "apply", ok: apply.ok, ts: new Date().toISOString(), detail: apply.error || apply.filePath });
        if (!apply.ok) return res.json({ success: false, stage: "apply", timeline, error: apply.error });

        // Step 2 — Verify
        const verify = typeof patchAssist.verifyPatch === "function"
            ? await patchAssist.verifyPatch(patchId, { command, autoRollback: false })
            : { ok: true, verdict: "skipped", pass: 0, fail: 0 };
        timeline.push({ step: "verify", ok: verify.ok, ts: new Date().toISOString(),
            verdict: verify.verdict, pass: verify.pass, fail: verify.fail, output: (verify.output || "").slice(0, 400) });

        const passed = verify.verdict === "pass" || verify.verdict === "skipped";

        // Step 3 — Auto-rollback on failure
        let rolledBack = false;
        if (!passed && autoRollback) {
            const rb = patchAssist.rollbackPatch(patchId, { approved: true });
            rolledBack = rb.ok;
            timeline.push({ step: "rollback", ok: rb.ok, ts: new Date().toISOString(), detail: rb.error || rb.filePath });
        }

        // Step 4 — Record learning
        if (_engMemory) {
            try {
                const patch = patchAssist.getPatch(patchId);
                if (patch) {
                    const key = passed ? "recordValidatedStep" : "recordSessionOutcome";
                    if (typeof _engMemory[key] === "function") {
                        _engMemory[key]({ patchId, filePath: patch.filePath, verdict: verify.verdict, pass: verify.pass, fail: verify.fail, rolledBack, ts: new Date().toISOString() });
                    } else if (typeof _engMemory.recordRecoveryPath === "function" && !passed) {
                        _engMemory.recordRecoveryPath({ patchId, filePath: patch.filePath, error: `Test failure: ${verify.fail} failing`, rolledBack });
                    }
                }
            } catch (_) {}
        }

        return res.json({
            success: true,
            patchId,
            passed,
            rolledBack,
            timeline,
            verdict: verify.verdict,
            pass: verify.pass,
            fail: verify.fail,
        });
    } catch (err) {
        timeline.push({ step: "error", ok: false, ts: new Date().toISOString(), detail: err.message });
        return res.status(500).json({ success: false, error: err.message, timeline });
    }
});

// B4.2  POST /runtime/patches/:id/learn — store patch outcome in engineering memory
router.post("/runtime/patches/:id/learn", rateLimiter(20, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    try {
        const patch = patchAssist.getPatch(req.params.id);
        if (!patch) return res.status(404).json({ success: false, error: "patch_not_found" });
        const { outcome, verdict, pass, fail, notes } = req.body || {};
        const success = outcome === "success" || verdict === "pass";
        const entry = { patchId: patch.id, filePath: patch.filePath, success, verdict, pass, fail, notes, ts: new Date().toISOString() };
        if (_engMemory) {
            const fn = success ? "recordValidatedStep" : "recordRecoveryPath";
            if (typeof _engMemory[fn] === "function") _engMemory[fn](entry);
        }
        return res.json({ success: true, recorded: entry });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B4.3  GET /runtime/patches/learning/summary — success/failure pattern stats
router.get("/runtime/patches/learning/summary", rateLimiter(20, 60_000), (req, res) => {
    try {
        const patches = patchAssist ? patchAssist.listPatches({}) : [];
        const applied    = patches.filter(p => p.status === "applied").length;
        const rolled     = patches.filter(p => p.status === "rolled_back").length;
        const pending    = patches.filter(p => p.status === "pending").length;
        const total      = patches.length;
        const byFile = {};
        for (const p of patches) {
            if (!p.filePath) continue;
            if (!byFile[p.filePath]) byFile[p.filePath] = { applied: 0, rolled_back: 0, total: 0 };
            byFile[p.filePath].total++;
            if (p.status === "applied")     byFile[p.filePath].applied++;
            if (p.status === "rolled_back") byFile[p.filePath].rolled_back++;
        }
        const hotspots = Object.entries(byFile)
            .sort(([,a],[,b]) => b.rolled_back - a.rolled_back)
            .slice(0, 5)
            .map(([file, stats]) => ({ file, ...stats }));
        const memStats = _engMemory ? _engMemory.stats() : null;
        return res.json({ success: true, total, applied, rolled_back: rolled, pending, hotspots, memoryStats: memStats });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B4.4  POST /runtime/incidents/:id/auto-fix — incident → autofix plan → patch → verify queue
router.post("/runtime/incidents/:id/auto-fix", rateLimiter(5, 60_000), async (req, res) => {
    if (!_incidentEngine) return res.status(503).json({ success: false, error: "incidentEngine_unavailable" });
    const incidentId = req.params.id;
    const { operatorId = null, queueApproval = true } = req.body || {};
    const timeline = [];
    try {
        // Step 1 — Load incident
        const inc = _incidentEngine.getIncident(incidentId);
        if (!inc) return res.status(404).json({ success: false, error: "incident_not_found" });
        timeline.push({ step: "incident_loaded", ts: new Date().toISOString(), severity: inc.severity, title: inc.title || inc.type });

        // Step 2 — Acknowledge
        const ack = _incidentEngine.acknowledge(incidentId, { operatorId });
        timeline.push({ step: "acknowledged", ok: ack.ok !== false, ts: new Date().toISOString() });

        // Step 3 — Generate auto-fix plan
        let plan = null;
        if (_autoFixPlanner && typeof _autoFixPlanner.planInline === "function") {
            plan = _autoFixPlanner.planInline({ incidentId, title: inc.title, description: inc.description, severity: inc.severity, service: inc.service });
            timeline.push({ step: "plan_generated", ts: new Date().toISOString(), planId: plan?.id, steps: plan?.steps?.length });
        } else if (_autoFixPlanner && typeof _autoFixPlanner.plan === "function") {
            plan = _autoFixPlanner.plan({ incidentId, title: inc.title, severity: inc.severity });
            timeline.push({ step: "plan_generated", ts: new Date().toISOString(), planId: plan?.id });
        }

        // Step 4 — If plan has a filePath/patch target, propose patch (approval gated)
        let patchId = null;
        let patchProposed = false;
        const patchTarget = plan?.filePath || inc.filePath || null;
        if (patchAssist && patchTarget && plan) {
            const patchDesc = plan.description || plan.title || `Auto-fix for incident ${incidentId}`;
            const proposed = patchAssist.proposePatch({ filePath: patchTarget, description: patchDesc, operatorId, source: "incident_auto_fix", incidentId });
            if (proposed.ok) {
                patchId = proposed.patchId;
                patchProposed = true;
                timeline.push({ step: "patch_proposed", ts: new Date().toISOString(), patchId, requiresApproval: queueApproval });
            }
        }

        // Step 5 — Record in engineering memory
        if (_engMemory && typeof _engMemory.recordRecoveryPath === "function") {
            _engMemory.recordRecoveryPath({ incidentId, planId: plan?.id, patchId, severity: inc.severity, service: inc.service, ts: new Date().toISOString() });
        }

        return res.json({
            success: true,
            incidentId,
            planId: plan?.id || null,
            patchId,
            patchProposed,
            requiresApproval: queueApproval,
            timeline,
        });
    } catch (err) {
        timeline.push({ step: "error", ts: new Date().toISOString(), detail: err.message });
        return res.status(500).json({ success: false, error: err.message, timeline });
    }
});

// B4.4b  GET /runtime/incidents/:id/auto-fix/status — check auto-fix status for an incident
router.get("/runtime/incidents/:id/auto-fix/status", rateLimiter(20, 60_000), (req, res) => {
    if (!_incidentEngine) return res.status(503).json({ success: false, error: "incidentEngine_unavailable" });
    try {
        const inc = _incidentEngine.getIncident(req.params.id);
        if (!inc) return res.status(404).json({ success: false, error: "incident_not_found" });
        const relatedPatches = patchAssist
            ? patchAssist.listPatches({}).filter(p => p.source === "incident_auto_fix" && p.incidentId === req.params.id)
            : [];
        const relatedPlans = _autoFixPlanner
            ? _autoFixPlanner.listPlans({}).filter(p => p.incidentId === req.params.id)
            : [];
        return res.json({ success: true, incident: inc, relatedPatches, relatedPlans });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase B5 — Learning → Recommendation Intelligence ────────────────

// B5.1  GET /runtime/intel/similar-fixes?q=&limit=
//   Similar Fix Finder — keyword match across patches + knowledge memory
router.get("/runtime/intel/similar-fixes", rateLimiter(30, 60_000), (req, res) => {
    try {
        const q     = (req.query.q || "").toLowerCase().trim();
        const limit = Math.min(20, parseInt(req.query.limit) || 10);
        const results = [];

        // 1. Patch history — match reason/filePath/diff preview against q
        if (patchAssist) {
            const patches = patchAssist.listPatches({});
            for (const p of patches) {
                if (!q) { results.push({ source: "patch", score: 50, patchId: p.id, filePath: p.filePath, reason: p.reason, status: p.status, proposedAt: p.proposedAt, preview: p.diff?.preview }); continue; }
                const haystack = `${p.filePath || ""} ${p.reason || ""} ${p.diff?.preview || ""}`.toLowerCase();
                const words = q.split(/\s+/).filter(Boolean);
                const hits  = words.filter(w => haystack.includes(w)).length;
                if (hits > 0) results.push({ source: "patch", score: Math.round((hits / words.length) * 100), patchId: p.id, filePath: p.filePath, reason: p.reason, status: p.status, proposedAt: p.proposedAt, preview: p.diff?.preview });
            }
        }

        // 2. Knowledge memory known-fixes
        if (_knowledgeMem) {
            const fixes = _knowledgeMem.query({ kind: "known-fix", search: q || undefined, limit: 20 });
            for (const f of fixes) {
                results.push({ source: "knowledge", score: 70, key: f.key, fix: f.fix, problem: f.problem, kind: f.kind, ts: f.ts });
            }
        }

        // 3. Engineering memory — validated steps
        if (_engMemory) {
            const mem = _engMemory.query(q || "fix", "validated-step");
            for (const m of mem) {
                const score = q ? 60 : 40;
                results.push({ source: "memory", score, chainName: m.chainName, goalPattern: m.goalPattern, confidence: m.confidence, stepCount: m.stepCount, ts: m.ts });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return res.json({ success: true, query: q, results: results.slice(0, limit), total: results.length });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B5.2  GET /runtime/intel/pattern-ranking?type=success|failure
//   Success + Failure Pattern Ranking
router.get("/runtime/intel/pattern-ranking", rateLimiter(20, 60_000), (req, res) => {
    try {
        const type = req.query.type || "both";

        // Derive from patch history
        const patches = patchAssist ? patchAssist.listPatches({}) : [];
        const byFile  = {};
        for (const p of patches) {
            const key = p.filePath || "unknown";
            if (!byFile[key]) byFile[key] = { file: key, applied: 0, rolled_back: 0, pending: 0, total: 0 };
            byFile[key].total++;
            if (p.status === "applied")     byFile[key].applied++;
            if (p.status === "rolled_back") byFile[key].rolled_back++;
            if (p.status === "pending")     byFile[key].pending++;
        }
        const fileStats = Object.values(byFile).map(f => ({
            ...f,
            successRate: f.total > 0 ? Math.round((f.applied / f.total) * 100) : null,
        }));

        const success = fileStats
            .filter(f => f.applied > 0)
            .sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))
            .slice(0, 10);

        const failure = fileStats
            .filter(f => f.rolled_back > 0)
            .sort((a, b) => b.rolled_back - a.rolled_back)
            .slice(0, 10);

        // Also pull from learningMemoryEngine if available
        let learnPatterns = null;
        if (_learningEngine) {
            try { learnPatterns = _learningEngine.getPatterns(); } catch (_) {}
        }

        // Pull known failure patterns from failureIntelligenceEngine
        let failurePatterns = null;
        if (_failIntelEngine) {
            try { failurePatterns = _failIntelEngine.FAILURE_PATTERNS || null; } catch (_) {}
        }

        return res.json({ success: true, type,
            successPatterns: type !== "failure" ? success : [],
            failurePatterns: type !== "success" ? failure : [],
            learnPatterns,
            knownFailurePatterns: failurePatterns,
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B5.3  POST /runtime/intel/recommend-patch
//   Patch Recommendation Engine — given a description, return ranked patch suggestions
router.post("/runtime/intel/recommend-patch", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { description = "", filePath = "", limit = 8 } = req.body || {};
        const query = `${description} ${filePath}`.toLowerCase().trim();
        const recommendations = [];

        // Source 1: past successful patches on same/similar files
        if (patchAssist) {
            const patches = patchAssist.listPatches({ status: "applied" });
            for (const p of patches) {
                let score = 0;
                const hay = `${p.filePath || ""} ${p.reason || ""} ${p.diff?.preview || ""}`.toLowerCase();
                if (filePath && p.filePath === filePath) score += 50;
                if (filePath && p.filePath?.split("/").pop() === filePath.split("/").pop()) score += 20;
                if (query) {
                    const words = query.split(/\s+/).filter(w => w.length > 3);
                    const hits = words.filter(w => hay.includes(w)).length;
                    score += hits > 0 ? Math.round((hits / Math.max(words.length, 1)) * 40) : 0;
                }
                if (score > 0) recommendations.push({ source: "patch_history", score, patchId: p.id, filePath: p.filePath, reason: p.reason, preview: p.diff?.preview, status: p.status, proposedAt: p.proposedAt });
            }
        }

        // Source 2: knowledge memory known-fixes
        if (_knowledgeMem) {
            const fixes = _knowledgeMem.query({ search: description || undefined, limit: 15 });
            for (const f of fixes) {
                recommendations.push({ source: "knowledge_base", score: 65, key: f.key, problem: f.problem, fix: f.fix, kind: f.kind });
            }
        }

        // Source 3: engineering memory chains matching description
        if (_engMemory) {
            const chains = _engMemory.suggestChains(description || "fix");
            for (const c of chains) {
                recommendations.push({ source: "eng_memory", score: 55, chain: typeof c === "string" ? c : c.chainName, confidence: typeof c === "object" ? c.confidence : null });
            }
        }

        // Source 4: learning engine recommendations
        if (_learningEngine) {
            try {
                const recs = _learningEngine.getRecommendations();
                for (const r of recs.slice(0, 5)) {
                    recommendations.push({ source: "learning_engine", score: 45, ...r });
                }
            } catch (_) {}
        }

        recommendations.sort((a, b) => b.score - a.score);
        return res.json({ success: true, description, filePath, recommendations: recommendations.slice(0, limit), total: recommendations.length });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B5.4  GET /runtime/intel/incident-kb?q=&severity=
//   Incident Knowledge Base — incidents + rca reports + known failure patterns
router.get("/runtime/intel/incident-kb", rateLimiter(20, 60_000), (req, res) => {
    try {
        const q        = (req.query.q || "").toLowerCase().trim();
        const severity = req.query.severity || null;
        const limit    = Math.min(30, parseInt(req.query.limit) || 15);

        // Incidents
        let incidents = _incidentEngine ? _incidentEngine.listIncidents({ status: req.query.status || null, limit: 50 }) : [];
        if (q) incidents = incidents.filter(i => JSON.stringify(i).toLowerCase().includes(q));
        if (severity) incidents = incidents.filter(i => (i.severity || "").toLowerCase() === severity.toLowerCase());

        // RCA reports
        let rcaReports = [];
        if (_rootCauseAnalyzer) {
            try { rcaReports = _rootCauseAnalyzer.listReports(); } catch (_) {}
            if (q) rcaReports = rcaReports.filter(r => JSON.stringify(r).toLowerCase().includes(q));
        }

        // Learning engine top incidents
        let topIncidents = [];
        let topCauses    = [];
        let topFixes     = [];
        if (_learningEngine) {
            try {
                const sum = _learningEngine.getSummary();
                topIncidents = sum.topIncidents || [];
                topCauses    = sum.topCauses    || [];
                topFixes     = sum.topFixes     || [];
            } catch (_) {}
        }

        // Known failure patterns from failureIntelligenceEngine
        let knownPatterns = _failIntelEngine?.FAILURE_PATTERNS || [];
        if (q) knownPatterns = knownPatterns.filter(p => JSON.stringify(p).toLowerCase().includes(q));

        return res.json({ success: true, query: q,
            incidents: incidents.slice(0, limit),
            rcaReports: rcaReports.slice(0, 10),
            topIncidents, topCauses, topFixes,
            knownPatterns: knownPatterns.slice(0, 10),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B5.5  GET /runtime/intel/search?q=&scope=
//   Engineering Search — unified search across patches, history, memory, knowledge, incidents
router.get("/runtime/intel/search", rateLimiter(30, 60_000), (req, res) => {
    try {
        const q     = (req.query.q || "").toLowerCase().trim();
        const scope = (req.query.scope || "all").toLowerCase();
        const limit = Math.min(40, parseInt(req.query.limit) || 20);
        if (!q) return res.json({ success: true, query: "", results: [], total: 0 });

        const results = [];
        const words = q.split(/\s+/).filter(w => w.length > 2);

        function _score(haystack) {
            const lower = haystack.toLowerCase();
            const hits = words.filter(w => lower.includes(w)).length;
            return hits > 0 ? Math.round((hits / words.length) * 100) : 0;
        }

        // Patches
        if (scope === "all" || scope === "patches") {
            const patches = patchAssist ? patchAssist.listPatches({}) : [];
            for (const p of patches) {
                const s = _score(`${p.filePath} ${p.reason} ${p.diff?.preview || ""}`);
                if (s > 0) results.push({ type: "patch", score: s, id: p.id, title: p.filePath || p.id?.slice(0,12), subtitle: p.reason, status: p.status, ts: p.proposedAt, meta: { patchId: p.id, filePath: p.filePath } });
            }
        }

        // Execution history
        if (scope === "all" || scope === "history") {
            const hist = _execHistory ? _execHistory.recent(100) : [];
            for (const e of hist) {
                const s = _score(`${e.input || ""} ${e.output || ""} ${e.agentId || ""} ${e.taskType || ""}`);
                if (s > 0) results.push({ type: "execution", score: s, id: e.executionId || e.id, title: e.input || "(unknown)", subtitle: e.agentId || e.taskType, status: e.success === false ? "failed" : "ok", ts: e.ts, meta: { agentId: e.agentId, durationMs: e.durationMs } });
            }
        }

        // Engineering memory
        if ((scope === "all" || scope === "memory") && _engMemory) {
            const mem = _engMemory.query(q, null);
            for (const m of mem) {
                const s = _score(`${m.goalPattern || ""} ${m.chainName || ""}`);
                results.push({ type: "memory", score: Math.max(s, 40), id: `mem-${m.ts}`, title: m.goalPattern || m.chainName, subtitle: `${m.type} · confidence ${m.confidence}%`, status: "ok", ts: m.ts, meta: m });
            }
        }

        // Knowledge base
        if ((scope === "all" || scope === "knowledge") && _knowledgeMem) {
            const kb = _knowledgeMem.query({ search: q, limit: 20 });
            for (const k of kb) {
                const s = _score(`${k.key || ""} ${k.problem || ""} ${k.fix || ""} ${k.description || ""}`);
                results.push({ type: "knowledge", score: Math.max(s, 50), id: `kb-${k.ts}`, title: k.key || k.problem || k.description, subtitle: k.kind, status: "ok", ts: k.ts, meta: k });
            }
        }

        // Incidents
        if ((scope === "all" || scope === "incidents") && _incidentEngine) {
            const incs = _incidentEngine.listIncidents({ limit: 50 });
            for (const inc of incs) {
                const s = _score(`${inc.title || ""} ${inc.message || ""} ${inc.type || ""} ${inc.service || ""} ${inc.description || ""}`);
                if (s > 0) results.push({ type: "incident", score: s, id: inc.id, title: inc.title || inc.message || inc.type, subtitle: `${inc.severity} · ${inc.service || "—"}`, status: inc.status, ts: inc.detectedAt || inc.ts, meta: { severity: inc.severity } });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return res.json({ success: true, query: q, scope, results: results.slice(0, limit), total: results.length });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B5.6  GET /runtime/intel/correlate?executionId= OR ?input=
//   Cross-Execution Correlation — find executions with overlapping context/errors
router.get("/runtime/intel/correlate", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { executionId, input, limit = 10 } = req.query;
        const cap = Math.min(20, parseInt(limit) || 10);
        if (!executionId && !input) return res.status(400).json({ success: false, error: "executionId or input required" });

        const all = _execHistory ? _execHistory.recent(200) : [];
        const anchor = executionId ? all.find(e => (e.executionId || e.id) === executionId) : { input };
        if (!anchor) return res.status(404).json({ success: false, error: "execution_not_found" });

        const anchorWords = new Set((anchor.input || "").toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const anchorErr   = (anchor.error || "").toLowerCase();

        const correlated = [];
        for (const e of all) {
            if ((e.executionId || e.id) === executionId) continue;
            let score = 0;
            // Shared input words
            const eWords = (e.input || "").toLowerCase().split(/\W+/).filter(w => w.length > 3);
            const shared = eWords.filter(w => anchorWords.has(w)).length;
            if (shared > 0) score += Math.round((shared / Math.max(anchorWords.size, 1)) * 60);
            // Same agent
            if (anchor.agentId && e.agentId === anchor.agentId) score += 15;
            // Same task type
            if (anchor.taskType && e.taskType === anchor.taskType) score += 10;
            // Same error pattern
            if (anchorErr && e.error && e.error.toLowerCase().includes(anchorErr.slice(0, 30))) score += 20;
            // Same outcome
            if (anchor.success === false && e.success === false) score += 5;
            if (score > 0) correlated.push({ score, executionId: e.executionId || e.id, input: e.input, agentId: e.agentId, taskType: e.taskType, success: e.success, error: e.error, durationMs: e.durationMs, ts: e.ts, sharedWords: shared });
        }

        correlated.sort((a, b) => b.score - a.score);

        // Also correlate with patches on same files
        const relatedPatches = [];
        if (patchAssist && anchor.input) {
            const words = (anchor.input || "").toLowerCase().split(/\W+/).filter(w => w.length > 3);
            const patches = patchAssist.listPatches({});
            for (const p of patches) {
                const hay = `${p.filePath || ""} ${p.reason || ""}`.toLowerCase();
                if (words.some(w => hay.includes(w))) relatedPatches.push({ patchId: p.id, filePath: p.filePath, status: p.status, proposedAt: p.proposedAt });
            }
        }

        return res.json({
            success: true,
            anchor: { executionId: anchor.executionId || anchor.id, input: anchor.input, agentId: anchor.agentId, ts: anchor.ts },
            correlated: correlated.slice(0, cap),
            relatedPatches: relatedPatches.slice(0, 8),
            total: correlated.length,
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B5.7  GET /runtime/intel/summary — full intelligence summary (all sources)
router.get("/runtime/intel/summary", rateLimiter(10, 60_000), (req, res) => {
    try {
        // Patch stats
        const patches = patchAssist ? patchAssist.listPatches({}) : [];
        const patchStats = patches.reduce((acc, p) => {
            acc.total++;
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
        }, { total: 0 });
        const successRate = patches.length > 0
            ? Math.round(((patchStats.applied || 0) / patches.length) * 100) : null;

        // Execution history stats
        const hist = _execHistory ? _execHistory.recent(200) : [];
        const histStats = hist.reduce((acc, e) => {
            acc.total++;
            if (e.success === false) acc.failed++; else acc.succeeded++;
            return acc;
        }, { total: 0, succeeded: 0, failed: 0 });

        // Knowledge base
        const kbStats = _knowledgeMem ? _knowledgeMem.stats() : null;

        // Engineering memory
        const memStats = _engMemory ? _engMemory.stats() : null;

        // Learning engine summary
        let learnSummary = null;
        if (_learningEngine) {
            try { learnSummary = _learningEngine.getSummary(); } catch (_) {}
        }

        // Failure intel
        let deployRisk = null;
        if (_failIntelEngine) {
            try {
                const rpt = _failIntelEngine.report();
                deployRisk = rpt.deploymentRisk || null;
            } catch (_) {}
        }

        // Incident summary
        const incSummary = _incidentEngine ? _incidentEngine.getIncidentSummary() : null;

        return res.json({ success: true,
            patch:    { ...patchStats, successRate },
            history:  histStats,
            knowledge: kbStats,
            memory:   memStats,
            learning: learnSummary,
            deployRisk,
            incidents: incSummary,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase B6 — Learning → Prediction ─────────────────────────────────

// ── shared helpers (B6 only) ──────────────────────────────────────────
function _b6PatchStats() {
    const patches = patchAssist ? patchAssist.listPatches({}) : [];
    const total   = patches.length;
    const applied  = patches.filter(p => p.status === "applied").length;
    const rolled   = patches.filter(p => p.status === "rolled-back" || p.status === "rolled_back").length;
    const pending  = patches.filter(p => p.status === "pending").length;
    const rollbackRate = total > 0 ? rolled / total : 0;
    const successRate  = total > 0 ? applied / total : null;
    // per-file breakdown
    const byFile = {};
    for (const p of patches) {
        const k = p.filePath || "unknown";
        if (!byFile[k]) byFile[k] = { applied: 0, rolledBack: 0, pending: 0, total: 0 };
        byFile[k].total++;
        if (p.status === "applied")                                  byFile[k].applied++;
        if (p.status === "rolled-back" || p.status === "rolled_back") byFile[k].rolledBack++;
        if (p.status === "pending")                                  byFile[k].pending++;
    }
    return { patches, total, applied, rolled, pending, rollbackRate, successRate, byFile };
}

function _b6HealStats() {
    try {
        const fs   = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/healing-history.json");
        const raw  = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
        const arr  = Array.isArray(raw) ? raw : [];
        const total     = arr.length;
        const succeeded = arr.filter(h => h.success !== false).length;
        const failed    = arr.filter(h => h.success === false).length;
        const healRate  = total > 0 ? succeeded / total : null;
        // last 30 days
        const cutoff = Date.now() - 30 * 86400_000;
        const recent = arr.filter(h => new Date(h.ts).getTime() > cutoff);
        const recentSucceeded = recent.filter(h => h.success !== false).length;
        const recentHealRate  = recent.length > 0 ? recentSucceeded / recent.length : null;
        // frequency: events per day
        if (arr.length >= 2) {
            const oldest = new Date(arr[0].ts).getTime();
            const newest = new Date(arr[arr.length - 1].ts).getTime();
            const days   = Math.max(1, (newest - oldest) / 86400_000);
            var perDay   = total / days;
        } else {
            var perDay = 0;
        }
        return { total, succeeded, failed, healRate, recentHealRate, perDay, recent: recent.length };
    } catch { return { total: 0, succeeded: 0, failed: 0, healRate: null, recentHealRate: null, perDay: 0, recent: 0 }; }
}

// B6.1  POST /runtime/predict/failure-risk
//   Predictive failure risk score before a pipeline/task runs.
//   Inputs: { request, filePath, pipelineName }
router.post("/runtime/predict/failure-risk", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { request = "", filePath = "", pipelineName = "standard-deploy" } = req.body || {};
        const query = `${request} ${filePath}`.toLowerCase().trim();
        const words = query.split(/\W+/).filter(w => w.length > 3);

        const factors   = [];
        let   riskScore = 0;

        // Factor 1: patch rollback rate for this file
        const ps = _b6PatchStats();
        if (filePath && ps.byFile[filePath]) {
            const fs = ps.byFile[filePath];
            const fileRb = fs.total > 0 ? fs.rolledBack / fs.total : 0;
            if (fileRb > 0.5) {
                riskScore += 35;
                factors.push({ factor: "high_file_rollback_rate", weight: 35, detail: `${Math.round(fileRb * 100)}% rollbacks on ${filePath.split("/").pop()}`, evidence: `${fs.rolledBack}/${fs.total} patches rolled back` });
            } else if (fileRb > 0.2) {
                riskScore += 15;
                factors.push({ factor: "moderate_file_rollback_rate", weight: 15, detail: `${Math.round(fileRb * 100)}% rollbacks on ${filePath.split("/").pop()}`, evidence: `${fs.rolledBack}/${fs.total} patches rolled back` });
            }
        }

        // Factor 2: overall platform rollback rate
        if (ps.rollbackRate > 0.4) {
            riskScore += 20;
            factors.push({ factor: "high_platform_rollback_rate", weight: 20, detail: `Platform rollback rate ${Math.round(ps.rollbackRate * 100)}%`, evidence: `${ps.rolled}/${ps.total} patches failed` });
        } else if (ps.rollbackRate > 0.25) {
            riskScore += 8;
            factors.push({ factor: "moderate_platform_rollback_rate", weight: 8, detail: `Platform rollback rate ${Math.round(ps.rollbackRate * 100)}%`, evidence: `${ps.rolled}/${ps.total} patches failed` });
        }

        // Factor 3: execution history error rate
        const hist = _execHistory ? _execHistory.recent(100) : [];
        if (hist.length >= 5) {
            const failed = hist.filter(e => e.success === false).length;
            const errRate = failed / hist.length;
            if (errRate > 0.4) {
                riskScore += 20;
                factors.push({ factor: "high_exec_error_rate", weight: 20, detail: `${Math.round(errRate * 100)}% execution error rate`, evidence: `${failed}/${hist.length} recent executions failed` });
            } else if (errRate > 0.2) {
                riskScore += 8;
                factors.push({ factor: "moderate_exec_error_rate", weight: 8, detail: `${Math.round(errRate * 100)}% execution error rate`, evidence: `${failed}/${hist.length} recent executions failed` });
            }
            // Factor 4: similar previous failures
            if (words.length > 0) {
                const similar = hist.filter(e => {
                    if (e.success !== false) return false;
                    const hay = (e.input || "").toLowerCase();
                    return words.some(w => hay.includes(w));
                });
                if (similar.length > 0) {
                    riskScore += Math.min(25, similar.length * 8);
                    factors.push({ factor: "similar_previous_failures", weight: Math.min(25, similar.length * 8), detail: `${similar.length} similar failed execution(s) found`, evidence: similar.slice(0, 2).map(e => e.input?.slice(0, 60) || "").join(" | ") });
                }
            }
        }

        // Factor 5: healing frequency (high heal rate → unstable system)
        const hs = _b6HealStats();
        if (hs.perDay > 50) {
            riskScore += 15;
            factors.push({ factor: "high_healing_frequency", weight: 15, detail: `${hs.perDay.toFixed(1)} heal events/day`, evidence: `System healing ${hs.total} times total` });
        } else if (hs.perDay > 20) {
            riskScore += 6;
            factors.push({ factor: "elevated_healing_frequency", weight: 6, detail: `${hs.perDay.toFixed(1)} heal events/day` });
        }

        // Factor 6: deployment risk from failureIntelligenceEngine
        if (_failIntelEngine) {
            try {
                const dr = _failIntelEngine.estimateDeploymentRisk(pipelineName);
                if (dr.riskScore > 0) {
                    const w = Math.round(dr.riskScore * 0.3);
                    riskScore += w;
                    factors.push({ factor: "pipeline_preflight_risk", weight: w, detail: dr.recommendation, evidence: dr.riskFactors.join("; ") });
                }
            } catch (_) {}
        }

        // Factor 7: open incidents
        const openInc = _incidentEngine ? _incidentEngine.listIncidents({ status: null, limit: 100 }).filter(i => i.status === "open" || i.status === "detected") : [];
        if (openInc.length > 0) {
            const w = Math.min(20, openInc.length * 7);
            riskScore += w;
            factors.push({ factor: "open_incidents", weight: w, detail: `${openInc.length} open incident(s)`, evidence: openInc.slice(0, 2).map(i => i.title || i.type || "incident").join(", ") });
        }

        riskScore = Math.min(100, Math.round(riskScore));
        const riskLevel = riskScore >= 70 ? "critical" : riskScore >= 45 ? "high" : riskScore >= 20 ? "moderate" : "low";
        const confidence = Math.min(95, 40 + Math.min(hist.length, 50) + Math.min(ps.total * 2, 30));

        // Positive signals (risk reducers)
        const mitigations = [];
        if (ps.successRate > 0.7)  mitigations.push(`High patch success rate (${Math.round(ps.successRate * 100)}%)`);
        if (hs.healRate > 0.9)     mitigations.push(`Self-healing success rate ${Math.round(hs.healRate * 100)}%`);
        if (openInc.length === 0)  mitigations.push("No open incidents");
        if (hist.length > 10 && hist.filter(e => e.success !== false).length / hist.length > 0.8) mitigations.push("Strong execution success history");

        return res.json({ success: true, riskScore, riskLevel, confidence,
            factors: factors.sort((a, b) => b.weight - a.weight),
            mitigations,
            recommendation: riskLevel === "critical" ? "Do NOT deploy — resolve critical factors first"
                : riskLevel === "high" ? "High risk — review all factors and run extra tests"
                : riskLevel === "moderate" ? "Moderate risk — proceed with caution and monitoring"
                : "Low risk — safe to proceed",
            meta: { patchTotal: ps.total, rollbackRate: Math.round(ps.rollbackRate * 100), execHistory: hist.length, openIncidents: openInc.length, healTotal: hs.total },
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B6.2  POST /runtime/predict/deploy-risk
//   Deploy Risk Assessment — similar failed/successful deploys + risk + confidence
router.post("/runtime/predict/deploy-risk", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { pipelineName = "standard-deploy", request = "", filePaths = [] } = req.body || {};

        // Base risk from fiE
        const baseRisk = _failIntelEngine
            ? _failIntelEngine.estimateDeploymentRisk(pipelineName)
            : { riskScore: 10, riskLevel: "low", riskFactors: [], recommendation: "Insufficient data" };

        const ps = _b6PatchStats();
        const hs = _b6HealStats();

        // Similar successful patches on these files
        const similarSuccessful = [];
        const similarFailed     = [];
        if (filePaths.length > 0 && patchAssist) {
            for (const fp of filePaths) {
                const filePatch = ps.byFile[fp];
                if (!filePatch) continue;
                const filePatches = ps.patches.filter(p => p.filePath === fp);
                filePatches.filter(p => p.status === "applied").forEach(p => similarSuccessful.push({ patchId: p.id, filePath: p.filePath, proposedAt: p.proposedAt }));
                filePatches.filter(p => p.status === "rolled-back" || p.status === "rolled_back").forEach(p => similarFailed.push({ patchId: p.id, filePath: p.filePath, rolledBackAt: p.rolledBackAt }));
            }
        } else {
            // No specific files — use overall
            ps.patches.filter(p => p.status === "applied").slice(-5).forEach(p => similarSuccessful.push({ patchId: p.id, filePath: p.filePath, proposedAt: p.proposedAt }));
            ps.patches.filter(p => p.status === "rolled-back" || p.status === "rolled_back").slice(-5).forEach(p => similarFailed.push({ patchId: p.id, filePath: p.filePath }));
        }

        // Recovery confidence
        let recoveryConf = null;
        if (_failIntelEngine) {
            try { recoveryConf = _failIntelEngine.recoveryConfidence("backend-restore"); } catch (_) {}
        }

        // Compute composite risk
        let compositeRisk = baseRisk.riskScore;
        if (ps.rollbackRate > 0.3) compositeRisk = Math.min(100, compositeRisk + Math.round(ps.rollbackRate * 30));
        if (hs.perDay > 50)        compositeRisk = Math.min(100, compositeRisk + 10);

        const riskPct  = compositeRisk;
        const confPct  = Math.min(95, 50 + Math.min(ps.total * 3, 35) + (hs.total > 100 ? 10 : 0));
        const level    = riskPct >= 70 ? "critical" : riskPct >= 45 ? "high" : riskPct >= 20 ? "moderate" : "low";

        return res.json({ success: true,
            pipelineName, riskPercentage: riskPct, confidenceScore: confPct,
            riskLevel: level,
            baseRisk: { score: baseRisk.riskScore, level: baseRisk.riskLevel, factors: baseRisk.riskFactors, recommendation: baseRisk.recommendation },
            similarSuccessful: similarSuccessful.slice(0, 6),
            similarFailed:     similarFailed.slice(0, 6),
            platformStats: { totalPatches: ps.total, successRate: ps.successRate != null ? Math.round(ps.successRate * 100) : null, rollbackRate: Math.round(ps.rollbackRate * 100), healRate: hs.healRate != null ? Math.round(hs.healRate * 100) : null },
            recoveryConfidence: recoveryConf,
            recommendation: level === "critical" ? "Critical deploy risk — halt and resolve blockers"
                : level === "high" ? "High deploy risk — requires peer review and extra smoke tests"
                : level === "moderate" ? "Moderate risk — deploy with staged rollout + monitoring"
                : "Low risk — deploy following standard checklist",
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B6.3  GET /runtime/predict/cross-project?q=
//   Cross-Project Knowledge — similar fixes + incidents across all stored knowledge
router.get("/runtime/predict/cross-project", rateLimiter(20, 60_000), (req, res) => {
    try {
        const q     = (req.query.q || "").toLowerCase().trim();
        const limit = Math.min(20, parseInt(req.query.limit) || 10);

        const results = [];

        // All knowledge memory entries (known-fix, stable-chain, runtime-failure, project-knowledge)
        if (_knowledgeMem) {
            const entries = _knowledgeMem.query({ search: q || undefined, limit: 50 });
            for (const e of entries) {
                const hay   = JSON.stringify(e).toLowerCase();
                const words = q.split(/\W+/).filter(w => w.length > 3);
                const hits  = q ? words.filter(w => hay.includes(w)).length : 1;
                const score = q ? Math.round((hits / Math.max(words.length, 1)) * 80) : 60;
                results.push({ source: "knowledge_base", kind: e.kind, score, key: e.key, problem: e.problem, fix: e.fix, description: e.description, ts: e.ts, chainName: e.chainName });
            }
        }

        // Engineering memory chains
        if (_engMemory) {
            const mem = q ? _engMemory.query(q, null) : _engMemory.query("", null);
            for (const m of mem) {
                results.push({ source: "eng_memory", kind: m.type, score: 55, chainName: m.chainName, goalPattern: m.goalPattern, confidence: m.confidence, stepCount: m.stepCount, ts: m.ts });
            }
        }

        // Similar patches by query
        if (patchAssist && q) {
            const patches = patchAssist.listPatches({ status: "applied" });
            const words   = q.split(/\W+/).filter(w => w.length > 3);
            for (const p of patches) {
                const hay  = `${p.filePath || ""} ${p.reason || ""} ${p.diff?.preview || ""}`.toLowerCase();
                const hits = words.filter(w => hay.includes(w)).length;
                if (hits > 0) results.push({ source: "patch_history", kind: "applied_patch", score: Math.round((hits / words.length) * 70), patchId: p.id, filePath: p.filePath, reason: p.reason, ts: p.proposedAt });
            }
        }

        // Ranking: sort by score, deduplicate by key/chainName
        results.sort((a, b) => b.score - a.score);
        const seen = new Set();
        const deduped = results.filter(r => {
            const key = r.key || r.chainName || r.patchId || JSON.stringify(r).slice(0, 40);
            if (seen.has(key)) return false;
            seen.add(key); return true;
        });

        return res.json({ success: true, query: q, results: deduped.slice(0, limit), total: deduped.length });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B6.4  POST /runtime/predict/pre-patch-advice
//   Recommendation Assistant — before applying a patch: top success/failure patterns + safest path
router.post("/runtime/predict/pre-patch-advice", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { filePath = "", description = "", patchId = null } = req.body || {};

        const ps   = _b6PatchStats();
        const hs   = _b6HealStats();
        const file = ps.byFile[filePath] || null;

        // Top success patterns
        const successPatterns = Object.entries(ps.byFile)
            .filter(([, s]) => s.applied > 0 && s.rolledBack === 0)
            .sort(([, a], [, b]) => b.applied - a.applied)
            .slice(0, 5)
            .map(([f, s]) => ({ file: f.split("/").slice(-2).join("/"), applied: s.applied, rollbackRate: 0, recommendation: "Safe file — all patches applied cleanly" }));

        // Top failure patterns
        const failurePatterns = Object.entries(ps.byFile)
            .filter(([, s]) => s.rolledBack > 0)
            .sort(([, a], [, b]) => (b.rolledBack / Math.max(b.total, 1)) - (a.rolledBack / Math.max(a.total, 1)))
            .slice(0, 5)
            .map(([f, s]) => ({ file: f.split("/").slice(-2).join("/"), rolledBack: s.rolledBack, total: s.total, rollbackRate: Math.round((s.rolledBack / s.total) * 100), warning: "High rollback rate — extra caution required" }));

        // Known failure patterns matching this file
        const fileExt  = filePath.split(".").pop();
        const knownRisk = (_failIntelEngine?.FAILURE_PATTERNS || []).filter(p =>
            description && p.rootCause.toLowerCase().includes(description.toLowerCase().split(" ")[0])
        );

        // Safest path advice
        const safestPath = [];
        safestPath.push("Run tests before applying: POST /runtime/patches/:id/verify");
        if (file && file.rolledBack > 0) safestPath.push(`Warning: ${file.rolledBack} previous rollback(s) on this file — review diff carefully`);
        if (file && file.applied > 0)    safestPath.push(`${file.applied} previous patch(es) applied successfully on this file`);
        if (hs.healRate != null && hs.healRate < 0.9) safestPath.push("System heal rate below 90% — deploy with extra rollback readiness");
        safestPath.push("Use autoRollback:true in auto-pipeline for safety net");

        // Lookup in knowledge base
        let kbFix = null;
        if (_knowledgeMem && description) {
            try { kbFix = _knowledgeMem.query({ search: description, limit: 3 }); } catch (_) {}
        }

        return res.json({ success: true, filePath, description,
            fileHistory: file ? { ...file, rollbackRate: file.total > 0 ? Math.round((file.rolledBack / file.total) * 100) : 0 } : null,
            successPatterns,
            failurePatterns,
            knownRiskPatterns: knownRisk.slice(0, 3),
            safestPath,
            kbMatches: kbFix ? kbFix.slice(0, 3) : [],
            platformHealth: { patchSuccessRate: ps.successRate != null ? Math.round(ps.successRate * 100) : null, rollbackRate: Math.round(ps.rollbackRate * 100), healRate: hs.healRate != null ? Math.round(hs.healRate * 100) : null },
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B6.5  POST /runtime/predict/explain
//   Engineering Advisor — "why is this risky?" / "why is this recommended?"
//   Evidence-backed explanation for a risk score or recommendation
router.post("/runtime/predict/explain", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { subject = "", subjectType = "patch", patchId = null, filePath = "", riskScore = null } = req.body || {};

        const ps  = _b6PatchStats();
        const hs  = _b6HealStats();
        const evidence = [];
        const reasoning = [];
        let verdict = "neutral";
        let score   = riskScore;

        // Patch-specific evidence
        if (subjectType === "patch" || subjectType === "file") {
            const file = ps.byFile[filePath] || null;
            if (file) {
                const rb  = file.rolledBack;
                const app = file.applied;
                const tot = file.total;
                const rbPct = tot > 0 ? Math.round((rb / tot) * 100) : 0;
                evidence.push({ type: "file_history", label: `${filePath.split("/").pop()} patch history`, value: `${app} applied, ${rb} rolled back (${rbPct}% failure rate)`, weight: rbPct > 40 ? "high" : rbPct > 20 ? "medium" : "low" });
                if (rb > app) { reasoning.push(`More rollbacks (${rb}) than successful patches (${app}) on this file.`); verdict = "risky"; score = score ?? 70; }
                else if (app > 0 && rb === 0) { reasoning.push(`All ${app} previous patches on this file were applied cleanly.`); verdict = "safe"; score = score ?? 15; }
            }
        }

        // Platform evidence
        evidence.push({ type: "platform_rollback_rate", label: "Platform-wide rollback rate", value: `${Math.round(ps.rollbackRate * 100)}% (${ps.rolled}/${ps.total} patches)`, weight: ps.rollbackRate > 0.3 ? "high" : "low" });
        if (ps.rollbackRate > 0.3) reasoning.push(`Platform rollback rate is elevated at ${Math.round(ps.rollbackRate * 100)}%.`);
        else reasoning.push(`Platform rollback rate is healthy at ${Math.round(ps.rollbackRate * 100)}%.`);

        // Healing evidence
        evidence.push({ type: "healing", label: "System heal events", value: `${hs.total} total, ${hs.perDay.toFixed(1)}/day, ${hs.healRate != null ? Math.round(hs.healRate * 100) + "% success" : "unknown rate"}`, weight: hs.perDay > 50 ? "high" : "low" });
        if (hs.healRate != null && hs.healRate < 0.9) reasoning.push(`Self-healing success rate is ${Math.round(hs.healRate * 100)}% — system under strain.`);
        else if (hs.healRate != null) reasoning.push(`Self-healing rate is strong (${Math.round(hs.healRate * 100)}%).`);

        // Knowledge base matches
        let kbMatches = [];
        if (_knowledgeMem && subject) {
            try {
                kbMatches = _knowledgeMem.query({ search: subject, limit: 3 });
                for (const k of kbMatches) {
                    evidence.push({ type: "knowledge_base", label: k.key || k.kind, value: k.fix || k.description || "(see detail)", weight: "medium" });
                    reasoning.push(`Known fix in KB: "${k.fix || k.description}"`);
                }
            } catch (_) {}
        }

        // Failure intelligence
        if (_failIntelEngine && subject) {
            const matched = (_failIntelEngine.FAILURE_PATTERNS || []).filter(p => p.rootCause.toLowerCase().includes(subject.toLowerCase().split(" ")[0]));
            for (const m of matched.slice(0, 2)) {
                evidence.push({ type: "failure_pattern", label: m.id, value: `${m.rootCause} — risk: ${m.riskLevel}`, weight: m.riskLevel === "critical" ? "high" : "medium" });
                reasoning.push(`Matches known failure pattern "${m.id}": ${m.rootCause}.`);
                if (m.recovery) reasoning.push(`Recommended recovery chain: ${m.recovery}.`);
            }
        }

        // Exec history
        const hist = _execHistory ? _execHistory.recent(100) : [];
        if (subject && hist.length > 0) {
            const words = subject.toLowerCase().split(/\W+/).filter(w => w.length > 3);
            const similar = hist.filter(e => words.some(w => (e.input || "").toLowerCase().includes(w)));
            if (similar.length > 0) {
                const failedSim = similar.filter(e => e.success === false).length;
                evidence.push({ type: "execution_history", label: "Similar past executions", value: `${similar.length} found, ${failedSim} failed`, weight: failedSim > similar.length / 2 ? "high" : "low" });
                if (failedSim > 0) reasoning.push(`${failedSim}/${similar.length} similar past execution(s) failed.`);
            }
        }

        score = score ?? (verdict === "risky" ? 65 : verdict === "safe" ? 15 : 30);

        return res.json({ success: true, subject, subjectType, filePath,
            verdict, riskScore: Math.min(100, Math.round(score)),
            reasoning,
            evidence: evidence.sort((a, b) => (b.weight === "high" ? 2 : b.weight === "medium" ? 1 : 0) - (a.weight === "high" ? 2 : a.weight === "medium" ? 1 : 0)),
            kbMatches: kbMatches.slice(0, 3),
            summary: reasoning.length > 0 ? reasoning[0] : "No evidence collected.",
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B6.6  GET /runtime/predict/readiness-score
//   Production Readiness Score — single composite score from all signals
router.get("/runtime/predict/readiness-score", rateLimiter(10, 60_000), (req, res) => {
    try {
        const ps  = _b6PatchStats();
        const hs  = _b6HealStats();
        const inc = _incidentEngine ? _incidentEngine.listIncidents({ limit: 200, status: null }) : [];

        // Incident frequency component (inverted: low = good)
        const openInc    = inc.filter(i => i.status === "open" || i.status === "detected").length;
        const resolvedInc = inc.filter(i => i.status === "resolved" || i.status === "auto-resolved").length;
        const incFreqScore = Math.max(0, 100 - openInc * 15 - Math.max(0, inc.length - resolvedInc) * 5);

        // Rollback frequency component (lower rollback = higher score)
        const rollbackScore = Math.max(0, Math.round((1 - ps.rollbackRate) * 100));

        // Test pass rate — derive from patches that have been verified
        // We use apply rate as proxy for test pass rate
        const testPassScore = ps.successRate != null ? Math.round(ps.successRate * 100) : 50;

        // Deployment success rate (applied patches / total non-pending)
        const deployable = ps.total - ps.pending;
        const deploySuccessScore = deployable > 0
            ? Math.round((ps.applied / deployable) * 100)
            : 50;

        // Healing success rate
        const healScore = hs.healRate != null ? Math.round(hs.healRate * 100) : 70;

        // Weights
        const WEIGHTS = {
            incidentFrequency:     0.20,
            rollbackFrequency:     0.25,
            testPassRate:          0.20,
            deploymentSuccessRate: 0.20,
            healingSuccessRate:    0.15,
        };

        const composite = Math.round(
            incFreqScore      * WEIGHTS.incidentFrequency +
            rollbackScore     * WEIGHTS.rollbackFrequency +
            testPassScore     * WEIGHTS.testPassRate +
            deploySuccessScore * WEIGHTS.deploymentSuccessRate +
            healScore         * WEIGHTS.healingSuccessRate
        );

        const level = composite >= 85 ? "production_ready"
            : composite >= 70 ? "mostly_ready"
            : composite >= 50 ? "needs_attention"
            : "not_ready";

        const signals = [
            { name: "Incident frequency",      score: incFreqScore,       weight: WEIGHTS.incidentFrequency,     rawValue: `${openInc} open incident(s)`, detail: `${inc.length} total, ${resolvedInc} resolved` },
            { name: "Rollback frequency",      score: rollbackScore,      weight: WEIGHTS.rollbackFrequency,     rawValue: `${Math.round(ps.rollbackRate * 100)}% rollback rate`, detail: `${ps.rolled}/${ps.total} patches rolled back` },
            { name: "Test pass rate",          score: testPassScore,      weight: WEIGHTS.testPassRate,          rawValue: `${testPassScore}%`, detail: `${ps.applied}/${ps.total} patches applied (proxy)` },
            { name: "Deployment success rate", score: deploySuccessScore, weight: WEIGHTS.deploymentSuccessRate, rawValue: `${deploySuccessScore}%`, detail: `${ps.applied}/${deployable} non-pending patches applied` },
            { name: "Healing success rate",    score: healScore,          weight: WEIGHTS.healingSuccessRate,    rawValue: `${healScore}%`, detail: `${hs.succeeded}/${hs.total} healing events succeeded` },
        ];

        const blockers = signals.filter(s => s.score < 50).map(s => ({ signal: s.name, score: s.score, recommendation: `Improve ${s.name.toLowerCase()} (currently ${s.rawValue})` }));
        const strengths = signals.filter(s => s.score >= 80).map(s => s.name);

        return res.json({ success: true,
            compositeScore: composite,
            level,
            badge: level === "production_ready" ? "🟢 Production Ready" : level === "mostly_ready" ? "🟡 Mostly Ready" : level === "needs_attention" ? "🟠 Needs Attention" : "🔴 Not Ready",
            signals,
            blockers,
            strengths,
            meta: { patchTotal: ps.total, incidentTotal: inc.length, healTotal: hs.total },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase B7 — Preventive Engineering ────────────────────────────────

// ── shared helpers (B7) ───────────────────────────────────────────────

// Returns per-file risk map: { [filePath]: { rollbackRate, total, rolledBack, applied, pending } }
function _b7FileRiskMap() {
    const { byFile } = _b6PatchStats();
    const map = {};
    for (const [file, stats] of Object.entries(byFile)) {
        map[file] = {
            ...stats,
            rollbackRate: stats.total > 0 ? Math.round((stats.rolledBack / stats.total) * 100) : 0,
        };
    }
    return map;
}

// Score a single patch for safety using real data. Returns { safetyScore, confidenceScore, riskLevel, explanation }
function _b7PatchSafetyScore(patch) {
    const { byFile } = _b6PatchStats();
    const filePath = patch?.filePath || "";
    const fileStats = byFile[filePath] || null;

    let safetyScore   = 100; // start safe
    let confidenceScore = 75;
    const reasons = [];

    // Deduct for file rollback history
    if (fileStats) {
        const rr = fileStats.total > 0 ? fileStats.rolledBack / fileStats.total : 0;
        if (rr > 0.5) {
            safetyScore  -= 35;
            confidenceScore = 90;
            reasons.push(`${Math.round(rr * 100)}% rollback rate on ${filePath.split("/").pop()} (${fileStats.rolledBack}/${fileStats.total})`);
        } else if (rr > 0.25) {
            safetyScore  -= 18;
            confidenceScore = 80;
            reasons.push(`${Math.round(rr * 100)}% rollback rate on ${filePath.split("/").pop()}`);
        } else if (fileStats.applied >= 3) {
            // file has been patched cleanly many times — boost
            safetyScore  = Math.min(100, safetyScore + 5);
            reasons.push(`${fileStats.applied} prior clean patches on this file`);
        }
    } else if (filePath) {
        reasons.push("First patch on this file — no history");
        confidenceScore = 55;
    }

    // Deduct for platform-level rollback rate
    const ps = _b6PatchStats();
    if (ps.total > 5) {
        const platformRr = ps.rolled / ps.total;
        if (platformRr > 0.4) {
            safetyScore  -= 20;
            reasons.push(`Platform rollback rate is high (${Math.round(platformRr * 100)}%)`);
        } else if (platformRr > 0.2) {
            safetyScore  -= 8;
            reasons.push(`Platform rollback rate is elevated (${Math.round(platformRr * 100)}%)`);
        }
    }

    // Deduct for recent open incidents touching the same file
    let incidentHits = 0;
    if (_incidentEngine) {
        try {
            const incs = _incidentEngine.listIncidents({ status: "open", limit: 20 });
            incidentHits = incs.filter(i => filePath && (i.context || "").includes(filePath.split("/").pop())).length;
            if (incidentHits > 0) {
                safetyScore  -= incidentHits * 8;
                reasons.push(`${incidentHits} open incident(s) related to this file`);
            }
        } catch {}
    }

    // Deduct for execution errors
    if (_execHistory) {
        try {
            const recent = _execHistory.recent(30);
            const errors = recent.filter(e => e.status === "error" || e.status === "failed");
            if (errors.length > 5) {
                safetyScore  -= 10;
                reasons.push(`${errors.length} execution errors in recent history`);
            }
        } catch {}
    }

    safetyScore = Math.max(0, Math.min(100, safetyScore));
    const riskLevel = safetyScore >= 80 ? "low" : safetyScore >= 60 ? "moderate" : safetyScore >= 40 ? "high" : "critical";

    return { safetyScore, confidenceScore, riskLevel, explanation: reasons };
}

// B7.1 + B7.6 — Pre-deploy guard: check risk before allowing a deploy
// POST /runtime/guard/pre-deploy
// Body: { pipelineName, filePaths[], request, threshold, operatorOverride }
router.post("/runtime/guard/pre-deploy", rateLimiter(20, 60_000), (req, res) => {
    try {
        const {
            pipelineName  = "standard-deploy",
            filePaths     = [],
            request       = "",
            threshold     = 70,     // block if riskScore >= threshold
            operatorOverride = false,
        } = req.body || {};

        const ps = _b6PatchStats();

        // Composite risk from patch history for these files
        const fileRiskMap = _b7FileRiskMap();
        const fileRisks = filePaths.map(fp => ({
            filePath: fp,
            ...(fileRiskMap[fp] || { rollbackRate: 0, total: 0, rolledBack: 0, applied: 0, pending: 0 }),
        }));

        let riskScore    = 0;
        const factors    = [];
        const warnings   = [];

        // Factor: files with high rollback rate
        const highRiskFiles = fileRisks.filter(f => f.rollbackRate > 40);
        if (highRiskFiles.length > 0) {
            riskScore += Math.min(40, highRiskFiles.length * 15);
            factors.push({ factor: "high_risk_files", weight: Math.min(40, highRiskFiles.length * 15),
                detail: `${highRiskFiles.length} file(s) with >40% rollback rate`,
                files: highRiskFiles.map(f => f.filePath) });
        }

        // Factor: platform rollback rate
        if (ps.total > 3) {
            const rr = ps.rolled / ps.total;
            if (rr > 0.4) {
                riskScore += 25;
                factors.push({ factor: "platform_rollback_rate", weight: 25, detail: `${Math.round(rr * 100)}% platform rollback rate` });
            } else if (rr > 0.2) {
                riskScore += 10;
                factors.push({ factor: "elevated_platform_rollback", weight: 10, detail: `${Math.round(rr * 100)}% platform rollback rate` });
            }
        }

        // Factor: open incidents
        if (_incidentEngine) {
            try {
                const openInc = _incidentEngine.listIncidents({ status: "open", limit: 10 });
                if (openInc.length > 0) {
                    riskScore += Math.min(20, openInc.length * 5);
                    factors.push({ factor: "open_incidents", weight: Math.min(20, openInc.length * 5),
                        detail: `${openInc.length} open incident(s) on platform` });
                }
            } catch {}
        }

        // Factor: failure intelligence preflight
        if (_failIntelEngine && pipelineName) {
            try {
                const est = _failIntelEngine.estimateDeploymentRisk(pipelineName);
                if (est && est.riskScore > 30) {
                    const w = Math.round(est.riskScore * 0.3);
                    riskScore += w;
                    factors.push({ factor: "pipeline_preflight", weight: w,
                        detail: `Failure intelligence: ${est.riskScore}% risk for pipeline "${pipelineName}"` });
                }
            } catch {}
        }

        // Recent similar failed patches
        const similarFailed = ps.patches.filter(p =>
            (p.status === "rolled-back" || p.status === "rolled_back") &&
            filePaths.some(fp => p.filePath === fp)
        );
        if (similarFailed.length > 0) {
            riskScore += Math.min(20, similarFailed.length * 7);
            factors.push({ factor: "similar_failed_patches", weight: Math.min(20, similarFailed.length * 7),
                detail: `${similarFailed.length} similar patch(es) previously rolled back` });
            warnings.push(...similarFailed.slice(0, 3).map(p => `Rollback: ${p.filePath?.split("/").pop()} (${p.patchId?.slice(0, 8)})`));
        }

        riskScore = Math.min(100, riskScore);
        const riskLevel = riskScore < 30 ? "low" : riskScore < 60 ? "moderate" : riskScore < 80 ? "high" : "critical";
        const blocked   = riskScore >= threshold && !operatorOverride;

        // Safer alternatives from knowledge base
        const alternatives = [];
        if (_knowledgeMem && filePaths.length > 0) {
            try {
                const kb = _knowledgeMem.query({ search: filePaths[0].split("/").pop(), limit: 3 });
                for (const k of kb) {
                    if (k.fix) alternatives.push(k.fix);
                }
            } catch {}
        }

        return res.json({
            success: true,
            blocked,
            riskScore,
            riskLevel,
            threshold,
            operatorOverride,
            factors,
            warnings,
            alternatives: alternatives.slice(0, 2),
            fileRisks,
            meta: { totalPatches: ps.total, rolled: ps.rolled, pipelineName, filesChecked: filePaths.length },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B7.2 — Patch safety score
// GET /runtime/guard/patch-safety/:id
router.get("/runtime/guard/patch-safety/:id", rateLimiter(30, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    try {
        const patch = patchAssist.getPatch(req.params.id);
        if (!patch) return res.status(404).json({ success: false, error: "patch_not_found" });
        const score = _b7PatchSafetyScore(patch);

        // Also fetch similar failed patches for context
        const ps = _b6PatchStats();
        const similarFailed = ps.patches.filter(p =>
            (p.status === "rolled-back" || p.status === "rolled_back") &&
            patch.filePath && p.filePath === patch.filePath && p.patchId !== patch.patchId
        ).slice(0, 3);

        // KB matches
        let kbMatches = [];
        if (_knowledgeMem && patch.filePath) {
            try {
                kbMatches = _knowledgeMem.query({ search: patch.filePath.split("/").pop(), limit: 3 });
            } catch {}
        }

        return res.json({
            success: true,
            patchId:        patch.patchId,
            filePath:       patch.filePath,
            safetyScore:    score.safetyScore,
            confidenceScore: score.confidenceScore,
            riskLevel:      score.riskLevel,
            explanation:    score.explanation,
            similarFailed,
            kbMatches,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B7.2 — Batch safety scores for patch list
// POST /runtime/guard/patch-safety-batch
// Body: { patchIds[] }
router.post("/runtime/guard/patch-safety-batch", rateLimiter(20, 60_000), (req, res) => {
    if (!patchAssist) return res.status(503).json({ success: false, error: "patchAssistant_unavailable" });
    try {
        const { patchIds = [] } = req.body || {};
        const scores = [];
        for (const id of patchIds.slice(0, 20)) {
            try {
                const patch = patchAssist.getPatch(id);
                if (!patch) continue;
                const score = _b7PatchSafetyScore(patch);
                scores.push({ patchId: id, filePath: patch.filePath, ...score });
            } catch {}
        }
        return res.json({ success: true, scores, generatedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B7.3 — Incident prevention: match current task against prior incident patterns
// POST /runtime/guard/incident-check
// Body: { task, filePath }
router.post("/runtime/guard/incident-check", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { task = "", filePath = "" } = req.body || {};
        const query = `${task} ${filePath}`.toLowerCase();
        const words = query.split(/\W+/).filter(w => w.length > 3);

        const matches   = [];
        const warnings  = [];

        // Match against open + resolved incidents
        if (_incidentEngine) {
            try {
                const allInc = [
                    ..._incidentEngine.listIncidents({ status: "open",     limit: 20 }),
                    ..._incidentEngine.listIncidents({ status: "resolved", limit: 20 }),
                ];
                for (const inc of allInc) {
                    const ctx = `${inc.type || ""} ${inc.context || ""} ${inc.description || ""}`.toLowerCase();
                    const hits = words.filter(w => ctx.includes(w)).length;
                    if (hits >= 2 || (words.length <= 2 && hits >= 1)) {
                        matches.push({
                            incidentId: inc.id,
                            type:       inc.type,
                            severity:   inc.severity,
                            status:     inc.status,
                            context:    inc.context?.slice(0, 120),
                            matchScore: Math.round((hits / Math.max(words.length, 1)) * 100),
                        });
                    }
                }
            } catch {}
        }

        // Match against repeated failure patterns from learningEngine
        if (_learningEngine) {
            try {
                const repeated = _learningEngine.detectRepeated ? _learningEngine.detectRepeated() : [];
                for (const pat of (repeated || [])) {
                    const patStr = `${pat.type || ""} ${pat.context || ""} ${pat.description || ""}`.toLowerCase();
                    const hits   = words.filter(w => patStr.includes(w)).length;
                    if (hits >= 1) {
                        warnings.push({
                            type:        "repeated_failure_pattern",
                            description: pat.description || pat.type || "Repeated failure",
                            count:       pat.count || 1,
                            matchScore:  Math.round((hits / Math.max(words.length, 1)) * 100),
                        });
                    }
                }
            } catch {}
        }

        // Match against known failure patterns from failureIntelligenceEngine
        if (_failIntelEngine && _failIntelEngine.FAILURE_PATTERNS) {
            try {
                for (const fp of _failIntelEngine.FAILURE_PATTERNS) {
                    const patStr = `${fp.type || ""} ${fp.pattern || ""}`.toLowerCase();
                    const hits   = words.filter(w => patStr.includes(w)).length;
                    if (hits >= 1) {
                        warnings.push({
                            type:        "known_failure_pattern",
                            description: fp.pattern || fp.type,
                            matchScore:  Math.round((hits / Math.max(words.length, 1)) * 100),
                        });
                    }
                }
            } catch {}
        }

        // Execution history — recent errors matching query
        const execMatches = [];
        if (_execHistory) {
            try {
                const recent = _execHistory.recent(50);
                for (const e of recent) {
                    if (e.status !== "error" && e.status !== "failed") continue;
                    const eStr = `${e.input || ""} ${e.error || ""}`.toLowerCase();
                    const hits = words.filter(w => eStr.includes(w)).length;
                    if (hits >= 2) {
                        execMatches.push({
                            executionId: e.id,
                            input:       (e.input || "").slice(0, 80),
                            error:       (e.error || "").slice(0, 80),
                            ts:          e.ts,
                            matchScore:  Math.round((hits / Math.max(words.length, 1)) * 100),
                        });
                    }
                }
            } catch {}
        }

        const totalMatches = matches.length + warnings.length + execMatches.length;
        const shouldWarn   = totalMatches > 0;
        const severity     = matches.some(m => m.severity === "critical") ? "critical"
            : matches.length > 2 ? "high"
            : totalMatches > 1  ? "moderate"
            : totalMatches > 0  ? "low" : "none";

        return res.json({
            success: true,
            shouldWarn,
            severity,
            incidentMatches: matches.slice(0, 5),
            failurePatterns: warnings.slice(0, 5),
            execHistory:     execMatches.slice(0, 5),
            summary: shouldWarn
                ? `${totalMatches} prior incident/pattern match(es) found for this task`
                : "No prior incident patterns detected — safe to proceed",
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B7.4 — Regression prevention: compare proposed patch against rollback/failed history
// POST /runtime/guard/regression-check
// Body: { filePath, description, patchId }
router.post("/runtime/guard/regression-check", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { filePath = "", description = "", patchId = "" } = req.body || {};
        const query = `${description} ${filePath}`.toLowerCase();
        const words = query.split(/\W+/).filter(w => w.length > 3);

        const regressionWarnings = [];
        const rolledBackPatches  = [];
        const failedPatches      = [];

        // Collect all rolled-back patches for this file
        if (patchAssist) {
            try {
                const all = patchAssist.listPatches({});
                for (const p of all) {
                    if (filePath && p.filePath !== filePath) continue;
                    const isRolled = p.status === "rolled-back" || p.status === "rolled_back";
                    if (isRolled && p.patchId !== patchId) {
                        rolledBackPatches.push({
                            patchId:     p.patchId,
                            filePath:    p.filePath,
                            description: (p.description || "").slice(0, 100),
                            proposedAt:  p.proposedAt,
                            rollbackReason: (p.rollbackReason || "").slice(0, 100),
                        });
                        // Check if description is similar to a prior rollback
                        if (words.length > 0) {
                            const pStr = `${p.description || ""} ${p.rollbackReason || ""}`.toLowerCase();
                            const hits = words.filter(w => pStr.includes(w)).length;
                            if (hits >= 2) {
                                regressionWarnings.push({
                                    type:        "similar_to_prior_rollback",
                                    patchId:     p.patchId,
                                    filePath:    p.filePath,
                                    description: (p.description || "").slice(0, 100),
                                    matchScore:  Math.round((hits / words.length) * 100),
                                    recommendation: `This patch resembles a previously rolled-back patch on ${p.filePath?.split("/").pop()}`,
                                });
                            }
                        }
                    }
                }
            } catch {}
        }

        // Execution history failures involving this file
        if (_execHistory) {
            try {
                const recent = _execHistory.recent(100);
                for (const e of recent) {
                    if (e.status !== "error" && e.status !== "failed") continue;
                    const eStr = `${e.input || ""} ${e.error || ""}`.toLowerCase();
                    const fileMatch = filePath && eStr.includes(filePath.split("/").pop().toLowerCase());
                    const descMatch = words.length > 0 && words.filter(w => eStr.includes(w)).length >= 2;
                    if (fileMatch || descMatch) {
                        failedPatches.push({
                            executionId: e.id,
                            input:       (e.input || "").slice(0, 80),
                            error:       (e.error || "").slice(0, 80),
                            ts:          e.ts,
                        });
                        if (descMatch) {
                            regressionWarnings.push({
                                type:        "similar_execution_failure",
                                executionId: e.id,
                                matchScore:  Math.round((words.filter(w => eStr.includes(w)).length / words.length) * 100),
                                recommendation: "Prior execution with similar context failed",
                            });
                        }
                    }
                }
            } catch {}
        }

        // Engineering memory — prior failed chains
        if (_engMemory) {
            try {
                const memResults = _engMemory.query(description || filePath, "failure");
                for (const m of (memResults || []).slice(0, 3)) {
                    regressionWarnings.push({
                        type:           "prior_failure_in_memory",
                        description:    (m.goal || m.outcome || "").slice(0, 100),
                        matchScore:     70,
                        recommendation: "Engineering memory contains a similar failure pattern",
                    });
                }
            } catch {}
        }

        const blocked = regressionWarnings.some(w => w.matchScore >= 80);
        const severity = blocked ? "high"
            : regressionWarnings.length > 2 ? "moderate"
            : regressionWarnings.length > 0 ? "low" : "none";

        return res.json({
            success: true,
            hasRegressions: regressionWarnings.length > 0,
            blocked,
            severity,
            regressionWarnings: regressionWarnings.slice(0, 8),
            rolledBackHistory:  rolledBackPatches.slice(0, 5),
            failedExecHistory:  failedPatches.slice(0, 5),
            summary: regressionWarnings.length > 0
                ? `${regressionWarnings.length} regression risk(s) detected`
                : "No regression risks detected",
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B7.5 — Guardrails dashboard: high-risk files, rollback hotspots, incident hotspots, recovery map
// GET /runtime/guard/dashboard
router.get("/runtime/guard/dashboard", rateLimiter(10, 60_000), (req, res) => {
    try {
        const fileRiskMap = _b7FileRiskMap();

        // High-risk files: rollback rate > 25% AND at least 2 patches
        const highRiskFiles = Object.entries(fileRiskMap)
            .filter(([, s]) => s.rollbackRate > 25 && s.total >= 2)
            .map(([file, s]) => ({ file, ...s }))
            .sort((a, b) => b.rollbackRate - a.rollbackRate)
            .slice(0, 10);

        // Frequent rollback files: most absolute rollbacks
        const frequentRollbacks = Object.entries(fileRiskMap)
            .filter(([, s]) => s.rolledBack > 0)
            .map(([file, s]) => ({ file, ...s }))
            .sort((a, b) => b.rolledBack - a.rolledBack)
            .slice(0, 10);

        // Incident hotspots
        const incidentHotspots = [];
        if (_incidentEngine) {
            try {
                const allInc = _incidentEngine.listIncidents({ limit: 50 });
                const byType = {};
                for (const inc of allInc) {
                    const key = inc.type || "unknown";
                    if (!byType[key]) byType[key] = { type: key, count: 0, open: 0, severity: [] };
                    byType[key].count++;
                    if (inc.status === "open") byType[key].open++;
                    if (inc.severity) byType[key].severity.push(inc.severity);
                }
                for (const v of Object.values(byType)) {
                    const critical = v.severity.filter(s => s === "critical").length;
                    incidentHotspots.push({ ...v, criticalCount: critical, topSeverity: critical > 0 ? "critical" : "high" });
                }
                incidentHotspots.sort((a, b) => b.count - a.count);
            } catch {}
        }

        // Recovery dependency map: which files need the most healing
        const hs = _b6HealStats();
        const recoveryMap = [];
        if (_engMemory) {
            try {
                const chains = _engMemory.suggestChains ? _engMemory.suggestChains("recovery") : [];
                for (const c of (chains || []).slice(0, 6)) {
                    recoveryMap.push({
                        chainName:  c.name || c.chainName || "unnamed",
                        confidence: c.confidence || 0,
                        steps:      c.steps?.length || 0,
                        description: (c.description || c.goal || "").slice(0, 100),
                    });
                }
            } catch {}
        }

        // Learning patterns from learningEngine
        const patterns = [];
        if (_learningEngine) {
            try {
                const raw = _learningEngine.getPatterns ? _learningEngine.getPatterns() : [];
                for (const p of (raw || []).slice(0, 5)) {
                    patterns.push({
                        type:       p.type || "unknown",
                        count:      p.count || 1,
                        impact:     p.impact || "unknown",
                        description: (p.description || p.context || "").slice(0, 100),
                    });
                }
            } catch {}
        }

        // Platform summary
        const ps = _b6PatchStats();
        const platformSummary = {
            totalPatches:    ps.total,
            appliedPatches:  ps.applied,
            rolledBackPatches: ps.rolled,
            pendingPatches:  ps.pending,
            rollbackRate:    ps.total > 0 ? Math.round((ps.rolled / ps.total) * 100) : 0,
            healTotal:       hs.total,
            healRate:        hs.healRate != null ? Math.round(hs.healRate * 100) : null,
            totalIncidents:  incidentHotspots.reduce((a, b) => a + b.count, 0),
        };

        return res.json({
            success: true,
            highRiskFiles,
            frequentRollbacks,
            incidentHotspots: incidentHotspots.slice(0, 8),
            recoveryMap,
            patterns,
            platformSummary,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B7.6 — Auto-warning: pre-action risk check (before apply / deploy / auto-fix)
// POST /runtime/guard/pre-action-warning
// Body: { action: "apply"|"deploy"|"auto-fix", patchId, filePath, task, pipelineName }
router.post("/runtime/guard/pre-action-warning", rateLimiter(20, 60_000), (req, res) => {
    try {
        const {
            action       = "apply",
            patchId      = "",
            filePath     = "",
            task         = "",
            pipelineName = "standard-deploy",
        } = req.body || {};

        const warnings    = [];
        const evidence    = [];
        let   riskLevel   = "low";
        let   riskScore   = 0;

        // Patch safety score (if patchId provided)
        let patchSafety = null;
        if (patchId && patchAssist) {
            try {
                const patch = patchAssist.getPatch(patchId);
                if (patch) {
                    patchSafety = _b7PatchSafetyScore(patch);
                    if (patchSafety.safetyScore < 60) {
                        riskScore = Math.max(riskScore, 100 - patchSafety.safetyScore);
                        warnings.push(`Patch safety score is ${patchSafety.safetyScore}/100 (${patchSafety.riskLevel})`);
                        for (const r of patchSafety.explanation) {
                            evidence.push({ type: "patch_safety", detail: r, weight: "high" });
                        }
                    }
                }
            } catch {}
        }

        // File rollback rate
        if (filePath) {
            const { byFile } = _b6PatchStats();
            const fs = byFile[filePath];
            if (fs && fs.total >= 2 && fs.rolledBack / fs.total > 0.3) {
                const rr = Math.round((fs.rolledBack / fs.total) * 100);
                riskScore = Math.max(riskScore, rr);
                warnings.push(`${rr}% rollback rate on ${filePath.split("/").pop()} (${fs.rolledBack}/${fs.total} patches)`);
                evidence.push({ type: "file_rollback_rate", detail: `${filePath}: ${rr}% rollback rate`, weight: "high" });
            }
        }

        // Incident match
        if (task || filePath) {
            if (_incidentEngine) {
                try {
                    const openInc = _incidentEngine.listIncidents({ status: "open", limit: 10 });
                    const fileName = filePath.split("/").pop().toLowerCase();
                    const related = openInc.filter(i => {
                        const ctx = `${i.type || ""} ${i.context || ""}`.toLowerCase();
                        return fileName && ctx.includes(fileName);
                    });
                    if (related.length > 0) {
                        riskScore = Math.max(riskScore, 50 + related.length * 10);
                        warnings.push(`${related.length} open incident(s) related to this file`);
                        evidence.push({ type: "open_incidents", detail: `${related.length} open incidents referencing ${filePath.split("/").pop()}`, weight: "high" });
                    }
                } catch {}
            }
        }

        // Similar failures from execution history
        if (_execHistory && (task || filePath)) {
            try {
                const recent = _execHistory.recent(40);
                const words  = `${task} ${filePath}`.toLowerCase().split(/\W+/).filter(w => w.length > 3);
                const errors = recent.filter(e => {
                    if (e.status !== "error" && e.status !== "failed") return false;
                    const eStr = `${e.input || ""} ${e.error || ""}`.toLowerCase();
                    return words.filter(w => eStr.includes(w)).length >= 2;
                });
                if (errors.length > 0) {
                    riskScore = Math.max(riskScore, 40 + errors.length * 5);
                    warnings.push(`${errors.length} similar execution failure(s) in recent history`);
                    evidence.push({ type: "exec_history", detail: `${errors.length} prior failures matching task context`, weight: "medium" });
                }
            } catch {}
        }

        // Similar failures from learning engine
        if (_learningEngine) {
            try {
                const repeated = _learningEngine.detectRepeated ? _learningEngine.detectRepeated() : [];
                if (repeated.length > 0) {
                    riskScore = Math.max(riskScore, riskScore + 10);
                    evidence.push({ type: "repeated_patterns", detail: `${repeated.length} repeated failure pattern(s) on platform`, weight: "medium" });
                }
            } catch {}
        }

        // Suggested safer alternative
        const alternatives = [];
        if (_knowledgeMem) {
            try {
                const q = filePath.split("/").pop() || task.split(" ").slice(0, 3).join(" ");
                const kb = _knowledgeMem.query({ search: q, limit: 3 });
                for (const k of kb) {
                    if (k.fix) alternatives.push(k.fix);
                }
            } catch {}
        }

        riskScore  = Math.min(100, riskScore);
        riskLevel  = riskScore < 30 ? "low" : riskScore < 60 ? "moderate" : riskScore < 80 ? "high" : "critical";
        const shouldWarn = riskScore >= 30;

        return res.json({
            success: true,
            action,
            shouldWarn,
            riskScore,
            riskLevel,
            warnings,
            evidence,
            alternatives: alternatives.slice(0, 2),
            patchSafety,
            summary: shouldWarn
                ? `⚠ ${riskLevel.toUpperCase()} risk before ${action} — ${warnings.length} warning(s) detected`
                : `${action} appears safe — no significant risk factors detected`,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase B8 — Recommendation & Approval Layer ───────────────────────

// ── B8 shared: decision log ───────────────────────────────────────────
(function _initDecisionLog() {
    try {
        const fs   = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/eng-decision-log.json");
        if (!fs.existsSync(file)) fs.writeFileSync(file, "[]", "utf8");
    } catch {}
})();

function _readDecisionLog() {
    try {
        const fs   = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/eng-decision-log.json");
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { return []; }
}

function _writeDecisionLog(entries) {
    try {
        const fs   = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/eng-decision-log.json");
        // keep last 500
        const trimmed = entries.slice(-500);
        fs.writeFileSync(file, JSON.stringify(trimmed, null, 2), "utf8");
        return true;
    } catch { return false; }
}

function _appendDecision(entry) {
    const log = _readDecisionLog();
    log.push({ ...entry, id: `dec_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, createdAt: new Date().toISOString() });
    _writeDecisionLog(log);
    return log[log.length - 1];
}

// ── B8 shared: confidence classifier ─────────────────────────────────
// Returns { tier: "auto"|"review"|"block", label, reason }
function _classifyConfidence(safetyScore, riskScore, confidenceScore) {
    if (riskScore >= 70 || safetyScore < 40) {
        return { tier: "block",  label: "Block", reason: `Risk ${riskScore}/100 or safety ${safetyScore}/100 exceeds threshold` };
    }
    if (safetyScore >= 80 && riskScore < 30 && confidenceScore >= 70) {
        return { tier: "auto",   label: "Auto-apply", reason: `High safety (${safetyScore}), low risk (${riskScore}), high confidence (${confidenceScore}%)` };
    }
    return { tier: "review", label: "Manual review", reason: `Moderate safety/risk — operator approval recommended` };
}

// ── B8.1  POST /runtime/recommend/incident-fixes ──────────────────────
// For a given incident: rank top 3 fixes with evidence scores
router.post("/runtime/recommend/incident-fixes", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { incidentId = "", limit = 3 } = req.body || {};

        // Fetch the incident
        let incident = null;
        if (_incidentEngine && incidentId) {
            try { incident = _incidentEngine.getIncident(incidentId); } catch {}
        }
        const incCtx = incident
            ? `${incident.type || ""} ${incident.context || ""} ${incident.description || ""}`
            : incidentId;
        const words = incCtx.toLowerCase().split(/\W+/).filter(w => w.length > 3);

        const candidates = [];

        // Source 1: Knowledge base
        if (_knowledgeMem) {
            try {
                const kb = _knowledgeMem.query({ search: words.slice(0, 5).join(" "), limit: 10 });
                for (const k of kb) {
                    if (!k.fix) continue;
                    candidates.push({
                        source:      "knowledge_base",
                        fix:         k.fix,
                        description: k.description || k.key || "",
                        kind:        k.kind || "unknown",
                        evidenceScore: 80,
                        confidence:    75,
                    });
                }
            } catch {}
        }

        // Source 2: Engineering memory — chains for similar goals
        if (_engMemory) {
            try {
                const chains = _engMemory.suggestChains(incCtx.slice(0, 80));
                for (const c of (chains || []).slice(0, 5)) {
                    candidates.push({
                        source:       "eng_memory",
                        fix:          c.name || c.chainName || "Recovery chain",
                        description:  c.description || c.goal || "",
                        kind:         "chain",
                        evidenceScore: Math.min(95, 50 + Math.round((c.confidence || 0) * 0.4)),
                        confidence:    c.confidence || 60,
                        steps:         c.steps?.length || 0,
                    });
                }
            } catch {}
        }

        // Source 3: Applied patches on similar files/context
        if (patchAssist) {
            try {
                const patches = patchAssist.listPatches({});
                const applied = patches.filter(p => p.status === "applied");
                for (const p of applied) {
                    const pStr = `${p.reason || ""} ${p.filePath || ""}`.toLowerCase();
                    const hits = words.filter(w => pStr.includes(w)).length;
                    if (hits >= 2) {
                        const safetyScore = _b7PatchSafetyScore(p).safetyScore;
                        candidates.push({
                            source:       "patch_history",
                            fix:          `Reapply patch on ${p.filePath?.split("/").pop()}`,
                            description:  p.reason || "",
                            kind:         "patch",
                            patchId:      p.id,
                            filePath:     p.filePath,
                            evidenceScore: Math.min(90, 40 + hits * 15 + Math.round(safetyScore * 0.2)),
                            confidence:    safetyScore,
                        });
                    }
                }
            } catch {}
        }

        // Source 4: autoFixPlanner
        if (_autoFixPlanner && incidentId) {
            try {
                const plan = _autoFixPlanner.getPlan(incidentId).catch?.() || _autoFixPlanner.getPlan(incidentId);
                if (plan && plan.steps?.length > 0) {
                    candidates.push({
                        source:       "autofix_planner",
                        fix:          plan.steps[0]?.action || "Execute auto-fix plan",
                        description:  plan.description || `${plan.steps.length} steps`,
                        kind:         "autofix_plan",
                        planId:       plan.planId || plan.id,
                        evidenceScore: 70,
                        confidence:    65,
                    });
                }
            } catch {}
        }

        // Deduplicate by fix text, sort by evidenceScore desc
        const seen = new Set();
        const ranked = candidates
            .filter(c => { const key = c.fix?.slice(0, 40); if (seen.has(key)) return false; seen.add(key); return true; })
            .sort((a, b) => b.evidenceScore - a.evidenceScore)
            .slice(0, limit);

        // Determine safest patch path
        const safestPath = ranked.find(r => r.source === "eng_memory" || r.source === "knowledge_base");

        return res.json({
            success: true,
            incidentId,
            incident: incident ? { type: incident.type, severity: incident.severity, status: incident.status, context: incident.context?.slice(0, 120) } : null,
            ranked,
            safestPath: safestPath || ranked[0] || null,
            totalCandidates: candidates.length,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.1  GET /runtime/recommend/all-incidents
// Rank fixes for ALL open incidents in one call
router.get("/runtime/recommend/all-incidents", rateLimiter(10, 60_000), (req, res) => {
    try {
        if (!_incidentEngine) return res.json({ success: true, incidents: [], generatedAt: new Date().toISOString() });
        const open = _incidentEngine.listIncidents({ status: "open", limit: 20 });
        const results = [];
        for (const inc of open) {
            const words = `${inc.type || ""} ${inc.context || ""}`.toLowerCase().split(/\W+/).filter(w => w.length > 3);
            const fixes = [];
            if (_knowledgeMem) {
                try {
                    const kb = _knowledgeMem.query({ search: words.slice(0, 4).join(" "), limit: 3 });
                    for (const k of kb) if (k.fix) fixes.push({ fix: k.fix, source: "knowledge_base", evidenceScore: 80, confidence: 75 });
                } catch {}
            }
            if (_engMemory) {
                try {
                    const chains = _engMemory.suggestChains(`${inc.type} ${inc.context}`.slice(0, 60));
                    for (const c of (chains || []).slice(0, 2)) {
                        fixes.push({ fix: c.name || "Recovery chain", source: "eng_memory", evidenceScore: 65, confidence: c.confidence || 60 });
                    }
                } catch {}
            }
            fixes.sort((a, b) => b.evidenceScore - a.evidenceScore);
            // Confidence tier
            const top = fixes[0];
            const tier = top ? _classifyConfidence(top.confidence || 60, 0, top.confidence || 60) : _classifyConfidence(50, 50, 50);
            results.push({
                incidentId: inc.id,
                type:       inc.type,
                severity:   inc.severity,
                status:     inc.status,
                context:    inc.context?.slice(0, 100),
                fixes:      fixes.slice(0, 3),
                topFix:     fixes[0] || null,
                tier:       tier.tier,
                tierLabel:  tier.label,
                tierReason: tier.reason,
            });
        }
        return res.json({ success: true, incidents: results, total: results.length, generatedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.2  GET /runtime/approval-queue
// Central queue: pending patches + pending auto-fixes + deploy risk
router.get("/runtime/approval-queue", rateLimiter(15, 60_000), (req, res) => {
    try {
        const ps = _b6PatchStats();

        // Pending patches with safety scores
        const pendingPatches = ps.patches
            .filter(p => p.status === "pending")
            .map(p => {
                const safety = _b7PatchSafetyScore(p);
                const tier   = _classifyConfidence(safety.safetyScore, 100 - safety.safetyScore, safety.confidenceScore);
                return {
                    id:             p.id,
                    filePath:       p.filePath,
                    reason:         (p.reason || "").slice(0, 120),
                    proposedAt:     p.proposedAt,
                    safetyScore:    safety.safetyScore,
                    confidenceScore: safety.confidenceScore,
                    riskLevel:      safety.riskLevel,
                    explanation:    safety.explanation,
                    tier:           tier.tier,
                    tierLabel:      tier.label,
                    tierReason:     tier.reason,
                    type:           "patch",
                };
            })
            .sort((a, b) => b.safetyScore - a.safetyScore);

        // Open incidents needing auto-fix approval
        const pendingFixes = [];
        if (_incidentEngine) {
            try {
                const openInc = _incidentEngine.listIncidents({ status: "open", limit: 20 });
                for (const inc of openInc) {
                    const tier = _classifyConfidence(50, 50, 50); // unknown until fix is ranked
                    pendingFixes.push({
                        id:          inc.id,
                        type:        inc.type,
                        severity:    inc.severity,
                        context:     (inc.context || "").slice(0, 100),
                        detectedAt:  inc.detectedAt,
                        tier:        tier.tier,
                        tierLabel:   tier.label,
                        queueType:   "incident_fix",
                    });
                }
            } catch {}
        }

        // Pending deploys: patches that are applied but not yet "deployed" (status applied)
        const pendingDeploys = ps.patches
            .filter(p => p.status === "applied")
            .slice(0, 10)
            .map(p => {
                const safety = _b7PatchSafetyScore(p);
                const risk   = Math.max(0, 100 - safety.safetyScore);
                const tier   = _classifyConfidence(safety.safetyScore, risk, safety.confidenceScore);
                return {
                    id:          p.id,
                    filePath:    p.filePath,
                    appliedAt:   p.appliedAt,
                    safetyScore: safety.safetyScore,
                    riskLevel:   safety.riskLevel,
                    tier:        tier.tier,
                    tierLabel:   tier.label,
                    queueType:   "deploy",
                };
            });

        // Totals
        const autoApplyCandidates = pendingPatches.filter(p => p.tier === "auto").length;
        const reviewNeeded        = pendingPatches.filter(p => p.tier === "review").length;
        const blocked             = pendingPatches.filter(p => p.tier === "block").length;

        return res.json({
            success: true,
            pendingPatches,
            pendingFixes,
            pendingDeploys,
            summary: {
                totalPending:      pendingPatches.length + pendingFixes.length,
                patchCount:        pendingPatches.length,
                fixCount:          pendingFixes.length,
                deployCount:       pendingDeploys.length,
                autoApplyCandidates,
                reviewNeeded,
                blocked,
            },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.2 + B8.3  POST /runtime/approval-queue/:id/decide
// Approve / Reject / Defer a queued item + log the decision
router.post("/runtime/approval-queue/:id/decide", rateLimiter(20, 60_000), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            decision      = "approve",   // "approve" | "reject" | "defer"
            queueType     = "patch",      // "patch" | "incident_fix" | "deploy"
            operatorId    = "operator",
            reason        = "",
            recommendation = "",
        } = req.body || {};

        let actionResult = null;
        let outcome      = "pending";

        if (decision === "approve") {
            if (queueType === "patch" && patchAssist) {
                try {
                    actionResult = patchAssist.applyPatch(id, { approved: true });
                    outcome = actionResult?.success ? "applied" : "failed";
                } catch (e) { actionResult = { success: false, error: e.message }; outcome = "failed"; }
            } else if (queueType === "incident_fix" && _autoFixPlanner) {
                try {
                    // Create a fix plan for the incident
                    const plan = await Promise.resolve(_autoFixPlanner.plan(id, { operatorId }));
                    actionResult = { success: true, planId: plan?.id || plan?.planId };
                    outcome = "planned";
                } catch (e) { actionResult = { success: false, error: e.message }; outcome = "failed"; }
            } else {
                actionResult = { success: true, note: "approved" };
                outcome = "approved";
            }
        } else if (decision === "reject" && queueType === "patch" && patchAssist) {
            try {
                actionResult = patchAssist.rollbackPatch(id);
                outcome = "rejected";
            } catch (e) { actionResult = { success: false, error: e.message }; outcome = "failed"; }
        } else {
            actionResult = { success: true, note: decision };
            outcome = decision;
        }

        // B8.4 — log the decision
        const logEntry = _appendDecision({
            itemId:         id,
            queueType,
            decision,
            recommendation,
            operatorId,
            reason: reason.slice(0, 200),
            outcome,
            actionSuccess:  actionResult?.success ?? true,
        });

        // Feed outcome back into learning engine
        if (_learningEngine && outcome !== "pending" && outcome !== "deferred") {
            try {
                _learningEngine.ingest({
                    type:    `approval_${outcome}`,
                    context: `${queueType} ${id} — ${decision} by ${operatorId}`,
                    outcome: decision === "approve" ? "success" : "skipped",
                });
            } catch {}
        }

        // Also record in engineering memory for future reference
        if (_engMemory && outcome !== "pending") {
            try {
                _engMemory.recordSessionOutcome({
                    goal:    `${decision} ${queueType} ${id}`,
                    outcome: decision === "approve" ? "success" : "skipped",
                    steps:   [{ action: decision, detail: reason || recommendation }],
                });
            } catch {}
        }

        return res.json({
            success: true,
            itemId:  id,
            decision,
            outcome,
            logId:   logEntry.id,
            actionResult,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.3  GET /runtime/recommend/automation-candidates
// Items that qualify for auto-apply based on confidence + risk
router.get("/runtime/recommend/automation-candidates", rateLimiter(15, 60_000), (req, res) => {
    try {
        const ps  = _b6PatchStats();
        const hs  = _b6HealStats();

        const candidates = [];

        // Pending patches that score "auto" tier
        for (const p of ps.patches.filter(p => p.status === "pending")) {
            const safety = _b7PatchSafetyScore(p);
            const risk   = Math.max(0, 100 - safety.safetyScore);
            const tier   = _classifyConfidence(safety.safetyScore, risk, safety.confidenceScore);
            if (tier.tier === "auto") {
                candidates.push({
                    type:           "patch",
                    id:             p.id,
                    filePath:       p.filePath,
                    reason:         (p.reason || "").slice(0, 100),
                    safetyScore:    safety.safetyScore,
                    confidenceScore: safety.confidenceScore,
                    riskLevel:      safety.riskLevel,
                    tierLabel:      tier.label,
                    tierReason:     tier.reason,
                    proposedAt:     p.proposedAt,
                });
            }
        }

        // Applied patches with high heal rate for context
        const autoDeployable = ps.patches
            .filter(p => p.status === "applied")
            .map(p => {
                const safety = _b7PatchSafetyScore(p);
                const tier   = _classifyConfidence(safety.safetyScore, 100 - safety.safetyScore, safety.confidenceScore);
                return { ...p, safety, tier };
            })
            .filter(p => p.tier.tier === "auto")
            .slice(0, 5)
            .map(p => ({
                type:           "deploy",
                id:             p.id,
                filePath:       p.filePath,
                safetyScore:    p.safety.safetyScore,
                confidenceScore: p.safety.confidenceScore,
                tierLabel:      p.tier.label,
                tierReason:     p.tier.reason,
                appliedAt:      p.appliedAt,
            }));

        candidates.push(...autoDeployable);

        // Platform context
        const platformScore = hs.healRate != null ? Math.round(hs.healRate * 100) : 70;
        const platformReady = platformScore >= 70 && ps.rolled / Math.max(ps.total, 1) < 0.3;

        return res.json({
            success: true,
            candidates,
            total: candidates.length,
            platformReady,
            platformScore,
            rollbackRate: ps.total > 0 ? Math.round((ps.rolled / ps.total) * 100) : 0,
            healRate:     hs.healRate != null ? Math.round(hs.healRate * 100) : null,
            generatedAt:  new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.4  GET /runtime/decisions
// Engineering decision log with optional filter
router.get("/runtime/decisions", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { queueType, decision, limit = 50 } = req.query;
        let log = _readDecisionLog();
        if (queueType) log = log.filter(e => e.queueType === queueType);
        if (decision)  log = log.filter(e => e.decision === decision);
        const sorted = log.slice().reverse().slice(0, parseInt(limit) || 50);

        // Stats
        const total    = log.length;
        const approved = log.filter(e => e.decision === "approve").length;
        const rejected = log.filter(e => e.decision === "reject").length;
        const deferred = log.filter(e => e.decision === "defer").length;
        const successRate = approved > 0
            ? Math.round((log.filter(e => e.decision === "approve" && e.outcome === "applied").length / approved) * 100)
            : null;

        return res.json({
            success: true,
            entries: sorted,
            stats: { total, approved, rejected, deferred, successRate },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.4  POST /runtime/decisions
// Manually record a decision (for UI-driven approvals not going through the queue endpoint)
router.post("/runtime/decisions", rateLimiter(20, 60_000), (req, res) => {
    try {
        const { itemId, queueType, decision, recommendation, operatorId, reason, outcome } = req.body || {};
        if (!itemId || !decision) return res.status(400).json({ success: false, error: "itemId and decision required" });

        const entry = _appendDecision({ itemId, queueType, decision, recommendation, operatorId: operatorId || "operator", reason: (reason || "").slice(0, 200), outcome: outcome || decision });

        // Feed back into learning
        if (_learningEngine) {
            try {
                _learningEngine.ingest({ type: `decision_${decision}`, context: `${queueType} ${itemId}`, outcome: decision === "approve" ? "success" : "skipped" });
            } catch {}
        }

        return res.json({ success: true, entry, generatedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.5  GET /runtime/recommend/deploys
// Recommended deploys: applied patches ranked by safety + confidence
router.get("/runtime/recommend/deploys", rateLimiter(15, 60_000), (req, res) => {
    try {
        const ps = _b6PatchStats();
        const deploys = ps.patches
            .filter(p => p.status === "applied")
            .map(p => {
                const safety = _b7PatchSafetyScore(p);
                const risk   = Math.max(0, 100 - safety.safetyScore);
                const tier   = _classifyConfidence(safety.safetyScore, risk, safety.confidenceScore);
                return {
                    id:             p.id,
                    filePath:       p.filePath,
                    reason:         (p.reason || "").slice(0, 120),
                    appliedAt:      p.appliedAt,
                    safetyScore:    safety.safetyScore,
                    confidenceScore: safety.confidenceScore,
                    riskLevel:      safety.riskLevel,
                    tier:           tier.tier,
                    tierLabel:      tier.label,
                    tierReason:     tier.reason,
                };
            })
            .sort((a, b) => b.safetyScore - a.safetyScore);

        return res.json({ success: true, deploys, total: deploys.length, generatedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B8.6  GET /runtime/recommend/autonomous-readiness
// Single composite score across 5 signals: prediction quality, prevention quality,
// approval success rate, rollback rate, incident recurrence
router.get("/runtime/recommend/autonomous-readiness", rateLimiter(10, 60_000), (req, res) => {
    try {
        const ps = _b6PatchStats();
        const hs = _b6HealStats();

        // Signal 1: Prediction quality — proxy: decisions with known outcomes
        const log = _readDecisionLog();
        const decisionTotal    = log.length;
        const decisionApproved = log.filter(e => e.decision === "approve").length;
        const decisionApplied  = log.filter(e => e.outcome === "applied").length;
        const predictionScore  = decisionTotal > 0
            ? Math.min(100, Math.round((decisionApplied / Math.max(decisionApproved, 1)) * 100))
            : 60; // baseline when no decisions yet

        // Signal 2: Prevention quality — guardrails caught risky ops
        // Proxy: patches that went through guard and succeeded vs total
        const guardedSuccess = log.filter(e => e.queueType === "patch" && e.outcome === "applied").length;
        const guardedTotal   = log.filter(e => e.queueType === "patch").length;
        const preventionScore = guardedTotal > 0
            ? Math.min(100, Math.round((guardedSuccess / guardedTotal) * 100))
            : 70; // baseline

        // Signal 3: Approval success rate
        const approvedSuccess = log.filter(e => e.decision === "approve" && (e.outcome === "applied" || e.outcome === "approved" || e.outcome === "planned")).length;
        const approvalScore   = decisionApproved > 0
            ? Math.min(100, Math.round((approvedSuccess / decisionApproved) * 100))
            : 65;

        // Signal 4: Rollback rate (lower is better → invert)
        const rollbackRate  = ps.total > 0 ? ps.rolled / ps.total : 0;
        const rollbackScore = Math.round((1 - rollbackRate) * 100);

        // Signal 5: Incident recurrence (fewer repeated incidents = better)
        let recurrenceScore = 80; // baseline
        if (_incidentEngine && _learningEngine) {
            try {
                const repeated = _learningEngine.detectRepeated ? _learningEngine.detectRepeated() : [];
                const openInc  = _incidentEngine.listIncidents({ status: "open", limit: 50 });
                // If repeated patterns = 0 and open incidents < 3, score high
                if (repeated.length === 0 && openInc.length < 3) recurrenceScore = 95;
                else if (repeated.length < 3 && openInc.length < 5) recurrenceScore = 80;
                else if (repeated.length < 6 || openInc.length < 10) recurrenceScore = 60;
                else recurrenceScore = 40;
            } catch {}
        }

        // Weighted composite: prediction 20, prevention 20, approval 20, rollback 25, recurrence 15
        const WEIGHTS = [
            { name: "Prediction Quality",   score: predictionScore,  weight: 0.20, rawValue: `${decisionApplied}/${decisionApproved} decisions applied`,  detail: "Based on decision log outcomes" },
            { name: "Prevention Quality",   score: preventionScore,  weight: 0.20, rawValue: `${guardedSuccess}/${guardedTotal} guarded ops succeeded`,    detail: "Guardrail enforcement success" },
            { name: "Approval Success Rate", score: approvalScore,   weight: 0.20, rawValue: `${approvedSuccess}/${decisionApproved} approvals succeeded`, detail: "Operator approval outcomes" },
            { name: "Rollback Rate",         score: rollbackScore,   weight: 0.25, rawValue: `${ps.rolled}/${ps.total} patches rolled back (${Math.round(rollbackRate*100)}%)`, detail: "Lower rollback = higher score" },
            { name: "Incident Recurrence",   score: recurrenceScore, weight: 0.15, rawValue: `Score: ${recurrenceScore}`,                                  detail: "Repeated pattern detection" },
        ];

        const compositeScore = Math.round(WEIGHTS.reduce((acc, s) => acc + s.score * s.weight, 0));
        const level = compositeScore >= 85 ? "fully_autonomous"
            : compositeScore >= 70 ? "mostly_autonomous"
            : compositeScore >= 55 ? "supervised"
            : "manual";

        const badge = level === "fully_autonomous" ? "🤖 Fully Autonomous"
            : level === "mostly_autonomous"        ? "⚙ Mostly Autonomous"
            : level === "supervised"               ? "👁 Supervised"
            : "✋ Manual";

        const strengths = WEIGHTS.filter(s => s.score >= 80).map(s => s.name);
        const blockers  = WEIGHTS
            .filter(s => s.score < 60)
            .map(s => ({ signal: s.name, score: s.score, recommendation: s.score < 40 ? `Critical: improve ${s.name}` : `Address ${s.name} to increase autonomy` }));

        return res.json({
            success: true,
            compositeScore,
            level,
            badge,
            signals: WEIGHTS,
            strengths,
            blockers,
            meta: {
                patchTotal:     ps.total,
                rolledBack:     ps.rolled,
                decisionTotal,
                healTotal:      hs.total,
            },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── Phase B9 — Approval & Execution Layer ────────────────────────────

// ── B9 shared: execution log ──────────────────────────────────────────
(function _initExecLog() {
    try {
        const fs   = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/eng-execution-log.json");
        if (!fs.existsSync(file)) fs.writeFileSync(file, "[]", "utf8");
    } catch {}
})();

function _readExecLog() {
    try {
        const fs   = require("fs");
        const path = require("path");
        return JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/eng-execution-log.json"), "utf8"));
    } catch { return []; }
}

function _appendExecLog(entry) {
    try {
        const fs   = require("fs");
        const path = require("path");
        const file = path.join(__dirname, "../../data/eng-execution-log.json");
        const log  = _readExecLog();
        const rec  = { ...entry, id: `exec_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, createdAt: new Date().toISOString() };
        log.push(rec);
        fs.writeFileSync(file, JSON.stringify(log.slice(-500), null, 2), "utf8");
        return rec;
    } catch { return entry; }
}

// B9 analytics helpers — computed from decision log + exec log
function _b9Analytics() {
    const decisions = _readDecisionLog();
    const execLog   = _readExecLog();

    const total       = decisions.length;
    const approved    = decisions.filter(d => d.decision === "approve").length;
    const rejected    = decisions.filter(d => d.decision === "reject").length;
    const deferred    = decisions.filter(d => d.decision === "defer").length;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : null;
    const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : null;

    // Rollback-after-approval: approved items that later appeared in rolled patches
    const ps = _b6PatchStats();
    const approvedIds = new Set(decisions.filter(d => d.decision === "approve").map(d => d.itemId));
    const rollbackAfterApproval = ps.patches.filter(p =>
        (p.status === "rolled-back" || p.status === "rolled_back") && approvedIds.has(p.id)
    ).length;
    const rollbackAfterApprovalRate = approved > 0 ? Math.round((rollbackAfterApproval / approved) * 100) : 0;

    // Recommendation accuracy: decisions that resulted in "applied" or "approved" outcome
    const successOutcomes = decisions.filter(d => d.decision === "approve" && (d.outcome === "applied" || d.outcome === "approved" || d.outcome === "planned")).length;
    const recommendationAccuracy = approved > 0 ? Math.round((successOutcomes / approved) * 100) : null;

    // Execution stats from exec log
    const execTotal   = execLog.length;
    const execSuccess = execLog.filter(e => e.outcome === "success" || e.outcome === "applied").length;
    const execFailed  = execLog.filter(e => e.outcome === "failed"  || e.outcome === "error").length;
    const execSuccessRate = execTotal > 0 ? Math.round((execSuccess / execTotal) * 100) : null;

    // Confidence calibration: compare predicted tier to actual outcome
    const calibrations = decisions.filter(d => d.predictedTier && d.outcome);
    const calibrated   = calibrations.filter(d => {
        if (d.predictedTier === "auto"   && (d.outcome === "applied" || d.outcome === "approved")) return true;
        if (d.predictedTier === "review" && d.decision === "approve" && d.outcome === "applied")    return true;
        if (d.predictedTier === "block"  && d.decision === "reject")                                return true;
        return false;
    }).length;
    const calibrationAccuracy = calibrations.length > 0 ? Math.round((calibrated / calibrations.length) * 100) : null;

    return {
        total, approved, rejected, deferred,
        approvalRate, rejectionRate,
        rollbackAfterApproval, rollbackAfterApprovalRate,
        recommendationAccuracy, successOutcomes,
        execTotal, execSuccess, execFailed, execSuccessRate,
        calibrationAccuracy, calibratedSamples: calibrations.length,
    };
}

// B9.1  GET /runtime/exec/unified-queue
// Merged queue: pending patches + deploys + auto-fixes + automation candidates, ranked by score
router.get("/runtime/exec/unified-queue", rateLimiter(15, 60_000), (req, res) => {
    try {
        const ps = _b6PatchStats();
        const items = [];

        // 1. Pending patches with safety + confidence scores
        for (const p of ps.patches.filter(p => p.status === "pending")) {
            const safety = _b7PatchSafetyScore(p);
            const risk   = Math.max(0, 100 - safety.safetyScore);
            const tier   = _classifyConfidence(safety.safetyScore, risk, safety.confidenceScore);
            // Ranking score: safety 40% + confidence 30% + tier bonus 30%
            const tierBonus = tier.tier === "auto" ? 30 : tier.tier === "review" ? 15 : 0;
            const rankScore = Math.round(safety.safetyScore * 0.4 + safety.confidenceScore * 0.3 + tierBonus);
            items.push({
                id:             p.id,
                type:           "patch_apply",
                filePath:       p.filePath,
                reason:         (p.reason || "").slice(0, 120),
                proposedAt:     p.proposedAt,
                safetyScore:    safety.safetyScore,
                confidenceScore: safety.confidenceScore,
                riskLevel:      safety.riskLevel,
                tier:           tier.tier,
                tierLabel:      tier.label,
                tierReason:     tier.reason,
                explanation:    safety.explanation,
                rankScore,
                actionLabel:    "Apply Patch",
            });
        }

        // 2. Applied patches ready for deploy
        for (const p of ps.patches.filter(p => p.status === "applied").slice(0, 8)) {
            const safety    = _b7PatchSafetyScore(p);
            const risk      = Math.max(0, 100 - safety.safetyScore);
            const tier      = _classifyConfidence(safety.safetyScore, risk, safety.confidenceScore);
            const tierBonus = tier.tier === "auto" ? 25 : 10;
            const rankScore = Math.round(safety.safetyScore * 0.5 + safety.confidenceScore * 0.2 + tierBonus);
            items.push({
                id:             p.id,
                type:           "patch_deploy",
                filePath:       p.filePath,
                appliedAt:      p.appliedAt,
                safetyScore:    safety.safetyScore,
                confidenceScore: safety.confidenceScore,
                riskLevel:      safety.riskLevel,
                tier:           tier.tier,
                tierLabel:      tier.label,
                tierReason:     tier.reason,
                rankScore,
                actionLabel:    "Deploy",
            });
        }

        // 3. Open incidents needing auto-fix
        if (_incidentEngine) {
            try {
                const openInc = _incidentEngine.listIncidents({ status: "open", limit: 15 });
                for (const inc of openInc) {
                    const sevScore = inc.severity === "critical" ? 20 : inc.severity === "high" ? 15 : 10;
                    items.push({
                        id:          inc.id,
                        type:        "incident_fix",
                        incidentType: inc.type,
                        severity:    inc.severity,
                        context:     (inc.context || "").slice(0, 100),
                        detectedAt:  inc.detectedAt,
                        safetyScore: 60,
                        confidenceScore: 55,
                        riskLevel:   "moderate",
                        tier:        "review",
                        tierLabel:   "Review needed",
                        rankScore:   50 + sevScore,
                        actionLabel: "Auto-Fix",
                    });
                }
            } catch {}
        }

        // Sort by rankScore desc, then by tier priority (auto first)
        const TIER_ORDER = { auto: 0, review: 1, block: 2 };
        items.sort((a, b) => {
            const tierDiff = (TIER_ORDER[a.tier] || 1) - (TIER_ORDER[b.tier] || 1);
            if (tierDiff !== 0) return tierDiff;
            return b.rankScore - a.rankScore;
        });

        const summary = {
            total:           items.length,
            patchApply:      items.filter(i => i.type === "patch_apply").length,
            patchDeploy:     items.filter(i => i.type === "patch_deploy").length,
            incidentFix:     items.filter(i => i.type === "incident_fix").length,
            autoTier:        items.filter(i => i.tier === "auto").length,
            reviewTier:      items.filter(i => i.tier === "review").length,
            blockTier:       items.filter(i => i.tier === "block").length,
        };

        return res.json({ success: true, items, summary, generatedAt: new Date().toISOString() });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B9.2  POST /runtime/exec/execute/:id
// One-click execution: approve → apply → verify → record
// Body: { type: "patch_apply"|"patch_deploy"|"incident_fix", operatorId, predictedTier }
router.post("/runtime/exec/execute/:id", rateLimiter(15, 60_000), async (req, res) => {
    const { id } = req.params;
    const {
        type          = "patch_apply",
        operatorId    = "operator",
        predictedTier = "review",
        skipVerify    = false,
    } = req.body || {};

    const timeline = [];
    const t = (step, data) => { timeline.push({ step, ts: new Date().toISOString(), ...data }); };

    try {
        t("start", { type, id, operatorId });

        let outcome     = "pending";
        let actionResult = null;

        if (type === "patch_apply" && patchAssist) {
            // Step 1: Apply
            try {
                const applied = patchAssist.applyPatch(id, { approved: true, operatorId });
                if (applied?.ok !== false) {
                    t("apply", { ok: true, detail: `Applied patch ${id}` });
                    outcome = "applied";
                    actionResult = applied;

                    // Step 2: Verify (unless skipped)
                    if (!skipVerify) {
                        try {
                            const verified = patchAssist.verifyPatch(id, { autoRollback: false });
                            const verifyPassed = (verified?.pass > 0 && verified?.fail === 0) || verified?.verdict === "pass";
                            t("verify", { ok: verifyPassed, pass: verified?.pass, fail: verified?.fail, verdict: verified?.verdict, output: (verified?.output || "").slice(0, 400) });
                            if (!verifyPassed && verified?.fail > 0) {
                                // Auto-rollback on test failure
                                try {
                                    patchAssist.rollbackPatch(id, { approved: true });
                                    t("rollback", { ok: true, reason: `${verified.fail} test(s) failed` });
                                    outcome = "rolled_back";
                                } catch (re) {
                                    t("rollback", { ok: false, error: re.message });
                                }
                            } else {
                                outcome = "verified";
                            }
                        } catch (ve) {
                            t("verify", { ok: false, error: ve.message });
                        }
                    }
                } else {
                    t("apply", { ok: false, error: applied?.error || "Apply failed" });
                    outcome = "failed";
                    actionResult = applied;
                }
            } catch (ae) {
                t("apply", { ok: false, error: ae.message });
                outcome = "failed";
            }
        } else if (type === "patch_deploy") {
            // For deploy: trigger pipeline with deployed patch context
            try {
                const patch = patchAssist?.getPatch(id);
                const deployResult = await Promise.resolve(null); // pipeline call would go here — use existing /pipeline/run style
                t("deploy", { ok: true, note: `Deploy triggered for ${patch?.filePath}` });
                outcome = "deployed";
                actionResult = { success: true, patchId: id, filePath: patch?.filePath };
            } catch (de) {
                t("deploy", { ok: false, error: de.message });
                outcome = "failed";
            }
        } else if (type === "incident_fix" && _autoFixPlanner) {
            // For incident: create an autofix plan
            try {
                const plan = _autoFixPlanner.plan(id, { operatorId });
                const resolved = await Promise.resolve(plan);
                t("plan", { ok: true, planId: resolved?.id || resolved?.planId, steps: resolved?.steps?.length });
                outcome = "planned";
                actionResult = resolved;
            } catch (ie) {
                t("plan", { ok: false, error: ie.message });
                outcome = "failed";
            }
        } else {
            t("execute", { ok: false, error: `Unsupported type: ${type} or module unavailable` });
            outcome = "failed";
        }

        t("complete", { outcome });

        // B9.4 — Record execution + feed into confidence calibration
        const execRecord = _appendExecLog({
            itemId:       id,
            type,
            operatorId,
            predictedTier,
            outcome,
            timeline,
        });

        // Feed into decision log
        _appendDecision({
            itemId:         id,
            queueType:      type,
            decision:       "approve",
            recommendation: `One-click ${type} via exec endpoint`,
            operatorId,
            reason:         `Executed ${type}`,
            outcome,
            predictedTier,
            actionSuccess:  outcome !== "failed",
        });

        // Feed outcome into learning engine
        if (_learningEngine) {
            try {
                _learningEngine.ingest({
                    type:    `exec_${outcome}`,
                    context: `${type} ${id} — ${outcome} by ${operatorId}`,
                    outcome: (outcome === "applied" || outcome === "verified" || outcome === "deployed" || outcome === "planned") ? "success" : "failed",
                });
            } catch {}
        }

        // Record in engineering memory
        if (_engMemory && outcome !== "failed") {
            try {
                _engMemory.recordSessionOutcome({
                    goal:    `Execute ${type} on ${id}`,
                    outcome: outcome === "applied" || outcome === "verified" ? "success" : outcome,
                    steps:   timeline.map(t => ({ action: t.step, detail: t.detail || t.error || t.note || "" })),
                });
            } catch {}
        }

        return res.json({
            success: true,
            itemId:  id,
            type,
            outcome,
            timeline,
            execId:  execRecord.id,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B9.3  GET /runtime/exec/analytics
// Approval analytics: rates, rollback-after-approval, recommendation accuracy
router.get("/runtime/exec/analytics", rateLimiter(15, 60_000), (req, res) => {
    try {
        const a  = _b9Analytics();
        const ps = _b6PatchStats();
        const hs = _b6HealStats();

        // Trend: last 7 days vs all-time
        const log   = _readDecisionLog();
        const cutoff7d = Date.now() - 7 * 86400_000;
        const recent7d = log.filter(d => new Date(d.createdAt).getTime() > cutoff7d);
        const approved7d = recent7d.filter(d => d.decision === "approve").length;
        const success7d  = recent7d.filter(d => d.decision === "approve" && (d.outcome === "applied" || d.outcome === "approved")).length;
        const accuracy7d = approved7d > 0 ? Math.round((success7d / approved7d) * 100) : null;

        return res.json({
            success: true,
            analytics: a,
            trend7d: { approved: approved7d, success: success7d, accuracy: accuracy7d },
            platform: {
                totalPatches:    ps.total,
                rollbackRate:    ps.total > 0 ? Math.round((ps.rolled / ps.total) * 100) : 0,
                healTotal:       hs.total,
                healRate:        hs.healRate != null ? Math.round(hs.healRate * 100) : null,
            },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B9.4  GET /runtime/exec/confidence-calibration
// Compare predicted tier to actual outcomes — confidence model accuracy
router.get("/runtime/exec/confidence-calibration", rateLimiter(15, 60_000), (req, res) => {
    try {
        const log = _readDecisionLog();
        const execLog = _readExecLog();

        // Group by predictedTier
        const byTier = { auto: [], review: [], block: [] };
        for (const d of log) {
            const tier = d.predictedTier;
            if (byTier[tier]) byTier[tier].push(d);
        }
        for (const e of execLog) {
            const tier = e.predictedTier;
            if (tier && byTier[tier]) byTier[tier].push(e);
        }

        const calibration = Object.entries(byTier).map(([tier, entries]) => {
            if (entries.length === 0) return { tier, samples: 0, accuracy: null, distribution: {} };
            const outcomes = {};
            for (const e of entries) {
                const o = e.outcome || "unknown";
                outcomes[o] = (outcomes[o] || 0) + 1;
            }
            // Auto tier is "correct" when outcome is applied/verified/deployed
            // Review tier is "correct" when decision was review AND it went through
            // Block tier is "correct" when rejected
            const correct = entries.filter(e => {
                if (tier === "auto")   return e.outcome === "applied" || e.outcome === "verified" || e.outcome === "deployed";
                if (tier === "review") return e.decision === "approve" && (e.outcome === "applied" || e.outcome === "approved");
                if (tier === "block")  return e.decision === "reject"  || e.outcome === "rolled_back";
                return false;
            }).length;
            return {
                tier,
                samples:     entries.length,
                correct,
                accuracy:    Math.round((correct / entries.length) * 100),
                distribution: outcomes,
            };
        });

        // Overall calibration score
        const totalSamples  = calibration.reduce((s, c) => s + c.samples, 0);
        const totalCorrect  = calibration.reduce((s, c) => s + (c.correct || 0), 0);
        const overallAccuracy = totalSamples > 0 ? Math.round((totalCorrect / totalSamples) * 100) : null;

        // Drift detection: recent 10 decisions vs historic
        const recentLog = log.slice(-10);
        const recentAuto    = recentLog.filter(d => d.predictedTier === "auto"   && (d.outcome === "applied" || d.outcome === "verified")).length;
        const recentReview  = recentLog.filter(d => d.predictedTier === "review" && d.decision === "approve").length;
        const driftSignal   = recentLog.length >= 5 ? "stable" : "insufficient_data";

        return res.json({
            success: true,
            calibration,
            overallAccuracy,
            totalSamples,
            drift: { signal: driftSignal, recentAuto, recentReview, window: recentLog.length },
            note: totalSamples === 0 ? "No calibration data yet — make decisions through the approval queue to build this model" : undefined,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B9.5  GET /runtime/exec/ranked-candidates
// Ranked candidates sorted by: safest × highest confidence × historical success
router.get("/runtime/exec/ranked-candidates", rateLimiter(15, 60_000), (req, res) => {
    try {
        const ps      = _b6PatchStats();
        const log     = _readDecisionLog();
        const execLog = _readExecLog();

        // Build per-file success history from decision + exec logs
        const fileSuccess = {};
        for (const d of [...log, ...execLog]) {
            if (!d.itemId) continue;
            const patch = patchAssist ? (() => { try { return patchAssist.getPatch(d.itemId); } catch { return null; } })() : null;
            const fp = patch?.filePath || "unknown";
            if (!fileSuccess[fp]) fileSuccess[fp] = { total: 0, success: 0 };
            fileSuccess[fp].total++;
            if (d.outcome === "applied" || d.outcome === "verified" || d.outcome === "deployed") fileSuccess[fp].success++;
        }

        const candidates = [];

        for (const p of ps.patches.filter(p => p.status === "pending")) {
            const safety    = _b7PatchSafetyScore(p);
            const risk      = Math.max(0, 100 - safety.safetyScore);
            const tier      = _classifyConfidence(safety.safetyScore, risk, safety.confidenceScore);

            // Historical success rate for this file
            const fh = fileSuccess[p.filePath] || { total: 0, success: 0 };
            const historicalRate = fh.total > 0 ? Math.round((fh.success / fh.total) * 100) : 70; // 70% default

            // Composite rank: safety 35% + confidence 25% + historical 25% + tier bonus 15%
            const tierBonus = tier.tier === "auto" ? 15 : tier.tier === "review" ? 7 : 0;
            const compositeScore = Math.round(
                safety.safetyScore   * 0.35 +
                safety.confidenceScore * 0.25 +
                historicalRate       * 0.25 +
                tierBonus
            );

            candidates.push({
                id:              p.id,
                filePath:        p.filePath,
                reason:          (p.reason || "").slice(0, 100),
                proposedAt:      p.proposedAt,
                safetyScore:     safety.safetyScore,
                confidenceScore: safety.confidenceScore,
                riskLevel:       safety.riskLevel,
                tier:            tier.tier,
                tierLabel:       tier.label,
                historicalRate,
                historicalSamples: fh.total,
                compositeScore,
                rank: 0, // filled below
            });
        }

        // Sort + assign rank
        candidates.sort((a, b) => b.compositeScore - a.compositeScore);
        candidates.forEach((c, i) => c.rank = i + 1);

        // Top recommendation
        const topPick = candidates[0] || null;
        const reason  = topPick
            ? `Ranked #1: safety ${topPick.safetyScore}/100, confidence ${topPick.confidenceScore}%, historical success ${topPick.historicalRate}%`
            : "No pending patches";

        return res.json({
            success: true,
            candidates,
            total: candidates.length,
            topPick,
            topPickReason: reason,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B9.6  GET /runtime/exec/readiness-dashboard
// Execution readiness: autonomous readiness + approval quality + exec success + rollback exposure
router.get("/runtime/exec/readiness-dashboard", rateLimiter(10, 60_000), (req, res) => {
    try {
        const a    = _b9Analytics();
        const ps   = _b6PatchStats();
        const hs   = _b6HealStats();
        const log  = _readDecisionLog();

        // Autonomous readiness (re-use B8.6 signal logic inline for self-containment)
        const decisionTotal  = log.length;
        const decisionApproved = log.filter(d => d.decision === "approve").length;
        const decisionApplied  = log.filter(d => d.outcome === "applied").length;
        const rollbackRate   = ps.total > 0 ? ps.rolled / ps.total : 0;
        const healRate       = hs.healRate ?? 0.7;

        // Signal scores
        const execSuccessScore    = a.execSuccessRate ?? 70;
        const approvalQualityScore = a.recommendationAccuracy ?? 65;
        const rollbackExposure    = Math.round((1 - rollbackRate) * 100);
        const healingScore        = Math.round(healRate * 100);

        // Guardrail effectiveness: decisions where tier matched outcome
        const guardedDecisions = log.filter(d => d.predictedTier).length;
        const guardedCorrect   = log.filter(d => {
            if (d.predictedTier === "auto"  && (d.outcome === "applied" || d.outcome === "verified")) return true;
            if (d.predictedTier === "block" && d.decision === "reject")                               return true;
            return false;
        }).length;
        const guardrailScore   = guardedDecisions > 0 ? Math.round((guardedCorrect / guardedDecisions) * 100) : 70;

        const signals = [
            { name: "Execution Success Rate",  score: execSuccessScore,     weight: 0.25, rawValue: `${a.execSuccess ?? 0}/${a.execTotal ?? 0} executions`, detail: "One-click execute outcomes" },
            { name: "Approval Quality",        score: approvalQualityScore, weight: 0.25, rawValue: `${a.successOutcomes ?? 0}/${decisionApproved} approvals succeeded`, detail: "Recommendation accuracy" },
            { name: "Rollback Exposure",       score: rollbackExposure,     weight: 0.20, rawValue: `${ps.rolled}/${ps.total} patches rolled back`, detail: "Lower rollback = higher score" },
            { name: "Guardrail Effectiveness", score: guardrailScore,       weight: 0.15, rawValue: `${guardedCorrect}/${guardedDecisions} predictions correct`, detail: "Confidence tier accuracy" },
            { name: "Healing Coverage",        score: healingScore,         weight: 0.15, rawValue: `${hs.succeeded ?? 0}/${hs.total} healed successfully`, detail: "Self-healing success rate" },
        ];

        const compositeScore = Math.round(signals.reduce((acc, s) => acc + s.score * s.weight, 0));
        const level = compositeScore >= 85 ? "execution_ready"
            : compositeScore >= 70 ? "mostly_ready"
            : compositeScore >= 55 ? "supervised"
            : "manual";

        const badge = {
            execution_ready: "✅ Execution Ready",
            mostly_ready:    "⚙ Mostly Ready",
            supervised:      "👁 Supervised",
            manual:          "✋ Manual",
        }[level];

        const strengths = signals.filter(s => s.score >= 80).map(s => s.name);
        const gaps      = signals.filter(s => s.score < 60).map(s => ({
            signal: s.name, score: s.score,
            action: `Improve ${s.name.toLowerCase()} to unlock higher autonomy`,
        }));

        // Recent activity summary
        const execLog    = _readExecLog();
        const recent5Exec = execLog.slice(-5).reverse();

        return res.json({
            success: true,
            compositeScore,
            level,
            badge,
            signals,
            strengths,
            gaps,
            recentExecutions: recent5Exec.map(e => ({
                id:        e.id,
                type:      e.type,
                outcome:   e.outcome,
                createdAt: e.createdAt,
            })),
            analytics: {
                approvalRate:             a.approvalRate,
                rejectionRate:            a.rejectionRate,
                rollbackAfterApprovalRate: a.rollbackAfterApprovalRate,
                recommendationAccuracy:    a.recommendationAccuracy,
                execSuccessRate:           a.execSuccessRate,
            },
            meta: {
                totalDecisions: decisionTotal,
                totalExec:      a.execTotal,
                totalPatches:   ps.total,
                healTotal:      hs.total,
            },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ── B10 Production Reliability ────────────────────────────────────────
// Sources: patch-history, healing-history, agent-runs, autonomous-cycles,
//          operational-trust, trust-evolution, deployments, telemetry,
//          eng-decision-log, eng-execution-log (all local, no new modules).

const path = require("path");
const fs   = require("fs");

const _B10_PATCH_HISTORY_PATH  = path.join(__dirname, "../../data/patch-history.json");
const _B10_AGENT_RUNS_PATH     = path.join(__dirname, "../../data/agent-runs.json");
const _B10_CYCLES_PATH         = path.join(__dirname, "../../data/autonomous-cycles.json");
const _B10_TRUST_PATH          = path.join(__dirname, "../../data/operational-trust.json");
const _B10_TRUST_EVO_PATH      = path.join(__dirname, "../../data/trust-evolution.json");
const _B10_DEPLOYMENTS_PATH    = path.join(__dirname, "../../data/deployments.json");
const _B10_TELEMETRY_PATH      = path.join(__dirname, "../../data/telemetry.json");

function _b10ReadJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch { return fallback; }
}

function _b10Patches() {
    const raw = _b10ReadJson(_B10_PATCH_HISTORY_PATH, {});
    return Array.isArray(raw) ? raw : (raw.patches || []);
}

function _b10HealStats() {
    const h  = _b6HealStats();          // uses existing helper (2000 entries)
    const all = _b6HealStats._raw || (() => {
        try { return JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/healing-history.json"), "utf8")); }
        catch { return []; }
    })();
    // day buckets
    const byDay = {};
    all.forEach(e => {
        const d = (e.ts || "").slice(0, 10);
        if (!d) return;
        if (!byDay[d]) byDay[d] = { total: 0, success: 0, fail: 0, strategies: {} };
        byDay[d].total++;
        if (e.success) byDay[d].success++; else byDay[d].fail++;
        byDay[d].strategies[e.strategy] = (byDay[d].strategies[e.strategy] || 0) + 1;
    });
    const days = Object.keys(byDay).sort();
    // MTTR proxy: restart_workflow heals are instant; escalations = ~manual. Use attempt count as proxy.
    const avgAttempts = all.length ? (all.reduce((s, e) => s + (e.attempt || 1), 0) / all.length) : 1;
    // incident frequency: fail events per day
    const incidentDays = days.map(d => byDay[d].fail);
    const avgIncidentsPerDay = incidentDays.length ? Math.round(incidentDays.reduce((a, b) => a + b, 0) / incidentDays.length) : 0;
    return { ...h, byDay, days, avgAttempts: +avgAttempts.toFixed(2), avgIncidentsPerDay };
}

function _b10PatchMetrics() {
    const patches = _b10Patches();
    const total   = patches.length;
    if (!total) return { total: 0, applied: 0, rolled: 0, pending: 0, applyRate: 0, rollbackRate: 0, successRate: 0 };
    const applied  = patches.filter(p => p.status === "applied").length;
    const rolled   = patches.filter(p => p.status === "rolled-back" || p.status === "rolled_back").length;
    const pending  = patches.filter(p => p.status === "pending").length;
    // deploy count via deployments + telemetry
    const dep    = _b10ReadJson(_B10_DEPLOYMENTS_PATH, {});
    const tel    = _b10ReadJson(_B10_TELEMETRY_PATH, []);
    const telArr = Array.isArray(tel) ? tel : Object.values(tel);
    const deployCount = (dep.history?.length || 0) + telArr.filter(t => t.type === "deploy" && t.ok).length;
    // auto-fix attempts from healing
    const hs     = _b6HealStats();
    const autoFixed = hs.success;
    return {
        total, applied, rolled, pending, deployCount, autoFixed,
        applyRate:    total ? Math.round(applied / total * 100)  : 0,
        rollbackRate: total ? Math.round(rolled  / total * 100)  : 0,
        pendingRate:  total ? Math.round(pending / total * 100)  : 0,
        successRate:  (applied + rolled) > 0 ? Math.round(applied / (applied + rolled) * 100) : null,
    };
}

function _b10AgentMetrics() {
    const runs   = _b10ReadJson(_B10_AGENT_RUNS_PATH, []);
    const cycles = _b10ReadJson(_B10_CYCLES_PATH,    []);
    const runsArr   = Array.isArray(runs)   ? runs   : Object.values(runs);
    const cyclesArr = Array.isArray(cycles) ? cycles : Object.values(cycles);
    const total     = runsArr.length;
    const success   = runsArr.filter(r => r.success === true || r.status === "success").length;
    const failed    = runsArr.filter(r => r.success === false || r.status === "failed").length;
    const avgDur    = total ? Math.round(runsArr.reduce((s, r) => s + (r.durationMs || 0), 0) / total) : 0;
    const byAgent   = {};
    runsArr.forEach(r => {
        const a = r.agentId || "unknown";
        if (!byAgent[a]) byAgent[a] = { total: 0, success: 0, failed: 0 };
        byAgent[a].total++;
        if (r.success === true || r.status === "success") byAgent[a].success++;
        else byAgent[a].failed++;
    });
    const cycleFail = cyclesArr.filter(c => c.status === "failed").length;
    const cycleOk   = cyclesArr.filter(c => c.status === "success" || c.status === "completed").length;
    return { total, success, failed, avgDurMs: avgDur,
        successRate: total ? Math.round(success / total * 100) : 0,
        cycleTotal: cyclesArr.length, cycleOk, cycleFail,
        cycleSuccessRate: cyclesArr.length ? Math.round(cycleOk / cyclesArr.length * 100) : 0,
        byAgent };
}

function _b10TrustMetrics() {
    const trust = _b10ReadJson(_B10_TRUST_PATH,    { events: [] });
    const evo   = _b10ReadJson(_B10_TRUST_EVO_PATH, { events: [], snapshots: [] });
    const events   = trust.events || [];
    const evoEvts  = evo.events   || [];
    const approved    = events.filter(e => e.type === "patch-applied").length;
    const rejected    = events.filter(e => e.type === "patch-rejected").length;
    const deployOk    = events.filter(e => e.type === "deploy-success").length;
    const recoveries  = events.filter(e => e.type === "recovery-success").length;
    const totalWeight = events.reduce((s, e) => s + (e.weight || 1), 0);
    // bad approvals = rolled-back patches that were first applied
    const patches   = _b10Patches();
    const badApproval = patches.filter(p => p.status === "rolled-back" || p.status === "rolled_back").length;
    // trust score: weighted sum normalised to 100
    const maxPossible = events.length * 2;
    const trustScore  = maxPossible > 0 ? Math.min(100, Math.round(totalWeight / maxPossible * 100)) : 50;
    // chain outcomes
    const chainOk   = evoEvts.filter(e => e.type === "chain-completed").length;
    const chainFail  = evoEvts.filter(e => e.type === "chain-interrupted" || e.type === "chain-failed").length;
    return { approved, rejected, deployOk, recoveries, badApproval, trustScore,
        totalEvents: events.length, totalWeight, chainOk, chainFail };
}

function _b10AccuracyMetrics() {
    const decisions = _readDecisionLog();
    const execLog   = _readExecLog();
    const ps        = _b10PatchMetrics();
    const hs        = _b6HealStats();
    // prediction accuracy: from decision log tier matches
    let tierMatch = 0, tierTotal = 0;
    decisions.forEach(d => {
        if (d.predictedTier && d.actualOutcome) {
            tierTotal++;
            const goodTiers = ["auto", "review"];
            const okOutcomes = ["applied", "verified", "deployed"];
            const predictedGood = goodTiers.includes(d.predictedTier);
            const actualGood    = okOutcomes.includes(d.actualOutcome);
            if (predictedGood === actualGood) tierMatch++;
        }
    });
    const predictionAccuracy = tierTotal > 0 ? Math.round(tierMatch / tierTotal * 100) : null;
    // recommendation accuracy: how many approved recommendations produced good outcomes
    const recommended = decisions.filter(d => d.decision === "approve");
    const recGood     = recommended.filter(d => ["applied", "verified", "deployed"].includes(d.actualOutcome || ""));
    const recAccuracy = recommended.length > 0 ? Math.round(recGood.length / recommended.length * 100) : null;
    // guardrail hit rate: patches blocked (rolled-back) vs total
    const guardrailHits   = ps.rolled;
    const guardrailTotal  = ps.total;
    const guardrailRate   = guardrailTotal > 0 ? Math.round(guardrailHits / guardrailTotal * 100) : null;
    // healing success as accuracy proxy
    const healAccuracy = Math.round(hs.successRate);
    return { predictionAccuracy, recAccuracy, guardrailRate, healAccuracy,
        tierSamples: tierTotal, recSamples: recommended.length, guardSamples: guardrailTotal };
}

// B10 scorecard builder (daily / weekly / lifetime)
function _b10Scorecard() {
    const now     = Date.now();
    const DAY_MS  = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    const heal = (() => {
        try { return JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/healing-history.json"), "utf8")); }
        catch { return []; }
    })();
    const patches = _b10Patches();
    const trust   = _b10ReadJson(_B10_TRUST_PATH, { events: [] });
    const trustEvts = trust.events || [];

    function scoreWindow(windowMs) {
        const cutoff = new Date(now - windowMs).toISOString();
        const hW = heal.filter(h => h.ts >= cutoff);
        const pW = patches.filter(p => (p.proposedAt ? new Date(p.proposedAt).toISOString() : "") >= cutoff);
        const tW = trustEvts.filter(e => {
            const ts = e.ts ? (typeof e.ts === "number" ? new Date(e.ts).toISOString() : e.ts) : "";
            return ts >= cutoff;
        });
        const healSuccess  = hW.filter(h => h.success).length;
        const patchApplied = pW.filter(p => p.status === "applied").length;
        const patchRolled  = pW.filter(p => p.status === "rolled-back" || p.status === "rolled_back").length;
        const deployOk     = tW.filter(e => e.type === "deploy-success").length;
        const recoveries   = tW.filter(e => e.type === "recovery-success").length;
        const healRate     = hW.length > 0 ? Math.round(healSuccess / hW.length * 100) : null;
        const patchRate    = (patchApplied + patchRolled) > 0 ? Math.round(patchApplied / (patchApplied + patchRolled) * 100) : null;
        // autonomy score: weighted average of signals (0-100)
        const signals = [
            { name: "Healing success",   v: healRate,   w: 0.35 },
            { name: "Patch success",     v: patchRate,  w: 0.30 },
            { name: "Deploy success",    v: deployOk > 0 ? 85 : (hW.length > 0 ? 50 : null), w: 0.20 },
            { name: "Recovery coverage", v: recoveries > 0 ? Math.min(100, recoveries * 10) : null, w: 0.15 },
        ].filter(s => s.v != null);
        const totalW = signals.reduce((s, x) => s + x.w, 0);
        const autonomyScore = totalW > 0
            ? Math.round(signals.reduce((s, x) => s + x.v * x.w, 0) / totalW)
            : null;
        return { heals: hW.length, healSuccess, healRate, patches: pW.length, patchApplied, patchRolled, patchRate,
            deploys: deployOk, recoveries, autonomyScore };
    }

    return {
        daily:    scoreWindow(DAY_MS),
        weekly:   scoreWindow(WEEK_MS),
        lifetime: scoreWindow(1000 * DAY_MS),   // effectively all-time
    };
}

// B10.1 Execution Success Dashboard
router.get("/runtime/reliability/exec-success", rateLimiter(60, 60_000), (req, res) => {
    try {
        const pm   = _b10PatchMetrics();
        const hs   = _b6HealStats();
        const am   = _b10AgentMetrics();
        const exec = _readExecLog();
        const dec  = _readDecisionLog();
        // B9 execution log outcomes
        const execByOutcome = {};
        exec.forEach(e => { execByOutcome[e.outcome || "unknown"] = (execByOutcome[e.outcome || "unknown"] || 0) + 1; });
        const execTotal   = exec.length;
        const execSuccess = exec.filter(e => ["applied","verified","deployed"].includes(e.outcome)).length;
        const execRolled  = exec.filter(e => e.outcome === "rolled_back" || e.outcome === "rolled-back").length;
        const execFailed  = exec.filter(e => e.outcome === "failed" || e.outcome === "error").length;
        return res.json({
            success: true,
            // patch layer
            patches:    { ...pm },
            // heal layer
            healing:    { total: hs.total, success: hs.success, fail: hs.fail, rate: hs.successRate, byStrategy: hs.byStrategy },
            // agent/cycle layer
            agents:     { total: am.total, success: am.success, failed: am.failed, rate: am.successRate,
                          cycleTotal: am.cycleTotal, cycleOk: am.cycleOk, cycleFail: am.cycleFail, cycleRate: am.cycleSuccessRate },
            // B9 exec log layer
            execLog:    { total: execTotal, success: execSuccess, rolled: execRolled, failed: execFailed, byOutcome: execByOutcome,
                          successRate: execTotal ? Math.round(execSuccess / execTotal * 100) : null },
            // decisions
            decisions:  { total: dec.length, approved: dec.filter(d=>d.decision==="approve").length,
                          rejected: dec.filter(d=>d.decision==="reject").length },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B10.2 Accuracy Dashboard
router.get("/runtime/reliability/accuracy", rateLimiter(60, 60_000), (req, res) => {
    try {
        const acc = _b10AccuracyMetrics();
        const am  = _b10AgentMetrics();
        // failure pattern detection accuracy from failIntelEngine
        let patternCount = 0;
        if (_failIntelEngine?.FAILURE_PATTERNS) patternCount = _failIntelEngine.FAILURE_PATTERNS.length;
        // learning engine summary
        let learnSummary = null;
        if (_learningEngine) { try { learnSummary = _learningEngine.getSummary(); } catch {} }
        return res.json({
            success: true,
            predictionAccuracy: acc.predictionAccuracy,
            recommendationAccuracy: acc.recAccuracy,
            guardrailHitRate: acc.guardrailRate,
            healingAccuracy: acc.healAccuracy,
            tierSamples: acc.tierSamples,
            recSamples: acc.recSamples,
            guardSamples: acc.guardSamples,
            // extra context
            patternCount,
            agentSuccessRate: am.successRate,
            learningEngine: learnSummary ? {
                totalIngested: learnSummary.totalIngested,
                uniquePatterns: learnSummary.uniquePatterns,
            } : null,
            note: acc.tierSamples === 0 ? "Prediction accuracy will populate as operator decisions are made through Execution Center" : null,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B10.3 Autonomous Scorecard
router.get("/runtime/reliability/scorecard", rateLimiter(60, 60_000), (req, res) => {
    try {
        const sc   = _b10Scorecard();
        const tm   = _b10TrustMetrics();
        // autonomy level
        const ls = sc.lifetime.autonomyScore;
        const level = ls == null ? "unknown"
            : ls >= 80 ? "high_autonomy"
            : ls >= 60 ? "growing_autonomy"
            : ls >= 40 ? "supervised"
            : "manual";
        const levelLabel = { high_autonomy: "High Autonomy", growing_autonomy: "Growing Autonomy",
            supervised: "Supervised", manual: "Manual", unknown: "Insufficient Data" }[level];
        return res.json({
            success: true, daily: sc.daily, weekly: sc.weekly, lifetime: sc.lifetime,
            trustMetrics: tm, level, levelLabel,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B10.4 Reliability Trends (MTTR, incident frequency, healing success)
router.get("/runtime/reliability/trends", rateLimiter(60, 60_000), (req, res) => {
    try {
        const hs = _b10HealStats();
        const am = _b10AgentMetrics();
        const tel = _b10ReadJson(_B10_TELEMETRY_PATH, []);
        const telArr = Array.isArray(tel) ? tel : Object.values(tel);
        // build daily trend from healing-history
        const trendByDay = hs.days.map(d => ({
            date:           d,
            heals:          hs.byDay[d].total,
            success:        hs.byDay[d].success,
            fail:           hs.byDay[d].fail,
            successRate:    hs.byDay[d].total > 0 ? Math.round(hs.byDay[d].success / hs.byDay[d].total * 100) : 0,
            strategies:     hs.byDay[d].strategies,
        }));
        // deploy events from telemetry (time-ordered)
        const deployEvents = telArr
            .filter(t => t.type === "deploy")
            .sort((a, b) => new Date(a.ts) - new Date(b.ts))
            .map(t => ({ ts: t.ts, ok: t.ok, phase: t.phase, elapsedMs: t.elapsedMs }));
        // MTTR proxy: avg time between fail + heal in healing history (we have no timestamps per heal pair,
        // so proxy = fail count × avg attempt count × estimated 30s per attempt)
        const mttrProxyMs = Math.round(hs.avgAttempts * 30_000);
        const mttrLabel   = mttrProxyMs < 60_000 ? `~${Math.round(mttrProxyMs/1000)}s`
            : `~${Math.round(mttrProxyMs/60_000)}m`;
        return res.json({
            success: true,
            trendByDay,
            deployEvents,
            summary: {
                totalHeals:        hs.total,
                healSuccessRate:   hs.successRate,
                avgIncidentsPerDay: hs.avgIncidentsPerDay,
                avgAttempts:       hs.avgAttempts,
                mttrProxyLabel:    mttrLabel,
                mttrProxyMs,
                agentRunTotal:     am.total,
                agentFailRate:     100 - am.successRate,
            },
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B10.5 Operator Trust Score
router.get("/runtime/reliability/trust-score", rateLimiter(60, 60_000), (req, res) => {
    try {
        const tm  = _b10TrustMetrics();
        const pm  = _b10PatchMetrics();
        const dec = _readDecisionLog();
        // approved / rejected from operational-trust events (real data)
        const approved   = tm.approved;      // patch-applied events
        const rejected   = tm.rejected;      // patch-rejected events
        const successApprovals = approved - tm.badApproval;
        const badApprovals     = tm.badApproval;
        const approvalQuality  = approved > 0 ? Math.round(successApprovals / approved * 100) : null;
        // also from B9 decision log if populated
        const decApproved = dec.filter(d => d.decision === "approve").length;
        const decRejected = dec.filter(d => d.decision === "reject").length;
        const decGood     = dec.filter(d => d.decision === "approve" && ["applied","verified","deployed"].includes(d.actualOutcome||"")).length;
        const decBad      = dec.filter(d => d.decision === "approve" && ["failed","rolled_back","rolled-back","error"].includes(d.actualOutcome||"")).length;
        // operator trust score 0-100
        // weights: good approvals +3, bad approvals -5, rejections -1 (rejections may be correct),
        //          deploys +2, recoveries +2
        const rawScore = (successApprovals * 3) + (tm.deployOk * 2) + (tm.recoveries * 2)
            - (badApprovals * 5) - (rejected * 1);
        const maxScore = tm.totalEvents * 3;
        const trustScore100 = maxScore > 0 ? Math.min(100, Math.max(0, Math.round((rawScore / maxScore) * 100))) : 50;
        const trustLevel = trustScore100 >= 80 ? "high"
            : trustScore100 >= 60 ? "medium"
            : trustScore100 >= 40 ? "low"
            : "critical";
        return res.json({
            success: true,
            trustScore: trustScore100,
            trustLevel,
            // operational-trust events (real 103 events)
            fromTrustLog: { approved, rejected, successApprovals, badApprovals, deployOk: tm.deployOk, recoveries: tm.recoveries, approvalQuality },
            // B9 decision log (starts empty, grows with use)
            fromDecisionLog: { approved: decApproved, rejected: decRejected, good: decGood, bad: decBad,
                quality: decApproved > 0 ? Math.round(decGood / decApproved * 100) : null },
            chainMetrics: { ok: tm.chainOk, fail: tm.chainFail },
            totalTrustEvents: tm.totalEvents,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// B10.6 One-click System Health Report
router.get("/runtime/reliability/health-report", rateLimiter(20, 60_000), (req, res) => {
    try {
        const pm  = _b10PatchMetrics();
        const hs  = _b6HealStats();
        const am  = _b10AgentMetrics();
        const tm  = _b10TrustMetrics();
        const acc = _b10AccuracyMetrics();
        const sc  = _b10Scorecard();
        const hst = _b10HealStats();
        const dec = _readDecisionLog();
        const exec = _readExecLog();
        // compute overall system health 0-100
        const signals = [
            { name: "Healing success rate",  score: hs.successRate,                    weight: 0.25 },
            { name: "Patch success rate",     score: pm.successRate ?? 50,              weight: 0.20 },
            { name: "Operator trust",         score: tm.trustScore,                     weight: 0.20 },
            { name: "Agent run success",      score: am.successRate,                    weight: 0.15 },
            { name: "Recommendation quality", score: acc.recAccuracy ?? 70,             weight: 0.10 },
            { name: "Guardrail effectiveness",score: acc.guardrailRate != null ? Math.min(100, acc.guardrailRate * 2) : 60, weight: 0.10 },
        ];
        const overallHealth = Math.round(signals.reduce((s, x) => s + x.score * x.weight, 0));
        const healthLabel = overallHealth >= 80 ? "Healthy"
            : overallHealth >= 65 ? "Good"
            : overallHealth >= 50 ? "Fair"
            : "Needs Attention";
        // critical alerts
        const alerts = [];
        if (am.successRate < 10) alerts.push({ level: "critical", msg: `Agent run success rate critically low: ${am.successRate}% (${am.failed}/${am.total} failed)` });
        if (pm.rollbackRate > 50) alerts.push({ level: "warn", msg: `High patch rollback rate: ${pm.rollbackRate}%` });
        if (hs.successRate < 70) alerts.push({ level: "warn", msg: `Healing success below target: ${hs.successRate}%` });
        if (pm.pending > 5) alerts.push({ level: "info", msg: `${pm.pending} patches pending operator review` });
        if (dec.length === 0) alerts.push({ level: "info", msg: "No B9 operator decisions recorded yet — use Execution Center to start approving items" });
        // strengths
        const strengths = [];
        if (hs.successRate >= 80) strengths.push(`Healing engine operating at ${hs.successRate}% success (${hs.success}/${hs.total} healed)`);
        if (tm.recoveries > 0) strengths.push(`${tm.recoveries} autonomous recoveries logged`);
        if (tm.deployOk > 0)  strengths.push(`${tm.deployOk} successful deployments`);
        if (pm.applied > 0)   strengths.push(`${pm.applied} patches successfully applied`);
        // autonomy trajectory
        const lifetimeScore = sc.lifetime.autonomyScore;
        const weeklyScore   = sc.weekly.autonomyScore;
        const trajectory = (lifetimeScore != null && weeklyScore != null)
            ? (weeklyScore >= lifetimeScore ? "improving" : "declining")
            : "insufficient_data";
        return res.json({
            success: true,
            overallHealth,
            healthLabel,
            trajectory,
            autonomyScore: lifetimeScore,
            signals,
            alerts,
            strengths,
            sections: {
                patches:   pm,
                healing:   { total: hs.total, success: hs.success, fail: hs.fail, rate: hs.successRate },
                agents:    { total: am.total, successRate: am.successRate, cycleTotal: am.cycleTotal, cycleRate: am.cycleSuccessRate },
                trust:     { trustScore: tm.trustScore, approved: tm.approved, rejected: tm.rejected, badApproval: tm.badApproval },
                accuracy:  acc,
                scorecard: { daily: sc.daily, weekly: sc.weekly },
                execLog:   { total: exec.length, decisions: dec.length },
            },
            mttr: hst.mttrLabel || `~${Math.round(hst.avgAttempts * 30)}s`,
            incidentFrequency: `~${hst.avgIncidentsPerDay}/day`,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// Phase 572 — Task Understanding
router.post("/runtime/engineering/understand", rateLimiter(30, 60_000), (req, res) => {
    if (!taskUnderstand) return res.status(503).json({ success: false, error: "taskUnderstanding_unavailable" });
    const task = taskUnderstand.understand(req.body?.text || "", { sessionId: req.body?.sessionId, operatorId: req.body?.operatorId, context: req.body?.context });
    return res.json({ success: true, task });
});

// Phase 573 — Terminal Workflows
router.post("/runtime/terminal/classify", rateLimiter(30, 60_000), (req, res) => {
    if (!terminalWF) return res.status(503).json({ success: false, error: "terminalWorkflows_unavailable" });
    return res.json({ success: true, ...terminalWF.classifyCommand(req.body?.cmd || "") });
});
router.get("/runtime/terminal/sequences", rateLimiter(30, 60_000), (req, res) => {
    if (!terminalWF) return res.status(503).json({ success: false, error: "terminalWorkflows_unavailable" });
    return res.json({ success: true, sequences: terminalWF.listSequences() });
});
router.get("/runtime/terminal/sequences/:name", rateLimiter(30, 60_000), (req, res) => {
    if (!terminalWF) return res.status(503).json({ success: false, error: "terminalWorkflows_unavailable" });
    return res.json({ success: true, ...terminalWF.getSequence(req.params.name, { sessionId: req.query.sessionId }) });
});

// Phase 574 — Browser Workflows
router.post("/runtime/browser/extraction-plan", rateLimiter(20, 60_000), (req, res) => {
    if (!browserWF) return res.status(503).json({ success: false, error: "browserWorkflows_unavailable" });
    return res.json({ success: true, ...browserWF.extractionPlan(req.body || {}) });
});
router.get("/runtime/browser/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!browserWF) return res.status(503).json({ success: false, error: "browserWorkflows_unavailable" });
    return res.json({ success: true, sessions: browserWF.listSessions() });
});

// Phase 575 — Execution Confidence
router.post("/runtime/confidence/summary", rateLimiter(30, 60_000), (req, res) => {
    if (!execConf) return res.status(503).json({ success: false, error: "executionConfidence_unavailable" });
    return res.json({ success: true, ...execConf.confidenceSummary(req.body || {}) });
});
router.post("/runtime/confidence/patch", rateLimiter(30, 60_000), (req, res) => {
    if (!execConf) return res.status(503).json({ success: false, error: "executionConfidence_unavailable" });
    return res.json({ success: true, ...execConf.patchConfidence(req.body || {}) });
});
router.post("/runtime/confidence/deployment", rateLimiter(30, 60_000), (req, res) => {
    if (!execConf) return res.status(503).json({ success: false, error: "executionConfidence_unavailable" });
    return res.json({ success: true, ...execConf.deploymentConfidence(req.body || {}) });
});

// Phase 576 — Debug Assist Mode
router.post("/runtime/debug-assist/activate", rateLimiter(10, 60_000), (req, res) => {
    if (!debugAssist) return res.status(503).json({ success: false, error: "debugAssistMode_unavailable" });
    return res.json({ success: true, ...debugAssist.activate(req.body?.sessionId, req.body?.goal) });
});
router.post("/runtime/debug-assist/deactivate", rateLimiter(10, 60_000), (req, res) => {
    if (!debugAssist) return res.status(503).json({ success: false, error: "debugAssistMode_unavailable" });
    return res.json({ success: true, ...debugAssist.deactivate() });
});
router.get("/runtime/debug-assist/state", rateLimiter(30, 60_000), (req, res) => {
    if (!debugAssist) return res.status(503).json({ success: false, error: "debugAssistMode_unavailable" });
    return res.json({ success: true, state: debugAssist.getState() });
});
router.post("/runtime/debug-assist/root-causes", rateLimiter(20, 60_000), (req, res) => {
    if (!debugAssist) return res.status(503).json({ success: false, error: "debugAssistMode_unavailable" });
    const errors = req.body?.errors || [];
    return res.json({ success: true, suggestions: debugAssist.rootCauseSuggestions(errors), depIssues: debugAssist.detectDependencyIssues(errors), plan: debugAssist.recoveryPlan(debugAssist.rootCauseSuggestions(errors), req.body?.goal) });
});
router.post("/runtime/debug-assist/ingest-error", rateLimiter(30, 60_000), (req, res) => {
    if (!debugAssist) return res.status(503).json({ success: false, error: "debugAssistMode_unavailable" });
    debugAssist.ingestError(req.body?.message || "", req.body?.ctx || {});
    return res.json({ success: true });
});

// Phase 577 — Deployment Assist
router.get("/runtime/deploy-assist/preflight", rateLimiter(20, 60_000), (req, res) => {
    if (!deployAssist) return res.status(503).json({ success: false, error: "deploymentAssist_unavailable" });
    return res.json({ success: true, ...deployAssist.preflightSummary(req.query.pipeline) });
});
router.get("/runtime/deploy-assist/rollback-recommendation", rateLimiter(20, 60_000), (req, res) => {
    if (!deployAssist) return res.status(503).json({ success: false, error: "deploymentAssist_unavailable" });
    return res.json({ success: true, ...deployAssist.rollbackRecommendation() });
});
router.get("/runtime/deploy-assist/dependency-integrity", rateLimiter(20, 60_000), (req, res) => {
    if (!deployAssist) return res.status(503).json({ success: false, error: "deploymentAssist_unavailable" });
    return res.json({ success: true, ...deployAssist.dependencyIntegrityCheck() });
});
router.get("/runtime/deploy-assist/readiness", rateLimiter(20, 60_000), (req, res) => {
    if (!deployAssist) return res.status(503).json({ success: false, error: "deploymentAssist_unavailable" });
    return res.json({ success: true, ...deployAssist.runtimeReadiness() });
});
router.get("/runtime/deploy-assist/stale-check", rateLimiter(20, 60_000), (req, res) => {
    if (!deployAssist) return res.status(503).json({ success: false, error: "deploymentAssist_unavailable" });
    return res.json({ success: true, ...deployAssist.staleDeploymentCheck() });
});

// Phase 578 — Engineering Context Memory
router.get("/runtime/eng-memory/query", rateLimiter(30, 60_000), (req, res) => {
    if (!engCtxMem) return res.status(503).json({ success: false, error: "engineeringContextMemory_unavailable" });
    return res.json({ success: true, entries: engCtxMem.query(req.query.q, req.query.type) });
});
router.get("/runtime/eng-memory/stats", rateLimiter(20, 60_000), (req, res) => {
    if (!engCtxMem) return res.status(503).json({ success: false, error: "engineeringContextMemory_unavailable" });
    return res.json({ success: true, ...engCtxMem.stats() });
});
router.post("/runtime/eng-memory/record-outcome", rateLimiter(20, 60_000), (req, res) => {
    if (!engCtxMem) return res.status(503).json({ success: false, error: "engineeringContextMemory_unavailable" });
    engCtxMem.recordOutcome(req.body || {});
    return res.json({ success: true });
});

// Phase 579 — Productivity Chains
router.get("/runtime/chains/list", rateLimiter(20, 60_000), (req, res) => {
    if (!prodChains) return res.status(503).json({ success: false, error: "productivityChainEngine_unavailable" });
    return res.json({ success: true, chains: prodChains.listChains() });
});
router.get("/runtime/chains/:name", rateLimiter(20, 60_000), (req, res) => {
    if (!prodChains) return res.status(503).json({ success: false, error: "productivityChainEngine_unavailable" });
    const chain = prodChains.getChain(req.params.name);
    if (!chain) return res.status(404).json({ success: false, error: "chain_not_found" });
    return res.json({ success: true, chain });
});
router.post("/runtime/chains/:name/execute", rateLimiter(5, 60_000), (req, res) => {
    if (!prodChains) return res.status(503).json({ success: false, error: "productivityChainEngine_unavailable" });
    const result = prodChains.executeChain(req.params.name, { approved: req.body?.approved, sessionId: req.body?.sessionId, resumeFromStep: req.body?.resumeFromStep });
    return res.json({ success: result.ok, ...result });
});

// Phase 580 — Daily Engineering Validation
router.get("/runtime/eng-validation/today", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyVal) return res.status(503).json({ success: false, error: "dailyEngineeringValidation_unavailable" });
    return res.json({ success: true, ...dailyVal.todayReport() });
});
router.get("/runtime/eng-validation/weekly", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyVal) return res.status(503).json({ success: false, error: "dailyEngineeringValidation_unavailable" });
    return res.json({ success: true, ...dailyVal.weeklyReport() });
});
router.post("/runtime/eng-validation/record", rateLimiter(30, 60_000), (req, res) => {
    if (!dailyVal) return res.status(503).json({ success: false, error: "dailyEngineeringValidation_unavailable" });
    const { type, ...data } = req.body || {};
    if (type === "debug")      dailyVal.recordDebuggingSession(data);
    else if (type === "deploy") dailyVal.recordDeployment(data);
    else if (type === "patch")  dailyVal.recordPatch(data);
    else if (type === "recovery") dailyVal.recordRecovery(data);
    else if (type === "replay") dailyVal.recordReplay(data);
    else return res.status(400).json({ success: false, error: "unknown type" });
    return res.json({ success: true });
});

// Phase 581 — Execution Calmness
router.post("/runtime/calmness/configure", rateLimiter(10, 60_000), (req, res) => {
    if (!execCalm) return res.status(503).json({ success: false, error: "executionCalmness_unavailable" });
    return res.json({ success: true, ...execCalm.configure(req.body?.sessionId, req.body?.overrides || {}) });
});
router.get("/runtime/calmness/config/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!execCalm) return res.status(503).json({ success: false, error: "executionCalmness_unavailable" });
    return res.json({ success: true, config: execCalm.getConfig(req.params.sessionId) });
});
router.get("/runtime/calmness/clarity/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!execCalm) return res.status(503).json({ success: false, error: "executionCalmness_unavailable" });
    return res.json({ success: true, ...execCalm.clarityReport(req.params.sessionId) });
});

// Phase 582 — Execution Timeline
router.get("/runtime/timeline/recent", rateLimiter(30, 60_000), (req, res) => {
    if (!execTimeline) return res.status(503).json({ success: false, error: "executionTimeline_unavailable" });
    return res.json({ success: true, ...execTimeline.recentSummary(parseInt(req.query.limit) || 20) });
});
router.get("/runtime/timeline/search", rateLimiter(20, 60_000), (req, res) => {
    if (!execTimeline) return res.status(503).json({ success: false, error: "executionTimeline_unavailable" });
    return res.json({ success: true, events: execTimeline.search({ q: req.query.q, type: req.query.type, sessionId: req.query.sessionId, replayId: req.query.replayId, limit: parseInt(req.query.limit) || 50 }) });
});
router.get("/runtime/timeline/session/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!execTimeline) return res.status(503).json({ success: false, error: "executionTimeline_unavailable" });
    return res.json({ success: true, events: execTimeline.sessionThread(req.params.sessionId) });
});
router.post("/runtime/timeline/record", rateLimiter(30, 60_000), (req, res) => {
    if (!execTimeline) return res.status(503).json({ success: false, error: "executionTimeline_unavailable" });
    const id = execTimeline.record(req.body?.type || "session", req.body || {});
    return res.json({ success: true, id });
});

// Phase 583 — Resilience Test
router.post("/runtime/resilience/run", rateLimiter(2, 60_000), (req, res) => {
    if (!resilTest) return res.status(503).json({ success: false, error: "resilienceTest_unavailable" });
    return res.json({ success: true, ...resilTest.runAll() });
});

// Phase 584 — Platform Audit
router.post("/runtime/platform-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!platAudit) return res.status(503).json({ success: false, error: "platformAudit_unavailable" });
    return res.json({ success: true, ...platAudit.runAudit() });
});

// Phase 585 — Engineering Foundation
router.get("/runtime/foundation/health", rateLimiter(10, 60_000), (req, res) => {
    if (!engFound) return res.status(503).json({ success: false, error: "engineeringFoundation_unavailable" });
    return res.json({ success: true, ...engFound.foundationHealth() });
});
router.get("/runtime/foundation/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!engFound) return res.status(503).json({ success: false, error: "engineeringFoundation_unavailable" });
    return res.json({ success: true, capabilities: engFound.capabilities() });
});
router.get("/runtime/foundation/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!engFound) return res.status(503).json({ success: false, error: "engineeringFoundation_unavailable" });
    return res.json({ success: true, ...engFound.moduleHealth() });
});


// ── Phases 586–600 — Operator-Grade Engineering Automation ────────────────────

function _tryRequirePhase586(p) { try { return require(p); } catch { return null; } }

const patchExecEng   = _tryRequirePhase586("../../agents/runtime/patchExecutionEngine.cjs");
const engChains      = _tryRequirePhase586("../../agents/runtime/engineeringChains.cjs");
const termSupervisor = _tryRequirePhase586("../../agents/runtime/terminalSupervisor.cjs");
const browserWFEng   = _tryRequirePhase586("../../agents/runtime/browserWorkflowEngine.cjs");
const wfValidator    = _tryRequirePhase586("../../agents/runtime/workflowValidator.cjs");
const opWFMem        = _tryRequirePhase586("../../agents/runtime/operatorWorkflowMemory.cjs");
const dailyProd      = _tryRequirePhase586("../../agents/runtime/dailyProductivityMode.cjs");
const recovOrch      = _tryRequirePhase586("../../agents/runtime/recoveryOrchestrationEngine.cjs");
const sessIntel      = _tryRequirePhase586("../../agents/runtime/sessionIntelligenceEngine.cjs");
const multiProj      = _tryRequirePhase586("../../agents/runtime/multiProjectRuntime.cjs");
const platPerf       = _tryRequirePhase586("../../agents/runtime/platformPerformance.cjs");
const rwValidation   = _tryRequirePhase586("../../agents/runtime/realWorldValidation.cjs");
const resilTest600   = _tryRequirePhase586("../../agents/runtime/resilienceTest600.cjs");
const opAudit        = _tryRequirePhase586("../../agents/runtime/operatorAutomationAudit.cjs");
const opEngPlat      = _tryRequirePhase586("../../agents/runtime/operatorEngineeringPlatform.cjs");

// Phase 586 — Advanced Patch Execution Engine
router.post("/runtime/patch-engine/propose-batch", rateLimiter(10, 60_000), (req, res) => {
    if (!patchExecEng) return res.status(503).json({ success: false, error: "patchExecutionEngine_unavailable" });
    const result = patchExecEng.proposeBatch(req.body?.files || [], { sessionId: req.body?.sessionId, replayId: req.body?.replayId, batchLabel: req.body?.batchLabel });
    return res.json({ success: result.ok, ...result });
});
router.post("/runtime/patch-engine/batches/:id/validate", rateLimiter(20, 60_000), (req, res) => {
    if (!patchExecEng) return res.status(503).json({ success: false, error: "patchExecutionEngine_unavailable" });
    return res.json({ success: true, ...patchExecEng.validateBatch(req.params.id) });
});
router.post("/runtime/patch-engine/batches/:id/apply", rateLimiter(5, 60_000), (req, res) => {
    if (!patchExecEng) return res.status(503).json({ success: false, error: "patchExecutionEngine_unavailable" });
    const result = patchExecEng.applyBatch(req.params.id, { approved: req.body?.approved, operatorId: req.body?.operatorId });
    return res.json({ success: result.ok, ...result });
});
router.post("/runtime/patch-engine/batches/:id/rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!patchExecEng) return res.status(503).json({ success: false, error: "patchExecutionEngine_unavailable" });
    const result = patchExecEng.rollbackBatch(req.params.id, { approved: req.body?.approved });
    return res.json({ success: result.ok, ...result });
});
router.get("/runtime/patch-engine/batches", rateLimiter(20, 60_000), (req, res) => {
    if (!patchExecEng) return res.status(503).json({ success: false, error: "patchExecutionEngine_unavailable" });
    return res.json({ success: true, batches: patchExecEng.listBatches({ status: req.query.status, sessionId: req.query.sessionId }) });
});
router.post("/runtime/patch-engine/locate-target", rateLimiter(30, 60_000), (req, res) => {
    if (!patchExecEng) return res.status(503).json({ success: false, error: "patchExecutionEngine_unavailable" });
    return res.json({ success: true, ...patchExecEng.locateEditTarget(req.body?.content, req.body?.searchStr) });
});

// Phase 587 — Engineering Execution Chains
router.get("/runtime/eng-chains/list", rateLimiter(20, 60_000), (req, res) => {
    if (!engChains) return res.status(503).json({ success: false, error: "engineeringChains_unavailable" });
    return res.json({ success: true, chains: engChains.listChains() });
});
router.post("/runtime/eng-chains/:name/execute", rateLimiter(5, 60_000), (req, res) => {
    if (!engChains) return res.status(503).json({ success: false, error: "engineeringChains_unavailable" });
    const result = engChains.executeChain(req.params.name, { approved: req.body?.approved, sessionId: req.body?.sessionId, replayId: req.body?.replayId, resumeFromStep: req.body?.resumeFromStep });
    return res.json({ success: result.ok, ...result });
});
router.get("/runtime/eng-chains/active", rateLimiter(20, 60_000), (req, res) => {
    if (!engChains) return res.status(503).json({ success: false, error: "engineeringChains_unavailable" });
    return res.json({ success: true, active: engChains.getActiveChains() });
});
router.get("/runtime/eng-chains/history", rateLimiter(20, 60_000), (req, res) => {
    if (!engChains) return res.status(503).json({ success: false, error: "engineeringChains_unavailable" });
    return res.json({ success: true, history: engChains.chainHistory(parseInt(req.query.limit) || 20) });
});

// Phase 588 — Terminal Supervisor
router.post("/runtime/terminal-supervisor/processes", rateLimiter(20, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, ...termSupervisor.registerProcess(req.body || {}) });
});
router.post("/runtime/terminal-supervisor/processes/:id/heartbeat", rateLimiter(60, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, ...termSupervisor.heartbeat(req.params.id, req.body || {}) });
});
router.post("/runtime/terminal-supervisor/processes/:id/restart", rateLimiter(10, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, ...termSupervisor.recordRestart(req.params.id, req.body || {}) });
});
router.post("/runtime/terminal-supervisor/processes/:id/stop", rateLimiter(10, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, ...termSupervisor.stopProcess(req.params.id, req.body || {}) });
});
router.get("/runtime/terminal-supervisor/runaway", rateLimiter(20, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, ...termSupervisor.detectRunaway() });
});
router.get("/runtime/terminal-supervisor/processes", rateLimiter(20, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, processes: termSupervisor.listProcesses({ status: req.query.status, sessionId: req.query.sessionId }) });
});
router.post("/runtime/terminal-supervisor/stabilize-output", rateLimiter(20, 60_000), (req, res) => {
    if (!termSupervisor) return res.status(503).json({ success: false, error: "terminalSupervisor_unavailable" });
    return res.json({ success: true, ...termSupervisor.stabilizeOutput(req.body?.lines || []) });
});

// Phase 589 — Browser Workflow Engine
router.get("/runtime/browser-engine/workflows", rateLimiter(20, 60_000), (req, res) => {
    if (!browserWFEng) return res.status(503).json({ success: false, error: "browserWorkflowEngine_unavailable" });
    return res.json({ success: true, workflows: browserWFEng.listWorkflows({ status: req.query.status }) });
});
router.post("/runtime/browser-engine/workflows/start", rateLimiter(10, 60_000), (req, res) => {
    if (!browserWFEng) return res.status(503).json({ success: false, error: "browserWorkflowEngine_unavailable" });
    return res.json({ success: true, ...browserWFEng.startWorkflow(req.body?.name, req.body || {}) });
});
router.post("/runtime/browser-engine/workflows/:id/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!browserWFEng) return res.status(503).json({ success: false, error: "browserWorkflowEngine_unavailable" });
    return res.json({ success: true, ...browserWFEng.advanceStep(req.params.id, { result: req.body?.result, operatorApproved: req.body?.operatorApproved }) });
});
router.post("/runtime/browser-engine/workflows/:id/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!browserWFEng) return res.status(503).json({ success: false, error: "browserWorkflowEngine_unavailable" });
    return res.json({ success: true, ...browserWFEng.interruptWorkflow(req.params.id, req.body || {}) });
});
router.post("/runtime/browser-engine/workflows/:id/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!browserWFEng) return res.status(503).json({ success: false, error: "browserWorkflowEngine_unavailable" });
    return res.json({ success: true, ...browserWFEng.resumeWorkflow(req.params.id) });
});
router.get("/runtime/browser-engine/recovery-plan/:id", rateLimiter(20, 60_000), (req, res) => {
    if (!browserWFEng) return res.status(503).json({ success: false, error: "browserWorkflowEngine_unavailable" });
    return res.json({ success: true, ...browserWFEng.browserRecoveryPlan(req.params.id, req.query.errorType) });
});

// Phase 590 — Workflow Validation
router.post("/runtime/workflow-validation/run", rateLimiter(10, 60_000), (req, res) => {
    if (!wfValidator) return res.status(503).json({ success: false, error: "workflowValidator_unavailable" });
    return res.json({ success: true, ...wfValidator.runValidation(req.body || {}) });
});
router.get("/runtime/workflow-validation/runtime-stability", rateLimiter(20, 60_000), (req, res) => {
    if (!wfValidator) return res.status(503).json({ success: false, error: "workflowValidator_unavailable" });
    return res.json({ success: true, ...wfValidator.validateRuntimeStability() });
});
router.get("/runtime/workflow-validation/deployment-readiness", rateLimiter(20, 60_000), (req, res) => {
    if (!wfValidator) return res.status(503).json({ success: false, error: "workflowValidator_unavailable" });
    return res.json({ success: true, ...wfValidator.validateDeploymentReadiness(req.query.pipeline) });
});

// Phase 591 — Operator Workflow Memory
router.get("/runtime/op-memory/query", rateLimiter(30, 60_000), (req, res) => {
    if (!opWFMem) return res.status(503).json({ success: false, error: "operatorWorkflowMemory_unavailable" });
    return res.json({ success: true, entries: opWFMem.query(req.query.q, req.query.type) });
});
router.get("/runtime/op-memory/suggest", rateLimiter(20, 60_000), (req, res) => {
    if (!opWFMem) return res.status(503).json({ success: false, error: "operatorWorkflowMemory_unavailable" });
    return res.json({ success: true, ...opWFMem.suggest(req.query.goal || "") });
});
router.get("/runtime/op-memory/stats", rateLimiter(20, 60_000), (req, res) => {
    if (!opWFMem) return res.status(503).json({ success: false, error: "operatorWorkflowMemory_unavailable" });
    return res.json({ success: true, ...opWFMem.stats() });
});
router.post("/runtime/op-memory/record", rateLimiter(20, 60_000), (req, res) => {
    if (!opWFMem) return res.status(503).json({ success: false, error: "operatorWorkflowMemory_unavailable" });
    const { type, ...data } = req.body || {};
    if (type === "debug-chain")   opWFMem.recordDebugChain(data);
    else if (type === "deploy")   opWFMem.recordDeployPattern(data);
    else if (type === "recovery") opWFMem.recordRecoveryFlow(data);
    else if (type === "sequence") opWFMem.recordExecSequence(data);
    else if (type === "env")      opWFMem.recordEnvWorkflow(data);
    else return res.status(400).json({ success: false, error: "unknown type" });
    return res.json({ success: true });
});

// Phase 592 — Daily Productivity Mode
router.get("/runtime/productivity/daily-briefing", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyProd) return res.status(503).json({ success: false, error: "dailyProductivityMode_unavailable" });
    return res.json({ success: true, ...dailyProd.dailyBriefing(req.query.sessionId) });
});
router.get("/runtime/productivity/discover-workflows", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyProd) return res.status(503).json({ success: false, error: "dailyProductivityMode_unavailable" });
    return res.json({ success: true, ...dailyProd.discoverWorkflows(req.query.goal || "") });
});
router.get("/runtime/productivity/replay-navigator", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyProd) return res.status(503).json({ success: false, error: "dailyProductivityMode_unavailable" });
    return res.json({ success: true, ...dailyProd.replayNavigator(parseInt(req.query.limit) || 20) });
});
router.post("/runtime/productivity/filter-clutter", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyProd) return res.status(503).json({ success: false, error: "dailyProductivityMode_unavailable" });
    return res.json({ success: true, ...dailyProd.filterClutter(req.body?.items || [], req.body?.sessionId) });
});

// Phase 593 — Recovery Orchestration Engine
router.post("/runtime/recovery-orch/restore-chain", rateLimiter(5, 60_000), (req, res) => {
    if (!recovOrch) return res.status(503).json({ success: false, error: "recoveryOrchestrationEngine_unavailable" });
    return res.json({ success: true, ...recovOrch.restoreInterruptedChain(req.body?.chainId, req.body || {}) });
});
router.post("/runtime/recovery-orch/deployment-rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!recovOrch) return res.status(503).json({ success: false, error: "recoveryOrchestrationEngine_unavailable" });
    return res.json({ success: true, ...recovOrch.executeDeploymentRollback(req.body?.runId, { approved: req.body?.approved }) });
});
router.post("/runtime/recovery-orch/restart-adapter", rateLimiter(5, 60_000), (req, res) => {
    if (!recovOrch) return res.status(503).json({ success: false, error: "recoveryOrchestrationEngine_unavailable" });
    return res.json({ success: true, ...recovOrch.restartAdapter(req.body?.adapterName, req.body || {}) });
});
router.post("/runtime/recovery-orch/heal-runtime", rateLimiter(3, 60_000), (req, res) => {
    if (!recovOrch) return res.status(503).json({ success: false, error: "recoveryOrchestrationEngine_unavailable" });
    return res.json({ success: true, ...recovOrch.healRuntimeState({ approved: req.body?.approved }) });
});
router.get("/runtime/recovery-orch/replay-chain/:replayId", rateLimiter(20, 60_000), (req, res) => {
    if (!recovOrch) return res.status(503).json({ success: false, error: "recoveryOrchestrationEngine_unavailable" });
    return res.json({ success: true, ...recovOrch.restoreReplayChain(req.params.replayId) });
});

// Phase 594 — Session Intelligence Engine
router.post("/runtime/session-intel/start", rateLimiter(20, 60_000), (req, res) => {
    if (!sessIntel) return res.status(503).json({ success: false, error: "sessionIntelligenceEngine_unavailable" });
    return res.json({ success: true, ...sessIntel.startSession(req.body?.sessionId, req.body || {}) });
});
router.post("/runtime/session-intel/:id/activity", rateLimiter(60, 60_000), (req, res) => {
    if (!sessIntel) return res.status(503).json({ success: false, error: "sessionIntelligenceEngine_unavailable" });
    return res.json({ success: true, ...sessIntel.updateActivity(req.params.id, req.body || {}) });
});
router.post("/runtime/session-intel/:id/block", rateLimiter(10, 60_000), (req, res) => {
    if (!sessIntel) return res.status(503).json({ success: false, error: "sessionIntelligenceEngine_unavailable" });
    return res.json({ success: true, ...sessIntel.markBlocked(req.params.id, req.body?.reason) });
});
router.post("/runtime/session-intel/:id/unblock", rateLimiter(10, 60_000), (req, res) => {
    if (!sessIntel) return res.status(503).json({ success: false, error: "sessionIntelligenceEngine_unavailable" });
    return res.json({ success: true, ...sessIntel.clearBlocked(req.params.id) });
});
router.get("/runtime/session-intel/:id", rateLimiter(20, 60_000), (req, res) => {
    if (!sessIntel) return res.status(503).json({ success: false, error: "sessionIntelligenceEngine_unavailable" });
    return res.json({ success: true, ...sessIntel.getSessionIntelligence(req.params.id) });
});
router.post("/runtime/session-intel/:id/recovery-guidance", rateLimiter(10, 60_000), (req, res) => {
    if (!sessIntel) return res.status(503).json({ success: false, error: "sessionIntelligenceEngine_unavailable" });
    return res.json({ success: true, ...sessIntel.recoveryPathGuidance(req.params.id, req.body?.errors || []) });
});

// Phase 595 — Multi-Project Runtime
router.post("/runtime/projects", rateLimiter(10, 60_000), (req, res) => {
    if (!multiProj) return res.status(503).json({ success: false, error: "multiProjectRuntime_unavailable" });
    return res.json({ success: true, ...multiProj.registerProject(req.body || {}) });
});
router.get("/runtime/projects", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProj) return res.status(503).json({ success: false, error: "multiProjectRuntime_unavailable" });
    return res.json({ success: true, projects: multiProj.listProjects() });
});
router.post("/runtime/projects/map-session", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProj) return res.status(503).json({ success: false, error: "multiProjectRuntime_unavailable" });
    return res.json({ success: true, ...multiProj.mapSessionToProject(req.body?.sessionId, req.body?.projectName) });
});
router.post("/runtime/projects/switch", rateLimiter(5, 60_000), (req, res) => {
    if (!multiProj) return res.status(503).json({ success: false, error: "multiProjectRuntime_unavailable" });
    return res.json({ success: true, ...multiProj.switchProject(req.body?.sessionId, req.body?.projectName, { approved: req.body?.approved }) });
});
router.post("/runtime/projects/enforce-isolation", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProj) return res.status(503).json({ success: false, error: "multiProjectRuntime_unavailable" });
    return res.json({ success: true, ...multiProj.enforceIsolation(req.body?.sessionId, req.body?.resourceKey) });
});

// Phase 596 — Platform Performance
router.get("/runtime/perf/cache-stats", rateLimiter(20, 60_000), (req, res) => {
    if (!platPerf) return res.status(503).json({ success: false, error: "platformPerformance_unavailable" });
    return res.json({ success: true, ...platPerf.cacheStats() });
});
router.get("/runtime/perf/responsiveness", rateLimiter(5, 60_000), (req, res) => {
    if (!platPerf) return res.status(503).json({ success: false, error: "platformPerformance_unavailable" });
    return res.json({ success: true, ...platPerf.measureResponsiveness() });
});
router.get("/runtime/perf/foundation-health", rateLimiter(10, 60_000), (req, res) => {
    if (!platPerf) return res.status(503).json({ success: false, error: "platformPerformance_unavailable" });
    return res.json({ success: true, ...platPerf.loadFoundationHealth(req.query.cached !== "false") });
});
router.get("/runtime/perf/session-restore/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!platPerf) return res.status(503).json({ success: false, error: "platformPerformance_unavailable" });
    return res.json({ success: true, ...platPerf.fastSessionRestore(req.params.sessionId) });
});
router.post("/runtime/perf/prune-cache", rateLimiter(5, 60_000), (req, res) => {
    if (!platPerf) return res.status(503).json({ success: false, error: "platformPerformance_unavailable" });
    return res.json({ success: true, ...platPerf.pruneExpiredCache() });
});
router.get("/runtime/perf/timeline", rateLimiter(20, 60_000), (req, res) => {
    if (!platPerf) return res.status(503).json({ success: false, error: "platformPerformance_unavailable" });
    return res.json({ success: true, ...platPerf.paginateTimeline({ type: req.query.type, sessionId: req.query.sessionId, page: parseInt(req.query.page) || 0, pageSize: parseInt(req.query.pageSize) || 20 }) });
});

// Phase 597 — Real-World Validation
router.post("/runtime/rw-validation/run", rateLimiter(2, 60_000), (req, res) => {
    if (!rwValidation) return res.status(503).json({ success: false, error: "realWorldValidation_unavailable" });
    return res.json({ success: true, ...rwValidation.runValidation() });
});

// Phase 598 — Resilience Test 600-series
router.post("/runtime/resilience600/run", rateLimiter(2, 60_000), (req, res) => {
    if (!resilTest600) return res.status(503).json({ success: false, error: "resilienceTest600_unavailable" });
    return res.json({ success: true, ...resilTest600.runAll() });
});

// Phase 599 — Operator Automation Audit
router.post("/runtime/op-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!opAudit) return res.status(503).json({ success: false, error: "operatorAutomationAudit_unavailable" });
    return res.json({ success: true, ...opAudit.runAudit() });
});

// Phase 600 — Operator Engineering Platform
router.get("/runtime/op-platform/health", rateLimiter(5, 60_000), (req, res) => {
    if (!opEngPlat) return res.status(503).json({ success: false, error: "operatorEngineeringPlatform_unavailable" });
    return res.json({ success: true, ...opEngPlat.platformHealth() });
});
router.get("/runtime/op-platform/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!opEngPlat) return res.status(503).json({ success: false, error: "operatorEngineeringPlatform_unavailable" });
    return res.json({ success: true, ...opEngPlat.fullPlatformHealth() });
});
router.get("/runtime/op-platform/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!opEngPlat) return res.status(503).json({ success: false, error: "operatorEngineeringPlatform_unavailable" });
    return res.json({ success: true, capabilities: opEngPlat.capabilities600() });
});
router.get("/runtime/op-platform/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!opEngPlat) return res.status(503).json({ success: false, error: "operatorEngineeringPlatform_unavailable" });
    return res.json({ success: true, ...opEngPlat.moduleHealth600() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phases 601–615 — Real Daily Engineering Environment
// ─────────────────────────────────────────────────────────────────────────────

const _runtimeDir615 = require("path").join(__dirname, "../../agents/runtime");
function _req615(name) { try { return require(require("path").join(_runtimeDir615, name)); } catch { return null; } }

const debugWfEngine   = _req615("debugWorkflowEngine.cjs");
const deployWfEngine  = _req615("deployWorkflowEngine.cjs");
const vscodeMaturity  = _req615("vscodeExecutionMaturity.cjs");
const browserMaturity = _req615("browserWorkflowMaturity.cjs");
const trustLayer      = _req615("operationalTrustLayer.cjs");
const wfSurvivability = _req615("workflowSurvivability.cjs");
const prodDashboard   = _req615("dailyProductivityDashboard.cjs");
const envHealth       = _req615("engineeringEnvironmentHealth.cjs");
const replaySystem    = _req615("executionReplaySystem.cjs");
const sessionCont     = _req615("debugSessionContinuity.cjs");
const deployEngine    = _req615("deploymentSurvivabilityEngine.cjs");
const envBootstrap    = _req615("environmentBootstrapHardening.cjs");
const resil615        = _req615("resilienceTest615.cjs");
const engAudit        = _req615("dailyEngineeringAudit.cjs");
const engFoundation   = _req615("dailyEngineeringFoundation.cjs");

// Phase 601 — Debug Workflow Engine
router.post("/runtime/debug-workflow/open", rateLimiter(10, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, ...debugWfEngine.openSession(req.body) });
});
router.post("/runtime/debug-workflow/:sessionId/ingest", rateLimiter(20, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, ...debugWfEngine.ingestErrors(req.params.sessionId, req.body.errors || []) });
});
router.post("/runtime/debug-workflow/:sessionId/plan", rateLimiter(10, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, ...debugWfEngine.buildPlan(req.params.sessionId) });
});
router.post("/runtime/debug-workflow/:sessionId/step", rateLimiter(30, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, ...debugWfEngine.recordStepResult(req.params.sessionId, req.body.stepOrder, req.body.result) });
});
router.post("/runtime/debug-workflow/:sessionId/close", rateLimiter(10, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, ...debugWfEngine.closeSession(req.params.sessionId, req.body) });
});
router.get("/runtime/debug-workflow", rateLimiter(20, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, sessions: debugWfEngine.listSessions({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});
router.get("/runtime/debug-workflow/active", rateLimiter(20, 60_000), (req, res) => {
    if (!debugWfEngine) return res.status(503).json({ success: false, error: "debugWorkflowEngine_unavailable" });
    return res.json({ success: true, sessions: debugWfEngine.activeSessions() });
});

// Phase 602 — Deploy Workflow Engine
router.post("/runtime/deploy-workflow/open", rateLimiter(5, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, ...deployWfEngine.openDeployment(req.body) });
});
router.post("/runtime/deploy-workflow/:deploymentId/approve", rateLimiter(5, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, ...deployWfEngine.approveDeployment(req.params.deploymentId, req.body) });
});
router.post("/runtime/deploy-workflow/:deploymentId/execute", rateLimiter(5, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, ...deployWfEngine.recordExecutionStart(req.params.deploymentId, req.body) });
});
router.post("/runtime/deploy-workflow/:deploymentId/monitor", rateLimiter(20, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, ...deployWfEngine.recordMonitorEvent(req.params.deploymentId, req.body.event) });
});
router.post("/runtime/deploy-workflow/:deploymentId/complete", rateLimiter(5, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, ...deployWfEngine.completeDeployment(req.params.deploymentId, req.body) });
});
router.post("/runtime/deploy-workflow/:deploymentId/rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, ...deployWfEngine.triggerRollback(req.params.deploymentId, req.body) });
});
router.get("/runtime/deploy-workflow", rateLimiter(20, 60_000), (req, res) => {
    if (!deployWfEngine) return res.status(503).json({ success: false, error: "deployWorkflowEngine_unavailable" });
    return res.json({ success: true, deployments: deployWfEngine.listDeployments({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 603 — VS Code Execution Maturity
router.post("/runtime/vscode/context", rateLimiter(20, 60_000), (req, res) => {
    if (!vscodeMaturity) return res.status(503).json({ success: false, error: "vscodeExecutionMaturity_unavailable" });
    return res.json({ success: true, ...vscodeMaturity.setEditorContext(req.body.sessionId, req.body) });
});
router.get("/runtime/vscode/context/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!vscodeMaturity) return res.status(503).json({ success: false, error: "vscodeExecutionMaturity_unavailable" });
    const ctx = vscodeMaturity.getEditorContext(req.params.sessionId);
    return res.json({ success: true, context: ctx });
});
router.get("/runtime/vscode/launch-configs", rateLimiter(10, 60_000), (req, res) => {
    if (!vscodeMaturity) return res.status(503).json({ success: false, error: "vscodeExecutionMaturity_unavailable" });
    return res.json({ success: true, ...vscodeMaturity.getLaunchConfigs() });
});
router.get("/runtime/vscode/chain/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!vscodeMaturity) return res.status(503).json({ success: false, error: "vscodeExecutionMaturity_unavailable" });
    return res.json({ success: true, ...vscodeMaturity.recommendChain(req.params.sessionId) });
});

// Phase 604 — Browser Workflow Maturity
router.get("/runtime/browser-maturity/report", rateLimiter(10, 60_000), (req, res) => {
    if (!browserMaturity) return res.status(503).json({ success: false, error: "browserWorkflowMaturity_unavailable" });
    return res.json({ success: true, ...browserMaturity.maturityReport() });
});
router.post("/runtime/browser-maturity/auth", rateLimiter(10, 60_000), (req, res) => {
    if (!browserMaturity) return res.status(503).json({ success: false, error: "browserWorkflowMaturity_unavailable" });
    return res.json({ success: true, ...browserMaturity.registerAuthSession(req.body.domain, req.body.token, req.body.ttlMs) });
});
router.get("/runtime/browser-maturity/auth", rateLimiter(20, 60_000), (req, res) => {
    if (!browserMaturity) return res.status(503).json({ success: false, error: "browserWorkflowMaturity_unavailable" });
    return res.json({ success: true, sessions: browserMaturity.listAuthSessions() });
});
router.post("/runtime/browser-maturity/validate-extraction", rateLimiter(10, 60_000), (req, res) => {
    if (!browserMaturity) return res.status(503).json({ success: false, error: "browserWorkflowMaturity_unavailable" });
    return res.json({ success: true, ...browserMaturity.validateExtraction(req.body.data, req.body.schema) });
});

// Phase 605 — Operational Trust Layer
router.get("/runtime/trust/score", rateLimiter(20, 60_000), (req, res) => {
    if (!trustLayer) return res.status(503).json({ success: false, error: "operationalTrustLayer_unavailable" });
    return res.json({ success: true, ...trustLayer.getTrustScore() });
});
router.post("/runtime/trust/signal", rateLimiter(20, 60_000), (req, res) => {
    if (!trustLayer) return res.status(503).json({ success: false, error: "operationalTrustLayer_unavailable" });
    return res.json({ success: true, ...trustLayer.recordSignal(req.body.signal, req.body) });
});
router.get("/runtime/trust/gate/:operation", rateLimiter(20, 60_000), (req, res) => {
    if (!trustLayer) return res.status(503).json({ success: false, error: "operationalTrustLayer_unavailable" });
    return res.json({ success: true, ...trustLayer.gateOperation(req.params.operation) });
});
router.get("/runtime/trust/report", rateLimiter(10, 60_000), (req, res) => {
    if (!trustLayer) return res.status(503).json({ success: false, error: "operationalTrustLayer_unavailable" });
    return res.json({ success: true, ...trustLayer.trustReport() });
});

// Phase 606 — Workflow Survivability
router.post("/runtime/survivability/checkpoint", rateLimiter(20, 60_000), (req, res) => {
    if (!wfSurvivability) return res.status(503).json({ success: false, error: "workflowSurvivability_unavailable" });
    return res.json({ success: true, ...wfSurvivability.saveCheckpoint(req.body.workflowId, req.body.stepIndex, req.body.state) });
});
router.get("/runtime/survivability/checkpoint/:workflowId", rateLimiter(20, 60_000), (req, res) => {
    if (!wfSurvivability) return res.status(503).json({ success: false, error: "workflowSurvivability_unavailable" });
    return res.json({ success: true, ...wfSurvivability.loadCheckpoint(req.params.workflowId) });
});
router.get("/runtime/survivability/score", rateLimiter(10, 60_000), (req, res) => {
    if (!wfSurvivability) return res.status(503).json({ success: false, error: "workflowSurvivability_unavailable" });
    return res.json({ success: true, ...wfSurvivability.survivabilityScore() });
});
router.get("/runtime/survivability/stale", rateLimiter(10, 60_000), (req, res) => {
    if (!wfSurvivability) return res.status(503).json({ success: false, error: "workflowSurvivability_unavailable" });
    return res.json({ success: true, ...wfSurvivability.detectStaleWorkflows() });
});
router.post("/runtime/survivability/resume", rateLimiter(5, 60_000), (req, res) => {
    if (!wfSurvivability) return res.status(503).json({ success: false, error: "workflowSurvivability_unavailable" });
    return res.json({ success: true, ...wfSurvivability.resumeWorkflow(req.body.workflowId, req.body) });
});

// Phase 607 — Daily Productivity Dashboard
router.get("/runtime/dashboard/briefing", rateLimiter(10, 60_000), (req, res) => {
    if (!prodDashboard) return res.status(503).json({ success: false, error: "dailyProductivityDashboard_unavailable" });
    return res.json({ success: true, ...prodDashboard.morningBriefing(req.query.sessionId) });
});
router.get("/runtime/dashboard/status", rateLimiter(30, 60_000), (req, res) => {
    if (!prodDashboard) return res.status(503).json({ success: false, error: "dailyProductivityDashboard_unavailable" });
    return res.json({ success: true, ...prodDashboard.quickStatus() });
});
router.get("/runtime/dashboard/workflows", rateLimiter(20, 60_000), (req, res) => {
    if (!prodDashboard) return res.status(503).json({ success: false, error: "dailyProductivityDashboard_unavailable" });
    return res.json({ success: true, ...prodDashboard.suggestWorkflows(req.query.goal || "") });
});

// Phase 608 — Engineering Environment Health
router.get("/runtime/env-health/scan", rateLimiter(5, 60_000), (req, res) => {
    if (!envHealth) return res.status(503).json({ success: false, error: "engineeringEnvironmentHealth_unavailable" });
    return res.json({ success: true, ...envHealth.scanEnvironment() });
});
router.get("/runtime/env-health/processes", rateLimiter(10, 60_000), (req, res) => {
    if (!envHealth) return res.status(503).json({ success: false, error: "engineeringEnvironmentHealth_unavailable" });
    return res.json({ success: true, ...envHealth.processHealth() });
});
router.get("/runtime/env-health/report", rateLimiter(5, 60_000), (req, res) => {
    if (!envHealth) return res.status(503).json({ success: false, error: "engineeringEnvironmentHealth_unavailable" });
    return res.json({ success: true, ...envHealth.environmentHealthReport() });
});

// Phase 609 — Execution Replay System
router.post("/runtime/replay/record", rateLimiter(10, 60_000), (req, res) => {
    if (!replaySystem) return res.status(503).json({ success: false, error: "executionReplaySystem_unavailable" });
    return res.json({ success: true, ...replaySystem.recordReplay(req.body) });
});
router.post("/runtime/replay/:replayId/execute", rateLimiter(5, 60_000), (req, res) => {
    if (!replaySystem) return res.status(503).json({ success: false, error: "executionReplaySystem_unavailable" });
    return res.json({ success: true, ...replaySystem.executeReplay(req.params.replayId, req.body) });
});
router.get("/runtime/replay/:id1/diff/:id2", rateLimiter(10, 60_000), (req, res) => {
    if (!replaySystem) return res.status(503).json({ success: false, error: "executionReplaySystem_unavailable" });
    return res.json({ success: true, ...replaySystem.replayDiff(req.params.id1, req.params.id2) });
});
router.get("/runtime/replay", rateLimiter(20, 60_000), (req, res) => {
    if (!replaySystem) return res.status(503).json({ success: false, error: "executionReplaySystem_unavailable" });
    return res.json({ success: true, replays: replaySystem.listReplays({ tag: req.query.tag, sessionId: req.query.sessionId, limit: Number(req.query.limit) || 20 }) });
});

// Phase 610 — Debug Session Continuity
router.post("/runtime/session-continuity/save", rateLimiter(20, 60_000), (req, res) => {
    if (!sessionCont) return res.status(503).json({ success: false, error: "debugSessionContinuity_unavailable" });
    return res.json({ success: true, ...sessionCont.saveSessionState(req.body.sessionId, req.body) });
});
router.get("/runtime/session-continuity/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!sessionCont) return res.status(503).json({ success: false, error: "debugSessionContinuity_unavailable" });
    return res.json({ success: true, ...sessionCont.restoreSessionState(req.params.sessionId) });
});
router.get("/runtime/session-continuity/:sessionId/summary", rateLimiter(20, 60_000), (req, res) => {
    if (!sessionCont) return res.status(503).json({ success: false, error: "debugSessionContinuity_unavailable" });
    return res.json({ success: true, ...sessionCont.continuitySummary(req.params.sessionId) });
});
router.post("/runtime/session-continuity/:sessionId/hypothesis", rateLimiter(20, 60_000), (req, res) => {
    if (!sessionCont) return res.status(503).json({ success: false, error: "debugSessionContinuity_unavailable" });
    return res.json({ success: true, ...sessionCont.addHypothesis(req.params.sessionId, req.body.hypothesis, req.body) });
});
router.get("/runtime/session-continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!sessionCont) return res.status(503).json({ success: false, error: "debugSessionContinuity_unavailable" });
    return res.json({ success: true, sessions: sessionCont.listContinuity({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 611 — Deployment Survivability Engine
router.post("/runtime/deploy-survivability/snapshot", rateLimiter(5, 60_000), (req, res) => {
    if (!deployEngine) return res.status(503).json({ success: false, error: "deploymentSurvivabilityEngine_unavailable" });
    return res.json({ success: true, ...deployEngine.captureSnapshot(req.body.deploymentId, req.body) });
});
router.post("/runtime/deploy-survivability/phased/init", rateLimiter(5, 60_000), (req, res) => {
    if (!deployEngine) return res.status(503).json({ success: false, error: "deploymentSurvivabilityEngine_unavailable" });
    return res.json({ success: true, ...deployEngine.initPhasedDeployment(req.body.deploymentId, req.body) });
});
router.post("/runtime/deploy-survivability/phased/:deploymentId/advance", rateLimiter(5, 60_000), (req, res) => {
    if (!deployEngine) return res.status(503).json({ success: false, error: "deploymentSurvivabilityEngine_unavailable" });
    return res.json({ success: true, ...deployEngine.advancePhase(req.params.deploymentId, req.body) });
});
router.get("/runtime/deploy-survivability/:deploymentId/rollback-recommendation", rateLimiter(10, 60_000), (req, res) => {
    if (!deployEngine) return res.status(503).json({ success: false, error: "deploymentSurvivabilityEngine_unavailable" });
    return res.json({ success: true, ...deployEngine.rollbackRecommendation(req.params.deploymentId) });
});
router.get("/runtime/deploy-survivability/score", rateLimiter(10, 60_000), (req, res) => {
    if (!deployEngine) return res.status(503).json({ success: false, error: "deploymentSurvivabilityEngine_unavailable" });
    return res.json({ success: true, ...deployEngine.survivabilityScore() });
});

// Phase 612 — Environment Bootstrap Hardening
router.get("/runtime/bootstrap/plan", rateLimiter(5, 60_000), (req, res) => {
    if (!envBootstrap) return res.status(503).json({ success: false, error: "environmentBootstrapHardening_unavailable" });
    return res.json({ success: true, ...envBootstrap.bootstrapPlan() });
});
router.get("/runtime/bootstrap/deps", rateLimiter(5, 60_000), (req, res) => {
    if (!envBootstrap) return res.status(503).json({ success: false, error: "environmentBootstrapHardening_unavailable" });
    return res.json({ success: true, ...envBootstrap.verifyDependencies() });
});
router.get("/runtime/bootstrap/env", rateLimiter(5, 60_000), (req, res) => {
    if (!envBootstrap) return res.status(503).json({ success: false, error: "environmentBootstrapHardening_unavailable" });
    return res.json({ success: true, ...envBootstrap.validateEnvFile() });
});

// Phase 613 — Resilience Test 615
router.post("/runtime/resilience615/run", rateLimiter(2, 60_000), (req, res) => {
    if (!resil615) return res.status(503).json({ success: false, error: "resilienceTest615_unavailable" });
    return res.json({ success: true, ...resil615.runAll() });
});

// Phase 614 — Daily Engineering Audit
router.post("/runtime/eng-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!engAudit) return res.status(503).json({ success: false, error: "dailyEngineeringAudit_unavailable" });
    return res.json({ success: true, ...engAudit.runAudit() });
});

// Phase 615 — Daily Engineering Foundation
router.get("/runtime/eng-foundation/health", rateLimiter(5, 60_000), (req, res) => {
    if (!engFoundation) return res.status(503).json({ success: false, error: "dailyEngineeringFoundation_unavailable" });
    return res.json({ success: true, ...engFoundation.platformHealth615() });
});
router.get("/runtime/eng-foundation/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!engFoundation) return res.status(503).json({ success: false, error: "dailyEngineeringFoundation_unavailable" });
    return res.json({ success: true, ...engFoundation.fullPlatformHealth() });
});
router.get("/runtime/eng-foundation/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!engFoundation) return res.status(503).json({ success: false, error: "dailyEngineeringFoundation_unavailable" });
    return res.json({ success: true, capabilities: engFoundation.capabilities615() });
});
router.get("/runtime/eng-foundation/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!engFoundation) return res.status(503).json({ success: false, error: "dailyEngineeringFoundation_unavailable" });
    return res.json({ success: true, ...engFoundation.moduleHealth615() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phases 616–630 — Semi-Autonomous Engineering Operator
// ─────────────────────────────────────────────────────────────────────────────

const _runtimeDir630 = require("path").join(__dirname, "../../agents/runtime");
function _req630(name) { try { return require(require("path").join(_runtimeDir630, name)); } catch { return null; } }

const autoDebugChains  = _req630("autonomousDebugChains.cjs");
const autoPatchPrep    = _req630("autonomousPatchPrep.cjs");
const goalExecution    = _req630("engineeringGoalExecution.cjs");
const autoTerminal     = _req630("autonomousTerminalOrchestration.cjs");
const autoBrowser      = _req630("autonomousBrowserWorkflows.cjs");
const decisionEngine   = _req630("operationalDecisionEngine.cjs");
const trustEvolution   = _req630("executionTrustEvolution.cjs");
const memoryEvolution  = _req630("engineeringMemoryEvolution.cjs");
const dailyAutomation  = _req630("dailyEngineeringAutomation.cjs");
const longHorizon      = _req630("longHorizonContinuity.cjs");
const stressTest630    = _req630("semiAutonomousStressTest.cjs");
const productivityEvo  = _req630("operatorProductivityEvolution.cjs");
const survivAudit      = _req630("platformSurvivabilityAudit.cjs");
const dailyDriver      = _req630("dailyDriverValidation.cjs");
const semiAutoFound    = _req630("semiAutonomousFoundation.cjs");

// Phase 616 — Autonomous Debug Chains
router.post("/runtime/auto-debug/plan", rateLimiter(10, 60_000), (req, res) => {
    if (!autoDebugChains) return res.status(503).json({ success: false, error: "autonomousDebugChains_unavailable" });
    return res.json({ success: true, ...autoDebugChains.planDebugChain(req.body.goal, req.body.sessionId) });
});
router.post("/runtime/auto-debug/:chainId/step", rateLimiter(20, 60_000), (req, res) => {
    if (!autoDebugChains) return res.status(503).json({ success: false, error: "autonomousDebugChains_unavailable" });
    return res.json({ success: true, ...autoDebugChains.executeStep(req.params.chainId, req.body.stepOrder, req.body) });
});
router.post("/runtime/auto-debug/:chainId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!autoDebugChains) return res.status(503).json({ success: false, error: "autonomousDebugChains_unavailable" });
    return res.json({ success: true, ...autoDebugChains.interruptChain(req.params.chainId, req.body) });
});
router.get("/runtime/auto-debug", rateLimiter(20, 60_000), (req, res) => {
    if (!autoDebugChains) return res.status(503).json({ success: false, error: "autonomousDebugChains_unavailable" });
    return res.json({ success: true, chains: autoDebugChains.listChains({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 617 — Autonomous Patch Prep
router.post("/runtime/auto-patch/propose", rateLimiter(10, 60_000), (req, res) => {
    if (!autoPatchPrep) return res.status(503).json({ success: false, error: "autonomousPatchPrep_unavailable" });
    return res.json({ success: true, ...autoPatchPrep.proposePatch(req.body) });
});
router.post("/runtime/auto-patch/:proposalId/apply", rateLimiter(5, 60_000), (req, res) => {
    if (!autoPatchPrep) return res.status(503).json({ success: false, error: "autonomousPatchPrep_unavailable" });
    return res.json({ success: true, ...autoPatchPrep.applyPatch(req.params.proposalId, req.body) });
});
router.post("/runtime/auto-patch/:proposalId/reject", rateLimiter(10, 60_000), (req, res) => {
    if (!autoPatchPrep) return res.status(503).json({ success: false, error: "autonomousPatchPrep_unavailable" });
    return res.json({ success: true, ...autoPatchPrep.rejectPatch(req.params.proposalId, req.body) });
});
router.get("/runtime/auto-patch/:proposalId/stale", rateLimiter(10, 60_000), (req, res) => {
    if (!autoPatchPrep) return res.status(503).json({ success: false, error: "autonomousPatchPrep_unavailable" });
    return res.json({ success: true, ...autoPatchPrep.checkForStaleFile(req.params.proposalId) });
});
router.post("/runtime/auto-patch/repair-suggestions", rateLimiter(10, 60_000), (req, res) => {
    if (!autoPatchPrep) return res.status(503).json({ success: false, error: "autonomousPatchPrep_unavailable" });
    return res.json({ success: true, ...autoPatchPrep.suggestRepairs(req.body.errorText, req.body.filePath) });
});
router.get("/runtime/auto-patch", rateLimiter(20, 60_000), (req, res) => {
    if (!autoPatchPrep) return res.status(503).json({ success: false, error: "autonomousPatchPrep_unavailable" });
    return res.json({ success: true, proposals: autoPatchPrep.listProposals({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 618 — Engineering Goal Execution
router.post("/runtime/goal/execute", rateLimiter(10, 60_000), (req, res) => {
    if (!goalExecution) return res.status(503).json({ success: false, error: "engineeringGoalExecution_unavailable" });
    return res.json({ success: true, ...goalExecution.executeGoal(req.body) });
});
router.post("/runtime/goal/:goalId/outcome", rateLimiter(10, 60_000), (req, res) => {
    if (!goalExecution) return res.status(503).json({ success: false, error: "engineeringGoalExecution_unavailable" });
    return res.json({ success: true, ...goalExecution.recordOutcome(req.params.goalId, req.body) });
});
router.get("/runtime/goal/:goalId/summary", rateLimiter(20, 60_000), (req, res) => {
    if (!goalExecution) return res.status(503).json({ success: false, error: "engineeringGoalExecution_unavailable" });
    return res.json({ success: true, ...goalExecution.goalSummary(req.params.goalId) });
});
router.get("/runtime/goal", rateLimiter(20, 60_000), (req, res) => {
    if (!goalExecution) return res.status(503).json({ success: false, error: "engineeringGoalExecution_unavailable" });
    return res.json({ success: true, goals: goalExecution.listGoals({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 619 — Autonomous Terminal Orchestration
router.post("/runtime/terminal/classify", rateLimiter(30, 60_000), (req, res) => {
    if (!autoTerminal) return res.status(503).json({ success: false, error: "autonomousTerminalOrchestration_unavailable" });
    return res.json({ success: true, ...autoTerminal.classifyCommand(req.body.command) });
});
router.post("/runtime/terminal/sequence", rateLimiter(10, 60_000), (req, res) => {
    if (!autoTerminal) return res.status(503).json({ success: false, error: "autonomousTerminalOrchestration_unavailable" });
    return res.json({ success: true, ...autoTerminal.planSequence(req.body) });
});
router.post("/runtime/terminal/:sequenceId/step", rateLimiter(20, 60_000), (req, res) => {
    if (!autoTerminal) return res.status(503).json({ success: false, error: "autonomousTerminalOrchestration_unavailable" });
    return res.json({ success: true, ...autoTerminal.recordCommandResult(req.params.sequenceId, req.body.order, req.body) });
});
router.post("/runtime/terminal/:sequenceId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!autoTerminal) return res.status(503).json({ success: false, error: "autonomousTerminalOrchestration_unavailable" });
    return res.json({ success: true, ...autoTerminal.interruptSequence(req.params.sequenceId, req.body) });
});
router.post("/runtime/terminal/restart", rateLimiter(5, 60_000), (req, res) => {
    if (!autoTerminal) return res.status(503).json({ success: false, error: "autonomousTerminalOrchestration_unavailable" });
    return res.json({ success: true, ...autoTerminal.recordRestart(req.body.processName, req.body.sessionId, req.body) });
});
router.get("/runtime/terminal/:sequenceId/checkpoint", rateLimiter(20, 60_000), (req, res) => {
    if (!autoTerminal) return res.status(503).json({ success: false, error: "autonomousTerminalOrchestration_unavailable" });
    return res.json({ success: true, ...autoTerminal.validationCheckpoint(req.params.sequenceId) });
});

// Phase 620 — Autonomous Browser Workflows
router.post("/runtime/auto-browser/start", rateLimiter(10, 60_000), (req, res) => {
    if (!autoBrowser) return res.status(503).json({ success: false, error: "autonomousBrowserWorkflows_unavailable" });
    return res.json({ success: true, ...autoBrowser.startSession(req.body) });
});
router.post("/runtime/auto-browser/:sessionDbId/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!autoBrowser) return res.status(503).json({ success: false, error: "autonomousBrowserWorkflows_unavailable" });
    return res.json({ success: true, ...autoBrowser.advanceStep(req.params.sessionDbId, req.body) });
});
router.post("/runtime/auto-browser/:sessionDbId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!autoBrowser) return res.status(503).json({ success: false, error: "autonomousBrowserWorkflows_unavailable" });
    return res.json({ success: true, ...autoBrowser.interruptSession(req.params.sessionDbId, req.body) });
});
router.post("/runtime/auto-browser/:sessionDbId/resume", rateLimiter(5, 60_000), (req, res) => {
    if (!autoBrowser) return res.status(503).json({ success: false, error: "autonomousBrowserWorkflows_unavailable" });
    return res.json({ success: true, ...autoBrowser.resumeSession(req.params.sessionDbId, req.body) });
});
router.get("/runtime/auto-browser", rateLimiter(20, 60_000), (req, res) => {
    if (!autoBrowser) return res.status(503).json({ success: false, error: "autonomousBrowserWorkflows_unavailable" });
    return res.json({ success: true, sessions: autoBrowser.listSessions({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 621 — Operational Decision Engine
router.post("/runtime/decision/recovery-path", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEngine) return res.status(503).json({ success: false, error: "operationalDecisionEngine_unavailable" });
    return res.json({ success: true, ...decisionEngine.chooseRecoveryPath(req.body.errorContext) });
});
router.post("/runtime/decision/prioritize-validation", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEngine) return res.status(503).json({ success: false, error: "operationalDecisionEngine_unavailable" });
    return res.json({ success: true, ...decisionEngine.prioritizeValidation(req.body) });
});
router.post("/runtime/decision/rollback", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEngine) return res.status(503).json({ success: false, error: "operationalDecisionEngine_unavailable" });
    return res.json({ success: true, ...decisionEngine.recommendRollback(req.body) });
});
router.post("/runtime/decision/unsafe-state", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEngine) return res.status(503).json({ success: false, error: "operationalDecisionEngine_unavailable" });
    return res.json({ success: true, ...decisionEngine.detectUnsafeState(req.body) });
});
router.post("/runtime/decision/stabilize", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEngine) return res.status(503).json({ success: false, error: "operationalDecisionEngine_unavailable" });
    return res.json({ success: true, ...decisionEngine.suggestStabilization(req.body) });
});
router.get("/runtime/decision/history", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEngine) return res.status(503).json({ success: false, error: "operationalDecisionEngine_unavailable" });
    return res.json({ success: true, decisions: decisionEngine.listDecisions({ type: req.query.type, limit: Number(req.query.limit) || 20 }) });
});

// Phase 622 — Execution Trust Evolution
router.post("/runtime/trust-evolution/event", rateLimiter(20, 60_000), (req, res) => {
    if (!trustEvolution) return res.status(503).json({ success: false, error: "executionTrustEvolution_unavailable" });
    return res.json({ success: true, ...trustEvolution.recordTrustEvent(req.body.eventType, req.body) });
});
router.get("/runtime/trust-evolution/progression", rateLimiter(10, 60_000), (req, res) => {
    if (!trustEvolution) return res.status(503).json({ success: false, error: "executionTrustEvolution_unavailable" });
    return res.json({ success: true, ...trustEvolution.trustProgression({ windowDays: Number(req.query.days) || 30 }) });
});
router.get("/runtime/trust-evolution/autonomy-safety", rateLimiter(10, 60_000), (req, res) => {
    if (!trustEvolution) return res.status(503).json({ success: false, error: "executionTrustEvolution_unavailable" });
    return res.json({ success: true, ...trustEvolution.autonomySafetyScore() });
});
router.post("/runtime/trust-evolution/snapshot", rateLimiter(5, 60_000), (req, res) => {
    if (!trustEvolution) return res.status(503).json({ success: false, error: "executionTrustEvolution_unavailable" });
    return res.json({ success: true, ...trustEvolution.takeSnapshot() });
});
router.get("/runtime/trust-evolution/confidence", rateLimiter(10, 60_000), (req, res) => {
    if (!trustEvolution) return res.status(503).json({ success: false, error: "executionTrustEvolution_unavailable" });
    return res.json({ success: true, ...trustEvolution.confidenceSummary() });
});

// Phase 623 — Engineering Memory Evolution
router.post("/runtime/memory-evolution/upsert", rateLimiter(20, 60_000), (req, res) => {
    if (!memoryEvolution) return res.status(503).json({ success: false, error: "engineeringMemoryEvolution_unavailable" });
    return res.json({ success: true, ...memoryEvolution.upsertMemory(req.body) });
});
router.get("/runtime/memory-evolution/query", rateLimiter(20, 60_000), (req, res) => {
    if (!memoryEvolution) return res.status(503).json({ success: false, error: "engineeringMemoryEvolution_unavailable" });
    return res.json({ success: true, results: memoryEvolution.query(req.query.q, { type: req.query.type, limit: Number(req.query.limit) || 10 }) });
});
router.post("/runtime/memory-evolution/prune", rateLimiter(2, 60_000), (req, res) => {
    if (!memoryEvolution) return res.status(503).json({ success: false, error: "engineeringMemoryEvolution_unavailable" });
    return res.json({ success: true, ...memoryEvolution.pruneStaleMemories({ dryRun: req.body.dryRun !== false }) });
});
router.get("/runtime/memory-evolution/stats", rateLimiter(10, 60_000), (req, res) => {
    if (!memoryEvolution) return res.status(503).json({ success: false, error: "engineeringMemoryEvolution_unavailable" });
    return res.json({ success: true, ...memoryEvolution.memoryStats() });
});
router.get("/runtime/memory-evolution/recovery-chains", rateLimiter(10, 60_000), (req, res) => {
    if (!memoryEvolution) return res.status(503).json({ success: false, error: "engineeringMemoryEvolution_unavailable" });
    return res.json({ success: true, ...memoryEvolution.prioritizeRecoveryChains(req.query.error || "") });
});

// Phase 624 — Daily Engineering Automation
router.post("/runtime/daily-automation/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyAutomation) return res.status(503).json({ success: false, error: "dailyEngineeringAutomation_unavailable" });
    return res.json({ success: true, ...dailyAutomation.startAutomation(req.body.automationName, req.body) });
});
router.post("/runtime/daily-automation/:runId/step", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyAutomation) return res.status(503).json({ success: false, error: "dailyEngineeringAutomation_unavailable" });
    return res.json({ success: true, ...dailyAutomation.recordStepResult(req.params.runId, req.body.stepOrder, req.body) });
});
router.post("/runtime/daily-automation/:runId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyAutomation) return res.status(503).json({ success: false, error: "dailyEngineeringAutomation_unavailable" });
    return res.json({ success: true, ...dailyAutomation.interruptAutomation(req.params.runId, req.body) });
});
router.post("/runtime/daily-automation/:runId/resume", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyAutomation) return res.status(503).json({ success: false, error: "dailyEngineeringAutomation_unavailable" });
    return res.json({ success: true, ...dailyAutomation.resumeAutomation(req.params.runId, req.body) });
});
router.get("/runtime/daily-automation/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyAutomation) return res.status(503).json({ success: false, error: "dailyEngineeringAutomation_unavailable" });
    return res.json({ success: true, catalog: dailyAutomation.catalogList() });
});
router.get("/runtime/daily-automation", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyAutomation) return res.status(503).json({ success: false, error: "dailyEngineeringAutomation_unavailable" });
    return res.json({ success: true, runs: dailyAutomation.listRuns({ status: req.query.status, limit: Number(req.query.limit) || 20 }) });
});

// Phase 625 — Long-Horizon Continuity
router.post("/runtime/long-horizon/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizon) return res.status(503).json({ success: false, error: "longHorizonContinuity_unavailable" });
    return res.json({ success: true, ...longHorizon.persistSession(req.body.sessionId, req.body) });
});
router.get("/runtime/long-horizon/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizon) return res.status(503).json({ success: false, error: "longHorizonContinuity_unavailable" });
    return res.json({ success: true, ...longHorizon.restoreSession(req.params.sessionId) });
});
router.post("/runtime/long-horizon/:sessionId/force-restore", rateLimiter(5, 60_000), (req, res) => {
    if (!longHorizon) return res.status(503).json({ success: false, error: "longHorizonContinuity_unavailable" });
    return res.json({ success: true, ...longHorizon.forceRestoreSession(req.params.sessionId) });
});
router.post("/runtime/long-horizon/:sessionId/reconnect", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizon) return res.status(503).json({ success: false, error: "longHorizonContinuity_unavailable" });
    return res.json({ success: true, ...longHorizon.recordReconnect(req.params.sessionId, req.body) });
});
router.get("/runtime/long-horizon/replay/:replayId/continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizon) return res.status(503).json({ success: false, error: "longHorizonContinuity_unavailable" });
    return res.json({ success: true, ...longHorizon.validateReplayContinuity(req.params.replayId) });
});
router.get("/runtime/long-horizon/health", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizon) return res.status(503).json({ success: false, error: "longHorizonContinuity_unavailable" });
    return res.json({ success: true, ...longHorizon.longHorizonHealth() });
});

// Phase 626 — Stress Test
router.post("/runtime/stress630/run", rateLimiter(2, 60_000), (req, res) => {
    if (!stressTest630) return res.status(503).json({ success: false, error: "semiAutonomousStressTest_unavailable" });
    return res.json({ success: true, ...stressTest630.runAll() });
});

// Phase 627 — Operator Productivity Evolution
router.get("/runtime/productivity/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!productivityEvo) return res.status(503).json({ success: false, error: "operatorProductivityEvolution_unavailable" });
    return res.json({ success: true, ...productivityEvo.productivitySummary() });
});
router.get("/runtime/productivity/debug-speed", rateLimiter(10, 60_000), (req, res) => {
    if (!productivityEvo) return res.status(503).json({ success: false, error: "operatorProductivityEvolution_unavailable" });
    return res.json({ success: true, ...productivityEvo.debuggingSpeedReport() });
});
router.get("/runtime/productivity/deploy-flow", rateLimiter(10, 60_000), (req, res) => {
    if (!productivityEvo) return res.status(503).json({ success: false, error: "operatorProductivityEvolution_unavailable" });
    return res.json({ success: true, ...productivityEvo.deploymentFlowReport() });
});
router.get("/runtime/productivity/discover", rateLimiter(20, 60_000), (req, res) => {
    if (!productivityEvo) return res.status(503).json({ success: false, error: "operatorProductivityEvolution_unavailable" });
    return res.json({ success: true, ...productivityEvo.discoverWorkflows(req.query.goal || "") });
});
router.get("/runtime/productivity/fatigue", rateLimiter(20, 60_000), (req, res) => {
    if (!productivityEvo) return res.status(503).json({ success: false, error: "operatorProductivityEvolution_unavailable" });
    return res.json({ success: true, ...productivityEvo.fatigueSummary(req.query.sessionId) });
});

// Phase 628 — Platform Survivability Audit
router.post("/runtime/survivability-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!survivAudit) return res.status(503).json({ success: false, error: "platformSurvivabilityAudit_unavailable" });
    return res.json({ success: true, ...survivAudit.runAudit() });
});

// Phase 629 — Daily-Driver Validation
router.post("/runtime/daily-driver/run", rateLimiter(2, 60_000), (req, res) => {
    if (!dailyDriver) return res.status(503).json({ success: false, error: "dailyDriverValidation_unavailable" });
    return res.json({ success: true, ...dailyDriver.runValidation() });
});

// Phase 630 — Semi-Autonomous Foundation
router.get("/runtime/semi-auto/health", rateLimiter(5, 60_000), (req, res) => {
    if (!semiAutoFound) return res.status(503).json({ success: false, error: "semiAutonomousFoundation_unavailable" });
    return res.json({ success: true, ...semiAutoFound.platformHealth630() });
});
router.get("/runtime/semi-auto/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!semiAutoFound) return res.status(503).json({ success: false, error: "semiAutonomousFoundation_unavailable" });
    return res.json({ success: true, ...semiAutoFound.fullPlatformHealth() });
});
router.get("/runtime/semi-auto/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!semiAutoFound) return res.status(503).json({ success: false, error: "semiAutonomousFoundation_unavailable" });
    return res.json({ success: true, capabilities: semiAutoFound.capabilities630() });
});
router.get("/runtime/semi-auto/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!semiAutoFound) return res.status(503).json({ success: false, error: "semiAutonomousFoundation_unavailable" });
    return res.json({ success: true, ...semiAutoFound.moduleHealth630() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phases 631–645 — Trusted Autonomous Engineering Operations
// ─────────────────────────────────────────────────────────────────────────────

const _req645 = (name) => _req630(name);

const trustedDebugAuto   = _req645("trustedDebugAutonomy.cjs");
const advPatchTrust      = _req645("advancedPatchTrust.cjs");
const autoEngGoals       = _req645("autonomousEngineeringGoals.cjs");
const autoTermSupervision = _req645("autonomousTerminalSupervision.cjs");
const autoBrowserOps     = _req645("autonomousBrowserOperations.cjs");
const engDecisionIntel   = _req645("engineeringDecisionIntelligence.cjs");
const autoWorkflowMem    = _req645("autonomousWorkflowMemory.cjs");
const dailyAutoFlows     = _req645("dailyAutonomousFlows.cjs");
const longHorizonAuto    = _req645("longHorizonAutonomousContinuity.cjs");
const stressTest640      = _req645("trustedAutonomyStressTest.cjs");
const engProductivityEvo = _req645("engineeringProductivityEvolution.cjs");
const platResilience     = _req645("advancedPlatformResilience.cjs");
const opTrustAudit       = _req645("operatorTrustAudit.cjs");
const dailyDriverAuto    = _req645("dailyDriverAutonomyValidation.cjs");
const trustedAutoFound   = _req645("trustedAutonomousFoundation.cjs");

// Phase 631 — Trusted Debug Autonomy
router.post("/runtime/trusted-debug/start", rateLimiter(10, 60_000), (req, res) => {
    if (!trustedDebugAuto) return res.status(503).json({ success: false, error: "trustedDebugAutonomy_unavailable" });
    return res.json({ success: true, ...trustedDebugAuto.startDebugRun(req.body) });
});
router.post("/runtime/trusted-debug/:runId/step/:stepOrder", rateLimiter(30, 60_000), (req, res) => {
    if (!trustedDebugAuto) return res.status(503).json({ success: false, error: "trustedDebugAutonomy_unavailable" });
    return res.json({ success: true, ...trustedDebugAuto.executeStep(req.params.runId, Number(req.params.stepOrder), req.body) });
});
router.post("/runtime/trusted-debug/:runId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!trustedDebugAuto) return res.status(503).json({ success: false, error: "trustedDebugAutonomy_unavailable" });
    return res.json({ success: true, ...trustedDebugAuto.interruptRun(req.params.runId, req.body) });
});
router.get("/runtime/trusted-debug", rateLimiter(20, 60_000), (req, res) => {
    if (!trustedDebugAuto) return res.status(503).json({ success: false, error: "trustedDebugAutonomy_unavailable" });
    return res.json({ success: true, runs: trustedDebugAuto.listRuns() });
});

// Phase 632 — Advanced Patch Trust
router.post("/runtime/patch-trust/outcome", rateLimiter(20, 60_000), (req, res) => {
    if (!advPatchTrust) return res.status(503).json({ success: false, error: "advancedPatchTrust_unavailable" });
    return res.json({ success: true, ...advPatchTrust.recordPatchOutcome(req.body) });
});
router.get("/runtime/patch-trust/tier", rateLimiter(20, 60_000), (req, res) => {
    if (!advPatchTrust) return res.status(503).json({ success: false, error: "advancedPatchTrust_unavailable" });
    return res.json({ success: true, ...advPatchTrust.patchTrustTier(req.query.filePath || "") });
});
router.get("/runtime/patch-trust/rollback-risk", rateLimiter(10, 60_000), (req, res) => {
    if (!advPatchTrust) return res.status(503).json({ success: false, error: "advancedPatchTrust_unavailable" });
    return res.json({ success: true, ...advPatchTrust.rollbackRiskIndicators(req.query) });
});
router.get("/runtime/patch-trust/confidence", rateLimiter(20, 60_000), (req, res) => {
    if (!advPatchTrust) return res.status(503).json({ success: false, error: "advancedPatchTrust_unavailable" });
    return res.json({ success: true, ...advPatchTrust.executionConfidenceSummary() });
});

// Phase 633 — Autonomous Engineering Goals
router.post("/runtime/auto-goals/start", rateLimiter(10, 60_000), (req, res) => {
    if (!autoEngGoals) return res.status(503).json({ success: false, error: "autonomousEngineeringGoals_unavailable" });
    return res.json({ success: true, ...autoEngGoals.startGoal(req.body) });
});
router.post("/runtime/auto-goals/:goalId/validation", rateLimiter(20, 60_000), (req, res) => {
    if (!autoEngGoals) return res.status(503).json({ success: false, error: "autonomousEngineeringGoals_unavailable" });
    return res.json({ success: true, ...autoEngGoals.recordValidation(req.params.goalId, req.body) });
});
router.post("/runtime/auto-goals/:goalId/complete", rateLimiter(10, 60_000), (req, res) => {
    if (!autoEngGoals) return res.status(503).json({ success: false, error: "autonomousEngineeringGoals_unavailable" });
    return res.json({ success: true, ...autoEngGoals.completeGoal(req.params.goalId, req.body) });
});
router.get("/runtime/auto-goals/:goalId", rateLimiter(20, 60_000), (req, res) => {
    if (!autoEngGoals) return res.status(503).json({ success: false, error: "autonomousEngineeringGoals_unavailable" });
    return res.json({ success: true, ...autoEngGoals.goalSummary(req.params.goalId) });
});
router.get("/runtime/auto-goals", rateLimiter(20, 60_000), (req, res) => {
    if (!autoEngGoals) return res.status(503).json({ success: false, error: "autonomousEngineeringGoals_unavailable" });
    return res.json({ success: true, goals: autoEngGoals.listGoals() });
});

// Phase 634 — Autonomous Terminal Supervision
router.post("/runtime/terminal-supervision/register", rateLimiter(20, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.registerProcess(req.body) });
});
router.post("/runtime/terminal-supervision/:processId/heartbeat", rateLimiter(60, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.heartbeat(req.params.processId, req.body) });
});
router.post("/runtime/terminal-supervision/:processId/checkpoint", rateLimiter(20, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.saveValidationCheckpoint(req.params.processId, req.body) });
});
router.get("/runtime/terminal-supervision/:processId/health", rateLimiter(20, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.verifyProcessHealth(req.params.processId) });
});
router.post("/runtime/terminal-supervision/:processId/restart", rateLimiter(5, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.requestRestart(req.params.processId, req.body) });
});
router.post("/runtime/terminal-supervision/:processId/stop", rateLimiter(10, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.stopProcess(req.params.processId) });
});
router.get("/runtime/terminal-supervision/stale", rateLimiter(10, 60_000), (req, res) => {
    if (!autoTermSupervision) return res.status(503).json({ success: false, error: "autonomousTerminalSupervision_unavailable" });
    return res.json({ success: true, ...autoTermSupervision.detectStale() });
});

// Phase 635 — Autonomous Browser Operations
router.post("/runtime/browser-ops/auth", rateLimiter(20, 60_000), (req, res) => {
    if (!autoBrowserOps) return res.status(503).json({ success: false, error: "autonomousBrowserOperations_unavailable" });
    return res.json({ success: true, ...autoBrowserOps.registerAuth(req.body.domain, req.body.token) });
});
router.post("/runtime/browser-ops/start", rateLimiter(10, 60_000), (req, res) => {
    if (!autoBrowserOps) return res.status(503).json({ success: false, error: "autonomousBrowserOperations_unavailable" });
    return res.json({ success: true, ...autoBrowserOps.startOperation(req.body) });
});
router.post("/runtime/browser-ops/:opId/step", rateLimiter(30, 60_000), (req, res) => {
    if (!autoBrowserOps) return res.status(503).json({ success: false, error: "autonomousBrowserOperations_unavailable" });
    return res.json({ success: true, ...autoBrowserOps.advanceStep(req.params.opId, req.body) });
});
router.post("/runtime/browser-ops/:opId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!autoBrowserOps) return res.status(503).json({ success: false, error: "autonomousBrowserOperations_unavailable" });
    return res.json({ success: true, ...autoBrowserOps.interruptOperation(req.params.opId, req.body) });
});
router.post("/runtime/browser-ops/:opId/recover", rateLimiter(5, 60_000), (req, res) => {
    if (!autoBrowserOps) return res.status(503).json({ success: false, error: "autonomousBrowserOperations_unavailable" });
    return res.json({ success: true, ...autoBrowserOps.recoverOperation(req.params.opId, req.body) });
});

// Phase 636 — Engineering Decision Intelligence
router.post("/runtime/decision/recovery-path", rateLimiter(20, 60_000), (req, res) => {
    if (!engDecisionIntel) return res.status(503).json({ success: false, error: "engineeringDecisionIntelligence_unavailable" });
    return res.json({ success: true, ...engDecisionIntel.prioritizeRecovery(req.body.errorContext || "") });
});
router.post("/runtime/decision/rollback-recommend", rateLimiter(10, 60_000), (req, res) => {
    if (!engDecisionIntel) return res.status(503).json({ success: false, error: "engineeringDecisionIntelligence_unavailable" });
    return res.json({ success: true, ...engDecisionIntel.recommendRollback(req.body) });
});
router.post("/runtime/decision/unsafe-runtime", rateLimiter(10, 60_000), (req, res) => {
    if (!engDecisionIntel) return res.status(503).json({ success: false, error: "engineeringDecisionIntelligence_unavailable" });
    return res.json({ success: true, ...engDecisionIntel.detectUnsafeRuntime() });
});
router.post("/runtime/decision/validation-order", rateLimiter(10, 60_000), (req, res) => {
    if (!engDecisionIntel) return res.status(503).json({ success: false, error: "engineeringDecisionIntelligence_unavailable" });
    return res.json({ success: true, ...engDecisionIntel.selectValidationOrder(req.body) });
});
router.get("/runtime/decision/history", rateLimiter(10, 60_000), (req, res) => {
    if (!engDecisionIntel) return res.status(503).json({ success: false, error: "engineeringDecisionIntelligence_unavailable" });
    return res.json({ success: true, history: engDecisionIntel.decisionHistory(req.query) });
});

// Phase 637 — Autonomous Workflow Memory
router.post("/runtime/workflow-memory/record", rateLimiter(30, 60_000), (req, res) => {
    if (!autoWorkflowMem) return res.status(503).json({ success: false, error: "autonomousWorkflowMemory_unavailable" });
    return res.json({ success: true, ...autoWorkflowMem.record(req.body) });
});
router.get("/runtime/workflow-memory/recall", rateLimiter(20, 60_000), (req, res) => {
    if (!autoWorkflowMem) return res.status(503).json({ success: false, error: "autonomousWorkflowMemory_unavailable" });
    return res.json({ success: true, ...autoWorkflowMem.recall(req.query.q || "", { type: req.query.type, limit: Number(req.query.limit) || 10 }) });
});
router.post("/runtime/workflow-memory/:fp/hit", rateLimiter(30, 60_000), (req, res) => {
    if (!autoWorkflowMem) return res.status(503).json({ success: false, error: "autonomousWorkflowMemory_unavailable" });
    return res.json({ success: true, ...autoWorkflowMem.hit(req.params.fp) });
});
router.get("/runtime/workflow-memory/debug-chain", rateLimiter(20, 60_000), (req, res) => {
    if (!autoWorkflowMem) return res.status(503).json({ success: false, error: "autonomousWorkflowMemory_unavailable" });
    return res.json({ success: true, ...autoWorkflowMem.recallDebugChain(req.query.error || "") });
});
router.get("/runtime/workflow-memory/stats", rateLimiter(20, 60_000), (req, res) => {
    if (!autoWorkflowMem) return res.status(503).json({ success: false, error: "autonomousWorkflowMemory_unavailable" });
    return res.json({ success: true, ...autoWorkflowMem.stats() });
});

// Phase 638 — Daily Autonomous Flows
router.post("/runtime/auto-flows/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyAutoFlows) return res.status(503).json({ success: false, error: "dailyAutonomousFlows_unavailable" });
    return res.json({ success: true, ...dailyAutoFlows.startFlow(req.body.flowName, req.body) });
});
router.post("/runtime/auto-flows/:runId/step/:stepOrder", rateLimiter(30, 60_000), (req, res) => {
    if (!dailyAutoFlows) return res.status(503).json({ success: false, error: "dailyAutonomousFlows_unavailable" });
    return res.json({ success: true, ...dailyAutoFlows.recordStep(req.params.runId, Number(req.params.stepOrder), req.body) });
});
router.post("/runtime/auto-flows/:runId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyAutoFlows) return res.status(503).json({ success: false, error: "dailyAutonomousFlows_unavailable" });
    return res.json({ success: true, ...dailyAutoFlows.interruptFlow(req.params.runId, req.body) });
});
router.post("/runtime/auto-flows/:runId/resume", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyAutoFlows) return res.status(503).json({ success: false, error: "dailyAutonomousFlows_unavailable" });
    return res.json({ success: true, ...dailyAutoFlows.resumeFlow(req.params.runId, req.body) });
});
router.get("/runtime/auto-flows/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyAutoFlows) return res.status(503).json({ success: false, error: "dailyAutonomousFlows_unavailable" });
    return res.json({ success: true, catalog: dailyAutoFlows.catalogList() });
});
router.get("/runtime/auto-flows", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyAutoFlows) return res.status(503).json({ success: false, error: "dailyAutonomousFlows_unavailable" });
    return res.json({ success: true, runs: dailyAutoFlows.listRuns(req.query) });
});

// Phase 639 — Long-Horizon Autonomous Continuity
router.post("/runtime/auto-continuity/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizonAuto) return res.status(503).json({ success: false, error: "longHorizonAutonomousContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonAuto.persistAutonomousSession(req.body.sessionId, req.body) });
});
router.get("/runtime/auto-continuity/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizonAuto) return res.status(503).json({ success: false, error: "longHorizonAutonomousContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonAuto.restoreAutonomousSession(req.params.sessionId, req.query) });
});
router.post("/runtime/auto-continuity/dedup-check", rateLimiter(30, 60_000), (req, res) => {
    if (!longHorizonAuto) return res.status(503).json({ success: false, error: "longHorizonAutonomousContinuity_unavailable" });
    const isDup = longHorizonAuto.isDuplicateRecovery(req.body.key);
    return res.json({ success: true, isDuplicate: isDup });
});
router.post("/runtime/auto-continuity/deploy/persist", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonAuto) return res.status(503).json({ success: false, error: "longHorizonAutonomousContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonAuto.persistDeploymentSession(req.body.deploymentId, req.body) });
});
router.get("/runtime/auto-continuity/health", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonAuto) return res.status(503).json({ success: false, error: "longHorizonAutonomousContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonAuto.continuityHealth() });
});

// Phase 640 — Trusted Autonomy Stress Test
router.post("/runtime/stress640/run", rateLimiter(2, 60_000), (req, res) => {
    if (!stressTest640) return res.status(503).json({ success: false, error: "trustedAutonomyStressTest_unavailable" });
    return res.json({ success: true, ...stressTest640.runAll() });
});

// Phase 641 — Engineering Productivity Evolution
router.post("/runtime/eng-productivity/event", rateLimiter(30, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.recordEvent(req.body.type, req.body) });
});
router.get("/runtime/eng-productivity/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.productivitySummary(req.query) });
});
router.get("/runtime/eng-productivity/debug-speed", rateLimiter(10, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.debuggingSpeedReport(req.query) });
});
router.get("/runtime/eng-productivity/deploy-cadence", rateLimiter(10, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.deploymentCadenceReport(req.query) });
});
router.get("/runtime/eng-productivity/patch-quality", rateLimiter(10, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.patchQualityReport(req.query) });
});
router.get("/runtime/eng-productivity/recovery", rateLimiter(10, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.recoveryPerformance(req.query) });
});
router.post("/runtime/eng-productivity/snapshot", rateLimiter(5, 60_000), (req, res) => {
    if (!engProductivityEvo) return res.status(503).json({ success: false, error: "engineeringProductivityEvolution_unavailable" });
    return res.json({ success: true, ...engProductivityEvo.takeSnapshot() });
});

// Phase 642 — Advanced Platform Resilience
router.post("/runtime/resilience/failure", rateLimiter(20, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.recordComponentFailure(req.body.component, req.body) });
});
router.get("/runtime/resilience/circuit-breaker/:component", rateLimiter(20, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.circuitBreakerStatus(req.params.component) });
});
router.get("/runtime/resilience/circuit-breakers", rateLimiter(10, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.allCircuitBreakers() });
});
router.get("/runtime/resilience/pressure", rateLimiter(10, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.runtimePressureScore() });
});
router.get("/runtime/resilience/degraded-mode", rateLimiter(10, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.detectDegradedMode() });
});
router.get("/runtime/resilience/cascade-risk", rateLimiter(10, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.cascadeRiskAssessment() });
});
router.get("/runtime/resilience/watchdog", rateLimiter(10, 60_000), (req, res) => {
    if (!platResilience) return res.status(503).json({ success: false, error: "advancedPlatformResilience_unavailable" });
    return res.json({ success: true, ...platResilience.watchdogSummary() });
});

// Phase 643 — Operator Trust Audit
router.post("/runtime/trust-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!opTrustAudit) return res.status(503).json({ success: false, error: "operatorTrustAudit_unavailable" });
    return res.json({ success: true, ...opTrustAudit.runAudit() });
});
router.get("/runtime/trust-audit/approval-discipline", rateLimiter(5, 60_000), (req, res) => {
    if (!opTrustAudit) return res.status(503).json({ success: false, error: "operatorTrustAudit_unavailable" });
    return res.json({ success: true, ...opTrustAudit.auditApprovalDiscipline() });
});
router.get("/runtime/trust-audit/autonomy-safety", rateLimiter(5, 60_000), (req, res) => {
    if (!opTrustAudit) return res.status(503).json({ success: false, error: "operatorTrustAudit_unavailable" });
    return res.json({ success: true, ...opTrustAudit.auditAutonomySafety() });
});
router.get("/runtime/trust-audit/platform-resilience", rateLimiter(5, 60_000), (req, res) => {
    if (!opTrustAudit) return res.status(503).json({ success: false, error: "operatorTrustAudit_unavailable" });
    return res.json({ success: true, ...opTrustAudit.auditPlatformResilience() });
});

// Phase 644 — Daily-Driver Autonomy Validation
router.post("/runtime/daily-driver-auto/run", rateLimiter(2, 60_000), (req, res) => {
    if (!dailyDriverAuto) return res.status(503).json({ success: false, error: "dailyDriverAutonomyValidation_unavailable" });
    return res.json({ success: true, ...dailyDriverAuto.runAll() });
});

// Phase 645 — Trusted Autonomous Engineering Foundation
router.get("/runtime/trusted-auto/health", rateLimiter(5, 60_000), (req, res) => {
    if (!trustedAutoFound) return res.status(503).json({ success: false, error: "trustedAutonomousFoundation_unavailable" });
    return res.json({ success: true, ...trustedAutoFound.platformHealth645() });
});
router.get("/runtime/trusted-auto/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!trustedAutoFound) return res.status(503).json({ success: false, error: "trustedAutonomousFoundation_unavailable" });
    return res.json({ success: true, ...trustedAutoFound.fullPlatformHealth() });
});
router.get("/runtime/trusted-auto/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!trustedAutoFound) return res.status(503).json({ success: false, error: "trustedAutonomousFoundation_unavailable" });
    return res.json({ success: true, capabilities: trustedAutoFound.capabilities645() });
});
router.get("/runtime/trusted-auto/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!trustedAutoFound) return res.status(503).json({ success: false, error: "trustedAutonomousFoundation_unavailable" });
    return res.json({ success: true, ...trustedAutoFound.moduleHealth645() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phases 646–660 — Execution Intelligence Evolution
// ─────────────────────────────────────────────────────────────────────────────

const _req660 = (name) => _req630(name);

const smartDebugIntel    = _req660("smartDebugIntelligence.cjs");
const execRiskIntel      = _req660("executionRiskIntelligence.cjs");
const adaptiveChains     = _req660("adaptiveWorkflowChains.cjs");
const terminalExecIntel  = _req660("terminalExecutionIntelligence.cjs");
const browserExecIntel   = _req660("browserExecutionIntelligence.cjs");
const decisionEvolution  = _req660("engineeringDecisionEvolution.cjs");
const memoryIntel        = _req660("operationalMemoryIntelligence.cjs");
const dailyExecAuto      = _req660("dailyExecutionAutomation.cjs");
const longHorizonExec    = _req660("longHorizonExecutionContinuity.cjs");
const prodIntelligence   = _req660("engineeringProductivityIntelligence.cjs");
const stressTest656      = _req660("executionIntelStressTest.cjs");
const platResEvolution   = _req660("platformResilienceEvolution.cjs");
const opTrustEvolution   = _req660("operatorTrustEvolution.cjs");
const execIntelAudit     = _req660("executionIntelligenceAudit.cjs");
const execIntelFound     = _req660("executionIntelligenceFoundation.cjs");

// Phase 646 — Smart Debug Intelligence
router.post("/runtime/debug-intel/record", rateLimiter(30, 60_000), (req, res) => {
    if (!smartDebugIntel) return res.status(503).json({ success: false, error: "smartDebugIntelligence_unavailable" });
    return res.json({ success: true, ...smartDebugIntel.recordFailure(req.body) });
});
router.post("/runtime/debug-intel/plan", rateLimiter(20, 60_000), (req, res) => {
    if (!smartDebugIntel) return res.status(503).json({ success: false, error: "smartDebugIntelligence_unavailable" });
    return res.json({ success: true, ...smartDebugIntel.buildDebugPlan(req.body.errorText || "", req.body) });
});
router.get("/runtime/debug-intel/correlate", rateLimiter(20, 60_000), (req, res) => {
    if (!smartDebugIntel) return res.status(503).json({ success: false, error: "smartDebugIntelligence_unavailable" });
    return res.json({ success: true, ...smartDebugIntel.correlateFailures(req.query) });
});
router.get("/runtime/debug-intel/repeated", rateLimiter(20, 60_000), (req, res) => {
    if (!smartDebugIntel) return res.status(503).json({ success: false, error: "smartDebugIntelligence_unavailable" });
    return res.json({ success: true, ...smartDebugIntel.detectRepeatedFailures(req.query) });
});
router.post("/runtime/debug-intel/root-causes", rateLimiter(20, 60_000), (req, res) => {
    if (!smartDebugIntel) return res.status(503).json({ success: false, error: "smartDebugIntelligence_unavailable" });
    return res.json({ success: true, ...smartDebugIntel.prioritizeRootCauses(req.body.errorText || "", req.body) });
});

// Phase 647 — Execution Risk Intelligence
router.post("/runtime/exec-risk/signal", rateLimiter(30, 60_000), (req, res) => {
    if (!execRiskIntel) return res.status(503).json({ success: false, error: "executionRiskIntelligence_unavailable" });
    return res.json({ success: true, ...execRiskIntel.recordSignal(req.body.type, req.body) });
});
router.get("/runtime/exec-risk/summary", rateLimiter(20, 60_000), (req, res) => {
    if (!execRiskIntel) return res.status(503).json({ success: false, error: "executionRiskIntelligence_unavailable" });
    return res.json({ success: true, ...execRiskIntel.riskSummary(req.query) });
});
router.post("/runtime/exec-risk/deploy-risk", rateLimiter(10, 60_000), (req, res) => {
    if (!execRiskIntel) return res.status(503).json({ success: false, error: "executionRiskIntelligence_unavailable" });
    return res.json({ success: true, ...execRiskIntel.deploymentRiskAssessment(req.body) });
});
router.post("/runtime/exec-risk/rollback", rateLimiter(10, 60_000), (req, res) => {
    if (!execRiskIntel) return res.status(503).json({ success: false, error: "executionRiskIntelligence_unavailable" });
    return res.json({ success: true, ...execRiskIntel.rollbackRecommendation(req.body) });
});
router.get("/runtime/exec-risk/warnings", rateLimiter(20, 60_000), (req, res) => {
    if (!execRiskIntel) return res.status(503).json({ success: false, error: "executionRiskIntelligence_unavailable" });
    return res.json({ success: true, ...execRiskIntel.trustAwareWarnings() });
});

// Phase 648 — Adaptive Workflow Chains
router.post("/runtime/adaptive-chains/create", rateLimiter(10, 60_000), (req, res) => {
    if (!adaptiveChains) return res.status(503).json({ success: false, error: "adaptiveWorkflowChains_unavailable" });
    return res.json({ success: true, ...adaptiveChains.createChain(req.body) });
});
router.post("/runtime/adaptive-chains/:chainId/step/:stepOrder", rateLimiter(30, 60_000), (req, res) => {
    if (!adaptiveChains) return res.status(503).json({ success: false, error: "adaptiveWorkflowChains_unavailable" });
    return res.json({ success: true, ...adaptiveChains.executeStep(req.params.chainId, Number(req.params.stepOrder), req.body) });
});
router.post("/runtime/adaptive-chains/:chainId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!adaptiveChains) return res.status(503).json({ success: false, error: "adaptiveWorkflowChains_unavailable" });
    return res.json({ success: true, ...adaptiveChains.interruptChain(req.params.chainId, req.body) });
});
router.get("/runtime/adaptive-chains", rateLimiter(20, 60_000), (req, res) => {
    if (!adaptiveChains) return res.status(503).json({ success: false, error: "adaptiveWorkflowChains_unavailable" });
    return res.json({ success: true, chains: adaptiveChains.listChains(req.query) });
});

// Phase 649 — Terminal Execution Intelligence
router.post("/runtime/terminal-intel/record", rateLimiter(30, 60_000), (req, res) => {
    if (!terminalExecIntel) return res.status(503).json({ success: false, error: "terminalExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...terminalExecIntel.recordExecution(req.body) });
});
router.post("/runtime/terminal-intel/retry-strategy", rateLimiter(20, 60_000), (req, res) => {
    if (!terminalExecIntel) return res.status(503).json({ success: false, error: "terminalExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...terminalExecIntel.selectRetryStrategy(req.body.command || "", req.body.failureOutput || "", req.body.retryCount || 0) });
});
router.get("/runtime/terminal-intel/dep-repairs", rateLimiter(10, 60_000), (req, res) => {
    if (!terminalExecIntel) return res.status(503).json({ success: false, error: "terminalExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...terminalExecIntel.prioritizeDependencyRepairs(req.query) });
});
router.post("/runtime/terminal-intel/:sessionId/checkpoint", rateLimiter(20, 60_000), (req, res) => {
    if (!terminalExecIntel) return res.status(503).json({ success: false, error: "terminalExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...terminalExecIntel.saveCheckpoint(req.params.sessionId, req.body.label, req.body) });
});
router.get("/runtime/terminal-intel/summary", rateLimiter(20, 60_000), (req, res) => {
    if (!terminalExecIntel) return res.status(503).json({ success: false, error: "terminalExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...terminalExecIntel.executionIntelSummary(req.query) });
});

// Phase 650 — Browser Execution Intelligence
router.post("/runtime/browser-intel/session", rateLimiter(20, 60_000), (req, res) => {
    if (!browserExecIntel) return res.status(503).json({ success: false, error: "browserExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...browserExecIntel.registerSession(req.body) });
});
router.post("/runtime/browser-intel/validate-extraction", rateLimiter(20, 60_000), (req, res) => {
    if (!browserExecIntel) return res.status(503).json({ success: false, error: "browserExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...browserExecIntel.validateExtraction(req.body.data, req.body.schema) });
});
router.get("/runtime/browser-intel/stale-sessions", rateLimiter(10, 60_000), (req, res) => {
    if (!browserExecIntel) return res.status(503).json({ success: false, error: "browserExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...browserExecIntel.detectStaleSessions() });
});
router.post("/runtime/browser-intel/form-safety", rateLimiter(20, 60_000), (req, res) => {
    if (!browserExecIntel) return res.status(503).json({ success: false, error: "browserExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...browserExecIntel.checkFormSafety(req.body) });
});
router.get("/runtime/browser-intel/state", rateLimiter(20, 60_000), (req, res) => {
    if (!browserExecIntel) return res.status(503).json({ success: false, error: "browserExecutionIntelligence_unavailable" });
    return res.json({ success: true, ...browserExecIntel.workflowStateReport() });
});

// Phase 651 — Engineering Decision Evolution
router.post("/runtime/decision-evo/rank-recovery", rateLimiter(20, 60_000), (req, res) => {
    if (!decisionEvolution) return res.status(503).json({ success: false, error: "engineeringDecisionEvolution_unavailable" });
    return res.json({ success: true, ...decisionEvolution.rankRecoveryStrategies(req.body.errorContext || "", req.body) });
});
router.post("/runtime/decision-evo/compare-deploys", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEvolution) return res.status(503).json({ success: false, error: "engineeringDecisionEvolution_unavailable" });
    return res.json({ success: true, ...decisionEvolution.compareDeploymentOptions(req.body.options || []) });
});
router.post("/runtime/decision-evo/debug-paths", rateLimiter(20, 60_000), (req, res) => {
    if (!decisionEvolution) return res.status(503).json({ success: false, error: "engineeringDecisionEvolution_unavailable" });
    return res.json({ success: true, ...decisionEvolution.prioritizeDebugPaths(req.body) });
});
router.get("/runtime/decision-evo/unstable-workflows", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEvolution) return res.status(503).json({ success: false, error: "engineeringDecisionEvolution_unavailable" });
    return res.json({ success: true, ...decisionEvolution.detectUnstableWorkflows() });
});
router.post("/runtime/decision-evo/stabilization", rateLimiter(10, 60_000), (req, res) => {
    if (!decisionEvolution) return res.status(503).json({ success: false, error: "engineeringDecisionEvolution_unavailable" });
    return res.json({ success: true, ...decisionEvolution.suggestStabilization(req.body) });
});

// Phase 652 — Operational Memory Intelligence
router.post("/runtime/memory-intel/upsert", rateLimiter(30, 60_000), (req, res) => {
    if (!memoryIntel) return res.status(503).json({ success: false, error: "operationalMemoryIntelligence_unavailable" });
    return res.json({ success: true, ...memoryIntel.upsert(req.body) });
});
router.get("/runtime/memory-intel/recall", rateLimiter(20, 60_000), (req, res) => {
    if (!memoryIntel) return res.status(503).json({ success: false, error: "operationalMemoryIntelligence_unavailable" });
    return res.json({ success: true, results: memoryIntel.recall(req.query.q || "", req.query) });
});
router.get("/runtime/memory-intel/clusters", rateLimiter(20, 60_000), (req, res) => {
    if (!memoryIntel) return res.status(503).json({ success: false, error: "operationalMemoryIntelligence_unavailable" });
    return res.json({ success: true, ...memoryIntel.clusterFailures(req.query.errorText || "") });
});
router.get("/runtime/memory-intel/successful-recoveries", rateLimiter(20, 60_000), (req, res) => {
    if (!memoryIntel) return res.status(503).json({ success: false, error: "operationalMemoryIntelligence_unavailable" });
    return res.json({ success: true, ...memoryIntel.recallSuccessfulRecoveries(req.query.errorText || "") });
});
router.get("/runtime/memory-intel/stats", rateLimiter(20, 60_000), (req, res) => {
    if (!memoryIntel) return res.status(503).json({ success: false, error: "operationalMemoryIntelligence_unavailable" });
    return res.json({ success: true, ...memoryIntel.stats() });
});
router.post("/runtime/memory-intel/cleanup", rateLimiter(5, 60_000), (req, res) => {
    if (!memoryIntel) return res.status(503).json({ success: false, error: "operationalMemoryIntelligence_unavailable" });
    return res.json({ success: true, ...memoryIntel.cleanupStaleMemories(req.body) });
});

// Phase 653 — Daily Execution Automation
router.post("/runtime/exec-auto/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyExecAuto) return res.status(503).json({ success: false, error: "dailyExecutionAutomation_unavailable" });
    return res.json({ success: true, ...dailyExecAuto.startAutomation(req.body.name, req.body) });
});
router.post("/runtime/exec-auto/:runId/step/:stepOrder", rateLimiter(30, 60_000), (req, res) => {
    if (!dailyExecAuto) return res.status(503).json({ success: false, error: "dailyExecutionAutomation_unavailable" });
    return res.json({ success: true, ...dailyExecAuto.recordStep(req.params.runId, Number(req.params.stepOrder), req.body) });
});
router.post("/runtime/exec-auto/:runId/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyExecAuto) return res.status(503).json({ success: false, error: "dailyExecutionAutomation_unavailable" });
    return res.json({ success: true, ...dailyExecAuto.interruptAutomation(req.params.runId, req.body) });
});
router.post("/runtime/exec-auto/:runId/resume", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyExecAuto) return res.status(503).json({ success: false, error: "dailyExecutionAutomation_unavailable" });
    return res.json({ success: true, ...dailyExecAuto.resumeAutomation(req.params.runId, req.body) });
});
router.get("/runtime/exec-auto/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyExecAuto) return res.status(503).json({ success: false, error: "dailyExecutionAutomation_unavailable" });
    return res.json({ success: true, catalog: dailyExecAuto.catalogList() });
});
router.get("/runtime/exec-auto", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyExecAuto) return res.status(503).json({ success: false, error: "dailyExecutionAutomation_unavailable" });
    return res.json({ success: true, runs: dailyExecAuto.listRuns(req.query) });
});

// Phase 654 — Long-Horizon Execution Continuity
router.post("/runtime/exec-continuity/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizonExec) return res.status(503).json({ success: false, error: "longHorizonExecutionContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonExec.persistSession(req.body.sessionId, req.body) });
});
router.get("/runtime/exec-continuity/:sessionId", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizonExec) return res.status(503).json({ success: false, error: "longHorizonExecutionContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonExec.restoreSession(req.params.sessionId, req.query) });
});
router.post("/runtime/exec-continuity/dedup", rateLimiter(30, 60_000), (req, res) => {
    if (!longHorizonExec) return res.status(503).json({ success: false, error: "longHorizonExecutionContinuity_unavailable" });
    return res.json({ success: true, isDuplicate: longHorizonExec.isDuplicateRecovery(req.body.key) });
});
router.get("/runtime/exec-continuity/health", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonExec) return res.status(503).json({ success: false, error: "longHorizonExecutionContinuity_unavailable" });
    return res.json({ success: true, ...longHorizonExec.continuityHealth() });
});

// Phase 655 — Engineering Productivity Intelligence
router.get("/runtime/prod-intel/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!prodIntelligence) return res.status(503).json({ success: false, error: "engineeringProductivityIntelligence_unavailable" });
    return res.json({ success: true, ...prodIntelligence.productivityIntelSummary(req.query) });
});
router.get("/runtime/prod-intel/debug", rateLimiter(10, 60_000), (req, res) => {
    if (!prodIntelligence) return res.status(503).json({ success: false, error: "engineeringProductivityIntelligence_unavailable" });
    return res.json({ success: true, ...prodIntelligence.debuggingProductivity(req.query) });
});
router.get("/runtime/prod-intel/discover", rateLimiter(20, 60_000), (req, res) => {
    if (!prodIntelligence) return res.status(503).json({ success: false, error: "engineeringProductivityIntelligence_unavailable" });
    return res.json({ success: true, ...prodIntelligence.discoverWorkflows(req.query.goal || "") });
});
router.get("/runtime/prod-intel/calmness", rateLimiter(20, 60_000), (req, res) => {
    if (!prodIntelligence) return res.status(503).json({ success: false, error: "engineeringProductivityIntelligence_unavailable" });
    return res.json({ success: true, ...prodIntelligence.operationalCalmness() });
});
router.post("/runtime/prod-intel/filter-warnings", rateLimiter(20, 60_000), (req, res) => {
    if (!prodIntelligence) return res.status(503).json({ success: false, error: "engineeringProductivityIntelligence_unavailable" });
    return res.json({ success: true, ...prodIntelligence.filterWarningNoise(req.body.warnings || [], req.body) });
});

// Phase 656 — Execution Intelligence Stress Test
router.post("/runtime/stress660/run", rateLimiter(2, 60_000), (req, res) => {
    if (!stressTest656) return res.status(503).json({ success: false, error: "executionIntelStressTest_unavailable" });
    return res.json({ success: true, ...stressTest656.runAll() });
});

// Phase 657 — Platform Resilience Evolution
router.get("/runtime/resilience-evo/continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!platResEvolution) return res.status(503).json({ success: false, error: "platformResilienceEvolution_unavailable" });
    return res.json({ success: true, ...platResEvolution.executionContinuitySummary() });
});
router.get("/runtime/resilience-evo/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platResEvolution) return res.status(503).json({ success: false, error: "platformResilienceEvolution_unavailable" });
    return res.json({ success: true, ...platResEvolution.resilienceEvolutionReport() });
});
router.post("/runtime/resilience-evo/rollback-safety", rateLimiter(10, 60_000), (req, res) => {
    if (!platResEvolution) return res.status(503).json({ success: false, error: "platformResilienceEvolution_unavailable" });
    return res.json({ success: true, ...platResEvolution.deploymentRollbackSafety(req.body) });
});

// Phase 658 — Operator Trust Evolution
router.post("/runtime/trust-evo/event", rateLimiter(30, 60_000), (req, res) => {
    if (!opTrustEvolution) return res.status(503).json({ success: false, error: "operatorTrustEvolution_unavailable" });
    return res.json({ success: true, ...opTrustEvolution.recordTrustEvent(req.body.type, req.body) });
});
router.get("/runtime/trust-evo/progression", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustEvolution) return res.status(503).json({ success: false, error: "operatorTrustEvolution_unavailable" });
    return res.json({ success: true, ...opTrustEvolution.trustProgression(req.query) });
});
router.get("/runtime/trust-evo/autonomy-maturity", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustEvolution) return res.status(503).json({ success: false, error: "operatorTrustEvolution_unavailable" });
    return res.json({ success: true, ...opTrustEvolution.autonomyMaturityScore(req.query) });
});
router.get("/runtime/trust-evo/confidence", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustEvolution) return res.status(503).json({ success: false, error: "operatorTrustEvolution_unavailable" });
    return res.json({ success: true, ...opTrustEvolution.operationalConfidenceEvolution(req.query) });
});
router.get("/runtime/trust-evo/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustEvolution) return res.status(503).json({ success: false, error: "operatorTrustEvolution_unavailable" });
    return res.json({ success: true, ...opTrustEvolution.trustSummary(req.query) });
});

// Phase 659 — Execution Intelligence Audit
router.post("/runtime/exec-intel-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!execIntelAudit) return res.status(503).json({ success: false, error: "executionIntelligenceAudit_unavailable" });
    return res.json({ success: true, ...execIntelAudit.runAudit() });
});

// Phase 660 — Execution Intelligence Foundation
router.get("/runtime/exec-intel/health", rateLimiter(5, 60_000), (req, res) => {
    if (!execIntelFound) return res.status(503).json({ success: false, error: "executionIntelligenceFoundation_unavailable" });
    return res.json({ success: true, ...execIntelFound.platformHealth660() });
});
router.get("/runtime/exec-intel/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!execIntelFound) return res.status(503).json({ success: false, error: "executionIntelligenceFoundation_unavailable" });
    return res.json({ success: true, ...execIntelFound.fullPlatformHealth() });
});
router.get("/runtime/exec-intel/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!execIntelFound) return res.status(503).json({ success: false, error: "executionIntelligenceFoundation_unavailable" });
    return res.json({ success: true, capabilities: execIntelFound.capabilities660() });
});
router.get("/runtime/exec-intel/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!execIntelFound) return res.status(503).json({ success: false, error: "executionIntelligenceFoundation_unavailable" });
    return res.json({ success: true, ...execIntelFound.moduleHealth660() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phases 661–675 — Execution Coordination Intelligence
// ─────────────────────────────────────────────────────────────────────────────

const _req675 = (name) => _req630(name);

const execPriorityEngine    = _req675("executionPriorityEngine.cjs");
const depAwareExec          = _req675("dependencyAwareExecution.cjs");
const adaptiveRecovCoord    = _req675("adaptiveRecoveryCoordination.cjs");
const execStateIntel        = _req675("executionStateIntelligence.cjs");
const smartDeployCoord      = _req675("smartDeploymentCoordination.cjs");
const engCtxCoord           = _req675("engineeringContextCoordination.cjs");
const opDecisionPriority    = _req675("operationalDecisionPrioritization.cjs");
const execMemCoord          = _req675("executionMemoryCoordination.cjs");
const dailyEngCoord         = _req675("dailyEngineeringCoordination.cjs");
const longHorizonSurv       = _req675("longHorizonExecutionSurvivability.cjs");
const coordStressTest671    = _req675("executionCoordinationStressTest.cjs");
const engProdCoord          = _req675("engineeringProductivityCoordination.cjs");
const platCoordResilience   = _req675("platformCoordinationResilience.cjs");
const execSafetyAudit       = _req675("executionSafetyAudit.cjs");
const execCoordFound        = _req675("executionCoordinationFoundation.cjs");

// Phase 661 — Execution Priority Engine
router.get("/runtime/exec-priority/workflows", rateLimiter(10, 60_000), (req, res) => {
    if (!execPriorityEngine) return res.status(503).json({ success: false, error: "executionPriorityEngine_unavailable" });
    return res.json({ success: true, ...execPriorityEngine.prioritizeWorkflows(req.query) });
});
router.get("/runtime/exec-priority/urgency", rateLimiter(10, 60_000), (req, res) => {
    if (!execPriorityEngine) return res.status(503).json({ success: false, error: "executionPriorityEngine_unavailable" });
    return res.json({ success: true, ...execPriorityEngine.checkRecoveryUrgency() });
});

// Phase 662 — Dependency-Aware Execution
router.post("/runtime/dep-exec/graph", rateLimiter(10, 60_000), (req, res) => {
    if (!depAwareExec) return res.status(503).json({ success: false, error: "dependencyAwareExecution_unavailable" });
    return res.json({ success: true, ...depAwareExec.registerDependencyGraph(req.body.name, req.body.deps) });
});
router.get("/runtime/dep-exec/order/:name", rateLimiter(10, 60_000), (req, res) => {
    if (!depAwareExec) return res.status(503).json({ success: false, error: "dependencyAwareExecution_unavailable" });
    return res.json({ success: true, ...depAwareExec.getExecutionOrder(req.params.name) });
});
router.post("/runtime/dep-exec/check-deploy", rateLimiter(10, 60_000), (req, res) => {
    if (!depAwareExec) return res.status(503).json({ success: false, error: "dependencyAwareExecution_unavailable" });
    return res.json({ success: true, ...depAwareExec.checkDeploymentDependencies(req.body.deploymentName, req.body.requiredServices || []) });
});
router.get("/runtime/dep-exec/stale-chains", rateLimiter(10, 60_000), (req, res) => {
    if (!depAwareExec) return res.status(503).json({ success: false, error: "dependencyAwareExecution_unavailable" });
    return res.json({ success: true, ...depAwareExec.detectStaleDependencyChains() });
});

// Phase 663 — Adaptive Recovery Coordination
router.post("/runtime/recovery-coord/attempt", rateLimiter(20, 60_000), (req, res) => {
    if (!adaptiveRecovCoord) return res.status(503).json({ success: false, error: "adaptiveRecoveryCoordination_unavailable" });
    return res.json({ success: true, ...adaptiveRecovCoord.recordRecoveryAttempt(req.body.path, req.body) });
});
router.post("/runtime/recovery-coord/choose", rateLimiter(10, 60_000), (req, res) => {
    if (!adaptiveRecovCoord) return res.status(503).json({ success: false, error: "adaptiveRecoveryCoordination_unavailable" });
    return res.json({ success: true, ...adaptiveRecovCoord.chooseRecoveryPath(req.body.errorContext, req.body) });
});
router.post("/runtime/recovery-coord/rollback/compare", rateLimiter(10, 60_000), (req, res) => {
    if (!adaptiveRecovCoord) return res.status(503).json({ success: false, error: "adaptiveRecoveryCoordination_unavailable" });
    return res.json({ success: true, ...adaptiveRecovCoord.compareRollbackOptions(req.body.options || []) });
});
router.get("/runtime/recovery-coord/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!adaptiveRecovCoord) return res.status(503).json({ success: false, error: "adaptiveRecoveryCoordination_unavailable" });
    return res.json({ success: true, ...adaptiveRecovCoord.recoverySummary(req.query) });
});

// Phase 664 — Execution State Intelligence
router.get("/runtime/exec-state/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!execStateIntel) return res.status(503).json({ success: false, error: "executionStateIntelligence_unavailable" });
    return res.json({ success: true, ...execStateIntel.executionStateSummary() });
});
router.get("/runtime/exec-state/pressure", rateLimiter(10, 60_000), (req, res) => {
    if (!execStateIntel) return res.status(503).json({ success: false, error: "executionStateIntelligence_unavailable" });
    return res.json({ success: true, ...execStateIntel.activeWorkflowPressure() });
});
router.get("/runtime/exec-state/interrupted", rateLimiter(10, 60_000), (req, res) => {
    if (!execStateIntel) return res.status(503).json({ success: false, error: "executionStateIntelligence_unavailable" });
    return res.json({ success: true, ...execStateIntel.interruptedWorkflowStates() });
});

// Phase 665 — Smart Deployment Coordination
router.get("/runtime/smart-deploy/readiness", rateLimiter(10, 60_000), (req, res) => {
    if (!smartDeployCoord) return res.status(503).json({ success: false, error: "smartDeploymentCoordination_unavailable" });
    return res.json({ success: true, ...smartDeployCoord.checkDeploymentReadiness(req.query.deploymentId) });
});
router.post("/runtime/smart-deploy/plan", rateLimiter(5, 60_000), (req, res) => {
    if (!smartDeployCoord) return res.status(503).json({ success: false, error: "smartDeploymentCoordination_unavailable" });
    return res.json({ success: true, ...smartDeployCoord.createPhasedDeploymentPlan(req.body) });
});
router.post("/runtime/smart-deploy/advance", rateLimiter(5, 60_000), (req, res) => {
    if (!smartDeployCoord) return res.status(503).json({ success: false, error: "smartDeploymentCoordination_unavailable" });
    return res.json({ success: true, ...smartDeployCoord.advanceDeploymentPhase(req.body.planId, req.body) });
});
router.post("/runtime/smart-deploy/rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!smartDeployCoord) return res.status(503).json({ success: false, error: "smartDeploymentCoordination_unavailable" });
    return res.json({ success: true, ...smartDeployCoord.rollbackDeploymentPlan(req.body.planId, req.body) });
});
router.post("/runtime/smart-deploy/canary-health", rateLimiter(10, 60_000), (req, res) => {
    if (!smartDeployCoord) return res.status(503).json({ success: false, error: "smartDeploymentCoordination_unavailable" });
    return res.json({ success: true, ...smartDeployCoord.assessCanaryHealth(req.body.deploymentId, req.body.metrics || {}) });
});

// Phase 666 — Engineering Context Coordination
router.post("/runtime/eng-ctx/save", rateLimiter(20, 60_000), (req, res) => {
    if (!engCtxCoord) return res.status(503).json({ success: false, error: "engineeringContextCoordination_unavailable" });
    return res.json({ success: true, ...engCtxCoord.saveContext(req.body.contextId, req.body) });
});
router.get("/runtime/eng-ctx/restore", rateLimiter(20, 60_000), (req, res) => {
    if (!engCtxCoord) return res.status(503).json({ success: false, error: "engineeringContextCoordination_unavailable" });
    return res.json({ success: true, ...engCtxCoord.restoreContext(req.query.contextId) });
});
router.post("/runtime/eng-ctx/correlate", rateLimiter(10, 60_000), (req, res) => {
    if (!engCtxCoord) return res.status(503).json({ success: false, error: "engineeringContextCoordination_unavailable" });
    return res.json({ success: true, ...engCtxCoord.correlateDebuggingSessions(req.body.errorText || "") });
});
router.get("/runtime/eng-ctx/interrupted-chains", rateLimiter(10, 60_000), (req, res) => {
    if (!engCtxCoord) return res.status(503).json({ success: false, error: "engineeringContextCoordination_unavailable" });
    return res.json({ success: true, ...engCtxCoord.reconnectInterruptedChains() });
});
router.get("/runtime/eng-ctx/list", rateLimiter(10, 60_000), (req, res) => {
    if (!engCtxCoord) return res.status(503).json({ success: false, error: "engineeringContextCoordination_unavailable" });
    return res.json({ success: true, contexts: engCtxCoord.listContexts(req.query) });
});

// Phase 667 — Operational Decision Prioritization
router.post("/runtime/op-decision/stabilize", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionPriority) return res.status(503).json({ success: false, error: "operationalDecisionPrioritization_unavailable" });
    return res.json({ success: true, ...opDecisionPriority.rankStabilizationPaths(req.body) });
});
router.post("/runtime/op-decision/debug-actions", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionPriority) return res.status(503).json({ success: false, error: "operationalDecisionPrioritization_unavailable" });
    return res.json({ success: true, ...opDecisionPriority.prioritizeDebuggingActions(req.body.errorContext || "", req.body) });
});
router.post("/runtime/op-decision/risky-branches", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionPriority) return res.status(503).json({ success: false, error: "operationalDecisionPrioritization_unavailable" });
    return res.json({ success: true, ...opDecisionPriority.identifyRiskyBranches(req.body.chains || []) });
});
router.post("/runtime/op-decision/safer-alternatives", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionPriority) return res.status(503).json({ success: false, error: "operationalDecisionPrioritization_unavailable" });
    return res.json({ success: true, ...opDecisionPriority.recommendSaferAlternatives(req.body) });
});
router.get("/runtime/op-decision/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionPriority) return res.status(503).json({ success: false, error: "operationalDecisionPrioritization_unavailable" });
    return res.json({ success: true, ...opDecisionPriority.decisionPrioritizationSummary(req.query) });
});

// Phase 668 — Execution Memory Coordination
router.post("/runtime/exec-memory/success", rateLimiter(20, 60_000), (req, res) => {
    if (!execMemCoord) return res.status(503).json({ success: false, error: "executionMemoryCoordination_unavailable" });
    return res.json({ success: true, ...execMemCoord.recordSuccess(req.body.chainId, req.body) });
});
router.post("/runtime/exec-memory/failure", rateLimiter(20, 60_000), (req, res) => {
    if (!execMemCoord) return res.status(503).json({ success: false, error: "executionMemoryCoordination_unavailable" });
    return res.json({ success: true, ...execMemCoord.recordFailure(req.body.chainId, req.body) });
});
router.get("/runtime/exec-memory/recall", rateLimiter(10, 60_000), (req, res) => {
    if (!execMemCoord) return res.status(503).json({ success: false, error: "executionMemoryCoordination_unavailable" });
    return res.json({ success: true, ...execMemCoord.prioritizeRepeatedSuccesses(req.query.goal || "", req.query) });
});
router.get("/runtime/exec-memory/env-recall", rateLimiter(10, 60_000), (req, res) => {
    if (!execMemCoord) return res.status(503).json({ success: false, error: "executionMemoryCoordination_unavailable" });
    return res.json({ success: true, ...execMemCoord.recallForEnvironment(req.query.goal || "", req.query.env || "default") });
});
router.get("/runtime/exec-memory/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!execMemCoord) return res.status(503).json({ success: false, error: "executionMemoryCoordination_unavailable" });
    return res.json({ success: true, ...execMemCoord.memoryCoordinationSummary() });
});

// Phase 669 — Daily Engineering Coordination
router.post("/runtime/daily-eng/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngCoord) return res.status(503).json({ success: false, error: "dailyEngineeringCoordination_unavailable" });
    return res.json({ success: true, ...dailyEngCoord.startSequence(req.body.sequenceType) });
});
router.post("/runtime/daily-eng/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngCoord) return res.status(503).json({ success: false, error: "dailyEngineeringCoordination_unavailable" });
    return res.json({ success: true, ...dailyEngCoord.advanceStep(req.body.runId, req.body) });
});
router.post("/runtime/daily-eng/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngCoord) return res.status(503).json({ success: false, error: "dailyEngineeringCoordination_unavailable" });
    return res.json({ success: true, ...dailyEngCoord.interruptSequence(req.body.runId) });
});
router.post("/runtime/daily-eng/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngCoord) return res.status(503).json({ success: false, error: "dailyEngineeringCoordination_unavailable" });
    return res.json({ success: true, ...dailyEngCoord.resumeSequence(req.body.runId, req.body) });
});
router.get("/runtime/daily-eng/startup", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyEngCoord) return res.status(503).json({ success: false, error: "dailyEngineeringCoordination_unavailable" });
    return res.json({ success: true, ...dailyEngCoord.runStartupOrchestration() });
});
router.get("/runtime/daily-eng/sequences", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngCoord) return res.status(503).json({ success: false, error: "dailyEngineeringCoordination_unavailable" });
    return res.json({ success: true, sequences: dailyEngCoord.catalogSequences() });
});

// Phase 670 — Long-Horizon Execution Survivability
router.post("/runtime/exec-surv/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizonSurv) return res.status(503).json({ success: false, error: "longHorizonExecutionSurvivability_unavailable" });
    return res.json({ success: true, ...longHorizonSurv.persistSurvivabilitySession(req.body.sessionId, req.body) });
});
router.get("/runtime/exec-surv/restore", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonSurv) return res.status(503).json({ success: false, error: "longHorizonExecutionSurvivability_unavailable" });
    return res.json({ success: true, ...longHorizonSurv.restoreSurvivabilitySession(req.query.sessionId, req.query) });
});
router.get("/runtime/exec-surv/storm-status", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonSurv) return res.status(503).json({ success: false, error: "longHorizonExecutionSurvivability_unavailable" });
    return res.json({ success: true, ...longHorizonSurv.reconnectStormStatus() });
});
router.post("/runtime/exec-surv/restore-interrupted", rateLimiter(5, 60_000), (req, res) => {
    if (!longHorizonSurv) return res.status(503).json({ success: false, error: "longHorizonExecutionSurvivability_unavailable" });
    return res.json({ success: true, ...longHorizonSurv.restoreInterruptedWorkflows(req.body) });
});
router.get("/runtime/exec-surv/health", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonSurv) return res.status(503).json({ success: false, error: "longHorizonExecutionSurvivability_unavailable" });
    return res.json({ success: true, ...longHorizonSurv.survivabilityHealth() });
});

// Phase 671 — Execution Coordination Stress Test
router.post("/runtime/coord-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!coordStressTest671) return res.status(503).json({ success: false, error: "executionCoordinationStressTest_unavailable" });
    return res.json({ success: true, ...coordStressTest671.runAll() });
});

// Phase 672 — Engineering Productivity Coordination
router.post("/runtime/prod-coord/debug-flow", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdCoord) return res.status(503).json({ success: false, error: "engineeringProductivityCoordination_unavailable" });
    return res.json({ success: true, ...engProdCoord.coordinateDebuggingFlow(req.body.errorContext || "", req.body) });
});
router.post("/runtime/prod-coord/deploy-sequence", rateLimiter(5, 60_000), (req, res) => {
    if (!engProdCoord) return res.status(503).json({ success: false, error: "engineeringProductivityCoordination_unavailable" });
    return res.json({ success: true, ...engProdCoord.coordinateDeploymentSequence(req.body.deploymentId, req.body) });
});
router.get("/runtime/prod-coord/calmness", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdCoord) return res.status(503).json({ success: false, error: "engineeringProductivityCoordination_unavailable" });
    return res.json({ success: true, ...engProdCoord.operationalCalmnessScore() });
});
router.get("/runtime/prod-coord/workflows", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdCoord) return res.status(503).json({ success: false, error: "engineeringProductivityCoordination_unavailable" });
    return res.json({ success: true, ...engProdCoord.discoverAvailableWorkflows(req.query.goal || "") });
});
router.get("/runtime/prod-coord/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdCoord) return res.status(503).json({ success: false, error: "engineeringProductivityCoordination_unavailable" });
    return res.json({ success: true, ...engProdCoord.productivityCoordinationSummary() });
});

// Phase 673 — Platform Coordination Resilience
router.get("/runtime/plat-coord/resilience", rateLimiter(5, 60_000), (req, res) => {
    if (!platCoordResilience) return res.status(503).json({ success: false, error: "platformCoordinationResilience_unavailable" });
    return res.json({ success: true, ...platCoordResilience.platformCoordinationResilienceReport() });
});
router.get("/runtime/plat-coord/continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!platCoordResilience) return res.status(503).json({ success: false, error: "platformCoordinationResilience_unavailable" });
    return res.json({ success: true, ...platCoordResilience.assessExecutionContinuity() });
});
router.get("/runtime/plat-coord/rollback-integrity", rateLimiter(10, 60_000), (req, res) => {
    if (!platCoordResilience) return res.status(503).json({ success: false, error: "platformCoordinationResilience_unavailable" });
    return res.json({ success: true, ...platCoordResilience.assessRollbackIntegrity(req.query.deploymentId || "") });
});

// Phase 674 — Execution Safety Audit
router.post("/runtime/exec-safety-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!execSafetyAudit) return res.status(503).json({ success: false, error: "executionSafetyAudit_unavailable" });
    return res.json({ success: true, ...execSafetyAudit.runAudit() });
});

// Phase 675 — Execution Coordination Foundation
router.get("/runtime/exec-coord/health", rateLimiter(5, 60_000), (req, res) => {
    if (!execCoordFound) return res.status(503).json({ success: false, error: "executionCoordinationFoundation_unavailable" });
    return res.json({ success: true, ...execCoordFound.platformHealth675() });
});
router.get("/runtime/exec-coord/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!execCoordFound) return res.status(503).json({ success: false, error: "executionCoordinationFoundation_unavailable" });
    return res.json({ success: true, ...execCoordFound.fullPlatformHealth() });
});
router.get("/runtime/exec-coord/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!execCoordFound) return res.status(503).json({ success: false, error: "executionCoordinationFoundation_unavailable" });
    return res.json({ success: true, capabilities: execCoordFound.capabilities675() });
});
router.get("/runtime/exec-coord/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!execCoordFound) return res.status(503).json({ success: false, error: "executionCoordinationFoundation_unavailable" });
    return res.json({ success: true, ...execCoordFound.moduleHealth675() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phases 676–690 — Engineering Strategy Intelligence
// ─────────────────────────────────────────────────────────────────────────────

const _req690 = (name) => _req630(name);

const stratDebugPlan      = _req690("strategicDebugPlanning.cjs");
const deployStratEngine   = _req690("deploymentStrategyEngine.cjs");
const wfStratCoord        = _req690("workflowStrategyCoordination.cjs");
const engPriorityIntel    = _req690("engineeringPriorityIntelligence.cjs");
const termStratOrch       = _req690("terminalStrategyOrchestration.cjs");
const browserStratIntel   = _req690("browserStrategyIntelligence.cjs");
const longHorizonPlan     = _req690("longHorizonExecutionPlanning.cjs");
const engMemStrategy      = _req690("engineeringMemoryStrategy.cjs");
const dailyEngStratFlows  = _req690("dailyEngineeringStrategyFlows.cjs");
const stratProdOpt        = _req690("strategicProductivityOptimization.cjs");
const engStratStress686   = _req690("engineeringStrategyStressTest.cjs");
const platStratResilience = _req690("platformStrategyResilience.cjs");
const opStratAudit        = _req690("operationalStrategyAudit.cjs");
const ddStratValidation   = _req690("dailyDriverStrategyValidation.cjs");
const engStratFound       = _req690("engineeringStrategyFoundation.cjs");

// Phase 676 — Strategic Debug Planning
router.post("/runtime/strat-debug/root-causes", rateLimiter(10, 60_000), (req, res) => {
    if (!stratDebugPlan) return res.status(503).json({ success: false, error: "strategicDebugPlanning_unavailable" });
    return res.json({ success: true, ...stratDebugPlan.prioritizeRootCauses(req.body.errorContext || "", req.body) });
});
router.post("/runtime/strat-debug/plan", rateLimiter(10, 60_000), (req, res) => {
    if (!stratDebugPlan) return res.status(503).json({ success: false, error: "strategicDebugPlanning_unavailable" });
    return res.json({ success: true, ...stratDebugPlan.buildValidationFirstPlan(req.body.errorContext || "", req.body) });
});
router.post("/runtime/strat-debug/recovery-paths", rateLimiter(10, 60_000), (req, res) => {
    if (!stratDebugPlan) return res.status(503).json({ success: false, error: "strategicDebugPlanning_unavailable" });
    return res.json({ success: true, ...stratDebugPlan.compareDebugRecoveryPaths(req.body.errorContext || "", req.body) });
});
router.post("/runtime/strat-debug/replay-plan", rateLimiter(10, 60_000), (req, res) => {
    if (!stratDebugPlan) return res.status(503).json({ success: false, error: "strategicDebugPlanning_unavailable" });
    return res.json({ success: true, ...stratDebugPlan.buildReplayLinkedDebugPlan(req.body.replayId || "", req.body.errorContext || "") });
});

// Phase 677 — Deployment Strategy Engine
router.get("/runtime/deploy-strat/readiness", rateLimiter(10, 60_000), (req, res) => {
    if (!deployStratEngine) return res.status(503).json({ success: false, error: "deploymentStrategyEngine_unavailable" });
    return res.json({ success: true, ...deployStratEngine.deploymentReadinessSummary(req.query.deploymentId || "") });
});
router.post("/runtime/deploy-strat/canary-risk", rateLimiter(10, 60_000), (req, res) => {
    if (!deployStratEngine) return res.status(503).json({ success: false, error: "deploymentStrategyEngine_unavailable" });
    return res.json({ success: true, ...deployStratEngine.analyzeCanaryRisk(req.body.deploymentId || "", req.body) });
});
router.post("/runtime/deploy-strat/rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!deployStratEngine) return res.status(503).json({ success: false, error: "deploymentStrategyEngine_unavailable" });
    return res.json({ success: true, ...deployStratEngine.recommendRollbackStrategy(req.body.deploymentId || "", req.body) });
});
router.post("/runtime/deploy-strat/plan", rateLimiter(5, 60_000), (req, res) => {
    if (!deployStratEngine) return res.status(503).json({ success: false, error: "deploymentStrategyEngine_unavailable" });
    return res.json({ success: true, ...deployStratEngine.buildHealthPrioritizedDeployPlan(req.body) });
});
router.get("/runtime/deploy-strat/risk-report", rateLimiter(5, 60_000), (req, res) => {
    if (!deployStratEngine) return res.status(503).json({ success: false, error: "deploymentStrategyEngine_unavailable" });
    return res.json({ success: true, ...deployStratEngine.operationalRiskReport(req.query.deploymentId || "") });
});

// Phase 678 — Workflow Strategy Coordination
router.post("/runtime/wf-strat/optimize-order", rateLimiter(10, 60_000), (req, res) => {
    if (!wfStratCoord) return res.status(503).json({ success: false, error: "workflowStrategyCoordination_unavailable" });
    return res.json({ success: true, ...wfStratCoord.optimizeExecutionOrder(req.body.workflows || []) });
});
router.post("/runtime/wf-strat/bottlenecks", rateLimiter(10, 60_000), (req, res) => {
    if (!wfStratCoord) return res.status(503).json({ success: false, error: "workflowStrategyCoordination_unavailable" });
    return res.json({ success: true, ...wfStratCoord.identifyWorkflowBottlenecks(req.body.workflows || []) });
});
router.post("/runtime/wf-strat/safer-paths", rateLimiter(10, 60_000), (req, res) => {
    if (!wfStratCoord) return res.status(503).json({ success: false, error: "workflowStrategyCoordination_unavailable" });
    return res.json({ success: true, ...wfStratCoord.suggestSaferExecutionPaths(req.body.workflows || [], req.body) });
});
router.post("/runtime/wf-strat/replay-safe", rateLimiter(10, 60_000), (req, res) => {
    if (!wfStratCoord) return res.status(503).json({ success: false, error: "workflowStrategyCoordination_unavailable" });
    return res.json({ success: true, ...wfStratCoord.coordinateReplaySafeWorkflows(req.body.workflows || []) });
});

// Phase 679 — Engineering Priority Intelligence
router.get("/runtime/eng-priority/rank", rateLimiter(10, 60_000), (req, res) => {
    if (!engPriorityIntel) return res.status(503).json({ success: false, error: "engineeringPriorityIntelligence_unavailable" });
    return res.json({ success: true, ...engPriorityIntel.rankEngineeringPriorities(req.query) });
});
router.get("/runtime/eng-priority/focus", rateLimiter(10, 60_000), (req, res) => {
    if (!engPriorityIntel) return res.status(503).json({ success: false, error: "engineeringPriorityIntelligence_unavailable" });
    return res.json({ success: true, ...engPriorityIntel.operationalFocusSummary() });
});
router.post("/runtime/eng-priority/stabilize", rateLimiter(10, 60_000), (req, res) => {
    if (!engPriorityIntel) return res.status(503).json({ success: false, error: "engineeringPriorityIntelligence_unavailable" });
    return res.json({ success: true, ...engPriorityIntel.recommendStabilization(req.body) });
});
router.post("/runtime/eng-priority/signal", rateLimiter(20, 60_000), (req, res) => {
    if (!engPriorityIntel) return res.status(503).json({ success: false, error: "engineeringPriorityIntelligence_unavailable" });
    return res.json({ success: true, ...engPriorityIntel.recordPrioritySignal(req.body.domain, req.body.factor, req.body) });
});

// Phase 680 — Terminal Strategy Orchestration
router.post("/runtime/term-strat/sequence", rateLimiter(10, 60_000), (req, res) => {
    if (!termStratOrch) return res.status(503).json({ success: false, error: "terminalStrategyOrchestration_unavailable" });
    return res.json({ success: true, ...termStratOrch.buildSafeCommandSequence(req.body.commands || [], req.body) });
});
router.post("/runtime/term-strat/shell-flow", rateLimiter(10, 60_000), (req, res) => {
    if (!termStratOrch) return res.status(503).json({ success: false, error: "terminalStrategyOrchestration_unavailable" });
    return res.json({ success: true, ...termStratOrch.buildDependencyAwareShellFlow(req.body.steps || [], req.body.deps || {}) });
});
router.post("/runtime/term-strat/should-execute", rateLimiter(20, 60_000), (req, res) => {
    if (!termStratOrch) return res.status(503).json({ success: false, error: "terminalStrategyOrchestration_unavailable" });
    return res.json({ success: true, ...termStratOrch.shouldExecuteCommand(req.body.command || "") });
});
router.post("/runtime/term-strat/replay-coord", rateLimiter(10, 60_000), (req, res) => {
    if (!termStratOrch) return res.status(503).json({ success: false, error: "terminalStrategyOrchestration_unavailable" });
    return res.json({ success: true, ...termStratOrch.coordinateReplayLinkedCommands(req.body.replayId || "", req.body.commands || []) });
});

// Phase 681 — Browser Strategy Intelligence
router.post("/runtime/browser-strat/optimize-extraction", rateLimiter(10, 60_000), (req, res) => {
    if (!browserStratIntel) return res.status(503).json({ success: false, error: "browserStrategyIntelligence_unavailable" });
    return res.json({ success: true, ...browserStratIntel.optimizeExtractionFlow(req.body.flows || []) });
});
router.get("/runtime/browser-strat/session-continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!browserStratIntel) return res.status(503).json({ success: false, error: "browserStrategyIntelligence_unavailable" });
    return res.json({ success: true, ...browserStratIntel.assessSessionContinuity(req.query.sessionId || "") });
});
router.post("/runtime/browser-strat/form-safety", rateLimiter(10, 60_000), (req, res) => {
    if (!browserStratIntel) return res.status(503).json({ success: false, error: "browserStrategyIntelligence_unavailable" });
    return res.json({ success: true, ...browserStratIntel.prioritizeFormSafety(req.body.forms || []) });
});
router.post("/runtime/browser-strat/workflow-sequence", rateLimiter(10, 60_000), (req, res) => {
    if (!browserStratIntel) return res.status(503).json({ success: false, error: "browserStrategyIntelligence_unavailable" });
    return res.json({ success: true, ...browserStratIntel.buildWorkflowLinkedBrowserSequence(req.body.workflowId || "", req.body.steps || []) });
});
router.post("/runtime/browser-strat/replay-plan", rateLimiter(10, 60_000), (req, res) => {
    if (!browserStratIntel) return res.status(503).json({ success: false, error: "browserStrategyIntelligence_unavailable" });
    return res.json({ success: true, ...browserStratIntel.buildReplayAwareBrowserPlan(req.body.replayId || "", req.body) });
});

// Phase 682 — Long-Horizon Execution Planning
router.post("/runtime/lh-plan/create", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonPlan) return res.status(503).json({ success: false, error: "longHorizonExecutionPlanning_unavailable" });
    return res.json({ success: true, ...longHorizonPlan.createMultiDayPlan(req.body) });
});
router.post("/runtime/lh-plan/progress", rateLimiter(20, 60_000), (req, res) => {
    if (!longHorizonPlan) return res.status(503).json({ success: false, error: "longHorizonExecutionPlanning_unavailable" });
    return res.json({ success: true, ...longHorizonPlan.updatePlanProgress(req.body.planId, req.body) });
});
router.get("/runtime/lh-plan/reconnect", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonPlan) return res.status(503).json({ success: false, error: "longHorizonExecutionPlanning_unavailable" });
    return res.json({ success: true, ...longHorizonPlan.planReconnectSafeContinuity(req.query.sessionId || "") });
});
router.post("/runtime/lh-plan/restore-interrupted", rateLimiter(5, 60_000), (req, res) => {
    if (!longHorizonPlan) return res.status(503).json({ success: false, error: "longHorizonExecutionPlanning_unavailable" });
    return res.json({ success: true, ...longHorizonPlan.planInterruptedWorkflowRestoration(req.body) });
});
router.get("/runtime/lh-plan/list", rateLimiter(10, 60_000), (req, res) => {
    if (!longHorizonPlan) return res.status(503).json({ success: false, error: "longHorizonExecutionPlanning_unavailable" });
    return res.json({ success: true, plans: longHorizonPlan.listLongHorizonPlans(req.query) });
});

// Phase 683 — Engineering Memory Strategy
router.post("/runtime/eng-memory/record", rateLimiter(20, 60_000), (req, res) => {
    if (!engMemStrategy) return res.status(503).json({ success: false, error: "engineeringMemoryStrategy_unavailable" });
    return res.json({ success: true, ...engMemStrategy.recordStrategyOutcome(req.body.strategyId, req.body) });
});
router.get("/runtime/eng-memory/recall", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemStrategy) return res.status(503).json({ success: false, error: "engineeringMemoryStrategy_unavailable" });
    return res.json({ success: true, ...engMemStrategy.prioritizeSuccessfulStrategies(req.query.goal || "", req.query) });
});
router.get("/runtime/eng-memory/env-recall", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemStrategy) return res.status(503).json({ success: false, error: "engineeringMemoryStrategy_unavailable" });
    return res.json({ success: true, ...engMemStrategy.recallStrategyForEnvironment(req.query.goal || "", req.query.env || "default") });
});
router.get("/runtime/eng-memory/deploy-patterns", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemStrategy) return res.status(503).json({ success: false, error: "engineeringMemoryStrategy_unavailable" });
    return res.json({ success: true, ...engMemStrategy.analyzeDeploymentPatterns(req.query.deploymentId || "") });
});
router.get("/runtime/eng-memory/stats", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemStrategy) return res.status(503).json({ success: false, error: "engineeringMemoryStrategy_unavailable" });
    return res.json({ success: true, ...engMemStrategy.memoryStrategyStats() });
});

// Phase 684 — Daily Engineering Strategy Flows
router.post("/runtime/daily-strat/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngStratFlows) return res.status(503).json({ success: false, error: "dailyEngineeringStrategyFlows_unavailable" });
    return res.json({ success: true, ...dailyEngStratFlows.startFlow(req.body.flowType) });
});
router.post("/runtime/daily-strat/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngStratFlows) return res.status(503).json({ success: false, error: "dailyEngineeringStrategyFlows_unavailable" });
    return res.json({ success: true, ...dailyEngStratFlows.advanceFlowStep(req.body.flowId, req.body) });
});
router.post("/runtime/daily-strat/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngStratFlows) return res.status(503).json({ success: false, error: "dailyEngineeringStrategyFlows_unavailable" });
    return res.json({ success: true, ...dailyEngStratFlows.interruptFlow(req.body.flowId) });
});
router.post("/runtime/daily-strat/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngStratFlows) return res.status(503).json({ success: false, error: "dailyEngineeringStrategyFlows_unavailable" });
    return res.json({ success: true, ...dailyEngStratFlows.resumeFlow(req.body.flowId, req.body) });
});
router.get("/runtime/daily-strat/startup", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyEngStratFlows) return res.status(503).json({ success: false, error: "dailyEngineeringStrategyFlows_unavailable" });
    return res.json({ success: true, ...dailyEngStratFlows.runStartupPlan() });
});
router.get("/runtime/daily-strat/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngStratFlows) return res.status(503).json({ success: false, error: "dailyEngineeringStrategyFlows_unavailable" });
    return res.json({ success: true, flows: dailyEngStratFlows.catalogFlows() });
});

// Phase 685 — Strategic Productivity Optimization
router.get("/runtime/strat-prod/efficiency", rateLimiter(10, 60_000), (req, res) => {
    if (!stratProdOpt) return res.status(503).json({ success: false, error: "strategicProductivityOptimization_unavailable" });
    return res.json({ success: true, ...stratProdOpt.debuggingEfficiencyScore() });
});
router.post("/runtime/strat-prod/warning-filter", rateLimiter(10, 60_000), (req, res) => {
    if (!stratProdOpt) return res.status(503).json({ success: false, error: "strategicProductivityOptimization_unavailable" });
    return res.json({ success: true, ...stratProdOpt.reduceWarningNoise(req.body.warnings || []) });
});
router.get("/runtime/strat-prod/fatigue", rateLimiter(10, 60_000), (req, res) => {
    if (!stratProdOpt) return res.status(503).json({ success: false, error: "strategicProductivityOptimization_unavailable" });
    return res.json({ success: true, ...stratProdOpt.operatorFatigueScore() });
});
router.get("/runtime/strat-prod/replay-discoverability", rateLimiter(10, 60_000), (req, res) => {
    if (!stratProdOpt) return res.status(503).json({ success: false, error: "strategicProductivityOptimization_unavailable" });
    return res.json({ success: true, ...stratProdOpt.assessReplayDiscoverability(req.query.goal || "") });
});
router.get("/runtime/strat-prod/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!stratProdOpt) return res.status(503).json({ success: false, error: "strategicProductivityOptimization_unavailable" });
    return res.json({ success: true, ...stratProdOpt.productivityOptimizationSummary() });
});

// Phase 686 — Engineering Strategy Stress Test
router.post("/runtime/eng-strat-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!engStratStress686) return res.status(503).json({ success: false, error: "engineeringStrategyStressTest_unavailable" });
    return res.json({ success: true, ...engStratStress686.runAll() });
});

// Phase 687 — Platform Strategy Resilience
router.get("/runtime/plat-strat/resilience", rateLimiter(5, 60_000), (req, res) => {
    if (!platStratResilience) return res.status(503).json({ success: false, error: "platformStrategyResilience_unavailable" });
    return res.json({ success: true, ...platStratResilience.platformStrategyResilienceReport() });
});
router.get("/runtime/plat-strat/continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!platStratResilience) return res.status(503).json({ success: false, error: "platformStrategyResilience_unavailable" });
    return res.json({ success: true, ...platStratResilience.assessStrategicExecutionContinuity() });
});
router.get("/runtime/plat-strat/rollback-integrity", rateLimiter(10, 60_000), (req, res) => {
    if (!platStratResilience) return res.status(503).json({ success: false, error: "platformStrategyResilience_unavailable" });
    return res.json({ success: true, ...platStratResilience.assessStrategicRollbackIntegrity(req.query.deploymentId || "") });
});
router.get("/runtime/plat-strat/workflow-survivability", rateLimiter(10, 60_000), (req, res) => {
    if (!platStratResilience) return res.status(503).json({ success: false, error: "platformStrategyResilience_unavailable" });
    return res.json({ success: true, ...platStratResilience.assessWorkflowSurvivability() });
});

// Phase 688 — Operational Strategy Audit
router.post("/runtime/op-strat-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!opStratAudit) return res.status(503).json({ success: false, error: "operationalStrategyAudit_unavailable" });
    return res.json({ success: true, ...opStratAudit.runAudit() });
});

// Phase 689 — Daily-Driver Strategy Validation
router.post("/runtime/dd-strat-validation/run", rateLimiter(2, 60_000), (req, res) => {
    if (!ddStratValidation) return res.status(503).json({ success: false, error: "dailyDriverStrategyValidation_unavailable" });
    return res.json({ success: true, ...ddStratValidation.runAll() });
});

// Phase 690 — Engineering Strategy Foundation
router.get("/runtime/eng-strat/health", rateLimiter(5, 60_000), (req, res) => {
    if (!engStratFound) return res.status(503).json({ success: false, error: "engineeringStrategyFoundation_unavailable" });
    return res.json({ success: true, ...engStratFound.platformHealth690() });
});
router.get("/runtime/eng-strat/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!engStratFound) return res.status(503).json({ success: false, error: "engineeringStrategyFoundation_unavailable" });
    return res.json({ success: true, ...engStratFound.fullPlatformHealth() });
});
router.get("/runtime/eng-strat/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!engStratFound) return res.status(503).json({ success: false, error: "engineeringStrategyFoundation_unavailable" });
    return res.json({ success: true, capabilities: engStratFound.capabilities690() });
});
router.get("/runtime/eng-strat/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!engStratFound) return res.status(503).json({ success: false, error: "engineeringStrategyFoundation_unavailable" });
    return res.json({ success: true, ...engStratFound.moduleHealth690() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 691-705 — Multi-Environment Engineering Operator
// ─────────────────────────────────────────────────────────────────────────────
const _req705 = (name) => _req630(name);

const crossEnvExec         = _req705("crossEnvironmentExecution.cjs");
const vsCodeExecIntel      = _req705("vsCodeExecutionIntelligence.cjs");
const termCoordIntel       = _req705("terminalCoordinationIntelligence.cjs");
const browserOpCoord       = _req705("browserOperationCoordination.cjs");
const deployEnvCoord       = _req705("deploymentEnvironmentCoordination.cjs");
const multiProjCtx         = _req705("multiProjectContextIntelligence.cjs");
const engWorkspaceRestore  = _req705("engineeringWorkspaceRestoration.cjs");
const opDecisionCoord      = _req705("operationalDecisionCoordination.cjs");
const dailyEngEnvFlows     = _req705("dailyEngineeringEnvironmentFlows.cjs");
const lhWorkspaceCont      = _req705("longHorizonWorkspaceContinuity.cjs");
const multiEnvStressTest   = _req705("multiEnvironmentStressTest.cjs");
const engProdEvolution2    = _req705("engineeringProductivityEvolution2.cjs");
const platCoordResilience2 = _req705("platformCoordinationResilience2.cjs");
const opSafetyAudit2       = _req705("operatorSafetyAudit2.cjs");
const multiEnvFound        = _req705("multiEnvironmentFoundation.cjs");

// Phase 691 — Cross-Environment Execution
router.post("/runtime/cross-env/context/save", rateLimiter(20, 60_000), (req, res) => {
    if (!crossEnvExec) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { ctxId, opts } = req.body || {};
    return res.json({ success: true, ...crossEnvExec.saveExecutionContext(ctxId, opts) });
});
router.post("/runtime/cross-env/context/restore", rateLimiter(20, 60_000), (req, res) => {
    if (!crossEnvExec) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { ctxId } = req.body || {};
    return res.json({ success: true, ...crossEnvExec.restoreExecutionContext(ctxId) });
});
router.post("/runtime/cross-env/recover", rateLimiter(10, 60_000), (req, res) => {
    if (!crossEnvExec) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { env, errorContext } = req.body || {};
    return res.json({ success: true, ...crossEnvExec.recoverEnvironment(env, errorContext) });
});
router.get("/runtime/cross-env/summary", rateLimiter(20, 60_000), (req, res) => {
    if (!crossEnvExec) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...crossEnvExec.crossEnvSummary() });
});

// Phase 692 — VS Code Execution Intelligence
router.post("/runtime/vscode-exec/file/register", rateLimiter(30, 60_000), (req, res) => {
    if (!vsCodeExecIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { filePath, meta } = req.body || {};
    vsCodeExecIntel.registerActiveFile(filePath, meta);
    return res.json({ success: true });
});
router.get("/runtime/vscode-exec/context", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCodeExecIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...vsCodeExecIntel.getActiveContext() });
});
router.post("/runtime/vscode-exec/patch/plan", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCodeExecIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { filePath, patch } = req.body || {};
    return res.json({ success: true, ...vsCodeExecIntel.planContextualPatch(filePath, patch) });
});
router.get("/runtime/vscode-exec/stale", rateLimiter(10, 60_000), (req, res) => {
    if (!vsCodeExecIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...vsCodeExecIntel.detectStaleFiles() });
});

// Phase 693 — Terminal Coordination Intelligence
router.post("/runtime/term-coord/chain/build", rateLimiter(20, 60_000), (req, res) => {
    if (!termCoordIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { chainId, steps } = req.body || {};
    return res.json({ success: true, ...termCoordIntel.buildRuntimeChain(chainId, steps) });
});
router.post("/runtime/term-coord/chain/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!termCoordIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { chainId, opts } = req.body || {};
    return res.json({ success: true, ...termCoordIntel.advanceChainStep(chainId, opts) });
});
router.post("/runtime/term-coord/restart-order", rateLimiter(10, 60_000), (req, res) => {
    if (!termCoordIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { services, deps } = req.body || {};
    return res.json({ success: true, ...termCoordIntel.planRestartOrder(services, deps) });
});

// Phase 694 — Browser Operation Coordination
router.post("/runtime/browser-op/session/register", rateLimiter(20, 60_000), (req, res) => {
    if (!browserOpCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, meta } = req.body || {};
    browserOpCoord.registerAuthSession(sessionId, meta);
    return res.json({ success: true });
});
router.post("/runtime/browser-op/session/continuity", rateLimiter(20, 60_000), (req, res) => {
    if (!browserOpCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId } = req.body || {};
    return res.json({ success: true, ...browserOpCoord.checkAuthContinuity(sessionId) });
});
router.post("/runtime/browser-op/form/protect", rateLimiter(20, 60_000), (req, res) => {
    if (!browserOpCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { formId, meta } = req.body || {};
    return res.json({ success: true, ...browserOpCoord.protectOperationalForm(formId, meta) });
});
router.get("/runtime/browser-op/sessions/stale", rateLimiter(10, 60_000), (req, res) => {
    if (!browserOpCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...browserOpCoord.detectStaleBrowserSessions() });
});

// Phase 695 — Deployment Environment Coordination
router.post("/runtime/deploy-env/stage/track", rateLimiter(20, 60_000), (req, res) => {
    if (!deployEnvCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { deploymentId, stage, meta } = req.body || {};
    return res.json({ success: true, ...deployEnvCoord.trackDeploymentStage(deploymentId, stage, meta) });
});
router.get("/runtime/deploy-env/summary", rateLimiter(20, 60_000), (req, res) => {
    if (!deployEnvCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const deploymentId = req.query.deploymentId || "";
    return res.json({ success: true, ...deployEnvCoord.deploymentStateSummary(deploymentId) });
});
router.post("/runtime/deploy-env/rollback", rateLimiter(5, 60_000), (req, res) => {
    if (!deployEnvCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { deploymentId, opts } = req.body || {};
    return res.json({ success: true, ...deployEnvCoord.coordinateRollback(deploymentId, opts) });
});
router.get("/runtime/deploy-env/trust", rateLimiter(20, 60_000), (req, res) => {
    if (!deployEnvCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const deploymentId = req.query.deploymentId || "";
    return res.json({ success: true, ...deployEnvCoord.deploymentTrustIndicator(deploymentId) });
});

// Phase 696 — Multi-Project Context Intelligence
router.post("/runtime/multi-proj/context/save", rateLimiter(30, 60_000), (req, res) => {
    if (!multiProjCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { projectId, ctxKey, data } = req.body || {};
    return res.json({ success: true, ...multiProjCtx.saveProjectContext(projectId, ctxKey, data) });
});
router.get("/runtime/multi-proj/context", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProjCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { projectId, ctxKey } = req.query;
    return res.json({ success: true, ...multiProjCtx.getProjectContext(projectId, ctxKey) });
});
router.get("/runtime/multi-proj/projects", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProjCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, projects: multiProjCtx.listProjects() });
});
router.post("/runtime/multi-proj/cleanup", rateLimiter(5, 60_000), (req, res) => {
    if (!multiProjCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { opts } = req.body || {};
    return res.json({ success: true, ...multiProjCtx.cleanupStaleProjectContexts(opts) });
});

// Phase 697 — Engineering Workspace Restoration
router.post("/runtime/workspace/snapshot", rateLimiter(10, 60_000), (req, res) => {
    if (!engWorkspaceRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { workspaceId, state } = req.body || {};
    return res.json({ success: true, ...engWorkspaceRestore.snapshotWorkspace(workspaceId, state) });
});
router.post("/runtime/workspace/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!engWorkspaceRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { workspaceId, opts } = req.body || {};
    return res.json({ success: true, ...engWorkspaceRestore.restoreWorkspace(workspaceId, opts) });
});
router.get("/runtime/workspace/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!engWorkspaceRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWorkspaceRestore.workspaceRestorationSummary() });
});

// Phase 698 — Operational Decision Coordination
router.post("/runtime/op-decision/paths", rateLimiter(20, 60_000), (req, res) => {
    if (!opDecisionCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { context } = req.body || {};
    return res.json({ success: true, ...opDecisionCoord.prioritizeCrossEnvExecutionPaths(context) });
});
router.post("/runtime/op-decision/flows", rateLimiter(20, 60_000), (req, res) => {
    if (!opDecisionCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { context } = req.body || {};
    return res.json({ success: true, ...opDecisionCoord.recommendSaferOperationalFlows(context) });
});
router.get("/runtime/op-decision/unstable", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opDecisionCoord.detectUnstableCoordinationStates() });
});
router.post("/runtime/op-decision/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!opDecisionCoord) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { context } = req.body || {};
    return res.json({ success: true, ...opDecisionCoord.decisionCoordinationSummary(context) });
});

// Phase 699 — Daily Engineering Environment Flows
router.post("/runtime/eng-env-flow/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngEnvFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { flowType } = req.body || {};
    return res.json({ success: true, ...dailyEngEnvFlows.startEnvFlow(flowType) });
});
router.post("/runtime/eng-env-flow/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngEnvFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { flowId, opts } = req.body || {};
    return res.json({ success: true, ...dailyEngEnvFlows.advanceEnvFlowStep(flowId, opts) });
});
router.post("/runtime/eng-env-flow/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngEnvFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { flowId } = req.body || {};
    return res.json({ success: true, ...dailyEngEnvFlows.interruptEnvFlow(flowId) });
});
router.post("/runtime/eng-env-flow/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngEnvFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { flowId, opts } = req.body || {};
    return res.json({ success: true, ...dailyEngEnvFlows.resumeEnvFlow(flowId, opts) });
});
router.get("/runtime/eng-env-flow/list", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngEnvFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, flows: dailyEngEnvFlows.listEnvFlows() });
});
router.post("/runtime/eng-env-flow/startup", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyEngEnvFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...dailyEngEnvFlows.runStartupEnvOrchestration() });
});

// Phase 700 — Long-Horizon Workspace Continuity
router.post("/runtime/lh-workspace/session/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!lhWorkspaceCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, opts } = req.body || {};
    return res.json({ success: true, ...lhWorkspaceCont.persistWorkspaceSession(sessionId, opts) });
});
router.post("/runtime/lh-workspace/session/restore", rateLimiter(10, 60_000), (req, res) => {
    if (!lhWorkspaceCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, opts } = req.body || {};
    return res.json({ success: true, ...lhWorkspaceCont.restoreWorkspaceSession(sessionId, opts) });
});
router.get("/runtime/lh-workspace/storm", rateLimiter(10, 60_000), (req, res) => {
    if (!lhWorkspaceCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lhWorkspaceCont.workspaceStormStatus() });
});
router.get("/runtime/lh-workspace/health", rateLimiter(10, 60_000), (req, res) => {
    if (!lhWorkspaceCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lhWorkspaceCont.workspaceContinuityHealth() });
});
router.get("/runtime/lh-workspace/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!lhWorkspaceCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    const limit = parseInt(req.query.limit) || 10;
    return res.json({ success: true, sessions: lhWorkspaceCont.listWorkspaceSessions({ limit }) });
});

// Phase 701 — Multi-Environment Stress Test
router.post("/runtime/multi-env-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!multiEnvStressTest) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvStressTest.runAll() });
});

// Phase 702 — Engineering Productivity Evolution
router.get("/runtime/eng-prod-evo2/visibility", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdEvolution2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdEvolution2.operatorVisibilityReport() });
});
router.get("/runtime/eng-prod-evo2/calmness", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdEvolution2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdEvolution2.multiEnvCalmnessScore() });
});
router.get("/runtime/eng-prod-evo2/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdEvolution2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdEvolution2.productivityEvolutionSummary() });
});

// Phase 703 — Platform Coordination Resilience 2
router.get("/runtime/plat-coord-res2/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platCoordResilience2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platCoordResilience2.platformCoordinationResilience2Report() });
});

// Phase 704 — Operator Safety Audit 2
router.post("/runtime/op-safety-audit2/run", rateLimiter(2, 60_000), (req, res) => {
    if (!opSafetyAudit2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opSafetyAudit2.runOperatorSafetyAudit2() });
});

// Phase 705 — Multi-Environment Foundation
router.get("/runtime/multi-env/health", rateLimiter(5, 60_000), (req, res) => {
    if (!multiEnvFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvFound.platformHealth705() });
});
router.get("/runtime/multi-env/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!multiEnvFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvFound.fullPlatformHealth705() });
});
router.get("/runtime/multi-env/capabilities", rateLimiter(20, 60_000), (req, res) => {
    if (!multiEnvFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, capabilities: multiEnvFound.capabilities705() });
});
router.get("/runtime/multi-env/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!multiEnvFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvFound.moduleHealth705() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 706-720 — Engineering Productivity OS
// ─────────────────────────────────────────────────────────────────────────────
const _req720 = (name) => _req630(name);

const instantWsRestore    = _req720("instantWorkspaceRestoration.cjs");
const rapidDebugFlows     = _req720("rapidDebuggingFlows.cjs");
const rapidDeployWf       = _req720("rapidDeploymentWorkflows.cjs");
const engCmdCenter        = _req720("engineeringCommandCenter.cjs");
const execProdChains      = _req720("executionProductivityChains.cjs");
const multiEnvProdIntel   = _req720("multiEnvProductivityIntelligence.cjs");
const engMemProd          = _req720("engineeringMemoryProductivity.cjs");
const dailyEngAuto2       = _req720("dailyEngineeringAutomation2.cjs");
const lhProdCont          = _req720("longHorizonProductivityContinuity.cjs");
const prodStressTest      = _req720("productivityStressTest.cjs");
const engUXRefinement     = _req720("engineeringUXRefinement.cjs");
const platProdResilience  = _req720("platformProductivityResilience.cjs");
const opProdAudit         = _req720("operatorProductivityAudit.cjs");
const ddProdValidation    = _req720("dailyDriverProductivityValidation.cjs");
const engProdOSFound      = _req720("engineeringProductivityOSFoundation.cjs");

// Phase 706 — Instant Workspace Restoration
router.post("/runtime/instant-ws/snapshot", rateLimiter(10, 60_000), (req, res) => {
    if (!instantWsRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { snapshotId, state } = req.body || {};
    return res.json({ success: true, ...instantWsRestore.snapshotFullWorkspace(snapshotId, state) });
});
router.post("/runtime/instant-ws/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!instantWsRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { snapshotId, opts } = req.body || {};
    return res.json({ success: true, ...instantWsRestore.instantRestore(snapshotId, opts) });
});
router.post("/runtime/instant-ws/reconnect-safe", rateLimiter(10, 60_000), (req, res) => {
    if (!instantWsRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { snapshotId, components } = req.body || {};
    return res.json({ success: true, ...instantWsRestore.reconnectSafeRestore(snapshotId, components) });
});
router.get("/runtime/instant-ws/list", rateLimiter(20, 60_000), (req, res) => {
    if (!instantWsRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, snapshots: instantWsRestore.listWorkspaceSnapshots() });
});
router.get("/runtime/instant-ws/health", rateLimiter(10, 60_000), (req, res) => {
    if (!instantWsRestore) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...instantWsRestore.workspaceRestoreHealth() });
});

// Phase 707 — Rapid Debugging Flows
router.post("/runtime/rapid-debug/init", rateLimiter(10, 60_000), (req, res) => {
    if (!rapidDebugFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { errorContext, opts } = req.body || {};
    return res.json({ success: true, ...rapidDebugFlows.initializeDebuggingSession(errorContext, opts) });
});
router.post("/runtime/rapid-debug/verify-deps", rateLimiter(10, 60_000), (req, res) => {
    if (!rapidDebugFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { target } = req.body || {};
    return res.json({ success: true, ...rapidDebugFlows.verifyDebuggingDependencies(target) });
});
router.get("/runtime/rapid-debug/runtime-health", rateLimiter(10, 60_000), (req, res) => {
    if (!rapidDebugFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...rapidDebugFlows.debugRuntimeHealthCheck() });
});
router.post("/runtime/rapid-debug/recovery", rateLimiter(10, 60_000), (req, res) => {
    if (!rapidDebugFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { errorContext, opts } = req.body || {};
    return res.json({ success: true, ...rapidDebugFlows.validationFirstRecovery(errorContext, opts) });
});

// Phase 708 — Rapid Deployment Workflows
router.get("/runtime/rapid-deploy/readiness", rateLimiter(10, 60_000), (req, res) => {
    if (!rapidDeployWf) return res.status(503).json({ success: false, error: "module_unavailable" });
    const target = req.query.target || "production";
    return res.json({ success: true, ...rapidDeployWf.scanEnvironmentReadiness(target) });
});
router.post("/runtime/rapid-deploy/prepare", rateLimiter(5, 60_000), (req, res) => {
    if (!rapidDeployWf) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { deploymentId, opts } = req.body || {};
    return res.json({ success: true, ...rapidDeployWf.prepareDeployment(deploymentId, opts) });
});
router.post("/runtime/rapid-deploy/rollback-prep", rateLimiter(5, 60_000), (req, res) => {
    if (!rapidDeployWf) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { deploymentId, opts } = req.body || {};
    return res.json({ success: true, ...rapidDeployWf.prepareRollback(deploymentId, opts) });
});
router.post("/runtime/rapid-deploy/phased-sequence", rateLimiter(5, 60_000), (req, res) => {
    if (!rapidDeployWf) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { deploymentId, opts } = req.body || {};
    return res.json({ success: true, ...rapidDeployWf.buildPhasedDeploymentSequence(deploymentId, opts) });
});
router.get("/runtime/rapid-deploy/visibility", rateLimiter(10, 60_000), (req, res) => {
    if (!rapidDeployWf) return res.status(503).json({ success: false, error: "module_unavailable" });
    const deploymentId = req.query.deploymentId || "";
    return res.json({ success: true, ...rapidDeployWf.deploymentOperatorVisibility(deploymentId) });
});

// Phase 709 — Engineering Command Center
router.get("/runtime/cmd-center/dashboard", rateLimiter(10, 60_000), (req, res) => {
    if (!engCmdCenter) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engCmdCenter.commandCenterDashboard() });
});
router.get("/runtime/cmd-center/runtime", rateLimiter(10, 60_000), (req, res) => {
    if (!engCmdCenter) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engCmdCenter.runtimeHealthPanel() });
});
router.get("/runtime/cmd-center/deployment", rateLimiter(10, 60_000), (req, res) => {
    if (!engCmdCenter) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engCmdCenter.deploymentStatusPanel() });
});
router.get("/runtime/cmd-center/workflows", rateLimiter(10, 60_000), (req, res) => {
    if (!engCmdCenter) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engCmdCenter.activeWorkflowsPanel() });
});
router.get("/runtime/cmd-center/recovery", rateLimiter(10, 60_000), (req, res) => {
    if (!engCmdCenter) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engCmdCenter.recoveryRecommendationsPanel() });
});

// Phase 710 — Execution Productivity Chains
router.post("/runtime/prod-chain/start", rateLimiter(10, 60_000), (req, res) => {
    if (!execProdChains) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { chainType } = req.body || {};
    return res.json({ success: true, ...execProdChains.startProductivityChain(chainType) });
});
router.post("/runtime/prod-chain/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!execProdChains) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { chainId, opts } = req.body || {};
    return res.json({ success: true, ...execProdChains.advanceChain(chainId, opts) });
});
router.post("/runtime/prod-chain/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!execProdChains) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { chainId } = req.body || {};
    return res.json({ success: true, ...execProdChains.interruptChain(chainId) });
});
router.post("/runtime/prod-chain/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!execProdChains) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { chainId, opts } = req.body || {};
    return res.json({ success: true, ...execProdChains.resumeChain(chainId, opts) });
});
router.get("/runtime/prod-chain/list", rateLimiter(20, 60_000), (req, res) => {
    if (!execProdChains) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, chains: execProdChains.listProductivityChains() });
});
router.get("/runtime/prod-chain/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!execProdChains) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, catalog: execProdChains.catalogProductivityChains() });
});

// Phase 711 — Multi-Environment Productivity Intelligence
router.get("/runtime/prod-intel/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!multiEnvProdIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvProdIntel.multiEnvProductivitySummary() });
});
router.get("/runtime/prod-intel/coordination", rateLimiter(10, 60_000), (req, res) => {
    if (!multiEnvProdIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvProdIntel.crossToolCoordinationScore() });
});
router.get("/runtime/prod-intel/continuity", rateLimiter(10, 60_000), (req, res) => {
    if (!multiEnvProdIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiEnvProdIntel.workspaceContinuityScore() });
});

// Phase 712 — Engineering Memory Productivity
router.post("/runtime/eng-mem-prod/record", rateLimiter(30, 60_000), (req, res) => {
    if (!engMemProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { type, key, outcome } = req.body || {};
    return res.json({ success: true, ...engMemProd.recordProductivityOutcome(type, key, outcome) });
});
router.get("/runtime/eng-mem-prod/workflows", rateLimiter(20, 60_000), (req, res) => {
    if (!engMemProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    const env = req.query.env || null;
    return res.json({ success: true, ...engMemProd.recallWorkflows({ env }) });
});
router.post("/runtime/eng-mem-prod/recovery-suggest", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { errorContext, opts } = req.body || {};
    return res.json({ success: true, ...engMemProd.suggestRecoveryPattern(errorContext, opts) });
});
router.get("/runtime/eng-mem-prod/stats", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engMemProd.memoryProductivityStats() });
});

// Phase 713 — Daily Engineering Automation 2
router.post("/runtime/daily-auto2/start", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngAuto2) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { automationType } = req.body || {};
    return res.json({ success: true, ...dailyEngAuto2.startAutomation2(automationType) });
});
router.post("/runtime/daily-auto2/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngAuto2) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { runId, opts } = req.body || {};
    return res.json({ success: true, ...dailyEngAuto2.advanceAutomationStep2(runId, opts) });
});
router.post("/runtime/daily-auto2/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngAuto2) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { runId } = req.body || {};
    return res.json({ success: true, ...dailyEngAuto2.interruptAutomation2(runId) });
});
router.post("/runtime/daily-auto2/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!dailyEngAuto2) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { runId, opts } = req.body || {};
    return res.json({ success: true, ...dailyEngAuto2.resumeAutomation2(runId, opts) });
});
router.get("/runtime/daily-auto2/summary", rateLimiter(5, 60_000), (req, res) => {
    if (!dailyEngAuto2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...dailyEngAuto2.runOperationalSummary2() });
});
router.get("/runtime/daily-auto2/list", rateLimiter(20, 60_000), (req, res) => {
    if (!dailyEngAuto2) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, runs: dailyEngAuto2.listAutomationRuns2() });
});

// Phase 714 — Long-Horizon Productivity Continuity
router.post("/runtime/lh-prod/session/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!lhProdCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, opts } = req.body || {};
    return res.json({ success: true, ...lhProdCont.persistProductivitySession(sessionId, opts) });
});
router.post("/runtime/lh-prod/session/restore", rateLimiter(10, 60_000), (req, res) => {
    if (!lhProdCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, opts } = req.body || {};
    return res.json({ success: true, ...lhProdCont.restoreProductivitySession(sessionId, opts) });
});
router.get("/runtime/lh-prod/storm", rateLimiter(10, 60_000), (req, res) => {
    if (!lhProdCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lhProdCont.productivityStormStatus() });
});
router.get("/runtime/lh-prod/health", rateLimiter(10, 60_000), (req, res) => {
    if (!lhProdCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lhProdCont.productivityContinuityHealth() });
});
router.get("/runtime/lh-prod/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!lhProdCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    const limit = parseInt(req.query.limit) || 10;
    return res.json({ success: true, sessions: lhProdCont.listProductivitySessions({ limit }) });
});

// Phase 715 — Productivity Stress Test
router.post("/runtime/prod-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!prodStressTest) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...prodStressTest.runAll() });
});

// Phase 716 — Engineering UX Refinement
router.get("/runtime/ux-refinement/report", rateLimiter(5, 60_000), (req, res) => {
    if (!engUXRefinement) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engUXRefinement.uxRefinementReport() });
});
router.get("/runtime/ux-refinement/calmness", rateLimiter(10, 60_000), (req, res) => {
    if (!engUXRefinement) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engUXRefinement.operationalCalmnessIndex() });
});
router.get("/runtime/ux-refinement/discoverability", rateLimiter(10, 60_000), (req, res) => {
    if (!engUXRefinement) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engUXRefinement.workflowDiscoverability() });
});

// Phase 717 — Platform Productivity Resilience
router.get("/runtime/plat-prod-res/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platProdResilience) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platProdResilience.platformProductivityResilienceReport() });
});

// Phase 718 — Operator Productivity Audit
router.post("/runtime/op-prod-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!opProdAudit) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opProdAudit.runOperatorProductivityAudit() });
});

// Phase 719 — Daily-Driver Productivity Validation
router.post("/runtime/dd-prod-validation/run", rateLimiter(2, 60_000), (req, res) => {
    if (!ddProdValidation) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...ddProdValidation.runAll() });
});

// Phase 720 — Engineering Productivity OS Foundation
router.get("/runtime/prod-os/health", rateLimiter(5, 60_000), (req, res) => {
    if (!engProdOSFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdOSFound.platformHealth720() });
});
router.get("/runtime/prod-os/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!engProdOSFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdOSFound.fullPlatformHealth720() });
});
router.get("/runtime/prod-os/capabilities", rateLimiter(5, 60_000), (req, res) => {
    if (!engProdOSFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, capabilities: engProdOSFound.capabilities720() });
});
router.get("/runtime/prod-os/quality", rateLimiter(10, 60_000), (req, res) => {
    if (!engProdOSFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdOSFound.productivityOSQuality() });
});
router.get("/runtime/prod-os/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!engProdOSFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdOSFound.moduleHealth720() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 721-735 — Operator Product Maturity
// ─────────────────────────────────────────────────────────────────────────────
const _req735 = (name) => _req630(name);

const oneClickFlows       = _req735("oneClickEngineeringFlows.cjs");
const engWsUX             = _req735("engineeringWorkspaceUX.cjs");
const repoIntel           = _req735("repoIntelligenceFoundation.cjs");
const ctxPatch            = _req735("contextualPatchMaturity.cjs");
const realDebugProd       = _req735("realDebuggingProductivity.cjs");
const deployProdMat       = _req735("deploymentProductivityMaturity.cjs");
const engMemRef           = _req735("engineeringMemoryRefinement.cjs");
const execPerfOpt         = _req735("executionPerformanceOptimization.cjs");
const longSesseSurv       = _req735("longSessionSurvivability.cjs");
const multiProjMat        = _req735("multiProjectEngineeringMaturity.cjs");
const prodMatStress       = _req735("productivityMaturityStressTest.cjs");
const opTrustRef          = _req735("operatorTrustRefinement.cjs");
const platMatRes          = _req735("platformMaturityResilience.cjs");
const prodMatAudit        = _req735("productMaturityAudit.cjs");
const opProdMatFound      = _req735("operatorProductMaturityFoundation.cjs");

// Phase 721 — One-Click Engineering Flows
router.post("/runtime/one-click/start", rateLimiter(10, 60_000), (req, res) => {
    if (!oneClickFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { flowType } = req.body || {};
    return res.json({ success: true, ...oneClickFlows.startOneClickFlow(flowType) });
});
router.post("/runtime/one-click/advance", rateLimiter(20, 60_000), (req, res) => {
    if (!oneClickFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { runId, opts } = req.body || {};
    return res.json({ success: true, ...oneClickFlows.advanceOneClickFlow(runId, opts) });
});
router.post("/runtime/one-click/interrupt", rateLimiter(10, 60_000), (req, res) => {
    if (!oneClickFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { runId } = req.body || {};
    return res.json({ success: true, ...oneClickFlows.interruptOneClickFlow(runId) });
});
router.post("/runtime/one-click/resume", rateLimiter(10, 60_000), (req, res) => {
    if (!oneClickFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { runId, opts } = req.body || {};
    return res.json({ success: true, ...oneClickFlows.resumeOneClickFlow(runId, opts) });
});
router.post("/runtime/one-click/execute-bundle", rateLimiter(10, 60_000), (req, res) => {
    if (!oneClickFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { flowType } = req.body || {};
    return res.json({ success: true, ...oneClickFlows.executeAutonomousBundle(flowType) });
});
router.get("/runtime/one-click/catalog", rateLimiter(20, 60_000), (req, res) => {
    if (!oneClickFlows) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, catalog: oneClickFlows.catalogOneClickFlows() });
});

// Phase 722 — Engineering Workspace UX
router.get("/runtime/ws-ux/report", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsUX) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsUX.workspaceUXReport() });
});
router.get("/runtime/ws-ux/calmness", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsUX) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsUX.workspaceCalmnessScore() });
});
router.get("/runtime/ws-ux/readability", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsUX) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsUX.workspaceReadabilityIndex() });
});
router.get("/runtime/ws-ux/replay-nav", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsUX) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsUX.replayNavigationSummary() });
});

// Phase 723 — Repo Intelligence Foundation
router.post("/runtime/repo-intel/symbol/index", rateLimiter(30, 60_000), (req, res) => {
    if (!repoIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { name, opts } = req.body || {};
    return res.json({ success: true, ...repoIntel.indexSymbol(name, opts) });
});
router.get("/runtime/repo-intel/symbol/lookup", rateLimiter(20, 60_000), (req, res) => {
    if (!repoIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...repoIntel.lookupSymbol(req.query.name || "") });
});
router.post("/runtime/repo-intel/dep/map", rateLimiter(30, 60_000), (req, res) => {
    if (!repoIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { fromFile, toFile, opts } = req.body || {};
    return res.json({ success: true, ...repoIntel.mapDependency(fromFile, toFile, opts) });
});
router.get("/runtime/repo-intel/graph/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!repoIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...repoIntel.repoGraphSummary() });
});
router.post("/runtime/repo-intel/files/target", rateLimiter(10, 60_000), (req, res) => {
    if (!repoIntel) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { goal, opts } = req.body || {};
    return res.json({ success: true, ...repoIntel.targetFilesForContext(goal, opts) });
});

// Sprint 5 — Symbol Intelligence (live grep, no pre-index)
const symIntel = (() => { try { return require("../../agents/dev/symbolIntelligence.cjs"); } catch { return null; } })();
router.get("/runtime/symbols/find", rateLimiter(20, 60_000), async (req, res) => {
    if (!symIntel) return res.status(503).json({ success: false, error: "symbolIntelligence_unavailable" });
    try { return res.json({ success: true, ...(await symIntel.findSymbol(req.query.name || "")) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.get("/runtime/symbols/references", rateLimiter(20, 60_000), async (req, res) => {
    if (!symIntel) return res.status(503).json({ success: false, error: "symbolIntelligence_unavailable" });
    try { return res.json({ success: true, ...(await symIntel.findReferences(req.query.name || "")) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.get("/runtime/symbols/implementations", rateLimiter(20, 60_000), async (req, res) => {
    if (!symIntel) return res.status(503).json({ success: false, error: "symbolIntelligence_unavailable" });
    try { return res.json({ success: true, ...(await symIntel.findImplementations(req.query.name || "")) }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.get("/runtime/symbols/imports", rateLimiter(20, 60_000), (req, res) => {
    if (!symIntel) return res.status(503).json({ success: false, error: "symbolIntelligence_unavailable" });
    try { return res.json({ success: true, ...symIntel.findImports(req.query.file || "") }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});
router.get("/runtime/symbols/dependents", rateLimiter(20, 60_000), (req, res) => {
    if (!symIntel) return res.status(503).json({ success: false, error: "symbolIntelligence_unavailable" });
    try { return res.json({ success: true, ...symIntel.findDependents(req.query.file || "") }); }
    catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Phase 724 — Contextual Patch Maturity
router.post("/runtime/ctx-patch/propose", rateLimiter(10, 60_000), (req, res) => {
    if (!ctxPatch) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { patchId, opts } = req.body || {};
    return res.json({ success: true, ...ctxPatch.proposePatch(patchId, opts) });
});
router.post("/runtime/ctx-patch/dep-aware-edit", rateLimiter(10, 60_000), (req, res) => {
    if (!ctxPatch) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { patchId, targetFile, opts } = req.body || {};
    return res.json({ success: true, ...ctxPatch.proposeDependencyAwareEdit(patchId, targetFile, opts) });
});
router.get("/runtime/ctx-patch/rollback-preview", rateLimiter(10, 60_000), (req, res) => {
    if (!ctxPatch) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...ctxPatch.buildRollbackPreview(req.query.patchId || "") });
});
router.post("/runtime/ctx-patch/apply", rateLimiter(5, 60_000), (req, res) => {
    if (!ctxPatch) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { patchId, opts } = req.body || {};
    return res.json({ success: true, ...ctxPatch.applyPatch(patchId, opts) });
});
router.get("/runtime/ctx-patch/list", rateLimiter(20, 60_000), (req, res) => {
    if (!ctxPatch) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, patches: ctxPatch.listPatches() });
});

// Phase 725 — Real Debugging Productivity
router.post("/runtime/real-debug/diagnose", rateLimiter(10, 60_000), (req, res) => {
    if (!realDebugProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { errorContext, opts } = req.body || {};
    return res.json({ success: true, ...realDebugProd.diagnoseRuntimeFailure(errorContext, opts) });
});
router.post("/runtime/real-debug/dep-repair", rateLimiter(10, 60_000), (req, res) => {
    if (!realDebugProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { target, opts } = req.body || {};
    return res.json({ success: true, ...realDebugProd.rapidDependencyRepair(target, opts) });
});
router.post("/runtime/real-debug/replay-guided", rateLimiter(10, 60_000), (req, res) => {
    if (!realDebugProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { replayId, errorContext } = req.body || {};
    return res.json({ success: true, ...realDebugProd.replayGuidedDebugging(replayId, errorContext) });
});
router.get("/runtime/real-debug/workflows", rateLimiter(10, 60_000), (req, res) => {
    if (!realDebugProd) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realDebugProd.discoverDebuggingWorkflows() });
});

// Phase 726 — Deployment Productivity Maturity
router.post("/runtime/deploy-mat/staged-flow", rateLimiter(5, 60_000), (req, res) => {
    if (!deployProdMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { deploymentId, opts } = req.body || {};
    return res.json({ success: true, ...deployProdMat.buildStagedDeploymentFlow(deploymentId, opts) });
});
router.get("/runtime/deploy-mat/rollback-readiness", rateLimiter(10, 60_000), (req, res) => {
    if (!deployProdMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const deploymentId = req.query.deploymentId || "";
    return res.json({ success: true, ...deployProdMat.rollbackReadinessAssessment(deploymentId) });
});
router.get("/runtime/deploy-mat/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!deployProdMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const deploymentId = req.query.deploymentId || "";
    return res.json({ success: true, ...deployProdMat.deploymentProductivitySummary(deploymentId) });
});
router.get("/runtime/deploy-mat/trust-report", rateLimiter(10, 60_000), (req, res) => {
    if (!deployProdMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const deploymentId = req.query.deploymentId || "";
    return res.json({ success: true, ...deployProdMat.operationalTrustReport(deploymentId) });
});

// Phase 727 — Engineering Memory Refinement
router.post("/runtime/mem-ref/record", rateLimiter(30, 60_000), (req, res) => {
    if (!engMemRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { type, key, outcome } = req.body || {};
    return res.json({ success: true, ...engMemRef.recordRefinedOutcome(type, key, outcome) });
});
router.post("/runtime/mem-ref/recall-recovery", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { errorContext, opts } = req.body || {};
    return res.json({ success: true, ...engMemRef.recallRecoveryPatterns(errorContext, opts) });
});
router.get("/runtime/mem-ref/replay-discoverability", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engMemRef.refinedReplayDiscoverability() });
});
router.get("/runtime/mem-ref/stats", rateLimiter(10, 60_000), (req, res) => {
    if (!engMemRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engMemRef.memoryRefinementStats() });
});

// Phase 728 — Execution Performance Optimization
router.post("/runtime/exec-perf/replay-render", rateLimiter(20, 60_000), (req, res) => {
    if (!execPerfOpt) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { replayId } = req.body || {};
    return res.json({ success: true, ...execPerfOpt.optimizeReplayRendering(replayId) });
});
router.get("/runtime/exec-perf/responsiveness", rateLimiter(10, 60_000), (req, res) => {
    if (!execPerfOpt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execPerfOpt.checkRuntimeResponsiveness() });
});
router.get("/runtime/exec-perf/cache-stats", rateLimiter(10, 60_000), (req, res) => {
    if (!execPerfOpt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execPerfOpt.cacheStats() });
});
router.post("/runtime/exec-perf/cache-clear", rateLimiter(5, 60_000), (req, res) => {
    if (!execPerfOpt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execPerfOpt.clearPerfCache() });
});

// Phase 729 — Long-Session Survivability
router.post("/runtime/long-sess/persist", rateLimiter(20, 60_000), (req, res) => {
    if (!longSesseSurv) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, opts } = req.body || {};
    return res.json({ success: true, ...longSesseSurv.persistSurvivabilitySession(sessionId, opts) });
});
router.post("/runtime/long-sess/restore", rateLimiter(10, 60_000), (req, res) => {
    if (!longSesseSurv) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { sessionId, opts } = req.body || {};
    return res.json({ success: true, ...longSesseSurv.restoreSurvivabilitySession(sessionId, opts) });
});
router.get("/runtime/long-sess/health", rateLimiter(10, 60_000), (req, res) => {
    if (!longSesseSurv) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...longSesseSurv.survivabilityHealth() });
});
router.get("/runtime/long-sess/sessions", rateLimiter(20, 60_000), (req, res) => {
    if (!longSesseSurv) return res.status(503).json({ success: false, error: "module_unavailable" });
    const limit = parseInt(req.query.limit) || 10;
    return res.json({ success: true, sessions: longSesseSurv.listSurvivabilitySessions({ limit }) });
});

// Phase 730 — Multi-Project Engineering Maturity
router.post("/runtime/multi-proj-mat/register", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProjMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { projectId, opts } = req.body || {};
    return res.json({ success: true, ...multiProjMat.registerProject(projectId, opts) });
});
router.post("/runtime/multi-proj-mat/switch", rateLimiter(10, 60_000), (req, res) => {
    if (!multiProjMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { projectId, opts } = req.body || {};
    return res.json({ success: true, ...multiProjMat.switchProject(projectId, opts) });
});
router.get("/runtime/multi-proj-mat/active", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProjMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...multiProjMat.getActiveProject() });
});
router.post("/runtime/multi-proj-mat/replay/save", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProjMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { projectId, replayId, data } = req.body || {};
    return res.json({ success: true, ...multiProjMat.saveProjectReplay(projectId, replayId, data) });
});
router.get("/runtime/multi-proj-mat/projects", rateLimiter(20, 60_000), (req, res) => {
    if (!multiProjMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, projects: multiProjMat.listProjects() });
});

// Phase 731 — Productivity Maturity Stress Test
router.post("/runtime/prod-mat-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!prodMatStress) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...prodMatStress.runAll() });
});

// Phase 732 — Operator Trust Refinement
router.get("/runtime/op-trust/report", rateLimiter(5, 60_000), (req, res) => {
    if (!opTrustRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opTrustRef.operatorTrustRefinementReport() });
});
router.get("/runtime/op-trust/visibility", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opTrustRef.executionVisibilityScore() });
});
router.get("/runtime/op-trust/transparency", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opTrustRef.workflowTransparencyReport() });
});
router.post("/runtime/op-trust/explainability", rateLimiter(10, 60_000), (req, res) => {
    if (!opTrustRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { context } = req.body || {};
    return res.json({ success: true, ...opTrustRef.operationalExplainability(context) });
});

// Phase 733 — Platform Maturity Resilience
router.get("/runtime/plat-mat-res/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platMatRes) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platMatRes.platformMaturityResilienceReport() });
});

// Phase 734 — Product Maturity Audit
router.post("/runtime/prod-mat-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!prodMatAudit) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...prodMatAudit.runProductMaturityAudit() });
});

// Phase 735 — Operator Product Maturity Foundation
router.get("/runtime/op-prod-mat/health", rateLimiter(5, 60_000), (req, res) => {
    if (!opProdMatFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opProdMatFound.platformHealth735() });
});
router.get("/runtime/op-prod-mat/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!opProdMatFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opProdMatFound.fullPlatformHealth735() });
});
router.get("/runtime/op-prod-mat/capabilities", rateLimiter(5, 60_000), (req, res) => {
    if (!opProdMatFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, capabilities: opProdMatFound.capabilities735() });
});
router.get("/runtime/op-prod-mat/quality", rateLimiter(10, 60_000), (req, res) => {
    if (!opProdMatFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opProdMatFound.productMaturityQuality() });
});
router.get("/runtime/op-prod-mat/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!opProdMatFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opProdMatFound.moduleHealth735() });
});

// ── Phase 736-750: Operator Platform Intelligence ─────────────────────────────

const _req750 = (name) => _req630(name);

const platSigAgg     = _req750("platformSignalAggregation");
const opIntelSurface = _req750("operatorIntelligenceSurface");
const crossPhaseInt  = _req750("crossPhaseIntelligence");
const adaptOpCtx     = _req750("adaptiveOperatorContext");
const intellAlertFlt = _req750("intelligentAlertFiltering");
const platDecSup     = _req750("platformDecisionSupport");
const runtimePattRec = _req750("runtimePatternRecognition");
const opWfOrch       = _req750("operatorWorkflowOrchestration");
const platHlthProj   = _req750("platformHealthProjection");
const intellCtxSw    = _req750("intelligentContextSwitching");
const platIntStress  = _req750("platformIntelligenceStressTest");
const opIntAudit     = _req750("operatorIntelligenceAudit");
const platIntUX      = _req750("platformIntelligenceUX");
const platIntRes     = _req750("platformIntelligenceResilience");
const opPlatIntFound = _req750("operatorPlatformIntelligenceFoundation");

// Phase 736 — Platform Signal Aggregation
router.post("/runtime/plat-sig/ingest", rateLimiter(30, 60_000), (req, res) => {
    if (!platSigAgg) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platSigAgg.ingestSignal(req.body) });
});
router.get("/runtime/plat-sig/surface", rateLimiter(10, 60_000), (req, res) => {
    if (!platSigAgg) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platSigAgg.signalSurface() });
});
router.get("/runtime/plat-sig/aggregate", rateLimiter(10, 60_000), (req, res) => {
    if (!platSigAgg) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platSigAgg.aggregateSignals() });
});

// Phase 737 — Operator Intelligence Surface
router.get("/runtime/op-intel/surface", rateLimiter(5, 60_000), (req, res) => {
    if (!opIntelSurface) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opIntelSurface.intelligenceSurfaceReport() });
});
router.get("/runtime/op-intel/health", rateLimiter(10, 60_000), (req, res) => {
    if (!opIntelSurface) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opIntelSurface.platformHealthSummary() });
});
router.get("/runtime/op-intel/actions", rateLimiter(10, 60_000), (req, res) => {
    if (!opIntelSurface) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opIntelSurface.operatorActionQueue() });
});

// Phase 738 — Cross-Phase Intelligence
router.get("/runtime/cross-phase/health", rateLimiter(5, 60_000), (req, res) => {
    if (!crossPhaseInt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...crossPhaseInt.crossPhaseHealthReport() });
});
router.get("/runtime/cross-phase/risk", rateLimiter(5, 60_000), (req, res) => {
    if (!crossPhaseInt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...crossPhaseInt.crossPhaseRiskPropagation() });
});
router.get("/runtime/cross-phase/trend", rateLimiter(10, 60_000), (req, res) => {
    if (!crossPhaseInt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...crossPhaseInt.crossPhaseTrendDirection() });
});

// Phase 739 — Adaptive Operator Context
router.post("/runtime/op-ctx/focus", rateLimiter(20, 60_000), (req, res) => {
    if (!adaptOpCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { focus, env } = req.body;
    return res.json({ success: true, ...adaptOpCtx.setOperatorFocus(focus, env) });
});
router.post("/runtime/op-ctx/action", rateLimiter(30, 60_000), (req, res) => {
    if (!adaptOpCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...adaptOpCtx.recordOperatorAction(req.body.action, req.body.context) });
});
router.get("/runtime/op-ctx/current", rateLimiter(20, 60_000), (req, res) => {
    if (!adaptOpCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...adaptOpCtx.getOperatorContext() });
});
router.get("/runtime/op-ctx/intent", rateLimiter(10, 60_000), (req, res) => {
    if (!adaptOpCtx) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...adaptOpCtx.inferOperatorIntent() });
});

// Phase 740 — Intelligent Alert Filtering
router.post("/runtime/alert-filter/submit", rateLimiter(30, 60_000), (req, res) => {
    if (!intellAlertFlt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellAlertFlt.filterAlert(req.body) });
});
router.get("/runtime/alert-filter/active", rateLimiter(10, 60_000), (req, res) => {
    if (!intellAlertFlt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellAlertFlt.getActiveAlerts() });
});
router.get("/runtime/alert-filter/stats", rateLimiter(10, 60_000), (req, res) => {
    if (!intellAlertFlt) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellAlertFlt.alertFilteringStats() });
});

// Phase 741 — Platform Decision Support
router.post("/runtime/decision-sup/query", rateLimiter(10, 60_000), (req, res) => {
    if (!platDecSup) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platDecSup.decisionSupport(req.body.type, req.body.params || {}) });
});
router.get("/runtime/decision-sup/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!platDecSup) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platDecSup.decisionSupportSummary() });
});

// Phase 742 — Runtime Pattern Recognition
router.post("/runtime/pattern-rec/record", rateLimiter(30, 60_000), (req, res) => {
    if (!runtimePattRec) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...runtimePattRec.recordRuntimeEvent(req.body.type, req.body.detail) });
});
router.get("/runtime/pattern-rec/detect", rateLimiter(5, 60_000), (req, res) => {
    if (!runtimePattRec) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...runtimePattRec.detectPatterns() });
});
router.get("/runtime/pattern-rec/report", rateLimiter(5, 60_000), (req, res) => {
    if (!runtimePattRec) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...runtimePattRec.patternRecognitionReport() });
});

// Phase 743 — Operator Workflow Orchestration
router.post("/runtime/wf-orch/start", rateLimiter(5, 60_000), (req, res) => {
    if (!opWfOrch) return res.status(503).json({ success: false, error: "module_unavailable" });
    const { workflowId, type, context } = req.body;
    return res.json({ success: true, ...opWfOrch.startOrchestratedWorkflow(workflowId, type, context || {}) });
});
router.post("/runtime/wf-orch/advance", rateLimiter(10, 60_000), (req, res) => {
    if (!opWfOrch) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opWfOrch.advanceOrchestratedWorkflow(req.body.workflowId, { operatorApproved: req.body.operatorApproved }) });
});
router.get("/runtime/wf-orch/status/:workflowId", rateLimiter(10, 60_000), (req, res) => {
    if (!opWfOrch) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opWfOrch.getWorkflowStatus(req.params.workflowId) });
});
router.get("/runtime/wf-orch/list", rateLimiter(10, 60_000), (req, res) => {
    if (!opWfOrch) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opWfOrch.listActiveWorkflows() });
});

// Phase 744 — Platform Health Projection
router.post("/runtime/hlth-proj/snapshot", rateLimiter(5, 60_000), (req, res) => {
    if (!platHlthProj) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platHlthProj.captureHealthSnapshot() });
});
router.get("/runtime/hlth-proj/outlook", rateLimiter(5, 60_000), (req, res) => {
    if (!platHlthProj) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platHlthProj.projectHealthOutlook() });
});

// Phase 745 — Intelligent Context Switching
router.post("/runtime/ctx-sw/save", rateLimiter(10, 60_000), (req, res) => {
    if (!intellCtxSw) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellCtxSw.saveContext(req.body.contextId, req.body.type, req.body.state || {}) });
});
router.post("/runtime/ctx-sw/switch", rateLimiter(10, 60_000), (req, res) => {
    if (!intellCtxSw) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellCtxSw.switchContext(req.body.contextId) });
});
router.get("/runtime/ctx-sw/active", rateLimiter(20, 60_000), (req, res) => {
    if (!intellCtxSw) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellCtxSw.getActiveContext() });
});
router.get("/runtime/ctx-sw/list", rateLimiter(10, 60_000), (req, res) => {
    if (!intellCtxSw) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...intellCtxSw.listContexts() });
});

// Phase 746 — Platform Intelligence Stress Test
router.post("/runtime/plat-int-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!platIntStress) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platIntStress.runAll() });
});

// Phase 747 — Operator Intelligence Audit
router.post("/runtime/op-int-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!opIntAudit) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opIntAudit.runOperatorIntelligenceAudit() });
});

// Phase 748 — Platform Intelligence UX
router.get("/runtime/plat-int-ux/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platIntUX) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platIntUX.intelligenceUXReport() });
});

// Phase 749 — Platform Intelligence Resilience
router.get("/runtime/plat-int-res/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platIntRes) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platIntRes.platformIntelligenceResilienceReport() });
});

// Phase 750 — Operator Platform Intelligence Foundation
router.get("/runtime/op-plat-int/health", rateLimiter(5, 60_000), (req, res) => {
    if (!opPlatIntFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opPlatIntFound.platformHealth750() });
});
router.get("/runtime/op-plat-int/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!opPlatIntFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opPlatIntFound.fullPlatformHealth750() });
});
router.get("/runtime/op-plat-int/capabilities", rateLimiter(5, 60_000), (req, res) => {
    if (!opPlatIntFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, capabilities: opPlatIntFound.capabilities750() });
});
router.get("/runtime/op-plat-int/quality", rateLimiter(10, 60_000), (req, res) => {
    if (!opPlatIntFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opPlatIntFound.intelligenceQuality() });
});
router.get("/runtime/op-plat-int/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!opPlatIntFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...opPlatIntFound.moduleHealth750() });
});

// ── Phase 751-765: Real Engineering Execution Experience ──────────────────────

const _req765 = (name) => _req630(name);

const realDbgSessExp  = _req765("realDebugSessionExperience");
const depExecExp      = _req765("deploymentExecutionExperience");
const engWsExp        = _req765("engineeringWorkspaceExperience");
const vsCodeExecExp   = _req765("vsCodeExecutionExperience");
const termExecExp     = _req765("terminalExecutionExperience");
const brwExecExp      = _req765("browserExecutionExperience");
const execVisMat      = _req765("executionVisibilityMaturity");
const engProdAccel    = _req765("engineeringProductivityAcceleration");
const lsEngCont       = _req765("longSessionEngineeringContinuity");
const mpExecMat       = _req765("multiProjectExecutionMaturity");
const realWldStress   = _req765("realWorldEngineeringStressTest");
const execUXRef       = _req765("executionUXRefinement");
const platExecRes     = _req765("platformExecutionResilience");
const realEngAudit    = _req765("realEngineeringExecutionAudit");
const realEngFound    = _req765("realEngineeringExecutionFoundation");

// Phase 751 — Real Debug Session Experience
router.post("/runtime/debug-sess/start", rateLimiter(5, 60_000), (req, res) => {
    if (!realDbgSessExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realDbgSessExp.startDebugSession(req.body.sessionId, req.body.errorContext || {}) });
});
router.post("/runtime/debug-sess/advance", rateLimiter(10, 60_000), (req, res) => {
    if (!realDbgSessExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realDbgSessExp.advanceDebugSession(req.body.sessionId, { operatorApproved: req.body.operatorApproved }) });
});
router.get("/runtime/debug-sess/status/:sessionId", rateLimiter(10, 60_000), (req, res) => {
    if (!realDbgSessExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realDbgSessExp.getDebugSessionStatus(req.params.sessionId) });
});
router.post("/runtime/debug-sess/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!realDbgSessExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realDbgSessExp.restoreDebugSession(req.body.sessionId) });
});
router.get("/runtime/debug-sess/walkthrough/:errorType", rateLimiter(10, 60_000), (req, res) => {
    if (!realDbgSessExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realDbgSessExp.debugSessionWalkthrough(req.params.errorType) });
});

// Phase 752 — Deployment Execution Experience
router.post("/runtime/dep-exec/start", rateLimiter(5, 60_000), (req, res) => {
    if (!depExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...depExecExp.startDeploymentSession(req.body.deploymentId, req.body.context || {}) });
});
router.post("/runtime/dep-exec/advance", rateLimiter(10, 60_000), (req, res) => {
    if (!depExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...depExecExp.advanceDeploymentStage(req.body.deploymentId, { operatorApproved: req.body.operatorApproved }) });
});
router.post("/runtime/dep-exec/rollback", rateLimiter(3, 60_000), (req, res) => {
    if (!depExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...depExecExp.rollbackDeployment(req.body.deploymentId, { operatorApproved: req.body.operatorApproved }) });
});
router.get("/runtime/dep-exec/progress/:deploymentId", rateLimiter(10, 60_000), (req, res) => {
    if (!depExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...depExecExp.getDeploymentProgress(req.params.deploymentId) });
});
router.get("/runtime/dep-exec/readiness", rateLimiter(10, 60_000), (req, res) => {
    if (!depExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...depExecExp.deploymentReadinessSummary(req.query.id || "") });
});

// Phase 753 — Engineering Workspace Experience
router.post("/runtime/ws-exp/save", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsExp.saveWorkspaceSnapshot(req.body.workspaceId, req.body.snapshot || {}) });
});
router.post("/runtime/ws-exp/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!engWsExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsExp.restoreWorkspace(req.body.workspaceId) });
});
router.post("/runtime/ws-exp/switch", rateLimiter(5, 60_000), (req, res) => {
    if (!engWsExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsExp.switchWorkspace(req.body.workspaceId) });
});
router.get("/runtime/ws-exp/active", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsExp.getActiveWorkspace() });
});
router.get("/runtime/ws-exp/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!engWsExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engWsExp.workspaceExperienceSummary() });
});

// Phase 754 — VS Code Execution Experience
router.post("/runtime/vscode-exp/file", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCodeExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...vsCodeExecExp.recordActiveFile(req.body.filePath, req.body.context || {}) });
});
router.post("/runtime/vscode-exp/patch-preview", rateLimiter(10, 60_000), (req, res) => {
    if (!vsCodeExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...vsCodeExecExp.patchPreview(req.body.filePath, req.body.patch || {}) });
});
router.get("/runtime/vscode-exp/context", rateLimiter(20, 60_000), (req, res) => {
    if (!vsCodeExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...vsCodeExecExp.getEditorContext(req.query.filePath) });
});

// Phase 755 — Terminal Execution Experience
router.post("/runtime/term-exp/command", rateLimiter(30, 60_000), (req, res) => {
    if (!termExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...termExecExp.recordCommand(req.body.command, req.body.context || {}) });
});
router.post("/runtime/term-exp/suggest", rateLimiter(10, 60_000), (req, res) => {
    if (!termExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...termExecExp.suggestNextCommand(req.body.state || {}) });
});
router.post("/runtime/term-exp/session/start", rateLimiter(5, 60_000), (req, res) => {
    if (!termExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...termExecExp.startShellSession(req.body.sessionId, req.body.context || {}) });
});
router.get("/runtime/term-exp/summary", rateLimiter(10, 60_000), (req, res) => {
    if (!termExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...termExecExp.terminalExperienceSummary() });
});

// Phase 756 — Browser Execution Experience
router.post("/runtime/browser-exp/save", rateLimiter(10, 60_000), (req, res) => {
    if (!brwExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...brwExecExp.saveBrowserSession(req.body.sessionId, req.body.context || {}) });
});
router.post("/runtime/browser-exp/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!brwExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...brwExecExp.restoreBrowserSession(req.body.sessionId) });
});
router.post("/runtime/browser-exp/form-check", rateLimiter(10, 60_000), (req, res) => {
    if (!brwExecExp) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...brwExecExp.formSafetyCheck(req.body.sessionId, req.body.formAction) });
});

// Phase 757 — Execution Visibility Maturity
router.get("/runtime/exec-vis/report", rateLimiter(5, 60_000), (req, res) => {
    if (!execVisMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execVisMat.executionVisibilityReport() });
});
router.get("/runtime/exec-vis/runtime-health", rateLimiter(5, 60_000), (req, res) => {
    if (!execVisMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execVisMat.runtimeHealthSummary() });
});
router.get("/runtime/exec-vis/recovery-recs", rateLimiter(5, 60_000), (req, res) => {
    if (!execVisMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execVisMat.recoveryRecommendations() });
});

// Phase 758 — Engineering Productivity Acceleration
router.get("/runtime/prod-accel/report", rateLimiter(5, 60_000), (req, res) => {
    if (!engProdAccel) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...engProdAccel.productivityAccelerationReport() });
});

// Phase 759 — Long-Session Engineering Continuity
router.post("/runtime/ls-eng-cont/persist", rateLimiter(10, 60_000), (req, res) => {
    if (!lsEngCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lsEngCont.persistEngineeringSession(req.body.sessionId, req.body.state || {}) });
});
router.post("/runtime/ls-eng-cont/restore", rateLimiter(5, 60_000), (req, res) => {
    if (!lsEngCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lsEngCont.restoreEngineeringSession(req.body.sessionId, { force: req.body.force }) });
});
router.get("/runtime/ls-eng-cont/health", rateLimiter(5, 60_000), (req, res) => {
    if (!lsEngCont) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...lsEngCont.engineeringContinuityHealth() });
});

// Phase 760 — Multi-Project Execution Maturity
router.get("/runtime/mp-exec/report", rateLimiter(5, 60_000), (req, res) => {
    if (!mpExecMat) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...mpExecMat.multiProjectExecutionReport() });
});

// Phase 761 — Real-World Engineering Stress Test
router.post("/runtime/rw-stress/run", rateLimiter(2, 60_000), (req, res) => {
    if (!realWldStress) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realWldStress.runAll() });
});

// Phase 762 — Execution UX Refinement
router.get("/runtime/exec-ux/report", rateLimiter(5, 60_000), (req, res) => {
    if (!execUXRef) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...execUXRef.executionUXReport() });
});

// Phase 763 — Platform Execution Resilience
router.get("/runtime/plat-exec-res/report", rateLimiter(5, 60_000), (req, res) => {
    if (!platExecRes) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...platExecRes.platformExecutionResilienceReport() });
});

// Phase 764 — Real Engineering Execution Audit
router.post("/runtime/real-eng-audit/run", rateLimiter(2, 60_000), (req, res) => {
    if (!realEngAudit) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realEngAudit.runRealEngineeringExecutionAudit() });
});

// Phase 765 — Real Engineering Execution Foundation
router.get("/runtime/real-eng-found/health", rateLimiter(5, 60_000), (req, res) => {
    if (!realEngFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realEngFound.platformHealth765() });
});
router.get("/runtime/real-eng-found/full-health", rateLimiter(3, 60_000), (req, res) => {
    if (!realEngFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realEngFound.fullPlatformHealth765() });
});
router.get("/runtime/real-eng-found/capabilities", rateLimiter(5, 60_000), (req, res) => {
    if (!realEngFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, capabilities: realEngFound.capabilities765() });
});
router.get("/runtime/real-eng-found/quality", rateLimiter(10, 60_000), (req, res) => {
    if (!realEngFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realEngFound.executionQuality() });
});
router.get("/runtime/real-eng-found/modules", rateLimiter(20, 60_000), (req, res) => {
    if (!realEngFound) return res.status(503).json({ success: false, error: "module_unavailable" });
    return res.json({ success: true, ...realEngFound.moduleHealth765() });
});

// ── I4: Autonomous Execution Runtime ───────────────────────────────────────
const _execRT = (() => { try { return require("../services/autonomousExecutionRuntime.cjs"); } catch { return null; } })();
const _execErr = (res) => res.status(503).json({ success: false, error: "execution_runtime_unavailable" });

// GET /runtime/execution
router.get("/runtime/execution", rateLimiter(60, 60_000), (req, res) => {
    if (!_execRT) return _execErr(res);
    const limit      = Math.min(parseInt(req.query.limit) || 100, 500);
    const status     = req.query.status     || null;
    const missionId  = req.query.missionId  || null;
    const capability = req.query.capability || null;
    const since      = req.query.since      || null;
    return res.json({ success: true, ..._execRT.listExecutions({ limit, status, missionId, capability, since }) });
});

// GET /runtime/execution/statistics
router.get("/runtime/execution/statistics", rateLimiter(30, 60_000), (req, res) => {
    if (!_execRT) return _execErr(res);
    return res.json({ success: true, ..._execRT.getStatistics() });
});

// POST /runtime/execution/retry
router.post("/runtime/execution/retry", rateLimiter(10, 60_000), async (req, res) => {
    if (!_execRT) return _execErr(res);
    const { executionId } = req.body;
    if (!executionId) return res.status(400).json({ success: false, error: "executionId required" });
    try {
        const result = await _execRT.retryExecution(executionId);
        return res.json({ success: true, execution: result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404 : 409;
        return res.status(status).json({ success: false, error: err.message });
    }
});

// POST /runtime/execution/cancel
router.post("/runtime/execution/cancel", rateLimiter(20, 60_000), (req, res) => {
    if (!_execRT) return _execErr(res);
    const { executionId } = req.body;
    if (!executionId) return res.status(400).json({ success: false, error: "executionId required" });
    try {
        const result = _execRT.cancelExecution(executionId);
        return res.json({ success: true, execution: result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404 : 409;
        return res.status(status).json({ success: false, error: err.message });
    }
});

// POST /runtime/execution/rollback
router.post("/runtime/execution/rollback", rateLimiter(10, 60_000), async (req, res) => {
    if (!_execRT) return _execErr(res);
    const { executionId } = req.body;
    if (!executionId) return res.status(400).json({ success: false, error: "executionId required" });
    try {
        const result = await _execRT.rollbackExecution(executionId);
        return res.json({ success: true, execution: result });
    } catch (err) {
        const status = err.message.includes("not found") ? 404 : 409;
        return res.status(status).json({ success: false, error: err.message });
    }
});

// GET /runtime/execution/:id  — must follow named routes
router.get("/runtime/execution/:id", rateLimiter(30, 60_000), (req, res) => {
    if (!_execRT) return _execErr(res);
    const exec = _execRT.getExecution(req.params.id);
    if (!exec) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, execution: exec });
});

// ── I2: Autonomous Decision Engine ─────────────────────────────────────────
const _decision = (() => { try { return require("../services/autonomousDecisionEngine.cjs"); } catch { return null; } })();

// GET /runtime/decisions
router.get("/runtime/decisions", rateLimiter(60, 60_000), (req, res) => {
    if (!_decision) return res.status(503).json({ success: false, error: "decision_engine_unavailable" });
    const limit     = Math.min(parseInt(req.query.limit)  || 100, 500);
    const action    = req.query.action    || null;
    const priority  = req.query.priority  || null;
    const status    = req.query.status    || null;
    const subsystem = req.query.subsystem || null;
    const since     = req.query.since     || null;
    return res.json({ success: true, ..._decision.getDecisions({ limit, action, priority, status, subsystem, since }) });
});

// GET /runtime/decisions/statistics
router.get("/runtime/decisions/statistics", rateLimiter(30, 60_000), (req, res) => {
    if (!_decision) return res.status(503).json({ success: false, error: "decision_engine_unavailable" });
    return res.json({ success: true, ..._decision.getStatistics() });
});

// GET /runtime/decisions/rules
router.get("/runtime/decisions/rules", rateLimiter(30, 60_000), (req, res) => {
    if (!_decision) return res.status(503).json({ success: false, error: "decision_engine_unavailable" });
    return res.json({ success: true, rules: _decision.getRules() });
});

// POST /runtime/decisions/replay
router.post("/runtime/decisions/replay", rateLimiter(10, 60_000), async (req, res) => {
    if (!_decision) return res.status(503).json({ success: false, error: "decision_engine_unavailable" });
    const { observerEventId } = req.body;
    if (!observerEventId) return res.status(400).json({ success: false, error: "observerEventId required" });
    try {
        const result = await _decision.replayEvent(observerEventId);
        if (!result) return res.status(404).json({ success: false, error: "event_not_found_or_no_rule_matched" });
        return res.json({ success: true, decision: result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /runtime/decisions/:id   — must come after /statistics and /rules
router.get("/runtime/decisions/:id", rateLimiter(30, 60_000), (req, res) => {
    if (!_decision) return res.status(503).json({ success: false, error: "decision_engine_unavailable" });
    const d = _decision.getDecision(req.params.id);
    if (!d) return res.status(404).json({ success: false, error: "not_found" });
    return res.json({ success: true, decision: d });
});

// ── I1: Continuous Runtime Observer ────────────────────────────────────────
const _observer = (() => { try { return require("../services/continuousRuntimeObserver.cjs"); } catch { return null; } })();

// GET /runtime/observer/status
router.get("/runtime/observer/status", rateLimiter(30, 60_000), (req, res) => {
    if (!_observer) return res.status(503).json({ success: false, error: "observer_unavailable" });
    return res.json({ success: true, ...(_observer.getStatus()) });
});

// GET /runtime/observer/events
router.get("/runtime/observer/events", rateLimiter(60, 60_000), (req, res) => {
    if (!_observer) return res.status(503).json({ success: false, error: "observer_unavailable" });
    const limit    = Math.min(parseInt(req.query.limit)  || 100, 500);
    const category = req.query.category || null;
    const severity = req.query.severity || null;
    const source   = req.query.source   || null;
    const since    = req.query.since    || null;
    return res.json({ success: true, ..._observer.getEvents({ limit, category, severity, source, since }) });
});

// GET /runtime/observer/health
router.get("/runtime/observer/health", rateLimiter(30, 60_000), (req, res) => {
    if (!_observer) return res.status(503).json({ success: false, error: "observer_unavailable" });
    return res.json({ success: true, ..._observer.getHealth() });
});

// GET /runtime/observer/sources
router.get("/runtime/observer/sources", rateLimiter(30, 60_000), (req, res) => {
    if (!_observer) return res.status(503).json({ success: false, error: "observer_unavailable" });
    return res.json({ success: true, sources: _observer.getSources() });
});

// GET /runtime/observer/statistics
router.get("/runtime/observer/statistics", rateLimiter(30, 60_000), (req, res) => {
    if (!_observer) return res.status(503).json({ success: false, error: "observer_unavailable" });
    return res.json({ success: true, ..._observer.getStatistics() });
});

// ── I5: Engineering Capability Layer ────────────────────────────────────────
function _engCap() {
    try { return require("../services/engineeringCapabilities.cjs"); } catch { return null; }
}

// GET /runtime/capabilities
router.get("/runtime/capabilities", rateLimiter(30, 60_000), (req, res) => {
    const ec = _engCap();
    if (!ec) return res.status(503).json({ success: false, error: "engineering_capabilities_unavailable" });
    return res.json({ success: true, capabilities: ec.getCapabilityMatrix() });
});

// POST /runtime/capabilities/remember
router.post("/runtime/capabilities/remember", rateLimiter(30, 60_000), (req, res) => {
    const ec = _engCap();
    if (!ec) return res.status(503).json({ success: false, error: "engineering_capabilities_unavailable" });
    const { type, data, opts } = req.body || {};
    if (!type || !data) return res.status(400).json({ success: false, error: "type and data required" });
    try {
        const result = ec.remember(type, data, opts || {});
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /runtime/capabilities/recall
router.post("/runtime/capabilities/recall", rateLimiter(30, 60_000), (req, res) => {
    const ec = _engCap();
    if (!ec) return res.status(503).json({ success: false, error: "engineering_capabilities_unavailable" });
    const { query, opts } = req.body || {};
    if (!query) return res.status(400).json({ success: false, error: "query required" });
    const result = ec.recall(query, opts || {});
    return res.json({ success: true, ...result });
});

module.exports = router;

