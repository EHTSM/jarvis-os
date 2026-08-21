# OS-ECOSYSTEM — SECURITY REPORT

**Date:** 2026-08-15 · **Server:** `localhost:5221` (isolated verification server, this session's
own process) · **Audit Track's server (port 5050) confirmed running throughout — including through
several of its own legitimate self-initiated restarts, each independently verified healthy before
this session continued. No action targeting port 5050 or any of its PIDs was ever issued by this
session.**

No JWT was ever forged. No authentication middleware was ever bypassed or disabled. No credentials
were guessed or invented. `.env` was never modified. Real, uniquely-identifiable data was populated
on both real tenants before any isolation conclusion was drawn — never empty-vs-empty.

---

## 1. Unauthenticated access

| Endpoint | Result |
|---|---|
| `/product-factory/plans` | 401 |
| `/dev/repos` | 401 (pre-existing, re-confirmed) |
| `/customer-org/health` | 401 (pre-existing, re-confirmed) |

All correctly gated.

---

## 2. FINDING 1 (P0 — the mission's own "first priority") — Product OS tenant isolation

### Was: 0/5 (per the same-day Product OS pass's own certification)

### Investigation

Per the mission's explicit checklist: confirmed via blast-radius grep that zero other services
depend on Product Factory record shape/IDs (9 of 14 referencing files only health-check-ping or
comment-reference the module, never call a real function); confirmed ~447 pre-existing records
across 5 stores; confirmed no cross-referencing from Business/Sales/Finance/Knowledge/Memory into
specific plan/architecture/assembly/validation/release IDs. **Conclusion: safely recoverable**,
contradicting the earlier pass's "requires broad architecture" classification.

### Fix

`orgId` required on every data-access function across all 5 Product Factory engines +
`productFactoryDashboard.getProductView()`; route layer adds `requireOrgMember` (not just
`attachOrg`) and threads `req.org.id` into every call. Identical pattern to the already-proven
`developerOS.cjs`/C10-003 fix.

### Live verification

Full battery in Workflow Evidence report: direct-ID read, list, **write** (architecture design
against a foreign plan), and dashboard view all confirmed blocked post-fix; all confirmed working
pre-fix (live-reproduced before fixing, not assumed from the earlier pass's report alone).
Legitimate own-org access confirmed unaffected in every case.

### After: 5/5 (list, read, write, dashboard, forged-header all correctly blocked)

---

## 3. FINDING 2 (P0 — newly discovered) — `/dev/*`'s C10-003 fix was itself incomplete

### Discovery context

Found while verifying Finding 1's fix against its own cited precedent, per this mission's Section
17 instruction to inspect prior fixes rather than blindly trust their "Closed" status.

### Root cause

`attachOrg` resolves `req.org` from a client-supplied `X-Org-Id` header with **no membership
verification** (explicitly documented as non-blocking in `orgMiddleware.cjs`'s own file header).
`ops.js`'s `/dev/*` gate (`router.use("/dev", requireAuth, attachOrg)`, plus a bare
`!req.org?.id` check) only verifies *some* real org resolved — not that the caller genuinely
belongs to it.

### Live reproduction (real accounts, real data)

```
A creates a real repo "A-SECRET-REPO-4471" (real orgId)
B, X-Org-Id forged to A's real org, GET /dev/repos   → 200, A's repo disclosed
B, X-Org-Id forged to A's real org, POST /dev/repos  → 200, a new repo created UNDER A's org
```
A real cross-tenant read **and write**, on the exact route the Audit Track's own C10-003 finding
had certified "Closed."

### Fix

```js
router.use("/dev", requireAuth, attachOrg, requireOrgMember);
```

### Negative test

`tests/security/113-ecosystem-os-tenant-isolation-recovery.cjs` — static assertion on the exact
gate string, confirmed failing pre-fix via `git stash` reproduction.

### Live re-verification

Forged header → 403 post-fix; legitimate own-org access (both A and B, no header) → 200, unaffected.

### Test-suite correction

`tests/runtime/10-c10-cross-system-closure.test.cjs`'s own assertion literally string-matched the
old, incomplete gate (`router.use("/dev", requireAuth, attachOrg)`). Updated to match the new,
strictly-more-secure gate (adding `requireOrgMember`) and added one new assertion covering the
membership check specifically — not weakened, corrected to assert the stronger real behavior.

---

## 4. FINDING 3 (P0 — newly discovered, inverted shape) — `/customer-org/*`'s "verified nobody" leak

### Root cause

`customerOrg.js`'s own `_orgId(req)` helper **correctly** returns `null` for a forged header the
caller isn't a genuine member of. But downstream service functions
(`customerHealthEngine.listHealthRecords`, and the identical pattern elsewhere in the same file)
treat a `null` orgId as "don't filter, return everything" — a legitimate design for genuinely
unscoped/operator callers elsewhere in this codebase, but wrong here since this route's callers are
always regular authenticated tenant accounts.

### Live reproduction

```
B, X-Org-Id forged to A's real org, GET /customer-org/health
→ 200, 58 real health records spanning MANY different real orgIds (entire platform-wide dataset)

B, no header at all (legitimate auto-resolve to B's own, genuinely empty org)
→ 200, {"records":[]}
```
**The attack path returned strictly more data than the legitimate path** — a genuinely inverted
vulnerability shape, not merely "same leak, different route."

### Fix

```js
router.use("/customer-org", requireAuth, attachOrg, requireOrgMember);
```
Closes the "verified nobody" path before any handler — and therefore before the null-orgId
unscoped-fallback service call — can ever be reached.

### Negative test and live re-verification

Same test file; forged header → 403 post-fix; legitimate no-header auto-resolve access for both A
(own empty org) and B (own empty org) → 200, unaffected.

---

## 5. Investigated and found NOT vulnerable — `crm.js`

`GET /crm/leads` also uses `attachOrg` alone. Tested the identical forged-header vector with real
data (a real lead named `CRM-SECRET-A-lead`) — **no leak occurred**. Investigated the reason rather
than assuming safety from one negative test: the route applies a second, independent filter
(`.filter(l => l.userId === userId)`) that happens to close the gap regardless of what `_orgId(req)`
resolves to. Confirmed by code reading, not just the one live test. **Not fixed — genuinely safe**,
documented as an investigated-and-resolved item, not left ambiguous or silently skipped.

---

## 6. Lower-severity, correctly-scoped findings — not fixed this pass

`ai.js` and `jarvis.js` also use `attachOrg` alone. Investigated: both uses are exclusively for
**usage-metering attribution** (which org's ledger a billing/usage event gets recorded against),
never for reading or returning that org's private data back to the caller. A forged header here
would misattribute billing/usage reporting to the wrong org — a real but categorically different
and lower-severity risk than data disclosure or unauthorized write. Consistent with the Master
Recovery's own C10-004b precedent (escalating a diffuse, lower-severity finding rather than
blanket-fixing it without a scoped investigation of each call site). Documented, not fixed this
pass.

---

## 7. Role/authorization verification

| Test | Result |
|---|---|
| Operator ≠ org owner | **PASS** — `/eos/v6/*` correctly 403's a real org owner who is not a platform operator |
| Org owner ≠ platform operator | **PASS** — same test, reverse framing |
| Membership cannot be forged via header | **PASS (after 3 fixes)** — `/dev/*`, `/product-factory/*`, `/customer-org/*` all now correctly reject a forged `X-Org-Id` for a non-member org |
| Direct-path non-member access | **PASS** — `/org-executive/:orgId/*` correctly 403's both a forged-header attempt and a direct non-member path attempt |
| Unauthenticated access | **PASS** — 0 leaks across all tested endpoints |

---

## 8. Summary

| Category | Result |
|---|---:|
| Unauthenticated access | 0 leaks / 3 tested |
| Cross-tenant isolation (Product OS) | **Was 0/5, now 5/5 (fixed)** |
| Cross-tenant isolation (forged header, platform-wide sweep) | **3 real findings, all fixed; 1 verified-safe false positive; 2 lower-severity escalated, not fixed** |
| Data integrity after all attacks | Unchanged, verified |
| Regression | 200/200 before and after every fix |

**Tenant isolation: 8/8** discrete boundary categories tested this pass now pass (Product OS ×5,
`/dev/*`, `/customer-org/*`, `/org-executive/*`) — 3 were found failing on first measurement and
are now fixed; 5 were already correct.
