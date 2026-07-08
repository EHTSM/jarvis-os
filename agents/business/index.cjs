/**
 * Business Agents Registry — auto-registers all business agents into agentManager.
 * Import this once (in executor.cjs) to activate the entire business layer.
 */

const agentManager = require("../multi/agentManager.cjs");

const BUSINESS_AGENTS = {
    businessPayment:      require("./paymentAgent.cjs"),
    businessSubscription: require("./subscriptionAgent.cjs"),
    businessRevenue:      require("./revenueAgent.cjs"),
    businessCRM:          require("./crmAgent.cjs"),
    businessMarketing:    require("./marketingAgent.cjs"),
    businessSEO:          require("./seoAgent.cjs"),
    businessContent:      require("./contentAgent.cjs"),
    businessAnalytics:    require("./analyticsAgent.cjs"),
    businessGrowth:       require("./growthAgent.cjs"),
    businessSupport:      require("./supportAgent.cjs")
};

for (const [name, agent] of Object.entries(BUSINESS_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "business", autoRegistered: true });
        } catch (err) {
            console.error(`[business/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = BUSINESS_AGENTS;
