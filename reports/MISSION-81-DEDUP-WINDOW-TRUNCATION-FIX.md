# MISSION 81 — DEDUP-WINDOW-TRUNCATION P0 FIX

**Date:** 2026-09-03
**Branch:** `security/reality-completion`
**Predecessors:** Mission 81 forensics passes 1 and 2 (Timer/Loop Attribution Forensics; VPS Lead-Mission Backlog Verification) — both read-only, no code changes.

> **No commit, no push, no VPS deployment, no PM2 restart, no data/missions.json deletion or truncation, no mission status change beyond two pre-existing tests' own established cleanup convention (see "Data/Process Confirmation" below).**

---

## Root Cause (exact)

`backend/services/businessIntelligenceEngine.cjs`'s `_recentlyTriggered(entityType, entityId, signalType)` — the 24-hour duplicate-mission guard in front of `_triggerMission()` — called:

```js
mm.listMissions({ since, limit: 500 })
```

`backend/services/missionMemory.cjs`'s `listMissions()` filters by `since`, sorts the result **newest-first**, then applies `.slice(0, limit)`. This is correct only while the true number of missions inside the `since` window stays under `limit`. Once real volume in that window exceeds 500, the truncation silently drops **older-but-still-inside-the-window** rows before `_recentlyTriggered()`'s own `.some()` predicate ever sees them — including, potentially, the very same lead's own prior trigger.

**Verified against real data (both forensics passes):**
- At the real Aug 27 incident's peak, **~3001 missions existed in one trailing-24h window** — 6× the 500-row limit.
- **3550 genuine `signalType:"lead_idle"` missions** exist across **488 distinct leads** — average 7.5 duplicates per lead.
- Worst-case lead (`lead_1784810737006_a2aa1f`): **71 duplicate missions**, gaps as small as **1.3 seconds**, only **1 of 71** ever reached `completed`.
- 95% of the entire backlog (3390/3550) was created **after** the dedup mechanism itself was added (commit `7ab28f57`, 2026-08-05) — the dedup logic was never disabled or reverted; it was structurally defeated by unrelated mission-volume growth crowding its own lookback window.

A separate, unrelated fix (`P0-2`, commit history already on this branch, `missionMemory.cjs`'s `createMission()`) added a create-time dedup index keyed on exact `orgId::objective` text. That fix is real and complementary but does **not** repair `_recentlyTriggered()`'s own broken existence check — and, as a new finding from this session, is **stricter than intended for this specific rule**: since all 3550 lead-idle missions share one byte-identical objective string (`"[Auto] Follow up immediately — leads idle >7 days convert 80% less frequently"` — confirmed: `distinct_objective_texts = 1` across all 3550 rows), P0-2's `orgId::objective` key would silently block a *second, genuinely different* lead's follow-up mission from ever being created while any other lead's identically-worded mission is still non-terminal — a different, entity-blind correctness gap P0-2 does not address and this mission's fix does not touch (P0-2 was not modified). `_recentlyTriggered()` remains the only mechanism that correctly keys on `entityId`, which is why fixing it directly (rather than relying on P0-2 alone) was the correct target.

---

## Fix

### Files changed

| File | Change |
|---|---|
| `backend/services/missionMemory.cjs` | Added new exported function `hasMissionMatching(opts)`. `listMissions()` is **completely unmodified** — same signature, same behavior, same `.slice(0, limit)` truncation, verified by regression test scenario H. |
| `backend/services/businessIntelligenceEngine.cjs` | `_recentlyTriggered()`'s body changed from a `listMissions({since, limit:500})` + `.some()` call to a single `mm.hasMissionMatching({since, predicate})` call. No other function in this file was touched. |

### Design

`hasMissionMatching({ since, orgId, predicate })` (new, `missionMemory.cjs`):
- Requires `since` (throws if missing/invalid) and `predicate` (a function; throws if missing) — this function exists specifically for bounded-window existence checks, never an unbounded full-store scan.
- Filters by `since` and, if supplied, exact `orgId` — reusing the exact same semantics `listMissions()` already has for both (same `m.orgId === orgId` exact-match, same ISO-`since`-vs-`createdAt` comparison).
- **No `limit` parameter exists on this function at all** — there is no row count it is allowed to silently stop scanning at.
- Iterates the store directly and **returns `true` the moment the predicate first matches** (short-circuit) — no array is built, no per-row shallow copy (`{...m}`) is made, and the common case (a match exists and is found quickly, since it's typically the newest or a recent row) does no more work than a single `Array.prototype.some()` over the since-filtered set — never worse than the code it replaces for realistic (<500-row) loads, and now also correct for loads above that.
- Returns a plain `boolean`, not `{missions[], total}` — the caller never needed mission objects, so none are allocated.

`_recentlyTriggered()` (`businessIntelligenceEngine.cjs`) now calls `hasMissionMatching()` with the identical predicate logic it always had (`metadata.autoTriggered && entityType && entityId && signalType` match) — no behavioral change to *what* counts as a duplicate, only to *how completely* the store is searched for one. `orgId` is deliberately **not** passed (this rule's missions have never carried an `orgId`, and this fix does not add org-scoping that didn't exist before — see "Why this cannot reintroduce cross-tenant leakage" below for why that's safe).

### Why the preferred design (over a bigger `limit`) was chosen

Per the mission's own explicit instruction, raising `limit: 500` to a larger constant was rejected — it would still leave a correctness dependency on an arbitrary number, and per the verified incident data (volume crossed 6× the old limit within roughly two weeks of accumulation), any fixed constant is only a matter of time from being crossed again. `hasMissionMatching()` has no such ceiling by construction.

A generic `noLimit`/`unlimited` flag added directly to `listMissions()` was considered and rejected in favor of a separate function: `listMissions()` has 74 existing internal consumers per its own header comment, and any flag threaded through its single shared code path risks an accidental default change affecting all of them. A new, narrowly-scoped function cannot regress `listMissions()`'s behavior by construction — proven directly by regression scenario H, which confirms `listMissions()`'s own truncation is byte-for-byte unchanged.

---

## Why this cannot reintroduce cross-tenant leakage

- `hasMissionMatching()`'s `orgId` filter is **exact-match only**, with **no fallback to unscoped missions** — identical to `listMissions()`'s own pre-existing `opts.orgId` filter (same file, same convention, same header-comment guarantee: "returns ONLY missions with that exact orgId... never falls back to unscoped/global missions, and never returns another org's").
- Regression scenario G proves this directly: a query for `orgId: "org_A"` against a fixture containing only an `org_B`-owned matching mission returns `false`; the same query with `orgId: "org_B"` returns `true`; an unscoped query (no `orgId`, matching `_recentlyTriggered()`'s own actual call shape) also returns `true` — three assertions covering wrong-org-rejected, right-org-accepted, and unscoped-preserved in one test.
- `_recentlyTriggered()` itself was **already unscoped before this fix** (it never received or passed an `orgId` — confirmed by reading the pre-fix source directly) and remains unscoped after this fix — this change does not add, remove, or alter any tenant-isolation boundary on this call site. Widening its scope to add org-awareness would be a separate, larger change this mission's rules ("do not remove legitimate mission creation," minimal-fix scope) correctly place out of bounds.
- No other file, route, or middleware was touched — `orgMiddleware.cjs`, `requireOrgMember`, `attachOrg`, and every other tenant-isolation control in the codebase are untouched by this fix.

---

## Tests

### New: `tests/runtime/44-mission-dedup-window-truncation.test.cjs` — 11/11 pass

Uses `node:test`'s built-in `mock.method(fs, ...)`, the exact same technique already established in this codebase for `missionMemory.cjs` (`tests/runtime/mission-memory-stats-malformed-record.test.cjs`) — scoped only to `missions.json`'s exact path, real `fs` calls for everything else. **Zero writes to the real `data/missions.json`** at any point (confirmed: file mtime unchanged before/after this test's run — see "Data/Process Confirmation").

| # | Scenario | Result |
|---|---|---|
| A | ≤500 missions in the 24h window → duplicate still found | ✔ |
| B | >500 missions in the 24h window → match at position >500 (oldest-first) still found | ✔ |
| C | 1000+ newer unrelated missions crowd the window → dedup still returns `true` | ✔ |
| D | Matching mission outside the 24h window → dedup returns `false` | ✔ |
| E | Different lead/entity → `false` | ✔ |
| F | Different `signalType` → `false` | ✔ |
| G | Org isolation: wrong org `false`, right org `true`, unscoped (real call shape) `true` | ✔ |
| H | `listMissions({limit:500})` itself is provably unchanged — same 500-row cap, same inability to see the older target past 500 newer rows (proves the fix lives in the new function, not a silent change to the old one) | ✔ |
| I | `hasMissionMatching()` returns a plain boolean — no per-row copy allocation | ✔ |
| I (validation) | Missing `since`/`predicate`/invalid `since` all throw clear errors | ✔ |
| **Incident reproduction** | 550 newer unrelated missions + the real worst-offender lead ID's prior trigger placed 20h back (still in-window) → `hasMissionMatching()` with `_recentlyTriggered()`'s exact predicate shape correctly reports `true` | ✔ |

### Regression (pre-existing, unmodified by this fix) — all pass

| Test | Result | Note |
|---|---|---|
| `tests/runtime/mission-memory-stats-malformed-record.test.cjs` | 4/4 pass | Same fs-mock technique this fix's new test follows; confirms `missionMemory.cjs`'s other read paths unaffected. |
| `tests/runtime/43-mission-storage-dedup.test.cjs` | 8/8 pass | P0-2's `createMission()` dedup index — confirms this fix (which never touches `createMission()`) left it fully intact. |
| `tests/runtime/40-mission-dedup-and-recovery.test.cjs` | 8/8 pass | `agentRuntimeSupervisor.cjs`'s own, separate `_missionExists()` dedup — confirms unaffected. |
| `tests/security/13-mission-memory-race-verification.cjs` | 2/7 pass (pre-existing failure, unrelated) | **Verified pre-existing**: re-ran with this session's entire diff `git stash`ed out — fails identically (in fact with higher, more variable over-counts, confirming it is a flaky concurrent-write race test, not a regression from this fix). Not caused by, or related to, this change. |

**`node --check`**: `backend/services/missionMemory.cjs` — OK. `backend/services/businessIntelligenceEngine.cjs` — OK. New test file — OK.

Only focused tests were run — no full corpus, no CI triggered, per this mission's instruction.

---

## Diff Stat

```
 backend/services/businessIntelligenceEngine.cjs | 29 ++++++---
 backend/services/missionMemory.cjs              | 79 +++++++++++++++++++++++++
 2 files changed, 101 insertions(+), 7 deletions(-)
```

New file: `tests/runtime/44-mission-dedup-window-truncation.test.cjs` (untracked, not yet added).

---

## Data/Process Confirmation

- **`data/missions.json`**: total mission count unchanged at 9702 before and after this session's work. `data/missions.json`'s mtime was unchanged (`Sep 3 06:02:04 2026`) after the new fs-mocked test ran, and only advanced (to `Sep 3 14:40:02 2026`) after running the two **pre-existing** regression suites (`43-mission-storage-dedup.test.cjs`, `40-mission-dedup-and-recovery.test.cjs`), which is those tests' own already-established, already-accepted convention (create a handful of prefixed test missions, mark them `cancelled` in a `_cleanup()` step) — not something newly introduced by this fix, and not a truncation, deletion, or status change to any of the real 9702 pre-existing missions. No mission belonging to the real lead-idle backlog (or any other real mission) had its status changed.
- **No mission was deleted.** **No existing backlog mission's status was changed.**
- **No commit, no push** — `git log --oneline -1` still shows `d7bfc7f1` (unchanged) at the end of this session.
- **No PM2 restart, no VPS action** — no PM2 process for `jarvis-os` exists on this machine (confirmed both at the start of the forensics passes and again at the end of this fix); nothing was started, stopped, or restarted.
- **ERA-2/Stripe**: not touched — no file under that scope was read or modified this session.
- **Business Intelligence was not disabled** — `INTELLIGENCE_RULES`, `scan()`, `scanLeads()`, and every other public function in `businessIntelligenceEngine.cjs` are unchanged; only `_recentlyTriggered()`'s internal implementation (a private helper, not part of the module's public API) was modified.
- **Legitimate mission creation was not removed** — a genuinely new, not-recently-triggered signal for any lead/deal/customer/campaign still creates a mission exactly as before; only the existence check that decides "recently" is now correct at any real volume.

---

## Known Pre-existing Limitation / Follow-up

`_recentlyTriggered()` has historically **not filtered terminal mission statuses** (`completed`/`failed`/`cancelled`) out of its duplicate-existence check — a mission for a given lead+signal counts as "recently triggered" regardless of whether it is still active or has already reached a terminal state.

This behavior **predates Mission 81** and was confirmed by direct historical inspection of commit `7ab28f57` (2026-08-05), the commit that originally introduced `_recentlyTriggered()`: it is a pure addition (28 insertions, 0 deletions) with no prior implementation to compare against, and its original predicate never referenced `m.status` in any form. `listMissions()`'s own `status` filter is `opts`-gated and was never invoked at this call site (no `status` key was ever passed). Mission 81 **deliberately preserves the original predicate semantics unchanged** and only replaces the underlying capped-scan primitive (`listMissions({since, limit:500})` → `hasMissionMatching({since, predicate})`) — it does not add, remove, or alter status handling in any way.

**Live-data inspection of the real `data/missions.json` (2026-09-03) found:**
- 3,550 `lead_idle` missions total
- 18 terminal (6 `completed`, 12 `failed`, 0 `cancelled`)
- 10 entityIds with both a terminal and a non-terminal `lead_idle` mission
- 0 of those overlaps fall inside the current 24-hour dedup window
- 0 confirmed suppressions (no case where a terminal mission was still within 24h of a subsequent non-terminal mission's creation)
- Closest historical terminal→non-terminal gap: **≈24.18 hours** (`lead_1784810737006_a2aa1f`) — just outside the window in every observed case; the next-closest gaps cluster at ≈25.3–26.1h, then jump to ≈97.6h+

**Therefore this is a separate, LOW-priority follow-up and is explicitly NOT part of Mission 81's scope.** Mission 81 remains strictly the >500-row dedup-window truncation fix. **This limitation is not fixed by Mission 81** — it is a real, open gap in `_recentlyTriggered()`'s predicate that should be addressed by its own dedicated, separately-scoped fix (with its own root-cause writeup, its own terminal-status test fixtures, and its own live-data verification) rather than folded into this commit.

---

## Stop Condition

Per this mission's explicit instruction: **STOP after validation.** No commit was made. No push was made. No VPS deployment was performed. The fix is validated, tested, and ready for the next explicit step (commit/deploy), which requires separate authorization.
