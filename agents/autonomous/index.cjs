/**
 * Autonomous System Layer — registers all 20 autonomous agents with agentManager.
 */

const agentManager = require("../multi/agentManager.cjs");

const AUTONOMOUS_AGENTS = {
    autonomousCore:          require("./autonomousCore.cjs"),
    aiArmyManager:           require("./aiArmyManager.cjs"),
    selfBusinessAgent:       require("./selfBusinessAgent.cjs"),
    startupBuilderAgent:     require("./startupBuilderAgent.cjs"),
    productBuilderAgent:     require("./productBuilderAgent.cjs"),
    autoSaasCreator:         require("./autoSaasCreator.cjs"),
    marketLaunchAgent:       require("./marketLaunchAgent.cjs"),
    growthLoopEngine:        require("./growthLoopEngine.cjs"),
    feedbackAnalyzerPro:     require("./feedbackAnalyzerPro.cjs"),
    selfOptimizationEngine:  require("./selfOptimizationEngine.cjs"),
    aiDecisionMaker:         require("./aiDecisionMaker.cjs"),
    scenarioSimulator:       require("./scenarioSimulator.cjs"),
    riskPredictionEngine:    require("./riskPredictionEngine.cjs"),
    opportunityFinder:       require("./opportunityFinder.cjs"),
    innovationEngine:        require("./innovationEngine.cjs"),
    competitorAI:            require("./competitorAI.cjs"),
    globalExpansionAgent:    require("./globalExpansionAgent.cjs"),
    multiLanguageExpansion:  require("./multiLanguageExpansion.cjs"),
    selfLearningBrainV2:     require("./selfLearningBrainV2.cjs"),
    jarvisEvolutionCore:     require("./jarvisEvolutionCore.cjs")
};

for (const [name, agent] of Object.entries(AUTONOMOUS_AGENTS)) {
    if (!agentManager.has(name)) {
        agentManager.register(name, agent, { category: "autonomous", autoRegistered: true });
    }
}

module.exports = AUTONOMOUS_AGENTS;
