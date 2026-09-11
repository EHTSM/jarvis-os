# CIVILIZATION MISSION 106 — COUNCIL CATEGORY-C DANGLING-REFERENCE FORENSIC PASS

**Date:** 2026-09-09
**Branch:** `security/reality-completion`
**HEAD:** `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged — no commit performed)

**STATUS: CERTIFIED**

This mission is forensic/no-mutation only. All 5 certification conditions verified below.

---

## STEP 1 — Baseline

| Item | Value |
|---|---|
| HEAD | `77f1cc0b421269134a2126d90caa4e2f078736dd` |
| Branch | `security/reality-completion` |
| `git status --short` path count | 72 (all pre-existing from Missions 96–105 / Phase 1–6 / ERA-1 / Gap Closure series — none newly modified by this mission) |
| P1-1 diff vs `7c229a52` | 222 lines |
| `data/civilization/council.json` SHA-256 | `cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0` |
| `data/civilization/council.json` byte size | 2,565 bytes |
| Council member count | 10 |
| Council proposal count | 0 |
| Council vote count | 0 |
| `data/civilization/registry.json` SHA-256 | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` (matches Mission 105's certified post-repair hash exactly) |
| `data/civilization/economy.json` SHA-256 | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` (matches Mission 105's baseline exactly — confirms zero drift since) |

Registry and economy hashes both independently re-confirmed identical to Mission 105's own final
figures before any analysis began — no unrelated intervening mutation occurred between missions.

---

## STEP 2 — The exact 10 Category-C records

All 10 read in full (`data/civilization/council.json`'s complete `members` array — reproduced
here verbatim, no field omitted):

| # | `id` (stable) | `memberId` (reference field) | role | `joinedAt` |
|---|---|---|---|---|
| 1 | `ccm_1782947457919_76ut` | `cmem_1782947457869_9hmp` | representative | 2026-07-01T23:10:57.919Z |
| 2 | `ccm_1782947457921_dwgw` | `cmem_1782947457900_uugc` | delegate | 2026-07-01T23:10:57.921Z |
| 3 | `ccm_1786794118721_nd7k` | `cmem_1786794118702_otlk` | representative | 2026-08-15T11:41:58.721Z |
| 4 | `ccm_1786794118722_f4lk` | `cmem_1786794118708_sygy` | delegate | 2026-08-15T11:41:58.722Z |
| 5 | `ccm_1787773130019_x6vg` | `cmem_1787773129264_7leg` | representative | 2026-08-26T19:38:50.019Z |
| 6 | `ccm_1787773130047_ec5h` | `cmem_1787773129696_u93u` | delegate | 2026-08-26T19:38:50.047Z |
| 7 | `ccm_1787773312053_0trk` | `cmem_1787773303640_4gmd` | representative | 2026-08-26T19:41:52.053Z |
| 8 | `ccm_1787773312078_gdu6` | `cmem_1787773308756_wg9o` | delegate | 2026-08-26T19:41:52.078Z |
| 9 | `ccm_1788870975552_qmye` | `cmem_1788870971587_s7cw` | representative | 2026-09-08T12:36:15.552Z |
| 10 | `ccm_1788870976167_k75w` | `cmem_1788870973077_jj2d` | delegate | 2026-09-08T12:36:16.167Z |

All 10 share `votingWeight: 1`, `mandate: "permanent"`, `status: "active"` — no structural
variance between records. Each has **exactly one outbound reference field**: `memberId`, intended
to point to a `registry.json` member record's `id`. No other reference field exists on these
records (no `orgId`, `tenantId`, or secondary pointer).

**Organization/reference fields:** only `memberId`, as above. No inbound references were found
pointing at any of these 10 records' own `id` fields — see Step 3's cross-file sweep.

---

## STEP 3 — Reference tracing (deterministic, across the full civilization data graph)

For each of the 10 records, the `memberId` was checked against three registry states, not just
one, to establish exactly when (if ever) the reference was ever valid:

| `memberId` | Resolves in **current** `registry.json` (4 members, post-Mission-105) | Resolves in **pre-Mission-105** backup (1,751 members) | Resolves in **pre-Mission-101** backup (2,526 members — the fullest, earliest available snapshot) |
|---|---|---|---|
| `cmem_1782947457869_9hmp` | No | No | No |
| `cmem_1782947457900_uugc` | No | No | No |
| `cmem_1786794118702_otlk` | No | No | No |
| `cmem_1786794118708_sygy` | No | No | No |
| `cmem_1787773129264_7leg` | No | No | No |
| `cmem_1787773129696_u93u` | No | No | No |
| `cmem_1787773303640_4gmd` | No | No | No |
| `cmem_1787773308756_wg9o` | No | No | No |
| `cmem_1788870971587_s7cw` | No | No | No |
| `cmem_1788870973077_jj2d` | No | No | No |

**All 10 fail to resolve against every available registry snapshot, including the earliest
(pre-Mission-101, 2,526 members — the most complete registry state this repository has any record
of).** This is the decisive evidence: these references were never valid at any point this
repository can observe, not references broken by a later cleanup mission.

**Full cross-file inbound/outbound reference sweep** (both the 10 `ccm_*` council-record IDs and
their 10 `memberId` values, searched as literal substrings across every other civilization data
file):

| File | References to the 10 `ccm_*` IDs | References to the 10 `memberId` values |
|---|---|---|
| `registry.json` | 0 | 0 |
| `diplomacy.json` | 0 | 0 |
| `economy.json` | 0 | 0 |
| `innovation.json` | 0 | 0 |
| `network.json` | 0 | 0 |
| `constitution.json` | 0 | 0 |

**These 10 records are fully isolated** — no other file in the civilization data graph references
them or is referenced by them. They exist only as self-contained entries inside
`council.json`'s own `members` array.

### Per-record classification (A–E, per this mission's own taxonomy)

All 10 records classify identically, by the same deterministic evidence:

- **(A) resolves cleanly:** No — for any of the 10.
- **(B) points to one of the 4 preserved manual-audit artifacts:** No — none of the 10
  `memberId`s match `cmem_1786794138531_rt40` (PlatA-SecretCo), `cmem_1786794148322_iu0z`
  (PlatA-Blueprint), `cmem_1786794158439_oapx` (PlatA-Clone), or `cmem_1785898622178_e961`
  (Victim2 Confidential Agency) — checked by exact ID comparison, not name similarity.
- **(C) points to intentionally preserved historical data:** No — the referenced IDs do not exist
  in any available historical snapshot, so there is no "historical data" being pointed at.
- **(D) ambiguous but potentially legitimate reference:** No — ambiguity would require some
  plausible-but-unconfirmed path to a real record; none exists here (see Step 4's root-cause
  finding below, which explains *why* they're unresolvable, removing rather than deepening the
  ambiguity).
- **(E) genuinely dangling reference:** **Yes, all 10.** Each `memberId` was never a valid
  registry reference at any point in this repository's observable history.

**No ambiguity was converted into deletion authority.** This mission classifies; it does not
delete, and would not have recommended deletion even under classification (E) without a separate,
explicit authorization mission — consistent with this mission's own explicit no-mutation scope.

### Root cause identified (code-level, not merely data-level)

Direct read of `backend/services/civilizationState.cjs:197-206`, `addCouncilMember()`:

```js
function addCouncilMember({ memberId, role = "representative", votingWeight = 1, mandate = "permanent" } = {}) {
  if (!memberId) return { ok: false, error: "memberId required" };
  const cou = _cou();
  if (cou.members.find(m => m.memberId === memberId && m.status === "active"))
    return { ok: false, error: "Already a council member" };
  const cm = { id: _id("ccm"), memberId, role, votingWeight, mandate, status: "active", joinedAt: new Date().toISOString() };
  cou.members.push(cm);
  _save("council");
  return { ok: true, councilMember: cm };
}
```

**CONFIRMED BY CODE: this function performs zero referential-integrity validation of `memberId`
against `registry.json`.** It checks only that `memberId` is non-empty and not already an active
council member — it never calls anything resembling `_reg().members.find(m => m.id === memberId)`
before accepting and persisting the reference. This is also reachable directly over HTTP:
`backend/routes/civilizationOrg.js:48` — `router.post("/civ/v9/council/members", (req, res) => {
const r = _st().addCouncilMember(req.body); ...})` — passes `req.body` straight through with no
additional validation at the route layer either.

**This fully explains how these 10 dangling records could exist without ever having corresponded
to a real registry member**, and why searching wider timestamp/ID ranges (per Mission 100's own
item 10 first option — "find additional evidence... to promote them to Category A") would not
succeed: there is no missing evidence to find. The gap is structural (an unvalidated write path),
not a matter of insufficiently thorough historical search. This answers Mission 100's item 10
definitively: **explicit permanent-orphaned-reference-defect classification, not a promotable
Category A finding.**

---

## STEP 4 — Cross-check against Mission 101/105

- **No Category-C member was accidentally removed by Mission 105:** confirmed — council member
  count is still exactly 10, all 10 IDs match Mission 101's own preserved set exactly (cross-
  referenced against `council.json.pre-mission101-repair-backup-20260909T142209Z.json`, which
  shows the same 10 records already present, unchanged, inside its own larger 416-member
  pre-repair array).
- **No preserved manual-audit artifact is incorrectly classified as dangling:** confirmed — all 4
  manual-audit registry artifacts (`PlatA-SecretCo`, `PlatA-Blueprint`, `PlatA-Clone`, `Victim2
  Confidential Agency`) were checked by exact ID against all 10 council `memberId` values; zero
  matches in either direction. The 4 manual artifacts have no council-membership relationship at
  all, dangling or otherwise — they are simply absent from `council.json` entirely.
- **No reference was created by Mission 105:** confirmed — Mission 105 only modified
  `registry.json` (hash-verified unchanged for every other civilization file, including
  `council.json`, in its own report). This mission independently re-confirms `council.json`'s
  hash is unchanged from its Mission 105-era state.
- **No previously certified clean relationship has regressed:** confirmed — Mission 105 itself
  already found and reported `network`/`council`/`diplomacy`/`innovation` dangling-reference
  counts of 0 with respect to the *registry deletion it performed* (i.e., no *registry* IDs it
  removed were referenced by these files). This mission's finding is a **different, pre-existing**
  class of dangling reference (`council.json`'s own `memberId` field never having pointed to a
  valid registry entry, independent of anything Mission 105 deleted) — not a contradiction of
  Mission 105's certification, a distinct and already-flagged (Mission 100 item 10) open item.

---

## STEP 5 — No-mutation integrity check

| File | Baseline SHA-256 (Step 1) | Final SHA-256 (end of this mission) | Identical? |
|---|---|---|---|
| `data/civilization/council.json` | `cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0` | `cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0` | **YES** |
| `data/civilization/registry.json` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | `bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1` | **YES** |
| `data/civilization/economy.json` | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` | `ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120` | **YES** |
| `data/civilization/diplomacy.json` | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` | `6a46d3dfc0492423331cf5d45263ace3b5dfa7573bf624647c66908c9cb290a2` | **YES** |
| `data/civilization/innovation.json` | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` | `1ea7da9674a17158c112c3a5396dccceba56b944d81c2a5f01eb6a98a51233ae` | **YES** |
| `data/civilization/network.json` | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` | `fb2450ee5b02f6f8c3ffb7a053d4e2ae6b8683d7b98ee7c5b52dbbd881dcbaf1` | **YES** |
| `data/civilization/constitution.json` | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` | `214ca6e524e6439bcabd2f03d22f93975c928447c8940913fb6c2afa82a0a748` | **YES** |

**Zero files mutated.** Every hash checked is identical before and after this mission's full
analysis. No backup file was created (none was needed — no mutation occurred). No `.git` operation
was performed; `.git/index.lock` was not inspected or touched by this mission (irrelevant to a
pure data-forensic pass).

---

## Concurrent work / worktree verification

`git status --short` shows the same 72 pre-existing paths from the start of this mission,
unchanged (this report is the only new file). No concurrent-session file was read for modification.
P1-1 (`agentRuntimeSupervisor.cjs`) diff vs `7c229a52` confirmed unchanged at exactly 222 lines.

---

## Economy remains deferred

Not touched, not analyzed further, per explicit scope. `economy.json`'s hash is confirmed
identical throughout this mission (Step 5). Mission 102's own deferred Part D2 items (balance/
resourcePool reconciliation) remain exactly as that mission left them — this mission adds no new
finding or recommendation regarding economy.json.

---

## Recommended founder decision

**None required to close this specific forensic question — it has been answered definitively by
code-level evidence, not left as an open ambiguity requiring a founder judgment call.** The 10
Category-C records are conclusively classified as **genuinely, permanently dangling** (Category E)
due to a **structural, code-level referential-integrity gap** in `addCouncilMember()`/
`POST /civ/v9/council/members`, not an unresolved data mystery.

Two separate, smaller decisions remain open for a **future, explicitly-scoped** mission — this
mission does not recommend a specific choice on either, consistent with its own no-mutation scope:

1. **Whether to eventually delete these 10 records.** Now that they are conclusively proven
   dangling (not merely "unresolved"), a future mission *could* propose their removal following
   the same backup/hard-preservation/atomic-write discipline Mission 105 already established — but
   that is a new mutation mission requiring its own explicit authorization, not performed here.
2. **Whether to fix `addCouncilMember()`'s validation gap.** Adding a real
   `if (!_reg().members.find(m => m.id === memberId)) return {ok:false, error:"memberId not found in registry"};`
   check (the same pattern already used elsewhere in this codebase for referential integrity) would
   prevent this exact class of defect from recurring — this is a genuine, narrow, code-level fix
   candidate, but implementing it is outside this mission's explicit forensic-only scope and would
   require its own test-first, minimal-fix mission.

---

## FINAL FORMAT

```
CIVILIZATION MISSION 106 STATUS: CERTIFIED
HEAD: 77f1cc0b421269134a2126d90caa4e2f078736dd
WORKTREE: 72 changed/untracked paths (unchanged from mission start; this report is the only addition); P1-1 unchanged at 222
CATEGORY-C RECORDS: 10
RESOLVED: 0
AMBIGUOUS: 0
GENUINE DANGLING: 10 (all 10 — conclusively proven by code-level root-cause analysis, not merely unresolved)
COUNCIL HASH BEFORE: cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0
COUNCIL HASH AFTER: cb07caa1967c95d9f53579d284204a378644a5de942ac83dd1a623166723e9b0 (IDENTICAL)
REGISTRY HASH BEFORE: bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1
REGISTRY HASH AFTER: bed384365b9ef9de779ee2c50c7373ce098fcd2022fde1da4958c358901541c1 (IDENTICAL — Mission 105 cleanup remains intact)
ECONOMY HASH BEFORE: ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120
ECONOMY HASH AFTER: ec492d8ed854ff71f39a32050ffae87b27d92246c0a2ee96e0fa43f87d292120 (IDENTICAL)
MANUAL ARTIFACT IMPACT: None — all 4 manual-audit registry artifacts checked by exact ID against all 10 council memberId values; zero relationship in either direction
MUTATION: NONE
DEPLOYMENT: NOT PERFORMED
COMMIT: NOT PERFORMED
PUSH: NOT PERFORMED
REPORT: reports/MISSION-106-COUNCIL-CATEGORY-C-DANGLING-REFERENCE-FORENSIC.md
NEXT MISSION: (optional, founder-gated) a scoped, test-first fix to addCouncilMember()'s missing registry-referential-integrity check; separately, (optional, founder-gated) a Mission-105-style surgical deletion of the now-conclusively-proven-dangling 10 records, following the same backup/hard-preservation/atomic-write discipline
```
