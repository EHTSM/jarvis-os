# OS-PRODUCT — DISCOVERY REPORT

**Track:** OOPLIX OS #16 — Product OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new product platform was built.**
**Isolation:** Verification server on **port 5210**. The concurrent Audit Track's own server (port
5050) was checked before and after every process action this pass — confirmed running throughout,
including through its own legitimate self-initiated restarts.

---

## 1. What "Product OS" actually is in this codebase

Confirmed via the frontend, not guessed: `ProductOSCenter.jsx` (a real, wired UI component, lazily
loaded in `App.jsx` under the `productos` tab) defines Product OS as the composition of two
separate real backend systems:

| System | Route prefix | Role |
|---|---|---|
| **Product Factory** (POST-Ω P12) | `/product-factory/*` | Plan → architecture → assembly → validation → release pipeline, given a text objective |
| **Engineering Org V2** | `/engorg/v2/*` | Objectives → epics → work items → blockers backlog |

Both were previously fully built with real persisted data but had **zero frontend consumers**
until a prior "A.8.3 recovery" mission wired them — confirmed by that mission's own comments still
present in `productFactoryApi.js`/`engOrgApi.js`/`ProductOSCenter.jsx`. This pass independently
re-verified those wired calls are still real and functional, not re-derived from the comments alone.

## 2. Backend inventory

| File | Lines | Role |
|---|---:|---|
| `backend/routes/productFactory.js` | 238 | `/product-factory/*` — plan/arch/assembly/validation/release/dashboard/pipeline |
| `backend/services/productPlannerEngine.cjs` | 267 | Requirements derivation, complexity scoring, roadmap generation |
| `backend/services/productArchitectureEngine.cjs` | 233 | Architecture design, service reuse suggestions |
| `backend/services/productAssemblyEngine.cjs` | 217 (+~35 this pass's fixes) | Coordinates workforce/mission/company assembly stages |
| `backend/services/productValidationEngine.cjs` | 278 (+~12 this pass's fix) | 6-dimension production-readiness scoring |
| `backend/services/productReleaseEngine.cjs` | 254 | Release notes, deployment plan, rollback plan generation |
| `backend/services/productFactoryDashboard.cjs` | 290 | Composite dashboard/health view |
| `backend/routes/engineeringOrg.js` | — | `/engorg/v2/*` — objectives/epics/work-items/blockers |
| `backend/services/feedbackHub.cjs` | 105 | Separate: real customer feedback → platform-wide roadmap (bug/feature/improvement, voting) |
| `frontend/src/components/ProductOSCenter.jsx` | 227 | The real, wired UI |
| `frontend/src/productFactoryApi.js` / `engOrgApi.js` | 38 / — | Real API clients |

## 3. The critical architectural finding — zero tenant model, anywhere

Confirmed by direct code inspection, not assumed: **no `orgId`, `workspaceId`, or `accountId` field
exists on any record in any of the 6 Product Factory services**, and none in `engineeringOrgState.cjs`
either (the same architecture class as `/ako/*`, `/knowledge-net/*`, and Company Factory found in
prior OS passes — a genuinely platform-wide simulation, not a per-tenant system). Unlike those
other systems, however, `/product-factory/*` and `/engorg/v2/*` are the ones actually surfaced to
**every ordinary authenticated user** via a real, wired, production-listed UI tab — not an
admin-only or clearly-labeled "platform simulation" surface.

Live-reproduced with two real accounts/orgs (see Security report for full detail): account B, with
no relationship whatsoever to account A's organization, could list every plan on the platform
(including A's, plus dozens of historical test plans from prior sessions), read A's plan by direct
ID in full, and — critically — **successfully run a real architecture-design write operation
against A's plan**.

**This is not a narrow IDOR bug to patch.** There is no tenant field to filter by; adding one would
mean a real schema change across 6 services plus a data-migration decision for the dozens of
pre-existing unowned records already in `data/product-*.json`. Per the mission's own fix policy
("if a capability is genuinely absent and requires broad architecture: document it as a genuine
gap... do not turn Product OS into a new architecture project"), this is documented as the primary,
unfixed genuine gap in the Security and Final reports rather than attempted as an in-pass schema
migration.

## 4. Real defects found and fixed (in-scope, minimal, not architectural)

Two genuine, live-reproduced fake-success defects were found and fixed in
`productAssemblyEngine.cjs` and `productValidationEngine.cjs` — both are field-mismatch/silent-
fallback bugs against already-real underlying services, not tenant-architecture issues, and both
are squarely inside this pass's minimal-recovery mandate:

1. **`productAssemblyEngine.cjs` read the wrong field names from two genuinely-succeeding calls**
   (`workforceManager.runMission()`'s real `id` field read as a nonexistent `mission.mission.id`;
   `missionOrchestrator.createManual()`'s real `missionId` field read as a nonexistent
   `m.mission.id` behind a nonexistent `m.ok` check) — live-reproduced: the server log showed a
   real mission created while the API response showed `null`. A third call
   (`companyLifecycleEngine.createCompany()`) was missing its required `creatorAccountId` and
   therefore failed deterministically every time, silently swallowed by a bare `catch{}`. The
   overall assembly always reported `status:"completed"` regardless of any of this.
2. **`productValidationEngine.cjs`'s 6 dimension checks silently fall back to a hardcoded,
   always-passing score** when their real underlying service is unavailable, and `productionReady`
   was computed without regard to whether any real measurement actually happened.

Both fixed with minimal, targeted, reversible changes — see Security and Final reports for full
root-cause/fix/negative-test/live-verification detail.

## 5. Real, confirmed integrations

| Integration | Status | Evidence |
|---|---|---|
| Product → Mission (via `productAssemblyEngine.cjs` → `missionOrchestrator.createManual()` / `workforceManager.runMission()`) | **Real, now correctly captured** (was silently broken by the field-name bug) | Live-verified: real `msn_*`/`wf_*` ids returned post-fix |
| Product → Developer OS `/dev/*` (org-scoped projects/repos) | **Genuine gap** | Confirmed zero references either direction |
| Product Factory ↔ Engineering Org (`/engorg/v2/*`) | **Genuine gap — UI-adjacent only, not code-linked** | Both appear as tabs in the same `ProductOSCenter.jsx`, but confirmed zero cross-references in either backend |
| Product → Knowledge OS | **Genuine gap** | One text-label mention in a static architecture-suggestion list (`productArchitectureEngine.cjs`), never an actual `require()` |
| Product → Memory OS | **Genuine gap** | No reference found |
| Product → Business/Sales/CRM/Revenue | **Genuine gap** | No reference found in either direction |
| Product → Executive OS | **Genuine gap** | No read path found |
| Product → Customer Success/Support | **Genuine gap** | No reference found |
| Feedback → Roadmap (`feedbackHub.cjs`) | **Real, separate, platform-wide by design** | Real submit/vote/status-transition, not org-scoped (a public feedback board pattern, not per-tenant product management) |

---

**Outcome:** Product OS is real, substantial, and genuinely wired end-to-end (frontend → API →
service → persistence), including real Mission-layer integration (now correctly honest after this
pass's fix). Its defining limitation is architectural, not a bug: no tenant model exists anywhere
in its data layer, confirmed live with two real accounts. Two genuine fake-success defects fixed.
**0 systems built.**
