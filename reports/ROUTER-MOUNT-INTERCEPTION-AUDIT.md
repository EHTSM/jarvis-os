# EXPRESS ROUTER MOUNT / BARE requireAuth INTERCEPTION AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-20 · **Branch:** `security/reality-completion`

---

## Method

151 files under `backend/routes/`. `routes/index.js` (the barrel) is mounted at the app root with no
prefix (`app.use(routes)` in `server.js`), and every sub-router it requires is likewise mounted with no
prefix — so every path-scoped `router.use("/x", ...)` gate, wherever it appears (barrel or sub-file),
matches against the real, full incoming URL, not a stripped mount-relative one. The one exception —
and the shape of the already-fixed `business.js` defect — is a **bare, zero-argument**
`router.use(middlewareFn)` (no path string at all), which Express treats as matching literally
everything from that point in the composed router's registration order onward, including unrelated
later files' routes.

Searched systematically for: (1) any other zero-argument `router.use(fn)` calls across all 151 files —
found only 1 (`productFactory.js`); (2) path-based exclusion logic (`req.path === /startsWith`) that
could have the `business.js`-style relative-vs-absolute mismatch — found only 3 files use this pattern
at all (`business.js`, already fixed; `browser.js`, confirmed correct; `index.js`, a non-security
deprecation-warning helper, confirmed correct); (3) every in-file `router.use("/prefix", ...)` gate
(76 files, including 3 using array-form gates) cross-referenced against every route the same file
registers, to find gate/route prefix mismatches; (4) files with routes but zero auth reference of any
kind, cross-referenced against `routes/index.js`'s 38 barrel-level outer gates to rule out
false-positives (a file can be legitimately gated entirely from the barrel, with no in-file logic).
Delegated the large systematic prefix-comparison pass (76 files) to a background research agent while
independently investigating `productFactory.js` (explicitly named in the mission) and manually verifying
a representative sample directly.

## `productFactory.js:64` — Explicit Classification: **CLEAN**

Line 63's bare `router.use((req,res,next) => requireAuth(req,res,() => attachOrg(req,res,next)))` has no
path argument — structurally identical in shape to `business.js`'s original bug. But every single route
registered in this file (27 routes, verified exhaustively) is genuinely under `/product-factory/*` — the
file registers nothing else, so the unscoped middleware never has anything else to leak onto. Line 64's
`router.use("/product-factory", requireOrgMember)` is redundant (line 63 already gates everything) but
harmless. `GET /product-factory/health` — the one route that might look like it should be a public
health-check by name — is an internal diagnostic for this specific subsystem, not the public system
health check (`GET /health`, served separately by `ops.js`, registered before any gate). Live-verified:
`GET /product-factory/health` correctly returns 401 (consistent with every other subsystem's own
internal `/health`-style diagnostic route in this codebase, e.g. `/enterprise/monitoring/:orgId/health`).

## `business.js` — CONFIRMED already fixed, re-verified as the reference pattern

Re-read its own fix history and reproduced its current-state correctness live: `GET /invite-preview/:token`
(workspace.js) — the originally-intercepted public route — returns 200; `POST /business/webhook/whatsapp`
returns 200 unauthenticated. `index.js` also mounts a *second*, later `/business` gate (line 282, for
`obi-x.js`'s `/business/x/*` routes) — verified via Express registration-order reasoning and live test
that this second gate does not re-intercept `business.js`'s own earlier-registered routes, since Express
matches and responds at the first registered handler in the chain, never re-entering the composed router
past that point.

## Genuine defect found: `backend/routes/ops.js` — P0

**Finding:** `ops.js`'s array-form operator gate (`router.use(["/stats", "/dashboard/revenue",
"/metrics", "/ops", "/runtime/reboot", "/workflow"], requireAuth, operatorOnly, operatorAudit)`) covered
only 6 of what should have been 14 route-family prefixes registered later in this same file. 8 families
— `/incidents`, `/rca-reports`, `/fix-plans`, `/healing-runs`, `/learning`, `/lifecycle`, `/goals`,
`/personal` — had **zero auth of any kind**, neither from this gate, nor an in-file fallback, nor any
`routes/index.js` outer gate (`ops.js` is mounted bare at `index.js:38`, no barrel-level prefix gate
exists for it).

**Live-reproduced, unauthenticated, no cookie:**
```
GET /personal/tasks     → 200, real personal task data (titles, details, tags, due dates, 12 real records)
GET /goals               → 200, real goal-engine data
GET /incidents            → 200, real incident-engine data
```
Full read AND write access: `POST /personal/tasks`, `PATCH/DELETE /personal/notes/:id`,
`POST /goals`, etc. — all reachable with no session at all. Same failure signature, same root cause,
and same severity class as this exact file's own already-documented-and-fixed `/business/*` duplicate-
route and `/dev/*` findings (visible in this file's own header comments, both dated 2026-08-14/15) — this
audit found the 8-family gap the prior remediation passes didn't extend to.

**Fix:** extended the existing array gate to include all 8 missing prefixes, matching the exact
`requireAuth, operatorOnly, operatorAudit` treatment already applied to its 6 siblings — the correct
level given none of the backing engines (`incidentEngine.cjs`, `goalEngine.cjs`, `personalOS.cjs`, etc.)
carry any orgId/accountId concept (confirmed via grep — these are founder/operator-only, platform-wide
data, not per-tenant records requiring `attachOrg`/`requireOrgMember`). Confirmed no canonical duplicate
implementation exists elsewhere for any of the 8 families (unlike the earlier `/business/*` case, which
was removed rather than fixed in-place, since a real duplicate existed in `business.js`) — so extending
the gate in place, not removing/redirecting, was the correct minimal fix.

**Live verification, before/after, with a real server restart:**
- Before fix: `GET /personal/tasks` → 200 with real data.
- After fix (server restarted to load the change): `GET /personal/tasks`, `/goals`, `/incidents`,
  `/rca-reports`, `/fix-plans`, `/healing-runs`, `/learning/summary`, `/lifecycle/maturity` — all → 401.
- Regression check: `/health`, `/test`, `/api/status` (genuinely public probes, registered before the
  gate) still → 200; `/stats` (already-gated sibling) still → 401; `/business/webhook/whatsapp` (the
  originally-fixed public webhook) still → 200 — confirming the fix widened coverage without narrowing
  anything that should remain public.

## Sweep results for the remaining ~74 in-file-gated route files

All confirmed clean via a background research agent's systematic prefix-comparison pass plus direct
manual verification of representative files (`admin.js`, `security.js`, `graph.js`, `growthOS.js`,
`co3UserSuccess.js`, `intelligence.js`, `founderTwin.js`, `browser.js`, `tasks.js`,
`founderAutomation.js`). Two apparent mismatches investigated and ruled out as false positives:
- `intelligence.js` — in-file gate scoped only to `/intelligence/unified` (business data, the real
  cross-tenant leak fixed in a prior mission); the platform-wide engineering routes
  (`/intelligence/correlations` etc.) are covered instead by `routes/index.js`'s own outer
  `router.use("/intelligence", requireAuth)` — intentional layered design, not a gap.
- `co3UserSuccess.js`'s `/co3/invites/*` — looked like it might need to be public (matching
  `workspace.js`'s genuinely-public invite-preview), but is an internal, operator-facing invite-code
  admin tool for the closed-beta program (`useInviteCode(code, accountId)` requires an already-
  authenticated account), not a public self-service redemption flow. Intentional, not a defect.

## Findings NOT fixed / out of scope

None — the one genuine defect found (`ops.js`) was fixed. `productFactory.js` was classified per the
mission's explicit request (CLEAN) rather than left as a decision item, since the investigation produced
an unambiguous, evidence-backed answer.

## Regression

**Before:** 365/365. **After:** 371/371 (clean run; one transient flake on a pre-existing, unrelated
test — `153-master-audit-core-runtime-engines`'s mission-recovery live test — confirmed to pass cleanly
on immediate re-run, consistent with the same environment-load flakiness pattern observed throughout
this program).
**New tests:** 6 (blocks 155 + 155b) — 2 structural + 4 live, including real HTTP reproductions of the
exact previously-vulnerable unauthenticated request and confirmation that genuinely-public routes remain
public. **Negative-tested the fix**: reverted, confirmed the structural test failed for the exact
expected reason (missing prefixes in the gate array), restored, confirmed passing again. Production
build: PASS. `tests/security/97-enterprise-isolation-integrity.cjs`: 1/1 PASS. `.env` untouched. Server
restarted once (required to load the route-file fix — Node does not hot-reload route registrations),
confirmed healthy (`GET /health` → 200) immediately after.

**No OS-track record altered.**
