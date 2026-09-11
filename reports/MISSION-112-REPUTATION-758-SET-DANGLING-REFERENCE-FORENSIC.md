# MISSION 112 — Reputation 758-Set Dangling-Reference Forensic

**Type:** Read-only forensic investigation. **Zero mutation performed.** Builds on Mission 111's
disclosed, honest finding (216 pre-existing reference instances in `reputation.json` pointing at the
758 civ-v9-origin member IDs whose economy balances Mission 111 removed).

**Date:** 2026-09-11
**Branch:** `security/reality-completion`
**HEAD:** `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged)

---

## 1. Executive Summary

All 216 reference instances in `reputation.json` (126 score-object entries + 45 endorsement records
+ 45 badge records) resolve, by exact source-code-literal match, to the same 758 civ-v9-origin
registry members Mission 109/110/111 already proved test-generated. `reputation.json` is confirmed
byte-identical to its own pre-Mission-111 backup, proving these 216 references existed **before**
Mission 111 ran, unrelated to that mission's economy-balance mutation. **Every one of the 216
instances is classified PROVABLY TEST-GENERATED** — none are ambiguous, none are legitimate, none are
"legitimate-but-dangling." The runtime has no member-existence validation guard on any reputation
write path, confirmed by direct code read, which is *why* dangling records can accumulate but is not
itself evidence of pollution — provenance for every instance rests on exact literal matching to
`civ-v9.test.cjs`, not on the absence of a guard. **No mutation is recommended by this mission** — it
reports evidence only, per its own read-only scope.

---

## 2. Exact 758-Member Derivation (re-derived fresh, not reused from cache)

Re-computed independently from raw snapshots, not relying on any Mission 109/110/111 scratch file:

```
Source: data/civilization/economy.json.pre-mission111-repair-backup-20260910T191309Z.json (balances)
Cross-referenced against:
  - data/civilization/registry.json (current, 4 members)
  - data/civilization/registry.json.pre-mission105-repair-backup-20260909T150116Z.json (1,751 members)
  - data/civilization/registry.json.pre-mission101-repair-backup-20260909T142209Z.json (2,526 members)

Set definition: balance key NOT in current registry, IN pre-101 registry, NOT in pre-105 registry
Result: 758 — exact match to Mission 109/110/111's own count
```

**Not reliant on timestamps.** Every one of the 758 resolves to an exact `registerMember()` name
literal in `tests/runtime/civ-v9.test.cjs`:

| Name prefix | Count | Exact source literal |
|---|---|---|
| `OrgA-` | 200 | `civ-v9.test.cjs:40` |
| `OrgB-` | 200 | `civ-v9.test.cjs:54` |
| `OrgC-` | 199 | `civ-v9.test.cjs:60` |
| `LowRep-` | 159 | `civ-v9.test.cjs:666` |
| **Total** | **758** | Exact match, 0 unaccounted |

Identical to Mission 110's own §3.2 derivation — reproduced independently here as this mission's own
first step, not merely cited.

---

## 3. Exact 216-Reference Derivation

Full-file scan of `data/civilization/reputation.json`'s three top-level structures
(`scores`, `endorsements`, `badges`) against the 758-member-ID set:

| Structure | Total records in file | Records referencing 758-set | Match field(s) checked |
|---|---|---|---|
| `scores` (object, keyed by memberId) | 126 | **126** (100% of all scores in the file) | Object key itself |
| `endorsements` (array) | 45 | **45** | `fromMemberId`, `toMemberId` (both checked independently — see §5) |
| `badges` (array) | 93 | **45** | `memberId` (checked); `fromMemberId` checked separately, 0 hits (always literal `"civilization"` or `"platform"`, never a real member ID) |
| **Total reference instances** | — | **216** | Exact match to Mission 111's disclosed count |

`reputation.json`'s content is confirmed **byte-identical** to
`data/civilization/reputation.json.pre-mission111-repair-backup-20260910T191320Z.json` (direct
`JSON.stringify` structural comparison, not just a file-hash check) — **proof these 216 references
existed before Mission 111 ran**, satisfying §8's historical-existence requirement directly rather
than by inference.

---

## 4. Instance vs. Unique-Member Counts (kept explicitly distinct, per instruction)

| Metric | Count |
|---|---|
| **Reference instances** (each score-object entry, each endorsement record, each badge record counted once) | **216** |
| **Unique member IDs touched** (union across all three structures — a member with both a score entry and a badge is counted once) | **126** |

**Why 126, not less:** every one of the 126 `scores`-object keys is, by construction, one of the
distinct members touched. Cross-checking the 45 endorsements (all 45 are fully *internal* to the
758-set — both `fromMemberId` and `toMemberId` resolve to 758-set members, confirmed directly, see
§5) and the 45 badges (all reference a `memberId` already present among the 126 scored members)
confirms the endorsement/badge participants are a subset of the already-scored 126, not a
disjoint additional population. **126 unique members, out of 758 total civ-v9-origin members, ever
received a reputation-system interaction — the remaining 632 members (mostly the `OrgC-`/`LowRep-`
population not selected as `memberA`/`memberB` in any given test run, per §7) never touched
`reputation.json` at all.**

---

## 5. Score / Endorsement / Badge Breakdown, With Full Provenance

### 5.1 Scores (126 references = 126 unique members, 1:1)

Each of the 126 `scores[memberId]` objects holds a nested `events` array. Individual event-type
tally across all 126 members' nested events (**not** a separate reference-instance count — these are
sub-records within the 126 already-counted score entries, reported for completeness per the brief's
"current record contents" requirement):

| `eventType` | Count | Exact source call site |
|---|---|---|
| `contribution` | 1,350 | `civ-v9.test.cjs:366` — `for (let i=0;i<30;i++) st.recordReputationEvent({memberId: memberB.id, eventType:"contribution", score:10})` (30/run × ~45 runs) |
| `violation` | 360 | `civ-v9.test.cjs:667` — `for (let i=0;i<10;i++) st.recordReputationEvent({memberId: lr.member.id, eventType:"violation", score:-10})` (10/run, `LowRep-` members only) |
| `innovation_adopted` | 133 | `civilizationState.cjs:767` (internal, triggered only via `adoptInnovation()`, itself only called at `civ-v9.test.cjs:502-510` with `memberB.id`/`memberC.id`) |
| `mission_completed` | 45 | `civ-v9.test.cjs:360` — `st.recordReputationEvent({memberId: memberA.id, eventType:"mission_completed", score:5, fromMemberId: memberB.id, ...})` |
| `endorsement` | 45 | Internal call inside `endorseMember()` (`civilizationState.cjs:568`), triggered by `civ-v9.test.cjs:377` |
| `pipeline_success` | 8 | `civilizationWorkflow.cjs:301`, inside `runCivilizationPipeline()`'s success branch, triggered by `civ-v9.test.cjs:713/721/730/796` |
| **Total individual events** | **1,941** | (informational — not a "reference instance" count; all nested inside the 126 already-counted score entries) |

### 5.2 Endorsements (45 references)

All 45 are **fully internal** to the 758-set: both `fromMemberId` and `toMemberId` resolve to a
758-set member (confirmed — 0 endorsements have only one side matching). `domain` is uniformly
`"engineering"` (45/45) and `message` is uniformly `"Outstanding contributor"` (45/45) — an exact
literal match to `civ-v9.test.cjs:377`'s single call site
(`st.endorseMember({fromMemberId: memberB.id, toMemberId: memberA.id, domain:"engineering",
message:"Outstanding contributor"})`), repeated once per historic test run.

### 5.3 Badges (45 references)

All 45 are badge name `"Pioneer"` (45/45) with `fromMemberId: "civilization"` (45/45, the function
default) — exact match to `civ-v9.test.cjs:383`'s single call site
(`st.awardBadge({memberId: memberA.id, badge:"Pioneer", reason:"First to adopt innovation",
fromMemberId:"civilization"})`). **None of the 758-set badge hits use `fromMemberId: "platform"`** —
that value belongs exclusively to the separate `CertOrg-*` / 1,615-set certification path
(`platformState.cjs:734`), already identified and excluded by Mission 110/111 as a distinct,
unrelated pollution class. This confirms the 758-set badges and the 1,615-set badges are two
genuinely separate provenance chains, not overlapping evidence.

---

## 6. Full Provenance Methodology

For every one of the 216 instances, provenance was established by exact matching, **never by
timestamp proximity or ID-shape inference**:

1. The referenced `memberId` (or `fromMemberId`/`toMemberId`) was checked against the independently
   re-derived 758-member-ID set (§2) — an exact set-membership test.
2. Every underlying record's own literal field values (`domain`, `message`, `badge`, `reason`,
   `eventType`, `fromMemberId`) were compared against the exact literal arguments passed in
   `civ-v9.test.cjs`'s own source code — not inferred from naming convention.
3. Every reputation-mutating function (`recordReputationEvent`, `endorseMember`, `awardBadge`) was
   read in full (`civilizationState.cjs:543-587`) to confirm the exact shape of what each call
   produces, so that a match could be verified structurally, not just by superficial string
   resemblance.
4. Where a function is called from non-test production code (`civilizationWorkflow.cjs:301`'s
   `pipeline_success` event, `civilizationState.cjs:767`'s `innovation_adopted` event), the actual
   caller of *that* code path was traced one level further to confirm it, too, was only ever invoked
   with a 758-set member ID in this dataset (§5.1, §7) — the code path's general reachability from
   production is disclosed honestly (§7) rather than used to claim "test-only code," but the
   *specific data* is still provably test-originated because the actual member IDs involved trace
   to the test file.

---

## 7. Test-Source Tracing — Complete Writer/Reader Sweep

**Repo-wide grep for `recordReputationEvent`, `endorseMember`, `awardBadge`, `listReputations`,
`getReputation`** across `backend/`, `agents/`, `frontend/src/`, `tests/` (excluding node_modules):

| File | Role |
|---|---|
| `backend/services/civilizationState.cjs` | Sole owner/mutator of `reputation.json` — defines all 5 functions, `_save("reputation")` is the only write path |
| `backend/routes/civilizationOrg.js` | HTTP route mounting only — `GET /civ/v9/reputation`, `GET /civ/v9/reputation/:memberId`, `POST /civ/v9/reputation/event`, `POST /civ/v9/reputation/endorse`, `POST /civ/v9/reputation/badge` (pure passthrough to the functions above, no independent logic) |
| `backend/services/civilizationOrg.cjs` | **Read-only** — `listReputations({})` used for its own KPI/memory self-tick (`civ_reputation`/`civ_trust` department blocks); confirmed via full grep, **never writes** |
| `backend/services/civilizationWorkflow.cjs` | Writes exactly one event type (`pipeline_success`) from inside `runCivilizationPipeline()`'s success branch — reachable via the HTTP route above and via `agents/executor.cjs`, but in this dataset only ever invoked (per `civ-v9.test.cjs`'s own call sites, §5.1) with 758-set member IDs |
| `backend/services/platformState.cjs` | Writes badges via `awardBadge` — **but exclusively `Certified-{bronze,silver,gold,platinum}` badges with `fromMemberId:"platform"`, targeting the separate 1,615/CertOrg-set, confirmed zero overlap with the 758-set (§5.3)** |
| `backend/services/academyEngine.cjs` | **False positive from initial grep** — its own `awardBadge(accountId, badgeId)` is an unrelated, differently-signatured local function for a separate academy/learning-path badge system; does not write to `reputation.json` at all (confirmed by direct read, no `_rep()`/`reputation` reference anywhere in this file) |
| `tests/runtime/civ-v9.test.cjs` | The sole test file exercising every one of the 5 reputation functions — exact call sites: lines 360, 366, 371-372, 377, 383, 388-389, 502-510, 667, 707-796 (via `runCivilizationPipeline`) |

**No frontend file, agent runtime file, or any other test file references any of these 5 functions.**

**Honest disclosure on reachability vs. actual provenance (per instruction not to infer from
convenience):** `civilizationWorkflow.cjs`'s `pipeline_success` path and `civilizationState.cjs`'s
`innovation_adopted` path are genuinely reachable from live production traffic (via the HTTP routes
and `agents/executor.cjs`), not test-exclusive code. **This mission does not claim these code paths
are test-only.** What is provable is narrower and stronger: in the actual data present in
`reputation.json` today, every single instance touching these paths names a memberId that
independently, exactly matches the 758-set (§2) — meaning whatever *could* happen via those paths in
production, what *did* happen in this specific dataset is fully accounted for by known historic test
runs, with zero residual unexplained by that account.

---

## 8. Historical Existence Proof

| Check | Result |
|---|---|
| `reputation.json` current SHA-256 | `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24` |
| `reputation.json.pre-mission111-repair-backup-20260910T191320Z.json` SHA-256 | `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24` |
| Identical? | **YES — byte-for-byte, confirmed by hash AND by full structural `JSON.stringify` equality** |

**This proves the 216 references existed in exactly their current form before Mission 111's economy
mutation ran**, not introduced or altered by it. Mission 111 never opened `reputation.json` for
writing (confirmed independently by this mission and previously by Mission 111's own report and its
independent-verification addendum). No `pre-mission101`/`pre-mission105`/`pre-mission108`
`reputation.json` backup exists (only `economy.json`, `registry.json`, `council.json`,
`constitution.json`, `diplomacy.json`, `innovation.json`, `network.json` received dedicated
backups at those mission boundaries — confirmed by directory listing, §2's source list). This means
this mission **cannot** prove the exact moment these 216 references were first written relative to
Missions 99–108 — only that they predate Mission 111 and postdate the historic `civ-v9.test.cjs` runs
that produced the underlying member IDs (which the 758-set's own registry-snapshot membership already
dates to before Mission 105's registry repair, consistent with all prior missions' timeline).

---

## 9. Referential Integrity Analysis

**Does `reputation.json` require a live registry member?** No enforcement exists. Direct read of all
5 mutating functions (`civilizationState.cjs:543-587`) confirms **zero `registry.members.find(...)`
or equivalent existence check** before writing a score event, endorsement, or badge. Every function
accepts any string as `memberId`/`fromMemberId`/`toMemberId` and writes unconditionally.

**Does runtime currently validate member existence?** **No — confirmed by absence, not inference.**
This is a structural gap, not a bug introduced recently; it has been present since these functions
were written (no version of `civilizationState.cjs` in this repo's history was checked for this
specific control, but the current code — which is what actually ran to produce all 216 references —
has no such guard).

**Can dangling reputation records affect production behavior?** Traced via `listReputations()`/
`getReputation()`'s only readers: `civilizationOrg.js`'s 2 GET routes (pure passthrough) and
`civilizationOrg.cjs`'s own KPI self-tick (`civ_reputation`/`civ_trust` department blocks, §7). Both
simply aggregate/display whatever is in `scores` — **a dangling record inflates the reported
member-count/average-score statistics** (e.g., `civilizationOrg.cjs`'s own `civ_reputation` KPI tick
counts `scores.length`, which currently includes the 126 dangling members) but does not cause a
crash, an authorization bypass, or any state-mutating side effect. This is a **data-quality/reporting-
accuracy issue, not a security or stability defect.**

**Does any legitimate surviving record reference these reputation entries?** No — confirmed by the
same reasoning as Mission 110's economy-balance analysis: `council.json`, `diplomacy.json`,
`network.json`, `innovation.json`, `constitution.json`, and the current (4-member) `registry.json`
were all checked for any reference to `reputation.json`'s own record IDs (`crevt_*`, `cend_*`,
`cbadge_*`) or to the 126 touched member IDs — **0 hits in any file.** Nothing outside
`reputation.json` itself points at these 216 records.

**Would deletion cause secondary dangling references?** No — confirmed by the same 0-hit sweep above.
Deleting any or all of these 216 references would not orphan anything else, since nothing references
them in turn.

---

## 10. Exact Classification Counts

| Category | Count | Basis |
|---|---|---|
| **1. PROVABLY TEST-GENERATED** | **216 / 216** (100%) | Every instance's referenced member resolves to the independently-re-derived 758-set (§2), and every instance's own literal field values (message, domain, badge name, eventType, score amounts) match an exact `civ-v9.test.cjs` call-site literal (§5, §6) — not inferred from timestamp or naming convention alone |
| **2. PROVABLY LEGITIMATE** | **0 / 216** | None found |
| **3. LEGITIMATE BUT DANGLING** | **0 / 216** | None found — "dangling" alone does not imply this category; every instance here additionally has affirmative test-origin proof, ruling this category out rather than defaulting into it |
| **4. AMBIGUOUS** | **0 / 216** | None — every instance resolved to an exact literal match, none required inference |

**By structure:**

| Structure | Test-generated | Legitimate | Legitimate-but-dangling | Ambiguous |
|---|---|---|---|---|
| Scores | 126 | 0 | 0 | 0 |
| Endorsements | 45 | 0 | 0 | 0 |
| Badges | 45 | 0 | 0 | 0 |
| **Total** | **216** | **0** | **0** | **0** |

**By unique member:** 126 / 126 unique touched members are test-generated (100%) — 0 legitimate, 0
legitimate-but-dangling, 0 ambiguous.

**Explicit compliance with instruction:** this classification is **not** derived from "the target
member was deleted, therefore this reference is pollution." It is derived from independently
re-proving the target member's own test-origin (§2, unchanged method from Mission 105/109/110) and
separately confirming each reputation record's own literal contents match a specific, named test call
site (§5, §6) — two independent lines of evidence converging on the same conclusion, not one
inference chained from the other.

---

## 11. Whether Any Mutation Is Justified

**This mission takes no position that mutation IS justified — consistent with its read-only scope.**
What can be honestly stated: the evidentiary bar this repo's own prior missions have used for
economy/registry deletions (exact test-literal provenance, zero cross-file legitimate reference) is
**fully met** for all 216 reputation reference instances — arguably with *stronger* per-instance
literal specificity than the original registry/economy deletions had, since every message/domain/badge-
name/event-type field is a uniform, exactly-repeated literal traceable to one named test line, not
merely a name-prefix pattern. Whether that evidentiary parity is sufficient to also authorize deletion
here is a founder decision, not one this mission makes.

---

## 12. Founder Decision Required

1. **Whether to authorize a Mission 113 to delete some or all of the 216 reputation reference
   instances** (126 score entries, 45 endorsements, 45 badges — all cleanly separable, since §9
   confirms zero secondary dangling-reference risk from doing so).
2. **Whether to authorize adding a member-existence validation guard** to
   `recordReputationEvent`/`endorseMember`/`awardBadge` (a forward-looking code change, distinct from
   a data cleanup, that would prevent this exact class of accumulation going forward) — this mission
   found the absence of such a guard but was not asked to propose fixing it, and does not recommend
   for or against without founder input, since it is a runtime behavior change outside this mission's
   read-only forensic scope.
3. **No decision is required to accept this mission's classification itself** — all 216 instances
   converge on a single, unambiguous category (test-generated) with no split findings requiring
   founder arbitration between competing classifications, unlike the economy/1,615 set's earlier
   1,591-vs-1,595 count discrepancy.

---

## 13. Recommended Mission 113

**Mission 113 (proposed) — Reputation 758-Set Surgical Repair, contingent on founder authorization:**

1. If authorized: apply the same backup → independent-re-derivation → hard-preservation-check →
   atomic-write → post-repair-validation discipline already established across Missions 105/108/111,
   scoped to `reputation.json`'s `scores` (126 keys), `endorsements` (45 records), and `badges` (45
   records referencing the 758-set) — never touching the remaining 0 legitimate-population records
   this mission did not examine in depth (this mission scoped its full analysis to the 216 already-
   flagged instances; a Mission 113 executing a repair should independently re-derive the exact
   deletion set fresh, per this repo's own established practice, rather than reuse this mission's
   scratch computation, exactly as Mission 111 did relative to Mission 110).
2. If the founder additionally wants the forward-looking guard (item 2 in §12): scope that as a
   distinct, explicitly-authorized code change to `backend/services/civilizationState.cjs`, separate
   from any data-repair mutation, with its own regression-test coverage addition.
3. Either way, re-run `tests/runtime/civ-v9.test.cjs` (115/115 expected, matching Mission 111's
   post-repair baseline) and confirm no re-pollution, per this repo's now-established convention.

---

## INTEGRITY CHECK — Before and After

| Check | Before this mission | After this mission | Identical? |
|---|---|---|---|
| `data/civilization/economy.json` | `f28195e77c8cdd4ad218ca406bd10d5e574bc54c7c0a7072b97573d407a6f07f` | `f28195e77c8cdd4ad218ca406bd10d5e574bc54c7c0a7072b97573d407a6f07f` | **YES** |
| `data/civilization/registry.json` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | **YES** |
| `data/civilization/reputation.json` | `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24` | `3fca8612da58a7ca2a53801469497ee11abbefdd80125a5099e511eadc0fdd24` | **YES** |
| `data/civilization/council.json` | `ccc6b9dce275f32d7c1a9df7f70d4ba189a7bf5cff216193c11e312c426f7498` | `ccc6b9dce275f32d7c1a9df7f70d4ba189a7bf5cff216193c11e312c426f7498` | **YES** |
| `data/civilization/diplomacy.json` | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` | **YES** |
| `data/civilization/innovation.json` | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` | **YES** |
| `data/civilization/network.json` | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` | **YES** |
| `data/civilization/constitution.json` | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` | **YES** |
| `resourcePools.global` | `{"capital": 9950}` | `{"capital": 9950}` | **YES — unchanged** |
| Git HEAD | `77f1cc0b421269134a2126d90caa4e2f078736dd` | `77f1cc0b421269134a2126d90caa4e2f078736dd` | **YES** |
| `git status --short` path count | 81 | 81 (unchanged; this report is untracked/new but was not yet added when the "after" check ran) | **Consistent** |

**No backup file was modified.** Both `economy.json.pre-mission111-repair-backup-*` and
`reputation.json.pre-mission111-repair-backup-*` were opened read-only and re-hashed identically to
their known values, never rewritten. No `.git` operation was performed (no reset, restore, stash,
clean, checkout, rebase, or pull). No production data, registry, economy, or council file was
mutated. Concurrent work (all pre-existing modified/untracked paths) confirmed unaltered.

---

## FINAL STATUS

```
MISSION 112 — CERTIFIED — READ-ONLY REPUTATION FORENSICS COMPLETE

HEAD: 77f1cc0b421269134a2126d90caa4e2f078736dd (unchanged)
758-MEMBER SET: independently re-derived, 758/758, exact match to Mission 109/110/111
216-REFERENCE SET: independently re-derived, 126 scores + 45 endorsements + 45 badges = 216, exact match
UNIQUE MEMBERS TOUCHED: 126 / 758
CLASSIFICATION: 216/216 PROVABLY TEST-GENERATED; 0 legitimate; 0 legitimate-but-dangling; 0 ambiguous
HISTORICAL PROOF: reputation.json byte-identical to pre-mission111 backup — confirmed pre-existing
REFERENTIAL INTEGRITY: no existence-validation guard on any reputation write path (confirmed);
  0 secondary dangling-reference risk from any future deletion (confirmed, 0 cross-file references)
MUTATION: NONE
DEPLOY/COMMIT/PUSH: NOT PERFORMED
FOUNDER DECISION REQUIRED: whether to authorize Mission 113 (deletion) and/or a forward-looking
  existence-validation guard — this mission recommends neither, evidence only
RECOMMENDED NEXT MISSION: Mission 113 — Reputation 758-Set Surgical Repair, founder-gated
REPORT: reports/MISSION-112-REPUTATION-758-SET-DANGLING-REFERENCE-FORENSIC.md
```
