/**
 * Agent Executor — looks up an agent in agentManager and runs it.
 * Records performance via performanceTracker.
 */

const agentManager      = require("./agentManager.cjs");
const performanceTracker = require("./performanceTracker.cjs");

async function run(agentName, task) {
    const entry = agentManager.get(agentName);
    if (!entry) {
        return { success: false, error: `Agent "${agentName}" not found or inactive` };
    }

    const ctx = performanceTracker.start(agentName, task?.type || "unknown");
    let result;

    try {
        result = await entry.agent.run(task);
        agentManager.recordExec(agentName, true);
        performanceTracker.finish(ctx, true);
    } catch (err) {
        agentManager.recordExec(agentName, false);
        performanceTracker.finish(ctx, false);
        result = { success: false, agent: agentName, error: err.message };
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
