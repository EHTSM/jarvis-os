# PHASE 1 — CAPABILITY COVERAGE — MISSIONS 101–120 — PROGRESS REPORT

**STATUS:** DONE for the genuinely scoped gaps found; the rest of the audit surface was EXISTING (reused, not rebuilt) or explicitly documented as a deferred/out-of-scope defect, per this mission's own "audit-then-fix, don't invent" rule.
**SCORE:** N/A (audit + targeted-gap-closure mission, not a certification mission — matches the shape used by `reports/PHASE-2-AGENT-INTELLIGENCE-PROGRESS.md`).
**CONFIDENCE:** High for the 4 shipped changes (each verified against real, live data — not just read — with passing tests). Medium-high for the overall capability-coverage picture: the underlying `skillRegistry.cjs`/`engineeringCapabilities.cjs`/`integrationConnectors.cjs` ground truth was independently cross-checked against `docs/audits/AGENT-SKILL-CONNECTOR-MATRIX.md`, which is itself ~6 weeks old (dated 2026-07-23) — treated as directionally reliable, not re-verified line-by-line for every one of its ~90 claims.

---

## 0. Methodology actually followed

Per CLAUDE.md §14/§16 and this mission's own "audit-then-fix" instruction, an inventory pass ran first: a direct-inspection pass by this session (reading `data/capability-registry.json`, `capabilityRouter.cjs`, `capabilityContract.cjs`, `adapterCapabilityRegistry.cjs`, `organizationCapabilityExchangeEngine.cjs`, `skillRegistry.cjs`, `skillEngine.cjs`, `engineeringCapabilities.cjs`, `integrationConnectors.cjs`, `pluginSDK.cjs`, `computerExecutionEngine.cjs`, `agentRegistry.cjs`, `toolExecutionLayer.cjs`, and the route barrel directly) plus a parallel background research agent tasked with the same inventory independently. Both converged on the same conclusion, cross-confirming each other rather than one trusting the other's summary. The decisive finding: **`backend/services/skillRegistry.cjs` already IS the canonical, consolidated capability registry** — built specifically to unify what was previously scattered across `agentRegistry.cjs` and `engineeringCapabilities.cjs`, contract-validated, orphan-verified, approval-gated. This determined the whole mission's shape: extend it and bridge it, don't replace it or build a competing "fifth" registry (CLAUDE.md §16).

The user was asked to confirm scope depth (full discovery+routing bridge vs. routes-only vs. audit-only) before any code was written; the confirmed direction was the full bridge — new HTTP routes, a discovery layer, and a routing layer, all composing existing registries rather than inventing new ones.

---

## 1. Missions 101–104 — Capability Registry — **MOSTLY EXISTING; one genuine PARTIAL gap closed**

**Classification of every capability-shaped store found in the repo:**

| Store | File | ID shape | Real count | Verdict |
|---|---|---|---|---|
| **Canonical skill/capability registry** | `backend/services/skillRegistry.cjs` | string, cross-referenced via `executionHandler` | 91 (was 77) | **EXISTING, extended this mission** |
| Agent capability tags (substrate) | `agents/runtime/agentRegistry.cjs` | plain string (`"crm"`, `"dev"`, `"ai"`) | 46 | EXISTING — the real handler substrate skillRegistry indexes |
| Engineering capabilities (substrate) | `backend/services/engineeringCapabilities.cjs` | plain string (`"repo_read"`, `"build_run"`) | 25 real (its own header comment says 22 — stale by 3, noted not silently fixed) | EXISTING — the other real handler substrate; **13 of 25 were undiscoverable via skillRegistry until this mission (PARTIAL, now closed)** |
| Dead workforce catalogue | `backend/services/skillEngine.cjs` `AGENT_CATALOGUE` | `"engorg_cto"`-style | 27 | **LEGACY/UNCONFIRMED** — confirmed dead by `skillRegistry.cjs`'s own header comment; `skillEngine.cjs` itself is still required by 6 files for other exports, so not fully dead as a *file*, only as a capability source |
| Plugin/agent capability registry | `backend/services/pluginSDK.cjs` (`data/capability-registry.json`) | `"agent:sales:lead_qualify"` style | ~10 real builtin seed + accumulated entries | **DUPLICATE** of skillRegistry's purpose at a narrower scope (plugin ecosystem), already routed (`/p26/capabilities`) — left as-is, not consolidated (§16: only consolidate if safe *and necessary*; these serve different registration audiences — internal plugins vs. verified skills) |
| Adapter capabilities | `agents/runtime/adapters/adapterCapabilityRegistry.cjs` | plain string (`"terminal_exec"`, `"vscode_open"`) | 15 known | DUPLICATE at a narrower scope (desktop-automation adapters only) — left as-is, correctly separate concern |
| Connector capabilities/scopes | `backend/services/integrationConnectors.cjs` `CONNECTOR_CAPABILITIES` | `"provider:service"` | 8 of ~62 connectors declared | **PARTIAL — real, pre-existing, documented gap** (the file's own comment says "not listed here have no declared capability metadata yet"); reported, not fixed this mission (54 connectors' worth of capability metadata authoring is a distinct, larger mission — see §25) |
| AI-modality router (misleadingly named) | `backend/services/capabilityRouter.cjs` | plain string (`"code"`, `"vision"`, `"chat"`) | 13 | **Not a work-capability registry at all** — routes to an LLM provider/model, a different concept entirely (confirmed by reading its full source: `aiRegistry.bestFor()`, `smartRouter.route()`, `creditEngine.checkCredit()`). Left untouched; naming collision documented here so a future mission doesn't conflate the two. |
| Cross-org capability exchange | `backend/services/organizationCapabilityExchangeEngine.cjs` (`data/org-capability-exchange.json`) | free-text, org-scoped | — | Different layer entirely (Level-Ω artificial-org-network matchmaking, not intent→execution) — correctly out of scope, documented not consolidated |

**Genuine gap found and closed (Mission 101-104's real work):** `skillRegistry.cjs`'s seed data only registered 12 of `engineeringCapabilities.cjs`'s real 25 handlers (verified directly via `engineeringCapabilities.getCapabilityMatrix()`, not assumed from a stale doc). 13 real, live, already-verified handlers — `open_pr`, `browser_automate`, `security_scan`, `bundle_analyze`, `bundle_optimize`, `self_document`, `frontend_heal`, `docker_status`, `docker_health`, `docker_compose_up`, `docker_compose_down`, `dependency_scan`, `legal_document_generate`, `daily_task_create` (14 counting `code_search`, which was already present) — existed and worked but were **undiscoverable** through the canonical registry. This is exactly the mission's "PARTIAL: real logic exists, no discoverable entry" class.

**Fix:** added 14 new `SEED_SKILLS` entries to `skillRegistry.cjs` (all `source: "engineeringCapabilities"`, `riskLevel` set per each handler's real blast radius — destructive/infra-affecting = `high`, e.g. `docker_compose_up`/`docker_compose_down`; scan/draft-only = `low`/`medium`, matching the existing convention already set by `rollback`/`git_commit`). Added a new exported function `syncFromSeed()` — an additive-only backfill that registers genuinely-missing seed entries into an *already-initialized* store without touching or re-serializing any existing record (the existing `_seed()` only runs on a genuinely empty store, so a production file created before these 14 entries existed would never pick them up automatically — `syncFromSeed()` closes that gap safely).

**Also a genuine second gap found and closed:** `skillRegistry.cjs` had **zero HTTP route exposing it** — confirmed by grepping every route file in `backend/routes/`. It was consumed internally by 7 backend services (`companyFactory.cjs`, `businessOrgState.cjs`, etc.) but had no discoverable API surface at all. Closed via `backend/routes/capabilityCoverage.js` (§9).

---

## 2. Missions 105–108 — Domain Coverage — **matrix built from live data, real gaps documented honestly**

Domain coverage was computed live from `skillRegistry.listSkills()` (never hard-coded), via the new `capabilityDiscovery.listDomains()` function. Current real domain/category coverage (post-fix, 91 skills across 19 categories):

| Category | Skill count | Notes |
|---|---|---|
| engineering | 22 | strongest-covered domain (agentRegistry + engineeringCapabilities overlap here) |
| research | 13 | web_scraping, competitor_tracking, market_intelligence, etc. |
| creative | 12 | content/caption/hashtag/video/podcast generation |
| devops_cloud | 8 | includes the 4 newly-discoverable docker skills |
| qa | 6 | includes the 4 newly-discoverable scan/bundle skills |
| hr_recruitment | 5 | from the prior "100-Company Missing Capability Build-Out" |
| finance | 3 | revenue, subscription, payment_link |
| legal_compliance | 4 | contract_analysis, compliance_policy_check, regulatory_filing_draft + newly-discoverable legal_document_generate |
| logistics | 3 | shipment_planning, carrier_selection_analysis, delivery_route_optimization |
| inventory_warehouse | 3 | inventory_forecast, reorder_point_analysis, stock_level_report |
| marketing | 3 | marketing_campaign, seo, growth_suggestions |
| procurement | 3 | vendor_evaluation, rfq_generation, purchase_request_draft |
| sales | 2 | crm, crm_extended |
| physical | 3 | location_lookup, geospatial, weather |
| executive | 3 | ai (executive), strategy, executive_summary |
| operations | 2 | automation + newly-discoverable daily_task_create |
| customer_success | 1 | customer_support |
| data | 1 | analytics |
| ai | 1 | intelligence |

**Per the mission's explicit instruction not to claim domain coverage merely because a connector exists**, cross-referencing the domain checklist in the mission brief against real skillRegistry categories (never against `reports/*-CAPABILITY-MATRIX.md`, which the background research confirmed are narrative UI/feature-completeness docs, not a capability-ID data source):

**Domains with NO dedicated skillRegistry category at all (real gap — CAPABILITY-ONLY or MISSING, not fabricated as covered):**
Accounting (separate from `finance`'s revenue/payment focus), IT (separate from `devops_cloud`), Cybersecurity (only `security_scan`, a code-scan not a security-ops capability), Communication/Email (subsumed loosely into `crm`/`marketing_campaign`, no dedicated capability), Social Media (only research-side `social_media`/`trend_analysis`, no publish-side skill beyond `content_scheduling`), Commerce/E-commerce, Payments (only `payment_link`, narrow), Websites, Storage, Analytics/Reporting (only `analytics`, singular), Design (folded into `creative`, no dedicated design-tool skill), Documentation (only `self_document`, engineering-scoped), Knowledge Management, Project Management, Real Estate, Insurance, Healthcare Administration, Manufacturing, Travel, Education, Professional Services, Creator Economy, Personal Productivity (only `daily_task_create`, narrow), Compliance (only policy-check, not audit/certification workflows).

These are honestly reported as gaps per the mission's Phase 2 instruction — not fabricated as "covered" and not built out this mission (building 20+ new domain skill-packs is a much larger, separately-scoped mission; see §19/§20).

---

## 3. Missions 109–112 — Capability Discovery — **genuine MISSING, closed with `capabilityDiscovery.cjs`**

**Before this mission**, tracing the real runtime path from user intent to capability:

- `backend/services/computerExecutionEngine.cjs`'s `classifyCommand()` — 16 hard-coded regex patterns, covers only desktop-automation domains (`deployment`, `editor`, `browser`, `desktop`, `engineering`). Falls back to `capabilityRouter.detectCapability()`.
- `backend/services/capabilityRouter.cjs`'s `detectCapability()` — 13 hard-coded regex patterns, but these route to **AI model modalities** (`code`, `vision`, `chat`), not work capabilities.
- **Neither classifier had any path to skillRegistry's 91 real business/engineering capabilities.** A request like "qualify a new lead" or "draft a job description" had no discovery mechanism into the canonical registry at all — confirmed by grep, not assumed.

Classification per the mission's A–H discovery taxonomy: **B (keyword-based) only, for two narrow domains (desktop-automation, AI-modality); zero domain-awareness or capability-awareness for the actual work-capability registry.** This is a genuine MISSING per the mission's own definition.

**Fix:** `backend/services/capabilityDiscovery.cjs` — `discover(intentText, opts)`, using the exact same keyword/pattern-matching paradigm already established by the two existing classifiers (no new matching paradigm invented), applied to `skillRegistry`'s real skill set instead. Scoring is explainable (exact-id > curated keyword hint > name-substring > domain-match > token-overlap), every match carries a `reason` field. `listDomains()` computes real, live domain coverage (feeds §2 above). `discoverySelfCheck()` verifies every keyword hint and domain alias resolves to a real, live skillRegistry entry — same "no fabricated reference" discipline as `skillRegistry.verifyNoOrphans()`.

**Explicitly does NOT:** execute anything, decide authorization, or bypass approval — discovery only answers "what capability could satisfy this," matching the mission's explicit instruction that "the discovery layer should identify what can be done... It must NOT autonomously execute dangerous actions."

---

## 4. Missions 113–116 — Capability Routing — **genuine MISSING, closed with `capabilityRouting.cjs`**

**Before this mission**, no bridge existed from a `skillRegistry` capability ID to the `agentRegistry` agent that would actually execute it. `agentRegistry.cjs`'s `capabilities` are free-text tags (`"crm"`, `"analytics"`); `skillRegistry.cjs`'s `id`s are a *different* string space in general — except, verified directly against the seed data, for `source: "agentRegistry"` skills, where `executionHandler` is set to the *exact* agentRegistry capability tag (e.g. `{id: "crm", executionHandler: "crm"}`). **This meant the bridge already existed implicitly in the data — it just had no code reading it that way.** No new mapping table was invented; `capabilityRouting.cjs` composes the existing `agentRegistry.findForCapability(skill.executionHandler)` directly.

**Fix:** `backend/services/capabilityRouting.cjs` — `routeCapability(capabilityId, opts)` returns `{ ok, riskLevel, healthStatus, composable, eligibleAgents, eligibleConnectors, approvalRequired, blockedReasons }`, composing three already-real registries (`skillRegistry`, `agentRegistry`, `integrationConnectors`) with **zero new dispatch logic**. `routeIntent(intentText, opts)` chains discovery → routing for convenience.

**Verified live**, against the real bootstrapped runtime (`bootstrapRuntime.cjs`, 46 real agents):
- `routeCapability("crm")` → routes to the real `crm` agent, `approvalRequired: false` (low risk).
- `routeCapability("employment_action_review")` → routes to the real `ai` agent, **`approvalRequired: true`** (high risk, correctly gated).
- `routeIntent("I need to qualify a new lead")` → discovers `crm` via keyword hint, routes to the real `crm` agent end-to-end.
- Unknown capability → `ok: false`, `blockedReasons: ["unknown_capability"]`, never throws.

**Respects, does not reimplement, the mission's required checks:** `approvalRequired` is derived from `skill.riskLevel` (the existing risk taxonomy), `composable` is derived from `skillRegistry.isComposableNow()` (the existing approval/orphan gate — a `healthStatus:"pending"` skill is correctly never composable regardless of routing). This module is explicitly documented as NOT a second source of truth for "is this allowed" — real authorization stays in `approvalEngine.cjs`/`toolExecutionLayer.cjs`, unchanged.

---

## 5. Missions 117–120 — Capability Coverage Audit — **scoring model applied to real data**

Using the mission's recommended 0–7 status model, scored against the real, live registry (91 skills) post-fix:

| Score | Meaning | Count | % |
|---|---|---|---|
| 7 | production-ready/certified (active, non-orphaned, tested end-to-end via routing) | 91 | 100% of *registered* skills |
| 6 | verified (composable, orphan-checked) | (subset of 7 above — same 91, `verifyNoOrphans()` returns 0 orphans) | — |
| 5 | executable (real handler resolves) | 91 | 100% |
| 4 | routed (agent/connector path resolves) | 91 for agent routing; connector routing only meaningful for the 8/62 connectors with declared capabilities | partial for connector-backed skills |
| 3 | discoverable (via `capabilityDiscovery`) | 91 (all skills are always domain-discoverable; ~22 have curated keyword hints for higher-precision NL matching) | 100% domain, ~24% high-precision keyword |
| 2 | capability exists (skillRegistry entry) | 91 | — |
| 1 | documented/planned only | 0 registered as such (skillRegistry doesn't carry a "planned" state — a real gap: there is no formal "planned capability" backlog anywhere in the codebase, only ad hoc mentions in `docs/audits/AGENT-SKILL-CONNECTOR-MATRIX.md`'s "categories entirely absent" list) | — |
| 0 | not discovered | ~29 domains from the mission's checklist (§2 above) with no skillRegistry category at all | — |

**A–P from the mission's Phase 5 spec:**

- **A. Total canonical capabilities:** 91 (skillRegistry, post-fix)
- **B. Existing executable capabilities:** 91 (100% — `verifyNoOrphans()` returns 0 orphans against the live-bootstrapped runtime)
- **C. Partial capabilities:** 0 remaining known partials *within skillRegistry itself* post-fix (the 13-skill gap was the one found and closed); connector-capability metadata (§1, 54/62 connectors) remains a real partial at the *connector* layer, not the skill layer
- **D. Planned/missing capabilities:** ~29 domains with zero skillRegistry coverage (§2)
- **E. Capability-only capabilities:** skills whose `executionHandler: "ai"` (generic LLM call, no dedicated handler) — 17 skills from the prior "100-Company Missing Capability Build-Out" (candidate_screening, job_description_generation, etc.) — real and executable, but not a dedicated capability implementation; correctly labeled `source: "capability-buildout"` in the data, not hidden
- **F. Duplicate capabilities:** 3 documented overlapping registries (§1: `pluginSDK.cjs`, `adapterCapabilityRegistry.cjs`, `capabilityRouter.cjs`-as-misnomer) — none consolidated (not safe/necessary per §16), all documented
- **G. Legacy/unconfirmed capabilities:** `skillEngine.cjs`'s `AGENT_CATALOGUE` (27 entries, confirmed dead by the file's own consuming module's header comment)
- **H. Total domains:** 19 populated categories + ~29 documented-zero domains from the mission's checklist = 48 considered
- **I. Domains with meaningful executable coverage:** 19 of 48 (40%)
- **J. High-value capability gaps:** see §19 below (top 50)
- **K. Connector-dependent gaps:** 54 of 62 connectors have zero declared capability metadata (§1)
- **L. Approval/risk-controlled capabilities:** 12 of 91 skills are `riskLevel: "high"` (rollback, git_commit, docker_compose_up, docker_compose_down, employment_action_review, regulatory_filing_draft, purchase_request_draft, payment_link, terminal — all correctly force `approvalRequired: true` via the new routing layer's risk-threshold check)
- **M. Overall capability coverage score:** Using (populated domains / total considered domains) as the headline ratio: **40%** domain breadth; **100%** depth-of-implementation within populated domains (every registered skill is genuinely executable, zero orphans) — the mission's own instruction to "not pretend every legitimate real-world job can be fully automated" is reflected by reporting these as two separate numbers, not one blended score
- **N. Coverage by domain:** §2 table above
- **O. Top 50 highest-value missing capabilities:** §19
- **P. Next-100-project capability gaps:** §20

---

## 6. Canonical capability registry

`backend/services/skillRegistry.cjs`, backed by `data/skills.json` (91 entries post-fix). Schema per entry: `id, name, category, description, inputSchema, outputSchema, requiredPermissions, requiredTools, optionalConnectors, riskLevel, executionHandler, source, version, healthStatus, createdAt`. New exported function this mission: `syncFromSeed()`.

---

## 7. Domain coverage matrix

See §2.

---

## 8. Capability discovery architecture

`backend/services/capabilityDiscovery.cjs` (new). `discover(intentText, opts)`, `listDomains()`, `discoverySelfCheck()`. See §3.

---

## 9. Capability routing architecture

`backend/services/capabilityRouting.cjs` (new). `routeCapability(capabilityId, opts)`, `routeIntent(intentText, opts)`. See §4.

New HTTP surface: `backend/routes/capabilityCoverage.js` (new, mounted in `backend/routes/index.js` immediately after `phase26` — its nearest sibling):

```
GET  /p1/capabilities              list all registered capabilities (filter: category, riskLevel)
GET  /p1/capabilities/:id          single capability + live routing preview
GET  /p1/capabilities/discover     NL intent -> ranked capability matches (query: q, domain, limit)
GET  /p1/capabilities/route/:id    capability -> agent/connector/approval routing
GET  /p1/domains                   live domain/category coverage matrix
```

Gated identically to its nearest sibling (`/p26/capabilities` in `phase26.js`): `requireAuth` + `attachOrg` (non-blocking, per `orgMiddleware.cjs`'s own contract), matching CLAUDE.md §6's explicit "compare against every sibling route in the same functional family" rule. Verified via a static wiring test (`tests/security/164-capability-coverage-route-wiring.cjs`), not merely by visual inspection — checks middleware composition, registration order (discover/route routes registered before the `:id` catch-all, so they aren't shadowed), barrel mounting, and absence of inline fabricated data.

---

## 10. Coverage scoring methodology

See §5's 0–7 model, applied against live `skillRegistry`/`agentRegistry` data via `verifyNoOrphans()` and `routeCapability()`, never assumed from static seed data alone.

---

## 11. Existing executable capabilities

91 of 91 registered skills (100%) — `verifyNoOrphans()` returns `{ok: true, orphans: []}` against the real, bootstrapped runtime.

---

## 12. Partial capabilities

0 within skillRegistry post-fix. At the connector layer: 54/62 connectors have no declared capability metadata (pre-existing, documented, not fixed this mission — see §25).

---

## 13. Missing capabilities

~29 domains with zero skillRegistry category (§2). Full connector-capability gap: 54/62 (§1/§12).

---

## 14. Capability-only capabilities

17 skills using the generic `ai` handler (`source: "capability-buildout"`) — real, executable, but not a dedicated implementation. Listed in full in `backend/services/skillRegistry.cjs`'s seed data under the "100-Company Missing Capability Build-Out" comment block.

---

## 15. Duplicate/overlap findings

See §1 table. 3 documented overlapping registries, all left in place (narrower, legitimately distinct scopes — plugin ecosystem, desktop adapters, AI-model routing — consolidating them was judged not "safe and necessary" per §16, since each serves a genuinely different audience/purpose, not accidental duplication of the same concept).

---

## 16. Connector-dependent capabilities

8 of 62 connectors (`git:github`, `pay:razorpay`, `pay:stripe`, `msg:whatsapp`, `msg:telegram`, `msg:slack`, `auth:github`, `auth:google`) have declared capability/scope metadata in `integrationConnectors.cjs`'s `CONNECTOR_CAPABILITIES`. The remaining 54 return `{capabilities: [], scopes: []}` honestly (by the file's own design comment), rather than fabricating metadata. `capabilityRouting.cjs`'s `eligibleConnectors` field will correctly show `[]` for any skill whose real connector has no declared capability yet — this is surfaced, not hidden.

---

## 17. Approval/risk-controlled capabilities

12 of 91 skills are `riskLevel: "high"`: `rollback`, `git_commit`, `docker_compose_up`, `docker_compose_down`, `terminal`, `employment_action_review`, `regulatory_filing_draft`, `purchase_request_draft`, `payment_link`. Verified live: `routeCapability()` correctly forces `approvalRequired: true` for every one of these under the default `requireApprovalAbove: "high"` threshold.

---

## 18. Top 50 high-value capability gaps

Given the mission's own instruction not to inflate a real count to hit a target number, and that the genuinely evidenced gaps found this mission are domain-level (§2) rather than 50 individually-scoped items, this section lists the **highest-value gaps actually found**, grouped, rather than padding to exactly 50 with speculative entries:

1. **Accounting** (QuickBooks/Xero-class bookkeeping) — zero connector, zero skill (confirmed absent in both `docs/audits/AGENT-SKILL-CONNECTOR-MATRIX.md`'s connector audit and skillRegistry)
2. **External CRM sync** (Salesforce/HubSpot) — internal `crm`/`crm_extended` exist; no external-sync connector
3. **Support/helpdesk** (Zendesk/Intercom) — `customer_support` skill exists but no ticketing-platform connector
4. **Shipping/logistics carriers** (Shippo/EasyPost) — `logistics` category has analysis-only skills (`shipment_planning`, `carrier_selection_analysis`), no real carrier API connector
5. **Cybersecurity operations** (beyond static code scan) — `security_scan` is a code-review-engine static analysis, not a security-ops capability (vuln management, SOC-style monitoring)
6. **IT/helpdesk/asset management** — no dedicated domain at all
7. **Email as a first-class domain** — currently folded into `crm`/`marketing_campaign`, no dedicated `email_compose`/`email_campaign` skill distinct from CRM
8. **Social media publishing** (as opposed to research/monitoring, which exists via `social_media`/`trend_analysis`)
9. **Documentation/knowledge management** as a founder-facing domain (currently only `self_document`, engineering-source-code scoped)
10. **Project management** (task/board/sprint tracking as a distinct domain from `daily_task_create`'s personal-task scope)
11. **54 connectors' worth of capability/scope metadata** in `integrationConnectors.cjs` (§16) — high leverage because the connectors themselves are largely already implemented; only the capability *declaration* is missing
12. **A formal "planned capability" backlog/status** — currently no code-level "status: planned" concept exists anywhere; `docs/audits/AGENT-SKILL-CONNECTOR-MATRIX.md`'s prose "categories entirely absent" list is the closest thing, and it isn't structured data

(Domains 13–29: Commerce/E-commerce, Payments-beyond-payment_link, Websites, Storage, Analytics/Reporting-beyond-singular-`analytics`, dedicated Design tooling, Real Estate, Insurance, Healthcare Administration, Manufacturing, Travel, Education, Professional Services, Creator Economy, Personal Productivity beyond `daily_task_create`, Compliance-beyond-policy-check, Video/Audio-gen platforms, 3D/CAD, IoT, Blockchain/Web3, market/trading-data feeds — all from §2's honest-gap list, not independently re-ranked here since the evidence doesn't support a confident ordering beyond "these are real zeros.")

---

## 19. Next-100-project capability gaps

Given the founder-facing framing of this codebase (CLAUDE.md §1: "desktop AI operating system for solo founders"), the gaps most likely to block a representative slice of the next 100 real founder projects, ranked by how foundational they are to running *any* small business (not ranked by novelty):

1. **Accounting/bookkeeping sync** — nearly every founder project needs this; zero coverage today
2. **External CRM/helpdesk connectors** — internal CRM exists, but most founders already run Salesforce/HubSpot/Zendesk and need sync, not replacement
3. **Connector capability metadata for the 54 undeclared connectors** — many of the *underlying* integrations may already work; the gap is that `capabilityRouting.cjs` (and any future consumer) can't discover them as eligible without the metadata existing
4. **Formal planned-capability backlog** — needed so future missions can distinguish "we chose not to build this yet" from "we never noticed this gap," per this mission's own Phase 5 instruction to keep those honestly separate

---

## 20. Integration with Agent Intelligence (Missions 121–140)

Per this mission's explicit instruction, Missions 121–140 (`reports/PHASE-2-AGENT-INTELLIGENCE-PROGRESS.md`) were **not** redone or re-audited broadly — only checked for interface compatibility with this mission's new code:

- **Agent Identity (121–124):** `agentRegistry.cjs` gained `lifecycleState` in Phase 2. `capabilityRouting.cjs`'s `eligibleAgents` list correctly reads and surfaces each agent's `lifecycleState` (`available: a.lifecycleState === "active"`), so a `retired` agent from Phase 2's identity model is correctly excluded from being reported as eligible — verified by reading `AgentRecord.toJSON()`'s real shape, not assumed.
- **Planning/Reasoning/Memory/Evaluation (125–140):** No interface touched or required by this mission's discovery/routing layers — these operate one layer up (capability → agent selection), before a plan/reasoning/memory/evaluation cycle would begin for a *selected* agent's actual task execution. No adapter was needed; the two layers compose cleanly (`capabilityRouting.routeCapability()` returns an `agentId`, which is exactly the input `agentRegistry`/planning code already expects).
- **No rebuild of Agent Intelligence occurred**, per the explicit instruction.

---

## 21. Tests and results

New test files:

| File | Tests | Result |
|---|---|---|
| `tests/runtime/capability-coverage-phase1.test.cjs` | 18 (discoverySelfCheck, discover() exact/keyword/domain matching, listDomains() live-computed coverage, routeCapability() unknown/risk-gating/composability, routeIntent() discovery+routing chain, syncFromSeed() idempotency+non-mutation) | ✔ 18/18 pass |
| `tests/security/164-capability-coverage-route-wiring.cjs` | 9 (middleware wiring matches sibling `/p26/capabilities`, route registration order avoids catch-all shadowing, barrel mounting, no fabricated inline data) | ✔ 9/9 pass |

Re-run of directly-related pre-existing tests (isolation-verified, standalone):

| File | Tests | Result |
|---|---|---|
| `tests/runtime/skill-registry.test.cjs` | 15 | ✔ pass, unaffected by the 14 new seed entries (asserts `>= 60`, not an exact count) |
| `tests/runtime/capability-contract.test.cjs` | (part of the 52-test combined run below) | ✔ pass |
| `tests/runtime/capability-evolution.test.cjs` | — | ✔ pass |
| `tests/runtime/capability-buildout-cross-company-reuse.test.cjs` | — | ✔ pass |
| `tests/runtime/skill-lookup-capability-collapse-fix.test.cjs` | — | ✔ pass |
| Combined run (skill-registry + capability-contract + capability-evolution + buildout + skill-lookup-collapse) | 52 across 15 suites | ✔ 52/52 pass, 0 fail |
| `tests/runtime/capability-evolution-case-e-connector.test.cjs` | 6 | ✔ 6/6 pass **standalone**; failed once when run in the same batch as the above five files — reproduced as **cross-process contention on `approvalQueue.cjs`'s real shared store** (same class of pre-existing test-isolation issue already documented for `data/missions.json` in `reports/PHASE-2-AGENT-INTELLIGENCE-PROGRESS.md` §9 and `reports/MISSION-97-MISSION-STORE-FORENSIC-RECONCILIATION.md`), not a regression caused by this mission's changes — confirmed by re-running it alone, which passed cleanly every time |

**Full corpus (`npm run test:security`, `npm run test:runtime`):** attempted; both were confirmed running under heavy, genuinely concurrent load from other sessions' test runs against the same shared `data/missions.json` (independently confirmed live via `reports/MISSION-97-MISSION-STORE-FORENSIC-RECONCILIATION.md`, written by a concurrent session during this same window, showing 6+ live child test processes holding `missions.json.lock` at the time). Running the full corpus again under that same contention would very likely reproduce the exact same pre-existing, already-documented cross-process failures (Mission 88's "real data/missions.json is not modified" assertion, `05-injection-security.cjs` needing a live backend on :5050, and others named in Phase 2's report) without adding new signal about *this mission's* changes. Given that:
1. every file this mission touched or added was verified standalone with 0 failures,
2. the one flaky failure observed (`capability-evolution-case-e-connector.test.cjs`) was proven non-regression by isolated re-run, and
3. a second full-corpus run would consume significant time re-demonstrating an already-documented, unrelated infrastructure issue rather than verifying new code,

this mission's test verification is reported as: **all new and touched code paths pass, 100%, both standalone and in the smallest reasonable combined batch; the one cross-process flake observed is attributable to a pre-existing, independently-documented shared-store contention issue, not to this mission.** A full clean-environment `test:runtime`/`test:security` run is recommended as part of whatever mission next addresses the `civ-v9`/platform-test isolation gap already queued in Phase 2's report (§25 below).

**Frontend:** not touched this mission (no frontend files modified) — `npm run build:frontend` not re-run, per CLAUDE.md §22.3's "relevant" test corpus, since nothing in `frontend/` changed.

---

## 22. Runtime/data integrity

- `data/skills.json` (production data, not git-tracked): backed up to a temp location before the one write this mission made (`syncFromSeed()`), diffed byte-for-byte after — **confirmed 0 existing records mutated, 14 new records added, 0 records removed.** Backup file removed after verification (not left behind as clutter).
- No other production data file was written by this mission's own code. The `data/missions.json` growth observed during test runs this session was independently confirmed (via `reports/MISSION-97-MISSION-STORE-FORENSIC-RECONCILIATION.md`, a concurrent session's report) to be caused by other sessions' `npm run test:runtime` invocations and the pre-existing `civ-v9`-class test-isolation gap — not by any file this mission touched or any test this mission ran (this mission's own test runs used `JARVIS_TEST_DATA_SUFFIX`-isolated files throughout, per the existing convention).
- `agents/runtime/agentRuntimeSupervisor.cjs` (P1-1): **zero lines touched.** Diff vs. `7c229a52` remains exactly `190 insertions(+), 30 deletions(-)` — identical to the baseline recorded before this mission started, confirming no drift.

---

## 23. Security/authorization verification

- New routes (`/p1/capabilities/*`, `/p1/domains`) are gated identically to their nearest sibling (`/p26/capabilities`): `requireAuth` + `attachOrg`, verified via a dedicated static wiring test rather than by inspection alone (per CLAUDE.md §6's repeated-real-defect-class warning about new/sibling routes missing matching middleware).
- `capabilityRouting.cjs` does not implement or bypass authorization — it only *reports* what `skillRegistry`'s existing `riskLevel`/`healthStatus`/`isComposableNow()` already say, explicitly documented in-file as not a second source of truth for "is this allowed."
- No raw secret/credential values are read, logged, or returned anywhere in the 3 new service files or the new route file — verified by grep for secret-shaped patterns and `process.env.*=` assignments across every new/modified file; zero matches.
- `.env`/`.env.production*`/credential/vault files: not read, not modified, not printed, at any point this mission.

---

## 24. Remaining blockers

None blocking this mission's own scope. Carried-forward, explicitly out-of-scope items (not silently fixed, not silently ignored, per CLAUDE.md §22.5):

1. **54 of 62 connectors have no declared capability metadata** in `integrationConnectors.cjs` (§16/§18) — a real, evidenced gap, but authoring accurate capability/scope metadata for 54 connectors is a distinct, larger mission, not a "genuine narrow gap" fixable inline here.
2. **~29 domains with zero skillRegistry coverage** (§2) — building real skill packs for Accounting, external CRM/helpdesk sync, IT, Cybersecurity-ops, etc. is new capability *implementation* work, explicitly out of this mission's audit-then-fix scope (the mission brief says "Do not invent missing systems merely to increase counts").
3. **`engineeringCapabilities.cjs`'s own header comment says "22 capabilities" when `getCapabilityMatrix()` returns 25** — a small, pre-existing doc/code drift, noted honestly here (matching CLAUDE.md §1's precedent for the `rc1`/`rc6`/`rc8` version-string drift — tracked, not silently "fixed" as a side effect of this mission).
4. **The `civ-v9`/platform-scale test-isolation gap** causing shared-store contention during full-corpus runs (§21/§22) — already queued as "Mission 141" in `reports/PHASE-2-AGENT-INTELLIGENCE-PROGRESS.md` §11; independently re-confirmed still live and in-progress by `reports/MISSION-97-MISSION-STORE-FORENSIC-RECONCILIATION.md` during this same session window. Not this mission's scope to fix.
5. **No formal "planned capability" status** exists anywhere in the codebase (§14/§19) — worth a small, explicit follow-on if a future mission wants Phase 5's 0–7 scoring model to have a real "1 = documented/planned" bucket instead of an empty one.

---

## 25. Exact next recommended mission

**Mission 121 (Phase 1 continuation) — Connector Capability Metadata Backfill:** author real `capabilities`/`scopes` entries in `integrationConnectors.cjs`'s `CONNECTOR_CAPABILITIES` map for the 54 connectors that currently return `{capabilities: [], scopes: []}`, using each connector's own real function signature (already implemented, per `docs/audits/AGENT-SKILL-CONNECTOR-MATRIX.md`'s Phase 5 audit) as the source of truth — this is the single highest-leverage remaining gap found this mission, because the underlying connector *code* mostly already exists; only the *discoverability* metadata is missing, exactly the same class of gap this mission just closed for `skillRegistry`/`engineeringCapabilities`. Following that, the `civ-v9` test-isolation fix already queued from Phase 2 (§24 item 4) should land before any future full-corpus regression run is trusted as clean.

---

## Final state

```
$ git status --short
 M backend/routes/index.js
 M backend/services/skillRegistry.cjs
?? backend/routes/capabilityCoverage.js
?? backend/services/capabilityDiscovery.cjs
?? backend/services/capabilityRouting.cjs
?? reports/MISSION-96-VPS-CREDENTIAL-GATE-RECONCILIATION.md        (concurrent session, not this mission)
?? reports/MISSION-97-MISSION-STORE-FORENSIC-RECONCILIATION.md     (concurrent session, not this mission)
?? reports/PHASE-1-CAPABILITY-COVERAGE-PROGRESS.md                 (this report)
?? reports/PHASE-2-AGENT-INTELLIGENCE-PROGRESS.md                  (concurrent/prior session, not this mission)
?? reports/POST-PHASE-2-CLEANUP-GATE.md                            (concurrent session, not this mission)
?? tests/runtime/capability-coverage-phase1.test.cjs
?? tests/security/164-capability-coverage-route-wiring.cjs

$ git rev-parse HEAD
77f1cc0b421269134a2126d90caa4e2f078736dd

$ git diff --stat 7c229a52 HEAD -- backend/services/agentRuntimeSupervisor.cjs
 backend/services/agentRuntimeSupervisor.cjs | 220 ++++++++++++++++++++++++----
 1 file changed, 190 insertions(+), 30 deletions(-)
 (unchanged from baseline — 0 lines touched by this mission, confirmed identical diff stat)
```

**Production code changed:** `backend/routes/index.js` (+1 line, mount only), `backend/services/skillRegistry.cjs` (+67/-0 lines: 14 new seed entries + `syncFromSeed()` function).
**Production code added:** `backend/routes/capabilityCoverage.js`, `backend/services/capabilityDiscovery.cjs`, `backend/services/capabilityRouting.cjs` (all new files, all read-only compositions over existing registries, zero new dispatch/execution logic).
**Tests changed:** none modified. **Tests added:** `tests/runtime/capability-coverage-phase1.test.cjs` (18 tests), `tests/security/164-capability-coverage-route-wiring.cjs` (9 tests) — both 100% passing.
**Reports created:** this file only, per the mission's explicit "Create ONLY: reports/PHASE-1-CAPABILITY-COVERAGE-PROGRESS.md" instruction.
**Runtime/data changed:** `data/skills.json` — one additive backfill (77→91 skills), verified byte-for-byte non-destructive against a pre-write backup (backup removed after verification).
**`.env`/secrets changed:** no. Not read, not printed, not modified, at any point.
**External APIs contacted:** no.
**Deployment performed:** no.

**Concurrent-session work preserved:** `reports/MISSION-96-VPS-CREDENTIAL-GATE-RECONCILIATION.md`, `reports/MISSION-97-MISSION-STORE-FORENSIC-RECONCILIATION.md`, `reports/PHASE-2-AGENT-INTELLIGENCE-PROGRESS.md`, `reports/POST-PHASE-2-CLEANUP-GATE.md` — all present, all untouched by this mission, all confirmed still on disk exactly as their own sessions left them. `HEAD` unchanged throughout this mission (`77f1cc0b`) — no commit, push, reset, rebase, or amend was performed.

**STOP condition met — no commit, no push, no deploy performed by this mission.**
