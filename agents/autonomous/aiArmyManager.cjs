/**
 * AI Army Manager — distributes tasks across agents with hard concurrency limits.
 * Max parallel tasks: 5. Never spawns uncontrolled execution.
 */

const { uid, NOW, logToMemory, ok, fail, MAX_TASKS_PER_CYCLE } = require("./_autoStore.cjs");

// Registry of available autonomous agents with their capabilities
const AGENT_REGISTRY = {
    opportunityFinder:      { capability: "opportunity",  priority: 1 },
    scenarioSimulator:      { capability: "simulation",   priority: 2 },
    riskPredictionEngine:   { capability: "risk",         priority: 2 },
    aiDecisionMaker:        { capability: "decision",     priority: 3 },
    selfBusinessAgent:      { capability: "business",     priority: 4 },
    startupBuilderAgent:    { capability: "startup",      priority: 4 },
    productBuilderAgent:    { capability: "product",      priority: 4 },
    autoSaasCreator:        { capability: "saas",         priority: 4 },
    marketLaunchAgent:      { capability: "marketing",    priority: 5 },
    growthLoopEngine:       { capability: "growth",       priority: 5 },
    feedbackAnalyzerPro:    { capability: "feedback",     priority: 6 },
    selfOptimizationEngine: { capability: "optimization", priority: 6 },
    innovationEngine:       { capability: "innovation",   priority: 4 },
    competitorAI:           { capability: "competitor",   priority: 3 },
    opportunityFinder:      { capability: "opportunity",  priority: 1 }
};

async function _executeTask(agentName, task, results) {
    const start = Date.now();
    try {
        // Lazy-load to avoid circular dependencies
        const agent  = require(`./${agentName}.cjs`);
        const result = agent.run ? await agent.run(task) : { success: false, error: "No run() method" };
        results.push({ agent: agentName, success: true, result, durationMs: Date.now() - start });
    } catch (err) {
        results.push({ agent: agentName, success: false, error: err.message, durationMs: Date.now() - start });
    }
}

async function assignTasks(taskList = [], context = {}) {
    if (!Array.isArray(taskList) || !taskList.length) {
        return fail("aiArmyManager", "taskList must be a non-empty array");
    }

    // Hard cap — never exceed MAX_TASKS_PER_CYCLE
    const capped = taskList.slice(0, MAX_TASKS_PER_CYCLE);
    if (taskList.length > MAX_TASKS_PER_CYCLE) {
        console.warn(`[aiArmyManager] Task list capped from ${taskList.length} to ${MAX_TASKS_PER_CYCLE} (safety limit)`);
    }

    const results    = [];
    const batchId    = uid("army");
    const startedAt  = NOW();

    // Execute all capped tasks in parallel — Promise.allSettled prevents one failure from killing others
    await Promise.allSettled(
        capped.map(t => _executeTask(t.agent, { type: t.type || "run", payload: t.payload || context }, results))
    );

    const succeeded = results.filter(r => r.success).length;
    const failed    = results.filter(r => !r.success).length;
    const summary   = {
        batchId,
        tasksAssigned: capped.length,
        tasksOmitted:  taskList.length - capped.length,
        succeeded,
        failed,
        maxAllowed:    MAX_TASKS_PER_CYCLE,
        results,
        startedAt,
        completedAt:   NOW()
    };

    logToMemory("aiArmyManager", `batch:${batchId}`, { succeeded, failed, total: capped.length });
    return ok("aiArmyManager", summary);
}

async function runSequential(taskList = [], context = {}) {
    const capped  = taskList.slice(0, MAX_TASKS_PER_CYCLE);
    const results = [];

    for (const t of capped) {
        await _executeTask(t.agent, { type: t.type || "run", payload: t.payload || context }, results);
    }

    return { success: true, results, total: capped.length };
}

function listAgents() {
    return Object.entries(AGENT_REGISTRY).map(([name, meta]) => ({ name, ...meta }));
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await assignTasks(p.tasks || [], p.context || {});
        return data;
    } catch (err) { return fail("aiArmyManager", err.message); }
}

module.exports = { assignTasks, runSequential, listAgents, MAX_TASKS_PER_CYCLE, run };
