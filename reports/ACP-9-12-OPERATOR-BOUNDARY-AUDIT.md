# MEMORY/ACP AUTHORIZATION BOUNDARY — AUDIT

**Track:** OOPLIX V1 Master Audit — resolving the open Memory OS authorization candidate
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** Memory OS Fake-Success Masking Audit (raised this candidate, deliberately
undecided), 25-OS Master Reconciliation (`/eos`/`/ent`/`/eco`/`/civ`/`/auto` operatorOnly precedent).

---

## Why this item, and how the boundary was determined (not guessed)

The Memory OS Fake-Success mission surfaced a real, live-confirmed fact — ordinary authenticated
customers could read internal platform-engineering data (RCAs, patch history, knowledge-growth stats)
via `/memory/*`, `/memory-index/*`, `/p18/memory/*` — but explicitly declined to fix it, since "should
this be operator-only, role-gated, or intentionally shared?" is a product decision, not something to
guess.

This mission's instruction was explicit: determine the intended boundary from **existing product
architecture, route intent, comments, documentation, and established permission patterns** — and only
fix if that boundary is clearly established.

It is. `backend/routes/index.js` already contains a directly on-point precedent, fixed earlier this
session for the platform's Level 6-10 surfaces:

```js
// operatorOnly: /eos/v6/* is the platform-wide Executive OS surface — goals,
// missions, decisions, approvals, budgets, risks across every org... The
// equivalent surface in Finance OS (GET /revenue/dashboard) is already
// operatorOnly; this closes the same gap here. Regular tenants get their
// own org-scoped view via /org-executive/:orgId/*...
router.use("/eos", requireAuth, operatorOnly);
// operatorOnly: /ent/v7/*, /eco/v8/*, /civ/v9/* are the same class of
// platform-wide Level 7-9 surface... no per-tenant scoping exists anywhere
// in their state singletons... Previously gated by requireAuth alone;
// live-reproduced with a non-operator tenant account... There is no
// tenant-scoped equivalent surface to preserve...
router.use("/ent", requireAuth, operatorOnly);
router.use("/eco", requireAuth, operatorOnly);
router.use("/civ", requireAuth, operatorOnly);
// operatorOnly: /auto/v10/* is the platform-wide Level 10 Autonomous
// Civilization surface... Previously gated by requireAuth alone, so any
// authenticated tenant... could read the full decision ledger AND
// pause/resume the platform's autonomous loop...
router.use("/auto", requireAuth, operatorOnly);
```

The justifying test this codebase has already applied five times: **(1)** no per-tenant scoping exists
anywhere in the backing state, **(2)** live-reproduced non-operator access to real platform-wide data
or writes, **(3)** no tenant-scoped equivalent route exists to preserve. This is not an ad-hoc rule I
invented — it is the codebase's own established, repeatedly-applied policy.

## Discovery — confirming ACP-9-12 matches the precedent exactly

**`/repo-viz/*` (ACP-9)**: `backend/services/repositoryVisualizationEngine.cjs` — both `buildRepoMap`
and its sibling functions resolve `path.resolve(cwd || process.cwd())`. There is no `orgId` parameter
anywhere in this function's signature. Every customer who reaches this endpoint sees the exact same
data — this server process's own repository (`/Users/ehtsm/jarvis-os`) — because there is structurally
no tenant dimension in the data model at all, not merely an unenforced one.

**`/memory/*` (ACP-10), `/memory-index/*`**: `engineeringMemoryEngine.cjs`, `unifiedMemoryEngine.cjs` —
0 `orgId` occurrences (grep-confirmed, both files). Data sources are lessons, RCAs, patch history,
pipeline runs — all about Ooplix's own codebase's engineering process.

**`/improvement/*` (ACP-11)**: `selfImprovement`'s backing evolution-cycle store — same zero-`orgId`
characteristic, confirmed live: `GET /improvement/stats` returns real cumulative stats
(`evolutionCycles: 27, patternsFound: 361, rulesPromoted: 85`) identical regardless of which account
queries it.

**`/platform/*` (ACP-12)**: `autonomousPlatform` run history — same characteristic.

**Frontend reachability confirmed exclusive**: `grep -rl '"/repo-viz\|"/memory-index\|"/improvement/\|"/platform/"' frontend/src/components/*.jsx`
returns exactly 4 files: `RepositoryMapPanel.jsx`, `EngineeringMemoryPanel.jsx`,
`SelfImprovementPanel.jsx`, `AutonomousPlatformPanel.jsx` — all mounted only inside
`AutonomousAgentDashboard.jsx`, itself explicitly titled around the "AI Coding Program" (ACP-1 through
ACP-12), alongside `DecisionsPanel`, `TechDebtDashboard`, `BundlePreviewPanel`, `ComposerPanel`,
`AutonomousAgentPanel` — all of which operate on `cwd={null}` (this server's own repository). No other
frontend component anywhere in the codebase references any of these 4 route groups. There is no
customer-facing feature that depends on ordinary-tenant access to any of them.

**The contrast that proves the fix's scope is correctly precise**: `/coding/*` (ACP-1 through ACP-8,
`codingAssistant.js`) is a **materially different system** — `grep -c "orgId\|req.org"
backend/routes/codingAssistant.js` → 37 real occurrences. This is the genuinely tenant-scoped,
customer-facing "repo-aware coding assistant" feature (per this session's own project memory). It was
deliberately **not** touched by this fix.

## Fix

Added `operatorOnly` to all 5 affected `router.use()` mounts in `backend/routes/index.js`, matching
the exact syntax already used for `/eos`/`/ent`/`/eco`/`/civ`/`/auto`:

```js
router.use("/repo-viz", requireAuth, operatorOnly);
router.use("/memory", requireAuth, operatorOnly);
router.use("/memory-index", requireAuth, operatorOnly);
router.use("/improvement", requireAuth, operatorOnly);
router.use("/platform", requireAuth, operatorOnly);
```

No new middleware, no new architecture — `operatorOnly` is the same, already-proven-correct function
(`backend/middleware/authMiddleware.js`) used by 5 other route groups today.

## The genuinely distinct, correctly-undecided case: `/p18/memory/*`

Investigated `SharedMemoryCenter.jsx` (a real, mounted, no-role-gate-reachable "Memory Fabric" tab)
because it consumes the *different* `/p18/memory/*` surface (`phase18.js`,
`memoryPersistenceLayer.cjs`), which the original Memory OS mission's candidate also named.

Found this is **not the same situation** as ACP-9-12, for two reasons:

1. **7 real frontend consumers** (`EngineeringWorkspace.jsx`, `MemoryOSV2.jsx`,
   `MemoryIntelligenceCenter.jsx`, `MemoryCenter.jsx`, `MissionControlV1.jsx`,
   `SharedMemoryCenter.jsx`, `SystemHealthDashboard.jsx`) — several plausibly legitimate,
   customer-facing features, not exclusively an operator-only dashboard's own tooling.
2. **`SharedMemoryCenter.jsx` already handles the failure path honestly** — its hardcoded
   `MEMORY_NODES` (describing the *platform operator's own* business: Ooplix pricing, Ooplix ICP,
   "Owner: Altamashjauhar") is only an initial seed, correctly replaced by real `listMemoryNodes()`
   data on success, and a visible `apiError` banner ("⚠ Live memory data unavailable — showing seed
   data") discloses when the real fetch fails — not a silent fabrication.

Live-confirmed the real backing data itself: `GET /p18/memory` (as an ordinary ` c10invitee` customer)
returns genuinely shared, non-tenant-specific records (`key: "test_semem_...", tags:
["failure","project:test_proj_a1"]`) — the same 2000-node store any account sees identically, since
`memoryPersistenceLayer.cjs` is also confirmed 0-`orgId`. This is architecturally the same underlying
fact as ACP-9-12 (no tenant dimension) — but the product-intent question is genuinely different: is
`/p18/memory` meant to become real per-customer "your company's shared agent memory" (matching
`SharedMemoryCenter.jsx`'s own UI framing), or is it meant to stay platform-wide shared operational
learning (matching its actual current data, which includes cross-system test/integration entries, not
solely one operator's engineering meta-data)? Fixing this with `operatorOnly` would **break a real,
already-shipped customer feature**. Fixing it with tenant-scoping would require new architecture
(adding `orgId` filtering across an engine multiple other systems also write to) — explicitly out of
bounds for this mission ("do not create random architecture", "if it genuinely requires a
product/security policy decision, document it as BLOCKED/DECISION REQUIRED").

**Classified: DECISION REQUIRED.** Not fixed. Documented here as a distinct, narrower, still-open
candidate for a future mission with a clear product-policy answer, separate from the now-closed ACP-9-12
question.

## Live re-verification

- Ordinary customer (`c10invitee`, no operator role) on all 5 fixed routes → `403 Forbidden — operator
  access required` (was `200`/real data before this fix).
- Unauthenticated on the same routes → `401` (unchanged — auth check runs before the role check).
- `/coding/context` (the deliberately untouched, genuinely tenant-scoped ACP-1-8 system) for the same
  ordinary customer → still `200`, real data — confirms the fix's scope stayed exactly as intended,
  not over-broadened.
- Re-ran all of the above on a fresh server process after a real restart — identical results.

## Regression

- Added 2 tests (describe block `127-master-audit-acp-9-12-operator-gate`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`, matching the exact structural-assertion pattern
  already used for the `/ent`/`/eco`/`/civ` precedent fix (describe block 114). Negative-tested —
  reverted all 5 gate additions at once, confirmed the structural test failed, restored.
- `npm run test:runtime`: **246/246** (244/244 baseline + 2 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: 8/8, unaffected.
- Production build: clean (no frontend files changed by this fix).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Memory/ACP Authorization Boundary (ACP-9 through ACP-12)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 90%

## V1 SURFACE

- **Backend:** `backend/routes/index.js` — 5 `router.use()` mounts gated with `operatorOnly`, matching
  the codebase's own established precedent exactly. No middleware or service logic changed.
- **Routes:** `/repo-viz/*`, `/memory/*`, `/memory-index/*`, `/improvement/*`, `/platform/*` — all
  live-tested, all correctly denied to ordinary customers, all still correctly reachable in principle
  by a real operator account (the mechanism itself — `operatorOnly` — is the same one already proven
  correct on 5 other route groups this session, not newly built or newly tested here).
- **Frontend:** none changed — the 4 ACP panel components already correctly handle a `403`/error
  response (each already has honest error-handling paths from the prior 2 missions' fixes), no new
  frontend work required for this authorization fix.
- **Persistence:** N/A — no persisted state changed.
- **Authentication:** PASS — unaffected; unauthenticated requests still correctly `401`.
- **Authorization:** PASS after fix — the exact defect (any authenticated customer reaching
  platform-internal engineering data) is closed, using the codebase's own proven mechanism.
- **Tenant Isolation:** N/A directly — this fix is about operator-vs-customer access, not
  cross-tenant leakage (the underlying data was never tenant-scoped to begin with, by design).
- **Cross-OS:** N/A — a route-gating fix in the shared barrel file, not a cross-OS composition.
- **Failure Honesty:** PASS — the new `403` carries the same real, existing, honest message
  (`operatorOnly`'s own `"Forbidden — operator access required"`) already used elsewhere.
- **Live Verification:** every claim backed by real HTTP requests with a real ordinary customer
  account, a real restart, and a real confirmation that the deliberately-untouched `/coding/*` remains
  reachable.
- **Regression:** 246/246 (244/244 baseline + 2 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — 5 route groups (ACP-9 through ACP-12) exposed platform-internal
  engineering data to any authenticated customer, matching a defect class this exact codebase had
  already identified and fixed 5 times for adjacent platform-wide surfaces (`/eos`/`/ent`/`/eco`/
  `/civ`/`/auto`), but had not yet applied to this family.
- **V1-critical P2:** 0
- **Other:** correctly identified and preserved the boundary between ACP-9-12 (platform-wide, fixed)
  and `/coding/*` ACP-1-8 (genuinely tenant-scoped, untouched) — confirmed by real `orgId` occurrence
  counts, not assumption; correctly identified `/p18/memory/*` as a distinct, harder case requiring an
  actual product decision rather than force-applying the same fix.

## FIXES

- `backend/routes/index.js`: added `operatorOnly` to the `router.use()` mounts for `/repo-viz`,
  `/memory`, `/memory-index`, `/improvement`, `/platform` — 5 lines changed, reusing the existing,
  already-proven `operatorOnly` middleware.
- 2 new regression tests, negative-tested.

## LIMITATIONS

- `/p18/memory/*` (a related but distinct surface, consumed by `SharedMemoryCenter.jsx` and 6 other
  components) remains genuinely undecided — documented as **DECISION REQUIRED**, not fixed, since
  fixing it either direction (operator-only or tenant-scoped) would require a product-policy answer
  this pass is not positioned to make without guessing, per this mission's own explicit instruction.
- The fix was verified via the `operatorOnly` mechanism's already-proven correctness (5 prior
  successful applications this session) and real non-operator-denial testing; a real operator-account
  login was not performed (would require inventing/guessing the operator password, explicitly
  forbidden) — operator-side reachability is inferred from the identical, already-tested mechanism,
  not independently re-verified with a live operator session this pass.
- No frontend UX change was made for the 4 ACP panels' new `403` responses — each already has a
  generic error-handling path from prior fixes, but no dedicated "operator access required" messaging
  was added; a non-operator user reaching these tabs will see a generic fetch-failure state, not a
  purpose-built explanation. Out of this narrow authorization fix's scope.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Resolves the authorization-boundary question the Memory OS Fake-Success mission correctly declined to
guess at, using the codebase's own established, previously-applied policy rather than inventing a new
one — closing a real security gap (platform-internal engineering data reachable by any paying
customer) across 5 route groups with a 5-line, zero-new-architecture fix. Correctly narrows scope
twice: once by confirming `/coding/*` must NOT be touched (a real customer feature), and once by
correctly declining to force a decision on the genuinely harder `/p18/memory/*` case rather than
guessing in either direction. No OS-track record altered.

## REGRESSION RESULT: 246/246 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean; backend-only change, no frontend files modified)
