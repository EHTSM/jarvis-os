# B23-03 — /coding/context ROUTE RECOVERY

**Track:** OOPLIX V1 Master Audit — next unresolved item after GG-1 and SENTRY_DSN
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior finding:** B.23 (`reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md` line 145) — "`/coding/context`
called by 2 live components; route not mounted. Honest 404; consumers degrade via `.catch()`." —
`GENUINE GAP`.

---

## Why this item

Scanned the full register for remaining code-fixable, non-credential-blocked items. B23-03 is the
only remaining `GENUINE GAP` (versus `PRE-EXISTING LIMITATION`/`CREDENTIAL BLOCKED`/environment-
blocked accessibility items) that is (a) explicitly named, (b) confirmed to have real live consumers,
and (c) fixable by composing existing infrastructure rather than inventing new architecture.

**En route, re-confirmed B23-04 ("JWT logout — stateless JWT stays valid until exp") is stale
relative to current code** — this session's own earlier Master Recovery phase (C10-027) already
built a real jti-based revocation ledger. Live-reproduced this pass: captured a real pre-logout
token, replayed it directly after logout — correctly rejected (`401 Token invalid or expired`), not
accepted. This was a re-confirmation, not this turn's primary audit; noted here and reflected in the
register update, not treated as a separate scored item since no code changed for it this pass.

## Discovery

`WorkspaceHealth.jsx` and `DevDashboard.jsx` (both real, mounted inside `ElectronWorkspace.jsx`) have
called `GET /coding/context` since B.23 first flagged it — the route never existed anywhere in
`codingAssistant.js`. Both components' `.catch()`-wrapped `get()` calls degraded honestly (a genuine
404, never a crash), which is why this sat as a disclosed gap rather than a live incident.

## Recovery — composed from existing services only

Added `GET /coding/context`, mounted below the router's existing `requireAuth`/`attachOrg`/
`rateLimiter` gate (same as every other `/coding/*` route). Composed entirely from already-real,
already-scoped infrastructure:
- `missionMemory.cjs`'s `listMissions({status:"in_progress", orgId})` — the same org-optional filter
  pattern this session's own C10-004 fix already proved safe for `_missionContext()`.
- `engineeringSmellDetector.cjs`'s `scan()` — the same mtime-cached (60s TTL) scan `/coding/smells`
  already calls; reusing it here does not reintroduce the full-repo-rescan cost C3 fixed earlier in
  this audit arc.
- The existing org-scoped patch-history store (`_loadPatchHistory()`), same filter already proven
  safe for `/coding/patch-history` (C9-PATCH).
- Git branch resolution via the same `execSync`+timeout+silent-fail pattern the file's own
  `_gitLog()`/`_gitDiffStat()` helpers already use — no new shell-exec mechanism.

No new service, no new store, no new middleware.

## Live verification

- Unauthenticated → `401` (correctly gated).
- Authenticated, no `cwd` → real data: `activeMission:null` (honest — no in-progress mission for that
  org), a real `recentPatch` record, a real 50-item (capped) `smells` array, `branch:null` (honest —
  no `cwd` supplied).
- Authenticated, real `cwd` → `branch:"security/reality-completion"` — the actual current git branch.
- **Cross-tenant isolation**: Org B's own request correctly returned `recentPatch:null` (not Org A's
  real patch) — live-verified with real two-tenant data, not empty-vs-empty.
- **Persistence**: real restart performed; the route and its real data (branch, patch, smells count)
  all confirmed identical post-restart.

## Regression

- Added 3 tests (describe block `118-master-audit-b23-03`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: route existence + service reuse, correct
  mount position below the auth/org gate, and org-scoping of `recentPatch`. All 3 negative-tested —
  the org-scoping test was explicitly reverted (patched to return the platform's first patch
  regardless of owner) and confirmed to fail with the expected message before being restored.
- `npm run test:runtime`: **224/224** (was 221/221 at phase start).
- Production build: clean (no frontend file touched — both real consumer components were already
  correct, just previously fed a 404).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: B23-03 — /coding/context Route Recovery

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.3/10
**CONFIDENCE:** 90%

## V1 SURFACE

- **Backend:** `backend/routes/codingAssistant.js` — 1 new route, 0 new services.
- **Routes:** `GET /coding/context`, correctly gated (`requireAuth` + `attachOrg` + rate limiter, inherited from the router's existing composition).
- **Frontend:** `WorkspaceHealth.jsx`, `DevDashboard.jsx` (both real, mounted in `ElectronWorkspace.jsx`) — now receive real data instead of a 404 they previously degraded from gracefully.
- **Persistence:** N/A for this route itself (read-only composition over 3 already-persisted stores); confirmed all 3 underlying stores' data survives a real restart.
- **Authentication:** PASS — unauthenticated correctly 401.
- **Authorization:** PASS — inherits the router's existing gate; no new authorization logic introduced.
- **Tenant Isolation:** PASS — live-verified with real two-tenant data; `recentPatch` correctly org-scoped, `activeMission` uses the same proven-safe optional-orgId filter.
- **Cross-OS:** PASS — composes Memory OS (`missionMemory.cjs`), the Engineering-smell detector (already certified via C3), and the existing patch-history store — no duplicate architecture.
- **Failure Honesty:** PASS — every field honestly `null`/empty on absence (no active mission, no cwd, smell detector unavailable, no patch found), never fabricated.
- **Live Verification:** every claim backed by real HTTP requests against the running server, including a real restart.
- **Regression:** 224/224 (221/221 baseline + 3 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 0
- **V1-critical P2:** 0
- **Other:** re-confirmed B23-04 (JWT logout revocation) is stale relative to current code — already fixed in this session's own earlier Master Recovery phase (C10-027); no code changed for it this pass, noted for register accuracy only.

## FIXES

- `backend/routes/codingAssistant.js`: added `GET /coding/context`, composing 3 existing services.
- `tests/runtime/10-c10-cross-system-closure.test.cjs`: 3 new tests, all negative-tested.

## LIMITATIONS

- `DevDashboard.jsx` fetches `coding` but never actually reads any field from it after the fetch — a
  real, separate, minor inefficiency (an unused network call), not something this pass's scope
  (recovering the missing route) required fixing; noted for a future pass, not silently ignored.
- Both real consumers are Electron-only (`ElectronWorkspace.jsx`); this recovery does not add a web
  reachability path — matching this whole audit arc's established practice of recovering exactly what
  was asked for, not expanding scope.
- `activeMission` was not live-tested against a real populated in-progress mission (would have
  required creating real workflow side effects via the mission orchestrator) — verified instead via
  direct source trace of the identical, already-proven-safe optional-orgId filter pattern.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes B23-03, the last remaining genuinely-open `GENUINE GAP` in the B-phase register that was both
code-fixable and non-credential-blocked. B23-04 (JWT revocation) is re-confirmed already resolved by
prior work in this same overall session. Combined with GG-1 and the SENTRY_DSN investigation, the
Audit Track's own register now has only credential-blocked (`SENTRY_DSN`), environment-blocked
(screen-reader certification), and deliberately-not-force-fixed (C.5's mobile overflow, with 3
documented future paths) items remaining open. No OS-track record altered.

## REGRESSION RESULT: 224/224 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean, no frontend file changed)
