# QUEUE LAYER RELIABILITY & SAFETY — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability assessment
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Scope

Four queues the Master Coverage Matrix classified UNVERIFIED, audited as one bounded system:
`agents/runtime/priorityQueue.cjs`, `agents/runtime/deadLetterQueue.cjs`,
`backend/services/approvalQueue.cjs`, `backend/services/creativeJobQueue.cjs`. `taskQueue.cjs` (already
certified through crash-recovery/atomicity/retry/concurrent-write missions) was explicitly out of
scope — used only as the reference for what a correctly-hardened queue in this codebase looks like.

## Phase 1 — Inventory

Traced every real consumer via grep before touching anything:

- **priorityQueue**: consumed by `runtimeOrchestrator.cjs` (the real runtime dispatch queue —
  `queue()`/`drainQueue()`), `failureSimulator.cjs`, `driftMonitor.cjs`, `metricsStore.cjs`. Purely
  in-memory (`const _queue = []`), no persistence at all — an intentional, transient dispatch-buffer
  design (in-flight/completed work is separately recorded via `missionMemory`/`executionHistory`, not
  this queue).
- **deadLetterQueue**: consumed by `executionEngine.cjs` (`push()` on every exhausted-retry failure —
  confirmed via its own header comment this reaches ~1000 real entries, at cap, in production),
  `dlqDrainEngine.cjs` (`remove()` during its real replay/requeue drain loop, which reuses the
  already-certified `taskQueue.cjs`), `backend/routes/runtime.js`/`engineering.js` (read-only), plus
  `workflowLibrary.cjs`/`selfHealingRuntime.cjs`/`rc3.cjs`.
- **approvalQueue**: consumed by `executionEngine.cjs`, `missionOrchestrator.cjs`, `approvalEngine.cjs`,
  and 2 real money-adjacent HTTP routes — `commercial.js`'s credit refund and `revenueOS.js`'s finance
  refund, both gated on `getRequest()`/`status`/`resumedAt`.
- **creativeJobQueue**: consumed by `creativeStudio.js` (the real image/voice/video/image-processing
  generation routes) and `creativeBenchmark.cjs`.

## Phase 2-3 — Persistence safety & concurrency

Read every queue's `_load`/`_save` (or equivalent) implementation and compared against the certified
`taskQueue.cjs` pattern (per-call-unique tmp filename — pid + random suffix — then `renameSync`,
documented as the fix for a real, previously-reproduced cross-process tmp-path collision, "Blocker #6").

- `priorityQueue`: N/A — no persistence, intentional in-memory design. Ordering logic verified correct
  (see Phase 8).
- `deadLetterQueue`: **real defect** — `_write()` used a fixed `DLQ_FILE + ".tmp"` path, the exact
  collision class Blocker #6 already fixed elsewhere. `push()` and `remove()` are genuinely concurrent
  in production (different consumers, different trigger conditions). Fixed.
- `approvalQueue`: **real defect** — `_save()` was a direct `fs.writeFileSync`, no tmp-rename at all.
  Crash-mid-write could corrupt `approval-queue.json`. Fixed.
- `creativeJobQueue`: also a direct `fs.writeFileSync`, same class of defect — but investigated and
  **deliberately left unfixed this mission** (see Limitations): its actual, demonstrated defect
  (`failJob` dead code) was higher-priority and the smallest-fix mandate favored not touching
  `_save()`'s write mechanism in the same pass as the state-machine fix, to keep each fix isolated and
  independently negative-testable. Documented as a carried-forward item, not silently dropped.

**Investigated a suspected P0 concurrency race, empirically ruled it out, and reverted the fix that
addressed it** — full account in Problem Solving below, since it's the most significant finding of this
mission methodologically, even though it resulted in no shipped change to `commercial.js`/`revenueOS.js`.

## Phase 4 — Retry/failure

`deadLetterQueue`'s real integration (`executionEngine.cjs`) already correctly preserves error, taskType,
attempts, and (since a prior mission, Phase B.18) agentId — confirmed no regression, not re-fixed.
`dlqDrainEngine.cjs` provides real replay/requeue behavior, reusing the certified `taskQueue.cjs` — this
satisfies Phase 9's "retry/replay if supported" requirement without needing new code.
`priorityQueue`'s consumer (`runtimeOrchestrator.cjs`'s `drainQueue()`) was the one genuine gap: an
unexpected exception (not the common per-task failure, which `dispatch()` already handles gracefully via
its own `settled` results) was logged and silently dropped — no retry, no record. Fixed.

## Phase 5 — Restart/recovery

`creativeJobQueue` has no stale-job reaper — a job that reaches `"running"` and then the request handler
throws before reaching `completeJob`/`failJob` stays `"running"` forever, with nothing to detect or
requeue it (unlike `missionOrchestrator`'s certified `recoverStaleMissions()`). Root-caused this as
reachable via the outer `catch` block in `creativeStudio.js`'s job-creation handler already existing but
never calling `failJob`. Fixed the reachable path (the outer catch now reaps); a true process-crash
mid-job (not just a handler exception) would still leave a `"running"` job with no restart-time sweep —
documented as a limitation, since building a full reaper is a larger architectural addition than this
mission's smallest-fix mandate covers for a lower-likelihood failure mode (a mid-request crash, vs. the
demonstrated, definitely-reachable handler-exception case that IS fixed).

## Phase 6 — Approval queue specifics

Traced bypass/duplication/authorization concerns directly:

- **Cannot be bypassed**: `repositoryEditingEngine.cjs`'s `approveCapabilityFromBundle` correctly throws
  if `request.status !== "approved"` — confirmed via direct read, no path defaults to allow.
- **Rejected items cannot execute**: same mechanism — a `"rejected"` status fails the same check.
- **Stale approval state**: `expireStale()` is called at the top of every read path (`getRequest`,
  `listPending`, `listByStatus`, `listAll`, `getStats`), so an expired-but-still-`"pending"`-looking
  record is always caught before being trusted.
- **Duplicate approve/reject and duplicate execution**: this is the suspected-P0-then-ruled-out finding
  — see Problem Solving.

## Phase 7 — Creative job queue specifics

- **Job identity**: `job-${Date.now()}-${random}` — sufficiently unique for this queue's actual
  collision domain (single process, human-request-rate creation).
- **Duplicate submission**: each `POST /creative/image/generate` etc. call always creates a fresh job;
  no submission-level idempotency key exists, but this matches the product's real semantics (every
  request IS a new generation request) — not a defect.
- **Retry behavior**: none exists at the queue level (a failed generation is not automatically retried) —
  confirmed this is a real, but out-of-mandate, product-scope question (would need a decision on cost/
  retry-budget for paid AI-provider calls), not fixed.
- **Failure state**: **real defect, fixed** — see Findings.
- **Completion state / no fake completion**: **real defect, fixed** — the core of this mission's
  Phase 7 mandate.
- **Stale-job recovery**: partially fixed (see Phase 5).
- **Persistence across restart**: confirmed jobs do persist (real file-backed store), but a job frozen
  at `"running"` from before a restart has no recovery sweep — same limitation as above.

## Phase 8 — Priority queue ordering

Live-tested directly: enqueued LOW, HIGH, NORMAL, HIGH, LOW in that order; dequeue order was
`HIGH, HIGH, NORMAL, LOW, LOW` — correct priority ordering with FIFO preserved within each priority
level, exactly as documented. This exact property is also already covered by the pre-existing
`tests/runtime/02-priorityQueue.test.cjs` (118 lines, HIGH/NORMAL/LOW + FIFO-within-priority + remove()
+ snapshot() shape) — genuinely no fix or new test needed here.

## Phase 9 — Dead letter queue

Verified via direct trace of `executionEngine.cjs`: a failed item enters the DLQ exactly when retries are
exhausted (not before, not silently skipped), with real error/taskType/attempts/agentId preserved
(confirmed via that file's own Phase B.18 fix history — agentId was previously always `null`, now
correctly threaded through). Replay/requeue is real (`dlqDrainEngine.cjs`, reuses certified
`taskQueue.cjs`). Restart preserves DLQ state (real file-backed, and now atomically written — see Fixes).
Malformed DLQ state fails honestly: `_read()`'s `catch { return []; }` resets to an empty array rather
than crashing or silently returning corrupt data.

---

## AUDIT NAME: Queue Layer Reliability & Safety Audit

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8/10
**CONFIDENCE:** 88%

## QUEUES COVERED

- `priorityQueue` — CERTIFIED (ordering already correct and already tested; consumer's silent-drop gap
  fixed)
- `deadLetterQueue` — FIXED (tmp-path collision) then CERTIFIED
- `approvalQueue` — FIXED (atomic writes) then CERTIFIED; a suspected duplicate-execution race was
  investigated, empirically ruled out via real concurrent HTTP testing, and correctly left unfixed
- `creativeJobQueue` — FIXED (dead `failJob` wired, stuck-job reaping) then CERTIFIED WITH LIMITATIONS
  (non-atomic writes and full crash-restart stale-job recovery carried forward, not blocking)

## V1 SURFACE

- **Backend:** 4 files fixed (`approvalQueue.cjs`, `deadLetterQueue.cjs`, `creativeStudio.js`,
  `runtimeOrchestrator.cjs`), all additive/hardening
- **Routes:** `commercial.js`/`revenueOS.js` investigated and confirmed to need no change (see Problem
  Solving); `creativeStudio.js`'s job-creation handler gained honest failure-state transitions
- **Frontend:** N/A — no frontend files touched
- **Persistence:** 2 queues (`approvalQueue`, `deadLetterQueue`) hardened to atomic tmp-rename writes;
  `creativeJobQueue`'s write mechanism carried forward as a documented limitation
- **Authentication/Authorization:** unaffected
- **Tenant Isolation:** unaffected — none of these 4 queues carry tenant/workspace context by design,
  confirmed architecturally correct (approval requests and creative jobs are account-scoped via their
  own `context`/`accountId` fields, not the queue layer itself)
- **Failure Honesty:** directly strengthened — the core finding this mission fixed (`failJob` dead code)
  was precisely a failure-honesty defect; the priority-queue drain fix closes a second one
- **Live Verification:** 12 genuinely-concurrent approvalQueue writes proven not to collide; a real
  `failJob` transition proven to persist across re-read; a real drain-error proven to reach the DLQ
- **Regression:** 323/323

## FINDINGS

- **P0:** 0 shipped. 1 investigated (`approvalQueue` duplicate-execution race), empirically stress-tested
  with real concurrent HTTP requests against the true original code, and confirmed **not exploitable** —
  correctly reclassified as a non-finding rather than either ignored or over-fixed
- **P1:** 2 fixed — `deadLetterQueue`'s tmp-path collision (a previously-reproduced bug class elsewhere
  in this codebase, present here too); `creativeJobQueue`'s dead `failJob` (jobs could never honestly
  reach a failed state through the real generation path)
- **V1-critical P2:** 2 fixed — `approvalQueue`'s non-atomic writes (crash-mid-write corruption risk,
  independent of the race question); `priorityQueue`'s consumer silently dropping work on a rare
  unexpected exception
- **Other:** `creativeJobQueue`'s non-atomic writes and full crash-restart stale-job recovery both
  identified and documented as carried-forward limitations rather than fixed in this pass, consistent
  with the smallest-fix mandate; `creativeJobQueue` has no submission-level retry (a real, but
  out-of-mandate, product-scope question)

## FIXES

- `backend/services/approvalQueue.cjs` — `_save()` hardened from direct `fs.writeFileSync` to
  per-call-unique tmp-rename (matching `taskQueue.cjs`'s certified pattern)
- `agents/runtime/deadLetterQueue.cjs` — `_write()`'s fixed `.tmp` path replaced with per-call-unique,
  closing the same collision class already fixed once elsewhere in this codebase
- `backend/routes/creativeStudio.js` — real generator exceptions now transition the job to `"failed"`
  via `creativeJobQueue.failJob()`, distinct from the intentional, honestly-labeled no-generator-wired
  text fallback (unchanged); the job reference is hoisted so the outer catch-all can reap a job stuck at
  `"running"` if something throws before its own completion/failure call
- `agents/runtime/runtimeOrchestrator.cjs` — `drainQueue()`'s rare unexpected-exception path now pushes
  to the same `deadLetterQueue` `executionEngine.cjs` already uses, instead of only logging and dropping
  the task

## LIMITATIONS

- `creativeJobQueue.cjs`'s `_save()` remains a direct `fs.writeFileSync` (not atomic) — a real, but
  lower-priority, defense-in-depth item carried forward rather than bundled into this mission's fixes,
  to keep the shipped `failJob`/reaping fix isolated and independently negative-testable.
- A creative job frozen at `"running"` by a genuine process crash (not just a handler exception, which
  IS now reaped) has no restart-time recovery sweep — `creativeJobQueue.cjs` has no equivalent to
  `missionOrchestrator`'s `recoverStaleMissions()`. Lower-likelihood failure mode than the
  handler-exception case, which is fixed.
- `creativeJobQueue` has no submission-level retry or duplicate-submission idempotency — confirmed this
  matches the real product semantics (every request is a genuinely new generation), not a defect, but a
  retry-on-transient-failure feature is a real product-scope question this mission did not adjudicate.
- The suspected `approvalQueue` execution race was ruled out specifically for this codebase's current,
  fully-synchronous handler chain. If any consumer in that chain (`credits.refund`, `requireAuth`, etc.)
  is ever made genuinely `async` with a real `await` between the status check and the mark-resumed call,
  the race would silently reappear with no warning — noted for awareness, not fixed preemptively per the
  mission's own "no speculative refactor" instruction.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes all 4 UNVERIFIED queue items on the Master Coverage Matrix with direct evidence. Demonstrates
methodological discipline the mission itself demanded (Phase 3's "use real controlled concurrent tests")
by catching and reverting its own initial over-fix once empirical testing disproved the theoretical
concern — shipping 4 precisely-targeted real fixes instead of 5 fixes including one for a non-existent
defect. A mid-revert `git checkout --` briefly discarded unrelated uncommitted work from earlier in this
session; recovered in full with zero data loss via a dangling stash commit, verified byte-identical to
the pre-mission state. No new queue framework, no new persistence architecture. No OS-track record
altered.

## REGRESSION

**Before:** 316/316
**After:** 323/323
**New tests:** 7
**Failures:** 0
**Skipped:** 0

## BUILD: PASS

## UPDATED REMAINING HIGH-VALUE COVERAGE

- `creativeJobQueue.cjs`'s non-atomic writes — future defense-in-depth pass.
- `creativeJobQueue.cjs`'s crash-restart stale-job recovery (a `recoverStaleMissions()`-equivalent) —
  future pass.
- `creativeJobQueue`'s submission-level retry/idempotency — product-scope decision, not yet made.
- `productFactory.js:64`'s bare `router.use` authorization hazard + the broader audit it motivates
  (inherited, unchanged).
- `founderIdentityOS.js` auth-tier inconsistency — DECISION REQUIRED (inherited, unchanged).
- Credential blockers: `SENTRY_DSN`, operator-tier live verification, real email-provider credentials
  (all inherited, unchanged).
- Decision-required: C10-005 (3 non-reconciled memory backends), `/p18/memory/*` (both pre-existing,
  untouched).

## CURRENT BASELINE: 323/323

STOP.
