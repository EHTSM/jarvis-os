/**
 * Social layer registry — registers all 19 social agents with agentManager.
 */

const agentManager = require("../multi/agentManager.cjs");

const SOCIAL_AGENTS = {
    instagramGrowth:     require("./instagramGrowthAgent.cjs"),
    autoPosting:         require("./autoPostingAgent.cjs"),
    dmAutomation:        require("./dmAutomationAgent.cjs"),
    commentReply:        require("./commentReplyAgent.cjs"),
    viralDetector:       require("./viralContentDetector.cjs"),
    influencerFinder:    require("./influencerFinderAgent.cjs"),
    socialAnalytics:     require("./socialAnalyticsAgent.cjs"),
    trendRiding:         require("./trendRidingAgent.cjs"),
    memeGenerator:       require("./memeGeneratorAgent.cjs"),
    xGrowth:             require("./xGrowthAgent.cjs"),
    linkedinGrowth:      require("./linkedinGrowthAgent.cjs"),
    youtubeSEO:          require("./youtubeSEOAgent.cjs"),
    videoOptimization:   require("./videoOptimizationAgent.cjs"),
    audienceTargeting:   require("./audienceTargetingAgent.cjs"),
    engagementBooster:   require("./engagementBoosterAgent.cjs"),
    socialSchedulerPro:  require("./socialSchedulerPro.cjs"),
    contentRepurposing:  require("./contentRepurposingAgent.cjs"),
    brandVoice:          require("./brandVoiceManager.cjs"),
    reputationManager:   require("./reputationManager.cjs")
};

for (const [name, agent] of Object.entries(SOCIAL_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "social", autoRegistered: true });
        } catch (err) {
            console.error(`[social/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = SOCIAL_AGENTS;
