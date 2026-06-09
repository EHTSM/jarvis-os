# MASTER SAAS ARCHITECTURE
**Date:** 2026-06-06 | **Phase:** 35 — Product Freeze & Surface Certification
**Status:** FROZEN — this document defines the canonical product surface. No new engines, screens, or product areas may be added without updating all four Phase 35 documents.

---

## PRODUCT IDENTITY

**Name:** Ooplix / JARVIS OS
**Category:** AI Operating System for business operators
**Target market:** Indian SMBs — freelancers, coaches, agencies, consultants
**Primary interface:** Web app (SaaS) + Electron desktop
**Secondary interfaces:** Capacitor mobile (Play Store) + Flutter mobile
**Backend:** Node.js monolith on port 5050, 399 routes across 17 route files
**AI provider:** Groq (primary) → OpenAI (fallback) → Ollama (local fallback)
**Auth:** JWT session cookie + local account system; Firebase optional for mobile

---

## BILLING TIERS

| Tier | Price | Key Limits |
|---|---|---|
| Trial | Free, 7 days | Full access |
| Starter | ₹999/month | Up to 100 leads, 1 seat |
| Growth | ₹2,499/month | Up to 1,000 leads, 5 seats, all features |
| Scale | Custom | Unlimited |

---

## PLATFORM SUMMARY

| Platform | Entry point | Auth method | Screen count |
|---|---|---|---|
| Web (SaaS) | app.ooplix.com | JWT cookie | 48 screens |
| Electron | `npm run desktop` | JWT cookie (same backend) | 48 + 11 exclusive panels |
| Flutter | Android/iOS app | Firebase Auth | 8 screens (4 need implementation) |
| Capacitor | Android app (Play Store) | Firebase Auth | 8 screens |

---

## NAVIGATION ARCHITECTURE (FROZEN)

### Web + Electron — Top Bar (always visible)

```
[Control Center]  [Execution]  [Intelligence]  [Pipeline]  [Contacts]  [More ▾]
      ↓                ↓             ↓              ↓           ↓
   home tab        runtime tab    chat tab      insights tab  clients tab
```

### Web + Electron — More ▾ Dropdown (grouped, 43 destinations)

```
── WORKFLOW SUITE ─────────────────────────────────────────────────────
  Agents            → tab: agents       (AgentCenter + merged Registry)
  Action Queue      → tab: agentactions (AgentActionCenter)
  Task Router       → tab: taskrouter   (TaskRouterCenter)
  Coordination      → tab: collab       (AgentCollaborationCenter)
  Tool Fabric       → tab: toolfabric   (ToolFabricCenter + merged Connectors)
  Workflows         → tab: autonomouswf (AutonomousWorkflowCenter + merged Orch/Dept)
  Memory            → tab: memory       (MemoryCenter + merged Fabric/Intel)
  Learning Engine   → tab: selfimprove  (SelfImprovementCenter)
  Knowledge Base    → tab: knowledge    (KnowledgeCenter — needs backend)
  Autonomy Dashboard→ tab: autonomyscore (merged: Ooplix/AutoRev/AutoMkt/AutoSup)
  Brain View        → tab: jarvisbrain  (JarvisBrainCenter)

── ENGINEERING SUITE ──────────────────────────────────────────────────
  Developer Copilot → tab: copilot      (DeveloperCopilotCenter + merged DeveloperOS)
  Engineering       → tab: engineering  (EngineeringCenter)
  Agent Factory     → tab: agentfactory (AgentFactoryCenter)

── INFRASTRUCTURE SUITE ───────────────────────────────────────────────
  DevOps Runtime    → tab: devops       (DevOpsCenter)
  Self-Healing      → tab: selfhealing  (SelfHealingCenter)
  Disaster Recovery → tab: disasterrecovery (DisasterRecoveryCenter — needs backend)
  Operations        → tab: operations   (OperationsCenter)
  AI Costs          → tab: aicost       (AICostCenter — needs backend)
  History           → tab: activity     (Logs)

── BUSINESS SUITE ─────────────────────────────────────────────────────
  Business OS       → tab: business     (BusinessOS + merged CRM/Reports/Launch)
  Personal OS       → tab: personal     (PersonalOS)
  Support           → tab: supportos    (SupportCenter — needs backend)

── GROWTH SUITE ───────────────────────────────────────────────────────
  SEO               → tab: seo          (SeoCommandCenter — needs backend)
  Content           → tab: content      (ContentEngine — needs backend)
  Email             → tab: email        (EmailMarketingOS — needs backend)

── SETTINGS SUITE ─────────────────────────────────────────────────────
  Getting Started   → tab: success      (SuccessCenter + merged Capabilities)
  Billing           → tab: billing      (BillingDashboard)
  Settings          → tab: settings     (WorkspaceSettings + merged Data/Privacy)
  Integrations      → tab: integrations (IntegrationCenter)
  Enterprise        → tab: enterprise   (EnterpriseOS + merged TeamWorkspace)
  Compliance        → tab: trustcompliance (TrustComplianceCenter)
  Help              → tab: help         (HelpHub)
```

### More ▾ total destinations: 43 (down from 48 — 5 removed from nav, merged into parent screens)

### Electron-exclusive (not in web More ▾)

```
Execution tab → Operator Console with 8 sub-panels:
  ExecLog Panel        BrowserAutomation Panel (desktop-only)
  Governor Panel       AIConsole Panel
  WorkflowPanel        TaskQueue Panel
  TelemetryPanel       AdapterPanel
  PluginManagerPanel

Floating window: 350×480 always-on-top overlay (same app, compact view)
```

### Flutter navigation

```
/splash → /login → /dashboard
              ↓
           /signup
           
Dashboard quick actions (need implementation):
  /chat     → AI Chat screen
  /tasks    → Task list + dispatch
  /metrics  → Stats dashboard
  /settings → Account settings
```

### Capacitor mobile navigation

```
Bottom tab bar: [Home/Chat]  [Dashboard]  [Tools]  [Profile]

Pre-auth: Login, Signup
In-app: Home, Dashboard, Tools, Profile, Privacy Policy, Terms
```

---

## BACKEND SERVICES (ALL 16 ENGINES — FROZEN)

| # | Engine | Routes | Consumer screens |
|---|---|---|---|
| 1 | RuntimeOrchestrator | `/jarvis`, `/runtime/*` | Control Center, Chat, Execution |
| 2 | AgentExecutionEngine | `/p18/agents/*` | Agents, Task Router, Action Queue |
| 3 | RuntimeActionEngine | `/p18/actions/*` | Action Queue, Workflows |
| 4 | MemoryPersistenceLayer | `/p18/memory/*` | Memory OS |
| 5 | AutonomousTaskLoop | `/p18/cycles/*` | Workflows, Brain View, Autonomy Dashboard |
| 6 | ToolExecutionLayer | `/p19/tools/*` | Tool Fabric |
| 7 | MultiAgentCoordinator | `/p19/coord/*` | Coordination |
| 8 | SelfHealingRuntime | `/p19/heal/*` | Self-Healing |
| 9 | ContinuousLearningEngine | `/p19/learn/*` | Learning Engine |
| 10 | AgentFactoryAutomation | `/p20/agents/*` | Agent Factory, Agents |
| 11 | MemoryIntelligenceEngine | `/p20/memory/*` | Memory OS (Intelligence tab) |
| 12 | GitHubEngineeringAgent | `/p23/github/*` | Engineering, Developer Copilot |
| 13 | EngineeringAutopilot | `/p23/autopilot/*` | Engineering |
| 14 | RepoIntelligenceEngine | `/p24/repo/*` | Developer Copilot |
| 15 | AutonomousRefactorEngine | `/p24/refactor/*` | Developer Copilot |
| 16 | DeploymentAutopilot | `/p25/deploy/*` | DevOps Runtime |
| 17 | EnterpriseObservability | `/p25/obs/*` | DevOps Runtime |
| 18 | OAuthIntegrationLayer | `/oauth/*` | Integrations |
| 19 | ProductionReadinessEngine | `/p21/readiness/*` | Operations |
| 20 | BillingService | `/billing/*` | Billing, Getting Started |
| 21 | PaymentService | `/payment/*` | Contacts |
| 22 | CRMService | `/crm/*` | Contacts, Pipeline |
| 23 | WhatsAppBridge | `/whatsapp/*` | Contacts, Settings |
| 24 | BrowserAgent | `/browser/*` | Execution (Electron) |
| 25 | EnterpriseManagementEngine | `/enterprise/*` | Enterprise OS |

**Engines without a screen (roadmap):**
- KnowledgeBaseEngine → Knowledge Base screen
- CostTrackingEngine → AI Costs screen
- SEOMonitoringEngine → SEO screen
- SupportTicketEngine → Support screen
- EmailAutomationEngine → Email Marketing screen
- ContentGenerationEngine → Content Engine screen

---

## REMOVED FROM NAVIGATION (FROZEN — DO NOT REINSTATE)

| Screen | Tab ID | Lines | Removal reason |
|---|---|---|---|
| Social Hub | `social` | 288 | No engine; social platform API integrations not scoped |
| Referral Engine | `referral` | 274 | No engine; referral product not yet defined |
| Partner Program | `partners` | 334 | No engine; partner product not yet defined |
| Community | `community` | 205 | External link; move to footer |
| Marketplace | `marketplace` | 142 | No engine; placeholder only |
| Visual Intelligence | (unrouted) | — | Never connected to routing; unreachable |

---

## MERGED SCREENS (FROZEN — components archived, functionality in parent)

| Removed screen | Merged into | As what |
|---|---|---|
| AgentRegistryCenter | Agent OS | "Full Profile" tab |
| SharedMemoryCenter | Memory OS | "Fabric" tab |
| MemoryIntelligenceCenter | Memory OS | "Intelligence" tab |
| AutonomousCompanyCenter | Workflows | "By Department" tab |
| ExecutionOrchestratorCenter | Workflows | "Execution Chain" tab |
| ExecutionConnectorCenter | Tool Fabric | "Connections" tab |
| OoplixRunsOoplixCenter | Autonomy Dashboard | "Domain Breakdown" tab |
| AutonomousRevenueCenter | Autonomy Dashboard | Domain row |
| AutonomousMarketingCenter | Autonomy Dashboard | Domain row |
| AutonomousSupportCenter | Autonomy Dashboard | Domain row |
| EnterpriseCRM | Business OS | "CRM" + "Pipeline" tabs |
| ExecutiveReports | Business OS | "Reports" tab |
| LaunchCommandCenter | Business OS | "Launch" section |
| DeveloperOS | Developer Copilot | "Overview" tab |
| TeamWorkspace | Enterprise OS | Teams section |
| CapabilitiesOverview | Getting Started | "What can Jarvis do?" tab |
| DataOwnershipCenter | Settings | "Data & Privacy" section |

---

## FINAL ENTERPRISE NAVIGATION (FROZEN)

### Web + Electron — Primary Header (all authenticated users)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [J] Ooplix          [Search… ⌘K]                        [Stop]  ●                 │
│─────────────────────────────────────────────────────────────────────────────────────│
│  ★ Control Center  │  Execution  │  Intelligence  │  Pipeline  │  Contacts  │ More ▾│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**★ Control Center** — default landing, live status, dispatch, pipeline summary
**Execution** — Operator Console (9 panels in Electron; auth-gated on web)
**Intelligence** — Chat with Jarvis (NL command interface)
**Pipeline** — Business metrics dashboard
**Contacts** — CRM contacts, payment links, WhatsApp follow-up
**More ▾** — 43 secondary destinations (see grouped menu below)

---

### Web + Electron — More ▾ Grouped Menu (FROZEN)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  MORE ▾                                                                             │
│─────────────────────────────────────────────────────────────────────────────────────│
│  ── WORKFLOW ────────────────────────────────────────────────────────────────────── │
│  Agents            Action Queue       Task Router       Coordination                │
│  Tool Fabric       Workflows          Memory OS         Learning Engine             │
│  Knowledge Base    Autonomy Dashboard Brain View                                    │
│                                                                                     │
│  ── ENGINEERING ─────────────────────────────────────────────────────────────────── │
│  Developer Copilot    Engineering Center    Agent Factory                           │
│                                                                                     │
│  ── INFRASTRUCTURE ──────────────────────────────────────────────────────────────── │
│  DevOps Runtime    Self-Healing    Disaster Recovery                                │
│  Operations        AI Costs        History                                          │
│                                                                                     │
│  ── BUSINESS ────────────────────────────────────────────────────────────────────── │
│  Business OS       Personal OS     Support OS                                       │
│                                                                                     │
│  ── GROWTH ──────────────────────────────────────────────────────────────────────── │
│  SEO               Content Engine  Email Marketing                                  │
│                                                                                     │
│  ── SETTINGS ────────────────────────────────────────────────────────────────────── │
│  Getting Started   Billing         Settings        Integrations                     │
│  Enterprise OS     Compliance      Help & Guides                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Total More ▾ items: 43**
- Workflow Suite: 11 items
- Engineering Suite: 3 items
- Infrastructure Suite: 6 items
- Business Suite: 3 items
- Growth Suite: 3 items
- Settings Suite: 7 items
- *(Navigation items removed and frozen: Social Hub, Referral Engine, Partner Program, Community, Marketplace)*

---

### Electron — Execution Tab Sub-panels

```
Execution tab → OperatorConsole renders 9 panels:
  ┌──────────────────┬─────────────────────┐
  │ ExecLog          │ BrowserAutomation   │  ← Desktop exclusive
  ├──────────────────┼─────────────────────┤
  │ Governor         │ AI Console          │
  ├──────────────────┼─────────────────────┤
  │ Workflow         │ Task Queue          │
  ├──────────────────┼─────────────────────┤
  │ Telemetry        │ Adapter             │
  └──────────────────┴─────────────────────┘
  + Plugin Manager (full-width)
```

---

### Flutter Mobile Navigation

```
Pre-auth:    /splash → /login ↔ /signup
Post-auth:   /dashboard
               ├── tile: /chat     (DEAD — GoRoute missing)
               ├── tile: /tasks    (DEAD — GoRoute missing)
               ├── tile: /metrics  (DEAD — GoRoute missing)
               └── tile: /settings (DEAD — GoRoute missing)
```

---

### Capacitor Mobile Navigation

```
Pre-auth:  Login  │  Signup
Bottom tab bar (post-auth):
  [Home/Chat]  [Dashboard]  [Tools]  [Profile]
                                         └── links: Privacy Policy · Terms
```

---

### Command Palette (⌘K) — Universal Search

All 43 More ▾ destinations + 5 primary tabs are searchable.
Palette also accepts free-text → routes to Intelligence (Chat) tab.

---

## CERTIFICATION SIGNATURES (Phase 35)

| Artifact | Count | Status |
|---|---|---|
| Backend engines | 25 | FROZEN |
| API routes | 399 | FROZEN |
| Web screens | 48 | FROZEN |
| Electron-exclusive panels | 11 | FROZEN |
| Flutter screens | 8 (4 DEAD) | DEFINED |
| Capacitor screens | 8 | FROZEN |
| Total certified surfaces | 75 | FROZEN |
| Phase 34 workflow audit | 17/17 PASS | CERTIFIED |
| Frontend build | 0 errors | CERTIFIED |
| Surface documentation | All 75 surfaces | COMPLETE |

**Phase 35 documents:**
- `MASTER_SAAS_ARCHITECTURE.md` — architecture + navigation (this file)
- `SCREEN_INVENTORY_FINAL.md` — all 75 surfaces with full detail
- `ROLE_MATRIX.md` — per-screen access by role + billing tier
- `SCREEN_AUDIT_CHECKLIST.md` — checklist + open items by priority

**No new features. No new engines. No redesign.**
**This is the frozen product surface as of 2026-06-06.**
