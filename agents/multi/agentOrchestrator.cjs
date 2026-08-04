/**
 * Agent Orchestrator — runs multi-step workflows across multiple agents.
 * Each step can pass output to the next step as input.
 */

const agentExecutor      = require("./agentExecutor.cjs");
const agentCommunication = require("./agentCommunication.cjs");
const performanceTracker = require("./performanceTracker.cjs");

/**
 * Run a sequential workflow.
 * steps: [{ agent: "codeGenerator", task: { type, payload } }]
 * Each step receives the previous step's result as `context.previousResult`.
 */
async function runWorkflow(workflowId, steps = []) {
    if (!steps.length) return { success: false, error: "No steps provided" };

    const ctx    = performanceTracker.start("orchestrator", workflowId);
    const results = [];
    let   prevResult = null;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const task = {
            ...step.task,
            payload: { ...(step.task?.payload || {}), previousResult: prevResult }
        };

        const result = await agentExecutor.run(step.agent, task);
        results.push({ step: i + 1, agent: step.agent, result });

        // Notify via message bus
        await agentCommunication.publish(`workflow:${workflowId}:step`, {
            step: i + 1, agent: step.agent, success: result.success
        }, "orchestrator");

        if (!result.success && step.stopOnFail !== false) {
            performanceTracker.finish(ctx, false);
            return { success: false, workflowId, stoppedAt: i + 1, results };
        }

        prevResult = result;
    }

    performanceTracker.finish(ctx, true);
    return { success: true, workflowId, totalSteps: steps.length, results, finalResult: prevResult };
}

// Run steps in parallel (no data passing between them)
async function runParallel(workflowId, steps = []) {
    const settled = await Promise.allSettled(
        steps.map(s => agentExecutor.run(s.agent, s.task))
    );
    return {
        success:    true,
        workflowId,
        results:    steps.map((s, i) => ({
            agent:  s.agent,
            result: settled[i].status === "fulfilled" ? settled[i].value : { success: false, error: settled[i].reason?.message }
        }))
    };
}

// Pre-built workflow: full dev project scaffold.
// Agent Civilization Unification (module 1/2): steps used to name agents
// ("codeGenerator", "versionControl", "deployment", "testRunner") that
// were never registered anywhere — this workflow could not have
// succeeded a single time it was called. Retargeted onto agent IDs
// actually present in the production agentRegistry: "dev" (generation,
// via agents/devAgent.cjs -> agents/dev/codeGeneratorAgent.cjs) and
// "terminal" (git ops, via agents/terminalAgent.cjs's whitelisted-command
// executor). No real, distinct "deployment" or "testRunner" agent exists
// in the registry today — see the unification report for the
// A-E classification of that gap.
async function devProjectWorkflow(projectName, description) {
    return runWorkflow(`dev-project-${Date.now()}`, [
        { agent: "dev",      task: { type: "dev",      payload: { framework: "express", description } } },
        { agent: "terminal", task: { type: "terminal", payload: { command: `git init ./generated/${projectName}` } } },
    ]);
}

module.exports = { runWorkflow, runParallel, devProjectWorkflow };
