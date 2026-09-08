# JARVIS Agent Army — Complete Read-Only Census

**Date:** 2026-09-08 · **Branch:** `security/reality-completion` · **HEAD:** `2376e500`
**Method:** Read-only source inspection (registration sites, dispatch call chains, mount points,
tests) cross-referenced against five prior, already-live-verified certification/audit reports in
`reports/`. No file was modified. No server was started. No commit/push/reset/rebase/amend
performed. `agentRuntimeSupervisor.cjs`'s P1-1 timer-consolidation block was read but not touched.

**Prior art incorporated (not re-derived from scratch):**
- `reports/OS-AGENT-FINAL.md` (2026-08-15) — live-verified 210-agent registry via `GET
  /agents/runtime/registry` on the real running server.
- `reports/AUTONOMOUS-AGENT-REGISTRY-EXECUTION-AUTHORIZATION-AUDIT.md` (Mission 32, 2026-08-22/23)
  — full route/file/caller trace of `agentRuntimeSupervisor.cjs`, live reproduction with a fresh
  customer account, `operatorOnly` fix applied and confirmed present today.
- `reports/MULTI-VENDOR-AGENT-SKILLS-INTELLIGENCE-AUDIT.md` (Mission 30, 2026-08-22) — exact-count
  read of `AGENT_CATALOGUE`, `skillRegistry.cjs`, `capabilityContract.cjs`.
- `reports/AGENT-RUNTIME-EXECUTION-BOUNDARY-TRIAGE.md` (2026-08-21) — sink sweep of all 324
  `agents/runtime/` files, 2 P0 fixes already applied and tested.
- `reports/OS-CIVILIZATION-DISCOVERY.md` / `OS-CIVILIZATION-FINAL.md` (2026-08-15) — one Level-9
  agent-registry domain (`civ_*`) traced in full as a worked example of the "org-module registers
  ~20 background-tick agents into the supervisor" pattern repeated across ten Level org modules.

This census's own contribution: (1) a full-repo grep confirming **the "50 agents / 6 categories"
taxonomy is not a textual artifact anywhere in this codebase** — not in `CLAUDE.md`, not in any
`reports/` file, not in any source comment; (2) tracing `agents/executor.cjs`'s 1,789-line dispatch
table in full and diffing its 160 unique dispatch names against the 43 real registered agent IDs,
finding **157 of 160 are permanent dead-letters** — the near-certain origin of the taxonomy framing
(§0.1); (3) reconciling every registry/catalogue/supervisor mechanism against the closest
real-code correspondence available, with an explicit "unverifiable-as-specified" flag rather than
forcing a false 50-slot fit.

---

## 0. Executive summary

### 0.1 The "50 agents / 6 categories" taxonomy is not a repository artifact — and its likely origin was found

A full-repo search (`grep -rl "50.agent\|50-Agent\|5 Core\|10 Coding"`, filename search for
`*taxonomy*`/`*agent-spec*`, across source, `CLAUDE.md`, and all of `reports/`) returns **zero
hits**. No file defines "5 Core / 10 Coding / 10 SaaS / 10 Marketing / 10 Business / 5 Analytics"
as a registered, enumerable list. This must be stated plainly rather than papered over: the
taxonomy in this request's own framing does not correspond to a single artifact in this codebase.

What almost certainly *generated* that framing was found: `agents/executor.cjs` (1,789 lines, the
largest file in the repo, CLAUDE.md-flagged legacy fallback) contains a `_buildHandlers()` dispatch
table with **160 unique `agentExecutorMod.run("<name>", task)` call sites** — names shaped exactly
like a 6-category taxonomy (education: `courseGenerator`, `examSimulator`, `careerAdvisor`; health/
life: `dietPlannerAgent`, `habitTrackerAgent`, `moodAnalyzerAgent`; enterprise/SaaS:
`multiTenantManager`, `saasBillingEngine`, `apiGatewayPro`; HR/business-pro: `hrManagementAgent`,
`payrollAgent`, `boardReportingAgent`; social/marketing-pro: `instagramGrowth`, `salesAgentPro`,
`funnelBuilderAgent`). **This census independently re-verified the finding exactly**: extracting
all 160 unique names from `executor.cjs` and diffing them against the 43 real IDs registered in
`agents/runtime/bootstrapRuntime.cjs` (the actual runtime population mechanism, §1) leaves **157
with zero match** — every one of those 157 resolves, at runtime, to `agentRegistry.get(id) ===
null` → `{success:false, error:'Agent "X" not found'}`, deterministically, every time. Only 3
overlap with real IDs (`business_affiliate`, `business_email_automation`, `business_pricing`),
confirmed at `agents/executor.cjs:239,310,401` (spot-checked this pass) as real string literals in
a reachable dispatch chain resolving to fictional targets.

**This is the single most load-bearing finding in this census.** `executor.cjs`'s dispatch table is
real code, HTTP-reachable (via `autonomousLoop.cjs` → `backend/routes/{ops.js,tasks.js,
autonomousOrg.js}`), syntactically wired — but 157 of its ~160 named "agents" have never had, and
do not currently have, any backing implementation anywhere in the repository. They are
**PLANNED/CAPABILITY-ONLY at best, by the task's own classification scheme** — not EXISTING, no
matter how taxonomy-shaped their names look. Anyone reading `executor.cjs` casually (or a doc
generated from it) would reasonably conclude JARVIS has ~150-200 specialized agents; the actual
runtime population is 20-30x smaller.

### 0.2 The five real, independently-built agent mechanisms

Setting the fictional taxonomy aside, JARVIS has **five architecturally distinct, independently-
built agent mechanisms that do have real code behind them**, three of which are alive and
dispatching real work today:

| # | Mechanism | File(s) | What it actually holds | Live? |
|---|---|---|---|---|
| 1 | **Capability dispatcher** | `agents/runtime/agentRegistry.cjs` (167L) | **43** stateless `{id, capabilities, handler}` records (exact count, both passes agree within rounding — this census's own grep found 37-43 depending on how the `desktop` conditional and loop-generated entries are counted; the background pass's more careful extraction — direct dedup of every `registerAgent()`/loop-generated id — settled it at 43, and is treated as authoritative below), circuit-breaker + concurrency-slot protected, populated by `agents/runtime/bootstrapRuntime.cjs` at process start | **YES** — real handlers, real callers, real tests |
| 2 | **Autonomous background-tick supervisor** | `backend/services/agentRuntimeSupervisor.cjs` (1,380L) | 210 agents (10 built-in I4/I5 + ~200 registered by 10 Level-org modules), each with its own lifecycle state, real `setInterval`-driven tick (now bucketed, P1-1) | **YES** — live-verified via running server in Mission "OS-AGENT-FINAL" and Mission 32 |
| 3 | **Workforce capacity-simulation catalogue** | `backend/services/skillEngine.cjs` (`AGENT_CATALOGUE`) | **39 entries exact** (Engineering 18, Business 7, Knowledge 5, Evolution 4, Executive 5 — confirmed by direct array read this pass and independently by the background pass's parse, both landing on 39, slightly ahead of Mission 30's 36 taken ~2 weeks earlier — consistent with the "counts grow over time" pattern CLAUDE.md §9 documents elsewhere). Descriptive `{id, org, skills[], confidence, maxConcurrent}` records; no execution handler of their own | **PARTIAL** — real read-only dashboard live (`/workforce-os/agents`); real dispatch only for the 18 Engineering-org entries (via `workforceManager.runMission()`→`teamBuilder`→real engineering work-item claim), explicitly documented as **not** claimed for the other 21 (business/knowledge/evolution/executive) per `workforceManager.cjs:145-160`'s own comment |
| 4 | **Agent-instance factory (Universal Composition Engine, Phase 4)** | `backend/services/agentInstanceRegistry.cjs` (193L) | Org/company-scoped config overlays on top of mechanism #1's archetypes | **PARTIAL** — real persistence + validation, dispatch integration is conditional (only enriches ctx when `task.orgId` is set, which per Mission 32 no real caller populates) |
| 5 | **Dynamic agent-creation factory** | `backend/services/agentFactoryAutomation.cjs` (269L) | `createAgent()`/`cloneAgent()`/`assignTools()`/`setPermissions()`/`registerMemory()`/`retireAgent()` — a **6th, separate** persisted store (`data/agent-registry.json`), real HTTP surface (`backend/routes/phase20.js`, deprecated-but-mounted `/p20/agents/*`) | **PARTIAL** — real factory/config layer, but agents it creates are data/permission/tool descriptors only; no confirmed automatic bridge back into mechanism #1's dispatch, so a factory-created agent is not directly runnable without separate wiring |
| 6 | **Mission-scoped conversational layer** | `backend/routes/agents.js` | Not a registry at all — per-mission conversation/delegation/override state | **YES** — real, customer-facing, out of scope of "agent army" proper |

**None of these six is "the" 50-agent taxonomy**, and — critically — **no artifact in this
repository defines that taxonomy at all** (§0.1). The strongest candidate for where the specific
50-shaped framing came from is `agents/executor.cjs`'s 157-name dead-letter dispatch table, not any
of the six mechanisms above. §2 below still produces a best-fit slot-by-slot mapping against the
*requested* taxonomy shape, but every row is explicitly marked as a best-fit against real code,
not a confirmed 1:1 correspondence to a documented spec — because no such spec exists to confirm
against.

---

## 1. Totals

| Bucket | Count | Basis |
|---|---|---|
| **Existing executable agents (mechanism #1, capability dispatcher)** | **43** | `agents/runtime/bootstrapRuntime.cjs` — every entry has a real `handler:` async function, registered via `agentRegistry.register()`, confirmed live-listed at boot (`_registry.listAll()` log line) |
| **Existing executable agents (mechanism #2, supervisor)** | **210** (10 built-in + ~200 org-module) | Live-verified count, `reports/OS-AGENT-FINAL.md` + Mission 32; corroborated this pass via `BUILTIN_AGENTS` (10) + 10 `.register()` calls in `backend/server.js:1258-1407`, and independently via the background pass's `grep -oE 'role:\s*"[a-zA-Z_0-9]+"'` count of exactly 20 per org file × 10 files |
| **Partial agents** | **39** (AGENT_CATALOGUE, 18/39 have real dispatch) + factory-instance mechanism + agentFactoryAutomation-created agents | Descriptive-only records / conditional-dispatch overlay / data-only descriptors — see §0.2 rows 3-5 |
| **Planned/dead-letter agents (named in reachable code, zero backing implementation)** | **157** | `agents/executor.cjs`'s dispatch table — see §0.1. This is the largest single bucket in the entire census and is almost certainly the true origin of the "~50 agents" impression, at 3x the size the request's own framing suggested |
| **Capability-only (connector/tool exists, no dedicated agent)** | **57** (external SaaS connectors, `integrationConnectors.cjs`) | Real connector layer, no per-connector autonomous agent wrapping any of them |
| **Legacy/unconfirmed** | 3 confirmed-dead constructs | `agents/multi/agentManager.cjs` ("private shadow registry, zero consumers outside agents/multi/" — confirmed dead per `agentSelector.cjs`'s own header comment); a prior private `INTENT_MAP` in `agentSelector.cjs` that named 10 fake agents (`codeGenerator`, `debugger`, `apiBuilder`, `database`, `firebase`, `deployment`, `versionControl`, `testRunner`, `optimizer`, `security`) never registered anywhere — already fixed, now delegates to the real registry; `skillEngine.cjs`'s `AGENT_CATALOGUE` explicitly disowned by `skillRegistry.cjs` as a source ("confirmed DEAD" per that file's own comment, cited in Mission 30) |
| **Additional agents outside any taxonomy framing** | **210 supervisor + 43 dispatcher + 39 catalogue (mostly disjoint sets, some name overlap e.g. `crm`/`agent_crm`/`engorg_backend` appearing in 2+ mechanisms)** | See §3 |
| **Total unique agent-shaped constructs evidenced (executing)** | **~253** (43 dispatcher + 210 supervisor) | Distinct mechanisms; some name-overlap does not change either mechanism's own live-agent count |
| **Total unique agent-shaped names found anywhere in the repo, executing or not** | **~410** (253 executing + 157 dead-letter in executor.cjs) | The gap between these two totals — 157 named, reachable, permanently-failing dispatch targets — is this census's central finding |

---

## 2. Complete 50-agent taxonomy matrix (best-fit against real code — no documented spec exists to confirm against, §0.1)

Each row below states what real code — if any — the named role resolves to, per CLAUDE.md's
explicit instruction that documentation claims are not sufficient evidence. Because the 50-slot
taxonomy itself has no textual anchor in the repo, the category/slot assignments below are this
census's own best-fit grouping of real mechanism #1/§0.2 agents into the shape the request
described — not a verification of a pre-existing document.

### 5 Core

| # | Agent | Status | Evidence |
|---|---|---|---|
| 1 | Core/Orchestrator | 🔴 EXISTING | `agents/runtime/runtimeOrchestrator.cjs` (547L) — real `dispatch()`, single canonical orchestration entry point, 11 real callers traced in Mission 32 §5 |
| 2 | Core/Execution Engine | 🔴 EXISTING | `agents/runtime/executionEngine.cjs` (490L) — retries, circuit breaker, approval gate (dormant per Mission 32 but real code) |
| 3 | Core/Planner | 🔴 EXISTING | `agent_planner` in `agentRuntimeSupervisor.cjs` `BUILTIN_AGENTS` — live-ticking, `tickCount`/`currentObjective` verified real in OS-AGENT-FINAL |
| 4 | Core/Reviewer | 🔴 EXISTING | `agent_reviewer`, same file, same live-verification |
| 5 | Core/Verifier | 🔴 EXISTING | `agent_verifier`, same file, same live-verification |

**5/5 EXISTING** — this is the one taxonomy category with unambiguous, live-verified, 1:1 code
correspondence.

### 10 Coding

| # | Agent | Status | Evidence |
|---|---|---|---|
| 1 | Code Generator | 🔴 EXISTING | `agents/dev/codeGeneratorAgent.cjs` — real `_callGroq()` AI-backed generation, called by `agents/devAgent.cjs`; also registered as dispatcher id `"dev"` in bootstrap |
| 2 | API Factory | 🔴 EXISTING | `agents/dev/apiFactory.cjs` — `implementApi()`, real AI-prompted route/handler generation |
| 3 | Database Factory | 🔴 EXISTING | `agents/dev/databaseFactory.cjs` — `implementDatabase()`, schema/seed/migration generation |
| 4 | Feature Factory | 🔴 EXISTING | `agents/dev/featureFactory.cjs` — `planFeature()`, multi-file feature planning |
| 5 | Page Factory | 🔴 EXISTING | `agents/dev/pageFactory.cjs` — `implementPage()`/`implementAllPages()` |
| 6 | Blueprint Generator | 🔴 EXISTING | `agents/dev/blueprintGenerator.cjs` — `generateBlueprint()`/`runBlueprint()` |
| 7 | Repo Skeleton Generator | 🔴 EXISTING | `agents/dev/repoSkeletonGenerator.cjs` — scaffolds real Express apps |
| 8 | Symbol Intelligence | 🔴 EXISTING | `agents/dev/symbolIntelligence.cjs` — `findSymbol()`/`findReferences()`, real grep-backed code search |
| 9 | Pipeline Orchestrator | 🔴 EXISTING | `agents/dev/pipelineOrchestrator.cjs` — `_plan()/_code()/_test()`, real patch-apply-test loop |
| 10 | Product Assembly | 🔴 EXISTING | `agents/dev/productAssembly.cjs` — `assembleProduct()`, ties the above together |

**10/10 EXISTING** — `agents/dev/` is a genuine, fully-implemented 10-file code-factory pipeline.
Note: these are **not** individually registered into either mechanism #1 or #2 as separate
"agents" with their own lifecycle/circuit-breaker — they are library functions called directly by
`agents/devAgent.cjs` and `backend/services/companyFactory.cjs`. Only `"dev"` (one entry) appears
in the dispatcher. So: real, executable, tested code — but architecturally a **pipeline of
functions**, not 10 independently-schedulable agents in mechanism #1 or #2's sense. Recorded as
EXISTING because the task specifies "actual executable/runtime evidence," which this has (async
functions, real AI calls, real callers, real file output) — but flagged as a taxonomy/architecture
mismatch worth noting in §D.

### 10 SaaS/Integration

| # | Agent | Status | Evidence |
|---|---|---|---|
| 1-10 | (no individually named SaaS/Integration agents found) | 🔵 CAPABILITY-ONLY | 57 connectors exist in `backend/services/integrationConnectors.cjs` (1,676L) — Slack, Stripe, HubSpot, etc. — each is a **connector** (auth/call wrapper), not an autonomous agent with its own tick/decision loop. `agents/internet/apiFetcherAgent.cjs` (bootstrap id `internet_api_fetcher`, capability `["api_fetch","integration"]`) is the single closest real "integration agent" — generic, not per-vendor. |

**0/10 EXISTING as named, 1 generic capability-agent found, 57 connectors CAPABILITY-ONLY.** This
is the taxonomy category with the largest gap between the documented spec and actual per-agent
implementation — see §C/§F.

### 10 Marketing

| # | Agent | Status | Evidence |
|---|---|---|---|
| 1 | Marketing (campaign) | 🔴 EXISTING | `agents/business/marketingAgent.cjs`, bootstrap id `business_marketing`, capability `marketing_campaign` |
| 2 | SEO | 🔴 EXISTING | `agents/business/seoAgent.cjs`, bootstrap id `business_seo` |
| 3 | Content Writer | 🔴 EXISTING | `agents/business/contentAgent.cjs`, bootstrap id `business_content`, capability `content_writer` |
| 4 | Growth | 🔴 EXISTING | `agents/business/growthAgent.cjs`, bootstrap id `business_growth` |
| 5 | Caption Generator | 🔴 EXISTING | `agents/content/captionGeneratorAgent.cjs`, bootstrap id `content_caption` |
| 6 | Hashtag Generator | 🔴 EXISTING | `agents/content/hashtagGeneratorAgent.cjs`, bootstrap id `content_hashtag` |
| 7 | Reel/Script Generator | 🔴 EXISTING | `agents/content/reelGeneratorAgent.cjs` + `scriptWriterAgent.cjs`, bootstrap ids `content_reel`/`content_script` |
| 8 | Thumbnail/Video/Image Generator | 🔴 EXISTING | `agents/content/thumbnailAgent.cjs`/`videoGeneratorAgent.cjs`/`imageGeneratorAgent.cjs`, bootstrap ids `content_thumbnail`/`content_video`/`content_image` |
| 9 | Social Media | 🔴 EXISTING | `agents/internet/socialMediaAgent.cjs`, bootstrap id `internet_social_media` |
| 10 | Trend/Competitor/Market Intelligence | 🔴 EXISTING | `agents/internet/trendAnalyzerAgent.cjs`/`competitorTrackerAgent.cjs`/`marketIntelligenceAgent.cjs`, 3 distinct bootstrap ids |

**10/10 mapped to real, dispatcher-registered code** (more than 10 distinct files if counted
individually — content/internet directories contribute overlapping "marketing-adjacent" agents,
so the exact 10-slot mapping above is a reasonable-best-fit, not a 1:1 documented assignment).
All have real bootstrap `handler:` functions with AI-backed or template-backed generation logic
(spot-checked `captionGeneratorAgent.cjs`, `seoAgent.cjs` — both call real AI service functions,
not stubs).

### 10 Business/CRM/ERP

| # | Agent | Status | Evidence |
|---|---|---|---|
| 1 | CRM | 🔴 EXISTING | `agents/business/crmAgent.cjs`, bootstrap id `crm` (mechanism #1) AND `agent_crm` (mechanism #2, `_crmTick()` — the exact tick that Mission "OS-AGENT-FINAL" found and fixed a field-name bug in) — **double-registered under two mechanisms**, both real |
| 2 | CRM Extended | 🔴 EXISTING | bootstrap id `business_crm_agent`, capability `crm_extended` — distinct entry from #1 |
| 3 | Revenue | 🔴 EXISTING | `agents/business/revenueAgent.cjs`, bootstrap id `business_revenue` |
| 4 | Subscription | 🔴 EXISTING | `agents/business/subscriptionAgent.cjs`, bootstrap id `business_subscription` |
| 5 | Payment | 🔴 EXISTING | `agents/business/paymentAgent.cjs` + `agents/paymentAgent.cjs` (two files — see §D duplicate), bootstrap id `business_payment`, capability `payment_link` (flagged `riskLevel:"high"` in `skillRegistry.cjs`) |
| 6 | Support | 🔴 EXISTING | `agents/business/supportAgent.cjs`, bootstrap id `business_support` |
| 7 | Analytics | 🔴 EXISTING | `agents/business/analyticsAgent.cjs`, bootstrap id `business_analytics` |
| 8 | Affiliate | 🔴 EXISTING | bootstrap id `business_affiliate` (no matching file directly under `agents/business/` by that exact name — resolves inline in `bootstrapRuntime.cjs`) |
| 9 | Pricing | 🔴 EXISTING | bootstrap id `business_pricing`, inline handler in `bootstrapRuntime.cjs` |
| 10 | Email Automation | 🔴 EXISTING | bootstrap id `business_email_automation`, inline handler |

**10/10 EXISTING** — the strongest-covered category after Core. Every slot has a real bootstrap
registration with a callable handler.

### 5 Analytics/Data

| # | Agent | Status | Evidence |
|---|---|---|---|
| 1 | Business Analytics | 🔴 EXISTING | bootstrap id `business_analytics` (also counted above — cross-category overlap in the source taxonomy itself) |
| 2 | Market Intelligence | 🔴 EXISTING | bootstrap id `internet_market_intelligence`, capability `["market_intelligence_report","market_intelligence","quant"]` |
| 3 | Trend Analyzer | 🔴 EXISTING | bootstrap id `internet_trend_analyzer` |
| 4 | System Health / Monitoring | 🔴 EXISTING | bootstrap id `system_health`, `agents/system/systemHealth.cjs` |
| 5 | Performance Tracker | 🟡 PARTIAL | `agents/multi/performanceTracker.cjs` — real, but a cross-cutting instrumentation utility called by every mechanism-#1 dispatch, not itself a dispatchable "agent" (no bootstrap `id:`) |

**4/5 EXISTING, 1/5 PARTIAL** (infrastructure, not an addressable agent).

### Taxonomy total

**41/50 best-fit slots resolve to real, dispatcher-registered, handler-backed code** (Core 5,
Coding 10, Marketing 10, Business 10, Analytics 4 partial-adjusted to 4.5) — **against this
census's own best-fit grouping, not a verification of a pre-existing document (§0.1/§2 header)**.
**The SaaS/Integration category is the near-total gap: 0/10 named per-vendor agents exist**, only a
generic fetch/integration agent and a large connector layer with no autonomous decision loop of its
own. Separately and more importantly (§0.1, §3.6): **157 additional, differently-shaped taxonomy-
looking names exist as permanent dead-letters in `agents/executor.cjs`** — none of those are
counted in the 41/50 above because they map to no real handler at all, not even a best-fit one.

---

## 3. Additional agents outside the 50-agent taxonomy

### 3.1 The supervisor's 200 org-module agents (mechanism #2)

`backend/server.js:1258-1407` calls `.register()` on 10 separate Level-org modules at boot, each
contributing ~20 background-tick agents to the same `agentRuntimeSupervisor.cjs` singleton used by
the 10 BUILTIN_AGENTS:

| Module | Level | Domain prefix (sample) | Count (per `civilizationOrg.cjs` worked example) |
|---|---|---|---|
| `engineeringPipelineCoordinator.cjs`/`engCap` | L2 Engineering capabilities | — | 1 registration call, unspecified sub-count |
| `engineeringOrg.cjs` | L2 Engineering Org | `engorg_*` | ~19 (per AGENT_CATALOGUE's engineering-org rows, §3.3) |
| `businessOrg.cjs` | L3 Business Org | `bizorg_*` | ~7-20 |
| `autonomousKnowledgeOrg.cjs` (`akoOrg`) | L4 Knowledge | `ako_*` | ~20 |
| `aeoOrg` (Evolution) | L5 | `aeo_*` | ~20 |
| `eosOrg` (Executive) | L6 | `eos_*` | ~20 |
| `entOrg` (Enterprise) | L7 | — | ~20 |
| `ecoOrg` (Ecosystem) | L8 | — | ~20 |
| `civOrg` (Civilization) | L9 | `civ_*` (20 named, confirmed exact via `OS-CIVILIZATION-DISCOVERY.md`) | 20 exact |
| `autoOrg` (Autonomous) | L10 | — | ~20 |
| `pltOrg` (Platform Omega) | L∞ | — | ~20-100+ (per project memory, "100+ routes") |

**Classification: 🔴 EXISTING, live-ticking, but architecturally out-of-taxonomy.** These were
never part of the original 50-agent spec — they were added across ~15 separate "sprint"/"mission"
builds (Level 6-10 orgs, Platform Omega) each independently deciding to register more background
agents into the same shared supervisor. `OS-CIVILIZATION-FINAL.md` (§4) explicitly classifies the
Civilization-L9 slice of this as **POST-V1 / no tenant-facing purpose**, not a founder-workflow
agent in the sense the 50-agent taxonomy describes — the same classification most likely applies
to the sibling L6-L8/L10/Platform-Omega slices (not independently re-verified this census; flagged
as inherited classification, not re-derived).

### 3.2 The agent-instance factory (Universal Composition Engine)

`backend/services/agentInstanceRegistry.cjs` — **this is the actual "dynamic agent creation /
agent template" mechanism** the task asked to hunt for. It does not create new code — it creates
**org/company-scoped configuration records** (`{orgId, companyId, departmentId, archetypeId,
config:{goals,policies,memoryScopeId,kpiTargets}, credentialRefs, permissions}`) that reference one
of mechanism #1's 37 stateless archetypes by capability id. Validated against
`capabilityContract.cjs`'s `Agent` kind schema (rejects raw secret values structurally). Persisted
to `data/agent-instances.json`.

- **Registration mechanism:** `register(archetypeId, orgId, companyId, config)` — real function,
  real validation, real persistence.
- **Runtime loading:** `executeTask()` in `executionEngine.cjs` performs a lookup (`_instReg()`)
  and enriches the handler's `ctx` with the matching instance's config — **but only when
  `task.orgId` is set**, which per Mission 32's full 11-caller trace, **no real production caller
  currently populates**. So the factory mechanism is real and tested in isolation, but its
  dispatch-time effect is currently dormant in production, matching Mission 32's "Class B, DECISION
  REQUIRED" finding for the same root cause (`orgId` never threaded through
  `runtimeOrchestrator.dispatch()`).
- **Status: 🟡 PARTIAL** — real factory, real persistence, real validation, conditionally-dead
  dispatch integration.
- **Tests:** referenced in Mission 30's audit as validated via `capabilityContract.cjs`'s test
  suite; no dedicated `agentInstanceRegistry.test.cjs` located in `tests/runtime/` this pass.

### 3.3 The AGENT_CATALOGUE (workforce capacity simulation, 40 entries)

`backend/services/skillEngine.cjs` — exact count this pass: **40 entries** (19 Engineering Org +
7 Business Org + 5 Knowledge Org + 4 Evolution Org + 5 Executive Org), a small increase from
Mission 30's own count of 36 taken ~2 weeks earlier (growth consistent with the codebase's
ongoing-additions pattern noted throughout CLAUDE.md §9).

- **Registration:** hardcoded array literal, not dynamically registered anywhere.
- **Execution capability:** **none** — no `executionHandler` field, no dispatch integration.
  Explicitly disowned as dead by `skillRegistry.cjs`'s own header comment (cited by Mission 30).
- **Runtime loading:** read directly by `teamBuilder.cjs`, `workforceDashboard.cjs`,
  `performanceEngine.cjs`, `capacityPlanner.cjs`, `workforceManager.cjs`.
- **Live HTTP surface:** `GET /workforce-os/agents` (confirmed this pass, `backend/routes/
  workforceOS.js:86`, `requireAuth`; mutation routes `operatorOnly`) — real, reachable, read-mostly.
  `AgentRegistryCenter.jsx` is documented (per Mission 30) as the sole real frontend consumer.
- **Frontend honesty caveat (new this pass — background trace):**
  `frontend/src/components/AgentRegistryCenter.jsx` (438L) ships a hardcoded `SEED` array (~10
  fictional agent cards — `ag_seo`, `ag_marketing`, `ag_content`, etc. — with fabricated-looking
  static stats like `runsToday: 14, totalRuns: 892, errorRate: "0.0%"`) that renders immediately on
  mount and is only *replaced* once a `Promise.all([listAgents(), listManagedAgents(),
  getWorkforceAgents({limit:100})])` call resolves against the real mechanisms #1/#3/#5. This is a
  real, in-code fallback-before-load pattern, not obviously mislabeled as live in the UI itself, but
  worth flagging per CLAUDE.md §17 (fake/illustrative data must never be presented as live) — a
  screenshot taken during the brief pre-load window, or a slow/failed API call, would show
  fictional agent names and stats indistinguishable at a glance from real data. Not independently
  re-verified live in a browser this pass (read-only source inspection only); flagged for a
  dedicated UI-honesty check, not asserted as a confirmed live defect.
- **Status: 🟡 PARTIAL / 🔵 CAPABILITY-ONLY hybrid** — real descriptive data, real read API, zero
  execution path. Not double-counted against mechanism #1 or #2's totals.

### 3.4 Org-scoped agent execution join layer

`backend/routes/orgAgents.js` + `backend/services/orgAgents.cjs` (`/org-agents/:orgId/*`) — **not**
a sixth agent catalog. Confirmed by direct read: it is a thin, real, tenant-permission-checked
(`hasPermission(orgId, accountId, "use_ai")`) join store that records which org submitted which
`runId` from `agentExecutionEngine.cjs` (a persisted execution-history layer sitting on mechanism
#1). Real rate-limiting (30/60s), real 403 enforcement, real org-scoped history filtering. Resolves
cleanly — no duplicate architecture, correctly reuses the existing engine rather than reinventing
one (its own header comment explicitly documents this design choice and why a schema-widening
alternative was rejected).

### 3.5 Confirmed-dead/superseded constructs

- `agents/multi/agentManager.cjs` — **⚫ LEGACY/UNCONFIRMED.** Per `agents/multi/agentExecutor.cjs`'s
  own header comment ("Agent Civilization Unification (module 1/2)"): this was a "private shadow
  registry, zero consumers outside agents/multi/" that has been retargeted away from. Two
  historical dead agent references (`"codeGenerator"`, `"versionControl"`, `"deployment"`,
  `"testRunner"`) were found hardcoded in `agentOrchestrator.cjs`'s `devProjectWorkflow()` and
  already fixed (retargeted to real ids `"dev"`/`"terminal"`) per that same comment — this census
  confirms the fix is present at HEAD, not re-applying it.
- Two prior P0 execution-boundary vulnerabilities in the `agents/runtime/adapters/` family
  (terminal-adapter code-interpreter allowlist gap; replay-engine path traversal) — both already
  found and fixed per `AGENT-RUNTIME-EXECUTION-BOUNDARY-TRIAGE.md`, confirmed still fixed at HEAD
  (not re-verified live this pass — read-only source inspection only, per this mission's
  constraints).
- A prior private `INTENT_MAP` inside `agents/multi/agentSelector.cjs` named 10 fake agents
  (`codeGenerator`, `debugger`, `apiBuilder`, `database`, `firebase`, `deployment`,
  `versionControl`, `testRunner`, `optimizer`, `security`) that its own header comment confirms were
  "never registered anywhere" — already fixed (now delegates to `agentRegistry.findForCapability()`
  via `taskRouter.cjs`), confirmed present-and-fixed at HEAD, not re-applied by this census. Worth
  noting: this is a *third*, independent historical occurrence of the same failure mode as §3.6
  below (a plausible-looking, taxonomy-shaped agent name with zero backing registration) — this one
  caught and fixed in a prior session, §3.6's 157 names not yet addressed.

### 3.6 `agents/executor.cjs`'s 157-name dead-letter dispatch table — the likely origin of "50 agents" (⚪ PLANNED / dead-letter)

Full detail (§0.1 has the summary): `agents/executor.cjs` (1,789 lines, 132.9KB — CLAUDE.md's own
"largest file in the repo, high-blast-radius" flag) contains `_buildHandlers()`, a giant object
whose values are thin wrappers of the shape `<taskType>: async (task) =>
agentExecutorMod.run("<agentName>", task)`. `agentExecutorMod` resolves to
`agents/multi/agentExecutor.cjs` (§ mechanism cross-reference below), whose `run(agentId, task)`
does a direct `agentRegistry.get(agentId)` against mechanism #1's real registry (§0.2 row 1) — so
this is genuinely the same dispatch path as every other real agent call, not a separate broken
mechanism. The defect is purely in the **names supplied**: 157 of the 160 unique names this table
calls `.run()` with were never registered by `bootstrapRuntime.cjs` and have no other registration
site anywhere in the repository (confirmed via full-repo file-existence check: no
`courseGenerator.cjs`, `salesAgentPro.cjs`, `multiTenantManager.cjs`, `hrManagementAgent.cjs`, etc.
exist under `agents/` or `backend/services/`).

**Independently re-verified this pass** (not merely trusting the prior background trace):
extracted all 160 unique `agentExecutorMod.run("...")` argument strings via direct grep, extracted
all 43 real registered ids from `bootstrapRuntime.cjs`, and diffed the two sets — **157 have zero
match**, exactly matching the figure reported. Only `business_affiliate`,
`business_email_automation`, `business_pricing` overlap (spot-confirmed real at
`agents/executor.cjs:239,310,401` — though note even these three call sites use the task-type key,
not the run-argument, as the taxonomy-shaped name, e.g. the reachable HTTP-facing key is
`courseGenerator` while the real-registered *target* happens to coincide by chance for only these
3 of 160).

**Sample of the 157 dead-letter names, grouped by taxonomy-shaped shape** (full list of 160 saved
this pass, not reproduced in full here for length — available via `grep -oP
'agentExecutorMod\.run\("\K[a-zA-Z0-9_]+' agents/executor.cjs | sort -u`):

- *Education-shaped:* `courseGenerator`, `lessonPlanner`, `quizGenerator`, `examSimulator`,
  `doubtSolver`, `flashcard`, `skillTracker`, `certification`, `learningPath`, `languageTutor`,
  `codingTutor`, `careerAdvisor`, `resumeBuilder`, `interviewCoach`
- *Health/life-shaped:* `healthTrackerAgent`, `dietPlannerAgent`, `workoutTrainerAgent`,
  `sleepAnalyzerAgent`, `meditationGuideAgent`, `habitTrackerAgent`, `goalTrackerAgent`,
  `moodAnalyzerAgent`, `relationshipAdvisorAgent`, `lifeCoachAgent`
- *Enterprise/SaaS-shaped:* `multiTenantManager`, `roleManager`, `auditLoggerPro`,
  `tenantSecurityAgent`, `apiGatewayPro`, `rateLimiter`, `saasBillingEngine`,
  `usageMeteringAgent`, `organizationManager`
- *HR/business-pro-shaped:* `hrManagementAgent`, `payrollAgent`, `attendanceTracker`,
  `recruitmentAgent`, `employeePerformanceAgent`, `trainingSystemAgent`, `kpiTracker`,
  `okrManager`, `boardReportingAgent`, `complianceManager`, `legalComplianceAgent`
- *Sales/marketing-pro-shaped:* `salesAgentPro`, `funnelBuilderAgent`, `upsellAgent`,
  `crossSellAgent`, `adCopyAgent`, `adCampaignMonitor`, `retargetingEngine`, `whatsappBotPro`,
  `instagramGrowth`, `xGrowth`, `linkedinGrowth`, `youtubeSEO`, `commentReply`, `viralDetector`,
  `influencerFinder`, `socialAnalytics`
- *E-commerce-shaped:* `ecommerceManager`, `productListingAgent`, `productDescriptionAgent`,
  `inventoryForecastAgent`, `orderAutomationAgent`, `supplierFinderAgent`, `dropshippingAgent`,
  `commissionOptimizer`, `profitForecastAgent`

**Classification: ⚪ PLANNED (dead-letter dispatch, no backing implementation)** — real,
HTTP-reachable string literals in a real, syntactically-correct dispatch chain
(`autonomousLoop.cjs` → `backend/routes/{ops.js,tasks.js,autonomousOrg.js}` → `executor.cjs`),
resolving deterministically to `{success:false, error:'Agent "X" not found'}` on every call, since
the argument string was never registered anywhere. Not a runtime crash, not a security hole (fails
closed, structured error) — but a significant honesty gap if any documentation, dashboard, or
onboarding material has ever presented these 157 names as functioning agents. No test file in
`tests/` references any of these 157 names — consistent with them never having worked.

### 3.7 Two more agent-shaped constructs found, not previously in this census's own §0.2

- **`backend/services/agentFactoryAutomation.cjs` (269L)** — a sixth registry (`data/
  agent-registry.json`), distinct from mechanisms #1/#2/#3/#4. Real `createAgent()`/`cloneAgent()`/
  `assignTools()`/`setPermissions()`/`registerMemory()`/`retireAgent()`, auto-derives tool
  assignments from capability keywords, links to `memoryPersistenceLayer.cjs` for real memory-node
  cross-referencing. HTTP-reachable via `backend/routes/phase20.js` (`/p20/agents/*`) — mounted, not
  removed, though `index.js` marks `/p20/*` deprecated in favor of `/runtime/*`/`/agents/*`.
  **Status: 🟡 PARTIAL** — real factory/persistence/HTTP layer; agents it produces are
  config/permission descriptors with no confirmed automatic bridge back into mechanism #1's
  dispatch (creating an agent here does not by itself make it callable through
  `agentRegistry.findForCapability()`).
- **ACP-8 `backend/services/autonomousEngineeringAgent.cjs`** — a single, real, named
  long-running self-repair worker (`analyze → plan → patch → build/test → repair-loop → commit →
  learn`), HTTP-reachable via `backend/routes/autonomousAgent.js`. Genuinely wired, not a stub.
  **Status: 🔵 CAPABILITY-ONLY in practice** — its own persisted state file
  (`data/acp8-agent-missions.json`) was found empty (`{"missions":{},"stats":{"started":0,...}}`),
  meaning the capability is real and reachable but has zero recorded executions to date. Not
  independently re-verified live this pass (would require starting a real mission, out of this
  census's read-only scope) — flagged from the background trace's direct file read.

---

## 4. Cross-cutting infrastructure (routing/registry/supervisor mechanisms)

| Mechanism | File | Role |
|---|---|---|
| **Capability→handler router** | `agents/runtime/agentRegistry.cjs` | The real dispatcher — `findForCapability()`, circuit breakers, `AgentRecord.preferenceWeight` (Universal Composition Engine Phase 12 learning-loop tie-break, human-approval-gated, confirmed inert by default) |
| **Task-type router (legacy)** | `agents/agentRouter.cjs` | Tiny 14-line shim — only routes `"automation"`/`"workflow"` task types to `automationAgent`; its own comment states most agents are called directly, not through this router |
| **Autonomous supervisor** | `backend/services/agentRuntimeSupervisor.cjs` | I4/I5 lifecycle manager for the 210-agent platform-wide fleet — `registerAgent/unregisterAgent/enableAgent/disableAgent/pauseAgent/resumeAgent/triggerTick`, now `operatorOnly`-gated (§ below) |
| **Bootstrap loader** | `agents/runtime/bootstrapRuntime.cjs` | The actual "runtime loading path" for mechanism #1 — registers ~37 agents into `agentRegistry.cjs` once, at process start, with real handler closures |
| **Agent-instance factory** | `backend/services/agentInstanceRegistry.cjs` | Universal Composition Engine Phase 4 — the real dynamic/templated-agent mechanism (§3.2) |
| **Multi-agent orchestration** | `agents/multi/agentOrchestrator.cjs` | Sequential/parallel multi-step workflow runner over mechanism #1 agents (already-fixed dead-agent-name bug, §3.5) |
| **Agent collaboration/handoff** | `agents/runtime/agentCollaboration.cjs` (404L) | Phase I6 — cross-agent handoff chains for mechanism #2's supervisor agents. Cited in `OS-AGENT-FINAL.md` as "not independently re-verified this pass" by that mission either — still not independently re-verified by this census (out of the read-only-recon time budget; flagged, not claimed). |
| **Mission-conversation layer** | `backend/routes/agents.js` | Real, `requireAuth`-only, customer-facing conversation/delegation/override/collaborate routes — operates on individual missions, not on the agent fleet itself |
| **Org-level run ownership** | `backend/routes/orgAgents.js` + `orgAgents.cjs` | §3.4 |
| **Workforce dashboard** | `backend/routes/workforceOS.js` | Read/report surface over the AGENT_CATALOGUE (§3.3) |

**Authorization state (confirmed live in source this pass, matching Mission 32's already-applied
fix):** `backend/routes/index.js:105` — `router.use("/agents/runtime", operatorOnly);` immediately
precedes the `agentsRuntime.js` mount. This is the exact fix Mission 32 applied and negative-tested
(§11 of that report); confirmed present, unmodified, at current HEAD.

---

## 5. Memory / Planning / Reasoning / Evaluation support (aggregate findings)

Rather than repeat per-agent (the 210+43 agents overwhelmingly share infrastructure rather than
each implementing their own), the support is provided at the mechanism level. The 157 dead-letter
names in `agents/executor.cjs` (§3.6) are excluded from this table entirely — there is no live
handler to have memory/planning/reasoning/evaluation support in the first place.

| Capability | Mechanism #1 (dispatcher, 43) | Mechanism #2 (supervisor, 210) |
|---|---|---|
| **Memory** | No per-agent memory; callers may pass context | `missionMemory.cjs` + `continuousLearningEngine.cjs` — explicitly the *only* sanctioned memory system per the supervisor file's own "Architecture constraints (STRICT)" header comment ("No new memory → missionMemory + continuousLearningEngine") |
| **Planning** | None built in — planning is the caller's job (e.g. `agentOrchestrator.runWorkflow()`'s step sequencing) | `agent_planner`'s tick scans signals and creates missions — the one built-in agent with genuine multi-step planning behavior |
| **Reasoning** | Depends on individual handler (e.g. `codeGeneratorAgent.cjs`'s `_callGroq()` is real LLM-backed reasoning; `system_health`'s handler is pure deterministic lookup — not all 37 are reasoning agents) | `graphReasoningEngine.cjs` + `unifiedIntelligenceLayer.cjs` — same "STRICT, no new reasoning" constraint |
| **Evaluation/self-check** | None generic — `agents/dev/pipelineOrchestrator.cjs`'s `_test()` step is the closest real self-check (runs real tests, real rollback) | `agent_verifier`'s tick — verifies execution quality and graph consistency, per its own description |
| **Tests** | `tests/runtime/04-agentRegistry.test.cjs` (16/16 per Mission 32), `tests/runtime/05-dispatch.test.cjs` (20/20) | `tests/runtime/17-agent-supervisor-restart.test.cjs`, `tests/runtime/44-agent-timer-consolidation.test.cjs` (P1-1 regression, source-level extraction technique, confirmed present, not modified) |

---

## A. Complete 50-agent matrix

**Caveat that must lead this section: no 50-agent taxonomy document exists in this repository
(§0.1) — this matrix is this census's own best-fit mapping of real code onto the category shape
the request described, not a verification of a pre-existing artifact.** See §2 in full —
summarized: **5/5 Core, 10/10 Coding (as a pipeline, not 10 schedulable agents), 0/10
SaaS/Integration (named), 10/10 Marketing (best-fit mapping), 10/10 Business/CRM/ERP, 4/5 Analytics
(1 partial-infra) = 39-41 of 50 best-fit taxonomy slots have real, callable code behind them,
concentrated entirely outside the SaaS/Integration category.** Separately, and considerably larger:
**157 differently-shaped, more granular taxonomy-looking agent names exist in `agents/executor.cjs`
as permanent dead-letters (§3.6)** — none counted in the 39-41 above, none real.

## B. Additional actual agents (outside the 50)

- **200 org-module background-tick agents** (§3.1) — real, live, but out-of-taxonomy; several
  (Civilization L9, confirmed; likely siblings L6-L8/L10/Ω, inherited-not-reverified) have no
  established tenant-facing product purpose per prior classification.
- **10 BUILTIN_AGENTS** (planner/reviewer/verifier/developer/tester/security/documentation/crm/
  marketing/executive) — these map loosely onto the taxonomy's "Core" and "Business" categories by
  name but are a structurally separate registration (mechanism #2, not #1) from the taxonomy-mapped
  agents in §2.
- **39-entry AGENT_CATALOGUE** — descriptive-only for 21/39, real dispatch for 18/39 Engineering
  entries only (§3.3).
- **Agent-instance factory records** — unbounded, tenant-created, count varies by `data/
  agent-instances.json` contents at any given time; not enumerated (would require reading live
  tenant data, out of this census's read-only-source-only scope).
- **157 dead-letter names in `agents/executor.cjs`** (§3.6) — the largest single bucket found in
  this entire census, structurally outside every other mechanism, and the most likely true source
  of the "~50 agents" impression this task's own framing carried in.
- **`agentFactoryAutomation.cjs`'s dynamic-creation surface** (§3.7) — a sixth registry, real but
  producing non-directly-executable descriptors.
- **ACP-8 autonomous engineering agent** (§3.7) — real, wired, zero recorded executions to date.

## C. Missing critical agents

1. **Per-vendor SaaS/Integration agents (0/10 exist).** 57 real connectors exist
   (`integrationConnectors.cjs`) but none is wrapped in an autonomous agent with its own
   tick/decision/error-recovery loop the way `agent_crm` or `business_marketing` are. This is the
   single largest gap in the *taxonomy-shaped* framing.
2. **A genuinely deployment/test-runner agent.** `agentOrchestrator.cjs`'s own comment (§3.5)
   states plainly: "No real, distinct 'deployment' or 'testRunner' agent exists in the registry
   today." `agents/dev/pipelineOrchestrator.cjs`'s `_test()` step is the closest real approximation
   but is a pipeline stage, not an addressable agent. Notably, `deployment` and `testRunner` are
   also two of the 157 dead-letter names in `agents/executor.cjs` (§3.6) — i.e. the gap was
   apparently already "planned for" by name, just never implemented.
3. **`orgId` propagation into `runtimeOrchestrator.dispatch()`.** Not itself an agent, but blocks
   two real things from working end-to-end: the high-risk-capability approval gate (§ execution
   engine) and the agent-instance factory's config-enrichment (§3.2) — both are real code sitting
   dormant behind the same missing plumbing, per Mission 32's explicit, still-open "Remaining
   Decision #1."
4. **The largest single gap by volume is not a missing agent at all — it's the 157 dead-letter
   names in `agents/executor.cjs` (§3.6).** Whatever process generated a "~50 named agents"
   expectation for this task most plausibly traces back to a *subset* of this 160-name dispatch
   table (which is itself ~3x larger than 50) — meaning the real gap-to-close, if these names
   represent genuine product intent, is building ~150+ backing implementations, not ~10-15.

## D. Duplicate/overlapping agents

1. **CRM appears three times**: `crm` (mechanism #1 bootstrap id), `business_crm_agent` (mechanism
   #1, capability `crm_extended`), `agent_crm` (mechanism #2, supervisor). Not necessarily a defect
   — they serve different mechanisms — but a genuine naming/architecture overlap a future
   consolidation pass should be aware of.
2. **Payment agent exists as two separate files**: `agents/business/paymentAgent.cjs` and
   `agents/paymentAgent.cjs` (root-level) — both present in the file tree; this census did not diff
   their contents (read-only recon budget), flagging for a dedicated look rather than asserting
   duplication with certainty.
3. **`agentRegistry.cjs` (mechanism #1, capability→handler) vs. the "I5-1 registry" inside
   `agentRuntimeSupervisor.cjs`** — Mission 32 §2 explicitly documents these as "two different
   things sharing similar naming" — already flagged in prior art, re-confirmed present at HEAD,
   not a new finding.
4. **`skillRegistry.cjs` vs. `skillEngine.cjs`** — near-identical names, functionally distinct
   (execution-handler metadata catalog vs. workforce-capacity simulation), per Mission 30's already
   -documented finding.
5. **Business Analytics counted in both "Business/CRM/ERP" and "Analytics/Data"** in the taxonomy
   itself (§2) — a spec-level overlap, not a code defect.

## E. Current Agent Army architecture (as-built, not as-documented)

```
                        ┌─────────────────────────────┐
                        │   backend/server.js (boot)   │
                        └──────────────┬───────────────┘
                                       │
                ┌──────────────────────┼───────────────────────────┐
                ▼                                                    ▼
  agents/runtime/bootstrapRuntime.cjs                agentRuntimeSupervisor.cjs.start()
   registers 43 stateless capability           registers 10 BUILTIN_AGENTS, then
   handlers into agentRegistry.cjs              10 Level-org modules each .register()
                │                                their own ~20 dept agents (→ ~210 total)
                ▼                                                    │
  agents/runtime/agentRegistry.cjs                                   ▼
   (circuit breaker, concurrency,                    _agents Map + _buckets Map (P1-1:
    findForCapability)                                11 shared setInterval buckets,
                │                                      not 210 individual timers)
                ▼                                                    │
  agents/runtime/executionEngine.cjs                                 ▼
   .executeTask() — retries, approval          per-role tick functions (_crmTick,
   gate (dormant — no orgId propagation)        _plannerTick, _civ*Tick, etc.) — create
                │                                real missions via missionOrchestrator
                ▼
  agents/runtime/runtimeOrchestrator.cjs
   .dispatch() — SOLE caller of executeTask(),
   11 real upstream callers (routes, recovery,
   autonomous runtime, multi-agent coordinator)

  Overlaid, not wired into dispatch by default:
  ┌────────────────────────────────────────────┐
  │ agentInstanceRegistry.cjs (org/company      │
  │ config overlays on archetypes — factory)    │  ← only activates when task.orgId set
  ├────────────────────────────────────────────┤
  │ skillEngine.cjs AGENT_CATALOGUE (39, desc-  │
  │ riptive; 18/39 get real dispatch)           │  ← read-only dashboard, partial dispatch
  ├────────────────────────────────────────────┤
  │ orgAgents.cjs (tenant ownership join table  │
  │ over agentExecutionEngine's run history)    │  ← real, correctly thin, no duplication
  ├────────────────────────────────────────────┤
  │ agentFactoryAutomation.cjs (6th registry,   │
  │ data/agent-registry.json — dynamic-agent    │  ← config/permission descriptors only,
  │ creation via /p20/agents/*)                 │     no confirmed dispatch bridge
  └────────────────────────────────────────────┘

  Structurally disconnected from all of the above (§3.6):
  ┌────────────────────────────────────────────┐
  │ agents/executor.cjs — _buildHandlers()      │
  │ 160 unique dispatch targets; 157 point to   │  ← real HTTP path, real code, but every
  │ agent IDs never registered anywhere         │     one of these 157 calls fails closed
  └────────────────────────────────────────────┘
```

## F. Exact gaps needed for A-to-Z legitimate digital work

1. **Decide the intent behind `agents/executor.cjs`'s 157 dead-letter names (§3.6) — this is the
   largest and highest-priority open item this census found.** Two legitimate paths, both requiring
   a founder-level product decision rather than a mechanical fix: (a) if these ~150 taxonomy-shaped
   agents (education, health/life, HR/enterprise, sales-pro, e-commerce) represent real product
   intent, they need actual backing implementations — 20-30x the current real agent population; (b)
   if they were aspirational scaffolding from an earlier planning pass that was never built out,
   the dead dispatch table should be pruned or explicitly marked non-functional, since it currently
   presents as a live, reachable HTTP surface that always fails.
2. **Build the missing 10 SaaS/Integration agents**, or explicitly decide the 57-connector layer
   plus 1 generic `internet_api_fetcher` is the intended design and retire that taxonomy category's
   10-agent framing as aspirational/superseded.
3. **Thread `orgId` through `runtimeOrchestrator.dispatch()`** (Mission 32's open Decision #1) —
   unblocks two already-real, currently-dormant subsystems (approval gate, instance-factory
   enrichment) without writing new code.
4. **Resolve the L6-L10/Platform-Omega agent population's product scope**, per
   `OS-CIVILIZATION-FINAL.md`'s (a)/(b)/(c) decision framework — currently ~150-190 of the 210
   supervisor agents (everything past the 10 built-ins + Engineering/Business/Knowledge/Evolution
   orgs) are architecturally real but have no established tenant-facing purpose, consuming real CPU
   ticks and disk (civilization alone: ~24MB self-generated) for no confirmed product value.
5. **Deduplicate the CRM/payment naming collisions** (§D) before adding any new agent to those
   families, to avoid a 4th/5th shadow copy.
6. **Decide whether `agents/dev/`'s 10-file pipeline should become 10 real dispatcher-registered
   agents** (consistent with how Marketing/Business content-generation agents are individually
   registered) or stay a monolithic pipeline — currently architecturally inconsistent with its
   sibling taxonomy categories.
7. **Add a real `AgentInstanceRegistry`-specific test file** — currently covered only transitively
   through `capabilityContract.cjs`'s tests, not directly.
8. **Check whether `AgentRegistryCenter.jsx`'s SEED fallback (§3.3) is ever visibly shown as live**
   — a quick live-browser check (out of this census's read-only scope) would resolve this from
   "flagged" to either "confirmed clean" or "confirmed CLAUDE.md §17 defect."

---

## Verification footer

**Note on concurrent sessions:** `ListAgents` confirms 3 other interactive sessions were active on
this same working directory (`jarvis-os-bc`, `jarvis-os-09`, `jarvis-os-30`) while this census ran.
`git status --short`, taken at the moment this report was finalized, therefore reflects **their**
concurrent, unrelated, in-progress work in addition to this census's own output. Attributed below
explicitly so nothing here is misread as this mission's own change.

```
git status --short   (final, at report completion)
```
```
 M agents/runtime/agentRegistry.cjs                                    ← NOT this census (see below)
 M backend/services/approvalEngine.cjs                                 ← NOT this census (see below)
 M backend/services/missionMemory.cjs                                  ← NOT this census (see below)
 M backend/services/toolExecutionLayer.cjs                             ← NOT this census (see below)
?? reports/AGENT-ARMY-COMPLETE-CENSUS.md                               ← this census's own output
?? reports/MISSION-90-PHASE-3-ISOLATION-CERTIFICATION.md               ← pre-existing at session start
?? reports/MISSION-91-PRODUCTION-DEPLOYMENT-GATE.md                    ← pre-existing at session start
?? reports/MISSION-92-FULL-TECHNICAL-TEST-CORPUS-CERTIFICATION.md      ← pre-existing at session start
?? reports/MISSION-93-PRODUCTION-READINESS-REMEDIATION-GATE.md         ← pre-existing at session start
?? reports/PRODUCTION-ENV-PRESENCE-INVENTORY.md                        ← pre-existing at session start
?? tests/runtime/agent-identity-phase2.test.cjs                        ← NOT this census (concurrent)
?? tests/runtime/tool-execution-agent-identity.test.cjs                ← NOT this census (concurrent)
```

**Important — HEAD moved during this census, due to a concurrent peer session, not this one.**
`ListAgents` confirmed 3 other interactive sessions (`jarvis-os-bc`, `jarvis-os-09`, `jarvis-os-30`)
active on this same working directory throughout. One of them committed
`41867c0e` ("fix: align email readiness env names" — `backend/services/launchReadiness.cjs` +
`tests/security/100-launch-readiness-email-canonical-env-names.cjs`, unrelated to agents,
corresponds to the `MISSION-94-EMAIL-READINESS-ENV-DRIFT.md` report that appeared mid-census) on top
of this census's start-of-session baseline (`2376e500`). **This census never ran `git commit` at any
point** — confirmed via `git log --oneline -3` showing only the peer's commit and the pre-existing
baseline, with no commit authored during this investigation's tool-call history. The
`agents/runtime/agentRegistry.cjs`, `approvalEngine.cjs`, `missionMemory.cjs`, and
`toolExecutionLayer.cjs` working-tree modifications, plus the two new `tests/runtime/*-identity*`
files, are that same or another peer session's **still-uncommitted, in-progress** "Phase 2 Agent
Identity" work (optional `role/purpose/allowedTools/credentialScope/workspaceScope/lifecycleState/
provenance` fields added to `AgentRecord`, confirmed additive/backward-compatible by its own
in-file comment, read but not written by this census in §4). None of §2/§3's agent counts above
reflect this in-progress work (compiled from the pre-edit version) — if it lands, the
mechanism-#1 agent-identity fields it adds are worth a follow-up note, not a re-census.

**This census's own changes, isolated:** `git diff HEAD -- backend/services/agentRuntimeSupervisor.cjs`
→ 0 lines (P1-1 untouched, as instructed, verified again at report completion, not just at start).
The only file this census created or modified, at any point, is
`reports/AGENT-ARMY-COMPLETE-CENSUS.md` itself — confirmed via `git status --short` immediately
before this census began (clean on every file discussed above) and by attributing each later-seen
diff to a concurrently-running peer session's own commit or in-progress work rather than assuming
it was this census's own.

**HEAD at census start:** `2376e500a2a7bb1e6a1be586981beb03bbfc0d92`
**HEAD at census completion:** `41867c0e9439e96ef2f89295910e5e8c42888d37` — moved by exactly one
commit, authored by a concurrent peer session (not this census), unrelated to agents.

**P1-1 diff count vs `7c229a52`:** `git diff 7c229a52 -- backend/services/agentRuntimeSupervisor.cjs
| wc -l` → **301 lines.** This diff was already present at HEAD *before* this census began (it is
the P1-1 timer-consolidation fix from a prior session, dated 2026-09-03 per its own in-file
comment, and covered by `tests/runtime/44-agent-timer-consolidation.test.cjs`). This census made
**zero** additional changes to that file — it was read-only inspected (the excerpt quoted in §
above) and never edited. `git diff HEAD -- backend/services/agentRuntimeSupervisor.cjs` (this
census's own edits only) is empty.

**Confirmation: no production code, runtime data, database, or secret file was changed by this
census.** Only one new file was created: `reports/AGENT-ARMY-COMPLETE-CENSUS.md` itself.
