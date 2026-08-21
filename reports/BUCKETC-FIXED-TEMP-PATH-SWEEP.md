# PERSISTENCE BUCKET-C FIXED-TEMP-PATH SWEEP

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-20 · **Branch:** `security/reality-completion`

---

## Scope

The 60 files identified in the prior Persistence Integrity Sweep as sharing a fixed (non-unique)
temporary-filename pattern (`${file}.tmp` rather than `${file}.${pid}.${random}.tmp`) for their JSON-store
writes. Excluded (already certified in prior missions): `sqlite.cjs`, `taskQueue.cjs`,
`businessDataService.cjs`, `crmService.js`, `approvalQueue.cjs`, `deadLetterQueue.cjs`,
`missionMemory.cjs`, `accountService.js`, `secretVault.cjs`'s audit/history fixes,
`memoryPersistenceLayer.cjs`, `engineeringSession.cjs`. Not re-opened: the cross-process lost-update
architecture decision, the `priorityQueue.cjs` persistence decision, the `localAccountSystem.cjs`
dead-code decision — all settled in prior missions.

## Method

The prior mission established the precise, narrow condition under which a fixed (vs. unique) tmp name is
actually exploitable: **not** general crash-safety (`rename()` is equally atomic regardless of tmp-name
uniqueness — a SIGKILL mid-write is survived the same way either way), but specifically **concurrent-
writer collision** — two callers racing to write the same shared tmp path. That, in turn, requires two
conditions simultaneously: (1) the deployment must permit genuine concurrency in the first place, and (2)
the specific write function must itself be interruptible mid-operation.

Re-confirmed condition (1) is absent by design: `ecosystem.config.cjs` is still pinned to `instances: 1,
exec_mode: "fork"` — a single Node process, no cluster workers, so cross-process collision is
architecturally impossible in this deployment. That leaves only intra-process interleaving as a possible
vector — which requires the specific write function to be `async` with a real `await` gap between reading
old data and writing new data (a fully synchronous function, however "concurrently" it's called by two
Express request handlers, cannot be interrupted mid-execution by Node's single-threaded event loop).

Personally investigated the 5 highest-stakes files directly (`personalOS.cjs`, `developerOS.cjs`,
`enterpriseOS.cjs`, `businessOS.cjs`, `goalEngine.cjs` — real, live, HTTP-reachable data stores, one of
which — `personalOS.cjs` — was the exact store found unauthenticated in the immediately prior mission).
Delegated the remaining 55 files to a background research agent with the precise classification criteria
above, cross-checked its two most load-bearing claims independently (a mutex-protected async writer, and
the one apparent false-positive grep match).

## Findings — 0 genuine defects across all 60 files

**24 files have zero `async function` declarations anywhere in the file** — trivially safe; every write
path is fully synchronous, so no intra-process interleaving is possible regardless of what the fixed tmp
name might otherwise expose.

**31 files contain at least one async function elsewhere in the file, but the specific write-path
function itself (`_save`/`_wj`/`_persist`/`_saveStore`/etc.) is fully synchronous** — confirmed
individually for all 31 (line-level `writeFileSync`/`renameSync`, no `await` between load and write).

**5 files use a genuinely async write path** (`backend/services/backgroundRuntime.cjs`,
`missionCollaborationEngine.cjs`, `engineeringPipelineCoordinator.cjs`, `missionOrchestrator.cjs`,
`deploymentCoordinator.cjs`) — each protected by an explicit single-flight mutex (`_writing`/
`_recsWriting`/`_orcWriting` flag, checked and set *before* the async `fs.writeFile`/`setImmediate` chain
begins, with a `_dirty`-flag requeue for any write requested while one is already in flight). Verified
directly for `missionCollaborationEngine.cjs`: `_save()` sets `_writing = true` synchronously before
yielding to `setImmediate`, and any concurrent `_save()` call while that flag is set returns immediately
without starting a second write — genuinely single-flight, independent of and stronger than the
pid+random tmp-name pattern used elsewhere. This protection was itself the fix for a *different*,
already-resolved bug (dropped writes when `_dirty` wasn't requeued) — its side effect is that it also
closes the fixed-tmp-name collision risk for these 5 files.

**`personalOS.cjs`, `developerOS.cjs`, `enterpriseOS.cjs`, `businessOS.cjs`** — zero async functions of
any kind (confirmed: 0/33, 0/49, 0/54, 0/43 respectively). All 4 are called only from fully synchronous
Express route handlers in `ops.js`/`enterpriseOS.cjs`'s own barrel — the entire request-to-response cycle
for every route backed by these files is synchronous JS with no microtask yield point, so two "concurrent"
HTTP requests are strictly serialized by the event loop before either can begin its write.

**`goalEngine.cjs`** — 1 async function (`executeGoalTask`, the only one in the file) genuinely has a
real `await` gap (awaiting a whole project run via `projectRunner.runProject()`) around calls to the
same fixed-tmp-name `_saveGoals()` that every other, synchronous goal-mutating function also uses —
structurally a real concurrent-collision shape if it were reachable. Confirmed via exhaustive repo grep:
**zero callers anywhere in the codebase** — exported but never invoked, genuinely dead code. Not fixed,
per the mission's own explicit instruction that a fixed-temp pattern in genuinely unreachable code is not
automatically a defect.

**`backend/services/rc3.cjs`** — the one grep match that is not a write site at all: its `.tmp`/
`renameSync` occurrence is a string-based readiness-check scanning *other files'* source text for the
presence of the atomic-write pattern (an RC-3 certification probe), not a persistence operation of its
own. Dropped from the candidate list entirely — not applicable to this defect class.

## Fixes

**None.** No genuine, reachable defect was found in this 60-file inventory. Per the mission's explicit
"this is NOT a blind bulk replacement" / "do not fix a fixed-temp pattern merely because grep finds it"
instructions, no code was changed.

## Decision required

None carried forward from this mission. (`goalEngine.cjs`'s `executeGoalTask` is worth noting for a
future session if it's ever wired up to a real caller — at that point it would need the same unique-tmp-
name treatment `_saveGoals()`'s siblings already got implicitly via their synchronous-only reachability —
but this is not a live decision today.)

## Live Verification

Since no fix was made, live verification took the form of independently re-confirming the audit's own
safety claims rather than a before/after fix reproduction: verified `ecosystem.config.cjs`'s
`instances:1, exec_mode:"fork"` pinning is still present (the load-bearing architectural fact the whole
synchronous-write safety argument depends on); verified `missionCollaborationEngine.cjs`'s mutex
mechanism directly by reading its `_save()` implementation; verified `goalEngine.cjs`'s `executeGoalTask`
has zero real callers via exhaustive grep; verified `rc3.cjs`'s match is a readiness-check string scan,
not a write site.

## Regression

**Before:** 371/371. **After:** 374/374 (clean run; no fixes made, so no negative-testing cycle applies).
**New tests:** 3 (block 156) — structural pins on the two safety properties this audit's classification
depends on (deployment concurrency architecture, mutex presence on the 5 async writers) plus a live check
that the 5 highest-stakes files' async-function counts and `executeGoalTask`'s unreachability haven't
drifted — so a future change that silently reintroduces this exact bug class (e.g. converting a
currently-sync `_save()` to async without adding the same mutex, or wiring up `executeGoalTask`) is
caught by regression rather than requiring this investigation to be redone from scratch. Production
build: PASS. `tests/security/97-enterprise-isolation-integrity.cjs`: 1/1 PASS. `.env` untouched. Server
confirmed healthy (`GET /health` → 200) throughout, same PID, no restart required (no source files were
changed).

**No OS-track record altered.**
