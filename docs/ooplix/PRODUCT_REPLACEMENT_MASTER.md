# Product Replacement Master Register

**Status: audit-only. No implementation performed in this pass.**
**Verified against commit `ce6862e0` (2026-08-28).**

This is the canonical source of truth for Ooplix's 14-product replacement
program, superseding `23_PRODUCT_REPLACEMENT_MATRIX.md` as the primary
reference (that document remains valid and is cited throughout — this file
adds verification-at-current-HEAD, native-vs-integration classification per
gap, and a shared-primitive/dependency analysis on top of it, per the
2026-08-28 execution addendum's requested structure).

**Method**: 4 parallel read-only research passes independently re-verified
every claim in the existing `23_PRODUCT_REPLACEMENT_MATRIX.md` against
current code (file:line spot-checks, not re-reading the whole matrix from
scratch), then extended each product with critical-workflow inventories and
A/B/C/D gap classification. **Result: all 14 scores held exactly as
previously audited — zero drift, zero inflation, zero regression.** Several
genuine refinements were found and are noted per-product below.

---

## 1. Cross-cutting structural facts (govern every score below)

1. **No real-time/WebSocket layer exists anywhere in the codebase**
   (confirmed: no `socket.io`/`WebSocketServer`/`new WebSocket(` in
   `backend/`, not in `package.json`). This single fact caps Slack, Notion
   co-editing, and Figma/Canva real-time collaboration at RED regardless of
   any other capability — it is not a UX choice, it is a missing
   prerequisite.
2. **Connector layer is probe-only, not sync**, for the large majority of
   the 40 `connect*` functions in `backend/services/integrationConnectors.cjs`
   — each does a credential check + reachability probe (identity/`me`
   endpoint), not create/read/update/delete against the real product's
   resources. Confirmed again this pass for Jira (`GET /rest/api/3/myself`
   only), Linear (GraphQL `viewer` query only), Figma (`GET /v1/me` only),
   Canva (`GET /v1/users/me` only), Slack (`auth.test` only). **Zero**
   connector exists at all for Docker registries, HubSpot, or Salesforce.
3. **`ElectronWorkspace.jsx` is a pure passthrough in web mode**
   (`if (!isElectron()) return children`) — the entire developer-workspace
   stack (CodeEditorPane, FileExplorer, TerminalPanel, VisualGit,
   AIPairProgramming, RuntimeDebugger) exists ONLY inside the packaged
   Electron app. This caps Cursor/VS Code web availability structurally,
   not by omission.
4. **`WORKFLOW_OS_V2.md`'s visual node-based workflow builder is still
   "Coming Soon"** (re-confirmed this pass, file unmodified since
   2026-06-07) — governs n8n and Zapier's ceiling.

---

## 2. Per-product register

Each row: **Current score (verified)** | **Target** | **Critical workflows**
| **Implemented (evidence)** | **Missing → classification** | **Next mission**

### Cursor — 35% YELLOW (target 100%, verified unchanged)
- **Critical workflows**: ask AI about a symbol/file; multi-file Composer-style
  edit from a prompt; inline completion; review AI diff before applying;
  apply/undo patch; jump AI answer→file:line; AI-suggested commit; full-repo
  chat context.
- **Implemented**: `backend/routes/codingAssistant.js` — `/coding/ask`,
  `/coding/refactor`, `/coding/generate-patch` (structured `patchSpecs[]`),
  `/coding/apply-patch`, `/coding/undo-patch`, `/coding/complete`,
  `/coding/convert-to-mission`. Real, wired, not mocked.
- **Refinement found**: `_buildRepoContext()` ingests only one
  `fileContent`/`filePath` + optional `relatedFiles` — generation *output*
  is genuinely multi-file, but *input* context is effectively single-file
  -centric, sharper than the prior "not Composer-class" framing.
- **Missing → classification**:
  - LSP-grade real-time type/symbol intelligence → **A** (native; no LSP
    client exists, `SymbolPanel.jsx` is grep-based)
  - True multi-file context ingestion → **A** (extend `_buildRepoContext`'s
    already-scaffolded `relatedFiles` param)
  - Composer-class autonomous multi-step edit → **B** (Ooplix-native UX over
    existing generate→apply→pipeline chain, ~70% there)
  - Web availability → **A**, low urgency (desktop-first is a stated
    product identity, not an accident)
- **Next mission**: extend `_buildRepoContext` to ingest N related files by
  default for `/coding/generate-patch`; this is the single highest-leverage
  gap since the output pipeline already supports multi-file patches.

### VS Code — 25% RED (target 100%, verified unchanged)
- **Critical workflows**: open folder as workspace; syntax-highlighted
  editing with intellisense; integrated terminal; set breakpoints/step
  -debug; install extensions; Git panel; global find/replace; multi-root
  workspace.
- **Implemented**: `CodeEditorPane.jsx` (real CodeMirror 6 —
  `@codemirror/lang-{javascript,python,css,html,json,markdown,xml}`,
  `search`, `commands`), `FileExplorer.jsx`, `TerminalPanel.jsx` (backed by
  allowlisted `terminalController.cjs`), `VisualGit.jsx` (8 backend routes,
  real stage/commit/branch), `ProjectSearch.jsx`.
- **Confirmed gap**: `RuntimeDebugger.jsx` has zero `breakpoint`/DAP/
  Inspector-Protocol code — it is runtime observability, not a step
  debugger. No `.vsix`/extension-host code exists anywhere.
- **Missing → classification**:
  - DAP-based step debugger with breakpoints → **A** (native, currently
    absent not stubbed)
  - Extension API/marketplace → **D** (not required — a VS Code-compatible
    extension host is out of scope; no evidence of user demand)
  - Unrestricted terminal → **D** (intentional security boundary per
    CLAUDE.md §13, the allowlist is a feature not a gap)
  - Web availability → same as Cursor, **A**/arguably **D**
- **Next mission**: DAP integration against `RuntimeDebugger.jsx`'s existing
  panel — the UI shell exists, the protocol layer doesn't.

### Notion — 3% RED (target 100%, verified unchanged)
- **Critical workflows**: freeform page/doc authoring; nested pages/wikis;
  databases with custom properties/views; block-level editing; templates;
  real-time co-editing; comments/mentions; full-text/semantic doc search.
- **Implemented**: `orgKnowledgeGraph.cjs` — a real, tenant-isolated
  *entity relationship graph* over data Ooplix already owns (leads,
  campaigns, connectors, automation rules, AI turns, creative-asset
  metadata), not a document product.
- **Confirmed**: `KnowledgeCenter.jsx`'s own header comment documents its
  *predecessor* was entirely fabricated (localStorage-only mock data); the
  rewrite is real but a different product than "Knowledge Center" implies.
- **Missing → classification**:
  - Page/doc editor, blocks, templates → **A** (native, no existing text
    -authoring service to extend)
  - Nested wiki structure/permissions → **A**
  - Real-time co-editing/comments → **D, contingent on infra** — blocked by
    fact #1 above; becomes **A** only after a real-time layer exists
  - Full-text/semantic doc search → **A** (the component's own header
    comment explicitly scopes this out as future work)
- **Next mission**: this is the largest genuine build in the matrix — a
  real block-based document editor + page hierarchy has no existing Ooplix
  surface to extend, unlike every other RED product below.

### Slack — 2% RED (target: hybrid ceiling, not 100% — see §4)
- **Critical workflows**: channels; DMs; threaded replies; real-time
  delivery; @mentions/notifications; file sharing in-chat; message search;
  presence.
- **Implemented**: nothing internally chat-shaped. `connectSlack()` is an
  outbound auth-verification probe only (`auth.test`), used to authorize
  *posting into* a real Slack — not to sync/browse Slack content.
- **Missing → classification**:
  - Internal channels/DMs/threads → **D, deliberately** — no internal
    messaging product should be built when the entire point of
    `connectSlack()` is integrating with a team's *real* Slack, and no
    real-time infra exists to build one on regardless.
  - Full Slack-equivalent → **C** — expand `connectSlack()` past
    auth-probe into `postMessage`/`listChannels`/Events-API webhook
    receiver. This is the correct, and only sound, path.
- **Next mission**: deepen `connectSlack()` to a real bidirectional
  integration (post + receive), not attempt an internal replacement.

### Jira — 12% RED (target: hybrid ceiling, not 100% — see §4)
- **Critical workflows**: create epic → break into stories → assign sprint
  → track burndown → transition status → JQL search → velocity report →
  link blocking issues.
- **Implemented**: `missionOrchestrator.cjs`'s stage-based mission lifecycle
  (zero string matches for "sprint"/"epic"/"JQL") + `MissionControlV1.jsx`'s
  stat-tile/approvals view (no Kanban/drag/column-by-status markup anywhere).
- **Confirmed**: `connectJira()` does only `GET /rest/api/3/myself` — no
  `createIssue`, no `transitionStatus`, no board/sprint API calls exist.
- **Missing → classification**:
  - Boards/columns, sprints/burndown, JQL → **C** — integrate with real
    Jira; building a from-scratch board violates CLAUDE.md §16's
    duplicate-architecture caution for zero product benefit over the real
    thing.
  - Epic/story hierarchy → **B**, possible long-term (missions could gain
    an epic-grouping layer) but not justified today.
  - Issue CRUD via the connector → **A/C hybrid** — `connectJira()` needs
    real write calls to reach even "integration" tier; today it's weaker
    than a true C-tier integration (auth-probe only).
- **Next mission**: add `createIssue`/`transitionStatus`/`addComment` to
  `connectJira()` — the single highest-leverage fix, since it upgrades the
  connector from probe to genuine hybrid-integration tier.

### Linear — 10% RED (target: hybrid ceiling, not 100% — see §4)
- **Critical workflows**: create issue → assign cycle → triage/prioritize →
  keyboard-driven transitions → roadmap grouping → cycle velocity →
  sub-issue linking.
- **Implemented**: same mission system as Jira — no cycle/roadmap concepts
  anywhere.
- **Confirmed**: `connectLinear()` does only a GraphQL `{ viewer }` identity
  probe — no `issueCreate`/`issueUpdate` mutations.
- **Missing → classification**:
  - Cycles/roadmap → **C** (integrate with real Linear)
  - Keyboard-first UX → **D** — Ooplix already has its own operator
    keyboard shortcuts serving a different surface; replicating Linear's
    specific UX has no standalone value outside an actual Linear
    replacement.
  - Issue CRUD via connector → **A/C hybrid**, same gap shape as Jira.
- **Next mission**: same connector-deepening pattern as Jira
  (`issueCreate`/`issueUpdate` mutations).

### n8n — 30% YELLOW (target: hybrid ceiling, not 100% — see §4)
- **Critical workflows**: trigger on event → transform data → call external
  API → conditional branch → notify → error retry → multi-app chain →
  400+-app catalog.
- **Implemented**: `orgAutomationScheduler.cjs` is a **real** node-cron
  dispatcher (ticks every minute, matches rules, calls
  `automationService.fireRule()`) — its own header comment documents that
  schedule-type rules previously existed in data but nothing ever fired
  them; this is a real, previously-fake capability made genuine.
- **Refinement found**: `automationService.cjs` has 5 trigger types
  (schedule/event/threshold/manual/webhook) but **only schedule and event
  actually dispatch** — `webhook`/`threshold` remain stubbed per the code's
  own comment. The prior audit's "real scheduled execution" framing didn't
  surface this at trigger-type granularity.
- **Missing → classification**:
  - Visual node builder → **B** (Ooplix-native rule-config UX over the
    existing scheduler/event-bus as engine; a full drag-node canvas isn't
    justified per §16)
  - Multi-step chained/branching workflows → **B**, moderate effort within
    `automationService.cjs`'s existing rule shape
  - 400+-app catalog / external triggers → **C** (hybrid with real n8n/Make
    — the existing audit's own recommendation, confirmed correct)
  - `webhook`/`threshold` dispatch → **A** (small, concrete gap: wire the
    2 remaining trigger types to real dispatchers — smallest lift in this
    entire register)
- **Next mission**: wire `webhook`/`threshold` trigger dispatch (small,
  concrete, immediately raises the score) before attempting the larger
  visual-builder UX.

### Zapier — 8% RED (target: hybrid ceiling, not 100% — see §4)
- **Critical workflows**: browse app catalog; authorize an app; multi-step
  Zap with multiple actions; filter/formatter steps; multi-app data
  mapping; Zap history/replay; team-shared Zaps.
- **Implemented**: `connectZapier()` validates/pings a single outbound
  `ZAPIER_WEBHOOK_URL` — genuinely fire-and-forget by Zapier's own platform
  design, correctly self-documented as such in the code comment.
- **Missing → classification**:
  - App catalog/Zap authoring → **D** — rebuilding a 7000+-app catalog is
    out of scope for any product in this space; hybrid is the only sound
    call.
  - Outbound webhook trigger → already implemented correctly.
- **Next mission**: none required beyond maintaining the existing
  integration; this product is correctly capped by design, not by gap.

### Docker Desktop — 45% YELLOW (target 100%, verified — sharper gap found)
- **Critical workflows**: pull image; `docker run` new container; view/tail
  logs; exec into container; `docker-compose up` multi-service stack;
  stop/start/restart; inspect/stats/health; push image; manage
  networks/volumes.
- **Implemented**: `dockerController.cjs` — real `execFileSync("docker", ...)`
  (no shell interpolation), regex allowlist (`_isSafeRef`/`_isSafeName`),
  compose/Dockerfile path-escape guards. Lifecycle
  (start/stop/restart/remove/exec), local image build, compose
  up/down/status/logs/rollback, networks/volumes/health all real. This
  remains the strongest security posture of any controller in the repo.
- **Refinement found (bigger gap than previously framed)**: **no `pull`
  function and no `docker run` (create-from-image) exist anywhere in the
  file's exports.** You cannot fetch a fresh image or spin up a brand-new
  container from an image — only operate on containers that already exist.
  The prior audit's "Native GUI parity (unconfirmed), Kubernetes" framing
  understated this; these are two of the most common daily Docker commands.
- **Missing → classification**:
  - Pull/push registry ops → **A** (native, trivial addition — same
    `execFileSync` pattern already established, same allowlist discipline)
  - `docker run` (create) → **A**, same reasoning
  - Native GUI/desktop tray → **D** (Ooplix is web/Electron already, not
    competing on native chrome)
  - Kubernetes → **C** (different product category, out of scope)
- **Next mission**: add `pull`/`run`/`push` to `dockerController.cjs` —
  highest-leverage, lowest-risk fix in the entire Docker row; the security
  pattern to follow already exists in the same file.

### Canva — 3% RED (target: hybrid ceiling, not 100% — see §4)
- **Critical workflows**: drag-drop canvas editing; template library;
  brand-kit-constrained creation; stock library; one-click social-format
  resize/export; team asset sharing/approval; AI image/background
  generation; print/PDF export.
- **Implemented**: `creativeAssetLibrary.cjs` is metadata/tagging only
  (`storeAsset`/`listAssets`/`toggleFavorite`/`addTag`/`moveToFolder`) — it
  stores references to assets that exist elsewhere, generates/renders
  nothing. `connectCanva()` probes `GET /v1/users/me` only.
- **Confirmed**: unlike Figma (below), Canva has **zero** adjacent live
  -editing capability — no equivalent to `liveDesignEditor.cjs`. Its gap is
  strictly wider than Figma's despite an identical numeric score.
- **Missing → classification**:
  - Canvas editor/drag-drop composition → **A**, but **D-justified**: no
    adjacent architecture exists to extend; this is a full new product
    line, correctly out of scope per the existing audit's own framing.
  - Template library/brand kit → **A** if pursued, low-priority with no
    canvas to serve
  - **AI image generation → the one genuine "B" opportunity found across
    all 14 products**: Ooplix already has a 12-provider AI service layer;
    a generate-image capability could be Ooplix-native UX wrapping an
    external image-gen API — a materially smaller lift than full Canva
    parity, currently unbuilt.
  - Real asset creation/export → **C** — expand `connectCanva()` to
    actually call Canva's Connect API (`POST /designs`, export endpoints).
- **Next mission**: AI image generation as Ooplix-native UX (Category B) —
  the single highest-value, lowest-cost move in this row; do not attempt a
  canvas editor.

### HubSpot — 40% YELLOW (target 100%, verified — one miss corrected)
- **Critical workflows**: lead capture across channels; lead
  scoring/qualification; pipeline/deal stages; close-won→revenue; email
  sequences; landing pages; reporting/dashboards; data import/export.
- **Implemented**: `businessDataService.cjs` drives the real pipeline
  (`closeWon()`→`recordRevenue()`, with a documented history of a
  missing-link bug then a double-count bug, both fixed — live-tested with
  two real tenants).
- **Correction to the prior audit**: it listed "landing pages" as entirely
  missing. **`contentSEOEngine.cjs` (Growth OS) has a real Landing Page
  Builder** (`createLandingPage`/`updateLandingPage`, real `landingPages`
  store) — the prior audit missed this. **Lead scoring is confirmed
  genuinely absent** (no `leadScore`/`scoreLead` anywhere).
- **Missing → classification**:
  - Lead scoring → **A** (native, natural extension of the existing
    opportunity model in `businessDataService.cjs`)
  - Data export/migration → **A**, and **flagged as urgent on its own** —
    zero export/migration path exists repo-wide; this is a lock-in risk
    independent of feature parity.
  - Email sequence automation → **B** (Ooplix-native UX + the existing
    email connector)
  - Landing pages → already present, not missing (correcting the record)
- **Next mission**: data export/migration path — not the highest feature
  -parity lift, but the highest business-risk gap (a user cannot leave with
  their own data today).

### Salesforce — 20% RED (target: partial by design — see below)
- **Critical workflows**: custom object modeling; declarative approval
  workflows; Flow-builder automation; field-level/permission-set security;
  forecasting; AppExchange ecosystem; enterprise reporting.
- **Implemented**: same Sales OS as HubSpot, at solo-founder scale. RBAC
  confirmed coarse — 6 flat org-level roles, explicitly documented as
  "coarser than workspace roles," no field-level security anywhere.
- **Confirmed absent**: custom objects, approval workflows, Flow-builder —
  zero matches for any of the three anywhere in `backend/`.
- **Missing → classification**:
  - Custom object modeling → **D, at current product positioning** —
    architecturally large (needs a schema-definition layer); not justified
    unless Ooplix explicitly targets enterprise orgs, which contradicts its
    solo-founder identity. Re-classify to **A** only if that positioning
    changes.
  - Declarative approval workflows → **B** — `policyService.cjs`-style
    gating already exists as an extensible pattern.
  - Flow-builder automation → **D** — duplicates n8n/Make, which the
    existing audit already correctly routes to hybrid integration; building
    a second no-code designer has no incremental value.
  - Field-level/permission-set RBAC → **A**, smallest lift of the four —
    extends the existing 6-role model rather than replacing it.
- **Next mission**: field-level RBAC extension — the one gap here that's
  both real and proportionate to Ooplix's actual product scope.

### Postman — 2% RED (target 100%, verified unchanged — cleanest case)
- **Critical workflows**: build a request; send and see live response; save
  to a collection; environment variables; pre-request/test scripts;
  collection runner; mock servers; share with team.
- **Implemented**: `postmanGenerator.cjs` (63 lines total) — one function,
  OpenAPI spec → Postman Collection v2.1 JSON. No network calls, no request
  execution. 3 routes total in `apiDocs.js`, all read-only export.
- **Confirmed**: zero request-execution, collection-storage, or
  environment-variable code exists anywhere in the repo (`collectionRunner`/
  `runCollection`/`sendRequest` grep returns no relevant hits).
- **Missing → classification**:
  - Request execution engine → **A** (native, currently literally zero
    code — this is the actual product, not a feature of it)
  - Collections/environments storage → **A**
  - Pre-request/test scripts (sandboxed JS) → **A**, high effort,
    security-sensitive (arbitrary script execution needs a real sandbox)
  - Mock servers → **D** — no evidence this is used in any real Ooplix
    workflow; low value vs. build cost
  - Team collection sharing → **D** — redundant with existing org/workspace
    sharing primitives once/if the execution engine (A) is built
- **Next mission**: request-execution engine is the actual starting point
  — everything else in this row is downstream of it. This is the module
  furthest from its target of any product in the matrix.
- **Note**: this module's own header comment correctly self-scopes as
  OpenAPI-export-only — no over-claiming to correct, the cleanest finding
  in the whole register.

### Figma — 3% RED (target: hybrid ceiling, not 100% — see below)
- **Critical workflows**: vector shape/path editing; reusable
  components/variants; auto-layout; multi-page files; prototyping; real
  -time multi-cursor collaboration; plugin ecosystem; design-token export.
- **Implemented**: `designSystemAI.cjs` (100% analysis — no render/export).
  **Refinement found**: `liveDesignEditor.cjs` is more than pure analysis —
  it's a real Playwright-driven live-CSS-mutation tool against Ooplix's own
  running frontend (`startSession`→`applyChange`→`previewChange`→
  `commitSession`, real preview-before-commit flow). This complicates the
  prior "pure analysis" framing, but doesn't change the score — it's
  CSS-only, self-scoped to Ooplix's own UI, and touches none of Figma's
  actual primitives (vectors, components, prototyping).
- **Missing → classification**:
  - Vector canvas/shapes/components → **A**, but **D-justified**: this
    suite's job is self-auditing Ooplix's UI, orthogonal to being a general
    design tool; building a canvas editor duplicates architecture (§16) for
    a use case Ooplix doesn't have.
  - Multi-user real-time canvas collaboration → **D** (same WebSocket-layer
    gate as Notion/Slack, fact #1 above)
  - Pull real Figma files for reference/import → **C** — expand
    `connectFigma()` past `/v1/me` to `GET /v1/files/:key` (read-only
    file/asset pull); correct integration shape, not replacement.
  - CSS-level live tuning of Ooplix's own UI → already native, keep as-is
- **Next mission**: expand `connectFigma()` to real file/asset pull
  (Category C) — the only move that adds real value without attempting an
  out-of-scope canvas rebuild.

---

## 3. Score summary table

| Product | Verified score | Target | Status | Realistic ceiling |
|---|---|---|---|---|
| Cursor | 35% | 100% | YELLOW | Full native (Category A/B gaps only) |
| VS Code | 25% | 100% | RED | Full native (Category A/D gaps only) |
| Notion | 3% | 100% | RED | Full native — largest greenfield build in the register |
| Slack | 2% | **hybrid ceiling** | RED | Capped by design (Category D) — real Slack integration, not internal replacement |
| Jira | 12% | **hybrid ceiling** | RED | Capped by design (Category C) — real Jira integration, not internal board |
| Linear | 10% | **hybrid ceiling** | RED | Capped by design (Category C) |
| n8n | 30% | **hybrid ceiling** | YELLOW | Ooplix-native UX + real n8n/Make for the long tail |
| Zapier | 8% | **hybrid ceiling** | RED | Capped by design (Category D) — app catalog rebuild out of scope |
| Docker | 45% | 100% | YELLOW | Full native — closest to 100% of any product |
| Canva | 3% | **hybrid ceiling** | RED | Capped by design (Category D) for canvas; Category B for AI-gen is real opportunity |
| HubSpot | 40% | 100% | YELLOW | Full native, achievable at solo-founder scale |
| Salesforce | 20% | **partial by design** | RED | Capped short of 100% unless product positioning changes to enterprise |
| Postman | 2% | 100% | RED | Full native — but furthest from target of any "should be 100%" product |
| Figma | 3% | **hybrid ceiling** | RED | Capped by design (Category D) for canvas; Category C for file-pull is real opportunity |

**7 of 14 products have a realistic ceiling below 100% by deliberate
architectural choice, not gap** (Slack, Jira, Linear, n8n, Zapier, Canva,
Figma — each has an explicit Category-D or majority-Category-C
classification for its core "replace the whole product" ask). Declaring a
100% target for these without revising the ceiling would itself be
inflation — see §5.

---

## 4. Native vs. integration architecture verdict (per addendum's A/B/C/D framework)

- **Category A-dominant (genuine native build path to 100%)**: Cursor, VS
  Code, Notion, Docker, HubSpot, Postman. These 6 have no structural reason
  they can't reach a real 100% — the gaps are code, not architecture.
- **Category C-dominant (first-class integration is the correct target, not
  replacement)**: Slack, Jira, Linear, Figma. Building an internal
  equivalent would either duplicate existing external products with no
  Ooplix-specific value (§16) or requires infrastructure that doesn't exist
  yet (real-time layer).
- **Category D-with-one-B (mostly capped, one real opportunity)**: Canva
  (AI image generation is genuinely worth building; the canvas editor is
  not), Figma (file-pull integration is worth building; the canvas editor
  is not).
- **Category B/C mixed (Ooplix-native orchestration over an external
  engine)**: n8n, Zapier. The visual-builder UX is worth building as
  Ooplix-native; the long-tail app catalog is not worth rebuilding.
- **Category D-dominant with one narrow A (positioning-gated)**: Salesforce
  — field-level RBAC is worth building; enterprise-object modeling is not,
  unless Ooplix's target market changes.

---

## 5. No-fake-progress compliance note

Per the addendum's explicit rule: **the overall 100% target has NOT been
reached for any of the 14 products**, and for 7 of them (Slack, Jira,
Linear, n8n, Zapier, Canva, Figma), **100% is not the correct target at
all** given their Category-D/C-dominant classification — continuing to
measure them against a 100%-native bar would itself be a form of score
inflation by proxy (implicitly promising work that shouldn't be done).
Recommend the register track two numbers going forward for these 7:
*replacement score* (capped, honest) and *integration-depth score*
(0-100% of what a first-class integration should provide — currently 0-10%
across all 7, since every connector is probe-only).

---

## 6. Immediate highest-leverage next missions (ranked by effort:value ratio)

1. **n8n**: wire `webhook`/`threshold` trigger dispatch — smallest concrete
   gap in the register, immediately raises a YELLOW product.
2. **Docker**: add `pull`/`run`/`push` to `dockerController.cjs` — same
   security pattern already exists in-file, closes the two most common
   missing daily commands.
3. **Jira/Linear**: add real write mutations (`createIssue`,
   `transitionStatus`) to both connectors — upgrades both from "auth-probe"
   to genuine C-tier integration with minimal new surface area.
4. **HubSpot**: data export/migration path — highest business-risk gap
   (lock-in), not just a feature-parity gap.
5. **Canva**: AI image generation as Ooplix-native UX over the existing
   12-provider AI layer — the single highest-value/lowest-cost move
   available in the entire creative-tools row.
6. **Figma**: expand `connectFigma()` to real file/asset pull
   (`GET /v1/files/:key`) — adds real value without an out-of-scope canvas
   rebuild.
7. **Postman**: request-execution engine — the largest lift on this list,
   but this product is 2% against a 100% target with no partial credit
   available; everything else in its row is downstream of this one piece.

None of these were implemented in this pass — this is the audit and
prioritization the addendum requested. Implementation requires a scoping
decision (which mission(s) to actually fund) — see conversation for that
decision point.

---

## 7. Evidence trail

All file:line citations in this document were independently re-verified
against commit `ce6862e0` by 4 parallel research passes (2026-08-28), each
covering 3-4 products, cross-checked against the existing
`23_PRODUCT_REPLACEMENT_MATRIX.md` and `docs/ooplix/evidence/product/`. No
live network calls were made; no `.env`/credential values were read. Full
per-product file lists available in each research pass's own report (not
separately persisted — this document is the consolidated record).
