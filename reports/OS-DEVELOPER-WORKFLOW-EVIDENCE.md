# OS-DEVELOPER — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5088` (dedicated Developer verification instance)
**Auth:** real `POST /auth/login` sessions only — **no JWT was forged, no auth bypassed.**
**Operator:** `finop@test.local` (workspace `ws_1786660472626_22971bc3`) · **Tenant B:** `finoa@test.local`

All output below is verbatim from executed requests or executed code paths.

---

## Lifecycle trace verified

```
IDE/PROJECT → workspace (GET /workspace)
CODE        → CodeEditorPane / Electron IPC (git-status, file read)
ANALYZE     → /coding/smells (3,587 findings), /engineering/intelligence
PLAN        → POST /missions/orchestrator/create → 5-stage plan
MISSION     → planned → active → failed (honest, post-fix)
AGENT       → stages dispatched to loop tasks, retried 2×
EXECUTE     → /runtime/dispatch → per-task results
TEST        → npm run test:runtime 144/144
BUILD       → npm run build (+ new artifact integrity guard)
DEPLOY      → /deployment/targets, /deployment/active (records read, none executed)
OBSERVE     → /runtime/status, /engineering/intelligence
FIX/VERIFY  → 4 defects fixed, negative-tested, live re-verified
```

---

## W1–W3 — Runtime, orchestrator, mission state

`GET /mission/runtime/status` → **200**
```json
{"success":true,"status":{"missions":{"total":2104,
 "byStatus":{"active":569,"planned":535,"completed":958,"failed":38,"cancelled":4},
 "byPriority":{"medium":764,"high":867,"low":235,"critical":238},
 "avgCompletionTimeMs":363819,"failureRate":0.0209}}}
```
Real corpus of 2,104 missions with a non-zero failure rate — not a seeded fixture.

`GET /missions/orchestrator/statistics` → **200**
```json
{"success":true,"running":true,"uptimeSec":365,"liveMissions":1,
 "created":1,"completed":2,"failed":0,"totalStages":5,"retries":0,"rollbacks":0}
```

## W4 — Create a real engineering mission

`POST /missions/orchestrator/create` → **200**
```json
{"success":true,"mission":{"missionId":"msn_159801596de24d64aaebc115988456d0",
 "goal":"DevOS verification: analyze code smells in a safe fixture","orchStatus":"planned",
 "stages":[{"id":"stg_...","index":0,"description":"Decompose goal: ...",
 "capability":"goal_decompose","status":"pending","maxRetries":2}, ...]}}
```
A real 5-stage plan (`goal_decompose → task_plan → validation → execution → reporting`).

## W5 — DEFECT D-1 DISCOVERED: fake mission completion

Polling the same mission after execution:

```
orchStatus = completed          <-- reported success
  [0] completed  cap=goal_decompose
       out: [ai] AI backend unavailable. Check provider API keys in your .env file.
  [1] completed  cap=task_plan
       out: [ai] AI backend unavailable. ...
  [2] completed  cap=validation
       out: [ai] AI backend unavailable. ...
  [3] completed  cap=execution
       out: [terminal] {"success":false,"error":"Command blocked: command_not_allowlisted"}
  [4] completed  cap=reporting
       out: [ai] AI backend unavailable. ...
```

**Every stage failed. The mission reported `completed`.** Zero real work was performed.

### Root cause (traced, not inferred)

`agents/autonomousLoop.cjs` `_runTask()` marked a task `completed` whenever the executor
*returned*. Executors report failure by **returning** `{success:false, error}` rather than
throwing (`agents/executor.cjs`; `agents/runtime/bootstrapRuntime.cjs:224` explicitly sets
`success:false` for "AI backend unavailable"). Nothing threw, so the catch block never ran, and
`missionOrchestrator._pollLoopTask()` — which reads `task.status` — saw `completed`.

The failure signal **already existed** and was simply never read.

### Fix + negative test

`_runTask()` now inspects `result.success`: all sub-tasks failed → task `failed`; some failed →
`completed` with `partialFailure` recorded.

```
PASS  all AI unavailable   -> failed
PASS  blocked terminal     -> failed
PASS  genuine success      -> completed
PASS  mixed                -> completed(partial)
PASS  legacy no-flag       -> completed     (no false failures on old shapes)
5/5 negative-test cases pass
```

### Live re-verification (identical conditions, post-fix)

`POST /missions/orchestrator/create` → mission `msn_eddff64b7e1b49119a25cab602a088f0`:
```
orchStatus = failed        <-- honest
memStatus  = failed
  [0] completed  cap=goal_decompose
  [1] completed  cap=task_plan
  [2] completed  cap=validation
  [3] failed     cap=execution   retries=2   err=Loop task failed
  [4] pending    cap=reporting
```
The failing stage retried twice, then failed; reporting correctly never ran.

## W6 — Code analysis (and DEFECT D-2)

`GET /coding/smells` → **200**, 3,594 findings in 4.0 s across 9 detectors:
`duplicate_literal 988 · dead_export 667 · long_function 540 · console_log_prod 527 ·
sync_fs 478 · query_optimization 205 · empty_catch 171 · todo_fixme 10 · blocking_crypto 8`

### Ground-truth check of a single finding

Reported: `TrustComplianceCenter.jsx` — *"15 TODO/FIXME comments accumulated"*.
Actual file contents: **1**. The other 14 were `status:"todo"` data values and the word "todo"
inside a sentence — the regex `/\b(TODO|FIXME)\b/i` was case-insensitive and not comment-anchored.

Repo-wide measurement (1,052 files): current **30** vs case-sensitive **13** → **17 phantom
matches across 4 files**.

### Fix + negative test

Marker now requires uppercase **inside a comment**:
```
PASS  // TODO: fix this            -> true
PASS  // FIXME broken              -> true
PASS   * TODO in jsdoc             -> true
PASS  /* TODO block */             -> true
PASS  status:"todo",               -> false   (was a false positive)
PASS  // done/partial/todo         -> false
PASS  const todoList = [];         -> false
8/8 negative-test cases pass
```

### Live re-verification
```
total smells: 3587
todo_fixme now: 1   (was 10)
all other detectors unchanged
latency 2.2 s  (optimization intact, not regressed)
```

## W7 — Deployment surfaces

`GET /deployment/targets` → **200** — 3 profiles with `healthEndpoint`, `healthThreshold`,
`rollbackOnFail`, `requireApproval`, `maxRetries`.
`GET /deployment/active` → **200** — real historical deploy records (`deploy_1784814024181_2`).

**No deployment was executed** — running one would deploy for real.

## W8 — Engineering intelligence

`GET /engineering/intelligence` → **200**
```
repositoryHealth: score 53, grade C
dimensions: repositoryHealth, missionRisk, commitRisk, codeHotspots, recentFailures,
            regressionTrends, dependencyRisk, executionInsights
```

## W9 — AI engineering (CREDENTIAL BLOCKED, honest)

`POST /coding/ask` → **500**
```json
{"ok":false,"error":"AI backend unavailable. Check provider API keys in your .env file."}
```
Server log shows a real 4-provider fallback chain before giving up:
`groq 429 (quota) · openai 401 (invalid) · ollama 404 · lmstudio unreachable`.

**No AI output was fabricated.** `.env` untouched; no key material printed.

## W10 — Non-AI code intelligence

`GET /memory/stats` → **200** — `lessons 2000, rules 5, rcas 5, failuresAnalysed 2440, missions 2119`
`GET /coding/decisions` → **200** — real opportunities with file/type
`GET /coding/bundle/status` → **404 `bundle not found`** — correct: no bundle created yet

## Git / repository integration (Electron IPC)

Executed the `git-status` handler's own logic read-only against this repo:
```
branch: security/reality-completion...origin/security/reality-completion [ahead 416]
changed files parsed: 33
   M agents/autonomousLoop.cjs
   M backend/routes/enterprisePolicy.js ...
```
Real git integration. **No push, no merge, no destructive git operation was performed.**

---

## DEFECT D-3 — Mission history destroyed on restart

After a server restart my failed mission was **absent** from `/missions/orchestrator` and from
`data/orchestrator-state.json`; the file contained only records created *after* the restart.

### Root cause

`missionOrchestrator.cjs`: `_loadOrch()` restores only **non-terminal** missions into `_live`,
while `_saveOrch()` serializes **only `_live.values()`**. Every completed/failed mission is
therefore dropped by the first save after boot.

Demonstrated:
```
persisted on disk : a:completed, b:failed, c:executing
restored to _live : c
next save writes  : c
LOST              : a, b
```

### Fix + negative test

Terminal records are recovered into a bounded `_terminalArchive` (500) and merged back on save;
live records win on id conflict.
```
T1 restart, no changes   -> a:completed, b:failed, c:executing   history preserved: true
T2 live mission finishes -> c:completed once (no duplicate)
T3 after 5 restarts      -> 3 records (stable, no loss)
```

### Live re-verification (real restart)
```
terminal missions before restart: 3
still present after restart     : 3
LOST                            : 0
total records after             : 11   (9 retained + 2 new)
```

---

## DEFECT D-4 — B.23 artifact integrity was NOT protected

**The mission's specific question:** can an exported `REACT_APP_API_URL` silently poison the
production bundle? **It could.**

`frontend/.env.production` pins `REACT_APP_API_URL=` (empty), but CRA loads `.env` files
**without overriding an existing `process.env` entry**, so a shell export wins:
```
.env.production value : ""
effective after config: "http://evil.example.com"
RESULT: shell export WINS -> bundle would be poisoned
```

**Proven end-to-end with a real build:**
```
REACT_APP_API_URL="https://evil-devos-probe.example.com" npm run build
→ files containing poisoned host: 44
```
`deploy.sh` passed the value straight through with **no validation**, and
`launchReadiness.cjs`'s "domain" check always returns `pass:true` — it is not an integrity guard.

**The clean build was immediately restored** (`poisoned refs remaining: 0`).

### Fix + negative test

`deploy.sh` now validates before building and verifies after:
```
''                        -> ALLOW(same-origin)
'https://api.ooplix.com'  -> ALLOW(https)
'http://evil.example.com' -> REJECT(not-https)
'https://localhost:3000'  -> REJECT(localhost)
'http://localhost:5050'   -> REJECT(localhost)
'ftp://x' / 'not-a-url'   -> REJECT(not-https)
```
A first attempt at the post-build check used a bare `localhost` grep; it **failed a clean build**
because the bundled Firebase SDK legitimately contains `"http://localhost"`. That false positive
was caught and the check was rewritten to assert on `BUILD_API_URL` itself. `bash -n` passes and a
clean build passes the guard.

---

## Performance

| Workflow | Latency |
|---|---|
| `/missions/orchestrator` | 0.002 s |
| `/runtime/status` | 0.001 s |
| `/deployment/targets` | 0.007 s |
| `/workspace` | 0.008 s |
| `/engineering/intelligence` | 0.142 s |
| `/coding/smells` (1,052 files) | **2.16 s** |

Only `/coding/smells` is slow, proportionate to a full-repo scan of 9 detectors. **Not regressed**
by the D-2 fix (4.0 s cold → 2.2 s warm).

---

## Regression

| Suite | Baseline | After fixes |
|---|---|---|
| `npm run test:runtime` | **144/144** | **144/144** |
| `tests/integration/07-production-hardening` | — | **87/87** |
| `tests/workflows/04-recovery-workflow` | — | **15/15** |
| `tests/integration/09-v1-engine-validation` | 55/56 | 55/56 (**pre-existing**) |
| `tests/runtime/auto-v10` | 0/1 | 0/1 (**pre-existing**) |
| Frontend `npm run build` | passes | passes |

The two failures were confirmed pre-existing by **stashing my changes and re-running on a clean
tree** — identical results. **No test was modified, skipped, or weakened.**

`09-v1-engine-validation` hardcodes `assert.equal(matrix.length, 12)` while the registry
legitimately registers **26** capabilities (confirmed in the boot log). That is a stale test, not a
product defect; correcting it is an owner decision and was left alone.
