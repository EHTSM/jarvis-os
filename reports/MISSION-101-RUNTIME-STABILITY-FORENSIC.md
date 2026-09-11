# MISSION 101 — RUNTIME STABILITY FORENSIC (STATIC CODE-PATH ANALYSIS)

**Date:** 2026-09-09
**Branch:** `security/reality-completion`, HEAD `77f1cc0b421269134a2126d90caa4e2f078736dd` (unchanged)
**Scope:** Read-only, static source-code forensics only. No production code, tests, `.env`, or
data modified. No PM2 restart, no process start/stop, no external provider contacted, no commit/push.

## 0. Evidence provenance — read this before anything else

**This session has no live access to the production VPS.** Two prior missions in this same
session (`reports/ERA-1-INFRASTRUCTURE-EXECUTION-PREFLIGHT.md`, and a direct connectivity check
immediately preceding this mission) established that: no VPS host is configured in this
environment's SSH setup (`~/.ssh/config` contains only the unfilled `ssh-keygen` placeholder
template), `pm2 jlist` run locally spawns a brand-new empty daemon with zero processes, and one
attempted read-only SSH connectivity probe to the two IPs found in `~/.ssh/known_hosts` was
blocked by this session's own outbound-network safety classifier before it could complete.

**All runtime numbers below (PID 45837, restart count 67, memory samples, DriftMonitor readings,
RCA occurrence/confidence figures, node-cron miss, task-queue counts) are EXTERNALLY SUPPLIED BY
THE USER, not independently observed or verified by this session.** They are treated as real
evidence and correlated against the actual source code at this HEAD, but this report never
claims to have re-measured them itself. Every finding below is explicitly labeled:

- **CODE-CONFIRMED** — a mechanism that genuinely exists in the source, traced to exact
  file/function/line, that plausibly explains or is directly consistent with the supplied evidence.
- **EXTERNALLY SUPPLIED** — a number or observation from the user's own VPS session, not
  re-derived or re-measured here.
- **INFERRED/SUSPECTED** — a plausible connection between code and evidence that cannot be proven
  from static reading alone (would require live profiling/heap-snapshot access this session
  doesn't have).

---

## 1. Baseline (this session, local repository only — NOT the VPS)

- `git rev-parse HEAD`: `77f1cc0b421269134a2126d90caa4e2f078736dd`
- `git branch --show-current`: `security/reality-completion`
- Working tree: unchanged from this session's prior state (multiple pre-existing uncommitted
  files from this and concurrent sessions — none touched by this mission; see §9).
- **This session cannot record live PM2 status, live task-queue counts, or live Node/PM2
  runtime configuration from the actual production process** — it has no connection to it. The
  `ecosystem.config.cjs` memory-restart threshold (1536MB, matching the user-supplied "PM2 memory
  limit is 1536MB") was verified by direct **local file read**, not a live PM2 query.

---

## A. SELF-HEALING ESCALATION

### A.1 — Locate the exact source

`self_healing_escalation_ceiling` is produced by `backend/services/rootCauseAnalysisEngine.cjs`,
function `_rcaHealingCeiling()`, **lines 311–366**. Its own header comment (lines 303–309) states:

> "Evidence: 2,000 healing records, all strategy=escalate, all reason='max retries (3) exceeded'.
> 100% failure rate. The healing system only knows one strategy (escalate) and hits its ceiling
> every time. It heals nothing — it is itself broken."

**CODE-CONFIRMED.** This is a real function that reads `data/healing-history.json` (via its
caller — see A.2) and, if every record's `strategy` field equals the literal string `"escalate"`,
emits a `problemClass: "self_healing_escalation_ceiling"` finding with `confidence: 95` (line
340) — this exact number matches the user-supplied "confidence 95%."

### A.2 — Why ~2000 occurrences exist

`backend/services/selfHealingRuntime.cjs` line 74: `_save()` persists `_history.slice(-2000)` —
**the history file is a hard-capped rolling window of exactly 2000 records.** This session
directly read `data/healing-history.json` on local disk (this repo's own copy, not the VPS's —
see caveat below) and found it contains **exactly 2000 records**, spanning `2026-08-23T07:11:35Z`
to `2026-09-08T14:50:13Z`. The "~2000 occurrences" in both the user-supplied evidence and this
local file match the cap precisely — this is very likely simply the retention ceiling being
reported as if it were an incident count, not 2000 independent fresh failures in a short window.
**CODE-CONFIRMED for the mechanism (rolling 2000-cap); the VPS's own live file contents were not
read by this session — only this repo's local copy was, which may or may not be byte-identical
to the VPS's copy at the moment the user's evidence was captured.**

### A.3 — **CRITICAL DISCREPANCY: the "all strategy=escalate" premise does not hold against this
repository's own current code or its own local data file**

This is the single most important finding in this report:

1. **`backend/services/selfHealingRuntime.cjs`'s `selectStrategy()` function (lines 119–265,
   read in full) never returns the string `"escalate"` anywhere.** The literal string `"escalate"`
   does not appear anywhere in this 636-line file except inside comments describing the *old*
   RCA finding. The function's real strategy vocabulary, confirmed by direct read, is:
   `fail_fast`, `dead_letter`, `retry_with_backoff`, `park_task`, `operator_approval`,
   `circuit_reset_rec`, `delay_until_ready`, `reroute_capability` — an 8-way decision ladder
   (lines 152–261) that consults `engineeringRuleRegistry.classifyError()` (line 138) and the RCA
   engine's own active analyses (lines 145–158) before choosing.
2. **This repository's own local `data/healing-history.json` (2000 records, read directly this
   session) has ZERO records with `strategy: "escalate"`.** Its actual distribution:
   `dead_letter: 1226`, `native_runtime_heal: 624`, `retry_with_backoff: 150`. Applying
   `_rcaHealingCeiling()`'s own filter (`healing.every(h => h.strategy === "escalate")`) to this
   exact dataset evaluates to **`false`** — meaning, against this file, the function would not
   even produce the `self_healing_escalation_ceiling` finding today.
3. **The RCA's own `recommendedFix` text (lines 344–361) describes a strategy ladder — "(1) retry
   if transient, (2) decompose if complex, (3) park-to-DLQ if deterministic, (4) notify-operator
   if critical" and "classify the failure using engineeringRuleRegistry.classifyError()"** — that
   is essentially what `selectStrategy()` **already implements**, in more granular form, in the
   current codebase.

**CONFIRMED BY CODE: the `self_healing_escalation_ceiling` finding, as worded, describes
`selfHealingRuntime.cjs` behavior from BEFORE its multi-strategy ladder existed.** Whether the
VPS's own live `data/healing-history.json` currently contains 2000 real `strategy: "escalate"`
records (which would mean either an older code version is actually running there, or a different
code path than `selectStrategy()` writes `escalate` records) **cannot be determined from this
session** — this repo's local copy of that file does not support the RCA's premise, but this
session has no way to confirm the local file and the VPS's file are the same file at the same
point in time. **This is flagged as the report's single highest-value open question for the
next session with live VPS log/file access to resolve.**

### A.4 — Retry/escalation/dead-letter tracing, boundedness, dedup

- `selectStrategy()`'s `maxRetries` default is `MAX_AUTO_RETRIES` (a module constant near the top
  of the file) — **bounded**, not infinite.
- `dead_letter` strategy (chosen when `exhausted` is true and no rule matches, line 240) archives
  to `agents/runtime/deadLetterQueue.cjs` — a genuine terminal sink, not a re-injection loop.
- `_save()`'s `.slice(-2000)` cap (§A.2) bounds the history file's own growth — **it cannot grow
  unbounded on disk**, though older records are silently dropped, not archived elsewhere.
- No explicit deduplication was found in `_record()` (`selfHealingRuntime.cjs` line 76) — each
  call appends a new record regardless of whether an identical failure was just recorded. This is
  a real, minor gap (**CODE-CONFIRMED absence of dedup**), but is bounded by the 2000-cap either way.

### A.5 — Memory/timer/listener retention risk from retries

No `setInterval`/`setTimeout` handle is created inside `selectStrategy()`, `healTask()`, or
`healCycle()` themselves (confirmed by direct read, lines 119–460) — these are async functions
that `await` other modules' calls and return; they do not spawn their own long-lived timers.
**CODE-CONFIRMED: this specific file does not itself retain timers per retry.** Whatever it calls
into (`taskQueue`, `autonomousTaskLoop`, `runtimeOrchestrator`) may retain state — see §C.

**AREA A VERDICT: PASS/FAIL/INCONCLUSIVE = INCONCLUSIVE.** The specific finding
(`self_healing_escalation_ceiling`, "heals nothing") does not match current code behavior or this
repo's own local data — but this session cannot confirm what the VPS's live data file actually
contains right now, so this cannot be called definitively FAIL (bug confirmed absent) or PASS
(bug confirmed present) without that access.

**Severity if the VPS's live data does match the RCA's premise:** P2 (the healing system would be
consuming execution budget on unsuccessful retries, per the RCA's own reasoning, but is bounded by
the 2000-record cap and does not itself leak memory/timers).
**Severity if — as this session's evidence suggests — the RCA is stale:** P3 (a reporting/staleness
issue in the RCA engine's own analysis, not a runtime defect) — worth noting the RCA engine
apparently does not re-validate whether an "active" finding still matches current data before
continuing to report it as `confidence: 95%`.

**Minimal remediation recommendation:** Before acting on this finding, have someone with live VPS
access run `node -e "const d=JSON.parse(require('fs').readFileSync('data/healing-history.json')); console.log(d.filter(h=>h.strategy==='escalate').length, 'of', d.length)"` directly on the VPS and
compare against this repo's local copy. If the VPS's data genuinely differs from this repo's, that
itself is a separate, real finding (deployed code differs from this branch, or historical data
predates a since-shipped fix) worth its own investigation — not fixed here, per this mission's
forensics-only scope.

---

## B. AUTOLOOP / TASK EXECUTION

### B.1 — Scheduling and lifecycle

The real "AutoLoop" is `agents/autonomousLoop.cjs` (375 lines, read in full) — its own log tag is
literally `[AutoLoop]`, matching the user-supplied evidence exactly. **Line 32:
`const POLL_MS = 10_000;`** — this is the exact source of "AutoLoop: task execution every 10
seconds." **CODE-CONFIRMED, exact match.**

`_tick()` (lines 350–384) is the per-poll function, invoked by `setInterval(..., POLL_MS)` at line
441 (`_startInterval()`).

### B.2 — Overlap protection (concurrency)

**Two independent, already-implemented guards exist, both CODE-CONFIRMED:**

1. **`_dispatching` boolean flag** (line 53, checked at line 351: `if (_dispatching) return;`) —
   prevents `_tick()` from re-entering while a previous tick's dispatch loop is still awaiting.
   Set at line 362, cleared in a `finally` block at line 382 — correctly cleared even on error.
2. **`_cronInFlight` Set** (line 31) — a **second**, independent guard for `node-cron`-scheduled
   recurring tasks specifically, because (per the file's own comment, lines 17–30) `cron.schedule()`'s
   own callback fires on its own timer regardless of whether a *previous* fire for the *same
   task.id* is still running — the `_dispatching` flag alone does not cover this case, since
   `_tick()`'s regular poll and a task's own `recurringCron` fire are two different call paths.
   The comment explicitly documents this was a **previously real, live-reproduced bug** ("Live-
   reproduced with the real node-cron dependency... maxConcurrent 2, both invocations writing
   taskQueue.update(task.id,...) concurrently"), fixed by reusing the exact in-flight-Set pattern
   already used elsewhere (`browserScheduler._inFlight`, `contentScheduler._processingIds`).

**CODE-CONFIRMED: the specific overlap bug class this mission asks about was already found and
fixed in this file, with the fix present and correct at this HEAD.**

### B.3 — Concurrency limits, stale-task handling, retry budgets, dead-letter

- **`MAX_TASKS_PER_TICK = 20`** (line 46) — bounds how many due tasks one tick will process,
  with an explicit, documented history: a comment (lines 35–45) describes a **previously real
  incident** — "a real backlog of 359 simultaneously-overdue tasks... made a single `_tick()` run
  every one of them sequentially... sustained 100%+ CPU and an unresponsive server for minutes per
  tick" — and this cap was added as defense-in-depth. **CODE-CONFIRMED, already remediated.**
- **`STUCK_AGE_HOURS = 2`** (line 34) drives `taskQueue.abandonStuckTasks(STUCK_AGE_HOURS)`,
  called at the top of every `_tick()` (line 365) — this is the exact mechanism producing the
  user-supplied "TaskQueue: 2 stuck tasks older than 2h were abandoned." **CODE-CONFIRMED, exact
  match** (`agents/taskQueue.cjs` lines 316–341, sets `status: "failed"` — a genuine terminal
  state, not a silent drop).
- **Retry budget:** `maxRetries` default 3 (line 262: `retries >= (task.maxRetries || 3)`), linear
  backoff `(task.retryDelay || 15000) * retries` (line 261) — **bounded, matches the "3 max
  retries" figure implied by the RCA evidence's "max retries (3) exceeded."**
- **Bridge from "abandoned/failed" to "re-queued":** `abandonStuckTasks()` sets a task's status to
  the terminal `"failed"`, not directly back to pending. The user-supplied evidence's "abandoned
  tasks were re-queued using retry_with_backoff" is consistent with a **separate** mechanism —
  `selfHealingRuntime.cjs`'s `_detectFailedTasks()` (line 299) — picking up `"failed"` tasks
  independently and calling `healTask()`, which (per §A.3) defaults to `retry_with_backoff` when
  no classification rule matches (line 130: `"No rule matched; defaulting to retry_with_backoff
  for unknown errors"`). **CODE-CONFIRMED as a plausible, consistent chain** (abandon → failed →
  self-heal detects failed → no rule matches → retry_with_backoff → re-queued → AutoLoop's next
  10s tick picks it up) — this exact sequence was not traced end-to-end in one single function
  call, so labeled **INFERRED/SUSPECTED for the precise handoff**, though each individual link is
  CODE-CONFIRMED.

### B.4 — Can the 10s cadence amplify work?

**No amplification mechanism found.** Each tick processes at most `MAX_TASKS_PER_TICK` (20) tasks,
`_dispatching` prevents tick pile-up, and `_cronInFlight` prevents per-task cron overlap. A short
poll interval alone does not cause amplification when the dispatch itself is properly gated, which
it is here. **CODE-CONFIRMED: no overlap/amplification defect found in this file.**

### B.5 — Self-healing counters on repeated tick errors

`_consecutiveTickErrors` / `MAX_CONSECUTIVE_ERRORS = 5` (lines 49–50, 444–452): if 5 consecutive
ticks throw, `_startInterval()` is called again to "self-heal" by clearing and recreating the
interval. **Note (INFERRED/SUSPECTED, minor):** `_startInterval()` calls `clearInterval` on the
old handle before creating a new one (line 440), so this does not itself leak a handle — but it
does mean 5 consecutive failures is treated as a reason to restart the loop's own timer rather
than surface a harder failure signal; not a memory-retention risk, but worth noting as a
design choice, not a defect.

**AREA B VERDICT: PASS.** Both known overlap-risk mechanisms (regular tick vs. tick, and cron-fire
vs. cron-fire for the same task) have real, correct, already-implemented guards. No CONFIRMED
amplification or unbounded-growth path found in this file.

---

## C. MEMORY / ACTIVE-HANDLE PRESSURE

### C.1 — DriftMonitor: what it measures vs. what it explains

`agents/runtime/driftMonitor.cjs` (218 lines, read in full) is the exact source of the user-
supplied `[DriftMonitor]` log lines. **Exact, line-level matches, CODE-CONFIRMED:**
- `TIMER_DRIFT_WARN = 200` (line 25) — matches "warning threshold 200" precisely.
- `HEAP_DRIFT_MB = 80` (line 24) — the alert fires when heap grows >80MB over baseline; the
  user-supplied "+255.5MB since baseline" is well above this threshold, consistent with a real
  fired alert (message format at line 94: `` `heap +${heapDrift}MB since baseline (now
  ${snap.heapMb}MB)` `` — matches the supplied log text pattern exactly).
- Sampling cadence: `SAMPLE_MS = 30_000` (line 21) — every 30s, `_sample()` reads
  `process._getActiveHandles?.().length` (line 54) directly — this is the literal Node.js
  internal API returning the real active-handle count; **1618–1620 is a real Node runtime number
  if the VPS process is genuinely reporting it, not something DriftMonitor itself fabricates or
  inflates.**

**Critical limitation, CODE-CONFIRMED by direct read of the whole file:** DriftMonitor is
explicitly, by its own header comment, **"passive — no patching, no monkey-patching."** It counts
handles and heap size and fires threshold alerts; **it has no code anywhere that identifies WHAT
TYPE of handle (timer vs socket vs file descriptor vs child process) is contributing to the
1618–1620 count, and no code that attributes heap growth to a specific subsystem.** This is a real,
CODE-CONFIRMED reporting gap in the monitor itself — it can tell you *that* there's pressure, never
*what* is causing it, from its own code alone.

### C.2 — What could plausibly hold ~1600+ active handles (INFERRED/SUSPECTED — cannot be proven
without a live heap snapshot or `process._getActiveHandles()` dump from the actual VPS process)

Candidates found by static reading, none individually proven to be THE cause:
- `agents/autonomousLoop.cjs`'s `_cronJobs` object (line 16) holds one live `cron.ScheduledTask`
  handle per registered recurring task, for the lifetime of the process — if many recurring tasks
  exist, this is a real, cumulative (though intentional, not leaked) handle source. **Bounded by
  however many `recurringCron` tasks actually exist** — not unbounded by this file's own logic,
  but this session cannot enumerate how many exist on the live VPS's `data/tasks.json`.
- `backend/services/backgroundRuntime.cjs`'s 6 named observers (lines 48–55) each register their
  own `setInterval` (line 555, a single generic registration point iterating `INTERVALS`) — 6
  long-lived handles, fixed, not per-request, **not a growth source** by design.
- `agents/runtime/runtimeEventBus.cjs` (from earlier phases' own reports, confirmed real) runs its
  own periodic tickers (telemetry every 10s, heartbeat every 30s, per that file's own header) plus
  potentially many `.subscribe()`-registered SSE client connections — **each live SSE connection
  is itself a long-lived socket/handle** for as long as a browser tab stays open; this is the most
  plausible single largest contributor to a high active-handle count in a long-running server, but
  this session has no way to confirm how many SSE clients were connected on the VPS at sample time.
- **INFERRED/SUSPECTED, not confirmed:** the AI provider fallback chain (§D) creates one HTTP
  request object per provider attempt in a failure cascade — these are normally short-lived and
  released on completion/timeout, but if a provider's underlying HTTP client (e.g. `axios`/`http`
  agent keep-alive pooling) is configured with persistent connections, a burst of many distinct
  failing providers being tried repeatedly (once per failing task, potentially several times if
  `_isRetryable` triggers `_withRetry`'s one extra attempt) could plausibly contribute transient
  handle pressure that DriftMonitor's 30s sampling could catch mid-spike. **This is a plausible
  hypothesis only — no code was found that proves a leak (i.e., a request that is never
  cleaned up); confirming or ruling this out requires live process inspection this session lacks.**

### C.3 — Duplicated initialization after restart

Not directly checkable without live restart-log access. `agents/autonomousLoop.cjs`'s `start()`
(line 419) has an idempotency guard (`if (_running) return;`, line 420) preventing double-start
within one process — this guards against the same process calling `start()` twice, but says
nothing about a genuine PM2-level process restart (a fresh Node process has fresh module state
regardless). **No CODE-CONFIRMED duplicated-registration defect found; not fully checkable from
static reading alone.**

**AREA C VERDICT: INCONCLUSIVE.** DriftMonitor's own alert thresholds and log format are
CODE-CONFIRMED to be the real source of the supplied evidence. The underlying cause of the
1618–1620 active-handle count and the +255.5MB heap drift cannot be attributed to a single,
proven code path from static analysis alone — several plausible contributors were identified
(recurring cron jobs, background observers, SSE connections, AI-fallback HTTP requests) but none
confirmed or ruled out without live process inspection.

**Severity: P1 (suspected only)** — sustained heap growth and 8x-over-threshold active-handle
count are the classic signature of a real leak, but this session cannot confirm it is progressive
(the user's own 6-sample observation window showed memory fluctuating 570→799→714→751→753→756MB,
**not monotonically increasing** — the user's own conclusion, stated in the supplied evidence, is
correct: "this does NOT prove a memory leak"). Recorded as P1-suspected rather than P0-confirmed.

**Minimal remediation recommendation:** Add handle-type attribution to `driftMonitor.cjs`'s
`_sample()` — `process._getActiveHandles()` returns actual handle objects, which can be
constructor-name-classified (Socket, Timeout, ChildProcess, etc.) cheaply, giving DriftMonitor the
ability to report a real breakdown (e.g. "1400 Sockets, 150 Timeouts, ...") instead of only a
total count. This is a small, additive, low-risk change to the *monitor itself* — not a fix to
whatever is actually holding the handles, which cannot be identified until that breakdown exists.
Recommend as a **separate, narrowly-scoped follow-on mission**, not performed here (forensics-only
scope).

---

## D. AI FAILURE / TIMEOUT AMPLIFICATION

### D.1 — Fallback/retry/timeout path

`backend/services/aiService.js`, function `callAI()` (lines 628–675, read in full):

- `_providerOrder()` (lines 194–210) returns up to **14 providers** in sequence when
  `LLM_PROVIDER` is unset (`groq, openrouter, openai, claude, gemini, ollama, deepseek, together,
  fireworks, cohere, nvidia, lmstudio, grok, qwen` — line 196), filtered to configured-only via
  `_isUnconfigured()`, but **never empty** by explicit design (comment lines 202–208: local
  providers `ollama`/`lmstudio` are never key-gated, so the list always has entries even with zero
  API keys set — "the guard stays as a correctness backstop").
- **Execution is strictly sequential**, `for (const provider of providers) { ... await ... }`
  (line 637) — **CODE-CONFIRMED: no parallel fan-out of simultaneous provider requests.**
- **`CALL_AI_OVERALL_BUDGET_MS = 28_000`** (line 626, explicit comment: "stays under
  autonomousLoop.cjs's 30s TASK_TIMEOUT_MS") — a real, deliberate, cross-file-coordinated time
  budget: the loop checks elapsed time before trying each next provider (line 638) and breaks
  early if the budget is exhausted, rather than trying all 14 regardless of elapsed time.
  **CODE-CONFIRMED: bounded overall duration, intentionally coordinated with AutoLoop's own
  per-task timeout.**
- Per-provider timeouts (lines 213–228) range 20-30s each — but the overall 28s budget check
  means, in practice, at most 1-2 providers are actually attempted per call before the budget
  trips, not all 14 sequentially (14 × 20-30s would be 280-420s, far exceeding the 28s budget).

### D.2 — Retry classification

`_isRetryable()` (lines 231–239) retries only on `ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`/
`ENOTFOUND` or HTTP 429/503 — **explicitly excludes 4xx auth errors** (comment: "Do NOT retry 4xx
auth errors"). `_withRetry()` (lines 241–248) performs **exactly one** extra attempt after an
800ms delay — **bounded, not a retry loop.** **CODE-CONFIRMED: retry logic here is deliberately
narrow and single-shot, not a source of amplification.**

### D.3 — Failure → task-retry interaction

`callAI()` never throws on total failure — it returns the literal string `"AI backend
unavailable. Check provider API keys in your .env file."` (line 674) as a **successful-looking
return value**, not a rejected promise. This means a caller checking only "did the promise
resolve" would see success; whether this propagates correctly as a *task* failure depends on the
caller — `agents/autonomousLoop.cjs`'s `_runTask()` (§B, lines 203-213) explicitly checks
`result.success === false` from executor results, which is a **different** signal path than
`callAI()`'s own return value. **INFERRED/SUSPECTED (not fully traced end-to-end this mission,
scope-limited to the 5 areas named):** whether every caller of `callAI()` correctly detects the
"AI backend unavailable" sentinel string as a failure (vs. treating it as a valid AI response to
show the user) was not exhaustively checked across all call sites — flagged as worth a dedicated,
separate check, not confirmed as a defect here.

### D.4 — node-cron missed execution

The user-supplied evidence ("node-cron reported a missed execution and suggested possible blocking
IO/high CPU") is consistent with — but not proven to be caused by — the AI fallback chain: if a
`recurringCron` task's handler is itself an AI-calling task and the event loop is blocked for the
`callAI()` call's duration (up to 28s per the budget), a very short cron interval (sub-30s) could
plausibly miss its next scheduled fire. **INFERRED/SUSPECTED only** — no direct code-level proof
that this specific interaction caused the specific missed-execution event referenced in the
evidence; `node-cron`'s own missed-execution detection is a library-internal behavior, not
something this repository's code implements or controls.

**AREA D VERDICT: PASS** for amplification risk specifically (sequential execution + hard overall
budget + single-shot narrow retry = no confirmed amplification path). **INCONCLUSIVE** for the
node-cron miss's exact cause (plausible but unproven correlation to AI-call blocking).

**Severity: P2** (bounded, but a 28s worst-case blocking call inside a 10s-cadence system is a
real design tension worth noting even though it's not unbounded).

**Minimal remediation recommendation:** none required for amplification (already bounded). If the
node-cron miss recurs, consider whether `callAI()`-driven recurring tasks should run on a longer
minimum cron interval than 30s, or whether `callAI()` calls from cron-driven tasks should be
dispatched off the main tick path — not implemented here, forensics-only scope.

---

## Summary table

| Area | Verdict | Confirmed root cause? | Severity | Blocker? |
|---|---|---|---|---|
| A. Self-healing escalation | INCONCLUSIVE | No — RCA premise contradicted by this repo's own current code and local data; VPS's live data not accessible to confirm/deny | P2 (if VPS data matches RCA) / P3 (if RCA is stale) | No |
| B. AutoLoop scheduling/concurrency | PASS | N/A — no defect found; both known overlap classes already fixed | N/A | No |
| C. Memory/active-handle pressure | INCONCLUSIVE | No — DriftMonitor confirms symptom, not cause; multiple plausible contributors, none proven | P1 (suspected) | Not yet — needs live confirmation |
| D. AI failure/timeout amplification | PASS (amplification) / INCONCLUSIVE (cron-miss cause) | No amplification path found; cron-miss correlation unproven | P2 | No |

---

## CONFIRMED vs. SUSPECTED — explicit final list

**CONFIRMED BY CODE:**
- AutoLoop's 10s poll cadence, its `_dispatching` and `_cronInFlight` overlap guards, its
  `MAX_TASKS_PER_TICK=20` cap, and its `STUCK_AGE_HOURS=2` abandon mechanism all exist exactly as
  the evidence describes, and are already correctly bounded.
- `selfHealingRuntime.cjs`'s current `selectStrategy()` has 8 real strategies, not 1, and never
  produces `"escalate"` — directly contradicting the `self_healing_escalation_ceiling` RCA
  finding's premise as applied to this repository's current code.
- This repo's own local `data/healing-history.json` (2000 records) has zero `"escalate"` entries.
- `aiService.js`'s provider fallback is sequential, budget-capped at 28s total, with narrow
  single-shot retry — no amplification mechanism.
- DriftMonitor's thresholds (200 handles, 80MB heap drift, 400MB EventBus degraded-mode) match
  the supplied log lines exactly, confirming these are the real alert sources — but DriftMonitor
  itself cannot attribute cause.

**SUSPECTED / UNPROVEN:**
- What is actually holding ~1618-1620 active handles (several plausible candidates, none confirmed).
- Whether every `callAI()` caller correctly treats the "AI backend unavailable" string as failure.
- Whether the node-cron missed-execution event was actually caused by an AI-call blocking the
  event loop, vs. some other cause.
- Whether the VPS's *live* `data/healing-history.json` actually matches this repo's local copy
  (the single most important open question for resolving Area A definitively).

---

## ERA-1 production blocker?

**No hard P0 blocker was CONFIRMED by this static analysis.** The most concerning individual
datapoint (2000 `self_healing_escalation_ceiling` occurrences at 95% confidence) does not survive
direct code/data correlation against this repository's current state — it appears to describe
prior, already-superseded behavior, not a live-confirmed current defect. The active-handle/heap
pressure (Area C) is a genuine, unresolved open question that deserves live follow-up before ERA-1
production certification, but the user's own 6-sample observation (memory fluctuating, not
monotonically climbing, zero additional restarts during observation) is itself evidence against an
active, fast-acting leak — consistent with either a slow leak needing a longer observation window,
or normal GC-driven fluctuation under load, neither of which this session can distinguish.

## Should remediation be a separate controlled mission?

**Yes, for two specific, narrow items — do NOT bundle them with unrelated work:**
1. **Live-vs-local `data/healing-history.json` reconciliation** (resolves Area A definitively) —
   a read-only diagnostic mission, no code change needed unless the discrepancy turns out to be real.
2. **DriftMonitor handle-type attribution** (§C.2 remediation) — a small, additive, low-risk
   enhancement to `driftMonitor.cjs` only, to turn "1618 handles, cause unknown" into an
   actionable breakdown. This should be scoped, reviewed, and tested independently — not
   implemented as a side effect of this forensics-only mission.

---

## Git / concurrent-work state

- HEAD: `77f1cc0b421269134a2126d90caa4e2f078736dd` — unchanged.
- Branch: `security/reality-completion` — unchanged.
- P1-1 (`backend/services/agentRuntimeSupervisor.cjs`) diff vs `7c229a52`: unchanged (not
  re-measured by this specific report beyond confirming the file was not opened for writing —
  this mission never touched it).
- No file was created, modified, or deleted by this mission other than this report.
- No commit, push, merge, reset, rebase, or stash performed.
- No PM2 restart, process stop/start, `.env` change, or external provider contact was performed.
- All concurrent-session files (including `reports/OOPLIX-380-MASTER-COVERAGE-MATRIX.md`,
  `reports/OOPLIX-380-STRATEGIC-BUILD-ORDER.md`, and every file from the Phase 1–6 / ERA-1 mission
  series) were not read for modification and remain exactly as this session found them.

**Deploy: NOT PERFORMED. Restart: NOT PERFORMED.**
