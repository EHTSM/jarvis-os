# MISSION 109 — CIVILIZATION ECONOMY BALANCE RECONCILIATION FORENSICS

**Date:** 2026-09-09
**Branch:** `security/reality-completion`
**HEAD:** `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged — no commit performed)

**STATUS: FORENSIC CLASSIFICATION COMPLETE — READ-ONLY, ZERO MUTATION**

Per explicit instruction, this mission stops after classification. No repair, no deletion, no
economy.json rewrite was performed or recommended as an action of this mission.

---

## Baseline (before any analysis)

| Item | Value |
|---|---|
| HEAD | `77f1cc0b421269134a2126d90caa4e2f078736dd` |
| `git status --short` path count | 77 |
| P1-1 diff vs `7c229a52` | 222 lines |
| `data/civilization/economy.json` SHA-256 | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` |
| `data/civilization/registry.json` SHA-256 | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` |
| `data/civilization/council.json` SHA-256 | `ccc6b9dce275f32d7c1a9df7f70d4ba189a7bf5cff216193c11e312c426f7498` |
| Balance keys | 2,377 |
| Trades | 0 |
| `resourcePools.global` | `{"capital": 9950}` |

**Both hashes match Mission 108's final recorded state exactly — zero drift.**

**Sources this mission used as its starting evidence** (re-verified, not blindly trusted):
`reports/MISSION-101-CIVILIZATION-DATA-INTEGRITY-REPAIR.md`,
`reports/MISSION-102-CIVILIZATION-REMAINING-DATA-RECONCILIATION.md`,
`reports/MISSION-105-CIVILIZATION-REGISTRY-SURGICAL-REPAIR.md`,
`reports/MISSION-108-COUNCIL-CATEGORY-C-SURGICAL-REPAIR.md`.

---

## Files and source code inspected (all read-only)

**Data files:** `data/civilization/economy.json` (current), `data/civilization/registry.json`
(current), `data/civilization/economy.json.pre-mission101-repair-backup-20260909T142209Z.json`,
`data/civilization/registry.json.pre-mission101-repair-backup-20260909T142209Z.json`,
`data/civilization/registry.json.pre-mission105-repair-backup-20260909T150116Z.json`.

**Source code:** `backend/services/civilizationState.cjs` (full read of `registerMember`,
`creditResource`, `debitResource`, `proposeTrade`, `acceptTrade`, `contributeToPool`,
`claimFromPool`, `getResourcePool`), `backend/routes/civilizationOrg.js` (route mounting for
balance/pool reads), `backend/services/platformState.cjs` (line ~438, the one non-trade
`creditResource` call site Mission 102 identified), `tests/runtime/civ-v9.test.cjs` (full grep for
every `creditResource`/`debitResource`/`contributeToPool`/`claimFromPool`/trade call).

**Scratch computation (never written to any production path):**
`/private/tmp/claude-501/-Users-ehtsm-jarvis-os/dbc90dbb-a2a9-4cf3-81fb-26a8f42692b1/scratchpad/mission109-758-set.json`,
`.../mission109-replay-result.json`.

---

## A. BALANCES — the 758 orphaned civ-v9-origin keys

### A1. Independent re-derivation of the 758 set

**Total balance keys today: 2,377. Of these:**

| Category | Count | Method |
|---|---|---|
| Resolve to a current registry member | **4** | Exact ID match against `registry.json`'s 4 remaining members — all 4 are the manual-audit-preserved identities (`Victim2 Confidential Agency`, `PlatA-SecretCo`, `PlatA-Blueprint`, `PlatA-Clone`) |
| Orphaned, but existed in **both** pre-Mission-101 and pre-Mission-105 registry snapshots | **1,615** | These are the platform-omega/IDOR-test-attributable members Mission 105 removed — orphaned since Mission 105, not Mission 101 |
| Orphaned, existed in pre-Mission-101 but **not** pre-Mission-105 | **758** | **This is the exact set this mission's brief asks about** — these members were already gone by the time Mission 105 ran, meaning Mission 101 (the civ-v9 repair) removed them |
| Orphaned, unexplained by any of the above | **0** | Full reconciliation: 4 + 1,615 + 758 = 2,377 = total balance-key count, **zero unaccounted** |

This independently reproduces Mission 102's "1,619 + 758 = 2,377" arithmetic with more precision:
Mission 102's "1,619" already included the 4 manual-audit keys (1,615 + 4 = 1,619); this mission
separates them explicitly since the 4 are provably legitimate (preserved, still-resolving), while
the 1,615 are provably platform-omega/IDOR-test pollution (Mission 105's own certified finding).

### A2. Per-key classification (all 758)

Every one of the 758 was checked against 3 independent sources — current registry (no match, by
definition of the set), pre-Mission-105 registry (no match, by definition), pre-Mission-101
registry (match — this is what defines the set) — **no record was classified from timestamp
proximity or ID pattern alone; every classification is an exact ID lookup against an actual
registry snapshot.**

**Sub-classification by trade involvement** (all 758 checked against the 199 completed trades in
the pre-Mission-101 economy backup):

| Sub-group | Count | Classification |
|---|---|---|
| Touched by at least one completed trade | **398** | See A3/B below — **provably reconstructible in principle, but NOT by trade-replay alone** (see honest correction in Part B) |
| Never touched by any completed trade | **360** | **Provably reconstructible — trivially.** Their current balance is byte-identical (all 7 resource fields + `lastUpdated`) to their `registerMember()`-time registry `resources` value, confirmed by direct comparison. Nothing has ever mutated them since creation. |

**Classification against this mission's 4-category taxonomy:**

- **(1) Provably reconstructible:** all 758 — in the sense that the exact source data needed to
  determine their current value (the pre-Mission-101 registry + economy backups) still exists and
  is internally consistent (see B1 below: current values are byte-identical to the pre-101 backup
  for every one of the 758, meaning nothing has drifted since Mission 101).
- **(2) Provably test-generated:** all 758 — every one traces to a registry member that Mission 101
  already forensically proved (via exact `registerOrg`/`registerMember` literal matching in
  `civ-v9.test.cjs`) was test-generated. This mission does not re-litigate that proof; it only
  confirms the corresponding balance keys are the ones left behind.
- **(3) Legitimate but not reconstructible:** none — no member in this set was found to have any
  legitimate, non-test origin.
- **(4) Ambiguous:** none — every one of the 758 resolves unambiguously to a specific, already-proven
  test-generated registry member with an exact ID match, not an inference.

**No record was classified as polluted merely because of test timestamps** — the classification
rests entirely on Mission 101's own already-independently-verified `registerOrg`/`registerMember`
literal-matching proof (re-cited, not re-derived from timestamps by this mission) plus this
mission's own exact-ID cross-referencing against 3 registry snapshots.

---

## B. REPLAY — performed in isolated scratch only, never written to production data

### B1. Baseline consistency check

**All 758 current balance values are byte-identical (all 7 fields + `lastUpdated`) to their
pre-Mission-101 backup values.** Zero drift since Mission 101 — confirmed by direct
`JSON.stringify` comparison of all 758 records between `economy.json` (current) and
`economy.json.pre-mission101-repair-backup-20260909T142209Z.json`. This means the replay question
is not "what changed" but "does the value that has persisted unchanged since Mission 101 reflect
only legitimate, deterministic activity."

### B2. Trade-only replay — performed, and its result is an HONEST NEGATIVE, disclosed in full

**Algorithm:** for each of the 758 keys, initialize a simulated balance from the pre-Mission-101
registry's own `resources` field for that member (the value `registerMember()` would have set at
creation, per direct code reading of `civilizationState.cjs:143,152`), then apply the 199
`status:"completed"` trades from the pre-Mission-101 economy backup, in `resolvedAt` order, using
the exact debit/credit mechanics of `acceptTrade()` (lines 358-369, read in full and reproduced
exactly: offer resources move from→to, request resources move to→from).

**Result:**
- **360 keys (never touched by any trade): exact match, 360/360.** Their simulated (untouched)
  value matches the pre-101 backup exactly, as expected.
- **398 keys (touched by ≥1 completed trade): 0/398 exact match against trade-replay alone.**

**This mismatch is disclosed honestly, not concealed or smoothed over.** Investigating the
mismatch further (not assumed, traced to source): the 398 mismatches resolve into **exactly 3
distinct, uniform delta patterns** (199 + 85 + 114 = 398, not noise) —
`{compute:+850, capital:+400}`, `{compute:+210, knowledge:+870, capital:+50}`, and
`{knowledge:+870, capital:+50}`. **Root cause, confirmed by direct code reading:**
`tests/runtime/civ-v9.test.cjs` contains **23 additional direct `creditResource()`/
`debitResource()`/`contributeToPool()`/`claimFromPool()` call sites** (lines 195-266, 729 — grep-
confirmed, full list in this mission's file-inspection log above) that grant/consume resources for
that run's own `memberA`/`memberB`/`memberC` **completely outside the trades system** — e.g.
`st.creditResource(memberA.id, "compute", 500, "setup")` before a trade test, or
`st.creditResource(memberA.id, "capital", 500, "setup")` before the pool-contribution test. Since
`memberA`/`memberB`/`memberC` are always the first 3 members registered in a given test run, and
every run repeats the identical sequence of setup credits, this produces the exact same 3 uniform
deltas across all 199 test runs — consistent with the root cause, not contradicting it.

**Honest conclusion: a trade-only replay does NOT fully reconstruct the 398 trade-touched keys'
current values.** A complete, fully deterministic replay would additionally need to model these 23
direct credit/debit call sites' exact amounts and ordering per test run — this is **mechanically
possible in principle** (the call sites and their fixed literal amounts are fully visible in
`civ-v9.test.cjs`'s source, and the number of runs is inferable from the 199-trade count divided by
however many trades each run creates), **but this mission did not build that fuller replay model**,
since the mission's own scope was to attempt trade replay specifically and report the result
honestly — not to iteratively expand the model until it matches. **This is reported as: replay
partially succeeds (360/758, 47.5%) by the stated trade-only method; the remaining 398 (52.5%) are
still provably test-generated (via the registry-membership proof, independent of replay), but their
exact value is not reconstructed by this mission's replay — only by a fuller model a future mission
could build using the 23 identified call sites as its additional input.**

### B3. Exact algorithm and source records used (for reproducibility)

1. Source: `economy.json.pre-mission101-repair-backup-20260909T142209Z.json`'s `trades` array,
   filtered to `status === "completed"` (199 of 597).
2. Source: `registry.json.pre-mission101-repair-backup-20260909T142209Z.json`'s `members[].resources`
   field, for the 758 target IDs, as the simulated starting balance.
3. Applied in `resolvedAt` timestamp order (matching real execution order).
4. Transfer mechanics: exact reproduction of `civilizationState.cjs:358-369`'s `acceptTrade()` logic.
5. Compared post-replay simulated values against the same backup's actual `balances[id]` values
   (7 numeric fields; `lastUpdated` excluded from comparison since replay does not simulate
   wall-clock time).

---

## C. RESOURCE POOLS — `resourcePools.global`

### C1. Writer/reader trace (re-verified independently across the WHOLE codebase, not just civ-v9.test.cjs)

`grep -rl "contributeToPool|claimFromPool|resourcePools"` across `backend/`, `agents/`,
`frontend/src/` returns exactly **2 files**: `backend/services/civilizationState.cjs` (the sole
owner/mutator) and `backend/routes/civilizationOrg.js` (read-only route mounting for
`GET /civ/v9/economy/pool/:poolId` → `getResourcePool`). **No other file in the entire repository
reads or writes this structure.**

### C2. Does a transaction ledger exist?

**No — CONFIRMED BY CODE, re-verified by direct read of `contributeToPool`/`claimFromPool`/
`getResourcePool` (lines 388-409, quoted in full):**
```js
function contributeToPool({ memberId, resourceType, amount, poolId = "global" } = {}) {
  ...
  eco.resourcePools[poolId][resourceType] = (eco.resourcePools[poolId][resourceType] || 0) + amount;
  _save("economy");
  return { ok: true, pool: eco.resourcePools[poolId] };
}
function claimFromPool({ memberId, resourceType, amount, poolId = "global", reason = "" } = {}) {
  ...
  pool[resourceType] -= amount;
  creditResource(memberId, resourceType, amount, `pool_claim:${poolId}`);
  ...
}
```
Both functions mutate a bare running total (`eco.resourcePools[poolId][resourceType]`) with `+=`/
`-=` only. **No array append, no history object, no per-contribution record, no reference back to
which `memberId` produced which portion of the total.** `getResourcePool` returns only the current
aggregate. This is a structural absence, not a missing feature that could be found with more
searching — there is no ledger anywhere in this codebase for this data.

### C3. Can the current value be reconstructed?

**No — CONFIRMED BY CODE.** With no per-contribution history anywhere (not in `economy.json`, not
in any log file, not in any other data file — the 6-file cross-sweep in Missions 102/105/106 found
zero references to `resourcePools` outside `civilizationState.cjs`/`civilizationOrg.js`), there is
no way to decompose the current `9950` into "legitimate portion" vs "test-generated portion." The
pre-Mission-101 backup shows the **identical** value (`{"capital": 9950}`) — meaning Mission 101's
own trade-record deletion had zero effect on this figure (pool contributions are a fully separate
code path from trades), so even the earliest available snapshot offers no decomposition clue.

### C4. Is any portion provably test-generated?

**Partially traceable, not fully decomposable.** `civ-v9.test.cjs` itself calls
`contributeToPool(+100 capital)` then `claimFromPool(-50 capital)` once per test run (net +50/run,
confirmed by direct code read of the test file's own pool-test block, lines 254-266) — this proves
**some** portion is test-generated, but the exact fraction of `9950` this represents cannot be
isolated, because (per C2/C3) there is no way to distinguish a civ-v9-run's +50 net contribution
from any other caller's contribution once they're summed into one running total. Mission 102 already
flagged this as UNRESOLVED (not enough historical civ-v9 runs to explain the full total by
themselves) — re-verified true by this mission's own independent code reading, not newly resolved.

### C5. Is deletion/reconciliation safe?

**No safe automatic reconciliation exists.** Any correction to `resourcePools.global` would
necessarily be an estimate or an explicit reset, not a proof-backed reconstruction — this mission
does not recommend either, consistent with its own read-only, no-mutation scope.

---

## D. DATA INTEGRITY (read-only checks, current live `economy.json`)

| Check | Result |
|---|---|
| Duplicate balance keys | **0** — JSON object keys are inherently unique; 2,377 keys confirmed distinct by construction. |
| Malformed records (missing required numeric field or `lastUpdated`) | **0** — all 2,377 records have all 7 numeric resource fields plus `lastUpdated`, confirmed by full iteration. |
| Negative/invalid values | **0** — no negative value found in any of the 7 resource fields across all 2,377 records (the schema itself does not declare negatives invalid, but none exist regardless). |
| `resourcePools` structural sanity | Clean — single pool (`global`), single populated resource type (`capital`), no non-numeric or negative value. |
| Cross-file references (economy → other files) | `trades: []` (0 records, confirmed) — no dangling trade reference is possible since the array itself is empty. |
| Cross-file references (registry → economy, re-confirmed) | 1,615 (platform-omega/IDOR) + 758 (civ-v9) + 4 (manual-audit, non-dangling) = 2,377 — full reconciliation, 0 unaccounted, matching Part A1 exactly. |

**No mutation was needed or performed to produce any of the above — all checks are read-only
iterations over the current live file.**

---

## Whether any mutation is justified — explicit statement per instruction

**This mission takes no position that mutation IS justified — it reports what evidence would
support IF a founder authorizes it, and flags exactly what evidence is missing where it cannot be
determined at all.** Specifically:

- **The 758 civ-v9-origin balance keys:** provably test-generated (via registry-membership proof,
  independent of replay success). A **full, expanded** replay (trades + the 23 direct
  credit/debit call sites) is likely achievable and could, in principle, justify either deleting
  these 758 keys outright (mirroring Mission 105's registry approach) or zeroing them — but this
  mission did not build that fuller model, so it cannot certify the exact reconstructed value today,
  only the provenance.
- **The 1,615 platform-omega/IDOR-origin balance keys:** already established as pollution by
  Mission 102/105, not newly investigated by this mission's replay work (out of this mission's
  explicit focus on the 758 set) — no new evidence for or against reconciling these is added here.
- **`resourcePools.global`:** no reconstruction is possible with any amount of further code
  analysis — the missing information (a transaction ledger) simply does not exist. Any correction
  here would be a founder-authorized estimate/reset, never a proof-backed reconciliation.

---

## Explicit founder decision required — for every non-provably-removable category

1. **The 758 civ-v9-origin balance keys.** Options: (a) authorize a Mission-110-style repair
   mission to build the fuller replay model (trades + 23 direct credit/debit call sites) and
   attempt full reconstruction before any deletion decision; (b) authorize direct deletion of these
   758 keys now, accepting that their provenance (not their exact value) is what's proven, mirroring
   how Mission 105 deleted the corresponding *registry* records without first reconstructing every
   field; (c) leave as-is indefinitely. **This mission does not recommend between these.**
2. **The 1,615 platform-omega/IDOR-origin balance keys.** Same three options apply, contingent on
   whatever founder decision is eventually made about `registry.json`'s corresponding
   already-frozen-but-not-yet-deleted pollution class (per Mission 102's own still-open Part D1 —
   not re-opened by this mission).
3. **`resourcePools.global`'s `9950` capital figure.** Options, per Mission 102's original framing
   (re-confirmed unchanged by this mission): (a) accept it as an approximate, mixed-provenance
   operational figure and leave it untouched; (b) authorize an explicit reset to `0` (or another
   founder-chosen baseline), accepting the loss of whatever legitimate portion (if any) it contains,
   since that portion cannot be isolated; (c) leave the reconciliation question open indefinitely.
   **No amount of further code-only forensic work can resolve this — it is a hard information
   limit, not a resourcing question.**

---

## Recommended Mission 110 (if the founder wants to proceed toward eventual reconciliation)

**Mission 110 (proposed) — Full economy-balance replay model + founder-gated repair,** contingent
on the founder's answer to the 3 decisions above:
1. If (1a) is chosen: extend this mission's scratch replay to also simulate the 23 identified
   direct `creditResource`/`debitResource`/`contributeToPool`/`claimFromPool` call sites from
   `civ-v9.test.cjs`, per-run, and re-attempt the 398-key comparison; report the new match/mismatch
   count honestly (it may still not reach 100% — report whatever the true result is).
2. If (1b) or founder otherwise authorizes deletion: apply the exact same
   backup → hard-preservation-check → atomic-write → post-repair-validation discipline Missions 105
   and 108 already established, scoped to `economy.json`'s `balances` object only — never touching
   `resourcePools`, `trades`, or any other file.
3. `resourcePools.global`: implement whichever of (3a)/(3b) the founder selects — (3b) would be a
   single-field, explicit, founder-authorized value change, not a "reconciliation" in the
   evidence-based sense this mission's other findings use that word for.

---

## FINAL CHECK — proof of read-only integrity

| File | Baseline SHA-256 | Final SHA-256 (end of this mission) | Identical? |
|---|---|---|---|
| `data/civilization/economy.json` | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` | **YES** |
| `data/civilization/registry.json` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | **YES** |
| `data/civilization/council.json` | `ccc6b9dce275f32d7c1a9df7f70d4ba189a7bf5cff216193c11e312c426f7498` | `ccc6b9dce275f32d7c1a9df7f70d4ba189a7bf5cff216193c11e312c426f7498` | **YES** |
| `data/civilization/diplomacy.json` | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` | **YES** |
| `data/civilization/innovation.json` | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` | **YES** |
| `data/civilization/network.json` | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` | **YES** |
| `data/civilization/constitution.json` | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` | **YES** |

**`resourcePools.global` specifically re-confirmed byte-identical** (`{"capital": 9950}` at both
start and end — implied by `economy.json`'s identical overall hash, independently re-read at the
end of this mission).

**No `.git` operation was performed.** `.git/index.lock` was not inspected or touched (irrelevant
to a pure data-forensic pass). `git status --short` at the end of this mission shows the same 77
pre-existing paths plus this new report — no concurrent file was read for modification, none was
altered.

**Deploy: NOT PERFORMED. Commit: NOT PERFORMED. Push: NOT PERFORMED.**

This mission stops here, per its own explicit instruction, with forensic classification complete
and three explicit founder decisions identified for any future mutation to proceed.
