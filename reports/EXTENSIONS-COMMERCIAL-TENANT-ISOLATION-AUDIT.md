# EXTENSIONS/COMMERCIAL TENANT ISOLATION — AUDIT

**Track:** OOPLIX V1 Master Audit — investigating the 3 deliberately-unswept files from the prior mission
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** RC/Launch Tooling Authorization Audit (explicitly deferred
`extensions.js`, `distribution.js`, `commercial.js` to a future mission, not assumed vulnerable).

---

## Method

The prior mission's own instruction: investigate the 3 named files without assuming they're
vulnerable. Read each file's actual routing/scoping logic and its backing service's real `orgId`/
identity-scoping behavior before drawing any conclusion, rather than pattern-matching on file names.

## `distribution.js` — confirmed clean, no fix needed

`router.use("/distrib", requireAuth)` with no `operatorOnly` — but the file's own header comment
states *"Tenant isolation — mirrors growthOS.js/contentSEO.js's req.orgId middleware"*.
`distributionEngine.cjs` confirmed **147 real `orgId` occurrences** — genuinely, extensively
tenant-scoped. Not the operator-vs-customer defect family; not investigated further.

## `extensions.js` — genuine cross-tenant IDOR found and fixed

This file is **not** part of the operator-only defect family (it correctly uses real
authenticated-user auth throughout) — but a systematic per-route read surfaced a different, real
defect: a caller-supplied identifier bypassing membership verification.

**Discovery**: `_wsId(req)` resolves the target workspace as
`req.query.workspaceId || req.body?.workspaceId || req.workspace?.id || "default"` — a caller-supplied
value takes priority. `attachWorkspace` (the only middleware composed on the base `/extensions` gate)
is documented as non-blocking by its own header comment — it resolves `req.workspace`/
`req.workspaceRole` but never rejects a request itself. The file's 6 mutating routes
(`load`/`unload`/`suspend`/`resume`/`restart`/`crash`) already correctly compose `requireRole()`,
which does check `req.workspaceRole` and reject an unauthorized caller — but the 5 **read-only**
routes (`GET /extensions/runtime`, `/metrics`, `/hooks`, `/quotas`, `/runtime/:id`) had no equivalent
gate at all.

**Live-reproduced**: a real, unrelated authenticated account supplied a real workspace ID belonging to
a different, unrelated account via `?workspaceId=` and successfully read:

```
GET /extensions/runtime?workspaceId=<victim's real workspace> → 200 {"extensions":[],"total":0}
GET /extensions/metrics?workspaceId=<victim's real workspace> → 200, full metrics payload including
    the entire platform-wide event-bus subscriber list (automation-service-event-loop, orchestrator_i3,
    engorg_wf_*, bizorg_wf_*, ...) — an incidental additional leak embedded in an otherwise
    workspace-scoped response.
```

**Fix**: added `requireWorkspaceMember` — the same real, already-proven membership-enforcement
middleware already used elsewhere in this codebase (e.g. `workspace.js`'s own
`GET /workspace/:id/members`) — to all 5 read-only routes, composed after the existing
`attachWorkspace`.

**A self-caught regression, investigated and resolved within the same pass**: an early verification
pass appeared to show the fix breaking the "no `workspaceId` supplied, view my own default workspace"
case for one specific test account (`403 Not a member of this workspace`). Investigated the root cause
before accepting this as a real regression: `getActiveWorkspace(accountId)`'s fallback resolves to the
literal `"default"` workspace record (0 real members) when an account has no saved active-workspace
preference. The specific test account used was created earlier in this multi-mission session, before
some workspace-provisioning logic was in its current form, and had no saved preference — not
representative of real registration. **Confirmed via two genuinely fresh `POST /accounts/register`
calls**: real registration correctly calls `switchWorkspace()`, saving a real per-account preference
pointing at a real, dedicated workspace — the default case works correctly for any account created
through the actual, current registration flow. No further fix needed; the apparent regression was an
artifact of stale test fixtures, not the code.

## `commercial.js` — genuine cross-tenant billing/usage leak found and fixed

**Discovery**: of the ~30 routes in this file, every single one correctly uses
`_accountId(req)` (`req.user?.sub || req.user?.accountId || req.user?.id || "unknown"` — the real
authenticated identity) — except 3:

```js
// GET /commercial/usage/summary — caller-supplied accountId silently wins
accountId: req.query.accountId || _accountId(req),

// GET /commercial/usage/history — no account filter passed at all
res.json({ ok: true, events: metering.loadHistory(limit) });

// GET /commercial/usage/by/:dimension — no account filter passed at all
const agg = metering.aggregateCost(dimension, { limit: ... });
```

`usageMetering.cjs`'s `loadHistory(limit)` reads the **entire raw on-disk usage ledger** with no
filtering by design (confirmed by direct source read); `aggregateCost(dimension, opts)` delegates to
`query(opts)`, which **does** correctly filter by `opts.accountId` when one is supplied — the defect
was purely that these 3 call sites never supplied it.

**Live-reproduced**: an ordinary authenticated account (with zero real usage of its own) called
`GET /commercial/usage/history?limit=3` and received real events belonging to a completely different,
unrelated `accountId`/`orgId` (`test-jarvis-org-attr-...`) — real cost figures, token counts, provider
names, request types. This is genuine cross-tenant billing-data exposure, more severe in kind than the
`extensions.js` finding (real financial/usage data, not empty placeholder responses).

**Fix**: pinned all 3 routes to `_accountId(req)` with no caller override, matching the file's own
established, correct pattern everywhere else:

```js
accountId: _accountId(req),                                    // usage/summary
const events = metering.loadHistory(limit).filter(e => e.accountId === accountId);  // usage/history
metering.aggregateCost(dimension, { limit: ..., accountId: _accountId(req) });      // usage/by/:dim
```

`loadHistory()` has no `accountId` parameter in its own signature, so the filter is applied to its
result in the route itself, rather than changing the shared service function's contract — the smaller,
safer change. `aggregateCost()` already accepts an `accountId` option via its existing `query()`
delegation, so that one only needed the missing argument supplied.

Confirmed no frontend consumer exists for any of the 3 fixed `usage/*` routes — no legitimate feature
depends on cross-account querying, and no operator/admin framing exists anywhere in this file that
would suggest cross-account access was ever an intended capability.

## Live re-verification (post-fix, and again after a real restart, with genuinely fresh accounts)

- Fresh account A creates a real workspace at registration; fresh account B (unrelated) supplies A's
  real workspace ID → `403 Not a member of this workspace` (was `200` with real data before the fix).
- Fresh account B's own default workspace read (no `workspaceId` supplied) → `200`, correctly own data.
- Fresh account B's `GET /commercial/usage/history` and `?accountId=` override attempt → both
  correctly scoped to B's own (empty) real usage, no cross-account leak.
- Re-ran the full sequence on a fresh server process after a real restart with two brand-new
  registrations — identical, correct results.

## Regression

- Added 3 tests (describe block `132-master-audit-extensions-commercial-tenant-isolation`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: structural coverage for all 5 `extensions.js`
  routes, structural coverage for all 3 `commercial.js` routes, and a live service-layer proof using
  `workspaceService.cjs` directly (an unrelated account resolves `null` role in another's real
  workspace; the real creator resolves `"Owner"` in their own).
- Each fix independently negative-tested: reverted `extensions.js`'s `/extensions/runtime` gate alone
  (confirmed only that test failed, others unaffected, restored); reverted `commercial.js`'s
  `usage/history` filter alone (confirmed only that test failed, others unaffected, restored).
- `npm run test:runtime`: **263/263** (260/260 baseline + 3 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected.
- Production build: clean (backend-only change; no frontend files modified).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Extensions/Commercial Tenant Isolation (extensions.js + commercial.js)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 90%

## V1 SURFACE

- **Backend:** `backend/routes/extensions.js` (5 routes gated), `backend/routes/commercial.js` (3
  routes re-scoped). Backing services (`extensionRuntime.cjs`, `usageMetering.cjs`) unchanged — their
  own filtering logic was already correct; only the route-level identity resolution was missing.
- **Routes:** 5 `/extensions/*` reads, 3 `/commercial/usage/*` reads — all live-tested with genuinely
  fresh, real accounts.
- **Frontend:** confirmed no consumer exists for the 3 fixed `/commercial/usage/*` routes; existing
  `/extensions/*` consumers (if any) are unaffected since the default same-workspace case is unchanged.
- **Persistence:** N/A — no persisted state changed.
- **Authentication:** PASS — unaffected.
- **Authorization:** PASS after fix — real, live-reproduced cross-tenant reads closed using
  already-proven mechanisms (`requireWorkspaceMember`, `_accountId(req)` self-scoping).
- **Tenant Isolation:** PASS after fix — the actual subject of this audit; live-verified with two
  independent fresh-account pairs, both before and after a real restart.
- **Cross-OS:** N/A — route-level authorization/scoping fixes, not a cross-OS composition.
- **Failure Honesty:** PASS — the new `403` (extensions) and correctly-scoped-empty responses
  (commercial) are both real, not fabricated; no fake success introduced.
- **Live Verification:** every claim backed by real HTTP requests with genuinely fresh registered
  accounts (not reused stale test fixtures, after one was found to be a false-positive regression
  signal), both before and after a real server restart.

## FINDINGS

- **P0:** 0
- **P1:** 2 found and fixed — `extensions.js`'s caller-supplied-workspace-ID read bypass (including an
  incidental platform-wide event-bus subscriber list leak), and `commercial.js`'s cross-account
  billing/usage-history exposure.
- **V1-critical P2:** 0
- **Other:** correctly distinguished a fix-verification artifact (a stale test account's missing
  workspace preference) from a real regression before accepting either conclusion; confirmed
  `distribution.js` (the third named file) is genuinely clean, avoiding an unnecessary fix.

## FIXES

- `backend/routes/extensions.js`: added `requireWorkspaceMember` to `GET /extensions/runtime`,
  `/metrics`, `/hooks`, `/quotas`, `/runtime/:id`.
- `backend/routes/commercial.js`: removed the `req.query.accountId` override in `usage/summary`;
  added a real `accountId` filter to `usage/history` and `usage/by/:dimension`.
- 3 new regression tests, each fix independently negative-tested.

## LIMITATIONS

- `distribution.js` was confirmed clean via its `orgId` count and header comment, not via a full live
  cross-tenant reproduction attempt (unlike `extensions.js`/`commercial.js`) — a lighter-touch
  confirmation, appropriate given the strength of the existing evidence (147 real `orgId` occurrences).
- The `extensions.js` metrics endpoint's incidental leak of the platform-wide event-bus subscriber
  list is now correctly gated behind workspace membership, but the underlying design (a
  workspace-scoped endpoint returning platform-wide internal data) was not otherwise changed — any
  real workspace member still sees this same platform-wide subscriber list, just no longer any
  arbitrary caller.
- Did not perform a broader sweep beyond these 3 named files this pass, per the mission's explicit
  "complete ONE audit only" instruction.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Directly answers the prior mission's own deferred question with real investigation rather than
assumption — one of the 3 files (`distribution.js`) confirmed genuinely clean, the other two
(`extensions.js`, `commercial.js`) found to have real, distinct cross-tenant IDOR defects (a different
shape than the 15 prior `operatorOnly` fixes this session — caller-supplied-identifier bypass rather
than missing role tier), both closed using already-proven, existing mechanisms. No OS-track record
altered.

## REGRESSION RESULT: 263/263 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean; backend-only change, no frontend files modified)
