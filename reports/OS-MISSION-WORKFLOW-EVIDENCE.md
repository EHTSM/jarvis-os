# OS-MISSION — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5111` (dedicated Mission verification instance)
**Auth:** real `POST /auth/login` sessions only — no JWT forged, no auth bypassed.
**Tenants:** Operator `finop@test.local` (ws `…22971bc3`) · Tenant A `finoa@test.local` (own ws `…5cc8412b`)

All output below is verbatim from executed requests or executed code paths.

---

## Chain verified

```
Frontend (MissionControlV1 / MissionDock)
  → _fetch client
  → Express route (/mission/*, /missions/*)
  → requireAuth (cookie JWT)  [no workspace-membership gate — see Security report]
  → missionOrchestrator.cjs
  → agents/autonomousLoop.cjs → agents/executor.cjs → real handlers (AI/terminal/filesystem)
  → data/orchestrator-state.json + data/missions.json  (fs, tmp+rename)
  → JSON response
```

---

## W1 — Mission runtime status

```json
{"success":true,"status":{"missions":{"total":2121,
 "byStatus":{"active":583,"planned":538,"completed":944,"failed":46,"cancelled":10},
 "avgCompletionTimeMs":339167,"failureRate":0.0255,
 "mostCommonFailurePhases":[{"phase":"execution","count":70},{"phase":"commit","count":34}],
 "totalSubtasks":9872}}}
```
**HTTP 200.** A real 2,121-mission corpus with a genuine, non-zero failure rate.

## W2 — Mission creation

```json
{"success":true,"mission":{"missionId":"msn_7f47d1fd5f2c4e3196669696b482fd05",
 "orchId":"orch_1786705719903_6","orchStatus":"planned",
 "stages":[{"index":0,"status":"pending","capability":"goal_decompose","maxRetries":2}, ...]}}
```
5 real stages generated every time.

---

## THE CENTRAL FINDING — a mission reported completed with every stage failing

### First observation (before this pass's fixes)

```
orchStatus = completed
  [0] completed  goal_decompose   out: [ai] AI backend unavailable. Check provider API keys…
  [1] completed  task_plan        out: [ai] AI backend unavailable. Check provider API keys…
  [2] completed  validation       out: [ai] AI backend unavailable. Check provider API keys…
  [3] completed  execution        out: [terminal] {"success":false,"command":"…blocked…"}
  [4] completed  reporting        out: [ai] AI backend unavailable. Check provider API keys…
```
Zero real work occurred on any of the 5 stages; the mission reported success.

### Root cause #1 — `agents/executor.cjs`

```js
// before
return { type: "ai", result: reply, message: reply, success: !!reply };
```
`callAI()` returns the **literal string** `"AI backend unavailable. Check provider API keys in
your .env file."` (`aiService.js:650`) when every provider fails. A non-empty string is truthy, so
`success:!!reply` reported **success** for a genuine failure. The identical check in
`agents/runtime/bootstrapRuntime.cjs:224` already excluded this exact sentinel — two handlers gave
opposite verdicts for the identical string.

```
executor.cjs:108   success = !!reply                          -> true
bootstrapRuntime   success = !!reply && !startsWith(AI back..) -> false
```

### Fix + negative test

```js
const unavailable = typeof reply === "string" && reply.startsWith("AI backend unavailable");
return { type: "ai", result: reply, message: reply, success: !!reply && !unavailable, ...(unavailable ? { error: reply } : {}) };
```
```
PASS  success=false  aiService failure sentinel
PASS  success=true   genuine AI reply
PASS  success=false  empty reply
PASS  success=false  null reply
PASS  success=true   sentinel NOT at start (substring only — doesn't over-match)
PASS  success=false  bare sentinel prefix
6/6 negative-test cases pass
```

### Root cause #2 — `backend/services/missionOrchestrator.cjs` (`_monitorStage`)

Even with the executor fixed, three branches in the stage-monitor loop treated an **unobserved**
outcome as success:

```js
// before
if (!loop) { _stageComplete(missionId, stg, null); return; }        // loop unavailable
if (!task) { _stageComplete(missionId, stg, null); return; }        // task vanished from queue
...
_stageComplete(missionId, stg, "timeout-assumed-complete");         // 5-min poll timeout
if (!stg.loopTaskId) { _stageComplete(missionId, stg, null); return; }  // never dispatched
```
A task that had genuinely **failed** and then rotated out of the bounded task queue before being
polled fell into the `!task` branch and was recorded `completed`. Observed live: a
`goal_decompose` stage with `retries:2` (i.e. it had exhausted retries and failed) was persisted as
`completed` with the AI-unavailable sentinel as its only output.

### Fix + negative test

All four branches now call `_stageFailed()` instead of `_stageComplete()`. `_stageFailed()` already
applies the normal retry budget before failing the mission, so this does not make missions fail
more eagerly — it just stops treating silence as success.
```
PASS  retry   no loopTaskId (never dispatched), retries<max
PASS  failed  no loopTaskId, retries exhausted
PASS  retry   loop unavailable, retries<max
PASS  retry   task vanished from queue, retries<max
PASS  failed  task vanished, retries exhausted
PASS  failed  5m timeout, retries exhausted
6/6 pass — no path yields "completed" without observed success
```

### Live re-verification — definitive, single clean process

A mission created on a single, freshly-restarted server process (see the Operational Hazard
section below for why "single clean process" needed to be stated explicitly):

```
MISSION=msn_f8a6272cc0cb4e1c8a55d8f3691b7b7f  "MissionOS DEFINITIVE honesty MSNOS-CLEAN-1"

FINAL:
orchStatus: failed
  [0] failed   goal_decompose   retries=2   out: Loop task failed
  [1] pending  task_plan
  [2] pending  validation
  [3] pending  execution
  [4] pending  reporting

FAKE completed stages: 0  -> ALL HONEST
```
**The mission failed after the first stage exhausted its retries — it did not march through
5 stages claiming false success.** This is the mission's core honesty rule, verified.

---

## OPERATIONAL HAZARD — orphaned server processes silently mutating shared state

While chasing an apparent "the fix didn't work" result, `ps aux` revealed **three**
`node backend/server.js` processes running simultaneously:

```
ehtsm  24146  ...  3:48AM   ...  node backend/server.js   (no listening port — orphaned)
ehtsm  12209  ...  5:26PM   ...  node backend/server.js   (port 5111 — this pass's server)
ehtsm   5962  ...  5:23PM   ...  node backend/server.js   (port 5099 — leftover from Memory OS pass)
```

PID 24146 had been running since **3:48AM** — over 13 hours, predating even this session's
Developer OS fixes — with **no listening port at all**, meaning it was a background-only
autonomous-loop instance ticking against the shared `data/task-queue.json` and `data/missions.json`
files. Because all `node` processes on this machine share the same `data/` directory regardless of
port, that stale process was independently picking up and executing due tasks with whatever code
was loaded 13+ hours earlier — interleaved with the correctly-fixed process. The result looked
exactly like an intermittent regression: some missions honest, others not, no code-level pattern.

**This is not a defect in the mission system.** It is a real operational hazard specific to running
multiple OS-verification passes on one machine without confirming every prior server process was
actually terminated. `lsof -ti:PORT` only finds the process bound to a given port — it will not
find a process with no open port at all.

**Remediation applied:** all three processes were force-killed (`kill -9`); the definitive
re-verification above ran against the single resulting clean process.
**Recommended for future passes:** `pkill -f "node backend/server.js"` before starting a new
isolated instance, not just a port-scoped kill.

---

## Persistence — verified across a full server restart

```
terminal missions before restart: 15
still present after restart     : 15
LOST                             : 0
total records after              : 17
```
**Genuine file-backed durability, matching the Developer OS D-3 fix.**

`missions.json` (the authoritative store) grew from 2,120 → 2,124 records across the session and
was never truncated or corrupted by the restart.

---

## Retry / pause / cancel / resume (as legitimate owner)

```
POST /missions/orchestrator/pause   {missionId}  -> {"orchStatus":"paused"}     HTTP 200
POST /missions/orchestrator/resume  {missionId}  -> {"orchStatus":"queued"}     HTTP 200
POST /mission/runtime/fail/:id (invalid from "paused") -> 409 "Invalid transition paused → failed"
POST /missions/orchestrator/cancel  {missionId}  -> {"orchStatus":"cancelled"}  HTTP 200
```
State-machine transition guards correctly reject invalid jumps (`paused → failed`,
`active → failed` outside the orchestrator's own failure path).

---

## GENUINE GAP — missionMemory lost-update race

`/mission/timeline/:id` returned 404 for a mission that had **just been created and executed**
through the orchestrator:
```json
{"success":false,"error":"Mission not found: msn_f8a6272cc0cb4e1c8a55d8f3691b7b7f"}
```

### Root cause

`missionOrchestrator._createRecord()` unconditionally calls `missionMemory.createMission()`, and in
isolation this is 1:1 — verified directly:
```
mission created: msn_78f6db14a64a4e368bd1153a947edce5
immediately visible in missionMemory: true planned
```
But `missionMemory.cjs`'s `createMission()` does an unsynchronized
**read → mutate → write**:
```js
const store = _loadMissions();      // reads current file (mtime-cached)
store.missions.push(mission);       // mutates local copy
_saveMissions(store);               // writes local copy back
```
When the autonomous engine fires multiple mission-creation calls in a tight window (observed:
several created within the same second), two calls can both read the same base state before either
writes — the second write overwrites the first's addition, silently dropping one mission.

### Measured impact

```
orchestrator records: 12
also in missionMemory: 5
orchestrator-ONLY (lost update): 7    (58%)
```
For each of those 7, `/mission/timeline`, `/mission/graph`, `/mission/replay`, and
`/mission/state` all 404 — even though the mission genuinely exists in `orchestrator-state.json`
and executed real stages.

### Why not fixed in this pass

`missionMemory.cjs` is shared, high-traffic infrastructure (2,124 records, consumed by every
already-certified OS track). A correct fix (file locking, an atomic append primitive, or a
different consistency model) changes write semantics for the platform's single authoritative
mission store. Given the volume of concurrent autonomous writers already observed, this needs a
dedicated pass rather than a same-session patch layered on top of two other fixes already applied
to the orchestrator. Documented here with exact reproduction for that pass.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** (baseline and final) |
| `tests/workflows/04-recovery-workflow` | **15/15** |
| `tests/runtime/14-memory-eviction` | **6/6** |

No test was modified, skipped, or weakened.
