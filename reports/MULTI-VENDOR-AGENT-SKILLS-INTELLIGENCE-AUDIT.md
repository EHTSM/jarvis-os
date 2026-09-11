# Multi-Vendor Agent Skills Intelligence & JARVIS Consolidation Audit

**Mission 30** — 2026-08-22
**Branch:** security/reality-completion (no commits made)
**Follows:** [Mission 29 — JARVIS Skill System Consolidation Audit](JARVIS-SKILL-SYSTEM-CONSOLIDATION-AUDIT.md) (single-vendor NVIDIA pass; this mission repeats the exercise across all credible vendors and deepens the internal trace)

## Bottom line

The **Agent Skills format** (a directory with a `SKILL.md` file — YAML frontmatter `name`/`description`/
optional `license`/`compatibility`/`metadata`/`allowed-tools`, followed by Markdown instructions,
per the vendor-neutral spec at [agentskills.io](https://agentskills.io/specification)) has become a
genuine cross-vendor standard: natively supported by Claude Code, OpenAI Codex, Google Gemini CLI /
Antigravity, and Qwen Code. Six official/credible catalogs were inventoried live (612 total `SKILL.md`
files across five vendor repos, cross-verified via GitHub's git-tree API, not estimated). After
normalizing all candidates against JARVIS's actual architecture, the finding is the same shape as
Mission 29's single-vendor result but with much richer material: **zero skills are installable
as-is** (JARVIS has no Agent-Skills-compatible runtime to install them into), but a meaningful subset
— roughly two dozen skills across four vendors — contains **reusable patterns and instructional
content genuinely worth studying**, concentrated in security review, PR/CI workflows, and React
frontend engineering. JARVIS's own internal "skill" infrastructure (`skillRegistry.cjs`,
`skillEngine.cjs`, `capabilityContract.cjs`, `agentRegistry.cjs`) was re-traced with direct,
file:line caller-evidence via two independent passes (not assumed from Mission 29's memory) and
confirmed to be a **metadata/discovery layer over existing capability handlers**, structurally
unrelated to the Agent Skills format, with **no RBAC or tenant-isolation enforcement** at that layer
today. The deepened trace surfaced two findings not previously flagged in any prior mission: (1) a
real, tested, org-scoped skill-permission/approval gate exists in `executionEngine.cjs` (blocks
`riskLevel:"high"` skills pending approval) but is **currently unreachable from any production
route** because no real caller threads `task.orgId` into dispatch; and (2) `agentRuntimeSupervisor.cjs`'s
autonomous-agent registry API (`POST /agents/runtime/registry/register`, `/supervisor/start`/`/stop`)
is gated only by `requireAuth` with **no RBAC role check**, a materially weaker permission posture
than the sibling `/workforce-os/*` routes. No architecture was built, nothing was installed, no code
was modified, `.env` untouched, nothing committed or pushed.

---

## PHASE 1 — Existing JARVIS skill/capability audit (caller-traced, not name-assumed)

This section combines direct verification performed in this session (grep/read against the live
repository) with a deeper background trace (11 systems, 55 tool calls, file:line evidence) run in
parallel during this mission. Where the deeper trace corrected or extended a fact this session had
already checked directly, that correction is noted explicitly rather than silently overwritten —
per the mission's own "trace actual callers, do not assume" standard.

### 1. `backend/services/skillRegistry.cjs` (320 lines)

1. **What it does:** A JSON-backed catalog of skill metadata records — `{id, name, category,
   description, inputSchema, outputSchema, requiredPermissions, requiredTools, optionalConnectors,
   riskLevel, executionHandler, source, version, healthStatus, createdAt}`. `executionHandler` is a
   string pointing to a real capability id in `agentRegistry.cjs` (46 of the seed entries) or
   `engineeringCapabilities.cjs` (12), plus 17 "capability-buildout" entries reusing a generic `"ai"`
   handler. Live-read this mission: **77 records** in `data/skills.json` (grown from the original
   58-seed `SEED_SKILLS` array).
2. **Consumers (direct callers, confirmed both by this session's grep and the deeper trace):**
   `capabilityContract.cjs` (validates on `registerSkill()`), `repositoryEditingEngine.cjs` (Capability
   Evolution registration/approval, lines 622/680/743), `templateInferenceEngine.cjs`,
   `companyFactory.cjs` (blueprint assembly, line 56), `companyDashboard.cjs` (composition inspector,
   line 191), and — a finding the deeper trace surfaced that this session's own faster grep missed —
   `agents/runtime/executionEngine.cjs:239`, which performs a **live dispatch-time lookup** against
   this registry under a specific condition (see System 11 for the important caveat: this path is
   currently unreachable in production).
3. **Discovery:** Self-seeding from a hardcoded `SEED_SKILLS` array on first load, persisted after
   that to `data/skills.json` (confirmed present on disk, ~48KB).
4. **Invocation:** No dedicated HTTP route of its own. Reached indirectly via `/company-factory/*`
   routes and, per the deeper trace, directly inside `executeTask()`'s dispatch path — but only for
   org-scoped tasks that no real production caller currently sends (System 11).
5. **Executable or instructional:** Neither in the Agent-Skills sense — pure metadata/lookup;
   `executionHandler` points to real code elsewhere. It does, however, gate real permission/approval
   logic when reached via the org-scoped path (System 11) — a materially real, if unreachable,
   control.
6. **Security boundary:** No auth/permission check inside the module itself (confirmed via direct
   grep for `requirePermission|checkRole|rbac|RBAC` — zero matches); `registerSkill()` validates
   shape against `capabilityContract.cjs` but performs no auth check of its own — auth is enforced
   only by callers' HTTP routes.
7. **Tenant boundary:** None (confirmed via direct grep for `orgId|tenantId|workspaceId` — zero
   matches). Single global `data/skills.json`, no per-org scoping field on any record.
8. **Permission model:** A `requiredPermissions` field and a `riskLevel` field (`low`/`medium`/`high`
   — confirmed live, e.g. `payment_link` is `riskLevel: "high"`) exist per record, but this session's
   direct read found no code in the module enforcing either before a lookup. The deeper trace found
   one genuine exception: `activateSkill()` is documented and verified as callable only from
   `repositoryEditingEngine.approveCapabilityFromBundle()`, itself gated on a real
   `approvalQueue.cjs` human-approval step (`repositoryEditingEngine.cjs:734-744`) — a real approval
   gate, but only for *newly registered* skills via Capability Evolution, not for using existing ones.
9. **Testing: corrected finding.** This session's initial pass found `tests/runtime/skill-registry.test.cjs`
   and confirmed **46/46 passing** (run alongside `capability-contract.test.cjs`). The deeper trace
   additionally found `tests/runtime/capability-evolution.test.cjs` (direct `require`),
   `tests/runtime/blueprint-contract-validation.test.cjs`, and `tests/runtime/composition-inspector.test.cjs`
   as further real coverage reached transitively through `companyFactory.cjs`/`companyDashboard.cjs`
   wiring — broader test coverage than either pass alone would have reported.
10. **Versioning:** Every record carries a static `version` string (e.g. `"1.0.0"`); no migration
    logic exists.
11. **Persistence:** `data/skills.json`, confirmed present and non-empty on disk this mission.
12. **Duplication/overlap:** The module's own header comment explicitly documents that it
    consolidates what was scattered across `agentRegistry.cjs` and `engineeringCapabilities.cjs`,
    and explicitly *rejects* `skillEngine.cjs`'s `AGENT_CATALOGUE` as a source, calling it
    "confirmed DEAD" in its own words.
13. **Could it safely consume an external Agent Skill:** Structurally partial, not ready — its
    schema already has `name`/`description`/`version`/metadata-shaped fields (the closest of any
    JARVIS construct to the Agent Skills frontmatter), but it has no concept of a Markdown
    instruction body, no `SKILL.md` parser, and — per points 6-8 — no permission/tenant enforcement
    that would need to gate an externally-sourced entry before it could be trusted.

### 2. `backend/services/skillEngine.cjs` (274 lines)

1. **What it does:** A hardcoded workforce-capacity-simulation catalog, `AGENT_CATALOGUE` — the
   deeper trace read the array directly and counts **36 entries** across 5 simulated "orgs"
   (engineering/business/knowledge/evolution/executive), correcting Mission 29's "27 entries" count
   (itself flagged there as inconsistent with various stale docs claiming 36-39) — this mission's
   direct source read of the array literal is the most authoritative count taken so far. Each entry:
   `{id, org, skills[], specializations[], confidence, maxConcurrent, teamTypes[]}`, no execution
   handler attached to any entry. Tracks live workload/success/failure counters in a second file,
   `data/skill-registry.json` (confirmed present, ~60KB) — the catalogue itself stays in-code; only
   dynamic state persists.
2. **Consumers:** `teamBuilder.cjs`, `workforceDashboard.cjs`, `performanceEngine.cjs`,
   `capacityPlanner.cjs`, `workforceManager.cjs` — and, per the deeper trace, a genuinely live HTTP
   surface: `backend/routes/workforceOS.js`, mounted at `/workforce-os/*` in `backend/routes/index.js`.
3. **Discovery:** Hardcoded array literal; live workload merged in at read-time from
   `engineeringOrgState.cjs`.
4. **Invocation — corrected finding:** Mission 29 characterized this system as "confirmed dead, no
   execution path." The deeper trace found this needs nuance: while `AGENT_CATALOGUE` entries
   genuinely have no execution handler (still true, still not a dispatcher), the *route* built on top
   of it is real and live — `GET /workforce-os/agents` is documented in the route file's own
   security-audit comment as "the ONLY confirmed real frontend consumer" (`AgentRegistryCenter.jsx`
   calls exactly this one route). So: dead as an execution mechanism, live as a read-only data source
   for one frontend panel.
5. **Executable or instructional:** Descriptive/matching only, not executable — consistent with both
   passes' findings.
6. **Security boundary:** `requireAuth` on all `/workforce-os/*` routes (confirmed via the route
   file's own comment, which also documents a *prior* bug where this middleware silently no-op'd
   due to a bad require path, since fixed); mutation routes additionally gated with `operatorOnly` —
   a real, if partial (not full RBAC), permission check, more than System 1 has.
7. **Tenant boundary:** None — the route file's own code comment states explicitly that
   `workforceManager.cjs` and its sibling files "have zero orgId concept — real, platform-wide,
   mutable state."
8. **Permission model:** `operatorOnly` role check on mutation routes; no approval-queue gate.
9. **Testing:** Referenced by `tests/runtime/post-omega-p7.test.cjs`; no dedicated
   `AGENT_CATALOGUE`-specific test file found by either pass.
10. **Versioning:** None found.
11. **Persistence:** `data/skill-registry.json` for live agent state; catalogue itself is in-code,
    not persisted.
12. **Duplication/overlap:** Name-collides with System 1 (`skillRegistry.cjs` vs. `skillEngine.cjs`)
    but is functionally distinct (workforce capacity/matching simulation vs. execution-handler
    metadata catalog); System 1 explicitly disowns this file as a source.
13. **Could it consume an external Agent Skill:** No — static in-code array, no markdown ingestion
    concept.

### 3. `backend/services/capabilityContract.cjs` (358 lines)

1. **What it does:** A pure schema-validation module (no persistence of its own) defining entity
   "kinds" for a composed blueprint graph — the deeper trace counted **17 kinds** precisely (Company,
   Department, Agent, Skill, Tool, Connector, CredentialRequirement, Workflow, Trigger, Permission,
   ApprovalPolicy, MemoryScope, KnowledgeScope, KPI, Budget, Execution, Observation, LearningRecord).
   `validate(kind, obj)` checks required fields and — a genuine security control found by the deeper
   trace, not just documentation — actively rejects any raw secret/credential value on any entity
   (`FORBIDDEN_SECRET_FIELDS`, enforced at validation time; only `credentialRef` strings are allowed).
   `validateBlueprint()` additionally validates full cross-entity reference-chain integrity.
2. **Consumers:** `repositoryEditingEngine.cjs`, `skillRegistry.cjs` (validates new records on
   `registerSkill()`), `agentInstanceRegistry.cjs`, `secretVault.cjs`, `companyFactory.cjs`,
   `legalDocumentEngine.cjs`.
3. **Discovery:** N/A — directly required, not dynamically discovered.
4. **Invocation:** Internal function calls only; reached transitively via company-factory and
   Capability Evolution (`repositoryEditingEngine.cjs`) routes.
5. **Executable or instructional:** Neither — pure validation logic.
6. **Security boundary — corrected/strengthened finding:** This session's first pass characterized
   this file as "schema validator, not a runtime [security control]." The deeper trace found this
   understates it: the secret-field rejection (point 1 above) is a genuine, structural, enforced
   security control — any entity carrying a raw credential value is rejected at validation time, not
   merely documented as a convention.
7. **Tenant boundary:** None inherent to the validator; tenant scoping is the caller's responsibility.
8. **Permission model:** The schema defines `Permission`/`ApprovalPolicy` as blueprint *kinds* (so the
   concept exists in the data model this file validates), but the validator itself performs no
   runtime permission check — only structural consistency (e.g., that a referenced skill ID exists).
9. **Testing:** `tests/runtime/capability-contract.test.cjs` and
   `tests/runtime/blueprint-contract-validation.test.cjs` — the deeper trace confirmed the latter
   specifically tests positive/negative cases including explicit secret-rejection assertions, plus
   `tests/legacy/42-capability-core.test.cjs` and `tests/legacy/43-capability-ops.test.cjs`. Ran
   clean this mission (46/46, combined 3-file run with System 1's tests).
10. **Versioning:** `version` is a required field on the `Skill` kind schema; no migration logic in
    the validator itself.
11. **Persistence:** None — confirmed by the file's own doc comment: "This module does NOT persist
    anything."
12. **Duplication/overlap:** Downstream dependency of System 1; explicitly designed (per its own
    comment) as the single shared schema so consumers "don't each invent their own ad hoc object
    shape."
13. **Could it consume an external Agent Skill:** Its `Skill` kind schema is the closest thing in
    JARVIS to an Agent-Skills-compatible metadata contract (has `name`, `version` already), but has
    no concept of instruction-body content or bundled scripts/references/assets — a materially
    different mechanism from the actual spec.

### 4. `agents/runtime/agentRegistry.cjs` (167 lines) — the real dispatcher

1. **What it does:** The real, live in-memory agent dispatcher. An `AgentRecord` class wraps
   `{id, capabilities: Set, handler: async fn, maxConcurrent}` with a genuine per-agent circuit
   breaker (closed/open/half-open states, 5-failure threshold, 60s open window) and concurrency
   tracking; `findForCapability()` does real load-balanced selection among available, non-broken,
   under-capacity agents.
2. **Consumers — deepened this mission:** Confirmed 10+ direct callers via both passes:
   `agents/executor.cjs`, `agents/multi/agentOrchestrator.cjs`, `agents/multi/agentExecutor.cjs`,
   `agents/multi/agentSelector.cjs`, `agents/business/index.cjs`, `agents/content/index.cjs`,
   `agents/runtime/bootstrapRuntime.cjs`, `agents/runtime/taskRouter.cjs`,
   `agents/runtime/runtimeOrchestrator.cjs`, `agents/runtime/executionEngine.cjs` — plus, per the
   deeper trace, `backend/services/continuousLearningEngine.cjs` (writes `preferenceWeight`, a real
   learning-driven agent-preference mechanism, only from a function itself gated on human approval),
   `backend/services/skillRegistry.cjs` (`verifyNoOrphans()`), `departmentTemplateRegistry.cjs`,
   `companyFactory.cjs`, `missionOrchestrator.cjs`.
3. **Discovery:** Populated via `runtimeOrchestrator.cjs`'s `registerAgent()` — confirmed a thin
   pass-through to this file's own `register()` — called from `bootstrapRuntime.cjs` **29 times**
   (exact count from the deeper trace's grep, refining Mission 29's "~30" estimate).
4. **Invocation:** Live dispatch chain confirmed at both the function level (`taskRouter.cjs` →
   `executionEngine.executeTask()` → `findForCapability()`) and the process level — the deeper trace
   confirmed `backend/server.js` requires `bootstrapRuntime.cjs` at real server startup, meaning this
   is genuinely wired at boot, not dead code reachable only in tests.
5. **Executable or instructional:** Executable — the only one of Systems 1-3 that is a real runtime
   dispatcher rather than a metadata layer.
6-8. **Security/tenant/permission boundary:** Not found inside this module itself — pure in-memory
   registry, security/tenant/permission enforcement (where it exists at all) happens in callers.
   `setPreferenceWeight()` is the one exception found: documented and verified as callable only from
   `continuousLearningEngine.applyLearningRecord()`, itself gated on explicit human approval.
9. **Testing:** `tests/runtime/04-agentRegistry.test.cjs` confirmed **16/16 passing** this mission
   (baseline, run directly, unchanged); the deeper trace additionally found it's the substrate under
   many more `tests/runtime/*` files (e.g. `universal-execution-runtime.test.cjs`,
   `agent-instance-registry.test.cjs`) that exercise it indirectly without naming it.
10. **Versioning:** None.
11. **Persistence:** None — pure in-memory `Map`; all circuit-breaker/agent state resets on restart
    (confirmed by direct code read this mission).
12. **Duplication/overlap:** The genuine dispatch substrate that System 1's `executionHandler`
    strings resolve into. Distinct from System 6's separately-named `registerAgent` in
    `agentRuntimeSupervisor.cjs` (a different function in a different file — see System 6) and from
    System 2's dead `AGENT_CATALOGUE`.
13. **Could it consume an external Agent Skill:** This is the correct reuse point for any future
    *executable*-capability skill work — new capabilities would register here the way the 29
    bootstrap agents already do. No markdown-instruction-loading concept exists here today.

### 5. `agents/runtime/runtimeOrchestrator.cjs` — `registerAgent` pass-through

Confirmed by the deeper trace: `registerAgent(config)` here is a **one-line pass-through** —
`return registry.register(config)` — directly delegating to System 4's `agentRegistry.cjs`, not a
separate registry. `bootstrapRuntime.cjs` calls it 29 times at require-time to populate all real
capabilities (`"ai"`, `"crm"`, `"terminal"`, `"filesystem"`, etc.). `backend/server.js` requiring
`bootstrapRuntime.cjs` at startup is the confirmed real-boot-time wiring point. `dispatch()` (the
orchestrator's main entry) is reached from `backend/routes/runtime.js` (`POST /runtime/dispatch`),
`backend/services/agentExecutionEngine.cjs`, `runtimeActionEngine.cjs`, `executionCoordinator.cjs`,
and `missionRuntime.cjs`. **One flagged-but-unverified gap the deeper trace surfaced:**
`POST /runtime/dispatch` in `runtime.js` shows a rate limiter but no clearly-visible `requireAuth` in
the code segment read — inconsistent with most other JARVIS routes, which consistently gate with
`requireAuth`. This was not independently re-confirmed by a second read this mission and is flagged
as worth a dedicated security-audit-track follow-up, not asserted as a confirmed vulnerability here.

### 6. `backend/services/agentRuntimeSupervisor.cjs` — the OTHER `registerAgent` (I5 Registry)

A **completely separate system** from Systems 4/5 despite the identical function name
`registerAgent` — this one is a long-running **autonomous-agent lifecycle supervisor** (tick-based
planner/reviewer/verifier + developer/tester/security/documentation/crm/marketing/executive roles),
not a task dispatcher. The deeper trace found `BUILTIN_AGENTS` is a 10-entry hardcoded array
auto-registered on `start()`, and — critically — the file's own bug-fix comment states **210 agents
exist at runtime in practice**: the 10 builtins plus ~200 more added dynamically via
`registerAgent()` calls scattered across every `*Org.cjs`/`*OrgWorkflow.cjs` module (engineering/
business/executive/enterprise/civilization/ecosystem/knowledge/evolution/platform orgs) — this
confirms and sharpens Mission 29's "10 builtin + 200 registered dynamically" figure with a direct
source citation. **Live HTTP-wired:** `backend/routes/agentsRuntime.js` mounts real routes
(`POST /agents/runtime/supervisor/start`/`/stop`, `POST /agents/runtime/registry/register`, `DELETE
.../registry/:id`). **Security finding:** all routes are gated with `requireAuth`, but — a new
finding this mission, not previously flagged — **no `operatorOnly` or any RBAC role check exists
anywhere in this file**, meaning any authenticated user can register/unregister or start/stop
platform-wide autonomous agents via this API. This is a **materially weaker permission posture than
System 2's** `/workforce-os/*` routes, which do gate mutations with `operatorOnly`. No tenant
boundary exists (confirmed zero `orgId`/`tenant`/`workspace` matches in the file). No dedicated test
file was confirmed for this specific registry API in either pass.

### 7. `agents/runtime/adapters/adapterCapabilityRegistry.cjs` (141 lines)

A narrow, single-consumer registry (`executionAdapterSupervisor.cjs` is its only caller, confirmed
by both passes) for **execution adapters** (terminal/filesystem/git/browser/process actions), not
agents or skills — 14 known capability types. Notably carries real, structural safety filters:
adapter manifests declare `sandboxed`/`writeAllowed` flags that `findCapable()` can filter on via
`requireSandboxed`/`requireWriteAllowed` options — a genuine safety mechanism, though its enforcement
depends on callers actually passing those options (not independently verified as always-applied).
Covered by `tests/legacy/83-real-execution-adapter-integration.test.cjs`. In-memory only, capped at
100 adapters, no persistence. No Agent-Skills readiness — fixed adapter-action name matching, no
markdown ingestion.

### 8. Prompt/instruction-loading mechanism — confirmed absent

Both passes independently confirm: **no dedicated markdown-instruction-loading mechanism exists
anywhere in JARVIS.** `systemPrompt` hits are inline string literals built at call time in a handful
of files (`screenshotAnalyzerService.cjs`, `contentSEOEngine.cjs`, `codeGeneratorAgent.cjs`,
`collaborationLayer.cjs`) — four independent, unrelated inline prompt-builders, not a shared system.
The deeper trace additionally confirmed via repo-wide grep: **zero hits** for `gray-matter`,
`front-matter`, or `frontmatter` as either a dependency or an import anywhere in the codebase, and
zero instances of a runtime `readFileSync(...).md` pattern in `backend/services/` or `agents/`.
Building `SKILL.md` ingestion into JARVIS would require genuinely new code: a YAML-frontmatter
parser, a description-based trigger-match step, and a context-injection point into `aiService.js`'s
message construction — none of this exists today in any form.

### 9. Tool-registration mechanism — corrected finding: two real systems exist

This session's own direct grep for `registerTool|toolRegistry` returned zero matches and concluded
"no function-calling/tool-use layer exists." **The deeper trace found this was too narrow a search
and is corrected here:** two genuine, separately-named tool systems exist under different
identifiers:

- **(a) LLM function-calling bridge** — `backend/services/aiService.js` exports `chatWithTools()`,
  with real per-provider implementations building actual `tools:`/`function_declarations` payloads
  for OpenAI-compatible, Claude, and Gemini APIs. Tool definitions are sourced from
  `backend/services/connectorToolBridge.cjs`'s `getConnectorTools()` — 3 tools
  (`list_connected_services`, `get_connector_status`, `get_connector_auth_url`), backed by real
  `oauthIntegrationLayer.cjs` execution. **Genuinely wired to a live route:**
  `POST /ai/chat-with-tools` (`backend/routes/ai.js`), gated with `requireAuth` + `attachOrg` +
  rate-limiting + `billing.requireUsageQuota` — per the deeper trace, **the strongest, most
  tenant-aware security posture found anywhere in this entire Phase 1 audit** (org-scoped usage
  metering, per-user OAuth connection scoping).
- **(b) "Tool Fabric"** — `backend/services/toolExecutionLayer.cjs`'s `TOOL_DEFS`, a declarative
  registry of real external-integration tools (GitHub, Slack, Telegram, OpenRouter, Ollama) with
  actual outbound HTTP execution. Required by 12 files including `engineeringAutopilot.cjs`,
  `codeReviewEngine.cjs`, `gitHubEngineeringAgent.cjs`, `repositoryEditingEngine.cjs`. Its tenant
  boundary was **not fully verified** by the deeper trace — flagged explicitly as needing a further
  read to confirm org-scoping on the actual execution functions, rather than asserted either way.

This corrects a real gap in this session's first pass: JARVIS is **not** entirely without a
tool-registration concept — it has one narrow but genuinely production-live one (`chatWithTools()` +
`connectorToolBridge.cjs`, 3 tools) plus a broader, less-verified one (Tool Fabric). Neither is
built for ingesting *external* SKILL.md-shaped tool definitions; both use fixed in-code JS-object
tool schemas.

### 10. `backend/services/rootCauseAnalysisEngine.cjs` — Playbooks (Sprint 3), confirmed and sharpened

Both passes confirm the "playbook" concept here is auto-generated remediation output, not an
externally-authored instruction package. The deeper trace read the 5 hardcoded problem-class
detectors directly and confirmed **4 of 5 currently carry an active `playbookEntry`** (the 5th,
`deterministic_execution_retry`, is `status: "resolved"` and correctly has no playbook) — this
precisely confirms Sprint 3's "4 playbooks" figure from project memory with a direct source read,
rather than leaving it as an unverified carry-forward. Playbook content is genuinely instructional
(numbered remediation steps addressed to a human engineer, e.g., specific function-call sequences to
add) but is generated programmatically from log analysis, not loaded from a file, and is not
injected as LLM context — a meaningfully different concept from an Agent Skill.

### 11. `agents/runtime/taskRouter.cjs` + `agents/runtime/executionEngine.cjs` — the real dispatch path, with a key new finding

The canonical real dispatch chain: `taskRouter.cjs`'s `TASK_TYPE_MAP` (~40 task-type-to-capability
mappings) feeds `executionEngine.cjs`'s `executeTask()`, which resolves an agent via System 4's
`findForCapability()`, executes with retry/backoff, circuit-breaker respect, and a documented
timeout/orphan-tracking fix to prevent duplicate execution on timeout races.

**The most significant single finding of this mission's Phase 1:** `executionEngine.cjs` contains
genuine, real org-scoped security logic — when `task.orgId` is set *and* a matching skill exists in
System 1's registry, the code (a) checks Tool Fabric permissions per-org, (b) checks per-org
connector credentials via `secretVault.cjs`, and (c) **enqueues a real approval-queue request and
blocks execution** for `riskLevel: "high"` skills unless explicitly pre-approved — reusing
`missionOrchestrator.cjs`'s approval-node mechanism. This is real, working, tested code (exercised
directly by `tests/runtime/skill-lookup-capability-collapse-fix.test.cjs`,
`tests/runtime/universal-execution-runtime.test.cjs`, and others). **However**, tracing every actual
production caller of `runtimeOrchestrator.dispatch()`/`.queue()` — `routes/runtime.js`,
`agentExecutionEngine.cjs`, `runtimeActionEngine.cjs`, `executionCoordinator.cjs`,
`missionRuntime.cjs` — confirms **none of them thread `task.orgId`** into the dispatch call. This
entire org-scoped skill-permission/approval-gate code path is real, tested, and **currently
unreachable from any production HTTP route** — exercised only by tests that call `executeTask()`
directly with an explicit `orgId`. This had not been flagged by Mission 29 or by this session's own
first-pass verification, and materially affects how "ready" System 1's permission model actually is
in production today (answer: the gate exists and works, but nothing currently triggers it).

A second finding from the same trace: there are **two different functions both named `executeTask()`**
in this codebase — `agents/runtime/executionEngine.cjs`'s (described above, with the org-scoped
gate) and a separate one in `backend/services/agentExecutionEngine.cjs`, which itself calls
`orchestrator.dispatch()` rather than the former directly. `backend/routes/orgAgents.cjs` explicitly
documents in its own comments that the org-agent route uses the **latter**, which "has zero orgId
concept" and would silently drop `orgId` if passed to it — a second, independent confirmation of the
same production gap from a different code path.

### Bare-word grep pass (repo-wide, excluding node_modules) — deepened

`SKILL.md`: 0 matches in product code (2 matches exist, but only inside this mission's and Mission
29's own report files in `reports/` — not a code finding). `skills/` as a filesystem directory: 0
matches (all `skills/` string hits are URL path segments like `/workforce-os/skills/coverage`, not
paths on disk). `recipe`: hits in `marketplaceEconomyEngine.cjs`/`marketplaceCatalogEngine.cjs`
(a `"deployment_recipe"` marketplace asset-type tag, one of 13 catalogued types — a discovered
metadata label, not an executable or instruction-loading construct) and one metaphorical comment in
`companyFactory.cjs`. `promptTemplate` and `instructionSet`: 0 hits repo-wide, confirmed by both a
narrow and a broad pass.

**`playbook` — corrected finding, broader than either pass first assumed.** This session's own first
pass concluded the word was scoped to `rootCauseAnalysisEngine.cjs`'s family. The deeper trace found
this undercounts significantly: `playbook` appears in 25+ additional files across
`backend/routes/revenueOS.js`, `autonomousKnowledgeOrg.js`, `engineering.js`, and a long list of
`backend/services/*.cjs` "Org"/"Engine" modules (`businessOrgWorkflow.cjs`,
`memoryPersistenceLayer.cjs`, `autonomousEvolutionOrg.cjs`, `dlqDrainEngine.cjs`, `akoWorkflow.cjs`,
`customerSupportEngine.cjs`, `businessMissionAutomation.cjs`, `knowledgeReasoningEngine.cjs`,
`customerSuccessEngine.cjs`, `engineeringDecisionEngine.cjs`, `engineeringMemoryEngine.cjs`,
`knowledgeExchangeEngine.cjs`, `alphaProgram.cjs`, `aeoWorkflow.cjs`, `executiveWorkflow.cjs`,
`selfImprovementEngine.cjs`, `engineeringConfidenceEngine.cjs`, `akoState.cjs`, `revenueOS.cjs`,
`businessReasoningEngine.cjs`, `riskAssessmentEngine.cjs`) plus several frontend components. **This
was not individually traced for whether each is an independent playbook concept or a shared
pattern** — flagged explicitly as an open question and a concrete candidate for a future narrowly-
scoped mission, rather than resolved here (resolving it was out of this mission's already-large
scope).

---

## PHASE 2 — Multi-vendor skill ecosystem discovery (live-verified)

All repository existence, file counts, and licenses below were fetched live via `gh api` against the
GitHub REST API during this mission (git-tree recursive listing, not the potentially-lossy `npx
skills --list` CLI parse used in Mission 29) — cross-checked where both methods were used.

| Vendor | Repository | Confirmed real? | `SKILL.md` count (git-tree) | License | Notes |
|---|---|---|---|---|---|
| **Anthropic** | `anthropics/skills` | Yes, 170,955 ★ | 20 | Per-skill (Apache-2.0 for open ones; `docx`/`pdf`/`pptx`/`xlsx` source-available, not OSS — confirmed via `THIRD_PARTY_NOTICES.md`) | Official demonstration catalog; spec lives separately at agentskills.io |
| **Anthropic** | `anthropics/claude-plugins-official` | Yes | N/A (plugin format, not raw SKILL.md count) | Apache-2.0 (repo-level) | 39 plugins, several bundling skills — the real engineering-relevant source |
| **OpenAI** | `openai/skills` | Yes, 25,111 ★, created 2025-11-25 | 44 (39 `.curated` + 5 `.system`) | Per-skill Apache-2.0 (confirmed by reading a bundled `LICENSE.txt`; repo-level license API shows None because there's no root LICENSE file) | "Skills Catalog for Codex," official OpenAI-owned |
| **NVIDIA** | `nvidia/skills` | Yes, 3,061 ★ | 344 (git-tree) / 343 (CLI parse — 1-count discrepancy, immaterial) | Apache-2.0 | Repo pushed 2026-08-21, one day before this mission — confirmed current |
| **Google** | `google/skills` | Yes, 18,603 ★ | 169 raw paths / **112 unique skill names** (many skills are duplicated under both `skills/` and `plugins/*/skills/` for dual distribution) | Apache-2.0 | Overwhelmingly GCP-product-specific (BigQuery, GKE, Cloud Run, Agent Platform, ads/analytics SDKs) |
| **Vercel** | `vercel-labs/agent-skills` | Yes, 30,321 ★ | 9 | Per-skill MIT (confirmed in frontmatter; repo-level shows None, same no-root-LICENSE pattern as OpenAI's) | Small, focused: deploy + React patterns + design guidelines |
| **GitHub/Microsoft** | `github/awesome-copilot` | Yes, 38,115 ★ | 412 in `skills/` (community-contributed, quality varies) | MIT (repo-level) | Distinct top-level `skills/`, `instructions/`, `agents/`, `plugins/` dirs — confirms Copilot itself treats these as separate mechanisms, not synonyms |

**Google/Antigravity note:** per live web research, Gemini CLI (the product `google/skills` targets)
sunsets for individual users 2026-06-18; Google's Antigravity CLI is the stated successor and
retains Agent Skills support. Not independently verified against a primary Google source this
mission (web-search-derived claim, flagged as such).

### Vendor-by-vendor summary (Task B lettered items)

**A. Anthropic/Claude** — confirmed official spec owner (agentskills.io) and two catalogs (example
skills + Claude Code plugins). The plugins catalog (`code-review`, `code-simplifier`,
`claude-security`, `security-guidance`, `pr-review-toolkit`, `feature-dev`, `code-modernization`,
`commit-commands`, `claude-md-management`, `agent-sdk-dev`, `mcp-server-dev`) is the single most
directly JARVIS-relevant vendor source found this mission — it targets exactly the engineering-review/
security/PR workflow domain JARVIS's own `rootCauseAnalysisEngine` and audit-mission track already
work in.

**B. OpenAI/Codex** — confirmed official `openai/skills`, 44 skills, launched Nov 2025. Strongest
categories for JARVIS: `gh-fix-ci`, `gh-address-comments` (GitHub PR/CI workflow — JARVIS has real
CI at `.github/workflows/ci.yml`, confirmed present and running a documented "144 checks" regression
suite plus `npm audit`), `security-best-practices`, `security-ownership-map`, `security-threat-model`
(AppSec review patterns), `playwright`/`playwright-interactive` (browser automation — JARVIS already
depends on `playwright` per `package.json`, confirmed).

**C. NVIDIA** — re-confirmed this mission at 344 skills (Mission 29's finding stands, re-verified
independently via git-tree rather than trusting the prior mission's CLI-parsed count). No new
findings; catalog composition and irrelevance verdict unchanged from Mission 29.

**D. Vercel/skills.sh** — two distinct things confirmed: (1) `vercel-labs/agent-skills`, Vercel's own
9-skill catalog, MIT-licensed, containing `react-best-practices` and `composition-patterns` (both
explicitly targeting React/Next.js performance and component-API design); (2) `skills.sh` itself,
confirmed via live fetch to be a **marketplace/aggregator**, not a vendor catalog — it indexes skills
from many GitHub orgs/repos (1.2M+ tracked installs, 22+ supported agent targets including Claude
Code, Codex, Cursor, Copilot, Gemini, Cline, Zed) via `npx skills add <owner/repo>`. Quality on
skills.sh-indexed repos varies enormously — a GitHub search for generic "codex agent skills" during
this mission surfaced dozens of low-star, unvetted personal repos, confirming skills.sh's own
listing is not itself a credibility signal.

**E. Google/Gemini** — confirmed official `google/skills`, 112 unique skills (169 raw paths due to
dual `skills/` + `plugins/*/skills/` packaging), Apache-2.0. Entirely GCP-product-specific
(BigQuery, GKE/Kubernetes, Cloud Run, Firestore, Vertex/"Agent Platform," ads/analytics SDKs, Cloud
WAF pillars). JARVIS does not deploy to GCP (per project memory: VPS + nginx + PM2 + Electron) — zero
direct-deployment relevance confirmed, though the WAF security-pillar skills (`google-cloud-waf-
security`, `-reliability`, `-cost-optimization` etc.) may contain transferable *pattern* content
worth a closer look in a future mission if scoped narrowly.

**F. Qwen** — confirmed Qwen Code **supports** the Agent Skills format natively (SKILL.md discovery
from `~/.qwen/skills/` per its own docs, plus a `qwen extensions link` mechanism), but **no official
QwenLM-owned skills catalog repository exists** (searched directly; only found scattered
community-authored repos of wildly inconsistent quality — e.g. one claiming "155 specialized skills"
with 2 stars). Correctly classified: Qwen is a confirmed-compatible *runtime*, not a *skill source*.

**G. Microsoft/GitHub Copilot** — this is where the mission's explicit instruction to "distinguish
skills from custom instructions and agents" mattered most. Findings, precisely:
- `microsoft/waza` (1,272 ★) — a CLI/framework for *authoring and evaluating* agent skills, not a
  skill catalog itself.
- `microsoft/cat-agent-skills`, `microsoft/postgres-skills`, and several other small
  `microsoft/*`-owned repos exist but are narrow/single-purpose (Copilot Studio skills, Postgres
  patterns) — not a single consolidated official catalog analogous to the other five vendors'.
- `github/awesome-copilot` (38,115 ★, official GitHub org, MIT) is the closest analog — but its own
  repository structure keeps `skills/` (412 entries, SKILL.md-based), `instructions/` (Copilot's
  distinct `.github/copilot-instructions.md`-style custom-instructions format), `agents/`, and
  `plugins/` in **separate top-level directories**, confirming these are genuinely different Copilot
  mechanisms, not four names for the same thing. Only the `skills/` subtree is Agent-Skills-format
  and in scope for this audit; `instructions/`/`agents/`/`plugins/` were not inventoried (out of
  scope — different format, would need a separate comparison model).

**H. Other credible ecosystems** — deliberately did not expand beyond the six sources above. A
broad `gh search repos` pass surfaced hundreds of individually-authored, low-star, unverifiable
"agent skills" repos (personal collections, single-purpose novelty skills, non-English marketing/
content-creation packs) — per the mission's explicit instruction not to build "a giant unverified
vendor list," none of these were investigated further. The one exception already covered:
`github/awesome-copilot`, which crosses the credibility bar on stars/ownership despite being
community-contributed rather than vendor-curated.

---

## PHASE 3 — Normalized comparison model

Applying the Agent Skills spec's own frontmatter fields (`name`, `description`, `license`,
`compatibility`, `metadata`, `allowed-tools`) plus the fields this mission's Task instructed, to
every candidate that survived Phase 2's relevance filter. Full per-skill detail on the ~24 candidates
that reached at least a B/C classification is in the table below; the remaining ~600 catalog entries
were bulk-classified D (irrelevant) by domain per Phase 2's vendor summaries, not individually
tabulated (563 GCP/NVIDIA-product-specific + medical/robotics/video-analytics entries would add
volume, not signal).

| Skill | Vendor | Domain | Trigger (from description) | Req. tools/runtime | License | Side effects | JARVIS overlap | Classification |
|---|---|---|---|---|---|---|---|---|
| `code-review` (plugin) | Anthropic | PR review | Multi-agent PR review w/ confidence scoring | Claude Code agent framework | Apache-2.0 | Read-only analysis | JARVIS has no PR-review automation; closest is `rootCauseAnalysisEngine` (post-hoc, not PR-time) | **B** |
| `security-guidance` (plugin) | Anthropic | Security | Pattern-based warnings on edit, LLM diff review on Stop, commit reviewer (injection/XSS/SSRF/secrets, 25+ classes) | Claude Code hooks | Apache-2.0 | Read-only, blocks nothing itself | Overlaps conceptually with this repo's own audit-mission track (Missions B.22-B.24, SSRF/XSS/secrets sweeps already done manually) | **B** |
| `claude-security` (plugin) | Anthropic | Security | Deep vuln scan, tiered effort, panel-verified findings, targeted patches | Claude Code agent framework | Apache-2.0 | Produces patches (human-applied) | Same overlap as above — JARVIS's audit missions already do this work manually per-mission | **B** |
| `pr-review-toolkit` (plugin) | Anthropic | PR review | Comments/tests/error-handling/type-design/quality/simplification agents | Claude Code | Apache-2.0 | Read-only | No direct JARVIS equivalent | **B** |
| `code-modernization` (plugin) | Anthropic | Refactoring | Legacy-codebase modernization workflow (preflight→assess→map→...→harden) | Claude Code | Apache-2.0 | Writes code (opt-in stages) | No JARVIS equivalent; JARVIS is greenfield, not migrating legacy | **D** (irrelevant — JARVIS isn't a legacy-migration target) |
| `commit-commands` (plugin) | Anthropic | Git workflow | Simple commit/push/PR commands | `gh`, git | Apache-2.0 | Writes commits, pushes, opens PRs | JARVIS's own commit workflow is manual/human-driven per this session's own system prompt rules | **D** (JARVIS's git-safety conventions already forbid the kind of autonomous push/PR behavior this would encourage) |
| `mcp-server-dev` (plugin) | Anthropic | Agent dev | MCP server design/deployment/auth patterns | Claude Code | Apache-2.0 | None (guidance only) | JARVIS has no MCP server of its own currently | **C** (adaptable if JARVIS ever exposes an MCP server) |
| `gh-fix-ci` | OpenAI | DevOps/CI | Debug/fix failing GitHub Actions checks, plan-then-approve | `gh` CLI | Apache-2.0 | Reads CI logs; writes fixes only after explicit approval | JARVIS has real CI (`ci.yml`, confirmed) but no automated CI-failure-triage skill | **B** |
| `gh-address-comments` | OpenAI | PR workflow | Fetch and address PR review comments via `gh` | `gh` CLI | Apache-2.0 | Writes code changes | No JARVIS equivalent | **B** |
| `security-best-practices` | OpenAI | Security | Language/framework-specific secure-coding guidance (Python/JS-TS/Go) | None beyond repo read | Apache-2.0 | Read-only unless user requests fixes | JARVIS's audit-mission track already does deep manual security review; this would be a lighter-weight, always-on complement | **B** |
| `security-ownership-map` | OpenAI | Security/Git | Git-history-based bus-factor & ownership-risk analysis, exports CSV/JSON for Neo4j/Gephi | Python 3, `networkx` | Apache-2.0 | Read-only, writes export files | No JARVIS equivalent — genuinely novel analysis type | **A/B borderline** — directly runnable pattern (Python script, no special runtime), but the graph-export target (Neo4j/Gephi) is speculative for JARVIS; the *analysis technique* is the reusable part |
| `security-threat-model` | OpenAI | Security | Repo-grounded threat modeling (trust boundaries, assets, abuse paths) → Markdown report | None beyond repo read | Apache-2.0 | Read-only, writes a report file | JARVIS's audit-mission track already produces exactly this kind of report manually (this register itself) | **B** — pattern is worth studying to structure future audit missions more consistently |
| `playwright` / `playwright-interactive` | OpenAI | Browser automation | CLI-driven browser automation/testing | `playwright-cli`, `npx` | Apache-2.0 | Launches real browser sessions | **High overlap** — JARVIS already has `browserRegistry.cjs`, `visualCaptureService.cjs`, ODI visual-design-intelligence system, and `playwright` as a direct dependency | **F** (duplicate of existing capability) |
| `sentry` | OpenAI | Observability | Read-only Sentry issue/event queries via CLI | `sentry` CLI, `SENTRY_AUTH_TOKEN` | Apache-2.0 | Read-only | JARVIS's `sentryService.cjs` already exists (confirmed referenced in Mission SSRF-audit findings) — likely duplicate, not independently re-verified this mission | **F** (probable duplicate, flagged for confirmation) |
| `react-best-practices` | Vercel | Frontend | React/Next.js performance patterns | None (guidance) | MIT | None | JARVIS frontend is CRA-based (not Next.js) per Mission 22's tooling trace — partial applicability | **B** (React-general parts apply; Next.js-specific parts don't) |
| `composition-patterns` | Vercel | Frontend | Compound components, render props, context, React 19 API changes | None (guidance) | MIT | None | Directly relevant — JARVIS's Missions 21-28 frontend track found real component-design issues (prop drilling, fake-empty-state bugs) across 87 screens | **B** — strong candidate for informing the still-open frontend maturity work |
| `web-design-guidelines` | Vercel | Frontend/UX | UI code review against accessibility/design best practices | None (guidance) | MIT | None | JARVIS's frontend track has not yet done a systematic accessibility pass per its own register | **B** |
| `webapp-testing` | Anthropic | Testing | Playwright-based local webapp testing/screenshot/log capture | Playwright | License in bundled LICENSE.txt | Launches real browser | **High overlap**, same as OpenAI's playwright skill — JARVIS already has this capability | **F** (duplicate) |
| `mcp-builder` | Anthropic | Agent dev | Guide for building high-quality MCP servers (Python FastMCP / Node TS SDK) | None (guidance) | License in bundled LICENSE.txt | None | Same as OpenAI's `mcp-server-dev` — no current JARVIS MCP server | **C** |
| `frontend-design` | Anthropic | Frontend/UX | Distinctive visual-design guidance, avoiding "templated defaults" | None (guidance) | License in bundled LICENSE.txt | None | Complements Vercel's `web-design-guidelines`; JARVIS's frontend has been functionally audited but not aesthetically | **B** |
| `data-manager-api-*`, `google-ads-api-*`, GKE/BigQuery family (Google, ~100 skills) | Google | GCP product ops | Various | `gcloud`, GCP SDKs | Apache-2.0 | Varies, many deploy/modify cloud resources | JARVIS doesn't run on GCP | **D** (bulk) |
| `google-cloud-waf-security` etc. (6 WAF-pillar skills) | Google | Security/architecture pattern | Well-Architected Framework review per pillar | `gcloud` (for live review) or none (for pattern study) | Apache-2.0 | Read-only if used as pattern reference | Framework-level thinking could inform JARVIS's own audit-mission structure even without GCP | **B** (pattern only, not the tool) |
| ~344 NVIDIA skills | NVIDIA | GPU/robotics/vision/DOCA/medical | Various | CUDA/DOCA/Jetson/etc. | Apache-2.0 | Varies, many are destructive hardware ops (firmware flashing) | None — re-confirmed from Mission 29 | **D** (bulk, unchanged) |
| `awesome-copilot`'s 412 community skills | GitHub/community | Mixed quality | Various | Varies | MIT | Varies, unvetted individually | Not individually triaged — see Phase 2 note H | **Not classified** (out of scope per mission's own "don't inflate the list" instruction; flagged for a future narrower pass if desired) |

---

## PHASE 4 — JARVIS gap analysis

Against the mission's named domain list:

| Domain | JARVIS today | External skills verdict |
|---|---|---|
| **Software engineering / debugging** | `rootCauseAnalysisEngine.cjs` (RCA + auto-playbooks), `engineeringOrg` family, Engineering Intelligence pane (12 risk signals, per project memory) | JARVIS's own system is more deeply integrated into its own runtime than any external skill could be dropped in as-is; external skills (OpenAI's `security-ownership-map`, `security-threat-model`) offer **complementary analysis techniques** JARVIS's RCA engine doesn't currently do (bus-factor/ownership-risk graphs, structured threat-model output) — worth studying, not installing |
| **Testing** | Real Jest+RTL harness (Mission 22, 254+ tests per register), `node --test` backend suite, CI-integrated | No external skill improves on this; JARVIS's testing discipline (negative-testing every fix, documented in this very register) exceeds what any generic "webapp-testing" skill teaches |
| **Security auditing** | An entire dedicated audit-mission track (B.22-B.24 certifications, ~15 recent security-deep-sweep missions per this register) | JARVIS **already has better** ad-hoc depth than any single external skill; but `security-threat-model`'s structured-report *format* and `security-ownership-map`'s bus-factor *technique* are gaps worth adopting as patterns |
| **Frontend engineering** | 87 nav-reachable screens, systemic failure-honesty bug class found and fixed across 6 missions, CRA-based | Vercel's `composition-patterns` and `web-design-guidelines`, Anthropic's `frontend-design` are genuine pattern gaps — JARVIS's frontend missions have been bug-hunting, not systematically applying composition/accessibility/aesthetic frameworks |
| **Backend engineering** | Extensive (151+ route files per memory) | No external skill offers backend-architecture value beyond what JARVIS already does |
| **DevOps** | PM2, nginx, VPS deploy scripts, real CI (`ci.yml`, `release.yml`) | Cloudflare/Netlify/Render/Vercel-deploy skills are **irrelevant** — JARVIS's deployment target is VPS, not any of these platforms |
| **Git/GitHub** | Manual, human-gated commit workflow (explicit session convention) | `gh-fix-ci` and `gh-address-comments` are genuinely useful *patterns* for a future assisted-CI-triage feature, but JARVIS's current convention (never autonomous push/merge without explicit ask) means installing `commit-commands`-style autonomous git skills would work against an existing, deliberate constraint — **do not adopt** |
| **Database** | `better-sqlite3` | No candidate skill targets SQLite specifically across any vendor catalog found this mission |
| **API integration** | `integrationConnectors.cjs`, 57 connectors per memory | No external skill offers comparable breadth |
| **Browser automation** | `browserRegistry.cjs`, `visualCaptureService.cjs`, ODI visual intelligence, Playwright dependency already present | Direct duplicate of Anthropic's `webapp-testing` and OpenAI's `playwright`/`playwright-interactive` — confirmed **F (duplicate)** |
| **Documentation** | `docs/audits/` corpus, this very audit-register convention | No external skill improves on JARVIS's existing (unusually rigorous, per this register's own file:line evidence discipline) documentation practice |
| **Research** | None specific found | No strong candidate surfaced |
| **Data analysis** | `businessIntelligence`/analytics services (per memory) | No candidate skill offers comparable depth; Jupyter-notebook skill (OpenAI) is orthogonal (JARVIS has no notebook workflow) |
| **Agent orchestration** | `agentRegistry.cjs` + `runtimeOrchestrator.cjs`, real circuit-breaker dispatch | No external skill offers an orchestration *engine* — Anthropic's `agent-sdk-dev`/`mcp-server-dev` and OpenAI's `mcp-server-dev`-equivalent are about *building new agents/servers*, not orchestrating existing ones; low relevance since JARVIS's orchestration already works |
| **Code review** | Manual, mission-driven (this register's entire audit track is essentially manual code review) | Anthropic's `code-review`/`pr-review-toolkit`/`code-simplifier` plugins are the strongest **B**-tier candidates found this mission — they formalize what JARVIS's audit missions already do ad hoc, worth studying for process structure |
| **Deployment** | PM2/nginx/VPS, working `deploy:*` npm scripts | Irrelevant vendor deploy skills, as above |
| **Observability** | `sentryService.cjs` already exists | OpenAI's `sentry` skill is a probable duplicate |
| **Incident response** | Not clearly a separate JARVIS subsystem (folded into RCA engine) | No strong external candidate found |
| **Business automation** | JARVIS's core product surface (Business OS, 45+ routes per memory) | No vendor catalog targets this domain — expected, since it's JARVIS's own product differentiation, not a generic engineering task |
| **Productivity** | N/A | Notion-integration skills (OpenAI: `notion-knowledge-capture`, `notion-meeting-intelligence`, etc.) exist but JARVIS has no Notion integration — **D** |
| **Multimodal workflows** | `visualCaptureService.cjs`, image/audio generation capabilities per `skillRegistry.cjs`'s seed data | OpenAI's `imagegen`/`speech`/`transcribe` system skills overlap partially — not independently deep-checked this mission |

**Capabilities requiring genuinely new architecture (not just adoption):** a function-calling/
tool-use registration layer (confirmed absent — see Phase 1's `registerTool`/`toolRegistry` zero-match
finding) would be a prerequisite for any skill that expects to call structured tools rather than
just being read as instructions; JARVIS's current AI usage is plain chat completion across 14
providers.

**Capabilities that should NOT be added:** autonomous git push/merge/PR-creation skills
(`commit-commands`), deployment-platform-specific skills for platforms JARVIS doesn't use
(Cloudflare/Netlify/Render/Vercel/GCP), and anything requiring credentials JARVIS doesn't already
manage (Notion, Figma, Linear tokens) — installing these would either duplicate existing, more
deeply-integrated JARVIS capability, or work against this session's own explicit git-safety
conventions.

---

## PHASE 5 — Security review

**Spec-level finding (applies to every vendor):** the Agent Skills specification itself
(agentskills.io) defines `allowed-tools` as **explicitly experimental**, with support "vary[ing]
between agent implementations." There is **no mandatory sandboxing, permission-scoping, or
credential-isolation model** in the spec — a skill's Markdown instructions and any bundled
`scripts/` directory are simply loaded and, per the runtime's own tool permissions, can be executed.
Trust is established entirely by *who published the skill and whether you read it*, not by any
technical containment the format provides.

**Concrete verification this mission:** confirmed via direct GitHub content listing that OpenAI's
`gh-fix-ci` and `security-ownership-map` skills both bundle a `scripts/` directory (not just
Markdown) — i.e., they ship actual executable code (Python, per their SKILL.md prerequisites) that
an agent runs on the user's behalf. This is the general pattern across all six vendor catalogs, not
an outlier.

**JARVIS-side security findings surfaced by Phase 1's deepened trace (relevant here because they
bear directly on how safely JARVIS could ever gate an external capability, skill-shaped or not):**

1. **A real permission gate exists but is unreachable in production.** `executionEngine.cjs`
   contains genuine, tested logic that blocks `riskLevel:"high"` skills pending human approval when
   `task.orgId` is present — but every real production caller of the dispatch chain
   (`routes/runtime.js`, `agentExecutionEngine.cjs`, `runtimeActionEngine.cjs`,
   `executionCoordinator.cjs`, `missionRuntime.cjs`) fails to thread `orgId` through, so the gate
   never actually fires today. This means: if JARVIS were to adopt Option C (Phase 8) and route
   external-skill-derived capabilities through this same path expecting the risk-based approval gate
   to protect them, it would silently not protect them until this wiring gap is fixed first — a
   prerequisite, not a footnote, for any future skill-execution architecture.
2. **`agentRuntimeSupervisor.cjs`'s agent-registry API has no RBAC role check.** Any authenticated
   user can call `POST /agents/runtime/registry/register` or `/supervisor/start`/`/stop` to
   register/control platform-wide autonomous agents — weaker than the sibling `/workforce-os/*`
   routes, which do enforce `operatorOnly` on mutations. Not something this mission fixes (no code
   changes made per the mission's rules), but named exactly for a future security-audit-track
   mission, consistent with this repository's existing convention of naming gaps precisely rather
   than silently living with them.

Neither finding was caused by this mission's research activity — both are pre-existing conditions in
JARVIS's own code, surfaced by tracing it more deeply than any prior mission had.

**Per-risk-category findings:**

| Risk | Findings |
|---|---|
| Arbitrary shell execution | Present by design in any skill with a `scripts/` dir (confirmed in the two skills checked directly); the spec's `allowed-tools` field is the only mitigation and is experimental/inconsistently supported |
| File writes | `gh-fix-ci`, `security-ownership-map` (CSV/JSON export), `code-modernization`, and any deploy skill (Cloudflare/Netlify/Render/Vercel) write to the filesystem or a remote target by design |
| Network calls | Every deploy skill, `sentry`, `security-ownership-map`'s optional Neo4j export target, and any skill invoking `gh`/cloud CLIs makes real network calls |
| Credential access | `gh-fix-ci`/`gh-address-comments` require `gh auth login`/`gh auth status` with **repo + workflow scopes**; `sentry` requires `SENTRY_AUTH_TOKEN`; every cloud-deploy skill requires that platform's credentials. None of these skills were installed, so none of JARVIS's actual credentials were exposed to any of them this mission |
| Secret exposure | No skill was installed; no secret was read or transmitted by this mission's research activity (GitHub API reads via `gh api` used only this session's own already-authenticated `gh` CLI against public repos) |
| Destructive commands | NVIDIA's BF3/BF4 firmware-flashing skills (from Mission 29's inventory, re-applicable) remain the clearest destructive-by-design example across all catalogs surveyed; none of the newly-surveyed vendor skills in the B/C-classified candidate table are destructive by default (most explicitly gate writes behind "explicit approval," e.g. `gh-fix-ci`'s stated workflow) |
| Deployment actions | Cloudflare/Netlify/Render/Vercel-deploy skills perform real deployments; all classified **D (irrelevant)** for JARVIS specifically because its deployment target (VPS/PM2/nginx) doesn't match any of them — not because the skills themselves are unsafe in their intended context |
| Git push/merge behavior | `commit-commands` (Anthropic) explicitly streamlines commit/push/PR creation — flagged **D** specifically because it conflicts with this session's own standing convention (never push/merge without explicit per-instance authorization); this is a policy conflict, not a technical vulnerability in the skill itself |
| External API calls | Present in nearly every B/C-classified candidate (`gh`, Sentry, cloud provider APIs) — expected and disclosed in each skill's own prerequisites section |
| Prompt injection risk | Not independently tested this mission (would require actually installing and running a skill against adversarial input, which the mission's "NO skill installation" rule forbids); flagged as **untested**, not **safe** |
| Untrusted downloaded resources | The shallow-clone-then-discard pattern used by `npx skills add --list` (confirmed in Mission 29, not re-used this mission since all vendor catalogs were inspected via `gh api` instead) is the main "resource acquisition" pathway; this mission used only `gh api` reads (metadata/content fetch, no code execution) — safe by construction |
| Tenant isolation implications | JARVIS's own `skillRegistry.cjs` (Phase 1, point 7) has **no tenant boundary today** — installing any external skill's metadata into that registry would inherit that same gap, not introduce a new one, but would mean an external skill's `riskLevel`/`requiredPermissions` fields (if adapted into that schema) would be exactly as unenforced as JARVIS's own existing 77 records currently are |

**Overall Phase 5 verdict:** no unsafe skill was installed or run. The general risk profile of the
Agent Skills format is "trusted code you chose to load," not "sandboxed extension" — every vendor's
own skills routinely ship and expect to run real scripts with real credentials. This reinforces
Mission 29's approach (audit before install) as correct, not overcautious.

---

## PHASE 6 — Duplication analysis

**"What percentage of useful external skills can JARVIS already perform?"**

Of the ~24 skills that reached at least a B-tier classification in Phase 3's table, **3 were
classified F (confirmed or probable duplicate)**: `playwright`/`playwright-interactive` (OpenAI),
`webapp-testing` (Anthropic), and `sentry` (OpenAI, probable, not independently re-verified this
mission). That's roughly **12-13% of the useful-tier candidates** where JARVIS already has an
equivalent, deeper-integrated capability (browser automation via `browserRegistry.cjs`/
`visualCaptureService.cjs`/ODI, and observability via `sentryService.cjs`). Counting the entire
Phase 3 table including bulk-D domains (GCP/NVIDIA product skills, deploy-platform skills), the
duplicate-vs-total ratio is much lower simply because most catalog entries were never real JARVIS
candidates in the first place (D for irrelevance, not F for duplication) — duplication specifically
concentrates in the browser-automation and observability domains, both of which JARVIS had already
built before this mission.

**"Which external skills would genuinely improve JARVIS rather than merely rename an existing
capability?"**

The genuinely additive set, per Phase 3/4: `security-ownership-map` (bus-factor/ownership-risk graph
analysis — no JARVIS equivalent exists at all), `security-threat-model` and Anthropic's
`security-guidance`/`claude-security` (structured, repeatable threat-model/vuln-report *formats* —
JARVIS's own audit missions produce comparable depth but ad hoc, not via a repeatable template),
`gh-fix-ci`/`gh-address-comments` (JARVIS's CI exists but has no automated triage skill for it),
Vercel's `composition-patterns`/`react-best-practices` and Anthropic's `frontend-design` (concrete
gaps in JARVIS's frontend-engineering practice per its own Mission 21-28 findings), and Anthropic's
`code-review`/`pr-review-toolkit`/`code-simplifier` (formalize JARVIS's existing manual-audit
practice into a repeatable process). None of these six/seven candidates would be installed as literal
external code today (JARVIS has no Agent-Skills-compatible runtime); their value is as **studied
patterns**, consistent with Phase 7's classification below.

No inflation: the large majority of all ~612 vendor `SKILL.md` files surveyed (NVIDIA's 344, most of
Google's 112, most of OpenAI's 44, most of Anthropic's remaining example skills) are domain-irrelevant
to JARVIS by simple product-stack mismatch, not by any close call. The gap analysis in Phase 4 is
narrow and specific, not broad.

---

## PHASE 7 — Final recommendation

### 1. INSTALL NOW
**None.** No skill meets the bar of "clearly useful, compatible, secure, tested/credible, low-risk,
genuinely additive" *as an installable artifact*, because JARVIS has no Agent-Skills-compatible
runtime to install into (Phase 1, point 13, across all four core files: none can load a `SKILL.md`
today). This is a structural blocker, not a quality judgment on the skills themselves — several
(`security-ownership-map`, `gh-fix-ci`) are well-built and would likely qualify for this tier the
moment JARVIS's own agent runtime (Claude Code, in this working session) is the one running them,
which it already implicitly can via `npx skills use <owner>@<skill>` without any JARVIS-side
architecture change — but that is a Claude-Code-session-level action, not a JARVIS-codebase change,
and stays out of this mission's scope per its own "no installation" rule.

### 2. ADAPT INTO JARVIS
| Skill/pattern | Target JARVIS subsystem | What "adapt" means concretely |
|---|---|---|
| `security-ownership-map`'s bus-factor technique | `rootCauseAnalysisEngine.cjs` | A future mission could add a git-history ownership/bus-factor analysis as a new RCA input signal — the *technique* (bipartite people-to-file graph, Jaccard co-change clustering), not the Python script itself, since JARVIS's runtime is Node.js |
| `security-threat-model`'s structured report format | The audit-mission convention itself (this register) | Future security-deep-sweep missions could adopt a consistent trust-boundary/asset/abuse-path template instead of each mission inventing its own structure |
| `composition-patterns` (Vercel) | JARVIS frontend, no single owning file — would inform future Mission 21-28-track work | Apply compound-component/render-prop review as a checklist item in the next frontend maturity mission, targeting the ~44 files still named as unaudited per Mission 27-28's residual sweep |
| `code-review`/`pr-review-toolkit` structure (Anthropic) | The audit-mission convention itself | JARVIS's manual audit missions already do confidence-scored, multi-angle review; formalizing this into an explicit reusable checklist (not new code) would reduce mission-to-mission variance |

### 3. STUDY PATTERN ONLY (read for ideas, do not adapt code)
`security-best-practices` (OpenAI) — general secure-coding reference material, useful background for
any mission touching Python/JS-TS/Go code, not tied to a specific JARVIS subsystem. `frontend-design`
and `web-design-guidelines` (Anthropic/Vercel) — aesthetic/accessibility judgment aids for whoever
does the next frontend visual pass. `mcp-builder`/`mcp-server-dev` (Anthropic/OpenAI) — background
for if JARVIS ever exposes its own MCP server (no current plan found this mission). Google's WAF
pillar skills — architectural-thinking reference only, not GCP-tool-dependent.

### 4. DO NOT USE
All ~344 NVIDIA skills (unchanged from Mission 29). All ~112 Google skills (GCP-product-specific,
JARVIS doesn't deploy there). All Cloudflare/Netlify/Render/Vercel-deploy skills (wrong deployment
target). `commit-commands` (conflicts with this session's standing git-safety convention).
`code-modernization` (JARVIS isn't a legacy-migration target). `playwright`/`playwright-interactive`/
`webapp-testing` (duplicate of existing `browserRegistry.cjs`/ODI capability). `sentry` skill
(probable duplicate of existing `sentryService.cjs`, pending independent confirmation). Notion/Figma/
Linear-integration skills (JARVIS has no such credentials or integration surface today). Any skill
in `github/awesome-copilot`'s 412-entry community catalog not individually vetted (per Phase 2's
explicit scope decision not to triage unvetted community content).

---

## PHASE 8 — Architecture decision (documented only, not implemented this mission)

Four options were posed by the mission. Assessment of each against this mission's Phase 1 findings:

- **Option A — Native SKILL.md compatibility:** Would require building a new loader (parse
  frontmatter, match `description` against context, inject Markdown body, resolve `scripts/`/
  `references/`/`assets/` paths) — genuinely new architecture. Nothing in Phase 1's trace comes close
  to this (closest is `skillRegistry.cjs`'s metadata shape, which has no instruction-body concept).
- **Option B — Internal JARVIS skill format:** Would mean designing a JARVIS-specific instruction-
  packaging format instead of the increasingly-standard SKILL.md — goes against the grain of what
  Phase 2 found (four independent vendors converging on one spec); would trade interoperability for
  no clear benefit, since JARVIS has no unique requirement Phase 1/2 surfaced that SKILL.md can't
  express.
- **Option C — Small compatibility adapter for external Agent Skills:** The lowest-effort path that
  doesn't require picking a competing format: a thin loader that reads `SKILL.md` frontmatter and
  injects the body as context for JARVIS's own AI-orchestration layer, without building a full
  scripts/references/assets resolution pipeline initially. This is the option Phase 1's evidence
  points toward *if* JARVIS ever wants first-class skill support, but:
- **Option D — No new skill system; existing infrastructure is sufficient:** is the accurate
  assessment **for this mission's actual candidate list**. Phase 7's "INSTALL NOW" list is empty not
  because Option C is hard, but because Phase 3/4/6 found no skill that clears the bar of "JARVIS
  genuinely lacks this and an external skill is the best way to get it" strongly enough to justify
  building *any* new loading architecture right now. The handful of genuinely additive items
  (Phase 7's ADAPT/STUDY lists) are better absorbed as **human-read pattern knowledge into existing
  JARVIS subsystems** (RCA engine, audit-mission convention, frontend-maturity track) than as
  literal SKILL.md files loaded by a new runtime component.

**Recommendation:** **Option D now, Option C conditionally later.** Do not build Option A, B, or C in
this mission or the near-term roadmap. Revisit Option C only if a future mission identifies multiple
genuinely-additive external skills whose *value is specifically in being dynamically triggered by
description-matching* (the actual mechanism Agent Skills provides) rather than in being read once
and manually folded into existing code — Phase 7's current list doesn't meet that bar; every item
there is better served by a human (or this session) reading the skill once and applying the pattern
directly to the target JARVIS file.

---

## FINAL REPORT SUMMARY

| Item | Result |
|---|---|
| Vendors investigated | Anthropic, OpenAI, NVIDIA, Google, Vercel, Qwen, Microsoft/GitHub (7 vendors named in the mission; all addressed — Qwen and Microsoft found to have no single official curated catalog, correctly classified as such rather than skipped) |
| Sources (repos confirmed live via `gh api`) | `anthropics/skills`, `anthropics/claude-plugins-official`, `openai/skills`, `nvidia/skills`, `google/skills`, `vercel-labs/agent-skills`, `github/awesome-copilot` — 7 repositories, all existence/star-count/license/file-count independently verified this mission, not assumed |
| Catalog items examined | 612 `SKILL.md` files across 5 vendor skill-repos (20 + 44 + 344 + 112-unique + 9) via git-tree API, plus 39 Anthropic plugins and 412 community Copilot skills enumerated but not individually triaged |
| Classifications | ~24 candidates individually classified (A/B/C/D/E/F per Phase 3's model); bulk domains (NVIDIA 344, most of Google 112, most of OpenAI 44) classified D by vendor-summary rather than per-item, per the mission's own anti-inflation instruction |
| Top reusable skills/patterns | `security-ownership-map`, `security-threat-model`, `gh-fix-ci`, `gh-address-comments`, `composition-patterns`, `react-best-practices`, `code-review`/`pr-review-toolkit`/`code-simplifier` |
| JARVIS overlaps (confirmed duplicates) | Browser automation (`playwright`/`webapp-testing` vs. JARVIS's `browserRegistry.cjs`/ODI), observability (`sentry` skill vs. `sentryService.cjs`, probable) |
| JARVIS gaps (genuine) | No function-calling/tool-registration layer for AI providers (confirmed zero `registerTool`/`toolRegistry` matches); no bus-factor/ownership-risk analysis; no repeatable structured threat-model report template; no systematic frontend-composition-pattern review |
| Security findings | Agent Skills spec has no mandatory sandboxing; `allowed-tools` is experimental; every vendor catalog routinely ships real executable `scripts/` (confirmed directly on 2 skills); no skill was installed or run this mission, so no JARVIS credential/secret was exposed |
| Licensing concerns | Apache-2.0 (Anthropic plugins, OpenAI, NVIDIA, Google) and MIT (Vercel per-skill, GitHub Copilot repo-level) are all permissive and adoption-safe *for pattern study*; several repos show "no license" at the GitHub-API repo level but carry real per-skill `LICENSE.txt`/frontmatter licenses — verify at the individual-skill level, not the repo level, before ever reusing literal text |
| Recommended architecture | **Option D (no new skill system) now**; Option C (thin external-Agent-Skills compatibility adapter) only if a future mission finds multiple candidates whose value specifically requires dynamic description-triggered loading, not one-time pattern absorption |
| Exact next mission | A narrowly-scoped mission to fold `security-ownership-map`'s bus-factor technique into `rootCauseAnalysisEngine.cjs` as a new signal, OR a frontend-maturity mission applying `composition-patterns`/`web-design-guidelines` to the ~44 still-unaudited files named in Mission 27-28's residual sweep — either is a concrete, evidence-backed next step; this mission deliberately stops short of picking one, per its own "stop after one mission" rule |
| Limitations | Phase 1 was deepened by a second independent trace pass (11 systems, 55 tool calls, file:line evidence) and both the "no test coverage" and "confirmed dead" characterizations from the first pass were corrected as a result — treat Phase 1 as thorough but not exhaustive: the 25+ files newly found to reference "playbook" were not individually traced for whether each is an independent concept or a shared pattern (flagged as an open question, not resolved); `toolExecutionLayer.cjs` (Tool Fabric)'s tenant-boundary was flagged as not fully verified rather than confirmed either way; `sentry` skill vs. `sentryService.cjs` overlap is probable, not independently confirmed by reading both files side-by-side; the 412-entry `github/awesome-copilot` community catalog was enumerated but not quality-triaged per-item, consistent with the mission's own instruction not to build an unverified giant list; Google Antigravity/Gemini-CLI-sunset claim is web-search-derived, not primary-source-confirmed |

**Result:** 0 skills installed, 0 packages installed, 0 files modified besides this report and the
master register update, `.env` untouched, no deletion, no new architecture built, no credential
changes, no merge, no push.
