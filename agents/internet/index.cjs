/**
 * Internet Agents Registry — registers all internet/data-intelligence agents.
 * Import once (in executor.cjs) to activate the layer.
 */

const agentManager = require("../multi/agentManager.cjs");

const INTERNET_AGENTS = {
    webScraper:          require("./webScraperAgent.cjs"),
    browserAutomation:   require("./browserAutomationAgent.cjs"),
    apiFetcher:          require("./apiFetcherAgent.cjs"),
    newsAggregator:      require("./newsAggregatorAgent.cjs"),
    socialMedia:         require("./socialMediaAgent.cjs"),
    trendAnalyzer:       require("./trendAnalyzerAgent.cjs"),
    competitorTracker:   require("./competitorTrackerAgent.cjs"),
    marketIntelligence:  require("./marketIntelligenceAgent.cjs"),
    location:            require("./locationAgent.cjs"),
    weather:             require("./weatherAgent.cjs")
};

for (const [name, agent] of Object.entries(INTERNET_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "internet", autoRegistered: true });
        } catch (err) {
            console.error(`[internet/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = INTERNET_AGENTS;
