# COMPLETE PRODUCT SURFACE MAP
Date: 2026-06-06 | Surfaces: Web App · Electron App · Flutter App · Capacitor Mobile App
Method: Full component scan + App.jsx tab routing + operator panel audit + mobile page audit

---

## PRODUCT AREAS (Legend)

| Code | Area |
|---|---|
| **ENG** | Autonomous Engineering Assistant |
| **WOS** | Workflow Operating System |
| **DEV** | AI DevOps Runtime |
| **SH** | Self-Healing Automation Platform |
| **OPS** | AI Operations Infrastructure |
| **COP** | Developer Execution Copilot |
| **CRM** | CRM / Business Automation |
| **INF** | Shared Infrastructure |

**Implementation Status:**
- `WIRED` — makes real backend API calls, live data
- `PARTIAL` — some API calls, some static data
- `STATIC` — renders seed/localStorage data only, no backend calls
- `DEAD` — screen exists but target route has no GoRoute / no rendering logic

---

## SURFACE 1: WEB APP

**Navigation structure:** Single-page app. Top tab bar has 5 direct tabs + "More ▾" dropdown with 48 additional destinations. Auth gate: requires `jarvis_started` + `jarvis_biz_profile` in localStorage.

---

### TOP-LEVEL TABS (always visible)

---

#### Screen: Control Center
- **Tab ID:** `home`
- **Nav path:** Top bar → "Control Center" (featured tab)
- **Product area:** CRM / Shared Infrastructure
- **Purpose:** Home dashboard — live runtime status, task dispatch, lead pipeline summary, service health widget
- **Expected user actions:** Dispatch a task via text input, view live queue depth, check service status, navigate to other screens
- **Expected backend APIs:** `GET /stats`, `GET /ops`, `GET /health`, `POST /runtime/dispatch`
- **Expected engines:** RuntimeOrchestrator, TaskQueue
- **Implementation status:** `WIRED` — stats and ops data polled on mount; task dispatch wired to `/runtime/dispatch`

---

#### Screen: Execution (Operator Console)
- **Tab ID:** `runtime`
- **Nav path:** Top bar → "Execution"
- **Product area:** OPS — AI Operations Infrastructure
- **Purpose:** Full operator cockpit — SSE stream, task log, emergency controls, browser automation, workflow runner, telemetry. Electron-default tab.
- **Expected user actions:** Execute commands, trigger emergency stop/resume, run browser automation workflows, view live execution stream
- **Expected backend APIs:** `GET /runtime/stream` (SSE), `POST /runtime/dispatch`, `POST /runtime/emergency/stop`, `POST /runtime/emergency/resume`, `POST /runtime/reboot`, full `/browser/*` API (30+ endpoints)
- **Expected engines:** RuntimeOrchestrator, BrowserAgent, TaskQueue, ExecutionHistory
- **Implementation status:** `WIRED` — all 6 operator sub-panels make real API calls
- **Sub-panels (Electron & Web):**
  - ExecLogPanel — `POST /runtime/dispatch`, emergency controls
  - GovernorPanel — `POST /runtime/reboot`, ops health
  - WorkflowPanel — trigger dispatch via callback (42 API refs)
  - BrowserAutomationPanel — full `/browser/*` API (15 API refs)
  - AIConsolePanel — AI command dispatch
  - AdapterPanel — service connectivity status
  - TaskQueuePanel — runtime queue state via useRuntimeStream
  - TelemetryPanel — ops/metrics via useRuntimeStream
  - PluginManagerPanel — plugin registry (static display)

---

#### Screen: Intelligence (Chat)
- **Tab ID:** `chat`
- **Nav path:** Top bar → "Intelligence"
- **Product area:** CRM / OPS
- **Purpose:** AI chat interface — converse with Jarvis, execute natural language commands
- **Expected user actions:** Type message, send command, clear history, use quick-action chips
- **Expected backend APIs:** `POST /jarvis`, `POST /ai/chat`
- **Expected engines:** RuntimeOrchestrator → aiService (Groq/OpenAI/Ollama)
- **Implementation status:** `WIRED` — chat messages dispatched to `/jarvis`; SSE stream monitored

---

#### Screen: Pipeline (Dashboard)
- **Tab ID:** `insights`
- **Nav path:** Top bar → "Pipeline"
- **Product area:** CRM
- **Purpose:** Business pipeline overview — lead count, revenue, follow-up stats, automation activity
- **Expected user actions:** View pipeline KPIs, check automation tiers, navigate to contacts
- **Expected backend APIs:** `GET /stats`, `GET /ops`
- **Expected engines:** CRM, AutomationEngine
- **Implementation status:** `WIRED` — stats polled from `/stats` and `/ops`

---

#### Screen: Contacts
- **Tab ID:** `clients`
- **Nav path:** Top bar → "Contacts"
- **Product area:** CRM
- **Purpose:** Lead CRM — add contacts, send WhatsApp messages, generate payment links, manage follow-ups
- **Expected user actions:** Add contact (name + phone), send WhatsApp message, create payment link, view lead list
- **Expected backend APIs:** `GET /crm`, `POST /crm`, `POST /payment/link`, `POST /whatsapp/send`, `POST /send-followup`
- **Expected engines:** CRM, PaymentService, WhatsAppBridge
- **Implementation status:** `WIRED` — CRM and payment APIs called; WhatsApp send wired

---

### MORE ▾ DROPDOWN — GETTING STARTED / SYSTEM

---

#### Screen: Getting Started
- **Tab ID:** `success`
- **Nav path:** More → "Getting Started"
- **Product area:** INF
- **Purpose:** Onboarding completion — checklist, first actions, trial status
- **Expected user actions:** Complete setup steps, navigate to feature screens
- **Expected backend APIs:** `GET /billing/status`, `GET /stats`, `GET /ops`
- **Expected engines:** BillingService
- **Implementation status:** `PARTIAL` — billing data loaded; some checklist items static

---

#### Screen: Overview
- **Tab ID:** `overview`
- **Nav path:** More → "Overview"
- **Product area:** INF
- **Purpose:** Capabilities overview — what Jarvis can do, product surface map
- **Expected user actions:** Read feature descriptions, click to navigate to capabilities
- **Expected backend APIs:** None required
- **Expected engines:** None
- **Implementation status:** `STATIC` — informational only, correct by design

---

#### Screen: History
- **Tab ID:** `activity`
- **Nav path:** More → "History"
- **Product area:** OPS
- **Purpose:** Execution log — task dispatch history, agent outputs, error log
- **Expected user actions:** Browse execution history, filter by status, view task details
- **Expected backend APIs:** `GET /runtime/history`, `GET /ops`
- **Expected engines:** ExecutionHistory
- **Implementation status:** `STATIC` — renders opsData from App-level state; no direct history API call from this component

---

#### Screen: Billing
- **Tab ID:** `billing`
- **Nav path:** More → "Billing"
- **Product area:** INF
- **Purpose:** Subscription management — plan status, upgrade, trial info
- **Expected user actions:** View plan, upgrade to paid tier, see usage
- **Expected backend APIs:** `GET /billing/status`, `POST /billing/upgrade`
- **Expected engines:** BillingService
- **Implementation status:** `WIRED` — billing status and upgrade calls made

---

#### Screen: Help & Guides
- **Tab ID:** `help`
- **Nav path:** More → "Help & Guides"
- **Product area:** INF
- **Purpose:** Documentation, keyboard shortcuts, FAQs
- **Expected user actions:** Browse guides, copy code snippets
- **Expected backend APIs:** None
- **Expected engines:** None
- **Implementation status:** `STATIC` — informational, correct by design

---

### MORE ▾ DROPDOWN — GROWTH / MARKETING

---

#### Screen: SEO Command Center
- **Tab ID:** `seo`
- **Nav path:** More → "SEO"
- **Product area:** CRM
- **Purpose:** SEO keyword tracking, meta generation, SERP monitoring
- **Expected user actions:** Run keyword scan, generate meta descriptions, view rank changes
- **Expected backend APIs:** None currently mapped (growth engine not yet built)
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

#### Screen: Content Engine
- **Tab ID:** `content`
- **Nav path:** More → "Content"
- **Product area:** CRM
- **Purpose:** AI content generation — blog posts, social copy, email drafts
- **Expected user actions:** Generate content, set topic, choose format
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

#### Screen: Social Hub
- **Tab ID:** `social`
- **Nav path:** More → "Social"
- **Product area:** CRM
- **Purpose:** Social media scheduling and posting management
- **Expected user actions:** Schedule posts, view calendar, connect social accounts
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

#### Screen: Email Marketing OS
- **Tab ID:** `email`
- **Nav path:** More → "Email"
- **Product area:** CRM
- **Purpose:** Email campaign management, sequence builder, analytics
- **Expected user actions:** Create campaigns, set sequences, view open rates
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

#### Screen: Referral Engine
- **Tab ID:** `referral`
- **Nav path:** More → "Referral"
- **Product area:** CRM
- **Purpose:** Referral program management — links, tracking, rewards
- **Expected user actions:** Generate referral links, view referrals, set rewards
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

#### Screen: Partner Program
- **Tab ID:** `partners`
- **Nav path:** More → "Partners"
- **Product area:** CRM
- **Purpose:** Partner / reseller program management
- **Expected user actions:** Enroll partners, track commissions, view partner activity
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

#### Screen: Launch Command Center
- **Tab ID:** `launch`
- **Nav path:** More → "Launch"
- **Product area:** CRM
- **Purpose:** Product launch planning — pre-launch checklist, launch day coordination
- **Expected user actions:** Run launch checklist, trigger launch sequences
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold only

---

### MORE ▾ DROPDOWN — PERSONAL / BUSINESS OS

---

#### Screen: Personal OS
- **Tab ID:** `personal`
- **Nav path:** More → "Personal"
- **Product area:** CRM
- **Purpose:** Personal productivity — goals, tasks, daily planner
- **Expected user actions:** Set goals, manage tasks, view daily schedule
- **Expected backend APIs:** `POST /jarvis` (via toast handler), settings
- **Expected engines:** TaskQueue, AI
- **Implementation status:** `STATIC` — personal task management uses localStorage

---

#### Screen: Business OS
- **Tab ID:** `business`
- **Nav path:** More → "Business"
- **Product area:** CRM
- **Purpose:** Business strategy — KPIs, revenue goals, market analysis
- **Expected user actions:** Set business KPIs, view revenue metrics, update strategy
- **Expected backend APIs:** `GET /stats`, `POST /jarvis`
- **Expected engines:** CRM, AI
- **Implementation status:** `STATIC` — renders seed business data

---

#### Screen: Developer OS
- **Tab ID:** `developer`
- **Nav path:** More → "Developer"
- **Product area:** COP
- **Purpose:** Developer productivity overview — repos, tasks, environments
- **Expected user actions:** View dev environment status, quick-navigate to engineering tools
- **Expected backend APIs:** None directly; navigates to Copilot/Engineering
- **Expected engines:** None directly
- **Implementation status:** `STATIC` — navigation hub

---

#### Screen: Enterprise OS
- **Tab ID:** `enterprise`
- **Nav path:** More → "Enterprise"
- **Product area:** INF
- **Purpose:** Enterprise multi-org management — organizations, departments, teams, roles, permissions, policies, audit log
- **Expected user actions:** Create/edit orgs, manage teams, define roles, set policies, review audit trail
- **Expected backend APIs:** Full `enterpriseApi` — orgs, depts, teams, roles, permissions, policies, audit events (20+ endpoints)
- **Expected engines:** EnterpriseManagementEngine
- **Implementation status:** `WIRED` — full CRUD wired via `enterpriseApi`

---

#### Screen: Team Workspace
- **Tab ID:** `team`
- **Nav path:** More → "Team"
- **Product area:** INF
- **Purpose:** Team collaboration — members, shared workspace, tasks
- **Expected user actions:** Add team members, assign tasks, view shared activity
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold

---

#### Screen: Enterprise CRM
- **Tab ID:** `ecrm`
- **Nav path:** More → "CRM"
- **Product area:** CRM
- **Purpose:** Full CRM — contacts, deals, pipeline stages, company management
- **Expected user actions:** Manage contacts, move deals through pipeline, view company profiles
- **Expected backend APIs:** `GET /crm`, `POST /crm`, CRM pipeline endpoints
- **Expected engines:** CRM
- **Implementation status:** `STATIC` — renders seed CRM data, no live API calls from this component

---

#### Screen: Executive Reports
- **Tab ID:** `reports`
- **Nav path:** More → "Reports"
- **Product area:** CRM
- **Purpose:** Business intelligence reports — revenue, leads, conversion rates
- **Expected user actions:** View reports, export data, set date ranges
- **Expected backend APIs:** `GET /stats`, `GET /ops`
- **Expected engines:** CRM, MetricsStore
- **Implementation status:** `STATIC` — renders seed report data

---

#### Screen: Settings
- **Tab ID:** `settings`
- **Nav path:** More → "Settings"
- **Product area:** INF
- **Purpose:** Workspace configuration — WhatsApp setup, API keys, billing, operator preferences
- **Expected user actions:** Connect WhatsApp, set webhook, configure integrations, change password
- **Expected backend APIs:** `GET /settings/status`, `POST /settings/whatsapp`, `POST /settings/webhook`
- **Expected engines:** SettingsService
- **Implementation status:** `PARTIAL` — WhatsApp setup wired; general settings mostly static

---

### MORE ▾ DROPDOWN — KNOWLEDGE / MEMORY

---

#### Screen: Knowledge Center
- **Tab ID:** `knowledge`
- **Nav path:** More → "Knowledge"
- **Product area:** WOS
- **Purpose:** Knowledge base management — FAQs, articles, agent knowledge
- **Expected user actions:** Browse articles, create FAQ entries, tag content
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — placeholder

---

#### Screen: Memory OS
- **Tab ID:** `memory`
- **Nav path:** More → "Memory"
- **Product area:** WOS
- **Purpose:** Persistent memory — store, browse, search, edit business/user/workflow memory nodes
- **Expected user actions:** Add memory (type/importance/title/body/tags), search, filter by type, delete, edit
- **Expected backend APIs:** `POST /p18/memory`, `GET /p18/memory`, `GET /p18/memory/search`, `PATCH /p18/memory/:id`, `DELETE /p18/memory/:id`
- **Expected engines:** MemoryPersistenceLayer
- **Implementation status:** `WIRED` — full CRUD wired; fallback to localStorage seed

---

#### Screen: Integrations
- **Tab ID:** `integrations`
- **Nav path:** More → "Integrations"
- **Product area:** INF
- **Purpose:** Third-party integration management — OAuth connections, webhook setup, API keys
- **Expected user actions:** Connect Google/GitHub/Slack/Notion, view connection status, disconnect
- **Expected backend APIs:** `GET /oauth/status`, `GET /oauth/connections`, `GET /oauth/:provider/url`
- **Expected engines:** OAuthIntegrationLayer
- **Implementation status:** `STATIC` — integration list UI; OAuth flow not triggered from this component

---

### MORE ▾ DROPDOWN — AUTONOMOUS ENGINEERING CLUSTER

---

#### Screen: Agent OS (Agent Center)
- **Tab ID:** `agents`
- **Nav path:** More → "Agents"
- **Product area:** WOS — Workflow Operating System
- **Purpose:** Agent registry — view all agents, toggle active/pause, execute tasks, view activity feed
- **Expected user actions:** Browse agents by type/status, click to open detail, enter task → "▷ Execute", view recent activity
- **Expected backend APIs:** `GET /p18/agents`, `GET /p18/agents/failures`, `POST /p18/agents/:id/execute`
- **Expected engines:** AgentExecutionEngine
- **Implementation status:** `WIRED` — agents listed from backend; execute form added (Phase 33)

---

#### Screen: Developer Copilot
- **Tab ID:** `copilot`
- **Nav path:** More → "Copilot"
- **Product area:** COP — Developer Execution Copilot
- **Purpose:** Code development assistant — repo index, code review, refactor detection, branch/PR management
- **Expected user actions:** Index repo path, submit code for review, scan for duplications/smells, browse PRs, view reviews
- **Expected backend APIs:** `POST /p24/repo/index`, `GET /p24/repo/status`, `POST /p23/review/code`, `GET /p23/review`, `POST /p24/refactor/detect/dup`, `POST /p24/refactor/detect/oversized`, `GET /p24/refactor/plans`
- **Expected engines:** RepoIntelligenceEngine, CodeReviewEngine, AutonomousRefactorEngine
- **Implementation status:** `WIRED` — index, review, refactor detection all wired (Phase 33)

---

#### Screen: Engineering Center
- **Tab ID:** `engineering`
- **Nav path:** More → "Engineering"
- **Product area:** ENG — Autonomous Engineering Assistant
- **Purpose:** Engineering lifecycle board — Requirement → Plan → Build → Review → Test → Done. Mission launcher for autopilot.
- **Expected user actions:** View task board by stage, advance tasks, launch autopilot mission (goal + repo), create local tasks
- **Expected backend APIs:** `POST /p23/autopilot/missions`, `GET /p23/autopilot/missions`, `GET /p23/autopilot/stats`, `GET /p23/github/activity`
- **Expected engines:** EngineeringAutopilot, GitHubEngineeringAgent
- **Implementation status:** `WIRED` — mission launcher added (Phase 33); board loads live missions

---

#### Screen: DevOps Runtime
- **Tab ID:** `devops`
- **Nav path:** More → "DevOps"
- **Product area:** DEV — AI DevOps Runtime
- **Purpose:** Deployment dashboard — deployments, services, infrastructure, incidents, SLOs, alerts. Canary deploy trigger.
- **Expected user actions:** View deployment history, click "▷ Deploy Canary" → modal, browse SLOs, resolve alerts, filter by environment
- **Expected backend APIs:** `POST /p25/deploy/canary`, `GET /p25/deploy`, `GET /p25/deploy/history`, `GET /p25/obs/slos`, `GET /p25/obs/alerts`, `POST /p25/obs/alerts/:id/resolve`, `GET /p25/obs/metrics`, `GET /p25/obs/alerts/rules`
- **Expected engines:** DeploymentAutopilot, EnterpriseObservability
- **Implementation status:** `WIRED` — 6 tabs all wired; canary deploy form added (Phase 33)

---

#### Screen: Self-Healing Platform
- **Tab ID:** `selfhealing`
- **Nav path:** More → "Self-Healing"
- **Product area:** SH — Self-Healing Automation Platform
- **Purpose:** Runtime health — health checks, recovery history, prevention rules, incident timeline, failure prediction
- **Expected user actions:** View check status, click "Probe", toggle prevention rules, browse incident timeline, view at-risk services
- **Expected backend APIs:** `GET /p19/heal/status`, `GET /p19/heal/history`, `POST /p19/heal/probe`, `POST /p19/heal/task/:id`, `POST /p19/heal/circuit-break`
- **Expected engines:** SelfHealingRuntime
- **Implementation status:** `WIRED` — all tabs load live data; probe button calls real API

---

#### Screen: Agent Registry
- **Tab ID:** `registry`
- **Nav path:** More → "Registry"
- **Product area:** WOS
- **Purpose:** Master agent registry — all agents with full capability/permission/tool/memory profile
- **Expected user actions:** Browse agents, filter by type/status, view capability profile, archive agents
- **Expected backend APIs:** `GET /p18/agents`, `GET /p20/agents`
- **Expected engines:** AgentExecutionEngine, AgentFactoryAutomation
- **Implementation status:** `WIRED` — agents from both p18 and p20 APIs merged

---

#### Screen: Task Router
- **Tab ID:** `taskrouter`
- **Nav path:** More → "Task Router"
- **Product area:** WOS
- **Purpose:** Task routing — view incoming tasks, agent assignments, reassign, escalate, view history
- **Expected user actions:** Browse task queue, reassign task to different agent, escalate flagged tasks, filter by priority/category
- **Expected backend APIs:** `GET /p18/agents`, `GET /p18/agents/:id/history`
- **Expected engines:** AgentExecutionEngine
- **Implementation status:** `WIRED` — live agent history populates task rows

---

#### Screen: Memory Fabric (Shared Memory)
- **Tab ID:** `sharedmem`
- **Nav path:** More → "Memory Fabric"
- **Product area:** WOS
- **Purpose:** Cross-agent shared memory — global/company/agent/project memory nodes with graph view
- **Expected user actions:** Browse memory by scope, view graph, select node to see linked memories, search
- **Expected backend APIs:** `GET /p18/memory?limit=100`
- **Expected engines:** MemoryPersistenceLayer
- **Implementation status:** `WIRED` — nodes loaded from backend; graph rendered

---

#### Screen: Operations Center
- **Tab ID:** `operations`
- **Nav path:** More → "Operations"
- **Product area:** OPS
- **Purpose:** Agent ops — throughput metrics, queue health, error rates, production readiness score
- **Expected user actions:** View agent throughput table, check queue depth, see readiness score banner
- **Expected backend APIs:** `GET /p21/readiness/report`
- **Expected engines:** ProductionReadinessEngine
- **Implementation status:** `WIRED` — readiness score banner shows live 89/100 score

---

#### Screen: Agent Collaboration Engine
- **Tab ID:** `collab`
- **Nav path:** More → "Collaboration"
- **Product area:** WOS
- **Purpose:** Multi-agent coordination — handoffs, escalations, triggers, shared tasks, collaboration graph
- **Expected user actions:** View handoff feed, browse graph, start coordination session (collaborate/handoff/delegate mode), view shared tasks
- **Expected backend APIs:** `GET /p19/coord/sessions`, `GET /p19/coord/sessions/stats`, `POST /p19/coord/collaborate`, `POST /p19/coord/handoff`, `POST /p19/coord/delegate`
- **Expected engines:** MultiAgentCoordinator
- **Implementation status:** `WIRED` — session list loaded; "+ Start Session" form added (Phase 33)

---

#### Screen: Tool Fabric
- **Tab ID:** `toolfabric`
- **Nav path:** More → "Tool Fabric"
- **Product area:** WOS
- **Purpose:** Tool registry — list all agent tools, health, permissions, usage. Connect/disconnect. Execute with input.
- **Expected user actions:** Browse tool list, select tool, enter input → "▷ Run", toggle permissions, connect/disconnect
- **Expected backend APIs:** `GET /p19/tools`, `GET /p19/tools/status`, `POST /p19/tools/:id/execute`, `PUT /p19/tools/:id/permissions/:action`
- **Expected engines:** ToolExecutionLayer
- **Implementation status:** `WIRED` — tool list loaded; execute form added (Phase 33)

---

#### Screen: Autonomous Company Center
- **Tab ID:** `autonomy`
- **Nav path:** More → "Autonomous Co"
- **Product area:** WOS
- **Purpose:** Autonomous workflow cycles — trigger → agent → tool → action → result visualization
- **Expected user actions:** View active cycles, click "+ New Workflow" → modal (goal + type) → launch cycle
- **Expected backend APIs:** `GET /p18/cycles`, `GET /p18/cycles/stats`, `POST /p18/cycles`
- **Expected engines:** AutonomousTaskLoop
- **Implementation status:** `WIRED` — cycles listed from backend; launch form added (Phase 33)

---

#### Screen: Execution Orchestrator
- **Tab ID:** `orchestrator`
- **Nav path:** More → "Orchestrator"
- **Product area:** OPS
- **Purpose:** Goal → task → agent → tool chain visualization. Full execution chain history.
- **Expected user actions:** View execution chains, browse retry map, filter by status, inspect individual chain
- **Expected backend APIs:** `GET /p18/cycles`, `GET /p18/cycles/stats`, `GET /p18/actions`
- **Expected engines:** AutonomousTaskLoop, RuntimeActionEngine
- **Implementation status:** `WIRED` — chains loaded from cycles API; retry map shown

---

#### Screen: Execution Connector
- **Tab ID:** `execconnector`
- **Nav path:** More → "Exec Connectors"
- **Product area:** WOS
- **Purpose:** Integration connector registry — external tool connections, action history per connector
- **Expected user actions:** View connector list, toggle connected/disconnected, view live action log
- **Expected backend APIs:** `GET /p18/actions?status=completed`, `GET /p18/actions?status=failed`, `GET /p18/actions/audit`
- **Expected engines:** RuntimeActionEngine
- **Implementation status:** `WIRED` — live action history loaded for connected/failed tabs

---

#### Screen: Autonomous Workflows
- **Tab ID:** `autonomouswf`
- **Nav path:** More → "Auto Workflows"
- **Product area:** WOS
- **Purpose:** Workflow list + flow visualization — Trigger → Agent → Tool → Action → Result per workflow
- **Expected user actions:** View workflow cards, click to inspect flow steps, filter by status, launch new cycle
- **Expected backend APIs:** `GET /p18/cycles`, `GET /p18/cycles/stats`, `POST /p18/cycles`
- **Expected engines:** AutonomousTaskLoop
- **Implementation status:** `WIRED` — same as Autonomous Company Center with flow visualization emphasis

---

#### Screen: Agent Action Center
- **Tab ID:** `agentactions`
- **Nav path:** More → "Agent Actions"
- **Product area:** WOS
- **Purpose:** Action queue — executed / pending / failed actions + human approval queue + autonomous approvals
- **Expected user actions:** Browse action tabs, approve/deny high-risk actions, view autonomous approvals
- **Expected backend APIs:** `GET /p18/actions?status=completed`, `GET /p18/actions?status=failed`, `GET /p18/actions?status=pending`, `GET /p18/actions/audit`
- **Expected engines:** RuntimeActionEngine
- **Implementation status:** `WIRED` — all three status tabs populated from backend

---

### MORE ▾ DROPDOWN — INTELLIGENCE / LEARNING

---

#### Screen: Agent Factory
- **Tab ID:** `agentfactory`
- **Nav path:** More → "Agent Factory"
- **Product area:** ENG
- **Purpose:** Create and manage AI agents — 8-template gallery, clone, train, retire
- **Expected user actions:** Choose template, click "Create Agent" → modal (name/model/description), clone existing, submit training examples
- **Expected backend APIs:** `GET /p20/agents`, `POST /p20/agents`, `GET /p20/agents/stats`
- **Expected engines:** AgentFactoryAutomation
- **Implementation status:** `WIRED` — create wired to backend; training form fires analytics (no backend endpoint yet)

---

#### Screen: Memory Intelligence
- **Tab ID:** `memoryintel`
- **Nav path:** More → "Memory Intel"
- **Product area:** WOS
- **Purpose:** Memory intelligence analytics — importance scoring, staleness tracking, cross-agent usage heatmap
- **Expected user actions:** View memory health scores, identify stale nodes, analyze usage patterns
- **Expected backend APIs:** `GET /p20/memory`, `GET /p20/memory/insights`, `POST /p20/memory/analyze`, `GET /p18/memory/stats`
- **Expected engines:** MemoryIntelligenceEngine, MemoryPersistenceLayer
- **Implementation status:** `WIRED` — memory intelligence data loaded from p20 + p18 APIs

---

#### Screen: Self-Improvement Engine
- **Tab ID:** `selfimprove`
- **Nav path:** More → "Self-Improve"
- **Product area:** WOS
- **Purpose:** Continuous learning — lessons learned, failure patterns, optimization opportunities, agent recommendations
- **Expected user actions:** Browse lessons, view failure patterns, view performance bars, apply recommendations, trigger re-analysis
- **Expected backend APIs:** `GET /p19/learn/lessons`, `GET /p19/learn/recommendations`, `GET /p19/learn/stats`, `POST /p19/learn/analyze`
- **Expected engines:** ContinuousLearningEngine
- **Implementation status:** `WIRED` — lessons and recommendations from backend; re-analyze button calls real API

---

#### Screen: Jarvis Brain Center
- **Tab ID:** `jarvisbrain`
- **Nav path:** More → "Jarvis Brain"
- **Product area:** OPS
- **Purpose:** Animated system visualization — goal → planning → memory → agents → tools → execution → learning loop
- **Expected user actions:** View animated flow, see live cycle count and goal completion
- **Expected backend APIs:** `GET /p18/cycles/stats`, `GET /p20/ooplix/status`
- **Expected engines:** AutonomousTaskLoop, OoplixAutonomyEngine
- **Implementation status:** `WIRED` — live cycle totals and autonomy status update the animated display

---

#### Screen: Autonomy Score Center
- **Tab ID:** `autonomyscore`
- **Nav path:** More → "Autonomy Score"
- **Product area:** OPS
- **Purpose:** Autonomy measurement — per-dimension scores (Automation/Memory/Execution/Learning/Coordination), trend chart, improvement opportunities
- **Expected user actions:** View score gauges, read weekly trend, explore improvement opportunities
- **Expected backend APIs:** `GET /p20/ooplix/score`, `GET /p20/ooplix/status`
- **Expected engines:** OoplixAutonomyEngine
- **Implementation status:** `WIRED` — live score overlaid on seed gauge data

---

#### Screen: Ooplix Runs Ooplix
- **Tab ID:** `oroplix`
- **Nav path:** More → "Ooplix Runs Ooplix"
- **Product area:** WOS
- **Purpose:** Full autonomous operation status — per-domain automation score (Revenue/Marketing/Support/Engineering/DevOps), goal tracking
- **Expected user actions:** Browse domain cards, view recent autonomous actions, check automation score per domain
- **Expected backend APIs:** `GET /p20/ooplix/status`, `GET /p20/ooplix/score`
- **Expected engines:** OoplixAutonomyEngine
- **Implementation status:** `WIRED` — live overall autonomy score shown; domain breakdown from seed data

---

### MORE ▾ DROPDOWN — INFRASTRUCTURE / COMPLIANCE

---

#### Screen: Data Ownership
- **Tab ID:** `dataowner`
- **Nav path:** More → "Data"
- **Product area:** INF
- **Purpose:** Data portability — export, delete, audit what's stored
- **Expected user actions:** Export data, view data categories, request deletion
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold

---

#### Screen: Support OS
- **Tab ID:** `supportos`
- **Nav path:** More → "Support"
- **Product area:** CRM
- **Purpose:** Support ticket management — inbound query routing, knowledge base access
- **Expected user actions:** View support tickets, route to agents, browse knowledge base
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold

---

#### Screen: Trust & Compliance
- **Tab ID:** `trustcompliance`
- **Nav path:** More → "Trust"
- **Product area:** INF
- **Purpose:** Compliance dashboard — audit logs, data handling policies, certifications
- **Expected user actions:** Browse audit events, view compliance status, export logs
- **Expected backend APIs:** None currently mapped from this component
- **Expected engines:** None implemented in this component
- **Implementation status:** `STATIC` — compliance display

---

#### Screen: Disaster Recovery
- **Tab ID:** `disasterrecovery`
- **Nav path:** More → "Recovery"
- **Product area:** SH
- **Purpose:** Disaster recovery planning — backup status, recovery procedures, RTO/RPO
- **Expected user actions:** View backup status, trigger recovery drill, view recovery runbook
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold

---

#### Screen: Mobile Platform
- **Tab ID:** `mobile`
- **Nav path:** More → "Mobile"
- **Product area:** INF
- **Purpose:** Mobile app management — Capacitor and Flutter build status, release notes
- **Expected user actions:** View build status, check release version, navigate to mobile docs
- **Expected backend APIs:** None
- **Expected engines:** None
- **Implementation status:** `STATIC` — informational

---

#### Screen: Community
- **Tab ID:** `community`
- **Nav path:** More → "Community"
- **Product area:** INF
- **Purpose:** Community hub — forum link, Discord, feedback
- **Expected user actions:** Link out to community, submit feedback
- **Expected backend APIs:** None
- **Expected engines:** None
- **Implementation status:** `STATIC` — placeholder

---

#### Screen: Marketplace
- **Tab ID:** `marketplace`
- **Nav path:** More → "Marketplace"
- **Product area:** INF
- **Purpose:** Agent and workflow marketplace — browse prebuilt agents/workflows to install
- **Expected user actions:** Browse marketplace listings, install agents/workflows
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — placeholder

---

#### Screen: AI Costs
- **Tab ID:** `aicost`
- **Nav path:** More → "AI Costs"
- **Product area:** OPS
- **Purpose:** LLM cost tracking — per-model token usage, cost breakdown, budget alerts
- **Expected user actions:** View cost by model, set budget alerts, see cost trend
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None implemented
- **Implementation status:** `STATIC` — UI scaffold

---

### MORE ▾ DROPDOWN — AUTONOMOUS BUSINESS OS

---

#### Screen: Autonomous Revenue
- **Tab ID:** `autorevenue`
- **Nav path:** More → "Auto Revenue"
- **Product area:** WOS / CRM
- **Purpose:** Revenue automation — autonomous lead qualification, deal closing, pipeline management
- **Expected user actions:** View revenue automation score, see recent autonomous actions, configure revenue goals
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None dedicated; uses CRM + Agent infrastructure
- **Implementation status:** `STATIC` — seed data display

---

#### Screen: Autonomous Marketing
- **Tab ID:** `automarketing`
- **Nav path:** More → "Auto Marketing"
- **Product area:** WOS / CRM
- **Purpose:** Marketing automation — content scheduling, campaign execution, SEO monitoring
- **Expected user actions:** View marketing automation status, see recent content actions
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None dedicated
- **Implementation status:** `STATIC` — seed data display

---

#### Screen: Autonomous Support
- **Tab ID:** `autosupport`
- **Nav path:** More → "Auto Support"
- **Product area:** WOS / CRM
- **Purpose:** Support automation — ticket deflection, auto-response, escalation routing
- **Expected user actions:** View support automation score, browse auto-resolved tickets
- **Expected backend APIs:** None currently mapped
- **Expected engines:** None dedicated
- **Implementation status:** `STATIC` — seed data display

---

### PRE-APP SCREENS (before auth)

---

#### Screen: Landing Page
- **Nav path:** `screen === "landing"` — direct URL or localStorage `jarvis_started !== "1"`
- **Product area:** INF
- **Purpose:** Marketing landing page — product pitch, CTA to start trial or sign in
- **Expected user actions:** Click "Start Free", click "Sign in", navigate to Pricing/Legal
- **Expected backend APIs:** None
- **Implementation status:** `STATIC` — marketing, correct by design

---

#### Screen: Onboarding
- **Nav path:** `screen === "onboarding"` — after landing, before app
- **Product area:** INF
- **Purpose:** Business profile setup — collect business name, industry, goals
- **Expected user actions:** Fill business profile form, complete steps
- **Expected backend APIs:** None (saves to localStorage)
- **Implementation status:** `STATIC` — localStorage-based

---

#### Screen: Login Page
- **Nav path:** Landing → "Sign in →" or auth gate when session expired
- **Product area:** INF
- **Purpose:** Email + password authentication
- **Expected user actions:** Enter email/password, submit
- **Expected backend APIs:** `POST /auth/login`, `GET /auth/me`
- **Implementation status:** `WIRED` — JWT cookie auth

---

#### Screen: Pricing Page
- **Nav path:** Landing → "See all plans →" or `screen === "pricing"`
- **Product area:** INF
- **Purpose:** Subscription plan comparison
- **Expected user actions:** View tiers, click upgrade CTA
- **Expected backend APIs:** None
- **Implementation status:** `STATIC` — marketing

---

### LEGAL SCREENS

All reachable via CompanyFooter links. `STATIC` — informational only.

| Screen | Nav path | Purpose |
|---|---|---|
| Company | Footer → "Company" | About Ooplix / Alwaliy Technologies |
| Privacy Policy | Footer → "Privacy Policy" | GDPR privacy notice |
| Terms of Service | Footer → "Terms of Service" | Usage terms |
| Refund Policy | Footer → "Refund Policy" | Refund terms |
| Contact | Footer → "Contact" | Contact information |
| Trust & Compliance | Footer → "Trust & Security" | Security posture |

---

## SURFACE 2: ELECTRON APP

Electron loads the same React app at `frontend/build/index.html` with `?desktop=1`. The `_IS_DESKTOP` flag is `true`, which causes:
1. `_initialScreen()` returns `"app"` directly (skips Landing and Onboarding)
2. Nav uses `DESKTOP_TABS` (identical to web `TABS`)
3. Default tab on first load: `home` (Control Center)
4. Commands route through `window.electronAPI.sendCommand()` → IPC → `POST /runtime/dispatch`

**All 56 web app tabs are accessible via the Electron shell via More ▾.**

Electron-exclusive capabilities (not available on web):

---

#### Panel: Operator Console (Execution Tab Default)
- **Nav path:** Execution tab (same as web) — but Electron defaults to this tab on startup
- **Product area:** OPS
- **Purpose:** Full operator cockpit with all 8 sub-panels in a grid layout
- **Electron-specific:** `window.electronAPI.sendCommand()` routes via IPC for offline-capable dispatch
- **Implementation status:** `WIRED`

---

#### Panel: Browser Automation Panel
- **Nav path:** Execution tab → "Browser" section (always-visible in Electron)
- **Product area:** COP
- **Purpose:** Full browser automation — run URL, search, library of saved workflows, replay
- **Expected user actions:** Enter URL/query, run automation, save to library, replay saved workflow, view history
- **Expected backend APIs:** Full `/browser/*` API (37 routes) — `POST /browser/run`, `GET /browser/library`, `POST /browser/library`, `GET /browser/history`, `POST /browser/replay/:id`
- **Expected engines:** BrowserAgent
- **Implementation status:** `WIRED` — 15 API references; full browser automation available

---

#### Panel: Floating Window
- **Nav path:** Triggered by Electron app (always-on-top, 350×480px)
- **Product area:** INF
- **Purpose:** Quick-access floating overlay — same React app, compact view
- **Implementation status:** Loads same app bundle with `?desktop=1`

---

#### IPC Commands Available (Electron-only)
| IPC Handle | Purpose |
|---|---|
| `send-command` | Route command through IPC → `/runtime/dispatch` |
| `report-renderer-crash` | Log renderer crashes to userData/renderer_crashes.json |
| `get-renderer-crashes` | Retrieve crash log ring buffer |
| `get-evolution-score` | Evolution scoring from runtime |
| `get-suggestions` | Workflow suggestions |

---

## SURFACE 3: FLUTTER APP

**Path:** `/Users/ehtsm/jarvis-os/flutter/lib/`
**Framework:** Flutter + Riverpod + GoRouter + Firebase Auth
**Backend:** Calls `GET /billing/status` and `GET /health`

---

#### Screen: Splash Screen
- **Route:** `/splash`
- **Nav path:** App launch → immediate
- **Product area:** INF
- **Purpose:** Auth state check — redirect to `/login` or `/dashboard` based on Firebase Auth state
- **Expected user actions:** None (automatic redirect)
- **Expected backend APIs:** Firebase Auth state check only (client-side)
- **Implementation status:** `PARTIAL` — Firebase auth check only

---

#### Screen: Login Screen
- **Route:** `/login`
- **Nav path:** Splash → if not authenticated
- **Product area:** INF
- **Purpose:** Email + password sign-in via Firebase Auth. Has "Sign Up" link.
- **Expected user actions:** Enter email/password, tap "Sign In", navigate to signup
- **Expected backend APIs:** Firebase Auth (client-side) — `signInWithEmailAndPassword`
- **Expected engines:** Firebase Auth
- **Implementation status:** `WIRED` — Firebase auth login works

---

#### Screen: Sign Up Screen
- **Route:** `/signup`
- **Nav path:** Login → "Sign Up" link
- **Product area:** INF
- **Purpose:** New account creation via Firebase Auth
- **Expected user actions:** Enter email/password, tap "Create Account", navigate to login
- **Expected backend APIs:** Firebase Auth — `createUserWithEmailAndPassword`
- **Expected engines:** Firebase Auth
- **Implementation status:** `WIRED` — Firebase auth signup works

---

#### Screen: Dashboard Screen
- **Route:** `/dashboard`
- **Nav path:** Successful login → redirect from splash
- **Product area:** CRM / INF
- **Purpose:** Main app dashboard — user card, billing plan status, server health, quick-action grid
- **Expected user actions:** View plan status, check server health, tap quick-action cards, sign out
- **Expected backend APIs:** `GET /billing/status`, `GET /health`
- **Expected engines:** BillingService, HealthMonitor
- **Implementation status:** `WIRED` — billing and health loaded; quick-action grid present

---

#### Screen: AI Chat (Dead Link)
- **Route:** `/chat` — **NO GoRoute defined**
- **Nav path:** Dashboard → "AI Chat" tile → `context.go('/chat')` → **GoRouter errorBuilder — "Page not found: /chat"**
- **Product area:** CRM
- **Purpose (intended):** Chat interface with Jarvis AI — same as web app chat
- **Expected backend APIs:** `POST /jarvis`
- **Implementation status:** `DEAD` — tile renders, route missing

---

#### Screen: Tasks (Dead Link)
- **Route:** `/tasks` — **NO GoRoute defined**
- **Nav path:** Dashboard → "Tasks" tile → **Page not found**
- **Product area:** WOS
- **Purpose (intended):** Task management — view, create, execute tasks
- **Expected backend APIs:** `GET /tasks`, `POST /runtime/dispatch`
- **Implementation status:** `DEAD` — tile renders, route missing

---

#### Screen: Metrics (Dead Link)
- **Route:** `/metrics` — **NO GoRoute defined**
- **Nav path:** Dashboard → "Metrics" tile → **Page not found**
- **Product area:** OPS
- **Purpose (intended):** Analytics — lead stats, revenue metrics, automation activity
- **Expected backend APIs:** `GET /stats`, `GET /ops`, `GET /metrics`
- **Implementation status:** `DEAD` — tile renders, route missing

---

#### Screen: Settings (Dead Link)
- **Route:** `/settings` — **NO GoRoute defined**
- **Nav path:** Dashboard → "Settings" tile → **Page not found**
- **Product area:** INF
- **Purpose (intended):** App settings — notification preferences, account management
- **Expected backend APIs:** `GET /settings/status`
- **Implementation status:** `DEAD` — tile renders, route missing

---

## SURFACE 4: CAPACITOR MOBILE APP (React)

**Path:** `/Users/ehtsm/jarvis-os/mobile/src/`
**Framework:** React + Capacitor + Firebase Auth
**Navigation:** Bottom tab bar (4 tabs) + Auth guard

---

#### Screen: Login
- **Route:** Default if not authenticated
- **Nav path:** App launch → if no Firebase user
- **Product area:** INF
- **Purpose:** Firebase email/password login
- **Expected user actions:** Enter credentials, tap login, navigate to signup
- **Expected backend APIs:** Firebase Auth
- **Implementation status:** `WIRED`

---

#### Screen: Signup
- **Route:** Login screen → "Sign Up" link
- **Product area:** INF
- **Purpose:** Firebase account creation
- **Expected user actions:** Enter email/password, create account
- **Expected backend APIs:** Firebase Auth
- **Implementation status:** `WIRED`

---

#### Screen: Home (AI Chat)
- **Nav path:** Bottom tab → Home icon
- **Product area:** CRM / OPS
- **Purpose:** AI chat interface — converse with Jarvis, quick-action chips, Firebase chat history
- **Expected user actions:** Type message, tap chip, view chat history, clear chat
- **Expected backend APIs:** `POST /jarvis`, `GET /health` (connectivity check), Firebase Firestore (chat history)
- **Expected engines:** RuntimeOrchestrator → Groq AI
- **Implementation status:** `WIRED` — `/jarvis` call + Firebase history + health check

---

#### Screen: Dashboard
- **Nav path:** Bottom tab → Dashboard icon
- **Product area:** CRM
- **Purpose:** Business metrics — lead stats, revenue, automation tier activity, follow-up rates
- **Expected user actions:** View stats cards, pull to refresh, see automation tier breakdowns
- **Expected backend APIs:** `GET /stats`, `GET /ops`, `GET /metrics`
- **Expected engines:** CRM, AutomationEngine, MetricsStore
- **Implementation status:** `WIRED` — stats and ops data fetched on mount + refresh

---

#### Screen: Tools
- **Nav path:** Bottom tab → Tools icon
- **Product area:** CRM
- **Purpose:** Business tools — AI task generator, payment link creator, WhatsApp follow-up sender, lead list
- **Expected user actions:** Generate AI task (text input), create payment link (amount + phone), send follow-up to lead, view lead list
- **Expected backend APIs:** `POST /jarvis` (task gen), `POST /payment/link`, `POST /send-followup`, `GET /crm`, `POST /whatsapp/send`
- **Expected engines:** RuntimeOrchestrator, PaymentService, WhatsAppBridge, CRM
- **Implementation status:** `WIRED` — all 4 tool sections call real backend endpoints

---

#### Screen: Profile
- **Nav path:** Bottom tab → Profile icon
- **Product area:** INF
- **Purpose:** User account — Firebase profile display, sign out
- **Expected user actions:** View account info, sign out
- **Expected backend APIs:** Firebase Auth (profile read + sign out)
- **Implementation status:** `PARTIAL` — Firebase profile only; no backend account sync

---

#### Screen: Privacy Policy
- **Nav path:** Profile → Privacy Policy link
- **Product area:** INF
- **Purpose:** Legal — privacy notice
- **Implementation status:** `STATIC` — informational

---

#### Screen: Terms of Service
- **Nav path:** Profile → Terms of Service link
- **Product area:** INF
- **Purpose:** Legal — usage terms
- **Implementation status:** `STATIC` — informational

---

## SUMMARY TABLE

### Web App — All 56 Screens

| # | Screen | Tab ID | Area | Status |
|---|---|---|---|---|
| 1 | Control Center | home | CRM/OPS | WIRED |
| 2 | Execution (Operator Console) | runtime | OPS | WIRED |
| 3 | Intelligence (Chat) | chat | CRM/OPS | WIRED |
| 4 | Pipeline (Dashboard) | insights | CRM | WIRED |
| 5 | Contacts | clients | CRM | WIRED |
| 6 | Getting Started | success | INF | PARTIAL |
| 7 | Overview | overview | INF | STATIC |
| 8 | History | activity | OPS | STATIC |
| 9 | Billing | billing | INF | WIRED |
| 10 | Help & Guides | help | INF | STATIC |
| 11 | SEO Command Center | seo | CRM | STATIC |
| 12 | Content Engine | content | CRM | STATIC |
| 13 | Social Hub | social | CRM | STATIC |
| 14 | Email Marketing OS | email | CRM | STATIC |
| 15 | Referral Engine | referral | CRM | STATIC |
| 16 | Partner Program | partners | CRM | STATIC |
| 17 | Launch Command Center | launch | CRM | STATIC |
| 18 | Personal OS | personal | CRM | STATIC |
| 19 | Business OS | business | CRM | STATIC |
| 20 | Developer OS | developer | COP | STATIC |
| 21 | Enterprise OS | enterprise | INF | WIRED |
| 22 | Team Workspace | team | INF | STATIC |
| 23 | Enterprise CRM | ecrm | CRM | STATIC |
| 24 | Executive Reports | reports | CRM | STATIC |
| 25 | Settings | settings | INF | PARTIAL |
| 26 | Knowledge Center | knowledge | WOS | STATIC |
| 27 | Memory OS | memory | WOS | WIRED |
| 28 | Integrations | integrations | INF | STATIC |
| 29 | Agent OS (Agent Center) | agents | WOS | WIRED |
| 30 | Developer Copilot | copilot | COP | WIRED |
| 31 | Engineering Center | engineering | ENG | WIRED |
| 32 | DevOps Runtime | devops | DEV | WIRED |
| 33 | Self-Healing Platform | selfhealing | SH | WIRED |
| 34 | Agent Registry | registry | WOS | WIRED |
| 35 | Task Router | taskrouter | WOS | WIRED |
| 36 | Memory Fabric | sharedmem | WOS | WIRED |
| 37 | Operations Center | operations | OPS | WIRED |
| 38 | Agent Collaboration Engine | collab | WOS | WIRED |
| 39 | Tool Fabric | toolfabric | WOS | WIRED |
| 40 | Autonomous Company Center | autonomy | WOS | WIRED |
| 41 | Execution Orchestrator | orchestrator | OPS | WIRED |
| 42 | Execution Connector | execconnector | WOS | WIRED |
| 43 | Autonomous Workflows | autonomouswf | WOS | WIRED |
| 44 | Agent Action Center | agentactions | WOS | WIRED |
| 45 | Agent Factory | agentfactory | ENG | WIRED |
| 46 | Memory Intelligence | memoryintel | WOS | WIRED |
| 47 | Self-Improvement Engine | selfimprove | WOS | WIRED |
| 48 | Jarvis Brain Center | jarvisbrain | OPS | WIRED |
| 49 | Autonomy Score Center | autonomyscore | OPS | WIRED |
| 50 | Ooplix Runs Ooplix | oroplix | WOS | WIRED |
| 51 | Data Ownership | dataowner | INF | STATIC |
| 52 | Support OS | supportos | CRM | STATIC |
| 53 | Trust & Compliance | trustcompliance | INF | STATIC |
| 54 | Disaster Recovery | disasterrecovery | SH | STATIC |
| 55 | Mobile Platform | mobile | INF | STATIC |
| 56 | Community | community | INF | STATIC |
| 57 | Marketplace | marketplace | INF | STATIC |
| 58 | AI Costs | aicost | OPS | STATIC |
| 59 | Autonomous Revenue | autorevenue | WOS/CRM | STATIC |
| 60 | Autonomous Marketing | automarketing | WOS/CRM | STATIC |
| 61 | Autonomous Support | autosupport | WOS/CRM | STATIC |
| — | Landing Page | (pre-app) | INF | STATIC |
| — | Onboarding | (pre-app) | INF | STATIC |
| — | Login Page | (pre-app) | INF | WIRED |
| — | Pricing Page | (pre-app) | INF | STATIC |
| — | Legal screens (6) | (footer) | INF | STATIC |

**Web total: 56 in-app tabs + 4 pre-app screens + 6 legal = 66 distinct screen surfaces**
**Wired: 30 | Partial: 3 | Static: 33**

---

### Electron App

All 56 web tabs available. Additional surfaces:

| # | Panel | Area | Status |
|---|---|---|---|
| E1 | Operator Console (cockpit layout) | OPS | WIRED |
| E2 | ExecLog Panel | OPS | WIRED |
| E3 | Governor Panel | OPS | WIRED |
| E4 | Workflow Panel | WOS | WIRED |
| E5 | Browser Automation Panel | COP | WIRED |
| E6 | AI Console Panel | OPS | WIRED |
| E7 | Adapter Panel | INF | PARTIAL |
| E8 | Task Queue Panel | OPS | WIRED |
| E9 | Telemetry Panel | OPS | WIRED |
| E10 | Plugin Manager Panel | INF | STATIC |
| E11 | Floating Window | INF | WIRED |

---

### Flutter App

| # | Screen | Route | Area | Status |
|---|---|---|---|---|
| F1 | Splash | /splash | INF | PARTIAL |
| F2 | Login | /login | INF | WIRED |
| F3 | Sign Up | /signup | INF | WIRED |
| F4 | Dashboard | /dashboard | CRM/INF | WIRED |
| F5 | AI Chat | /chat | CRM/OPS | **DEAD** |
| F6 | Tasks | /tasks | WOS | **DEAD** |
| F7 | Metrics | /metrics | OPS | **DEAD** |
| F8 | Settings | /settings | INF | **DEAD** |

**Flutter: 4 active screens, 4 dead navigation targets**

---

### Capacitor Mobile App

| # | Screen | Area | Status |
|---|---|---|---|
| M1 | Login | INF | WIRED |
| M2 | Signup | INF | WIRED |
| M3 | Home (AI Chat) | CRM/OPS | WIRED |
| M4 | Dashboard | CRM | WIRED |
| M5 | Tools | CRM | WIRED |
| M6 | Profile | INF | PARTIAL |
| M7 | Privacy Policy | INF | STATIC |
| M8 | Terms of Service | INF | STATIC |

**Capacitor: 8 screens, 5 wired, 1 partial, 2 static**

---

## TOTALS BY PRODUCT AREA

| Area | Web | Electron-extra | Flutter | Capacitor | Total |
|---|---|---|---|---|---|
| ENG — Autonomous Engineering | 3 | — | — | — | 3 |
| WOS — Workflow OS | 16 | 2 | 1 dead | — | 18 |
| DEV — AI DevOps Runtime | 1 | — | — | — | 1 |
| SH — Self-Healing | 2 | — | — | — | 2 |
| OPS — AI Operations Infra | 8 | 5 | 1 dead | 1 | 15 |
| COP — Developer Copilot | 3 | 1 | — | — | 4 |
| CRM — Business Automation | 18 | — | 1 | 3 | 22 |
| INF — Shared Infrastructure | 15 | 3 | 6 | 4 | 28 |
| **Total** | **66** | **11** | **8** | **8** | **93** |
