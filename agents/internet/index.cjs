/**
 * Internet Agents — barrel export of the 10 internet/*.cjs implementation
 * files. Required by executor.cjs solely to confirm each file loads cleanly.
 *
 * Agent Civilization Unification (module 2): this barrel used to ALSO
 * register each agent into agentManager (agents/multi/'s private shadow
 * registry) under camelCase names (webScraper, trendAnalyzer, ...).
 * agents/runtime/bootstrapRuntime.cjs independently registers the same
 * 10 files into the real, production agentRegistry under different IDs
 * (internet_web_scraper, internet_trend_analyzer, ...) — confirmed 1:1
 * file coverage. agentManager had zero consumers after module 1, so this
 * was pure duplicate state with no reader. See agents/business/index.cjs
 * for the full rationale (identical pattern, applied consistently here).
 */

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

module.exports = INTERNET_AGENTS;
