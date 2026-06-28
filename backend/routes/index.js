"use strict";
/**
 * Route barrel — mounts all domain route files.
 * Import order determines Express match priority for overlapping prefixes.
 * Specific paths (webhooks, ai, simulation) before broad ones (crm, ops).
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { requireActiveAccount } = require("../services/billingService");

// Deprecation notice middleware — logs a warning and adds HTTP headers for any
// /pNN/* prefixes that have been superseded by canonical named routes.
// Routes remain functional; this is a warning layer only, not a removal.
function _deprecate(prefix, replacement) {
    return (req, res, next) => {
        if (!req.path.startsWith(prefix)) return next();
        const logger = require("../utils/logger");
        logger.warn(`[Deprecated] ${req.method} ${req.path} — migrate to ${replacement}`);
        res.setHeader("Deprecation", "true");
        res.setHeader("Link", `<${replacement}>; rel="successor-version"`);
        next();
    };
}

router.use(require("./auth"));         // POST /auth/login, POST /auth/logout, GET /auth/me
router.use(require("./accounts"));    // POST /accounts/register, GET /accounts/me, GET /accounts
router.use(require("./settings"));    // GET /settings/status, POST /settings/whatsapp, POST /settings/razorpay
router.use(require("./billing"));     // GET /billing/status, POST /billing/upgrade, POST /billing/cancel
router.use(require("./metrics"));      // /metrics/dashboard, /metrics/health, /metrics/errors
router.use(requireActiveAccount);      // billing gate — all routes below require active trial or paid plan
router.use(require("./jarvis"));       // POST /jarvis
router.use(require("./whatsapp"));     // /whatsapp/*
router.use(require("./telegram"));     // /telegram/send, /telegram/status
router.use(require("./payment"));      // /payment/*, /webhook/razorpay, /razorpay-webhook
router.use(require("./crm"));          // /crm, /crm-leads, /crm/lead/*
router.use(require("./ai"));           // POST /ai/chat
router.use(require("./simulation"));   // POST /simulate/*, /send-followup
router.use(require("./ops"));          // /health, /ops, /stats, /metrics, /test, /api/status
router.use("/runtime", requireAuth);   // gate all /runtime/* routes
router.use(require("./runtime"));      // /runtime/dispatch, /runtime/queue, /runtime/status, /runtime/history
router.use(require("../../agents/runtime/runtimeStream.cjs")); // GET /runtime/stream, /runtime/stream/status
router.use(require("./tasks"));        // /tasks, /scheduler/status, /queue/status
router.use(require("./browser"));      // /browser/run, /browser/action, /browser/navigate, /browser/sessions, /browser/status
router.use(_deprecate("/p18/", "/runtime/* or /agents/*"));
router.use(require("./phase18"));      // /p18/actions, /p18/agents, /p18/memory, /p18/cycles
router.use(_deprecate("/p19/", "/runtime/* or /agents/*"));
router.use(require("./phase19"));      // /p19/tools, /p19/coord, /p19/heal, /p19/learn
router.use(_deprecate("/p20/", "/agents/* or /ooplix (via phase20)"));
router.use(require("./phase20"));      // /p20/agents, /p20/memory, /p20/improve, /p20/ooplix
router.use(_deprecate("/p21/obs", "/analytics/*"));
router.use(require("./phase21"));      // /oauth/*, /p21/obs, /p21/live, /p21/readiness
router.use(_deprecate("/p22/", "/security/* or admin-specific endpoints"));
router.use(require("./phase22"));      // /p22/secrets, /p22/security, /p22/deploy, /p22/alerts
router.use(_deprecate("/p23/", "/agents/* or integration-specific endpoints"));
router.use(require("./phase23"));      // /p23/github, /p23/review, /p23/release, /p23/autopilot
router.use(_deprecate("/p24/", "/agents/* or IDE-specific endpoints"));
router.use(require("./phase24"));      // /p24/vscode, /p24/repo, /p24/refactor, /p24/multirepo
router.use(_deprecate("/p25/obs", "/analytics/*"));
router.use(require("./phase25"));      // /p25/deploy, /p25/secrets, /p25/obs, /p25/search
router.use(require("./phase26"));      // /p26/graph, /p26/memory, /p26/reason, /p26/observer, /p26/plugins, /p26/capabilities, /p26/manifest, /p26/templates
router.use(require("./phase27"));      // /p27/executive, /p27/missions, /p27/planning, /p27/ai, /p27/improvement
router.use(require("./mission"));      // /mission/runtime/*, /mission/timeline/*, /mission/graph/*, /mission/replay/*, /mission/state/*
router.use(require("./agents"));       // /agents/conversation/*, /agents/status/*, /agents/delegation/*, /agents/message, /agents/override, /agents/task/*
router.use(require("./agentsRuntime")); // /agents/runtime/supervisor — Phase I4 long-running agent runtime
router.use(require("./lifecycle"));    // /runtime/lifecycle/*, /runtime/stage/*, /runtime/events/*, /runtime/pause/*, /runtime/resume/*, /runtime/retry/*
router.use(require("./intelligence"));   // /intelligence/correlations, /intelligence/insights, /intelligence/patterns, /intelligence/trends, /intelligence/recommendation-confidence
router.use(require("./engineering"));   // /engineering/intelligence (J4 engineering risk panel)
router.use(require("./business"));      // /business/pipeline, /business/missions, /business/leads, /business/deals, /business/marketing/*, /business/customers, /business/operations
router.use(require("./organizations")); // /orgs, /orgs/:orgId, /orgs/:orgId/departments, /orgs/:orgId/teams, /orgs/:orgId/missions, /orgs/me/context
router.use(require("./workforce"));    // /workforce/:missionId/plan, /workforce/:missionId/steps/:stepId/*, /workforce/:missionId/approvals/*, /workforce/org/:orgId/workers
router.use(require("./graph"));        // /graph/stats, /graph/node/:type/:id, /graph/traverse, /graph/related, /graph/impact, /graph/lookup, /graph/edges, /graph/index
router.use(require("./collaboration"));       // /collaboration/session/*, /collaboration/history/*, /collaboration/message, /collaboration/action, /collaboration/replan, /collaboration/approve, /collaboration/reject
router.use(require("./collaborationEngine")); // /collab/plans/*, /collab/handoff, /collab/active, /collab/blocked, /collab/stalled, /collab/stats (Phase I6)
router.use(require("./pipeline"));           // /pipeline/run, /pipeline/:id, /pipeline/active, /pipeline/stats, /pipeline/validate (Phase I7)
router.use(require("./deployment"));         // /deployment/run, /deployment/:id, /deployment/targets, /deployment/active, /deployment/benchmark (Phase I8)
router.use(require("./workspace"));      // /workspace, /workspace/:id, /workspace/invite, /workspace/switch, /workspace/activity
router.use(require("./security"));      // /security/sessions, /security/devices, /security/audit, /security/policies, /security/tokens, /security/score
router.use(require("./admin"));         // /admin/team, /admin/member/*, /admin/departments, /admin/profile, /admin/statistics, /admin/quotas
router.use(require("./governance"));    // /governance/policies, /governance/templates, /governance/compliance, /governance/reports, /governance/risk
router.use(require("./automation"));    // /automation/rules, /automation/templates, /automation/history, /automation/statistics, /automation/dry-run
router.use(require("./codingAssistant")); // /coding/ask, /coding/action, /coding/explain-file, /coding/find-impl, /coding/summarize, /coding/review, /coding/refactor, /coding/explain-error, /coding/smells/*
router.use(require("./codingDecisions")); // /coding/decisions/* (ACP-4)
router.use(require("./codingBundle"));   // /coding/bundle/* (ACP-6)
router.use(require("./composer"));        // /composer/* (ACP-7)
router.use(require("./autonomousAgent")); // /autonomous/* (ACP-8)
router.use(require("./repositoryViz"));      // /repo-viz/* (ACP-9)
router.use(require("./engineeringMemory"));   // /memory/* (ACP-10)
router.use(require("./selfImprovement"));      // /improvement/* (ACP-11)
router.use(require("./autonomousPlatform"));  // /platform/* (ACP-12)
router.use(require("./analytics"));    // /analytics/executive, /workspace, /productivity, /automation, /security, /governance, /ai, /runtime, /missions, /reports
router.use(require("./plugins"));      // /plugins, /plugins/:id, /plugins/install, /plugins/uninstall, /plugins/enable, /plugins/disable, /plugins/health, /plugins/diagnostics
router.use(require("./marketplace"));  // /marketplace/catalog, /plugin/:id, /categories, /featured, /search, /recommendations, /versions/:id, /changelog/:id
router.use(require("./extensions"));   // /extensions/runtime, /extensions/:id, /extensions/load, /unload, /suspend, /resume, /restart, /metrics, /hooks, /quotas
router.use(require("./commercial"));      // /commercial/* — AI Credit Engine, Smart Router, Usage Metering, Billing Core, Feature Gates, Provider Manager, Cost Analytics, Developer Console, Admin Dashboard, Commercial Benchmark
router.use(require("./aiEcosystem"));     // /ai-ecosystem/* — Universal Registry, Capability Router, Model Marketplace, Local Runtime, Creative Hub, Browser AI, Enterprise Policies, Benchmark Lab, Marketplace UI, Viability
router.use(require("./browserPlatform")); // /browser-platform/* — Browser Registry, Session Manager, Visual Controller, NL Browser, Memory, Workflow Builder, HITL, Marketplace, Dashboard, Benchmark
router.use(require("./creativeStudio")); // /creative/* — Creative Registry, Unified Router, Image/Video/Voice/Brand/Social Studios, Workspace, Asset Library, Benchmark
router.use(require("./launchPlatform")); // /launch/* — Dashboard, Onboarding, Workspaces, Docs, Academy, Referral, CST, Feedback, Readiness, Benchmark
router.use(require("./founderJournal")); // /fop/* — FOP-1: Journal, Escape, Crash, Perf, AI, Credits, Friction, Weekly Score, Launch Confidence, Ship Recommendation
router.use(require("./growthOS"));        // /growth/* — G1: Email, SMS, WhatsApp, Push, Automation, Audience, Analytics, Templates, Dashboard, Benchmark
router.use(require("./contentSEO"));      // /content/* — G2: Blog Studio, SEO, Repurposing, Landing Pages, Docs, Calendar, Keywords, Brand Voice, Dashboard, Benchmark
router.use(require("./distribution"));    // /distrib/* — G3: Publisher, Orchestrator, Influencer, Community, Referral, Launch, Analytics, Performance AI, Executive, Benchmark
router.use(require("./revenueOS"));       // /revenue/* — G4: Revenue Dashboard, Subscriptions, Upgrade Intelligence, Customer Success, Churn, Forecasting, Affiliates, Finance, Executive, Benchmark
router.use(require("./productionInfra")); // /ops/infra/* — CO1: GitHub, VPS, Environment, Database, Monitoring, Security, Deployment, Docs, Launch, Benchmark
router.use(require("./co2FounderOps"));  // /co2/* — CO2: Deploy, AI Providers, Billing, Email, Dogfood, QA, Bugs, Perf, Readiness, Alpha Report
router.use(require("./co3UserSuccess")); // /co3/* — CO3: Invites, Feedback, Analytics, CS Inbox, KB, Releases, Crashes, Usage, Beta Ops, Launch Benchmark
router.use(require("./op1PublicLaunch")); // /op1/* — OP-1: Public Launch — 6-week program, KPIs, escapes, blockers, releases, log
router.use(require("./productionWiring")); // /wiring/* — Production Wiring Sprint 1: AI/Payments/Email/OAuth/WhatsApp/Browser audit
router.use(require("./productionWiring2")); // /wiring2/* — Production Wiring Sprint 2: SMTP/AI-extended/OAuth/Monitoring/Storage/E2E
router.use(require("./pcsCredentials")); // /credentials/* — PCS-1: Email/AI/OAuth/Crash/Storage credential audit + env var report
router.use(require("./pcs2ExternalPlatforms")); // /ext/* — PCS-2: Meta/Google/Microsoft/Git/Productivity/Design/Commerce/Automation audit
router.use(require("./dop1")); // /dop/* — DOP-1: Production Infrastructure Validation (10 modules: VPS/Nginx/SSL/DNS/Domains/Deploy/Backup/Monitor/Security/Stress)
router.use(require("./dop2")); // /dop2/* — DOP-2: Real Production Deployment (10 phases: Connect/Deps/Repo/Env/Nginx/SSL/PM2/Health/Smoke/Reports)
router.use(require("./plan-management")); // /plan/* — current plan, upgrade
router.use(require("./odi"));            // ODI-1..10: /odi/screenshots /odi/capture /odi/dom /odi/layout /odi/components /odi/analyze /odi/tokens /odi/accessibility /odi/responsive /odi/patches /odi/runs /odi/run
router.use(require("./engineeringOrg")); // Level 2: /engorg/status /engorg/summary /engorg/agents/:id /engorg/missions
router.use(require("./businessOrg"));              // Level 3: /bizorg/status /bizorg/summary /bizorg/agents/:id /bizorg/v3/*
router.use(require("./autonomousKnowledgeOrg")); // Level 4: /ako/status /ako/summary /ako/agents/:id /ako/v4/*
router.use(require("./autonomousEvolutionOrg")); // Level 5: /aeo/status /aeo/summary /aeo/agents/:id /aeo/v5/*
router.use(require("./executiveOrg"));           // Level 6: /eos/status /eos/summary /eos/agents/:id /eos/v6/*
router.use(require("./enterpriseOrg"));          // Level 7: /ent/status /ent/summary /ent/agents/:id /ent/v7/*
router.use(require("./ecosystemOrg"));           // Level 8: /eco/status /eco/summary /eco/agents/:id /eco/v8/*
router.use(require("./civilizationOrg"));        // Level 9: /civ/status /civ/summary /civ/agents/:id /civ/v9/*
router.use(require("./autonomousOrg"));          // Level 10: /auto/status /auto/summary /auto/agents/:id /auto/v10/*
router.use(require("./platformOrg"));           // Level Ω:  /platform/status /platform/summary /platform/v1/*
router.use(require("./postOmega"));             // POST-Ω:   /pomena/status /pomena/review /pomena/audit /pomena/dashboard
router.use(require("./founderAutomation"));     // POST-Ω P2: /founder/* /bible/*
router.use(require("./autonomousExecution"));   // POST-Ω P3: /execution/* dashboard+plan+execute+evidence+recovery+metrics
router.use(require("./approvalRoutes"));        // POST-Ω P4: /approval/* queue+engine+evidence+analytics+dashboard+policy
router.use(require("./computerController"));    // POST-Ω P5: /computer/* desktop+browser+editor+terminal+workspace+run
router.use(require("./founderTwin"));          // POST-Ω P6: /twin/* profile+decisions+predict+preferences+context+scenarios
router.use(require("./workforceOS"));          // POST-Ω P7: /workforce-os/* agents+teams+capacity+performance+dashboard
router.use(require("./companyFactory"));       // POST-Ω P8: /company-factory/* create+blueprints+workspace+lifecycle+dashboard
router.use(require("./workspaceMesh"));       // POST-Ω P9: /workspace-mesh/* registry+coordinator+sync+health+dashboard

module.exports = router;
