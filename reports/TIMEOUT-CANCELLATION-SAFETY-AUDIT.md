# TIMEOUT, CANCELLATION & LONG-RUNNING OPERATION SAFETY — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-20 · **Branch:** `security/reality-completion`

---

## Method

Inventoried real long-running operations across the categories named in the mission: AI/provider calls,
`autonomousLoop.cjs`, `executionEngine.cjs`, `autonomousExecutionRuntime.cjs`, raw HTTP/HTTPS calls,
child-process/terminal execution, browser automation, and repository analysis. For each candidate,
established the operation's actual execution semantics (what genuinely happens when it runs long) before
classifying it as a defect, per the mission's own explicit instruction. Live-reproduced every claim: a
real hung local HTTP server (accepts the TCP connection, never responds) for HTTP-client timeout claims,
a real `sleep 5` child process for the process-kill claim, and a standalone `Promise.race` reproduction
script proving the "loser" of the race keeps running in the background.

## Phase 1-2 — Inventory & real timeout behavior

**`agents/autonomousLoop.cjs`, `agents/runtime/executionEngine.cjs`,
`backend/services/autonomousExecutionRuntime.cjs`** — all three implement timeouts via
`Promise.race([realWork, timeoutPromise])`. Empirically confirmed (standalone reproduction script) that
this genuinely does NOT stop `realWork`: the loser of the race keeps executing to completion in the
background, fully disconnected from the caller, which has already moved on to retry/mark-failed logic.
This is real and live, not theoretical — it is the mission's own central Phase-2 warning materialized in
this codebase.

**`backend/services/terminalController.cjs`'s `streamOutput()`** — real defect. Its sibling `execute()`
correctly bounds commands via `execFileSync(bin, rest, { timeout })`; `streamOutput()` spawned the
identical allow-listed command with a bare `spawn()` and zero timeout or kill path anywhere. Reachable
live via the mounted `POST /computer/terminal/stream` route. **Fixed.**

**`backend/services/vsCodeExtensionService.cjs`'s `_httpsPost`/`_httpPost`** — real defect. Both back the
Editor AI facade (`aiExplain`/`aiGenerate`/`aiFix`, `/p24/vscode/*` routes). `req.on("error", reject)`
only fires on connection-level failure (refused/reset/DNS) — never on a server that accepts the TCP
connection but simply never replies, so a slow/hung AI provider endpoint hung the request forever.
**Fixed**, both functions, same `req.setTimeout()` pattern already correct elsewhere in this codebase.

**`agents/salesAgent.cjs`'s Groq axios call** — real defect. Backs the live `POST /jarvis` sales-closer
flow (`jarvisController.js` → `SalesAgent.generateReply()`). axios has no default timeout; none was set.
**Fixed** with a 15s timeout, matching `apiManager.cjs`'s established default for the same purpose.

**`backend/services/founderIdentityOS.cjs`'s Cloudflare discovery `fetch()`** — real defect, an isolated
inconsistency rather than a file-wide pattern. Its sibling `_discoverGitHub()` (a few lines above)
already correctly bounds its own `https.get()` calls via `req.setTimeout(8000, ...)`; the Cloudflare
`_get` helper used native `fetch()` with no `AbortSignal`. **Fixed** with `AbortSignal.timeout(8_000)`,
matching the sibling's own 8s bound.

**`backend/services/repoIntelligenceEngine.cjs`'s `walk()`** — investigated, **not a defect**. Its
recursive `fs.readdirSync` walk has no in-recursion bound (unlike its sibling in
`repositoryEditingEngine.cjs`, which correctly checks a `maxFiles` cap before every recursive call). But
the real, mounted `POST /p24/repo/index` route (`backend/routes/phase24.js:106-124`) already runs
`indexRepo()` inside a child process via `execFile(..., { timeout: 30000 })` — Node's own `timeout`
option SIGTERMs the child if it exceeds 30s, and being off-process, a pathological walk cannot block the
main server's event loop regardless. Confirmed via direct test that `Dirent.isDirectory()` returns
`false` for a symlinked directory, so a symlink cycle cannot cause infinite recursion either — no
fix needed.

**`agents/browser/browserRunner.cjs`** — investigated, **already excellent, no fix needed**. Real
cancel-token architecture (`_makeCancelToken()`, checked at the top of each step-loop iteration), a hard
workflow-level `setTimeout(() => token.cancel(...), timeoutMs)` (default 5 min) with `clearTimeout` on
every exit path, real operator controls (`cancel(workflowId)`, `emergencyStop()`). One of the
better-instrumented subsystems in the codebase.

## Phase 3 — Cancellation

**Cooperative-but-real cancellation exists** in `autonomousExecutionRuntime.cjs` (a `cancelled` flag
checked between retry attempts) and `browserRunner.cjs` (a cancel token checked between workflow steps).
Neither cancels *mid-attempt* — the current in-flight attempt runs to completion regardless — but each
attempt is itself further bounded by its own nested timeout, so the gap between cancellation-request and
actual-stop is bounded, not infinite. Classified as **(1) intentional/safe** per the mission's own
3-way classification, not a defect.

**`autonomousLoop.cjs` and `executionEngine.cjs` have no cancellation at all** beyond the `Promise.race`
timeout itself — there is no token, flag, or `AbortController` a caller can use to request early
stopping. Classified as **(2) environment/architecture limitation**, not a code defect requiring a fix
in this bounded mission (see Final Classification below).

## Phase 6 — Retry interaction

`executionEngine.cjs`'s retry loop already checks `result.nonRetriable` (lines 327, 381) before
scheduling another attempt — the existing, already-certified convention this mission's Phase 6
instructed to reuse, not reinvent. **CERTIFIED, no fix needed.**

**5th fix, added on follow-up (2026-08-20, same day, second pass):** cross-referencing this mission's own
Phase 1-2 finding — that `executionEngine.cjs`'s `_withTimeout` does not cancel the underlying handler
promise on timeout — against the retry loop specifically surfaced a concrete, previously-undocumented
duplicate-execution risk: when attempt N times out, the loop's next iteration (attempt N+1) re-invokes
`agent.handler(task, extendedCtx)` for the identical task while attempt N's orphaned promise may still be
running in the background and could still complete, mutating state a second time (a duplicate CRM write,
duplicate payment call, or duplicate mission-execution side effect, depending on which handler is behind
the timeout). This is real, not theoretical — `executionEngine.cjs` is the central dispatch path for
`autonomousLoop.cjs`, `autonomousExecutionRuntime.cjs`, and `runtimeOrchestrator.dispatch()` alike.

Threading a real `AbortController` through every one of the ~14 files that register a handler via
`agentRegistry.register()` so cancellation could actually stop the orphan mid-flight would be the new
cancellation framework / architecture redesign this mission's own scope explicitly prohibits. Instead,
fixed the narrower, concretely-actionable half of the problem — the *retry* side, not the *cancellation*
side: `_withTimeout` now marks a `(taskId, task.type)` composite key as orphaned when it specifically
times out (as opposed to the handler genuinely rejecting), and the retry loop refuses to start a new
concurrent attempt for that same key while the mark is set, bailing straight to dead-letter instead —
mirroring the existing `nonRetriable` short-circuit pattern two lines away, not a new mechanism. The
orphan mark clears itself once the abandoned promise actually settles (either outcome), so a genuinely
later, fresh dispatch of the same key is never blocked forever.

Keyed by **both** `taskId` and `task.type`, not `taskId` alone: `runtimeOrchestrator.dispatch()` reuses
one `taskId` across every task in a multi-task batch (`runtimeOrchestrator.cjs:293-310`), so a
`taskId`-only key would have incorrectly blocked an unrelated sibling task sharing the same dispatch-level
`taskId` — verified live via a dedicated test proving a sibling task is never blocked by another task's
orphan. Does **not** claim to fix the underlying cancellation gap (the orphaned handler still runs to
completion in the background, unstoppable, exactly as before) — it only prevents the retry loop from
compounding that gap into a second concurrent invocation of the same work.

## Phase 7 — Process/browser safety

`terminalController.cjs`'s `execute()` (real `execFileSync` timeout) and the fixed `streamOutput()`
(real process-group `SIGKILL`) both now correctly bound and clean up. `backend/core/safe-exec.js` was
already correct and is the pattern both fixes above reuse. `browserController.cjs`'s `downloadFile()`
shell-interpolated `curl` command has a real timeout (no hang risk) but is a shell-injection surface —
**noted as an "Other" finding, out of this mission's timeout/cancellation scope, not fixed here.**

## Phase 8 — Live failure test evidence

- `terminalController.streamOutput("sleep 5", { timeoutMs: 500 })`: record transitions `streaming` →
  `failed` at ~530-780ms (not the natural 5000ms), confirmed via `ps aux` that zero orphaned `sleep 5`
  process remains.
- `vsCodeExtensionService`-pattern raw HTTP POST against a real hung local server: rejects at ~503-517ms
  for a 500ms bound, via the explicit `timed out` error, not a hang.
- `salesAgent.cjs`-pattern axios call against the same kind of hung server: rejects at ~508-1017ms for
  its configured bound, `ECONNABORTED`.
- `founderIdentityOS.cjs`-pattern native `fetch()` with `AbortSignal.timeout()` against the same kind of
  hung server: throws `TimeoutError` at ~502-507ms.
- Standalone `Promise.race` reproduction: caller receives the timeout rejection and proceeds immediately;
  the orphaned underlying promise genuinely completes hundreds of ms later, fully disconnected —
  demonstrating the systemic pattern (Phase 1-2) is real, not merely theoretically possible.
- `executionEngine.cjs`'s duplicate-execution guard: a handler forced to time out on attempt 1 (200ms
  bound, 1500ms real completion) is confirmed invoked exactly once during the full `executeTask()` call —
  attempts 2 and 3 are correctly blocked rather than firing a second concurrent invocation; once the
  orphan genuinely settles ~1500ms later, a fresh dispatch of the same `(taskId, task.type)` succeeds
  normally, proving the guard is temporary, not a permanent lockout; a sibling task sharing the same
  dispatch-level `taskId` as an orphaned task is confirmed to run unaffected.

## Final Classification

**Fixed (5):** `terminalController.streamOutput()` (zero-bound spawned child — highest severity, real
process-group leak risk), `vsCodeExtensionService._httpsPost`/`_httpPost` (zero-bound raw HTTP backing a
live AI-editor facade), `salesAgent.cjs`'s Groq axios call (zero-bound, backing the live sales-closer
flow), `founderIdentityOS.cjs`'s Cloudflare `fetch()` (zero-bound, isolated inconsistency),
`executionEngine.cjs`'s retry loop (duplicate-execution risk on timeout-then-retry, closed via a
composite-keyed orphan guard). All 5 reuse an existing, already-established pattern from elsewhere in
this exact codebase — no new mechanism, framework, or dependency.

**Documented limitation, not fixed — systemic `Promise.race`-without-`AbortController` pattern** across
`autonomousLoop.cjs`, `executionEngine.cjs`, `autonomousExecutionRuntime.cjs`: the orphaned handler
promise itself still cannot be stopped mid-flight and still runs to its natural completion in the
background — only the *retry loop's* reaction to that orphan was fixed (see the 5th fix above), not the
orphan's existence. A true fix for the orphan itself requires threading a real cancellation signal through
every capability/agent handler across dozens of files — a large, invasive, multi-file architectural
change the mission explicitly prohibits ("DO NOT redesign the architecture. DO NOT introduce a new
cancellation framework."). Mitigating factor: every orphaned underlying operation is itself further
bounded by its own nested timeout (a provider call, a capability handler, a subprocess) — none of the
operations found this mission are truly *unbounded*, only *imprecisely cancelled*, and the duplicate-side-
effect consequence of that imprecision is now closed by the 5th fix above. Secondary consequence:
`agentRegistry.cjs`'s `_active` slot count can still be briefly stale for the duration of an orphaned
call, since it decrements on the timeout `catch`, not on the orphan's actual completion — same root
cause, same "document, don't fix" classification (does not create a duplicate-execution risk the way the
retry-loop gap did, only an imprecise concurrency count).

**Certified as-is, no fix needed:** `browserRunner.cjs`'s cancellation (real, cooperative, correctly
bounded), `autonomousExecutionRuntime.cjs`'s between-attempt cancellation (same reasoning),
`repoIntelligenceEngine.cjs`'s `walk()` (already bounded by its caller's `execFile` process timeout,
symlink-cycle-proof by `Dirent.isDirectory()` semantics), `executionEngine.cjs`'s `nonRetriable` retry
gate (already correct).

## Regression

**Before:** 340/340. **After:** 352/352 (clean re-run; two other pre-existing tests — an unrelated
mission-recovery test and a password-reset test — failed transiently on an earlier run made under heavy
concurrent CPU load from two overlapping test suites, including a false-positive orphan-process check
caused by the monitoring harness's own background polling process; both were confirmed unrelated to this
mission's fixes and disappeared on a clean re-run with no other load on the machine).
**New tests:** 12 total — block 151 (4 structural + 5 live, covering the first 4 fixes with static-source
assertions and real hung-server/hung-process reproductions) plus block 152 (1 structural + 2 live,
covering the 5th fix: the duplicate-execution guard, a genuine background-timeout reproduction proving
exactly one handler invocation occurs, and a sibling-task isolation proof). **Negative-tested all 5
fixes**: each fix individually reverted, confirmed the corresponding targeted test(s) failed for the exact
expected reason (stale `streaming` status never transitioning; missing
`req.setTimeout`/`timeout`/`AbortSignal.timeout` assertions failing; the duplicate-execution guard's
structural assertions failing to find the guard code and its live test observing 2 handler invocations
instead of 1), restored, confirmed passing again. Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: 1/1 PASS. `.env` untouched. Server confirmed
healthy (`GET /health` → 200) throughout, same PID, no restart required.

**No OS-track record altered.**
