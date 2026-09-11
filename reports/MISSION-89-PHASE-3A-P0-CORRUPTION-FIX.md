# Mission 89 Phase 3A — P0 Mission-Store Corruption Data-Loss Fix

**Status:** IMPLEMENTED, TESTED, NOT COMMITTED. Awaiting explicit review/approval before staging.
**Scope:** Fixes ONLY the confirmed P0 defect (corruption/truncation → silent, permanent history loss on the next mutation). No other Mission 89 finding (orgId reassignment, lock ownership, terminal-status inconsistency, `withMissionsLock()` scope) was touched.

---

## Exact Root Cause

`missionMemory.cjs`'s `_loadMissions()` treated every read failure — a genuinely missing file (`ENOENT`, the legitimate "no history yet" case) **and** a parse/shape failure on an existing, corrupted file — identically: both silently returned a fresh `{missions: [], lastUpdated: ...}` empty store, logging only a single warn-level line for the corruption case. The caller (any of this file's 10 mutation functions, none of which distinguished "genuinely empty" from "corrupted-and-treated-as-empty") then proceeded normally and eventually called `_saveMissions(store)`, which overwrote the corrupted file on disk with a store containing only the store's own single new mutation — permanently destroying every pre-existing mission record, even though the original corrupted file's raw bytes (potentially partially recoverable) were still sitting on disk at that exact moment, one write away from being gone forever.

Live-reproduced in Mission 89 Phase 2 (tests A1/A2, prior to this fix): 5 seeded historical missions were unrecoverably destroyed by both an invalid-JSON corruption and a truncated-JSON corruption, each followed by a single `createMission()` call.

---

## Exact Implementation Change

File: `backend/services/missionMemory.cjs` (the only production file changed).

`_loadMissions()` was restructured to distinguish three cases explicitly, where it previously collapsed all failures into one:

1. **File missing (`ENOENT`)** — unchanged, legitimate behavior: returns a fresh empty store, no throw, no quarantine. This is the correct "no history exists yet" case (e.g., first-ever run).
2. **File exists but a real filesystem error occurs reading it** (permissions, I/O error — distinct from a parse failure) — now throws a typed error (`code: "MISSION_STORE_READ_ERROR"`) rather than silently returning empty. This was not itself part of the reproduced defect but shares the same root architectural gap (treating "can't read the real content" as "there is no content") and is closed by the same restructuring at negligible extra cost.
3. **File exists but is genuinely corrupted** (`JSON.parse` throws, or the parsed result lacks a `missions` array) — a new `_quarantineCorruptedFile(reason)` helper copies (never moves) the corrupted file's exact raw bytes to a uniquely-named, timestamped path (`missions.json.corrupted.<timestamp>.<random>.bak`, in the same directory) via `fs.copyFileSync`, logs an `error`-level line naming the quarantine path, and `_loadMissions()` then throws a typed error (`code: "MISSION_STORE_CORRUPTED"`, carrying `.quarantinePath`) instead of returning an empty store.

No other function in the file was modified. `_saveMissions()`, the lock (`_withMissionsLock`/`_acquireMissionsLock`/`_releaseMissionsLock`), the dedup index, the retention cap, and all 10 mutation functions' own bodies are byte-unchanged — the fix is entirely contained within `_loadMissions()`'s own error-handling branch and one new, purely-additive helper function.

---

## Why Historical Data Can No Longer Be Silently Overwritten

Every one of the 10 mutation functions follows the same shape: `_withMissionsLock(() => { const store = _loadMissions(); /* mutate */ _saveMissions(store); })`. Since `_loadMissions()` now **throws** on genuine corruption instead of returning a value, execution never reaches the mutation logic or the `_saveMissions(store)` call at all — the throw propagates naturally up through the lock's own `finally` block (releasing the lock correctly, confirmed by test A7) and out to the caller, exactly like any other pre-existing validation throw in this file (e.g., `createMission()`'s own `objective`-required check). No code path exists between detecting corruption and a mutation function's `_saveMissions()` call, so the previously-observed overwrite is now structurally impossible, not merely less likely. The original corrupted file is never written to by `_loadMissions()` itself (only read and copied), so it remains byte-for-byte on disk exactly as it was, in addition to the new quarantine copy.

---

## Tests and Repeated-Run Counts

`tests/runtime/55-mission-memory-integrity-reproduction.test.cjs` was extended (describe block "A" renamed from "Mission 89 Phase 2 — A... (reproduction)" to "Mission 89 Phase 3A — A... — FIXED") from 2 tests to **7 tests**:

- **A1** (invalid JSON): asserts `createMission()` now throws with `code: "MISSION_STORE_CORRUPTED"`, the original corrupted file is byte-for-byte untouched, exactly one quarantine file is created containing the exact corrupted bytes, and the thrown error references that quarantine file.
- **A2** (truncated JSON): same assertions via a distinct corruption shape.
- **A3** (new): valid-JSON-wrong-shape (`{notMissions: ...}`) also throws with the same code and quarantine guarantee, exercised via a read function (`listMissions`), not just a mutation.
- **A4** (new): after a corruption throw, restoring a valid file allows historical mission IDs to be read back normally — proving the underlying store itself was never touched by the failed attempt, and there is no stuck/poisoned cache preventing recovery once the file is fixed.
- **A5** (new): valid `missions.json` continues to work with zero behavior change across `createMission`/`updateMission`/`addSubtask`/`listMissions`/`getMission` — the common case is untouched.
- **A6** (new): a genuinely missing file is confirmed NOT to trigger quarantine or a throw — the legitimate empty-store case is preserved exactly as before.
- **A7** (new): the lock is confirmed released (not left held) after a corruption-triggered throw inside `_withMissionsLock()`, and a subsequent, repaired mutation succeeds quickly (not blocked by any leftover lock state).

**Run 1:** 15/15 pass (full file, all describe blocks A-G plus Z).
**Run 2:** 15/15 pass.
**Run 3:** 15/15 pass.

Deterministic across all 3 runs — no flakiness. (Note: the file's other describe blocks — B/C/D/E/F/G — cover Mission 89's other, still-unfixed findings, correctly unaffected by this phase's narrowly-scoped change; B1 in particular still confirms the orgId-reassignment defect remains present, as expected since it is explicitly out of scope for Phase 3A.)

### Regression Suite

Combined run of Mission 40, 43, 44, 51, 52, 54 (55 tests total): **55/55 pass.** No regression caused by the `_loadMissions()` restructuring — every existing mutation, dedup, lock, concurrency, and admission-guard test continues to pass unchanged.

---

## Real-Data Preservation Evidence

- SHA-256 before: `7965d7c99aa5d772b241c75078821c6eaa42f1658a2ea9d340bb0f3589c9a1eb`
- SHA-256 after: **identical**
- mtime before/after: `1788725402` (unchanged)
- size before/after: `40843016` bytes (unchanged)
- No `.lock`, `.tmp`, or `.corrupted.*.bak` artifact present in the real `data/` directory at any point — every test operates against an isolated `mkdtempSync` fixture (via the existing `buildIsolatedMissionMemory()` helper), never the real file.

---

## Exact Files Changed

- `backend/services/missionMemory.cjs` — production fix, 2 hunks (both scoped to `_loadMissions()` and its new `_quarantineCorruptedFile()` helper).
- `tests/runtime/55-mission-memory-integrity-reproduction.test.cjs` — test file, describe block "A" extended from 2 to 7 tests (existing B-G blocks and the final data-integrity check untouched).
- `reports/MISSION-89-PHASE-3A-P0-CORRUPTION-FIX.md` — this report, new.

`backend/services/agentRuntimeSupervisor.cjs` was **not modified** — its working-tree diff remains exactly the same 10 pre-existing P1-1 hunks, confirmed via `git diff | grep -c "^@@"` = 10. `tests/runtime/44-agent-timer-consolidation.test.cjs` remains untracked and untouched.

---

## Git Diff Summary

```
 M backend/services/agentRuntimeSupervisor.cjs   (pre-existing P1-1 only — untouched by this phase)
 M backend/services/missionMemory.cjs            (+98/-40 across 2 hunks — the P0 fix)
?? reports/MISSION-89-PHASE-2-REPRODUCTION.md     (prior phase's deliverable, still untracked)
?? tests/runtime/44-agent-timer-consolidation.test.cjs   (pre-existing P1-1 test, untouched)
?? tests/runtime/55-mission-memory-integrity-reproduction.test.cjs   (extended this phase)
```

`git diff --stat`:
```
 backend/services/agentRuntimeSupervisor.cjs | 220 ++++++++++++++++++++++++----
 backend/services/missionMemory.cjs          |  98 +++++++++++--
 2 files changed, 278 insertions(+), 40 deletions(-)
```
(The `agentRuntimeSupervisor.cjs` line count reflects its pre-existing, unrelated P1-1 diff only — zero lines of this phase's own work touch that file.)

---

## STOP

Per instruction: not staged, not committed, not pushed, not deployed. Awaiting explicit review before any git operation.
