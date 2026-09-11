# CUSTOMER-REACHABLE API / DATA-ACCESS BOUNDARY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

Bounded audit of remaining customer-reachable API/data-access surfaces after the prior Execution &
Tool Authorization Boundary Sweep. Built a risk-ranked inventory across `business.js`, `analytics.js`,
`customerOrg.js`, `crm.js`, `graph.js`, `exportFiles.js`, `distribution.js`, `organizations.js`,
`integrations.js`, `codingAssistant.js`, and their real service-layer caller chains, excluding
surfaces already certified in prior missions.

## Genuine Vulnerabilities Found — 2 P1 IDOR families, both proven live, plus 1 functional bug
discovered and fixed as a direct consequence of one of the P1 fixes

**1. `business.js`'s mission-layer alias routes — cross-tenant read/write via unverified org
resolution (P1).** 9 routes (`GET`/`POST /business/deals`, `/marketing/tasks`, `/customers`,
`/operations`, plus `GET /business/pipeline/:entityType` and `GET /business/automation/status/
:missionId`) ran on `requireAuth` only — never composing `_requireOrg`/`requireOrgMember`, unlike
every sibling CRM route in the same file. `attachOrg` resolves `req.org` from a caller-suppliable
`X-Org-Id` header via an unauthenticated `getOrg(orgId)` lookup (no membership check — that's
`requireOrgMember`'s job, which these routes skipped). Live-reproduced: a fresh customer account B,
with zero relation to org A, sent `X-Org-Id: <org A's real id>` to `GET /business/deals` and received
org A's real deal record (created moments earlier with a unique marker) verbatim, `HTTP 200`.
Worse, `GET /business/pipeline/:entityType` never used `orgId` at all — org B received org A's real
deal with **no header forgery required**, by simply calling the route normally.

**2. `customerOrg.js`'s customerId-keyed routes — cross-tenant read/write despite router-level org
membership (P1).** The router already required real org membership (`requireOrgMember`) before any
handler runs — but 7 routes (`journey/:customerId/advance`, `health/score/:customerId`, `health/
:customerId/history`, `health/:customerId/trend`, `success/plan/:customerId`, `success/predict/
:customerId`) never checked whether the *specific* `customerId` in the URL actually belonged to the
caller's *own* verified org — only that the caller belonged to *some* org. Live-reproduced: customer
B correctly denied on write/read via `404` after the fix; before the fix, B could rescore org A's
real customer, read A's real churn/renewal/NPS predictions, and advance A's customer's lifecycle
stage.

**3. Functional bug in `customerHealthEngine.cjs`'s lead-matching, discovered while fixing #2 (not
independently security-relevant, but directly interacted with the fix above).** `scoreCustomer()`
matched `(l.userId || l.phone || l.chatId) === customerId` — a first-truthy-field pattern that only
ever compares `customerId` against whichever field is truthy *first* per lead, not against all three
independently. Every lead created through the real product route (`POST /crm/lead`) carries a real
`userId` (the caller's account id) alongside its phone, so `scoreCustomer(phone)` for a real customer
silently never matched its own lead — `orgId` stayed permanently `null`. Combined with the new
ownership check in #2 (record orgId must match caller orgId), this would have wrongly rejected the
*legitimate* owner too, since `null` never equals a real orgId. Caught during live verification of
the P1 fix, not filed as a separate finding — fixed as part of the same change since leaving it would
have broken the audited feature for every real customer.

## Fixes

All reuse existing, already-established mechanisms — no new authorization framework:

1. `backend/routes/business.js` — added `_requireOrg` (the file's own existing `requireOrgMember`
   wrapper) to all 9 previously-ungated routes; changed `req.org?.id || null` to `req.org.id`
   (now guaranteed non-null post-gate) throughout. `automation/status/:missionId` additionally
   checks the target mission's own stored `orgId` (via `missionMemory.cjs`'s existing `getMission()`)
   before returning execution status.
2. `backend/routes/analytics.js` — added `requireWorkspaceMember` (the same middleware `workspace.js`
   already uses) to all 7 workspace-scoped routes (`executive`, `workspace`, `productivity`,
   `automation`, `security`, `governance`, `runtime`, `reports`).
3. `backend/routes/customerOrg.js` — threaded `_orgId(req)` (the file's own existing helper) through
   `advanceStage`/`getHealthHistory`/`getHealthTrend`; added existing-record ownership pre-checks
   (via `getHealthRecord`/`getPlan` called with no orgId, then comparing) for `health/score`,
   `success/plan`, and `success/predict`, since those service functions auto-attribute `orgId` from
   the matching CRM lead by design and can't take a caller-supplied value directly.
4. `backend/services/customerJourneyEngine.cjs` — `advanceStage()` gained an optional `orgId`
   parameter, matching the file's own existing `getJourney()` convention.
5. `backend/services/customerHealthEngine.cjs` — `getHealthHistory()`/`getHealthTrend()` gained an
   optional `orgId` parameter; `scoreCustomer()`'s lead-matching fixed to check `userId`/`phone`/
   `chatId` independently instead of the first-truthy-field shape.

## Live Verification

Full HTTP chain verified against the restarted production server with two freshly registered
ordinary customer accounts:
- **business.js**: A creates a real deal; B forging `X-Org-Id` to A's org receives `403 "Not a member
  of this organization"` (was `200` with A's real data); A's own access and `GET /business/pipeline/
  deal` no longer leak A's deal to B by default.
- **customerOrg.js**: A seeds a real CRM lead + scores it (record correctly carries A's real `orgId`
  after the matching-logic fix); B's rescore/history/trend/predict attempts against that same
  `customerId` all correctly return `404`; A's own read access remains functional (`200`).
- **analytics.js**: A's own `/analytics/security` returns `200`; B supplying A's real workspaceId as
  a query param is rejected (`403 "Not a member of this workspace"`, was `200`).

## Limitations

- `graph.js`'s `/graph/index*` mutation routes and `/graph/reasoning*` aggregate-data routes were
  identified as lower-confidence P2 candidates (platform-wide, no direct named-record exposure) but
  not fixed this mission — flagged for a future targeted pass if warranted.
- `businessDataService.cjs`'s `F_LEADS` store and `crmService.js`'s lead store are confirmed to be
  two entirely separate, non-synchronized data stores sharing similar shapes — a pre-existing
  architectural inconsistency discovered during live verification (not a security defect; `/business/
  leads` writes are correctly org-scoped in their own store) but worth a future consolidation pass.
- Security suite (`97-enterprise-isolation-integrity.cjs`) required waiting out this environment's
  shared 5-registrations/15-minute rate limit (consumed by this mission's own live verification and
  the regression suite's account creation) before it could run — an environment condition, not a
  product failure; documented and waited out rather than skipped.

## Regression

**Before:** 412/412. **After:** 419/420 in the full concurrent run (1 failure = the pre-existing,
session-documented `133-master-audit-stale-active-mission-recovery` timing flake, unrelated to any
change this mission — re-confirmed 3/3 passing cleanly in isolation). **New tests:** 8 (block 162) —
4 structural + 4 live/unit, covering all 3 route-file fixes, the matching-logic fix, and the full
real HTTP chain with two independent customer accounts. **Negative-tested**: reverted one
representative fix per file (business.js's `/business/deals` gate, analytics.js's `/analytics/
security` gate, customerOrg.js's `health/score` ownership check, customerHealthEngine.cjs's matching
fix), confirmed exactly the 5 dependent tests failed for the expected reasons while the 3 independent
tests (customerOrg.js's other routes, customerJourneyEngine's advanceStage, getHealthHistory/Trend)
correctly still passed, restored, confirmed all 8 passed again.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting
out the shared registration rate-limit window).
**Server:** restarted twice (once for the initial fix set, once after the matching-logic bug was
found and fixed mid-verification — both required since these are `require()`-cached Express route/
service modules), confirmed healthy after each restart.
**`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working tree preserved
throughout (confirmed via `git status` before and after).

**No OS-track record altered.**
