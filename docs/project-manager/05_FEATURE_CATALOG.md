# 05 — Feature Catalog

**Status of this document:** VERIFIED against `frontend/src/App.jsx` (navigation registry), backend route files, and `docs/current/` audit findings. Status labels use the source material's own vocabulary: **REAL** (live-tested working), **CODE READY / WAITING** (correct code, missing credential), **PARTIAL**, **SIMULATION** (honestly self-labeled), **REMOVED FROM NAV** (component exists, unreachable by design), **NOT IMPLEMENTED**.

This catalog is organized by the product's own navigation grouping (7 groups, 74 total nav entries, confirmed in `frontend/src/App.jsx`), not a marketing taxonomy.

---

## Account & Setup (6 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| Getting Started | Onboarding flow | `co3UserSuccess.cjs` and related | REAL |
| Billing | Plan/trial status, upgrade, cancel | `billingService.js`, `/billing/*` | REAL — live Razorpay SDK integration, not a stub |
| Settings | App/connector configuration | `/settings/*` | REAL |
| Help & Guides | In-app documentation | Static/content-driven | REAL |
| Beta Checklist | Closed-beta readiness checklist | `betaReadiness.cjs` | REAL |
| Overview | Account summary | Various | REAL |

## Operations (10 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| Mission Control | Create/track AI missions | `missionOrchestrator.cjs`, `/missions/*`, `/mission/*` | REAL — live-verified, 228+ real missions observed during audit |
| Runtime Console | Live agent/task runtime view | `agents/runtime/*`, `/runtime/*` | REAL |
| Execution | Execution tracking | Execution engine services | REAL |
| History | Activity history | `executionHistory.cjs` | REAL |
| Reports | Reporting | Various | REAL |
| Operations, Orchestrator, Reliability | Ops dashboards over the runtime | `agents/runtime/*` | REAL |
| Global Activity | Cross-system activity feed | `runtimeEventBus.cjs` | REAL |
| System Health | Health/status dashboard | `/health`, `/ops`, `/metrics/*` | REAL |

## AI & Agents (10 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| Agents | Agent directory/management | `agentRegistry.cjs` | REAL |
| Agent Runtime | Live agent execution view | `AutonomousAgentDashboard` | REAL |
| Agent Factory | Agent creation | Agent registry services | REAL |
| Agent Actions | Action history per agent | Runtime services | REAL |
| Collaboration | Multi-agent handoff/coordination | `missionCollaborationEngine.cjs`, `/collab/*` | REAL |
| Task Router | Capability-based task routing | `agents/runtime/taskRouter.cjs` | REAL — directly unit-tested (`tests/runtime/01-taskRouter.test.cjs`) |
| Registry | Capability/agent registry | `agentRegistry.cjs` | REAL |
| Tool Fabric | Tool-calling infrastructure | `aiService.js` `chatWithTools()` | REAL — native function-calling for 4 providers |
| Auto Workflows | Automated workflow chains | Workflow OS services | REAL |
| Autonomy Score, Live Agent Roster | Autonomy metrics/roster views | Various | REAL, though see [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md) for the honest limits of what "autonomous" means here |

## Intelligence (11 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| Intelligence, Prediction, Recommendations | Business/engineering intelligence dashboards | `*IntelligenceEngine.cjs`, `*PredictionEngine.cjs` families | REAL — real computation over real data, per-domain (business, engineering, knowledge, evolution) |
| Guardrails | Safety/policy constraints | Governance services | REAL |
| Command Console | Natural-language command interface | AI router | REAL |
| Executive Loop | Executive decision loop | `executiveOrg.cjs` (Level 6) | PARTIAL — real code, self-referential scope (see doc 11) |
| Reasoning & Risk | Risk/reasoning overlay | `reasoningEngine.cjs` | REAL |
| Memory Fabric, Memory Intel | Cross-system memory views | `semanticMemorySearch.cjs`, `memoryIntelligenceEngine.cjs` | REAL — genuine TF-IDF search, independently verified |
| Self-Improve | Continuous self-improvement engine | `engineeringSmellDetector.cjs` and related | REAL — pattern discovery is real; see doc 11 for self-correction limits |
| Jarvis Brain | Central AI reasoning view | AI router + reasoning engine | REAL |

## Engineering (6 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| Engineering | Engineering dashboard | Engineering org services | REAL |
| Eng Workspace | Code editor, file explorer, visual git | CodeMirror 6, `/coding/*` | REAL |
| Copilot | AI pair-programming (chat, patch, review, refactor) | `backend/routes/codingAssistant.js` — 20+ endpoints confirmed | REAL — `/coding/ask`, `/coding/generate-patch`, `/coding/apply-patch`, `/coding/undo-patch` all live route handlers, not stubs |
| DevOps | Deployment/ops dashboard | `/deployment/*` | REAL |
| Self-Healing | Automated failure recovery | `executionRecovery.cjs`, `selfHealingFrontend.cjs` | REAL for recovery-with-escalation; NOT true self-correction (see doc 11). Note: a real path-traversal vulnerability in this subsystem's file-patch functions was found and fixed on 2026-07-17. |
| Exec Connectors | Connector execution bridge | `connectorToolBridge.cjs` | PARTIAL — exposes connector *status* to AI agents as tool-calling definitions; the file's own header states no per-service *action* layer exists yet ("no 'send Slack message' method exists anywhere") |

## Growth (9 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| Creative Studio | Image/video/voice/brand/social content generation | `backend/routes/creativeStudio.js` — 10 sub-modules, 35+ endpoints | REAL routing + real job-queue architecture (`creativeJobQueue.cjs`); whether the queue calls a real external generation provider end-to-end was not independently confirmed in this audit — flagged for follow-up. Fixed a real credit-check bug on 2026-07-17 (module-7 commit). |
| SEO, Content, Social, Email | Marketing automation modules, all served by `GrowthOSV2` | `/growth/*` | REAL, though thinner API wiring was noted (routes mostly through a generic `sendMessage()` call rather than dedicated typed API modules — flagged, not necessarily a problem) |
| Referral | Referral/credit rewards system | Referral services | REAL |
| Partners | Partner program | Various | REAL |
| Launch | Launch platform (onboarding, academy, benchmark) | Launch platform services | REAL |
| AI Costs | AI usage/cost tracking | Usage metering (billing) | REAL |

## Enterprise & Platform (9 screens)

| Feature | Purpose | Backend | Status |
|---|---|---|---|
| CRM | Deal pipeline, leads, WhatsApp/Telegram automation | `backend/routes/crm.js`, `business.js` | REAL — live-tested end to end |
| Companies | Multi-company management ("Company Factory") | `backend/routes/companyFactory.js`, `CompanyFactoryCenter.jsx` | REAL — create company from idea, lifecycle tracking (planning→building→testing→launch→growth→scale→maintenance), quality gates. Newly surfaced to nav 2026-07 (was backend-complete but unreachable before). See [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md). |
| Team | Org/team management, RBAC | `orgMiddleware.cjs`, organization service | REAL — RBAC live-verified to return real 403s |
| Integrations | Connector dashboard | `/integrations/*` | REAL — see [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md) |
| Marketplace | Asset marketplace (13 asset types: agent, workflow, blueprint, template, plugin, etc.) + connector submission workflow | `backend/routes/autonomousMarketplace.js`, `marketplace.js` | REAL code, low real-world liquidity (no evidence of external sellers/buyers yet — internal/scaffolding stage) |
| Trust | Compliance/trust center | `TrustComplianceCenter.jsx` | REAL — contains a genuine compliance risk-register entry, not fake content |
| Support | Support ticketing/ops | Support OS services | REAL |
| Ooplix Runs Ooplix ("Oroplix") | Dogfooding dashboard — the product managing its own operations | Various | REAL, self-referential by design |
| Executive Dash | Executive summary dashboard | `businessIntelligenceDashboard.cjs` and related | REAL |

## Removed From Navigation (2026-07-17)

The following are **not currently reachable** by any user through the UI (nav, search, or command palette). Component files still exist on disk; nothing was deleted:

| Page | Reason |
|---|---|
| EnterpriseCRM | Fabricated example data ("Arjun Mehta, Priya Sharma"), no real backend |
| KnowledgeCenter | Fabricated data |
| AutonomousCompanyCenter, AutonomousRevenueCenter, AutonomousMarketingCenter, AutonomousSupportCenter | Fabricated data — near-identical duplicate cluster |
| DataOwnershipCenter | Fabricated literal record counts |
| DisasterRecoveryCenter, MobilePlatformCenter, CommunityCenter | Fabricated data |
| MemoryOSV2, PersonalOS, DeveloperOS, EnterpriseOS | Called backend namespaces (`/personal/*`, `/dev/*`, `/enterprise/*`) that do not exist anywhere in `backend/routes/` |

## Not Implemented (zero code)

- PayPal payment connector
- Real Gmail / Google Calendar / Google Drive API calls (OAuth scope requested, zero outbound calls made)
- Stripe webhook handling (env var documented, no route exists)

---

*Next: [06_SCREEN_CATALOG.md](06_SCREEN_CATALOG.md) for the complete screen-by-screen navigation map.*
