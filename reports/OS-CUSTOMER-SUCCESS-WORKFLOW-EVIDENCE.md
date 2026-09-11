# OS-CUSTOMER-SUCCESS — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5144` (dedicated Customer Success verification
instance) · **Auth:** real `POST /auth/login` sessions only — no JWT forged, no auth bypassed.

**Two real organizations** (created in the Organization OS pass, reused here):

| Org | Owner | ID |
|---|---|---|
| A | `finoa@test.local` | `org_1786718762053_1` |
| B | `finop@test.local` | `org_1786718779057_2` |

---

## Chain verified

```
Frontend (CustomerSuccessCenter.jsx, via customerOrgApi.js)
  → Express route (/customer-org/*)
  → requireAuth (cookie JWT) → attachOrg (verified org membership)
  → customerJourneyEngine.cjs / customerHealthEngine.cjs / customerSuccessEngine.cjs
  → data/customer-journeys.json + customer-health.json + customer-success-plans.json (fs, real writes)
  → JSON response
```

---

## W1 — Real journey sync (Sales/CRM → Customer Success handoff)

```json
POST /customer-org/journey/sync
→ {"ok":true,"synced":88,"byStage":{"lead":19,"qualification":56,...,"onboarding":8,"adoption":5}}
```
Sourced from `crmService.getLeads()` (68 real leads) + `revenueOS.listCustomerHealth()`. No new
customer database created — journeys read the existing CRM leads directly.

### CRM identity preserved

```
grep confirmed: 35 of 68 real CRM leads carry a real orgId field (crmService.js's own
pre-existing pattern — journeys.orgId now inherits from lead.orgId).
```

---

## THE CENTRAL FINDING — journey/health/success-plan records leaked across tenants

### Reproduction — before fix

```js
require('./backend/services/customerHealthEngine.cjs').listHealthRecords({})
```
No `orgId` parameter existed on any of the three engines' functions. Confirmed with `grep -n
"orgId"` returning **zero matches** in `customerJourneyEngine.cjs`, `customerHealthEngine.cjs`,
`customerSuccessEngine.cjs` before this pass.

### Live reproduction with two real, non-forged sessions

```
GET /customer-org/health?limit=2   (Org A owner, real membership, real Org A header)
→ {"records":[{"customerId":"919000000002",...},{"customerId":"919988776655",...}]}

GET /customer-org/health?limit=2   (Org B owner, real membership, real Org B header)
→ {"records":[{"customerId":"919000000002",...},{"customerId":"919988776655",...}]}
```
**Identical results.** Two different, real, independently-authenticated organizations received the
exact same customer health data — the same class of leak the codebase's own comment in
`customerOrg.js` documents having already fixed once for support tickets, still present on three
sibling engines.

## ROOT CAUSE — traced to source, matching a known precedent

`customerSupportEngine.listTickets()` already implements the correct pattern:
```js
function listTickets({ customerId, status, severity, limit = 50, orgId = null } = {}) {
  let tickets = _load().tickets;
  if (orgId) tickets = tickets.filter(t => t.orgId === orgId);
  ...
}
```
`customerJourneyEngine.listJourneys()`, `customerHealthEngine.listHealthRecords()`, and
`customerSuccessEngine.listPlans()` had no equivalent — the records themselves never carried an
`orgId` field to filter on.

## FIX — the exact precedented pattern, applied to all three engines

**`customerJourneyEngine.cjs`** — `_buildJourney()` now stamps `orgId: lead.orgId || null` (CRM
leads already carry this field); `getJourney(customerId, orgId)` and
`listJourneys({..., orgId})` now filter, excluding legacy null-orgId rows from scoped calls
(matching the tickets precedent exactly, not misattributing them).

**`customerHealthEngine.cjs`** — `scoreCustomer()` inherits `orgId` from the matching CRM lead;
`getHealthRecord(customerId, orgId)` and `listHealthRecords({..., orgId})` now filter identically.

**`customerSuccessEngine.cjs`** — `generateSuccessPlan()` inherits `orgId` from the health record
(this function doesn't read a lead directly); `getPlan(customerId, orgId)` and
`listPlans({..., orgId})` now filter identically.

**`customerOrg.js`** — every affected route now passes `_orgId(req)` through, the same helper
already used for ticket routes.

## Negative tests (isolated, before touching HTTP)

```
T1 stage-only filter (was broken - would return 0): 3 (expect 3)         PASS
T2 orgId scoping - OrgA only: [c1,c3] (expect c1,c3)                     PASS
T3 orgId scoping - OrgB only: [c2] (expect c2)                           PASS
T4 legacy null-org excluded from OrgA scoped call: false (expect false)  PASS
T5 unscoped call (internal use) still sees everything: 4 (expect 4)      PASS
T6 combined stage+churnRisk: [c3] (expect c3)                            PASS
```
All 6 cases pass — the fix is correct in isolation before any live request was made.

## Live re-verification — direct-ID access, two real organizations

A real journey record (`919999999999`, a genuine customer in `data/customer-journeys.json`) was
tagged with Org A's real id to create a controlled test:

```
GET /customer-org/journey/919999999999   (Org A owner, real session)
→ 200  {"journey":{"customerId":"919999999999",...}}

GET /customer-org/journey/919999999999   (Org B owner, real session — the SAME customer)
→ 404  {"error":"journey not found"}
```

## Live re-verification — list endpoint, two real organizations

```
GET /customer-org/journey?limit=200   (Org A)
→ OrgA sees 919999999999: True | total visible: 1

GET /customer-org/journey?limit=200   (Org B)
→ OrgB sees 919999999999: False | total visible: 0
```
Org B correctly sees **zero** records — not just the one tagged to Org A, but none of the other
67 legacy null-orgId records either, because the scoped call now correctly excludes unowned rows.

## Live re-verification — health records (independently re-scored, not reusing journey's tag)

```
POST /customer-org/health/score-all   (re-scores all 88 customers with the fix active)
→ {"scored":88,"atRisk":49}

[health record for 919999999999 tagged Org A directly, matching the journey test]

GET /customer-org/health/919999999999   (Org A) → 200, real record
GET /customer-org/health/919999999999   (Org B) → 404 "health record not found"

GET /customer-org/health?limit=200   (Org A) → 1 record
GET /customer-org/health?limit=200   (Org B) → 0 records, 919999999999 absent
```

## Live re-verification — success plans (generated fresh, inheriting orgId from health)

```
POST /customer-org/success/plan/919999999999   (Org A)
→ 200  {"plan":{"customerId":"919999999999","orgId":"org_1786718762053_1",...}}

GET /customer-org/success/plan/919999999999   (Org A) → 200, real plan
GET /customer-org/success/plan/919999999999   (Org B) → 404 "plan not found"

GET /customer-org/success/plans?limit=200   (Org A) → 1 plan
GET /customer-org/success/plans?limit=200   (Org B) → 0 plans
```

**All three engines confirmed correctly isolated, end to end, with real customer data and two real
organizations.**

---

## Onboarding — real, exercisable workflow (not UI mock data)

```json
GET /launch/onboarding/roles
→ {"roles":[{"id":"developer",...},{"id":"founder",...}]}

POST /launch/onboarding/start   {"role":"founder"}
→ {"state":{"accountId":"...","roleId":"founder","completed":false,
    "steps":[{"id":"mission","label":"Define your first product Mission","done":false},...]}}

POST /launch/onboarding/step/mission
→ {"state":{...,"steps":[{"id":"mission","done":true,"doneAt":"2026-08-14T16:27:01.700Z"},...]}}
```
Real step completion with a real timestamp — not a static mock.

---

## Finance integration (renewal prediction — no real payment executed)

```json
POST /customer-org/success/predict/919999999999
→ {"churn":{"probability":0.3,"severity":"medium","timeframe":"90 days"},
   "expansion":{"probability":0.15,"upsellSignal":"not_ready"},
   "renewal":{"probability":0.65,"daysToRenewal":90,"renewalDate":null,...}}
```
Sourced from `revenueOS.cjs` (`_rev().getCustomerHealth()`), the same service independently
verified real in the Finance OS pass. **No Razorpay credential touched, no payment executed.**

---

## OPERATIONAL FINDING — accidental cross-file middleware blocks legitimate access

`security.js`'s unscoped `router.use(requireWorkspaceMember)` (documented as accidentally
*protecting* `governance.js` in the Organization OS pass) here **blocks** legitimate
`/customer-org/*` and `/launch/onboarding/*` requests:

```
GET /launch/onboarding/roles   (Org A owner, real Org membership, no Workspace header)
→ 403  {"error":"Not a member of this workspace"}

GET /launch/onboarding/roles   (same user, WITH a real Workspace header they happen to hold)
→ 200  {"roles":[...]}
```

Verified this is **not** a security bypass — the leaked gate genuinely validates real workspace
membership and cannot be spoofed:
```
GET /customer-org/journey   (Org A owner + FORGED x-workspace-id to a workspace they don't own)
→ 403  "Not a member of this workspace"   (still correctly rejected)
```

**Not fixed this pass.** The root cause lives in `security.js`, outside Customer Success OS's file
scope, and the mission's fix policy directs documenting rather than redesigning shared
infrastructure during this pass. See Final report's Remaining Limitations.

---

## Process management (lessons applied from prior passes)

Two server processes were spawned by this session's own background-launch pattern (a known
environmental behavior, first documented in the Mission OS pass). Both were identified precisely
via `lsof -p <pid> | grep LISTEN` before any action was taken; only the process **not** bound to
port 5144 was killed. The Audit Track's own concurrent server (port 5050) was checked via
`lsof -ti:5050` and confirmed untouched throughout.

---

## Persistence — verified across a real restart

```
Before restart: 18 journeys with real orgId
[server killed, restarted clean]
After restart:  18 journeys with real orgId (0 lost)
Health records: 69 (unchanged)
```

---

## Build

```
CI=false npm run build
→ succeeds
```
B.23 artifact-integrity guard (from the Developer OS pass) unmodified and unaffected — no frontend
file was changed this pass.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** (baseline and final) |
| `tests/runtime/p11-customer-org.test.cjs` | 75/76 — the 1 failure (`customerAutomationEngine` follow-up trigger) confirmed **pre-existing** via clean-tree stash test |
| `tests/runtime/32-b21-support-tenant-scoping.test.cjs` | **7/7** |
| `tests/runtime/21-support-ownership-lifecycle.test.cjs` | **15/15** |
| `tests/runtime/22-customer-ops-integrity.test.cjs` | **15/15** |
| `tests/security/88-launch-integrations-support-customer-success-ux-consistency.cjs` | **22/22** (6 live-only checks skipped due to an unrelated expired saved JWT, unaffected by this pass) |

No test was modified, skipped, or weakened.
