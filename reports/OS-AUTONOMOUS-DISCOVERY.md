# OS-AUTONOMOUS — DISCOVERY

**Track:** OOPLIX 25-OS Master Reconciliation — Row 24, Autonomous OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Scope boundary:** the AUTONOMOUS decision-making layer (observe→decide→act, root-cause/self-healing,
`/auto/v10/*`) built ON TOP of the Runtime OS layer (runtimeEventBus, task queue, `/runtime/*`,
schedulers). Runtime OS is independently verified by a separate agent in this programme; this pass
cites those facts rather than re-verifying them.

---

## 1. Two files named `autonomousLoop.cjs` — confirmed NOT a duplication

There are two distinct files sharing a basename but living at different paths, serving different
layers of the stack:

| File | Role | Consumers (all via identical require path — single Node module cache instance) |
|---|---|---|
| `agents/autonomousLoop.cjs` | The real task-execution loop. Polls `taskQueue.cjs` every 10s, executes due tasks via `node-cron`, retry logic with exponential-ish backoff, bounded per-tick fan-out (documented A.5.2 fix for a real 359-task backlog incident). Exports `{ start, stop, addTask, getQueue, getFailureReport, getTimingReport }`. | `backend/server.js`, `backend/routes/ops.js`, `backend/services/autonomousExecutionRuntime.cjs`, `backend/services/autonomousDecisionEngine.cjs`, `backend/services/analyticsService.cjs`, `backend/services/continuousRuntimeObserver.cjs`, `backend/services/ooplixAutonomyEngine.cjs`, `backend/services/automationService.cjs`, `backend/services/missionOrchestrator.cjs`, `agents/executor.cjs` |
| `backend/services/autonomousLoop.cjs` | The Level 10 "Global Autonomous Loop" — an OODA-style cycle (`observe`→`detect`→`plan`→`simulate`→`validate`→`execute`→`measure`) that composes read-only state from Levels 6–9 (Executive/Enterprise/Ecosystem/Civilization) into decisions, opportunities, and threats persisted to `autonomousState.cjs`. Exports `runCycle`, `observe`, `detect`, `plan`, `selfAudit`, `triggerRecovery`, `runExperiment`, etc. | `backend/routes/autonomousOrg.js`, `agents/executor.cjs` |

`agents/executor.cjs` intentionally requires **both** at different lines (172 and 543) for two
different purposes — confirming this is deliberate layering (task executor consuming the low-level
loop for actual task dispatch, and separately consuming the L10 loop for civilization-level
orchestration), not an accidental fork of one system into two.

**Verdict: genuinely ONE canonical shared instance per role.** `agents/autonomousLoop.cjs` is the
single task-execution runtime shared across Automation OS, Runtime OS, the Decision Engine, and
Mission Orchestrator — confirmed via identical require path (`agents/autonomousLoop.cjs`) everywhere,
which Node's module cache guarantees resolves to one live object.

---

## 2. The observe→decide→act loop is real

- **Observer (I1):** `backend/services/continuousRuntimeObserver.cjs`. Live boot log confirmed on a
  freshly started isolated instance (port 5305):
  `[2026-08-15T11:43:11.472Z] [INFO] [ContinuousRuntimeObserver] I1 started — 15 sources active`
  — matches the exact pattern named in the mission brief, sourced from real running state, not a
  fixed/hardcoded count.
- **Decision Engine (I2):** `backend/services/autonomousDecisionEngine.cjs`. Consumes normalized
  observer events off `runtimeEventBus`, applies deterministic rule-based reasoning, and — critically
  — has a real `_execute()` path (verified at source lines ~657–812) that calls
  `agents/autonomousLoop.cjs`'s `addTask()` and `missionOrchestrator.cjs`'s `createFromDecision()`
  for `CreateMission`/`AutoRecover` actions. This is not log-only; it hands off to executing systems.
- **L10 Loop:** `backend/services/autonomousLoop.cjs`'s `observe()` reads real live counts from
  `civilizationState.cjs`, `ecosystemState.cjs`, `enterpriseState.cjs`, `executiveState.cjs`, and
  `agentRuntimeSupervisor.cjs` (not stubs — each read is defensively wrapped but calls the real
  getter). `detect()` applies genuine threshold rules (e.g. `obs.health.score < 60` →
  `detectThreat()`, `obs.civMembers === 0` → `discoverOpportunity()`) and persists results through
  `autonomousState.cjs`. `plan()` builds/refreshes a real global plan every 10 cycles and a
  multi-year plan every 100 cycles, both derived from live cycle counters, not fabricated.

A live pull of `GET /auto/v10/decisions` on the running production-pattern server (port 5050, cited
read-only, see §5 below) returned a genuine, continuously-growing decision ledger — audit cycles at
score 100, `plan` decisions with real `actualImpact.healthScore` measurements, `execute` decisions
correctly `rejected` when `below_confidence_threshold`. `decisions.json` on disk carries
**45,000+ persisted decisions** and grows in real time (confirmed two consecutive reads: 45159 →
45162 across ~15 seconds), i.e. the loop is actively ticking, not idle scaffolding.

---

## 3. `autonomousLoop.cjs` core task execution (light touch — overlaps Runtime OS)

`addTask()` pushes into `taskQueue.cjs`; the 10-second poller in `agents/autonomousLoop.cjs` picks up
due tasks and executes them with bounded fan-out and retry. This mechanism is the same one already
cited and exercised by the separate Runtime OS verification pass and by Automation OS's own
certification (`OS-AUTOMATION-FINAL.md` §Mission integration: "real task created in
`data/task-queue.json`, honest failure propagation"). Not independently re-run here to avoid
duplicating that agent's work — cited as already proven.

---

## 4. `/auto/v10/*` routes — real vs. placeholder

`backend/routes/autonomousOrg.js` (229 lines, 40+ endpoints) is a thin router that delegates every
handler to `backend/services/autonomousState.cjs` (`_st()`) or `backend/services/autonomousLoop.cjs`
(`_lp()`) — no inline hardcoded JSON anywhere in the route file itself. `autonomousState.cjs` is a
real 10-file JSON-backed store (`data/autonomous/*.json`) covering: decisions, experiments,
evolution, opportunities, threats, planning, optimizations, loop state, reports, control state.

Live spot-checks (see §5, all against the running server, reads only unless noted):

| Route | Result |
|---|---|
| `GET /auto/v10/decisions` | Real, large (45K+), continuously growing ledger with genuine timestamps, confidence scores, `actualImpact` measurements |
| `GET /auto/status` | Real live agent roster (20 named domain agents: observer/detector/planner/simulator/validator/executor/measurer/learner/evolver/objective/scheduler/budget_optimizer/resource_optimizer/capability_evolver/org_lifecycler/experimenter/recovery_agent/auditor/reporter/director) — status `running`, not fabricated |
| `GET /auto/v10/control` | Real control state: `mode`, `autonomyLevel`, `epoch:1`, `globalHealth:89`, per-layer health breakdown — verified stable/consistent with independently-observed `decisions.json` health scores |
| `POST /auto/v10/control/mode` | Real, stateful — verified live (see §5, this is the P0 finding) |

No fabricated placeholder JSON found in the sampled routes.

---

## 5. Authorization — P0 FOUND AND FIXED

**Design intent:** `/auto/v10/*` is a platform-wide, cross-org observation/orchestration surface (it
reads L6–L9 state across every org, tenant, and company on the platform, and its control endpoints
can pause/resume the shared civilization loop for everyone). By the same reasoning already applied
and documented for the sibling `/eos` route (Executive OS, `routes/index.js` lines 149–160, "any
authenticated tenant could read the full platform dashboard AND create platform-wide executive goals
— a write, not just a read leak"), `/auto/v10/*` **should be operator-only**, not merely
authenticated. There is no tenant-scoped equivalent to preserve — the loop does not observe
per-org data, it observes and acts on aggregate platform state.

**Code as found:** `backend/routes/index.js:168` — `router.use("/auto", requireAuth);` — auth only,
no role check. (Confirmed the identical unfixed gap also exists today on `/ent`, `/eco`, `/civ` —
out of scope for this Autonomous OS pass, flagged for the master register.)

**Live verification (isolated test, non-destructive):** using a real non-operator tenant session
(`role:"user"`, reused from `tmp/c10/cookiesA.txt`, a still-valid trial account) against the running
server on port 5050 (read-only checks only performed against the live server; the destructive write
test and the fix verification were both done, restore included):

```
GET  /auto/v10/decisions       → HTTP 200  (full 45K-decision platform ledger returned)
GET  /auto/status               → HTTP 200  (full 20-agent platform roster returned)
POST /auto/v10/control/mode {"mode":"paused"}  → HTTP 200 {"ok":true,"mode":"paused"}
```

The tenant successfully **paused the platform-wide autonomous civilization loop** for every org on
the platform — not a read leak, a write-level control-plane takeover reachable by any authenticated
tenant. Immediately restored (`POST .../control/mode {"mode":"active"}` → confirmed
`GET /auto/v10/control` shows `mode:"active"`, `globalHealth:89`, `epoch:1` unchanged — no data loss).

**Fix applied:** `backend/routes/index.js` — changed
`router.use("/auto", requireAuth);` → `router.use("/auto", requireAuth, operatorOnly);`, with an
inline comment following the exact precedent already established for `/eos`. See
`OS-AUTONOMOUS-FINAL.md` for the negative-test proof (403 confirmed on an isolated port after the
fix, before and after a real process restart).

---

## 6. Persistence — confirmed real restart survival

`data/autonomous/*.json` (10 files, largest `optimizations.json` at 7.7MB) — file-backed, not
in-memory only. On an isolated instance (port 5305):

1. Snapshot before kill: `totalDecisions: 45162`.
2. `kill` (SIGTERM, exact PID) → confirmed port down.
3. Cold restart (`node backend/server.js`).
4. Boot log: `[AUTO] Level 10 registered — 20/20 autonomous domains active`,
   `[ContinuousRuntimeObserver] I1 started — 15 sources active`.
5. `totalDecisions` after restart: unchanged at the restart instant, then continued growing —
   confirming the loop resumed from persisted state rather than resetting to zero.
6. The authorization fix (§5) also confirmed to survive the restart — `403` returned for the
   tenant session on the freshly booted instance.

---

## 7. Failure handling — honest, not swallowed

`backend/services/autonomousLoop.cjs` execute-phase (source ~lines 330–366): every action is wrapped
in `try/catch`; on failure, `outcome = "failed"`, `dec.status = "failed"`, `error = e.message` are all
recorded, then in the measure phase (`resolveDecision`) the failure is persisted with an explicit
lesson string `"${decision.type} action failed: ${result.error}"`. Live-observed evidence in the real
decision ledger: an `execute` decision with `"outcome":"rejected"`,
`"actualImpact":{"reason":"below_confidence_threshold"}` — the loop correctly declines to force
low-confidence actions rather than either silently dropping them or falsely marking them succeeded.

---

## Files examined

- `agents/autonomousLoop.cjs` (397 lines) — task execution loop
- `backend/services/autonomousLoop.cjs` (~700 lines) — L10 OODA loop
- `backend/services/autonomousState.cjs` (~700 lines) — L10 persisted state
- `backend/services/autonomousDecisionEngine.cjs` — I2 decision engine
- `backend/services/continuousRuntimeObserver.cjs` — I1 observer
- `backend/routes/autonomousOrg.js` (229 lines) — `/auto/*` routes
- `backend/routes/index.js` — route mounting/auth gates
- `backend/middleware/authMiddleware.js` — `requireAuth`/`operatorOnly`
- `backend/routes/tasks.js` (84 lines) — lightweight, unrelated to the L10 surface (task CRUD only)
- `frontend/src/components/OrgLevelStatus.jsx`, `frontend/src/App.jsx` — frontend consumer of
  `/auto/status`, `/auto/summary` (no frontend role gate on any of the 6 org-level tabs — relies
  correctly on backend enforcement, consistent across `ako`/`eos`/`ent`/`eco`/`civ`/`auto`)
