# OS-CUSTOMER-SUCCESS — SECURITY EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5144` · **Method:** executed attack attempts

**Constraints honoured:** no JWT forged, no auth bypassed, no credentials guessed, no security
middleware disabled, `.env` not modified, no secret printed. All sessions from real
`POST /auth/login`.

**Two real organizations**, reused from the Organization OS pass:

| Org | Owner | ID |
|---|---|---|
| A | `finoa@test.local` | `org_1786718762053_1` |
| B | `finop@test.local` | `org_1786718779057_2` |

---

## 1. Authentication

| # | Test | Result |
|---|---|---|
| — | Unauthenticated `GET /customer-org/journey` | 401 (inherited `requireAuth`, unmodified) |
| — | Unauthenticated `POST /customer-org/journey/sync` | 401 |

`requireAuth` was not touched this pass; verified correct across five prior OS passes.

---

# FINDING CS-1 — Customer journey/health/success-plan records leaked across every tenant (HIGH → FIXED)

**Status:** Confirmed, root-caused, fixed, negative-tested, live-verified against two real orgs.

## Reproduction — the leak, live, two real sessions

```
GET /customer-org/health?limit=2   (Org A owner)
→ {"records":[{"customerId":"919000000002",...},{"customerId":"919988776655",...}]}

GET /customer-org/health?limit=2   (Org B owner — different account, different real org)
→ {"records":[{"customerId":"919000000002",...},{"customerId":"919988776655",...}]}
```
**Byte-for-byte identical response** to two independently-authenticated, unrelated organizations.

## Root cause

`customerJourneyEngine.cjs`, `customerHealthEngine.cjs`, `customerSuccessEngine.cjs` — confirmed by
`grep -n "orgId"` returning **zero matches** in all three files — stored and returned every
customer record to every caller with no tenant field to filter on. The route file's own comment
documents the identical defect class already fixed once for support tickets:

> *"Support tickets previously carried no tenant field at all, so listTickets() returned every
> org's tickets to every authenticated caller (reproduced live: two separate companies received
> the SAME 50-ticket list, containing neither company's own tickets)."*

Three sibling engines feeding the same route file and the same frontend (`CustomerSuccessCenter.jsx`)
carried the unfixed version of this exact bug.

## Fix — the exact precedented pattern (`customerSupportEngine.listTickets()`), applied identically

```js
// customerJourneyEngine.cjs — _buildJourney()
orgId: lead.orgId || null,   // inherited from the CRM lead, which already carries a real orgId

// listJourneys() / getJourney()
if (orgId) list = list.filter(j => j.orgId === orgId);   // legacy null-orgId rows excluded, not misattributed
```
Identical pattern applied to `customerHealthEngine.cjs` (inheriting `orgId` from the CRM lead) and
`customerSuccessEngine.cjs` (inheriting `orgId` from the health record). `customerOrg.js` passes
`_orgId(req)` — the route file's own existing, already-verified helper — through to every affected
function.

## Negative tests (isolated, before any HTTP request)

```
T1 stage-only filter (was broken)          : 3 (expect 3)            PASS
T2 orgId scoping - OrgA only               : [c1,c3] (expect c1,c3)  PASS
T3 orgId scoping - OrgB only               : [c2] (expect c2)        PASS
T4 legacy null-org excluded from scoped call: false (expect false)   PASS
T5 unscoped call preserves internal behaviour: 4 (expect 4)          PASS
T6 combined stage+churnRisk filter         : [c3] (expect c3)        PASS
```

## Live verification — direct-ID access (all three engines, two real orgs)

| Engine | Org A (owner) | Org B (different org, same customerId) |
|---|---|---|
| Journey | 200, real record | **404** `journey not found` |
| Health | 200, real record | **404** `health record not found` |
| Success plan | 200, real record | **404** `plan not found` |

## Live verification — list endpoints (all three engines, two real orgs)

| Engine | Org A sees | Org B sees |
|---|---|---|
| Journey | 1 (their own) | **0** — not the tagged record, not any of the 67 other legacy records either |
| Health | 1 | **0** |
| Success plans | 1 | **0** |

## Before / After summary

| | Before | After |
|---|---|---|
| Cross-org direct-ID read | 200 (full record disclosed) | **404** |
| Cross-org list read | Identical full list disclosed | **Correctly empty / own-org-only** |
| Legacy (pre-fix) records under a scoped call | Would be misattributed to whoever asks | **Correctly excluded**, matching the tickets precedent |
| Unscoped internal calls (stats, aggregation) | Full dataset | **Unchanged** — still full dataset (no `orgId` param passed) |

---

## 2. Forged headers

| # | Test | Result |
|---|---|---|
| — | `X-Org-Id` forged to a different org, on a **path-parameterised** route | Not applicable to `customer-org` (no `:orgId` path segment — org comes solely from `attachOrg`'s verified resolution) |
| — | Forged `x-workspace-id` on a request the caller has no real membership for | **403** — the accidental `security.js` leak (documented in Organization OS) genuinely validates real membership; forging the header does not bypass it |

`attachOrg` (from `orgMiddleware.cjs`, already hardened and re-verified in the Organization OS
pass) is the sole source of org identity for every `/customer-org/*` route — there is no
client-suppliable org id path parameter on this surface to confuse with a header.

## 3. Customer / Success-Plan / Health / Activity IDOR

All covered under Finding CS-1 above — every one of the mission's named IDOR categories
(customer-IDOR, success-plan IDOR, health-score IDOR) was the same single root cause, fixed
identically across all three.

**Activity IDOR:** no distinct "customer activity" record type separate from journey/health/success
was found in this codebase — journey stage transitions and health-score history serve that role,
and were covered by the same fix.

**Feedback IDOR:** feedback lives in the adjacent `/co3/feedback` system, not `/customer-org/*`;
not exercised this pass (Not Measured, not asserted secure or insecure).

---

## Security posture summary

| Dimension | Verdict |
|---|---|
| Authentication | **Strong** — inherited, unaffected |
| **Cross-tenant journey/health/success-plan access** | **Was HIGH severity — now FIXED** |
| Forged header resistance | **Strong** — `attachOrg` unaffected by any header value without real membership |
| Support ticket isolation (pre-existing) | **Strong** — unaffected, unmodified, re-verified via `32-b21-support-tenant-scoping` (7/7) |
| Onboarding | **Strong** — account-scoped by design, no cross-account leak surface found |

**No credentials were rotated, printed, or modified at any point. No real payment was executed.**
