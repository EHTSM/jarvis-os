# Mission 89 Phase 3C — P1 Cross-Process Lock Ownership Race Fix

**Status:** IMPLEMENTED, TESTED, NOT COMMITTED. Awaiting explicit review/approval before staging.
**Scope:** Fixes ONLY the confirmed P1 lock-release ownership race. Builds on Phase 3A (P0 corruption fix) and Phase 3B (orgId immutability), same file, non-overlapping hunks. No other Mission 89 finding (terminal-status inconsistency, `withMissionsLock()` scope) was touched.

---

## Confirmed Defect (Recap)

`_releaseMissionsLock()` previously called `fs.unlinkSync(LOCK_FILE)` unconditionally, with no verification that the calling process still actually owned the lock file it was about to delete. Reproduced live in Mission 89 Phase 2 (test C1, real forked processes): Process A acquires the lock and remains genuinely alive but stuck past `_LOCK_STALE_MS`; Process B correctly force-breaks A's now-stale-looking lock and acquires its own legitimate replacement; A eventually reaches its own release path and unconditionally deletes whatever lock file exists — which by then is B's, not A's. B's ownership was silently destroyed with no error on either side.

---

## Exact Implementation

File: `backend/services/missionMemory.cjs`, `_acquireMissionsLock()` and `_releaseMissionsLock()` only.

1. **Per-acquisition token**: each successful acquisition now writes `${process.pid}.${crypto.randomBytes(8).toString("hex")}` into the lock file instead of the bare PID — a unique token per acquisition, not merely per process, so that even the same process regaining a lock it previously lost is correctly treated as a new, distinct ownership epoch. The token is kept in a new module-level variable, `_lockToken`, alongside the existing `_lockDepth` counter.

2. **Ownership-verified release**: `_releaseMissionsLock()` now reads the lock file's current on-disk content immediately before deleting it, and only calls `fs.unlinkSync()` if that content still matches exactly the token this process itself wrote at acquisition time. If the content differs (another process force-broke and reacquired), the file is already gone (`ENOENT`), or any other read error occurs, release is now a **safe no-op** — it logs a warning and returns without deleting anything, rather than deleting an unknown holder's lock.

3. **`_lockDepth` alone was confirmed insufficient** and is not solely relied upon — it is pure in-process state with no way to detect that the on-disk lock has been replaced by a different process entirely; the fix adds the on-disk token comparison specifically because in-memory state cannot observe this.

4. **Check-then-unlink race window**: Node's `fs` API has no atomic "delete-if-content-matches" primitive, and introducing OS-level advisory file locking (`flock`) to make this fully atomic would be the "redesign the entire locking system" this phase is explicitly scoped to avoid. The fix therefore narrows, rather than perfectly eliminates, the race: the read-verify-unlink sequence is now a handful of synchronous statements with no I/O or yield points between the read and the unlink, converting an **always-wrong unconditional delete** into a delete that only proceeds when this process's own token is confirmed present at the moment of release — a categorically smaller and different risk than the previously-unconditional bug, and matches the same proportionate verify-before-mutate pattern already accepted elsewhere in this exact function (`_acquireMissionsLock()`'s own stale-check-then-unlink for force-breaking an abandoned lock has the identical, already-accepted race shape).

No other function, no dedup logic, no corruption/quarantine logic (Phase 3A), no orgId logic (Phase 3B), no terminal-status logic, and no autonomous-admission logic was touched. `agentRuntimeSupervisor.cjs` was not modified at all.

---

## Tests

`tests/runtime/55-mission-memory-integrity-reproduction.test.cjs`'s describe block "C" was rewritten from 1 test (which pinned the old, buggy behavior) to **10 tests**, matching the mission's own lettered requirements C-A through C-H:

- **C-A**: normal, uncontested acquire → release removes the lock file correctly.
- **C-B**: reentrant (nested) `withMissionsLock()` calls behave correctly — the lock exists throughout both the outer and nested callback, the nested call's own release is a safe no-op, and only the outer call's release actually removes the file.
- **C-C**: a fresh (non-stale) lock still causes a second process to time out after the existing bounded ~10s window — unchanged.
- **C-D**: a stale lock can still be force-broken and a new holder can acquire it quickly — unchanged.
- **C-E (PRIMARY REGRESSION)**: two genuine forked processes reproduce the exact original race scenario — A acquires, is aged stale, B force-breaks and acquires a distinct token, A attempts late release. **Result: A's release does NOT remove B's lock; the lock file's content is confirmed still exactly B's own token; B subsequently releases normally and its own release does remove the file.**
- **C-F**: forcibly replacing the lock's on-disk content with a fabricated different identity while the original process still (logically) holds it — the original holder's own release call does not unlink the replacement identity's content.
- **C-G**: a throwing `withMissionsLock()` callback still releases the lock correctly (no residue), and a subsequent call is not blocked.
- **C-H.1/C-H.2/C-H.3**: the primary regression scenario (same shape as C-E) repeated 3 additional independent times, each with its own isolated fixture — all confirm the fix holds consistently, not as a one-off.

### Repeated-Run Results

Full suite (`55-mission-memory-integrity-reproduction.test.cjs`, all describe blocks A-G plus Z; now 28 tests total after Phase 3A's 7 + Phase 3B's 6 + Phase 3C's 10, replacing the prior 1 lock test, plus the pre-existing D/E/F/G/Z tests):

- **Run 1:** 28/28 pass.
- **Run 2:** 28/28 pass.
- **Run 3:** 28/28 pass.

Deterministic across all 3 full-suite runs, and the primary regression itself was independently confirmed **4 times** total (C-E plus C-H.1/2/3) within a single run, every one passing.

### Regression Suite

Combined run of Mission 40, 43, 44, 51, 52, 54 (55 tests total): **55/55 pass.** No regression — Mission 51/52's own lock/concurrency tests exercise only the normal (uncontested, non-race) acquire/release path, which is completely unaffected by the ownership check (the token always matches in that path, so the unlink always proceeds exactly as before); Mission 88's admission-guard tests do not interact with lock internals directly.

---

## Real-Data Preservation Evidence

- SHA-256 before: `7965d7c99aa5d772b241c75078821c6eaa42f1658a2ea9d340bb0f3589c9a1eb`
- SHA-256 after: **identical**
- mtime before/after: `1788725402` (unchanged)
- size before/after: `40843016` bytes (unchanged)
- No `.lock`, `.tmp`, or `.corrupted.*.bak` artifact present in the real `data/` directory. Every test operates against an isolated `mkdtempSync` fixture (via `buildIsolatedMissionMemory()` or the local `_buildIsolatedRepoPaths()` cross-process variant).

---

## Git Status / Diff

```
 M backend/services/agentRuntimeSupervisor.cjs   (pre-existing P1-1 only — untouched by this phase)
 M backend/services/missionMemory.cjs            (cumulative Phase 3A + 3B + 3C: +214/-46 across 6 hunks)
?? reports/MISSION-89-PHASE-2-REPRODUCTION.md
?? reports/MISSION-89-PHASE-3A-P0-CORRUPTION-FIX.md
?? reports/MISSION-89-PHASE-3B-ORGID-IMMUTABILITY.md
?? tests/runtime/44-agent-timer-consolidation.test.cjs   (pre-existing P1-1 test, untouched)
?? tests/runtime/55-mission-memory-integrity-reproduction.test.cjs   (extended this phase)
```

`git diff backend/services/missionMemory.cjs | grep -c "^@@"` = 6 (4 from Phase 3A/3B, unchanged; 2 new hunks strictly scoped to `_acquireMissionsLock()`/`_releaseMissionsLock()` for this phase).

`git diff backend/services/agentRuntimeSupervisor.cjs | grep -c "^@@"` = 10 — confirmed identical to every prior mission's verification; this phase did not touch the file at all.

No file is staged (`git status --short` shows only ` M`/`??`, no `A`/staged entries).

---

## Confirmation: P1-1 Untouched

`agentRuntimeSupervisor.cjs`'s working-tree diff remains exactly the same 10 pre-existing P1-1 hunks, matching every prior confirmation byte-for-byte across this entire mission chain. `tests/runtime/44-agent-timer-consolidation.test.cjs` remains untracked and untouched.

---

## STOP

Per instruction: not staged, not committed, not pushed, not deployed. Awaiting explicit review before any git operation.
