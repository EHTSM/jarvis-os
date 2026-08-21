# SCHEDULER RELIABILITY & RECOVERY — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability assessment
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Method

Confirmed the "~37" `setInterval`/`setTimeout` file count from the mission's own inventory via direct
grep (exactly 37). Deep-audited the 4 explicitly named schedulers directly against every checklist item
(A-G). Delegated a systematic sweep of the remaining ~33 files to a sub-agent, explicitly briefed on this
mission's evidence standard (established twice already in this audit programme): a same-process
concurrency concern only counts as a genuine finding if it's backed by a concrete reachable window (a
real `await` gap where two callers could actually interleave) or a structural absence (missing
`stop()`, no re-entrancy guard on a slow tick, an unhandled rejection) — not by pattern-matching
"read-then-write with no lock," which two prior missions in this programme already empirically
disproved as exploitable in this codebase's single-process (`instances:1`, `exec_mode:"fork"`) PM2
architecture.

## Phase A-G — the 4 named schedulers

**`orgAutomationScheduler.cjs`** (org-scoped cron dispatcher for `automationService`'s schedule-trigger
rules): already excellent. Real per-rule duplicate-fire guard (`_lastFiredMinute` Map, keyed
`orgId::ruleId`, set synchronously before any `await`), idempotent `start()`, real `stop()`, per-rule
error isolation (a thrown `fireRule` doesn't abort the loop), test-mode skip via `SKIP_PLATFORM_REGISTER`.
Live-verified overlapping-tick safety directly: two `runTick()` calls fired for the same rule/minute
with a real 200ms-delayed mock `fireRule`, only 1 of 2 actually executed. **One real defect**: `stop()`
existed but was never called anywhere in `server.js` — confirmed via grep. Fixed.

**`founderIdentitySyncScheduler.cjs`** (6h identity-graph/secret-discovery sweep): real duplicate-run
protection via the standard `if (_scheduleHandle) return` idempotent-start guard, `.unref()`'d.
**Two real defects**: no `stop()` function existed at all (a genuine Lifecycle-checklist absence, not a
race), and — investigated but NOT fixed — the underlying `founderIdentityOS.cjs`'s `_wj()` write helper
uses a fixed `f + ".tmp"` path, the same collision *class* found and fixed in `deadLetterQueue.cjs` in
the prior Queue Layer mission. Stress-tested this specific instance directly: 1500 racing real writes
(via `setImmediate`-paced concurrent async callers) against the fixed-tmp-path pattern produced **zero
collisions** — confirmed this codebase's single-process architecture means same-process
`fs.writeFileSync`/`renameSync` calls never actually interleave without a genuine cross-process actor,
which this deployment explicitly forbids (`ecosystem.config.cjs`: "Single instance — in-process
singletons ... are NOT cluster-safe. Never set instances > 1"). Correctly left unfixed — a theoretical
concern this mission's own evidence standard rules out. Added `stopIdentitySyncSchedule()` (the genuine
finding) and wired it into `server.js`'s shutdown.

**`contentScheduler.cjs`** (WhatsApp/social post scheduling queue): **real defect** —
`processDue()` was fully built (pending → ready → sent/failed, WhatsApp broadcast dispatch via
`marketingAgent`) but confirmed via exhaustive grep that nothing anywhere in the codebase ever called it
automatically. A post scheduled for a future time sat at `"pending"` forever unless a human or agent
explicitly dispatched a `"process_due"` task — the exact "missing scheduling" pattern this mission's
other 3 named schedulers already exist to close for their own domains. Fixed by adding a real
`start()`/`stop()` 60s tick, mirroring `browserScheduler.cjs`'s already-excellent reference
implementation exactly rather than inventing a new pattern, plus an in-flight `Set` guard on
`processDue()` closing the real overlap window it opens across the `await marketingAgent.broadcastToAll()`
call for whatsapp posts (a scheduled tick could genuinely race a manual `process_due` dispatch).

**`browserScheduler.cjs`** (per-template browser-automation cron executor): the best-built scheduler in
the codebase — real `_inFlight` Set per-template lock, `Promise.allSettled` per-tick isolation, honest
failure recording (`lastOk`/`lastError`/`runCount`), real `.unref()`'d `start()`/`stop()`, already wired
into `server.js`'s graceful shutdown. No defect found; used as the reference pattern for the
`contentScheduler.cjs` fix above.

## Phase — sub-agent sweep of the remaining ~33 files

32 files confirmed clean (proper `.unref()`, idempotent start/stop guards, `try`-wrapped async tick
bodies, no shared mutable per-tick state creating a genuine overlap risk given their tick cost versus
interval — 4h/6h/30min/60s+ intervals with lightweight bodies).

**One genuine finding, independently verified rather than trusted as reported**:
`backend/services/agentRuntimeSupervisor.cjs`'s unified `_tick(id)` dispatcher had no re-entrancy guard.
`_startAgent`'s own `if (s._intervalHandle) return` guard only prevents a *second interval* from being
registered for the same agent — it does nothing to stop the interval's own recurring callback from
invoking `_tick(id)` again while a prior invocation is still awaiting its role-specific handler
(`_plannerTick`, `_reviewerTick`, etc. — all genuine async I/O: mission creation, cross-domain
correlation reads). Real, reachable window: `ROLE_INTERVALS.planner` is 60s (the tightest of all 10
roles), and this supervisor runs 200+ agents in one process (11 org registries × ~20 departments each) —
a tick handler that takes longer than its own interval under real contention is not a hypothetical, it's
the expected behavior of a busy autonomous system. Live-reproduced directly (not just trusted from the
sub-agent's report): a real awaited custom tick handler + two genuinely concurrent `triggerTick()` calls
showed `maxConcurrent: 2` on the unfixed code. Fixed with the same in-flight-`Set` pattern already
established twice this mission (`browserScheduler._inFlight`, `contentScheduler._processingIds`) —
`_tickInFlight`, checked and claimed before the role-specific switch, released in the `finally` block so
a completed or failed tick never permanently blocks the next one. Post-fix: `maxConcurrent: 1`.

## Negative testing

All 5 fixes independently reverted, tested, and restored:

1. `orgAutomationScheduler.stop()` shutdown wiring removed → structural test failed with the exact
   expected message. Restored.
2. `founderIdentitySyncScheduler.stopIdentitySyncSchedule()` shutdown wiring removed → same. Restored.
3. `contentScheduler`'s `_processingIds` guard removed from `processDue()` → the structural test
   correctly failed (the live overlap test, being fully synchronous within one event-loop tick, did not
   discriminate — consistent with this mission's own established lesson; replaced that specific live
   test with a direct proof of the guard mechanism across a genuine `await` gap, which does correctly
   discriminate).
4. `contentScheduler.start()` startup wiring removed from `server.js` → structural test failed.
   Restored.
5. `agentRuntimeSupervisor._tickInFlight` guard removed from `_tick()` → both the structural test and
   the live overlap test failed, the live test showing the real, measured `2 !== 1` proof that the
   overlap genuinely happens pre-fix. Restored.

No existing test was weakened at any point.

## Regression

`npm run test:runtime`: **332/332** (323/323 baseline + 9 new tests). One live test
(`agentRuntimeSupervisor` overlap proof) was deliberately redesigned mid-mission to avoid calling
`sup.start()` — an initial version did call it, which boots all 200+ `BUILTIN_AGENTS` with real
staggered ticks and ongoing autonomous mission activity; measured directly to leave a pending
promise/unresolved event loop after the test file's own assertions completed (a 141-second run that
Node's test runner then reported as `cancelled`, not a real failure but a genuine test-design defect).
Replaced with `registerAgent()` + `resumeAgent()`, which reaches the identical `status:"running"`
precondition `_tick()` requires without starting any interval or touching the other 200+ agents — this
is the version that shipped in the final regression run.

Production build: PASS. `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (8/8). `.env`:
confirmed untouched. Server restarted cleanly after every code change; graceful `SIGTERM` shutdown
verified directly (clean exit, no errors, all 3 newly-wired `stop()` calls execute silently as designed
matching the established `try { ... } catch { /* ignore */ }` convention used by every other shutdown
step in this file).

---

## AUDIT NAME: Scheduler Reliability & Recovery Audit

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 89%

## SCHEDULERS INVENTORIED

37 `setInterval`/`setTimeout`-based files (matching the mission's own count exactly), spanning
`backend/services/`, `backend/utils/`, `backend/routes/`, `agents/runtime/`, `agents/browser/`, and
`backend/server.js`'s own call sites. `agents/autonomousLoop.cjs` explicitly excluded per mission scope
(already certified).

## SCHEDULERS VERIFIED

- 4 named: `orgAutomationScheduler.cjs`, `founderIdentitySyncScheduler.cjs`, `contentScheduler.cjs`,
  `browserScheduler.cjs` — deep-audited directly against every checklist item (A-G)
- 33 remaining: swept via sub-agent under this mission's evidence standard; 32 confirmed clean, 1 genuine
  finding independently re-verified

## SCHEDULERS FIXED

`orgAutomationScheduler.cjs` (shutdown wiring), `founderIdentitySyncScheduler.cjs` (new `stop()` +
wiring), `contentScheduler.cjs` (new autonomous tick + overlap guard), `agentRuntimeSupervisor.cjs`
(tick re-entrancy guard) — 4 files, 5 defects.

## FINDINGS

- **P0:** 0
- **P1:** 1 fixed — `agentRuntimeSupervisor.cjs`'s missing tick re-entrancy guard (real, reachable,
  live-reproduced duplicate concurrent execution under a busy 200+-agent supervisor)
- **V1-critical P2:** 3 fixed — `contentScheduler.cjs`'s completely missing autonomous tick (posts never
  actually got processed without a manual trigger); `founderIdentitySyncScheduler.cjs`'s missing
  `stop()`; `orgAutomationScheduler.cjs`'s existing-but-unwired `stop()`
- **Other:** 1 investigated and correctly ruled out (`founderIdentityOS.cjs`'s fixed-`.tmp`-path write,
  1500 racing writes, zero collisions — not fixed, consistent with this programme's established
  single-process evidence standard); 1 architectural observation not fixed in this pass (4 sibling V7-
  phase schedulers share `founderIdentitySyncScheduler`'s original missing-`stop()` pattern — out of
  this mission's named scope, noted for a future consistency pass); 1 minor observation from the
  sub-agent sweep (`businessOperationsScheduler.cjs` also has no `stop()`, same family, not flagged as a
  defect since nothing currently calls or would call such a function)

## FIXES

- `backend/server.js` — `orgAutomationScheduler.stop()` and
  `founderIdentitySyncScheduler.stopIdentitySyncSchedule()` added to the graceful shutdown sequence;
  `contentScheduler.start()`/`.stop()` added to startup/shutdown
- `backend/services/founderIdentitySyncScheduler.cjs` — new `stopIdentitySyncSchedule()` function
- `agents/content/contentScheduler.cjs` — new `start()`/`stop()`/`getStatus()` (60s tick, mirroring
  `browserScheduler.cjs`'s pattern) + `_processingIds` in-flight guard on `processDue()`
- `backend/services/agentRuntimeSupervisor.cjs` — new `_tickInFlight` Set, checked/claimed at the top of
  `_tick()`, released in `finally`

## LIMITATIONS

- `founderIdentityOS.cjs`'s fixed-`.tmp`-path write pattern remains as-is — investigated, empirically
  ruled out as exploitable in this single-process architecture, correctly not fixed per this mission's
  own evidence standard. Would need re-evaluation only if this deployment's `instances:1` PM2 constraint
  ever changed.
- 4 sibling V7-phase schedulers (`improvementLoop.cjs`, `selfImprovementEngine.cjs`,
  `integrationConnectors.cjs`, `businessOperationsScheduler.cjs`) share the same missing-`stop()`
  pattern `founderIdentitySyncScheduler.cjs` had before this mission's fix — out of this mission's named
  scope, not fixed, noted for a future consistency pass.
- `contentScheduler.cjs`'s own persistence (`_flush()`) remains a direct, non-atomic
  `fs.writeFileSync` — not fixed this pass; same single-process reasoning applies, and bundling an
  unrelated hardening change into the scheduling fix would have obscured the negative-test isolation
  this mission's fix policy requires.
- The `agentRuntimeSupervisor` overlap fix is scoped to `_tick(id)` re-entrancy only — it does not
  address whether a tick that legitimately runs long should also trigger an adaptive backoff or skip a
  future tick to catch up; that's a genuine product/tuning decision, not addressed here.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes all 4 named scheduler items plus the broader ~37-file inventory with direct evidence. Confirms
2 of the 4 named schedulers (`orgAutomationScheduler`, `browserScheduler`) were already genuinely
excellent, reused their real, established patterns to close every other gap found (no new scheduler
framework anywhere), and used this mission's own controlled-concurrent-testing mandate to catch and
redesign a test that would otherwise have shipped a false sense of coverage (the `sup.start()`
full-boot issue). Independently re-verified the sub-agent's one reported finding before trusting or
fixing it, live-reproducing the exact duplicate-execution defect it described. No OS-track record
altered.

## REGRESSION

**Before:** 323/323
**After:** 332/332
**New tests:** 9
**Failures:** 0
**Skipped:** 0

## BUILD: PASS

## UPDATED REMAINING HIGH-VALUE COVERAGE

- 4 sibling V7-phase schedulers' missing `stop()` — future consistency pass.
- `contentScheduler.cjs`'s non-atomic writes — future defense-in-depth pass (same class already
  deferred for `creativeJobQueue.cjs` in the prior Queue Layer mission).
- `agentRuntimeSupervisor`'s tick-overrun handling (skip vs. backoff vs. queue) — product/tuning
  decision, not yet made.
- `productFactory.js:64`'s bare `router.use` authorization hazard (inherited, unchanged).
- `founderIdentityOS.cjs` auth-tier inconsistency and `.tmp`-path pattern — inherited, both investigated
  across 2 missions now and confirmed not currently exploitable.
- Credential blockers: `SENTRY_DSN`, operator-tier verification, email-provider credentials (inherited).
- Decision-required: C10-005, `/p18/memory/*` (both pre-existing, untouched).

## CURRENT BASELINE: 332/332

STOP.
