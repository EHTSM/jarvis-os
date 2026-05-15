# SYSTEM_RECOVERY_GUIDE.md

**Date:** 2026-05-15

---

## Scenario 1: Server Crash (PM2 Auto-Restart)

PM2 restarts `backend/server.js` automatically. On restart:

1. `autonomousLoop` calls `recoverStale()` — any tasks stuck in `running` status are reset to `pending`
2. `agentRegistry` is re-initialized fresh (circuit breaker state is lost — all circuits start **closed**)
3. `runtimeEventBus` ring buffer is empty — SSE clients will see `replayCount: 0`
4. Frontend's `OperatorConsole` reconnects automatically via SSE `EventSource` with exponential backoff

**Data survived:** `data/task-queue.json`, `data/dead-letter.json`, `data/logs/execution.ndjson`  
**Data lost:** in-memory execution history ring (500 entries), circuit breaker state

**Operator action:** None required. Monitor PM2 logs for repeat crashes.

---

## Scenario 2: Task Stuck in "running" State

Occurs when a task started executing but the server crashed mid-execution.

**Detection:**
```bash
curl -b "jarvis_auth=<token>" http://localhost:5050/runtime/status
# Look for tasks with status: "running" that have old timestamps
```

**Fix:** Restart PM2 — `recoverStale()` will reset `running` → `pending` automatically.

```bash
pm2 restart jarvis-os
```

If the task is in an infinite loop (running > 2 hours):
```bash
# autonomousLoop.abandonStuckTasks() handles this on restart
# Or manually clear via API:
curl -b "jarvis_auth=<token>" -X DELETE http://localhost:5050/runtime/dead-letter/<taskId>
```

---

## Scenario 3: Dead-Letter Queue Accumulating

Tasks exhausted all retries and landed in DLQ. This means the agent consistently fails.

**Detection:**
```bash
curl -b "jarvis_auth=<token>" http://localhost:5050/runtime/dead-letter
# Look for entries with the same error pattern
```

**Fix options:**

A. Circuit breaker already open — wait for 60s cooldown, agent will half-open and probe automatically.

B. Persistent agent failure — check agent environment:
```bash
# Terminal agent failing?
curl -b "jarvis_auth=<token>" -X POST http://localhost:5050/runtime/dispatch \
  -H "Content-Type: application/json" \
  -d '{"input":"run: echo hello"}'
```

C. Remove DLQ entries after root cause is fixed:
```bash
curl -b "jarvis_auth=<token>" -X DELETE http://localhost:5050/runtime/dead-letter/<taskId>
```

---

## Scenario 4: Emergency Stop (E-Stop)

**Trigger e-stop (halts all new task dispatch):**
```bash
curl -b "jarvis_auth=<token>" -X POST http://localhost:5050/runtime/emergency/stop \
  -H "Content-Type: application/json" \
  -d '{"reason":"runaway task detected"}'
```

**Resume:**
```bash
curl -b "jarvis_auth=<token>" -X POST http://localhost:5050/runtime/emergency/resume
```

**UI:** GovernorPanel → Emergency Stop button. Active stop is shown in red.

---

## Scenario 5: task-queue.json Corrupted

Symptoms: server logs `task-queue.json was corrupt — reset to []`

**Auto-handled at startup:** corrupt file is backed up and reset.  
**Manual recovery if needed:**
```bash
# Find backup
ls data/task-queue.json.bak.*

# Restore if backup looks valid
cp data/task-queue.json.bak.<timestamp> data/task-queue.json

# Or start fresh
echo "[]" > data/task-queue.json
```

---

## Scenario 6: Execution Log at Capacity

`data/logs/execution.ndjson` rotates automatically at 10 MB. Rotated files are deleted after 7 days.

**Check current size:**
```bash
curl -b "jarvis_auth=<token>" http://localhost:5050/runtime/health/deep
# Returns: { "execLog": { "sizeBytes": ..., "exists": true } }
```

**Manual rotation (if needed):**
```bash
mv data/logs/execution.ndjson data/logs/execution.$(date +%s).ndjson
```

---

## Scenario 7: SSE Stream Not Connecting

Symptoms: OperatorConsole shows `POLL #N` indefinitely.

**Check:**
```bash
# Test SSE endpoint directly
curl -b "jarvis_auth=<token>" -N http://localhost:5050/runtime/stream
# Should stream "data: connected" immediately
```

**Causes:**
- nginx proxy buffering SSE — add `proxy_buffering off; proxy_cache off;` to location block
- CORS issue — verify `ALLOWED_ORIGINS` in server.js includes frontend origin
- Auth failure — SSE requires valid `jarvis_auth` cookie

---

## Scenario 8: High Memory Usage

`memTracker.start()` logs heap stats every 30s at warn level when usage exceeds thresholds.

```bash
pm2 logs jarvis-os | grep "heap"
```

Common cause: `data/` JSON files growing unbounded (failure-memory.json, pattern-clusters.json from dead modules). Safe to delete these files — they're written by dead code that won't regenerate them:
```bash
rm -f data/failure-memory.json data/pattern-clusters.json data/workflow-trust.json
rm -rf data/workflow-checkpoints/
```

---

## Diagnostic Commands

```bash
# Server health
curl http://localhost:5050/health

# Deep health (auth required)
curl -b "jarvis_auth=<TOKEN>" http://localhost:5050/runtime/health/deep

# Queue status
curl -b "jarvis_auth=<TOKEN>" http://localhost:5050/runtime/status

# Last 20 execution log entries
curl -b "jarvis_auth=<TOKEN>" http://localhost:5050/runtime/logs?n=20

# Dead-letter queue
curl -b "jarvis_auth=<TOKEN>" http://localhost:5050/runtime/dead-letter

# PM2 process status
pm2 status && pm2 logs jarvis-os --lines 100

# Check port
lsof -nP -iTCP:5050
```
