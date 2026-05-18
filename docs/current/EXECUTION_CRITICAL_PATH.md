# EXECUTION_CRITICAL_PATH.md

**Audit Date:** 2026-05-15

---

## Overview

Every task in JARVIS takes one of three paths. Each path is completely independent. Understanding which path a given task takes is essential for debugging, monitoring, and stabilization.

---

## PATH A — Interactive HTTP Gateway

**Trigger:** `POST /jarvis { input, type, chatId, phone }`  
**Caller:** Frontend AI Console, WhatsApp messages, Telegram messages  
**Timeout:** None (Express default — connection-dependent)  
**Retries:** None  
**Circuit breaker:** None  
**History:** No (not recorded in executionHistory)

```
Client
  │
  ▼
POST /jarvis
  │
  ▼
routes/jarvis.js
  │
  ▼
jarvisController.js
  │
  ├─ 1. Parse input
  │    parser.parseCommand(input)
  │    → { type, intent, query, url, app, ... }
  │
  ├─ 2. Execute tool action (if parseable)
  │    toolAgent.execute(parsed)
  │    │
  │    ├── "open_url"     → primitives.openURL(url)
  │    ├── "web_search"   → primitives.webSearch(query)
  │    ├── "open_app"     → primitives.openApp(name)
  │    ├── "type_text"    → primitives.typeText(text)
  │    ├── "press_key"    → primitives.pressKey(key)
  │    ├── "speak"        → primitives.speak(text)
  │    └── "open_*"       → primitives.openURL(resolvedURL)
  │         └── child_process / open / robotjs
  │
  ├─ 3. If tool result empty → orchestrator.gateway()  [lazy-loaded]
  │    orchestrator.cjs (388 lines)
  │    → aiService.callAI(input)
  │    → Groq LLM API call
  │
  └─ 4. If no orchestrator → direct AI fallback
       aiService.callAI(input, { history, system })
       → Groq LLM API call

RESPONSE: { reply, action, data }
```

**Bottlenecks:**
- Groq API call latency (P50 ~1s, P99 ~5s)
- No timeout on external API calls
- No retry on network errors

---

## PATH B — Autonomous Background Loop

**Trigger:** Task in `data/task-queue.json` with `scheduledFor <= now` and `status = "pending"`  
**Caller:** `POST /tasks`, cron schedules, autonomousLoop.addTask()  
**Poll interval:** 10s  
**Timeout:** 30s per task  
**Retries:** Up to `maxRetries` (default 3), linear backoff (`retryDelay * attempt`)  
**Circuit breaker:** None  
**History:** Yes — written to `data/task-queue.json` (persistent) + `autonomousLoop._execTimings`

```
setInterval(10s)
  │
  ▼
taskQueue.getDuePending()
  │ reads data/task-queue.json from disk
  │ filters: status=pending, scheduledFor <= now
  │
  ▼
_runTask(task)
  │
  ├─ 1. Mark task running in queue (disk write)
  │    taskQueue.update(id, { status: "running", startedAt })
  │
  ├─ 2. Plan
  │    planner.cjs.plannerAgent(task.input)
  │    │ [lazy-loaded on first call]
  │    └─ returns array of { type, label, payload, input }
  │
  ├─ 3. Execute each sub-task sequentially
  │    for (pt of parsedTasks):
  │      executor.cjs.executorAgent(pt)    ← 2099-line monolith
  │      with _withTimeout(30s)
  │      │
  │      ├── type=ai        → aiService.callAI()
  │      ├── type=terminal  → terminalAgent / child_process
  │      ├── type=browser   → browserAgent / open
  │      ├── type=desktop   → desktopAgent / robotjs
  │      ├── type=dev       → devAgent / code gen
  │      ├── type=web_search→ primitives.webSearch()
  │      ├── type=crm       → crmService operations
  │      └── type=queue_task→ autonomousLoop.addTask()  ← self-scheduling
  │
  └─ 4. Mark task completed (disk write)
       taskQueue.update(id, { status: "completed", completedAt, executionLog })

ON FAILURE:
  ├─ retries < maxRetries: reschedule (disk write)
  └─ retries >= maxRetries: mark failed (disk write)
```

**Bottlenecks:**
- Every task does 2+ disk writes (start + complete)
- `getDuePending()` reads the entire queue file from disk on every tick
- Tasks execute sequentially within a tick (no parallel execution across due tasks)
- Cron tasks only fire once even if multiple intervals have elapsed since restart

**Performance note:** If the queue has 50 tasks all due at once, PATH B executes them all sequentially in a single tick. This will take up to 50 × 30s = 25 minutes. The `_dispatching` guard prevents re-entry but means the 10s interval effectively becomes unbounded when under load.

---

## PATH C — Runtime API Dispatch

**Trigger:** `POST /runtime/dispatch { input, timeoutMs, retries }` or `POST /runtime/queue { input, priority }`  
**Caller:** Operator Console (WorkflowPanel), programmatic API callers  
**Timeout:** Configurable (default 30s)  
**Retries:** Configurable (default 3, exponential backoff)  
**Circuit breaker:** YES — per registered agent  
**History:** Yes — written to `executionHistory.cjs` in-memory ring buffer

```
POST /runtime/dispatch
  │
  ▼
routes/runtime.js
  │
  ▼
runtimeOrchestrator.dispatch(input)
  │
  ├─ 1. Plan
  │    planner.cjs.plannerAgent(input)  [lazy-loaded]
  │    → array of { type, label, payload, input }
  │
  ├─ 2. Inject memory context
  │    memoryContext.getContextForTask(input, type)
  │    → { similar, prompt, history }  [reads contextEngine, lazy]
  │
  ├─ 3. Execute all tasks in parallel
  │    Promise.allSettled(tasks.map(task =>
  │      executionEngine.executeTask(task, options)
  │    ))
  │    │
  │    └─ Per task:
  │         for attempt 0..maxRetries:
  │           ├─ capability = taskRouter.resolveCapability(task.type)
  │           ├─ agent = agentRegistry.findForCapability(capability)
  │           │
  │           ├─ IF agent found (circuit closed, slot available):
  │           │    agent.acquireSlot()
  │           │    result = await agent.handler(task, ctx)  [30s timeout]
  │           │    agent.recordSuccess()
  │           │    executionHistory.record(success)
  │           │    runtimeEventBus.emit("execution", ...)
  │           │    return { success: true, result, agentId, durationMs }
  │           │
  │           ├─ IF agent circuit OPEN:
  │           │    skip this agent, try next (findForCapability returns null)
  │           │    fall through to legacy executor
  │           │
  │           └─ IF no agent registered:
  │                executor.cjs.execute(task, ctx)  [legacy fallback]
  │                executionHistory.record()
  │
  └─ 4. Aggregate results
       memory.recordExecution(input, tasks, results)  → disk write
       return { success, tasks, results, reply, durationMs }
```

**Bottlenecks:**
- `memoryContext.getContextForTask()` synchronously reads disk on first call per instance
- `Promise.allSettled` is parallel across sub-tasks but retry backoff is per-task (exponential: 1s, 2s, 4s...)
- `memory.recordExecution()` → `contextEngine.addConversation()` → disk write on every dispatch

---

## Architectural Bottleneck Map

```
╔═══════════════════════════════════════════════════════════════════╗
║  BOTTLENECK #1: SERIAL TASK EXECUTION IN PATH B                  ║
║                                                                   ║
║  autonomousLoop processes all due tasks one-by-one.               ║
║  10 tasks × 2s avg = 20s before next tick can check queue.        ║
║  During this window, new high-priority tasks wait.                ║
║                                                                   ║
║  Fix: Execute tasks in parallel with per-task concurrency limit.  ║
╚═══════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════╗
║  BOTTLENECK #2: DISK READ ON EVERY 10s TICK                       ║
║                                                                   ║
║  taskQueue.getDuePending() reads the entire task-queue.json        ║
║  from disk on every poll interval.                                ║
║  At 100 tasks in queue: 18KB read + JSON.parse every 10s.         ║
║                                                                   ║
║  Fix: Cache the parsed queue in memory, invalidate on writes.     ║
╚═══════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════╗
║  BOTTLENECK #3: DISK WRITE ON EVERY TASK STATE CHANGE             ║
║                                                                   ║
║  Every task start, every retry, every completion = disk write.    ║
║  A task with 3 retries = 6 disk writes.                           ║
║                                                                   ║
║  Fix: Batch writes or use write debouncing (already has atomic    ║
║  tmp+rename, so writes are safe — just frequent).                  ║
╚═══════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════╗
║  BOTTLENECK #4: contextEngine DISK WRITE ON EVERY DISPATCH        ║
║                                                                   ║
║  Every PATH C dispatch calls memory.recordExecution() which       ║
║  calls contextEngine.addConversation() which writes               ║
║  data/memory-store.json from disk.                                ║
║                                                                   ║
║  Fix: Write async, debounce with 5s delay, cap file size.         ║
╚═══════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════╗
║  BOTTLENECK #5: GROQ API — SINGLE POINT OF EXTERNAL FAILURE       ║
║                                                                   ║
║  All AI tasks in all three paths rely on Groq API.                ║
║  No retry, no timeout in PATH A.                                  ║
║  No circuit breaker for Groq in any path.                         ║
║                                                                   ║
║  Fix: Add circuit breaker for aiService.callAI() calls.           ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## Critical Path for a Typical Task

Most tasks are "user asks question → AI responds". The critical path is:

```
POST /jarvis (PATH A)
  ↓ parser.parseCommand()               ~2ms
  ↓ toolAgent.execute()                 ~2ms (no match for AI queries)
  ↓ aiService.callAI() → Groq API      ~800-3000ms  ← DOMINATES
  ↓ format response                     ~1ms
  → total: 800ms - 3000ms

The actual runtime (planner, executionEngine, agentRegistry)
adds ~5-10ms overhead on PATH C but is never called for PATH A.
```

The runtime infrastructure adds near-zero value for the most common use case.
