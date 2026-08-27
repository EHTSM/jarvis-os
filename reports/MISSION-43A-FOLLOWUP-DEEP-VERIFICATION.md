# MISSION 43A Follow-Up — Deep Verification of Low-Confidence Flags

**Type:** Audit / discovery only. No code modified, no packages installed, no
`.env`/production/VPS touched, no git commit/push/merge performed.

**Date:** 2026-08-23

## 1. Scope

Mission 43A (`MISSION-43A-BACKEND-ROUTE-GAP-DISCOVERY.md` §5) flagged 9
uncertified route files as lower-confidence — skimmed for auth/orgId
presence but not traced into their backing services or confirmed as real
defects. This follow-up reads each file in full and traces at least one
level into its service layer, per prior mission's own verification
standard (the standard used to confirm `mission.js`/`collaboration.js`/
`plan-management.js` as real defects). No remediation applied.

## 2. Result — three of nine were actually worse than the original triage

Six of nine files are confirmed real defects (one materially more severe
than anything in the original 43A report); three are confirmed fine as
genuinely platform-wide, no-tenant-model features.

### 2.1 `backend/routes/browserPlatform.js` — DEFECT, **HIGH** (cross-account credential exposure + unrated SSRF-shaped capability)

- Mount: `/browser-platform`, `requireAuth` only (`backend/routes/browserPlatform.js:102`), no `operatorOnly`.
- `_accountId(req)` (`backend/routes/browserPlatform.js:104`) exists and is
  used correctly on profile *creation* (`:164,171`) and on the list route
  when `?all` isn't set (`:157`) — but:
  - `GET /browser-platform/sessions?all=true` (`:157`) — `all` is a
    **client-controlled query param** that, when set, skips the account
    filter entirely, returning every account's browser session profiles.
  - `GET/PUT/DELETE /browser-platform/sessions/:id` and
    `/sessions/:id/cookies` and `/sessions/:id/storage`
    (`:176-224`) call `sessionManager.getProfile/updateProfile/deleteProfile/
    saveCookies/getCookies/clearCookies/saveStorage` with **no
    `_accountId(req)` check at all**.
  - Confirmed at the service layer: `backend/services/browserSessionManager.cjs`
    — `getProfile(id)` (line 75), `saveCookies(profileId, domain, cookies)`
    (line 116), `getCookies(profileId, domain)` (line 129) take **no
    accountId parameter whatsoever**; only `listProfiles(opts)` (line 82)
    supports account filtering, and only when the caller passes it.
  - Net effect: any authenticated user who can guess/enumerate a profile
    `id` can read, overwrite, or delete another account's saved browser
    session — including its saved cookies and localStorage snapshot for
    whatever third-party site that profile is authenticated to. This is
    direct session-hijacking material, not just a data-shape leak.
- `POST /browser-platform/control/navigate` (`:273-281`) takes a raw
  caller-supplied `url` with no allow-list and drives a real server-side
  Playwright session to it — SSRF-shaped (can probe internal network
  endpoints), chainable with `/control/screenshot` (`:283-292`) or
  `/control/pdf` to exfiltrate the result.
- No rate limiting anywhere in the file. Its sibling `backend/routes/browser.js`
  rate-limits every comparable route (`rateLimiter(10, 60_000)` at 9 call
  sites) — `browserPlatform.js` has none, despite exposing a materially more
  dangerous capability set.
- **Verified independently** (not just agent-reported): read
  `browserPlatform.js:140-235` and `browserSessionManager.cjs` directly,
  confirmed `getProfile`/`saveCookies`/`getCookies` take no accountId
  argument at the function-signature level.

### 2.2 `backend/routes/workspaceMesh.js` — DEFECT, **HIGH** (bypasses an existing, deliberate `operatorOnly` gate via a parallel path)

- Mount: `/workspace-mesh`, `requireAuth` only (`backend/routes/index.js:320`).
- `POST /workspace-mesh/execute` → `workspaceMesh.execute()`
  (`backend/services/workspaceMesh.cjs:136-190`, `skipApproval` defaults to
  `true` at line 134) → `workspaceCoordinator._dispatch()`
  (`backend/services/workspaceCoordinator.cjs:134-166`) → the **same**
  `browserController`/`editorController`/`terminalController`/
  `computerController` stack that backs `/computer/*`.
- `backend/routes/index.js:301-310`'s own inline comment explains **why**
  `/computer/*` is deliberately gated `requireAuth + operatorOnly`: "real
  arbitrary shell command execution... real desktop/browser/editor
  automation." `workspaceMesh.js` reaches the identical execution stack
  through `requireAuth` alone — a parallel, ungated door to a capability
  this codebase's own author already judged too dangerous for ordinary
  authenticated users.
- Mitigating factor: `terminalController.cjs` allow-lists commands
  internally (`ALLOWED_COMMANDS`/`ALLOWED_NPM_SCRIPTS`/`ALLOWED_GIT_SUBCOMMANDS`,
  lines 60-106) via `execFileSync` (argv array, not shell string) — so this
  is not raw unrestricted RCE. `browserController.executeWorkflow` and
  `computerController.run` are not similarly restricted at this layer,
  however, and the underlying `/computer/*` gate was added because the
  *capability*, not just the shell primitive, was judged too dangerous.
- Zero `orgId` references anywhere across the workspace-mesh service
  family (`workspaceMesh.cjs`, `workspaceRegistry.cjs`,
  `workspaceCoordinator.cjs`, `workspaceSynchronization.cjs`,
  `workspaceHealth.cjs`, `workspaceDashboard.cjs`) — single global state,
  no tenant model, compounding the authorization gap.

### 2.3 `backend/routes/obi-x.js` — DEFECT, **MEDIUM-HIGH** (reintroduces the plan-management.js defect class through a sibling never swept)

- Mount: `/business/x/*`; barrel comment explicitly groups it under
  `/business/*` (`backend/routes/index.js:327-328`).
- The sibling route at the same prefix, `business.js`, was **already
  audited and fixed** for this exact defect class (its own comments cite
  "100-COMPANY-REALITY-AUDIT.md... orgId loaded/mutated every org's
  records globally," now scoped via `orgId: req.org.id` throughout,
  `backend/routes/business.js:89-373`).
- `obi-x.js`'s `POST /business/x/reasoning/analyze` →
  `businessReasoningEngine.analyze()`
  (`backend/services/businessReasoningEngine.cjs:180-227`) calls
  `businessOrgState.getAllKpis()`, `getPipelineStats()`, `listDeals()`,
  `customerSuccess.getOverview()`, **`crmService.getStats()` with zero
  arguments** — the identical unscoped call already flagged as the
  `plan-management.js` defect in Mission 43A §4.3
  (`backend/services/crmService.js:160-162` falls through to the entire
  unfiltered cross-org lead store when `orgId === undefined`) —
  `revenueOS.getRevenueDashboard()`, and `revenueOS.listChurnRisks()`, all
  unscoped.
- The resulting analysis (real MRR/ARR/churn/deal data) persists to a
  shared `data/business-reasoning.json` and is readable by any
  authenticated user via `GET /business/x/reasoning/:id`,
  `GET /business/x/reasoning` (unscoped list), and
  `GET /business/x/dashboard` (`backend/routes/obi-x.js:32-56,222-233`).
- Zero `orgId` references anywhere in `businessReasoningEngine.cjs`,
  `businessQualityEngine.cjs`, `businessBenchmarkEngine.cjs`,
  `businessPredictionEngine.cjs`, `businessEvolutionEngine.cjs`,
  `businessIntelligenceDashboard.cjs`.

### 2.4 `backend/routes/pipeline.js` — DEFECT, **MEDIUM-HIGH** (cross-tenant IDOR, same shape as mission.js/collaboration.js)

- Mount: `/pipeline`, in-file `requireAuth` only (`backend/routes/pipeline.js:28`).
- `GET /pipeline/:id`, `POST /pipeline/:id/approve`,
  `POST /pipeline/:id/cancel` (`:92-114`) pass a caller-supplied `:id`
  straight into `engineeringPipelineCoordinator.getPipeline/
  approvePipeline/cancelPipeline()` with zero ownership check. Zero
  `orgId` references anywhere in `engineeringPipelineCoordinator.cjs`.
- `POST /pipeline/run` (`:66-80`) triggers the real I7 pipeline (patch
  generation, build/test run, `git add`/`git commit`/`git checkout --`
  against the live repo). No rate limit on `/pipeline/run` or
  `/pipeline/validate`; the latter is fire-and-forget (response sent
  immediately, work continues async — `:83-89`), so a caller can fire many
  concurrent repo-mutating validation runs with no throttling.

### 2.5 `backend/routes/engineering.js` — DEFECT, **MEDIUM** (undocumented repo-committing surface, no operator gate, no rate limit)

- Mount: `/engineering`, `requireAuth` only (`backend/routes/index.js:109`).
  The barrel's own inline comment describes this file as exposing only
  `/engineering/intelligence` — materially incomplete: the file is 1058
  lines and also exposes rule-registry, RCA, confidence-engine, DLQ-drain,
  autonomous-scenario, and benchmark-suite routes.
- Most of the file is genuinely read-only derived analytics (same
  platform-wide, no-tenant shape as the already-certified "X V1" family) —
  no defect there.
- Two routes are real, repo-mutating operations gated by `requireAuth`
  only, no `operatorOnly`, no rate limit:
  - `POST /engineering/scenario/run` (`:973-985`) runs the full
    Observe→Discover→Plan→Execute→Validate→Commit→Report pipeline against
    the live repo; the commit step requires `approved:true` in the request
    body, but that flag is **caller-supplied**, not operator-verified
    server-side.
  - `POST /engineering/benchmark/run` and
    `POST /engineering/benchmark/scenario/:id` (`:1010-1056`) →
    `engineeringBenchmark.cjs:80-230` — confirmed: reads a real file,
    patches it, `git add`s it, and **commits it** directly against the
    live repository root via `execFileSync`, rolling back via
    `git checkout --` on test failure. `targetFile` is hardcoded per
    scenario ID server-side (not attacker-controlled — no arbitrary-path
    write), but the operation itself is real and consequential.

### 2.6 `backend/routes/autonomousAgent.js` — DEFECT, **MEDIUM** (cross-tenant IDOR, same shape as mission.js)

- Mount: `/autonomous/*`, in-file `requireAuth` on each route
  individually (`:27,45,60,72,85,97,110,121,134`).
- `GET /autonomous/:id`, `POST /autonomous/:id/pause|resume|cancel|retry`
  (`:60-144`) pass `req.params.id` straight into
  `autonomousEngineeringAgent.cjs`'s mission-control functions with no
  ownership check. Zero `orgId` references anywhere in that service.
  `GET /autonomous` (list) and `GET /autonomous/stats` are also
  unscoped/platform-wide.
- Lower blast radius than `mission.js` (engineering-automation missions,
  not customer business data), but pause/cancel/retry are real
  state-changing actions any authenticated user could trigger against
  another party's running automation.

### 2.7–2.9 `researchInstitute.js`, `okb-x.js`, `ose-x.js` — **NO DEFECT FOUND**

All three traced fully into their backing service families
(`researchPlanner.cjs`/`benchmarkEngine.cjs`/`experimentManager.cjs`/
`researchPublicationEngine.cjs`; `knowledgeReasoningEngine.cjs`/
`knowledgeGraph.cjs`/`engineeringMemoryEngine.cjs`/`akoState.cjs`;
`evolutionReasoningEngine.cjs`/`aeoState.cjs`/`selfImprovementEngine.cjs`)
— zero `orgId` references anywhere in any of them, and none operate over
customer/business data. These are genuinely platform/founder-level R&D,
knowledge-graph, and self-evolution systems with no per-tenant data model
to violate — same conclusion class as the already-certified `oai-x.js`/
`odi-x.js` siblings. No action needed.

## 3. Updated remediation grouping

The original 43A-proposed fix scope (`mission.js`, `collaboration.js`,
`plan-management.js`) should be **expanded**, not left as a separate
mission, since 5 of the 6 new defects share the identical fix pattern.
(Note: a separately-numbered, unrelated "Mission 43B" — Frontend A-Z Gap
Discovery — was appended to the register by another session in parallel
with this work; the backend fix mission proposed here needs its own
distinct number, e.g. "Mission 43D," when scheduled, to avoid confusion
with that frontend mission.)

- **Same IDOR-ownership-check pattern** (add server-resolved
  caller-org/account check before returning/mutating a caller-supplied
  resource ID): `pipeline.js`, `autonomousAgent.js`, and the
  `browserPlatform.js` session/cookie routes (using `_accountId(req)`,
  which already exists in-file and just isn't applied consistently).
- **Same unscoped-service-call pattern as plan-management.js** (pass the
  already-supported `orgId` argument through): `obi-x.js`'s
  `crmService.getStats()` call plus its other unscoped service calls.
- **Same `operatorOnly`-gate-precedent pattern as `/computer/*`**
  (mount-level `operatorOnly`, already justified in
  `backend/routes/index.js:301-310`): `workspaceMesh.js` entirely, plus
  `engineering.js`'s two mutating routes specifically
  (`/scenario/run`, `/benchmark/*`) via a scoped route-level
  `operatorOnly`, not a blanket mount-level one (since the rest of the
  file is legitimately broader-access read-only analytics).
- **Additive, not architectural**: rate limiting on
  `browserPlatform.js`'s control/session routes (reuse the existing
  `rateLimiter` middleware already used in `browser.js`), and on
  `pipeline.js`'s run/validate routes and `engineering.js`'s two mutating
  routes.

This remains one mission-sized unit of work (same fix primitives applied
across a wider but related file set), not a new architecture — consistent
with CLAUDE.md §16/§22.

## 4. Limitations

- Verification traced one level into services per file, as instructed;
  did not exhaustively read every downstream function (e.g. did not fully
  audit `computerExecutionEngine.execute()`'s own internals beyond
  confirming it's the same stack `/computer/*` already gates).
- No live server exercise (no running-server reproduction) — findings are
  from direct static code reading of route handlers and their immediate
  service dependencies, consistent with the discovery-only mission scope.
- No code changed, no packages installed, no `.env`/production/VPS
  touched, no git commit/push/merge performed.
