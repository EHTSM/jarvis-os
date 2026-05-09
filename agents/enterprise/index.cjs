/**
 * Enterprise SaaS Platform Layer — registers all 39 enterprise agents with agentManager.
 */

const agentManager = require("../multi/agentManager.cjs");

const ENTERPRISE_AGENTS = {
    // Core platform infrastructure
    multiTenantManager:        require("./multiTenantManager.cjs"),
    roleManager:               require("./roleManager.cjs"),
    auditLoggerPro:            require("./auditLoggerPro.cjs"),
    tenantSecurityAgent:       require("./tenantSecurityAgent.cjs"),
    apiGatewayPro:             require("./apiGatewayPro.cjs"),
    rateLimiter:               require("./rateLimiter.cjs"),
    saasBillingEngine:         require("./saasBillingEngine.cjs"),
    usageMeteringAgent:        require("./usageMeteringAgent.cjs"),

    // Organization & people
    organizationManager:       require("./organizationManager.cjs"),
    hrManagementAgent:         require("./hrManagementAgent.cjs"),
    payrollAgent:              require("./payrollAgent.cjs"),
    attendanceTracker:         require("./attendanceTracker.cjs"),
    recruitmentAgent:          require("./recruitmentAgent.cjs"),
    employeePerformanceAgent:  require("./employeePerformanceAgent.cjs"),
    trainingSystemAgent:       require("./trainingSystemAgent.cjs"),

    // Strategy & reporting
    kpiTracker:                require("./kpiTracker.cjs"),
    okrManager:                require("./okrManager.cjs"),
    boardReportingAgent:       require("./boardReportingAgent.cjs"),
    enterpriseDashboard:       require("./enterpriseDashboard.cjs"),

    // Collaboration & communication
    teamCollaborationAgent:    require("./teamCollaborationAgent.cjs"),
    chatSystemAgent:           require("./chatSystemAgent.cjs"),
    fileSharingAgent:          require("./fileSharingAgent.cjs"),
    documentCollaborationAgent: require("./documentCollaborationAgent.cjs"),
    approvalWorkflowAgent:     require("./approvalWorkflowAgent.cjs"),

    // Legal & compliance
    complianceManager:         require("./complianceManager.cjs"),
    legalComplianceAgent:      require("./legalComplianceAgent.cjs"),
    contractManager:           require("./contractManager.cjs"),
    digitalSignatureAgent:     require("./digitalSignatureAgent.cjs"),

    // Infrastructure & reliability
    loadBalancerAgent:         require("./loadBalancerAgent.cjs"),
    cloudCostOptimizer:        require("./cloudCostOptimizer.cjs"),
    enterpriseBackupSystem:    require("./enterpriseBackupSystem.cjs"),
    disasterRecoveryAgent:     require("./disasterRecoveryAgent.cjs"),
    slaMonitor:                require("./slaMonitor.cjs"),

    // Branding & customization
    whiteLabelSystem:          require("./whiteLabelSystem.cjs"),
    customBrandingAgent:       require("./customBrandingAgent.cjs"),
    adminPanelGenerator:       require("./adminPanelGenerator.cjs"),

    // Support & knowledge
    enterpriseSupportBot:      require("./enterpriseSupportBot.cjs"),
    ticketRoutingAgent:        require("./ticketRoutingAgent.cjs"),
    knowledgePortalAgent:      require("./knowledgePortalAgent.cjs")
};

for (const [name, agent] of Object.entries(ENTERPRISE_AGENTS)) {
    if (!agentManager.has(name)) {
        agentManager.register(name, agent, { category: "enterprise", autoRegistered: true });
    }
}

module.exports = ENTERPRISE_AGENTS;
