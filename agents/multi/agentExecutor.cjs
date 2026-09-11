/**
 * Agent Executor — looks up an agent in the real production agentRegistry
 * (agents/runtime/agentRegistry.cjs) and runs its registered handler.
 * Records performance via performanceTracker.
 *
 * Agent Civilization Unification (module 1/2): previously looked up
 * agentName in agentManager (agents/multi/'s private shadow registry,
 * zero consumers outside agents/multi/) and called entry.agent.run(task)
 * — a different call shape than the registry agentSelector.select() now
 * returns agent IDs from. Retargeted to agentRegistry.get(id).handler(task),
 * the same call shape agents/runtime/executionEngine.cjs uses for every
 * other dispatch path, so a task run through this module and one run
 * through the main runtime pipeline both go through the same circuit
 * breaker / concurrency slot bookkeeping on the same AgentRecord.
 */

const agentRegistry      = require("../runtime/agentRegistry.cjs");
const performanceTracker = require("./performanceTracker.cjs");

async function run(agentId, task) {
    const agent = agentRegistry.get(agentId);
    if (!agent) {
        return { success: false, error: `Agent "${agentId}" not found` };
    }
    if (!agent.isAvailable()) {
        return { success: false, error: `Agent "${agentId}" unavailable (circuit ${agent._cbState} or at concurrency limit)` };
    }

    const ctx = performanceTracker.start(agentId, task?.type || "unknown");
    agent.acquireSlot();
    let result;

    try {
        result = await agent.handler(task);
        agent.recordSuccess(Date.now() - ctx.startMs);
        performanceTracker.finish(ctx, true);
    } catch (err) {
        agent.recordFailure();
        performanceTracker.finish(ctx, false);
        result = { success: false, agent: agentId, error: err.message };
    }

    return result;
}

// Run the same task on multiple agents and return all results
async function runAll(agentNames, task) {
    const results = await Promise.allSettled(agentNames.map(n => run(n, task)));
    return agentNames.map((name, i) => ({
        agent:  name,
        result: results[i].status === "fulfilled" ? results[i].value : { success: false, error: results[i].reason?.message }
    }));
}

module.exports = { run, runAll };
