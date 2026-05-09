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

// ── Boot: register only layers reachable from planner task types ──
// Planner generates: web_search, open_url, open_app, type_text, press_key,
//   key_combo, time, date, get_leads, queue_task, ai, remind/timer triggers.
// dev/business/internet/content handlers ARE reachable via agentExecutorMod.
// All other layers (businessPro, social, education, life, enterprise,
//   health, media) produce no planner task types — excluded from startup load.
require("./dev/index.cjs");
require("./business/index.cjs");
require("./internet/index.cjs");
require("./content/index.cjs");

// ── Tool Handlers — built once, reused on every task ────────────
// Handlers are pure async functions; no per-call state needed.
// Lazy requires inside each handler still work on first invocation.
let _handlers = null;
function _buildHandlers() {
    if (_handlers) return _handlers;
    _handlers = {

        browser: async (task) => {
            const browserAgent = require("./browserAgent.cjs");
            return browserAgent.run(task);
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
                // Single source of truth: same APP_MAP as execution pipeline (backend/utils/parser.js)
                const { APP_MAP } = require("../backend/utils/parser.js");
                const raw    = (task.payload?.app || "").toLowerCase().trim();
                const appName = APP_MAP[raw] || task.payload?.app || "Unknown";
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
            if (task.type === "key_combo") {
                const mods         = task.payload?.modifiers || [];
                const key          = task.payload?.key || "c";
                const desktopResult = await desktopAgent.pressKeyCombo(mods, key);
                const combo        = `${mods.join("+")}+${key}`;
                return {
                    type:    "key_combo",
                    result:  desktopResult.success ? `Key combo: ${combo}` : `Key combo error: ${desktopResult.error}`,
                    success: desktopResult.success,
                    combo,
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

        research: async (task) => {
            const researchAgent = require("./researchAgent.cjs");
            const query = task.payload?.query || task.input || "";
            const result = await researchAgent(query);
            return { type: "research", result, success: true };
        },

        dev: async (task) => {
            const devAgent = require("./devAgent.cjs");
            return devAgent.run(task);
        },

        terminal: async (task) => {
            const terminalAgent = require("./terminalAgent.cjs");
            const command = task.payload?.command || task.input || "";
            const result = await terminalAgent.run(command);
            return { type: "terminal", ...result };
        },

        task_queue: async (task) => {
            const loop = require("./autonomousLoop.cjs");
            const { input, scheduledFor, recurringCron, type: taskType } = task.payload || {};
            if (!input) return { type: "task_queue", success: false, result: "No input provided for queued task" };
            const queued = loop.addTask({ input, scheduledFor, recurringCron, type: taskType || "auto" });
            const when   = queued.recurringCron
                ? `recurring (${queued.recurringCron})`
                : `scheduled for ${new Date(queued.scheduledFor).toLocaleString()}`;
            return {
                type:    "task_queue",
                success: true,
                result:  `Task queued — ID: ${queued.id}\nInput: "${input}"\nSchedule: ${when}\nStatus: pending`,
                task_id: queued.id
            };
        },

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
        knowledgePortal:          async (task) => agentExecutorMod.run("knowledgePortalAgent",      task),

        // ── Infrastructure Modules (Phase A) ─────────────────────
        // Maps
        maps: async (task) => {
            const maps = require("../modules/infrastructure/mapsAgent.cjs");
            const p    = task.payload || {};
            if (p.from && p.to) return maps.getDirections(p.from, p.to, p.mode || "driving");
            return maps.getLocation(p.query || p.location || p.input || task.input || "");
        },
        mapLocation:   async (task) => {
            const { getLocation } = require("../modules/infrastructure/mapsAgent.cjs");
            const p = task.payload || {};
            return getLocation(p.query || p.location || p.input || task.input || "");
        },
        mapDirections: async (task) => {
            const { getDirections } = require("../modules/infrastructure/mapsAgent.cjs");
            const p = task.payload || {};
            return getDirections(p.from, p.to, p.mode || "driving");
        },

        // GPS
        gps: async (task) => {
            const gps = require("../modules/infrastructure/gpsAgent.cjs");
            const p   = task.payload || {};
            return gps.getCurrentLocation(p.userId || p.user || "anonymous", p);
        },
        gpsLocation: async (task) => {
            const { getCurrentLocation } = require("../modules/infrastructure/gpsAgent.cjs");
            const p = task.payload || {};
            return getCurrentLocation(p.userId || "anonymous", p);
        },

        // Payments (infrastructure layer — wraps existing Razorpay util)
        infraPayment: async (task) => {
            const { createPayment } = require("../modules/infrastructure/paymentAgent.cjs");
            return createPayment(task.payload || {});
        },
        paymentStatus: async (task) => {
            const { getPaymentStatus } = require("../modules/infrastructure/paymentAgent.cjs");
            return getPaymentStatus((task.payload || {}).paymentId);
        },

        // Wallet
        wallet: async (task) => {
            const wallet = require("../modules/infrastructure/walletAgent.cjs");
            const p      = task.payload || {};
            if (task.type === "wallet_add")     return wallet.addFunds(p);
            if (task.type === "wallet_deduct")  return wallet.deductFunds(p);
            if (task.type === "wallet_history") return wallet.getHistory(p);
            return wallet.checkBalance(p);
        },
        walletBalance:  async (task) => { const { checkBalance }  = require("../modules/infrastructure/walletAgent.cjs"); return checkBalance(task.payload  || {}); },
        walletAdd:      async (task) => { const { addFunds }      = require("../modules/infrastructure/walletAgent.cjs"); return addFunds(task.payload      || {}); },
        walletDeduct:   async (task) => { const { deductFunds }   = require("../modules/infrastructure/walletAgent.cjs"); return deductFunds(task.payload   || {}); },
        walletHistory:  async (task) => { const { getHistory }    = require("../modules/infrastructure/walletAgent.cjs"); return getHistory(task.payload     || {}); },

        // Notifications (infrastructure layer — wraps existing WA + TG utils)
        infraNotify: async (task) => {
            const notify = require("../modules/infrastructure/notificationAgent.cjs");
            const p      = task.payload || {};
            if (p.phone && p.chatId) return notify.sendBroadcast(p);
            if (p.chatId)            return notify.sendTelegram(p);
            return notify.sendWhatsApp(p);
        },
        notifyWhatsApp: async (task) => { const { sendWhatsApp } = require("../modules/infrastructure/notificationAgent.cjs"); return sendWhatsApp(task.payload || {}); },
        notifyTelegram: async (task) => { const { sendTelegram } = require("../modules/infrastructure/notificationAgent.cjs"); return sendTelegram(task.payload || {}); },
        notifyBroadcast: async (task) => { const { sendBroadcast } = require("../modules/infrastructure/notificationAgent.cjs"); return sendBroadcast(task.payload || {}); },

        // ── Health Layer ─────────────────────────────────────────────
        healthSymptom: async (task) => {
            const { checkSymptoms } = require("./health/symptomChecker.cjs");
            const p = task.payload || {};
            return checkSymptoms({ userId: p.userId || p.user, symptoms: p.symptoms || [task.input], age: p.age, gender: p.gender, duration: p.duration, existingConditions: p.existingConditions });
        },
        healthTriage: async (task) => {
            const { triage } = require("./health/triageAgent.cjs");
            const p = task.payload || {};
            return triage({ userId: p.userId || p.user, checkId: p.checkId, riskLevel: p.riskLevel, detectedSystems: p.detectedSystems, symptoms: p.symptoms, age: p.age });
        },
        healthDiagnosis: async (task) => {
            const { getPossibleCauses } = require("./health/diagnosisSupportAgent.cjs");
            const p = task.payload || {};
            return getPossibleCauses({ userId: p.userId || p.user, symptoms: p.symptoms || [task.input], checkId: p.checkId });
        },
        healthDoctor: async (task) => {
            const { recommendDoctor } = require("./health/doctorRecommendationAgent.cjs");
            const p = task.payload || {};
            return recommendDoctor({ userId: p.userId || p.user, symptoms: p.symptoms, detectedSystems: p.detectedSystems, age: p.age, query: p.query || task.input });
        },
        healthBookAppt: async (task) => {
            const { bookAppointment } = require("./health/appointmentBookingAgent.cjs");
            return bookAppointment(task.payload || {});
        },
        healthRecord: async (task) => {
            const mgr = require("./health/medicalRecordManager.cjs");
            const p   = task.payload || {};
            if (task.type === "health_record_get")    return mgr.getRecords(p);
            if (task.type === "health_profile_get")   return mgr.getHealthProfile(p);
            if (task.type === "health_profile_update")return mgr.updateHealthProfile(p);
            return mgr.addRecord(p);
        },
        healthPrescription: async (task) => {
            const { analyzePrescription } = require("./health/prescriptionAnalyzer.cjs");
            return analyzePrescription(task.payload || {});
        },
        healthDrugCheck: async (task) => {
            const { checkInteractions } = require("./health/drugInteractionChecker.cjs");
            return checkInteractions(task.payload || {});
        },
        healthRisk: async (task) => {
            const { assessRisk } = require("./health/healthRiskPredictor.cjs");
            return assessRisk(task.payload || {});
        },
        healthFitness: async (task) => {
            const fit = require("./health/fitnessMonitoringAgent.cjs");
            const p   = task.payload || {};
            if (task.type === "health_steps")        return fit.logDailySteps(p);
            if (task.type === "health_fitness_stats")return fit.getFitnessStats(p);
            return fit.logWorkout(p);
        },
        healthCalorie: async (task) => {
            const cal = require("./health/calorieCounterAgent.cjs");
            const p   = task.payload || {};
            if (task.type === "health_calorie_summary") return cal.getDailySummary(p);
            if (task.type === "health_food_lookup")     return cal.lookupFood(p);
            return cal.logMeal(p);
        },
        healthDiet: async (task) => {
            const { getDietPlan } = require("./health/dietRecommendationAgent.cjs");
            return getDietPlan(task.payload || {});
        },
        healthMental: async (task) => {
            const mh = require("./health/mentalHealthAssistant.cjs");
            const p  = task.payload || {};
            if (task.type === "health_mood_log") return mh.logMood(p);
            return mh.chat({ userId: p.userId || p.user, message: p.message || task.input, mood: p.mood });
        },
        healthTherapy: async (task) => {
            const { startSession } = require("./health/therapyChatbot.cjs");
            const p = task.payload || {};
            return startSession({ userId: p.userId || p.user, concern: p.concern || task.input, module: p.module });
        },
        healthStress: async (task) => {
            const { analyzeStress } = require("./health/stressAnalyzer.cjs");
            return analyzeStress(task.payload || {});
        },
        healthMeditation: async (task) => {
            const { getSession } = require("./health/meditationCoach.cjs");
            const p = task.payload || {};
            return getSession({ userId: p.userId || p.user, type: p.type, goal: p.goal || task.input });
        },
        healthSleep: async (task) => {
            const sl = require("./health/sleepTherapyAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "health_sleep_log") return sl.logSleep(p);
            return sl.getSleepAdvice({ userId: p.userId || p.user, issue: p.issue || task.input });
        },
        healthHabit: async (task) => {
            const hab = require("./health/habitRecoveryAgent.cjs");
            const p   = task.payload || {};
            if (task.type === "health_habit_log")     return hab.logHabitDay(p);
            if (task.type === "health_habit_progress") return hab.getHabitProgress(p);
            return hab.createHabitPlan(p);
        },
        healthAddiction: async (task) => {
            const add = require("./health/addictionTracker.cjs");
            const p   = task.payload || {};
            if (task.type === "health_sobriety_log") return add.logSobrietyDay(p);
            return add.startRecovery(p);
        },
        healthWellness: async (task) => {
            const wl = require("./health/wellnessPlanner.cjs");
            const p  = task.payload || {};
            if (task.type === "health_wellness_log") return wl.logWellnessDay(p);
            return wl.createWellnessPlan(p);
        },
        healthYoga: async (task) => {
            const { getYogaSession } = require("./health/yogaTrainerAgent.cjs");
            const p = task.payload || {};
            return getYogaSession({ userId: p.userId || p.user, goal: p.goal || task.input, level: p.level });
        },
        healthPregnancy: async (task) => {
            const preg = require("./health/pregnancyCareAgent.cjs");
            const p    = task.payload || {};
            if (task.type === "health_pregnancy_log") return preg.logPregnancyEntry(p);
            return preg.getPregnancyInfo(p);
        },
        healthChild: async (task) => {
            const ch = require("./health/childHealthTracker.cjs");
            const p  = task.payload || {};
            if (task.type === "health_child_log")       return ch.logChildHealth(p);
            if (task.type === "health_child_milestones") return ch.getMilestones(p);
            return ch.getVaccinationSchedule(p);
        },
        healthElder: async (task) => {
            const el = require("./health/elderCareAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "health_elder_reminder") return el.addMedicationReminder(p);
            return el.getElderCarePlan(p);
        },
        healthEmergency: async (task) => {
            const em = require("./health/emergencyAlertAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "health_emergency_alert") return em.triggerAlert(p);
            return em.getEmergencyGuide({ userId: p.userId || p.user, situation: p.situation || task.input });
        },
        healthAmbulance: async (task) => {
            const { findNearbyAmbulance } = require("./health/ambulanceFinder.cjs");
            return findNearbyAmbulance({ ...(task.payload || {}), urgent: true });
        },
        healthHospital: async (task) => {
            const { findNearbyHospitals } = require("./health/hospitalFinder.cjs");
            return findNearbyHospitals(task.payload || {});
        },
        healthBlood: async (task) => {
            const bd = require("./health/bloodDonorFinder.cjs");
            const p  = task.payload || {};
            if (task.type === "health_blood_register") return bd.registerDonor(p);
            if (task.type === "health_blood_info")     return bd.getBloodGroupInfo(p);
            return bd.findDonors(p);
        },
        healthResearch: async (task) => {
            const { searchResearch } = require("./health/medicalResearchAgent.cjs");
            const p = task.payload || {};
            return searchResearch({ userId: p.userId || p.user, query: p.query || task.input, topic: p.topic });
        },
        healthTrials: async (task) => {
            const { findTrials } = require("./health/clinicalTrialFinder.cjs");
            return findTrials(task.payload || {});
        },
        healthGenomics: async (task) => {
            const { getGenomicsInfo } = require("./health/genomicsFutureAgent.cjs");
            const p = task.payload || {};
            return getGenomicsInfo({ userId: p.userId || p.user, topic: p.topic || task.input });
        },
        healthWearable: async (task) => {
            const wd = require("./health/wearableDataAnalyzer.cjs");
            const p  = task.payload || {};
            if (task.type === "health_wearable_trends") return wd.getWearableTrends(p);
            return wd.analyzeData(p);
        },
        healthDashboard: async (task) => {
            const { getDashboard } = require("./health/healthDashboard.cjs");
            const p = task.payload || {};
            return getDashboard({ userId: p.userId || p.user, days: p.days });
        },
        healthInsurance: async (task) => {
            const ins = require("./health/insuranceClaimAgent.cjs");
            const p   = task.payload || {};
            if (task.type === "health_claim_update") return ins.updateClaimStatus(p);
            if (task.type === "health_claim_list")   return ins.getClaims(p);
            if (task.type === "health_claim_help")   return ins.getRejectionHelp(p);
            return ins.createClaim(p);
        },
        healthBilling: async (task) => {
            const { analyzeBill } = require("./health/medicalBillingAgent.cjs");
            return analyzeBill(task.payload || {});
        },
        healthReport: async (task) => {
            const { generateReport } = require("./health/healthReportGenerator.cjs");
            const p = task.payload || {};
            return generateReport({ userId: p.userId || p.user, reportType: p.reportType });
        },
        healthNotes: async (task) => {
            const dn = require("./health/doctorNotesAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "health_notes_get") return dn.getNotes(p);
            if (task.type === "health_notes_summarize") return dn.summarizeVisit(p);
            return dn.saveNotes(p);
        },
        healthTelemedicine: async (task) => {
            const tele = require("./health/telemedicineAgent.cjs");
            const p    = task.payload || {};
            if (task.type === "health_tele_platforms") return tele.getPlatforms(p);
            return tele.bookVirtualConsult(p);
        },
        healthChat: async (task) => {
            const { askQuestion } = require("./health/healthChatSupport.cjs");
            const p = task.payload || {};
            return askQuestion({ userId: p.userId || p.user, question: p.question || task.input });
        },
        healthImage: async (task) => {
            const img = require("./health/medicalImageAnalyzer.cjs");
            const p   = task.payload || {};
            return img.describeImageType({ userId: p.userId || p.user, imageType: p.imageType, query: p.query || task.input });
        },
        healthRadiology: async (task) => {
            const rad = require("./health/radiologyAssistant.cjs");
            const p   = task.payload || {};
            if (task.type === "health_radiology_term") return rad.lookupTerm({ userId: p.userId || p.user, term: p.term || task.input });
            return rad.explainReport({ userId: p.userId || p.user, reportText: p.reportText || task.input, terms: p.terms });
        },

        // ── Media Layer ───────────────────────────────────────────────────

        mediaMovies: async (task) => {
            const m = require("./media/movieRecommendationAgent.cjs");
            const p = task.payload || {};
            if (p.addToWatchlist || task.type === "media_watchlist") return m.addToWatchlist({ userId: p.userId, title: p.title, platform: p.platform });
            return m.recommend({ userId: p.userId, genres: p.genres, mood: p.mood, minRating: p.minRating, exclude: p.exclude, limit: p.limit });
        },

        mediaOTT: async (task) => {
            const o = require("./media/ottAggregatorAgent.cjs");
            const p = task.payload || {};
            if (p.title || task.type === "media_find_title") return o.findTitle({ userId: p.userId, title: p.title || task.input });
            if (p.compareSubscriptions || task.type === "media_compare_ott") return o.compareSubscriptions({ userId: p.userId, titles: p.titles });
            return o.listPlatforms({ userId: p.userId, region: p.region, budget: p.budget });
        },

        mediaMusic: async (task) => {
            const m = require("./media/musicRecommendationAgent.cjs");
            const p = task.payload || {};
            return m.recommend({ userId: p.userId, mood: p.mood, genres: p.genres, activity: p.activity, language: p.language });
        },

        mediaPlaylist: async (task) => {
            const pl = require("./media/playlistGenerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_get_playlists") return pl.getPlaylists({ userId: p.userId });
            return pl.generatePlaylist({ userId: p.userId, theme: p.theme, mood: p.mood, genres: p.genres, trackCount: p.trackCount, title: p.title });
        },

        mediaGaming: async (task) => {
            const g = require("./media/gamingAssistant.cjs");
            const p = task.payload || {};
            if (task.type === "media_gaming_tips") return g.getGamingTips({ userId: p.userId, game: p.game || task.input });
            if (task.type === "media_gaming_log")  return g.logSession({ userId: p.userId, game: p.game, durationMinutes: p.durationMinutes, outcome: p.outcome, notes: p.notes });
            return g.recommendGames({ userId: p.userId, platform: p.platform, genre: p.genre, freeToPlay: p.freeToPlay, rating: p.rating });
        },

        mediaStreamMod: async (task) => {
            const sm = require("./media/streamModerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_stream_ban")    return sm.banUser({ userId: p.userId, streamId: p.streamId, targetUserId: p.targetUserId, reason: p.reason });
            if (task.type === "media_stream_report") return sm.getStreamReport({ userId: p.userId, streamId: p.streamId });
            return sm.moderateMessage({ userId: p.userId, streamId: p.streamId, message: p.message || task.input, authorId: p.authorId, authorName: p.authorName });
        },

        mediaChatBot: async (task) => {
            const cb = require("./media/chatEngagementBot.cjs");
            const p  = task.payload || {};
            if (task.type === "media_poll")      return cb.createPoll({ userId: p.userId, streamId: p.streamId, topic: p.topic, options: p.options });
            if (task.type === "media_giveaway")  return cb.triggerGiveaway({ userId: p.userId, streamId: p.streamId, prize: p.prize, keyword: p.keyword });
            if (task.type === "media_pick_winner") return cb.pickWinner({ userId: p.userId, streamId: p.streamId, giveawayId: p.giveawayId });
            return cb.autoReply({ userId: p.userId, streamId: p.streamId, message: p.message || task.input, authorName: p.authorName });
        },

        mediaMeme: async (task) => {
            const mm = require("./media/memeGeneratorPro.cjs");
            const p  = task.payload || {};
            if (task.type === "media_meme_templates") return mm.getTrendingTemplates({ userId: p.userId });
            return mm.generateMeme({ userId: p.userId, template: p.template, texts: p.texts, topic: p.topic || task.input });
        },

        mediaGif: async (task) => {
            const gf = require("./media/gifGenerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_gif_create")    return gf.createCustomGif({ userId: p.userId, frames: p.frames, fps: p.fps, title: p.title });
            if (task.type === "media_gif_reaction")  return gf.getReactionGif({ userId: p.userId, emotion: p.emotion || task.input });
            return gf.searchGif({ userId: p.userId, query: p.query || task.input, category: p.category });
        },

        mediaAnimation: async (task) => {
            const an = require("./media/animationCreator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_animation_styles") return an.getAnimationStyles();
            return an.planAnimation({ userId: p.userId, title: p.title, style: p.style, durationSeconds: p.durationSeconds, scenes: p.scenes, targetPlatform: p.targetPlatform });
        },

        mediaStory: async (task) => {
            const st = require("./media/storyGenerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_story_prompt") return st.getStoryPrompt({ userId: p.userId, genre: p.genre });
            return st.generateStory({ userId: p.userId, genre: p.genre, premise: p.premise || task.input, structure: p.structure, characters: p.characters });
        },

        mediaComic: async (task) => {
            const co = require("./media/comicCreatorAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "media_comic_layouts") return co.getLayouts();
            return co.createComicScript({ userId: p.userId, title: p.title, genre: p.genre, synopsis: p.synopsis, panels: p.panels });
        },

        mediaCharacter: async (task) => {
            const ch = require("./media/characterGenerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_archetypes") return ch.getArchetypes();
            return ch.generateCharacter({ userId: p.userId, name: p.name, archetype: p.archetype, genre: p.genre, visualStyle: p.visualStyle, backstory: p.backstory });
        },

        mediaAvatar: async (task) => {
            const av = require("./media/avatarCreatorPro.cjs");
            const p  = task.payload || {};
            if (task.type === "media_avatar_styles") return av.getAvatarStyles();
            return av.createAvatar({ userId: p.userId, style: p.style, name: p.name, customisation: p.customisation, platform: p.platform });
        },

        mediaVirtualInfluencer: async (task) => {
            const vi = require("./media/virtualInfluencerAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "media_influencer_plan") return vi.generateContentPlan({ userId: p.userId, personaId: p.personaId, weeks: p.weeks });
            return vi.createPersona({ userId: p.userId, name: p.name, personaType: p.personaType, niche: p.niche, consent: p.consent, watermark: p.watermark });
        },

        mediaLikeness: async (task) => {
            const lc = require("./media/likenessController.cjs");
            const p  = task.payload || {};
            if (task.type === "media_likeness_check")    return lc.checkConsent({ userId: p.userId, subjectName: p.subjectName, contentType: p.contentType, platform: p.platform });
            if (task.type === "media_likeness_revoke")   return lc.revokeConsent({ userId: p.userId, consentId: p.consentId, reason: p.reason });
            if (task.type === "media_likeness_watermark")return lc.enforceWatermark({ userId: p.userId, contentId: p.contentId, subjectName: p.subjectName, contentType: p.contentType, watermarkData: p.watermarkData });
            return lc.registerConsent({ userId: p.userId, subjectName: p.subjectName, contentTypes: p.contentTypes, platforms: p.platforms, grantedBy: p.grantedBy, consentDocument: p.consentDocument });
        },

        mediaModerate: async (task) => {
            const mod = require("./media/contextModerationAI.cjs");
            const p   = task.payload || {};
            if (task.type === "media_mod_log")    return mod.getModerationLog({ userId: p.userId, approved: p.approved });
            if (task.type === "media_mod_appeal") return mod.appeal({ userId: p.userId, moderationId: p.moderationId, reason: p.reason });
            return mod.moderate({ userId: p.userId, contentId: p.contentId, contentType: p.contentType, title: p.title || task.input, description: p.description, tags: p.tags, transcript: p.transcript });
        },

        mediaCopyright: async (task) => {
            const cc = require("./media/copyrightChecker.cjs");
            const p  = task.payload || {};
            if (task.type === "media_copyright_multi") return cc.checkMultipleAssets({ userId: p.userId, contentId: p.contentId, assets: p.assets });
            return cc.checkAsset({ userId: p.userId, contentId: p.contentId, assetType: p.assetType, assetName: p.assetName || task.input, license: p.license, source: p.source, artist: p.artist, label: p.label });
        },

        mediaVoiceAct: async (task) => {
            const va = require("./media/voiceActingAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "media_voice_styles") return va.getActingStyles();
            return va.generateVoiceover({ userId: p.userId, scriptText: p.scriptText || task.input, style: p.style, emotion: p.emotion, language: p.language, consent: p.consent, watermark: p.watermark, isRealPersonVoice: p.isRealPersonVoice });
        },

        mediaSFX: async (task) => {
            const sfx = require("./media/soundEffectGenerator.cjs");
            const p   = task.payload || {};
            if (task.type === "media_sfx_categories") return sfx.getSFXCategories();
            if (task.type === "media_sfx_create")     return sfx.generateSFX({ userId: p.userId, type: p.type || task.input, description: p.description });
            return sfx.searchSFX({ userId: p.userId, category: p.category, query: p.query || task.input });
        },

        mediaBGM: async (task) => {
            const bgm = require("./media/backgroundMusicAgent.cjs");
            const p   = task.payload || {};
            if (task.type === "media_bgm_options") return bgm.getMoodOptions();
            return bgm.selectMusic({ userId: p.userId, mood: p.mood || task.input, durationSeconds: p.durationSeconds, videoType: p.videoType, contentId: p.contentId });
        },

        mediaPodcastEdit: async (task) => {
            const pe = require("./media/podcastEditorAgent.cjs");
            const p  = task.payload || {};
            if (task.type === "media_podcast_specs")   return pe.getPlatformSpecs({ platform: p.platform });
            if (task.type === "media_podcast_op")      return pe.updateOperationStatus({ userId: p.userId, planId: p.planId, operation: p.operation, status: p.status });
            return pe.createEditPlan({ userId: p.userId, episodeId: p.episodeId, episodeTitle: p.episodeTitle || task.input, targetPlatforms: p.targetPlatforms, operations: p.operations, durationSec: p.durationSec });
        },

        mediaAudioClean: async (task) => {
            const ac = require("./media/audioCleaner.cjs");
            const p  = task.payload || {};
            if (task.type === "media_noise_types")   return ac.getNoiseTypes();
            if (task.type === "media_audio_targets") return ac.getAudioTargets();
            return ac.analyseAudio({ userId: p.userId, fileId: p.fileId, fileName: p.fileName, noiseType: p.noiseType, targetUse: p.targetUse, measuredLufs: p.measuredLufs });
        },

        mediaSubtitle: async (task) => {
            const sub = require("./media/subtitleGenerator.cjs");
            const p   = task.payload || {};
            if (task.type === "media_subtitle_formats") return sub.getFormats();
            if (task.type === "media_subtitle_langs")   return sub.getLanguages();
            return sub.createSubtitleJob({ userId: p.userId, videoId: p.videoId, videoTitle: p.videoTitle, language: p.language, format: p.format, speakerDiarisation: p.speakerDiarisation });
        },

        mediaDubbing: async (task) => {
            const dub = require("./media/dubbingAgent.cjs");
            const p   = task.payload || {};
            if (task.type === "media_dub_langs") return dub.getSupportedLanguages();
            return dub.createDubbingJob({ userId: p.userId, videoId: p.videoId, videoTitle: p.videoTitle, sourceLang: p.sourceLang, targetLang: p.targetLang, consent: p.consent, watermark: p.watermark, lipSync: p.lipSync });
        },

        mediaVideoEdit: async (task) => {
            const ve = require("./media/videoEditorPro.cjs");
            const p  = task.payload || {};
            if (task.type === "media_video_presets") return ve.getPlatformPresets();
            return ve.createEditProject({ userId: p.userId, title: p.title || task.input, rawClips: p.rawClips, targetPlatform: p.targetPlatform, colorGrade: p.colorGrade });
        },

        mediaSceneDetect: async (task) => {
            const sd = require("./media/sceneDetectionAgent.cjs");
            const p  = task.payload || {};
            return sd.detectScenes({ userId: p.userId, videoId: p.videoId, videoTitle: p.videoTitle, totalDurationSec: p.totalDurationSec, manualTimestamps: p.manualTimestamps });
        },

        mediaClip: async (task) => {
            const cl = require("./media/clipGenerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_clip_batch") return cl.batchGenerateClips({ userId: p.userId, sourceVideoId: p.sourceVideoId, sourceTitle: p.sourceTitle, segments: p.segments });
            return cl.generateClip({ userId: p.userId, sourceVideoId: p.sourceVideoId, sourceTitle: p.sourceTitle, startSec: p.startSec, endSec: p.endSec, clipType: p.clipType, addCaptions: p.addCaptions });
        },

        mediaHighlight: async (task) => {
            const he = require("./media/highlightExtractor.cjs");
            const p  = task.payload || {};
            if (task.type === "media_highlight_add") return he.addHighlight({ userId: p.userId, jobId: p.jobId, startSec: p.startSec, endSec: p.endSec, label: p.label });
            return he.extractHighlights({ userId: p.userId, videoId: p.videoId, videoTitle: p.videoTitle, signals: p.signals, manualMoments: p.manualMoments, targetHighlightCount: p.targetHighlightCount });
        },

        mediaTrailer: async (task) => {
            const tr = require("./media/trailerGenerator.cjs");
            const p  = task.payload || {};
            if (task.type === "media_trailer_types") return tr.getTrailerTypes();
            return tr.generateTrailerPlan({ userId: p.userId, sourceContentId: p.sourceContentId, sourceTitle: p.sourceTitle, trailerType: p.trailerType, highlights: p.highlights });
        },

        mediaCompress: async (task) => {
            const mc = require("./media/mediaCompressor.cjs");
            const p  = task.payload || {};
            if (task.type === "media_compress_image") return mc.compressImage({ userId: p.userId, fileId: p.fileId, fileName: p.fileName, targetFormat: p.targetFormat });
            if (task.type === "media_compress_presets") return mc.getPresets();
            return mc.compressVideo({ userId: p.userId, fileId: p.fileId, fileName: p.fileName, inputSizeMB: p.inputSizeMB, preset: p.preset, targetResolution: p.targetResolution });
        },

        mediaConvert: async (task) => {
            const fc = require("./media/formatConverter.cjs");
            const p  = task.payload || {};
            if (task.type === "media_convert_formats") return fc.getSupportedFormats();
            return fc.convert({ userId: p.userId, fileId: p.fileId, fileName: p.fileName, sourceFormat: p.sourceFormat, targetFormat: p.targetFormat || task.input, quality: p.quality });
        },

        mediaStream: async (task) => {
            const so = require("./media/streamingOptimizer.cjs");
            const p  = task.payload || {};
            if (task.type === "media_stream_profiles") return so.getStreamingProfiles();
            return so.createStreamProfile({ userId: p.userId, contentId: p.contentId, targetPlatforms: p.targetPlatforms, qualities: p.qualities });
        },

        mediaCDN: async (task) => {
            const cdn = require("./media/cdnManager.cjs");
            const p   = task.payload || {};
            if (task.type === "media_cdn_providers") return cdn.getCDNProviders();
            return cdn.planCDNDeployment({ userId: p.userId, contentType: p.contentType, expectedMonthlyGBTransfer: p.expectedMonthlyGBTransfer, regions: p.regions });
        },

        mediaStorage: async (task) => {
            const ms = require("./media/mediaStorageAI.cjs");
            const p  = task.payload || {};
            if (task.type === "media_storage_list")   return ms.listAssets({ userId: p.userId, contentType: p.contentType, tag: p.tag, storageTier: p.storageTier });
            if (task.type === "media_storage_tier")   return ms.tierAsset({ userId: p.userId, assetId: p.assetId, newTier: p.newTier });
            if (task.type === "media_storage_delete") return ms.deleteAsset({ userId: p.userId, assetId: p.assetId });
            return ms.registerAsset({ userId: p.userId, contentId: p.contentId, contentType: p.contentType, fileName: p.fileName, fileSizeMB: p.fileSizeMB, format: p.format, storageTier: p.storageTier, tags: p.tags, publicUrl: p.publicUrl });
        },

        mediaThumbnail: async (task) => {
            const to = require("./media/thumbnailOptimizer.cjs");
            const p  = task.payload || {};
            if (task.type === "media_thumbnail_specs") return to.getPlatformSpecs();
            return to.optimiseThumbnail({ userId: p.userId, contentId: p.contentId, platform: p.platform, currentCTR: p.currentCTR, title: p.title || task.input, currentIssues: p.currentIssues });
        },

        mediaPerformance: async (task) => {
            const pt = require("./media/contentPerformanceTracker.cjs");
            const p  = task.payload || {};
            if (task.type === "media_perf_log")     return pt.logMetrics({ userId: p.userId, contentId: p.contentId, platform: p.platform, date: p.date, metrics: p.metrics });
            if (task.type === "media_perf_compare") return pt.comparePeriods({ userId: p.userId, contentId: p.contentId, currentDays: p.currentDays, previousDays: p.previousDays });
            return pt.analysePerformance({ userId: p.userId, contentId: p.contentId, days: p.days });
        },

        // ── Legal Layer ───────────────────────────────────────────────────

        legalAdvice: async (task) => {
            const { advise, getDomains } = require("./legal/legalAdvisorAI.cjs");
            const p = task.payload || {};
            if (task.type === "legal_domains") return getDomains();
            return advise({ userId: p.userId, domain: p.domain, query: p.query || task.input });
        },

        legalContract: async (task) => {
            const { analyzeText } = require("./legal/contractAnalyzer.cjs");
            const p = task.payload || {};
            return analyzeText({ userId: p.userId, contractText: p.contractText || task.input, contractType: p.contractType });
        },

        legalCaseLaw: async (task) => {
            const { searchCaseLaw, getLegalDatabases } = require("./legal/caseLawSearchAgent.cjs");
            const p = task.payload || {};
            if (task.type === "legal_databases") return getLegalDatabases({ userId: p.userId });
            return searchCaseLaw({ userId: p.userId, query: p.query || task.input, jurisdiction: p.jurisdiction, domain: p.domain });
        },

        legalDoc: async (task) => {
            const { generateTemplate, listTemplates } = require("./legal/legalDocumentGenerator.cjs");
            const p = task.payload || {};
            if (task.type === "legal_doc_templates") return listTemplates({ userId: p.userId });
            return generateTemplate({ userId: p.userId, templateType: p.templateType, variables: p.variables });
        },

        legalCompliance2: async (task) => {
            const { checkCompliance, getFrameworks } = require("./legal/complianceChecker.cjs");
            const p = task.payload || {};
            if (task.type === "legal_frameworks") return getFrameworks({ userId: p.userId });
            return checkCompliance({ userId: p.userId, framework: p.framework, businessType: p.businessType, checkItems: p.checkItems });
        },

        legalPolicy: async (task) => {
            const { generatePolicy, getPolicyTypes } = require("./legal/policyGenerator.cjs");
            const p = task.payload || {};
            if (task.type === "legal_policy_types") return getPolicyTypes({ userId: p.userId });
            return generatePolicy({ userId: p.userId, policyType: p.policyType, businessName: p.businessName, businessType: p.businessType, variables: p.variables });
        },

        legalChat: async (task) => {
            const { chat } = require("./legal/legalChatbot.cjs");
            const p = task.payload || {};
            return chat({ userId: p.userId, message: p.message || task.input });
        },

        legalDispute: async (task) => {
            const { analyzeDispute, getResolutionMethods } = require("./legal/disputeResolutionAgent.cjs");
            const p = task.payload || {};
            if (task.type === "legal_dispute_methods") return getResolutionMethods({ userId: p.userId });
            return analyzeDispute({ userId: p.userId, disputeType: p.disputeType, amount: p.amount, description: p.description || task.input, jurisdiction: p.jurisdiction });
        },

        legalArbitration: async (task) => {
            const { initiateArbitration, getInstitutions } = require("./legal/arbitrationAgent.cjs");
            const p = task.payload || {};
            if (task.type === "legal_arb_institutions") return getInstitutions({ userId: p.userId });
            return initiateArbitration({ userId: p.userId, disputeType: p.disputeType, claimantId: p.claimantId, respondentId: p.respondentId, amount: p.amount, jurisdiction: p.jurisdiction, institution: p.institution });
        },

        legalIP: async (task) => {
            const { assessIPProtection, getIPTypes } = require("./legal/ipProtectionAgent.cjs");
            const p = task.payload || {};
            if (task.type === "legal_ip_types") return getIPTypes({ userId: p.userId });
            return assessIPProtection({ userId: p.userId, assetName: p.assetName || task.input, ipType: p.ipType, jurisdiction: p.jurisdiction, description: p.description });
        },

        legalCopyright: async (task) => {
            const { registerCopyrightAsset, generateTakedownNotice } = require("./legal/copyrightProtection.cjs");
            const p = task.payload || {};
            if (task.type === "legal_takedown") return generateTakedownNotice({ userId: p.userId, assetId: p.assetId, platform: p.platform, infringingUrl: p.infringingUrl, yourName: p.yourName });
            return registerCopyrightAsset({ userId: p.userId, title: p.title, type: p.type, description: p.description, jurisdiction: p.jurisdiction });
        },

        legalPatent: async (task) => {
            const { searchPriorArt, getPatentDatabases } = require("./legal/patentSearchAgent.cjs");
            const p = task.payload || {};
            if (task.type === "legal_patent_db") return getPatentDatabases({ userId: p.userId });
            return searchPriorArt({ userId: p.userId, inventionTitle: p.inventionTitle || task.input, description: p.description, ipcClass: p.ipcClass, jurisdiction: p.jurisdiction });
        },

        legalLicense: async (task) => {
            const { recommendLicense, getLicenseTypes } = require("./legal/licensingAgent.cjs");
            const p = task.payload || {};
            if (task.type === "legal_license_types") return getLicenseTypes({ userId: p.userId });
            return recommendLicense({ userId: p.userId, assetType: p.assetType, useCase: p.useCase, isOpenSource: p.isOpenSource, commercialUse: p.commercialUse });
        },

        legalTerms: async (task) => {
            const { generateTerms } = require("./legal/termsGenerator.cjs");
            const p = task.payload || {};
            return generateTerms({ userId: p.userId, businessName: p.businessName, businessType: p.businessType, jurisdiction: p.jurisdiction, variables: p.variables });
        },

        legalConsent: async (task) => {
            const { recordConsent, revokeConsent, checkConsent } = require("./legal/consentManager.cjs");
            const p = task.payload || {};
            if (task.type === "legal_consent_check")  return checkConsent({ userId: p.userId, subjectId: p.subjectId, consentType: p.consentType });
            if (task.type === "legal_consent_revoke") return revokeConsent({ userId: p.userId, consentId: p.consentId, reason: p.reason });
            return recordConsent({ userId: p.userId, subjectId: p.subjectId, consentType: p.consentType, purpose: p.purpose, expiryDays: p.expiryDays });
        },

        // ── Security Layer ────────────────────────────────────────────────

        secPrivacy: async (task) => {
            const { scanForPII, handleDataSubjectRequest, maskPII } = require("./security/privacyManagerPro.cjs");
            const p = task.payload || {};
            if (task.type === "sec_dsr")       return handleDataSubjectRequest({ userId: p.userId, requestType: p.requestType, subjectEmail: p.subjectEmail, description: p.description });
            if (task.type === "sec_mask_pii")  return maskPII({ userId: p.userId, text: p.text || task.input });
            return scanForPII({ userId: p.userId, text: p.text || task.input, source: p.source });
        },

        secEncrypt: async (task) => {
            const { encrypt, decrypt, hashData, generateKey } = require("./security/dataEncryptionAgent.cjs");
            const p = task.payload || {};
            if (task.type === "sec_decrypt")     return decrypt({ userId: p.userId, iv: p.iv, encryptedHex: p.encryptedHex, authTag: p.authTag, key: p.key });
            if (task.type === "sec_hash")        return hashData({ userId: p.userId, data: p.data || task.input, algorithm: p.algorithm });
            if (task.type === "sec_genkey")      return generateKey({ userId: p.userId, keyType: p.keyType });
            return encrypt({ userId: p.userId, data: p.data || task.input, key: p.key });
        },

        secThreat: async (task) => {
            const { analyzeInput, scanPayload } = require("./security/threatDetectionSystem.cjs");
            const p = task.payload || {};
            if (task.type === "sec_scan_payload") return scanPayload({ userId: p.userId, payload: p.payload, source: p.source });
            return analyzeInput({ userId: p.userId, input: p.input || task.input, inputType: p.inputType, source: p.source });
        },

        secIntrusion: async (task) => {
            const { checkLoginAttempt, checkRateLimit, getSecurityLog } = require("./security/intrusionDetectionAgent.cjs");
            const p = task.payload || {};
            if (task.type === "sec_rate_limit")   return checkRateLimit({ userId: p.userId, endpoint: p.endpoint, ip: p.ip });
            if (task.type === "sec_ids_log")       return getSecurityLog({ userId: p.userId, limit: p.limit });
            return checkLoginAttempt({ userId: p.userId, ip: p.ip, userAgent: p.userAgent, geoCountry: p.geoCountry, success: p.success });
        },

        secFirewall: async (task) => {
            const { inspectRequest, addToBlocklist, getFirewallRules } = require("./security/firewallAI.cjs");
            const p = task.payload || {};
            if (task.type === "sec_fw_block")    return addToBlocklist({ userId: p.userId, ip: p.ip, reason: p.reason, duration: p.duration });
            if (task.type === "sec_fw_rules")    return getFirewallRules({ userId: p.userId });
            return inspectRequest({ userId: p.userId, sourceIP: p.sourceIP, destinationPort: p.destinationPort, payloadSizeBytes: p.payloadSizeBytes, method: p.method, path: p.path, headers: p.headers });
        },

        secMalware: async (task) => {
            const { scanFile, scanDirectory, computeFileHash } = require("./security/malwareScanner.cjs");
            const p = task.payload || {};
            if (task.type === "sec_scan_dir")   return scanDirectory({ userId: p.userId, files: p.files });
            if (task.type === "sec_file_hash")  return computeFileHash({ userId: p.userId, fileContent: p.fileContent });
            return scanFile({ userId: p.userId, fileName: p.fileName || task.input, fileContent: p.fileContent, fileSizeBytes: p.fileSizeBytes, fileHash: p.fileHash });
        },

        secPhishing: async (task) => {
            const { analyzeURL, analyzeEmail } = require("./security/phishingDetector.cjs");
            const p = task.payload || {};
            if (task.type === "sec_phish_email") return analyzeEmail({ userId: p.userId, subject: p.subject, body: p.body, senderEmail: p.senderEmail, senderName: p.senderName });
            return analyzeURL({ userId: p.userId, url: p.url || task.input });
        },

        secIdentity: async (task) => {
            const { assessPasswordStrength, generatePassword, checkBreachExposure, getMFARecommendation } = require("./security/identityProtectionAgent.cjs");
            const p = task.payload || {};
            if (task.type === "sec_gen_password")  return generatePassword({ userId: p.userId, length: p.length, includeSymbols: p.includeSymbols });
            if (task.type === "sec_breach_check")  return checkBreachExposure({ userId: p.userId, email: p.email || task.input });
            if (task.type === "sec_mfa_guide")     return getMFARecommendation({ useCase: p.useCase });
            return assessPasswordStrength({ userId: p.userId, password: p.password || task.input });
        },

        secFraud: async (task) => {
            const { analyzeTransaction, flagMerchant, getTransactionHistory } = require("./security/fraudDetectionSystem.cjs");
            const p = task.payload || {};
            if (task.type === "sec_fraud_history")  return getTransactionHistory({ userId: p.userId, limit: p.limit });
            if (task.type === "sec_flag_merchant")  return flagMerchant({ userId: p.userId, merchantId: p.merchantId, reason: p.reason });
            return analyzeTransaction({ userId: p.userId, transactionId: p.transactionId, amount: p.amount, currency: p.currency, merchantId: p.merchantId, deviceId: p.deviceId, geoLocation: p.geoLocation, timestamp: p.timestamp });
        },

        secMonitor: async (task) => {
            const { monitorTransaction, getAccountRiskProfile, getAnomalyLog } = require("./security/transactionMonitor.cjs");
            const p = task.payload || {};
            if (task.type === "sec_risk_profile") return getAccountRiskProfile({ userId: p.userId });
            if (task.type === "sec_anomaly_log")  return getAnomalyLog({ userId: p.userId, limit: p.limit });
            return monitorTransaction({ userId: p.userId, amount: p.amount, currency: p.currency, merchantId: p.merchantId, deviceId: p.deviceId, geoLocation: p.geoLocation, sessionId: p.sessionId, timestamp: p.timestamp });
        },

        secVault: async (task) => {
            const { storeFile, retrieveFile, deleteFile, listVaultFiles, shareFileAccess } = require("./security/secureFileVault.cjs");
            const p = task.payload || {};
            if (task.type === "sec_vault_retrieve") return retrieveFile({ userId: p.userId, fileId: p.fileId, encryptionKey: p.encryptionKey });
            if (task.type === "sec_vault_delete")   return deleteFile({ userId: p.userId, fileId: p.fileId, confirm: p.confirm });
            if (task.type === "sec_vault_list")     return listVaultFiles({ userId: p.userId });
            if (task.type === "sec_vault_share")    return shareFileAccess({ userId: p.userId, fileId: p.fileId, shareWithUserId: p.shareWithUserId });
            return storeFile({ userId: p.userId, fileName: p.fileName, fileContent: p.fileContent, encryptionKey: p.encryptionKey, tags: p.tags, accessList: p.accessList });
        },

        // ── Governance Layer ──────────────────────────────────────────────

        govAudit: async (task) => {
            const { recordAuditEvent, queryAuditTrail, verifyAuditIntegrity, exportAuditTrail } = require("./governance/auditTrailGenerator.cjs");
            const p = task.payload || {};
            if (task.type === "gov_audit_query")  return queryAuditTrail({ userId: p.userId, organizationId: p.organizationId, category: p.category, actor: p.actor, fromDate: p.fromDate, toDate: p.toDate, limit: p.limit });
            if (task.type === "gov_audit_verify") return verifyAuditIntegrity({ userId: p.userId, organizationId: p.organizationId });
            if (task.type === "gov_audit_export") return exportAuditTrail({ userId: p.userId, organizationId: p.organizationId, format: p.format, fromDate: p.fromDate, toDate: p.toDate });
            return recordAuditEvent({ userId: p.userId, organizationId: p.organizationId, category: p.category, action: p.action, actor: p.actor, affectedEntity: p.affectedEntity, details: p.details, severity: p.severity });
        },

        govDashboard: async (task) => {
            const { recordKPI, getDashboard, updateDimensionScore, generateGovernanceReport } = require("./governance/governanceDashboard.cjs");
            const p = task.payload || {};
            if (task.type === "gov_dashboard")      return getDashboard({ userId: p.userId, organizationId: p.organizationId });
            if (task.type === "gov_dim_score")       return updateDimensionScore({ userId: p.userId, organizationId: p.organizationId, dimension: p.dimension, score: p.score });
            if (task.type === "gov_report")          return generateGovernanceReport({ userId: p.userId, organizationId: p.organizationId, period: p.period });
            return recordKPI({ userId: p.userId, organizationId: p.organizationId, kpiKey: p.kpiKey, value: p.value, period: p.period });
        },

        govRegulation: async (task) => {
            const { searchRegulations, trackCompliance, getComplianceMatrix, setReviewReminder } = require("./governance/regulationTracker.cjs");
            const p = task.payload || {};
            if (task.type === "gov_reg_search")   return searchRegulations({ userId: p.userId, jurisdiction: p.jurisdiction, category: p.category, keyword: p.keyword || task.input });
            if (task.type === "gov_reg_matrix")   return getComplianceMatrix({ userId: p.userId, organizationId: p.organizationId });
            if (task.type === "gov_reg_reminder") return setReviewReminder({ userId: p.userId, regulationId: p.regulationId, reviewDate: p.reviewDate, assignedTo: p.assignedTo });
            return trackCompliance({ userId: p.userId, organizationId: p.organizationId, regulationId: p.regulationId, status: p.status, notes: p.notes, reviewDate: p.reviewDate });
        },

        govRisk: async (task) => {
            const { registerRisk, updateRiskStatus, getRiskRegister, runComplianceCheck } = require("./governance/riskComplianceAI.cjs");
            const p = task.payload || {};
            if (task.type === "gov_risk_register")   return getRiskRegister({ userId: p.userId, organizationId: p.organizationId, band: p.band, category: p.category, status: p.status });
            if (task.type === "gov_risk_update")      return updateRiskStatus({ userId: p.userId, organizationId: p.organizationId, riskId: p.riskId, status: p.status, mitigationUpdate: p.mitigationUpdate, notes: p.notes });
            if (task.type === "gov_compliance_check") return runComplianceCheck({ userId: p.userId, organizationId: p.organizationId, checkItems: p.checkItems });
            return registerRisk({ userId: p.userId, organizationId: p.organizationId, title: p.title || task.input, description: p.description, category: p.category, likelihood: p.likelihood, impact: p.impact, owner: p.owner, mitigationPlan: p.mitigationPlan, dueDate: p.dueDate });
        },

        govVoting: async (task) => {
            const { createProposal, castVote, closeProposal, getProposals } = require("./governance/governanceVotingAI.cjs");
            const p = task.payload || {};
            if (task.type === "gov_vote")              return castVote({ userId: p.userId, organizationId: p.organizationId, proposalId: p.proposalId, choice: p.choice, weight: p.weight, comment: p.comment });
            if (task.type === "gov_close_proposal")    return closeProposal({ userId: p.userId, organizationId: p.organizationId, proposalId: p.proposalId, forceClose: p.forceClose });
            if (task.type === "gov_get_proposals")     return getProposals({ userId: p.userId, organizationId: p.organizationId, status: p.status });
            return createProposal({ userId: p.userId, organizationId: p.organizationId, title: p.title || task.input, description: p.description, voteType: p.voteType, quorumPct: p.quorumPct, totalEligibleVoters: p.totalEligibleVoters, deadline: p.deadline });
        },

        govDAO: async (task) => {
            const { createDAO, addMember, recordTreasuryAction, getDAOInfo } = require("./governance/daoManager.cjs");
            const p = task.payload || {};
            if (task.type === "gov_dao_info")     return getDAOInfo({ userId: p.userId, daoId: p.daoId });
            if (task.type === "gov_dao_member")   return addMember({ userId: p.userId, daoId: p.daoId, newMemberId: p.newMemberId, role: p.role, votingWeight: p.votingWeight });
            if (task.type === "gov_dao_treasury") return recordTreasuryAction({ userId: p.userId, daoId: p.daoId, action: p.action, amount: p.amount, currency: p.currency, recipient: p.recipient, description: p.description, signatures: p.signatures });
            return createDAO({ userId: p.userId, name: p.name || task.input, type: p.type, description: p.description, tokenSymbol: p.tokenSymbol, initialMembers: p.initialMembers, governanceRules: p.governanceRules });
        },

        govTransparency: async (task) => {
            const { publishDisclosure, getDisclosures, recordStakeholderEngagement, getTransparencyScore } = require("./governance/transparencyEngine.cjs");
            const p = task.payload || {};
            if (task.type === "gov_disclosures")       return getDisclosures({ userId: p.userId, organizationId: p.organizationId, type: p.type, fromDate: p.fromDate, isPublicOnly: p.isPublicOnly });
            if (task.type === "gov_engage")             return recordStakeholderEngagement({ userId: p.userId, organizationId: p.organizationId, stakeholderGroup: p.stakeholderGroup, channel: p.channel, summary: p.summary, actionItems: p.actionItems, date: p.date });
            if (task.type === "gov_transparency_score") return getTransparencyScore({ userId: p.userId, organizationId: p.organizationId });
            return publishDisclosure({ userId: p.userId, organizationId: p.organizationId, type: p.type, title: p.title || task.input, summary: p.summary, content: p.content, period: p.period, isPublic: p.isPublic });
        },

        govEthics: async (task) => {
            const { assessAISystem, logAIDecision, getEthicsAssessments, getPrinciples } = require("./governance/ethicsAIMonitor.cjs");
            const p = task.payload || {};
            if (task.type === "gov_ethics_principles")   return getPrinciples();
            if (task.type === "gov_ethics_log")          return logAIDecision({ userId: p.userId, systemName: p.systemName, decision: p.decision, explanation: p.explanation, affectedUserId: p.affectedUserId, confidence: p.confidence, humanReviewed: p.humanReviewed });
            if (task.type === "gov_ethics_history")      return getEthicsAssessments({ userId: p.userId, limit: p.limit });
            return assessAISystem({ userId: p.userId, systemName: p.systemName || task.input, description: p.description, useCases: p.useCases, dataInputs: p.dataInputs, outputTypes: p.outputTypes, hasHumanOversight: p.hasHumanOversight, isExplainable: p.isExplainable, processesPersonalData: p.processesPersonalData, affectsHighStakesDomains: p.affectsHighStakesDomains });
        },

        govBlockchain: async (task) => {
            const { hashAndRecord, verifyRecord, getRecords, getSupportedNetworks } = require("./governance/blockchainVerification.cjs");
            const p = task.payload || {};
            if (task.type === "gov_blockchain_verify")   return verifyRecord({ userId: p.userId, recordId: p.recordId, originalData: p.originalData });
            if (task.type === "gov_blockchain_records")  return getRecords({ userId: p.userId, network: p.network, label: p.label, limit: p.limit });
            if (task.type === "gov_blockchain_networks") return getSupportedNetworks();
            return hashAndRecord({ userId: p.userId, data: p.data || task.input, network: p.network, label: p.label });
        },

        govSmartContract: async (task) => {
            const { getTemplate, auditContract, simulateDeploy, getSecurityChecklist } = require("./governance/smartContractAgent.cjs");
            const p = task.payload || {};
            if (task.type === "gov_contract_templates") return getTemplate({ userId: p.userId });
            if (task.type === "gov_contract_audit")     return auditContract({ userId: p.userId, contractCode: p.contractCode, contractName: p.contractName });
            if (task.type === "gov_contract_deploy")    return simulateDeploy({ userId: p.userId, contractName: p.contractName, network: p.network, constructorArgs: p.constructorArgs, gasEstimate: p.gasEstimate });
            if (task.type === "gov_contract_checklist") return getSecurityChecklist();
            return getTemplate({ userId: p.userId, templateKey: p.templateKey || task.input });
        },

        govWallet: async (task) => {
            const { createWallet, recordTransaction, getWallets, getSecurityGuide } = require("./governance/cryptoWalletManager.cjs");
            const p = task.payload || {};
            if (task.type === "gov_wallet_list")    return getWallets({ userId: p.userId, network: p.network, tier: p.tier });
            if (task.type === "gov_wallet_txn")     return recordTransaction({ userId: p.userId, walletId: p.walletId, type: p.type, amount: p.amount, toAddress: p.toAddress, fromAddress: p.fromAddress, network: p.network, txHash: p.txHash, note: p.note });
            if (task.type === "gov_wallet_guide")   return getSecurityGuide();
            return createWallet({ userId: p.userId, network: p.network, label: p.label, tier: p.tier, tags: p.tags });
        },

        // ── Intelligence Layer ─────────────────────────────────────────────

        intelligence: async (task) => {
            const { runPipeline, getPipelineHistory, getPipelineConfig } = require("./intelligence/agiSimulationCore.cjs");
            const p = task.payload || {};
            if (task.type === "intel_history") return getPipelineHistory({ userId: p.userId, limit: p.limit });
            if (task.type === "intel_config")  return getPipelineConfig();
            return runPipeline({ userId: p.userId, goal: p.goal || task.input, domain: p.domain, options: p.options });
        },

        intelThink: async (task) => {
            const { generateThoughts, getThinkingFrames } = require("./intelligence/thoughtGenerator.cjs");
            const p = task.payload || {};
            if (task.type === "intel_frames") return getThinkingFrames();
            return generateThoughts({ userId: p.userId, goal: p.goal || task.input, domain: p.domain, maxIdeas: p.maxIdeas });
        },

        intelCreate: async (task) => {
            const { enhanceIdeas, brainstorm } = require("./intelligence/creativityEngine.cjs");
            const p = task.payload || {};
            if (task.type === "intel_brainstorm") return brainstorm({ userId: p.userId, topic: p.topic || task.input, technique: p.technique, count: p.count });
            return enhanceIdeas({ userId: p.userId, ideas: p.ideas, goal: p.goal || task.input, iterations: p.iterations });
        },

        intelHypothesis: async (task) => {
            const { generateHypotheses, getHypothesisTemplates } = require("./intelligence/hypothesisGenerator.cjs");
            const p = task.payload || {};
            if (task.type === "intel_hyp_templates") return getHypothesisTemplates();
            return generateHypotheses({ userId: p.userId, goal: p.goal || task.input, ideas: p.ideas, count: p.count });
        },

        intelValidate: async (task) => {
            const { validateIdeas, validateSingleIdea } = require("./intelligence/ideaValidator.cjs");
            const p = task.payload || {};
            if (task.type === "intel_validate_one") return validateSingleIdea({ userId: p.userId, idea: p.idea || task.input });
            return validateIdeas({ userId: p.userId, ideas: p.ideas, goal: p.goal || task.input });
        },

        intelExperiment: async (task) => {
            const { simulateExperiment, simulateBatch } = require("./intelligence/experimentSimulator.cjs");
            const p = task.payload || {};
            if (task.type === "intel_exp_batch") return simulateBatch({ userId: p.userId, hypotheses: p.hypotheses, priorScore: p.priorScore });
            return simulateExperiment({ userId: p.userId, hypothesis: p.hypothesis || task.input, priorValidationScore: p.priorValidationScore });
        },

        intelReason: async (task) => {
            const { reason, getReasoningModes } = require("./intelligence/advancedReasoningCore.cjs");
            const p = task.payload || {};
            if (task.type === "intel_reason_modes") return getReasoningModes();
            return reason({ userId: p.userId, goal: p.goal || task.input, pipelineOutput: p.pipelineOutput });
        },

        intelReflect: async (task) => {
            const { reflect, getBiasGuide } = require("./intelligence/selfReflectionAI.cjs");
            const p = task.payload || {};
            if (task.type === "intel_bias_guide") return getBiasGuide();
            return reflect({ userId: p.userId, goal: p.goal || task.input, reasoningOutput: p.reasoningOutput });
        },

        intelMemory: async (task) => {
            const { storeLearning, recallLearnings, evolveMemory, getMemoryStats } = require("./intelligence/memoryEvolutionEngine.cjs");
            const p = task.payload || {};
            if (task.type === "intel_mem_recall")  return recallLearnings({ userId: p.userId, query: p.query || task.input, type: p.type, minStrength: p.minStrength, limit: p.limit });
            if (task.type === "intel_mem_evolve")  return evolveMemory({ userId: p.userId });
            if (task.type === "intel_mem_stats")   return getMemoryStats({ userId: p.userId });
            return storeLearning({ userId: p.userId, goal: p.goal, type: p.type, content: p.content || task.input, score: p.score, tags: p.tags });
        },

        intelMultiBrain: async (task) => {
            const { think, getBrainModes } = require("./intelligence/multiBrainSystem.cjs");
            const p = task.payload || {};
            if (task.type === "intel_brain_modes") return getBrainModes();
            return think({ userId: p.userId, goal: p.goal || task.input, ideas: p.ideas, modes: p.modes });
        },

        intelParallel: async (task) => {
            const { processParallel, getParallelConfig } = require("./intelligence/parallelThinkingEngine.cjs");
            const p = task.payload || {};
            if (task.type === "intel_parallel_config") return getParallelConfig();
            return processParallel({ userId: p.userId, ideas: p.ideas, strategy: p.strategy, maxStreams: p.maxStreams });
        },

        intelAmplify: async (task) => {
            const { amplify, getTechniques } = require("./intelligence/intelligenceAmplifier.cjs");
            const p = task.payload || {};
            if (task.type === "intel_amp_techniques") return getTechniques();
            return amplify({ userId: p.userId, reasoning: p.reasoning || task.input, goal: p.goal, level: p.level });
        },

        intelCuriosity: async (task) => {
            const { generateQuestions, getExplorationSeeds } = require("./intelligence/curiosityEngine.cjs");
            const p = task.payload || {};
            if (task.type === "intel_curiosity_seeds") return getExplorationSeeds({ userId: p.userId, topic: p.topic || task.input });
            return generateQuestions({ userId: p.userId, topic: p.topic || task.input, types: p.types, count: p.count });
        },

        intelExplore: async (task) => {
            const { explore, getExplorationStrategies } = require("./intelligence/explorationAI.cjs");
            const p = task.payload || {};
            if (task.type === "intel_explore_strategies") return getExplorationStrategies();
            return explore({ userId: p.userId, concept: p.concept || task.input, strategy: p.strategy, maxDepth: p.maxDepth, domain: p.domain });
        },

        intelLearn: async (task) => {
            const { extractLessons, getLessonLibrary, applyLessons } = require("./intelligence/learningAgent.cjs");
            const p = task.payload || {};
            if (task.type === "intel_lesson_library") return getLessonLibrary({ userId: p.userId, category: p.category, limit: p.limit });
            if (task.type === "intel_apply_lessons")  return applyLessons({ userId: p.userId, goal: p.goal || task.input });
            return extractLessons({ userId: p.userId, goal: p.goal || task.input, pipelineOutput: p.pipelineOutput });
        },

        intelInnovate: async (task) => {
            const { buildInnovationPlan, advanceStage, getInnovationTypes } = require("./intelligence/innovationPipeline.cjs");
            const p = task.payload || {};
            if (task.type === "intel_innovation_types") return getInnovationTypes();
            if (task.type === "intel_stage_advance")    return advanceStage({ userId: p.userId, planId: p.planId, stageId: p.stageId, evidence: p.evidence, outcome: p.outcome });
            return buildInnovationPlan({ userId: p.userId, goal: p.goal || task.input, ideas: p.ideas, type: p.type });
        },

        intelScience: async (task) => {
            const { frameDiscovery, getScientificMethod } = require("./intelligence/scientificDiscoveryAI.cjs");
            const p = task.payload || {};
            if (task.type === "intel_sci_method") return getScientificMethod();
            return frameDiscovery({ userId: p.userId, phenomenon: p.phenomenon || task.input, domain: p.domain, discoveryType: p.discoveryType, insights: p.insights });
        },

        intelResearch: async (task) => {
            const { generatePaperOutline, getPaperStructure } = require("./intelligence/researchPaperWriter.cjs");
            const p = task.payload || {};
            if (task.type === "intel_paper_structure") return getPaperStructure();
            return generatePaperOutline({ userId: p.userId, title: p.title || task.input, domain: p.domain, hypothesis: p.hypothesis, insights: p.insights, methodology: p.methodology, citationStyle: p.citationStyle });
        },

        intelQuantum: async (task) => {
            const { superpose, tunnel, getQuantumPrinciples } = require("./intelligence/quantumInterface.cjs");
            const p = task.payload || {};
            if (task.type === "intel_quantum_principles") return getQuantumPrinciples();
            if (task.type === "intel_quantum_tunnel")     return tunnel({ userId: p.userId, idea: p.idea || task.input, barrierDescription: p.barrierDescription });
            return superpose({ userId: p.userId, ideas: p.ideas, goal: p.goal || task.input });
        },

        // ── HumanAI Layer ─────────────────────────────────────────────
        humanBCI: async (task) => {
            const { simulateSignalReading, getSignalHistory, getSupportedSignals } = require("./humanAI/brainComputerInterfaceAgent.cjs");
            const p = task.payload || {};
            if (task.type === "hai_bci_history")  return getSignalHistory({ userId: p.userId, consent: p.consent, limit: p.limit });
            if (task.type === "hai_bci_signals")  return getSupportedSignals();
            return simulateSignalReading({ userId: p.userId, consent: p.consent, signalType: p.signalType, intentText: p.intentText || task.input });
        },

        humanNeuralLink: async (task) => {
            const { initLink, transmitSignal, getLinkStatus, getSupportedProtocols } = require("./humanAI/neuralLinkSimulation.cjs");
            const p = task.payload || {};
            if (task.type === "hai_nl_transmit")  return transmitSignal({ userId: p.userId, consent: p.consent, linkId: p.linkId, signalPayload: p.signalPayload || task.input, direction: p.direction });
            if (task.type === "hai_nl_status")    return getLinkStatus({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_nl_protocols") return getSupportedProtocols();
            return initLink({ userId: p.userId, consent: p.consent, protocol: p.protocol, deviceId: p.deviceId });
        },

        humanThought: async (task) => {
            const { decodeThought, getThoughtHistory, getCognitiveModes } = require("./humanAI/thoughtToTextAgent.cjs");
            const p = task.payload || {};
            if (task.type === "hai_thought_history") return getThoughtHistory({ userId: p.userId, consent: p.consent, limit: p.limit });
            if (task.type === "hai_thought_modes")   return getCognitiveModes();
            return decodeThought({ userId: p.userId, consent: p.consent, rawThought: p.rawThought || task.input, cognitiveMode: p.cognitiveMode });
        },

        humanEmotion: async (task) => {
            const { detectEmotion, syncEmotionToTarget, getEmotionHistory, getSupportedEmotions } = require("./humanAI/emotionSyncEngine.cjs");
            const p = task.payload || {};
            if (task.type === "hai_emotion_sync")    return syncEmotionToTarget({ userId: p.userId, consent: p.consent, emotionId: p.emotionId, targets: p.targets });
            if (task.type === "hai_emotion_history") return getEmotionHistory({ userId: p.userId, consent: p.consent, limit: p.limit });
            if (task.type === "hai_emotion_list")    return getSupportedEmotions();
            return detectEmotion({ userId: p.userId, consent: p.consent, inputText: p.inputText || task.input, contextTags: p.contextTags });
        },

        humanPersonality: async (task) => {
            const { buildPersonalityProfile, simulateResponse, listProfiles, deleteProfile } = require("./humanAI/personalityCloneAI.cjs");
            const p = task.payload || {};
            if (task.type === "hai_personality_respond") return simulateResponse({ userId: p.userId, consent: p.consent, profileId: p.profileId, prompt: p.prompt || task.input });
            if (task.type === "hai_personality_list")    return listProfiles({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_personality_delete")  return deleteProfile({ userId: p.userId, consent: p.consent, profileId: p.profileId });
            return buildPersonalityProfile({ userId: p.userId, consent: p.consent, traitInputs: p.traitInputs, profileName: p.profileName });
        },

        humanTwin: async (task) => {
            const { createTwin, syncTwin, queryTwin, listTwins } = require("./humanAI/digitalTwinCreator.cjs");
            const p = task.payload || {};
            if (task.type === "hai_twin_sync")  return syncTwin({ userId: p.userId, consent: p.consent, twinId: p.twinId, dataSnapshot: p.dataSnapshot });
            if (task.type === "hai_twin_query") return queryTwin({ userId: p.userId, consent: p.consent, twinId: p.twinId, query: p.query || task.input });
            if (task.type === "hai_twin_list")  return listTwins({ userId: p.userId, consent: p.consent });
            return createTwin({ userId: p.userId, consent: p.consent, twinName: p.twinName, fidelity: p.fidelity, enabledLayers: p.enabledLayers });
        },

        humanMemory: async (task) => {
            const { backupMemory, recallMemory, searchMemories, deleteMemory, getMemoryStats } = require("./humanAI/memoryBackupAI.cjs");
            const p = task.payload || {};
            if (task.type === "hai_memory_recall")  return recallMemory({ userId: p.userId, consent: p.consent, memoryId: p.memoryId });
            if (task.type === "hai_memory_search")  return searchMemories({ userId: p.userId, consent: p.consent, query: p.query || task.input, memoryType: p.memoryType, limit: p.limit });
            if (task.type === "hai_memory_delete")  return deleteMemory({ userId: p.userId, consent: p.consent, memoryId: p.memoryId, confirm: p.confirm });
            if (task.type === "hai_memory_stats")   return getMemoryStats({ userId: p.userId, consent: p.consent });
            return backupMemory({ userId: p.userId, consent: p.consent, memoryType: p.memoryType, content: p.content || task.input, retentionTier: p.retentionTier, tags: p.tags });
        },

        humanLifeLog: async (task) => {
            const { logEvent, queryLog, getLifeSummary, deleteEvent } = require("./humanAI/lifeLoggerAgent.cjs");
            const p = task.payload || {};
            if (task.type === "hai_lifelog_query")   return queryLog({ userId: p.userId, consent: p.consent, category: p.category, tags: p.tags, startDate: p.startDate, endDate: p.endDate, limit: p.limit });
            if (task.type === "hai_lifelog_summary") return getLifeSummary({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_lifelog_delete")  return deleteEvent({ userId: p.userId, consent: p.consent, eventId: p.eventId, confirm: p.confirm });
            return logEvent({ userId: p.userId, consent: p.consent, category: p.category, title: p.title || task.input, description: p.description, tags: p.tags, privacyLevel: p.privacyLevel, metadata: p.metadata });
        },

        humanHistory: async (task) => {
            const { addChapter, getTimeline, generateBiography, deleteChapter } = require("./humanAI/personalHistoryAI.cjs");
            const p = task.payload || {};
            if (task.type === "hai_history_timeline")  return getTimeline({ userId: p.userId, consent: p.consent, eraTag: p.eraTag, startYear: p.startYear, endYear: p.endYear });
            if (task.type === "hai_history_biography") return generateBiography({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_history_delete")    return deleteChapter({ userId: p.userId, consent: p.consent, chapterId: p.chapterId, confirm: p.confirm });
            return addChapter({ userId: p.userId, consent: p.consent, eraTag: p.eraTag, title: p.title || task.input, narrative: p.narrative, year: p.year, emotionalWeight: p.emotionalWeight, tags: p.tags });
        },

        humanLegacy: async (task) => {
            const { addLegacyEntry, getLegacyArchive, generateLegacySummary, deleteEntry } = require("./humanAI/legacyAISystem.cjs");
            const p = task.payload || {};
            if (task.type === "hai_legacy_archive")  return getLegacyArchive({ userId: p.userId, consent: p.consent, legacyType: p.legacyType, audience: p.audience });
            if (task.type === "hai_legacy_summary")  return generateLegacySummary({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_legacy_delete")   return deleteEntry({ userId: p.userId, consent: p.consent, entryId: p.entryId, confirm: p.confirm });
            return addLegacyEntry({ userId: p.userId, consent: p.consent, legacyType: p.legacyType, audience: p.audience, content: p.content || task.input, title: p.title, scheduledReleaseDate: p.scheduledReleaseDate });
        },

        humanVoice: async (task) => {
            const { createVoiceProfile, synthesiseSpeech, listVoiceProfiles } = require("./humanAI/voicePersonalityClone.cjs");
            const p = task.payload || {};
            if (task.type === "hai_voice_speak")  return synthesiseSpeech({ userId: p.userId, consent: p.consent, profileId: p.profileId, text: p.text || task.input, emotionalOverlay: p.emotionalOverlay });
            if (task.type === "hai_voice_list")   return listVoiceProfiles({ userId: p.userId, consent: p.consent });
            return createVoiceProfile({ userId: p.userId, consent: p.consent, profileName: p.profileName, archetype: p.archetype, speechStyle: p.speechStyle, customTraits: p.customTraits });
        },

        humanBehaviour: async (task) => {
            const { buildBehaviourModel, simulateScenario, listModels } = require("./humanAI/behaviourSimulationAI.cjs");
            const p = task.payload || {};
            if (task.type === "hai_behaviour_simulate") return simulateScenario({ userId: p.userId, consent: p.consent, modelId: p.modelId, scenarioType: p.scenarioType, scenarioDescription: p.scenarioDescription || task.input });
            if (task.type === "hai_behaviour_list")     return listModels({ userId: p.userId, consent: p.consent });
            return buildBehaviourModel({ userId: p.userId, consent: p.consent, modelName: p.modelName, domainInputs: p.domainInputs, traits: p.traits });
        },

        humanIdentity: async (task) => {
            const { buildIdentitySnapshot, compareSnapshots, listSnapshots, deleteSnapshot } = require("./humanAI/identityReplicationAgent.cjs");
            const p = task.payload || {};
            if (task.type === "hai_identity_compare") return compareSnapshots({ userId: p.userId, consent: p.consent, snapshotIdA: p.snapshotIdA, snapshotIdB: p.snapshotIdB });
            if (task.type === "hai_identity_list")    return listSnapshots({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_identity_delete")  return deleteSnapshot({ userId: p.userId, consent: p.consent, snapshotId: p.snapshotId, confirm: p.confirm });
            return buildIdentitySnapshot({ userId: p.userId, consent: p.consent, snapshotLabel: p.snapshotLabel, components: p.components, selfDescription: p.selfDescription || task.input });
        },

        humanAvatar: async (task) => {
            const { createAvatar, interactWithAvatar, getAvatarState, listAvatars } = require("./humanAI/avatarConsciousAI.cjs");
            const p = task.payload || {};
            if (task.type === "hai_avatar_interact") return interactWithAvatar({ userId: p.userId, consent: p.consent, avatarId: p.avatarId, input: p.input || task.input, contextMood: p.contextMood });
            if (task.type === "hai_avatar_state")    return getAvatarState({ userId: p.userId, consent: p.consent, avatarId: p.avatarId });
            if (task.type === "hai_avatar_list")     return listAvatars({ userId: p.userId, consent: p.consent });
            return createAvatar({ userId: p.userId, consent: p.consent, avatarName: p.avatarName, archetype: p.archetype, consciousnessLevel: p.consciousnessLevel, expressionModes: p.expressionModes });
        },

        humanVirtualHuman: async (task) => {
            const { createVirtualHuman, animateVirtualHuman, listVirtualHumans } = require("./humanAI/virtualHumanCreator.cjs");
            const p = task.payload || {};
            if (task.type === "hai_vh_animate") return animateVirtualHuman({ userId: p.userId, consent: p.consent, humanId: p.humanId, script: p.script || task.input, emotion: p.emotion, durationSec: p.durationSec });
            if (task.type === "hai_vh_list")    return listVirtualHumans({ userId: p.userId, consent: p.consent });
            return createVirtualHuman({ userId: p.userId, consent: p.consent, humanName: p.humanName, appearancePreset: p.appearancePreset, personalityBase: p.personalityBase, languages: p.languages, backstory: p.backstory });
        },

        humanMetaverse: async (task) => {
            const { createMetaverseSpace, spawnAvatar, getSpaceAnalytics, listSpaces } = require("./humanAI/metaverseAgent.cjs");
            const p = task.payload || {};
            if (task.type === "hai_meta_spawn")     return spawnAvatar({ userId: p.userId, consent: p.consent, spaceId: p.spaceId, avatarStyle: p.avatarStyle, displayName: p.displayName, interactionTypes: p.interactionTypes });
            if (task.type === "hai_meta_analytics") return getSpaceAnalytics({ userId: p.userId, consent: p.consent, spaceId: p.spaceId });
            if (task.type === "hai_meta_list")      return listSpaces({ userId: p.userId, consent: p.consent });
            return createMetaverseSpace({ userId: p.userId, consent: p.consent, spaceName: p.spaceName || task.input, worldType: p.worldType, maxOccupants: p.maxOccupants, features: p.features });
        },

        humanImmortality: async (task) => {
            const { createPreservationRecord, getVault, getVaultSummary, revokeRecord } = require("./humanAI/digitalImmortalitySystem.cjs");
            const p = task.payload || {};
            if (task.type === "hai_immortal_vault")   return getVault({ userId: p.userId, consent: p.consent, preservationType: p.preservationType });
            if (task.type === "hai_immortal_summary") return getVaultSummary({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_immortal_revoke")  return revokeRecord({ userId: p.userId, consent: p.consent, recordId: p.recordId, confirm: p.confirm });
            return createPreservationRecord({ userId: p.userId, consent: p.consent, preservationType: p.preservationType, title: p.title || task.input, content: p.content, activationCondition: p.activationCondition, trusteeName: p.trusteeName });
        },

        humanCompanion: async (task) => {
            const { createCompanion, startSession, getCompanionHistory, listCompanions } = require("./humanAI/aiCompanionPro.cjs");
            const p = task.payload || {};
            if (task.type === "hai_companion_chat")    return startSession({ userId: p.userId, consent: p.consent, companionId: p.companionId, sessionType: p.sessionType, userMessage: p.userMessage || task.input });
            if (task.type === "hai_companion_history") return getCompanionHistory({ userId: p.userId, consent: p.consent, companionId: p.companionId, limit: p.limit });
            if (task.type === "hai_companion_list")    return listCompanions({ userId: p.userId, consent: p.consent });
            return createCompanion({ userId: p.userId, consent: p.consent, companionName: p.companionName, role: p.role, primaryMoodState: p.primaryMoodState, personalityTraits: p.personalityTraits });
        },

        humanRelationship: async (task) => {
            const { createRelationshipSim, practiceScenario, getDynamicsReport, listSims } = require("./humanAI/relationshipSimulationAI.cjs");
            const p = task.payload || {};
            if (task.type === "hai_rel_practice") return practiceScenario({ userId: p.userId, consent: p.consent, simId: p.simId, scenarioContext: p.scenarioContext, userInput: p.userInput || task.input });
            if (task.type === "hai_rel_dynamics") return getDynamicsReport({ userId: p.userId, consent: p.consent, simId: p.simId });
            if (task.type === "hai_rel_list")     return listSims({ userId: p.userId, consent: p.consent });
            return createRelationshipSim({ userId: p.userId, consent: p.consent, simName: p.simName, relationshipType: p.relationshipType, dynamicWeights: p.dynamicWeights, persona: p.persona });
        },

        humanEQ: async (task) => {
            const { assessEQ, getEQProgress, getEQCoachingTip } = require("./humanAI/emotionalIntelligenceCore.cjs");
            const p = task.payload || {};
            if (task.type === "hai_eq_progress") return getEQProgress({ userId: p.userId, consent: p.consent });
            if (task.type === "hai_eq_tip")      return getEQCoachingTip({ userId: p.userId, consent: p.consent, domain: p.domain });
            return assessEQ({ userId: p.userId, consent: p.consent, selfResponses: p.selfResponses });
        },

        // ── Metaverse Layer ───────────────────────────────────────────
        metaWorld: async (task) => {
            const { createWorld, getWorld, updateWorld, deleteWorld, listWorlds } = require("../modules/metaverse/metaverseBuilder.cjs");
            const p = task.payload || {};
            if (task.type === "meta_world_get")    return getWorld({ worldId: p.worldId });
            if (task.type === "meta_world_update") return updateWorld({ userId: p.userId, worldId: p.worldId, updates: p.updates });
            if (task.type === "meta_world_delete") return deleteWorld({ userId: p.userId, worldId: p.worldId, confirm: p.confirm });
            if (task.type === "meta_world_list")   return listWorlds({ userId: p.userId, worldType: p.worldType, theme: p.theme, status: p.status });
            return createWorld({ userId: p.userId, worldName: p.worldName || task.input, worldType: p.worldType, theme: p.theme, maxUsers: p.maxUsers, physics: p.physics, settings: p.settings });
        },

        metaScene: async (task) => {
            const { generateScene, getSceneTemplate, addSceneObject } = require("../modules/metaverse/worldGenerator3D.cjs");
            const p = task.payload || {};
            if (task.type === "meta_scene_template") return getSceneTemplate({ worldType: p.worldType, theme: p.theme });
            if (task.type === "meta_scene_add_obj")  return addSceneObject({ worldId: p.worldId, userId: p.userId, objectType: p.objectType, position: p.position, color: p.color, metadata: p.metadata });
            return generateScene({ worldId: p.worldId, objectCount: p.objectCount });
        },

        metaAvatar: async (task) => {
            const { createAvatar, getAvatar, updateTransform, setAnimation, equipAccessory, leaveWorld } = require("../modules/metaverse/avatarController3D.cjs");
            const p = task.payload || {};
            if (task.type === "meta_avatar_get")       return getAvatar({ userId: p.userId, worldId: p.worldId });
            if (task.type === "meta_avatar_move")      return updateTransform({ userId: p.userId, worldId: p.worldId, position: p.position, rotation: p.rotation, scale: p.scale });
            if (task.type === "meta_avatar_animate")   return setAnimation({ userId: p.userId, worldId: p.worldId, animation: p.animation });
            if (task.type === "meta_avatar_equip")     return equipAccessory({ userId: p.userId, worldId: p.worldId, slot: p.slot, itemId: p.itemId });
            if (task.type === "meta_avatar_leave")     return leaveWorld({ userId: p.userId, worldId: p.worldId });
            return createAvatar({ userId: p.userId, worldId: p.worldId, displayName: p.displayName || task.input, model: p.model, color: p.color, accessories: p.accessories });
        },

        metaVR: async (task) => {
            const { dispatchInteraction, getInteractionHistory, getXRCapabilities, sendHapticFeedback } = require("../modules/metaverse/vrInteractionAgent.cjs");
            const p = task.payload || {};
            if (task.type === "meta_vr_history")  return getInteractionHistory({ worldId: p.worldId, userId: p.userId, eventType: p.eventType, limit: p.limit });
            if (task.type === "meta_vr_caps")     return getXRCapabilities({ xrMode: p.xrMode });
            if (task.type === "meta_vr_haptic")   return sendHapticFeedback({ userId: p.userId, worldId: p.worldId, intensity: p.intensity, durationMs: p.durationMs, hand: p.hand });
            return dispatchInteraction({ userId: p.userId, worldId: p.worldId, inputType: p.inputType, eventType: p.eventType, targetObjectId: p.targetObjectId, position: p.position, payload: p.payload });
        },

        metaOffice: async (task) => {
            const { createOffice, setPresenceStatus, postAnnouncement, getOfficeState } = require("../modules/metaverse/virtualOfficeAI.cjs");
            const p = task.payload || {};
            if (task.type === "meta_office_presence")    return setPresenceStatus({ userId: p.userId, officeId: p.officeId, status: p.status, roomId: p.roomId });
            if (task.type === "meta_office_announce")    return postAnnouncement({ userId: p.userId, officeId: p.officeId, message: p.message || task.input, priority: p.priority });
            if (task.type === "meta_office_state")       return getOfficeState({ officeId: p.officeId });
            return createOffice({ userId: p.userId, officeName: p.officeName || task.input, teamSize: p.teamSize, rooms: p.rooms, tools: p.tools });
        },

        metaClassroom: async (task) => {
            const { createClassroom, enrollStudent, startSession, submitAssignment, getClassroomState } = require("../modules/metaverse/virtualClassroom.cjs");
            const p = task.payload || {};
            if (task.type === "meta_class_enroll")   return enrollStudent({ classroomId: p.classroomId, studentId: p.studentId, displayName: p.displayName });
            if (task.type === "meta_class_session")  return startSession({ classroomId: p.classroomId, instructorId: p.instructorId, sessionTitle: p.sessionTitle || task.input, mediaType: p.mediaType, mediaUrl: p.mediaUrl });
            if (task.type === "meta_class_submit")   return submitAssignment({ classroomId: p.classroomId, studentId: p.studentId, sessionId: p.sessionId, content: p.content || task.input });
            if (task.type === "meta_class_state")    return getClassroomState({ classroomId: p.classroomId });
            return createClassroom({ userId: p.userId, className: p.className || task.input, subject: p.subject, maxStudents: p.maxStudents, roomMode: p.roomMode, seatLayout: p.seatLayout });
        },

        metaMarket: async (task) => {
            const { listAsset, searchListings, purchaseAsset, delistAsset } = require("../modules/metaverse/digitalMarketplace.cjs");
            const p = task.payload || {};
            if (task.type === "meta_market_search")    return searchListings({ query: p.query || task.input, category: p.category, currency: p.currency, maxPrice: p.maxPrice, limit: p.limit, offset: p.offset });
            if (task.type === "meta_market_buy")       return purchaseAsset({ buyerId: p.buyerId, listingId: p.listingId, quantity: p.quantity });
            if (task.type === "meta_market_delist")    return delistAsset({ sellerId: p.sellerId, listingId: p.listingId });
            return listAsset({ sellerId: p.sellerId, assetId: p.assetId, assetName: p.assetName || task.input, category: p.category, price: p.price, currency: p.currency, description: p.description, imageUrl: p.imageUrl, quantity: p.quantity });
        },

        metaNFT: async (task) => {
            const { generateNFT, createCollection, getUserNFTs } = require("../modules/metaverse/nftGeneratorAI.cjs");
            const p = task.payload || {};
            if (task.type === "meta_nft_collection") return createCollection({ creatorId: p.creatorId, collectionName: p.collectionName || task.input, symbol: p.symbol, maxSupply: p.maxSupply, description: p.description, royaltyPercent: p.royaltyPercent });
            if (task.type === "meta_nft_list")       return getUserNFTs({ userId: p.userId, limit: p.limit });
            return generateNFT({ creatorId: p.creatorId, collectionId: p.collectionId, name: p.name || task.input, description: p.description, externalUrl: p.externalUrl, traitOverrides: p.traitOverrides, standard: p.standard, royaltyPercent: p.royaltyPercent });
        },

        metaNFTTrade: async (task) => {
            const { createListing, buyNFT, placeBid, getTradeHistory } = require("../modules/metaverse/nftTradingAgent.cjs");
            const p = task.payload || {};
            if (task.type === "meta_nft_buy")     return buyNFT({ buyerId: p.buyerId, orderId: p.orderId });
            if (task.type === "meta_nft_bid")     return placeBid({ bidderId: p.bidderId, orderId: p.orderId, bidAmount: p.bidAmount, currency: p.currency });
            if (task.type === "meta_nft_trades")  return getTradeHistory({ userId: p.userId, limit: p.limit });
            return createListing({ sellerId: p.sellerId, tokenId: p.tokenId, price: p.price, currency: p.currency, orderType: p.orderType, auctionEndAt: p.auctionEndAt });
        },

        metaLand: async (task) => {
            const { claimLand, listLandForSale, purchaseLand, getUserLands } = require("../modules/metaverse/virtualLandManager.cjs");
            const p = task.payload || {};
            if (task.type === "meta_land_sell")     return listLandForSale({ ownerId: p.ownerId, plotId: p.plotId, salePrice: p.salePrice, currency: p.currency });
            if (task.type === "meta_land_buy")      return purchaseLand({ buyerId: p.buyerId, plotId: p.plotId });
            if (task.type === "meta_land_list")     return getUserLands({ userId: p.userId, worldId: p.worldId });
            return claimLand({ userId: p.userId, worldId: p.worldId, x: p.x, z: p.z, width: p.width, depth: p.depth, plotName: p.plotName, zone: p.zone });
        },

        metaGesture: async (task) => {
            const { recogniseGesture, getGestureLibrary, mapGestureToAction } = require("../modules/metaverse/gestureRecognition.cjs");
            const p = task.payload || {};
            if (task.type === "meta_gesture_library") return getGestureLibrary();
            if (task.type === "meta_gesture_map")     return mapGestureToAction({ gesture: p.gesture || task.input });
            return recogniseGesture({ userId: p.userId, worldId: p.worldId, gestureData: p.gestureData, handedness: p.handedness });
        },

        metaMocap: async (task) => {
            const { ingestFrame, detectMotionAction, getSessionRecap } = require("../modules/metaverse/motionCaptureAgent.cjs");
            const p = task.payload || {};
            if (task.type === "meta_mocap_detect") return detectMotionAction({ userId: p.userId, worldId: p.worldId });
            if (task.type === "meta_mocap_recap")  return getSessionRecap({ userId: p.userId, worldId: p.worldId });
            return ingestFrame({ userId: p.userId, worldId: p.worldId, frameData: p.frameData });
        },

        metaEvent: async (task) => {
            const { createEvent, buyTicket, updateEventStatus, listEvents } = require("../modules/metaverse/virtualEventManager.cjs");
            const p = task.payload || {};
            if (task.type === "meta_event_ticket")  return buyTicket({ userId: p.userId, eventId: p.eventId, tier: p.tier });
            if (task.type === "meta_event_status")  return updateEventStatus({ hostId: p.hostId, eventId: p.eventId, status: p.status });
            if (task.type === "meta_event_list")    return listEvents({ eventType: p.eventType, status: p.status, limit: p.limit });
            return createEvent({ hostId: p.hostId, eventName: p.eventName || task.input, eventType: p.eventType, worldId: p.worldId, startAt: p.startAt, endAt: p.endAt, description: p.description, maxAttendees: p.maxAttendees, ticketTiers: p.ticketTiers });
        },

        metaEconomy: async (task) => {
            const { getEconomySnapshot, runEconomicSimulation, getPriceHistory } = require("../modules/metaverse/metaverseEconomyAI.cjs");
            const p = task.payload || {};
            if (task.type === "meta_econ_simulate") return runEconomicSimulation({ scenarioName: p.scenarioName || task.input, policyChanges: p.policyChanges });
            if (task.type === "meta_econ_price")    return getPriceHistory({ assetType: p.assetType, periods: p.periods });
            return getEconomySnapshot({ worldId: p.worldId });
        },

        metaCurrency: async (task) => {
            const { getWallet, transfer, mint, getTransactionHistory } = require("../modules/metaverse/virtualCurrencySystem.cjs");
            const p = task.payload || {};
            if (task.type === "meta_mvc_transfer") return transfer({ fromUserId: p.fromUserId, toUserId: p.toUserId, amount: p.amount });
            if (task.type === "meta_mvc_mint")     return mint({ adminId: p.adminId, recipientId: p.recipientId, amount: p.amount, reason: p.reason });
            if (task.type === "meta_mvc_history")  return getTransactionHistory({ userId: p.userId, limit: p.limit });
            return getWallet({ userId: p.userId });
        },

        metaSync: async (task) => {
            const { exportUserState, importUserState, syncFriendsList, getUserPresence } = require("../modules/metaverse/crossWorldSync.cjs");
            const p = task.payload || {};
            if (task.type === "meta_sync_import")   return importUserState({ userId: p.userId, targetWorldId: p.targetWorldId, snapshotId: p.snapshotId, dataTypes: p.dataTypes });
            if (task.type === "meta_sync_friends")  return syncFriendsList({ userId: p.userId, friendId: p.friendId, action: p.action });
            if (task.type === "meta_sync_presence") return getUserPresence({ userId: p.userId });
            return exportUserState({ userId: p.userId, worldId: p.worldId, dataTypes: p.dataTypes });
        },

        metaAsset: async (task) => {
            const { uploadAsset, getAsset, listUserAssets, deleteAsset, transferAssetOwnership } = require("../modules/metaverse/digitalAssetManager.cjs");
            const p = task.payload || {};
            if (task.type === "meta_asset_get")      return getAsset({ assetId: p.assetId });
            if (task.type === "meta_asset_list")     return listUserAssets({ ownerId: p.ownerId, assetType: p.assetType, format: p.format, limit: p.limit });
            if (task.type === "meta_asset_delete")   return deleteAsset({ ownerId: p.ownerId, assetId: p.assetId, confirm: p.confirm });
            if (task.type === "meta_asset_transfer") return transferAssetOwnership({ fromId: p.fromId, toId: p.toId, assetId: p.assetId });
            return uploadAsset({ ownerId: p.ownerId, assetName: p.assetName || task.input, assetType: p.assetType, format: p.format, fileSizeMB: p.fileSizeMB, metadata: p.metadata, worldId: p.worldId, tags: p.tags });
        },

        metaSecurity: async (task) => {
            const { reportThreat, enforceAction, scanWorldForAnomalies, getSecurityLog } = require("../modules/metaverse/virtualSecurityAI.cjs");
            const p = task.payload || {};
            if (task.type === "meta_sec_enforce") return enforceAction({ moderatorId: p.moderatorId, targetId: p.targetId, worldId: p.worldId, action: p.action, durationMinutes: p.durationMinutes, reason: p.reason });
            if (task.type === "meta_sec_scan")    return scanWorldForAnomalies({ worldId: p.worldId });
            if (task.type === "meta_sec_log")     return getSecurityLog({ worldId: p.worldId, threatType: p.threatType, severity: p.severity, limit: p.limit });
            return reportThreat({ reporterId: p.reporterId, targetId: p.targetId, worldId: p.worldId, threatType: p.threatType, evidence: p.evidence, severity: p.severity });
        },

        metaReality: async (task) => {
            const { setPhysicsRules, setWeather, setTimeCycle, addEnvironmentEffect, getWorldEnvironment } = require("../modules/metaverse/realitySimulationEngine.cjs");
            const p = task.payload || {};
            if (task.type === "meta_env_weather")  return setWeather({ worldId: p.worldId, weatherState: p.weatherState, intensity: p.intensity, transitionSeconds: p.transitionSeconds });
            if (task.type === "meta_env_time")     return setTimeCycle({ worldId: p.worldId, cycle: p.cycle, speedMultiplier: p.speedMultiplier, currentHour: p.currentHour });
            if (task.type === "meta_env_effect")   return addEnvironmentEffect({ worldId: p.worldId, effectType: p.effectType, zone: p.zone, durationSeconds: p.durationSeconds, magnitude: p.magnitude });
            if (task.type === "meta_env_state")    return getWorldEnvironment({ worldId: p.worldId });
            return setPhysicsRules({ worldId: p.worldId, preset: p.preset, overrides: p.overrides });
        },

        metaAR: async (task) => {
            const { createOverlay, updateOverlay, removeOverlay, getUserOverlays, getARCapabilities } = require("../modules/metaverse/arOverlayAgent.cjs");
            const p = task.payload || {};
            if (task.type === "meta_ar_update")  return updateOverlay({ userId: p.userId, overlayId: p.overlayId, worldId: p.worldId, updates: p.updates });
            if (task.type === "meta_ar_remove")  return removeOverlay({ userId: p.userId, overlayId: p.overlayId, worldId: p.worldId });
            if (task.type === "meta_ar_list")    return getUserOverlays({ userId: p.userId, worldId: p.worldId });
            if (task.type === "meta_ar_caps")    return getARCapabilities();
            return createOverlay({ userId: p.userId, overlayType: p.overlayType, anchorType: p.anchorType, position: p.position, content: p.content || task.input, worldId: p.worldId, arMode: p.arMode, style: p.style });
        },

        govTokenize: async (task) => {
            const { tokenizeAsset, recordFractionPurchase, approveToken, getTokenRegistry } = require("./governance/tokenizationAgent.cjs");
            const p = task.payload || {};
            if (task.type === "gov_token_list")     return getTokenRegistry({ userId: p.userId, assetClass: p.assetClass, status: p.status });
            if (task.type === "gov_token_approve")  return approveToken({ userId: p.userId, tokenId: p.tokenId, legalApprovalRef: p.legalApprovalRef });
            if (task.type === "gov_token_purchase") return recordFractionPurchase({ userId: p.userId, tokenId: p.tokenId, investorId: p.investorId, fractionCount: p.fractionCount });
            return tokenizeAsset({ userId: p.userId, assetName: p.assetName || task.input, assetClass: p.assetClass, totalValue: p.totalValue, currency: p.currency, totalFractions: p.totalFractions, jurisdiction: p.jurisdiction, description: p.description, legalDocumentRef: p.legalDocumentRef });
        },

        // ── futureTech layer handlers ────────────────────────────────────

        ftSatellite: async (task) => {
            const { processSatellitePass, analyseRegion, getSupportedProducts } = require("../modules/futureTech/satelliteDataAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_satellite_products") return getSupportedProducts();
            if (task.type === "ft_satellite_region")   return analyseRegion({ userId: p.userId, latitude: p.latitude, longitude: p.longitude, product: p.product, resolution: p.resolution });
            return processSatellitePass({ userId: p.userId, satelliteId: p.satelliteId, satelliteType: p.satelliteType, orbitType: p.orbitType, product: p.product, targetRegion: p.targetRegion });
        },

        ftSpaceTrack: async (task) => {
            const { trackObject, getConjunctionAlerts, getCatalogStats } = require("../modules/futureTech/spaceTrackingAgent.cjs");
            const p = task.payload || {};
            if (task.type === "ft_space_catalog")     return getCatalogStats({ userId: p.userId });
            if (task.type === "ft_space_conjunction") return getConjunctionAlerts({ userId: p.userId, objectId: p.objectId, windowHours: p.windowHours });
            return trackObject({ userId: p.userId, objectId: p.objectId, objectType: p.objectType });
        },

        ftAstronomy: async (task) => {
            const { queryObject, searchByTopic, calculateDistance, getVisibilityForecast } = require("../modules/futureTech/astronomyAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_astro_topic")      return searchByTopic({ userId: p.userId, topic: p.topic || task.input });
            if (task.type === "ft_astro_distance")   return calculateDistance({ userId: p.userId, fromObject: p.fromObject, toObject: p.toObject });
            if (task.type === "ft_astro_visibility") return getVisibilityForecast({ userId: p.userId, objectName: p.objectName, latitude: p.latitude, longitude: p.longitude, days: p.days });
            return queryObject({ userId: p.userId, objectName: p.objectName || task.input, includeHistory: p.includeHistory });
        },

        ftSpaceWeather: async (task) => {
            const { getCurrentConditions, getSolarFlareForecast, getGeomagneticStormHistory } = require("../modules/futureTech/spaceWeatherAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_spacewx_flare")   return getSolarFlareForecast({ userId: p.userId, horizonHours: p.horizonHours });
            if (task.type === "ft_spacewx_history") return getGeomagneticStormHistory({ userId: p.userId, days: p.days });
            return getCurrentConditions({ userId: p.userId });
        },

        ftMars: async (task) => {
            const { getEnvironmentReading, simulateResourceSurvey, planBaseLocation } = require("../modules/futureTech/marsSimulationAgent.cjs");
            const p = task.payload || {};
            if (task.type === "ft_mars_survey")   return simulateResourceSurvey({ userId: p.userId, site: p.site, resources: p.resources });
            if (task.type === "ft_mars_base")     return planBaseLocation({ userId: p.userId, requirements: p.requirements });
            return getEnvironmentReading({ userId: p.userId, site: p.site });
        },

        ftMission: async (task) => {
            const { createMission, advanceMissionPhase, selectLaunchVehicle, getMissionList } = require("../modules/futureTech/spaceMissionPlanner.cjs");
            const p = task.payload || {};
            if (task.type === "ft_mission_list")    return getMissionList({ userId: p.userId, status: p.status });
            if (task.type === "ft_mission_vehicle") return selectLaunchVehicle({ userId: p.userId, payloadMass_kg: p.payloadMass_kg, targetOrbit: p.targetOrbit });
            if (task.type === "ft_mission_advance") return advanceMissionPhase({ userId: p.userId, missionId: p.missionId });
            return createMission({ userId: p.userId, missionName: p.missionName || task.input, missionType: p.missionType, destination: p.destination, payloadMass_kg: p.payloadMass_kg, launchYear: p.launchYear });
        },

        ftDrone: async (task) => {
            const { suggestMission, executeControl, getDroneStatus } = require("../modules/futureTech/droneControlAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_drone_status")  return getDroneStatus({ userId: p.userId, droneId: p.droneId });
            if (task.type === "ft_drone_control") return executeControl({ userId: p.userId, droneId: p.droneId, command: p.command, parameters: p.parameters, approved: p.approved });
            return suggestMission({ userId: p.userId, droneId: p.droneId, droneType: p.droneType, objective: p.objective || task.input });
        },

        ftRobotics: async (task) => {
            const { simulateTask, executeRobotCommand, getCapabilityMatrix } = require("../modules/futureTech/roboticsControlSystem.cjs");
            const p = task.payload || {};
            if (task.type === "ft_robot_caps")    return getCapabilityMatrix({ userId: p.userId });
            if (task.type === "ft_robot_control") return executeRobotCommand({ userId: p.userId, robotId: p.robotId, command: p.command, parameters: p.parameters, approved: p.approved });
            return simulateTask({ userId: p.userId, robotId: p.robotId, robotType: p.robotType, taskType: p.taskType || task.input });
        },

        ftAV: async (task) => {
            const { planRoute, simulateScenario, activateAutonomousMode } = require("../modules/futureTech/autonomousVehicleAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_av_scenario")  return simulateScenario({ userId: p.userId, scenario: p.scenario, vehicleType: p.vehicleType, saeLevel: p.saeLevel, conditions: p.conditions });
            if (task.type === "ft_av_activate")  return activateAutonomousMode({ userId: p.userId, vehicleId: p.vehicleId, saeLevel: p.saeLevel, routeId: p.routeId, approved: p.approved });
            return planRoute({ userId: p.userId, origin: p.origin || task.input, destination: p.destination, vehicleType: p.vehicleType, saeLevel: p.saeLevel, preferences: p.preferences });
        },

        ftSmartCity: async (task) => {
            const { getCityHealthScore, optimiseDistrict, getInfrastructureAlerts } = require("../modules/futureTech/smartCityAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_city_alerts")   return getInfrastructureAlerts({ userId: p.userId, cityId: p.cityId, severity: p.severity });
            if (task.type === "ft_city_district") return optimiseDistrict({ userId: p.userId, districtId: p.districtId, districtType: p.districtType, objectives: p.objectives });
            return getCityHealthScore({ userId: p.userId, cityId: p.cityId || task.input, domains: p.domains });
        },

        ftTraffic: async (task) => {
            const { analyseNetworkCongestion, optimiseSignalTiming, applySignalControl, getTrafficForecast } = require("../modules/futureTech/trafficOptimization.cjs");
            const p = task.payload || {};
            if (task.type === "ft_traffic_forecast") return getTrafficForecast({ userId: p.userId, cityId: p.cityId, hours: p.hours });
            if (task.type === "ft_traffic_signal")   return optimiseSignalTiming({ userId: p.userId, junctionId: p.junctionId, junctionType: p.junctionType, mode: p.mode, volumes: p.volumes });
            if (task.type === "ft_traffic_control")  return applySignalControl({ userId: p.userId, junctionId: p.junctionId, phaseConfig: p.phaseConfig, approved: p.approved });
            return analyseNetworkCongestion({ userId: p.userId, cityId: p.cityId || task.input, sectorIds: p.sectorIds });
        },

        ftEnergyGrid: async (task) => {
            const { getGridStatus, optimiseDistribution, applyGridControl, forecastDemand } = require("../modules/futureTech/energyGridAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_grid_forecast")  return forecastDemand({ userId: p.userId, gridId: p.gridId, hours: p.hours });
            if (task.type === "ft_grid_optimise")  return optimiseDistribution({ userId: p.userId, gridId: p.gridId, zones: p.zones, peakShaving: p.peakShaving });
            if (task.type === "ft_grid_control")   return applyGridControl({ userId: p.userId, gridId: p.gridId, controlActions: p.controlActions, approved: p.approved });
            return getGridStatus({ userId: p.userId, gridId: p.gridId });
        },

        ftRenewable: async (task) => {
            const { getSolarForecast, getWindForecast, optimiseStorageDispatch, getRenewableMix } = require("../modules/futureTech/renewableEnergyManager.cjs");
            const p = task.payload || {};
            if (task.type === "ft_renewable_wind")    return getWindForecast({ userId: p.userId, latitude: p.latitude, longitude: p.longitude, turbineCapacityKW: p.turbineCapacityKW, hubHeight_m: p.hubHeight_m, forecastType: p.forecastType });
            if (task.type === "ft_renewable_storage") return optimiseStorageDispatch({ userId: p.userId, storageType: p.storageType, capacityKWh: p.capacityKWh, currentSOC_pct: p.currentSOC_pct });
            if (task.type === "ft_renewable_mix")     return getRenewableMix({ userId: p.userId, region: p.region });
            return getSolarForecast({ userId: p.userId, latitude: p.latitude, longitude: p.longitude, capacityKWp: p.capacityKWp, forecastType: p.forecastType });
        },

        ftClimate: async (task) => {
            const { predictClimate, analyseExtremeEvents, getTippingPointRisk, getClimateScenarioComparison } = require("../modules/futureTech/climatePredictionAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_climate_extreme")   return analyseExtremeEvents({ userId: p.userId, region: p.region, eventType: p.eventType, periodYears: p.periodYears });
            if (task.type === "ft_climate_tipping")   return getTippingPointRisk({ userId: p.userId, elements: p.elements });
            if (task.type === "ft_climate_compare")   return getClimateScenarioComparison({ userId: p.userId, region: p.region, scenarios: p.scenarios });
            return predictClimate({ userId: p.userId, region: p.region || task.input, scenario: p.scenario, model: p.model, timescale: p.timescale, horizonYears: p.horizonYears });
        },

        ftCarbon: async (task) => {
            const { trackEmissions, calculateCarbonFootprint, getOffsetOpportunities, generateEmissionReport } = require("../modules/futureTech/carbonTrackingAgent.cjs");
            const p = task.payload || {};
            if (task.type === "ft_carbon_footprint") return calculateCarbonFootprint({ userId: p.userId, activities: p.activities });
            if (task.type === "ft_carbon_offsets")   return getOffsetOpportunities({ userId: p.userId, targetTCO2e: p.targetTCO2e, offsetTypes: p.offsetTypes, budget_USD: p.budget_USD });
            if (task.type === "ft_carbon_report")    return generateEmissionReport({ userId: p.userId, entityId: p.entityId, standard: p.standard, year: p.year });
            return trackEmissions({ userId: p.userId, entityId: p.entityId, entityType: p.entityType, period: p.period, scopes: p.scopes });
        },

        ftEnvironment: async (task) => {
            const { monitorEcosystem, analyseAirQuality, monitorWaterQuality, assessSoilHealth } = require("../modules/futureTech/environmentalAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_env_air")    return analyseAirQuality({ userId: p.userId, locationId: p.locationId, latitude: p.latitude, longitude: p.longitude, pollutants: p.pollutants });
            if (task.type === "ft_env_water")  return monitorWaterQuality({ userId: p.userId, waterbodyId: p.waterbodyId, waterbodyType: p.waterbodyType, params: p.params });
            if (task.type === "ft_env_soil")   return assessSoilHealth({ userId: p.userId, plotId: p.plotId, soilType: p.soilType, depth_cm: p.depth_cm });
            return monitorEcosystem({ userId: p.userId, ecosystemId: p.ecosystemId, ecosystemType: p.ecosystemType, metrics: p.metrics });
        },

        ftDisaster: async (task) => {
            const { predictDisasterRisk, getEarlyWarning, issueEvacuationAlert, getHistoricalDisasterData } = require("../modules/futureTech/disasterPredictionAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_disaster_warning")   return getEarlyWarning({ userId: p.userId, region: p.region, disasterType: p.disasterType });
            if (task.type === "ft_disaster_evacuate")  return issueEvacuationAlert({ userId: p.userId, regionId: p.regionId, disasterType: p.disasterType, severity: p.severity, approved: p.approved });
            if (task.type === "ft_disaster_history")   return getHistoricalDisasterData({ userId: p.userId, region: p.region, disasterType: p.disasterType, yearRange: p.yearRange });
            return predictDisasterRisk({ userId: p.userId, region: p.region || task.input, disasterTypes: p.disasterTypes, horizonDays: p.horizonDays });
        },

        ftOcean: async (task) => {
            const { getOceanStatus, analyseMarineEcosystem, trackOceanCurrents, forecastSeaLevelRise } = require("../modules/futureTech/oceanMonitoringAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_ocean_marine")  return analyseMarineEcosystem({ userId: p.userId, habitatId: p.habitatId, habitatType: p.habitatType, threats: p.threats });
            if (task.type === "ft_ocean_currents") return trackOceanCurrents({ userId: p.userId, currentSystem: p.currentSystem });
            if (task.type === "ft_ocean_slr")     return forecastSeaLevelRise({ userId: p.userId, coastalCity: p.coastalCity, scenario: p.scenario, horizonYears: p.horizonYears });
            return getOceanStatus({ userId: p.userId, basinId: p.basinId, layer: p.layer });
        },

        ftAgriculture: async (task) => {
            const { getCropRecommendation, monitorCropHealth, optimiseIrrigation, predictHarvest } = require("../modules/futureTech/agriculturalAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_agri_health")    return monitorCropHealth({ userId: p.userId, farmId: p.farmId, cropType: p.cropType, fieldId: p.fieldId, imagingSource: p.imagingSource });
            if (task.type === "ft_agri_irrigation") return optimiseIrrigation({ userId: p.userId, farmId: p.farmId, cropType: p.cropType, soilMoisture_pct: p.soilMoisture_pct, irrigationType: p.irrigationType });
            if (task.type === "ft_agri_harvest")   return predictHarvest({ userId: p.userId, farmId: p.farmId, cropType: p.cropType, plantingDate: p.plantingDate, fieldArea_ha: p.fieldArea_ha, farmingSystem: p.farmingSystem });
            return getCropRecommendation({ userId: p.userId, farmId: p.farmId, soilType: p.soilType, climate: p.climate, cropHistory: p.cropHistory, season: p.season, waterAvailability_mm: p.waterAvailability_mm });
        },

        ftFoodChain: async (task) => {
            const { traceProduct, assessSupplyChainRisk, optimiseInventory, getFoodSafetyAlerts } = require("../modules/futureTech/foodSupplyChainAI.cjs");
            const p = task.payload || {};
            if (task.type === "ft_food_risk")     return assessSupplyChainRisk({ userId: p.userId, chainId: p.chainId, categories: p.categories, region: p.region });
            if (task.type === "ft_food_inventory") return optimiseInventory({ userId: p.userId, warehouseId: p.warehouseId, products: p.products, storageCondition: p.storageCondition });
            if (task.type === "ft_food_safety")   return getFoodSafetyAlerts({ userId: p.userId, region: p.region, category: p.category, severity: p.severity });
            return traceProduct({ userId: p.userId, productId: p.productId || task.input, batchId: p.batchId, category: p.category });
        }
    };
    return _handlers;
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
