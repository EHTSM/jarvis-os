MISSION 100
CIVILIZATION SIBLING-DATA FORENSIC RECONCILIATION

STATUS: CERTIFIED — FORENSIC ANALYSIS COMPLETE

All six sibling files (`council.json`, `diplomacy.json`, `economy.json`, `innovation.json`,
`network.json`, `registry.json`) were analyzed against `backend/services/civilizationState.cjs`'s
real schema and the full literal/template-derived signature set of
`tests/runtime/civ-v9.test.cjs` (including transformations applied by
`backend/services/civilizationWorkflow.cjs`, e.g. `Cross-org: `, `Knowledge: `, `Goal: `
prefixes). Reference relationships were mapped across all seven civilization files
(constitution + 6 siblings) and a full node/edge graph was built for `network.json`. No
mutation of any kind occurred — all six file hashes are byte-identical to the Step 1
baseline, both before and after the mandated regression run. Evidence is sufficient to
classify the overwhelming majority of records with high confidence; a small residual is
explicitly flagged Category C (ambiguous) rather than force-classified.

**Scope-expanding finding, stated up front:** Mission 99 characterized this as a
"2-record incident" confined to `constitution.json`, with sibling-file occurrence counts
reported only as raw string-match counts (not analyzed). Mission 100 finds the real scope
is far larger: **civ-v9.test.cjs has been run at least 55 times historically** against
live production `data/civilization/` files (not just the single 2026-06-27 run Mission 99
examined), spanning **2026-06-27 through 2026-09-09 (today, including runs from this very
mission's own regression check, which correctly landed in an isolated directory and
never touched production data — see REGRESSION SAFETY RESULTS)**. Across the seven
civilization files, the civ-v9-attributable proportion of most arrays is at or near
100%. `constitution.json` itself — which Mission 99 believed it had fully cleaned to "6
legitimate articles, 206 legitimate amendments, 405 untouched precedents" — is now shown
to have **206/206 amendments (100%) and 405/405 precedents (100%) still be test-generated
pollution from the 54 test runs that occurred *after* the single run Mission 99 traced**;
only the 6 genesis articles (created by the idempotent, dedup-guarded
`bootstrapCivilization()` seed, not by the test's own article-creation call after the
first run) are proven legitimate.

---

## BASELINE (Step 1)

**HEAD commit:** `77f1cc0b421269134a2126d90caa4e2f078736dd`
**Branch:** `security/reality-completion`
**`git status --short` line count:** 58 (23 modified + ... untracked, all pre-existing from
concurrent sessions — see gitStatus context; unrelated to this mission). `data/` is fully
covered by `.gitignore:23`, so none of the seven civilization files ever appear in `git
status` — confirmed, not an anomaly, matching Mission 99's precedent.

| File | SHA-256 | Bytes | JSON valid | Top-level keys (array lengths) |
|---|---|---|---|---|
| `constitution.json` | `6c7424b2cd0fb10518ab14a2ba6ff777f5fc49d8bdefdd400c711758196c4d7a` | 191,019 | yes | `articles`:6, `amendments`:206, `precedents`:405 |
| `council.json` | `d6b6c8cdad84b10cf739474d4e9b4fa2a5757d27614c3cb12d68f125cbc6c4cf` | 519,017 | yes | `members`:416, `proposals`:624, `votes`:0 |
| `diplomacy.json` | `1e8ebaad39b34947a9e5ee57ec1783378c0972fc14de5f67c6d1fd25518231f3` | 1,084,945 | yes | `treaties`:626, `disputes`:197, `arbitrations`:197, `negotiations`:823 |
| `economy.json` | `4f97415ffd7d3dcc8dd098d441b166218579b9733ce1dd8db24bbcd299a3f09a` | 823,396 | yes | `balances`:2377 keys (object), `trades`:597, `resourcePools`:1 key |
| `innovation.json` | `26f7086c449cafb019cd73b1b198cc0f975f4302948507c818bfdb985b87a457` | 1,526,047 | yes | `projects`:94, `innovations`:94, `proposals`:2087, `adoptions`:279 |
| `network.json` | `d2ffad53a4bdfa62406bff9db0377fe935a1ebba299c81a3c0f87512ed1da577` | 10,786,348 | yes | `channels`:259, `missionRoutes`:16698, `knowledgeRoutes`:412, `collaborations`:228 |
| `registry.json` | `01781358cc8a93f6a6fa6537404a17eb9243224f76759ff8a130b4c5959ef949` | 1,743,140 | yes | `members`:2526, `alliances`:203 |

**Schema source (`civilizationState.cjs` comments + `DEFAULTS`, lines 34-75):**
`registry` = member organizations + alliances; `council` = council members + proposals +
votes; `constitution` = articles + amendments + precedents; `economy` = resource ledger
(`balances`, keyed by memberId) + trades + resourcePools; `network` = collaboration
channels + mission routes (with nested `bids[]`) + knowledge routes + collaborations;
`diplomacy` = treaties + disputes + arbitrations + negotiations (with nested `rounds[]`);
`innovation` = research projects (with nested `findings[]`) + innovations + evolution
proposals (named `proposals` in the file) + adoptions.

---

## PER-FILE SUSPICIOUS RECORD INVENTORY (Steps 2 + 4)

Method: every civ-v9.test.cjs state-mutating call (Blocks 1–14, lines 39–817) was
enumerated with its exact literal/template arguments, then cross-matched against every
array in all seven files, including the `civilizationWorkflow.cjs` transformations the
pipeline applies (`Cross-org: ${command}`, `Knowledge: ${command}`, `Goal:
${command.slice(0,120)}`, `Civilization Report: ${title.slice(0,80)}`,
`Civilization initiative: ${command}`). A record is classified **A (proven
test-generated)** only when it matches a literal/structural signature unique to a
specific cited test line, or carries a direct foreign-key reference to an already-proven
record; **B (proven legitimate)** when it is structurally inconsistent with every test
call and/or predates all identified burst clusters; **C (ambiguous)** when evidence is
incomplete or conflicting.

### constitution.json (re-examined; not just the 2 records Mission 99 removed)

- **`articles` (6 total): Category B — proven legitimate.** All 6 are the genesis set
  (`articleNumber` 1–6: Right to Participate, Obligation to Cooperate, Resource
  Reciprocity, Dispute Resolution, Innovation Adoption, Reputation Integrity), created by
  `civilizationWorkflow.cjs`'s `bootstrapCivilization()` (idempotent, checked via
  `addConstitutionalArticle`'s own `articleNumber` dedup guard at
  `civilizationState.cjs:269-270`). civ-v9.test.cjs line 154 (`articleNumber: 100`) is
  structurally distinct from all 6 and, after the first run created it, every subsequent
  run's identical call was rejected by the dedup guard (line 159's own test,
  `"addConstitutionalArticle — dedup articleNumber"`, proves this is expected/tested
  behavior) — which is *why* only one polluted article (already removed by Mission 99)
  ever existed, while its dependent amendment was not similarly guarded.
- **`amendments` (206 total, currently in file): Category A — 206/206 (100%) proven
  test-generated.** Every single amendment has `change === "Add clause for AI rights"`
  and `rationale === "AI entities need representation"`, a byte-for-byte match to
  civ-v9.test.cjs:172 (`proposeAmendment — ok`). `proposeAmendment` has no dedup guard
  (unlike `addConstitutionalArticle`), so it succeeded on every one of the ≥55 historical
  test runs. **Correction to Mission 99:** all 206 target the SAME `articleId`,
  `cart_1782601786594_n5sg` — this is legitimate Article 1 ("Right to Participate"),
  because the test's `arts[0].id` (line 170-171, `listArticles({})` sorted by
  `articleNumber`) always resolves to the lowest-numbered article, which after the first
  run's fake article was later removed (by Mission 99) or was simply never `arts[0]` (the
  fake article's number was 100, never sorted first) is always Article 1. Mission 99's
  report described the amendment as attached to the *fake* article
  (`cart_1782601786128_xyxt`) — true only for that one run's single surviving amendment
  at the time Mission 99 looked; the other 205 were not examined and all point at the
  real Article 1. Removing these amendments requires no removal or edit of Article 1
  itself — Article 1 is legitimate and must be preserved untouched.
- **`precedents` (405 total): Category A — 405/405 (100%) proven test-generated.** Every
  precedent has `title` matching `/^Precedent-\d{10,13}$/` (civ-v9.test.cjs:178, also
  re-invoked at line 442's `closeArbitration` call), `ruling` matching either
  `"Members must share knowledge freely"` (line 178) or
  `"Parties share resources equally"` (line 442), and `caseRef: "CASE-001"` — a fixed
  test constant (line 178) that no legitimate precedent-recording call in this codebase
  reuses. Mission 99's characterization of "all 405 precedents (untouched)" as implicitly
  safe was a correct statement about *what Mission 99 did* (it touched nothing) but not a
  finding that they were legitimate — they were never checked. They are not.

### council.json

- **`members` (416 total): 406/416 (97.6%) Category A**, referencing a `memberId` that is
  itself a proven civ-v9-generated registry member (see registry.json below); traceable to
  civ-v9.test.cjs:101,112 (`addCouncilMember`) and Block 13's `civilizationOrg.cjs`
  registration flow. **10/416 (2.4%) Category C — ambiguous**: their `memberId` (e.g.
  `cmem_1782947457869_9hmp`, `cmem_1786794118702_otlk`) has a timestamp that falls exactly
  within a known civ-v9 burst cluster window, but the referenced member does not exist in
  the *current* `registry.json` at all (dangling foreign key — not present under any ID).
  Evidence is directionally consistent with test origin (timestamp) but the required
  structural proof (an existing member record to confirm the name pattern) is missing —
  flagged Category C rather than assumed.
- **`proposals` (624 total): Category A — 624/624 (100%).** Every title matches
  `Proposal-<TS>`, `VoteTest-<TS>`, or `DupVote-<TS>` (civ-v9.test.cjs:123, 130, 137).
- **`votes` (0 total):** empty array — nothing to classify. (Votes are stored inline on
  each proposal's own `.votes[]`, not in this top-level array; the top-level `votes: []`
  in `council.json`'s `DEFAULTS` is unused dead schema, confirmed by
  `civilizationState.cjs:64` never pushing to it.)

### diplomacy.json

- **`treaties` (626 total): Category A — 626/626 (100%).** Titles match `Treaty-<TS>`
  (line 401), `Conclude-<TS>`/auto-created via `concludeNegotiation` (line 465, 683),
  `Partnership <TS>` (line 690), `Full flow <TS>` (line 812).
- **`disputes` (197 total): Category A — 197/197 (100%).** Titles match `Dispute-<TS>`
  (line 431).
- **`arbitrations` (197 total): Category A — 197/197 (100%).** Every `ruling` field is
  the exact literal `"Parties share resources equally"` from `closeArbitration`
  (civ-v9.test.cjs:442) — no arbitration in the file has any other ruling text.
- **`negotiations` (823 total): Category A — 823/823 (100%).** Titles match
  `Negotiation-<TS>` (line 451), `NegRound-<TS>` (line 457), `Conclude-<TS>` (line 464),
  `Partnership <TS>` (line 690, via `negotiateBetweenOrgs`), `Full flow <TS>` (line 812).

### economy.json

- **`balances` (2377 keyed entries, object not array):** keyed by `memberId`; not
  independently classifiable as records (they are per-member running totals, created as a
  side effect of `registerMember`/`creditResource`/`debitResource`). Classification
  follows the owning member: **≥775 keys correspond to proven civ-v9 members** (every
  civ-v9 registry member gets an initial balance per `registerMember`,
  `civilizationState.cjs:152`); the remainder correspond to other-test-suite members (see
  registry.json) or `"global"`-style pool aggregation, none proven civ-v9-specific beyond
  the 775.
- **`trades` (597 total): Category A — 597/597 (100%).** 199 trades have
  `description === "Compute for knowledge exchange"` (`proposeTrade`, line 224-228,
  225-228); the remaining 398 have `description === ""` with `offer:{compute}` /
  `request:{knowledge}` shape and `fromMemberId`/`toMemberId` both resolving to proven
  civ-v9 members — an exact structural match to the parameterless `acceptTrade` calls at
  lines 236 and 245 (`acceptTrade — executes resource transfer`,
  `acceptTrade — wrong acceptor rejected`), which never set a `description`.
- **`resourcePools` (1 key: `"global"`):** written to by `contributeToPool`/`claimFromPool`
  (civ-v9.test.cjs:254-268); the pool is a shared aggregate, not a per-run record, so it
  cannot be cleanly attributed to one run — flagged for MISSION 101 as a value that will
  need re-derivation (not simple deletion) after any trade/balance repair, since its
  current numeric value was built up additively across all 55+ runs.

### innovation.json

- **`projects` (94 total): Category A — 94/94 (100%).** Titles match `Research-<TS>`
  (civ-v9.test.cjs:477).
- **`innovations` (94 total): Category A — 94/94 (100%).** Titles match `Innovation-<TS>`
  (line 496); `description`/`implementation` fields are also exact literal matches
  (`"Novel consensus algorithm"`, `"Use weighted voting with reputation"`).
- **`proposals` (2087 total, evolution proposals): 277/2087 (13.3%) Category A** —
  titles match `Evo-<TS>` (line 522) with `change: "Add self-healing to all engineering
  orgs"` / `rationale: "Reduces downtime"` (line 522, exact literal match). **1810/2087
  (86.7%) Category B — proven legitimate/different-origin**: titles read
  `"Enhance autonomous decision quality — cycle N"` with `proposerId: "autonomous_system"`
  — structurally inconsistent with every civ-v9.test.cjs call (which always sets a real
  `memberA`/`memberB`/`memberC` id as `proposerId`, never the literal string
  `"autonomous_system"`) and produced by a separate autonomous-tick subsystem outside this
  mission's scope. Confirmed out of scope per CLAUDE.md §14.6 (stop at mission scope, do
  not silently expand).
- **`adoptions` (279 total): Category A — 279/279 (100%).** Every `adoption.innovationId`
  resolves to one of the 94 Category-A innovations above (direct FK match, no adoption
  targets any other innovation).

### registry.json

- **`members` (2526 total): 775/2526 (30.7%) Category A** — names match
  `OrgA-<TS>`/`OrgB-<TS>`/`OrgC-<TS>`/`LowRep-<TS>` (civ-v9.test.cjs:40, 54, 60, 666).
  **1751/2526 (69.3%) Category B — proven legitimate/different-origin**: names match
  patterns (`AgencyA-<TS>`, `BlueprintA-<TS>`, `Clone-<TS>`, `BPClone-<TS>`,
  `Roundtrip-<TS>`, `Fork-<TS>`, `Imported-<TS>`, `CertOrg-<tier>-<TS>`,
  `SmokeClone-<TS>`, `EventTest-<TS>`, and 9 more) that are **confirmed present verbatim
  in `tests/runtime/platform-omega.test.cjs`** (`grep` confirmed), a wholly separate test
  suite that also exercises `civilizationState.registerMember()`. This is a distinct
  pollution source with its own separate proof chain — explicitly out of Mission 100's
  scope (which is scoped to civ-v9 only) and must not be conflated with or repaired
  alongside the civ-v9 findings. **No record in `registry.json` was found to be
  hand-entered/organic production data** — every one of the 2526 members traces to one
  of these two test suites; there is currently zero verified-legitimate organic
  civilization membership data in this file.
- **`alliances` (203 total): Category A — 203/203 (100%).** Names match `AllianceAB-<TS>`
  (civ-v9.test.cjs:87); all `memberIds` resolve to proven civ-v9 members.

### network.json

See CROSS-FILE REFERENCE GRAPH below for full graph statistics. Record-level summary:

- **`channels` (259 total): 254/259 (98.1%) Category A** (`TestChannel-<TS>`,
  `DupChannel-<TS>`, civ-v9.test.cjs:282, 288-289). **5/259 not civ-v9-attributable** —
  likely `bootstrapCivilization()`'s own seeded default channels (the workflow seeds ≥5
  channels per the test's own assertion at line 792, `"civilization has bootstrapped
  channels post-registration"` expecting `channels.length >= 5`) — Category B, legitimate
  bootstrap seed data, not test pollution.
- **`missionRoutes` (16,698 total): Category A — 16,698/16,698 (100%).** Direct literals
  (`Build AI system <TS>`, `EOS link test <TS>`, civ-v9.test.cjs:300, 803) plus workflow
  wrapper `Cross-org: <command>` (civilizationWorkflow.cjs:122) applied to every pipeline
  command literal (`Test command <TS>`, `Build civilization feature <TS>`,
  `Health test <TS>`, `Resource-backed initiative <TS>`, `Cross-layer smoke <TS>`,
  `Delegate task <TS>`). The dominant single pattern, `Cross-org: Cross-layer smoke <TS>`,
  alone accounts for 15,933 of the 16,698 (95.4%) — one per historical test run's Block 12
  pipeline invocation at line 796, each of which also recursively re-triggers
  `crossOrgCoordination` inside `runCivilizationPipeline`. This also carries **5,865
  nested `bids[]` sub-records**, all with `proposal: "Auto-delegated by director"` — a
  literal generated by an autonomous "director" bidding process (`civilizationOrg.cjs` /
  autonomous engine), not directly from civ-v9.test.cjs, but only fired *because* it was
  auto-bidding on these test-created mission routes — classified Category A by direct
  parent-record dependency (the mission route it bid on is 100% proven test-generated).
- **`knowledgeRoutes` (412 total): Category A — 412/412 (100%).** Direct literal
  `Knowledge <TS>` (line 326) plus workflow wrapper `Knowledge: <command>`
  (civilizationWorkflow.cjs:127) applied to the same pipeline command literals as above.
- **`collaborations` (228 total): Category A — 228/228 (100%).** Names match `Collab-<TS>`
  / `CompleteCollab-<TS>` (civ-v9.test.cjs:337, 343).

---

## CROSS-FILE REFERENCE GRAPH (Step 3)

Starting from the two Mission-99-known-polluted constitution.json IDs
(`cart_1782601786128_xyxt`, `camend_1782601786128_hzgd` — both already removed, confirmed
absent from the current file), the reference chain was traced forward: the retained
Article 1 (`cart_1782601786594_n5sg`) is now the target of all 206 amendments (see above).
`proposerId`/`fromMemberId`/`toMemberId`/`memberId` fields across all seven files
overwhelmingly resolve to `registry.json`'s 775 civ-v9-tagged members (`cmem_*` ids whose
owning record has an `OrgA-/OrgB-/OrgC-/LowRep-<TS>` name) or, for autonomous-bid records,
the literal pseudo-ids `"system"` / `"autonomous_system"` (not real registry entries — used
directly as fallback values in `civilizationWorkflow.cjs:122,127` when no `memberId` is
supplied).

### network.json graph statistics (required special subsection)

Built by treating every `memberId`-shaped field across `channels[].memberIds`,
`missionRoutes[].fromMemberId/assignedTo/bids[].bidderMemberId`,
`knowledgeRoutes[].fromMemberId/toMemberId`, and `collaborations[].memberIds` (pairwise) as
graph edges:

- **Unique node IDs referenced:** 391
- **Unique edges:** 22,604 (mission-bid, mission-assigned, knowledge-share, and
  pairwise-collaboration edge types combined)
- **Nodes that are proven civ-v9-polluted registry members:** 389 / 391 (99.5%)
- **Nodes that exist in `registry.json` under some OTHER (non-civ-v9) classification:** 0
- **Nodes with no matching `registry.json` entry at all (the two pseudo-ids):** 2
  (`"system"`, `"autonomous_system"` — literal fallback strings, not real member records)
- **Edges touching at least one civ-v9-proven node:** 22,604 / 22,604 (100%)
- **Edges touching an unknown/dangling node with no civ-v9 node also present:** 0
- **Edges entirely among other-known (legitimately-distinct, non-civ-v9) registry
  members:** 0

**Conclusion for network.json:** there is currently no legitimate graph state in this
file that a civ-v9 repair would orphan, because there is no node in the graph that is
*not* either a proven civ-v9 member or one of the two literal system pseudo-ids. This
removes the "do not delete a node that legitimate edges also depend on" conflict Mission
99 anticipated — the conflict does not currently exist in this file, but this finding
should be re-verified by MISSION 101 immediately before any deletion, in case concurrent
production/test activity (this repo has multiple long-running sessions, per `git status`)
adds new legitimate nodes between now and then.

### Constitution ↔ sibling cross-references

- `cart_1782601786594_n5sg` (Article 1, legitimate) ← referenced by all 206 amendments'
  `articleId`. No sibling file references this ID.
- No `precedent.id` or `amendment.id` is referenced by any of the six sibling files
  (one-way references only: constitution.json's own records reference registry members,
  not vice versa).
- `caseRef: "CASE-001"` (all 405 precedents) does not correspond to any `arbitration.id`
  in `diplomacy.json` — it is a fixed test literal, not a real cross-reference, confirming
  it is test-authored rather than a genuine case-tracking value.

---

## IMMUTABLE FORENSIC SNAPSHOT (Step 5)

All data above (file hashes/sizes/record counts, the full suspicious-ID inventory with
A/B/C classifications, the reference-graph findings, and network.json's graph statistics)
is captured in this report as the immutable snapshot. No backup files were created this
mission (per explicit instruction — no mutation is authorized, so no backup is needed
yet). Intermediate working artifacts (extracted ID lists, the pattern-matching sweep
scripts and their JSON outputs) were written only to
`/private/tmp/claude-501/-Users-ehtsm-jarvis-os/066a0509-4f69-4e07-a8fb-7fea003b43a4/scratchpad/`,
never back to `data/civilization/`.

---

## NO-MUTATION VERIFICATION (Step 6)

| File | SHA-256 (Step 1 baseline) | SHA-256 (final, post-regression-run) | Identical? |
|---|---|---|---|
| `constitution.json` | `6c7424b2cd0fb10518ab14a2ba6ff777f5fc49d8bdefdd400c711758196c4d7a` | `6c7424b2cd0fb10518ab14a2ba6ff777f5fc49d8bdefdd400c711758196c4d7a` | YES |
| `council.json` | `d6b6c8cdad84b10cf739474d4e9b4fa2a5757d27614c3cb12d68f125cbc6c4cf` | `d6b6c8cdad84b10cf739474d4e9b4fa2a5757d27614c3cb12d68f125cbc6c4cf` | YES |
| `diplomacy.json` | `1e8ebaad39b34947a9e5ee57ec1783378c0972fc14de5f67c6d1fd25518231f3` | `1e8ebaad39b34947a9e5ee57ec1783378c0972fc14de5f67c6d1fd25518231f3` | YES |
| `economy.json` | `4f97415ffd7d3dcc8dd098d441b166218579b9733ce1dd8db24bbcd299a3f09a` | `4f97415ffd7d3dcc8dd098d441b166218579b9733ce1dd8db24bbcd299a3f09a` | YES |
| `innovation.json` | `26f7086c449cafb019cd73b1b198cc0f975f4302948507c818bfdb985b87a457` | `26f7086c449cafb019cd73b1b198cc0f975f4302948507c818bfdb985b87a457` | YES |
| `network.json` | `d2ffad53a4bdfa62406bff9db0377fe935a1ebba299c81a3c0f87512ed1da577` | `d2ffad53a4bdfa62406bff9db0377fe935a1ebba299c81a3c0f87512ed1da577` | YES |
| `registry.json` | `01781358cc8a93f6a6fa6537404a17eb9243224f76759ff8a130b4c5959ef949` | `01781358cc8a93f6a6fa6537404a17eb9243224f76759ff8a130b4c5959ef949` | YES |

All seven files (constitution.json included, for completeness even though it was
Mission 99's scope, not this mission's) are byte-identical to their Step 1 baseline
hashes. Zero mutation occurred during this mission, including during the mandated
regression test run. `git status --short` line count remained 58 throughout (unrelated
concurrent-session files only; `data/` is gitignored so none of these seven files ever
enter git's view).

---

## REGRESSION SAFETY RESULTS (Step 7)

- **Command run:** `node --test tests/runtime/civ-v9.test.cjs` (only this single file —
  the broader test corpus was explicitly NOT run, per mission scope).
- **Result:** **115 passed, 0 failed** out of 115 (test's own internal counter) /
  Node's `--test` harness reports 1 top-level test file, pass 1, fail 0.
- **`constitution.json` hash before this run:**
  `6c7424b2cd0fb10518ab14a2ba6ff777f5fc49d8bdefdd400c711758196c4d7a`
- **`constitution.json` hash after this run:**
  `6c7424b2cd0fb10518ab14a2ba6ff777f5fc49d8bdefdd400c711758196c4d7a` — **identical**,
  confirming the Phase 0-2 `JARVIS_TEST_DATA_SUFFIX` isolation fix in
  `civilizationState.cjs` continues to prevent re-pollution, consistent with Mission 99's
  finding.
- **All six sibling files' hashes before/after this run:** identical (see NO-MUTATION
  VERIFICATION table above) — the isolation fix protects all seven files uniformly, since
  they share one `DATA_DIR` resolution (`civilizationState.cjs:31-33`).
- **Observed side effect (informational, not a defect, not touched):** the test run
  created a new isolated directory,
  `data/civilization.test-67089-1788961961549/`, exactly as `JARVIS_TEST_DATA_SUFFIX` is
  designed to do (civ-v9.test.cjs:14). Two additional such directories from other,
  unrelated sessions already existed
  (`civilization.test-55727-1788960411885`, `civilization.test-57748-1788960783336`) —
  these are test-isolation artifacts, not part of the six files this mission is
  constrained to, and were left untouched (out of scope; no instruction to clean them).
- **JSON validity re-check on all six sibling files (Step 1/6 overlap):** all six parse
  cleanly with `JSON.parse` post-test-run, matching their pre-run schemas exactly (no
  structural change).

---

## MISSION 101 SHOULD:

1. **Identify the exact proven test-generated records — reference this report's
   Category-A inventory directly** rather than re-deriving it: 206/206 constitution
   amendments, 405/405 constitution precedents, 406/416 (with 10 Category-C exceptions)
   council members, 624/624 council proposals, 626/626 diplomacy treaties, 197/197
   diplomacy disputes, 197/197 diplomacy arbitrations, 823/823 diplomacy negotiations,
   597/597 economy trades, 94/94 innovation projects, 94/94 innovation innovations,
   277/2087 innovation evolution proposals (NOT the other 1810 — those are
   `autonomous_system`-authored and out of scope), 279/279 innovation adoptions, 775/2526
   registry members (NOT the other 1751 — those are `platform-omega.test.cjs`-attributable
   and need their own separate forensic pass, not folded into this repair), 203/203
   registry alliances, 254/259 network channels (NOT the 5 bootstrap-seeded ones),
   16,698/16,698 network mission routes (including their 5,865 nested bids), 412/412
   network knowledge routes, 228/228 network collaborations.
2. **Create verified pre-repair backups of all seven files** (constitution.json included,
   to protect the Article 1 target that will remain after amendment cleanup) using the
   same temp-file-then-rename, hash-verified convention Mission 99 used.
3. **Perform surgical deletion only on category-A records**, filtering by the exact
   `id` sets enumerable from this report's per-file sections (the full ID lists were
   generated during this mission and are reproducible via the same
   literal/structural-match method documented here — re-derive them fresh rather than
   trusting a stale list, since new civ-v9 runs may have added more between missions).
4. **Repair dependent references only where proven necessary** — cite exactly:
   `innovation.adoptions` must be filtered in lockstep with `innovation.innovations` (all
   279 adoptions reference a to-be-deleted innovation, so all 279 must go together, not
   independently); `network.missionRoutes[].bids[]` must be dropped together with their
   parent mission route (do not attempt to keep an orphaned bid); **Article 1
   (`cart_1782601786594_n5sg`) itself must NOT be touched** — only its 206 dependent
   amendments are deleted, exactly mirroring the asymmetric pattern Mission 99 already
   established for the (now-removed) fake article + its one dependent amendment.
5. **Verify graph integrity after any `network.json` edits** — re-run this mission's
   node/edge census (391 nodes / 22,604 edges baseline) and confirm the post-repair graph
   has zero dangling edges (an edge whose endpoint no longer exists) — since this
   mission's Step 3 finding was that literally all current nodes are civ-v9-attributable
   or the two system pseudo-ids, a full civ-v9 repair of network.json is expected to leave
   very few or zero real records; MISSION 101 must explicitly confirm this expectation
   against live data at repair time, not assume it.
6. **Verify all legitimate records remain unchanged** — specifically the 6 constitution
   articles (byte-for-byte, especially Article 1's `content`/`adoptedAt`), the 5
   bootstrap-seeded network channels, the 1810 `autonomous_system`-authored innovation
   proposals, and the 1751 platform-omega-attributable registry members (these last two
   groups must survive a civ-v9-only repair completely untouched — verify by count and by
   hash-of-subset before/after, not just overall file validity).
7. **Rerun focused civ-v9 validation** (`node --test tests/runtime/civ-v9.test.cjs`,
   expect 115/115) immediately after repair, exactly as this mission did pre-repair.
8. **Prove no re-pollution** by re-hashing all seven files immediately after that
   validation run, exactly as Step 7 of this mission did — the isolation fix is already
   proven effective (twice now, across Mission 99 and Mission 100), but the discipline of
   re-checking rather than assuming must continue.
9. **Separately scope and mission-ize the `platform-omega.test.cjs`-attributable
   registry.json pollution (1751 records)** — confirmed present via literal grep match
   but never forensically traced line-by-line the way civ-v9 was in this mission; do not
   fold it into the civ-v9 repair, and do not leave it undocumented either.
10. **Resolve the 10 Category-C council.json dangling-memberId records** — either find
    additional evidence (e.g. a wider timestamp/ID search this mission did not attempt)
    to promote them to Category A, or explicitly document them as a permanent
    orphaned-reference defect distinct from the civ-v9 pollution class.
