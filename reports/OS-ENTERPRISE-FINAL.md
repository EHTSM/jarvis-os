# OS-ENTERPRISE-FINAL — Legacy Enterprise Engine Auth Gap: Found and Fixed

Date: 2026-08-15 · Branch: `security/reality-completion`
Companion: `reports/OS-ENTERPRISE-RECONCILIATION.md` (the 4-question disposition)

---

## Summary

While reconciling B.24 + Organization OS + C10-010's evidence for the 25-OS
Master Inventory's "Enterprise OS" row, a genuine gap was identified: B.24's
live two-tenant testing covered `organizationService.cjs` (canonical) and the
6 `enterprise*.js` M1–M8 modules, but never touched the third, independently
running engine `agents/runtime/enterpriseOS.cjs`, mounted flat in
`backend/routes/ops.js` at `/enterprise/orgs`, `/enterprise/depts`,
`/enterprise/teams`, `/enterprise/roles`, `/enterprise/permissions`,
`/enterprise/policies`, `/enterprise/audit`, `/enterprise/dashboard`,
`/enterprise/summary/*`, `/enterprise/compliance/:orgId`, `/enterprise/search`,
`/enterprise/stats`.

Live testing on an isolated port found this engine had **no authentication
middleware at all**. Fixed with the same precedented gate used elsewhere in
the same file for platform-wide, non-tenant-scoped admin data.

---

## Defect (P0) — found and fixed

**`agents/runtime/enterpriseOS.cjs`'s 32 routes in `ops.js` had zero auth
middleware.** Any HTTP client, with no session cookie and no account, could:

- List every organization on the platform (`GET /enterprise/orgs`)
- Create new organizations (`POST /enterprise/orgs`)
- Rename and archive existing organizations, including pre-existing seed data
  (`PATCH`/`POST .../archive` on `Acme Global`)
- Create departments/roles/teams under any org ID (`POST /enterprise/depts`,
  `/enterprise/roles`, etc.)
- Read the full platform-wide audit log (`GET /enterprise/audit`)

### Live reproduction (isolated port 5307, before fix)

```
$ curl -X POST http://localhost:5307/enterprise/orgs -H "Content-Type: application/json" \
    -d '{"name":"SECRET-LEGACY-ORG-NOAUTH","industry":"finance","plan":"enterprise"}'
{"success":true,"org":{"orgId":"org_1786794085580","name":"SECRET-LEGACY-ORG-NOAUTH",...}}
   -- no Cookie header sent at all --

$ curl http://localhost:5307/enterprise/orgs
{"success":true,"orgs":[... 7 orgs including "Acme Global", "Beta Corp" ...]}
   -- no Cookie header sent at all --

$ curl -X PATCH http://localhost:5307/enterprise/orgs/org_1785926546479 \
    -d '{"name":"HACKED-ACME-BY-NOAUTH"}'
{"success":true,"org":{"orgId":"org_1785926546479","name":"HACKED-ACME-BY-NOAUTH",...}}
   -- pre-existing seeded "Acme Global" org, renamed, no auth --

$ curl -X POST http://localhost:5307/enterprise/orgs/org_1785926546479/archive
{"success":true,"org":{...,"status":"archived",...}}
   -- same org, archived, no auth --

$ curl "http://localhost:5307/enterprise/audit?limit=5"
{"success":true,"events":[... platform-wide audit entries across all orgs ...]}
   -- no auth --
```

**Root cause.** `backend/routes/ops.js` mounts the `_eos` (enterpriseOS.cjs)
route block with plain `router.post(...)`/`router.get(...)` calls and no
preceding `router.use(..., requireAuth, ...)`. A file-wide grep for
`router.use` in `ops.js` shows exactly two gates in the whole file (line 75
for `/stats`/`/ops`/`/metrics`/etc., lines 718–719 for `/dev/*`) — neither
covers `/enterprise/*`. `ops.js` itself is `router.use`'d in
`backend/routes/index.js` before any of the later global auth gates
(`requireActiveAccount` at line 30, `/runtime`'s `requireAuth` at line 39,
etc.), so nothing upstream caught this either.

## Fix

Added a shared gate array and applied it to all 32 `_eos`-backed route
registrations in `backend/routes/ops.js`:

```js
const _eosGate = [requireAuth, operatorOnly, operatorAudit];
```

Same middleware trio already used for this file's other platform-wide,
non-account-scoped admin data (`/stats`, `/dashboard/revenue`, `/metrics`,
`/ops`, `/runtime/reboot`, `/workflow` — see line ~75's own comment: "platform-
wide founder data... not scoped to any one account, so a regular customer must
never reach these"). This legacy engine is architecturally the same class:
`createOrg`/`updateOrg`/etc. take an arbitrary `orgId` with no verification
the caller belongs to it, and `listOrgs()` returns every org in one call —
there is no per-request tenant-membership concept to scope against, only a
platform-operator boundary. `operatorOnly` (not `attachOrg`/`requireOrgMember`)
is therefore the correct-shaped gate, not a workaround.

**Applied per-route, not via `router.use(prefix, ...)`.** Two of the twelve
route prefixes touched — `/enterprise/audit` and `/enterprise/dashboard` —
are literal-string prefixes of unrelated, already-correctly-gated org-scoped
route families mounted later in `backend/routes/index.js`
(`enterpriseAudit.js`'s `/enterprise/audit/:orgId/search` etc.,
`enterpriseDashboard.js`'s `/enterprise/dashboard/:orgId` etc.). Because
`ops.js` mounts before those files, a `router.use("/enterprise/dashboard",
requireAuth, operatorOnly, operatorAudit)` prefix gate would have also
intercepted `/enterprise/dashboard/<realOrgId>` and demanded operator tier
from legitimate org owners — this was caught during verification (see
"Regression caught and corrected" below) and fixed by gating each exact route
individually instead.

## Regression caught and corrected during this pass

The first fix attempt used `router.use([...12 prefixes...], requireAuth,
operatorOnly, operatorAudit)`. Verification showed this broke the real,
B.24-tested `/enterprise/dashboard/:orgId` route:

```
before correction:
  GET /enterprise/dashboard/<realOrgId>  (as the org's own owner)
  -> 403 {"error":"Forbidden — operator access required"}   <- REGRESSION

after correction (per-route _eosGate array, exact paths only):
  GET /enterprise/dashboard/<realOrgId>  (as the org's own owner)
  -> 200, real dashboard data                                <- FIXED
  GET /enterprise/dashboard/<realOrgId>  (as a different tenant, B)
  -> 403                                                      <- correct, unchanged
```

This is disclosed rather than omitted because it is exactly the kind of
"fix broke something it didn't test" mistake this programme's methodology
exists to catch — caught here by explicitly re-testing B.24's own measured
routes after applying the change, before considering the fix complete.

## Live verification (isolated port 5307, after fix)

```
Unauthenticated:
  POST /enterprise/orgs                 -> 401
  GET  /enterprise/orgs                 -> 401
  GET  /enterprise/dashboard (flat)     -> 401
  GET  /enterprise/audit (flat)         -> 401
  GET  /enterprise/stats                -> 401

Authenticated, regular (non-operator) tenant account:
  GET  /enterprise/orgs                 -> 403
  POST /enterprise/orgs                 -> 403

Real org-scoped routes (enterpriseDashboard.js / enterprisePolicy.js /
enterpriseMonitoring.js / enterpriseAudit.js) — unaffected:
  GET /enterprise/dashboard/<ownOrgId>          (owner)  -> 200
  GET /enterprise/policy/<ownOrgId>             (owner)  -> 200
  GET /enterprise/monitoring/<ownOrgId>/health  (owner)  -> 200
  GET /enterprise/audit/<ownOrgId>/search       (owner)  -> 200
  GET /enterprise/dashboard/<otherOrgId>        (cross)  -> 403
  GET /enterprise/policy/<otherOrgId>           (cross)  -> 403
  GET /enterprise/monitoring/<otherOrgId>/health(cross)  -> 403
  GET /enterprise/audit/<otherOrgId>/search     (cross)  -> 403

Canonical /orgs/* and precedent /dev/* routes — unaffected:
  GET /orgs/me/context (self)  -> 200
  GET /dev/repos (unauth)      -> 401
```

## Negative test (regression locked in)

Extended `tests/security/97-enterprise-isolation-integrity.cjs` (the same
suite B.24 added, not a new parallel file) with two new sections:

1. **"Legacy enterpriseOS.cjs engine (/enterprise/orgs etc.) requires auth"**
   — 5 unauthenticated probes (must be 401) + 1 non-operator probe (must be
   403).
2. **"Fix did not shadow the real org-scoped /enterprise/* routes"** — the
   owner's own `/enterprise/dashboard/:orgId` and `/enterprise/audit/:orgId
   /search` must remain 200, guarding against the exact prefix-collision
   regression caught above ever silently returning.

**Negative-tested for real:** reverted the fix on one route
(`GET /enterprise/orgs`), re-ran the suite, confirmed it fails with the exact
expected message:

```
FAILED: unauthenticated GET /enterprise/orgs must be denied (got 200) —
        legacy enterprise engine has no membership model to scope against
200 !== 401
```

Restored the fix, re-ran — clean:

```
[Legacy enterpriseOS.cjs engine (/enterprise/orgs etc.) requires auth]
  ✓  5 unauthenticated legacy-engine probes denied (401); non-operator tenant denied (403)

[Fix did not shadow the real org-scoped /enterprise/* routes]
  ✓  real org-scoped /enterprise/dashboard/:orgId and /enterprise/audit/:orgId/search unaffected by the legacy-engine gate

8 passed, 0 failed
```

## Full regression

```
npm run test:runtime   -> 211/211 pass, 0 fail, 65 suites
                           (run before exploitation testing AND after the fix
                            — both clean; the exploitation phase itself made
                            no code change, only the fix afterward did)
```

## Data cleanup

Exploiting the legacy engine on the isolated port 5307 wrote to the same
on-disk `data/enterprise-orgs.json` / `enterprise-depts.json` /
`enterprise-roles.json` files the port-5050 instance reads (this engine has
no per-port data isolation — a further argument that it should never have
been reachable without auth). Restored via:

- `Acme Global` renamed and re-activated back to its original `name`/`status`
  via the same API, then `archivedAt` (which the API has no "unarchive" verb
  to null) corrected with one minimal, audited, targeted JSON field write.
- The 3 test artifacts created (`SECRET-LEGACY-ORG-NOAUTH` org,
  `NOAUTH-DEPT`, `NOAUTH-ROLE`) removed from their respective JSON files.
- Confirmed final state: 6 orgs (the original seed count), `Acme Global`
  `status:"active"`, `archivedAt:null` — byte-equivalent to pre-test state
  apart from a benign `updatedAt` timestamp.
- `enterprise-audit.json` retains the test-session's audit entries —
  intentionally not scrubbed; audit logs are append-only by design and
  leaving a record of test activity is the correct behavior, not corruption.
- None of these `data/*.json` files are git-tracked (`git ls-files` returns
  empty for all four) — this was runtime state, not repository state.

## Port discipline

- Port 5050 (PID 45392, the pre-existing live dev instance) was never
  stopped, restarted, or sent any exploit/test traffic. Health-checked
  before this pass (`200 ok`), spot-checked mid-pass, and confirmed healthy
  and on the same PID at the end (`uptime_seconds` monotonically increasing
  throughout, same PID 45392 the whole time).
- All testing used port 5307, confirmed free via `lsof` before first use,
  restarted twice (to pick up code changes) by exact PID
  (`kill -9 <pid>` from `lsof -tiTCP:5307 -sTCP:LISTEN`, never a blanket
  `pkill`), and torn down by exact PID at the end of the session.

## Scope discipline

- No new Enterprise architecture was built. The fix is exactly one gate
  array (`_eosGate`) reused across 32 pre-existing route registrations —
  the same shape and same middleware trio already in production use
  elsewhere in the same file.
- The C10-010 product decision (migrate `enterpriseOS.cjs`'s data onto
  `organizationService.cjs`, or formally retire the legacy engine) was
  explicitly NOT made or implemented here, per the mission's instruction.
  What changed is that the legacy engine's worst-case exposure is now
  "an authenticated platform operator can act on it" rather than "anyone
  on the internet can."
