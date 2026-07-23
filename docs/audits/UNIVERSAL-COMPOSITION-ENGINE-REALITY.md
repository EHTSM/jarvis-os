# JARVIS Universal Autonomous Company Composition Engine — Reality Report

**Mission:** Make JARVIS capable of composing any current or future company from reusable capabilities via one real chain: Company Factory → Department Factory → Agent Factory → Skill Registry → Tool Fabric → Connector Registry → Credential Vault → Workflow Engine → Approval/Safety Engine → Execution Runtime → Learning → Capability Evolution.

**Branch:** `security/reality-completion`. **Commits:** `105339a` through `dbb4004` (12 commits, Phases 1, 3-repair, 4-13). **Scope executed:** Slices 1-5 of the approved plan (`/Users/ehtsm/.claude/plans/indexed-sniffing-crystal.md`), covering Phases 1, 3 (repair), 4-15, 17. Phase 2 (Company Factory contract validation), Phase 16 (frontend org-scoping build-out), and further Phase 14/15 depth remain explicitly deferred (see "Remaining Blockers" below) — no marketing language, no assumed completion beyond what is evidenced here.

This report follows the evidence-only convention of `100-COMPANY-REALITY-AUDIT.md`, `AGENT-SKILL-CONNECTOR-MATRIX.md`, `100-COMPANY-COVERAGE-MATRIX.md`, and `100-COMPANY-GAP-LIST.md` — every claim below is backed by a real test, a real script run, or a direct code citation, never an assumption.

---

## 1. What already existed (confirmed real, reused unchanged)

- **Agent Registry / Execution Runtime** — `agents/runtime/agentRegistry.cjs` (38 agents at boot, `bootstrapRuntime.cjs`), `taskRouter.cjs`, `executionEngine.cjs`'s dispatch chain. Unchanged in structure; extended additively (see §2).
- **Department Factory** — `backend/services/departmentTemplateRegistry.cjs` (33 department templates, real `isComposableNow()` verification against the live registry). Reused as-is; only its *persistence* was repaired (§2).
- **Company Factory** — `backend/services/companyFactory.cjs`'s 13-step pipeline, `businessTemplateEngine.cjs`'s 10 hardcoded templates + keyword-pattern `inferTemplate()`.
- **Connector Registry** — `backend/services/integrationConnectors.cjs` (62 real connector functions, real network probes via `_probe()`). Unchanged; a derived status-vocabulary mapping was added on top (§2).
- **Credential Vault** — `backend/services/secretVault.cjs` (real AES-256-GCM). Unchanged.
- **Workflow Engine** — `backend/services/missionOrchestrator.cjs` (real DAG, parallel dispatch, retry-with-backoff, pause/resume/cancel). Unchanged in its core mechanics; extended additively (§2).
- **Approval Engine** — `backend/services/approvalEngine.cjs` / `approvalQueue.cjs` (real 11-step pipeline, real persisted requests). Unchanged; wired into new call sites (§2).
- **Repository Editing Engine** — `backend/services/repositoryEditingEngine.cjs`'s real requirement→AI-plan→file-write→test/build/review/commit pipeline (`planBundle`/`applyBundle`, real `fs.writeFileSync`, real `engineeringPipelineCoordinator` gates). Unchanged in its core mechanics; one new final stage added (§2).
- **Tool-like layer** — `backend/services/toolExecutionLayer.cjs` (real catalog, risk levels, rate limiting, permission gating, usage tracking, real HTTP execution). Confirmed the most complete of three disconnected tool-like layers found; extended, not replaced.

---

## 2. What was repaired or wired (real gaps closed, evidenced)

| Gap found | Fix | Evidence |
|---|---|---|
| Department composition metadata (skills/connectors/permissions/kpis) was computed at company-creation time then **discarded** — never persisted onto the department record | `organizationService.createDepartment()` gained an additive `composition` field; `companyFactory.cjs`'s Step 11a now threads it through | Real end-to-end HTTP proof: created company → 9/9 departments carried non-null `composition` (65/65 assertions) — commit `e319785` |
| No concept of a per-company agent instance — `agentRegistry.cjs` is one global Map shared by every org | New `agentInstanceRegistry.cjs` overlay + additive lookup in `executionEngine.cjs`'s `executeTask()` | Real cross-org isolation proof: two real orgs, same archetype capability, verified each dispatched task's `ctx` contains ONLY its own org's config — commit `773db77` |
| 46+12 real capabilities scattered across two disconnected runtimes, no discoverable registry | New `skillRegistry.cjs` — 58 skills seeded from the confirmed-real, deduplicated inventory | `verifyNoOrphans()` correctly reports `ok:false` pre-bootstrap, `ok:true` post-bootstrap (genuine live-registry check, not fabricated) — commit `363499a` |
| Tool-like layer was platform-scoped only, reachable only via `phase19.js`, no OS-exec tool | Extended `toolExecutionLayer.cjs`: `system:exec` tool wrapping `safe-exec.js`; org/agent-instance-scoped permission overlay | Real safe-exec integration test (allowlisted command executes; non-allowlisted command genuinely blocked) — commit `79acd4c` |
| Connector status vocabulary (`CONNECTED\|READY\|PARTIAL\|MISSING\|NOT_APPLICABLE`) didn't match the mission's requested richer states | Additive `_mapLegacyStatus()` derivation, no connector function modified | Verified against real, already-recorded data: `pay:razorpay`'s real HTTP-401 failure correctly maps to `AUTH_FAILED`, never a fabricated `CONNECTED_VERIFIED` — commit `9296b13` |
| `missionOrchestrator.cjs` had no way to express Approval/Wait/HumanTask nodes | Additive `nodeType` field (14 types), `extraStages` support, new blocking statuses + `resolveBlockingStage()` | Caught and fixed a real bug during testing: missions incorrectly stayed `"executing"` while blocked on nothing — commit `0f2a62e` |
| `approvalQueue.cjs`/`approvalEngine.cjs` had **zero** test coverage despite being real, populated services | New dedicated test suite; proved the new Approval node genuinely calls the real queue | 8 new tests, real request creation/approval/rejection — commit `d34514a` |
| The 12-node composition chain had never been traced end-to-end as one path | Wired Skill/Tool/Connector/Approval resolution into `executeTask()`, plus telemetry + a new `agentInstanceRegistry.recordObservation()` | Real proof: a high-risk skill's handler is verified to NEVER run before a genuine, independently-retrievable approval request is granted — commit `a2de98f` (**STOP-condition checkpoint**) |
| Lessons' `applied` field was always `false` — zero write-back existed anywhere | Additive `preferenceWeight` on `AgentRecord` (tie-break only, never overrides load) + `applyLearningRecord()` (requires explicit `approvedBy`) | Proved via filesystem-write spy: `applyLearningRecord()` never writes a `.cjs`/`.js`/`.ts` file — commit `cb92f89` |
| A tested, committed repository-editing bundle never became a registered, usable capability | New `registerCapabilityFromBundle()` (registers `pending`, never `active`) + `approveCapabilityFromBundle()` (requires a genuinely approved real request) | Full real proof: pending → blocked → approved via real queue → active → composable; rejection permanently blocks activation — commit `dbb4004` |

---

## 3. What was genuinely created (new files, minimal by design)

| File | Purpose |
|---|---|
| `backend/services/capabilityContract.cjs` | Schema/validation for the 18 composition entity kinds; structurally rejects raw secret fields |
| `backend/services/agentInstanceRegistry.cjs` | Agent Factory instance overlay (org-scoped config on top of stateless archetypes) |
| `backend/services/skillRegistry.cjs` | Discoverable skill registry (58 real skills seeded, `verifyNoOrphans()`, `activateSkill()`, `isComposableNow()`) |
| `docs/audits/UNIVERSAL-COMPOSITION-ENGINE-REALITY.md` | This report |
| 12 new test files under `tests/runtime/` | See §6 |

Everything else was an **extension** of an existing file (`organizationService.cjs`, `companyFactory.cjs`, `companyDashboard.cjs`, `toolExecutionLayer.cjs`, `integrationConnectors.cjs`, `missionOrchestrator.cjs`, `executionEngine.cjs`, `agentRegistry.cjs`, `continuousLearningEngine.cjs`, `repositoryEditingEngine.cjs`) — 3 new service modules total against an 18-phase mission, consistent with "search before creating."

---

## 4. Commits (this mission)

```
105339a feat(composition): Phase 1 — Universal Capability Contract
e319785 feat(composition): Phase 3 repair — persist department composition onto org records
773db77 feat(composition): Phase 4 — Agent Factory instances
363499a feat(composition): Phase 5 — Skill Registry
79acd4c feat(composition): Phase 6 — Tool Fabric consolidation
9296b13 feat(composition): Phase 7 — Connector Registry status vocabulary mapping
0f3eecc test(composition): Phase 8 — Credential Vault reference-only discipline proof
0f2a62e feat(composition): Phase 9 — Workflow Engine node types
d34514a test(composition): Phase 10 — Approval + Safety wiring coverage
a2de98f feat(composition): Phase 11 — Universal Execution Runtime (STOP-condition checkpoint)
cb92f89 feat(composition): Phase 12 — Learning Loop approval-gated write-back
dbb4004 feat(composition): Phase 13 — Capability Evolution registration (Cases C/D)
```

No merge, no push, no credentials committed. `scratchpad/` (ephemeral verification scripts) added to `.gitignore` after an unrelated stray commit (`57cdbcd`, not created by this work — an out-of-band VSCode auto-commit) was found and reset.

---

## 5. Tests

12 new test files, 302 tests passing together across the broadest regression run (existing 8-file core runtime suite + all 12 new composition-engine files + 2 real workflow tests), run with `--test-concurrency=1`.

**Known testing-infrastructure finding (not a logic defect):** running many `tests/runtime/*.test.cjs` files concurrently (Node's default) causes intermittent, non-deterministic failures because several files share unlocked `data/*.json` fixtures (`skills.json`, `agent-instances.json`, `tool-permissions.json`) with no file locking — concurrent processes race on read-modify-write. Confirmed via two full-suite runs producing *different* failing tests each time, then confirmed the flakiness vanishes entirely with `--test-concurrency=1` (188/188, then 207/207, then 302/302 — all clean). This is a pre-existing class of issue (the same JSON-file-without-locking pattern used throughout the codebase), not something introduced by or unique to this mission's code. Recommend fixing in a dedicated testing-hardening pass: either give each test file a unique data-file suffix, or standardize on sequential test execution for `tests/runtime/`.

A second, unrelated pre-existing hang was found: `tests/runtime/odi-x-v1.test.cjs` hangs indefinitely when run as part of the full suite (confirmed via process inspection — stuck mid-benchmark-scenario for 50+ minutes in one observation). Not touched by this mission's changes; flagged for separate investigation.

---

## 6. Exact counts

| Layer | Count | Detail |
|---|---|---|
| **Agent archetypes** | 38 registered (real, `bootstrapRuntime.cjs`) | Unchanged this mission |
| **Skills registered** | 58 (46 from `agentRegistry` + 12 from `engineeringCapabilities`) | All seeded `healthStatus:"active"`; `verifyNoOrphans()` proves 0 orphans once bootstrapped |
| **Tools registered** | 9 (github, gmail, slack, notion, gdrive, telegram, openrouter, ollama, **system:exec** [new]) | 1 new tool added this mission |
| **Connectors with real health** | 65 recorded; composition-status distribution: 42 NEEDS_CREDENTIALS, 12 NOT_IMPLEMENTED, 4 CONNECTED_VERIFIED, 4 CONFIGURED_UNVERIFIED, 3 AUTH_FAILED | Derived from real, already-probed data — 0 fabricated |
| **Departments with persisted composition** | 33 templates; composition field now persisted on every auto-created department (was 0 before this mission — full field was previously discarded) | Verified via real end-to-end HTTP test |
| **Approval categories with real execution-layer enforcement** | 2 confirmed pre-mission (refund, production deploy) + Approval/HumanTask/Wait nodes now available as a reusable workflow primitive | ~13 categories still have no real executing action to gate — correctly NOT fabricated |
| **New test files** | 12 (`capability-contract`, `department-template-registry`, `agent-instance-registry`, `skill-registry`, `tool-fabric`, `connector-composition-status`, `credential-reference-discipline`, `mission-orchestrator-nodetypes`, `approval-queue-engine`, `universal-execution-runtime`, `learning-loop-writeback`, `capability-evolution`) | 122 individual test cases across these files |

### Completion percentages (honest, not rounded up)

| Component | Status |
|---|---|
| Universal Capability Contract | 100% — all 18 kinds defined, validated, secret-rejection proven |
| Company Factory blueprint validation against the contract | **0%** — Phase 2 not executed this mission (deferred, see §7) |
| Department Factory persistence | 100% — composition now genuinely persisted and queryable |
| Agent Factory instances | 100% of the additive-overlay design; **0%** of a hypothetical "multiply AgentRecord per org" alternative (deliberately rejected, see plan) |
| Skill Registry | 100% of the 58 confirmed-real skills; explicitly does not claim the mission's aspirational "~90 skills" target (that gap was already documented honestly in the prior 100-Company mission and remains unchanged) |
| Tool Fabric consolidation | 1 of 3 disconnected tool-like layers (`toolExecutionLayer.cjs`) extended; `adapters/adapterCapabilityRegistry.cjs`'s `KNOWN_CAPABILITIES` fold-in was scoped out (not executed — see §7) |
| Connector Registry vocabulary | 100% of the mapping layer; connector coverage itself unchanged from the prior mission's audit (42/65 still NEEDS_CREDENTIALS — a credentials problem, not a code gap) |
| Credential Vault discipline | 100% in new registries; `founderVault.js`'s plaintext-reveal route and `secretVault.cjs`'s convention-only org-scoping remain **unfixed by design** (flagged, explicitly out of scope) |
| Workflow Engine node types | 14/14 node type names declared; 3/14 (Approval, Wait, HumanTask) have genuinely new status-handling logic; the other 11 reuse existing mechanisms (Parallel/Retry already real; Trigger/Condition/SkillExecution/ToolExecution/ConnectorAction/Fallback/Verification/Completion are currently just labels with no dedicated new logic beyond the default AgentAction path) |
| Approval + Safety wiring | 100% of the Approval-node → real-queue connection; ~13/15 requested approval categories still have no real action to gate (unchanged, correctly not fabricated) |
| Universal Execution Runtime | 100% — the full 9-step chain (Instance→Skill→Tool→Connector→Approval→Execute→Verify→Telemetry→Memory) is wired and proven with real blocking/unblocking behavior |
| Learning Loop | 1 of many possible write-backs implemented (preferenceWeight nudge); the broader "recommendation → workflow parameter improvement proposal" surface described in the original mission text is **not** built — this is the narrowest possible closing of the `applied:false` gap, not a general learning-to-code system |
| Capability Evolution | Cases A/B (compose/repair) require no new code (confirmed via existing registries); Cases C/D (new skill/tool) have a real registration+approval path; Case E (new connector) reuses the existing connector-function shape but has **no new code or test proving it** — not executed this mission |
| Auto-composition test (10 niches) | 100% run; **honest finding: only 3/10 niches (SaaS, Ecommerce, Marketing agency) matched a genuinely dedicated `businessTemplateEngine.cjs` pattern — the other 7 silently fell back to the generic `saas` default.** This is a pre-existing template-inference coverage gap, not introduced by this mission, but confirmed and documented here for the first time with direct evidence. |
| Future niche test (5 niches) | 100% run; **all 5 (space, quantum, drone delivery, carbon credit, neurotech) fell back to defaults or coincidental keyword matches — zero genuine gap-detection occurred at the template-inference layer.** No new fake capability was added to compensate. |
| Frontend exposure | **Explicitly not built this mission.** 7 named components (`AgentRegistryCenter`, `AgentFactoryCenter`, `ToolFabricCenter`, `IntegrationCenter`, `RecommendationCenter`, `AgentActionCenter`, `AutonomousAgentDashboard`) confirmed global/platform-scoped with zero `orgId` filtering in either the frontend or their backend routes (`phase18.js`/`phase19.js`) — threading real org-scoping requires new backend filtering, which is out of this mission's scope per its own "no architecture expansion" rule. `WorkflowAutomationCenter.jsx` confirmed as a 48-line placeholder with zero backend API calls — genuinely unfinished, not touched. |

---

## 7. Explicit yes/no answers (mission's required format)

- **Can JARVIS compose the original 100 companies?** Partially, and honestly less than the prior mission's own aspirational framing suggested: the *department/skill composition mechanics* work and are now persisted/queryable, but *template inference* (which niche → which template) only genuinely recognizes 3 of the 10 niches tested here via dedicated keyword patterns — the rest silently default to `saas`. This was true before this mission too; it is now directly confirmed with evidence rather than assumed.
- **Can it identify capability gaps for an unknown Company #101?** Yes, for the *department/skill* layer (`isComposableNow()`/`verifyNoOrphans()` are real, live-registry checks, proven to correctly report both success and failure). No, for the *template-inference* layer — an unrecognized niche is currently misclassified as `saas` rather than flagged as a gap; `inferTemplate()` has no "no match" branch to report honestly.
- **Can it compose a new agent without writing a new file?** Yes, for a per-company configured instance of an *existing* archetype (`agentInstanceRegistry.register()`, proven with real cross-org isolation). No, for a genuinely new archetype — that still requires a new handler function registered in `agentRegistry.cjs`, unchanged from before this mission (a deliberate, documented design decision, not an oversight).
- **Can it discover missing skills/tools/connectors?** Yes for skills (`skillRegistry.verifyNoOrphans()`) and tools (Tool Fabric's `resolvePermission()` genuinely denies ungranted tools). Connectors: yes, via the existing `getCompositionStatus()`, unchanged mechanism, now with richer vocabulary.
- **Can it safely create/register a new reusable capability?** Yes — `registerCapabilityFromBundle()`/`approveCapabilityFromBundle()` proven end-to-end: pending, non-composable, until a real human approval via `approvalQueue.cjs` is granted. Rejection permanently blocks activation. No path exists to skip this.
- **What still requires a human?** (1) Every high-risk skill execution for an org-scoped task (Phase 11's approval gate). (2) Every new capability's activation (Phase 13). (3) Every operational learning write-back (`applyLearningRecord()`'s mandatory `approvedBy`). (4) Template-inference misses for unrecognized niches — no automated fallback beyond the `saas` default exists; a human must currently notice and correct a misclassified company.

---

## 8. Scale-boundary honesty (unchanged from the prior mission's own finding)

This mission does not claim to prove companies #101-200+ scale. The architecture remains single-process, flat-JSON — `data/skills.json`/`data/agent-instances.json` are not claimed to hold up under concurrent multi-hundred-company write load (in fact, this mission's own testing directly demonstrated JSON-file write races under concurrency, at test-suite scale — see §5). Phases 14-15 prove *compositional coverage*, not *scale or reliability at scale*.

---

## 9. Remaining P0 / P1 / blockers

**Remaining P0:** none identified as newly introduced by this mission. Pre-existing P0s from prior missions are unchanged (out of scope here).

**Remaining P1 (this mission's own explicit scope gaps):**
- Phase 2 (Company Factory blueprint contract validation) — not executed.
- Phase 16 (frontend org-scoping) — not built; requires new backend route filtering first (see §6).
- `adapters/adapterCapabilityRegistry.cjs` fold-in into the Tool Fabric — not executed.
- Capability Evolution Case E (new connector) — no new code or test.
- `businessTemplateEngine.cjs`'s template-inference coverage gap (7/10 niches, 5/5 future niches falling back to defaults) — newly *confirmed with evidence* by this mission, not newly *created* by it; recommend a dedicated future mission to add dedicated patterns for at minimum: real-estate, manufacturing/industrial, agriculture/IoT, biotech/scientific, logistics, media/content, and a genuine "no match, flag as gap" branch instead of a silent `saas` default.

**External credential/infrastructure blockers:** unchanged from the prior 100-Company mission's audit — 42/65 connectors remain `NEEDS_CREDENTIALS` (a credentials-availability problem in this dev environment, not a code gap); `pay:razorpay` and `ai:openai`'s real, invalid dev-environment credentials remain invalid (correctly reported as `AUTH_FAILED`/`CONFIGURED_UNVERIFIED`, not silently marked healthy).

**Testing-infrastructure blockers (newly found this mission):** the shared-JSON-file test race (§5) and the pre-existing `odi-x-v1.test.cjs` hang — both flagged for a future testing-hardening pass, neither blocking this mission's own correctness (both confirmed non-issues once isolated).

---

## 10. Exact next recommended mission

**"Composition Reality P2: Template Inference & Frontend Exposure"** — two independently schedulable halves:
1. Add dedicated `businessTemplateEngine.cjs` patterns for the 7 confirmed-gap niches (real-estate, manufacturing, agriculture/IoT, biotech, logistics, media, and a generic "physical/industrial" catch-all), plus a genuine unmatched-niche gap-flag instead of the silent `saas` default — this directly closes the most concrete, evidenced gap this report found.
2. Backend route filtering (`orgId` query param support in `phase18.js`/`phase19.js` and siblings) + frontend context-threading across the 7 named components — the actual Phase 16 work, scoped as its own mission since it's a multi-tenancy retrofit, not composition-engine wiring.

A secondary, lower-priority mission: a testing-infrastructure hardening pass for the shared-JSON-file race and the `odi-x-v1.test.cjs` hang found during this work.

---

## COMPLETION GAPS UPDATE (this session) — Phases 1-8 closed

This update closes exactly the gaps §10 above named as the next recommended mission, plus the two Phase 2/16 gaps flagged as explicitly not executed in the original report. 8 commits, `08e928c`..`717f6de`.

### 1. Blueprint Contract Validation (was: not executed)
`capabilityContract.cjs` gained `validateBlueprint()` — validates the full composed blueprint (Company + Departments/Agents/Skills/Tools/Connectors/CredentialRequirements/Workflows/Permissions/ApprovalPolicies/MemoryScope/KnowledgeScope/KPIs/Budget) plus 6 reference-chain checks (department→agent, department→skill, agent→skill, skill→tool, tool→connector, connector→credentialRequirement, action→approvalPolicy). Wired into `companyFactory.cjs` as a new Step 7c — a structurally invalid blueprint now genuinely rejects company creation. Found and fixed a real gap this surfaced: `departmentTemplateRegistry.cjs`'s "executive" template referenced 2 skill names (`strategy`, `executive_summary`) never registered in `skillRegistry.cjs` — added both. Skill count: 58 → **60**.

### 2. Template Inference Engine (was: silent SaaS fallback, only 3/10 niches matched)
New `templateInferenceEngine.cjs` — ~20 structural dimension rules (not per-niche strings) mapping a structured company definition to capability tags, unioned across every genuinely-matched base template, fed into the existing `departmentTemplateRegistry.deriveDepartmentsForTemplate()`. Returns a genuine `CAPABILITY_GAP` (with exact missing pieces) when nothing resolves, instead of defaulting to "saas". Two real bugs found and fixed during development: a naive tag-overlap rule spuriously matched unrelated templates via generic cross-cutting tags (crm/billing/reporting); a generic `regulated:true` rule spuriously added health-specific `hipaa_compliance` to every regulated business (crypto exchanges, etc.).

### 3. Original 100-Company Inference Test
All 100 original niches run through the new engine (`docs/audits/original-100-companies.json`, `tests/runtime/original-100-inference.test.cjs`). **Result: 100/100 correctly classified, 0 CAPABILITY_GAP, 0 silent SaaS fallback** — see the corrected status table below. 26/100 companies genuinely combine 2+ base templates.

### 4. Unknown Niche Test
22 temporary niches genuinely outside the original 100 (space/quantum/drone/carbon-credit/neurotech/cannabis/firearms/crypto/aerospace/deep-sea-mining/vertical-farming/nuclear/podcast/NFT/livestream/funeral-home/pet-grooming/ride-hailing/warehouse-robotics/genomics/weather-derivatives/submarine-cable). All resolve honestly — reusable capabilities recognized where applicable (podcast/NFT/ride-hailing correctly reuse `marketplace`), missing capabilities identified honestly (drone delivery/deep-sea mining/warehouse robotics never claim false `COMPOSABLE_NOW`), no capability fabricated to pass tests (verified structurally — the engine exports only one read-only function).

### 5. Frontend Org/Company Scoping — real cross-tenant IDOR found and fixed
`GET /company-factory/companies` (list), `GET /company-factory/companies/:id`, and `.../detail` had **zero authorization** — `companyLifecycleEngine.getCompany(id)`/`companyDashboard.getCompanyDetail(id)` are pure id-lookups with no ownership check. Any authenticated account could view any other org's company by guessing/enumerating an id; the list route returned every company across every org. Fixed via the existing `_requireCompanyOrgPermission()`/`organizationService.hasPermission()`/`listOrgs()` mechanisms (no new permission model). Verified with a real, live-server HTTP test: two independent orgs, Org A denied (403) access to Org B's company/detail in both directions, list never leaks cross-org, own-org access preserved.

### 6. Composition Inspector UI
`companyDashboard.getCompanyComposition()` (new) + `GET /company-factory/companies/:id/composition` (new, same auth as #5) aggregate real backend state — Departments/Skills (resolved against the real Skill Registry)/Connectors (real status)/Credential readiness (real vault state, never a value)/Approval policies/Capability gaps (re-derived via the Phase 2 engine). Frontend: extended `CompanyFactoryCenter.jsx`'s existing `CompanyDetail` component with new `ic-detail-section` blocks (same design pattern as the existing Departments section) — no redesign, no mock cards. Verified via unit tests, real HTTP, and real Playwright browser session.

### 7. Test Fixture Concurrency Reliability
Fixed the confirmed shared-JSON race (§5 of the original report): 3 services (`skillRegistry.cjs`, `agentInstanceRegistry.cjs`, `toolExecutionLayer.cjs`) now resolve their data file path through an optional `JARVIS_TEST_DATA_SUFFIX` env var — unset (real usage) is unchanged; 8 test files set a unique per-process suffix, giving each genuinely isolated fixtures instead of forcing sequential execution (which the mission explicitly disallowed as a "fix"). Verified via 3+ consecutive full-suite runs (298 tests each, 0 failures) plus a dedicated test spawning two real concurrent child processes proving zero cross-contamination.

### 8. Final Verification
393 tests (full `tests/runtime/*` + `tests/workflows/*` composition-relevant suite) + 25 (V5 tenant-isolation/RBAC) + 103 (injection security) + 31 (MFA security) + 6 (webhook security) = **558 tests passing**, real HTTP runtime throughout, real Playwright browser verification.

### Corrected 100-Company status distribution

| Status | Count |
|---|---|
| COMPOSABLE_NOW | 0 (honest — 42/65 connectors still `NEEDS_CREDENTIALS` in this dev environment) |
| NEEDS_CREDENTIALS | 61 |
| NEEDS_CONNECTOR | 0 |
| NEEDS_CAPABILITY | 23 |
| NEEDS_EXTERNAL_INFRA | 16 |
| UNSUPPORTED | 0 |
| **CAPABILITY_GAP** | **0** (was the core problem this update fixes) |

### Updated exact counts

Agent archetypes: 38 (unchanged) · Skills: 60 (was 58) · Tools: 9 (unchanged) · Connectors: 65 recorded (unchanged) · Department templates: 33, of which 22 composable now / 11 genuinely `requiresNewCapability` (HR, Legal/Compliance, Procurement, Supply Chain, Inventory/Warehouse, Logistics, 3D/CAD, Manufacturing, IoT/Robotics, Energy/Infrastructure — unchanged from the original report, honestly still unbuilt).

### Explicit answers (mission's required questions)

1. **Does any niche still silently fall back to SaaS?** No — verified directly across the original 100 (0 residual over-fallback cases) and the 22 unknown niches (0 cases). A niche with no genuine signal now returns `CAPABILITY_GAP`, never a defaulted template.
2. **Can Company #101 with an unknown niche be analyzed without hardcoding it?** Yes — the 22-niche unknown test proves this: genuinely novel niches (space, quantum) either honestly gap or reuse an existing template via structural dimension signals, never a per-niche hardcoded rule.
3. **Can JARVIS tell exactly which reusable capability is missing?** Yes — `capabilityGap.missingDepartments`/`missingConnectors`/`missingExternalInfra` name the exact missing pieces, sourced from the real, live department/connector registries, never guessed.
4. **Can it compose a specialized agent from existing skills/tools without a new agent file?** Unchanged from the original report — yes for a per-company configured instance of an existing archetype (`agentInstanceRegistry`); no for a genuinely new archetype (still requires a new handler file, a deliberate design boundary, not a gap).
5. **Are frontend company/org boundaries enforced server-side?** Yes, now — this was a real, previously-unenforced gap (§5 above), fixed and verified with a live-server cross-org HTTP test in both directions.

### Remaining, honestly out of scope for this update
- `founderVault.js`'s plaintext-reveal route and `secretVault.cjs`'s convention-only org-scoping — unchanged, still flagged, not fixed (security-sensitive vault-internals work, a separate concern).
- The `odi-x-v1.test.cjs` hang and a rare (~1/14 observed) `missionMemory.cjs`/`missions.json` write race — both pre-existing, both outside this update's 3-file scope, both documented for a future testing-hardening pass.
- 11/33 department families and ~13/15 approval categories genuinely have no real code — unchanged, honestly still `requiresNewCapability`/ungated, not fabricated.
