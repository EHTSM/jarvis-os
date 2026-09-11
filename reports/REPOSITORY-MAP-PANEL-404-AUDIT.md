# REPOSITORY MAP PANEL 404 — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after Engineering Memory Panel 404
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior finding referenced:** Engineering Memory Panel 404 Audit (same defect class, same fix pattern).

---

## Why this item

The prior mission fixed one instance of a bespoke, incorrectly `/api`-prefixed fetch helper in
`EngineeringMemoryPanel.jsx`. Rather than selecting the next audit target from the register blind,
systematically searched the entire frontend for the same defect signature:

```
grep -rl "await fetch(\`/api\|fetch('/api\|fetch(\"/api" frontend/src/
```

Found 5 additional matches beyond the one already fixed:

- `AutonomousPlatformPanel.jsx`, `RepositoryMapPanel.jsx`, `SelfImprovementPanel.jsx` — all three
  mounted as sibling tabs inside the same `AutonomousAgentDashboard.jsx` dashboard as the
  just-fixed `EngineeringMemoryPanel.jsx`, reachable via the `agentruntime` tab by any authenticated
  user (no operator gate, confirmed in an earlier mission this session).
- `operator/widgets/RuntimeHealthCard.jsx`, `operator/widgets/FirstRunSetup.jsx` — a different pattern
  (single hardcoded call, not a reusable helper), both already correctly setting
  `credentials:"include"`, mounted only inside the operator-only `OperatorConsole.jsx` — a smaller,
  lower-priority audience. Live-confirmed both still call nonexistent `/api/*` paths and 404, but not
  selected this pass.

Per this mission's explicit instruction ("audit ONE concrete item... do NOT perform a broad
uncontrolled frontend rewrite"), selected the single largest of the three sibling panel components —
`RepositoryMapPanel.jsx` (811 lines, the "Repository" tab, ACP-9 Visual Repository Intelligence — a
named, substantial feature per this session's own project history) — as this pass's one fix. The
other 4 confirmed-broken components remain open, documented findings for future missions, not silently
dropped.

## Discovery

`frontend/src/components/RepositoryMapPanel.jsx`'s own `API()` helper (lines 11-24, prior to this
fix) was **byte-for-byte identical** to the defect already fixed in `EngineeringMemoryPanel.jsx`,
including the same "A.11.2" doc comment — evidently copy-pasted between the two files at some point,
carrying the same bug forward:

```js
const API = async (method, path, body) => {
    const r = await fetch(`/api${path}`, { method, headers: {...}, ...(body ? {body} : {}) });
    ...
};
```

All 8 of this panel's API calls go through this helper: `GET /repo-viz/stats`, `POST /repo-viz/map`,
`GET /repo-viz/module-graph`, `GET /repo-viz/dep-graph`, `GET /repo-viz/hotspots`, `GET
/repo-viz/critical-paths`, `POST /repo-viz/ai-nav`, `GET /repo-viz/node/:id`. Live-tested directly:

```
GET /api/repo-viz/stats  (real, valid auth) -> 404 "Not Found: GET /api/repo-viz/stats"
GET /repo-viz/stats      (the REAL route)   -> 200, real data
```

`backend/routes/index.js` mounts `/repo-viz/*` (`repositoryViz.js`, ACP-9) with no `/api` prefix —
same root cause confirmed in the prior audit: only `/api/auth/*`, `/api/accounts/*`, and `/api/status`
are real duplicate-mounted routes anywhere in this codebase. The entire "Repository" tab has been
completely non-functional across all 8 of its capabilities, for every user, always. Same compounding
second defect: the raw `fetch()` never set `credentials:"include"`.

## Fix

Identical fix to the prior mission — replaced the bespoke helper with a thin delegation to the
canonical `_fetch` (`_client.js`):

```js
import { _fetch } from "../_client";
const API = async (method, path, body) => {
    return _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
};
```

Preserved the file's existing `API(method, path, body)` call-site signature and
`Error{message, status}` contract exactly, so no other line in the file's 8 call sites needed to
change.

## Live re-verification

- Confirmed the real, correct paths now work end-to-end, with real data — not just the individual
  `stats` endpoint:
  1. `POST /repo-viz/map` — built a real repository map: 644 files, 411 code files, 256 dependency
     edges, 12 circular dependencies, 1 hotspot (`backend/routes/index.js`, 135 commits).
  2. `GET /repo-viz/module-graph`, `/repo-viz/dep-graph`, `/repo-viz/hotspots`,
     `/repo-viz/critical-paths` — all correctly returned `{ok:true, error:"no map cached"}` before the
     map existed (an honest, non-fabricated pending state), then real graph data once it did.
  3. `POST /repo-viz/ai-nav` — returned an honest `"AI backend unavailable. Check provider API keys in
     your .env file."` explanation (matching this session's known AI-credential-blocked state) rather
     than a fabricated navigation result.
- Confirmed the old broken `/api`-prefixed path still correctly `404`s — proving this was never a
  working route.
- Re-ran the full `stats`/`map`/`hotspots` sequence on a fresh server process after a real restart —
  identical, correct results.
- Verified the fix is present in the actual built, served production JS chunk: located the compiled
  chunk containing `/repo-viz/stats`, confirmed the real path string is present and no
  `` `/api${ `` pattern remains anywhere in the build output.

## Regression

- Added 2 tests (describe block `125-master-audit-repository-map-panel-404`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Negative-tested — reverted the fix, confirmed
  both failed, restored.
- `npm run test:runtime`: **240/240** (238/238 baseline + 2 new tests).
- Production build: clean, fix confirmed present in the served bundle.
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Repository Map Panel 404 (RepositoryMapPanel.jsx)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.4/10
**CONFIDENCE:** 88%

## V1 SURFACE

- **Backend:** none changed — `/repo-viz/*` routes (ACP-9) were already correct; re-verified, not
  modified.
- **Routes:** `GET /repo-viz/stats`, `POST /repo-viz/map`, `GET /repo-viz/hotspots` (representative
  sample of the 8 call sites) — all live-tested end-to-end with real repository data, unaffected.
- **Frontend:** `frontend/src/components/RepositoryMapPanel.jsx` — 1 helper function fixed, 0 other
  lines changed across the file's 8 call sites and its ~15 sub-components.
- **Persistence:** N/A directly for this fix — the underlying map-caching behavior (`cached:true`
  confirmed via `/repo-viz/stats`) was already correct and unaffected.
- **Authentication:** PASS after fix — the compounding missing-credentials defect is also resolved.
- **Authorization:** N/A directly — the underlying `/repo-viz/*` routes' own `requireAuth` gate was
  already correct and unaffected by this fix.
- **Tenant Isolation:** N/A — repository-map data describes the platform's own codebase (like
  `EngineeringMemoryPanel.jsx`'s data), not per-tenant customer data.
- **Cross-OS:** N/A — a single-component frontend fix over already-correct backend routes.
- **Failure Honesty:** improved for the routing defect itself; a separate, narrower pre-existing
  failure-honesty gap (`buildMap()`'s silent `catch {}`) was found but deliberately not fixed this
  pass — documented as a limitation.
- **Live Verification:** every claim backed by real HTTP requests against the real routes, including
  actually building a real repository map with real data, a real restart, and confirmation the fix is
  present in the actual served production bundle.
- **Regression:** 240/240 (238/238 baseline + 2 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed (2 compounding defects, same helper, same shape as the prior mission's
  `EngineeringMemoryPanel.jsx` finding) — all 8 API calls in this component were completely
  non-functional due to a nonexistent `/api` route prefix, compounded by a missing credentials flag.
- **V1-critical P2:** 0
- **Other:** systematically identified 4 additional components with the identical defect signature
  (`AutonomousPlatformPanel.jsx`, `SelfImprovementPanel.jsx`, `RuntimeHealthCard.jsx`,
  `FirstRunSetup.jsx`) via a targeted grep sweep — all confirmed still broken, none fixed this pass
  per the "audit ONE concrete item" instruction, documented as open findings for future missions
  rather than silently left undiscovered.

## FIXES

- `frontend/src/components/RepositoryMapPanel.jsx`: replaced the bespoke `API()` helper's raw,
  incorrectly-`/api`-prefixed, credentials-omitting `fetch()` call with a delegation to the canonical
  `_fetch` (`_client.js`), preserving the existing call-site signature and error contract exactly.
- 2 new regression tests, negative-tested.

## LIMITATIONS

- 4 additional components confirmed to share this exact defect were NOT fixed this pass, per explicit
  instruction to audit one concrete item: `AutonomousPlatformPanel.jsx`, `SelfImprovementPanel.jsx`
  (both siblings in the same dashboard, same defect shape, same fix would apply), and
  `RuntimeHealthCard.jsx`/`FirstRunSetup.jsx` (operator-only, single hardcoded `/api/*` calls rather
  than a reusable helper, but confirmed equally broken).
- `buildMap()`'s `catch {}` silently swallows a real map-build failure — the UI shows the same
  "not yet built" state whether the user never clicked "Build Map" or clicked it and it genuinely
  failed. This is a real, narrower, lower-severity failure-honesty gap, distinct from the
  100%-non-functional routing defect that was this pass's actual target — not fixed, to avoid
  expanding this single-item audit's scope.
- No real browser/Playwright click-through exercised the fixed UI end-to-end; verification was via
  direct backend HTTP requests replicating exactly what the fixed component calls, plus confirming
  the fix's presence in the actual built, served bundle — matching this session's established
  convention.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Confirms the prior mission's fix was not an isolated incident — the same copy-pasted defect exists in
at least 5 more places across the frontend, of which one (this panel, an entire named feature — ACP-9
Visual Repository Intelligence) is now fixed. The remaining 4 are explicitly documented rather than
silently discovered-and-ignored, giving a future mission a concrete, evidence-backed starting point
without requiring re-discovery. Demonstrates the value of a systematic grep-based sweep for a known
defect signature over ad-hoc re-investigation of the register once a defect class is identified. No
OS-track record altered.

## REGRESSION RESULT: 240/240 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean, fix confirmed present in the actual served production bundle)
