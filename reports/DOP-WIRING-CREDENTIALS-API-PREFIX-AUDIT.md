# DOP/WIRING/CREDENTIALS API-PREFIX — AUDIT

**Track:** OOPLIX V1 Master Audit — frontend/backend wiring (4th occurrence of a known defect class)
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Why this item

Reconciled the register per this mission's own instruction before selecting. C10-005 (3
non-reconciled memory backends) remains genuinely **DECISION REQUIRED — BLOCKED ON FOUNDER PRODUCT
DECISION** — it requires choosing a canonical backend, a product call this audit has no authority or
evidence to make; left untouched, no architecture invented, no guess made. `/p18/memory/*`'s own
DECISION REQUIRED status (from the Memory/ACP Authorization Boundary Audit) is the same kind of item
for the same reason and was also left untouched.

With no other P0/P1/decision-blocked item outstanding, continued this session's own established
precedent: after fixing `EngineeringMemoryPanel.jsx` and `RepositoryMapPanel.jsx` for an identical
routing defect, a systematic grep swept for remaining instances and found 4 more
(`AutonomousPlatformPanel.jsx`, `SelfImprovementPanel.jsx`, `RuntimeHealthCard.jsx`,
`FirstRunSetup.jsx`), all fixed in the following mission. Re-running that exact sweep this pass
surfaced **6 further, previously-undiscovered matches** of the same pattern.

## Discovery

```
grep -rln 'fetch(`/api${path}`' frontend/src
→ DOP1Dashboard.jsx, DOP2Dashboard.jsx, ProductionWiring.jsx, ProductionWiring2.jsx,
  CredentialDashboard.jsx, ExternalPlatformDashboard.jsx
```

Each file's local `api()` helper called `fetch(\`/api${path}\`, ...)`, but the real backend mounts
these route families with **no `/api` prefix**:

| Component | Real route family | Backend file |
|---|---|---|
| `DOP1Dashboard.jsx` | `/dop/*` | `backend/routes/dop1.js` |
| `DOP2Dashboard.jsx` | `/dop2/*` | `backend/routes/dop2.js` |
| `ProductionWiring.jsx` | `/wiring/*` | `backend/routes/productionWiring.js` |
| `ProductionWiring2.jsx` | `/wiring2/*` | `backend/routes/productionWiring2.js` |
| `CredentialDashboard.jsx` | `/credentials/*` | `backend/routes/pcsCredentials.js` |
| `ExternalPlatformDashboard.jsx` | `/ext/*` | `backend/routes/pcs2ExternalPlatforms.js` |

All 6 are real, live-mounted tabs inside `ElectronWorkspace.jsx` ("Production Wiring", "Production
Wiring 2", "Credentials", "External Platforms", "Infra Validation", "Deployment") — not dead code, not
unreachable.

**Live-reproduced** with a real registered-and-logged-in account:

```
GET /api/dop/report          -> 404 "Not Found: GET /api/dop/report"
GET /dop/report               -> 200, real 96-check infra validation report (productionScore, verdict, modules)

GET /api/dop2/report         -> 404
GET /dop2/report              -> 200, real (honest "no report yet" for an account that never ran a deploy)

GET /api/wiring/report       -> 404
GET /wiring/report            -> 200, real 53-check wiring report

GET /api/wiring2/report      -> 404
GET /wiring2/report           -> 200, real 76-check wiring report

GET /api/credentials/report  -> 404
GET /credentials/report       -> 200, real 47-credential audit report

GET /api/ext/report          -> 404
GET /ext/report                -> 200, real 39-platform external audit report
```

All 6 route families are gated by `requireAuth` alone (confirmed — not an authorization question, a
pure routing defect); every one of the underlying `api()` call sites already passed a clean,
correctly-formed relative path (`/dop/report`, `/wiring2/audit/${tab}`, etc.) — the bug was entirely in
the shared helper's own hardcoded prefix, not in any individual call site.

**A material difference from the 3 prior fixes in this exact defect class**: all 6 helpers here already
correctly set `credentials: "include"` — the earlier fixes each had a second, compounding defect
(missing credentials); this pass only needed the path corrected.

## Fix

```diff
- fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
+ fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
```

Applied identically to all 6 files. Confirmed each backend route file's error path (`_err()`) always
returns valid JSON (`{ok:false,error}`), so the existing `.then(r => r.json())` — no status check —
was correct to leave unchanged; a rewrite to the canonical `_fetch` client (used for the 3 prior fixes,
which needed its throw-on-non-2xx behavior) was unnecessary here since none of these 6 files' consumers
rely on a thrown error.

## Live re-verification

- Full production rebuild (`CI=true npm run build`) — clean.
- Confirmed zero remaining `/api${path}` occurrences anywhere in the built bundle.
- Located the compiled chunk and confirmed the fix is genuinely present in the served JS
  (`fetch(s,{credentials:"include",...})` with a bare path variable, no prefix concatenation).
- Restarted the server on the fresh build, confirmed `/health` OK.
- Re-ran the full authenticate → call-all-6-routes sequence against the fresh process: all 6 correct
  (5 returning real report data, `/dop2/report` correctly returning its own honest
  "no report yet" for an account with no deploy history — not a defect).
- Confirmed the immediately-prior mission's own fix (`recoverStaleMissions()` active/running recovery)
  is still firing correctly on this restart (`"Recovered 10 stale running/active mission(s) → planned"`
  in the startup log) — no regression to that unrelated fix.

**A genuine, unrelated environmental anomaly was hit mid-verification**: one intermediate server
instance logged its own successful HTTP-listen line but held zero actual listening sockets under this
session's own heavy autonomous-mission background load (confirmed via `lsof -p <pid>` showing no LISTEN
socket despite the process being alive and actively processing missions). Resolved by a clean
exact-PID kill and restart — not a code defect, and unrelated to this mission's pure frontend
path-string fix (the same process anomaly could occur regardless of this change).

## Regression

- Added describe block `134-master-audit-dop-wiring-credentials-api-prefix` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: structural checks that none of the 6 files call
  the old prefixed pattern and that all 6 now call `fetch(path, ...)` directly, a check that all 6
  backend route files require auth and are genuinely mounted in `backend/routes/index.js`, and a check
  that all 6 components are real consumers inside `ElectronWorkspace.jsx` (not dead code).
- Negative-tested: reverted `DOP1Dashboard.jsx`'s fix alone, confirmed the 2 structural tests correctly
  failed with their exact expected assertion messages, restored, confirmed passing again.
- `npm run test:runtime`: **270/270** (266/266 baseline + 4 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (8/8).
- Production build: clean, fix confirmed present in the served bundle.
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: DOP/Wiring/Credentials API-Prefix (6-component routing defect)

**STATUS:** CERTIFIED
**SCORE:** 9/10
**CONFIDENCE:** 91%

## V1 SURFACE

- **Backend:** no backend files modified — all 6 backing route files (`dop1.js`, `dop2.js`,
  `productionWiring.js`, `productionWiring2.js`, `pcsCredentials.js`, `pcs2ExternalPlatforms.js`) were
  already correct.
- **Routes:** all 6 route families (`/dop/*`, `/dop2/*`, `/wiring/*`, `/wiring2/*`, `/credentials/*`,
  `/ext/*`) confirmed real, mounted, `requireAuth`-gated, live-tested with real data.
- **Frontend:** 6 components fixed (`DOP1Dashboard.jsx`, `DOP2Dashboard.jsx`, `ProductionWiring.jsx`,
  `ProductionWiring2.jsx`, `CredentialDashboard.jsx`, `ExternalPlatformDashboard.jsx`); all confirmed
  real, live tabs inside `ElectronWorkspace.jsx`.
- **Persistence:** N/A — read-heavy reporting routes; no persisted state changed by this fix.
- **Authentication:** PASS — unaffected; all routes remain correctly `requireAuth`-gated.
- **Authorization:** N/A — no role-tier question in this defect; not the `operatorOnly` defect family.
- **Tenant Isolation:** N/A — these are internal/founder tooling dashboards
  (infra/deployment/credential/external-platform audits), not customer tenant data; confirmed no
  `orgId` concept applies to any of the 6 backing services.
- **Cross-OS:** N/A — pure frontend path-string fix.
- **Failure Honesty:** PASS — unchanged; each backend route's existing `{ok:false,error}` shape is
  correctly surfaced to the already-correct consumer logic in all 6 files (no fake-success masking
  found or introduced).
- **Live Verification:** real authenticated account, real HTTP requests, both before and after a real
  production rebuild and a real server restart; fix confirmed present in the served bundle.
- **Regression:** 270/270 (0 failures, 0 skipped, 4 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — 6 components (a single shared defect pattern) calling a nonexistent
  `/api`-prefixed path, making 6 real internal-tooling dashboard tabs completely non-functional for
  every user who opens them.
- **V1-critical P2:** 0
- **Other:** confirmed C10-005 and the `/p18/memory/*` item remain correctly DECISION REQUIRED, not
  guessed at or silently resolved.

## FIXES

- 6 files: `` fetch(`/api${path}`, ...) `` → `fetch(path, ...)`, preserving each file's exact
  `api(method, path, body)` call-site signature.
- 4 new regression tests (2 structural on the fix itself, 1 on backend route mounting, 1 on frontend
  consumer reachability), negative-tested.

## LIMITATIONS

- This appears to be the last remaining instance of this specific `/api${path}` pattern in the
  codebase (confirmed via a full-repo grep returning zero live matches, only historical comments in
  already-fixed files) — but a systematic, code-pattern-based sweep cannot rule out a differently-shaped
  routing defect elsewhere with equal confidence to a live-tested claim.
- `/dop2/report`'s "no report yet" response was not independently deep-verified beyond confirming it is
  an honest, correctly-shaped response (not a fake success) — a full deploy-and-report cycle through
  this dashboard was out of scope for a routing-only fix.
- The environmental server-listen anomaly encountered mid-verification was resolved operationally
  (restart) but not root-caused — if it recurs with a clear, reproducible trigger, it would warrant its
  own dedicated investigation in a future mission.

## FINAL CLASSIFICATION: **CERTIFIED**

## PROGRAMME IMPACT

Closes the last known instance of a defect class this session has now found and fixed 4 separate times
across 12 total components — a routing-layer mismatch between a bespoke local fetch helper and the
real, unprefixed backend mount convention. All 6 previously-broken internal tooling tabs
(Production Wiring, Production Wiring 2, Credentials, External Platforms, Infra Validation, Deployment)
are now genuinely functional. No OS-track record altered.

## REGRESSION RESULT: 270/270 (0 failures, 0 skipped, 4 net new tests)

## BUILD RESULT: PASS (clean; frontend-only change, fix confirmed present in the served bundle)

## CURRENT BASELINE: 270/270
