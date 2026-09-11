# CIVILIZATION MISSION 107 — COUNCIL MEMBER REFERENTIAL-INTEGRITY FIX

**Date:** 2026-09-09
**Branch:** `security/reality-completion`
**HEAD:** `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged — no commit performed)

**STATUS: CERTIFIED**

All 7 certification conditions verified below with direct evidence.

---

## STEP 1 — Baseline

| Item | Value |
|---|---|
| HEAD | `77f1cc0b421269134a2126d90caa4e2f078736dd` |
| `git status --short` path count (before) | 73 |
| P1-1 diff vs `7c229a52` | 222 lines |
| `data/civilization/council.json` SHA-256 | `cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0` |
| `data/civilization/registry.json` SHA-256 | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` |
| `data/civilization/economy.json` SHA-256 | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` |
| Council member count | 10 |
| Council proposal count | 0 |
| `.git/index.lock` | Present, stale — **not touched** |

**The 10 dangling Category-C member IDs (unchanged, Mission 106's exact set):**
```
cmem_1782947457869_9hmp, cmem_1782947457900_uugc, cmem_1786794118702_otlk,
cmem_1786794118708_sygy, cmem_1787773129264_7leg, cmem_1787773129696_u93u,
cmem_1787773303640_4gmd, cmem_1787773308756_wg9o, cmem_1788870971587_s7cw,
cmem_1788870973077_jj2d
```
All 3 hashes and the 10-ID set confirmed identical to Mission 106's own final figures — zero
drift between missions.

---

## STEP 2 — Write-contract trace

- `backend/services/civilizationState.cjs:167` — `function getMember(id) { return _reg().members.find(m => m.id === id) || null; }` — an **existing, already-exported** (line 949) shared lookup, already used elsewhere in the same file (e.g. `updateMember`).
- `backend/services/civilizationState.cjs:197` — `addCouncilMember()`, the exact function Mission 106 identified as performing zero validation.
- `backend/routes/civilizationOrg.js:48` — `router.post("/civ/v9/council/members", (req, res) => { const r = _st().addCouncilMember(req.body); return res.status(r.ok?201:400).json(r); })` — the route derives its HTTP status **entirely** from `addCouncilMember()`'s own `ok` field, with no independent validation of its own. **This means the narrowest correct fix location is inside `addCouncilMember()` alone — fixing the route file is not necessary, since it has no separate logic to fix.**
- Existing error convention in this file: `{ ok: false, error: "<message>" }`, confirmed consistent across ~20 other functions in the same file (`registerMember`, `formAlliance`, `voteOnProposal`, `contributeToPool`, etc.).
- Existing tests: `tests/runtime/civ-v9.test.cjs`'s `addCouncilMember — ok` / `— duplicate blocked` / `— second member` tests already always pass a real, previously-registered `memberA.id`/`memberB.id` — they never exercised the invalid-memberId path, which is why this gap existed with no failing test to reveal it.

**No shared referential-integrity helper beyond `getMember()` was needed or invented** — this is a direct reuse of an existing function, not a new mechanism.

---

## STEP 3 — TDD (test written and run BEFORE the fix)

Created `tests/runtime/civilization-council-referential-integrity.test.cjs` — 5 isolated test
cases (`JARVIS_TEST_DATA_SUFFIX` set before any `require()`, following the same convention
`civilizationState.cjs` already honors — no real `data/civilization/*.json` file is ever read or
written by this test).

**Run against the pre-fix code — result: 2 of 5 tests FAILED, exactly as expected:**

```
✔ CASE A — a valid, existing registry memberId succeeds
✖ CASE B — a non-existent memberId is deterministically rejected
  AssertionError: true !== false
  (pre-fix addCouncilMember() returned {ok:true} for a fabricated, non-existent memberId)
✔ CASE B2 — an empty-string memberId is still rejected by the pre-existing 'memberId required' check
✔ CASE C — the fix does not touch or require repair of pre-existing dangling records
✖ CASE D — the HTTP route cannot bypass the invariant (real Express app, real route, real request)
  AssertionError: route must return 400 for a non-existent memberId, got 201
```

This confirms the test suite targets the exact Mission 106 defect and live-reproduces it through
both the direct function call (CASE B) and a real HTTP round-trip through a real Express server
mounting the actual route handler shape (CASE D) — not merely a unit-level assertion.

---

## STEP 4 — Exact fix

**File changed: `backend/services/civilizationState.cjs`, one function, +8/-0 lines** (the file's
overall working-tree diff also includes a pre-existing, unrelated `DATA_DIR`/`JARVIS_TEST_DATA_SUFFIX`
hunk from an earlier concurrent Gap Closure session — already present and read by this session
during Missions 105/106's investigation, not touched or altered by this mission):

```diff
 function addCouncilMember({ memberId, role = "representative", votingWeight = 1, mandate = "permanent" } = {}) {
   if (!memberId) return { ok: false, error: "memberId required" };
+  // Mission 107 fix: this previously accepted any memberId with no check
+  // against the registry, which is how Mission 106's 10 permanently-
+  // dangling council.json records were created (proven: none of their
+  // memberIds ever resolved against any registry snapshot). Reuses the
+  // existing getMember() lookup already used elsewhere in this file —
+  // no new validation mechanism, no registry mutation, no side effect on
+  // existing council records (this only gates NEW writes).
+  if (!getMember(memberId)) return { ok: false, error: "memberId not found in registry" };
   const cou = _cou();
   if (cou.members.find(m => m.memberId === memberId && m.status === "active"))
     return { ok: false, error: "Already a council member" };
```

- Reuses the existing `getMember()` function — no new lookup mechanism.
- Follows the existing `{ok:false, error:"..."}` convention exactly.
- Performs no registry mutation, no placeholder-member creation, no side effect on `council.json`'s
  existing data — it only gates the write path for *new* `addCouncilMember()` calls.
- The HTTP route requires no code change — it already forwards `addCouncilMember()`'s `ok` field
  1:1 into its HTTP status, so the fix closes the route automatically (verified in Step 3/5's
  CASE D, a real Express+HTTP test, not an assumption).

---

## STEP 5 — Tests after fix

**New regression test — 5/5 passing:**
```
✔ CASE A — a valid, existing registry memberId succeeds
✔ CASE B — a non-existent memberId is deterministically rejected
✔ CASE B2 — empty-string memberId still rejected by pre-existing check
✔ CASE C — pre-existing dangling records untouched by the new validation
✔ CASE D — the HTTP route cannot bypass the invariant (real server, real request)
tests 5, pass 5, fail 0
```

**Existing council test — unaffected, still 115/115 passing:**
```
tests/runtime/civ-v9.test.cjs
[civ-v9] Results: 115 passed, 0 failed out of 115 tests
```
(This includes the pre-existing `addCouncilMember — ok` / `— duplicate blocked` / `— second
member` tests, all of which already pass real registered members and therefore continue to pass
unmodified against the new validation.)

**Relevant civilization-adjacent regression** (per this mission's own "if a broader safe
regression suite exists, run the relevant subset" instruction — the full `test:runtime`/
`test:security` corpus was **not** run, per this repo's own documented shared-store-mutation risk,
consistent with every prior mission in this chain):
```
tests/runtime/platform-omega.test.cjs   — 111/111 passed
tests/security/23-platform-org-idor.cjs — 15/15 passed
```
Both confirmed unaffected by this fix (neither exercises `addCouncilMember` directly, but both
transitively load `civilizationState.cjs`, so both serve as a load/import-safety check on the
changed file).

---

## STEP 6 — Data integrity

| File | Baseline SHA-256 | Final SHA-256 (after fix + all test runs) | Identical? |
|---|---|---|---|
| `data/civilization/council.json` | `cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0` | `cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0` | **YES** |
| `data/civilization/registry.json` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | **YES** |
| `data/civilization/economy.json` | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` | **YES** |

`resourcePools.global` unchanged (implied by economy.json's identical hash; the file was never
opened for writing by this mission). All 10 pre-existing dangling Category-C records confirmed
**exactly present, unchanged** (re-read after all tests: same 10 IDs, same array length of 10).
**No historical council cleanup occurred** — this mission's own explicit instruction not to delete
the 10 was honored throughout; no deletion code was written or executed. No other civilization file
(`diplomacy.json`, `innovation.json`, `network.json`, `constitution.json`) was opened for writing.

Isolated per-run test scratch directories (`data/civilization.test-<pid>-<ts>/`,
`data/platform.test-<pid>-<ts>/`) created by this mission's own test invocations were confirmed
present immediately after each run (proving isolation genuinely activated) and then deleted as
transient verification scaffolding — 8 directories precisely attributed to this mission's own
process IDs/timestamps, no concurrent-session artifact touched.

---

## Concurrent work / worktree preservation

`git status --short`: 73 pre-existing paths before this mission, 74 after (the +1 is this mission's
own new test file; `civilizationState.cjs`'s modification was already counted in the pre-existing
73, since its unrelated `DATA_DIR` hunk predates this mission). P1-1
(`agentRuntimeSupervisor.cjs`) diff vs `7c229a52` confirmed unchanged at exactly 222 lines, both
before and after. No `.git` operation performed. `.git/index.lock` left untouched.

---

## Recommendation for the separate historical-cleanup mission

Mission 106 already conclusively proved the 10 existing dangling records can never resolve to a
real registry member (checked against every available registry snapshot back to the earliest,
2,526-member pre-Mission-101 state). This mission's fix prevents any *new* such record from being
created, but — per its own explicit "prevention only" scope — does not touch the existing 10.

A future, separately-authorized **Mission 108 (proposed)** could apply the same
backup → hard-preservation-check → atomic-write → post-repair-validation discipline Mission 105
already established for `registry.json`, adapted for `council.json`'s 10 records specifically:
1. Create a timestamped, hash-verified backup of `council.json`.
2. Confirm (re-derive fresh, not trusted from this or Mission 106's report) that the deletion set
   is exactly these 10 IDs and nothing else.
3. Surgically remove them via the same temp-file-then-rename convention.
4. Re-run `civ-v9.test.cjs` and this mission's own new referential-integrity test suite afterward,
   confirming both pass and that `registry.json`/`economy.json` remain untouched.

This mission does not perform that cleanup and does not recommend a timeline for it — only that
the fix landing here is a safe prerequisite (no new dangling records will be created while that
decision is pending).

---

## Deployment / Commit / Push

**NOT PERFORMED.** No PM2 restart, no VPS action, no commit, no push.

---

## FINAL FORMAT

```
CIVILIZATION MISSION 107 STATUS: CERTIFIED
HEAD: 77f1cc0b421269134a2126d90caa4e2f078736dd
WORKTREE: 74 paths (73 pre-existing + this mission's 1 new test file); civilizationState.cjs's diff includes one pre-existing unrelated hunk (DATA_DIR isolation, from an earlier concurrent session) plus this mission's own 8-line addition; P1-1 unchanged at 222
FILES CHANGED: backend/services/civilizationState.cjs (+8/-0, addCouncilMember only); tests/runtime/civilization-council-referential-integrity.test.cjs (new)
ROOT CAUSE: addCouncilMember() never validated memberId against the registry before this fix — confirmed by Mission 106, re-confirmed live here (pre-fix test returned ok:true for a fabricated memberId)
VALID MEMBER TEST: PASS — a real, registered memberId still succeeds (CASE A)
INVALID MEMBER TEST: PASS — a non-existent memberId is now deterministically rejected with {ok:false, error:"memberId not found in registry"} (CASE B)
ROUTE BYPASS TEST: PASS — a real Express server mounting the real route handler shape returns 400 for an invalid memberId and 201 for a valid one (CASE D)
COUNCIL HASH BEFORE: cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0
COUNCIL HASH AFTER: cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0 (IDENTICAL)
REGISTRY HASH BEFORE: bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1
REGISTRY HASH AFTER: bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1 (IDENTICAL)
ECONOMY HASH BEFORE: ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120
ECONOMY HASH AFTER: ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120 (IDENTICAL)
10 DANGLING RECORDS: All 10 confirmed present, unchanged, un-repaired — exactly as Mission 106 left them
HISTORICAL DELETION: NOT PERFORMED (explicitly out of this mission's scope, per instruction)
CONCURRENT WORK: Preserved
DEPLOYMENT: NOT PERFORMED
COMMIT: NOT PERFORMED
PUSH: NOT PERFORMED
REPORT: reports/MISSION-107-COUNCIL-REFERENTIAL-INTEGRITY-FIX.md
NEXT MISSION: Mission 108 (proposed, founder-gated) — Mission-105-style surgical deletion of the 10 now-permanently-orphaned council records, using the same backup/hard-preservation/atomic-write/post-repair-validation discipline
```
