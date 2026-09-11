# STALE ACTIVE MISSION RECOVERY — AUDIT

**Track:** OOPLIX V1 Master Audit — production-critical reliability / data integrity
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Selected per mission priority order:** P0/P1 security items reconciled as already-closed this
session; no new authorization defect assumed. Next real, actionable item was production-critical
reliability / data integrity.

---

## Why this item

Re-read `reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md` per the mission's own instruction to reconcile
before selecting. Found several register lines already stale/resolved by earlier, sometimes-uncredited
passes (C10-006, C10-010, GG-1's IP-enforcement line). One item — C10-005, "3 non-reconciled memory
backends" — genuinely still open but requires a product decision on canonical backend choice, not a
code-level fix; documented as **DECISION REQUIRED** and set aside rather than guessed at.

Per the explicit instruction not to assume another authorization defect exists, pivoted to direct
investigation of this session's own repeatedly-recurring risk pattern: JSON-file-backed persistent
stores under a long-running, frequently-restarted server process.

## Discovery

`data/missions.json` (13.5MB) contained **658 missions permanently stuck at status `"active"`**,
median age 248 hours (~10 days), oldest ~399 hours (~16.6 days), all subtasks still `"pending"` —
never progressing, never failing, never completing.

Root cause, confirmed by direct source read rather than inference:

- `backend/services/missionOrchestrator.cjs`'s `createManual()` → `_queue()` tracks in-progress
  execution in `const _live = new Map()` — a module-level, in-process-only structure with **zero
  persistence and zero startup recovery**.
- `backend/services/missionMemory.cjs`'s own `VALID_STATUSES` header comment independently documents
  `"active"` as a second, legacy status value with "scattered lower-confidence external readers,"
  distinct from the real `planned → running → completed/failed` state machine that
  `agents/runtime/missionRuntime.cjs` implements and enforces.
- Nothing else in the codebase ever transitions a mission out of `"active"`.
- `agents/runtime/missionRuntime.cjs`'s `recoverStaleMissions()` — already correct, already wired at
  every server startup (`backend/server.js:1253`), already wraps recovery in a real recorded decision —
  only ever checked `status: "running"`.

This server restarted 15+ times over this session's own mission arc. Every restart silently orphaned
whatever `_live` held at that moment, since `_live` is empty on the next boot and nothing reconciles it
against the persisted store. 658 is the accumulated result of that repeated, unrecovered failure mode.

## Fix

Extended `recoverStaleMissions()`'s existing loop to also check `"active"`:

```js
function recoverStaleMissions() {
    const STALE_STATUSES = ["running", "active"];
    const missionIds = [];
    for (const status of STALE_STATUSES) {
        const { missions: stale } = memory.listMissions({ status, limit: 1000 });
        for (const m of stale) {
            memory.updateMission(m.id, { status: "planned" });
            memory.recordDecision(m.id, {
                type: "system",
                description: `Recovered from stale "${status}" state on process restart`,
                rationale: "Mission was left in-progress by a prior process instance that did not reach a terminal state (crash or forced restart)",
                outcome: "reset_to_planned",
            });
            missionIds.push(m.id);
        }
    }
    if (missionIds.length > 0) {
        logger.info(`[MissionRuntime] Recovered ${missionIds.length} stale running/active mission(s) → planned`);
    }
    return { recovered: missionIds.length, missionIds };
}
```

Reused the exact existing mechanism — no new recovery pathway, no new service, no schema change.
Deliberately left `"planned"` (615 also old) untouched: that is a distinct, legitimately valid,
intentional pre-start state per the same documented state machine, and recategorizing it would be a
scheduling-policy guess this pass has no evidence to make.

## Live re-verification

- Took a real backup first: `cp data/missions.json /tmp/missions_backup_before_recovery.json`.
- Ran the fixed function directly against the real, full-scale production data file (not a synthetic
  sample): `active` 658 → 6 (the 6 being genuinely fresh, still-in-flight missions), `planned`
  correctly absorbed the recovered set, each with a real decision recorded.
- Restarted the real server (exact-PID kill, fresh `nohup` on a new log file), confirmed healthy via
  `GET /health` → `{"status":"ok",...}`.
- Confirmed via the real startup log that the fix fires correctly at boot, going forward, without
  manual intervention:
  ```
  [MissionRuntime] Recovered 4 stale running/active mission(s) → planned
  [Startup] Recovered 4 stale running mission(s) → planned
  ```
  (the "4" here are missions genuinely orphaned by that specific restart, not old backlog — the
  backlog had already been cleared by the live test run above).
- Post-restart state: `active: 13` — fresh, legitimate in-flight missions from ongoing platform
  activity since the restart, not stale backlog.

## Regression

- Added describe block `133-master-audit-stale-active-mission-recovery` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: a structural check confirming `_live` is
  in-memory-only, a structural check confirming `STALE_STATUSES` includes `"active"`, and a live
  end-to-end test that creates a real synthetic mission, forces it to `"active"`, runs
  `recoverStaleMissions()`, confirms it lands on `"planned"` with a correctly-worded recorded decision,
  and cleans up after itself.
- Negative-tested: reverted `STALE_STATUSES` to `["running"]` only, confirmed both new structural and
  live tests failed for the right reason, restored the fix, confirmed all tests passed again.
- `npm run test:runtime`: **266/266** (263/263 baseline + 3 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected.
- Production build (`cd frontend && CI=true npm run build`): clean — no frontend files touched.
- `.env`: confirmed untouched (`git status --porcelain .env` → empty).

---

## AUDIT NAME: Stale/Active Mission Recovery (missionOrchestrator._live orphaning)

**STATUS:** CERTIFIED
**SCORE:** 9/10
**CONFIDENCE:** 92%

## V1 SURFACE

- **Backend:** `agents/runtime/missionRuntime.cjs` (1 function extended, ~10-line diff).
  `backend/services/missionOrchestrator.cjs` and `missionMemory.cjs` read for root-cause confirmation,
  not modified.
- **Routes:** N/A — startup-lifecycle fix, no HTTP route surface.
- **Frontend:** N/A — no frontend files touched; no UI consumer of mission status depends on `"active"`
  vs `"planned"` distinction being fixed at this layer.
- **Persistence:** PASS — real, live-verified against the actual `data/missions.json` production file,
  atomic-write path (`_saveMissions`) already correct and untouched.
- **Authentication:** N/A — not an auth-surface change.
- **Authorization:** N/A — not an authorization-surface change.
- **Tenant Isolation:** N/A — mission recovery is a global-process-lifecycle concern, not tenant-scoped.
- **Cross-OS:** N/A — pure Node.js server-lifecycle logic, no OS-specific behavior.
- **Failure Honesty:** PASS — recovered missions are reset to a real, correct, resumable state
  (`"planned"`) with a real recorded decision explaining why, not silently dropped or fabricated as
  complete.
- **Live Verification:** real production data file, real backup taken first, real before/after counts
  confirmed via direct inspection, real server restart, real startup log grep confirming the fix fires
  automatically going forward.
- **Regression:** 266/266 (0 failures, 0 skipped, 3 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 0
- **V1-critical P2:** 1 found and fixed — `missionOrchestrator.cjs`'s in-memory-only `_live` Map
  silently orphaning missions at `"active"` on every server restart, with no existing recovery
  (658 real missions accumulated stuck, median age 10 days).
- **Other:** C10-005 (3 non-reconciled memory backends) confirmed still open, correctly classified as
  **DECISION REQUIRED** (canonical-backend choice is a product decision, not a code defect) and set
  aside rather than guessed at. C10-006, C10-010, and GG-1's IP-enforcement register line reconciled as
  already resolved by earlier passes.

## FIXES

- `agents/runtime/missionRuntime.cjs`: `recoverStaleMissions()` extended to check both `"running"` and
  `"active"` via a `STALE_STATUSES` array, reusing its existing reset-to-`"planned"`-plus-recorded-
  decision behavior unchanged.
- 3 new regression tests (2 structural, 1 live end-to-end), each fix layer independently
  negative-tested.
- Real production backlog cleared live (658 → 6 `active`), confirmed self-healing on every future
  restart via the real startup log.

## LIMITATIONS

- The 615 missions genuinely stuck at `"planned"` (a separate, valid, intentional pre-start status)
  were deliberately left untouched — whether some of those represent a *different*, real scheduling
  defect (e.g., an execution queue that never picks them up) is not established by this pass and would
  require separate investigation before any action.
- Did not trace the exact single literal call site that first writes `status: "active"` inside
  `missionOrchestrator.cjs`'s deeper call chain — sufficient evidence (the `_live` Map's structure, the
  `VALID_STATUSES` documentation, and the empirical 658-mission backlog) was gathered to confirm root
  cause and correctness of the fix without that one additional trace step.
- `data/missions.json` remains a single large JSON file rewritten via full-file atomic replace on every
  mutation; this pass did not re-open that design (already correctly out-of-scope per
  `reports/OS-MISSION-FINAL.md`'s prior disposition).

## FINAL CLASSIFICATION: **CERTIFIED**

## PROGRAMME IMPACT

Closes a real, previously undiscovered production-reliability gap directly caused by this session's
own repeated restart cadence — every future restart now self-heals orphaned `"active"` missions using
the same trusted mechanism already governing `"running"` missions, with zero new architecture. No
OS-track record altered.

## REGRESSION RESULT: 266/266 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean; backend-only change, no frontend files modified)

## CURRENT BASELINE: 266/266
