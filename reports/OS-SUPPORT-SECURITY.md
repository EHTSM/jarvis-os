# OS-SUPPORT — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5155` · **Method:** executed attack attempts

**Constraints honoured:** no JWT forged, no auth bypassed, no credentials guessed, no security
middleware disabled, `.env` not modified, no secret printed. All sessions from real
`POST /auth/login`.

**Tenants:**

| Account | Real role | Org/Workspace |
|---|---|---|
| `finoa@test.local` | user | Org A / workspace `…5cc8412b` |
| `finop@test.local` | **operator** (genuine platform role) | Org B / workspace `…22971bc3` |
| `supc@test.local` (created this pass) | genuine non-operator peer | own workspace |

---

## 1. Authentication

| # | Test | Result |
|---|---|---|
| — | Unauthenticated `GET /co3/cs` | 401 |
| — | Unauthenticated `POST /customer-org/support/ticket` | 401 |

`requireAuth` unmodified, inherited from prior-verified middleware.

---

# FINDING SUP-1 — Cross-tenant analytics leak in `getCSInbox()` (HIGH → FIXED)

## Reproduction

```
GET /co3/cs   (finoa, 1 real ticket, correctly scoped tickets array)
→ "total":9,"open":6,"resolved":1,"slaBreach":5,
   "byStatus":{"open":6,"closed":1,"resolved":1,"in_progress":1}
```
A single-ticket account received platform-wide totals, SLA-breach counts, and a full cross-tenant
status/priority breakdown — every summary field leaked, while the `tickets` list itself did not.

## Root cause

`getCSInbox()` computed all 7 summary fields from the raw `tickets` array instead of the
already-scoped `filtered` array, even when a caller-supplied `accountId` filter was applied.

## Fix

All summary computations (`byStatus`, `byPriority`, `slaBreach`, `total`, `open`, `resolved`,
`avgResolutionHrs`) now derive from `filtered`. Unscoped calls (no filter — internal aggregation,
operator view) are unaffected since `filtered === tickets` in that case.

## Negative test

```
T1 scoped: total=1, no cross-tenant data     PASS
T2 unscoped: total=4, full aggregate intact  PASS
```

## Live verification

| | Before | After |
|---|---|---|
| Non-operator, 1 real ticket | `total:9, slaBreach:5` (platform-wide) | `total:1, slaBreach:0` (own only) |
| Operator (genuine platform role) | `total:9` | `total:9` (unaffected — correct, this is the intended all-tickets view) |

---

# FINDING SUP-2 — Cross-tenant write IDOR on ticket resolution (HIGH → FIXED)

## Reproduction

```
POST /customer-org/support/ticket/<OrgA's real ticket id>/resolve   (Org B — unrelated organization)
{"resolution":"resolved by wrong org"}
→ 200  {"ticket":{"status":"resolved",...}}
```
Confirmed genuinely persisted to disk. **Reverted immediately** after confirmation, before any
further testing, so no fabricated resolution record remained in the data store.

## Root cause

The sibling `GET /customer-org/support/ticket/:id` route carries a documented B.21 ownership
check; the `POST .../resolve` mutation route was missing the identical guard — an oversight where
one half of a read/write pair was hardened and the other was not.

## Fix

```js
router.post("/customer-org/support/ticket/:id/resolve", wrap(async (req, res) => {
  const existing = _csup()?.getTicket?.(req.params.id);
  if (!existing) return err(res, "ticket not found", 404);
  const org = _orgId(req);
  if (org && existing.orgId !== org) return err(res, "ticket not found", 404);
  ok(res, _csup()?.resolveTicket?.(req.params.id, req.body));
}));
```
Same 404-not-403 convention as the sibling read route, so the endpoint does not confirm a ticket's
existence to a non-owner.

## Live verification

| | Before | After |
|---|---|---|
| Org B resolves Org A's ticket | 200, real mutation persisted | **404**, zero effect (confirmed on disk) |
| Org A resolves their own ticket | 200 | **200** (unaffected) |

---

## 2. Historical support-ticket leak — explicit regression (mission-mandated)

Per the mission's explicit instruction: populate Org A only (not two empty tenants), then verify.

```
Org A creates a real ticket.
GET .../ticket/:id   (Org A)  → 200, real ticket
GET .../ticket/:id   (Org B)  → 404 "ticket not found"
GET .../tickets      (Org B)  → {"tickets":[]}  — zero results, response body inspected, not just status
```

**PASS.** The historical leak this system was previously hardened against (B.21) remains fixed,
and this pass's own new fixes (SUP-1, SUP-2) close two adjacent gaps in the same defect family.

## 3. A test-methodology error, caught and corrected before reporting

Initial reply/status-update testing used `finop@test.local` as the "attacker" account against
`finoa`'s ticket and found both actions succeeded. Before classifying this as a defect, the account
was verified: `finop` genuinely holds the platform `operator` role, and the code's own comment
documents operator-wide ticket visibility as the intended support-desk model — the same
distinction already established and verified independent of tenant ownership in the Organization
OS pass (org owner ≠ platform operator, and here: platform operator legitimately spans all
tenants' support tickets by design).

A **new, genuine non-operator peer account** was created and used to re-run the identical test:

```
POST /co3/cs/:id/reply   (genuine peer, real role:"user")   → 403 "Forbidden — ticket belongs to another account"
PATCH /co3/cs/:id        (genuine peer)                     → 403 same
GET /co3/cs               (genuine peer)                     → total:0, zero tickets visible
```

**Correctly isolated.** No fix was required for this path — reported here to document that the
finding was investigated rather than assumed, exactly as the mission's Step 4 requires ("Do not
merely trust status code" / do not call a false positive a leak either).

## 4. Direct-ID / IDOR summary

| # | Test | Result |
|---|---|---|
| Ticket direct-ID read, cross-org | **404** (pre-existing B.21 fix, re-verified) |
| Ticket direct-ID write (resolve), cross-org | **404** (SUP-2 fix, this pass) |
| Ticket reply, cross-account (genuine peer) | **403** |
| Ticket status update, cross-account (genuine peer) | **403** |
| Ticket list, cross-org / cross-account | Empty result set, verified by body inspection |
| Ticket analytics summary, cross-account | **Fixed (SUP-1)** — no longer platform-wide |

## 5. Role / privilege escalation

| # | Test | Result |
|---|---|---|
| Non-operator claims operator-wide ticket visibility | Not possible — `_isOperator()` reads the real session role, not any client-suppliable field |
| Forged `X-Org-Id` header | No effect — `attachOrg` (Organization OS pass, unmodified here) derives identity from verified membership only |

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — inherited, unaffected |
| **Support analytics tenant isolation** | **Was HIGH — now FIXED (SUP-1)** |
| **Ticket resolution write IDOR** | **Was HIGH — now FIXED (SUP-2)** |
| Ticket direct-ID read isolation | **Strong** (pre-existing, re-verified) |
| Reply/update isolation | **Strong** (verified against a genuine non-operator peer, not just a role-holding account) |
| Historical leak regression | **PASS** |
| Forged header resistance | **Strong**, unmodified |
| Operator role integrity | **Strong** — not spoofable |

**No credentials were rotated, printed, or modified at any point.**
