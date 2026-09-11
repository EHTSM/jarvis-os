# 06 — Screen Catalog

**Status of this document:** VERIFIED against `frontend/src/App.jsx` (the app's navigation registry, read in full — 74 nav entries confirmed by direct count). Primary tabs are eagerly loaded; secondary/overflow tabs are `lazy()`-loaded. "Current Status" reflects the 2026-07-17 reality audit where the same screen appears in [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md).

---

## Primary Navigation (always visible, 6 tabs)

| Screen | Purpose | Primary User | Navigation |
|---|---|---|---|
| Dashboard (`home`) | Landing overview | All users | Top nav |
| Contacts (`clients`) | Contact list | Sales/CRM user | Top nav |
| Payments (`payments`) | Payment tracking | Founder/operator | Top nav |
| Pipeline (`insights`) | Deal pipeline | Sales/CRM user | Top nav |
| AI (`chat`) | Direct AI chat interface | All users | Top nav — eagerly loaded (`Chat` component) |
| More (`more`) | Overflow menu into 68 additional screens | Power users | Top nav |

## Account & Setup Group (6 screens)

| Screen | id | Purpose | Backend APIs | Status |
|---|---|---|---|---|
| Getting Started | `success` | Guided onboarding | Onboarding services | REAL |
| Billing | `billing` | Plan, trial, upgrade/cancel | `/billing/status`, `/billing/upgrade`, `/billing/cancel` | REAL |
| Settings | `settings` | Connector/app config | `/settings/*` | REAL |
| Help & Guides | `help` | In-app docs | Static content | REAL |
| Beta Checklist | `betachecklist` | Closed-beta readiness | `/beta/*` | REAL |
| Overview | `overview` | Account summary | Various | REAL |

## Operations Group (10 screens)

| Screen | id | Purpose | Backend APIs | Status |
|---|---|---|---|---|
| History | `activity` | Activity log | Execution history services | REAL |
| Reports | `reports` | Reporting | Various | REAL |
| Mission Control | `mission` | Mission tracking | `/missions/*`, `/mission/*` | REAL |
| Runtime Console | `runtime` | Live runtime state | `/runtime/*` (JWT-gated) | REAL |
| Execution | `execution` | Execution detail | Execution engine | REAL |
| Operations | `operations` | Ops dashboard | Various | REAL |
| Orchestrator | `orchestrator` | Orchestration view | `missionOrchestrator.cjs` | REAL |
| Reliability | `reliability` | Reliability metrics | Runtime services | REAL |
| Global Activity | `globalactivity` | Cross-system feed | `runtimeEventBus.cjs` (SSE) | REAL |
| System Health | `systemhealth` | Health dashboard | `/health`, `/metrics/*` | REAL |

## AI & Agents Group (10 screens)

| Screen | id | Purpose | Backend APIs | Status |
|---|---|---|---|---|
| Agents | `agents` | Agent directory (rendered by `AgentOSV2`) | `phase18Api`, `phase20Api`, `telemetryApi`, `runtimeApi` | REAL |
| Agent Runtime | `agentruntime` | Live agent execution (`AutonomousAgentDashboard`) | `_fetch("/collab/active")`, `_fetch("/pipeline/active")` | REAL |
| Agent Factory | `agentfactory` | Agent creation | Registry services | REAL |
| Agent Actions | `agentactions` | Per-agent action log | Runtime services | REAL |
| Collaboration | `collab` | Multi-agent handoff | `/collab/*` | REAL |
| Task Router | `taskrouter` | Capability routing view | `taskRouter.cjs` | REAL |
| Registry | `registry` | Capability registry | `agentRegistry.cjs` | REAL |
| Tool Fabric | `toolfabric` | Tool-calling infra | `aiService.js` | REAL |
| Auto Workflows | `autonomouswf` | Workflow chains (`WorkflowOSV2`) | `runtimeApi`, `telemetryApi`, `phase18Api` | REAL |
| Autonomy Score / Live Agent Roster | `autonomyscore`/`agentcollab` | Autonomy metrics | Various | REAL |

## Intelligence Group (11 screens)

| Screen | id | Purpose | Status |
|---|---|---|---|
| Intelligence | `intel` | Cross-domain intelligence dashboard | REAL |
| Prediction | `predict` | Prediction engine views | REAL |
| Recommendations | `recommend` | Recommendation engine | REAL |
| Guardrails | `guardrails` | Policy/safety constraints | REAL |
| Command Console | `nlconsole` | NL command interface | REAL |
| Executive Loop | `execloop` | Executive decision loop | PARTIAL (real code, self-referential scope) |
| Reasoning & Risk | `inteloverlay` | Reasoning/risk overlay | REAL |
| Memory Fabric | `sharedmem` | Cross-system memory | REAL (TF-IDF, verified) |
| Memory Intel | `memoryintel` | Memory intelligence | REAL |
| Self-Improve | `selfimprove` | Self-improvement engine | REAL (pattern discovery); not true self-correction |
| Jarvis Brain | `jarvisbrain` | Central reasoning view | REAL |

## Engineering Group (6 screens)

| Screen | id | Purpose | Backend APIs | Status |
|---|---|---|---|---|
| Engineering | `engineering` | Engineering dashboard | Engineering org services | REAL |
| Eng Workspace | `workspace` | Code editor, git, terminal | `/coding/*` | REAL |
| Copilot | `copilot` | AI pair-programming (`DeveloperCopilotV2`) | `telemetryApi`, `runtimeApi`, `phase24Api`, `phase19Api`, `phase21Api` | REAL |
| DevOps | `devops` | Deployment dashboard | `/deployment/*` | REAL |
| Self-Healing | `selfhealing` | Automated recovery | `executionRecovery.cjs` | REAL (escalation, not judgment revision) |
| Exec Connectors | `execconnector` | Connector-to-agent bridge | `connectorToolBridge.cjs` | PARTIAL (status only, no action layer yet) |

## Growth Group (9 screens)

| Screen | id | Purpose | Status |
|---|---|---|---|
| Creative Studio | `creative` | Image/video/voice/brand generation (`CreativeStudio`) | REAL routing, job-queue based |
| SEO | `seo` | SEO tools (rendered by `GrowthOSV2`) | REAL |
| Content | `content` | Content generation (`GrowthOSV2`) | REAL |
| Social | `social` | Social scheduling (`GrowthOSV2`) | REAL |
| Email | `email` | Email campaigns (`GrowthOSV2`) | REAL |
| Referral | `referral` | Referral program (`GrowthOSV2`) | REAL |
| Partners | `partners` | Partner program | REAL |
| Launch | `launch` | Launch platform (`GrowthOSV2`) | REAL |
| AI Costs | `aicost` | AI usage/cost tracking | REAL |

*Note: SEO/Content/Social/Email/Referral/Launch all render through one shared component (`GrowthOSV2`) with a different `initialTab` prop — one component powering 6 nav entries.*

## Enterprise & Platform Group (9 screens)

| Screen | id | Purpose | Backend APIs | Status |
|---|---|---|---|---|
| CRM | `business` | Deal pipeline, leads (`BusinessOS`) | `businessApi.js` | REAL — live end-to-end tested |
| Companies | `companies` | Multi-company management | `companyFactoryApi.js` | REAL |
| Team | `team` | Org/RBAC management | Organization service | REAL |
| Integrations | `integrations` | Connector dashboard | `connectorApi.js`, `/integrations/*` | REAL |
| Marketplace | `marketplace` | Asset marketplace | `/auto-market/*`, `/marketplace/*` | REAL code, low real usage |
| Trust | `trustcompliance` | Compliance center | `TrustComplianceCenter` | REAL |
| Support | `supportos` | Support ticketing | Support services | REAL |
| Ooplix Runs Ooplix | `oroplix` | Dogfooding dashboard | Various | REAL, self-referential |
| Executive Dash | `executivedash` | Executive summary | `businessIntelligenceDashboard.cjs` | REAL |

## Screens Removed From All Navigation Paths (2026-07-17)

These 14 pages were removed from `App.jsx`'s nav array, `GlobalSearch.jsx`'s `STATIC_ROUTES`, and `CommandPalette.jsx`'s command list — the only three places a user could reach any screen. **No user can currently navigate to any of these**, though the component files remain on disk:

EnterpriseCRM, KnowledgeCenter, AutonomousCompanyCenter, DataOwnershipCenter, DisasterRecoveryCenter, MobilePlatformCenter, CommunityCenter, AutonomousRevenueCenter, AutonomousMarketingCenter, AutonomousSupportCenter, MemoryOSV2, PersonalOS, DeveloperOS, EnterpriseOS.

See [05_FEATURE_CATALOG.md](05_FEATURE_CATALOG.md) for why each was removed.

## Navigation Mechanics

Three separate places a user reaches a screen, all kept in sync since the 2026-07-17 cleanup:
1. The primary/overflow `TABS`/`MORE_TABS` arrays in `App.jsx`
2. `GlobalSearch.jsx`'s `STATIC_ROUTES`
3. `CommandPalette.jsx`'s command list

Most secondary modules are `lazy()`-loaded; only Chat, Dashboard, CommandCenter, TrialBanner, ConnectBar, OperatorConsole, and auth screens are eagerly imported at startup.

---

*Next: [07_AI_CAPABILITIES.md](07_AI_CAPABILITIES.md) for exactly what the AI runtime can and cannot do.*
