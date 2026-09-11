/**
 * Business Agents — barrel export of the 10 business/*.cjs implementation
 * files, required by executor.cjs solely to confirm each file loads
 * cleanly (their real dependencies — agents/crm.cjs, agents/paymentAgent.cjs,
 * agents/core/groqClient.cjs — must resolve, or one broken require here
 * would otherwise surface as a confusing failure deeper in a task run).
 *
 * Agent Civilization Unification (module 2): this barrel used to ALSO
 * register each agent into agentManager (agents/multi/'s private shadow
 * registry) under camelCase names (businessPayment, businessCRM, ...).
 * That registration was a second, disconnected bookkeeping entry for the
 * exact same 10 files that agents/runtime/bootstrapRuntime.cjs
 * independently registers into the real, production agentRegistry under
 * different IDs (business_payment, business_crm_agent, ...) — confirmed
 * 1:1 file coverage, no capability lost by removing this side registry.
 * agentManager itself has had zero consumers since module 1 retargeted
 * agentSelector/agentExecutor onto agentRegistry, so this was pure
 * duplicate state with no reader. Dispatch for these agents goes through
 * agentRegistry exclusively now — see agents/runtime/bootstrapRuntime.cjs
 * for the live registration and agents/runtime/taskRouter.cjs for the
 * task-type -> capability -> agent resolution path.
 */

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

module.exports = BUSINESS_AGENTS;
