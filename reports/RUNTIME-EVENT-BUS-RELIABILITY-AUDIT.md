# RUNTIME EVENT BUS RELIABILITY, ISOLATION & BACKPRESSURE — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Method

Read `agents/runtime/runtimeEventBus.cjs` in full first. It is a genuinely well-built, hand-rolled
publish/subscribe implementation (not a raw Node `EventEmitter`) with a bounded 500-event ring buffer,
per-subscriber flood damping, system-wide degraded-mode suppression above a heap threshold, a
stale-subscriber sweep, and a fully synchronous `emit()` that isolates a throwing subscriber via
`try/catch` around each individual call and auto-removes it. Then traced the real ~90-file dependency
graph by distinguishing genuine publishers/subscribers from mere importers — actual `.subscribe(`/
`.emit(` call sites and their execution context, not import counts.

## Phase 1 — Inventory

**Publish API:** `emit(type, payload)` — pushes to the ring buffer, tracks a sliding 60s rate window,
then synchronously calls every subscriber's `fn` with the full event envelope.

**Subscribe API:** `subscribe(id, fn)` — `id` is a `Map` key (subscriber identity, not an event-type
filter), throws `Error` at `MAX_SUBS` capacity. `unsubscribe(id)` removes by key.

**Real publishers:** every workflow/org file via `_emit()` wrappers, `missionOrchestrator.cjs`,
`executionHistory.cjs` (task lifecycle), the bus's own internal `telemetry`/`heartbeat` tickers.

**Real subscribers, traced precisely (not just grepped):** 14 files with genuine `.subscribe()` calls —
`akoWorkflow.cjs` (8), `aeoWorkflow.cjs` (10), `executiveWorkflow.cjs` (6), `ecosystemWorkflow.cjs` (3),
`enterpriseWorkflow.cjs` (3), `civilizationWorkflow.cjs` (3), `businessOrgWorkflow.cjs` (19),
`engineeringOrgWorkflow.cjs` (12), `autonomousOrg.cjs` (1), `platformOrg.cjs` (1),
`orgAutomationCenter.cjs` (1), `automationService.cjs` (1), `missionOrchestrator.cjs` (1),
`autonomousDecisionEngine.cjs` (1) — **70 real subscriber registrations**, plus the genuine external
surface: real browser SSE clients via `agents/runtime/runtimeStream.cjs`.

**SSE bridge:** `runtimeStream.cjs`'s `GET /runtime/stream` — the only real SSE consumer of this bus.
Independent `MAX_SSE=10` connection cap, reconnect-storm damping, `Last-Event-ID`-based gap-fill replay.

**Handler execution model:** fully synchronous within a single `emit()` call — subscribers are invoked
in `Map` insertion order, each to completion, before the next subscriber runs; the next `emit()` call
cannot interleave mid-delivery. No async overlap risk inside a single emit.

## Phase 2 — Failure isolation (CERTIFIED, no fix needed)

Live-verified directly: a subscriber that throws is caught by `emit()`'s per-subscriber `try/catch`,
auto-removed from `_subscribers` afterward, and does not block any other subscriber registered before or
after it in the same `emit()` call. The publisher (and the whole process) is unaffected. This is the
correct, already-built behavior the mission's Phase 2 checklist asks for.

## Phase 3 — Memory/leak safety (CERTIFIED, no fix needed)

`subscribe`/`unsubscribe` are plain `Map.set`/`Map.delete` — no accumulation risk for a caller that
correctly unsubscribes. `runtimeStream.cjs`'s SSE `cleanup()` is idempotent (`_cleaned` guard) and always
calls `bus.unsubscribe(clientId)` on both `close` and `error`. Re-registering under the same `id`
replaces rather than duplicates (confirmed live) — this is the actual mechanism behind Finding #2 below,
not a memory-growth risk. The ring buffer and rate-tracking array are both correctly bounded
(`RING_SIZE=500`, sliding 60s window with active trimming). No unbounded array/map found.

## Phase 4 — Backpressure/load (CERTIFIED, no fix needed)

Live-verified: emitting 50 rapid non-critical events to a single subscriber delivered exactly 30 (the
real `FLOOD_BURST_MAX`), with the other 20 correctly suppressed for that subscriber only — while the
ring buffer still recorded all 50 (so a differently-paced subscriber, or a reconnecting client's replay,
is unaffected by another subscriber's flood state). Emitting 1000 events kept the ring buffer bounded at
exactly 500 with the monotonic `totalEvents` counter unaffected by trimming. Degraded mode (heap-based,
system-wide non-critical suppression) is a real, existing, separate safety valve. No uncontrolled growth
found; this is intentional, already-safe, documented behavior — certified.

## Phase 5 — Event ordering (CERTIFIED, honestly documented)

Live-verified: sequential `emit()` calls are delivered strictly in order, and for each event every
subscriber is called in `Map` insertion (registration) order, fully synchronously, before the next event
is processed. This is a genuinely strong guarantee — stronger than a typical async pub/sub — and it is
accurate to the real, synchronous implementation, not an inflated claim.

## Phase 6 — Duplicate delivery

Confirmed re-subscribing under an identical `id` does not duplicate delivery (it replaces the prior
registration in the `Map`) — this is the actual mechanism behind Finding #2 (silent overwrite, not
double-delivery). No duplicate-delivery defect found in the bus itself.

## Phase 7 — Tenant/security isolation (CRITICAL — 1 real finding, fixed)

Traced the intended contract before classifying, per this mission's own explicit instruction not to
assume a platform-wide-shared surface is automatically a leak. `GET /runtime/stream` was `requireAuth`
only. Live-reproduced with two real, independent, newly-registered `role:"user"` test accounts: an
ordinary customer with zero special access received the complete platform-wide internal telemetry
stream — real mission IDs, orchestrator internals, internal Executive-OS department agent state
(`eos_timeline`/`eos_risk`/`eos_policy`/`eos_budget`), and server heap/RSS/error-rate metrics — none of
it filtered by org/workspace, none of it that customer's own business data. Confirmed the real, intended
contract via every actual frontend consumer (`RuntimeDebugger.jsx`, `EngineeringConsole.jsx`,
`CommandCenter.jsx`, `operator/BrowserAutomationPanel.jsx`) — all live exclusively inside
`ElectronWorkspace`'s `operator-os/` tooling tree, never the customer-facing app. This is genuinely
operator-only content that was simply never upgraded past `requireAuth`, matching the exact
"platform-wide, not-tenant-scoped surface reachable by ordinary customers" defect class the prior
Endpoint Authorization Sweep mission fixed 25+ times. Fixed identically.

## Phase 8 — SSE (CERTIFIED, no fix needed)

Live-verified against the real running server with a genuine authenticated session: connect → real
`connected` ack with `replayCount`/`lastSeq` → cold-connect full 50-event replay → live event delivery
(`orchestrator:executing`, `mission:subtask:updated`, `task:added`, etc., correctly SSE-formatted with
`id:`/`event:`/`data:`) → reconnect with `Last-Event-ID` header correctly performs gap-fill replay
(`replayCount: 52`, not another full 50) rather than a full replay. Disconnect cleanup (`cleanup()`) is
idempotent, clears both the ping and JWT-expiry-warning timers, and correctly unsubscribes.

## Phase 9 — Startup/shutdown (CERTIFIED, no fix needed)

`runtimeEventBus.cjs`'s own `start()`/`stop()` were already correctly wired into `server.js` — `start()`
at boot (registers the telemetry/heartbeat tickers, idempotent), `stop()` at graceful shutdown (clears
both tickers, clears all subscribers). Live-verified restart-safety directly: stop → subscriber count
resets to 0 → start → resubscribe → event delivery works normally. Real `SIGTERM` shutdown verified
against the live server: clean exit, no errors, no hang.

## Negative testing

4 fixes independently reverted, tested, and restored:

1. Reverted `akoWorkflow.cjs`'s type-filter/payload-source fix (representative of the 6-file class) →
   the structural test correctly failed on the un-namespaced subscriber id.
2. Reverted `MAX_SUBS` from 150 back to 20 → both the structural test and the live 8-file registration
   test failed — the live test's failure was the literal, real production error, `Error: EventBus at
   capacity (20 subscribers)`, thrown from `businessOrgWorkflow.cjs:570`, reproducing the exact defect
   found live in the running server.
3. Reverted the `/runtime/stream` `operatorOnly` gate → the structural test correctly failed
   immediately; the live rejection test then hung, because without the gate the SSE stream stayed open
   for the non-operator test account instead of returning a `403` — concrete proof the gate is load-
   bearing. Killed the hung process, restored the fix, then hardened the live test itself with an
   explicit socket timeout (`timeout: 3000` + `r.destroy()` on the `timeout` event) so a future
   regression of this exact class fails the test cleanly instead of hanging the suite.

No existing test was weakened at any point.

## Regression

`npm run test:runtime`: **340/340** (332/332 baseline + 8 new tests). Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (8/8). `.env`: confirmed untouched.
Real `SIGTERM` graceful shutdown re-verified clean after all fixes; server restarted and confirmed
healthy.

---

## AUDIT NAME: Runtime Event Bus Reliability, Isolation & Backpressure Audit

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 7.5/10
**CONFIDENCE:** 90%

## EVENT BUS INVENTORY

`agents/runtime/runtimeEventBus.cjs` — a single, custom, in-process pub/sub implementation. No wildcard
subscriptions (subscribers must filter by `evt.type` themselves inside their handler — this is by
design, not a gap). Persistent state: a 500-event bounded ring buffer (for reconnect replay) and
burn-in/degraded-mode counters; all other state (subscribers) is transient, cleared on `stop()`/process
restart.

## PUBLISHERS

Every workflow/org file's `_emit()` wrapper (real event types like `ako:objective:created`,
`bizorg:deal:won`, `engorg:work:completed`), `missionOrchestrator.cjs`, `executionHistory.cjs`, plus the
bus's own internal `telemetry` (10s)/`heartbeat` (30s) tickers.

## SUBSCRIBERS

70 real, permanent, code-registered subscriptions across 14 files (`akoWorkflow.cjs` 8,
`aeoWorkflow.cjs` 10, `executiveWorkflow.cjs` 6, `ecosystemWorkflow.cjs` 3, `enterpriseWorkflow.cjs` 3,
`civilizationWorkflow.cjs` 3, `businessOrgWorkflow.cjs` 19, `engineeringOrgWorkflow.cjs` 12,
`autonomousOrg.cjs` 1, `platformOrg.cjs` 1, `orgAutomationCenter.cjs` 1, `automationService.cjs` 1,
`missionOrchestrator.cjs` 1, `autonomousDecisionEngine.cjs` 1). Each registered exactly once at server
startup, living for the process lifetime.

## SSE CONSUMERS

`agents/runtime/runtimeStream.cjs`'s `GET /runtime/stream` — the sole real external subscriber surface,
one dynamic `subscribe(clientId, ...)` registration per browser connection, independently capped at
`MAX_SSE=10` concurrent connections.

## EVENT CLASSES

Internal automation signals (`<org>:<entity>:<action>` shaped, e.g. `ako:objective:created`,
`bizorg:deal:won`), runtime/orchestrator lifecycle (`task:added`, `execution`, `orchestrator:*`,
`mission:*`), and bus-internal (`telemetry`, `heartbeat`, `connected`, `error`). All transient — only the
most recent 500 are retained for replay, nothing is durably persisted beyond process lifetime.

## FINDINGS

- **P0:** 0
- **P1:** 2 fixed — (1) 6 files' `subscribe()` misuse (no type filter, wrong payload source) affecting
  33 call sites, live-reproduced firing on unrelated events with `undefined` payload fields; (2)
  `MAX_SUBS=20` silently exhausted by the bus's own 70-subscriber real internal population,
  live-confirmed via the real server startup order that most cross-org automation event wiring silently
  fails to register right now
- **V1-critical P2:** 2 fixed — 9 silently-collided subscriber ids across the 6 broken files (a second,
  distinct defect from the type-filter bug, caused by the same root misunderstanding of the API); the
  `/runtime/stream` `requireAuth`-only gate exposing platform-wide internal telemetry to any ordinary
  authenticated customer
- **Other:** 0 — everything else audited (failure isolation, backpressure, ordering, duplicate delivery,
  SSE lifecycle, startup/shutdown) was already correctly built and is certified as-is with no fix

## FIXES

- `backend/services/akoWorkflow.cjs`, `aeoWorkflow.cjs`, `executiveWorkflow.cjs`,
  `ecosystemWorkflow.cjs`, `enterpriseWorkflow.cjs`, `civilizationWorkflow.cjs` — all 33 `subscribe()`
  calls now check `evt.type` and destructure from `evt.payload`; every subscriber id renamed to a
  per-file-unique namespace (`ako_sub_*`, `aeo_sub_*`, `eos_sub_*`, `eco_sub_*`, `ent_sub_*`,
  `civ_sub_*`), closing both the type-filter defect and the id-collision defect in the same pass
- `agents/runtime/runtimeEventBus.cjs` — `MAX_SUBS` raised from 20 to 150
- `backend/routes/index.js` — `router.use("/runtime/stream", operatorOnly)` added, scoped to just the
  SSE bridge

## LIMITATIONS

- `MAX_SUBS=150` is a generous but still finite ceiling based on the real, counted internal population
  (70) plus SSE headroom — if this platform's org/workflow count grows meaningfully beyond its current
  20-department-per-org × 10-org-level shape, this number should be revisited. It is not
  auto-scaling, matching the mission's "no speculative redesign" instruction.
- The `operatorOnly` fix is scoped to `/runtime/stream` and `/runtime/stream/status` only. The broader
  `/runtime/*` prefix (`requireAuth`-only) contains other routes — dispatch, dead-letter, diagnostics,
  quarantine — that on inspection also appear to be operator/engineering tooling with no
  customer-facing purpose, but a full audit of that prefix is the Endpoint Authorization Sweep mission's
  territory, not this one's; noted for a future pass rather than expanded into here.
- No wildcard subscription mechanism exists (subscribers filter by `evt.type` themselves) — this is
  existing, intentional design, not a gap, but it is the direct root cause of the type-filter misuse
  found in 6 files: a caller who assumes the bus supports type-filtered subscription (a very reasonable
  assumption never actually contradicted anywhere else in the API surface, only in its actual behavior)
  will make this exact mistake again for any future subscriber. Not fixed — adding real
  server-side type filtering would be a larger API change than this mission's smallest-fix mandate
  covers, but flagged clearly for whoever adds the next subscriber.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the event bus's reliability, isolation, and tenant-security posture with direct, live-reproduced
evidence rather than assumption. The two P1 findings are the most severe of this entire audit
programme's queue/scheduler/bus track to date — most of this platform's real, built cross-org automation
event wiring was silently, permanently non-functional in the live running server before this mission,
with zero error surfaced anywhere in logs or responses. Confirmed the bus's own core mechanics (failure
isolation, backpressure, ordering, SSE lifecycle, startup/shutdown) were already excellently built and
did not need touching. No new event-bus architecture. No OS-track record altered.

## REGRESSION

**Before:** 332/332
**After:** 340/340
**New tests:** 8
**Failures:** 0
**Skipped:** 0

## BUILD: PASS

## UPDATED REMAINING HIGH-VALUE COVERAGE

- The broader `/runtime/*` prefix's authorization scope (beyond `/runtime/stream`) — likely also
  operator-only in intent, not yet fully audited; future pass.
- No real server-side event-type filtering in `subscribe()` — the root cause class behind this
  mission's #1 finding; a future subscriber could repeat the same mistake. Noted, not fixed (would
  expand the bus's API surface beyond this mission's mandate).
- `MAX_SUBS=150` should be revisited if the platform's org/department count grows materially.
- 4 sibling schedulers' missing `stop()` (inherited from the Scheduler Reliability mission, unchanged).
- `productFactory.js:64` bare `router.use` hazard (inherited, unchanged).
- `founderIdentityOS.cjs` auth-tier inconsistency + `.tmp`-path pattern (inherited, both investigated
  across prior missions, confirmed not currently exploitable).
- Credential blockers: `SENTRY_DSN`, operator-tier verification, email-provider credentials (inherited).
- Decision-required: C10-005, `/p18/memory/*` (both pre-existing, untouched).

## CURRENT BASELINE: 340/340

STOP.
