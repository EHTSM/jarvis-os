const devAgent = require("./devAgent.cjs");
const marketingAgent = require("./marketingAgent.cjs");
const automationAgent = require("./automationAgent.cjs");
const researchAgent = require("./researchAgent.cjs");

function agentRouter(taskType) {

    if (["code", "build", "fix_bug"].includes(taskType)) {
        return devAgent;
    }

    if (["post", "content", "instagram", "whatsapp"].includes(taskType)) {
        return marketingAgent;
    }

    if (["automation", "workflow"].includes(taskType)) {
        return automationAgent;
    }

    if (["research", "analyze"].includes(taskType)) {
        return researchAgent;
    }

    return null;
}

module.exports = agentRouter;