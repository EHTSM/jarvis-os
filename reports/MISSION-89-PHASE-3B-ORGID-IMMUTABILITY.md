# Mission 89 Phase 3B — P1 OrgId Ownership Reassignment Fix

**Status:** IMPLEMENTED, TESTED, NOT COMMITTED. Awaiting explicit review/approval before staging.
**Scope:** Fixes ONLY the confirmed P1 orgId-reassignment defect. Builds on Phase 3A's uncommitted P0 corruption fix (same file, non-overlapping hunks). No other Mission 89 finding (lock ownership, terminal-status inconsistency, `withMissionsLock()` scope) was touched.

---

## Confirmed Defect (Recap)

`updateMission(id, { orgId: "org-B" })` previously succeeded silently and durably reassigned a mission's org ownership — reproduced live in Mission 89 Phase 2 (test B1) for the top-level `orgId` field, and (test B2) for the `metadata.orgId` convention used by `organizationService.cjs`'s `createMissionForOrg()`. During Phase 3B's own inspection, this was additionally confirmed **externally reachable**, not merely an internal risk: `backend/routes/phase27.js:238` calls `mm.updateMission(req.params.id, req.body)`, passing an HTTP request body directly as the patch with no field allowlist.

---

## Implementation

File: `backend/services/missionMemory.cjs`, `updateMission()` only.

1. **Top-level `orgId`**: added directly to the existing `IMMUTABLE` field set (`id, createdAt, orgId, subtasks, decisions, artifacts, failures, deployments, approvals, learnings, timeline, metrics`) — the same set already protecting `id`/`createdAt`/etc. from patching, so `orgId` in a patch is now silently ignored exactly like those fields already are, with zero new architecture.

2. **`metadata.orgId`**: since `metadata` itself must remain a legitimately patchable top-level field (existing production callers — `agentRuntimeSupervisor.cjs`'s tester tick, `engineeringOrg.cjs`'s QA tick — replace the whole `metadata` object to add fields like `verified`/`qaVerified`), blanket-immutabilizing `metadata` was not an option. Instead, when a patch supplies a `metadata` object AND the mission already has a `metadata.orgId` value, the merge now preserves the **existing** `metadata.orgId` regardless of what the incoming patch's `metadata.orgId` says — every other field in the patched metadata object still applies exactly as the caller intended. If the mission has no prior `metadata.orgId` (never org-scoped via that convention), a patch may still set it for the first time — immutability applies only to reassigning an already-established value, matching the mission's own framing ("immutable **after creation**").

No other function, no dedup logic, no lock logic, no terminal-status logic, and no autonomous-admission logic was touched. `agentRuntimeSupervisor.cjs` was not modified at all.

---

## Tests

`tests/runtime/55-mission-memory-integrity-reproduction.test.cjs`'s describe block "B" was rewritten from 2 tests (which pinned the old, buggy behavior) to **6 tests** proving the fix, matching the mission's own lettered requirements A-F:

- **B-A**: an org-A mission's `orgId` cannot be changed to org-B; the call does not throw (silently ignored, matching `id`/`createdAt`'s existing treatment) and the returned mission still shows `org-A`.
- **B-B**: a completely fresh `getMission()` read (not just the `updateMission()` return value) confirms `org-A` persists.
- **B-C**: the raw on-disk JSON confirms `org-A` persists — proving enforcement at the persistence layer, not merely an in-memory/return-value artifact.
- **B-D**: a patch that happens to include the mission's own current `orgId` (a same-value no-op) does not block other legitimate fields (e.g., `priority`) in the same patch from applying.
- **B-E**: both org-scoping conventions (top-level `orgId` and `metadata.orgId`) remain protected; a legitimate metadata field addition (the exact `{...existing, verified: true}` pattern already used in production) still fully applies while `orgId` stays protected; and a mission with no prior `metadata.orgId` can still have it set for the first time.
- **B-F**: a full sequence of legitimate mutations across multiple APIs (`updateMission`, `addSubtask`, `updateSubtask`, `recordDecision`) continues to work normally, with `orgId` unaffected throughout.

### Repeated-Run Results

Full suite (`55-mission-memory-integrity-reproduction.test.cjs`, all describe blocks A-G plus Z, now 19 tests total after Phase 3A's 15 + Phase 3B's 6 replacing the prior 2):

- **Run 1:** 19/19 pass.
- **Run 2:** 19/19 pass.
- **Run 3:** 19/19 pass.

Deterministic across all 3 runs. Phase 3A's own "A" block (corruption fix, 7 tests) remains green and unaffected by this phase's changes — confirmed in the same run.

### Regression Suite

Combined run of Mission 40, 43, 44, 51, 52, 54 (55 tests total): **55/55 pass.** No regression — dedup (`_effectiveOrgId()`/`_getDedupIndex()`) reads `orgId` only at `createMission()` time, never through `updateMission()`, so it is structurally unaffected by this fix; the admission guard and lock tests are likewise untouched since neither reads or writes `orgId` via `updateMission()`.

---

## Real-Data Preservation Evidence

- SHA-256 before: `7965d7c99aa5d772b241c75078821c6eaa42f1658a2ea9d340bb0f3589c9a1eb`
- SHA-256 after: **identical**
- mtime before/after: `1788725402` (unchanged)
- size before/after: `40843016` bytes (unchanged)
- No `.lock`, `.tmp`, or `.corrupted.*.bak` artifact present in the real `data/` directory. Every test operates against an isolated `mkdtempSync` fixture via the existing `buildIsolatedMissionMemory()` helper.

---

## Git Status / Diff

```
 M backend/services/agentRuntimeSupervisor.cjs   (pre-existing P1-1 only — untouched by this phase)
 M backend/services/missionMemory.cjs            (cumulative Phase 3A + 3B: +136/-44 across 4 hunks)
?? reports/MISSION-89-PHASE-2-REPRODUCTION.md
?? reports/MISSION-89-PHASE-3A-P0-CORRUPTION-FIX.md
?? tests/runtime/44-agent-timer-consolidation.test.cjs   (pre-existing P1-1 test, untouched)
?? tests/runtime/55-mission-memory-integrity-reproduction.test.cjs   (extended this phase)
```

`git diff backend/services/missionMemory.cjs | grep -c "^@@"` = 4 (2 from Phase 3A's corruption fix, unchanged; 2 new hunks strictly scoped to `updateMission()` for this phase).

`git diff backend/services/agentRuntimeSupervisor.cjs | grep -c "^@@"` = 10 — confirmed identical to every prior mission's verification; this phase did not touch the file at all.

---

## STOP

Per instruction: not staged, not committed, not pushed, not deployed. Awaiting explicit review before any git operation.
