# JARVIS 100-Company Capability Reality Audit

**Mode:** Audit only. No code was changed, no agents/skills/connectors were created, no architecture was refactored.
**Date:** 2026-07-23
**Scope:** `/Users/ehtsm/jarvis-os` on branch `security/reality-completion`, commit range up to `e030bb1`.

**Method note:** This repository contains 150+ self-authored markdown "phase completion" reports at the repo root (e.g. `PRODUCT_EXCELLENCE_REPORT.md`, `FINAL_PRODUCTION_CERTIFICATION.md`) and a `MEMORY.md` project index claiming things like "39-agent AGENT_CATALOGUE," "57 connectors," "144/144 regression," "100+ routes." **None of these documents were used as evidence.** Every claim below is backed by a file path and line number that a reviewer can open and verify directly, gathered by six parallel code-reading passes over `backend/`, `agents/`, `frontend/`, `electron/`, and `data/`. Where a memory/doc claim conflicts with what the code does, the code wins and the discrepancy is called out explicitly.

**Headline finding:** JARVIS-OS has a real, non-trivial single-tenant-oriented product core (auth, billing, an Express app with 142 route files, a genuine encrypted secret vault, a real knowledge graph, a real company/org data model). Layered on top of it is a much larger set of code that *describes* a 100-company autonomous operating system but does not *execute* one: agent/skill catalogues that are inert metadata, connector "health checks" that don't call the vendor, an approval engine that isn't wired to the routes that move money, and a persistence layer (flat JSON files, single Node process) that was never built or tested for multi-tenant concurrent scale. There is also one **confirmed, exploitable cross-tenant IDOR** in a live CRM route.

---

## PART 1 — Company Factory

Entry point: `POST /company-factory/create` → `backend/routes/companyFactory.js:127` → `backend/services/companyFactory.cjs:135` `createCompany()`. Route is mounted and reachable (`backend/routes/index.js:163-164`, behind `requireAuth`).

| Capability | Verdict | Evidence |
|---|---|---|
| Company creation | **WORKING** | `companyFactory.cjs:135-290`, real 13-step pipeline, persists via `fs.writeFileSync`-backed `_save()` (`companyFactory.cjs:266`). Verified non-trivial real data on disk in `data/company-factory.json` (442KB), `data/company-lifecycle.json` (1.1MB). |
| Company→org linkage | **WORKING** | `companyLifecycleEngine.cjs:142-157` calls real `organizationService.createOrg()` (`organizationService.cjs:323-353`), persists to `data/organizations.json`. Company record stores `orgId`. |
| Company isolation | **WORKING (RBAC-level), PARTIAL (data-level)** | Route-level checks via `organizationService.hasPermission` (`companyFactory.js:40`). But see Part 6 — underlying memory/CRM stores are frequently global-by-default unless orgId is explicitly threaded through, and one confirmed IDOR crosses this boundary in a *different* route file (`business.js`, see Part 6/8). |
| Company cloning | **WORKING** | `companyFactory.cjs:302-320` `cloneCompany()` re-runs the real creation pipeline from `source.templateId` — not a shallow copy. |
| Company templates | **PARTIAL** | Only **10 hardcoded templates** exist: `saas, agency, ecommerce, marketplace, healthcare, education, crm, erp, ai_product, internal_tool` (`backend/services/businessTemplateEngine.cjs:17-168`). Niche inference (`inferTemplate()`, line 185) is a linear regex ladder over ~10 keyword patterns, defaulting to `saas` if nothing matches (line 191) — real code, but not the ML/semantic classification the target model implies. |
| Branding | **WORKING (thin proxy)** | `companyFactory.js:286-325` reads/writes `brandStudio.cjs`, scoped by `company.orgId`. |
| Assets | **WORKING** | `companyFactory.js:329-381` real CRUD via `creativeAssetLibrary.cjs` + optional real S3/R2 upload through `storageService.cjs`; returns HTTP 503 honestly if no storage provider is configured (no silent mock). |
| CRM (per company) | **WORKING (thin proxy)** | `companyFactory.js:389-429` proxies to `businessDataService.cjs`, orgId-scoped — but `businessDataService` itself is globally-readable when orgId is omitted elsewhere (Part 6). |
| Marketing (per company) | **WORKING (thin proxy)** | `companyFactory.js:431-447`, same `businessDataService.cjs` backing. |
| AI (per company) | **WORKING** | `companyFactory.js:461-484` real `aiOrchestrator.execute()` call with orgId for budget attribution (see Part 10, real budget enforcement in `orgBudgets.cjs`). |
| Memory (per company) | **WORKING (repurposed field), not truly dedicated** | `companyFactory.js:492-512` overloads `company.orgId` as the `projectId` partition key into `semanticMemorySearch` — a real mechanism, but "per-company" memory is actually reused org-partitioning, not a first-class company memory store. |
| Billing (per company) | **WORKING (thin proxy)** | `companyFactory.js:519-547`, real `orgBudgets.cjs` + `organizationService.getOrgBillingOverview`. |
| Connectors (per company) | **WORKING (thin proxy)** | `companyFactory.js:555-593`, real `secretVault.cjs` store/list/validate/delete, gated by `policyService.assertConnectorAllowed`. |
| Analytics (per company) | **WORKING (read-side aggregation)** | `companyFactory.js:600-622`, computed composition of real underlying calls, no new storage. |
| Company lifecycle | **WORKING** | `companyLifecycleEngine.cjs:38-320` — real staged state machine (planning→building→testing→launch→growth→scale→maintenance) with gate checks and persisted transitions. |
| Cross-company intelligence | **PARTIAL** | `companyFactory.js:91-109` — only 2 hardcoded heuristics (stage-bottleneck count, risk-score threshold). Real computation, shallow rule set. |
| Portfolio dashboard | **WORKING** | `companyFactory.js:62-123` `founder/dashboard` — real, computed composition of org/lifecycle/usage/CRM data, not static. |

**Important structural caveat found by the automated agent-factory pipeline test** (Part 7 below): when a company is created via `companyFactory.cjs`, the workforce/agent assignment step runs with **`dryRun: true` hardcoded** (`companyFactory.cjs:199`, `companyWorkspaceBuilder.cjs:129`) — meaning **no agent is ever actually executed** as part of company creation; only structured JSON records describing an intended team are written. Also, **no RBAC/permission assignment step exists in the factory at all** — `companyLifecycleEngine.cjs:141` contains a verbatim code comment: *"No parallel company-scoped storage or permission system is created here."* And **no connector-attachment step exists in the creation pipeline** — connectors are wired later via the manual per-company proxy routes listed above, not automatically by niche.

---

## PART 2 — Department Engine

Two unrelated systems both use the word "department":

**(A) Generic org departments** — `backend/routes/organizations.js` → `organizationService.cjs:637-696` (`createDepartment`/`updateDepartment`/`deleteDepartment`/`listDepartments`). Schema (`organizationService.cjs:645-653`): `{id, name, description, leadAccountId, createdAt, updatedAt, teams:[]}` — **no `type`/`family`/`template` field**. Confirmed via live data: all 4 real orgs on disk have `"departments": []` (never populated in practice). This is free-text label + generic CRUD, zero behavioral differentiation by department name.

**(B) Ten hardcoded "OrgX" agent-persona services** — `businessOrg.cjs`, `engineeringOrg.cjs`, `autonomousKnowledgeOrg.cjs`, `autonomousEvolutionOrg.cjs`, `executiveOrg.cjs`, `enterpriseOrg.cjs`, `ecosystemOrg.cjs`, `civilizationOrg.cjs`, `autonomousOrg.cjs`, `platformOrg.cjs` — each registers ~20 named "department" agents into `agentRuntimeSupervisor`, each with a real `tickFn`. These are **fixed, code-defined, single-instance-system-wide rosters** — not user-configurable per-company templates, not per-org, mounted at static routes (`/bizorg/*`, `/engorg/*`, `/ako/*`, `routes/index.js:136-151`).

### Family-by-family (32 requested families)

| Family | Status | Evidence |
|---|---|---|
| Executive/Founder | Explicit agent | `bizorg_ceo`/`bizorg_coo` `businessOrg.cjs:515-516` |
| Strategy | Explicit agent | `bizorg_coordinator` `businessOrg.cjs:533` |
| Operations | Explicit agent | `bizorg_coo` `businessOrg.cjs:516` |
| Administration | Composable only | Generic dept CRUD only |
| Sales | Explicit agent | `bizorg_sales` `businessOrg.cjs:517` |
| CRM | Explicit agent | `bizorg_crm` `businessOrg.cjs:520` |
| Marketing | Explicit agent | `bizorg_marketing` `businessOrg.cjs:518` |
| Growth | Explicit agent | `bizorg_growth` `businessOrg.cjs:519` |
| Customer Success | Explicit agent | `bizorg_cs` `businessOrg.cjs:521` |
| Support | Composable only | No dedicated ticketing agent found |
| Product | Explicit agent (partial) | `bizorg_product_mkt` `businessOrg.cjs:526`; `ako_product` |
| Engineering | Explicit agent (20 roles) | `engineeringOrg.cjs:1116-1260` |
| AI | Explicit agent | `ako_ai_model`, `ako_prompt` (`autonomousKnowledgeOrg.cjs`) |
| DevOps/Cloud | Explicit agent | `devops_eng` `engineeringOrg.cjs:1188` |
| QA | Explicit agent | `qa_eng` `engineeringOrg.cjs:1196` |
| Security | Explicit agent | `security_eng` `engineeringOrg.cjs:1204` |
| Data/Analytics | Explicit agent | `bizorg_analytics`, `bizorg_bi` `businessOrg.cjs:532-533` |
| Research | Explicit agent | `ako_research` |
| Finance/Accounting | Explicit agent | `bizorg_finance` `businessOrg.cjs:522` |
| Billing/Payments | Explicit agent | `bizorg_billing` `businessOrg.cjs:523` |
| Legal/Compliance | **MISSING** | No dedicated agent/service; only contextual mentions in enterprise files |
| HR/Recruitment | **MISSING** | Zero service files match hr/recruitment/hiring/payroll |
| Procurement | **MISSING** | No dept agent or service |
| Supply Chain | **MISSING** | Zero matches |
| Inventory/Warehouse | **MISSING** | Zero matches |
| Logistics | **MISSING** | Zero matches |
| Brand/Design | Explicit (non-agent service) | `brandStudio.cjs`, used by company-factory branding |
| Content/SEO | Explicit agent | `bizorg_content`, `bizorg_seo` `businessOrg.cjs:527-528` |
| Video/Audio/Media | **MISSING as dept** | Only an AI capability-routing tag in `capabilityRouter.cjs`/`creativeRegistry.cjs` |
| 3D/CAD | **MISSING as dept** | `capabilityRouter.cjs:27-28` — regex classifier only, no business logic |
| Manufacturing/Production | **MISSING** | Zero matches |
| IoT/Robotics/Maintenance/Quality | **MISSING** | Zero matches |
| Energy/Infrastructure | **MISSING** | Zero matches |

**Summary:** ~18 of 32 requested families have real, differentiated agent logic. The remaining ~14 (HR, Legal/Compliance, Procurement, Supply Chain, Inventory, Logistics, Manufacturing, IoT/Robotics, Energy, 3D/CAD, Video/Audio/Media production, Support ticketing, Administration) have **no code at all** — they would have to be built from zero, not "wired up."

---

## PART 3 — Agent Archetypes

**There is no single 60-role (or 39-agent) catalogue that executes.** Three disjoint constructs exist, none matching memory-doc claims:

1. **`agents/runtime/agentRegistry.cjs`** (real dispatcher, circuit-breaker backed) — only **8 capabilities actually registered** at boot (`agents/runtime/bootstrapRuntime.cjs`): `browser` (27), `terminal` (37), `automation` (52), `dev` (67), `filesystem` (105-135), `desktop` (env-gated, off by default, 145-178), `crm` (184-203), `ai` (209-220). Real dispatch path: `taskRouter.cjs:10-72` → `agentRegistry.findForCapability()` → `executionEngine.executeTask()` with retries/timeout/circuit breaker/dead-letter queue.
2. **`backend/services/agentRuntimeSupervisor.cjs`** — 10 role-tagged agents (planner, reviewer, verifier, developer, tester, security, documentation, crm, marketing, executive), each on a real `setInterval` tick that reads real services and **creates mission/task records** — but none of these ticks perform the end action (no email sent, no API called); they stop at "create a mission for later execution."
3. **`backend/services/skillEngine.cjs:37-82` `AGENT_CATALOGUE`** — 27 entries, each a **plain data object** (`id, org, skills[], specializations[], confidence, ...`) with **no handler function and no execution path**. Consumers are only `teamBuilder.cjs`/`workforceDashboard.cjs`/`performanceEngine.cjs`/`capacityPlanner.cjs` — a workforce-capacity *simulation*, not a dispatcher.

Separately, `agents/business/*.cjs` (11 files), `agents/content/*.cjs` (11), `agents/internet/*.cjs` (11), `agents/multi/*.cjs` (6), `agents/system/*.cjs` (2) each contain real, non-trivial per-file logic (SEO agent, video generator, social media agent, market intelligence agent, etc.) — **confirmed via exhaustive grep: zero files under `backend/` `require()` any of `agents/multi`, `agents/business`, or `agents/content`.** ~41 files with real logic are completely unreachable from the running Express server.

### Classification against ~60 target roles (abridged; full detail in `AGENT-SKILL-CONNECTOR-MATRIX.md`)

- **WORKING** (real logic + reachable execution path): Software Engineer/Coding (`dev` capability), CRM/Sales (`crm` capability, narrow), Finance/Billing/Payment (`billingService.js`, real Razorpay-backed `paymentService.js`).
- **PARTIAL** (real logic, stops at mission-creation, no end-action): Founder/CEO, COO, Strategy, Executive Intelligence, Marketing, Growth, QA, Security, Customer Success/Support, Scientific Research (dashboard-only), Forecasting (revenue-only).
- **COMPOSABLE NOW** (no dedicated agent, but generic mission/AI/automation capability could genuinely do it): Project Manager, Risk, Product Manager, Data Engineer, AI/ML, Integration.
- **UNWIRED** (real code exists, unreachable from the server): SEO, Social Media, Content/Writer, Graphic Design, Video, Audio/Voice, Research/Knowledge (internet agents), Quant/Market Intelligence.
- **MISSING** (no code found anywhere): Compliance, Performance Ads, DevOps/Cloud (as an executing agent — only a skill-tag exists), Accounting, Treasury, Procurement, Inventory, Supply Chain, Logistics, UI/UX, 3D/CAD, HR, Recruitment, Document, Legal Workflow, Manufacturing, Quality Control, Maintenance, IoT, Robotics, Energy, Geospatial, Blockchain/Web3, Simulation/Digital Twin.

---

## PART 4 — Skill Library

No unified executable skill/tool registry backs an AI tool-calling interface anywhere in the repo (no `tools: [...]` function-calling schema was found passed to any AI provider in `backend/services/aiService.js`).

- **Real executable skills (WORKING):** 8 — `browser, terminal, automation, dev, filesystem, crm, ai`, plus `desktop` (disabled by default). These map to: Operations (automation, terminal), Engineering (dev, filesystem), CRM/Support (crm), Advanced Intelligence (ai), Physical/Industrial (desktop, off).
- **PARTIAL:** the 10 `agentRuntimeSupervisor` role ticks — real reads + real mission writes, no end-action execution.
- **UNWIRED:** ~41 files across `agents/business`, `agents/content`, `agents/internet`, `agents/multi`, `agents/system` — real logic, zero server-side reachability.
- **DEAD:** `skillEngine.cjs` `AGENT_CATALOGUE` — 27 entries × ~5 tags ≈ 135 skill-tag strings, pure metadata consumed only by an internal workforce-capacity simulation that itself doesn't drive task dispatch.

**Total distinct real executable skills found: 8 WORKING. ~10 PARTIAL. ~41 files UNWIRED. ~135 tag-strings DEAD/metadata-only.** Against the ~90-target capability set, this is **8/90 confirmed working**, with a large amount of real but disconnected code that could be wired up without being newly written (see Gap List, P1).

---

## PART 5 — Connector Master Audit

`backend/services/integrationConnectors.cjs` (1468 lines) is the *entire* connector surface — **13 phases (A–M), 62 connector functions.** There is no CRM/support/accounting/shipping/maps/3D/video/audio/blockchain/trading/scientific/mobile-distribution/desktop-signing/IoT connector anywhere in the repo; grep for salesforce/hubspot/quickbooks/zendesk/shippo/blender/autocad/coinbase/web3 returns zero hits. Full per-connector table with env var names is in `AGENT-SKILL-CONNECTOR-MATRIX.md`. Highlights:

- Every connector follows one shape: check env/vault → if present, call `_probe()` (raw HTTP call) → map success/failure to CONNECTED/PARTIAL. **None do real business work** (no message sent, no charge made, no file uploaded) — they are reachability/auth-verification probes only. Real send-side logic for email lives separately in `emailService.cjs` (SendGrid/Resend/Postmark real sends, confirmed at lines 134/143/153).
- **Currently live with real credentials (3):** `ai:groq`, `ai:openai`, `pay:razorpay` — confirmed CONNECTED in `data/integration-connectors.json`.
- **FAKE-MOCK health checks that never touch the network but report CONNECTED:** `auth:github` (`integrationConnectors.cjs:816-817`), `auth:apple` (859-860), `auth:discord` (867-868) — report CONNECTED from env-var presence alone. `auto:zapier` (1108) only regex-validates a URL string.
- **Cannot be meaningfully probed by design:** `email:ses` (618-627, explicit comment "cannot probe without sending," always PARTIAL). `infra:firebase` (398-401) never contacts Firebase, only `JSON.parse()`s the service-account string.
- **Weaker verification than status implies:** `auth:google`, `auth:microsoft`, `auth:linkedin` only hit the provider's public OIDC discovery document, never validate the actual client secret.
- **Real, legitimate secret storage:** `secretVault.cjs` uses genuine AES-256-GCM encryption at rest (lines 52-71), key derived from `JWT_SECRET`, file mode `0600` — confirmed the on-disk `data/vault.json` holds ciphertext, not plaintext. Currently holds only 4 secrets total.
- **`secretManagementLayer.cjs`** validates only 13 hardcoded keys — a small subset of the 60+ connector env vars; most connectors have no rotation/strength auditing.

**Bottom line:** the "57 connectors" figure from project memory roughly matches the phase A–M *count of functions* (62), but essentially all of them are unauthenticated health probes, not working integrations — real "IMPLEMENTED + CREDENTIALS PRESENT" status applies to exactly 3 (Groq, OpenAI, Razorpay).

---

## PART 6 — Memory + Knowledge

| Area | Verdict | Evidence |
|---|---|---|
| Company memory isolation | **PARTIAL / FAKE-MOCK underneath** | `missionMemory.cjs` is fully global (no orgId on schema). Isolation is bolted on one layer up: `organizationService.cjs:817-867` stamps/filters by `metadata.orgId` client-side (loads all, then filters) — works, but is not a scoped store. `memoryPersistenceLayer.cjs` (the actual semantic-memory recall agents use, `recall({agentId,input})`) has **no orgId/companyId concept at all**. `businessDataService.cjs:47-58` explicitly documents opt-in-only scoping: *"every record is visible/writable, regardless of orgId field"* when orgId is omitted. |
| Organization memory isolation (middleware) | **PARTIAL, fragile** | `orgMiddleware.cjs` `attachOrg` reads orgId only from header/query/body, **never `req.params.orgId`** — meaning naive composition on `:orgId`-param routes gives zero protection. Multiple route files (`enterpriseDashboard.js`, `enterpriseMonitoring.js`, `orgAiBrain.js`, `orgAgents.js`, `crossOrgCollaboration.js`) **self-document this exact bug** in code comments and claim to hand-patch it with manual re-checks — verified present, but fragile-by-construction (depends on every future route author remembering the patch). |
| Workspace memory isolation | **FAKE-MOCK / MISSING** | `automationService.cjs` treats `workspaceId` as a free-form unvalidated string key with no ownership/membership check — anyone who knows/guesses a workspaceId can read/write its rules. |
| Agent memory | **MISSING at engine level** | `orgAgents.cjs:6-24` — explicit comment: the shared `agentExecutionEngine`/`runtimeOrchestrator` "neither has an orgId concept... modifying that shared engine's schema to add orgId was rejected." Per-org filtering is a post-hoc array filter over a globally-shared run history. |
| Semantic memory / knowledge graph | **WORKING mechanically, FAKE-MOCK isolation** | `knowledgeGraph.cjs` implements a genuine graph (real BFS traversal, line 290-329; real impact analysis, 365-395) — not a flat list. But it's a single global edge store, capped at 20,000 edges, no org partition in the store. `orgKnowledgeGraph.cjs:167-177` `getOrgImpact()` has a code **comment describing a mitigation that the function body never implements** — it calls `kg.impactAnalysis()` with no filter at all, meaning any org member can retrieve impact analysis for another org's node. |
| Docs/CRM/connector/workflow/AI context joining | **PARTIAL** | Real edges are created (`indexCrm/indexConnectors/indexWorkflows/indexAiContext/indexDocuments`, `orgKnowledgeGraph.cjs:51-128`), but indexing is manual/on-demand (`indexOrg(orgId)`), not automatic on every write — if nobody calls it, the graph is stale/empty for that org. |
| **Cross-company IDOR** | **CONFIRMED, EXPLOITABLE** | `backend/routes/business.js:301-331` — `POST /business/leads/qualify` and `PATCH /business/leads/:phone/stage` call `businessDataService.listLeads({limit:1000})` with **no orgId argument at all** (loads every org's leads globally), then mutate the found record with no org-membership check. Routes only apply `requireAuth` — **any authenticated user from any org can read and modify another org's CRM lead data.** This is real, reachable, unmitigated. |

---

## PART 7 — Autonomous Agent Factory

Tracing the 13-step target pipeline against `companyFactory.cjs`/`companyWorkspaceBuilder.cjs`/`companyLifecycleEngine.cjs`:

| Step | Reality |
|---|---|
| 1. Inspect niche | Real code, but a 10-keyword regex ladder over 10 static templates, defaults to `saas` (`businessTemplateEngine.cjs:172-191`) |
| 2. Determine departments | Static array copied from the matched template (`teamTypes`, line 24) — no derivation |
| 3. Determine agents | Real matching (`skillEngine.findBySkills`) over a static `AGENT_CATALOGUE` — selection logic is real, the underlying "agents" are static rows |
| 4. Select skills | Same real matching, over a static per-catalogue-entry skill list |
| 5. Attach connectors | **No such step exists in the pipeline at all** (confirmed via grep — zero connector references in companyFactory/companyWorkspaceBuilder/companyBlueprintEngine) |
| 6. Assign permissions | **None** — `companyLifecycleEngine.cjs:141` comment: "No parallel company-scoped storage or permission system is created here" |
| 7. Provision company memory | Writes to a single shared `data/company-workspaces.json`, tagged by companyId — not an isolated per-company store |
| 8. Create workflows | A JSON list of step-name strings (`_buildProductionBible`) — never executed by anything |
| 9. Assign KPIs | Static zeroed template values; updated only by manual `PATCH .../kpis` (plain `Object.assign`), no automatic metrics feed |
| 10. Register agents | `workforceManager.runMission({dryRun:true})` — **short-circuits before real registration/execution** (dryRun exits at step 5 of that engine's own internal 10-step flow) |
| 11. Execute agents | **Never invoked** for company creation — `dryRun:true` is hardcoded, so the real AI-provider execution path is skipped entirely |
| 12. Monitor agents | Dashboard reads back the same static JSON written once at creation — no polling/health-check loop |
| 13. Improve/reconfigure | One-way lesson log (`continuousLearningEngine.createLesson`) — nothing reads it back to change agent behavior |

**(A) Composing agents from existing skills:** Works as designed for what it is — real, reachable code that selects among static catalogue entries and writes structured records.
**(B) Creating genuinely new executable skills at runtime:** **Does not exist.** No dynamic code generation + `eval`/`new Function`/generated-file `require()` pipeline was found; the only `eval`/`new Function` hits are (a) lint rules that *flag* eval as a violation, and (b) a frontend-patch syntax-checker unrelated to agent skills.

**Where a human must currently intervene:** creating a real (non-simulated) org requires a real authenticated account; any actual AI-provider execution requires manually configured API keys; KPIs require manual PATCH calls; connectors and RBAC require entirely separate, manual, out-of-band configuration since the factory performs none of it automatically; production deploys require a human to hit an approval endpoint (see Part 8).

---

## PART 8 — Approval / Safety Engine

A real, self-contained subsystem exists: `backend/services/approvalEngine.cjs` + `approvalQueue.cjs` + `backend/routes/approvalRoutes.js` (session lifecycle, evidence, auto-approval policy). But it is only called from a handful of files: `browserPlatform.js`, `codingBundle.js`, `deployment.js`, `codingAssistant.js`, `engineering.js`, `pipeline.js`. **It is not wired into any money-moving, legal, or safety-critical route.**

| Gate | Enforcement at execution layer? | Evidence |
|---|---|---|
| Money transfer / refund | **NO — executes immediately** | `backend/routes/commercial.js:107` (`POST /commercial/credits/refund`) and `backend/routes/revenueOS.js:245` call refund functions directly, no approval-engine reference anywhere in either file |
| Pricing changes | **NO — label only** | `businessTemplateEngine.cjs:56` lists `"pricing_changes"` under a template's `governance.approvalRequired` array, but no pricing route consults this field — it is descriptive metadata |
| Large purchases / contract signing / legal filing / tax filing-payment | **NO enforcement found** | No matching routes reference the approval engine; `revenueOS.js:236` marks invoices paid directly with no gate |
| Production deployment | **YES — real execution-layer gate, but defaults off, and deploy itself is simulated** | `deploymentCoordinator.cjs:425` physically halts the deploy stage if `run.requireApproval && run.approvalStatus !== "approved"`; approved via `POST /deployment/:id/approve` (`deploymentCoordinator.cjs:708-715`). But `requireApproval` **defaults to false** (line 205) unless explicitly requested, and the coordinator's own comment (432-434) states the "deploy" action is simulated via an existing `build_run` capability, not a real shell-out to npm/docker/kubectl |
| Privileged security changes / public publishing / hiring-firing / medical-clinical / live financial trading / blockchain signing-transfers / physical-safety-critical | **NO enforcement found anywhere** | Template `governance` fields exist as labels (e.g. healthcare template lists `"all_releases","data_access_changes"`) but are never consulted by any executing route |

**Bottom line:** exactly **one** verified execution-layer HITL gate exists in the entire codebase (production deploy), and even it is opt-in and gates a simulated action. Every financial/legal/medical/trading/blockchain category in the requested audit list has zero enforcement — approval-engine machinery is real in isolation but architecturally disconnected from the routes that would need it.

---

## PART 9 — 100-Company Niche Coverage

The repo does not contain a pre-existing "100 company template" artifact — only **10 hardcoded business templates** (`businessTemplateEngine.cjs:17-168`: saas, agency, ecommerce, marketplace, healthcare, education, crm, erp, ai_product, internal_tool). A representative 100-company matrix mapped onto these 10 real templates (10 niches each) is provided in `100-COMPANY-COVERAGE-MATRIX.md`, with each row scored against real capability (Parts 1-8), not aspiration.

Aggregate result (detail in the matrix file):
- **READY NOW:** 0 companies (no company can run unattended today — every path terminates in `dryRun:true`, no connectors auto-attached, no RBAC assigned, no approval gate on money movement).
- **READY AFTER CREDENTIALS:** ~10-15 companies whose core need maps to the 3 live connectors (AI + payments) plus generic CRM/content, e.g. simple SaaS/agency/content niches.
- **PARTIAL — SKILLS MISSING:** the majority of niches requiring any of the ~14 missing department families (HR, legal, supply chain, manufacturing, IoT, etc.).
- **REQUIRES SPECIALIZED EXTERNAL INFRASTRUCTURE:** niches needing physical/industrial, blockchain, scientific, or trading capability — none of which exist in any form.
- **NOT CURRENTLY SUPPORTED:** any niche requiring real multi-agent autonomous execution (since execution is short-circuited by `dryRun:true` in the factory) or genuine approval-gated financial operation (since the approval engine doesn't gate money routes).

---

## PART 10 — Scale Reality

- **Storage:** flat JSON files, not a database. `better-sqlite3` is declared in `package.json` and has a real schema module (`backend/db/sqlite.cjs`), but is used by exactly one caller (`agents/taskQueue.cjs:15-49`) as a **passive shadow-write** ("if SQLite fails, runtime continues with JSON authoritative" — comment in that file). JSON remains the actual source of truth everywhere else.
- **No indexing:** every service does full-array `.find`/`.filter` scans over whole-file JSON loaded via `fs.readFileSync`/`writeFileSync` on every call (e.g. `organizationService.cjs`, 34 such calls). `data/company-factory.json` is already 442KB at low real usage.
- **Org isolation at the storage level:** one shared file (`data/organizations.json`) holds *all* orgs in one array — every org's read/write serializes through the same file, with non-atomic `writeFileSync` in most services (only `taskQueue.cjs` uses atomic rename).
- **Scheduler:** real `node-cron` with a same-tier overlap guard (`automationService.js:44-46`), but ticks execute inline on the same event loop/process as the HTTP server — not a job queue with concurrency pools or backpressure.
- **Agents/process model:** `ecosystem.config.cjs:33-35` **hard-pins `instances: 1`**, with an explicit comment: "in-process singletons... are NOT cluster-safe. Never set instances > 1." This is a direct, self-documented ceiling on horizontal scaling.
- **Event bus:** does not exist — zero `EventEmitter`-based pub/sub found anywhere in `backend/`.
- **AI budgets / billing quotas:** genuinely enforced, not cosmetic — `orgBudgets.cjs:96-135` and `billingService.js:36-158` both check real recorded usage before allowing further spend/requests.
- **Load/stress tests found:** `tests/stress/01-http-stress.test.cjs` is a **real** test — genuine concurrent HTTP requests against a running server — but at a concurrency of **20** requests. Other "stress" files (`01-high-pressure-stress.cjs`, `02-large-scale-session.cjs`) are sequential in-process function-call loops of 20-30 iterations, not concurrent load, and not against a live server.
- **No test anywhere simulates 100 concurrent companies/orgs.** The largest verified concurrency in any real test is 20 concurrent HTTP requests or 30 sequential loop iterations.

**Architecturally supported vs. load-test verified — explicit separation:**
- 1 company/org: fully supported and is what the system is built/tested for (`backend/db/sqlite.cjs` comment: "Optimized for local single-operator use").
- 5 concurrent orgs: likely functions, but every write to shared files (`organizations.json`, etc.) risks lost updates since most writes are non-atomic — **not verified by any test**.
- 17 / 35 / 50 / 100 concurrent orgs: **not supported by anything found in code** — single Node process (hard-pinned), whole-file JSON parse/stringify per operation, O(n) scans growing with total data, no worker/process isolation for agents. **"100 companies" and "144/144 regression" are not load-test verified by anything in this repository.**

---

## PART 11 — Frontend Exposure

Sampled 10 components across feature areas (full detail available on request; representative findings):

| Area | Verdict | Evidence |
|---|---|---|
| Company Factory | **Real, live-wired** | `CompanyFactoryCenter.jsx` → `companyFactoryApi.js` → `/company-factory/*` (route confirmed mounted) |
| Connectors/Integrations | **Real, live-wired** | `connectorApi.js` → `/vault/*`, `/integrations/*` |
| Memory/Knowledge | **Real, live-wired** | `MemoryIntelligenceCenter.jsx` → `phase20Api.js` |
| Approval Gates | **Real, live-wired** | `operator/PatchApprovalPanel.jsx` → `backend/routes/approvalRoutes.js` (`/approval`, `requireAuth`) |
| Business dashboard | **Real, live-wired** | `CustomerDashboard.jsx` → `/business/dashboard`, `/orgs/me/context` |
| CRM (Contacts) | **Real, live-wired** | `ContactsV2.jsx`/`WhatsAppSetup.jsx` → `crmApi.js` → `/crm/leads` |
| **CRM (Enterprise CRM)** | **DEAD/FAKE UI** | `EnterpriseCRM.jsx` — `_loadCRM()` reads only `localStorage`, ships hardcoded `SEED_OPPS`/`SEED_TEAM` arrays (lines 28-40), **zero backend fetch** despite presenting as a live CRM pipeline |
| Engineering/DevOps | **Real, live-wired** | `DevOpsCenter.jsx` → `phase25Api` |
| Analytics/System Health | **Real, heavily wired** | `SystemHealthDashboard.jsx` → 7 distinct real API modules |
| Admin/Marketplace | **Real, live-wired** | `AdminDashboard.jsx` → `/commercial/admin/dashboard`, `/marketplace/submissions` |

**Electron:** does not add a second product surface. `electron/main.cjs:196-200` loads either the dev server or the same built `frontend/build`. `electron/src/App.js` is a vestigial 32-line stub, not part of the actual build path. Electron's real value-add is native chrome only (window, tray, splash, crash-recovery pages).

**Overall:** most sampled surfaces are genuinely wired. At least one prominent, customer-facing capability (Enterprise CRM) is a pure client-side mock with zero backend integration — a concrete instance of "looks real, isn't."

---

## PART 12 — Final Reality Scorecard

| Metric | Score |
|---|---|
| Company Factory | **~70%** (creation/lifecycle/org-linkage genuinely work; connector/RBAC/agent-execution steps inside the pipeline do not) |
| Department Composition | **~56%** (18/32 families have real differentiated agent logic; 14/32 have zero code) |
| Agent Archetypes | **~8 WORKING / 60** (plus ~10 partial mission-creation-only, ~41 real-but-unreachable files that could be wired without new development) |
| Executable Skills | **~8 WORKING / ~90** target set |
| Connector Families | **3 WORKING (creds present) / 62 functions defined / 0 for whole categories (CRM/support/accounting/shipping/maps/3D/video/blockchain/trading/scientific/IoT)** |
| Memory/Knowledge | **~35%** (real graph mechanics and real vault exist; isolation is opt-in/fragile, one confirmed cross-tenant IDOR, one documented-but-unimplemented graph leak) |
| Autonomous Agent Composition | **~30%** (selection/matching logic is real; execution is short-circuited by hardcoded `dryRun:true`) |
| New Skill Creation | **0%** (no dynamic skill/code generation pipeline exists) |
| Approval/Safety Enforcement | **~7%** (1 of ~15 requested gate categories has any execution-layer enforcement, and it defaults off) |
| Frontend Exposure | **~80%** of sampled surfaces genuinely wired; known exception (Enterprise CRM) is pure mock |
| Multi-company Readiness | **Architecturally: 1 company verified; 5 plausible-but-unverified; 17-100 not supported by current single-process/flat-file design** |
| 100-company Coverage | **0 READY NOW; a minority READY AFTER CREDENTIALS; majority PARTIAL or NOT SUPPORTED** — see `100-COMPANY-COVERAGE-MATRIX.md` |

### Company readiness counts (see matrix for the full 100-row breakdown)
- **READY NOW:** 0
- **READY AFTER CREDENTIALS:** ~10-15 (simple SaaS/agency/content niches needing only AI + payments + generic CRM)
- **PARTIAL:** ~55-65 (missing one or more department families, connectors, or safety gates)
- **NOT SUPPORTED:** ~20-30 (require missing categories entirely: physical/industrial, blockchain, scientific/deep-tech, regulated-finance-with-real-approval-gates)

---

See also: `100-COMPANY-COVERAGE-MATRIX.md`, `AGENT-SKILL-CONNECTOR-MATRIX.md`, `100-COMPANY-GAP-LIST.md`.
