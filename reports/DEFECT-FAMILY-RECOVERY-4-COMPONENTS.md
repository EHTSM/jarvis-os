# KNOWN DEFECT FAMILY RECOVERY — 4 COMPONENTS

**Track:** OOPLIX V1 Master Audit — targeted recovery, not a new audit selection
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** Engineering Memory Panel 404 Audit, Repository Map Panel 404 Audit
(both fixed the identical defect class in 2 other components; this mission's grep sweep from the
Repository Map Panel audit identified these 4 remaining instances by name).

---

## Scope

Not a new audit — a targeted recovery of 4 already-identified, already-confirmed-live instances of
the same defect class fixed twice before this mission: a bespoke frontend fetch helper calling a
nonexistent `/api`-prefixed route (the real backend has no general `/api` mirroring rule — only
`/api/auth/*`, `/api/accounts/*`, and `/api/status` are genuinely duplicate-mounted), frequently
compounded by a missing `credentials: "include"` flag.

## A. AutonomousPlatformPanel.jsx

**Defect confirmed**: bespoke `API()` helper (byte-identical to the pattern already fixed twice),
`fetch(`/api${path}`, ...)`, no `credentials`. Calls: `POST /platform/benchmark`, `GET
/platform/runs?limit=30`, `POST /platform/run`.

**Routes confirmed real**: `backend/routes/index.js` — `router.use("/platform", requireAuth)`.
Live: `GET /api/platform/runs` → `404`; `GET /platform/runs` → `200`,
`{ok:true, runs:[], stats:{total:0,...}}` (honest empty state, real tenant has 0 runs yet).

**Fix applied**: replaced the helper with a delegation to `_fetch` (`_client.js`), preserving the
`API(method, path, body)` signature. 0 other lines changed.

**Live verification**: `GET /platform/runs` post-fix and post-restart → `200`, real data. Unauthenticated
→ `401` (unchanged boundary).

**Regression test**: `126-master-audit-defect-family-recovery`, test 1 — negative-tested (reverted,
confirmed exact failure, restored).

## B. SelfImprovementPanel.jsx

**Defect confirmed**: identical bespoke helper. Calls: `POST /improvement/evolve`, `GET
/improvement/patterns`, `GET /improvement/candidates`, `POST /improvement/promote`, `GET
/improvement/measure`, `GET /improvement/architecture`, `GET /improvement/confidence`, `POST
/improvement/benchmark`, `GET /improvement/stats` (8 calls total).

**Routes confirmed real**: `router.use("/improvement", requireAuth)`. Live: `GET
/api/improvement/stats` → `404`; `GET /improvement/stats` → `200`, real data (`evolutionCycles: 27,
cumulativeStats: {total: 27, patternsFound: 361, rulesPromoted: 85, ...}`).

**Fix applied**: identical pattern — helper delegates to `_fetch`, signature preserved.

**Live verification**: `GET /improvement/stats` post-fix and post-restart → `200`, real data.
Unauthenticated → `401`.

**Regression test**: test 2 — negative-tested, restored.

## C. RuntimeHealthCard.jsx

**Defect confirmed**: a different shape from A/B — one inline call, not a shared helper:
`fetch("/api/runtime/beta-candidate", { credentials: "include" })`. **Credentials were already
correctly set** here (this file was already better than A/B/D in that specific respect) — only the
path was wrong.

**Route confirmed real**: `backend/routes/runtime.js:1430`, `router.use("/runtime", requireAuth)`.
Live: `GET /api/runtime/beta-candidate` → `404`; `GET /runtime/beta-candidate` → `200`, real
beta-readiness gate data (`betaReady, score, gates[]`).

**Fix applied**: replaced the inline `fetch()` + manual `.then(r => r.ok ? r.json() : null)` chain with
a direct `_fetch("/runtime/beta-candidate")` call — `_fetch` already parses JSON and throws on failure
internally, so the manual ok-check step was removed as redundant, not functionally changed. The
existing `.then(data => {...}).catch(() => {})` shape (an already-honest "leave `betaGate` null on
failure" behavior — no fabricated data) was preserved exactly.

**Live verification**: `GET /runtime/beta-candidate` post-fix and post-restart → `200`, real gate data.
Unauthenticated → `401`.

**Regression test**: test 3 — negative-tested, restored. (Initial regex was too broad and matched this
file's own explanatory code comment describing the old defect; tightened to match only a real call
site with `{ credentials` following, not prose.)

## D. FirstRunSetup.jsx

**Defect confirmed**: `fetch("/api/health", { credentials: "include" })`. Credentials already correct;
path wrong.

**Route confirmed real**: `GET /health` — public, no auth required at all (confirmed earlier this
session and re-confirmed this pass). Live: `GET /api/health` → `401` (a coincidental fallthrough, not
a genuine auth requirement — `/api/*` isn't a recognized prefix so it hits whatever gate happens to sit
in the request's path); `GET /health` → `200`, real server status.

**Severity**: the highest of the four. This is the very first screen a brand-new user sees during
onboarding. The component unconditionally set `healthOk = r.ok`, and since `r.ok` was always `false`
for the broken path, every single new user was shown "✗ Not reachable" with troubleshooting
instructions ("To connect, start the backend: `npm run server`") — a genuine, user-facing false
negative on the platform's actual first impression, regardless of real backend health. Not a
peripheral dashboard defect like the other three; a first-run-experience defect.

**Fix applied**: replaced `fetch("/api/health", {credentials}).then(r => setHealthOk(r.ok))` with
`_fetch("/health").then(() => setHealthOk(true))`. `_fetch` throws on any non-2xx response, so success
of the `.then()` branch itself is the correct honest signal — no `r.ok` check needed since `_fetch`
already performs that check internally and routes failure through `.catch()`.

**Live verification**: `GET /health` post-fix and post-restart → `200`. Confirmed the real (previously
mis-signaled) healthy state would now correctly resolve `healthOk = true`.

**Regression test**: test 4 — negative-tested (same regex-tightening fix as C, for the same reason —
the explanatory comment's prose). Restored.

## Failure-honesty inspection (per mission instruction)

- **A**: `loadHistory()`'s `catch {}` silently swallows a real fetch failure, leaving `histData` at its
  initial `{runs: [], stats: {}}` — indistinguishable from a genuinely-empty tenant. This is the same
  narrow, lower-severity pattern already found and deliberately left unfixed in `RepositoryMapPanel.jsx`
  in the prior mission (a real gap, but not the routing defect this recovery targeted, and expanding
  scope to fix it would go beyond "the smallest safe fix" for this targeted recovery). The panel's
  primary user action (`handleSubmit`) already surfaces real errors correctly (`catch (e) =>
  setCurrentRun({...status:"failed", error: e.message})`), rendered honestly in `ExecutionPanel`'s
  timeline — not fixed, documented as a limitation.
- **B**: no silent-swallow `catch {}` blocks found anywhere in the file — all catches either set a real
  error message or (for the promote/architecture/confidence views) leave state at its honest initial
  `null`/loading value, not a fabricated one.
- **C**: `.catch(() => {})` on the beta-gate fetch was already honest before this fix (leaves
  `betaGate` at its initial `null`, and the JSX correctly gates rendering on `betaGate &&` — no
  fabricated data ever shown) — preserved exactly, not altered.
- **D**: the primary defect *was* the failure-honesty issue (a false negative shown as if genuine) —
  fully resolved by the path fix itself; no separate failure-honesty gap remains in this file.

No new fake-success or silent-failure defect was introduced by any of the 4 fixes.

## Regression

- Added 4 tests (describe block `126-master-audit-defect-family-recovery`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`, one per component.
- **Each of the 4 was independently negative-tested**: reverted that one component's fix in isolation
  (the other 3 fixes left in place), ran the suite, confirmed only that component's specific test
  failed with the expected assertion message, restored that component's fix, confirmed all 4 tests
  passed again — repeated for A, then B, then C, then D, one at a time as instructed.
- `npm run test:runtime`: **244/244** (240/240 baseline + 4 new tests, 0 failures, 0 skipped).
- Production build: clean, no new warnings.
- All 4 fixes confirmed present in the actual built, served production JS bundle — located each
  component's compiled chunk (`AutonomousPlatformPanel` and `SelfImprovementPanel` each in their own
  lazy-loaded chunk; `RuntimeHealthCard` and `FirstRunSetup` both compiled into `main.js`) and
  confirmed the real, unprefixed route strings and the minified `_fetch` delegation call shape for
  each.
- `.env`: confirmed untouched throughout.

## Security re-verification

- **Authentication**: unaffected for all 4 — none of the fixes touch how a session is established;
  they only correct which path a request targets and, for A/B, add the credentials the browser needs
  to actually send the existing session cookie.
- **Authorization**: unaffected — `/platform/*`, `/improvement/*`, and `/runtime/*` retain their
  pre-existing `requireAuth` gates, live-reconfirmed post-fix and post-restart (`401` for all three
  when unauthenticated). `/health` remains correctly public, unchanged.
- **Operator-only boundaries**: `RuntimeHealthCard.jsx` and `FirstRunSetup.jsx` are both mounted inside
  `OperatorConsole.jsx`; neither this recovery nor any prior mission this session added or removed a
  role check at that mount point — the pre-existing reachability characteristic (any authenticated
  user, not just `role: "operator"`, can reach the `runtime` tab containing `OperatorConsole`) is
  unchanged by this pass, since fixing a route string does not alter who can reach the component that
  calls it.
- **Tenant isolation**: no cross-tenant behavior change in any of the 4 fixes — none of the affected
  routes are tenant/org-scoped data in the first place (platform run history, self-improvement
  evolution stats, beta-readiness gates, and server health are all platform-level, not per-customer
  data), consistent with the same classification already established for the sibling
  `EngineeringMemoryPanel.jsx`/`RepositoryMapPanel.jsx` fixes.
- **Credentials not exposed to logs/UI**: confirmed — `_fetch` sends the existing httpOnly session
  cookie via `credentials: "include"`, the same mechanism every other correctly-wired component in the
  codebase already uses; no credential value is read, displayed, or logged by any of the 4 fixes.

---

## KNOWN DEFECT FAMILY: Frontend bespoke fetch / incorrect route prefix / missing credentials

## COMPONENTS

- **AutonomousPlatformPanel**: Defect confirmed (bespoke `/api${path}` helper) · Fix applied
  (delegated to `_fetch`) · Live verification (`GET /platform/runs` → `200` real data, pre/post
  restart) · Regression test (126, test 1, negative-tested)
- **SelfImprovementPanel**: Defect confirmed (identical helper) · Fix applied (delegated to `_fetch`)
  · Live verification (`GET /improvement/stats` → `200` real data) · Regression test (126, test 2,
  negative-tested)
- **RuntimeHealthCard**: Defect confirmed (wrong path only, credentials already correct) · Fix applied
  (`_fetch("/runtime/beta-candidate")`, preserved honest null-on-failure shape) · Live verification
  (`GET /runtime/beta-candidate` → `200` real gate data) · Regression test (126, test 3,
  negative-tested)
- **FirstRunSetup**: Defect confirmed (wrong path, most severe — first-run false negative) · Fix
  applied (`_fetch("/health")`) · Live verification (`GET /health` → `200`) · Regression test (126,
  test 4, negative-tested)

## ADDITIONAL FINDINGS

- **P0**: 0
- **P1**: 4 fixed (this recovery's scope) — all previously identified, none newly discovered this pass.
- **V1-critical P2**: 0
- **Other**: confirmed D (`FirstRunSetup.jsx`) was the most severe of the four despite being
  last-listed — a first-impression onboarding defect, not a peripheral dashboard tab, previously
  uncharacterized by severity in the prior mission's grep-sweep listing.

## FAILURE-HONESTY FINDINGS

- `AutonomousPlatformPanel.jsx`'s `loadHistory()` silent `catch {}` — real but narrow, same class
  already left unfixed in `RepositoryMapPanel.jsx`, documented as a limitation, not fixed (outside
  this recovery's targeted scope).
- `SelfImprovementPanel.jsx` — no silent-swallow catches found.
- `RuntimeHealthCard.jsx` — pre-existing `.catch(() => {})` was already honest; preserved unchanged.
- `FirstRunSetup.jsx` — the routing defect itself *was* the failure-honesty bug; fully resolved.

## SECURITY

- **Authentication**: unaffected/PASS for all 4.
- **Authorization**: unaffected/PASS — all 3 auth-gated routes re-confirmed `401` when unauthenticated,
  post-fix and post-restart; `/health` correctly remains public.
- **Tenant Isolation**: N/A for all 4 — none of the affected routes carry per-tenant data.

## REGRESSION

**Before**: 240/240
**After**: 244/244
**New tests**: 4 (one per component, describe block `126-master-audit-defect-family-recovery`)
**Failures**: 0
**Skipped**: 0

## BUILD: PASS

Clean, no new warnings. All 4 fixes confirmed present in the actual served production bundle.

## FINAL CLASSIFICATION: **RECOVERY COMPLETE**

All 4 confirmed instances of the known defect family were fixed, individually live-verified against
the real backend, individually negative-tested, and confirmed present in the production build. None
required a product-policy decision. None turned out to lack the defect — all 4 grep-signature matches
were genuine.

## PROGRAMME IMPACT

Closes out the full known blast radius of this defect family identified across the last two missions
(6 total instances found: `EngineeringMemoryPanel.jsx` and `RepositoryMapPanel.jsx` fixed in prior
missions, these 4 fixed in this recovery pass). No further known instances of this specific defect
signature remain undiscovered from the original grep sweep. Surfaces one severity-ordering correction
worth noting for future prioritization: `FirstRunSetup.jsx`, though listed last/smallest in the prior
mission's inventory, was in fact the most user-impactful of the four (first-run experience, every new
user, every time) — a reminder that blast radius and reachability matter more than component size or
list position when triaging a defect family. No OS-track record altered. `.env` untouched, no merge,
no push.
