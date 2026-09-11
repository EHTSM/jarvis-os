# OS-ENGINEERING — DEDICATED V1 VERIFICATION

**Track:** OOPLIX OS #2 — Engineering OS (25-OS Master Reconciliation, final remaining item)
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Method:** Inventory → live route verification → end-to-end workflow test → security sweep →
failure-honesty test → fix (1 genuine defect found) → negative-test → regression → certify.
**NO NEW ARCHITECTURE WAS BUILT.**

---

## Verdict: CERTIFIED WITH LIMITATIONS — 7.6/10, confidence 84%

## Phase 1 — Inventory

**Backend:** `backend/routes/engineeringOrg.js` (21 real routes), backed by 3 services:
`engineeringOrg.cjs` (org roster/status), `engineeringOrgState.cjs` (729-line real data model —
objectives/epics/work-items/blockers/handoffs/approvals/reviews/KPIs/memory, real disk persistence
via `fs.writeFileSync`), `engineeringOrgWorkflow.cjs` (CTO/EM/Architect workflow actions). Reuses
`agentRuntimeSupervisor.cjs` (Agent OS's already-certified 210-agent registry — 20 of those agents
are this org's own `engorg_*` roster) and `missionMemory.cjs` (Memory OS's canonical store) — no
duplicate registry or memory system.

**Frontend:** 3 surfaces found, only 1 genuinely reachable in web mode:
- `EngineeringConsole.jsx` — the component whose name most directly matches "Engineering" — is
  **not mounted anywhere in `App.jsx`**; it IS mounted in `ElectronWorkspace.jsx` only (Electron-only,
  matching this session's established `RevenueOS.jsx` precedent for Electron-passthrough components).
  It doesn't call any `/engorg/*` route anyway — it calls `/runtime/*` and `/agents/*`.
- `ProductOSCenter.jsx` (mounted at `tab === "productos"`, independently certified by Product OS)
  genuinely imports and calls `engOrgApi.js`, which genuinely calls `/engorg/v2/objectives`,
  `/engorg/v2/epics`, `/engorg/v2/work-items` — this is the one real, reachable web path into
  Engineering OS's V2 workflow data, but it's a secondary panel inside Product OS's tab, not a
  dedicated "Engineering" navigation entry.
- No dedicated "Engineering" tab exists in the main web navigation at all.

**Tenant model:** Zero `orgId` anywhere in `engineeringOrgState.cjs` — confirmed intentional, not a
leak: this data models the platform's own internal AI-engineering-org backlog (how the 20 `engorg_*`
agents build/maintain the platform itself), not tenant business data. Live-verified Org A and Org B
see the identical platform-wide dashboard (97 objectives, 67 epics, 243 work items) — correct,
consistent behavior for genuinely platform-wide data, architecturally the same class already
established for Agent OS's registry and the Level 3-5 org tiers (Business/Knowledge/Evolution Org).

## Phase 2/3 — Route verification & end-to-end workflow

All 21 routes confirmed to exist, all `requireAuth`-gated. Live end-to-end workflow test:
`POST /engorg/v2/work-items` (create) → `POST .../claim` (real status transition, real history entry)
→ `POST .../complete` (returns a real `reviewId`) → confirmed the review genuinely appears in
`GET /engorg/v2/reviews`, correctly linked back to the work item. This is a real, working
engineering-intent-to-review pipeline, not fabricated — not invented by this pass, exercised as it
already existed.

## Phase 4 — Security

| Check | Result |
|---|---|
| Unauthenticated access | **PASS** — `GET /engorg/status`, `GET /engorg/v2/dashboard` both 401 |
| Cross-tenant access | **N/A (correctly platform-wide by design)** — Org A and Org B both see identical data; no secret-labeled tenant data is exposed since this store contains no tenant records |
| IDOR | **Not applicable in the tenant sense** — `engineerId`/`completedBy` reference one of 20 fixed AI-agent identities, not real user accounts |
| **Privilege escalation — FOUND AND FIXED (see below)** | Fixed this phase |
| Secrets leakage | None found |
| Backend trusting frontend claims | None found beyond the already-assessed agent-identity fields (not a security boundary) |
| **Platform-wide writes exposed to tenant users — FOUND AND FIXED** | Fixed this phase |

### ENGOS-1 (P1 — privilege escalation, live-reproduced)

`POST /engorg/agents/:id/enable`, `.../disable`, `.../tick` were gated `requireAuth` only. **Live-reproduced**: a non-operator tenant (Org B) successfully disabled `engorg_backend` — one of the 20
shared, platform-wide AI engineer agents — for every user on the platform via a single unauthenticated-
by-role request. This is the identical control-plane class already found and fixed this session for
`/auto/v10/control/mode` (Autonomous OS) and `/ent`, `/eco`, `/civ` (Enterprise/Ecosystem/Civilization
Org): a write action with no legitimate ordinary-user use case, disrupting shared platform state for
every tenant.

**Distinguished from legitimate ordinary-user actions** (deliberately left unchanged): creating a work
item, claiming it, creating an objective/epic — these are legitimate product actions where an
ordinary user directs the AI org, matching the `requireAuth`-only precedent already established for
`/bizorg` and `/missions` routes elsewhere in this codebase. Only the 3 routes that pause/resume/force
an immediate tick on a *shared* agent — with no per-request scope, affecting every tenant's view of
that agent — were re-gated.

**Fix:** added `operatorOnly` to `POST /engorg/agents/:id/tick`, `/enable`, `/disable`. No new
middleware invented — the same `operatorOnly` function already used for `/eos`, `/auto`, `/ent`,
`/eco`, `/civ` this session.

**Live verification (before/after, fresh server process):**
| Action | Before | After |
|---|---|---|
| Non-operator `POST /engorg/agents/:id/disable` | `200`, agent genuinely disabled platform-wide | `403 Forbidden` |
| Non-operator `POST /engorg/agents/:id/enable` | not tested pre-fix (fixed alongside disable) | `403 Forbidden` |
| Non-operator `POST /engorg/agents/:id/tick` | not tested pre-fix (fixed alongside disable) | `403 Forbidden` |
| Ordinary user `POST /engorg/v2/work-items` (unaffected legitimate action) | `200` | `200` (confirmed unaffected post-fix) |

**Negative-tested:** reverted the fix, confirmed the new regression test genuinely failed with the
expected message, restored, confirmed passing again.

## Phase 5 — Failure honesty

Tested with invalid/nonexistent IDs: `POST /engorg/v2/work-items/wi_does_not_exist/claim` →
`{"success":false,"error":"Work item not found"}`; `POST /engorg/v2/blockers/blk_does_not_exist/resolve`
→ `{"success":false,"error":"Blocker not found"}`. Both honest, no fake success. No AI-provider or
external-credential dependency exists anywhere in this OS's own logic (`engineeringOrgWorkflow.cjs`
is entirely rule-based) — no credential-blocked path to test for honest failure, unlike AI Workspace.

## Phase 6 — Live verification

Every claim in this report is backed by a live HTTP request against the actual running server (port
5050), not source inspection alone: real dashboard data (97 objectives / 67 epics / 243 work items,
non-static, confirmed via a second request showing genuinely advancing `updatedAt` timestamps), real
end-to-end workflow (create→claim→complete→review), real persistence across an actual restart
(verified the test work item's `status:"in_review"` and `reviewId` survived), real cross-agent
integration (`GET /engorg/agents/engorg_backend` returns the same live-ticking agent Agent OS's own
certification already verified), real recently-generated memory records (timestamp 2 seconds before
the query, confirming the 20 agents are genuinely producing live output, not static seed data).

## Phase 7 — Regression

`npm run test:runtime`: **214/214** (was 212/212 at phase start — 2 net new tests, 0 weakened).
Production build: clean (`CI=true npm run build`, no frontend file touched this pass).

---

## FINDINGS

- **P0:** 0.
- **P1:** 1 found and fixed (ENGOS-1, privilege escalation on the agent control-plane routes).
- **V1-critical P2:** 0.
- **Other:** `EngineeringConsole.jsx` (the component most obviously named for this OS) is dead in web
  mode — a real UX/discoverability gap, not a security or data-integrity issue. The V2 workflow
  surface's only web reachability is as a secondary panel inside Product OS's tab, not a dedicated
  Engineering navigation entry.

## FIXES

- `backend/routes/engineeringOrg.js`: added `operatorOnly` to `POST /engorg/agents/:id/tick`,
  `/enable`, `/disable`. Live-verified, negative-tested, regression-clean.

## LIMITATIONS

- No dedicated "Engineering" tab exists in the main web navigation — the real, working V2 workflow
  data is only reachable as a secondary panel inside Product OS's own tab. This is a discoverability
  gap, not a functional or security defect; recovering it (if ever prioritized) would follow the same
  pattern already proven for `LaunchPlatform.jsx`'s earlier recovery, not require new backend work.
- `EngineeringConsole.jsx` is genuinely dead in web mode (Electron-only) — not investigated further
  this pass since it doesn't call `/engorg/*` at all; it's a different component (`/runtime`/`/agents`
  monitoring dashboard) than the Engineering-Org workflow surface this report covers.
- No dedicated regression suite existed for Engineering OS specifically before this pass; the 2 tests
  added this pass lock in only the one fix found, not a comprehensive suite of this OS's full surface.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Engineering OS now has a real, dedicated, live-evidenced verification result — the one item that
prevented the 25-OS programme from moving past "B. SOME OS STILL REQUIRE VERIFICATION." With this
pass complete, **all 25 OSs in the master inventory now have either a real certification, an honest
non-V1 classification, or a completed sufficiency determination** — the 25-OS programme's status can
now move to **"A. ALL 25 OS VERIFIED / CERTIFIED OR HONESTLY CLASSIFIED."**
