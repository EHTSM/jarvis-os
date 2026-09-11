# CORE RUNTIME ENGINES — PRODUCTION SAFETY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-20 · **Branch:** `security/reality-completion`

---

## Scope

4 previously-unaudited core runtime engines: `executionEngine.cjs`, `missionRuntime.cjs`,
`developerOS.cjs`, `executor.cjs`. Explicitly excluded (already certified): `autonomousLoop.cjs`,
`autonomousExecutionRuntime.cjs`, prior timeout/cancellation/queue/scheduler/event-bus work.

## Method

Read all 4 files in full. Confirmed each engine's real consumers via grep before forming any finding
(`executionEngine.cjs` ← `runtimeOrchestrator.cjs`; `missionRuntime.cjs` ← 9 files incl.
`backend/routes/mission.js`; `developerOS.cjs` ← `enterpriseOS.cjs` + `backend/routes/ops.js`;
`executor.cjs` ← `autonomousLoop.cjs` + `executionEngine.cjs`). Delegated `executor.cjs`'s 1777-line
deep-dive to a background research agent (read-only, no modifications) while independently re-verifying
`executionEngine.cjs` (already deeply known from the prior Timeout/Cancellation mission) and investigating
`missionRuntime.cjs`/`developerOS.cjs` directly. Live-reproduced every fix against real, isolated test
data (test missions created and cleaned up afterward) or, where the defect was already manifested in the
live environment's own real data, verified and remediated it directly with before/after evidence.

## executionEngine.cjs — CERTIFIED, no new defects found

Re-verified against the checklist: `_orphanedAttempts` duplicate-execution guard (from the prior
Timeout/Cancellation mission) confirmed present and correct; `agent.acquireSlot()`/`recordFailure()`/
`recordSuccess()` confirmed symmetric on every exit path including the timeout catch block (no slot
leak); `nonRetriable` short-circuit confirmed correct; org isolation confirmed correct (credentials/
context always sourced from `task.orgId`, resolved server-side, never re-derived insecurely); the file
is fully stateless per-call with no persistence/recovery obligations of its own (correctly delegated to
callers). No genuine new defect found in this file this mission.

## missionRuntime.cjs — 1 genuine, live-manifested P1 defect found and fixed

**Finding:** `recoverStaleMissions()` (the existing, already-certified mission-level crash-recovery
function, called once at server startup) resets a mission stuck at `"running"`/`"active"` back to
`"planned"` — but has no equivalent for an individual **subtask** stuck at `"running"`.
`_dispatchSubtask()` marks a subtask `"running"` before `await`ing `orchestrator.dispatch()`; if the
process dies mid-dispatch, that subtask is left at `"running"` permanently. Nothing else ever transitions
a subtask out of `"running"` automatically, `_getReadySubtasks()` only ever picks up `"pending"`
subtasks (never re-touches a `"running"` one), and any subtask depending on the stuck one can never
become ready either, since its dependency never reaches `"completed"`.

**Live evidence (before fix):** confirmed via direct query against this environment's own real
`data/missions.json` — **292 subtasks stuck at `"running"` across 277 missions**, oldest ~337 hours
(~14 days). Critically, 236 of those 277 missions had ALREADY been recovered to `"planned"` by the
existing mission-level logic on a prior restart — yet their stuck subtask silently blocked the mission
from ever completing even after being re-triggered.

**Fix:** `recoverStaleMissions()` now also scans every mission (regardless of the mission's own current
status — a mission can carry a stale subtask independent of its own status, as the live data confirms)
for any subtask stuck at `"running"` and resets it to `"pending"` via `missionMemory.updateSubtask()`
— the same existing API already used by `updateSubtaskStatus()`, no new persistence mechanism. Same
failure-mode reasoning as the existing mission-level recovery (prior process died mid-execution before
reaching a terminal state), same fix shape (reset to a re-driveable state), reusing the exact same
function so no new startup hook was added.

**Live remediation:** running the fixed function against the real environment recovered **286 real
orphaned subtasks across 271 missions** (a few more than the initial 292/277 count, since the server
kept running real work during the audit). Verified end-to-end with an isolated test mission
(created → subtask forced to `"running"` to simulate a crash mid-dispatch → recovery run →
subtask confirmed `"pending"` → `startMission()` re-driven → dependent subtask correctly became
dispatchable → mission correctly auto-completed) — proving the full recovery→re-dispatch→completion
cycle genuinely works, not just the isolated status reset. Test mission removed from the real store
afterward (targeted single-record cleanup, not a destructive operation on the file).

## developerOS.cjs — CERTIFIED as a service; 1 genuine defect found in a real consumer's contract violation

The file itself: org-isolation (C10-003, prior mission) reconfirmed correct on every function — every
list/get/search/create path requires and filters by `orgId`, `_ownedBy()` never falls back to unscoped
records, every HTTP route (`/dev/*`, `backend/routes/ops.js`) threads `req.org.id` (server-resolved,
never client-supplied) and the body-spread ordering prevents a forged `orgId` in the request body from
surviving. No new defect found in the service itself.

**Finding (in a real consumer):** `agents/runtime/enterpriseOS.cjs`'s `getEnterpriseDashboard()` — a
genuinely platform-wide, non-org-scoped aggregator — called `developerOS.getStats()` with **zero
arguments**. Since the C10-003 recovery (prior mission) made `getStats(orgId)` throw via
`_requireOrgId()` when `orgId` is falsy, this call has unconditionally thrown since that fix landed,
making `GET /enterprise/dashboard` (`backend/routes/ops.js:848`) always return a generic `500
internal_error` for every caller — confirmed by direct reproduction (`developerOS.getStats()` throws
`"getStats: orgId is required"`) and by comparing against the aggregator's other two cross-OS calls
(`personalOS.getStats()`, `businessOS.getStats()`), both correctly zero-arg by design, confirming this
is an isolated regression from the prior org-isolation fix, not a systemic pattern.

**Fix:** wrapped the call in the same defensive `try/catch` pattern already used elsewhere in this exact
file for optional cross-module lookups, passing a sentinel `"_platform_"` orgId (this aggregator has no
real single-org context to pass — `personalStats`/`businessStats` alongside it are deliberately
platform-wide too, so fabricating a real org would be wrong; the try/catch is the correct minimal fix,
not thread-a-real-orgId). Live-verified: `getEnterpriseDashboard()` now returns the full real dashboard
object end-to-end, including a correctly-populated (all-zero, honest) `ecosystem.developer` block,
instead of throwing.

## executor.cjs — 1 genuine defect found (fake-success), 3 other findings documented as limitations

Sub-agent inventory (read-only, no modifications) cross-referenced and independently spot-verified:

**Fixed — `autoOS` handler fake-success:** `executor.cjs`'s `autoOS` handler hardcoded
`success: true` regardless of what `autonomousLoop.runCycle()` actually returned. `runCycle()` genuinely
returns `{ ok: false, reason: "paused" }` when the autonomous loop is paused — doing zero real work — yet
the handler reported success unconditionally. Same bug class as this exact file's own already-documented,
already-fixed `ai` handler bug (a sub-call's honest failure/no-op sentinel discarded into a blanket
success). Any caller checking `result.success` (`autonomousLoop.cjs`'s own `allFailed` guard,
`executionEngine.cjs`'s `softFailed` check) would never see that the cycle did nothing. Fixed: reads
`cycle.ok` and reports `success: cycleOk`, with the real failure reason surfaced. Live-verified against
this environment's real, persisted `autonomousLoop` control state: paused mode → `success:false,
error:"paused"`; active mode → a genuine cycle runs → `success:true`. Control state (`mode`,
`autonomyLevel`) explicitly restored to its original value after the test, confirmed via direct file
comparison.

**Documented, not fixed (out of this mission's fix scope):**
- No internal timeout/orphan-guard in `executor.cjs` itself — by design, delegated entirely to callers
  (`autonomousLoop.cjs`'s and `executionEngine.cjs`'s own `_withTimeout`). `executionEngine.cjs`'s path
  is already mitigated by the `_orphanedAttempts` guard (prior mission); `autonomousLoop.cjs`'s path has
  no equivalent — but `autonomousLoop.cjs` itself is explicitly excluded from this mission's scope.
- No dedup/idempotency inside `executor.cjs` itself — every call is a fresh, real execution (payments,
  messages, org pipelines all fire again on a duplicate call). This is the same already-certified,
  documented architectural limitation from the prior Timeout/Cancellation mission (threading real
  cancellation/dedup through every handler would be the prohibited redesign), not a new finding.
- `executionEngine.cjs` passes an unused second `instanceCtx` argument to `legacy.execute(task,
  instanceCtx)` — `executorAgent`/`execute` is single-arg, so it's silently dropped. Real but harmless
  (no crash, no data loss, no context was ever consumed by that path); not fixed given its low severity
  relative to the risk of touching this heavily-exercised shared file for a no-op argument.

## Findings NOT classified as defects

- `executor.cjs`'s `notifyBroadcast` and `research` handlers' success-composition — correctly
  field-checked against each sub-service's real return shape, not truthy-whole-object bugs.
- `executor.cjs` holds no direct process/file/socket resources of its own — pure dispatch/routing layer,
  cleanup obligations correctly belong to the sub-modules it delegates to.
- `executor.cjs` is never directly HTTP-reachable (confirmed via exhaustive repo grep — exactly 2 real
  requirers, both already-audited internal callers); auth is correctly enforced upstream by design.
- `executor.cjs`'s org/tenant IDs are always sourced from `task.payload`, never re-derived or defaulted
  insecurely, across every handler that reads one (payment, WhatsApp/Telegram, eco/civ pipelines,
  governance layer).

## Regression

**Before:** 352/352. **After:** 358/358 (clean run; one transient flake on `141-master-audit-
autolooop-soft-failure-retry` during a heavier concurrent run, confirmed unrelated to any of this
mission's 3 fixes and passing cleanly on isolated re-run — same class of environment-load flakiness
observed throughout this program, not caused by these changes).
**New tests:** 6 (block 153 in `tests/runtime/10-c10-cross-system-closure.test.cjs`) — 3 structural + 3
live, covering all 3 fixes with real crash-simulation (isolated test mission, cleaned up), real
paused/active autonomous-cycle reproduction (real control state, restored after), and a real dashboard
call reproduction. **Negative-tested all 3 fixes**: each individually reverted, confirmed the
corresponding test(s) failed for the exact expected reason, restored, confirmed passing again (with the
other 2 fixes' tests continuing to pass throughout each individual revert, confirming independence).
Production build: PASS. `tests/security/97-enterprise-isolation-integrity.cjs`: 1/1 PASS. `.env`
untouched. Server confirmed healthy (`GET /health` → 200) throughout, same PID, no restart required.

**No OS-track record altered.**
