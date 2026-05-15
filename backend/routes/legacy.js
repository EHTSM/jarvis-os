"use strict";
/**
 * Legacy routes — mirrors everything in root server.js that the new
 * backend/routes/jarvis.js doesn't cover:
 *   /saas, /leads, /parse-command, /memory/*, /scheduled/*, /learning/*,
 *   /context/*, /voice/*, /desktop/*, /agents/*, /evolution/*,
 *   /auto-agent/*, /workflow/*, /predict/*, /self-improve/*
 *
 * All root-level modules are loaded gracefully; each route group
 * returns 503 if its module failed to load.
 */

const express = require("express");
const router  = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const operatorAudit   = require("../middleware/operatorAudit");

// All legacy routes require operator authentication.
// These routes expose internal system state (agents, evolution, voice,
// desktop) and must not be reachable without a valid JWT session.
router.use(requireAuth, operatorAudit);

// ── Graceful module loader ────────────────────────────────────────
function tryRequire(path) {
    try { return require(path); } catch { return null; }
}

// ── Root-level modules ────────────────────────────────────────────
const ROOT = require("path").join(__dirname, "../../");

const orchestratorMod   = tryRequire(ROOT + "orchestrator.cjs");
const schedulerMod      = tryRequire(ROOT + "scheduler.cjs");
const taskQueue         = tryRequire(ROOT + "agents/taskQueue.cjs");
const commandParserMod  = tryRequire(ROOT + "commandParser.cjs");
const leadsMod          = tryRequire(ROOT + "agents/leads.cjs");
const bulkSenderMod     = tryRequire(ROOT + "utils/bulkSender.cjs");
const followUpSeqMod    = tryRequire(ROOT + "agents/followUpSequence.cjs");
const saasRoutes        = tryRequire(ROOT + "agents/saas.cjs");

// Destructure orchestrator exports
const {
    getMemoryState,
    clearMemoryState,
    contextEngine,
    learningSystem,
    voiceAgent,
    desktopAgent,
    agentFactory,
    evolutionEngine
} = orchestratorMod || {};

const {
    getScheduledTasks,
    cancelTask,
    getSchedulerStatus,
    clearAllTasks,
    getTask
} = schedulerMod || {};

const { parseCommand, executeCommand } = commandParserMod || {};
const { getLeads: getMapsLeads }       = leadsMod         || {};
const { sendBulk }                     = bulkSenderMod    || {};
const { followUpSequence }             = followUpSeqMod   || {};

// ── In-memory state (persists per process) ────────────────────────
const commandHistory = {
    commands: [],
    addCommand(cmd, parsed, result) {
        this.commands.push({ command: cmd, type: parsed?.type, timestamp: new Date(), success: result?.success });
        if (this.commands.length > 50) this.commands.shift();
    },
    getFrequency() {
        const freq = {};
        this.commands.forEach(c => { if (c.type) freq[c.type] = (freq[c.type] || 0) + 1; });
        return freq;
    },
    getSuggestions() {
        return Object.entries(this.getFrequency())
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([type, count]) => ({ type, frequency: count, suggestion: `You often use ${type} (${count}x)` }));
    }
};

const workflows        = {};
let   masterAgentMgr   = null;

// ── Helpers ───────────────────────────────────────────────────────
function unavailable(name) {
    return (_req, res) => res.status(503).json({ error: `${name} module unavailable` });
}

// Safe degraded response for evolution endpoints — returns 200 with empty data
// so the frontend Insights tab renders instead of throwing on 503.
function evolutionFallback(shape) {
    return (_req, res) => res.json({ success: false, available: false, ...shape });
}

// ── /saas ─────────────────────────────────────────────────────────
if (saasRoutes) {
    router.use("/saas", saasRoutes);
}

// ── Google Maps leads ─────────────────────────────────────────────
router.get("/leads", getMapsLeads
    ? async (req, res) => {
        const q    = req.query.q || "digital marketing agency india";
        const data = await getMapsLeads(q).catch(() => []);
        res.json(data);
    }
    : unavailable("leads"));

// ── Parse-command ─────────────────────────────────────────────────
router.post("/parse-command", parseCommand
    ? async (req, res) => {
        try {
            const { command } = req.body;
            if (!command) return res.status(400).json({ error: "command required" });
            const parsed = parseCommand(command);
            const result = await executeCommand(parsed);
            commandHistory.addCommand(command, parsed, result);
            res.json({ success: true, input: command, parsed, result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("commandParser"));

// ── Memory ────────────────────────────────────────────────────────
router.get("/memory", getMemoryState
    ? (req, res) => {
        try {
            const state = getMemoryState();
            res.json({ success: true, memory_state: state, short_term_count: state?.shortTerm?.length || 0, long_term_count: state?.longTerm?.length || 0 });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("memory"));

router.delete("/memory", clearMemoryState
    ? (req, res) => {
        try { clearMemoryState(); res.json({ success: true, message: "Memory cleared" }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("memory"));

router.get("/memory/suggestions", (req, res) => res.json({ success: true, suggestions: commandHistory.getSuggestions() }));
router.get("/memory/frequency",   (req, res) => res.json({ success: true, frequency: commandHistory.getFrequency() }));
router.get("/memory/history", (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    res.json({ success: true, history: commandHistory.commands.slice(-limit).reverse() });
});

// ── Task Queue (replaces dead scheduler.cjs routes) ──────────────
// All /scheduled/* routes now serve live taskQueue.cjs data.
router.get("/scheduled", taskQueue
    ? (req, res) => {
        try {
            let tasks = taskQueue.getAll();
            if (req.query.status) tasks = tasks.filter(t => t.status === req.query.status);
            res.json({ success: true, tasks, count: tasks.length });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("taskQueue"));

router.get("/scheduled/:id", taskQueue
    ? (req, res) => {
        try {
            const task = taskQueue.getAll().find(t => t.id === req.params.id);
            if (!task) return res.status(404).json({ error: "Task not found" });
            res.json({ success: true, task });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("taskQueue"));

router.delete("/scheduled/:id", taskQueue
    ? (req, res) => {
        try {
            const result = taskQueue.update(req.params.id, { status: "cancelled" });
            if (!result) return res.status(404).json({ error: "Task not found" });
            res.json({ success: true, task: result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("taskQueue"));

router.delete("/scheduled", taskQueue
    ? (req, res) => {
        try {
            const pending = taskQueue.getAll().filter(t => t.status === "pending");
            for (const t of pending) taskQueue.update(t.id, { status: "cancelled" });
            res.json({ success: true, cancelled: pending.length });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("taskQueue"));

router.get("/scheduler/status", (req, res) => {
    try {
        const all     = taskQueue ? taskQueue.getAll() : [];
        const pending = all.filter(t => t.status === "pending").length;
        const running = all.filter(t => t.status === "running").length;
        res.json({ success: true, status: "active", mode: "taskQueue", pending, running, total: all.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Learning ──────────────────────────────────────────────────────
router.get("/learning/stats",         learningSystem ? (req, res) => { try { res.json({ success: true, ...learningSystem.getStats() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.get("/learning/habits",        learningSystem ? (req, res) => { try { res.json({ success: true, habits: learningSystem.getUserHabits() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.get("/learning/patterns",      learningSystem ? (req, res) => { try { res.json({ success: true, patterns: learningSystem.getPatterns(parseInt(req.query.limit) || 10) }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.get("/learning/frequency",     learningSystem ? (req, res) => { try { res.json({ success: true, frequency: learningSystem.getFrequency() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.get("/learning/success-rates", learningSystem ? (req, res) => { try { res.json({ success: true, success_rates: learningSystem.getSuccessRate() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.get("/learning/suggestions",   learningSystem ? (req, res) => { try { res.json({ success: true, suggestions: learningSystem.getSuggestions(req.query.prefix || "") }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.get("/learning/optimizations", learningSystem ? (req, res) => { try { res.json({ success: true, suggestions: learningSystem.getOptimizationSuggestions() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));
router.delete("/learning",            learningSystem ? (req, res) => { try { learningSystem.clearLearning(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));

// ── Context ───────────────────────────────────────────────────────
router.get("/context/history", contextEngine
    ? (req, res) => { try { res.json({ success: true, history: contextEngine.getLastConversations(parseInt(req.query.limit) || 10) }); } catch (e) { res.status(500).json({ error: e.message }); } }
    : unavailable("context"));

router.get("/context/session", contextEngine
    ? (req, res) => { try { res.json({ success: true, session: contextEngine.getSessionStats() }); } catch (e) { res.status(500).json({ error: e.message }); } }
    : unavailable("context"));

// ── Voice ─────────────────────────────────────────────────────────
router.get("/voice/status", voiceAgent
    ? (req, res) => { try { res.json({ success: true, enabled: voiceAgent.voiceEnabled, platform: process.platform }); } catch (e) { res.status(500).json({ error: e.message }); } }
    : unavailable("voice"));

router.post("/voice/speak", voiceAgent
    ? async (req, res) => {
        try {
            const { text, rate, voice } = req.body;
            if (!text) return res.status(400).json({ error: "text required" });
            const result = await voiceAgent.speak(text, { rate, voice });
            res.json({ success: true, ...result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("voice"));

// ── Desktop ───────────────────────────────────────────────────────
router.get("/desktop/status",        desktopAgent ? (req, res) => { try { res.json({ success: true, ...desktopAgent.getStatus() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/open-app",     desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.openApp(req.body.app)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/type",         desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.typeText(req.body.text, req.body.speed)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/press-key",    desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.pressKey(req.body.key)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/press-combo",  desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.pressKeyCombo(req.body.modifiers, req.body.key)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/move-mouse",   desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.moveMouse(req.body.x, req.body.y)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/click",        desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.click(req.body.button)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));
router.post("/desktop/double-click", desktopAgent ? async (req, res) => { try { res.json(await desktopAgent.doubleClick(req.body.button)); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("desktop"));

// ── Agent Factory ─────────────────────────────────────────────────
router.get("/agents/status", (req, res) => {
    try {
        const mc      = _getMC();
        const factory = agentFactory ? agentFactory.listAgents() : { total: 0, agents: [] };
        const perf    = mc ? mc.agentStatus() : {};
        res.json({
            success:      true,
            factory_agents: { count: factory.total, agents: factory.agents },
            ...perf
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/agents/list",            agentFactory ? (req, res) => { try { const a = agentFactory.listAgents(); res.json({ success: true, total: a.total, agents: a.agents }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("agentFactory"));
router.get("/agents/suggestions",     agentFactory ? (req, res) => { try { res.json({ success: true, suggestions: agentFactory.suggestAgentCreation({ frequency: {} }) }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("agentFactory"));
router.get("/agents/top-50",          agentFactory ? (req, res) => { try { const list = agentFactory.listAgents(); res.json({ success: true, agents: (list.agents || []).slice(0, 50) }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("agentFactory"));

// Dynamic agent creation is disabled — Phase I minimization.
// Runtime must be controlled by the operator, not autonomous code generation.
router.post("/agents/dynamic/create", (req, res) =>
    res.status(410).json({ error: "Dynamic agent creation is disabled. Deploy agents via the codebase, not HTTP." })
);

router.post("/agents/delegate", agentFactory
    ? async (req, res) => {
        try {
            const { task } = req.body;
            if (!task) return res.status(400).json({ error: "task required" });
            const result = await agentFactory.executeAgent("auto", task);
            res.json({ success: true, result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("agentFactory"));

router.post("/agents/:agentName/execute", agentFactory
    ? async (req, res) => {
        try { res.json(await agentFactory.executeAgent(req.params.agentName, req.body.input)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("agentFactory"));

router.delete("/agents/:agentName", agentFactory
    ? (req, res) => { try { res.json(agentFactory.deleteAgent(req.params.agentName)); } catch (e) { res.status(500).json({ error: e.message }); } }
    : unavailable("agentFactory"));

// ── Observability endpoints (must be before /agents/:agentName wildcard) ──
const MC_PATH = require("path").join(__dirname, "../../agents/metrics/metricsCollector.cjs");
let _mc = null;
function _getMC() {
    if (!_mc) { try { _mc = require(MC_PATH); } catch { _mc = null; } }
    return _mc;
}

router.get("/agents/perf", (req, res) => {
    const mc = _getMC();
    if (!mc) return res.status(503).json({ error: "Metrics collector unavailable" });
    res.json({ success: true, ...mc.agentStatus() });
});

router.get("/agents/:agentName", agentFactory
    ? (req, res) => {
        try {
            const a = agentFactory.getAgent(req.params.agentName);
            if (!a.success) return res.status(404).json(a);
            res.json(a);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("agentFactory"));

// ── Evolution Engine ──────────────────────────────────────────────
router.get("/evolution/score",        evolutionEngine ? (req, res) => { try { res.json({ success: true, ...evolutionEngine.getOptimizationScore() }); } catch (e) { res.status(500).json({ error: e.message }); } } : evolutionFallback({ optimization_score: 0, score: 0 }));
router.get("/evolution/approvals",    evolutionEngine ? (req, res) => { try { const p = evolutionEngine.getPendingApprovals(); res.json({ success: true, pending: p, pending_count: p.length }); } catch (e) { res.status(500).json({ error: e.message }); } } : evolutionFallback({ pending: [], pending_count: 0 }));
router.post("/evolution/approve/:id", evolutionEngine ? async (req, res) => { try { res.json(await evolutionEngine.handleApproval(req.params.id, true)); } catch (e) { res.status(500).json({ error: e.message }); } } : evolutionFallback({}));
router.post("/evolution/reject/:id",  evolutionEngine ? (req, res) => { try { res.json(evolutionEngine.handleApproval(req.params.id, false)); } catch (e) { res.status(500).json({ error: e.message }); } } : evolutionFallback({}));
router.get("/evolution/suggestions",  evolutionEngine ? (req, res) => { try { res.json({ success: true, ...evolutionEngine.analyzeAndSuggest({ tasks: [], results: [], duration: 0 }) }); } catch (e) { res.status(500).json({ error: e.message }); } } : evolutionFallback({ suggestions: [] }));

// ── 500 Master Agent System ───────────────────────────────────────
async function initMasterAgentMgr() {
    if (masterAgentMgr?.initialized) return true;
    try {
        const Cls = tryRequire(ROOT + "agents/MasterAgentManager.cjs");
        if (!Cls) return false;
        masterAgentMgr = new Cls();
        await masterAgentMgr.initialize();
        return true;
    } catch { return false; }
}

router.get("/agents/500/initialize", async (req, res) => {
    if (masterAgentMgr?.initialized) return res.json({ success: true, status: "already_initialized" });
    const ok = await initMasterAgentMgr();
    res.json({ success: ok, message: ok ? "500-agent system ready" : "Initialization failed" });
});
router.get("/agents/500/status",    (req, res) => {
    if (!masterAgentMgr) return res.json({ status: "not_initialized", message: "Call GET /agents/500/initialize first" });
    try { res.json({ success: true, stats: masterAgentMgr.getSystemStatistics() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/agents/500/by-domain", (req, res) => {
    if (!masterAgentMgr) return res.status(503).json({ error: "not initialized" });
    try { res.json({ success: true, agents: masterAgentMgr.listAllAgents() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/agents/500/execute", async (req, res) => {
    if (!masterAgentMgr) return res.status(503).json({ error: "not initialized — call /agents/500/initialize first" });
    try {
        const { task, collaborative } = req.body;
        if (!task) return res.status(400).json({ error: "task required" });
        const result = collaborative
            ? await masterAgentMgr.executeTaskWithTeam(task, collaborative.numberOfAgents || 3)
            : await masterAgentMgr.routeTask(task);
        res.json({ success: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/agents/500/domain/:domain", async (req, res) => {
    if (!masterAgentMgr) return res.status(503).json({ error: "not initialized" });
    try { res.json({ success: true, result: await masterAgentMgr.routeTask(req.body.task, req.params.domain.toUpperCase()) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
// Continuous autonomous learning disabled — Phase I minimization.
router.post("/agents/500/start-learning", (req, res) =>
    res.status(410).json({ error: "Autonomous continuous learning is disabled." })
);
router.get("/agents/500/:agentName", (req, res) => {
    if (!masterAgentMgr) return res.status(503).json({ error: "not initialized" });
    const agent = masterAgentMgr.getAgent(req.params.agentName);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    try { res.json({ success: true, agent: { name: agent.name, domain: agent.domain, status: agent.getStatus(), capabilities: agent.getCapabilities() } }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auto-agent ────────────────────────────────────────────────────
router.post("/auto-agent/schedule", parseCommand
    ? async (req, res) => {
        try {
            const { command, delay = 5000 } = req.body;
            if (!command) return res.status(400).json({ error: "command required" });
            const parsed = parseCommand(command);
            const taskId = `auto_${Date.now()}`;
            setTimeout(async () => {
                const result = await executeCommand(parsed);
                commandHistory.addCommand(command, parsed, result);
            }, parseInt(delay));
            res.json({ success: true, taskId, delay });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("commandParser"));

router.post("/auto-agent/execute", parseCommand
    ? async (req, res) => {
        try {
            const { command } = req.body;
            if (!command) return res.status(400).json({ error: "command required" });
            const parsed = parseCommand(command);
            const result = await executeCommand(parsed);
            commandHistory.addCommand(command, parsed, result);
            res.json({ success: true, result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    : unavailable("commandParser"));

router.get("/auto-agent/status", (req, res) =>
    res.json({ success: true, status: "active", mode: "cron", scheduledTasks: getScheduledTasks ? getScheduledTasks().length : 0 })
);

// ── Workflows ─────────────────────────────────────────────────────
router.post("/workflow/create", (req, res) => {
    const { name, steps } = req.body;
    if (!name || !steps) return res.status(400).json({ error: "name and steps required" });
    workflows[name] = { name, steps, createdAt: new Date(), executions: 0 };
    res.json({ success: true, workflow: workflows[name] });
});
router.post("/workflow/execute", async (req, res) => {
    const wf = workflows[req.body.name];
    if (!wf) return res.status(404).json({ error: "Workflow not found" });
    if (!parseCommand) return res.status(503).json({ error: "commandParser unavailable" });
    const results = [];
    for (const step of wf.steps) {
        const parsed = parseCommand(step.command || step);
        results.push(await executeCommand(parsed));
    }
    wf.executions++;
    res.json({ success: true, name: req.body.name, results });
});
router.get("/workflow/list", (req, res) => res.json({ success: true, workflows: Object.values(workflows) }));

// ── Predict ───────────────────────────────────────────────────────
router.post("/predict/next-commands", (req, res) => res.json({ success: true, predictions: commandHistory.getSuggestions() }));

// ── Self-improve ──────────────────────────────────────────────────
router.get("/self-improve/analyze",    evolutionEngine ? (req, res) => { try { res.json({ success: true, score: evolutionEngine.getOptimizationScore() }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("evolution"));
router.get("/self-improve/evaluation", learningSystem  ? (req, res) => { try { res.json({ success: true, patterns: learningSystem.getPatterns(10) }); } catch (e) { res.status(500).json({ error: e.message }); } } : unavailable("learning"));

// ── Misc ──────────────────────────────────────────────────────────
router.post("/start-automation", (req, res) =>
    res.json({ success: true, message: "Automation loop is already running (cron-based)" })
);

router.get("/bulk", sendBulk
    ? async (req, res) => {
        await sendBulk("Limited offer! Join JARVIS AI now.").catch(() => {});
        res.json({ success: true });
    }
    : unavailable("bulkSender"));

// GET /queue/status — detailed autonomous queue state
router.get("/queue/status", (req, res) => {
    const mc = _getMC();
    if (!mc) return res.status(503).json({ error: "Metrics collector unavailable" });
    res.json({ success: true, ...mc.queueStatus() });
});

// ── Autonomous Task Queue ─────────────────────────────────────────
const ROOT_AGENTS = require("path").join(__dirname, "../../agents/");
const autonomousLoop = tryRequire(ROOT_AGENTS + "autonomousLoop.cjs");
const taskQueueMod   = tryRequire(ROOT_AGENTS + "taskQueue.cjs");

// GET /tasks — list all queued tasks
router.get("/tasks", (req, res) => {
    if (!taskQueueMod) return res.status(503).json({ error: "Task queue unavailable" });
    const tasks = taskQueueMod.getAll();
    res.json({ success: true, count: tasks.length, tasks });
});

// POST /tasks — add a task to the autonomous queue
// Body: { input, scheduledFor?, recurringCron?, type? }
router.post("/tasks", (req, res) => {
    if (!autonomousLoop) return res.status(503).json({ error: "Autonomous loop unavailable" });
    const { input, scheduledFor, recurringCron, type } = req.body || {};
    if (!input) return res.status(400).json({ error: "input is required" });
    const task = autonomousLoop.addTask({ input, scheduledFor, recurringCron, type });
    res.json({ success: true, task });
});

// DELETE /tasks/:id — cancel a task
router.delete("/tasks/:id", (req, res) => {
    if (!taskQueueMod) return res.status(503).json({ error: "Task queue unavailable" });
    const updated = taskQueueMod.update(req.params.id, { status: "cancelled" });
    if (!updated) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true, task: updated });
});

module.exports = router;
