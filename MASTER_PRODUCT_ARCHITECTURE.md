# MASTER PRODUCT ARCHITECTURE
Date: 2026-06-06 | Based on: COMPLETE_PRODUCT_SURFACE_MAP.md (93 screens across 4 surfaces)
Purpose: Canonical screen inventory with KEEP/MERGE/REMOVE decisions and final navigation architecture

---

## EXECUTIVE DECISION SUMMARY

**Starting inventory:** 93 surfaces (66 web screens + 11 Electron panels + 8 Flutter + 8 Capacitor)

**After architecture decisions:**
- Web: 66 → **42 screens** (24 removed, 8 merged)
- Electron: 11 panels → **11 panels** (all kept, Browser Automation already exclusive)
- Flutter: 8 → **8 screens** (4 dead routes need implementation, none removed)
- Capacitor: 8 → **8 screens** (all kept)

**Total rationalized surfaces: 69** (down from 93; -24 removed, -8 merged into existing screens)

---

## DECISION CRITERIA

| Criterion | Rule |
|---|---|
| Unique backend engine | KEEP — distinct data source, no overlap |
| Static scaffold, no backend, no planned engine | REMOVE if < 12 months to engine build |
| Near-duplicate of another screen (same data, same engine) | MERGE into the richer of the two |
| Useful but wrong surface | MOVE TO appropriate platform |
| Operator-only workflow requiring desktop keyboard | MOVE TO ELECTRON |
| Mobile-appropriate, backend exists | MOVE TO MOBILE |

---

## SECTION 1: AUTONOMOUS ENGINEERING ASSISTANT

**Screens in this area:** 3 screens + Engineering Autopilot Mission API

---

### Engineering Center
- **Tab ID:** `engineering`
- **Decision:** KEEP
- **Rationale:** Unique — requirement → plan → build → review → test → done pipeline backed by `EngineeringAutopilot` + `GitHubEngineeringAgent`. Mission launcher form added Phase 33. No equivalent screen.
- **Final nav group:** Engineering Suite → Engineering Center

---

### Developer Copilot
- **Tab ID:** `copilot`
- **Decision:** KEEP
- **Rationale:** Unique — repo indexing, code review, refactor detection. Backed by `RepoIntelligenceEngine`, `CodeReviewEngine`, `AutonomousRefactorEngine`. Three fully wired tabs.
- **Final nav group:** Engineering Suite → Developer Copilot

---

### Agent Factory
- **Tab ID:** `agentfactory`
- **Decision:** KEEP
- **Rationale:** Unique — agent creation/cloning/training. Backed by `AgentFactoryAutomation` (`/p20/agents`). Template gallery is the primary UX. Distinct from Agent OS (which manages running agents).
- **Final nav group:** Engineering Suite → Agent Factory
- **Note:** Training form needs backend endpoint (currently fires `track()` only).

---

## SECTION 2: WORKFLOW OPERATING SYSTEM

**Screens in this area before decisions:** 18 screens

---

### Agent OS (Agent Center)
- **Tab ID:** `agents`
- **Decision:** KEEP — **primary agent management screen**
- **Rationale:** Core WOS screen. Registry + execute form + activity feed. Backed by `AgentExecutionEngine`. Keep as the main "Agents" destination.
- **Final nav group:** Workflow Suite → Agents

---

### Agent Registry Center
- **Tab ID:** `registry`
- **Decision:** MERGE → into Agent OS
- **Rationale:** Shows the same agent list as Agent OS with more detail on capabilities/permissions/tools/memory links. These are two tabs worth of content within one screen, not two separate screens. The detail panel in Agent OS already covers what Registry adds. Merge Registry's capability/permission detail view as an additional tab in Agent OS ("Profile" tab).
- **Merge target:** Agent OS → add "Full Profile" tab rendering capability matrix

---

### Agent Action Center
- **Tab ID:** `agentactions`
- **Decision:** KEEP
- **Rationale:** Unique function — action queue with 5 tabs (Executed/Pending/Failed/Human Approvals/Autonomous). Human approval workflow is high-value and has no equivalent. Backed by `RuntimeActionEngine`.
- **Final nav group:** Workflow Suite → Action Queue

---

### Agent Collaboration Engine
- **Tab ID:** `collab`
- **Decision:** KEEP
- **Rationale:** Unique — multi-agent coordination sessions, handoff graph, shared task tracking. Start Session form added Phase 33. No equivalent screen. Backed by `MultiAgentCoordinator`.
- **Final nav group:** Workflow Suite → Coordination

---

### Task Router
- **Tab ID:** `taskrouter`
- **Decision:** KEEP
- **Rationale:** Unique function — task assignment, escalation, reassignment UI. Pulls live execution history. Backed by `AgentExecutionEngine` history.
- **Final nav group:** Workflow Suite → Task Router

---

### Tool Fabric
- **Tab ID:** `toolfabric`
- **Decision:** KEEP
- **Rationale:** Unique — tool registry with health, permissions, connect/disconnect, execute form. Backed by `ToolExecutionLayer`. No equivalent.
- **Final nav group:** Workflow Suite → Tools

---

### Memory OS (Memory Center)
- **Tab ID:** `memory`
- **Decision:** KEEP — **primary memory management screen**
- **Rationale:** Full CRUD for memory nodes. Core WOS infrastructure. Backed by `MemoryPersistenceLayer`.
- **Final nav group:** Workflow Suite → Memory

---

### Memory Fabric (Shared Memory Center)
- **Tab ID:** `sharedmem`
- **Decision:** MERGE → into Memory OS
- **Rationale:** SharedMemoryCenter shows the same memory nodes as MemoryCenter but in a graph/canvas layout filtered by scope (global/company/agent/project). This is a "Graph View" tab on the Memory screen, not a separate destination. Both call `/p18/memory`. Merge as a "Fabric" tab within Memory OS.
- **Merge target:** Memory OS → add "Fabric" tab (graph view + scope filters)

---

### Memory Intelligence Center
- **Tab ID:** `memoryintel`
- **Decision:** MERGE → into Memory OS
- **Rationale:** Importance scores, staleness tracking, usage heatmap — this is analytics *about* memory nodes. Should be a third tab ("Intelligence") within Memory OS, not a separate navigation destination. All three memory views (List/Fabric/Intelligence) share the same data.
- **Merge target:** Memory OS → add "Intelligence" tab

---

### Autonomous Workflows (AutonomousWorkflowCenter)
- **Tab ID:** `autonomouswf`
- **Decision:** KEEP — **primary workflow/cycle screen**
- **Rationale:** Workflow list + Trigger→Agent→Tool→Action→Result flow visualization + Launch Cycle form. Backed by `AutonomousTaskLoop` (`/p18/cycles`). Core WOS screen.
- **Final nav group:** Workflow Suite → Workflows

---

### Autonomous Company Center
- **Tab ID:** `autonomy`
- **Decision:** MERGE → into Autonomous Workflows
- **Rationale:** Shows department-organized task queue (Revenue/Marketing/Support/Engineering/DevOps) with seed data. No distinct backend engine — same cycles API. Adds a "By Department" view that belongs as a tab within Autonomous Workflows, not a standalone screen.
- **Merge target:** Autonomous Workflows → add "By Department" tab

---

### Execution Orchestrator Center
- **Tab ID:** `orchestrator`
- **Decision:** MERGE → into Autonomous Workflows
- **Rationale:** Shows execution chains (Goal→Tasks→Agents→Results) — this is the detail view of a single cycle. The Autonomous Workflows screen already selects cycles and shows flow steps. Orchestrator adds chain visualization and retry map. Merge as an "Execution Chain" tab within Autonomous Workflows.
- **Merge target:** Autonomous Workflows → add "Execution Chain" tab

---

### Execution Connector Center
- **Tab ID:** `execconnector`
- **Decision:** MERGE → into Tool Fabric
- **Rationale:** Shows connected external integrations with action history per connector. Tool Fabric already shows tool health, connect/disconnect, and execute. Connectors are tools. Merge as a "Connections" tab within Tool Fabric.
- **Merge target:** Tool Fabric → add "Connections" tab

---

### Self-Improvement Engine
- **Tab ID:** `selfimprove`
- **Decision:** KEEP
- **Rationale:** Unique — lessons learned, failure patterns, optimization opportunities, recommendations, re-analyze trigger. Backed by `ContinuousLearningEngine` (`/p19/learn/*`). No overlap with other screens.
- **Final nav group:** Workflow Suite → Learning Engine

---

### Ooplix Runs Ooplix Center
- **Tab ID:** `oroplix`
- **Decision:** MERGE → into Autonomy Score Center
- **Rationale:** Both screens call `getAutonomyScore()` + `getAutonomyStatus()` from the same engine. OoplixRunsOoplix adds per-domain breakdown (Revenue/Marketing/Support/etc) and recent autonomous actions. Autonomy Score adds per-dimension gauges and trend chart. Together they form one "Autonomy Dashboard" screen. The combined view is more useful than either alone.
- **Merge target:** Autonomy Score → add "Domain Breakdown" tab

---

### Autonomy Score Center
- **Tab ID:** `autonomyscore`
- **Decision:** KEEP (absorbs OoplixRunsOoplix)
- **Rationale:** After merge becomes the canonical "Autonomy Dashboard" — gauges + trend + domain breakdown + opportunities.
- **Renamed to:** Autonomy Dashboard
- **Final nav group:** Workflow Suite → Autonomy Dashboard

---

### Jarvis Brain Center
- **Tab ID:** `jarvisbrain`
- **Decision:** KEEP
- **Rationale:** Distinct purpose — animated flow visualization of the full Goal→Planning→Memory→Agents→Tools→Execution→Learning loop. High product value as an "intelligence visualization" screen. Backed by live cycle stats. No structural overlap with other screens (visualization not management).
- **Final nav group:** Workflow Suite → Brain View

---

### Knowledge Center
- **Tab ID:** `knowledge`
- **Decision:** KEEP (but deprioritized — needs backend)
- **Rationale:** 386 lines of substantial UI for FAQ/article management. Distinct purpose from Memory. No current backend engine, but clearly mapped to a knowledge base product. Keep as a placeholder with a clear future engine path. Do not remove — it occupies a real product need.
- **Status:** STATIC — needs `/knowledge/*` routes and KnowledgeBase engine
- **Final nav group:** Workflow Suite → Knowledge Base

---

## SECTION 3: AI DEVOPS RUNTIME

**Screens in this area:** 1 screen (DevOps Runtime)

---

### DevOps Runtime
- **Tab ID:** `devops`
- **Decision:** KEEP
- **Rationale:** Unique — deployment management, services health, SLOs, alerts, canary deploy trigger. Backed by `DeploymentAutopilot` + `EnterpriseObservability`. All 6 tabs wired. No equivalent screen.
- **Final nav group:** Infrastructure Suite → DevOps Runtime
- **Note:** Blue-green deployment tab needs rollout UI (backend works, no form yet).

---

## SECTION 4: SELF-HEALING AUTOMATION PLATFORM

**Screens in this area:** 2 screens

---

### Self-Healing Platform
- **Tab ID:** `selfhealing`
- **Decision:** KEEP
- **Rationale:** Unique — health checks, recovery history, prevention rules, incident timeline, failure prediction. Backed by `SelfHealingRuntime`. Probe button triggers live API. All 5 tabs wired.
- **Final nav group:** Infrastructure Suite → Self-Healing

---

### Disaster Recovery Center
- **Tab ID:** `disasterrecovery`
- **Decision:** KEEP (but deprioritized — needs backend)
- **Rationale:** Distinct purpose from Self-Healing. Disaster Recovery covers RTO/RPO planning, backup verification, recovery runbooks — backup strategy layer vs. real-time healing layer. 257 lines of UI scaffold. Keep as a placeholder. Do not merge into Self-Healing.
- **Status:** STATIC — needs `/disaster-recovery/*` routes
- **Final nav group:** Infrastructure Suite → Disaster Recovery

---

## SECTION 5: AI OPERATIONS INFRASTRUCTURE

**Screens in this area:** 8 screens before decisions

---

### Execution (Operator Console)
- **Tab ID:** `runtime`
- **Decision:** KEEP — **primary operations surface**
- **Rationale:** Most wired screen in the entire product. 8 sub-panels, SSE stream, emergency controls, full browser automation. Already Electron-default tab. Keep as the flagship operational screen.
- **Final nav group:** Operations (top-level tab, always visible)

---

### Operations Center
- **Tab ID:** `operations`
- **Decision:** KEEP
- **Rationale:** Unique — agent throughput metrics, queue depth, error rates, production readiness score. `ProductionReadinessEngine` (`/p21/readiness/report`). Distinct from the execution cockpit (manages ops health vs. running tasks).
- **Final nav group:** Infrastructure Suite → Operations

---

### Control Center
- **Tab ID:** `home`
- **Decision:** KEEP — **default home tab**
- **Rationale:** Home dashboard combining live status + task dispatch + CRM summary + navigation hub. Correctly positioned as the default landing screen for authenticated users.
- **Final nav group:** Top-level tab (always visible)

---

### History / Logs
- **Tab ID:** `activity`
- **Decision:** KEEP
- **Rationale:** Execution activity log. Different from Agent Action Center (actions) and Execution Orchestrator (chains) — History shows the high-level message/event timeline. Needed as an audit/compliance surface.
- **Final nav group:** Operations Suite → History

---

### AI Costs Center
- **Tab ID:** `aicost`
- **Decision:** KEEP (but deprioritized — needs backend)
- **Rationale:** 396 lines of substantial token cost tracking UI. Real business need — LLM costs are a primary operating expense. No current backend engine. Keep as roadmap placeholder, not removed.
- **Status:** STATIC — needs cost tracking via provider API metrics
- **Final nav group:** Infrastructure Suite → AI Costs
- **Note:** Can be partially implemented against `/p25/obs/metrics` which already tracks API request counts.

---

### Autonomy Dashboard (was: Autonomy Score + Ooplix Runs Ooplix)
- **Decision:** KEEP (merged)
- **See:** Section 2 — merged from two WOS screens
- **Final nav group:** Operations Suite → Autonomy Dashboard

---

### Jarvis Brain Center
- **Decision:** KEEP
- **See:** Section 2 — visualization
- **Final nav group:** Operations Suite → Brain View

---

### Visual Intelligence
- **Tab ID:** Not in MORE_TABS (component exists but not routed)
- **Decision:** REMOVE
- **Rationale:** `VisualIntelligence.jsx` exists in components directory but is not assigned any tab ID in App.jsx. It has no route, no navigation path, no backend engine. Unreachable.
- **Action:** Delete file or assign a tab ID if content is valuable.

---

## SECTION 6: SHARED INFRASTRUCTURE

**Screens in this area:** 15 screens before decisions

---

### Enterprise OS
- **Tab ID:** `enterprise`
- **Decision:** KEEP
- **Rationale:** The most-wired non-core screen at 1384 lines — org/dept/team/role/permission/policy/audit management. Backed by a full `enterpriseApi` with 20+ endpoints. Unique and complete. Target: multi-seat enterprise customers.
- **Final nav group:** Settings Suite → Enterprise

---

### Billing Dashboard
- **Tab ID:** `billing`
- **Decision:** KEEP
- **Rationale:** Essential — subscription plan, upgrade flow, trial status. Backed by `BillingService`. No equivalent.
- **Final nav group:** Settings Suite → Billing

---

### Settings
- **Tab ID:** `settings`
- **Decision:** KEEP
- **Rationale:** WhatsApp setup, webhook config, operator preferences. Partially wired. Core infrastructure.
- **Final nav group:** Settings Suite → Settings

---

### Integrations
- **Tab ID:** `integrations`
- **Decision:** KEEP
- **Rationale:** OAuth connection management (Google/GitHub/Slack/Notion). Backed by `OAuthIntegrationLayer`. Distinct from Tool Fabric (runtime tools vs. user-facing integrations).
- **Final nav group:** Settings Suite → Integrations

---

### Getting Started
- **Tab ID:** `success`
- **Decision:** KEEP
- **Rationale:** Onboarding checklist. Needs to surface in nav for new users. Keep.
- **Final nav group:** Settings Suite → Getting Started

---

### Help & Guides
- **Tab ID:** `help`
- **Decision:** KEEP
- **Rationale:** 407 lines of documentation UI. Static but correct — documentation doesn't need a backend.
- **Final nav group:** Settings Suite → Help

---

### Community / Marketplace / Mobile Platform
- **Tab IDs:** `community`, `marketplace`, `mobile`
- **Decision:** REMOVE (all three)
- **Rationale:**
  - `CommunityCenter` (205 lines): Link-out to external community. Should be a link in Help/Footer, not a full screen destination.
  - `MarketplaceCenter` (142 lines): Placeholder with no backend. Move to roadmap. Remove from nav until marketplace engine exists.
  - `MobilePlatformCenter`: Internal build status screen. Move to DevOps Runtime → a "Mobile" section, not a standalone tab.
- **Action:** Remove from MORE_TABS. Community becomes a footer link. Mobile platform info folds into DevOps. Marketplace returns when engine is built.

---

### Overview (Capabilities)
- **Tab ID:** `overview`
- **Decision:** MERGE → into Getting Started
- **Rationale:** CapabilitiesOverview is a feature list — it belongs as a tab within Getting Started ("What can Jarvis do?"), not a standalone navigation destination.
- **Merge target:** Getting Started → add "Capabilities" tab

---

### Data Ownership Center
- **Tab ID:** `dataowner`
- **Decision:** MOVE TO Settings
- **Rationale:** Data export, deletion, audit is a settings-level concern. Fold as a "Data & Privacy" section within Settings rather than a standalone screen.
- **Move target:** Settings → add "Data & Privacy" section

---

### Trust & Compliance Center
- **Tab ID:** `trustcompliance`
- **Decision:** KEEP (renamed — move to footer/settings)
- **Rationale:** 251 lines of compliance display. Relevant for enterprise sales. Keep but demote from main nav — accessible via Settings Suite → Compliance or footer link.
- **Final nav group:** Settings Suite → Compliance

---

### Team Workspace
- **Tab ID:** `team`
- **Decision:** MERGE → into Enterprise OS
- **Rationale:** TeamWorkspace (409 lines) covers members, assignments, shared workspace. Enterprise OS already has a full Teams management tab backed by `createEnterpriseTeam` / `addEnterpriseTeamMember`. These are duplicates targeting the same concept. Merge TeamWorkspace content into Enterprise OS Teams section.
- **Merge target:** Enterprise OS → Teams section

---

### Login / Onboarding / Pricing / Landing
- **Decision:** KEEP (all)
- **Rationale:** Essential pre-app flow. Keep as-is. No redundancy.
- **Final nav group:** Pre-app screens (not in main nav)

---

### Legal Screens (6)
- **Decision:** KEEP
- **Rationale:** Legal requirement. Keep as footer links only, not in main nav.
- **Final nav group:** Footer (not tab nav)

---

## SECTION 7: CRM / BUSINESS AUTOMATION

**Screens in this area:** 22 screens before decisions

---

### Contacts (PaymentPanel)
- **Tab ID:** `clients`
- **Decision:** KEEP — **primary CRM screen**
- **Rationale:** Add contact, send WhatsApp, create payment link, view lead list. Core revenue-generating screen. Wired to CRM + payment + WhatsApp APIs.
- **Final nav group:** Top-level tab (always visible)

---

### Pipeline (Dashboard)
- **Tab ID:** `insights`
- **Decision:** KEEP
- **Rationale:** Lead pipeline stats, automation tier activity. Wired. Core CRM visibility.
- **Final nav group:** Top-level tab (always visible)

---

### Intelligence (Chat)
- **Tab ID:** `chat`
- **Decision:** KEEP
- **Rationale:** Primary AI interface. Wired to Groq. Core product.
- **Final nav group:** Top-level tab (always visible)

---

### Enterprise CRM
- **Tab ID:** `ecrm`
- **Decision:** MERGE → into Business OS
- **Rationale:** EnterpriseCRM (353 lines) shows contacts, leads, pipeline stages, company profiles — loaded from the same localStorage as Dashboard/Contacts. BusinessOS (918 lines) already has Leads, Contacts, Pipeline, Campaigns, Revenue sections. These are the same data from different angles. Merge EnterpriseCRM's pipeline/company view into BusinessOS as additional tabs.
- **Merge target:** Business OS → add "CRM" and "Pipeline" tabs

---

### Business OS
- **Tab ID:** `business`
- **Decision:** KEEP
- **Rationale:** 918 lines. Business overview — pipeline, leads, contacts, campaigns, revenue sections. After absorbing EnterpriseCRM, becomes the full business management hub.
- **Final nav group:** Business Suite → Business OS

---

### Executive Reports
- **Tab ID:** `reports`
- **Decision:** MERGE → into Business OS
- **Rationale:** Shows revenue/leads/conversion KPI reports — this is the "Reports" section that belongs inside Business OS. Same seed data. Merge as a "Reports" tab within Business OS.
- **Merge target:** Business OS → add "Reports" tab

---

### Personal OS
- **Tab ID:** `personal`
- **Decision:** KEEP
- **Rationale:** 715 lines. Personal productivity — goals, tasks, health, daily planner. Distinct from Business OS. Justified standalone destination for personal workflow management.
- **Final nav group:** Business Suite → Personal OS

---

### Developer OS
- **Tab ID:** `developer`
- **Decision:** MERGE → into Developer Copilot
- **Rationale:** DeveloperOS (907 lines) is a navigation hub for developer tools — velocity, tasks, weekly summary. Developer Copilot already is the primary developer screen. DeveloperOS content (velocity metrics, task summary) belongs as an "Overview" tab within Developer Copilot.
- **Merge target:** Developer Copilot → add "Overview" tab

---

### SEO Command Center
- **Tab ID:** `seo`
- **Decision:** KEEP (deprioritized — needs backend)
- **Rationale:** 353 lines, distinct product surface. SEO is a real ongoing customer need. Keep in nav but mark as "Coming Soon" until engine is built. Better to keep a clear nav destination than delete it.
- **Status:** STATIC — needs SEO engine (`/seo/*` routes)
- **Final nav group:** Growth Suite → SEO

---

### Email Marketing OS
- **Tab ID:** `email`
- **Decision:** KEEP (deprioritized — needs backend)
- **Rationale:** 526 lines, substantial email campaign UI. Email marketing is a core product need for the target market (SMBs). Keep nav destination.
- **Status:** STATIC — needs email engine
- **Final nav group:** Growth Suite → Email

---

### Content Engine
- **Tab ID:** `content`
- **Decision:** KEEP (deprioritized — needs backend)
- **Rationale:** 308 lines. AI content generation is a natural extension of the agent system. Keep destination.
- **Status:** STATIC — wire to `POST /jarvis` with content prompts as an interim solution
- **Final nav group:** Growth Suite → Content

---

### Social Hub
- **Tab ID:** `social`
- **Decision:** REMOVE
- **Rationale:** 288 lines. Social media scheduling requires deep integration with Twitter/LinkedIn/Instagram APIs that are not planned. Lowest priority among growth screens. Remove from nav; reinstate when social engine is built. Does not share any infrastructure with other screens.

---

### Referral Engine
- **Tab ID:** `referral`
- **Decision:** REMOVE
- **Rationale:** 274 lines of referral program UI with no backend engine planned. A referral program requires its own tracking engine, payment integration, and user notification system. Remove from nav. Reinstate as a standalone product feature when scope is defined.

---

### Partner Program
- **Tab ID:** `partners`
- **Decision:** REMOVE
- **Rationale:** 334 lines. Partner/reseller program requires separate business logic, commissions, partner portals. No backend engine. Remove from nav.

---

### Launch Command Center
- **Tab ID:** `launch`
- **Decision:** MERGE → into Business OS
- **Rationale:** Launch planning (product hunt, pre-launch checklist, day-of coordination) is a business workflow. Merge as a "Launch" section within Business OS. 269 lines — good content that belongs in context.
- **Merge target:** Business OS → add "Launch" section

---

### Autonomous Revenue, Marketing, Support
- **Tab IDs:** `autorevenue`, `automarketing`, `autosupport`
- **Decision:** MERGE → into Autonomy Dashboard
- **Rationale:** All three show per-domain autonomous action scores and recent autonomous actions — exactly the "Domain Breakdown" content being merged into the Autonomy Dashboard from OoplixRunsOoplix. These three screens represent the same data from three narrower lenses. They become the Revenue/Marketing/Support rows in the Autonomy Dashboard domain breakdown tab.
- **Merge target:** Autonomy Dashboard → Domain Breakdown tab

---

### Support OS
- **Tab ID:** `supportos`
- **Decision:** KEEP (deprioritized — needs backend)
- **Rationale:** 315 lines. Support ticket management is a real product need distinct from the Support *agent* (which executes autonomously). Keep as a customer-facing support desk screen.
- **Status:** STATIC — needs `/support/*` routes and ticket engine
- **Final nav group:** Business Suite → Support

---

## SECTION 8: PLATFORM-SPECIFIC ARCHITECTURE DECISIONS

---

### ELECTRON-ONLY SCREENS (move from web consideration)

The following capabilities should be exclusive to Electron, not accessible via the web tab nav:

| Screen / Panel | Current | Recommendation | Reason |
|---|---|---|---|
| Browser Automation Panel | Electron (via Execution tab) | MOVE TO ELECTRON ONLY — keep here | Requires desktop Chrome/chromium; Play Store/App Store unsafe |
| Governor Panel (reboot) | Electron operator panel | KEEP ELECTRON ONLY | `POST /runtime/reboot` is destructive; desktop operator action |
| Terminal execution | Available via execution tab | KEEP ELECTRON ONLY | Shell command execution requires host OS access |
| Floating Window | Electron only | KEEP ELECTRON ONLY | Requires `BrowserWindow` |

**No web screens need to be moved to Electron.** The existing split (same app + `?desktop=1`) is correct.

---

### FLUTTER — DEAD ROUTES (must implement, not remove)

4 quick-action tiles on the Flutter Dashboard are dead links with no `GoRoute`:

| Route | Tile Label | Decision | Required screen |
|---|---|---|---|
| `/chat` | AI Chat | IMPLEMENT | Chat screen calling `POST /jarvis`, Firebase history |
| `/tasks` | Tasks | IMPLEMENT | Task list from `/tasks` + dispatch form |
| `/metrics` | Metrics | IMPLEMENT | Stats from `GET /stats`, `GET /ops` |
| `/settings` | Settings | IMPLEMENT | Account settings, notification prefs |

These are KEEP decisions — the tiles exist, users tap them, the app crashes. All four need `GoRoute` definitions and corresponding screen widgets.

---

### CAPACITOR MOBILE — ARCHITECTURE STAYS

All 8 Capacitor screens are correctly scoped for mobile. No removals. One addition recommended:

| Screen | Decision | Recommendation |
|---|---|---|
| Home (Chat) | KEEP | Core mobile experience |
| Dashboard | KEEP | Stats + automation tiers |
| Tools | KEEP | 5 tools all wired correctly |
| Profile | KEEP | Add `/auth/me` sync to profile fields |
| Login / Signup | KEEP | Firebase Auth working |
| Privacy / Terms | KEEP | Legal requirement |
| Agent Execution (new) | CONSIDER | Add minimal "Execute agent" form in Tools page |

---

## FINAL NAVIGATION ARCHITECTURE

### Web App — Recommended Navigation Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOP BAR (always visible — 5 tabs)                                   │
│                                                                       │
│  [Control Center]  [Execution]  [Intelligence]  [Pipeline]  [More ▾] │
└─────────────────────────────────────────────────────────────────────┘

MORE ▾ DROPDOWN — Organized into 6 named groups:

┌─ WORKFLOW SUITE ──────────────────┐
│  Agents                           │ (was: Agent OS + Registry merged)
│  Task Router                      │
│  Action Queue                     │ (was: Agent Actions)
│  Coordination                     │ (was: Agent Collaboration)
│  Tool Fabric                      │ (absorbs Exec Connectors)
│  Workflows                        │ (was: Autonomous Workflows, absorbs Orchestrator + Dept View)
│  Memory                           │ (absorbs Memory Fabric + Memory Intel as tabs)
│  Learning Engine                  │ (was: Self-Improvement)
│  Knowledge Base                   │
└───────────────────────────────────┘

┌─ ENGINEERING SUITE ───────────────┐
│  Developer Copilot                │ (absorbs Developer OS as tab)
│  Engineering Center               │
│  Agent Factory                    │
└───────────────────────────────────┘

┌─ INFRASTRUCTURE SUITE ────────────┐
│  DevOps Runtime                   │ (absorbs Mobile Platform info)
│  Self-Healing                     │
│  Disaster Recovery                │
│  Operations                       │
│  AI Costs                         │
└───────────────────────────────────┘

┌─ BUSINESS SUITE ──────────────────┐
│  Business OS                      │ (absorbs CRM + Reports + Launch)
│  Personal OS                      │
│  Support                          │
└───────────────────────────────────┘

┌─ GROWTH SUITE ────────────────────┐
│  SEO                              │
│  Content                          │
│  Email                            │
│  (Social — removed until engine)  │
│  (Referral — removed until engine)│
│  (Partners — removed until engine)│
└───────────────────────────────────┘

┌─ SETTINGS SUITE ──────────────────┐
│  Getting Started                  │ (absorbs Capabilities Overview)
│  Billing                          │
│  Settings                         │ (absorbs Data & Privacy)
│  Integrations                     │
│  Enterprise                       │ (absorbs Team Workspace)
│  Compliance                       │
│  Help                             │
└───────────────────────────────────┘

┌─ INTELLIGENCE VIEWS ──────────────┐
│  Autonomy Dashboard               │ (absorbs OoplixRunsOoplix + 3 Auto screens)
│  Brain View                       │
│  History                          │
└───────────────────────────────────┘
```

---

### Electron App — Recommended Navigation Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  Identical to web app + these exclusive panels:                      │
│                                                                       │
│  EXECUTION TAB (default on launch):                                  │
│  ┌─────────────────────────────────────────────────────┐             │
│  │  ExecLog Panel    │  Workflow Panel  │ AI Console   │             │
│  │  Governor Panel   │  Telemetry Panel │ Task Queue   │             │
│  │  Adapter Panel    │  Plugin Manager  │              │             │
│  ├─────────────────────────────────────────────────────┤             │
│  │  Browser Automation Panel (full-width, below grid)  │  DESKTOP    │
│  └─────────────────────────────────────────────────────┘  EXCLUSIVE │
│                                                                       │
│  FLOATING WINDOW: 350×480px always-on-top overlay                    │
│  IPC: sendCommand, reportCrash, getEvolutionScore, getSuggestions    │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Flutter App — Recommended Navigation Structure

```
Route map (current → target):
/splash     → Keep (auth redirect)
/login      → Keep
/signup     → Keep
/dashboard  → Keep (add refresh + correct navigation)
/chat       → IMPLEMENT (was dead) → AI Chat screen
/tasks      → IMPLEMENT (was dead) → Task list + dispatch
/metrics    → IMPLEMENT (was dead) → Stats dashboard
/settings   → IMPLEMENT (was dead) → Account settings

Bottom nav (add for authenticated state):
  [Home/Chat]  [Dashboard]  [Tasks]  [Profile]
```

---

### Capacitor Mobile App — Recommended Navigation Structure

```
Bottom Tab Bar:
  [Home/Chat]  [Dashboard]  [Tools]  [Profile]

Screens:
  Login, Signup (pre-auth)
  Home — AI Chat with quick-action chips
  Dashboard — Stats, automation tiers
  Tools — AI Task Gen, Payment Link, WhatsApp Follow-up, CRM Leads
  Profile — Account info, sign out
  Privacy Policy, Terms (footer links)
```

---

## FINAL SCREEN COUNT PER PLATFORM

### Web App

| Group | Screens (after decisions) | Change |
|---|---|---|
| Top-level tabs (always visible) | 5 | = |
| Workflow Suite | 9 | -4 merged into existing screens |
| Engineering Suite | 3 | = |
| Infrastructure Suite | 5 | = |
| Business Suite | 3 | -2 merged into Business OS |
| Growth Suite | 3 | -3 removed (Social/Referral/Partners) |
| Settings Suite | 7 | -2 merged (Capabilities→GS, Team→Enterprise) |
| Intelligence Views | 3 | -3 merged into Autonomy Dashboard |
| Pre-app screens | 4 | = |
| Legal screens (footer only) | 6 | = |
| **TOTAL** | **48** | **from 66** |

Removed: `VisualIntelligence` (unrouted), `Community`, `Marketplace`, `Social Hub`, `Referral Engine`, `Partner Program`
Merged away: `AgentRegistry`, `SharedMemory`, `MemoryIntel`, `AutonomousCompany`, `ExecutionOrchestrator`, `ExecConnector`, `OoplixRunsOoplix`, `EnterpriseCRM`, `ExecutiveReports`, `DeveloperOS`, `TeamWorkspace`, `CapabilitiesOverview`, `DataOwnership`, `LaunchCommandCenter`, `Auto Revenue/Marketing/Support`

---

### Electron App

| Panel | Count | Change |
|---|---|---|
| Web screens (same app) | 48 | = |
| Operator Console panels | 9 | = |
| Floating Window | 1 | = |
| IPC endpoints | 5 | = |
| **TOTAL SURFACES** | **11 exclusive** | = |

---

### Flutter App

| Screen | Count | Change |
|---|---|---|
| Auth screens (Splash/Login/Signup) | 3 | = |
| Dashboard | 1 | = |
| AI Chat | 1 | +1 new implementation |
| Tasks | 1 | +1 new implementation |
| Metrics | 1 | +1 new implementation |
| Settings | 1 | +1 new implementation |
| **TOTAL** | **8** | from 4 active (4 dead → implemented) |

---

### Capacitor Mobile App

| Screen | Count | Change |
|---|---|---|
| Auth (Login/Signup) | 2 | = |
| Home/Chat | 1 | = |
| Dashboard | 1 | = |
| Tools | 1 | = |
| Profile | 1 | = |
| Legal (2) | 2 | = |
| **TOTAL** | **8** | = |

---

### Totals After Architecture

| Platform | Before | After | Delta |
|---|---|---|---|
| Web (in-app screens) | 66 | 48 | -18 |
| Electron (exclusive) | 11 | 11 | 0 |
| Flutter | 8 | 8 | 0 (4 dead → implemented) |
| Capacitor | 8 | 8 | 0 |
| **Grand total** | **93** | **75** | **-18** |

---

## ENTERPRISE-GRADE STRUCTURAL RECOMMENDATIONS

### 1. Navigation Information Architecture

The current More ▾ dropdown with 48 unlabeled items is unusable at enterprise scale. Replace with a **grouped sidebar or command palette**:

```
Recommended approach: Collapsible sidebar (desktop) / Command palette (Cmd+K, already implemented)

Sidebar groups:
  ◉ Core          → Control Center, Execution, Intelligence, Pipeline, Contacts
  ▷ Workflows     → Agents, Workflows, Task Router, Tool Fabric, Memory, Learning
  ⬡ Engineering   → Developer Copilot, Engineering Center, Agent Factory
  ⬟ Infrastructure→ DevOps, Self-Healing, Operations, AI Costs
  ◎ Business      → Business OS, Personal OS, Growth screens
  ◈ Settings      → Billing, Integrations, Enterprise, Settings, Help
```

---

### 2. Role-Based Screen Visibility

Not all 48 screens are relevant to every user role:

| Screen group | Operator | Developer | Business User | Enterprise Admin |
|---|---|---|---|---|
| Core 5 tabs | ✓ | ✓ | ✓ | ✓ |
| Workflow Suite | ✓ | ✓ | Read-only | ✓ |
| Engineering Suite | — | ✓ | — | ✓ |
| Infrastructure Suite | ✓ | ✓ | — | ✓ |
| Business Suite | ✓ | — | ✓ | ✓ |
| Growth Suite | ✓ | — | ✓ | ✓ |
| Settings Suite | ✓ | ✓ | Billing only | ✓ |
| Enterprise OS | — | — | — | ✓ |

Recommendation: Add `user.role` to `AuthContext` and filter MORE_TABS by role at render time.

---

### 3. Screen Depth Principle

Every screen should answer one question. Current violations:

| Violation | Fix |
|---|---|
| Autonomous Workflows + Orchestrator + Department View = same data, 3 screens | Merge to one screen, 3 tabs |
| Memory + Fabric + Intelligence = same nodes, 3 screens | Merge to one screen, 3 tabs |
| Agent OS + Registry = same agents, 2 screens | Merge to one screen, 2 tabs |
| Business OS + CRM + Reports + Launch = same business data, 4 screens | Merge to one screen, 4 tabs |
| Autonomy Dashboard + Ooplix Runs Ooplix + 3 Auto screens = same score data, 5 screens | Merge to one screen, 5 tabs |

**Rule:** If two screens call the same backend endpoint, they must be tabs on one screen — not separate nav destinations.

---

### 4. Progressive Disclosure Pattern

Recommended for each product area: implement a 3-depth nav pattern:

```
Level 1 (Tab/Screen): Workflow Suite → "Workflows"
Level 2 (Tab within screen): [All] [Running] [Failed] [Done] [By Department] [Chain View]
Level 3 (Detail panel): Click a workflow → slide-in panel with full chain visualization
```

This eliminates the need for separate screens (AutonomousWorkflowCenter vs ExecutionOrchestrator) while surfacing the same depth of information.

---

### 5. Mobile-First Screens

These web screens have enough demand on mobile to warrant Capacitor implementation:

| Screen | Justification | Capacitor priority |
|---|---|---|
| Agent execution | Operators want to trigger agents on mobile | HIGH |
| Self-Healing status | On-call monitoring needs mobile view | HIGH |
| Memory add/view | Business operators add notes on mobile | MEDIUM |
| Deployment status | On-call engineers need canary status | MEDIUM |

---

### 6. Screens Requiring New Backend Engines (Roadmap)

| Screen | Engine needed | Routes needed | Priority |
|---|---|---|---|
| Knowledge Base | KnowledgeBaseEngine | `/knowledge/*` | P1 |
| AI Costs | CostTrackingEngine | `/ai/costs/*` | P1 |
| SEO | SEOMonitoringEngine | `/seo/*` | P2 |
| Support OS | SupportTicketEngine | `/support/*` | P2 |
| Content Engine | ContentGenerationEngine (or wire to `/jarvis`) | `/content/*` | P2 |
| Email Marketing OS | EmailAutomationEngine | `/email/*` | P2 |
| Disaster Recovery | BackupRecoveryEngine | `/recovery/*` | P3 |
| Marketplace | MarketplaceEngine | `/marketplace/*` | P3 |
| Referral Engine | ReferralTrackingEngine | `/referral/*` | P4 |
| Partner Program | PartnerEngine | `/partners/*` | P4 |

Content Engine can be partially enabled immediately by wiring the existing text input to `POST /jarvis` with a content-generation system prompt, before a dedicated engine is built.

---

## COMPLETE REMOVAL LIST

These 6 screens are removed from nav immediately. Components can be kept in codebase as archived code until confirmed not needed.

| Screen | Tab ID | Lines | Reason |
|---|---|---|---|
| Social Hub | `social` | 288 | No engine planned; social APIs require separate business development |
| Referral Engine | `referral` | 274 | No engine, no backend; product scope not defined |
| Partner Program | `partners` | 334 | No engine, no backend; separate product not yet scoped |
| Community | `community` | 205 | Link-out only; belongs in footer, not nav |
| Marketplace | `marketplace` | 142 | No engine; placeholder only |
| Visual Intelligence | (unrouted) | — | Never added to routing; unreachable |

---

## COMPLETE MERGE LIST

These 15 screens are merged into their targets. Their content becomes tabs/sections in richer screens.

| Screen (source) | Merges into | As |
|---|---|---|
| Agent Registry Center | Agent OS | "Full Profile" tab |
| Shared Memory Center | Memory OS | "Fabric" tab |
| Memory Intelligence Center | Memory OS | "Intelligence" tab |
| Autonomous Company Center | Autonomous Workflows | "By Department" tab |
| Execution Orchestrator Center | Autonomous Workflows | "Execution Chain" tab |
| Execution Connector Center | Tool Fabric | "Connections" tab |
| Ooplix Runs Ooplix Center | Autonomy Dashboard | "Domain Breakdown" tab |
| Autonomous Revenue Center | Autonomy Dashboard | Domain row in Domain Breakdown |
| Autonomous Marketing Center | Autonomy Dashboard | Domain row in Domain Breakdown |
| Autonomous Support Center | Autonomy Dashboard | Domain row in Domain Breakdown |
| Enterprise CRM | Business OS | "CRM" + "Pipeline" tabs |
| Executive Reports | Business OS | "Reports" tab |
| Launch Command Center | Business OS | "Launch" section |
| Developer OS | Developer Copilot | "Overview" tab |
| Team Workspace | Enterprise OS | Teams section |
| Capabilities Overview | Getting Started | "What can Jarvis do?" tab |
| Data Ownership Center | Settings | "Data & Privacy" section |
