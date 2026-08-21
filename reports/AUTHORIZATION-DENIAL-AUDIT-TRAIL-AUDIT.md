# AUTHORIZATION-DENIAL AUDIT-TRAIL — AUDIT

**Track:** OOPLIX V1 Master Audit — backend coverage: observability / audit trail / security
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Why this item

Reconciled the register per this mission's own instruction. C10-005 and `/p18/memory/*` remain
**DECISION REQUIRED**, `SENTRY_DSN` remains **CREDENTIAL-BLOCKED** — neither selected.

Investigated two coverage-matrix candidates first and found both already correctly engineered:

- **Rate limiting** (`backend/middleware/rateLimiter.js`): real per-IP-per-route in-memory buckets,
  1156 total call sites, sensitive routes (`login`, `forgot-password`, `register`) individually tuned
  with tighter windows. Live-confirmed the registration limiter is genuinely enforced — 2 requests
  succeeded, then 6 correctly `429`'d with an honest `Retry-After: 671` (this session's own extensive
  prior account-creation activity from the same IP, not a bug). Confirmed `/health` correctly isolated
  from the exhausted bucket.
- **Payment webhook idempotency** (`webhookController.js`'s Razorpay handler): `triggerFulfillment()`
  already has a documented, previously-fixed TOCTOU guard for duplicate webhook deliveries;
  `billingService.activatePlan()` and `crmService.updateLead()` are both naturally idempotent overwrite
  operations with no accumulating side effect.

Both correctly reconciled as already mature, no actionable defect, moved past.

## Discovery

Selected observability/audit-trail coverage (matrix #9, #11) and checked whether this session's own
extensive authorization-fix history (15+ `operatorOnly` gates, 19+ `requireOrgMember`/
`requireOrgPermission` route files, `requireWorkspaceMember` on `extensions.js`) actually produces a
forensic trail when someone is denied.

`backend/utils/auditLog.cjs` is real, durable infrastructure — `data/logs/audit.ndjson`, 20 MB rotation,
30-day retention — and `auth.js` already correctly logs `login_denied` with a reason for policy-based
login rejections. But categorizing the actual, current, real production file:

```
grep '"type":"auth"' data/logs/audit.ndjson | (categorize by action)
    94  login
    63  register
     2  logout
```

**Zero** entries for any authorization-boundary 403 — `operatorOnly`, `requireOrgMember`,
`requireOrgPermission` all had **no logging call anywhere**, confirmed by direct source read. This is
significant because this session's own prior missions live-reproduced dozens of real 403s against
these exact gates while fixing them, and none of that left a trace.

`requireWorkspaceMember` was a partial exception: it already emits `workspace:access:denied` on
`runtimeEventBus`, with a header comment explicitly framing it as an IDOR-probing detector — but
`runtimeEventBus` (confirmed by direct source read) has no persistence beyond a shared 500-entry ring
buffer across every event type platform-wide. Unless an SSE client happens to be connected at the exact
moment, and the ring hasn't rotated past it, the signal is gone forever.

## Fix

Added `auditLog.recordAuth()` — the exact same real, durable mechanism `auth.js` already uses for
`login_denied` — to all 4 denial branches:

```js
// authMiddleware.js — operatorOnly
if (req.user.role !== "operator") {
  auditLog.recordAuth({ action: "operator_access_denied", operator: req.user, method: req.originalUrl });
  return res.status(403).json(...);
}

// orgMiddleware.cjs — requireOrgMember
auditLog.recordAuth({ action: "org_access_denied", operator: req.user, method: `${req.path}::${req.org.id}` });

// orgMiddleware.cjs — requireOrgPermission
auditLog.recordAuth({ action: "org_permission_denied", operator: req.user, method: `${action}@${req.org.id}` });

// workspaceMiddleware.cjs — requireWorkspaceMember (in addition to the existing event-bus emission)
auditLog.recordAuth({ action: "workspace_access_denied", operator: req.user, method: `${req.originalUrl}::${req.workspace.id}` });
```

Deliberately scoped to meaningful, low-volume signals — an authenticated caller exceeding their role or
tenant boundary — not bare `requireAuth` 401s (unauthenticated/expired token: high-volume, low-signal
bot/stale-session traffic), matching `auth.js`'s own existing precedent of not separately auditing every
missing-credentials request. Each call wrapped in `try/catch` so audit logging can never itself block
the real denial response, matching the fail-safe pattern already used throughout `auditLog.cjs`'s own
callers.

## Live re-verification

With genuinely fresh, real accounts against the real running server:

| Path | Trigger | Real audit.ndjson entry |
|---|---|---|
| `operatorOnly` | ordinary user → `GET /execution/dashboard` | `operator_access_denied`, correct account ID, `method:"/execution/dashboard"` |
| `requireOrgPermission` | account B → `GET /orgs/<A's real org>/departments` | `org_permission_denied`, `method:"view_departments@org_..."` |
| `requireOrgMember` | account B → `GET /business/leads` w/ forged `X-Org-Id` | `org_access_denied`, `method:"/business/leads::org_..."` |
| `requireWorkspaceMember` | account B → `GET /extensions/runtime?workspaceId=<A's real ws>` | `workspace_access_denied`, correct workspace ID |

Confirmed each entry landed immediately, correctly attributed to the real denied account. Confirmed
legitimate own-resource access (`GET /extensions/runtime` with no override, `GET /business/leads` for
one's own org) still returns `200` with correctly-scoped data, and produces zero denial log entries.

## Regression

- Added describe block `137-master-audit-authorization-denial-audit-trail` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: a structural test covering all 4 denial sites,
  and 2 live tests calling `operatorOnly` directly with mock `req`/`res` and polling the real
  `auditLog.tail()` API (not raw byte-offset comparison on the live, concurrently-written production
  log file — an earlier version of this test was found to race against the real server's own ongoing
  writes/rotation and was redesigned to poll the module's own read API instead).
- Negative-tested: reverted `operatorOnly`'s fix, confirmed both the structural and live-denial tests
  failed for the right reason, restored, confirmed passing again.
- `npm run test:runtime`: **277/277** (274/274 baseline + 3 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1).
- Production build: unaffected (backend-only, no frontend files touched).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Authorization-Denial Audit-Trail (operatorOnly/requireOrgMember/requireOrgPermission/requireWorkspaceMember)

**STATUS:** CERTIFIED
**SCORE:** 9/10
**CONFIDENCE:** 92%

## V1 SURFACE

- **Backend:** `backend/middleware/authMiddleware.js`, `orgMiddleware.cjs`, `workspaceMiddleware.cjs`
  (3 files, 4 denial branches extended with durable audit logging). `backend/utils/auditLog.cjs` reused
  unchanged.
- **Routes:** all routes composing any of the 4 fixed middlewares — 15+ `operatorOnly`-gated route
  groups, 19+ `requireOrgMember`/`requireOrgPermission` route files, `extensions.js`'s
  `requireWorkspaceMember` routes — all now produce a durable denial record.
- **Frontend:** N/A — no frontend files touched, no UI consumer of the audit log in scope this pass.
- **Persistence:** PASS — the actual subject; real entries confirmed landing in
  `data/logs/audit.ndjson` with existing rotation/retention, live-verified across all 4 paths.
- **Authentication:** N/A — unaffected.
- **Authorization:** N/A — no boundary was widened, narrowed, or changed; this pass only added logging
  to already-correct denials.
- **Tenant Isolation:** N/A — the audit-log fix doesn't change isolation behavior, only its visibility.
- **Cross-OS:** N/A — pure Node.js logging call, platform-independent.
- **Failure Honesty:** PASS, and the actual improvement — a real denial no longer disappears without a
  trace; a legitimate access is confirmed to never be mislogged as a denial.
- **Live Verification:** 4 real denial paths reproduced with genuinely fresh accounts against the real
  running server, each confirmed to produce a real, correctly-attributed, immediately-readable audit
  entry; legitimate access confirmed unaffected and not falsely logged.
- **Regression:** 277/277 (0 failures, 0 skipped, 3 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — every authorization-boundary 403 across 4 real, heavily-used middleware
  functions had zero durable audit trail, despite dozens of real denials having been live-reproduced
  across this session's own prior missions.
- **V1-critical P2:** 0
- **Other:** confirmed rate limiting and payment-webhook idempotency are both already correctly
  engineered — investigated, not force-"fixed."

## FIXES

- 4 denial branches across 3 middleware files now call `auditLog.recordAuth()`, reusing the exact
  mechanism `auth.js` already uses for `login_denied` — no new logging architecture.
- 3 new regression tests (1 structural, 2 live), negative-tested.

## LIMITATIONS

- Deliberately does not audit bare `requireAuth` 401s (unauthenticated/expired token) — a scope
  decision, not an oversight, matching this file's own existing precedent; if a future need arises to
  track unauthenticated probing volume specifically, that would be a separate, distinct decision.
- The fix logs the denial event itself but does not add any alerting/threshold detection on top of it
  (e.g., "N denials from the same account in M minutes") — out of scope for this pass; the durable
  record now exists for such tooling to be built on top of later if needed.
- `requireOrgMember`'s logged `method` field packs the route path and org ID into one string
  (`path::orgId`) rather than separate structured fields, matching `recordAuth()`'s existing 3-field
  schema (`action`/`operator`/`method`) rather than changing it — a minimal-footprint choice, not a
  schema redesign.

## FINAL CLASSIFICATION: **CERTIFIED**

## PROGRAMME IMPACT

Closes a real, previously-invisible observability gap directly created by this session's own
extensive authorization-hardening work — 15+ `operatorOnly` fixes and 19+ `requireOrgMember`/
`requireOrgPermission` route files now leave a genuine forensic trail when their boundaries are
actually tested in production, closing the loop between "the defect is fixed" and "an attempt to
exploit it would be visible." No OS-track record altered.

## REGRESSION RESULT: 277/277 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (unaffected; backend-only change, no frontend files modified)

## CURRENT BASELINE: 277/277
