# OS-EXECUTIVE — DISCOVERY REPORT

**Track:** OOPLIX OS #8 — Executive OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new executive system was built.**
**Isolation:** Verification server on **port 5122** (dedicated), leaving :5050 to other sessions.
All prior server processes were force-killed before starting (per the operational hazard
documented in the Mission OS pass — `pkill -f "node backend/server.js"` before any isolated run).

---

## 1. Method

Traced actual importers/routes for every candidate before classifying anything as dead. Several
components looked plausible from filenames alone but were confirmed **orphaned by grep**, not
assumption — see §4.

---

## 2. The real Executive surface — three distinct systems, not one

Discovery found **three separate, non-duplicate systems** answering to "Executive," each serving a
different real purpose:

| System | What it actually is | Scope |
|---|---|---|
| **`CommandCenter.jsx` + `founderHomeApi.js`** | The real founder command layer — operator-gated, composes runtime health, revenue, deployments, approvals, mission templates | Operator-only, platform-wide |
| **`executiveOrg.cjs` / `executiveState.cjs` (`/eos/v6/*`)** | "Level 6" autonomous executive department simulation — 20 department agents ticking goals/strategies/missions/decisions/risks/budgets, composed from the other Level org-state layers (business/engineering/knowledge/evolution) | Was authenticated-only, **no operator gate** (fixed — see Security report) |
| **`orgExecutiveIntelligence.cjs` (`/org-executive/:orgId/*`)** | Genuinely org-scoped executive intelligence — connector health, AI spend, knowledge graph size, agent success, automation ROI, with real `_assertMember` enforcement and honest `insufficientData` handling | Per-org, real membership-checked |

None of these duplicate each other's function. `CommandCenter` is the UI/command layer;
`executiveOrg`/`executiveState` is a cross-system autonomous tick engine; `orgExecutiveIntelligence`
is a tenant-facing read-only insight composer. This matches the mission's Core Rule — the platform
already has an executive layer; it does not need a fourth.

## 3. Backend Inventory

| File | Lines | Role |
|---|---:|---|
| `backend/services/executiveState.cjs` | 754 (+~15 this pass) | Goals/strategies/missions/decisions/approvals/risks/budgets store, `getDashboard()`, `getGlobalHealth()`, `syncOrgStatus()` |
| `backend/services/executiveOrg.cjs` | 509 | 20 department-agent tick implementations, reuses `missionOrchestrator`/`missionMemory`/org-state layers |
| `backend/services/executiveReasoning.cjs` | 781 | Decision/reasoning support |
| `backend/services/executiveWorkflow.cjs` | 645 | Strategy-building workflows |
| `backend/services/orgExecutiveIntelligence.cjs` | 160 | Real org-scoped insights/recommendations/forecast/summary |
| `backend/routes/executiveOrg.js` | — | `/eos/status`, `/eos/summary`, `/eos/agents/:id`, `/eos/v6/*` (30+ endpoints) |
| `backend/routes/orgExecutiveIntelligence.js` | — | `/org-executive/:orgId/*` (4 endpoints) |

Route registration confirmed: `backend/routes/index.js:149-150` (`/eos/*`), `:221`
(`/org-executive/*`).

## 4. Frontend Inventory — traced, not assumed

| Component | Status | Evidence |
|---|---|---|
| `CommandCenter.jsx` (1,991 lines) | **WIRED, operator-gated** | `App.jsx:24,1472`; role-gated per its own comment |
| `ExecutiveDashboard.jsx` (915 lines) | **WIRED** | `App.jsx:153,1606` (tab `executivedash`) — but calls scattered P20-P27 phase endpoints (collaboration/approvals), not a KPI aggregator |
| `ExecutiveReports.jsx` (405 lines) | **ORPHAN — confirmed by grep** | Zero imports anywhere; zero `fetch`/`_fetch` calls in the file itself — a static shell with no data source |

`ExecutiveReports.jsx` was not assumed dead from its name — `grep -rl "ExecutiveReports"
frontend/src` returned only its own file and CSS. It genuinely has no importer and no backend call.

## 5. Data sources actually consumed by the Executive layer

`executiveState.syncOrgStatus()` composes from:

| Source | Read via | Real? |
|---|---|---|
| Engineering | `engineeringOrgState.getDashboard()` | ✅ real |
| Business | `businessOrgState.getDashboard()` | ⚠️ real, but **partially synthetic** — see Workflow Evidence |
| Knowledge | `akoState.getDashboard()` | ✅ real |
| Evolution | `aeoState.getDashboard()` | ✅ real |
| Runtime | `selfHealingRuntime.getStatus()` | ✅ real |
| Agents | `agentRuntimeSupervisor.listAgents()` | ✅ real |

**Not consumed at all**: Finance OS's `revenueOS.cjs` (the verified, real MRR source), Sales OS,
Marketing/Growth OS, Support/Customer Success. The Executive dashboard's "business.mrr" comes from
`businessOrgState`, a **different, older, partially-demo-populated** revenue computation — not the
Finance OS figure this program already certified as real (₹108,891 MRR, independently verified
against raw ledger data in the Finance OS pass).

## 6. Key Discovery Findings

1. **Executive OS already substantially exists** across 3 legitimate, non-duplicate systems.
   Nothing needed building.
2. **`/eos/v6/*` had no operator gate** — any authenticated tenant could read the platform-wide
   executive dashboard **and write platform-wide goals**. Fixed (see Security report).
3. **The executive "business.mrr" figure silently mixed real and synthetic demo data** — 211 of
   1,079 deals (19.6%) — with the disclosure that exists in the source
   (`businessOrgState.getDashboard().dataIntegrity`) dropped before reaching the executive layer.
   Fixed (see Workflow Evidence).
4. **Health-score fallbacks (`score:50`) were indistinguishable from a genuine medium-health
   reading** when a source was actually unavailable. Fixed with an explicit `unavailable` flag.
5. **`execMissions` (executiveState's own mission-tracking array) has no retention cap** and has
   grown to 9,259 records (6 MB), 99.96% still marked `active` — a likely stale-data accumulation,
   documented as a genuine gap rather than fixed in this pass.
6. **`ExecutiveReports.jsx` is a confirmed orphan** — wired nowhere, calls nothing.

---

**Outcome:** Executive OS is a recovery/verification target. Three defects fixed with negative
tests and live re-verification; two genuine gaps documented. **0 systems built.**
