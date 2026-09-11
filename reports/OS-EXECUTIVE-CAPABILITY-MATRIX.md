# OS-EXECUTIVE — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Verification port:** 5122 · **Regression:** 144/144 before and after

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · VERIFY = works but with
a caveat requiring ongoing attention · GAP = Genuine Gap · NM = Not Measured · ARCHIVE = dead code

---

## 1. Executive Dashboard

| # | Capability | Status | CAPABILITY / UI / ROUTE / SERVICE / DATA SOURCE / AUTH / ORG SCOPING |
|---|---|---|---|
| 1 | `GET /eos/v6/dashboard` | **FIXED** | goals/missions/decisions/approvals/risks/health · no UI directly bound · `executiveOrg.js` · `executiveState.cjs` · `data/eos/state.json` + composed org-state · was `requireAuth` only → now `requireAuth+operatorOnly` |
| 2 | `CommandCenter.jsx` | **PROD** | Founder command shell · `App.jsx` (operator-gated tab) · `runtimeApi.js`+`founderHomeApi.js` · real backend routes · `requireAuth` per-route, role-gated in UI · platform-wide (operator) |
| 3 | `ExecutiveDashboard.jsx` | **PROD (narrow)** | Collaboration/approval view · `App.jsx` tab `executivedash` · P20-P27 phase APIs · real routes · `requireAuth` · **not** a KPI aggregator despite the name |
| 4 | `ExecutiveReports.jsx` | **ARCHIVE CANDIDATE** | No UI mount, no data source, zero imports anywhere |

## 2. Business / Sales / Finance / Marketing / Customer / Support KPIs

| # | Capability | Status | Evidence |
|---|---|---|---|
| 5 | Business KPIs (via `/eos/v6/context`) | **FIXED (disclosure)** | `businessOrgState.getDashboard()` — real, but 19.6% synthetic-deal contamination now disclosed |
| 6 | Sales KPIs | **GENUINE GAP** | No Executive read path found into Sales OS's verified data |
| 7 | Finance/Revenue KPIs (via Executive) | **GENUINE GAP** | Executive reads `businessOrgState`'s own MRR, **not** the real Finance OS `revenueOS.cjs` figure (₹108,891, independently verified in the Finance OS pass) — two competing numbers exist |
| 8 | Marketing/Growth KPIs | **GENUINE GAP** | No Executive read path found into Marketing/Growth OS |
| 9 | Customer KPIs | **NOT MEASURED** | No dedicated Customer OS pass exists yet in this program to reconcile against |
| 10 | Support KPIs | **NOT MEASURED** | Same — no Support OS pass exists yet |
| 11 | Revenue/Finance via `founderHomeApi.getRevenueDashboard()` | **PROD** | This one **does** call the real `/revenue/dashboard` — confirmed MRR ₹108,891, matching Finance OS exactly. Only `CommandCenter`'s path is correct; `/eos/v6`'s is not |

## 3. Engineering / Mission / Runtime / Agent KPIs

| # | Capability | Status | Evidence |
|---|---|---|---|
| 12 | Engineering KPIs (via `/eos/v6/context`) | **PROD** | `engineeringOrgState.getDashboard()` — real, workItems:243 |
| 13 | Mission KPIs (`/eos/v6/dashboard` missions.total) | **VERIFY** | Real linkage (89.6% of 9,263 `execMissions` carry a genuine `orchMissionId`) but is a **separate, unbounded, uncapped store** from Mission OS's `missions.json` (2,130) — different aggregation window, not fabrication, but a genuine architectural gap (§6) |
| 14 | Agent/runtime status | **PROD** | `agentRuntimeSupervisor.listAgents()` — real, `total`/`running` counts |
| 15 | `/eos/v6/health` global health score | **FIXED** | `getGlobalHealth()` — real per-source computation, `score:50` fallback on failure was indistinguishable from genuine medium health |

## 4. Organization / Memory / Automation / Risk

| # | Capability | Status | Evidence |
|---|---|---|---|
| 16 | Organization/workforce status | **PROD** | `/org-executive/:orgId/insights` — real, `_assertMember`-checked, `org.memberCount`/`plan` |
| 17 | Memory/knowledge signals | **PROD** | `akoState.getDashboard()` — real, 1,464 knowledge items |
| 18 | Automation status | **PROD** | `orgExecutiveIntelligence.getInsights()` → `analyticsService.getAutomationROI(orgId)` — genuinely org-scoped (per the file's own documented reuse-check) |
| 19 | Risk/health signals | **PROD** | Real risk records with severity, `criticalRisks` factored into overall score |
| 20 | Activity/event timeline | **PROD** | `executiveState._r()` reports (10,346 real records observed) |

## 5. Goals / Summaries / Search / Actions

| # | Capability | Status | Evidence |
|---|---|---|---|
| 21 | `POST /eos/v6/goals` (create goal) | **FIXED (auth)** | Was writable by any authenticated tenant → now operator-only. Functionally real (persists, returns real id) |
| 22 | `PATCH /eos/v6/goals/:id` | **PROD (post-fix, operator-only)** | Same gate applies |
| 23 | Executive summaries (`getOperationalSummary`) | **PROD** | `orgExecutiveIntelligence.cjs` — real plain-language composition of real data, no AI-generated filler |
| 24 | Cross-OS search | **NOT MEASURED** | No dedicated executive-search endpoint was found distinct from each OS's own search |
| 25 | Executive actions (goal/mission/decision/approval CRUD) | **PROD (post-fix, operator-only)** | All exercised at least once: create goal, list missions, list decisions, list approvals |
| 26 | Decision/command workflows | **PROD** | `executiveWorkflow.cjs` — `buildStrategy` reused by department ticks |

## 6. Security / Isolation

| # | Capability | Status | Evidence |
|---|---|---|---|
| 27 | Unauthenticated access to `/eos/*` | **PROD** | 401 (barrel `requireAuth`) |
| 28 | **Non-operator tenant read of `/eos/v6/dashboard`** | **FIXED** | Was 200 (full platform data) → now 403 |
| 29 | **Non-operator tenant write of `/eos/v6/goals`** | **FIXED** | Was 200 (real write succeeded) → now 403 |
| 30 | `/org-executive/:orgId/*` membership check | **PROD** | Non-member → 403 via `_assertMember`, confirmed live |
| 31 | Forged workspace header on `/org-executive` | **PROD** | No effect — membership check uses real org/account, not headers |

## 7. Honesty (Step 7 scan)

| # | Capability | Status | Evidence |
|---|---|---|---|
| 32 | `Math.random()` audit | **PROD (clean)** | Only used for ID-suffix generation, not metric fabrication |
| 33 | Hardcoded multiplier audit | **PROD (clean)** | None found in `executiveState.cjs` |
| 34 | **Health-score `unavailable` disclosure** | **FIXED** | See #15 |
| 35 | **Business MRR synthetic-data disclosure** | **FIXED** | See #5 |
| 36 | Forecast honesty (`orgExecutiveIntelligence.getForecast`) | **PROD** | Returns `insufficientData:true` rather than fabricating a trend when <2 real data days exist — already correct |

## 8. Freshness

| # | Capability | Status | Evidence |
|---|---|---|---|
| 37 | `/eos/v6/context` freshness | **PROD (documented)** | Computed live on each request (`syncOrgStatus()` runs synchronously per call), not cached — `lastSync` timestamp reflects the actual request time |
| 38 | No new polling/scheduler/event-bus added | **PROD** | Confirmed — this pass added zero new refresh mechanisms |

## 9. Genuine Gaps (not fixed — documented per fix policy)

| # | Gap | Why not fixed |
|---|---|---|
| 39 | **Executive MRR reads `businessOrgState`, not Finance OS's real `revenueOS.cjs`** | Repointing touches `executiveOrg.cjs`/`executiveWorkflow.cjs`'s own tick logic beyond the dashboard display — broader than a minimal fix; documented with full reconciliation evidence |
| 40 | **`execMissions` has no retention cap** (9,263 records, 6 MB, 99.96% still "active") | Same class of leak already fixed elsewhere in the codebase (`_lessons`, `memory-archive.json`) but not yet here; changing write semantics of a shared executive-tick-generated store is a dedicated-pass change |
| 41 | No Executive read path into Sales/Marketing/Support OS | No dashboard, service, or route reads these — a real absence, not a defect in an existing integration |
| 42 | Cross-OS search (unified, executive-level) | Not found as a distinct capability |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **24** |
| **Fixed** (this pass) | **6** |
| **Verify** | 1 |
| **Genuine Gaps** | **6** |
| **Archive Candidate** | 1 |
| **Not Measured** | 4 |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| **Total assessed** | **42** |

**No executive system was duplicated and nothing was built.** Three root causes fixed across
6 capability entries, each with a negative test and live re-verification; six genuine gaps
documented with full evidence rather than force-fixed.
