const agentRouter = require("./agentRouter.cjs");
const { createAgent } = require("./createAgent.cjs");

async function agentManager(task) {
    let result = agentRouter(task.type || task.name);

    if (!result) {
        console.log("⚠️ Creating agent:", task.name);
        await createAgent(task);
        result = agentRouter(task.type || task.name);
    }

    return result;
}

module.exports = { agentManager };
