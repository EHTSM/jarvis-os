"use strict";
/**
 * Route barrel — mounts all domain route files.
 * Import order determines Express match priority for overlapping prefixes.
 * Specific paths (webhooks, ai, simulation) before broad ones (crm, ops).
 */
const router = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
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
router.use(require("./accounts"));    // POST /accounts/register, GET /accounts/me, GET /accounts/me/export (GDPR), GET /accounts
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
// Runtime Event Bus Reliability, Isolation & Backpressure Audit (2026-08-16):
// GET /runtime/stream (the real SSE bridge onto runtimeEventBus) was only
// requireAuth, not operatorOnly — live-reproduced: a brand-new, ordinary
// role:"user" customer account with no special access received the FULL
// platform-wide internal telemetry stream (real mission IDs, orchestrator
// internals, internal Executive-OS department agent state like
// eos_timeline/eos_risk/eos_policy/eos_budget, server heap/RSS/error-rate
// metrics) — none of it filtered by org/workspace, none of it this
// customer's own data. The frontend's own naming confirms the intended
// contract: every real consumer (RuntimeDebugger.jsx, EngineeringConsole.jsx,
// CommandCenter.jsx, operator/BrowserAutomationPanel.jsx) lives under
// ElectronWorkspace's operator-os/ tooling, never the customer-facing app.
// Same fix pattern as the Endpoint Authorization Sweep mission's other
// platform-wide-not-tenant-scoped findings — operatorOnly at the mount,
// scoped to just the stream (not the whole /runtime/* prefix, which is a
// separate, already-audited surface).
router.use("/runtime/stream", operatorOnly);
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
// Founder/Ops Authorization Cluster audit (2026-08-20): /p22/* exposes
// secret-rotation status, JWT/CSP/security-header configuration checks,
// and deploy-validation reports — zero orgId concept, reachable by any
// authenticated customer via SystemHealthDashboard.jsx's "systemhealth"
// tab (no role gate at that render level). Same defect class as the rest
// of this cluster.
router.use("/p22", requireAuth, operatorOnly);
router.use(require("./phase22"));      // /p22/secrets, /p22/security, /p22/deploy, /p22/alerts
router.use(_deprecate("/p23/", "/agents/* or integration-specific endpoints"));
router.use(require("./phase23"));      // /p23/github, /p23/review, /p23/release, /p23/autopilot
router.use(_deprecate("/p24/", "/agents/* or IDE-specific endpoints"));
router.use(require("./phase24"));      // /p24/vscode, /p24/repo, /p24/refactor, /p24/multirepo
router.use(_deprecate("/p25/obs", "/analytics/*"));
router.use(require("./phase25"));      // /p25/deploy, /p25/secrets, /p25/obs, /p25/search
router.use(require("./phase26"));      // /p26/graph, /p26/memory, /p26/reason, /p26/observer, /p26/plugins, /p26/capabilities, /p26/manifest, /p26/templates
router.use(require("./phase27"));      // /p27/executive, /p27/missions, /p27/planning, /p27/ai, /p27/improvement
router.use("/mission", requireAuth);   // gate all /mission/* routes
router.use("/missions", requireAuth);  // gate all /missions/* routes
router.use(require("./mission"));      // /mission/runtime/*, /mission/timeline/*, /mission/graph/*, /mission/replay/*, /mission/state/*
router.use("/agents", requireAuth);    // gate all /agents/* routes (agents.js has no in-file guard; barrel comment claimed one that never existed)
router.use(require("./agents"));       // /agents/conversation/*, /agents/status/*, /agents/delegation/*, /agents/message, /agents/override, /agents/task/*
router.use(require("./agentsRuntime")); // /agents/runtime/supervisor — Phase I4 long-running agent runtime
router.use(require("./lifecycle"));    // /runtime/lifecycle/*, /runtime/stage/*, /runtime/events/*, /runtime/pause/*, /runtime/resume/*, /runtime/retry/*
router.use("/intelligence", requireAuth); // gate all /intelligence/* routes
router.use(require("./intelligence"));   // /intelligence/correlations, /intelligence/insights, /intelligence/patterns, /intelligence/trends, /intelligence/recommendation-confidence
router.use("/engineering", requireAuth); // gate all /engineering/* routes
router.use(require("./engineering"));   // /engineering/intelligence (J4 engineering risk panel)
router.use(require("./business"));      // /business/pipeline, /business/missions, /business/leads, /business/deals, /business/marketing/*, /business/customers, /business/operations
router.use(require("./organizations")); // /orgs, /orgs/:orgId, /orgs/:orgId/departments, /orgs/:orgId/teams, /orgs/:orgId/missions, /orgs/me/context
router.use(require("./enterpriseSso")); // Enterprise & Physical Integration M1: /enterprise/sso/* — SAML/OIDC/Google/Entra SSO (mixed auth: admin config gated, IdP-facing login routes public by design)
router.use(require("./enterpriseScim")); // Enterprise & Physical Integration M2: /enterprise/scim/:orgId/v2/* SCIM protocol (per-org bearer auth) + /enterprise/scim/:orgId/token admin (requireAuth)
router.use(require("./enterpriseAudit")); // Enterprise & Physical Integration M3: /enterprise/audit/:orgId/* search + login/permission/scim/ai/billing history + export (requireAuth + view_audit_log)
router.use(require("./enterprisePolicy")); // Enterprise & Physical Integration M4: /enterprise/policy/:orgId/* org policy CRUD (requireAuth + manage_policy) + /enterprise/mfa/* per-account TOTP enrollment (requireAuth)
router.use(require("./enterprisePhysical")); // Enterprise & Physical Integration M6: /enterprise/physical/folder-sync/* — local folder sync uploads into org storage (requireAuth + attachOrg + requireOrgMember)
router.use(require("./enterpriseMonitoring")); // Enterprise & Physical Integration M7: /enterprise/monitoring/:orgId/* org/connector/AI-usage/background-jobs/queue health + alert center (requireAuth + attachOrg + requireOrgMember)
router.use(require("./enterpriseDashboard")); // Enterprise & Physical Integration M8: /enterprise/dashboard/:orgId/* composed overview/compliance/security/users/devices/ai/billing/connectors/analytics (requireAuth + attachOrg + requireOrgMember, admin-tier gating on security/users/devices)
router.use(require("./workforce"));    // /workforce/:missionId/plan, /workforce/:missionId/steps/:stepId/*, /workforce/:missionId/approvals/*, /workforce/org/:orgId/workers
router.use(require("./graph"));        // /graph/stats, /graph/node/:type/:id, /graph/traverse, /graph/related, /graph/impact, /graph/lookup, /graph/edges, /graph/index
router.use("/collaboration", requireAuth);    // gate all /collaboration/* routes
router.use(require("./collaboration"));       // /collaboration/session/*, /collaboration/history/*, /collaboration/message, /collaboration/action, /collaboration/replan, /collaboration/approve, /collaboration/reject
router.use(require("./collaborationEngine")); // /collab/plans/*, /collab/handoff, /collab/active, /collab/blocked, /collab/stalled, /collab/stats (Phase I6)
router.use(require("./pipeline"));           // /pipeline/run, /pipeline/:id, /pipeline/active, /pipeline/stats, /pipeline/validate (Phase I7)
router.use(require("./deployment"));         // /deployment/run, /deployment/:id, /deployment/targets, /deployment/active, /deployment/benchmark (Phase I8)
router.use(require("./dependencyAudit"));    // V6 Phase 5: /devops/dependencies/* real npm audit/outdated/update
router.use(require("./legal"));              // V6 Phase 6 (Legal OS): /legal/* real AI-drafted document generation
router.use(require("./dailyPlanning"));      // V6 Phase 8 (Personal JARVIS): /planning/* real task/agenda engine, composes missions+twin
router.use(require("./founderAssistant"));   // V6 Phase 8 (Personal JARVIS): /assistant/* conversational entrypoint, composes twin+profile+planning
router.use(require("./pushNotifications"));  // V6 Phase 8 (Personal JARVIS: mobile): /push/* device token registry, real Firebase-readiness gated send
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
// operatorOnly: /repo-viz/*, /memory/*, /memory-index/*, /improvement/*,
// /platform/* (ACP-9 through ACP-12) are the same class of platform-wide,
// not-tenant-scoped surface already fixed for /eos, /ent, /eco, /civ, /auto
// above (Levels 6-10) — no per-tenant scoping exists anywhere in their
// backing state: repositoryVisualizationEngine.cjs always resolves
// `path.resolve(cwd || process.cwd())` (this server process's own repo, not
// any customer's), and engineeringMemoryEngine.cjs/unifiedMemoryEngine.cjs/
// selfImprovement's stores (lessons, RCAs, patch history, evolution cycles)
// are confirmed zero-orgId (grep-confirmed 0 occurrences across every
// backing engine file). This is a genuinely different data model from the
// org-scoped /coding/* (ACP-1-8, codingAssistant.js — 37 real orgId/req.org
// occurrences, correctly tenant-aware, NOT touched here): these five route
// groups are the platform operator/founder's own AI-coding-program tooling
// about Ooplix's own codebase (repo maps, engineering RCAs, self-improvement
// cycles, autonomous-engineering-platform run history) — confirmed by their
// only frontend consumers (RepositoryMapPanel.jsx, EngineeringMemoryPanel.jsx,
// SelfImprovementPanel.jsx, AutonomousPlatformPanel.jsx, all mounted only
// inside AutonomousAgentDashboard.jsx, "AI Coding Program," never inside any
// customer-facing tenant workflow). Previously gated by requireAuth alone;
// live-reproduced with a real non-operator customer account: GET
// /memory/stats and GET /memory/timeline both returned real internal
// engineering RCA titles and knowledge-growth stats to an ordinary customer.
// Same fix as the five surfaces above: add operatorOnly. There is no
// tenant-scoped equivalent to preserve for any of these five — unlike /eos's
// preserved /org-executive/:orgId/*, nothing in this family has a real
// per-customer counterpart route.
router.use("/repo-viz", requireAuth, operatorOnly);        // gate all /repo-viz/* routes
router.use(require("./repositoryViz"));      // /repo-viz/* (ACP-9)
router.use("/memory", requireAuth, operatorOnly);           // gate all /memory/* routes
router.use(require("./engineeringMemory"));   // /memory/* (ACP-10)
router.use("/memory-index", requireAuth, operatorOnly);     // gate all /memory-index/* routes
router.use(require("./unifiedMemoryIndex"));  // /memory-index/* — cross-product memory index (agents/runtime/unifiedMemoryEngine.cjs), previously built but unwired
router.use("/improvement", requireAuth, operatorOnly);       // gate all /improvement/* routes
router.use(require("./selfImprovement"));      // /improvement/* (ACP-11)
router.use("/platform", requireAuth, operatorOnly);         // gate all /platform/* routes
router.use(require("./autonomousPlatform"));  // /platform/* (ACP-12)
router.use(require("./analytics"));    // /analytics/executive, /workspace, /productivity, /automation, /security, /governance, /ai, /runtime, /missions, /reports
router.use(require("./plugins"));      // /plugins, /plugins/:id, /plugins/install, /plugins/uninstall, /plugins/enable, /plugins/disable, /plugins/health, /plugins/diagnostics
router.use(require("./marketplace"));  // /marketplace/catalog, /plugin/:id, /categories, /featured, /search, /recommendations, /versions/:id, /changelog/:id
router.use(require("./extensions"));   // /extensions/runtime, /extensions/:id, /extensions/load, /unload, /suspend, /resume, /restart, /metrics, /hooks, /quotas
router.use(require("./commercial"));      // /commercial/* — AI Credit Engine, Smart Router, Usage Metering, Billing Core, Feature Gates, Provider Manager, Cost Analytics, Developer Console, Admin Dashboard, Commercial Benchmark
router.use(require("./aiEcosystem"));     // /ai-ecosystem/* — Universal Registry, Capability Router, Model Marketplace, Local Runtime, Creative Hub, Browser AI, Enterprise Policies, Benchmark Lab, Marketplace UI, Viability
router.use(require("./browserPlatform")); // /browser-platform/* — Browser Registry, Session Manager, Visual Controller, NL Browser, Memory, Workflow Builder, HITL, Marketplace, Dashboard, Benchmark
router.use(require("./creativeStudio")); // /creative/* — Creative Registry, Unified Router, Image/Video/Voice/Brand/Social Studios, Workspace, Asset Library, Benchmark
router.use(require("./exportFiles")); // /exports/:orgScope/:filename — Enterprise Capability Expansion: shared serving route for exportFileService.cjs (DOCX/PPTX/ZIP/JSON exports)
router.use(require("./apiDocs"));     // /api-docs/* — Enterprise Capability Expansion: OpenAPI + Postman generated from the live mounted router tree
router.use(require("./launchPlatform")); // /launch/* — Dashboard, Onboarding, Workspaces, Docs, Academy, Referral, CST, Feedback, Readiness, Benchmark
router.use(require("./founderJournal")); // /fop/* — FOP-1: Journal, Escape, Crash, Perf, AI, Credits, Friction, Weekly Score, Launch Confidence, Ship Recommendation
router.use(require("./growthOS"));        // /growth/* — G1: Email, SMS, WhatsApp, Push, Automation, Audience, Analytics, Templates, Dashboard, Benchmark
router.use(require("./contentSEO"));      // /content/* — G2: Blog Studio, SEO, Repurposing, Landing Pages, Docs, Calendar, Keywords, Brand Voice, Dashboard, Benchmark
router.use(require("./distribution"));    // /distrib/* — G3: Publisher, Orchestrator, Influencer, Community, Referral, Launch, Analytics, Performance AI, Executive, Benchmark
router.use(require("./revenueOS"));       // /revenue/* — G4: Revenue Dashboard, Subscriptions, Upgrade Intelligence, Customer Success, Churn, Forecasting, Affiliates, Finance, Executive, Benchmark
// Founder/Ops Authorization Cluster audit (2026-08-20): productionInfra.js's
// own header comment already claimed "All routes require auth (operator-
// only)" but never actually applied operatorOnly anywhere in the file — a
// documentation/code mismatch. Fixed at the mount, matching the file's own
// stated intent. co2FounderOps.js (deploy config, AI provider keys status,
// billing, QA/bug tracking) has the identical zero-orgId, platform-internal
// shape, reachable via FounderOps.jsx with no frontend role gate.
router.use("/ops/infra", requireAuth, operatorOnly);
router.use(require("./productionInfra")); // /ops/infra/* — CO1: GitHub, VPS, Environment, Database, Monitoring, Security, Deployment, Docs, Launch, Benchmark
router.use("/co2", requireAuth, operatorOnly);
router.use(require("./co2FounderOps"));  // /co2/* — CO2: Deploy, AI Providers, Billing, Email, Dogfood, QA, Bugs, Perf, Readiness, Alpha Report
router.use(require("./co3UserSuccess")); // /co3/* — CO3: Invites, Feedback, Analytics, CS Inbox, KB, Releases, Crashes, Usage, Beta Ops, Launch Benchmark
router.use(require("./op1PublicLaunch")); // /op1/* — OP-1: Public Launch — 6-week program, KPIs, escapes, blockers, releases, log
// Founder/Ops Authorization Cluster audit (2026-08-20): /wiring, /wiring2,
// /credentials, /ext, /dop are all platform-internal audit/validation
// tooling (external-integration wiring status, credential env-var
// manifests, infra readiness) with zero orgId concept anywhere in their
// backing services — requireAuth alone let any signed-up customer reach
// them. Live-reproduced against /credentials/env with a fresh, ordinary
// customer account: real secret-key names, purposes, and configured/unset
// status for every env var this app uses. Same defect class already fixed
// for /founder, /bible, /aeo, and the POST-Ω P13-P19 cluster — operatorOnly
// at the mount, matching that exact precedent.
router.use("/wiring", requireAuth, operatorOnly);
router.use(require("./productionWiring")); // /wiring/* — Production Wiring Sprint 1: AI/Payments/Email/OAuth/WhatsApp/Browser audit
router.use("/wiring2", requireAuth, operatorOnly);
router.use(require("./productionWiring2")); // /wiring2/* — Production Wiring Sprint 2: SMTP/AI-extended/OAuth/Monitoring/Storage/E2E
router.use("/credentials", requireAuth, operatorOnly);
router.use(require("./pcsCredentials")); // /credentials/* — PCS-1: Email/AI/OAuth/Crash/Storage credential audit + env var report
router.use("/ext", requireAuth, operatorOnly);
router.use(require("./pcs2ExternalPlatforms")); // /ext/* — PCS-2: Meta/Google/Microsoft/Git/Productivity/Design/Commerce/Automation audit
router.use(require("./integrations")); // /integrations/* — Production Mission 3: unified A-L connector connect/health/status/reconnect/rotate
router.use(require("./founderVault")); // /vault/* — Production Mission 3.1: Founder Identity & Secret Vault (57 connectors, 12 cred types, env manager)
router.use(require("./myConnectors")); // /my-connectors/* — Public SaaS Mission 7: customer-facing, org-scoped connector setup (WhatsApp/Razorpay/Stripe/SMTP), backed by secretVault's org-scoping
router.use("/dop", requireAuth, operatorOnly);
router.use(require("./dop1")); // /dop/* — DOP-1: Production Infrastructure Validation (10 modules: VPS/Nginx/SSL/DNS/Domains/Deploy/Backup/Monitor/Security/Stress)
router.use(require("./dop2")); // /dop2/* — DOP-2: Real Production Deployment (10 phases: Connect/Deps/Repo/Env/Nginx/SSL/PM2/Health/Smoke/Reports)
router.use(require("./plan-management")); // /plan/* — current plan, upgrade
router.use(require("./odi"));            // ODI-1..10: /odi/screenshots /odi/capture /odi/dom /odi/layout /odi/components /odi/analyze /odi/tokens /odi/accessibility /odi/responsive /odi/patches /odi/runs /odi/run
router.use(require("./engineeringOrg")); // Level 2: /engorg/status /engorg/summary /engorg/agents/:id /engorg/missions
router.use(require("./businessOrg"));              // Level 3: /bizorg/status /bizorg/summary /bizorg/agents/:id /bizorg/v3/*
router.use(require("./autonomousKnowledgeOrg")); // Level 4: /ako/status /ako/summary /ako/agents/:id /ako/v4/*
// operatorOnly: /aeo/v5/* is the platform-wide Level 5 Autonomous Evolution
// Organization surface — objectives, evolutions (including
// POST /aeo/v5/evolutions/:id/approve|apply|revert), tasks, experiments,
// all platform-wide mutating writes. Unlike the adjacent Level 2/3/4 files
// (engineeringOrg.js/businessOrg.js/autonomousKnowledgeOrg.js, which have a
// real per-org v2/v3/v4 workflow layer and were correctly given a narrower
// tick/enable/disable-only operatorOnly fix), this file has NO per-route
// auth at all (not even requireAuth) and its entire surface — status
// through workflow/learn — is undifferentiated platform-wide mutable
// state, the same shape as the already-fixed /eos/v6 (L6). aeoState.cjs/
// autonomousEvolutionOrg.cjs/aeoWorkflow.cjs confirmed zero orgId. No
// tenant-scoped equivalent to preserve.
router.use("/aeo", requireAuth, operatorOnly);   // gate all /aeo/* routes
router.use(require("./autonomousEvolutionOrg")); // Level 5: /aeo/status /aeo/summary /aeo/agents/:id /aeo/v5/*
// operatorOnly: /eos/v6/* is the platform-wide Executive OS surface — goals,
// missions, decisions, approvals, budgets, risks across every org, composed
// via executiveState.syncOrgStatus() from business/engineering/knowledge/
// evolution state. Previously gated by requireAuth alone, so any authenticated
// tenant (verified: a non-operator workspace member) could read the full
// platform dashboard AND create platform-wide executive goals via
// POST /eos/v6/goals — a write, not just a read leak. The equivalent surface
// in Finance OS (GET /revenue/dashboard) is already operatorOnly; this closes
// the same gap here. Regular tenants get their own org-scoped view via
// /org-executive/:orgId/* (orgExecutiveIntelligence.js), which already
// correctly enforces real org membership via _assertMember.
router.use("/eos", requireAuth, operatorOnly);   // gate all /eos/* routes
router.use(require("./executiveOrg"));           // Level 6: /eos/status /eos/summary /eos/agents/:id /eos/v6/*
// operatorOnly: /ent/v7/*, /eco/v8/*, /civ/v9/* are the same class of
// platform-wide Level 7-9 surface as /eos (L6) and /auto (L10) above — no
// per-tenant scoping exists anywhere in their state singletons
// (enterpriseOrgState.cjs/ecosystemOrgState.cjs/civilizationState.cjs all
// confirmed to have zero orgId enforcement by the dedicated Civilization OS
// and Autonomous OS verification passes, 2026-08-15). Previously gated by
// requireAuth alone; live-reproduced with a non-operator tenant account:
// POST /ent/v7/companies returned 201 and genuinely persisted a new
// platform-wide company record. Same fix as /eos and /auto: add
// operatorOnly. There is no tenant-scoped equivalent surface to preserve —
// these three Levels model inter-organization/platform state, not anything
// a single tenant does inside their own business.
router.use("/ent", requireAuth, operatorOnly);   // gate all /ent/* routes
router.use(require("./enterpriseOrg"));          // Level 7: /ent/status /ent/summary /ent/agents/:id /ent/v7/*
router.use("/eco", requireAuth, operatorOnly);   // gate all /eco/* routes
router.use(require("./ecosystemOrg"));           // Level 8: /eco/status /eco/summary /eco/agents/:id /eco/v8/*
router.use("/civ", requireAuth, operatorOnly);   // gate all /civ/* routes
router.use(require("./civilizationOrg"));        // Level 9: /civ/status /civ/summary /civ/agents/:id /civ/v9/*
// operatorOnly: /auto/v10/* is the platform-wide Level 10 Autonomous
// Civilization surface — the global OODA loop's decision ledger, experiment
// ledger, evolution timeline, opportunity/threat maps, and loop control
// (including POST /auto/v10/control/mode, which can pause the shared
// platform-wide autonomous loop for every org). Previously gated by
// requireAuth alone, so any authenticated tenant (verified live: a
// non-operator workspace member) could read the full decision ledger AND
// pause/resume the platform's autonomous loop — a write, not just a read
// leak, and one capable of disrupting every tenant on the platform. Same
// class of gap already fixed for /eos above; this closes the identical gap
// here. There is no tenant-scoped equivalent to preserve — this loop
// observes and acts across L6-L9 platform state, not per-org data.
router.use("/auto", requireAuth, operatorOnly);  // gate all /auto/* routes
router.use(require("./autonomousOrg"));          // Level 10: /auto/status /auto/summary /auto/agents/:id /auto/v10/*
router.use(require("./platformOrg"));           // Level Ω:  /platform/status /platform/summary /platform/v1/* (guarded above by /platform requireAuth)
router.use(require("./postOmega"));             // POST-Ω:   /pomena/status /pomena/review /pomena/audit /pomena/dashboard
router.use(require("./founderAutomation"));     // POST-Ω P2: /founder/* /bible/*
router.use(require("./autonomousExecution"));   // POST-Ω P3: /execution/* dashboard+plan+execute+evidence+recovery+metrics
router.use("/approval", requireAuth);          // gate all /approval/* routes
router.use(require("./approvalRoutes"));        // POST-Ω P4: /approval/* queue+engine+evidence+analytics+dashboard+policy
// operatorOnly: /computer/* is the Universal Computer Controller — real
// arbitrary shell command execution (POST /computer/terminal/run,
// POST /computer/run), real desktop/browser/editor automation against the
// production server. This file's own header comment already documents a
// prior "highest-severity finding" (a broken auth import silently no-op'd
// every in-file requireAuth call) that was fixed to point at the real
// middleware — but never escalated beyond requireAuth, so any authenticated
// customer could still run arbitrary commands on the server. No frontend
// consumer exists anywhere in the product (confirmed by direct search) —
// genuinely operator/founder-only tooling, not a customer feature.
router.use("/computer", requireAuth, operatorOnly);  // gate all /computer/* routes
router.use(require("./computerController"));    // POST-Ω P5: /computer/* desktop+browser+editor+terminal+workspace+run
router.use(require("./dockerController"));      // V6 Phase 3: /computer/docker/* container+compose+network+volume orchestration
router.use("/twin", requireAuth);              // gate all /twin/* routes (Security Hardening: in-file requireAuth now also points at the real middleware, fail-closed)
router.use(require("./founderTwin"));          // POST-Ω P6: /twin/* profile+decisions+predict+preferences+context+scenarios
router.use("/workforce-os", requireAuth);      // gate all /workforce-os/* routes (Security Hardening: in-file requireAuth now also points at the real middleware, fail-closed)
router.use(require("./workforceOS"));          // POST-Ω P7: /workforce-os/* agents+teams+capacity+performance+dashboard
router.use("/company-factory", requireAuth);   // gate all /company-factory/* routes
router.use(require("./companyFactory"));       // POST-Ω P8: /company-factory/* create+blueprints+workspace+lifecycle+dashboard
router.use("/workspace-mesh", requireAuth);   // gate all /workspace-mesh/* routes
router.use(require("./workspaceMesh"));       // POST-Ω P9: /workspace-mesh/* registry+coordinator+sync+health+dashboard
router.use("/research", requireAuth);        // gate all /research/* routes
router.use(require("./researchInstitute"));  // POST-Ω P10: /research/* planner+knowledge+benchmark+experiments+publications+dashboard
router.use("/odi", requireAuth);            // gate all /odi/* routes (incl. /odi/x/*)
router.use(require("./odi-x"));             // ODI X V1:   /odi/x/* reasoning+quality+benchmark+predict+evolution+dashboard
router.use(require("./oai-x"));             // OAI X V1:   /engineering/x/* reasoning+quality+benchmark+predict+evolution+dashboard (guarded above by /engineering requireAuth)
router.use("/business", requireAuth);       // gate all /business/* routes (incl. /business/x/*)
router.use(require("./obi-x"));             // OBI X V1:   /business/x/* reasoning+quality+benchmark+predict+evolution+dashboard
router.use("/knowledge", requireAuth);      // gate all /knowledge/* routes
router.use(require("./okb-x"));             // OKB X V1:   /knowledge/x/* reasoning+quality+benchmark+predict+evolution+dashboard
router.use("/evolution", requireAuth);      // gate all /evolution/* routes
router.use(require("./ose-x"));             // OSE X V1:   /evolution/x/* reasoning+quality+benchmark+predict+evolution+dashboard
router.use("/customer-org", requireAuth);   // gate all /customer-org/* routes
router.use(require("./customerOrg"));       // POST-Ω P11: /customer-org/* journey+health+success+support+automation+dashboard
router.use("/product-factory", requireAuth);      // gate all /product-factory/* routes
router.use(require("./productFactory"));          // POST-Ω P12: /product-factory/* planner+arch+assembly+validation+release+dashboard+pipeline
// operatorOnly: POST-Ω P13-P19 (/auto-market, /knowledge-net,
// /revenue-engine, /investment, /physical, /science, /infra) are all the
// same class of platform-wide, zero-orgId autonomous-engine surface already
// fixed for L6-L10/ACP-9-12 above — confirmed by direct grep: 0 orgId
// occurrences across all 20 backing engine files for this cluster
// (marketplaceCatalogEngine.cjs, revenueDiscoveryEngine.cjs,
// capitalAllocationEngine.cjs, infrastructureRegistryEngine.cjs, etc.).
// Real mutating writes reachable by any authenticated customer
// (POST /infra/resources/register, POST /infra/recovery/trigger,
// POST /auto-market/publish, etc.). No frontend consumer exists anywhere
// in the product for any of these 7 prefixes (confirmed by direct search).
router.use("/auto-market", requireAuth, operatorOnly);         // gate all /auto-market/* routes
router.use(require("./autonomousMarketplace"));  // POST-Ω P13: /auto-market/* catalog+recommend+cert+automate+economy+dashboard
router.use("/knowledge-net", requireAuth, operatorOnly);      // gate all /knowledge-net/* routes
router.use(require("./knowledgeNetwork"));      // POST-Ω P14: /knowledge-net/* federation+correlation+discovery+governance+exchange+dashboard
router.use("/revenue-engine", requireAuth, operatorOnly);     // gate all /revenue-engine/* routes
router.use(require("./autonomousRevenue"));     // POST-Ω P15: /revenue-engine/* discovery+optimization+pricing+forecast+automation+dashboard
router.use("/investment", requireAuth, operatorOnly);        // gate all /investment/* routes
router.use(require("./autonomousInvestment")); // POST-Ω P16: /investment/* capital+analysis+portfolio+risk+automation+dashboard
router.use("/physical", requireAuth, operatorOnly);            // gate all /physical/* routes
router.use(require("./physicalWorld"));          // POST-Ω P17: /physical/* registry+orchestration+scenarios+health+workflow+dashboard
router.use("/science", requireAuth, operatorOnly);               // gate all /science/* routes
router.use(require("./scientificDiscovery"));      // POST-Ω P18: /science/* plan+hypotheses+experiments+publications+innovations+dashboard
router.use("/infra", requireAuth, operatorOnly);                // gate all /infra/* routes
router.use(require("./globalInfrastructure"));    // POST-Ω P19: /infra/* registry+planner+health+recovery+optimization+dashboard
router.use("/org-network", requireAuth);          // gate all /org-network/* routes
router.use(require("./organizationNetwork"));     // POST-Ω P20: /org-network/* registry+collab+capability+governance+evolution+dashboard
router.use(require("./founderIdentityOS"));       // Mission 3.2: /fdios/* 12 FDIOS modules
// Founder/Ops Authorization Cluster audit (2026-08-20): /alpha/* and
// /beta/* are internal readiness-program dashboards (onboarding funnel
// telemetry, support diagnostics, gate-check reports) — zero orgId
// concept, zero frontend consumer anywhere in the codebase (confirmed via
// exhaustive grep).
router.use("/alpha", requireAuth, operatorOnly);
router.use(require("./alphaProgram"));            // Mission 5:   /alpha/* 7-phase internal alpha program
router.use("/beta", requireAuth, operatorOnly);
router.use(require("./betaReadiness"));           // Mission 6:   /beta/* closed beta readiness + auth fixes
router.use(require("./closedBeta"));              // Mission 6 Extended: /cbeta/* 14 FIX REQUIRED items
router.use(require("./rc1"));                     // RC-1: /rc1/* release candidate freeze, verify, report
router.use(require("./rc2"));                     // RC-2: /rc2/* deployment rehearsal, 13-step, Go/No-Go
router.use(require("./rc3"));                     // RC-3: /rc3/* 7-day stability certification, 7-area, Go/No-Go
router.use(require("./rc4"));                     // RC-4: /rc4/* final launch certification, 8-area, Go/No-Go
router.use(require("./productionDeployment"));    // PM-7: /pm7/* live production deployment tracking
router.use(require("./orgAiBrain"));               // V5 M1: /org-ai/:orgId/* org-scoped AI ask/ask-stream/recommend/history/usage/provider-health (requireAuth, permission-gated via organizationService directly)
router.use(require("./orgKnowledgeGraph"));         // V5 M2: /org-graph/:orgId/* org-scoped knowledge graph index/query/impact (requireAuth, permission-gated via organizationService directly)
router.use(require("./orgAgents"));                 // V5 M3: /org-agents/:orgId/* org-scoped agent list/run/history over the real agentExecutionEngine + agentRegistry (requireAuth, permission-gated via organizationService directly)
router.use(require("./crossOrgCollaboration"));     // V5 M4: /cross-org/* mutual-consent company-to-company sharing over organizationService.grantOrgAccess (requireAuth, org_owner-gated via organizationService directly)
router.use(require("./orgAiWorkspace"));            // V5 M5: /org-workspace/:orgId/* composed dashboard over M1-M4 + automationService (requireAuth, permission-gated via organizationService directly)
router.use(require("./orgExecutiveIntelligence")); // V5 M6: /org-executive/:orgId/* insights/recommendations/forecast/summary composed from real org-scoped data (requireAuth, permission-gated via organizationService directly)
router.use(require("./orgAutomationCenter"));       // V5 M7: /org-automation/:orgId/* workflows/scheduled-jobs/triggers/connectors/AI-execution unified over automationService + orgAutomationScheduler + orgAiBrain (requireAuth, permission-gated via organizationService directly)

module.exports = router;
