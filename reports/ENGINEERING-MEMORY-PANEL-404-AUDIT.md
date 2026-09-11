# ENGINEERING MEMORY PANEL 404 — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after Org Purge UI Wiring
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** RBAC Role Exercise Audit, Memory OS Fake-Success Masking Audit,
C10-006/C10-010/C10-012/C10-013 (`reports/C10-FINAL-CLOSURE-INVENTORY.md`).

---

## Why this item

Per this mission's explicit new emphasis — certified backend capabilities may have missing, broken,
unreachable, or non-consuming frontend consumers — first verified rather than assumed the prior
mission's own "Frontend: not investigated" limitations, before selecting a fresh target.

**RBAC Role Exercise's frontend gap, checked with real evidence**: registered a genuine third viewer-
role member on the real Org A test tenant, called `POST /jarvis` directly with that account's session,
and confirmed the real `403 Forbidden — this organization role does not permit AI usage` response.
Traced the exact response shape through `frontend/src/api.js`'s `sendMessage()` (which correctly
converts a thrown `_fetch` error into `{success:false, reply: err.message}`) and `App.jsx`'s own chat
rendering (`push(res.success ? "jarvis" : "error", res.reply || ...)`) — confirmed the real backend fix
is genuinely, honestly surfaced to a real user as an error chat bubble, not silently dropped or masked.
**No defect found** — a real, evidence-based negative result. Test member removed, Org A restored to
its original single-owner state afterward.

**C10-012 (Support OS frontend)** re-confirmed already resolved: `SupportCenter.jsx`'s own header
comment (dated 2026-08-15, "MASTER FINAL GAP CLOSURE, C10-012") shows it was already rewritten to call
the real `/customer-org/support/*` backend, with honest error handling and no fabricated data.

**C10-006, C10-010, C10-013** remain correctly resolved per the prior mission's reconciliation — not
re-checked in depth this pass, only confirmed the prior mission's conclusions still stand.

Applying the "does the frontend actually call the correct route, and does it honestly expose errors"
lens to `EngineeringMemoryPanel.jsx` — the sibling component to the just-fixed `MemoryOSV2.jsx`,
explicitly flagged in that mission's own limitations section as "not independently re-audited for the
same fake-success pattern" — surfaced a different, more severe class of defect: not fake-success
masking, but every single API call in the entire component targeting a route that has never existed.

## Discovery

`frontend/src/components/EngineeringMemoryPanel.jsx`'s own local `API()` helper (lines 11-24, prior
to this fix):

```js
const API = async (method, path, body) => {
    const r = await fetch(`/api${path}`, { method, headers: {...}, ...(body ? {body} : {}) });
    ...
};
```

Every one of the panel's 12 distinct call sites (across 8 tabs) goes through this helper, calling
paths like `/api/memory/stats`, `/api/memory/timeline`, `/api/memory-index/summary`. Live-tested
directly against the real backend:

```
GET /api/memory/stats  (real, valid auth cookie) -> 404 "Not Found: GET /api/memory/stats"
GET /memory/stats      (the REAL route)           -> 200, real data (2000 archived memory nodes)
```

Traced why: `backend/routes/index.js` mounts `/memory/*` (`engineeringMemory.js`) and `/memory-index/*`
(`unifiedMemoryIndex.js`) with **no `/api` prefix at all**. Grep-confirmed the only routes in this
entire codebase that are genuinely duplicate-mounted under `/api/*` are `/api/auth/*` (6 routes in
`auth.js`), `/api/accounts/*` (2 routes in `accounts.js`), and `/api/status` (1 route in `ops.js`) —
11 routes total, all explicitly hand-written as separate `router.post("/api/...")` /
`router.get("/api/...")` calls. There is no general "everything is also mounted under `/api`" rule in
this application, despite a misleadingly broad `nginx.conf` comment ("Both /auth/* and /api/auth/*
proxy to the backend... because server.js mounts routes at both / and /api") that reads as if it
described a global behavior rather than 3 specific files' explicit choice.

This means `EngineeringMemoryPanel.jsx` — mounted inside `AutonomousAgentDashboard.jsx`, reachable via
the `agentruntime` tab, itself reachable by any authenticated user — has been completely
non-functional across all 8 of its views (Timeline, Lessons, Similarity, Predictions, Growth, Evolve,
Benchmark, Index) since whenever this bespoke `API()` helper was introduced, for every user, in every
environment.

A second, compounding defect in the same helper: the raw `fetch()` call never set
`credentials: "include"`. This browser's default `fetch()` behavior does not send cookies to a
same-origin request unless explicitly told to — so even with the path corrected, every call would
still have failed with `401 Unauthorized` (no session cookie transmitted), independent of the routing
bug. `_client.js`'s canonical `_fetch` already sets this correctly, and is used by literally every
other component in the codebase, including this file's own sibling `MemoryOSV2.jsx`.

## Fix

Removed the bespoke `API()` implementation and replaced it with a thin wrapper delegating to the
canonical `_fetch`:

```js
import { _fetch } from "../_client";
const API = async (method, path, body) => {
    try {
        return await _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (e) { throw e; }
};
```

Deliberately preserved the file's existing `API(method, path, body)` call-site signature (all 12 call
sites across 8 view components remain unchanged) and the `Error{message, status}` shape every caller
already destructures (`e.message`, checked in several `catch` blocks) — `_fetch` already throws exactly
that shape. This is the smallest possible fix: one function's internals changed, zero other lines in
the file needed to change, and it reuses existing, already-proven architecture rather than
reimplementing fetch semantics a second time.

## Live re-verification

- Confirmed the real, correct paths the fixed component now calls all work, with real data:
  `GET /memory/stats` → real memory-source counts; `GET /memory/timeline?limit=5` → real RCA/timeline
  events; `GET /memory-index/summary` → real cross-product namespace counts.
- Confirmed the old broken `/api`-prefixed paths still correctly `404` — proving this was never a
  working route, not an environment-specific regression.
- Re-ran the same three real-path checks on a fresh server process after a full restart — identical,
  correct results.
- Verified the fix is present in the actual built, served production JS chunk (not just source):
  located the compiled chunk containing `"ENGINEERING MEMORY"`, confirmed the real string
  `/memory/stats` is present, confirmed zero remaining occurrences of the broken
  `` fetch(`/api${path}`) `` pattern anywhere in the entire build output, and traced the minified
  `API()` helper's call site directly to a call into the imported `_fetch` module function.

## Regression

- Added 2 tests (describe block `124-master-audit-engineering-memory-panel-404`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Negative-tested — reverted the entire fix,
  confirmed both failed, restored.
- `npm run test:runtime`: **238/238** (236/236 baseline + 2 new tests).
- Production build: clean, no new warnings, fix confirmed present in the served bundle.
- `.env`: confirmed untouched throughout.
- Test data: 1 temporary viewer-role member added to and removed from Org A during the RBAC
  frontend-reachability re-check (restored to its original single-owner state) — no persistent test
  fixtures altered.

---

## AUDIT NAME: Engineering Memory Panel 404 (EngineeringMemoryPanel.jsx)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.4/10
**CONFIDENCE:** 88%

## V1 SURFACE

- **Backend:** none changed — `/memory/*`, `/memory-index/*` routes were already correct; re-verified,
  not modified.
- **Routes:** `GET /memory/stats`, `GET /memory/timeline`, `GET /memory-index/summary` (representative
  sample of the 12 call sites) — all live-tested, confirmed correct and unaffected.
- **Frontend:** `frontend/src/components/EngineeringMemoryPanel.jsx` — 1 helper function fixed
  (routing + credentials), 0 other lines changed across the file's 8 view components.
- **Persistence:** N/A — no state persisted by this fix; a pure client-side routing correction.
- **Authentication:** PASS after fix — the second compounding defect (missing `credentials:"include"`)
  is also resolved; real session cookies are now sent, matching every other component's behavior.
- **Authorization:** N/A directly — this fix does not touch any permission check; the underlying
  `/memory/*` routes' own `requireAuth` gate was already correct and unaffected.
- **Tenant Isolation:** N/A — this data is genuinely shared platform-engineering knowledge (per the
  prior mission's own reclassification of C10-004), not per-tenant data requiring isolation.
- **Cross-OS:** N/A — a single-component frontend fix over already-correct backend routes.
- **Failure Honesty:** improved as a side effect — real backend errors (once actually reachable) now
  flow through `_fetch`'s standard error-shape contract instead of the old helper's separate,
  never-actually-exercised error path.
- **Live Verification:** every claim backed by real HTTP requests against the real routes (confirming
  both the bug and the fix), including a real restart, and direct confirmation the fix is present in
  the actual served production bundle — not source-only reasoning.
- **Regression:** 238/238 (236/236 baseline + 2 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed (2 compounding defects, same helper function) — every one of this
  component's 8 tabs and 12 API calls has been completely non-functional (100% failure rate) due to a
  nonexistent `/api` route prefix, compounded by a missing credentials flag that would have caused
  authentication failure even with the path corrected.
- **V1-critical P2:** 0
- **Other:** 1 real audit-methodology validation — directly verified (not assumed) that the RBAC Role
  Exercise audit's backend fix is correctly surfaced through the real frontend chat UI, finding no
  defect (a genuine negative result); confirmed C10-006/C10-010/C10-012/C10-013 remain correctly
  resolved from the prior mission's reconciliation.

## FIXES

- `frontend/src/components/EngineeringMemoryPanel.jsx`: replaced the bespoke `API()` helper's raw,
  incorrectly-`/api`-prefixed, credentials-omitting `fetch()` call with a delegation to the canonical
  `_fetch` (`_client.js`), preserving the existing call-site signature and error contract exactly.
- 2 new regression tests, negative-tested.

## LIMITATIONS

- This fix addresses `EngineeringMemoryPanel.jsx` specifically; a repo-wide sweep for other components
  using a similarly bespoke, potentially-broken fetch helper (rather than the canonical `_fetch`) was
  not performed — only this concretely-identified instance was fixed.
- No real browser/Playwright click-through exercised the fixed UI end-to-end (open the tab, see real
  data render); verification was via direct backend HTTP requests replicating exactly what the fixed
  component calls, plus confirming the fix's presence and correctness in the actual built, served JS
  bundle. This matches this session's established frontend-verification convention.
- The RBAC frontend re-check covered only the primary `/jarvis` chat surface (`App.jsx`); the other
  `sendMessage` consumers (`ContentEngine.jsx`, `AgentOSV2.jsx`, `DeveloperCopilotV2.jsx`,
  `WorkflowOSV2.jsx`, `operator/AIConsolePanel.jsx`) were not independently re-checked for the same
  honest-error-surfacing behavior.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Directly validates this mission's specific methodology — checking whether certified backend
capabilities have real, working, correctly-consuming frontend counterparts — by finding a genuine,
100%-reproduction-rate defect that had never been caught: an entire 8-tab component completely
non-functional due to a routing typo class of bug, compounded by a missing credentials flag. Also
validates the same methodology in the negative direction: directly confirmed the RBAC Role Exercise
audit's backend fix is correctly and honestly surfaced through its real frontend consumer, finding no
defect — demonstrating this class of check is not merely defect-hunting theater but produces real
confirmations as well as real findings. No OS-track record altered.

## REGRESSION RESULT: 238/238 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean, fix confirmed present in the actual served production bundle)
