# PRE-CREDENTIAL V1 PERFECTION — Cross-OS

**Date:** 2026-08-15 · **Branch:** `security/reality-completion`

Verifying canonical organization/workspace/RBAC context propagation through the mission's named
chain, citing prior passes' live evidence where this phase did not re-touch that surface, and
adding new live evidence only where this phase's own work bears on it.

---

## Organization → Business/Sales

**PASS, re-confirmed this phase.** `BusinessOS.jsx`'s Pipeline view (`/business/opportunities/*`)
correctly threads `req.org.id` from the canonical `organizationService.cjs` hierarchy — live
two-tenant tested this phase with real secret-labeled deals (see Security report). This is also the
real, non-duplicate replacement surface for the dead `EnterpriseCRM.jsx` mock (C10-026).

## Business/Sales → Finance

**Unaffected by this phase — cited, not re-derived.** Close-won → revenue-record linkage (C10-029's
churn/decrement path) remains covered by existing regression, untouched this phase.

## → Marketing/Growth

**Unaffected by this phase.**

## → Customer Success → Support

**Materially affected by the concurrent session's C10-012 fix, independently re-verified this
phase.** `SupportCenter.jsx` now genuinely calls `/customer-org/support/*` — confirmed via source
read (real `_fetch` calls, no `SEED_TICKETS`/`KB_ARTICLES`, honest empty/loading/no-org states). Not
re-run as a live two-tenant HTTP test this phase (the concurrent session's own live two-tenant
secret-labeled-ticket test, cited in `MASTER-OPEN-FINDINGS.md`'s C10-012 row, is accepted as
sufficient — independently corroborated via this phase's own source-level confirmation that the
fetch calls and honest states are genuinely present, not merely claimed).

## → Executive

**Unaffected by this phase — cited.** `/org-executive/:orgId/*` remains the confirmed-real,
org-scoped completion of this flow for regular org owners (established in the Ecosystem OS pass,
unaffected by anything this phase touched).

## → Developer

**Re-confirmed this phase.** `/dev/*` still correctly gated `requireAuth + attachOrg +
requireOrgMember` — live-tested with a real new repo, forged-header attempt correctly 403'd.

## → Memory

**Re-confirmed this phase (source-level).** `/coding/*` still mounts `attachOrg`;
`_missionContext(req.org?.id)` remains the real, org-scoped call site for AI mission-context
injection.

## → Knowledge

**Materially re-verified this phase.** Real secret-labeled opportunity (`ORGA-SECRET-DEAL-SPHINX`)
created via `BusinessOS.jsx`'s real backend was correctly picked up by `KnowledgeCenter.jsx`'s real
backend (`/org-graph/:orgId/index` → real graph containing the real opportunity, correctly scoped
to Org A alone) — this is genuine evidence that a real business entity (an opportunity created
through one OS) stays the same entity and is correctly tenant-scoped when it surfaces through a
completely different OS (Knowledge), not duplicated or leaked.

## → AI Workspace → Mission

**Unaffected by this phase — cited.** Credential-blocked AI provider calls remain honestly reported.

## → Automation

**Materially affected this phase (independent re-verification of a concurrent fix).** The `event`
trigger type genuinely dispatches now — live-verified via a real two-rule chain (an `emit_event`
action firing a separate `event`-trigger rule, `runCount` incrementing 0→1 with real persistence to
`data/automation-layer.json`). `manual` and `schedule` re-confirmed still working independently.
`threshold`/`webhook`/`approval` remain correctly undispatched — no fabrication, explicit
regression-test guard against inventing a scheduler/cron for them.

## → Product

**Re-confirmed this phase.** `/product-factory/*` still correctly isolated — live-tested with a
real secret-labeled plan (`gapclosure-secret-product-A`), direct-ID cross-tenant read 404, forged-
header 403.

## → Ecosystem

**Unaffected by this phase — cited.** No changes to `/dev/*`'s or `/customer-org/*`'s core gating
beyond what was already established and re-confirmed above.

---

## Where a system is intentionally platform-wide — proof and documentation

`RevenueOS.jsx`'s backend (`/revenue/*`) is deliberately `requireAuth + operatorOnly` — confirmed
via direct source read of `revenueOS.js`'s router-wide gate and its own explanatory code comment
("Platform-wide founder financial data... operator-only... Regular customers get their OWN billing
via GET /billing/status, which is correctly account-scoped"). This is why `RevenueOS.jsx` was NOT
recovered as a web tab this phase despite superficially resembling the already-recovered
`LaunchPlatform.jsx` pattern — the two differ in exactly the dimension that matters
(`operatorOnly` vs. `requireAuth`-only backend gating).

## No entity duplicated across systems to fake an integration

The real opportunity created via `BusinessOS.jsx` (`/business/opportunities/*`) is the SAME entity
(same `opp_*` ID) that appears in `KnowledgeCenter.jsx`'s graph via `/org-graph/*` — confirmed by
matching the exact ID and label across both API responses this phase. No duplicate record was
created to make the cross-OS integration appear to work.
