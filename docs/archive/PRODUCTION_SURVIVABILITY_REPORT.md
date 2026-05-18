> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# PRODUCTION SURVIVABILITY REPORT
Final Production Sanity Audit — Single VPS Solo Operator  
Date: 2026-05-16

---

## Scope

This report covers operational survivability only: crash loops, memory leaks, async hazards, orphan processes, queue starvation, SSE connection leaks, autonomous execution risks, and graceful shutdown fidelity.

No new features. No architectural changes. Findings only.

---

## 1. CRASH LOOP RISKS

### 1.1 EADDRINUSE — Handled Correctly
`uncaughtException` handler explicitly detects `EADDRINUSE` and exits with code 1, printing the lsof command. PM2 restart on a port-conflict loop is prevented by the explicit `process.exit(1)` + clear log message. This is done correctly.

### 1.2 Telegram Polling 401 / 409 — Handled Correctly
The Telegram bot catches polling errors and disables itself (logs, no crash). A 401 (bad token) stops polling; a 409 (conflicting bot instance) throttles to one log per 5 minutes. No crash loop.

### 1.3 autonomousLoop Self-Healing Interval — Real Risk
If `_tick()` throws 5 consecutive times, the loop calls `_startInterval()` on itself — which clears and recreates the `setInterval`. This means on 5 consecutive errors, the interval is destroyed and recreated. Each recreation loses `_consecutiveTickErrors = 0`, so the counter resets correctly. This is safe. However: if the error source is persistent (e.g., disk full, corrupted task queue), the loop will self-heal in a tight 5-failure → restart → 5-failure cycle. Each cycle takes `5 × POLL_MS = 50s`. Not a crash loop, but a persistent error cycle that will log loudly and show up in `errTracker`.

### 1.4 Uncaught Exception → PM2 Restart
`uncaughtException` handler: records the error, logs, then `setTimeout(() => process.exit(1), 200)`. PM2 will restart. This is correct behavior — state is unknown after an uncaught exception, clean restart is the right call. **Risk**: if a module throws on `require()` at startup (e.g., malformed JSON in data file), PM2 will restart loop indefinitely. The only data files loaded at startup are `data/tasks.json` (taskQueue) and `data/leads.json` (CRM). Both use try/catch with fallback to empty arrays. This is handled.

### 1.5 Unhandled Promise Rejection — Logged, Not Fatal
`unhandledRejection` handler logs and continues. This is appropriate for a single-server operator tool. The risk is silent state corruption if the rejection was from a critical operation. Currently, all major async operations are wrapped in try/catch with explicit error returns, so this is a backstop, not a primary handler.

---

## 2. MEMORY LEAK RISKS

### 2.1 CONFIRMED LEAK: Adapter Receipt Maps (Medium — Days to Weeks)

**Files:** `terminalExecutionAdapter.cjs`, `filesystemExecutionAdapter.cjs`, `gitExecutionAdapter.cjs`

Each adapter maintains a `_receipts = new Map()` that stores the execution result (stdout, stderr, status, timing) for every command ever run. There is NO size cap, NO eviction, and `reset()` is only called in tests.

**Impact:** At 100 terminal executions per day, after 30 days:
- 3,000 receipt entries
- Average receipt size: ~2KB (small commands) to ~50KB (verbose git logs)
- Estimated range: 6MB–150MB of in-process heap

This will be visible as a slow upward heap drift over days/weeks. The `/runtime/health/deep` endpoint reports heap; `GET /ops` shows the trend. The memory leak will NOT cause OOM on a typical 1–2GB VPS within a month of solo operator use, but should be fixed before sustained production deployment.

**Fix (not implemented — design only):** Cap the Map at 1000 entries; evict oldest on overflow.

### 2.2 CONFIRMED LEAK: processLifecycleAdapter Process Map (Low)

**File:** `processLifecycleAdapter.cjs`

`deregisterProcess()` marks entries as `alive: false` but never deletes them from `_processes`. The Map grows to `MAX_TRACKED = 500` entries and then `registerProcess()` returns `{ registered: false, reason: "tracking_limit_reached" }`. After 500 total child process spawns, process tracking silently fails. The processes still execute normally — they're just not tracked.

`cleanupOrphans()` is defined but never called in production code. No scheduled cleanup.

**Impact:** After 500 terminal/git executions (hours to days of production use), process tracking breaks silently. Orphan detection stops working. Commands still run.

**Fix (not implemented):** Call `cleanupOrphans()` periodically (e.g., every 100 executions, or on a 5-minute interval).

### 2.3 Memory-Indexed Data Files (Low — Bounded)

| File | Size Now | Bound |
|------|----------|-------|
| `data/memory-store.json` | 168KB | Capped at 500 entries (enforced) |
| `data/memory-index.json` | 191KB | Capped at 500 entries (enforced) |
| `data/feedback-loop.json` | 29KB | Capped at 1000 records (enforced) |
| `data/learning.json` | 86KB | No explicit cap found |
| `data/learning-patterns.json` | 36KB | Unknown |

`data/learning.json` and `data/learning-patterns.json` do not appear to have eviction logic reviewed in this audit. Monitor their growth over time. At current sizes they are not a concern.

### 2.4 _withTimeout Timer Not Cleared (Negligible)

`autonomousLoop._withTimeout()` uses `Promise.race()` with an inner `setTimeout`. If the task resolves before the timeout, the timer is not cleared — it fires 30s later and attempts to reject an already-settled Promise (Node.js no-op). The timer holds a closure reference until it fires. With `TASK_TIMEOUT_MS = 30_000` and tasks processing serially, at most one stale timer exists at any time. Negligible.

---

## 3. UNHANDLED PROMISE REJECTIONS

All major async paths are wrapped:
- `autonomousLoop._tick()` — fully try/caught; errors increment `_consecutiveTickErrors`
- `runtimeOrchestrator.dispatch()` — uses `Promise.allSettled()`, rejections become settled failures
- `executionEngine.executeTask()` — try/catch with dead-letter push on final failure
- `safeExec.run()` — Promise never rejects; errors resolve to `{ ok: false }`
- `terminalExecutionAdapter.execute()` — Promise never rejects; errors resolve to receipt with status "failed"

**Gap:** `runtimeOrchestrator._drainRef` interval runs `async () => { if (pq.size() > 0) await drainQueue(); }` without a `.catch()`. If `drainQueue()` throws an unhandled exception, it becomes an unhandled promise rejection (logged but not fatal). `drainQueue()` internally wraps its dispatch in a try/catch, so this path is safe in practice.

---

## 4. ASYNC DEADLOCKS

**No deadlocks identified.** Analysis:

- `autonomousLoop._tick()` has a `_dispatching` depth guard — re-entry is prevented. Tasks are processed serially (one at a time via `for...of await`).
- `runtimeOrchestrator.dispatch()` uses `Promise.allSettled()` — all subtasks run in parallel without waiting on each other, so no circular wait.
- `executionEngine.executeTask()` has a retry loop (up to 3 attempts) with sequential execution — no concurrent access to shared state that could deadlock.
- `priorityQueue.enqueue/dequeue` is synchronous — no async operations, no deadlock possible.

---

## 5. ORPHAN CHILD PROCESS RISKS

**Partially handled.** Analysis:

- `safeExec.js`: On timeout, sends `SIGKILL` to the process GROUP (`process.kill(-child.pid, "SIGKILL")`). This kills child processes spawned by the command. Correct.
- `terminalExecutionAdapter.cjs`: On timeout, sends `SIGTERM` to the child only (`child.kill("SIGTERM")`). Does NOT kill the process group. If `git fetch` (hypothetically, not in allowlist) spawned SSH processes, those would be orphaned. In practice, the allowlisted commands (echo, ls, node, npm, git) do not spawn persistent child processes, so this is low risk.
- `processLifecycleAdapter.cleanupOrphans()` is never called, so TTL-expired processes aren't automatically killed.

**Real-world risk:** A `git status` that spawns a subprocess (e.g., .gitconfig `post-index-change` hook) could orphan. Mitigated by `DEFAULT_TIMEOUT_MS = 15s` which will SIGTERM the parent.

---

## 6. QUEUE STARVATION SCENARIOS

### 6.1 Priority Queue (runtimeOrchestrator) — Low Risk
The `priorityQueue` is in-memory, sorted by priority. The drain loop runs every 5s. If a HIGH priority item is continuously enqueued, LOW items wait indefinitely. With a single operator, the queue depth is bounded by operator behavior. No starvation mechanism is enforced — this is acceptable for a single-user tool.

### 6.2 Disk Queue (autonomousLoop) — Low Risk
The `taskQueue` processes one task at a time (`_dispatching` depth guard). Slow tasks (up to 30s) block subsequent tasks. If a `recurringCron` task runs every minute and takes 30s, it occupies the loop 50% of the time. All other queued tasks are deferred until it completes.

**Queue starvation scenario:** 5 recurring cron tasks, each 30s execution time, all scheduled to run simultaneously → 2.5 minutes of queue blocking for any new task.

Mitigation: cron tasks default `maxRetries = 3` and are abandoned as "stuck" after `STUCK_AGE_HOURS = 2`.

---

## 7. SSE CONNECTION LEAK RISKS

**Well handled.** Analysis of `runtimeStream.cjs`:

- Hard cap: `MAX_SSE = 10` concurrent connections. Exceeding returns 429.
- Cleanup registered on `req.close`, `req.error`, `res.error`, `res.finish` — 4-way coverage.
- Cleanup is idempotent (guarded by `_cleaned` flag) — double-cleanup is safe.
- Ping timer: `pingRef.unref()` — won't prevent process exit.
- If `res.write` throws (client disconnected), the EventBus auto-removes the subscriber.
- The `_active` counter is protected by `Math.max(0, _active - 1)` — won't go negative.

**Minor gap:** JWT expiry warning timer (`_expiryWarnTimer`) is added to the cleanup function — correctly cleared on disconnect. Good.

**Gap identified:** SSE connections from unauthenticated requests — the route IS protected by `router.use("/runtime", requireAuth)` mounted before the stream router in `routes/index.js`. Confirmed safe.

**Real-world risk:** If a reverse proxy (nginx) closes idle connections without sending a FIN/RST (e.g., proxy_read_timeout), the server-side `req.close` event may not fire. The ping mechanism (20s keep-alive) prevents nginx from closing the connection, but if nginx is misconfigured with a <20s timeout, connections will leak. The cap of 10 limits blast radius.

---

## 8. GRACEFUL SHUTDOWN GAPS

**What is stopped on SIGTERM:**
1. HTTP server (stops accepting new connections)
2. autonomousLoop (clears interval)
3. automation engine (stops cron jobs)
4. memoryTracker (stops interval)
5. runtimeEventBus (clears intervals, unsubscribes all)

**What is NOT stopped:**
- `runtimeOrchestrator._drainRef` interval — continues draining the priorityQueue after shutdown
- `rateLimiter` interval (cleanup interval) — `.unref()` so it doesn't prevent exit
- Active child processes — SIGTERMed by 15s timeout, but if shutdown takes less than 15s, they may be mid-execution

**Impact of _drainRef not being stopped:** During the 5s shutdown grace period, the drain loop could pick up and start executing new tasks from the priority queue. This is harmless for the grace-period use case, but means dispatch() could be called after the HTTP server has stopped accepting connections. The executed results would be discarded.

**5s grace period is adequate** for the current workload. Git/terminal commands complete in <1s; only long-running npm commands (~30s) could be interrupted. These would be abandoned mid-execution, leaving the output incomplete. No data corruption risk.

---

## 9. AUTONOMOUS EXECUTION RISKS

### 9.1 Self-Trigger Recursion — Bounded
The executor's `task_queue` handler enqueues tasks into `autonomousLoop.addTask()`. A task could enqueue itself (e.g., `input: "schedule: repeat this every minute"`). The planner would route this back to `task_queue` type, which calls `addTask` again. If the newly queued task also has `recurringCron`, it gets a cron job. If it does NOT have `recurringCron`, it gets `status: "pending"` and runs once. Self-triggering without `recurringCron` is bounded.

Self-triggering WITH `recurringCron` creates a new cron job each time. If a recurring task queues another recurring task on every execution, the `_cronJobs` Map and node-cron jobs grow without bound. Mitigated by the emergency stop governor.

### 9.2 Infinite Retry Loop — Bounded
Tasks retry up to `maxRetries = 3` (default) with linear back-off (`delay = retryDelay * retryCount`). After 3 failures, task is marked `"failed"`. The `_failureTracker` emits a loud warning at 3 failures. This is correctly bounded.

### 9.3 Runaway Automation
The automation engine (`automationService.js`) runs follow-up, onboarding, and upsell cron jobs. These call `wa.sendMessage()` internally. If WhatsApp credentials are misconfigured, each cron tick will log failures — no crash, no runaway.

### 9.4 Emergency Stop Coverage
Emergency stop blocks:
- `runtimeOrchestrator.dispatch()` (checked at entry)
- `autonomousLoop._tick()` (checked at entry)

Emergency stop does NOT block:
- `automation engine` cron jobs (automationService.js)
- `Telegram bot polling`
- `rateLimiter` maintenance interval
- In-flight processes already spawned

For the intended use case (stop runaway dispatch/queue), coverage is sufficient.

---

## 10. TOP 10 REALISTIC FAILURE SCENARIOS

| # | Scenario | Probability | Severity | Mitigation |
|---|----------|-------------|----------|------------|
| 1 | **`_receipts` Map OOM after 30+ days** | High (will happen eventually) | Medium (gradual, predictable) | Cap Maps at 1000 entries; monitor heap via `/runtime/health/deep` weekly |
| 2 | **`processLifecycleAdapter` hits 500-entry limit, tracking fails silently** | High (after days of use) | Low (tracking breaks, commands still run) | Call `cleanupOrphans()` on a 5-min interval |
| 3 | **Disk full from `execution.ndjson` growth** | Medium (weeks-months) | High (server stops writing, potential crash) | Set up logrotate; monitor `/data/logs/` size |
| 4 | **PM2 restart loop if startup data file is corrupted** | Low | High (server stays down) | All data file reads use try/catch with fallback; low risk in practice |
| 5 | **Emergency stop doesn't survive PM2 restart** | Medium | Medium (runaway re-emerges after restart) | Persist governor state to disk — not currently implemented |
| 6 | **autonomousLoop 5-error restart cycle obscures root cause** | Low-Medium | Medium (silent failure loop) | Check `GET /ops?debug=1` errors_per_hour |
| 7 | **Recurring cron task queues more recurring tasks (explosion)** | Low | High (CPU + queue saturation) | Emergency stop; audit queued tasks via `GET /runtime/status` |
| 8 | **SSE connection leak if nginx proxy_read_timeout < 20s** | Low (config error) | Low (capped at 10 connections) | Ensure nginx `proxy_read_timeout >= 120s` |
| 9 | **Graceful shutdown truncates long-running npm/node commands** | Low | Low (operator can retry) | Acceptable; 5s grace period is intentional |
| 10 | **node -e arbitrary code execution by compromised operator account** | Very Low (requires auth bypass) | Critical | Rotate JWT_SECRET immediately if auth is compromised |

---

## 11. READINESS BY USE CASE

| Use Case | Safe? | Blocking Issues |
|----------|-------|-----------------|
| Personal use (1 operator, low frequency) | **YES** | None blocking |
| Internal operator use (1 operator, daily use) | **YES** | Monitor heap drift; set up log rotation before week 2 |
| 10 users (multiple operators) | **NO** | Rate limiter keyed by IP (not by user); receipt Map leak scales with usage; no per-user session isolation |
| 100 users | **NO** | Architecture not designed for this — in-memory queues, single-process, no horizontal scaling |
