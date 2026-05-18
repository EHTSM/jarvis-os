> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# FAILURE RECOVERY REPORT
Final Production Sanity Audit — Single VPS Solo Operator  
Date: 2026-05-16

---

## 1. GRACEFUL SHUTDOWN

### What Happens on SIGTERM (PM2 stop) or SIGINT (Ctrl+C)

```
SIGTERM received
→ _gracefulShutdown("SIGTERM")
    1. HTTP server: stops accepting new connections (existing connections drain)
    2. autonomousLoop: clearInterval — no more tick fires
    3. automation engine: stops cron jobs
    4. memoryTracker: stops sampling interval
    5. runtimeEventBus: clearInterval on telemetry/heartbeat, clears all subscribers
    6. setTimeout(process.exit(0), 5000) — hard exit after 5s grace period
```

### What Is NOT Stopped

| Component | Behavior After SIGTERM |
|-----------|----------------------|
| `runtimeOrchestrator._drainRef` interval | Continues for up to 5s, may drain one more queue item |
| In-flight `safeExec.run()` child processes | Continue executing until their own 15s timeout kills them |
| Telegram bot polling | Stops when process exits; no explicit cleanup |
| `rateLimiter` cleanup interval | `.unref()` — won't prevent exit |

### Assessment

The 5-second grace period is appropriate for the workload. Terminal commands (15s max) may be interrupted, but the socket is already abandoned by the HTTP server. The operator can retry after restart. No data corruption risk from the interrupt.

**Missing:** The cleanup sequence does not close the LOG_FILE write stream. If a write is in progress at exit, the buffer may be flushed or dropped depending on the OS. In practice, a graceful shutdown drains write buffers before exit. Low risk.

---

## 2. QUEUE RECOVERY BEHAVIOR

### 2.1 Disk Queue (autonomousLoop / taskQueue.cjs)

| Task Status at Crash | Recovery Behavior |
|---------------------|-------------------|
| `pending` (not yet started) | Recovered on restart via `taskQueue.recoverStale()` — marked ready to run |
| `running` (in-flight at crash) | Set to `pending` by `recoverStale()` — retried on next tick |
| `completed` / `failed` | Unchanged — preserved in file |
| `cancelled` | Unchanged |
| Stuck `pending` > 2h | Abandoned by `abandonStuckTasks(2)` — marked `status: "abandoned"` |

`taskQueue.recoverStale()` is called at `autonomousLoop.start()`. Tasks that were `running` at crash are reset to `pending` and retried. If the task was partially completed (e.g., sent a WhatsApp message then crashed), it will be retried and may run twice. This is acceptable for an operator tool — the operator can see duplicate executions in the task log.

**Crash during atomic write (`data/task-queue.json`):**
- The `_save()` function uses `fs.writeFileSync(tmp); fs.renameSync(tmp, file)`. POSIX rename is atomic.
- A crash before the rename: `.tmp` file exists, original file is intact. On restart, `recoverStale()` reads the old file (correct state before the crash operation).
- A crash after the rename: new file is the authoritative state.

### 2.2 Priority Queue (runtimeOrchestrator)

**All priority queue items are lost on crash or restart.** This is the in-memory `priorityQueue.cjs` with no persistence.

Tasks submitted via `POST /runtime/queue` that were pending or in-flight at crash are silently dropped. No recovery path exists. The dead-letter queue only receives tasks that fail AFTER being dequeued — not tasks that were in the queue at crash time.

**The disk queue (taskQueue) is the correct path for tasks that must survive restart.** The priority queue is for immediate background execution that the operator does not expect to survive a restart.

---

## 3. CORRUPTED STATE RECOVERY

### 3.1 Corrupted `data/task-queue.json`

```js
// taskQueue.cjs _load():
try {
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw);
} catch {
    return [];  // corrupted or missing → start empty
}
```

On JSON parse failure: starts with empty queue. All pending/running tasks are lost. No error escalation beyond the console.warn in the startup diagnostics.

**Impact:** If the server crashes mid-write AND the atomic rename fails (race condition on some filesystems), the corrupt `.tmp` file could replace the good file. Pending tasks are lost. Operator must re-submit.

**Detection:** `GET /runtime/status` will show 0 pending tasks immediately after restart with a corrupted file. Compare to expected task count.

### 3.2 Corrupted `data/leads.json`

CRM loads leads on startup:
```js
try {
    const raw = fs.readFileSync(LEADS_FILE, "utf8");
    leads = JSON.parse(raw);
} catch {
    leads = [];
}
```

On parse failure: CRM starts with 0 leads. No data loss to the file itself — the corrupt JSON file remains on disk. The operator can inspect and repair it manually.

### 3.3 Corrupted `data/dead-letter.json`

```js
// deadLetterQueue._read():
try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
catch { return []; }
```

On parse failure: returns empty array. Dead-letter history is lost but new failures will populate it fresh. Non-critical.

### 3.4 Corrupted `data/memory-store.json`

Similar try/catch fallback → empty array. AI context memory is lost. Operator must rebuild by using the system normally.

### 3.5 Missing `data/` directory

`operatorAudit.js`: `fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true })` at module load. Creates the `data/logs/` directory if missing.

`taskQueue.cjs`: No explicit `data/` directory creation. If `data/` is missing, `fs.readFileSync` throws → caught → empty queue. On first `_save()`, `fs.writeFileSync` throws → task is NOT saved to disk. All new tasks will appear to queue successfully (in-memory) but won't persist across restart.

**This is a silent data loss scenario.** If `data/` is deleted after deployment, new tasks queue normally but are lost on restart. No error message to the operator.

**Detection:** After restarting, all previously queued tasks disappear. The `GET /runtime/status` response shows `pendingCount: 0`.

**Mitigation (not implemented):** Add `fs.mkdirSync(path.dirname(FILE), { recursive: true })` to `taskQueue.cjs` initialization.

---

## 4. PARTIAL TASK FAILURE BEHAVIOR

### 4.1 Terminal Execution Failure

If a terminal command exits with non-zero status:
- `safeExec.run()` returns `{ ok: false, exitCode: N, stderr: "..." }`
- `terminalAgent.run()` returns `{ success: false, error: "...", exitCode: N }`
- `runtimeOrchestrator.dispatch()` returns `{ success: false, reply: stderr_message }`
- HTTP response: `200 { success: false, results: [{ error: "..." }], reply: "..." }`

The operator sees the failure in the HTTP response. No automatic retry for `/runtime/dispatch` (single synchronous dispatch). For queued tasks (autonomousLoop), retries up to `maxRetries` (default 3) with back-off.

### 4.2 AI Call Failure (Groq API Error)

- Groq API returns 429 (rate limit) or 5xx: the AI handler catches and returns `{ error: "..." }`
- No retry in the dispatch path — operator must re-send
- The failure is recorded in `errTracker` under category "transient"

### 4.3 Multi-Task Dispatch Failure

`runtimeOrchestrator.dispatch()` uses `Promise.allSettled()` — one subtask failure does not prevent others from completing. The response includes per-task results.

Example: "git status and what is the time" — if the planner generates two tasks (git, time), and git fails due to a locked index, the time task still succeeds. The operator sees both results.

---

## 5. EMERGENCY STOP RELIABILITY

### 5.1 What It Stops

- `runtimeOrchestrator.dispatch()`: checks `governor.isEmergencyActive()` at entry, returns 503 if active
- `autonomousLoop._tick()`: checks governor at top of tick, returns early if active

### 5.2 What It Does NOT Stop

- Currently in-flight `dispatch()` calls (the check is at entry, not mid-execution)
- Currently running child processes (already spawned before the stop)
- Automation engine cron jobs (`automationService.js`) — NOT governed
- Telegram bot polling — NOT governed
- Recurring cron tasks registered with `autonomousLoop._registerCron()` — cron jobs fire regardless of governor state

**Critical gap:** Recurring cron tasks bypass the emergency stop. A recurring task registered in the autonomousLoop will have its own `cron.schedule()` callback. That callback calls `_runTask()`, which calls `_getExecutor()` but does NOT check the emergency governor. If the emergency is declared to stop a runaway recurring task, the cron job continues firing.

**Workaround:** Use `POST /runtime/emergency/stop` then manually cancel the recurring task via the disk queue (update `status: "cancelled"` in `data/task-queue.json`). The cron job will then exit its next tick:
```js
if (fresh.status === "cancelled" || fresh.status === "failed") {
    job.stop();
    delete _cronJobs[task.id];
    return;
}
```

### 5.3 Persistence

Emergency state is in-memory only. After PM2 restart, the emergency is cleared. If the runaway condition was triggered by a recurring task, it will resume after restart.

**The operator must cancel the task before restarting**, or the runaway will resume.

### 5.4 Emergency Stop Test Result

From regression suite:
- `POST /runtime/emergency/stop { reason: "regression-test" }` → 200, emergencyId=emerg-1
- `POST /runtime/emergency/resume {}` → 200, resolved=true
- Round-trip latency: < 2ms

Stop/resume works correctly for the covered cases.

---

## 6. COMPLETE FAILURE SCENARIO TABLE

| Scenario | Probability | Severity | Time to Detect | Recovery |
|----------|-------------|----------|----------------|---------|
| Server OOM (heap > 512MB) | Low (<1/month solo use) | High | Minutes (PM2 restart loop) | Restart + investigate heap via `/runtime/health/deep`. Receipt Map is root cause. |
| Disk full from `execution.ndjson` | Low (months-years) | High | Hours (file writes fail) | Delete old log files; set up logrotate |
| `data/task-queue.json` corrupt | Very Low | Medium | Next restart | File is present but tasks lost; re-queue manually |
| PM2 restart loop (startup crash) | Very Low | High | Immediate | Check PM2 logs; usually a missing .env var or malformed data file |
| Emergency stop survives restart | Does not survive | Medium | Immediate | Cancel recurring task before restarting |
| Runaway recurring cron task | Very Low | Medium | Minutes | Emergency stop → cancel task via data/task-queue.json → restart |
| Groq API outage | Medium (~1/month) | Low | Seconds (operator sees errors) | AI calls fail gracefully; terminal/system tasks unaffected |
| WhatsApp rate limit hit | Low | Low | Seconds | WA returns 429; logged; bulk send stops |
| `data/` directory missing | Very Low | High (silent) | Next restart | All new tasks are lost silently; recreate data/ |
| JWT_SECRET leaked | Very Low | Critical | Not automatically | Rotate JWT_SECRET in .env; restart; all sessions invalidated |

---

## 7. RECOVERY RUNBOOK (Short Form)

**Server won't start (PM2 loop):**
```
pm2 logs jarvis --lines 50    # look for startup error
node scripts/check-startup-env.cjs  # check missing env vars
node -e "JSON.parse(require('fs').readFileSync('data/task-queue.json','utf8'))"  # test file validity
```

**Heap growing unexpectedly:**
```
curl -s -H "x-auth-token: $TOKEN" http://localhost:5050/runtime/health/deep | python3 -m json.tool
# Check heap.heapMb and memory.trend
# If trend is "rising", restart server and monitor
```

**Runaway task won't stop:**
```
# 1. Emergency stop
curl -s -X POST -H "Content-Type: application/json" -H "x-auth-token: $TOKEN" \
     -d '{"reason":"runaway"}' http://localhost:5050/runtime/emergency/stop

# 2. Cancel the task (edit data/task-queue.json, change status to "cancelled")
# 3. Restart server (emergency stop doesn't survive restart)
pm2 restart jarvis
```

**Logs filling disk:**
```
du -sh /path/to/jarvis-os/data/logs/
# If > 100MB: rotate
gzip data/logs/execution.ndjson && mv data/logs/execution.ndjson.gz data/logs/execution.$(date +%Y%m%d).ndjson.gz
```

**Tokens compromised:**
```
# 1. Generate new JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 2. Update .env JWT_SECRET=<new_value>
# 3. Restart server — all existing tokens immediately invalid
pm2 restart jarvis
```
