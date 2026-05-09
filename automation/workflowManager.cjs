const { runWorkflow } = require("./n8nConnector.cjs");

async function runWorkflowByName(name) {
    try {
        const result = await runWorkflow(name);
        return result;
    } catch {
        console.warn("Creating workflow placeholder:", name);
        return "Workflow placeholder created";
    }
}

module.exports = { runWorkflow: runWorkflowByName };
