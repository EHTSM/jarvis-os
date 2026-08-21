# MASTER RECOVERY PROGRESS

Date: 2026-08-15 · Branch: `security/reality-completion`
Live checkpoint — updated as items close. See `MASTER-OPEN-FINDINGS.md` for the authoritative single table; this document narrates the work as it happened.

---

## Closed this session

### C10-003 — Developer OS tenant scoping (Recovery-test result: D — recover, don't rebuild)

**Root cause:** `agents/runtime/developerOS.cjs` (5 entity types: repos, projects, issues, builds, deployments; 46 functions) had zero `orgId` concept anywhere. After C.9/C.10's `requireAuth` fix closed unauthenticated access, any two authenticated users of different orgs still saw each other's full engineering data.

**Fix:** Rewrote the entire file — every create function now stores `orgId`; every list/get/search/stats/dashboard function now **requires** `orgId` (throws if omitted) and filters every record by exact match. Route layer (`backend/routes/ops.js`) now mounts `attachOrg`, requires a resolved org (403 otherwise), and threads `req.org.id` into all ~40 call sites. Pre-recovery records (no `orgId` field) are correctly invisible to everyone — never silently reassigned — until an operator explicitly runs the new `backfillUnownedRecords(orgId)` migration function (not exposed via any route).

**Live verification:** Two real tenants — Org B correctly got an empty repo list and a 404 on Org A's repo by direct ID; search, stats, and dashboard all correctly scoped; full create/update/complete/archive functionality re-tested working; data survived a real server restart.

**Regression:** New tests in `tests/runtime/10-c10-cross-system-closure.test.cjs` assert both the auth gate and the org-scoping; a prior C.9 test that asserted the *absence* of org-scoping (correct at the time) was updated to assert the new, fixed behavior instead, exactly as that test's own comment anticipated.

### C10-004 + C.9 mission-context leak — Memory OS root cause (Recovery-test result: D, with a scope correction)

**Discovery during recovery:** The inventory framed this as "Memory OS across 3 backends" — tracing writers/readers revealed the real scope is far larger: `missionMemory.cjs` alone has **74 internal consumers** across autonomous engineering, knowledge graphs, executive/platform/civilization state, and business automation. The large majority use missions as shared, cross-cutting platform infrastructure, not tenant-owned objects. Making `orgId` a required parameter (the C10-003 pattern) would have broken dozens of legitimate internal integrations — exactly what the recovery mandate warns against.

**Fix (scope-corrected to match the actual codebase, not the original item's assumption):** `orgId` is **optional** everywhere in `missionMemory.cjs`. `createMission()` stores it only if supplied; `listMissions()` gained an optional `orgId` filter — supplied, it returns only exact-match missions (never falls back to unscoped/global); omitted, behavior is byte-identical to before, which is what all 74 internal callers need. The actual tenant-facing leak — `codingAssistant.js`'s `_missionContext()`, which injects "recent missions" into the AI's system prompt — now receives and passes the real caller `orgId` (via a newly-mounted `attachOrg` on `/coding/*`, non-blocking). This is the exact function C.9 proved live was injecting an unrelated org's mission text into any caller's AI context.

**Live verification:** Created an org-scoped mission with a distinctive marker for Org A. Direct service-layer test: Org B's scoped query → empty (no leak); Org A's scoped query → returns their mission; unscoped query (the legacy 74-consumer path) → completely unchanged, still returns the full historical mix. `_missionContext()`'s exact logic re-tested to confirm it produces the correctly-scoped prompt string per org.

**Regression:** The old C.9 test asserting `missionMemory.cjs` has no `orgId` anywhere was replaced with tests asserting the optional-filter contract and the `_missionContext()` wiring — both negative-test-verified (temporarily reverted, confirmed the suite catches the regression, restored).

**The other named C.10 item under this same umbrella — 13 other engineering-memory source engines with zero org scoping (rule registry, RCA engine, pipeline coordinator, decision engine, smell detector, etc.) — remains genuinely open.** These are read-only-aggregated-through-`engineeringMemoryEngine.cjs` sources; most are legitimately platform-wide engineering intelligence (rules, root-cause patterns), not tenant business data, so blanket org-scoping them would repeat the same mistake this fix specifically avoided for missions. Escalated to `MASTER-OPEN-FINDINGS.md` as requiring a product decision on which of the 13 are genuinely tenant-bound vs. intentionally shared, rather than a blind mechanical fix.

### C10-029 — MRR decrement path / churn (Recovery-test result: E — genuinely absent, minimal build)

**Root cause:** `businessOrgState.cjs`'s `advanceDeal()` correctly increments MRR on `closed_won` (with a real idempotency guard from a prior fix), but no function anywhere decremented it — a won deal's MRR contribution was permanent even after churn. No churn/cancellation concept existed in the deal model at all (confirmed: 0 pre-existing churn-handling code).

**Build (minimal, scoped):** Added `churnDeal(id, {actor, reason})` — a `closed_won` deal can transition to a new `"churned"` terminal stage exactly once, decrementing MRR by the identical formula used to increment it (floor at 0), incrementing a new `dealsChurned` KPI counter. `"churned"` added to `TERMINAL_STAGES`, so the existing `advanceDeal()` guard automatically also blocks re-advancing a churned deal — no duplicate logic. Wired through `businessOrgWorkflow.cjs`'s `salesChurnDeal()` (mirrors `salesAdvanceDeal()`'s real event/memory/KPI pattern exactly) and a new `POST /bizorg/v3/deals/:id/churn` route mirroring the existing `/advance` route.

**Live verification:** Real deal created ($120,000), advanced to `closed_won` (MRR: 53802→63802, exactly +10000 = round(120000/12)), churned (MRR: 63802→53802, exactly restored), `dealsChurned` incremented to 1. Idempotency re-tested: second churn attempt correctly blocked (no double-decrement), attempting to re-advance a churned deal correctly blocked by the shared `TERMINAL_STAGES` guard. Data survived a real server restart.

**Regression:** New negative tests assert the exact decrement formula, the idempotency guard, and the `TERMINAL_STAGES` inclusion.

---

## Regression status after this checkpoint

```
npm run test:runtime: 186/186, 0 fail, 0 skipped
(176 pre-existing + 5 C.10 audit tests + 5 Master Recovery tests so far)
```

## In progress / remaining

See `MASTER-OPEN-FINDINGS.md` for the full authoritative table with every C10-00x ID's current disposition. Continuing in priority order per `MASTER-RECOVERY-PLAN.md`.
