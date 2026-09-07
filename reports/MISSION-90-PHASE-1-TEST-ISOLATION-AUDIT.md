# Mission 90 Phase 1 — Test Isolation Audit

**Status:** RECONNAISSANCE ONLY. No production code, test, or report other than this one was modified. No real data touched. No commit. No unsafe test was executed.

---

## 1. Scope

Audit every test in the repository that can directly or indirectly mutate the real `data/missions.json` through the production `missionMemory.cjs` singleton (or transitively via `missionOrchestrator.cjs`, which internally requires it). Classify risk, document existing safe patterns, and produce a migration plan. No fixes in this phase.

---

## 2. MissionMemory Dependency Inventory

| Test | Dependency | Mutation | Isolation | Real Data Risk | Concurrency | Action |
|---|---|---|---|---|---|---|
| `tests/runtime/09-c9-ai-experience-honesty.test.cjs` | None (reads `missionMemory.cjs` source as text only) | No | N/A | None | Safe | None needed |
| `tests/runtime/10-c10-cross-system-closure.test.cjs` | Direct `require()` of real path (multiple call sites) | Yes | None | **High** | Already serialized (`MISSION_MUTATING`) | Migrate |
| `tests/runtime/30-b20-chaos-recovery.test.cjs` | Direct `require()` of real path | Conditional (`if (!fs.existsSync(MISSIONS))`, self-cleans) | Partial (conditional + self-cleanup) | **Low in practice** (real file always pre-exists on this repo), but real design gap | Not serialized | Migrate |
| `tests/runtime/40-mission-dedup-and-recovery.test.cjs` | `buildIsolatedMissionMemory()` (Mission 82 helper) | Yes, isolated | Full | None | Safe | None needed |
| `tests/runtime/41-blocker-resolution-recursion-guard.test.cjs` | Direct `require()` of real path | Yes | None | **High** | Already serialized | Migrate |
| `tests/runtime/42-autonomous-boot-gate.test.cjs` | Direct `require()` of real path, but read-only (`getMissionStats()`) | No | N/A | None | Safe (already excluded from `MISSION_MUTATING` by design) | None needed |
| `tests/runtime/43-mission-storage-dedup.test.cjs` | `buildIsolatedMissionMemory()` | Yes, isolated | Full | None | Safe | None needed |
| `tests/runtime/44-mission-dedup-window-truncation.test.cjs` | Direct `require()` of real path, but `fs.statSync`/`readFileSync` mocked for that path; **never calls a mutation function** | No (read-path-only exercised) | Full (via fs mocking, not module copy) | None | Safe | None needed (different valid pattern) |
| `tests/runtime/47-p0-autonomous-feedback-loop-fix.test.cjs` | `_buildIsolatedRepo()` (local variant) | Yes, isolated | Full | None | Safe | None needed |
| `tests/runtime/49-p0-guard-integration.test.cjs` | `_buildIsolatedGuardAndMemory()` (local variant) | Yes, isolated | Full | None | Safe | None needed |
| `tests/runtime/51-mission-memory-write-lock.test.cjs` | `_buildIsolatedRepo()` (local variant) | Yes, isolated, cross-process (fork) | Full | None | Safe | None needed |
| `tests/runtime/52-mission-memory-concurrency-stress.test.cjs` | `_buildIsolatedRepo()` (local variant) | Yes, isolated, cross-process (fork) | Full | None | Safe | None needed |
| `tests/runtime/54-autonomous-admission-concurrency.test.cjs` | `_buildIsolatedRepoPaths()` (local variant) | Yes, isolated, cross-process (fork) | Full | None | Safe | None needed |
| `tests/runtime/55-mission-memory-integrity-reproduction.test.cjs` | `buildIsolatedMissionMemory()` + local `_buildIsolatedRepoPaths()` | Yes, isolated, cross-process (fork) | Full | None | Safe | None needed |
| `tests/runtime/mission-memory-stats-malformed-record.test.cjs` | Direct `require()` of real path, but `fs.statSync`/`readFileSync` mocked; never calls a mutation function | No (read-path-only exercised) | Full (via fs mocking) | None | Safe, **but genuinely undocumented as such** | Document/confirm only |
| `tests/runtime/p14-knowledge-network.test.cjs` | None (comment-only reference) | No | N/A | None | Safe | None needed |
| `tests/runtime/p18-scientific-discovery.test.cjs` | **No `require()` of `missionMemory.cjs` at all** — raw `fs.writeFileSync` directly to the real `data/missions.json` path, bypassing the module entirely | **Yes — unconditional, permanent, every run** | **None** | **Highest** | Not serialized, not even acknowledged | **Migrate — highest priority** |
| `tests/runtime/mission-orchestrator-nodetypes.test.cjs` | Transitive via `missionOrchestrator.cjs`'s own `_getMem()` | Yes (indirect) | None | **High** | Already serialized | Migrate |
| `tests/runtime/approval-queue-engine.test.cjs` | Transitive via `missionOrchestrator.cjs` | Yes (indirect) | None | **High** | Already serialized | Migrate |
| `tests/integration/09-v1-engine-validation.test.cjs` | Transitive via `missionOrchestrator.cjs`'s `createManual()` | Yes (indirect) | None | **High — previously undocumented, not in `MISSION_MUTATING`, not run by `test:runtime`/`test:security` at all** | **Unserialized, uncatalogued** | **Migrate** |
| `tests/security/13-mission-memory-race-verification.cjs` | Direct `require()` of real path | Yes | None | **High** | Already serialized | Migrate |
| `tests/security/18-mission-runtime-lifecycle.cjs` | Direct `require()` of real path | Yes | None | **High** | Already serialized | Migrate |
| `tests/security/52-runtime-stability-fixes.cjs` | Direct `require()` of real path | Yes | None | **High — already confirmed live-colliding** (this session, Missions 84/87/88) | Already serialized | Migrate |
| `tests/security/76-mission-store-retention-cap.cjs` | None (reads source text only, structural) | No | N/A | None | Safe | None needed |
| `tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs` | Direct `require()` of real path | Yes | None | **High** | Already serialized | Migrate |
| `tests/security/126-m4-memory-os-cross-tenant-read-idor.cjs` | None — uses `memoryPersistenceLayer.cjs`, a **different** store, not `missionMemory.cjs` | N/A for this store | N/A | None (for missions.json specifically) | Out of this mission's scope | None needed (flag for a future, separate audit of `memoryPersistenceLayer.cjs`) |

---

## 3. Confirmed Real-Data Mutators

Independently verified (source inspection, not assumption) as capable of writing to the real `data/missions.json`:

1. `tests/runtime/10-c10-cross-system-closure.test.cjs`
2. `tests/runtime/30-b20-chaos-recovery.test.cjs` (conditional)
3. `tests/runtime/41-blocker-resolution-recursion-guard.test.cjs`
4. `tests/runtime/p18-scientific-discovery.test.cjs` (unconditional, raw `fs.writeFileSync`, bypasses `missionMemory.cjs` entirely)
5. `tests/runtime/mission-orchestrator-nodetypes.test.cjs` (transitive)
6. `tests/runtime/approval-queue-engine.test.cjs` (transitive)
7. `tests/integration/09-v1-engine-validation.test.cjs` (transitive, previously uncatalogued)
8. `tests/security/13-mission-memory-race-verification.cjs`
9. `tests/security/18-mission-runtime-lifecycle.cjs`
10. `tests/security/52-runtime-stability-fixes.cjs`
11. `tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs`

**11 confirmed mutators total** — 7 more than the 4 identified in Mission 89 Phase 3D.

---

## 4. The Four Previously Observed Mutators

Mission 89 Phase 3D ran, and observed a real-data hash change from, exactly these 4 files: `30-b20-chaos-recovery.test.cjs`, `41-blocker-resolution-recursion-guard.test.cjs`, `42-autonomous-boot-gate.test.cjs`, `mission-memory-stats-malformed-record.test.cjs`.

Independently re-verified from current source in this phase:

- **`41-blocker-resolution-recursion-guard.test.cjs`** — genuinely mutates via direct `require()` + real `createMission()`/`updateMission()` calls (line 34 confirms the direct require; the test body creates and updates real missions to exercise recursion-guard logic). **Confirmed real mutator.**
- **`30-b20-chaos-recovery.test.cjs`** — genuinely can mutate, but **only conditionally** (`if (!fs.existsSync(MISSIONS))`, i.e. only on a fresh checkout with no pre-existing file) and **self-cleans** when it does (filters out its own seeded mission and rewrites the file). On this repository's actual current state (a 40MB+, 9,700+-mission real file), this condition never triggers. **Confirmed technically capable, but the specific hash change observed in Phase 3D was NOT primarily attributable to this file's own mutation path** — more likely attributable to its OTHER writes (raw tmp/foreign-file fixtures at lines 28/44/60-61, which are scoped to non-`missions.json` filenames and cleaned up in `finally` blocks) having no lasting effect, or simply to the other 3 files in the same run.
- **`42-autonomous-boot-gate.test.cjs`** — **re-verified as read-only**: it requires the real path but only calls `getMissionStats()` (a pure read, never `_saveMissions()`). **This file could NOT have caused the hash change.** Its presence in Phase 3D's "4 tests" list is accurate as "ran alongside the other 3 in the same batch," not as an independent contributor to the mutation.
- **`mission-memory-stats-malformed-record.test.cjs`** — **re-verified as read-only via fs mocking**: `fs.statSync`/`fs.readFileSync` are mocked for any path ending in `missions.json`, and the test never calls a mutation function. **This file could NOT have caused the hash change either** — it is provably incapable of touching the real file, by the same mechanism already relied upon by `44-mission-dedup-window-truncation.test.cjs`.

**Correction to Phase 3D's finding**: of the 4 files actually run, only **`41-blocker-resolution-recursion-guard.test.cjs`** is unconditionally, confirmedly responsible for real mutation; `30-b20-chaos-recovery.test.cjs` is conditionally capable but did not trigger its mutating branch on this run (the real file already existed); `42-autonomous-boot-gate.test.cjs` and `mission-memory-stats-malformed-record.test.cjs` are both read-only and structurally incapable of the observed hash change. This is a materially more precise finding than Phase 3D's own report, which treated all 4 as equally responsible.

---

## 5. Additional Unisolated Candidates (Not Run During Mission 89, Not Yet Cataloged)

These were **not** executed during Mission 89 (correctly, since Mission 89 stopped once the non-isolation pattern was noticed) and must **not** be run until migrated:

- `tests/runtime/10-c10-cross-system-closure.test.cjs` (already known, in `MISSION_MUTATING`)
- `tests/runtime/p18-scientific-discovery.test.cjs` — **highest-priority**: unconditional, permanent, raw-`fs.writeFileSync` pollution of the real store, not even mediated by `missionMemory.cjs`'s own validation/atomic-write path. Its own sibling test's header comment documents that this exact fixture already caused one real, live-reproduced production defect (a malformed record shape that crashed `getMissionStats()` elsewhere in the corpus, fixed separately in Micro-Mission 16).
- `tests/runtime/mission-orchestrator-nodetypes.test.cjs`, `tests/runtime/approval-queue-engine.test.cjs` — transitive mutators via `missionOrchestrator.cjs`, already in `MISSION_MUTATING` (serialized, but not isolated).
- `tests/integration/09-v1-engine-validation.test.cjs` — transitive mutator, **previously uncatalogued**: not in `MISSION_MUTATING`, and `tests/integration/` is not covered by `npm run test:runtime`/`test:security` at all (per CLAUDE.md §9), meaning this file's real-data risk has likely never been surfaced to any automated gate.
- `tests/security/13-mission-memory-race-verification.cjs`, `tests/security/18-mission-runtime-lifecycle.cjs`, `tests/security/52-runtime-stability-fixes.cjs`, `tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs` — all already known, in `MISSION_MUTATING`.

---

## 6. Existing Isolation Patterns

- **Mission 82's shared helper** (`tests/runtime/_isolatedMissionMemory.helper.cjs`): `buildIsolatedMissionMemory()` — `mkdtempSync` + copies `missionMemory.cjs` and `backend/utils/logger.js` into matching relative paths, then `require()`s the copy. Returns `{memory, root, missionMemoryPath, missionsFile, cleanup()}`. Directly reusable for any test that only needs same-process mutation (no forking).
- **Local `_buildIsolatedRepo()`/`_buildIsolatedRepoPaths()` variants** (Missions 47/49/51/52/54/55): same underlying technique, either returning a `require()`'d instance (same-process) or bare file paths (for `fork()`-based cross-process tests). These are near-duplicates of the shared helper with minor extensions (e.g., also copying `autonomousMissionGuard.cjs`) — candidates for future consolidation, though each documents its own reason for not reusing the shared helper directly.
- **fs-mocking pattern** (`44-mission-dedup-window-truncation.test.cjs`, `mission-memory-stats-malformed-record.test.cjs`): `mock.method(fs, "statSync"/"readFileSync", ...)` intercepts reads for any path ending in `missions.json`, with a monotonically-increasing fake mtime to defeat the read-through cache. Valid **only** for tests that never call a mutation function (since `writeFileSync`/`renameSync` are not intercepted) — correctly used by both files, since both only exercise read-side logic.
- **Self-cleaning conditional-mutation pattern** (`30-b20-chaos-recovery.test.cjs`'s last test): mutate only if the real file doesn't exist, and reverse the mutation in a `finally` block. Weaker than true isolation (still touches the real path when its precondition is met) but bounded and self-aware.

---

## 7. Migration Plan

| # | File | Isolation Strategy | Helper Reuse | Forked-Process Handling | Expected Regression Coverage |
|---|---|---|---|---|---|
| 1 | `tests/runtime/p18-scientific-discovery.test.cjs` | Replace raw `fs.writeFileSync(missionsPath, ...)` seeding with `buildIsolatedMissionMemory()` + real `createMission()` calls against the isolated copy; point `selfImprovementEngine.discoverPatterns()`'s scan target at the isolated path (may require a small, narrowly-scoped seam if that function hardcodes the real path — needs Phase 2 inspection) | Shared helper, if `discoverPatterns()` accepts an injectable path or module instance; otherwise the local-variant pattern | No | Confirms hypothesis-generation logic without ever touching real data |
| 2 | `tests/runtime/10-c10-cross-system-closure.test.cjs` | Extract the 5 `missionMemory`-touching call sites (lines ~1188-3215) to use `buildIsolatedMissionMemory()` per-test | Shared helper | No (no forking observed for these specific call sites) | Preserves existing auth/org-scoping assertions unchanged |
| 3 | `tests/runtime/41-blocker-resolution-recursion-guard.test.cjs` | Replace direct `require()` with `buildIsolatedMissionMemory()` | Shared helper | No | Preserves recursion-guard depth/metadata assertions |
| 4 | `tests/runtime/mission-orchestrator-nodetypes.test.cjs` | Isolate both `missionMemory.cjs` and `missionOrchestrator.cjs` together (local variant, matching Mission 49's `_buildIsolatedGuardAndMemory()` precedent, since `missionOrchestrator.cjs` itself needs to resolve the isolated `missionMemory.cjs` via its own internal require) | Local variant (two-file copy) | No | Preserves node-type/workflow assertions |
| 5 | `tests/runtime/approval-queue-engine.test.cjs` | Same two-file isolation as #4 | Local variant | No | Preserves approval-queue wiring assertions |
| 6 | `tests/integration/09-v1-engine-validation.test.cjs` | Same two-file isolation as #4 | Local variant | No | Preserves `createManual()` schema assertions; also consider adding this file to `MISSION_MUTATING` immediately as an interim mitigation if full isolation is deferred, since it is currently neither isolated nor serialized |
| 7 | `tests/security/13-mission-memory-race-verification.cjs` | Replace direct `require()` with `buildIsolatedMissionMemory()`; if genuine cross-process racing is the test's intent, use the fork-based local-variant pattern (Mission 86/88 precedent) instead | Shared helper or fork-based local variant, depending on the test's actual intent (needs Phase 2 read of its full body) | Possibly, pending Phase 2 inspection | Preserves race-condition assertions |
| 8 | `tests/security/18-mission-runtime-lifecycle.cjs` | Replace direct `require()` with `buildIsolatedMissionMemory()` | Shared helper | No | Preserves lifecycle-transition assertions |
| 9 | `tests/security/52-runtime-stability-fixes.cjs` | Replace direct `require()` with `buildIsolatedMissionMemory()` — this is the file already confirmed this session to leave 40+ residual "A5.2-TEST subtask persistence" records in the real store from repeated prior runs; migrating it also retroactively stops further residue accumulation | Shared helper | No | Preserves subtask-persistence/dedup/verified-marking assertions — the exact P0-2/A.5.2 regression coverage this file exists for |
| 10 | `tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs` | Replace direct `require()` with `buildIsolatedMissionMemory()`, ensuring org-scoping test fixtures (org-A/org-B) are constructed against the isolated copy | Shared helper | No | Preserves cross-tenant IDOR assertions — must confirm org isolation logic itself is exercised identically against an isolated store |
| 11 | `tests/runtime/30-b20-chaos-recovery.test.cjs` | Lower priority (conditional, self-cleaning) — migrate its one conditionally-mutating test to `buildIsolatedMissionMemory()` for correctness-in-principle, even though it is not currently triggering on this repo's real state | Shared helper | No | Preserves orphan-tmp-sweep assertions |

**Smallest-risk-first ordering** (also serves as the recommended Phase 2 sequence — see §10).

---

## 8. Test Runner Risk

- `npm run test:runtime` (`scripts/run-test-suite.cjs runtime`) auto-discovers every file under `tests/runtime/` (one subdirectory level deep) and already recognizes 12 files (`MISSION_MUTATING.runtime`) as real-store mutators requiring serialization (`--test-concurrency=1`) — this list already includes `10-c10-cross-system-closure.test.cjs`, `40-mission-dedup-and-recovery.test.cjs` (now safely isolated, so its continued presence in this list is now unnecessary but harmless), `41-blocker-resolution-recursion-guard.test.cjs`, `43-mission-storage-dedup.test.cjs` (also now safely isolated), `approval-queue-engine.test.cjs`, `mission-orchestrator-nodetypes.test.cjs`, and 6 organizationService-related files.
- **`npm run test:runtime` does NOT protect `p18-scientific-discovery.test.cjs`** — it is absent from `MISSION_MUTATING` entirely, so it runs in the fully parallel batch alongside every other test, with zero serialization against the concurrent-lost-update race this list exists to prevent, in addition to its own permanent-pollution problem.
- `npm run test:security` (`scripts/run-test-suite.cjs security`) has its own `MISSION_MUTATING.security` list, correctly including `13`, `18`, `52`, `125`. `126` is also listed but touches a different store (`memoryPersistenceLayer.cjs`), not `missionMemory.cjs`.
- **`tests/integration/09-v1-engine-validation.test.cjs` is not run by either `npm run test:runtime` or `npm run test:security`** — `tests/integration/` has its own separate, undiscovered-in-this-audit entry point (per CLAUDE.md §9, integration tests "have their own separate `npm run test:*` entries or must be invoked directly"), meaning this real-data mutator's risk has likely never been evaluated against the `MISSION_MUTATING` serialization concept at all, since that list is scoped only to `runtime`/`security`.
- `tests/runtime/mission-orchestrator-nodetypes.test.cjs` and `tests/runtime/approval-queue-engine.test.cjs` are correctly serialized already but not isolated — running `npm run test:runtime` today is safe from *concurrent* corruption but still permanently writes test-seed missions into the real store on every invocation.

---

## 9. Scope Boundary

Confirmed via `git status --short` and `git diff --stat` (captured identically before and after this audit — see Verification below):

- **No production code changes**: `backend/services/missionMemory.cjs`'s diff is unchanged from the start of this phase (still the cumulative Mission 89 Phase 3A+3B+3C work, 6 hunks).
- **No test changes**: zero test files modified, created, or staged during this phase (only this one report file was created).
- **No real data changes**: `data/missions.json`'s SHA-256/mtime/size are identical before and after this audit.
- **No P1-1 changes**: `backend/services/agentRuntimeSupervisor.cjs`'s diff remains exactly the same 10 pre-existing P1-1 hunks.
- **No Mission 89 fix changes**: all of Mission 89's uncommitted work (corruption fix, orgId immutability, lock ownership fix, and their tests/reports) remains byte-identical and untouched.

---

## 10. Recommended Phase 2 — Ordered Migration Sequence (Smallest-Risk-First)

1. **`tests/runtime/30-b20-chaos-recovery.test.cjs`** — smallest change (one conditionally-mutating test), lowest current real-world risk, good warm-up for the pattern.
2. **`tests/runtime/41-blocker-resolution-recursion-guard.test.cjs`** — single-file isolation swap, no forking, no transitive dependency.
3. **`tests/security/18-mission-runtime-lifecycle.cjs`** — same shape as #2.
4. **`tests/security/125-msn1-mission-runtime-cross-tenant-idor.cjs`** — same shape, slightly more care needed for org-scoping fixture construction.
5. **`tests/security/52-runtime-stability-fixes.cjs`** — same shape; also retroactively stops the already-confirmed residue-accumulation problem in the real store.
6. **`tests/security/13-mission-memory-race-verification.cjs`** — needs a Phase 2 read of its full body first to determine single-process vs. fork-based isolation is appropriate.
7. **`tests/runtime/mission-orchestrator-nodetypes.test.cjs`** and **`tests/runtime/approval-queue-engine.test.cjs`** — two-file (missionMemory + missionOrchestrator) isolation, slightly more involved but same underlying technique.
8. **`tests/integration/09-v1-engine-validation.test.cjs`** — same two-file isolation; also consider whether this file should be added to a `test:integration` script's own future `MISSION_MUTATING`-equivalent list as an interim step if full migration is deferred.
9. **`tests/runtime/10-c10-cross-system-closure.test.cjs`** — largest file (multiple call sites across a very large test file), do last among the "direct/transitive `missionMemory.cjs`" group to apply lessons learned from #1-8.
10. **`tests/runtime/p18-scientific-discovery.test.cjs`** — highest-priority in terms of real-world severity, but placed last in execution order because it requires the most investigation (whether `discoverPatterns()`/`hypothesisEngine.cjs` can accept an injectable data path, or whether the isolation must instead intercept at the `fs` level like `44`/`mission-memory-stats-malformed-record` already do). Recommend a short, dedicated Phase 2 sub-task to resolve this design question before implementing.

---

## Verification

```
git status --short   (before and after this audit — identical)
 M backend/services/agentRuntimeSupervisor.cjs
 M backend/services/missionMemory.cjs
?? reports/MISSION-89-PHASE-2-REPRODUCTION.md
?? reports/MISSION-89-PHASE-3A-P0-CORRUPTION-FIX.md
?? reports/MISSION-89-PHASE-3B-ORGID-IMMUTABILITY.md
?? reports/MISSION-89-PHASE-3C-LOCK-OWNERSHIP-FIX.md
?? reports/MISSION-89-PHASE-3D-FINAL-INTEGRITY-CERTIFICATION.md
?? tests/runtime/44-agent-timer-consolidation.test.cjs
?? tests/runtime/55-mission-memory-integrity-reproduction.test.cjs
```

```
git diff --stat   (before and after this audit — identical)
 backend/services/agentRuntimeSupervisor.cjs | 220 ++++++++++++++++++++++++----
 backend/services/missionMemory.cjs          | 214 +++++++++++++++++++++++++--
 2 files changed, 388 insertions(+), 46 deletions(-)
```

- SHA-256 of `data/missions.json`: `60aae24e5efa2fd25b2c2423196e398048fedc142f0ec0218e76b12bf1dc07e6` — **identical before and after this audit**.
- mtime: `1788736437` — unchanged.
- size: `40831895` bytes — unchanged.
- `git diff backend/services/agentRuntimeSupervisor.cjs | grep -c "^@@"` = 10 — unchanged, same P1-1 hunks.

No file was staged. No commit was created. No unsafe test was executed during this phase — every finding above was derived from static source inspection only.
