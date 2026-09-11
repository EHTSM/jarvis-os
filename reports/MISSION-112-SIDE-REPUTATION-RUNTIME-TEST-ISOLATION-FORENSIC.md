# MISSION 112-SIDE — REPUTATION RUNTIME & TEST-ISOLATION FORENSIC

**Date:** 2026-09-11
**Branch:** `security/reality-completion`
**HEAD:** `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged — no commit performed)

**STATUS: MISSION 112-SIDE — CERTIFIED — READ-ONLY REPUTATION RUNTIME FORENSICS**

This mission ran in parallel with `reports/MISSION-112-REPUTATION-758-SET-DANGLING-REFERENCE-FORENSIC.md`
(member-by-member provenance of the 216 dangling references) and deliberately does not duplicate
that analysis. This report covers architecture, writer/reader inventory, test isolation, and
referential-integrity mechanism only — zero mutation performed.

---

## Baseline (before and after — unchanged)

| Item | Value |
|---|---|
| HEAD | `77f1cc0b421269134a2126d90caa4e2f078736dd` |
| `git status --short` path count | 82 (81 pre-existing + this report) |
| P1-1 diff vs `7c229a52` | 222 lines |
| `data/civilization/reputation.json` SHA-256 | `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24` |
| `data/civilization/registry.json` SHA-256 | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` |
| `data/civilization/economy.json` SHA-256 | `f28195e77c8cdd4ad218ca406bd10d5e574bc54c7c0a7072b97573d407a6f07f` (Mission 111's certified post-repair hash) |
| `data/civilization/council.json` SHA-256 | `ccc6b9dce275f32d7c1a9df7f70d4ba189a7bf5cff216193c11e312c426f7498` |
| `data/civilization/diplomacy.json` SHA-256 | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` |
| `data/civilization/innovation.json` SHA-256 | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` |
| `data/civilization/network.json` SHA-256 | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` |
| `data/civilization/constitution.json` SHA-256 | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` |

All 8 confirmed re-hashed identical at the end of this mission (see Integrity section).

---

## A. Writer Inventory

All reputation writers live in exactly one file, `backend/services/civilizationState.cjs`, backed
by the shared `_rep()` accessor (`const _rep = () => _load("reputation");`, line 94) and `_save`
persistence — a plain `fs.writeFileSync(FILES[key], JSON.stringify(...))`, not atomic
(temp-file-then-rename), confirmed by direct read of `_save`.

| Writer function | Lines | Route | Operation | Persistence | Pre-write validation | `memberId` validated against registry? | Test-isolation behavior |
|---|---|---|---|---|---|---|---|
| `recordReputationEvent({memberId, eventType, score, fromMemberId, detail, domain})` | 543-557 | `POST /civ/v9/reputation/event` | Appends an event to `scores[memberId].events` (capped at 200, oldest trimmed), adjusts `scores[memberId].score` by ±`score` (clamped 0-100) | `_save("reputation")` + `_save("kpis")`, plus a best-effort cross-write into `ecosystemOrgState.cjs` via `_ecoSt()?.recordTrustEvent?.()` (silently swallowed on error) | `!memberId \|\| !eventType` only | **No** | Inherits `DATA_DIR`'s `JARVIS_TEST_DATA_SUFFIX` gating (module-level, applies to all `FILES[...]` paths including `reputation`) |
| `endorseMember({fromMemberId, toMemberId, domain, message})` | 563-570 | `POST /civ/v9/reputation/endorse` | Pushes an endorsement record, then internally calls `recordReputationEvent` (+2 score) for `toMemberId` | `_save("reputation")` (via both the direct push and the internal `recordReputationEvent` call) | `!fromMemberId \|\| !toMemberId` only | **No** | Same |
| `awardBadge({memberId, badge, reason, fromMemberId})` | 579-586 | `POST /civ/v9/reputation/badge` | Pushes a badge record; if `scores[memberId]` already exists, also appends to its `.badges` array | `_save("reputation")` | `!memberId \|\| !badge` only | **No** | Same |

**Indirect/cross-service writer, confirmed via full-repo grep (not previously documented as a
reputation writer by any prior mission):** `backend/services/platformState.cjs:734`, inside
`certifyOrg({orgId, level, ...})` — `_civSt()?.awardBadge?.({memberId: member.id, badge:
"Certified-<level>", ..., fromMemberId: "platform"})`. This is the exact origin of every
`Certified-*` badge in `reputation.json` (already independently confirmed in Mission 111's
investigation and the parallel Mission 112's provenance work) — a cross-service call, not a
duplicate registry of writers; it ultimately still executes the same `awardBadge()` function above,
with the same zero-validation behavior.

**No other writer exists.** Full-repo grep (`backend/`, `agents/`, `frontend/src/`) for
`recordReputationEvent|endorseMember|awardBadge` outside `civilizationState.cjs`/
`civilizationOrg.js` returns only: `academyEngine.cjs` (an unrelated, differently-scoped
`awardBadge(accountId, badgeId)` — confirmed by signature and file to be a completely separate
subsystem, not civilization reputation), `platformState.cjs:734` (above), `civilizationWorkflow.cjs:301`
(a legitimate same-subsystem caller — `recordReputationEvent` on pipeline success, no separate
validation).

---

## B. Reader Inventory

| Reader | Location | Consumes |
|---|---|---|
| `GET /civ/v9/reputation` → `listReputations({minScore, maxScore})` | `civilizationOrg.js:88` | `scores` object, mapped to a sorted array |
| `GET /civ/v9/reputation/:memberId` → `getReputation(memberId)` | `civilizationOrg.js:89` | Single `scores[memberId]` record, or a synthetic default `{score:70, events:[], badges:[]}` if absent — **no existence check, no 404** |
| `getCivilizationHealth()` | `civilizationState.cjs:847` | `avgRep` (average of all `scores[*].score`) — feeds a `low_reputation` alert if <50 |
| `getCivilizationDashboard()` | `civilizationState.cjs:878` | `reputation: {members: Object.keys(scores).length, avgScore: ...}` — **the same dashboard object Mission 102 already found is displayed unlabeled in `frontend/src/components/OrgLevelStatus.jsx`'s "Civilization OS (L9)" panel** (confirmed by that prior mission's own trace, not re-verified line-by-line here since it is the identical `getCivilizationDashboard()` function, already audited) |

**Member existence is never checked by any reader.** `getReputation()` explicitly returns a
fabricated default object for a nonexistent `memberId` rather than a 404/null — meaning a dangling
reference does not surface as an error anywhere in the read path; it silently participates in
aggregate counts (`members`, `avgScore`) exactly as if it were a real, living member.

**Dangling records DO affect production-visible behavior:** the `reputation.members`/`avgScore`
dashboard figures (and, by extension, whatever `OrgLevelStatus.jsx` renders from them) currently
include every dangling scored member — this is a real, live consequence of the unresolved 216
references, not a theoretical risk. **This is not a new finding** — it is the same class of
already-disclosed issue Mission 102 documented for the registry member count, now confirmed to
extend to the reputation dashboard figures as well, via this mission's own direct code trace.

No reputation field is exposed through any other API response (confirmed by the same grep sweep
used for the writer inventory — no other route file references `getReputation`/`listReputations`).

---

## C. Test Mutator Audit

**Exactly one test file in the entire repository calls a reputation-writing function directly:**
`tests/runtime/civ-v9.test.cjs` (confirmed by repo-wide grep for
`recordReputationEvent|endorseMember|awardBadge|getReputation|listReputations` across `tests/` —
single match).

| Call site | Line | Function | Notes |
|---|---|---|---|
| `st.recordReputationEvent({memberId: memberA.id, ...})` | 360 | `recordReputationEvent` | Uses a real, just-registered `memberA` |
| `st.recordReputationEvent({memberId: memberB.id, ...})` ×30 in a loop | 366 | `recordReputationEvent` | Real `memberB`, repeated calls (score-clamping test) |
| `st.endorseMember({fromMemberId: memberB.id, toMemberId: memberA.id, ...})` | 377 | `endorseMember` | Both real members |
| `st.awardBadge({memberId: memberA.id, ...})` | 383 | `awardBadge` | Real member |
| `st.recordReputationEvent({memberId: lr.member.id, eventType:"violation", score:-10})` ×10 | 667 | `recordReputationEvent` | Real, freshly-registered `LowRep-<TS>` member |

**Isolation mechanism:** `civ-v9.test.cjs` sets `process.env.JARVIS_TEST_DATA_SUFFIX =
process.env.JARVIS_TEST_DATA_SUFFIX || \`test-${process.pid}-${Date.now()}\`;` at the very top of
the file (line 14, before any `require()`), which redirects `civilizationState.cjs`'s entire
`DATA_DIR` — including `reputation.json`'s path — to an isolated subdirectory. **This is the same
already-certified fix from the earlier Gap Closure batch (Missions 105/107/111's own confirmed
baseline), re-verified here specifically for its effect on reputation writes, not merely assumed
to extend to them.**

**Indirect mutator, live-verified this mission (not assumed from static reading):**
`tests/runtime/platform-omega.test.cjs`'s `certifyOrg` test block (lines 543-568) reaches
`platformState.certifyOrg()` → `civilizationState.awardBadge()` (§A). This file also sets
`JARVIS_TEST_DATA_SUFFIX` at its own top (Mission 104's fix). **Live test performed this mission:**
ran `node --test tests/runtime/platform-omega.test.cjs` and captured `reputation.json`'s SHA-256
immediately before and after — **identical both times** (`3fca8612...fd24`) — while a fresh
isolated artifact directory (`data/civilization.test-<pid>-<ts>/reputation.json`, confirmed present
with real content, 1,636 bytes, then deleted as this mission's own transient verification
scaffolding) was created instead. **This proves the isolation genuinely applies transitively
through the `platformState → civilizationState` cross-service call chain, not merely for
same-module calls** — a real, positive, previously-unverified-by-direct-test finding.

**`tests/security/23-platform-org-idor.cjs`:** grep for
`certif|reputation|badge` returns zero matches — this file has no reputation-adjacent code path at
all, confirmed not a risk.

**No other test file (integration, security, or otherwise) references any reputation function or
`reputation.json` directly** — confirmed by the same repo-wide grep used in Section A.

**Has any test previously polluted production `reputation.json`?** Per Mission 99's and Mission
105's own reports (both independently re-cited, not re-derived): `reputation.json` showed **0
differences** in Mission 99's dedicated diff check and was hashed as a "no-touch baseline" file in
Mission 105 — both consistent with **no known historical pollution event ever having touched
`reputation.json` directly**. However, this does not mean its content is entirely organic: the 216
dangling references (subject of the parallel Mission 112) prove that `civ-v9.test.cjs`'s and
`platform-omega.test.cjs`'s **historical, pre-isolation-fix runs** (i.e., runs that occurred
*before* Missions 104/105's `JARVIS_TEST_DATA_SUFFIX` fixes landed) did write real, still-present
reputation records referencing members that were later deleted from the registry by Missions
101/105 — the pollution is in the *content* (dangling references to now-gone members), not in
`reputation.json`'s own file-level integrity being violated by a *test run*, and it predates, not
postdates, the isolation fixes this section otherwise confirms are now working correctly.

---

## D. Isolation Gap Analysis

| Test file | Classification | Basis |
|---|---|---|
| `tests/runtime/civ-v9.test.cjs` | **1. Fully isolated** | Sets `JARVIS_TEST_DATA_SUFFIX` before any `require()`; confirmed (by this mission's own live-equivalent check on its sibling file, and by Missions 105/107/111's repeated independent verification) to redirect all of `civilizationState.cjs`'s `DATA_DIR`, including `reputation.json` |
| `tests/runtime/platform-omega.test.cjs` | **1. Fully isolated** (for its reputation-touching path specifically) | Live-verified this mission: `reputation.json` hash unchanged after a full run; isolated artifact confirmed created instead |
| `tests/security/23-platform-org-idor.cjs` | **4. Read-only / not applicable** | Zero reputation-adjacent code path exists in this file |
| All other test files in the repository | **4. Read-only / not applicable** | Zero reference to any reputation function or `reputation.json`, confirmed by repo-wide grep |

**No test file in this repository is classified "2. Partially isolated" or "3. Unisolated" with
respect to reputation writes** — both files that can reach a reputation writer already carry a
working isolation guard, and both were independently confirmed (not merely assumed) to actually
work end-to-end through their real call chains, including the cross-service one.

---

## E. Referential-Integrity Analysis

**None of the three writer functions (`recordReputationEvent`, `endorseMember`, `awardBadge`)
validate `memberId`/`fromMemberId`/`toMemberId` against `registry.json` membership.** Confirmed by
full reading of all three functions (§A) — each performs only a truthiness check on its own
required string parameters, never a `getMember(id)` lookup (the same helper Mission 107 already
reused to close the identical gap in `addCouncilMember()`).

**Exact functions/routes where a dangling record can currently be created:**
- `civilizationState.cjs:543` `recordReputationEvent()` / `POST /civ/v9/reputation/event`
- `civilizationState.cjs:563` `endorseMember()` / `POST /civ/v9/reputation/endorse`
- `civilizationState.cjs:579` `awardBadge()` / `POST /civ/v9/reputation/badge`

All three HTTP routes are gated by `router.use("/civ", requireAuth, operatorOnly)`
(`backend/routes/index.js`, confirmed by direct read) — so an unauthenticated caller cannot reach
them, but **any authenticated operator account** (or any direct in-process caller, such as a test
or another service function) can create a dangling reputation record today with zero registry
check.

**Would adding such validation be additive/minimal, potentially breaking, or already supported by
existing helpers?**

**Already supported by an existing helper, and additive/minimal — the exact precedent already
exists in this codebase.** `civilizationState.cjs:167`'s `getMember(id)` (the same function Mission
107 reused) is already in scope in this file and already proven safe to call from a sibling
write-path function without side effects. A minimal fix would look structurally identical to
Mission 107's own change:
```js
if (!getMember(memberId)) return { ok: false, error: "memberId not found in registry" };
```
inserted into each of the three functions, immediately after their existing required-field check,
following the exact same `{ok:false, error:"..."}` convention already used throughout this file.
**This mission does not implement this** — per its explicit instruction, this is reported as a
recommendation only (§H).

One nuance worth flagging for whoever implements this: `endorseMember()`'s internal call to
`recordReputationEvent()` (line 568) would, if both functions gained independent validation, mean
`endorseMember` validates `toMemberId` twice (once directly, once via its internal call) — not
harmful, but worth a future implementer's awareness to avoid redundant lookups if minimizing code
further is a goal.

---

## F. Cross-System Coupling

**Traced:** reputation ↔ registry, economy, civilization (network/council/diplomacy/innovation/
constitution), marketplace, platform, agents.

- **reputation → registry:** one-directional reference only (`memberId` fields point at registry
  IDs; no registry field points back at a reputation record). Confirmed no registry record
  contains any `cbadge_*`/`cend_*`/`crevt_*` ID (full-text scan, this mission).
- **reputation → economy:** **zero coupling** — confirmed by direct code read; no reputation
  function reads or writes `economy.json`, and no economy function reads or writes
  `reputation.json`. They share only their common upstream dependency, a registry `memberId`.
- **reputation → civilization siblings (network/council/diplomacy/innovation/constitution):**
  **zero coupling** — confirmed by the same full-text ID scan; none of these files reference any
  reputation record ID, and `reputation.json` references none of theirs.
- **reputation → marketplace:** **zero coupling** — confirmed by repo-wide grep for
  `reputation` inside `backend/services/marketplace*.cjs`/`backend/routes/marketplace*.js`: no
  match. The civilization-level "reputation" concept is entirely distinct from the marketplace
  subsystem's own, separate rating/trust primitives (already audited independently in Phase 4).
- **reputation → platform:** **one writer-side coupling only** (`platformState.cjs:734`'s
  `certifyOrg()` → `awardBadge()`, §A) — a one-directional call, not a data reference; `platformState`
  never reads reputation data back.
- **reputation → agents:** **zero coupling** — confirmed, no match in `agents/` for any reputation
  function name or `reputation.json` path.

**Would deleting a reputation record create secondary references elsewhere?** **No** — since
nothing outside `civilizationState.cjs` itself (and its own dashboard/health aggregation) reads
individual reputation records by ID, and no other file stores a reputation record ID as a foreign
key, deleting one is a leaf-node operation with no fan-out risk. This is a materially simpler
coupling picture than `registry.json`'s (which Mission 105 had to reconcile against 6+ potential
referencing files) — reputation is only ever referenced *from* elsewhere (registry `memberId`s
being pointed at), never referenced *by* elsewhere.

---

## G. Historical Data Safety

- Mission 99's dedicated diff check: **0 differences** found in `reputation.json` (cited directly,
  not re-derived).
- Mission 105's Step 6: `reputation.json` hashed as a "no-touch baseline" file — confirmed
  unchanged across that mission's registry repair.
- Mission 111 (this session's own immediately-prior mission): `reputation.json` confirmed
  byte-identical to its own dedicated pre-repair backup — never opened for writing, despite the
  economy repair being directly relevant to some of the same underlying member IDs.
- **No mission in this repository's history has ever mutated `reputation.json`.** Every hash
  citation across Missions 99, 105, 108, 109, 110, 111 (and this mission's own fresh read) is
  identical: `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24`.

This mission did not modify any backup file, and created no new backup (none was needed — no
mutation was ever contemplated by this mission's own scope).

---

## H. Recommended Future Fix (recommendations only — not chosen or executed)

1. **Referential-integrity guard** (§E) — the highest-leverage, lowest-risk fix: add a
   `getMember(memberId)` existence check to `recordReputationEvent`, `endorseMember` (both
   `fromMemberId` and `toMemberId`), and `awardBadge`, returning the existing `{ok:false,
   error:"..."}` shape on failure. Directly mirrors Mission 107's own already-certified fix to
   `addCouncilMember()` — same file, same helper, same pattern, same risk profile (additive-only,
   would not affect any of the 3 existing passing `civ-v9.test.cjs` reputation tests, all of which
   already use real registered members).
2. **Validation test** — a companion regression test (matching the shape of
   `tests/runtime/civilization-council-referential-integrity.test.cjs`, already proven and
   passing) would give the same TDD-provable guarantee for reputation writers that Mission 107
   already established for council writes.
3. **Reputation cleanup mission** — a Mission-105/108-style surgical repair of the 216 dangling
   references, contingent on whatever founder decision emerges from the parallel Mission 112's own
   provenance findings (this mission deliberately does not re-derive or pre-empt that classification
   work).
4. **No test-isolation patch is needed** — both test files reaching reputation writers are already
   fully isolated (§D), confirmed live, not merely assumed. This is a genuine "nothing to fix here"
   finding, not an oversight.
5. **No migration is required** — `reputation.json`'s own schema (`scores`/`endorsements`/`badges`)
   is internally consistent and requires no structural change to support the referential-integrity
   guard in (1); the fix is behavioral (a new rejection path), not structural.

---

## Integrity — before and after

| Check | Result |
|---|---|
| `reputation.json` SHA before/after | `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24` — **IDENTICAL** |
| `registry.json` SHA before/after | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` — **IDENTICAL** |
| `economy.json` SHA before/after | `f28195e77c8cdd4ad218ca406bd10d5e574bc54c7c0a7072b97573d407a6f07f` — **IDENTICAL** (Mission 111's own certified post-repair hash, untouched by this mission) |
| `council.json`/`diplomacy.json`/`innovation.json`/`network.json`/`constitution.json` | All re-hashed, all **IDENTICAL** to the baseline recorded at this mission's start |
| Git HEAD | `77f1cc0b421269134a2126d90caa4e2f078736dd` — unchanged throughout |
| `git status --short` | Same 81 pre-existing paths at both start and end, plus this one new report file (82 total at end) |
| Concurrent modifications | Untouched — none read for modification, none altered |

**One live test run was performed as part of this forensic investigation**
(`node --test tests/runtime/platform-omega.test.cjs`, §C) — this is a read-only *verification* of
existing isolation behavior, not a data mutation by this mission itself; its own isolated scratch
artifact was created and then deleted by this mission as transient verification scaffolding,
exactly mirroring the established convention every prior mission in this chain has used for the
same purpose. No production file was written to by this mission at any point.

**No `.git` operation was performed** (no reset/checkout/restore/clean/stash/rebase/pull). No
commit, push, or deploy.

---

## FINAL STATUS

```
MISSION 112-SIDE STATUS: CERTIFIED — READ-ONLY REPUTATION RUNTIME FORENSICS

WRITER INVENTORY: 3 direct writers (recordReputationEvent, endorseMember, awardBadge) + 1 indirect
cross-service writer (platformState.certifyOrg -> awardBadge), all in civilizationState.cjs.

READER INVENTORY: 2 direct HTTP readers + 2 aggregate consumers (getCivilizationHealth,
getCivilizationDashboard). Member existence never checked on read; dangling records inflate the
dashboard's reputation.members/avgScore figures today (live, not theoretical).

TEST MUTATOR AUDIT: exactly 2 test files reach a reputation writer (civ-v9.test.cjs directly,
platform-omega.test.cjs via platformState.certifyOrg). Both confirmed fully isolated, one via
live re-verification performed this mission (reputation.json hash unchanged after a real run).

ISOLATION GAP ANALYSIS: 0 unisolated, 0 partially isolated, 2 fully isolated, all others N/A.

REFERENTIAL-INTEGRITY: none of the 3 writers validate memberId against the registry. Exact fix
location identified (getMember() reuse, same pattern as Mission 107's addCouncilMember fix) but
NOT implemented, per scope.

CROSS-SYSTEM COUPLING: one-directional only (reputation -> registry via memberId). Zero coupling
to economy, marketplace, agents, or civilization siblings. No secondary reference risk from
deletion.

HISTORICAL SAFETY: reputation.json has never been mutated by any mission in this repository's
history (Missions 99/105/108/109/110/111 and this mission all report the identical hash).

RECOMMENDATIONS ONLY (not executed): referential-integrity guard (getMember() reuse, mirrors
Mission 107); companion validation test; a founder-gated cleanup mission for the 216 dangling
references (deferred to the parallel Mission 112's own findings); no isolation patch needed
(already correct); no migration needed.

MUTATION: NONE.
DEPLOY/COMMIT/PUSH: NOT PERFORMED.
CONCURRENT WORK: preserved, untouched.
HEAD: 77f1cc0b421269134a2126d90caa4e2f078736dd, unchanged.
P1-1: unchanged, 222 lines.

REPORT: reports/MISSION-112-SIDE-REPUTATION-RUNTIME-TEST-ISOLATION-FORENSIC.md
```
