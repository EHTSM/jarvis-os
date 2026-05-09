/**
 * Executor Agent — routes tasks through the automation + multi-agent pipeline.
 *
 * Flow:
 *   input → agentRouter (dynamic) → automationEngine → toolSelector
 *         → IF dev/multi task → agentSelector → agentExecutor → performanceTracker
 *         → ELSE → existing tool handlers
 *
 * Errors → errorHandler  |  Logs → logManager
 */

const agentRouter       = require("./agentRouter.cjs");
const { toolAgent }     = require("./tool.cjs");
const VoiceAgent        = require("./voiceAgent.cjs");
const { DesktopAgent }  = require("./desktopAgent.cjs");
const { AgentFactory }  = require("./agentFactory.cjs");

const voiceAgent    = new VoiceAgent();
const desktopAgent  = new DesktopAgent();
const agentFactory  = new AgentFactory();

// ── Automation Layer ─────────────────────────────────────────────
const automationEngine   = require("./automation/automationEngine.cjs");
const logManager         = require("./automation/logManager.cjs");
const errorHandler       = require("./automation/errorHandler.cjs");
const systemMonitor      = require("./automation/systemMonitor.cjs");

// ── Multi-Agent Layer ────────────────────────────────────────────
const agentSelector      = require("./multi/agentSelector.cjs");
const agentExecutorMod   = require("./multi/agentExecutor.cjs");
const performanceTracker = require("./multi/performanceTracker.cjs");
const agentOrchestrator  = require("./multi/agentOrchestrator.cjs");
const systemHealth       = require("./system/systemHealth.cjs");

// ── Boot: register all agent layers ──────────────────────────────
require("./dev/index.cjs");            // dev layer          — idempotent
require("./business/index.cjs");       // business layer     — idempotent
require("./internet/index.cjs");       // internet layer     — idempotent
require("./content/index.cjs");        // content layer      — idempotent
require("./businessPro/index.cjs");    // businessPro layer  — idempotent
require("./social/index.cjs");         // social layer       — idempotent
require("./education/index.cjs");      // education layer    — idempotent
require("./life/index.cjs");           // life OS layer      — idempotent
require("./autonomous/index.cjs");    // autonomous layer   — idempotent
require("./enterprise/index.cjs");   // enterprise layer   — idempotent

// ── Tool Handlers — preserve every original response shape ──────
function _buildHandlers() {
    return {

        browser: async (task) => {
            const toolResult = await toolAgent(task);
            return { type: task.type, result: toolResult.message, url: toolResult.url };
        },

        voice: async (task) => {
            const text        = task.payload?.text || "Speaking";
            const voiceResult = await voiceAgent.speak(text);
            return {
                type:    "speak",
                result:  voiceResult.success ? `Spoken: "${text.slice(0, 50)}"` : `Voice error: ${voiceResult.error}`,
                success: voiceResult.success,
                message: voiceResult.message
            };
        },

        desktop: async (task) => {
            if (task.type === "open_app") {
                const appName      = task.payload?.app || "Unknown";
                const desktopResult = await desktopAgent.openApp(appName);
                return {
                    type:    "open_app",
                    result:  desktopResult.success ? `Opened: ${appName}` : `Failed to open: ${appName}`,
                    success: desktopResult.success,
                    app:     appName,
                    error:   desktopResult.error
                };
            }
            if (task.type === "type_text") {
                const text         = task.payload?.text || "";
                const speed        = task.payload?.speed || 50;
                const desktopResult = await desktopAgent.typeText(text, speed);
                return {
                    type:        "type_text",
                    result:      desktopResult.success ? `Typed: ${text.slice(0, 50)}` : `Type error: ${desktopResult.error}`,
                    success:     desktopResult.success,
                    typed_chars: desktopResult.typed_chars || 0,
                    error:       desktopResult.error
                };
            }
            if (task.type === "press_key") {
                const key          = task.payload?.key || "enter";
                const desktopResult = await desktopAgent.pressKey(key);
                return {
                    type:    "press_key",
                    result:  desktopResult.success ? `Pressed: ${key}` : `Key press error: ${desktopResult.error}`,
                    success: desktopResult.success,
                    key,
                    error:   desktopResult.error
                };
            }
            return { success: false, error: "Unknown desktop task type" };
        },

        scheduler: async (task) => ({
            type:          "trigger",
            result:        "Task scheduled",
            trigger_type:  task.trigger_type,
            original_type: task.type,
            action:        task.action,
            delay_ms:      task.delay_ms,
            cron_time:     task.cron_time,
            time:          task.time,
            is_recurring:  task.is_recurring,
            payload:       task.payload
        }),

        ai: async () => null,

        system: async (task) => {
            if (task.type === "time") {
                return { type: "time", result: `Current time is: ${new Date().toLocaleTimeString()} ⏰` };
            }
            if (task.type === "date") {
                return { type: "date", result: `Today's date is: ${new Date().toLocaleDateString()} 📅` };
            }
            if (task.type === "clear_memory") {
                return { type: "clear_memory", result: "clear_memory" };
            }
            return { type: task.type, result: "System task acknowledged" };
        },

        agent_factory: async (task) => {
            if (task.type === "list_agents") {
                const agentList   = agentFactory.listAgents();
                const agentSummary = agentList.agents.length === 0
                    ? "No agents created yet"
                    : agentList.agents.map(a => `• ${a.name} (${a.type})`).join("\n");
                return {
                    type:    "list_agents",
                    result:  `📦 Total Agents: ${agentList.total}\n${agentSummary}`,
                    success: true,
                    agents:  agentList.agents,
                    total:   agentList.total
                };
            }

            if (task.type === "execute_agent") {
                const agentName      = task.payload?.agent || "";
                const input          = task.payload?.input || task.payload;
                const executionResult = await agentFactory.executeAgent(agentName, input);
                return {
                    type:    "execute_agent",
                    result:  executionResult.success
                        ? `✅ Agent "${agentName}" executed: ${JSON.stringify(executionResult.result).slice(0, 100)}`
                        : `❌ Failed to execute agent: ${executionResult.error}`,
                    success: executionResult.success,
                    agent:   agentName,
                    output:  executionResult.result,
                    error:   executionResult.error
                };
            }

            if (task.type === "create_agent") {
                const specification = task.payload?.specification || "";
                const nameMatch     = specification.match(/(?:called?|named?|for)\s+(\w+)/i);
                const agentName     = nameMatch ? nameMatch[1].toLowerCase() : `agent_${Date.now()}`;

                let agentType = "processor";
                if (specification.includes("api") || specification.includes("fetch") || specification.includes("http")) {
                    agentType = "api";
                } else if (specification.includes("schedule") || specification.includes("daily") || specification.includes("recurring")) {
                    agentType = "scheduler";
                } else if (specification.includes("analyze") || specification.includes("analysis")) {
                    agentType = "analyzer";
                }

                const spec           = { description: specification, config: { specification }, inputType: "string", outputType: "object" };
                const creationResult = await agentFactory.createAgent(agentName, agentType, spec);
                return {
                    type:       "create_agent",
                    result:     creationResult.success
                        ? `✨ Created agent "${creationResult.agent}" (${creationResult.type})`
                        : `❌ Failed to create agent: ${creationResult.error}`,
                    success:    creationResult.success,
                    agent:      creationResult.agent,
                    agent_type: creationResult.type,
                    error:      creationResult.error
                };
            }

            return { success: false, error: "Unknown agent_factory task type" };
        },

        automation: async (task) => {
            const automationAgent = require("./automationAgent.cjs");
            return automationAgent.execute(task);
        },

        leads: async () => {
            const { RealLeadsEngine } = require("./realLeadsEngine.cjs");
            const engine = new RealLeadsEngine();
            const leads  = await engine.getLeads();
            return { type: "leads", result: leads };
        },

        // ── Content / Creator agents ─────────────────────────────
        scriptWriter:     async (task) => agentExecutorMod.run("scriptWriter",     task),
        captionGenerator: async (task) => agentExecutorMod.run("captionGenerator", task),
        hashtagGenerator: async (task) => agentExecutorMod.run("hashtagGenerator", task),
        thumbnail:        async (task) => agentExecutorMod.run("thumbnail",        task),
        imageGenerator:   async (task) => agentExecutorMod.run("imageGenerator",   task),
        videoGenerator:   async (task) => agentExecutorMod.run("videoGenerator",   task),
        reelGenerator:    async (task) => agentExecutorMod.run("reelGenerator",    task),
        podcastGenerator: async (task) => agentExecutorMod.run("podcastGenerator", task),
        voiceCloning:     async (task) => agentExecutorMod.run("voiceCloning",     task),
        contentScheduler: async (task) => agentExecutorMod.run("contentScheduler", task),

        // ── Internet agents — route through multi-agent executor ──
        webScraper:         async (task) => agentExecutorMod.run("webScraper",         task),
        browserAutomation:  async (task) => agentExecutorMod.run("browserAutomation",  task),
        apiFetcher:         async (task) => agentExecutorMod.run("apiFetcher",         task),
        newsAggregator:     async (task) => agentExecutorMod.run("newsAggregator",     task),
        socialMedia:        async (task) => agentExecutorMod.run("socialMedia",        task),
        trendAnalyzer:      async (task) => agentExecutorMod.run("trendAnalyzer",      task),
        competitorTracker:  async (task) => agentExecutorMod.run("competitorTracker",  task),
        marketIntelligence: async (task) => agentExecutorMod.run("marketIntelligence", task),
        location:           async (task) => agentExecutorMod.run("location",           task),
        weather:            async (task) => agentExecutorMod.run("weather",            task),

        // ── Education & Learning Layer ───────────────────────────────
        courseGenerator:   async (task) => agentExecutorMod.run("courseGenerator",   task),
        lessonPlanner:     async (task) => agentExecutorMod.run("lessonPlanner",     task),
        quizGenerator:     async (task) => agentExecutorMod.run("quizGenerator",     task),
        examSimulator:     async (task) => agentExecutorMod.run("examSimulator",     task),
        doubtSolver:       async (task) => agentExecutorMod.run("doubtSolver",       task),
        notesGenerator:    async (task) => agentExecutorMod.run("notesGenerator",    task),
        flashcard:         async (task) => agentExecutorMod.run("flashcard",         task),
        skillTracker:      async (task) => agentExecutorMod.run("skillTracker",      task),
        certification:     async (task) => agentExecutorMod.run("certification",     task),
        learningPath:      async (task) => agentExecutorMod.run("learningPath",      task),
        languageTutor:     async (task) => agentExecutorMod.run("languageTutor",     task),
        codingTutor:       async (task) => agentExecutorMod.run("codingTutor",       task),
        careerAdvisor:     async (task) => agentExecutorMod.run("careerAdvisor",     task),
        resumeBuilder:     async (task) => agentExecutorMod.run("resumeBuilder",     task),
        interviewCoach:    async (task) => agentExecutorMod.run("interviewCoach",    task),
        knowledgeTester:   async (task) => agentExecutorMod.run("knowledgeTester",   task),
        bookSummary:       async (task) => agentExecutorMod.run("bookSummary",       task),
        researchAssistant: async (task) => agentExecutorMod.run("researchAssistant", task),
        academicWriter:    async (task) => agentExecutorMod.run("academicWriter",    task),
        knowledgeGraph:    async (task) => agentExecutorMod.run("knowledgeGraph",    task),

        // ── Social Media Domination Layer ───────────────────────────
        instagramGrowth:    async (task) => agentExecutorMod.run("instagramGrowth",    task),
        autoPosting:        async (task) => agentExecutorMod.run("autoPosting",        task),
        dmAutomation:       async (task) => agentExecutorMod.run("dmAutomation",       task),
        commentReply:       async (task) => agentExecutorMod.run("commentReply",       task),
        viralDetector:      async (task) => agentExecutorMod.run("viralDetector",      task),
        influencerFinder:   async (task) => agentExecutorMod.run("influencerFinder",   task),
        socialAnalytics:    async (task) => agentExecutorMod.run("socialAnalytics",    task),
        trendRiding:        async (task) => agentExecutorMod.run("trendRiding",        task),
        memeGenerator:      async (task) => agentExecutorMod.run("memeGenerator",      task),
        xGrowth:            async (task) => agentExecutorMod.run("xGrowth",            task),
        linkedinGrowth:     async (task) => agentExecutorMod.run("linkedinGrowth",     task),
        youtubeSEO:         async (task) => agentExecutorMod.run("youtubeSEO",         task),
        videoOptimization:  async (task) => agentExecutorMod.run("videoOptimization",  task),
        audienceTargeting:  async (task) => agentExecutorMod.run("audienceTargeting",  task),
        engagementBooster:  async (task) => agentExecutorMod.run("engagementBooster",  task),
        socialSchedulerPro: async (task) => agentExecutorMod.run("socialSchedulerPro", task),
        contentRepurposing: async (task) => agentExecutorMod.run("contentRepurposing", task),
        brandVoice:         async (task) => agentExecutorMod.run("brandVoice",         task),
        reputationManager:  async (task) => agentExecutorMod.run("reputationManager",  task),

        // ── Autonomous System Layer ──────────────────────────────────
        autonomous:           async (task) => {
            const autonomousCore = require("./autonomous/autonomousCore.cjs");
            return autonomousCore.runTask(task);
        },
        autonomousCore:          async (task) => agentExecutorMod.run("autonomousCore",         task),
        aiArmyManager:           async (task) => agentExecutorMod.run("aiArmyManager",          task),
        selfBusiness:            async (task) => agentExecutorMod.run("selfBusinessAgent",      task),
        startupBuilder:          async (task) => agentExecutorMod.run("startupBuilderAgent",    task),
        productBuilder:          async (task) => agentExecutorMod.run("productBuilderAgent",    task),
        autoSaas:                async (task) => agentExecutorMod.run("autoSaasCreator",        task),
        marketLaunch:            async (task) => agentExecutorMod.run("marketLaunchAgent",      task),
        growthLoop:              async (task) => agentExecutorMod.run("growthLoopEngine",       task),
        feedbackAnalyzer:        async (task) => agentExecutorMod.run("feedbackAnalyzerPro",    task),
        selfOptimization:        async (task) => agentExecutorMod.run("selfOptimizationEngine", task),
        aiDecision:              async (task) => agentExecutorMod.run("aiDecisionMaker",        task),
        scenarioSim:             async (task) => agentExecutorMod.run("scenarioSimulator",      task),
        riskPredict:             async (task) => agentExecutorMod.run("riskPredictionEngine",   task),
        opportunityFind:         async (task) => agentExecutorMod.run("opportunityFinder",      task),
        innovation:              async (task) => agentExecutorMod.run("innovationEngine",       task),
        competitorAnalysis:      async (task) => agentExecutorMod.run("competitorAI",           task),
        globalExpansion:         async (task) => agentExecutorMod.run("globalExpansionAgent",   task),
        multiLang:               async (task) => agentExecutorMod.run("multiLanguageExpansion", task),
        selfLearning:            async (task) => agentExecutorMod.run("selfLearningBrainV2",    task),
        jarvisEvolution:         async (task) => agentExecutorMod.run("jarvisEvolutionCore",    task),

        // ── Personal Life OS Layer ───────────────────────────────────
        healthTracker:       async (task) => agentExecutorMod.run("healthTrackerAgent",       task),
        dietPlanner:         async (task) => agentExecutorMod.run("dietPlannerAgent",         task),
        workoutTrainer:      async (task) => agentExecutorMod.run("workoutTrainerAgent",      task),
        sleepAnalyzer:       async (task) => agentExecutorMod.run("sleepAnalyzerAgent",       task),
        meditationGuide:     async (task) => agentExecutorMod.run("meditationGuideAgent",     task),
        habitTracker:        async (task) => agentExecutorMod.run("habitTrackerAgent",        task),
        goalTracker:         async (task) => agentExecutorMod.run("goalTrackerAgent",         task),
        dailyPlanner:        async (task) => agentExecutorMod.run("dailyPlannerAgent",        task),
        timeOptimizer:       async (task) => agentExecutorMod.run("timeOptimizerAgent",       task),
        focusMode:           async (task) => agentExecutorMod.run("focusModeAgent",           task),
        financeManager:      async (task) => agentExecutorMod.run("financeManagerAgent",      task),
        expenseAnalyzer:     async (task) => agentExecutorMod.run("expenseAnalyzerAgent",     task),
        investmentAdvisor:   async (task) => agentExecutorMod.run("investmentAdvisorAgent",   task),
        riskAnalyzer:        async (task) => agentExecutorMod.run("riskAnalyzerAgent",        task),
        travelPlanner:       async (task) => agentExecutorMod.run("travelPlannerAgent",       task),
        eventPlanner:        async (task) => agentExecutorMod.run("eventPlannerAgent",        task),
        smartReminder:       async (task) => agentExecutorMod.run("smartReminderAgent",       task),
        moodAnalyzer:        async (task) => agentExecutorMod.run("moodAnalyzerAgent",        task),
        relationshipAdvisor: async (task) => agentExecutorMod.run("relationshipAdvisorAgent", task),
        lifeCoach:           async (task) => agentExecutorMod.run("lifeCoachAgent",           task),

        // ── BusinessPro agents — advanced business & money engine ──
        leadQualification:       async (task) => agentExecutorMod.run("leadQualificationAgent",  task),
        salesPro:                async (task) => agentExecutorMod.run("salesAgentPro",           task),
        funnelBuilder:           async (task) => agentExecutorMod.run("funnelBuilderAgent",      task),
        upsell:                  async (task) => agentExecutorMod.run("upsellAgent",             task),
        crossSell:               async (task) => agentExecutorMod.run("crossSellAgent",          task),
        pricingOptimizer:        async (task) => agentExecutorMod.run("pricingOptimizer",        task),
        adCopy:                  async (task) => agentExecutorMod.run("adCopyAgent",             task),
        adCampaign:              async (task) => agentExecutorMod.run("adCampaignMonitor",       task),
        retargeting:             async (task) => agentExecutorMod.run("retargetingEngine",       task),
        emailAutomation:         async (task) => agentExecutorMod.run("emailAutomationPro",      task),
        whatsappBot:             async (task) => agentExecutorMod.run("whatsappBotPro",          task),
        ecommerce:               async (task) => agentExecutorMod.run("ecommerceManager",        task),
        productListing:          async (task) => agentExecutorMod.run("productListingAgent",     task),
        productDescription:      async (task) => agentExecutorMod.run("productDescriptionAgent", task),
        inventoryForecast:       async (task) => agentExecutorMod.run("inventoryForecastAgent",  task),
        orderAutomation:         async (task) => agentExecutorMod.run("orderAutomationAgent",    task),
        supplierFinder:          async (task) => agentExecutorMod.run("supplierFinderAgent",     task),
        dropshipping:            async (task) => agentExecutorMod.run("dropshippingAgent",       task),
        affiliate:               async (task) => agentExecutorMod.run("affiliateAgent",          task),
        commissionOptimizer:     async (task) => agentExecutorMod.run("commissionOptimizer",     task),
        profitForecast:          async (task) => agentExecutorMod.run("profitForecastAgent",     task),

        // ── Business agents — route through multi-agent executor ──
        businessPayment:      async (task) => agentExecutorMod.run("businessPayment",      task),
        businessSubscription: async (task) => agentExecutorMod.run("businessSubscription", task),
        businessRevenue:      async (task) => agentExecutorMod.run("businessRevenue",      task),
        businessCRM:          async (task) => agentExecutorMod.run("businessCRM",          task),
        businessMarketing:    async (task) => agentExecutorMod.run("businessMarketing",    task),
        businessSEO:          async (task) => agentExecutorMod.run("businessSEO",          task),
        businessContent:      async (task) => agentExecutorMod.run("businessContent",      task),
        businessAnalytics:    async (task) => agentExecutorMod.run("businessAnalytics",    task),
        businessGrowth:       async (task) => agentExecutorMod.run("businessGrowth",       task),
        businessSupport:      async (task) => agentExecutorMod.run("businessSupport",      task),

        // ── Dev agents — route through multi-agent executor ─────
        codeGenerator:  async (task) => agentExecutorMod.run("codeGenerator",  task),
        debugger:       async (task) => agentExecutorMod.run("debugger",       task),
        apiBuilder:     async (task) => agentExecutorMod.run("apiBuilder",     task),
        database:       async (task) => agentExecutorMod.run("database",       task),
        firebase:       async (task) => agentExecutorMod.run("firebase",       task),
        deployment:     async (task) => agentExecutorMod.run("deployment",     task),
        versionControl: async (task) => agentExecutorMod.run("versionControl", task),
        testRunner:     async (task) => agentExecutorMod.run("testRunner",     task),
        optimizer:      async (task) => agentExecutorMod.run("optimizer",      task),
        security:       async (task) => agentExecutorMod.run("security",       task),

        // ── Multi-agent orchestration ────────────────────────────
        orchestrator:   async (task) => {
            const { steps, workflowId, parallel } = task.payload || {};
            if (!steps?.length) return { success: false, error: "steps[] required in payload" };
            return parallel
                ? agentOrchestrator.runParallel(workflowId || "workflow", steps)
                : agentOrchestrator.runWorkflow(workflowId || "workflow", steps);
        },

        // ── Smart agent selection from free-text ─────────────────
        agentSelector:  async (task) => {
            const selected = agentSelector.select(task);
            if (!selected) return { success: false, error: "No suitable agent found" };
            return agentExecutorMod.run(selected.agent, task);
        },

        // ── System health ────────────────────────────────────────
        sysHealth: async () => ({ success: true, ...systemHealth.health() }),

        // ── Enterprise SaaS Platform Layer ───────────────────────
        enterprise: async (task) => {
            const { run: enterpriseRun } = require("./enterprise/_enterpriseStore.cjs");
            return enterpriseRun ? enterpriseRun(task) : { success: false, error: "Enterprise store run not found" };
        },
        // Core infrastructure
        multiTenantManager:       async (task) => agentExecutorMod.run("multiTenantManager",        task),
        roleManager:              async (task) => agentExecutorMod.run("roleManager",               task),
        auditLoggerPro:           async (task) => agentExecutorMod.run("auditLoggerPro",            task),
        tenantSecurity:           async (task) => agentExecutorMod.run("tenantSecurityAgent",       task),
        apiGateway:               async (task) => agentExecutorMod.run("apiGatewayPro",             task),
        enterpriseRateLimit:      async (task) => agentExecutorMod.run("rateLimiter",               task),
        saasBilling:              async (task) => agentExecutorMod.run("saasBillingEngine",         task),
        usageMetering:            async (task) => agentExecutorMod.run("usageMeteringAgent",        task),
        // People & HR
        orgManager:               async (task) => agentExecutorMod.run("organizationManager",       task),
        hrManagement:             async (task) => agentExecutorMod.run("hrManagementAgent",         task),
        payroll:                  async (task) => agentExecutorMod.run("payrollAgent",              task),
        attendance:               async (task) => agentExecutorMod.run("attendanceTracker",         task),
        recruitment:              async (task) => agentExecutorMod.run("recruitmentAgent",          task),
        employeePerformance:      async (task) => agentExecutorMod.run("employeePerformanceAgent",  task),
        trainingSystem:           async (task) => agentExecutorMod.run("trainingSystemAgent",       task),
        // Strategy & reporting
        kpiTracker:               async (task) => agentExecutorMod.run("kpiTracker",               task),
        okrManager:               async (task) => agentExecutorMod.run("okrManager",               task),
        boardReporting:           async (task) => agentExecutorMod.run("boardReportingAgent",       task),
        enterpriseDashboard:      async (task) => agentExecutorMod.run("enterpriseDashboard",       task),
        // Collaboration
        teamCollaboration:        async (task) => agentExecutorMod.run("teamCollaborationAgent",    task),
        chatSystem:               async (task) => agentExecutorMod.run("chatSystemAgent",           task),
        fileSharing:              async (task) => agentExecutorMod.run("fileSharingAgent",          task),
        documentCollab:           async (task) => agentExecutorMod.run("documentCollaborationAgent", task),
        approvalWorkflow:         async (task) => agentExecutorMod.run("approvalWorkflowAgent",     task),
        // Legal & compliance
        complianceManager:        async (task) => agentExecutorMod.run("complianceManager",         task),
        legalCompliance:          async (task) => agentExecutorMod.run("legalComplianceAgent",      task),
        contractManager:          async (task) => agentExecutorMod.run("contractManager",           task),
        digitalSignature:         async (task) => agentExecutorMod.run("digitalSignatureAgent",     task),
        // Infrastructure
        loadBalancer:             async (task) => agentExecutorMod.run("loadBalancerAgent",         task),
        cloudCost:                async (task) => agentExecutorMod.run("cloudCostOptimizer",        task),
        enterpriseBackup:         async (task) => agentExecutorMod.run("enterpriseBackupSystem",    task),
        disasterRecovery:         async (task) => agentExecutorMod.run("disasterRecoveryAgent",     task),
        slaMonitor:               async (task) => agentExecutorMod.run("slaMonitor",               task),
        // Branding & admin
        whiteLabel:               async (task) => agentExecutorMod.run("whiteLabelSystem",          task),
        customBranding:           async (task) => agentExecutorMod.run("customBrandingAgent",       task),
        adminPanel:               async (task) => agentExecutorMod.run("adminPanelGenerator",       task),
        // Support & knowledge
        enterpriseSupport:        async (task) => agentExecutorMod.run("enterpriseSupportBot",      task),
        ticketRouting:            async (task) => agentExecutorMod.run("ticketRoutingAgent",        task),
        knowledgePortal:          async (task) => agentExecutorMod.run("knowledgePortalAgent",      task)
    };
}

// ── Task types that belong to the dev/multi-agent layer ──────────
// Dev tasks bypass automationEngine and go direct through agentSelector → agentExecutor.
// Business tasks use automationEngine → toolSelector → _buildHandlers() → agentExecutorMod.
const DEV_TASK_TYPES = new Set([
    "generate_code","write_code","debug_code","fix_error","fix_bug",
    "build_api","create_api","create_schema","database_op","firebase_setup",
    "deploy","create_dockerfile","git_op","git_init","git_commit","git_status","git_log",
    "generate_tests","run_tests","optimize_code","security_scan","sanitize_code",
    "run_workflow","agent_select","agent_exec","system_health"
]);

// ── Main Entry Point ─────────────────────────────────────────────
async function executorAgent(task) {
    logManager.info("ExecutorAgent: task received", { type: task?.type });

    const ctx = performanceTracker.start("executorAgent", task?.type || "unknown");
    let result;

    try {
        // Stage 1 — dynamic agent routing (existing behaviour preserved)
        const routedAgent = agentRouter(task.type);
        if (routedAgent && routedAgent.execute) {
            result = await routedAgent.execute(task);
            systemMonitor.record(task, result);
            performanceTracker.finish(ctx, result?.success !== false);
            return result;
        }

        // Stage 2 — dev/multi tasks go to agentSelector → agentExecutor
        const handlers     = _buildHandlers();
        const isDevTask    = DEV_TASK_TYPES.has(task.type);
        const isAiWithText = task.type === "ai" && (task.input || task.payload?.description);
        const toolHint     = (isDevTask || isAiWithText) ? agentSelector.select(task) : null;

        if (toolHint) {
            logManager.info("ExecutorAgent: agentSelector picked", { agent: toolHint.agent, method: toolHint.method });
            result = await agentExecutorMod.run(toolHint.agent, task);
        } else {
            // Stage 3 — standard automation pipeline for all other tasks
            result = await automationEngine.run(task, handlers);
        }

    } catch (err) {
        result = errorHandler.handle(err, { taskType: task?.type });
        systemMonitor.record(task, result);
    }

    performanceTracker.finish(ctx, result?.success !== false);
    logManager.info("ExecutorAgent: task complete", { type: task?.type });
    return result;
}

module.exports = { executorAgent };
