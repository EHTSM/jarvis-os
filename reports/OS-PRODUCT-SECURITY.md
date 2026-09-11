# OS-PRODUCT — SECURITY REPORT

**Date:** 2026-08-15 · **Server:** `localhost:5210` (isolated verification server, this session's
own process) · **Audit Track's own server (port 5050) confirmed running throughout — including
through its own legitimate self-initiated restarts, each independently verified healthy before this
session continued. No action targeting port 5050 or any of its PIDs was ever issued by this
session.**

No JWT was ever forged. No authentication middleware was ever bypassed or disabled. No credentials
were guessed or invented. `.env` was never modified. Real, uniquely-identifiable knowledge (real
product plans named `PRODUCT-A-<unique>`/`PRODUCT-B-<unique>`) was populated on both tenants before
any isolation conclusion was drawn — never empty-vs-empty.

---

## 1. Unauthenticated access

| Endpoint | Method | Result |
|---|---|---|
| `/product-factory/plans` | GET | **401** |
| `/product-factory/plan` | POST | **401** |
| `/product-factory/arch/:planId` | POST | **401** |

All tested endpoints correctly reject unauthenticated requests, confirmed via the path-scoped
`router.use("/product-factory", requireAuth)` registration in `routes/index.js` — this is the
**correct, non-leaky pattern** (a real path argument, not the bare unscoped-middleware pattern that
caused the recurring accidental-authorization defect found in 5 prior OS passes). This route's own
authentication does not rely on any other file's accident.

---

## 2. THE CENTRAL FINDING — Product OS has no tenant model at all (GENUINE GAP, not fixed)

### Severity and reproduction

Live-reproduced with two real accounts/orgs and real, distinguishable secret-labeled data:

| Test | Actor | Target | Result |
|---|---|---|---|
| Read product by direct ID | B (own org, zero relationship to A) | A's real plan | **200 — full data, including `PRODUCT-A-f83a21` secret string** |
| List all products | B | platform-wide | **200 — 50 plans returned: A's, B's, and every historical test plan on the entire platform** |
| **Write** — run architecture design | B | A's plan | **200 — B genuinely executed a real write operation against A's resource, not merely a read** |
| Dashboard product view | B | A's plan | **200 — full cross-tenant dashboard data** |
| Roadmap access | N/A | — | No per-product roadmap exists; the plan's own `roadmap` field is part of the same unscoped record |
| Release data access | (same pattern, not separately re-tested — identical route shape) | — | Same class of exposure confirmed by architecture, not independently re-verified per-endpoint given the root cause is identical across all 5 sub-resources |
| Forged `X-Org-Id` header | B | — | No effect either way — there is no org check anywhere to forge past; the header is simply irrelevant, not "bypassed" |

### Root cause

Confirmed by direct code inspection of all 6 backend files
(`productPlannerEngine.cjs`, `productArchitectureEngine.cjs`, `productAssemblyEngine.cjs`,
`productValidationEngine.cjs`, `productReleaseEngine.cjs`, `productFactoryDashboard.cjs`) and the
route file (`productFactory.js`): **zero `orgId`/`workspaceId`/`accountId` fields exist anywhere in
the data model.** Every list/get/create function operates on the full, flat, platform-wide record
set with no filtering parameter of any kind. This is not an accidentally-missing check on an
otherwise-scoped system (the pattern behind 5 prior OS passes' findings) — there is no tenant
concept in this system's design at all, architecturally identical to `/ako/*`, `/knowledge-net/*`,
and Company Factory (all confirmed platform-wide-by-design in prior OS passes), except that this
system is the one actually surfaced to every ordinary user via a real, wired, production UI tab.

### Why this is documented, not fixed

Per the mission's own explicit fix policy: *"If a capability is genuinely absent and requires broad
architecture: document it as a genuine gap... Do not turn Product OS into a new architecture
project."* Retrofitting real tenant isolation here would require:
1. Adding an `orgId` field to every record type across 6 services.
2. Threading the requesting account's real org through every route handler (currently none of them
   even resolve `req.org`).
3. A data-migration decision for the dozens of pre-existing, already-unowned plans/architectures/
   assemblies/validations/releases already in `data/product-*.json` (created across many prior
   sessions before any tenant concept existed).
4. Deciding the correct interaction with the platform-wide "autonomous factory" framing the UI
   itself uses (`ProductOSCenter.jsx`'s own copy: "Product plans, requirements, roadmaps and
   release planning") — is this meant to be a shared company-wide product board, or per-tenant? That
   product decision is out of this pass's authority to make unilaterally via a schema change.

This is a genuine, serious, real finding — not minimized — but it is architectural, not a bug, and
the user was consulted on this exact tradeoff before this pass proceeded (documented in this pass's
own working record): document honestly and certify the rest of the system on its own merits, rather
than attempt a broad schema migration mid-pass.

---

## 3. Authorization model verification

| Role | Verified | Result |
|---|---|---|
| Unauthenticated | Yes | 401 across all tested endpoints |
| Ordinary authenticated user | Yes | Full read+write access to every record platform-wide (the finding above) |
| Org owner vs. platform operator | **N/A to this system** | No role or org-permission check exists anywhere in Product Factory routes to distinguish these — confirmed absence, not a bypass |

No membership can be "forged" here because no membership check exists to forge past — this is
distinct from (and more severe in architecture, though not necessarily in immediate real-world
sensitivity, since product plans are less inherently sensitive than e.g. CRM lead PII) the header-
forgery-defeats-a-real-check pattern found and fixed in prior OS passes.

---

## 4. Two real, fixed fake-success defects (see Workflow Evidence for full reproduction)

### PROD-1 — assembly mission/workforce integration silently broken

`productAssemblyEngine.cjs` read wrong field names from two genuinely-succeeding calls
(`workforceManager.runMission()`, `missionOrchestrator.createManual()`), and a third call
(`companyLifecycleEngine.createCompany()`) failed deterministically every time due to a missing
required field — all three silently absorbed into an unconditional `status:"completed"`. **Fixed**:
corrected field reads, surfaced real failures as explicit `*CreationError` fields, made overall
`status` honestly reflect per-stage failure (`completed_with_errors`). Negative-tested (static
assertions confirmed failing pre-fix) and live-verified (real `msn_*`/`wf_*` ids now captured).

### PROD-2 — validation fallback scores indistinguishable from real measurement

All 6 validation dimensions silently fall back to a hardcoded, always-passing score when their real
underlying service is unavailable; `productionReady` never accounted for whether any real check
actually ran. **Fixed**: added `measuredDimensions`/`totalDimensions`, gated `productionReady` on
at least one real measurement having occurred (the explicit, disclosed `skipExecute` mock-preview
path is intentionally exempt). Negative-tested and live-verified (5/6 real, 1/6 genuine fallback,
correctly distinguished).

---

## 5. Mission/Knowledge/Memory context leakage

- **Mission context leakage:** N/A — no cross-tenant mission read path exists from Product OS (the
  one real mission-creation integration is write-only, from Product into Mission Orchestrator, now
  correctly captured after PROD-1's fix).
- **Knowledge context leakage:** N/A — no integration exists to leak through (confirmed absent, see
  Discovery report).
- **Memory context leakage:** N/A — same, no integration exists.

---

## 6. Summary

| Category | Result |
|---|---|
| Unauthenticated access | 0 leaks / 3 tested — correctly gated |
| Cross-tenant isolation | **Total absence confirmed — genuine architectural gap, documented not fixed** |
| Fake-success defects | 2 found, both fixed, negative-tested, live-verified |
| Forged headers | N/A — no check exists to bypass |
| Data integrity | Unaffected by testing (no destructive test performed given the documented gap) |

**Tenant isolation: 0/5 discrete boundary categories pass** (read, list, write, dashboard, and
implicitly release/roadmap access all cross tenants freely) — this is the honest result of a real
architectural gap, reported plainly rather than minimized or silently worked around.
