> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# VPS RESOURCE RISK REPORT
Final Production Sanity Audit — Single VPS Solo Operator  
Date: 2026-05-16

---

## Target Deployment

Single VPS. Single operator. No Kubernetes. No distributed infra. Moderate traffic.

Baseline measurements from regression test run (fresh server, < 5 minutes uptime):
- Heap: 34–37 MB
- RSS: 99–138 MB (higher after server runs several minutes, module caches fill)
- HTTP request latency: 0–23ms for authenticated endpoints
- git status dispatch: 23ms
- Time query: 3ms

---

## 1. RAM RISK AREAS

### 1.1 Expected Steady-State Memory

| Phase | Estimated Heap | RSS |
|-------|---------------|-----|
| Fresh start | 35–40 MB | 100–140 MB |
| After 1 hour (Telegram polling + automation) | 45–60 MB | 150–180 MB |
| After 24 hours (receipt map growth) | 60–100 MB | 200–250 MB |
| After 30 days (receipt map + module cache) | 100–200 MB | 250–350 MB |

Assumes: ~50 terminal/dispatch executions/day. Node.js caches all `require()`d modules after first load — this adds ~50–80 MB of "fixed" module cache overhead.

### 1.2 Identified Memory Growth Sources (Ranked)

**High impact — receipt Maps (terminalExecutionAdapter, filesystemExecutionAdapter, gitExecutionAdapter):**
- No eviction. Each completed execution adds an entry.
- After 10,000 executions (weeks of daily use): estimated 20–50 MB of receipts in heap.

**Medium impact — Node.js module cache:**
- `executor.cjs` alone is ~2000+ lines. Many `require()` calls inside handlers use lazy-load (`require("./...")` inside function bodies). These modules get cached on first use but are never released.
- Not a leak, but contributes to baseline RSS.

**Low impact — runtimeEventBus ring buffer:**
- Fixed 500-event ring. Each telemetry event is ~200 bytes. 500 × 200 = ~100KB. Bounded.

**Low impact — autonomousLoop failure/timing trackers:**
- `_failureTracker`: Map keyed by 40-char prefix. With diverse inputs, could accumulate many entries but no cap. Low risk at operator scale (< 100 unique inputs).
- `_execTimings`: ring buffer of last 100, capped.
- `_slowTasks`: ring buffer of last 20, capped.
- `_typeStats`: Map keyed by task type. Bounded by the number of distinct task types (~50 max).

**Low impact — data files loaded into memory:**
- `data/task-queue.json` (21KB), `data/dead-letter.json` (21KB), `data/memory-store.json` (168KB) — all loaded and kept in memory as parsed JSON objects.

### 1.3 RAM Recommendation

**Minimum VPS RAM:** 512 MB  
**Comfortable VPS RAM:** 1 GB (allows headroom for growth + OS overhead)  
**Warning threshold:** Heap > 200 MB — indicates receipt map growth or a new leak  
**Critical threshold:** Heap > 450 MB — `memTracker` emits a MEMORY_CRITICAL warning

Monitor: `GET /runtime/health/deep` (heap + trend) and `GET /ops` (full memory report + trend label).

---

## 2. CPU SPIKE AREAS

### 2.1 Identified CPU Spike Sources

**Groq AI calls (`/ai/chat`, `/jarvis` with AI routing):**
- These call the Groq API via HTTP. The wait is I/O-bound (network). CPU impact is minimal — just JSON serialization.
- Risk: If Groq API is slow, the request thread is blocked waiting for the response. Express is single-threaded. One slow AI call doesn't block other requests (they're async), but many concurrent AI calls (rate limit: 60/min) could queue.

**`executor.cjs` module load:**
- `executor.cjs` is 2000+ lines with hundreds of `require()` calls inside handlers. First execution of each handler type triggers module loading. Cold-start CPU spike: ~100–200ms when a new handler type is first called.

**taskQueue disk sync:**
- `taskQueue.cjs` writes to disk on every status update using `fs.writeFileSync` (synchronous write). During a burst of task updates, this blocks the Node.js event loop.
- At the current scale (< 10 concurrent tasks), each write is ~1–5ms. Not a bottleneck.

**JSON parsing of large data files:**
- `data/memory-store.json` (168KB), `data/memory-index.json` (191KB) are parsed on every read operation. At low frequency (AI calls only), not a concern.

**autonomousLoop tick with many pending tasks:**
- Tasks are processed serially. A tick with 20 pending tasks takes up to `20 × 30s = 600s`. CPU during this is low (waiting on I/O) but the loop is occupied.

### 2.2 CPU Recommendations

Single VPS CPU is adequate for the current workload. The system is I/O-bound (disk, network) rather than CPU-bound. A 1-2 vCPU VPS is sufficient.

**Risk:** If `executor.cjs` is changed to load modules eagerly instead of lazily, startup time could spike by 2–5 seconds. Keep lazy-loading.

---

## 3. WebSocket / SSE SCALING LIMITS

**SSE hard cap: 10 concurrent connections** (`MAX_SSE` in `runtimeStream.cjs`).  
**EventBus subscriber cap: 20** (`MAX_SUBS` in `runtimeEventBus.cjs`).

For a single-operator tool, the realistic concurrent SSE connection count is 1–3 (browser tab + maybe a monitoring script). The caps are not a practical limit.

**Memory per SSE connection:**
- 1 `res` object: ~2–5KB
- 1 event listener: negligible
- 1 ping timer (20s interval, `unref()`): negligible
- Total per connection: ~5–10KB

At 10 connections: ~50–100KB. Negligible.

**Telemetry events:** emitted every 10s to all subscribers. With 10 subscribers × 10 events/min × 200 bytes/event = 20KB/min of SSE data. Negligible.

**Reconnect behavior:** Clients auto-reconnect; on reconnect, last 50 events are replayed from the ring buffer. This correctly handles nginx proxy restarts and brief network drops.

---

## 4. LOG GROWTH RISKS

### 4.1 `data/logs/execution.ndjson` — HIGH RISK

**Current size: 2.3MB after dev/test usage (15,000+ lines).**

This file grows with every execution recorded by `executionHistory.cjs`. It's append-only with no rotation or size limit.

**Projection:**
- 100 executions/day × 200 bytes/entry = ~20KB/day
- After 1 year: ~7MB
- After 5 years: ~35MB

At moderate use (500 executions/day): ~100KB/day → ~36MB/year.

**These numbers are manageable, but the file will grow unboundedly.** On a VPS with 20GB disk, this won't fill the disk for years at operator-scale. However, if autonomous loop tasks run frequently, the growth rate could be 10x.

**Recommendation:** Add logrotate for `data/logs/*.ndjson`, rotate weekly, keep 4 weeks.

### 4.2 `data/logs/operator-audit.ndjson` — LOW RISK

**Current size: 3.8KB (26 lines).** Grows with every authenticated HTTP request.

At 1000 requests/day × ~150 bytes/entry = 150KB/day → ~54MB/year.

This is negligible for a solo operator tool (< 100 requests/day expected). Still, no rotation exists.

### 4.3 `$LOG_FILE` (if set) — MEDIUM RISK

If `LOG_FILE` env var is set, `backend/utils/logger.js` opens an `fs.createWriteStream(logFile, { flags: "a" })`. No rotation, no size limit. All INFO/WARN/ERROR logs are written here.

At startup: ~20 log lines. Per request: 1–2 log lines. Per autonomous loop tick: 3–5 lines.

At high volume (100 ticks/hour with tasks): ~50KB/hour → 1.2MB/day → 36MB/month. 

**Set up logrotate before enabling `LOG_FILE` in production.**

### 4.4 `data/task-queue.json` and `data/dead-letter.json` — BOUNDED

`task-queue.json`: `pruneOldTasks(50)` runs every 6 hours — keeps last 50 completed/failed tasks. Bounded at ~50 tasks × ~500 bytes = 25KB max. Current: 21KB. OK.

`data/dead-letter.json`: Capped at 1000 entries, oldest evicted on overflow. Current: 21KB. OK.

---

## 5. PM2 RESTART SAFETY

### 5.1 Startup Sequence

1. `dotenv.config()` — loads `.env`
2. Env validation (checks required vars)
3. Express middleware setup
4. Route mounting
5. HTTP server listen (binds port 5050)
6. Telegram bot start (polling)
7. Automation engine start (cron)
8. autonomousLoop start (reads disk queue, processes overdue tasks immediately on startup)
9. `bootstrapRuntime.cjs` (registers agents, configures filesystem adapter)
10. Startup diagnostics log

**Risk: Race condition on startup.**

Step 8 (`autonomousLoop.start()`) runs immediately and processes any overdue tasks from disk. This happens BEFORE step 9 (`bootstrapRuntime`), which registers the runtime agents. If an overdue task requires the `terminal` agent (registered at step 9) and the autonomousLoop tick fires before step 9 completes, the agent registry is empty and the task falls to the legacy executor.

In practice, this is benign — the legacy executor IS available (it's just a module require, not a registered agent), and the task would succeed via the fallback path. But it means the first tick after restart uses legacy paths, not registered agents.

**Risk: Data file corruption after unclean shutdown.**

If the server crashes mid-write to `data/task-queue.json`, the file could be partially written. On restart, `JSON.parse()` will fail. `taskQueue.cjs` uses `fs.readFileSync` inside a try/catch and returns `[]` on parse error. This is safe — but all pending tasks are lost on a corrupt file.

The atomic rename pattern (`writeFile tmp → rename`) is used in `taskQueue.cjs`. A crash DURING the rename could leave either the old file or a `.tmp` file. `fs.renameSync` is atomic on POSIX systems — the rename either completes or doesn't. The old file remains valid if the rename fails.

### 5.2 PM2 Configuration Recommendations

```yaml
# ecosystem.config.js
apps:
  - name: jarvis
    script: backend/server.js
    max_restarts: 5        # don't loop forever on persistent errors
    min_uptime: 10000      # must stay up 10s to count as successful start
    restart_delay: 3000    # wait 3s between restarts
    max_memory_restart: 512M  # restart if heap exceeds 512MB
    kill_timeout: 10000    # 10s to drain before SIGKILL (current code uses 5s)
    env:
      NODE_ENV: production
```

**Missing:** No `max_memory_restart` is currently configured. The `memTracker` emits a MEMORY_CRITICAL warning at 450MB heap but does NOT trigger a restart. Without PM2 `max_memory_restart`, the process will continue above 450MB until OOM.

---

## 6. STARTUP ORDERING RISKS

### 6.1 Telegram Bot vs. HTTP Server

Telegram bot polling starts BEFORE the HTTP server binds. If the Telegram token is invalid, the polling error handler catches it without crashing. The HTTP server then starts normally. Ordering is safe.

### 6.2 autonomousLoop vs. Agent Registry

autonomousLoop calls `taskQueue.recoverStale()` and then `_startInterval()` at startup. If there are pending tasks due immediately, `_tick()` fires and calls `_getExecutor()` (lazy require of executor.cjs). The executor uses task type → executor handler, not the agent registry. The registered agents (terminal, browser, etc.) are only used by `runtimeOrchestrator`, not by the autonomous loop. 

**The autonomous loop and the runtime orchestrator are fully separate execution paths.** This is why they can start in any order without coordination.

### 6.3 Database/Disk State on Restart

All state files are in `data/`. On restart:
- `data/task-queue.json`: loaded at autonomousLoop start
- `data/leads.json`: loaded at CRM init
- `data/dead-letter.json`: loaded on first read
- `data/memory-store.json` / `data/memory-index.json`: loaded on first AI query

No startup ordering issues with disk state.

---

## 7. RESOURCE SUMMARY TABLE

| Resource | Current | 30-day Projection | Risk | Action |
|----------|---------|-------------------|------|--------|
| Heap | 35–40 MB | 100–200 MB | Medium | Monitor weekly; fix receipt map eviction |
| RSS | 100–140 MB | 250–350 MB | Low | No action needed < 1GB |
| VPS RAM needed | — | — | — | 1 GB minimum |
| `execution.ndjson` | 2.3 MB | ~3–5 MB | Low (operator scale) | Set up logrotate before month 2 |
| `task-queue.json` | 21 KB | ~25 KB | None | Bounded by pruneOldTasks |
| CPU | <5% idle | <15% with automation | None | 1-2 vCPU adequate |
| SSE connections | 10 max | 10 max | None | Adequate for single operator |
| Disk (total data/) | ~800 KB | ~5–10 MB | None | No risk at operator scale |
