# PRE-CREDENTIAL V1 PERFECTION — Security

**Date:** 2026-08-15 · **Branch:** `security/reality-completion` · **Verification port:** 5233

All checks below use two real accounts/orgs created this phase (`org_1786791701677_1` /
`org_1786791701698_2`) with real secret-labeled data — never empty-vs-empty.

---

## The mission's 12 named security priorities — see Progress report for the full table

Summary: **11 of 12 re-confirmed PASS this phase; 1 (businessEventAdapter external-ingestion
identity) correctly remains an open, named, undecided item — not a regression, not silently
resolved.**

## New findings this phase

| Finding | Class | Disposition |
|---|---|---|
| `BusinessOS.jsx` rendered a fabricated-looking `Probability: undefined%` on every deal card (no backend field exists) | Honesty (not tenant-isolation) | **FIXED** — dead-field render removed |
| `RevenueOS.jsx` is a real operator-only console structurally similar to a previously-recovered web-tab pattern, but unsafe to recover the same way | Reachability / potential info-disclosure surface if mishandled | **NOT fixed — FOUNDER DECISION required before any web nav change** |

No new tenant-isolation, authentication, or authorization defect was found this phase. Every
security-sensitive surface touched by this phase's own investigation (Product OS opportunities via
`BusinessOS.jsx`'s real backend, the automation event-dispatch chain) was found already correctly
gated by the existing `attachOrg`/`requireOrgMember` or `operatorOnly` patterns.

## Automation event-loop concurrency note (not a security defect, documented for completeness)

While independently re-verifying the concurrent session's C10-007 fix, a debug-tracing session
(added temporarily to `automationService.cjs`, removed before this report was written — `git diff`
confirmed clean) revealed the real `runtimeEventBus` carries a very high volume of internal platform
events (`execution`, `orchestrator:*`, `agent:*:state`, `telemetry`, etc.) even under light test
load. This is not a security issue — the event-loop subscriber correctly processes every event
regardless of volume, and rule-matching is exact-string (`rule.trigger.eventName === evt.type`), so
there is no cross-rule or cross-tenant matching risk. It does mean a rule's fire may take longer
than a naive `sleep 1` to observe under load — a testing/observability note, not a functional or
security defect.

## Tenant isolation — full battery, real two-tenant data

| Surface | List-scoped | Direct-ID cross-tenant | Forged `X-Org-Id` | Cross-tenant write |
|---|---|---|---|---|
| `/dev/*` (Developer OS) | PASS | N/A (list confirmed empty) | 403 | Not re-tested this phase (unchanged since Ecosystem OS pass) |
| `/product-factory/*` | N/A | 404 | 403 | Not re-tested this phase (unchanged since Ecosystem OS pass) |
| `/business/opportunities/*` (via BusinessOS) | PASS | 404 | 403 | 404 (close-won blocked) |
| `/intelligence/unified/*` | N/A (single-resource endpoint) | N/A | 403 | N/A (read-only endpoint) |
| `/customer-org/*` | Not re-tested this phase | Not re-tested this phase | 403 | Not re-tested this phase |
| `/org-graph/*` (Knowledge OS) | PASS (own org's index only) | N/A | Not re-tested this phase | N/A |

## Operator vs. owner boundary

Org A's account (a real `org_owner` of its own org) was correctly blocked (`403 Forbidden —
operator access required`) from `/cbeta/billing/credits/:accountId`, a platform-operator-only route
— confirms org ownership does not imply platform operator privilege, and vice versa (established in
prior passes, unaffected by this phase's changes).

## Failure honesty

- Automation's 3 remaining non-dispatched trigger types (`threshold`/`webhook`/`approval`): no UI
  or API claims they fire; creation is honestly accepted, execution honestly never happens.
- Sentry: `captureException()` returns `{ok:false, error:"SENTRY_DSN not set"}` without a DSN — no
  fake success.
- `BusinessOS.jsx`'s `probability` fabrication-looking render: fixed by removal, not by inventing a
  fake computed value.
- AI provider calls: still honestly report `success:false` with real error text when
  credential/rate-limit blocked (unchanged, re-confirmed via existing regression).

## Regression

`npm run test:runtime`: **211/211** before and after this phase's one code change
(`BusinessOS.jsx`'s `probability` render removal — frontend-only, no backend test covers it
directly; verified instead via live HTTP + production build).

`tests/security/96-production-build-artifact-integrity.cjs` (poisoned `REACT_APP_API_URL` /
dev-bypass-flag guard): **4/4 PASS** — no loopback/dev API origin compiled into the artifact, no
debug/dev-bypass flags, single consistent main chunk.

## Process/session hygiene

- Port 5050 (Audit Track) checked before and after every process action this phase, confirmed
  healthy throughout (PID changed once between checks, consistent with its own independent
  legitimate restart — never targeted by this session).
- Port 5233 used exclusively for this phase's own isolated verification server, stopped by exact
  PID at the end.
- `.env` confirmed untouched (`git status --porcelain .env` → clean); no credential added.
- No merge, no push, no blanket `pkill`/`killall`.
