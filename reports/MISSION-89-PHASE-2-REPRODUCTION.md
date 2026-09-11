# Mission 89 Phase 2 — Mission Memory Integrity Defect Reproduction

**Status:** REPRODUCTION ONLY — no fixes implemented, no files staged, no commits made.
**Source of truth:** Mission 89 Phase 1 audit report (reconnaissance-only findings).
**Scope:** Convert Phase 1's confirmed/suspected findings into deterministic, isolated regression tests and independently verify each one — no finding was assumed true without direct reproduction in this phase.

---

## 1. Exact Files Changed

- `tests/runtime/55-mission-memory-integrity-reproduction.test.cjs` — **new file**, 10 tests across 8 `describe` blocks (A, B, C, D, E, F, G, and a final real-data-integrity check).
- `reports/MISSION-89-PHASE-2-REPRODUCTION.md` — this report, **new file**.

No production code file was created, modified, staged, or committed. No existing test file was modified.

---

## 2. Exact Defects Reproduced

### A. P0 — Corruption → mutation data loss (REPRODUCED, both shapes)
- **A1 (invalid JSON):** 5 historical missions seeded and persisted. File replaced with invalid JSON (`"{ this is not valid json at all"`). A subsequent `createMission()` call succeeded, and the resulting on-disk store contained **only the 1 new mission** — all 5 historical missions were permanently, silently destroyed. `logger.warn` was called once with `"Load failed: ... — starting empty"`, the only signal of the event.
- **A2 (truncated JSON):** Same setup, file truncated to 50% of its valid length instead of replaced with garbage. Identical outcome: 0 of 5 historical missions survived; final store contained only the 1 post-truncation mission.
- Both reproductions are deterministic — confirmed across 3 independent full-suite runs with identical results every time.

### B. P1 — orgId reassignment via updateMission() (REPRODUCED, both conventions)
- **B1:** A mission created with `orgId: "org-A"` was passed to `updateMission(id, {orgId: "org-B"})`. The call did not throw. A **fresh** `getMission()` call (not just the return value of `updateMission()`) showed `orgId: "org-B"`, and direct inspection of the raw on-disk JSON confirmed the same — proving this is a genuine, durably-persisted ownership change, not a transient read-layer artifact.
- **B2:** The same reassignment succeeds via the `metadata.orgId` convention (the `organizationService.cjs`-style ownership field) as well — both org-scoping conventions documented in `missionMemory.cjs`'s own header are equally exposed.

### C. P1 — stale-lock / late-release ownership race (REPRODUCED, genuine forked processes)
Exact sequence executed with two real, separately-forked Node processes (not simulated):
1. Process A calls `withMissionsLock()`, acquires the lock, signals "acquired", then spins (synchronously, inside its own held lock) waiting for a release signal.
2. The lock file's mtime is artificially aged past `_LOCK_STALE_MS` (30s) via `utimesSync` — simulating A having appeared stuck, without actually crashing or exiting.
3. Process B calls `withMissionsLock()`. It observes the (still real, un-abandoned) lock as stale, force-breaks it, and successfully acquires its own lock. Verified: the lock file's content at this point is exactly Process B's own PID.
4. Process A is now signaled to proceed with its normal release path (`_releaseMissionsLock()` → `fs.unlinkSync(LOCK_FILE)`).
5. **Result: the lock file no longer exists immediately after A's release — even though Process B's own `withMissionsLock()` callback had not yet returned and B still believed it held the lock.**

This is a direct, live demonstration that `_releaseMissionsLock()` performs no ownership/PID verification before unlinking — it deletes whatever lock file exists at the path, regardless of which process created it.

### D. P2 — terminal-status consistency (OBSERVED, confirmed inconsistency — no fix)
Direct source inspection (not assumption) of the three sets:
- `missionMemory.cjs` `TERMINAL_STATUSES` (retention): `["cancelled", "completed", "failed"]`
- `missionMemory.cjs` `_TERMINAL_STATUSES_FOR_DEDUP` (dedup index): `["cancelled", "completed", "failed", "paused"]`
- `autonomousMissionGuard.cjs` `_TERMINAL` (cooldown/admission-cap): `["cancelled", "completed", "failed"]`

**Confirmed inconsistency: `paused`.** It is treated as terminal ONLY by the dedup index — never by retention (a `paused` mission is always preserved as "live") and never by the autonomous guard (a `paused` mission always counts toward the 25-mission active cap). This is a real, code-verified cross-file semantic disagreement, not a hypothetical concern.

### E. P2 — retention with interspersed live missions (CONFIRMED CORRECT — not a defect)
1000 terminal missions created (with 2 live missions interspersed at different insertion points: one at position 500, one at position 1000), plus a triggering 1001st terminal mission. Result: both live missions survived, terminal count was capped at exactly 1000, total store size was 1002. **This scenario does NOT reproduce a defect** — `_capTerminalMissions()`'s live/terminal partitioning is correct regardless of insertion order.

### F. P2 — withMissionsLock() long-callback exposure (REPRODUCED)
An 800ms artificially slow `withMissionsLock()` callback in one forked process was run concurrently with an entirely unrelated `createMission()` call (different objective, no shared business logic) in a second forked process. The unrelated call's own self-reported elapsed time was **~742-851ms across 3 runs** — consistently ≥70% of the slow callback's duration, proving the unrelated mutation genuinely waited on the shared, cross-cutting lock for nearly the full duration of a completely unrelated operation. This confirms the architectural exposure: `withMissionsLock()`'s scope is the entire `missions.json` store, not per-mission or per-signal, so any slow callback (even one with a bug, or one doing unexpected work) stalls every other mutation in the system.

### G. P2 — tmp+lock co-existence (TESTED — no defect surfaced beyond already-known behavior)
A stale orphaned `.tmp` file (aged past its 5-minute grace window) and a stale `.lock` file (aged past its 30-second threshold) were both placed in the isolated fixture simultaneously. A subsequent mutation succeeded quickly (1-2ms, not the full 10s acquire timeout), confirming stale-lock recovery is unaffected by a co-existing stale `.tmp`. The `.tmp` file was **not** cleaned by this call — `_sweepOrphanedTmp()` only runs once at module load, never on a per-mutation basis — which is documented here as observed, existing behavior, not asserted as either correct or incorrect.

---

## 3. Exact Defects Not Reproduced

- **E (retention with interspersed live missions)** was investigated as a potential edge case per Mission 89's own request but did **not** reveal a defect — the existing `_capTerminalMissions()` implementation correctly handles this scenario. Reported as a confirmed-correct regression pin, not a gap.
- **G (tmp+lock co-existence)** did not reveal any additional defect beyond the already-known (Mission 85-documented) behavior that `_sweepOrphanedTmp()` is a startup-only operation — this is pre-existing, disclosed behavior, not a new finding.

---

## 4. Test Counts and Repeated-Run Results

New suite (`55-mission-memory-integrity-reproduction.test.cjs`): **10 tests**.

| Run | Result |
|---|---|
| 1 | 10/10 pass |
| 2 | 10/10 pass |
| 3 | 10/10 pass |

All concurrency-involved tests (C1, F1) and the full suite were deterministic across all 3 independent runs — no flakiness observed.

One test-authoring bug was found and fixed during development (not a production defect): test F1 originally attached a `child.on("exit", ...)` listener for the slow-callback child *after* awaiting the waiter child's completion — since the slow child's own exit could occur before that listener was attached, the listener would never fire, causing a false test timeout. Fixed by attaching the exit-tracking promise immediately after forking, before any other `await`.

---

## 5. Regression Suite Results

Combined run of Mission 40, 43, 44, 51, 52, 54 (55 tests total): **55/55 pass**. No regression caused by the new test file's addition or by any test execution against the isolated fixtures.

---

## 6. Real Data SHA/Mtime/Size Preservation

- Before all validation: `7965d7c99aa5d772b241c75078821c6eaa42f1658a2ea9d340bb0f3589c9a1eb`, mtime `1788725402`, size `40843016`.
- After all validation (new suite run 3x + full regression suite): **identical** — same hash, same mtime, same size.
- No `.lock` or `.tmp` artifact present in the real `data/` directory at any point.

---

## 7. Git Status

```
 M backend/services/agentRuntimeSupervisor.cjs
?? tests/runtime/44-agent-timer-consolidation.test.cjs
?? tests/runtime/55-mission-memory-integrity-reproduction.test.cjs
```

`agentRuntimeSupervisor.cjs`'s working-tree diff remains exactly the same 10 pre-existing P1-1 hunks (`git diff | grep -c "^@@"` = 10), byte-identical to every prior confirmation across Missions 84-88. `tests/runtime/44-agent-timer-consolidation.test.cjs` remains untracked and untouched. `reports/` is a new, untracked directory addition not yet reflected above since it was created during this phase (a new report file, per the mission's own deliverable list).

---

## 8. Confirmation: No Production Code Was Changed

Confirmed via direct diff inspection: `backend/services/missionMemory.cjs`, `backend/services/autonomousMissionGuard.cjs`, `backend/services/agentRuntimeSupervisor.cjs` (beyond its pre-existing P1-1 hunks), `backend/services/engineeringOrg.cjs`, and every other production file are byte-unchanged from HEAD `7c229a52`. This phase is test-and-report only.

---

## STOP

Per Mission 89 Phase 2's explicit instruction: no fixes have been implemented for any of the confirmed defects (P0 corruption data loss, P1 orgId reassignment, P1 lock ownership race, or the P2 findings). No file has been staged, committed, or pushed. Awaiting explicit authorization for a Phase 3 fix-implementation mission before any production code changes are proposed.
