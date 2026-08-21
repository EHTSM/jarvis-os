# C.10 — CROSS-SYSTEM WORKFLOW EVIDENCE

Date: 2026-08-14/15 · Branch: `security/reality-completion`

Raw measured evidence from the live, authenticated server with two real test tenants.

---

## Setup

```
accountA: 77483981d0f5bf2578d53a40 (c10orga_1786740067@test.local)
accountB: 786e0eaafc7e3bd474238347 (c10orgb_1786740067@test.local)
orgA:     org_1786740067275_1 (C10-OrgA-1786740067)
orgB:     org_1786740067291_2 (C10-OrgB-1786740067)
Both created via real accountService/organizationService functions, logged in via real /auth/login.
```

## Flow 1 — Lead → Qualification → Opportunity → Close-Won → Revenue

```
POST /crm/lead (Org A)
  -> {"success":true,"lead":{"phone":"919999000111","orgId":"org_...275_1",...}}

POST /business/leads (Org A) — a SEPARATE store from /crm/lead, confirmed by code read
  -> {"success":true,"lead":{"id":"lead_...b56720","status":"new","orgId":"org_...275_1"}}

POST /business/leads/lead_...b56720/qualify
  -> {"success":true,"lead":{...,"status":"qualified","qualifiedAt":"..."}}

POST /business/opportunities {"title":"C10-FLOW1-OPP","value":50000,"leadId":"lead_...b56720"}
  -> {"success":true,"opportunity":{"id":"opp_...b0f91c","stage":"qualified","value":50000,"orgId":"org_...275_1"}}

POST /business/opportunities/opp_...b0f91c/close-won
  -> {"success":true,"opportunity":{...,"stage":"closed-won","history":[{"from":"qualified","to":"closed-won",...}],
                                     "closedAt":"...","closedWonAt":"..."}}

GET /business/revenue (Org A)
  -> {"success":true,"revenue":[{"id":"rev_...fc71bf","amount":50000,"source":"opportunity-close-won",
                                  "oppId":"opp_...b0f91c","orgId":"org_...275_1"}],"total":1}

GET /business/revenue/stats
  -> {"success":true,"total":50000,"count":1,"byType":{"one-time":50000},"bySource":{"opportunity-close-won":50000}}

GET /business/dashboard
  -> {"success":true,"leads":{"total":2,"qualified":1},"opportunities":{"total":1,"wonThisMonth":1},
      "revenue":{"total":50000,"count":1}}
```

**Real, correctly-linked, automatic revenue generation on close-won — confirmed genuine, not fabricated.** All figures consistent across `/business/revenue`, `/business/revenue/stats`, and `/business/dashboard`.

```
GET /eos/v6/dashboard (Org A, a real org owner, not a platform operator)
  -> HTTP 403 {"error":"Forbidden — operator access required"}
```
**Confirms the Flow 1 gap precisely**: there is no path for the org that generated this $50,000 in real revenue to see it reflected in "Executive OS" — that surface is a separate, platform-wide, operator-only system, not a reconciliation layer over Business OS.

## Flow 2 — CRM identity → Campaign → Delivery (honest failure)

```
POST /growth/email/campaigns {"name":"C10-FLOW2-CAMPAIGN","subject":"Test","body":"Hello"}
  -> {"ok":true,"campaign":{"id":"ecm-...537rn","status":"draft","orgId":"org_...275_1",...}}

POST /growth/email/campaigns/ecm-...537rn/send
  -> HTTP 400 {"error":"Email campaign sending is not available: CRM leads in this deployment have
                no email address field (phone/WhatsApp-first CRM), so there is no real recipient
                list to send to. Configure a real audience with real email addresses via
                /growth/audiences to enable sending."}
```
**A real, structurally accurate, honest failure** — not a fake "sent" success. The explanation is specific to this product's actual CRM design (phone-first), not a generic error.

## Flow 3 — Customer → Support → Escalation (tenant isolation, live-verified)

```
POST /customer-org/support/ticket (Org A) {"customerId":"c10-cust-A","subject":"C10-FLOW3-TICKET","severity":"high"}
  -> {"ok":true,"ticket":{"id":"cst_...t1hx","orgId":"org_...275_1","status":"open",...}}

GET /customer-org/support/ticket/cst_...t1hx (Org B)
  -> HTTP 404 {"error":"ticket not found"}          <- correctly blocked (read)

POST /customer-org/support/ticket/cst_...t1hx/resolve (Org B) {"resolution":"forged by Org B"}
  -> HTTP 404 {"error":"ticket not found"}          <- correctly blocked (write)
     NOTE: an in-file comment claimed this write route "never got the same guard" as the read
     route. Live testing proves the code below that comment DOES independently check
     existing.orgId !== org — the comment is a stale description of a PRIOR state, not the
     current one. Reclassified FIXED, not TRUE, based on live evidence overriding the comment.

POST /customer-org/support/ticket/cst_...t1hx/resolve (Org A, real owner)
  -> HTTP 200 {"ok":true,"ticket":{...,"status":"resolved","resolution":"resolved by real owner",...}}

GET /customer-org/support/tickets?limit=-1 (Org A)      -> correctly clamped, 1 real ticket returned
GET /customer-org/support/tickets?limit=99999 (Org A)    -> correctly clamped, 1 real ticket returned
```

## Flow 7 — Organization → Department → Permissions (tenant isolation + forged headers)

```
POST /orgs/org_...275_1/departments (Org A) {"name":"C10-FLOW7-DEPT"}
  -> {"ok":true,"department":{"id":"dept_...","name":"C10-FLOW7-DEPT"}}

GET /orgs/org_...275_1/departments (Org B, direct ID, no membership)
  -> HTTP 403 {"error":"Forbidden — requires permission: view_departments"}

POST /orgs/org_...275_1/departments (Org B, direct ID, attempting a write)
  -> HTTP 403 {"error":"Forbidden — requires permission: manage_departments"}

GET /orgs/me/context (Org B, WITH a forged X-Org-Id: <org-A-id> header)
  -> HTTP 200 {"primaryOrg":{"orgId":"org_...291_2",...}}   <- Org B's OWN data, header had no effect
```

## Persistence / restart

```
Before restart — recorded state:
  Lead: lead_...b56720, status=qualified
  Opportunity: opp_...b0f91c, stage=closed-won, value=50000
  Revenue: total=1
  Department: dept_..., name=C10-FLOW7-DEPT
  Support ticket: cst_...t1hx, status=resolved
  Campaign: ecm-...537rn

Server restarted (real process kill + real node backend/server.js relaunch).

After restart — same queries:
  Lead:        IDENTICAL
  Opportunity: IDENTICAL (stage=closed-won, value=50000 — no drift, no duplication)
  Revenue:     IDENTICAL (total=1)
  Department:  IDENTICAL
  Support ticket: IDENTICAL (status=resolved)
```
**PASS — full cross-OS persistence integrity across a real backend restart**, repeated a second time later in the session (after the security fixes) with the same result.

## P0 #1 — `/dev/*` fully unauthenticated (found, fixed, live-verified)

```
BEFORE FIX:
curl -X POST /dev/repos -d '{"name":"C10-UNAUTH-TEST-REPO"}'   (NO cookie, NO auth header at all)
  -> HTTP 201 {"success":true,"repo":{"repoId":"repo_...","name":"C10-UNAUTH-TEST-REPO",...}}

curl /dev/repos   (NO auth)
  -> HTTP 200 — full global repo list including real entries: jarvis-core, jarvis-ui, jarvis-mobile,
     real remote URLs, real language/status/tag metadata

Confirmed 36 total /dev/* routes, 0 behind any auth gate — including DELETE /dev/issues/:id and
POST /dev/deployments/:id/rollback.

FIX: router.use("/dev", requireAuth) added, registered before the first /dev route handler.

AFTER FIX:
curl /dev/repos (no auth)          -> HTTP 401 {"error":"Unauthorized"}
curl -b cookiesA.txt /dev/repos    -> HTTP 200, real data (legitimate access preserved)
curl -b cookiesB.txt /dev/repos    -> HTTP 200, SAME data as Org A sees (documented remaining gap:
                                       developerOS.cjs has zero orgId concept — auth fix closes the
                                       "anyone on the internet" hole, does not close cross-tenant
                                       visibility among authenticated users)
```

## P0 #2 — `/cbeta/billing/*` cross-account IDOR (found, fixed, live-verified)

```
BEFORE FIX:
curl -b cookiesB.txt /cbeta/billing/credits/<accountA-real-id>
  -> HTTP 200 {"ok":true,"balanceINR":0,"history":[]}     <- Org B reads Org A's real billing record

curl -b cookiesB.txt -X POST /cbeta/billing/credits
  -d '{"accountId":"<accountA-real-id>","amountINR":99999,"reason":"C10-FORGED-CREDIT-BY-ORGB"}'
  -> HTTP 200 {"ok":true,"accountId":"<accountA-real-id>","newBalance":99999}

curl -b cookiesA.txt /cbeta/billing/credits/<accountA-real-id>   (confirm it landed for real)
  -> HTTP 200 {"ok":true,"balanceINR":99999,"history":[{"reason":"C10-FORGED-CREDIT-BY-ORGB",...}]}

Confirmed: a real, unrelated authenticated account forged a ₹99,999 credit onto another real
account's billing record, and it persisted. Not a read-only leak — a write-side financial
record corruption.

FIX: operatorOnly gate added to /cbeta/billing/{downgrade,payment-failure,retry-queue,
process-retries,invoices,credits,coupons/apply} — these are internal beta-ops billing-management
tools where accepting a target accountId is intentional (an operator managing another user's
billing), so the fix is restricting WHO may specify someone else's accountId, not removing the
parameter. Left ungated: /cbeta/billing/coupons (list/create) and /coupons/validate — these do
not accept a target accountId and are a separate, lower-severity concern not addressed here.

AFTER FIX:
curl -b cookiesB.txt /cbeta/billing/credits/<accountA-real-id>
  -> HTTP 403 {"error":"Forbidden — operator access required"}
curl -b cookiesB.txt -X POST /cbeta/billing/credits -d '{"accountId":"<accountA-real-id>",...}'
  -> HTTP 403 {"error":"Forbidden — operator access required"}
```
The earlier forged ₹99,999 test record remains in the disposable test account's data (not real production data — both accounts are C.10's own throwaway test fixtures) and needed no separate cleanup.

## Regression

```
npm run test:runtime (pre-C.10): 176/176
npm run test:runtime (post both C.10 fixes): 181/181, 0 fail, 0 skipped
New file: tests/runtime/10-c10-cross-system-closure.test.cjs (5 new tests)
  - /dev/* requireAuth gate presence + ordering
  - developerOS.cjs still has no orgId (documents the remaining gap, doesn't let it be silently "fixed")
  - business.js close-won -> revenue linkage stays present (Flow 1 regression guard)
  - customerOrg.js resolve route keeps its independent ownership check (Flow 3 regression guard)
  - closedBeta.js operatorOnly gate covers all accountId-accepting billing routes, before the handlers

Negative-test self-check: both fixes independently reverted, confirmed the new tests catch each
regression with the expected failure message, then restored. Final run: 181/181 clean.
```
