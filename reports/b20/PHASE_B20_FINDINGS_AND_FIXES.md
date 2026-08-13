# Phase B.20 — Findings Dossier & Root-Cause / Fix Register

Each finding: reproduced live → root cause → minimal recovery → regression →
re-verified. Nothing is listed that was not observed.

---

## B20-F1 — Production build broken at HEAD
**Classification: FIXED · Severity: critical**

### Reproduce
```bash
$ cd frontend && REACT_APP_API_URL=http://127.0.0.1:5099 CI=true npm run build
Failed to compile.
Attempted import error: 'getTasks' is not exported from '../api' (imported as 'getTasks').
```

### Root cause
`frontend/src/hooks/useRuntimeStream.js:2` imported `getTasks` from `../api`.

- `api.js` does **not** export `getTasks` (`git show HEAD:frontend/src/api.js | grep -c getTasks` → `0`).
- The symbol lives in `personalApi.js`, and its signature differs: it takes
  `{status, priority, overdue, limit}` while the call site (`line 125`) passes
  nothing.
- This hook polls the **runtime task queue**, so the correct function is
  `getRuntimeTasks()` — `_fetch("/tasks")`, no arguments — which `api.js` *does*
  re-export via `export * from "./runtimeApi"`.

### Pre-existing, not caused by this phase
```bash
$ git show HEAD:frontend/src/hooks/useRuntimeStream.js | grep -n getTasks
2:import { BASE_URL, getOpsData, getTasks, getRuntimeStatus, getRuntimeHistory } from '../api';
$ git log --oneline -1 -- frontend/src/hooks/useRuntimeStream.js
d75ecfd7 fix(runtime): ... (Phase A.11.4)
```
Present at baseline `18972132`. No prior phase's gate caught it.

### Minimal recovery
Import `getRuntimeTasks` instead of `getTasks`; update the single call site.
Two lines. No new module, no signature change, no new architecture.

### Regression
`tests/runtime/30-b20-chaos-recovery.test.cjs` — parses the named imports from
`../api` in `useRuntimeStream.js`, resolves `api.js`'s real export surface
(following its `export * from` re-exports), and asserts the intersection is
complete.

### Re-verified
```
Compiled successfully.
```
**Negative-tested:** restoring the bad import → 7 pass / 1 fail.

---

## B20-F2 — Orphaned `.tmp` files leak disk across crash cycles
**Classification: FIXED · Severity: moderate (disk only)**

### Reproduce (observed artifacts)
```bash
$ ls -la data/*.tmp
-rw-r--r--  11412345  data/missions.json.45477.217dbaa1dafe.tmp
-rw-r--r--         0  data/missions.json.69940.9ff20af88ef7.tmp
$ ps -p 69940     # → no such process
$ du -k data/*.tmp
11148  /  12316   (KB)
```

### Root cause
`backend/services/missionMemory.cjs::_saveMissions()`:
```js
const tmp = `${MISSIONS_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
try { fs.writeFileSync(tmp, ...); fs.renameSync(tmp, MISSIONS_FILE); }
catch (err) { try { fs.unlinkSync(tmp); } catch {} throw err; }
```
Cleanup runs only on a **caught** error. Process death between `writeFileSync`
and `renameSync` (SIGKILL / OOM / host restart) leaves the tmp orphaned with no
code path that ever removes it.

Confirmed by exhaustive search — the only `.tmp` reference in the codebase
*ignores* them (`continuousRuntimeObserver.cjs:269`); no sweep exists anywhere,
including at startup.

### Impact — bounded honestly
Nothing reads `.tmp`; `missions.json` itself parsed cleanly (2,087 missions).
This is **unbounded disk growth, not data corruption**.

### Reproduction limit — stated, not hidden
The orphan could **not** be reproduced on demand: 41 mission writes plus a
SIGKILL produced **zero** new orphans. The write→rename window is very narrow.
The defect is real (two artifacts, dead pids, no cleanup path) but **rare**.

### Minimal recovery
A module-load sweep in the same file, using the existing `fs`/`path`/`logger`
imports:
- regex-scoped to `^missions\.json\.\d+\.[0-9a-f]+\.tmp$` — cannot touch another
  service's tmp or a real data file;
- 5-minute grace window — a concurrent writer's in-flight tmp is never removed;
- fully guarded, never blocks startup.

### Regression
Four tests: sweeps an aged orphan; **does not** sweep a young one; does not
touch foreign tmp or real data files; leaves `missions.json` parseable.

### Re-verified
Sweep reclaimed ~11 MB; `find data -name "missions.json.*.tmp"` → empty.
**Negative-tested:** sweep disabled → 7 pass / 1 fail.

---

## B20-F3 — `GET /queue/status` depends on an archived module
**Classification: GENUINE CAPABILITY GAP — recorded, not built**

### Reproduce
```
GET /queue/status → 503 {"error":"Metrics collector unavailable"}
```

### Root cause
`backend/routes/tasks.js:28`
```js
const MC_PATH = path.join(ROOT_AGENTS, "metrics/metricsCollector.cjs");
function _getMC() { if (!_mc) { try { _mc = require(MC_PATH); } catch { _mc = null; } } return _mc; }
```
`agents/metrics/` **does not exist** — the module was moved to
`_archive/20260520_010917/agents/metrics/metricsCollector.cjs` in a May 2026
cleanup. The `try/catch` nulls it, so the route returns a permanent 503.

Four call sites reference it: `routes/tasks.js` ×2, `routes/ops.js` ×2.

### Why this is not scored as a failure
The endpoint **fails closed and honestly** — it reports unavailability rather
than fabricating zero counters, which is the correct behaviour for the defect
class this phase hunts. And the same data is live elsewhere:
```
GET /tasks            → 200 {"success":true,"count":65,...}
GET /scheduler/status → 200 (pending/running/total from taskQueueMod)
```

### Why it was not fixed
`agents/runtime/metricsStore.cjs` is not a drop-in replacement — its API is
`start/stop/recent/availableDates`, with **no** `queueStatus()`. Restoring the
endpoint means reviving an archived module: that is building capability, not
minimal recovery, and the brief forbids it. **Recorded, not built.**

---

## B20-F4 — Existing chaos suite cannot authenticate
**Classification: FIXED (harness) — not a product defect**

### Reproduce
```
$ node tests/chaos/01-controlled-chaos.cjs
PASSED: 2/10  FAILED: 6/10  SKIPPED: 2/10
  ✗ SCENARIO_01 ... 0 success, 20 failed
  ✗ SCENARIO_04 ... 0 accepted, 50 failed
  ✗ SCENARIO_08 ... 0/100 handled
```
Every scenario gets **zero** successful requests — the signature of a harness
fault, not a product fault.

### Root cause
The harness sends a header:
```js
if (token) { options.headers["x-auth-token"] = token; }
```
`authMiddleware.requireAuth` reads the cookie jar **only**:
```js
const cookies = _parseCookies(req);
const token   = cookies[COOKIE_NAME];   // "jarvis_auth"
if (!token) return res.status(401).json({ error: "Unauthorized" });
```

Measured with a validly signed operator JWT:
```
no auth            401
x-auth-token       401
Authorization      401
jarvis_auth cookie 403 → "Not a member of this workspace"   ← accepted
```

The cookie-only design is deliberate and security-positive (httpOnly resists
XSS token theft). A first hypothesis — that the harness's spawned server bound
to the wrong port — was **tested and disproved** (`PORT=5050` produced the
identical 6/10).

### Consequence
Those 6 "failures" are **not** product defects and are excluded from this
phase's results. Reporting them as chaos findings would have been fabricated
evidence.

### Recovery
`scripts/b20-chaos-driver.cjs` authenticates the way the app does, and
**hard-fails** if its authenticated probe is rejected — so a zero collected
from 401s can never be reported as a pass. Guarded by a regression test
asserting the middleware never accepts a header-borne token.

---

## Verified-correct behaviours (no finding raised)

| Behaviour | Evidence |
| --- | --- |
| CRM dedup is not a silent drop | `saveLead()` returns early on dedup, but the route checks first and responds `{"success":true,"duplicate":true,...}` explicitly, never overwriting |
| Atomic writes survive target permission loss | `chmod 444` on `leads.json` did not block the write — tmp+rename replaces the inode. Correct durability design |
| 500s are handled, not crashes | Both AI 500s carry `success:false`, an actionable message, and a `traceId`; no stack leak |
| Restart does not duplicate | Record written pre-SIGKILL survived with exactly 1 copy on disk |

---

*Phase B.20 · Ooplix V1 · Confidential*
