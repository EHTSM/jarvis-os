# SCREEN INVENTORY — FINAL
Date: 2026-06-06 | Phase 35 — Product Freeze
Scope: All 75 certified surfaces across Web, Electron, Flutter, Capacitor

---

## HOW TO READ THIS DOCUMENT

**Status codes:**
- `WIRED` — makes real backend API calls, live data
- `PARTIAL` — some real API calls, some static/seed data
- `STATIC` — no backend calls; renders seed data or localStorage
- `NEEDS-BACKEND` — UI complete but no matching engine exists yet
- `DEAD` — route defined in nav but no screen file or GoRoute
- `ELECTRON-ONLY` — panel exclusive to Electron shell

**Role codes:** OP = Operator · DEV = Developer · BIZ = Business User · ENT = Enterprise Admin · ALL = All roles

---

## PLATFORM 1: WEB APP (48 screens)

---

### GROUP A: TOP-LEVEL TABS (5 screens — always visible to all roles)

---

**S01 — Control Center**
- Tab ID: `home`
- Product area: Shared Infrastructure / CRM
- Role: ALL
- Purpose: Default home — live runtime status, task dispatch input, lead pipeline summary, service health widget, quick-navigation tiles
- User actions: Type and dispatch a task, view queue depth, check service health, navigate to other tabs
- Backend APIs: `GET /stats`, `GET /ops`, `GET /health`, `POST /runtime/dispatch`
- Engines: RuntimeOrchestrator, CRMService, AutomationEngine
- Status: `WIRED`
- Missing: None

---

**S02 — Execution (Operator Console)**
- Tab ID: `runtime`
- Product area: AI Operations Infrastructure
- Role: OP, DEV, ENT
- Purpose: Full operator cockpit — SSE event stream, task execution log, emergency controls, browser automation, workflow runner, telemetry panels
- User actions: Execute commands, emergency stop/resume, run browser workflows, monitor live stream, view recent failures
- Backend APIs: `GET /runtime/stream` (SSE), `POST /runtime/dispatch`, `POST /runtime/emergency/stop`, `POST /runtime/emergency/resume`, `POST /runtime/reboot`, full `/browser/*` (37 routes)
- Engines: RuntimeOrchestrator, BrowserAgent, TaskQueue, ExecutionHistory
- Status: `WIRED`
- Missing: None (browser automation Electron-exclusive, correctly gated)

---

**S03 — Intelligence (Chat)**
- Tab ID: `chat`
- Product area: CRM / AI Operations Infrastructure
- Role: ALL
- Purpose: Primary AI interface — natural language commands to Jarvis, quick-action chips, conversation history
- User actions: Type message, tap chip, send command, clear history
- Backend APIs: `POST /jarvis`, `POST /ai/chat`
- Engines: RuntimeOrchestrator → Groq/OpenAI/Ollama via aiService
- Status: `WIRED`
- Missing: None

---

**S04 — Pipeline (Dashboard)**
- Tab ID: `insights`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: Business pipeline overview — lead count, revenue stats, automation tier activity, WhatsApp follow-up rates
- User actions: View KPI cards, check automation tier breakdowns, pull to refresh, navigate to contacts
- Backend APIs: `GET /stats`, `GET /ops`
- Engines: CRMService, AutomationEngine, MetricsStore
- Status: `WIRED`
- Missing: None

---

**S05 — Contacts**
- Tab ID: `clients`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: Lead CRM — add contacts, send WhatsApp messages, generate payment links, manage follow-up sequences
- User actions: Add contact (name + WhatsApp number), send message, create payment link, view lead list, set follow-up tier
- Backend APIs: `GET /crm`, `POST /crm/lead`, `PATCH /crm/lead/:phone`, `POST /payment/link`, `POST /whatsapp/send`, `POST /send-followup`
- Engines: CRMService, PaymentService, WhatsAppBridge
- Status: `WIRED`
- Missing: Razorpay keys return 401 (key rotation required — see PRODUCTION_ENV_AUDIT.md)

---

### GROUP B: WORKFLOW SUITE (11 screens)

---

**S06 — Agents (Agent OS)**
- Tab ID: `agents`
- Product area: Workflow Operating System
- Role: OP, DEV, ENT
- Purpose: Agent management — browse registry, toggle active/pause, execute tasks with inline result, view activity feed
- User actions: Filter agents by type/status, click agent to open detail, enter task input → "▷ Execute", view recent activity feed, switch to "Full Profile" tab for capability/permission matrix
- Backend APIs: `GET /p18/agents`, `GET /p18/agents/failures`, `POST /p18/agents/:id/execute`, `GET /p18/agents/:id/history`, `GET /p20/agents`
- Engines: AgentExecutionEngine, AgentFactoryAutomation
- Status: `WIRED`
- Missing: Agent toggle (pause/activate) does not call backend — UI-only state change

---

**S07 — Action Queue**
- Tab ID: `agentactions`
- Product area: Workflow Operating System
- Role: OP, ENT
- Purpose: Action queue management — 5 tabs: Executed / Pending / Failed / Human Approvals / Autonomous approvals
- User actions: Browse action tabs, approve or deny high-risk actions, view autonomous action log
- Backend APIs: `GET /p18/actions?status=completed`, `GET /p18/actions?status=failed`, `GET /p18/actions?status=pending`, `GET /p18/actions/audit`
- Engines: RuntimeActionEngine
- Status: `WIRED`
- Missing: Approve/deny does not call a backend approval endpoint — UI-only state

---

**S08 — Task Router**
- Tab ID: `taskrouter`
- Product area: Workflow Operating System
- Role: OP, ENT
- Purpose: Task routing — view incoming tasks, reassign to agents, escalate, filter by priority/category, inspect task flow
- User actions: Browse task queue, reassign task to different agent, escalate flagged task, filter by priority, view flow visualization
- Backend APIs: `GET /p18/agents`, `GET /p18/agents/:id/history`
- Engines: AgentExecutionEngine
- Status: `WIRED`
- Missing: Reassign and escalate are UI-only; no `PATCH /tasks/:id/assign` backend endpoint

---

**S09 — Coordination**
- Tab ID: `collab`
- Product area: Workflow Operating System
- Role: OP, DEV, ENT
- Purpose: Multi-agent coordination — handoff graph, event feed, shared tasks, start new coordination sessions (collaborate/handoff/delegate)
- User actions: View handoff feed, browse collaboration graph, start session (modal: mode + agents + goal), view shared task progress
- Backend APIs: `GET /p19/coord/sessions`, `GET /p19/coord/sessions/stats`, `POST /p19/coord/collaborate`, `POST /p19/coord/handoff`, `POST /p19/coord/delegate`
- Engines: MultiAgentCoordinator
- Status: `WIRED`
- Missing: Handoff feed shows seed data; live handoff events not piped to feed

---

**S10 — Tool Fabric**
- Tab ID: `toolfabric`
- Product area: Workflow Operating System
- Role: OP, DEV, ENT
- Purpose: Tool registry — health status, permissions, connect/disconnect, execute with input, connection history
- User actions: Browse tool list, select tool, enter input → "▷ Run", toggle permissions, connect/disconnect, view usage stats
- Backend APIs: `GET /p19/tools`, `GET /p19/tools/status`, `POST /p19/tools/:id/execute`, `PUT /p19/tools/:id/permissions/:action`, `GET /p19/tools/:id/usage`
- Engines: ToolExecutionLayer
- Status: `WIRED`
- Missing: All tools return `not_configured` (no external API keys set — see PRODUCTION_ENV_AUDIT.md)

---

**S11 — Workflows**
- Tab ID: `autonomouswf`
- Product area: Workflow Operating System
- Role: OP, DEV, ENT
- Purpose: Autonomous workflow cycles — list view, flow visualization (Trigger→Agent→Tool→Action→Result), launch new cycle, execution chain detail, department view
- User actions: Browse workflow cards, click to view flow, click "+ New Workflow" → modal (goal + type) → launch, filter by status
- Backend APIs: `GET /p18/cycles`, `GET /p18/cycles/stats`, `POST /p18/cycles`
- Engines: AutonomousTaskLoop
- Status: `WIRED`
- Missing: Cycle tasks succeed when LLM configured; quality depends on Groq key validity

---

**S12 — Memory OS**
- Tab ID: `memory`
- Product area: Workflow Operating System
- Role: OP, BIZ, ENT
- Purpose: Persistent memory — List view (CRUD), Fabric view (cross-agent graph), Intelligence view (staleness/importance analytics)
- User actions: Add memory node (type/importance/title/body/tags), search, filter, edit, delete; browse graph view; view memory health scores
- Backend APIs: `POST /p18/memory`, `GET /p18/memory`, `GET /p18/memory/search`, `PATCH /p18/memory/:id`, `DELETE /p18/memory/:id`, `GET /p18/memory/stats`, `GET /p20/memory/report`, `GET /p20/memory/rank`
- Engines: MemoryPersistenceLayer, MemoryIntelligenceEngine
- Status: `WIRED`
- Missing: None

---

**S13 — Learning Engine**
- Tab ID: `selfimprove`
- Product area: Workflow Operating System
- Role: OP, DEV, ENT
- Purpose: Continuous learning — lessons learned, failure patterns, optimization opportunities, agent recommendations, re-analyze trigger
- User actions: Browse lessons tab, view failure patterns, see performance bars, apply recommendations, click "↺ Re-analyze"
- Backend APIs: `GET /p19/learn/lessons`, `GET /p19/learn/recommendations`, `GET /p19/learn/stats`, `POST /p19/learn/analyze`
- Engines: ContinuousLearningEngine
- Status: `WIRED`
- Missing: "Apply" button on recommendations is UI-only (no apply endpoint)

---

**S14 — Knowledge Base**
- Tab ID: `knowledge`
- Product area: Workflow Operating System
- Role: ALL
- Purpose: Knowledge base — FAQ management, article browser, agent knowledge library
- User actions: Browse articles, create FAQ entries, tag content, search knowledge base
- Backend APIs: None implemented
- Engines: None (KnowledgeBaseEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine, `/knowledge/*` routes

---

**S15 — Autonomy Dashboard**
- Tab ID: `autonomyscore`
- Product area: AI Operations Infrastructure / Workflow OS
- Role: OP, ENT
- Purpose: Autonomy measurement — per-dimension score gauges (Automation/Memory/Execution/Learning/Coordination), weekly trend chart, improvement opportunities, per-domain breakdown (Revenue/Marketing/Support/Engineering/DevOps)
- User actions: View score gauges, read weekly trend, browse improvement opportunities, view domain-level action breakdown
- Backend APIs: `GET /p20/ooplix/score`, `GET /p20/ooplix/status`, `GET /p20/ooplix/history`
- Engines: OoplixAutonomyEngine
- Status: `WIRED`
- Missing: Domain breakdowns (Revenue/Marketing/Support) use seed data; live per-domain autonomous action feed not implemented

---

**S16 — Brain View**
- Tab ID: `jarvisbrain`
- Product area: AI Operations Infrastructure
- Role: OP, ENT
- Purpose: Animated intelligence visualization — Goal→Planning→Memory→Agents→Tools→Execution→Learning loop with live cycle count and goal completion
- User actions: View animated flow, see live cycle totals update, browse active goals
- Backend APIs: `GET /p18/cycles/stats`, `GET /p20/ooplix/status`
- Engines: AutonomousTaskLoop, OoplixAutonomyEngine
- Status: `WIRED`
- Missing: Goal list uses seed data

---

### GROUP C: ENGINEERING SUITE (3 screens)

---

**S17 — Developer Copilot**
- Tab ID: `copilot`
- Product area: Developer Execution Copilot
- Role: DEV, ENT
- Purpose: Code development assistant — repo indexing, code review submission, refactor detection, branch/PR management, developer overview
- User actions: Index repo path → stats returned, paste code → "◉ Review code" → score/findings, enter path → "⬟ Scan for issues", browse PRs and review list
- Backend APIs: `POST /p24/repo/index`, `GET /p24/repo/status`, `POST /p23/review/code`, `GET /p23/review`, `POST /p24/refactor/detect/dup`, `POST /p24/refactor/detect/oversized`, `GET /p24/refactor/plans`, `GET /p23/github/activity`, `GET /p23/github/stats`
- Engines: RepoIntelligenceEngine, CodeReviewEngine, AutonomousRefactorEngine, GitHubEngineeringAgent
- Status: `WIRED`
- Missing: Repo index runs in child process (2000 file cap); GITHUB_TOKEN not set so GitHub repo data unavailable

---

**S18 — Engineering Center**
- Tab ID: `engineering`
- Product area: Autonomous Engineering Assistant
- Role: DEV, ENT
- Purpose: Engineering lifecycle board — Requirement→Plan→Build→Review→Test→Done. Autopilot mission launcher.
- User actions: View task board by stage, advance tasks through pipeline, click "⚡ Launch Mission" → modal (goal + repo) → mission started, create local task
- Backend APIs: `POST /p23/autopilot/missions`, `GET /p23/autopilot/missions`, `GET /p23/autopilot/stats`, `GET /p23/github/activity`
- Engines: EngineeringAutopilot, GitHubEngineeringAgent
- Status: `WIRED`
- Missing: GITHUB_TOKEN not set (missions run without GitHub integration)

---

**S19 — Agent Factory**
- Tab ID: `agentfactory`
- Product area: Autonomous Engineering Assistant
- Role: DEV, ENT
- Purpose: Agent creation — 8-template gallery, create agent (name/model/description), clone existing agents, submit training examples
- User actions: Choose template card, click "Create Agent" → modal, fill name/model → submit, clone existing agent, submit training data
- Backend APIs: `GET /p20/agents`, `POST /p20/agents`, `POST /p20/agents/:id/clone`, `GET /p20/agents/stats`
- Engines: AgentFactoryAutomation
- Status: `WIRED`
- Missing: Training form fires `track()` only — no `/p20/agents/:id/train` endpoint implemented

---

### GROUP D: INFRASTRUCTURE SUITE (6 screens)

---

**S20 — DevOps Runtime**
- Tab ID: `devops`
- Product area: AI DevOps Runtime
- Role: OP, DEV, ENT
- Purpose: Deployment dashboard — deployment history, service health, infrastructure status, incidents, SLOs, alerts. Canary deploy trigger.
- User actions: Browse deployments, click "▷ Deploy Canary" → modal (service + version + traffic %) → deploy, view SLO status, resolve alerts, filter by environment
- Backend APIs: `POST /p25/deploy/canary`, `GET /p25/deploy`, `GET /p25/deploy/history`, `GET /p25/obs/slos`, `GET /p25/obs/alerts`, `POST /p25/obs/alerts/:id/resolve`, `GET /p25/obs/metrics`, `GET /p25/obs/alerts/rules`
- Engines: DeploymentAutopilot, EnterpriseObservability
- Status: `WIRED`
- Missing: Blue-green deploy form not added (backend works, no UI trigger). Rollback button not surfaced.

---

**S21 — Self-Healing Platform**
- Tab ID: `selfhealing`
- Product area: Self-Healing Automation Platform
- Role: OP, DEV, ENT
- Purpose: Runtime health — 5 tabs: Health Checks, Recovery Actions, Prevention Rules, Incident Timeline, Failure Prediction
- User actions: View check status by service, click "Run Probe" → sweep triggered, toggle prevention rules on/off, browse incident timeline
- Backend APIs: `GET /p19/heal/status`, `GET /p19/heal/history`, `POST /p19/heal/probe`, `POST /p19/heal/task/:id`, `POST /p19/heal/circuit-break`
- Engines: SelfHealingRuntime
- Status: `WIRED`
- Missing: Rule toggles are UI-only (no rule write endpoint). Health check list shows seed data (not live probe results).

---

**S22 — Disaster Recovery**
- Tab ID: `disasterrecovery`
- Product area: Self-Healing Automation Platform
- Role: OP, ENT
- Purpose: Disaster recovery planning — backup status, recovery procedures, RTO/RPO targets
- User actions: View backup status, view recovery runbook, trigger recovery drill
- Backend APIs: None implemented
- Engines: None (BackupRecoveryEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine, `/recovery/*` routes

---

**S23 — Operations Center**
- Tab ID: `operations`
- Product area: AI Operations Infrastructure
- Role: OP, DEV, ENT
- Purpose: Agent ops health — throughput table, queue depth, error rates, production readiness score banner
- User actions: View agent throughput per agent, check queue depth indicators, read readiness score
- Backend APIs: `GET /p21/readiness/report`
- Engines: ProductionReadinessEngine
- Status: `WIRED`
- Missing: Throughput and queue data use seed constants (not live `/ops` polling from this component)

---

**S24 — AI Costs**
- Tab ID: `aicost`
- Product area: AI Operations Infrastructure
- Role: OP, ENT
- Purpose: LLM cost tracking — per-model token usage, cost breakdown by agent, budget alerts
- User actions: View cost by model, set budget threshold, see cost trend chart
- Backend APIs: None implemented
- Engines: None (CostTrackingEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine. Interim: can partially populate from `/p25/obs/metrics` which tracks `request_count` and `response_ms`.

---

**S25 — History**
- Tab ID: `activity`
- Product area: AI Operations Infrastructure
- Role: OP, DEV, ENT
- Purpose: Execution activity log — WhatsApp message timeline, task dispatch history, system events
- User actions: Browse activity timeline, view message queue log, check system events
- Backend APIs: Uses `opsData` from App-level state (`GET /ops`)
- Engines: AutomationEngine, ExecutionHistory
- Status: `PARTIAL`
- Missing: No direct history API call from this component; relies on App-level `opsData` prop

---

### GROUP E: BUSINESS SUITE (3 screens)

---

**S26 — Business OS**
- Tab ID: `business`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: Business management hub — overview, leads, contacts, pipeline stages, campaigns, revenue metrics, reports, launch planning
- User actions: View business overview, browse leads, manage pipeline stages, see revenue trend, access reports, plan product launch
- Backend APIs: `GET /stats` (via App state), `POST /jarvis` (via toast handler)
- Engines: CRMService, AI
- Status: `STATIC`
- Missing: Pipeline and CRM tabs use localStorage seed; no direct CRM API calls from this component

---

**S27 — Personal OS**
- Tab ID: `personal`
- Product area: CRM / Business Automation
- Role: OP, BIZ
- Purpose: Personal productivity — goals, tasks, reminders, daily planner, health tracking
- User actions: View personal dashboard, manage personal task list, set goals, view daily summary
- Backend APIs: None (localStorage persistence)
- Engines: None
- Status: `STATIC`
- Missing: Backend persistence for personal data. Correct to be localStorage-only for personal items.

---

**S28 — Support OS**
- Tab ID: `supportos`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: Support ticket management — inbound query routing, knowledge base lookup, escalation
- User actions: View support tickets, assign to support agent, browse knowledge base, view ticket status
- Backend APIs: None implemented
- Engines: None (SupportTicketEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine, `/support/*` routes

---

### GROUP F: GROWTH SUITE (3 screens — all NEEDS-BACKEND)

---

**S29 — SEO Command Center**
- Tab ID: `seo`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: SEO management — keyword rank tracking, meta generation, on-page audit, competitor analysis
- User actions: Run keyword scan, generate meta descriptions, view rank changes, audit page SEO
- Backend APIs: None implemented
- Engines: None (SEOMonitoringEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine, `/seo/*` routes

---

**S30 — Content Engine**
- Tab ID: `content`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: AI content generation — blog posts, social copy, email drafts, brand-voice enforcement
- User actions: Select content type, enter topic, generate, edit, save
- Backend APIs: None (can use `POST /jarvis` as interim)
- Engines: None dedicated (ContentGenerationEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine or wiring to existing `/jarvis` endpoint with content-specific system prompt

---

**S31 — Email Marketing OS**
- Tab ID: `email`
- Product area: CRM / Business Automation
- Role: OP, BIZ, ENT
- Purpose: Email campaign management — sequence builder, campaign analytics, subscriber management
- User actions: Create email campaign, set schedule, view open rates, manage subscriber lists
- Backend APIs: None implemented
- Engines: None (EmailAutomationEngine not built)
- Status: `NEEDS-BACKEND`
- Missing: Backend engine, `/email/*` routes

---

### GROUP G: SETTINGS SUITE (7 screens)

---

**S32 — Getting Started**
- Tab ID: `success`
- Product area: Shared Infrastructure
- Role: ALL
- Purpose: Onboarding hub — setup checklist, trial status, capabilities overview, first-action prompts
- User actions: Complete setup steps, view "What can Jarvis do?" tab, navigate to features
- Backend APIs: `GET /billing/status`, `GET /stats`, `GET /ops`
- Engines: BillingService
- Status: `PARTIAL`
- Missing: Some checklist items static

---

**S33 — Billing**
- Tab ID: `billing`
- Product area: Shared Infrastructure
- Role: OP, BIZ, ENT
- Purpose: Subscription management — current plan, upgrade flow, usage stats, trial countdown
- User actions: View plan details, click "Upgrade", view usage limits
- Backend APIs: `GET /billing/status`, `POST /billing/upgrade`
- Engines: BillingService
- Status: `WIRED`
- Missing: Razorpay subscription IDs not configured (`RAZORPAY_PLAN_ID_STARTER` etc. not set)

---

**S34 — Settings**
- Tab ID: `settings`
- Product area: Shared Infrastructure
- Role: OP, ENT
- Purpose: Workspace configuration — WhatsApp setup, webhook config, Data & Privacy section (data export, deletion)
- User actions: Connect WhatsApp (phone ID + token), configure webhook URL, export data, request account deletion
- Backend APIs: `GET /settings/status`, `POST /settings/whatsapp`, `POST /settings/webhook`
- Engines: SettingsService
- Status: `PARTIAL`
- Missing: Most settings fields are static; only WhatsApp setup calls backend

---

**S35 — Integrations**
- Tab ID: `integrations`
- Product area: Shared Infrastructure
- Role: OP, DEV, ENT
- Purpose: OAuth connection management — connect/disconnect Google, GitHub, Slack, Notion
- User actions: Click "Connect" per provider → redirected to OAuth flow, view connection status, disconnect
- Backend APIs: `GET /oauth/status`, `GET /oauth/connections`, `GET /oauth/:provider/url`, `DELETE /oauth/:provider/revoke`
- Engines: OAuthIntegrationLayer
- Status: `STATIC`
- Missing: OAuth provider credentials not set (all 4 providers unconfigured — see PRODUCTION_ENV_AUDIT.md). UI renders but connections cannot be made.

---

**S36 — Enterprise OS**
- Tab ID: `enterprise`
- Product area: Shared Infrastructure
- Role: ENT
- Purpose: Enterprise management — organizations, departments, teams, roles, permissions, policies, audit log
- User actions: Create org, add departments, manage teams + members, define roles, set permissions, enforce policies, view audit trail
- Backend APIs: Full enterpriseApi — 20+ functions covering org/dept/team/role/permission/policy/audit CRUD
- Engines: EnterpriseManagementEngine
- Status: `WIRED`
- Missing: None

---

**S37 — Compliance**
- Tab ID: `trustcompliance`
- Product area: Shared Infrastructure
- Role: ENT, OP
- Purpose: Compliance dashboard — data handling policies, security posture, certifications, audit log display
- User actions: View compliance status, browse audit events, export compliance report
- Backend APIs: None from this component directly
- Engines: None
- Status: `STATIC`
- Missing: Backend compliance audit endpoint

---

**S38 — Help & Guides**
- Tab ID: `help`
- Product area: Shared Infrastructure
- Role: ALL
- Purpose: Documentation — keyboard shortcuts, API reference, setup guides, FAQs
- User actions: Browse guides, copy code snippets, navigate to relevant screens
- Backend APIs: None
- Engines: None
- Status: `STATIC` — correct by design
- Missing: None (documentation correctly static)

---

### GROUP H: PRE-APP SCREENS (4 screens — not in tab nav)

---

**S39 — Landing Page**
- Nav: Default for unauthenticated users on public web
- Product area: Shared Infrastructure
- Role: Anonymous visitors
- Purpose: Marketing — product pitch, CTA to start trial or sign in
- Status: `STATIC` — correct by design

---

**S40 — Onboarding**
- Nav: After landing, before app (first-time users)
- Product area: Shared Infrastructure
- Role: New users
- Purpose: Business profile setup — collect business name, industry, goals for Jarvis personalization
- Status: `STATIC` — localStorage persistence, correct by design

---

**S41 — Login**
- Nav: Sign-in flow / auth gate
- Product area: Shared Infrastructure
- Role: All authenticated users
- Purpose: Email + password authentication
- Backend APIs: `POST /auth/login`, `GET /auth/me`
- Status: `WIRED`

---

**S42 — Pricing**
- Nav: Landing → "See all plans"
- Product area: Shared Infrastructure
- Role: Anonymous visitors
- Purpose: Subscription plan comparison
- Status: `STATIC` — correct by design

---

### GROUP I: LEGAL SCREENS (6 screens — footer only, not in tab nav)

**S43 — Company** · **S44 — Privacy Policy** · **S45 — Terms of Service** · **S46 — Refund Policy** · **S47 — Contact** · **S48 — Trust & Security**

All `STATIC`. All accessible via footer links. No backend needed. All KEEP.

---

## PLATFORM 2: ELECTRON APP (11 exclusive panels)

All web screens (S01–S48) are accessible. Electron-exclusive surfaces:

---

**E01 — ExecLog Panel**
- Product area: AI Operations Infrastructure
- Role: OP
- Purpose: Live execution log with emergency stop/resume controls
- Backend APIs: `POST /runtime/dispatch`, `POST /runtime/emergency/stop`, `POST /runtime/emergency/resume`
- Status: `WIRED`

---

**E02 — Governor Panel**
- Product area: AI Operations Infrastructure
- Role: OP
- Purpose: Runtime governance — reboot, health refresh, governor status
- Backend APIs: `POST /runtime/reboot`, `GET /ops`
- Status: `WIRED`

---

**E03 — Workflow Panel**
- Product area: Workflow Operating System
- Role: OP
- Purpose: Workflow trigger panel — fire named workflows, view results inline
- Backend APIs: `POST /runtime/dispatch` (42 wired call sites)
- Status: `WIRED`

---

**E04 — Browser Automation Panel**
- Product area: Developer Execution Copilot
- Role: OP, DEV
- Purpose: Full browser automation — run URL/search, save to library, replay saved workflows, view history. DESKTOP EXCLUSIVE.
- Backend APIs: Full `/browser/*` API (37 routes) — run, workflow, library, history, replay, schedules
- Engines: BrowserAgent
- Status: `WIRED`
- Note: Not available on web; blocked by Capacitor BLOCKED_PATTERNS on mobile

---

**E05 — AI Console Panel**
- Product area: AI Operations Infrastructure
- Role: OP
- Purpose: Inline AI command dispatch with notification feedback
- Backend APIs: `POST /jarvis`
- Status: `WIRED`

---

**E06 — Task Queue Panel**
- Product area: AI Operations Infrastructure
- Role: OP
- Purpose: Live queue visualization via SSE stream
- Backend APIs: `GET /runtime/stream` (SSE)
- Status: `WIRED`

---

**E07 — Telemetry Panel**
- Product area: AI Operations Infrastructure
- Role: OP
- Purpose: Service metrics display via SSE stream
- Backend APIs: `GET /runtime/stream` (SSE), `GET /ops`
- Status: `WIRED`

---

**E08 — Adapter Panel**
- Product area: Shared Infrastructure
- Role: OP
- Purpose: Service connectivity status — WhatsApp, AI, Payments, Telegram
- Backend APIs: `GET /ops` (from App state)
- Status: `PARTIAL`

---

**E09 — Plugin Manager Panel**
- Product area: Shared Infrastructure
- Role: OP
- Purpose: Runtime plugin registry display
- Backend APIs: None
- Status: `STATIC`

---

**E10 — Floating Window**
- Product area: Shared Infrastructure
- Role: OP
- Purpose: Always-on-top compact overlay (350×480) — same app loaded with `?desktop=1`
- Status: `WIRED` — loads same app bundle

---

**E11 — IPC Bridge**
- Product area: Shared Infrastructure
- Role: OP
- Purpose: Electron IPC handles — sendCommand (offline dispatch), reportCrash, getRendererCrashes, getEvolutionScore, getSuggestions
- Status: `WIRED`

---

## PLATFORM 3: FLUTTER APP (8 screens)

---

**F01 — Splash Screen**
- Route: `/splash`
- Purpose: Auth state check → redirect
- Backend APIs: Firebase Auth state (client-side)
- Status: `PARTIAL`

---

**F02 — Login Screen**
- Route: `/login`
- Purpose: Firebase email/password sign-in
- Backend APIs: Firebase Auth `signInWithEmailAndPassword`
- Status: `WIRED`

---

**F03 — Sign Up Screen**
- Route: `/signup`
- Purpose: Firebase account creation
- Backend APIs: Firebase Auth `createUserWithEmailAndPassword`
- Status: `WIRED`

---

**F04 — Dashboard Screen**
- Route: `/dashboard`
- Purpose: Main app — user card, billing plan, server health, quick-action grid
- Backend APIs: `GET /billing/status`, `GET /health`
- Status: `WIRED`
- Missing: 4 quick-action tiles navigate to dead routes

---

**F05 — AI Chat Screen**
- Route: `/chat`
- Purpose: Chat interface with Jarvis AI + Firebase history
- Backend APIs: `POST /jarvis`, Firebase Firestore (chat history)
- Status: `DEAD` — GoRoute missing, tile navigates to error page
- Missing: GoRoute definition + ChatScreen widget

---

**F06 — Tasks Screen**
- Route: `/tasks`
- Purpose: Task list and dispatch
- Backend APIs: `GET /tasks`, `POST /runtime/dispatch`
- Status: `DEAD` — GoRoute missing
- Missing: GoRoute definition + TasksScreen widget

---

**F07 — Metrics Screen**
- Route: `/metrics`
- Purpose: Stats dashboard — leads, revenue, automation
- Backend APIs: `GET /stats`, `GET /ops`, `GET /metrics`
- Status: `DEAD` — GoRoute missing
- Missing: GoRoute definition + MetricsScreen widget

---

**F08 — Settings Screen**
- Route: `/settings`
- Purpose: Account settings, notification preferences
- Backend APIs: `GET /settings/status`
- Status: `DEAD` — GoRoute missing
- Missing: GoRoute definition + SettingsScreen widget

---

## PLATFORM 4: CAPACITOR MOBILE APP (8 screens)

---

**M01 — Login**
- Purpose: Firebase email/password sign-in
- Backend APIs: Firebase Auth
- Status: `WIRED`

---

**M02 — Signup**
- Purpose: Firebase account creation
- Backend APIs: Firebase Auth
- Status: `WIRED`

---

**M03 — Home (AI Chat)**
- Nav: Bottom tab → Home
- Purpose: AI chat interface with quick-action chips and Firebase history
- Backend APIs: `POST /jarvis`, `GET /health`, Firebase Firestore
- Status: `WIRED`

---

**M04 — Dashboard**
- Nav: Bottom tab → Dashboard
- Purpose: Business metrics — lead stats, revenue, automation tier activity
- Backend APIs: `GET /stats`, `GET /ops`, `GET /metrics`
- Status: `WIRED`

---

**M05 — Tools**
- Nav: Bottom tab → Tools
- Purpose: Business tools — AI task generator, payment link creator, WhatsApp follow-up, CRM lead list
- Backend APIs: `POST /jarvis`, `POST /payment/link`, `POST /send-followup`, `GET /crm`, `POST /whatsapp/send`
- Status: `WIRED`

---

**M06 — Profile**
- Nav: Bottom tab → Profile
- Purpose: Account info display and sign-out
- Backend APIs: Firebase Auth (profile read + sign-out)
- Status: `PARTIAL` — Firebase only, no `/auth/me` sync

---

**M07 — Privacy Policy**
- Nav: Profile footer link
- Status: `STATIC` — correct by design

---

**M08 — Terms of Service**
- Nav: Profile footer link
- Status: `STATIC` — correct by design

---

## SUMMARY COUNTS

| Platform | Total | WIRED | PARTIAL | STATIC/Design | NEEDS-BACKEND | DEAD |
|---|---|---|---|---|---|---|
| Web (S01–S48) | 48 | 24 | 5 | 14 | 5 | 0 |
| Electron (E01–E11) | 11 | 8 | 1 | 2 | 0 | 0 |
| Flutter (F01–F08) | 8 | 3 | 1 | 0 | 0 | 4 |
| Capacitor (M01–M08) | 8 | 5 | 1 | 2 | 0 | 0 |
| **Total** | **75** | **40** | **8** | **18** | **5** | **4** |
