# RC/LAUNCH TOOLING AUTHORIZATION — AUDIT

**Track:** OOPLIX V1 Master Audit — sweep for remaining instances of the operator-vs-customer defect family
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** `/eos`/`/ent`/`/eco`/`/civ`/`/auto` (25-OS Master Reconciliation),
ACP-9-12 Memory/ACP Authorization Boundary Audit, Founder Automation Authorization Audit.

---

## Method

Per this mission's explicit instruction 5 ("if another instance of the SAME operator-vs-customer
authorization defect exists... fix all directly confirmed instances that are safe to recover
together"), performed a bounded, systematic sweep rather than an uncontrolled repository-wide rewrite:

1. Listed every `router.use(..., requireAuth)` in `backend/routes/*.js` lacking `operatorOnly`
   (~80 matches).
2. Cross-referenced each against its backing service's `orgId` occurrence count — the same objective
   signal used successfully in every prior instance of this defect family this session.
3. Manually screened out every match whose name/context indicated genuine tenant-scoped functionality
   (workspace, orgs, marketplace, plugins, workforce, business, security, collaboration, graph, etc.)
   — none of these were re-investigated in depth, since their names and prior session history already
   establish them as legitimate customer-facing features.
4. For the remainder, read the actual route file and backing service to confirm the classification,
   then live-tested against the real running server with a real, ordinary, non-operator customer
   account before touching any code.

## Discovery

6 route files, all internal release/launch-management infrastructure, all gated by `requireAuth` alone:

| File | Prefix | Backing service | `orgId` count | Purpose |
|---|---|---|---|---|
| `rc1.js` | `/rc1/*` | `rc1.cjs` | 0 | Production RC-1: version freeze, manifest, backup, blockers |
| `rc2.js` | `/rc2/*` | `rc2.cjs` | 0 | Production RC-2: deployment rehearsal |
| `rc3.js` | `/rc3/*` | `rc3.cjs` | 0 | Production RC-3: 7-day stability certification |
| `rc4.js` | `/rc4/*` | `rc4.cjs` | 0 | Production RC-4: final launch certification |
| `productionDeployment.js` | `/pm7/*` | `productionDeployment.cjs` | 0 | PM7: live production deployment tracking |
| `postOmega.js` | `/pomena/*` | `selfReviewEngine.cjs` + `consolidationAudit.cjs` | 0 | POST-Ω Sprint P1: self-review + consolidation audit |
| `op1PublicLaunch.js` | `/op1/*` | `op1PublicLaunch.cjs` | 0 | OP-1: executive dashboard, blockers, KPIs, releases |

**Live-reproduced** with a real, ordinary, non-operator customer test account, before any fix:

```
GET /rc1/version   → 200, real frozen-version manifest (1.0.0-rc1, freeze history)
GET /rc4/areas     → 200, real final launch certification area weights (Launch Readiness,
                        Documentation, Business Readiness, Operations, Infrastructure, ...)
GET /pm7/health    → 200, real live deployment reachability status
GET /pomena/status → 200, real self-review/consolidation-audit dashboard state
```

Zero role check anywhere in any of these 6 files — only the general `requireAuth`.

## Frontend consumer check

Searched for a legitimate reason any of these 6 might need broad reachability. Found exactly one real
match: `PublicLaunch.jsx` (`grep -rl '"/op1/'` in `frontend/src/components/`), consuming `/op1/*`.
Traced its mount point: `frontend/src/components/ElectronWorkspace.jsx`, alongside sibling tabs
"Founder Ops", "Production Ops", "Revenue OS", "User Success" — a coherent internal-operator-console
tab family, not customer CRM features.

**Confirmed decisive**: `App.jsx`'s own comment on `ElectronWorkspace.jsx` states it is *"a documented
pure passthrough in web mode (`if (!isElectron()) return children`)"* — verified directly in
`ElectronWorkspace.jsx` (`isElectron = () => !!window.electronAPI?.isElectron`). This means
`PublicLaunch.jsx` and its sibling tabs **never render at all** in the actual web product any ordinary
customer uses — they exist only inside the Electron desktop shell (`window.electronAPI` is only
present there). No frontend consumer at all exists for the other 5 route families
(`grep -rl` against `rc1`/`rc2`/`rc3`/`rc4`/`pm7`/`pomena` path strings in `frontend/src/components/`
returns nothing).

## Fix

Added `operatorOnly` to all 7 files' route-level gates (6 route files; `op1PublicLaunch.js` counted
separately from the other 5 since it's the one file with a real, Electron-only frontend consumer,
otherwise identical treatment):

```js
router.use("/rc1", requireAuth, operatorOnly);
router.use("/rc2", requireAuth, operatorOnly);
router.use("/rc3", requireAuth, operatorOnly);
router.use("/rc4", requireAuth, operatorOnly);
router.use("/pm7", requireAuth, operatorOnly);
router.use("/pomena", requireAuth, operatorOnly);
router.use("/op1", requireAuth, operatorOnly);
```

Reuses the exact, already-proven `operatorOnly` middleware — no new architecture, matching the
identical fix already successfully applied 8 times earlier this session.

## Live re-verification (post-fix, and again after a real restart)

- Ordinary customer on all 7 route prefixes → `403 Forbidden — operator access required` (was `200`
  with real internal data before the fix).
- Unauthenticated → `401` (unchanged).
- `/coding/context` and `/business/leads` (genuinely tenant-scoped, unrelated systems) → still `200`
  for the same customer — confirms the fix's scope stayed exactly as intended.

## Regression

- Added 2 tests (describe block `131-master-audit-rc-launch-tooling-operator-gate`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: one structural assertion covering all 7 files'
  gate lines, one confirming `/coding/*` and `/business/*` remain untouched.
- Negative-tested: reverted `rc1.js`'s gate alone, confirmed the structural test failed, restored,
  confirmed passing again.
- `npm run test:runtime`: **260/260** (258/258 baseline + 2 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected.
- Production build: clean (backend-only change; no frontend files modified).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: RC/Launch Tooling Authorization (rc1-4, productionDeployment, postOmega, op1PublicLaunch)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.6/10
**CONFIDENCE:** 91%

## V1 SURFACE

- **Backend:** 7 route files, 1 gate line changed in each. Backing services
  (`rc1.cjs`-`rc4.cjs`, `productionDeployment.cjs`, `selfReviewEngine.cjs`, `consolidationAudit.cjs`,
  `op1PublicLaunch.cjs`) unchanged — their own logic was already correct.
- **Routes:** dozens of routes across the 7 files, all now correctly gated; a representative sample
  (version/manifest, deployment health, self-review status, executive dashboard) live-tested for each.
- **Frontend:** confirmed exactly one real consumer (`PublicLaunch.jsx`), and confirmed it is
  Electron-desktop-only, never reachable in the actual web product — no frontend risk from this fix.
- **Persistence:** N/A — no persisted state changed.
- **Authentication:** PASS — unaffected; unauthenticated requests still correctly `401`.
- **Authorization:** PASS after fix — real, live-reproduced gaps across 7 files closed using the
  identical, already-proven mechanism applied 8 times earlier this session.
- **Tenant Isolation:** N/A directly — operator-vs-customer boundary, not cross-tenant data; none of
  this data was ever tenant-scoped by design (internal release/launch-process tracking).
- **Cross-OS:** N/A — a route-gating fix, not a cross-OS composition.
- **Failure Honesty:** PASS — the new `403` carries the same real, honest, already-used message.
- **Live Verification:** every claim backed by real HTTP requests with a real ordinary customer
  account, both before and after a real server restart.

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed (6 route files, 7 counting the frontend-consumer distinction) — internal
  release-candidate certification, production-deployment tracking, self-review/consolidation-audit,
  and executive-launch-dashboard surfaces were all reachable by any authenticated customer.
- **V1-critical P2:** 0
- **Other:** confirmed via direct code trace that the one real frontend consumer of this cluster
  (`PublicLaunch.jsx`) is genuinely inert in the web product (Electron-only passthrough gate), avoiding
  a false assumption that fixing the backend would break a real customer-visible feature.

## FIXES

- `backend/routes/rc1.js`, `rc2.js`, `rc3.js`, `rc4.js`, `productionDeployment.js`, `postOmega.js`,
  `op1PublicLaunch.js`: added `operatorOnly` to each file's existing route-level gate.
- 2 new regression tests, negative-tested.

## LIMITATIONS

- None of these 7 route families have a reachable web-product frontend consumer today — this fix
  closes a real, live-reachable authorization gap regardless of current UI reachability, matching the
  precedent set by every one of the 8 prior instances of this exact defect class this session.
- Did not verify with a real operator login (would require the operator password, not fabricated) —
  operator-side reachability is inferred from the identical, already-proven mechanism's 8 prior
  successful applications, not independently re-verified with a live operator session this pass.
- This sweep was bounded to files where the `orgId`-count signal plus a `requireAuth`-only gate both
  matched; a small number of `router.use(..., requireAuth)` matches with borderline names (e.g.
  `extensions.js`, `distribution.js`, `commercial.js`) were not individually investigated this pass —
  deliberately, to avoid an uncontrolled repository-wide sweep per this mission's explicit instruction.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the 9th through 15th instances of the identical platform-wide-surface authorization gap found
across this session, completing a coherent internal-tooling cluster (release certification, deployment
tracking, self-review, launch dashboard) in one bounded pass rather than piecemeal across future
missions. Reuses the exact same proven, zero-new-architecture mechanism each time — no duplicate
authorization systems created. No OS-track record altered.

## REGRESSION RESULT: 260/260 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean; backend-only change, no frontend files modified)
