/**
 * BusinessPro registry — registers all 21 business-pro agents with agentManager.
 */

const agentManager = require("../multi/agentManager.cjs");

const BP_AGENTS = {
    leadQualificationAgent:  require("./leadQualificationAgent.cjs"),
    salesAgentPro:           require("./salesAgentPro.cjs"),
    funnelBuilderAgent:      require("./funnelBuilderAgent.cjs"),
    upsellAgent:             require("./upsellAgent.cjs"),
    crossSellAgent:          require("./crossSellAgent.cjs"),
    pricingOptimizer:        require("./pricingOptimizer.cjs"),
    adCopyAgent:             require("./adCopyAgent.cjs"),
    adCampaignMonitor:       require("./adCampaignMonitor.cjs"),
    retargetingEngine:       require("./retargetingEngine.cjs"),
    emailAutomationPro:      require("./emailAutomationPro.cjs"),
    whatsappBotPro:          require("./whatsappBotPro.cjs"),
    ecommerceManager:        require("./ecommerceManager.cjs"),
    productListingAgent:     require("./productListingAgent.cjs"),
    productDescriptionAgent: require("./productDescriptionAgent.cjs"),
    inventoryForecastAgent:  require("./inventoryForecastAgent.cjs"),
    orderAutomationAgent:    require("./orderAutomationAgent.cjs"),
    supplierFinderAgent:     require("./supplierFinderAgent.cjs"),
    dropshippingAgent:       require("./dropshippingAgent.cjs"),
    affiliateAgent:          require("./affiliateAgent.cjs"),
    commissionOptimizer:     require("./commissionOptimizer.cjs"),
    profitForecastAgent:     require("./profitForecastAgent.cjs")
};

for (const [name, agent] of Object.entries(BP_AGENTS)) {
    if (!agentManager.has(name)) {
        try {
            agentManager.register(name, agent, { category: "businessPro", autoRegistered: true });
        } catch (err) {
            console.error(`[businessPro/index] Failed to register ${name}:`, err.message);
        }
    }
}

module.exports = BP_AGENTS;
