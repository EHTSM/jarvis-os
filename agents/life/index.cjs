/**
 * Life OS Layer — registers all 20 life agents with agentManager.
 */

const agentManager = require("../multi/agentManager.cjs");

const LIFE_AGENTS = {
    healthTrackerAgent:      require("./healthTrackerAgent.cjs"),
    dietPlannerAgent:        require("./dietPlannerAgent.cjs"),
    workoutTrainerAgent:     require("./workoutTrainerAgent.cjs"),
    sleepAnalyzerAgent:      require("./sleepAnalyzerAgent.cjs"),
    meditationGuideAgent:    require("./meditationGuideAgent.cjs"),
    habitTrackerAgent:       require("./habitTrackerAgent.cjs"),
    goalTrackerAgent:        require("./goalTrackerAgent.cjs"),
    dailyPlannerAgent:       require("./dailyPlannerAgent.cjs"),
    timeOptimizerAgent:      require("./timeOptimizerAgent.cjs"),
    focusModeAgent:          require("./focusModeAgent.cjs"),
    financeManagerAgent:     require("./financeManagerAgent.cjs"),
    expenseAnalyzerAgent:    require("./expenseAnalyzerAgent.cjs"),
    investmentAdvisorAgent:  require("./investmentAdvisorAgent.cjs"),
    riskAnalyzerAgent:       require("./riskAnalyzerAgent.cjs"),
    travelPlannerAgent:      require("./travelPlannerAgent.cjs"),
    eventPlannerAgent:       require("./eventPlannerAgent.cjs"),
    smartReminderAgent:      require("./smartReminderAgent.cjs"),
    moodAnalyzerAgent:       require("./moodAnalyzerAgent.cjs"),
    relationshipAdvisorAgent:require("./relationshipAdvisorAgent.cjs"),
    lifeCoachAgent:          require("./lifeCoachAgent.cjs")
};

for (const [name, agent] of Object.entries(LIFE_AGENTS)) {
    if (!agentManager.has(name)) {
        agentManager.register(name, agent, { category: "life", autoRegistered: true });
    }
}

module.exports = LIFE_AGENTS;
