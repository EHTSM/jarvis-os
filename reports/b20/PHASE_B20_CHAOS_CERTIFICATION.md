# Phase B.20 — Chaos Engineering Certification

**Branch:** `security/reality-completion`
**Baseline HEAD:** `189721325de3626686c8a1708c5be758d85ec791`
**B.20 commit:** `f6855003`
**Date:** 2026-08-13
**Scope:** Audit + recovery only. No merge. No push. `.env` untouched.

---

## 1. Executive summary

Ooplix was operated under controlled failure and **fails safely in every domain
that could be measured**. Denials stay denials under retry, expired and forged
sessions are rejected, write failures surface as errors with nothing persisted,
and the AI path reports provider unavailability instead of fabricating a reply.

Two real defects were found and fixed. One of them means **the phase did not
start from a working baseline**:

> `npm run build` was **already broken at HEAD**. A named import
> (`getTasks` from `../api`) does not exist, so the production bundle could not
> compile at all. No prior phase's gate caught this.

The second is a disk leak: a process killed between `writeFileSync` and
`renameSync` orphans a `.tmp` file forever — ~11 MB was sitting on this repo.

One capability gap is recorded, not built: `GET /queue/status` depends on a
module archived in May 2026 and has been permanently 503 ever since.

**A significant part of the pre-existing chaos suite was measuring nothing.**
`tests/chaos/01-controlled-chaos.cjs` reports 6/10 FAIL with results like
"0/20 connects", "0/50 accepted", "0/100 handled". Those zeros describe the
harness, not the product: it authenticates with an `x-auth-token` **header**,
while the app reads the session **only** from the httpOnly `jarvis_auth`
cookie. Every request it makes returns 401. Those failures are **not** product
defects and are not counted as such here.

---

## 2. Pre-flight (Section 1)

| Check | Result |
| --- | --- |
| git HEAD at start | `189721325de3626686c8a1708c5be758d85ec791` |
| Branch | `security/reality-completion` |
| `.env` | **Untracked and untouched** (mtime Aug 5, never in git) |
| `.env.example` | SHA `be428b4c…00fe2d` — **identical at start and end** |
| Dirty tracked files at start | 3, all pre-existing: `backend/routes/runtime.js`, `backend/services/businessOrg.cjs`, `backend/services/businessOrgWorkflow.cjs` |
| `npm run test:runtime` baseline | **144 pass / 0 fail / 0 skipped** (50 suites) |
| Backend port | 5050 (`PORT` env; `server.js` defaults to 5050) |
| Existing chaos utilities found | `tests/chaos/01-controlled-chaos.cjs` (10 scenarios), `tests/burnin/*` (7 suites), 9 npm burn-in scripts |

Existing utilities were inventoried **before** anything new was written, per the
brief. The new driver exists only because the existing one cannot authenticate
(§4.1) — its scenarios were not duplicated.

---

## 3. Method

Every finding below was **reproduced live against the running application
before any source was read**, then root-caused, minimally recovered,
regression-tested, and re-verified.

Authentication is by real cookie session (`jarvis_auth`, signed with the app's
own `signJWT`) against two **genuinely separate tenants** taken from
`data/workspaces.json`:

| Tenant | Account | Workspace |
| --- | --- | --- |
| A | `ws_owner_1` | `ws_1784239964906_5959d972` "Iso Test WS" |
| B | `phase9-user` | `ws_1784259743213_fc85d672` "Phase9 Test WS" |

**Validity gate.** `scripts/b20-chaos-driver.cjs` refuses to run if its
authenticated probe is rejected:

```
INVALID RUN — authenticated probe returned 403.
Chaos results collected from rejected requests describe the harness, not the product.
```

This is the direct lesson of §4.1: a zero from a 401 is not a pass.

---

## 4. Findings

### 4.1 — The existing chaos suite authenticates in a way the app rejects
**Classification: FIXED (harness), not a product defect**

`tests/chaos/01-controlled-chaos.cjs` sends `x-auth-token`:

```js
if (token) { options.headers["x-auth-token"] = token; }
```

`backend/middleware/authMiddleware.js` reads the cookie jar only:

```js
const cookies = _parseCookies(req);
const token   = cookies[COOKIE_NAME];      // COOKIE_NAME = "jarvis_auth"
if (!token) return res.status(401).json({ error: "Unauthorized" });
```

Measured directly — a validly signed operator JWT, three ways:

```
/health                    200
/api/runtime/status noauth 401 {"error":"Unauthorized"}
  + x-auth-token           401 {"error":"Unauthorized"}
  + Authorization Bearer   401 {"error":"Unauthorized"}
  + jarvis_auth cookie     403 {"error":"Not a member of this workspace"}   ← accepted
```

The cookie-only design is deliberate and **security-positive** (an httpOnly
cookie resists XSS token theft). The harness simply predates it.

**Consequence for this audit:** the suite's 6 "FAILURES" — reconnect flood
0/20, overload 0/50, audit stress 0/100 — are all artifacts of universal 401s.
Reporting them as chaos failures would have been fabricated evidence. Guarded
by a regression test asserting the middleware never accepts a header token.

---

### 4.2 — Production build broken at HEAD
**Classification: FIXED · Severity: critical (total build failure)**

```
$ npm run build
Failed to compile.
Attempted import error: 'getTasks' is not exported from '../api' (imported as 'getTasks').
```

`frontend/src/hooks/useRuntimeStream.js:2` imported `getTasks` from `../api`.
That symbol is exported from `personalApi.js` — a different module, and its
signature takes a filter object (`{status, priority, overdue, limit}`) while
the call site passes nothing.

This hook polls the **runtime task queue**, so the function it actually wants
is `getRuntimeTasks()` — which `api.js` *does* re-export (`export * from
"./runtimeApi"`) and which takes no arguments, matching the call site exactly.

**Verified pre-existing**, not caused by this phase:

```
$ git show HEAD:frontend/src/api.js | grep -c getTasks
0
$ git show HEAD:frontend/src/hooks/useRuntimeStream.js | grep -n getTasks
2:import { BASE_URL, getOpsData, getTasks, ... } from '../api';
```

Introduced by `d75ecfd7` (Phase A.11.4). **Fix:** import `getRuntimeTasks` and
call it. Build now reports `Compiled successfully.`

---

### 4.3 — Orphaned `.tmp` files leak disk across crash cycles
**Classification: FIXED · Severity: moderate (disk only, no correctness impact)**

`missionMemory._saveMissions()` uses a unique-name atomic write:

```js
const tmp = `${MISSIONS_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
try { fs.writeFileSync(tmp, ...); fs.renameSync(tmp, MISSIONS_FILE); }
catch (err) { try { fs.unlinkSync(tmp); } catch {} throw err; }
```

The cleanup runs only on a **caught** error. Death between `writeFileSync` and
`renameSync` — SIGKILL, OOM kill, host restart — leaves the tmp with no code
path that ever removes it. Confirmed by exhaustive search: the only `.tmp`
reference in the codebase *ignores* them
(`continuousRuntimeObserver.cjs:269`); there is no sweep anywhere.

Measured on this repo:

```
-rw-r--r--  11412345  data/missions.json.45477.217dbaa1dafe.tmp   (pid gone)
-rw-r--r--         0  data/missions.json.69940.9ff20af88ef7.tmp   (pid gone)
du -k → 11148 KB + 12316 KB
```

Nothing reads `.tmp`, and `missions.json` itself was healthy (2,087 missions
parsing cleanly) — so this is unbounded disk growth, **not** corruption.

**Honest limit:** I could not reproduce the orphan on demand. 41 mission writes
plus a SIGKILL produced **zero** new orphans — the window between write and
rename is very narrow. The defect is real (two artifacts, dead pids, no cleanup
path) but **rare**, and it is recorded as such rather than overstated.

**Fix:** a module-load sweep, regex-scoped to this store's own
`missions.json.<pid>.<hex>.tmp` shape, with a 5-minute grace window so a
concurrent writer's in-flight tmp is never deleted. Reclaimed the ~11 MB.

---

### 4.4 — `GET /queue/status` depends on an archived module
**Classification: GENUINE CAPABILITY GAP — recorded, not built**

```
GET /queue/status → 503 {"error":"Metrics collector unavailable"}
```

`backend/routes/tasks.js:28` requires `agents/metrics/metricsCollector.cjs`.
That directory **does not exist** — the module was moved to
`_archive/20260520_010917/` in a May 2026 cleanup. The require sits inside a
`try/catch` that nulls the module, so the endpoint returns a permanent 503
instead of crashing.

Four call sites reference it (`routes/tasks.js` ×2, `routes/ops.js` ×2).

**This is fail-closed, honest behaviour** — it reports unavailability rather
than fabricating zero counters. And the same data is served live elsewhere:

```
GET /tasks            → 200  {"success":true,"count":65,"tasks":[...]}
GET /scheduler/status → 200  (pending/running/total from taskQueueMod)
```

`agents/runtime/metricsStore.cjs` is **not** a drop-in replacement — its API is
`start/stop/recent/availableDates`, with no `queueStatus()`. Restoring the
endpoint means reviving an archived module, which exceeds "minimal recovery"
and would be inventing capability. **Recorded, not built.**

---

## 5. Failure-domain results (Section 2)

17 scenarios, all authenticated (`scripts/b20-chaos-driver.cjs`).
Full log: `/tmp/b20-results.json`.

| Domain | Scenario | Result |
| --- | --- | --- |
| E | Unauthenticated request denied | **PRODUCTION READY** — 401 `{"error":"Unauthorized"}` |
| E | Role-escalation claim → B's members | **PRODUCTION READY** — 403 |
| V | A cannot read B's workspace members | **PRODUCTION READY** — 403 |
| V | Denial survives 8 retries (no bypass) | **PRODUCTION READY** — all 403 |
| V | A's workspace list excludes B | **PRODUCTION READY** — 2 workspaces, none B's |
| V | No cross-tenant cache bleed | **PRODUCTION READY** — distinct payloads (940 B vs 482 B) |
| U | Expired session rejected | **PRODUCTION READY** — 401 "Token invalid or expired" |
| U | Tampered signature rejected | **PRODUCTION READY** — 401 |
| F | Malformed JSON body | **PRODUCTION READY** — 400 `{"success":false,"error":"Invalid JSON body"}` |
| G | Empty body → no fabricated success | **PRODUCTION READY** — 400 `{"error":"prompt required"}` |
| C | AI under short client deadline | **PRODUCTION READY** — 502 in 1419 ms, no fake reply |
| I | AI provider unavailable | **PRODUCTION READY** — 502 "Check provider API keys", `content=false` |
| N | 3 concurrent identical submissions | **PRODUCTION READY** — 200×3, **1** record created |
| M | 30 concurrent reads | **PRODUCTION READY** — 30×200, p50 9 ms, p95 12 ms, **0** 5xx |
| D | Unknown route | **PRODUCTION READY** — honest 404 |
| Q | Deep health check | **PRODUCTION READY** — 207 multi-status, reports `healthy:false` truthfully |
| P | Queue status | **GENUINE CAPABILITY GAP** — §4.4 |

### Domains verified outside the driver

| Domain | Method | Result |
| --- | --- | --- |
| W | SIGKILL backend mid-workflow, restart | **PRODUCTION READY** — record written pre-kill survived; exactly 1 copy on disk; no duplication, no corruption |
| L | `chmod 555 data/` then write | **PRODUCTION READY** — 500 `{"success":false,...,"details":"EACCES..."}`, **0** records persisted, store intact |
| K | Atomic read path | **PRODUCTION READY** — tmp+rename means a `chmod 444` on the target cannot corrupt it (rename replaces the inode) |
| M/N | 5 concurrent POSTs, unique key | **PRODUCTION READY** — `duplicate` flags `[false,true,true,true,true]`, **1** record persisted |

### Domains NOT measured — stated, not implied

| Domain | Status | Reason |
| --- | --- | --- |
| I (success path) | **CREDENTIAL BLOCKED** | No AI provider API keys configured. Failure honesty was verified; a *successful* generation could not be. |
| J | **CREDENTIAL BLOCKED** | External integrations (payments, WhatsApp, Telegram) need live third-party credentials. |
| A, B, X, Y | **NOT MEASURED** | Backend-unavailable, network-interruption, frontend-reload and logout/login are browser-side. B.19.5 exercised the authenticated UI, but this phase did not re-drive it under injected failure. |
| O, R, S, T | **NOT MEASURED** | Background worker, automation, scheduler and partial-workflow failure require injecting faults into long-running agent processes. Not safely reproducible with existing mechanisms inside this phase. |

---

## 6. "Looks successful but failed" hunt (Section 4)

Probed the specific defect class across six endpoints, checking for 2xx +
`success:true` with no real payload or unconfirmed side effect:

```
 502  AI generate (no provider)  claims=false content=false
 500  AI chat-with-tools         claims=false content=false
 500  jarvis command             claims=false content=true
 200  mission runtime status     claims=true  content=true   (missions.total=2080)
 200  billing status             claims=true  content=true   (plan=trial, daysLeft=7)
 503  queue status               claims=false content=false
```

**No fabricated success was found.** Both 500s are *handled* errors carrying an
actionable message, `success:false`, and a `traceId` — no stack leak, no
invented reply:

```json
{"success":false,"reply":"Something went wrong. Please try again.",
 "error":"AI backend unavailable. Check provider API keys in your .env file.",
 "traceId":"msrozbfo"}
```

**A false positive I had to discard:** my first detector flagged
`mission runtime status` and `billing status` as "claims success, no content".
Both were wrong — the payloads carry real data under keys my heuristic did not
list. The instrument was at fault, not the product, and no finding was raised.

Also examined: `crmService.saveLead()` silently `return`s on dedup (line 74).
Traced to the route — it is **not** silent to the user; the handler checks for
an existing lead first and responds `{"success":true,"duplicate":true,...}`
explicitly, never overwriting. Correct behaviour, no finding.

---

## 7. Recovery measurements (Section 8)

Measured, not estimated:

| Measurement | Value |
| --- | --- |
| Cold start → first healthy `/health` | **2,998 ms** |
| SIGKILL → authenticated request served again | **2,595 ms** |
| Steady-state `/workspace` latency | **p50 5 ms, p95 30 ms** |
| 30 concurrent reads | p50 9 ms, p95 12 ms, max 12 ms, 0 × 5xx |
| AI failure surfaced (no provider) | **1,419–1,460 ms** |
| Write-failure error surfaced | < 100 ms, 0 records persisted |
| Duplicate-submission window | 5 concurrent POSTs → 1 record (no window observed) |
| Orphan disk reclaimed by sweep | ~11 MB |

No "resilience score" was invented, per the brief.

---

## 8. Tenant isolation under failure (Section 6)

Two genuinely separate accounts with disjoint workspace membership.

| Check | Result |
| --- | --- |
| Cross-org data leak | **None** — A→B members = 403 |
| Cross-org mutation | **None attempted successfully** — 403 before any handler |
| Authorization bypass on retry | **None** — 8 consecutive retries all 403 |
| Cached response bleed | **None** — distinct payloads (940 B vs 482 B) |
| Stale tenant data after switch | **None** — A's list contains 2 workspaces, none B's |
| Session bleed | **None** — expired and forged tokens both 401 |
| Expected denial code | **403 maintained** throughout |

**Honest scope limit:** isolation was proven on `/workspace*` routes, which are
genuinely tenant-scoped via `requireWorkspaceMember`. An early scenario used
`/runtime/status` and appeared to show a leak — that was **my error**:
`/runtime/status` is a global runtime endpoint that ignores `x-workspace-id` by
design, so it can neither prove nor disprove scoping. The scenario was
corrected rather than reported. Isolation across all 4,755 routes is **not**
claimed from this evidence.

---

## 9. Regression gate (Section 12)

| Suite | Before B.20 | After B.20 |
| --- | --- | --- |
| `npm run test:runtime` | **144 / 144** | **144 / 144** — unchanged |
| `tests/runtime/30-b20-chaos-recovery` (new) | — | **8 / 8** |
| `25-accessibility-contrast` | 9/9 | 9/9 |
| `26-accessibility-foundation` | 21/22 | 21/22 — pre-existing `G1-B193` |
| `27-visual-accessibility` | 16/16 | 16/16 |
| `28-keyboard-aria-recovery` | 14/14 | 14/14 |
| `29-a11-ux-consistency` | 12/12 | 12/12 |
| `tests/security/89` | byte-identical | **byte-identical** `aa5b00db…9bfebcb` |
| Production build | **FAILED** | **Compiled successfully** |

No existing test was modified, weakened, or skipped. The one standing failure
(suite 26) is the accessibility form-labelling gap recorded in B.19.5, and is
explicitly **not** a B.20 regression.

### Negative testing

Both new guards were proven to fail against un-fixed code:

| Guard | With fix | Fix removed |
| --- | --- | --- |
| Orphan tmp sweep | 8 pass / 0 fail | **7 pass / 1 fail** |
| `useRuntimeStream` import integrity | 8 pass / 0 fail | **7 pass / 1 fail** |

A passing suite therefore means something.

---

## 10. Scores (Section 10)

Scored strictly from measured evidence.

| Dimension | Score | Basis |
| --- | --- | --- |
| Chaos Engineering | **7 / 10** | 17 authenticated scenarios + 4 out-of-driver domains measured; 8 of 25 domains NOT MEASURED (browser-side and background-worker injection) |
| Failure Recovery | **9 / 10** | SIGKILL recovery 2,595 ms with no data loss or duplication; write failure fails closed; capped by unmeasured worker/scheduler recovery |
| Data Integrity | **9 / 10** | Atomic tmp+rename survives target `chmod 444`; 0 records on write failure; 1 record from 5 concurrent writes; −1 for the orphan leak found (now fixed) |
| Security Under Failure | **10 / 10** | Expired, forged, header-borne and unauthenticated tokens all rejected; no bypass under 8× retry |
| Tenant Isolation Under Failure | **9 / 10** | Zero leaks across 6 checks on genuinely scoped routes; not proven across all 4,755 routes |
| Error Honesty | **10 / 10** | No fabricated success found in any probe; 500s carry actionable messages + traceId; dead dependency fails closed rather than faking counters |
| Resilience | **8 / 10** | 30 concurrent reads with 0 × 5xx at p95 12 ms; capped by unmeasured sustained-load and worker-failure domains |
| **Overall B.20** | **8.5 / 10** | |

**Not 10/10, deliberately.** Eight of twenty-five failure domains could not be
measured with existing mechanisms inside this phase, and the AI success path is
credential-blocked. Scoring those as passes would be inventing evidence.

---

## 11. Certification

> **CERTIFIED WITH LIMITATIONS.**
>
> Across every failure domain that could be measured, Ooplix fails safely,
> recovers correctly, preserves tenant and security boundaries, and does not
> fabricate success. Two real defects were found and fixed — including a
> production build that was already broken at HEAD — and one capability gap is
> recorded rather than built.
>
> Certification is **limited**, not full: 8 of 25 failure domains remain
> **NOT MEASURED**, and the AI success path is **CREDENTIAL BLOCKED**.
> Those are named in §5, not rounded away.

---

## 12. Git safety (Section 13)

| Check | Result |
| --- | --- |
| `.env` | Untracked, unmodified (mtime Aug 5, pre-dates this session) |
| `.env.example` | SHA identical at start and end |
| B.20 commit | `f6855003` — exactly 5 files, all B.20 |
| Unrelated dirty files committed | **None** — the 3 pre-existing dirty backend files remain uncommitted and untouched |
| Merged | **No** |
| Pushed | **No** |

Files in `f6855003`:
```
backend/services/missionMemory.cjs          (orphan tmp sweep)
frontend/src/hooks/useRuntimeStream.js      (broken import fix)
tests/runtime/30-b20-chaos-recovery.test.cjs (new regression suite)
scripts/b20-chaos-driver.cjs                (new)
scripts/b20-scenarios.cjs                   (new)
```

---

*Phase B.20 · Ooplix V1 · Confidential*
