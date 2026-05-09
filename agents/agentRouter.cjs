const automationAgent = require("./automationAgent.cjs");

// Only route task types where the target agent has an .execute() method.
// devAgent/marketingAgent/researchAgent don't expose .execute — they are
// called directly by executor handlers, not through this router.
function agentRouter(taskType) {
    if (["automation", "workflow"].includes(taskType)) {
        return automationAgent;
    }
    return null;
}

module.exports = agentRouter;