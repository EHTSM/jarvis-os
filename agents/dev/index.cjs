/**
 * Dev Agents Registry — loads all dev agents and registers them in agentManager.
 * Import this file once (in executor or server) to activate the full dev layer.
 */

const agentManager = require("../multi/agentManager.cjs");

const DEV_AGENTS = {
    codeGenerator:  require("./codeGeneratorAgent.cjs"),
    debugger:       require("./debugAgent.cjs"),
    apiBuilder:     require("./apiBuilderAgent.cjs"),
    database:       require("./databaseAgent.cjs"),
    firebase:       require("./firebaseAgent.cjs"),
    deployment:     require("./deploymentAgent.cjs"),
    versionControl: require("./versionControlAgent.cjs"),
    testRunner:     require("./testAgent.cjs"),
    optimizer:      require("./optimizationAgent.cjs"),
    security:       require("./securityAgent.cjs")
};

// Register every dev agent (idempotent — skip if already registered)
for (const [name, agent] of Object.entries(DEV_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "dev", autoRegistered: true });
        } catch (err) {
            console.error(`[dev/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = DEV_AGENTS;
