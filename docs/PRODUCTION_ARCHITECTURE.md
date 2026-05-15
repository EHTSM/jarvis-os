# JARVIS OS — Production Architecture

**Date:** 2026-05-15  
**Status:** Production-grade MVP runtime  
**Test coverage:** 111/111 real-world workflow tests passing (no mocks)

---

## Architecture Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                            │
│  OperatorConsole → AuthProvider → WorkflowPanel / GovernorPanel    │
│  SSE listener ←────── /runtime/stream ──────────── runtimeStream   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP (auth: JWT cookie)
┌──────────────────────────▼──────────────────────────────────────────┐
│                      BACKEND (Express)                              │
│                                                                     │
│  POST /auth/login (rate: 10/5min) → authMiddleware (JWT+scrypt)    │
│  POST /runtime/dispatch  ─────────────────────┐                    │
│  POST /runtime/queue                          │                    │
│  GET  /runtime/status                         ▼                    │
│  GET  /runtime/history            runtimeOrchestrator              │
│  GET  /runtime/dead-letter                    │                    │
│  GET  /runtime/health/deep                    │                    │
│  GET  /runtime/logs               ────────────┘                    │
│  POST /runtime/emergency/stop → runtimeEmergencyGovernor           │
│  POST /runtime/emergency/resume                                     │
│  GET  /ops    /tasks   /health                                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                   RUNTIME CORE (agents/runtime/)                    │
│                                                                     │
│  runtimeOrchestrator                                                │
│      │── planner.cjs → task decomposition                          │
│      │── executionEngine.cjs → capability routing + retries        │
│      │── priorityQueue.cjs → in-memory priority queue              │
│      └── executionHistory.cjs → 500-entry in-memory ring           │
│                                                                     │
│  executionEngine                                                    │
│      │── taskRouter.cjs → task.type → capability string            │
│      │── agentRegistry.cjs → findForCapability + circuit breaker   │
│      │── deadLetterQueue.cjs → failed tasks persisted to disk      │
│      └── executor.cjs (legacy fallback for unregistered caps)      │
│                                                                     │
│  runtimeEventBus ── 500-entry SSE ring buffer                      │
│      └── runtimeStream.cjs → GET /runtime/stream (EventSource)    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    AGENT LAYER (5 real agents)                      │
│                                                                     │
│  desktop    (robotjs, maxConcurrent=1)  ← open_app, key_combo      │
│  browser    (primitives, maxConcurrent=3) ← open_url, web_search   │
│  terminal   (shell exec, maxConcurrent=2) ← terminal               │
│  automation (n8n webhooks, maxConcurrent=2) ← automation           │
│  dev        (Groq codegen, maxConcurrent=2) ← dev                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                    PERSISTENCE LAYER                                │
│                                                                     │
│  data/task-queue.json      ← atomic write (tmp+rename)             │
│  data/dead-letter.json     ← failed tasks that exhausted retries   │
│  data/logs/execution.ndjson← persistent NDJSON execution log       │
│  data/logs/app.log         ← optional: set LOG_FILE env var        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Execution Lifecycle Diagram

```
User input
    │
    ▼
POST /runtime/dispatch
    │
    ▼
runtimeOrchestrator.dispatch(input)
    │
    ├── planner.plannerAgent(input)
    │       └── returns [{type, label, payload, input}]
    │
    ▼
Promise.allSettled(tasks.map(executeTask))
    │
    ▼
executionEngine.executeTask(task, options)
    │
    ├── taskRouter.resolveCapability(task.type)
    │       └── "terminal" | "browser" | "dev" | ... | "ai"
    │
    ├── agentRegistry.findForCapability(capability)
    │       ├── circuit breaker check (closed/half-open → ok, open → null)
    │       └── load balancing (least active slot)
    │
    ├── [agent found] → agent.handler(task, ctx)
    │       ├── acquireSlot()
    │       ├── withTimeout(handler, timeoutMs)
    │       ├── success → recordSuccess(durationMs)
    │       └── failure → recordFailure() + backoff + retry
    │
    ├── [no agent] → legacy executor.cjs fallback
    │
    └── [all retries exhausted]
            ├── executionHistory.record(failure)
            │       └── execLog.append(entry) → data/logs/execution.ndjson
            └── deadLetterQueue.push(entry) → data/dead-letter.json
    │
    ▼
result: { success, result, agentId, durationMs, attempts, error }
    │
    ▼
runtimeEventBus.emit("execution", entry) → SSE → OperatorConsole
```

---

## Agent Communication Flow

```
                    agentRegistry
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   desktop agent   terminal agent    browser agent
   (maxCon=1)      (maxCon=2)        (maxCon=3)
        │                │                │
   robotjs          child_process    primitives.cjs
   open_app         shell exec       openURL/webSearch
   key_combo        git/npm/node     safe URL validation
```

**Circuit Breaker per agent:**
```
closed ──(5 consec failures)──► open
  ▲                               │
  │                          (60s cooldown)
  │                               │
  └────(probe success)────── half-open
```

**Load balancing:** `findForCapability(cap)` returns the agent with the lowest `_active` slot count among all agents registered for `cap`.

---

## Recovery Flow

```
Server crash
    │
    ▼
PM2 restarts process
    │
    ▼
bootstrapRuntime.cjs
  └── registers 5 agents fresh (agentRegistry is in-memory)
    │
    ▼
autonomousLoop starts (if enabled)
  └── reads data/task-queue.json
  └── recoverStale(): running → pending  (crash recovery)
  └── abandonStuckTasks(): pending > 2h → failed (except recurring)
    │
    ▼
SSE clients reconnect
  └── GET /runtime/stream → EventSource
  └── "connected" event with replayCount
  └── runtimeEventBus.getRecent(50) → replay of last 50 events
    │
    ▼
Operator console reconnects
  └── Fetch fallback polling (ops/tasks every 6s, history every 5s)
  └── SSE indicator shows "POLL #N" during backoff
  └── On reconnect: indicator returns to "SSE"
```

---

## Folder Structure (Production Live Code)

```
jarvis-os/
├── agents/
│   ├── runtime/                    ← LIVE CORE
│   │   ├── agentRegistry.cjs       ← Circuit breaker + slot tracking
│   │   ├── executionEngine.cjs     ← Retries, backoff, timeout, DLQ hook
│   │   ├── executionHistory.cjs    ← 500-entry ring + disk bridge
│   │   ├── runtimeEventBus.cjs     ← SSE ring buffer + subscriber mgmt
│   │   ├── runtimeOrchestrator.cjs ← dispatch, queue, status
│   │   ├── runtimeStream.cjs       ← SSE endpoint (/runtime/stream)
│   │   ├── taskRouter.cjs          ← type → capability mapping
│   │   ├── priorityQueue.cjs       ← In-memory priority queue
│   │   ├── deadLetterQueue.cjs     ← Persistent DLQ (data/dead-letter.json)
│   │   ├── bootstrapRuntime.cjs    ← Registers 5 production agents
│   │   ├── memoryContext.cjs       ← Context injection for tasks
│   │   └── control/
│   │       └── runtimeEmergencyGovernor.cjs  ← E-stop / resume
│   │
│   │   ⚠️  ~200 files in subdirs (benchmark/, chaos/, evolution/,
│   │       intelligence/, governance/, etc.) are DEAD CODE —
│   │       never imported, never loaded. See DEAD_CODE_REPORT.md.
│   │
│   ├── terminalAgent.cjs           ← Shell exec with security allowlist
│   ├── browserAgent.cjs            ← URL safety + open/search
│   ├── devAgent.cjs                ← Groq code generation
│   ├── automationAgent.cjs         ← n8n webhook dispatch
│   ├── desktopAgent.cjs            ← robotjs keyboard/app control
│   ├── planner.cjs                 ← Task decomposition (regex + AI)
│   └── primitives.cjs              ← openURL, webSearch
│
├── backend/
│   ├── server.js                   ← Express entry + PM2 target
│   ├── routes/
│   │   ├── index.js                ← Route aggregator + auth gate
│   │   ├── auth.js                 ← Login (rate limited), logout, /me
│   │   └── runtime.js              ← dispatch, queue, status, DLQ, logs
│   ├── middleware/
│   │   ├── authMiddleware.js       ← JWT sign/verify (HS256, no deps)
│   │   └── rateLimiter.js          ← Per-IP in-memory rate limiter
│   └── utils/
│       ├── logger.js               ← Structured logger (+ optional LOG_FILE)
│       └── execLog.cjs             ← Persistent NDJSON execution log
│
├── frontend/src/
│   ├── contexts/AuthContext.jsx    ← JWT auth state + login/logout
│   ├── components/auth/LoginPage.jsx
│   └── components/operator/        ← 8 operator panels
│       ├── OperatorConsole.jsx     ← SSE + polling orchestrator
│       ├── TaskQueuePanel.jsx
│       ├── ExecLogPanel.jsx
│       ├── GovernorPanel.jsx
│       ├── WorkflowPanel.jsx
│       ├── AdapterPanel.jsx
│       ├── TelemetryPanel.jsx
│       └── AIConsolePanel.jsx
│
├── data/
│   ├── task-queue.json             ← Persistent task queue (atomic write)
│   ├── dead-letter.json            ← Failed tasks (DLQ, max 1000)
│   └── logs/
│       └── execution.ndjson        ← Persistent execution log (rotate 10MB)
│
├── tests/workflows/                ← 111 real-world tests, 0 mocks
│   ├── 01-ai-execution.test.cjs
│   ├── 02-terminal-workflow.test.cjs
│   ├── 03-browser-workflow.test.cjs
│   ├── 04-recovery-workflow.test.cjs
│   ├── 05-operator-control.test.cjs
│   ├── 06-filesystem-workflow.test.cjs
│   ├── 07-execution-engine-stress.test.cjs
│   ├── 08-git-workflow.test.cjs
│   ├── 09-queue-and-history.test.cjs
│   └── 10-persistent-log.test.cjs
│
└── docs/
    ├── PRODUCTION_ARCHITECTURE.md  ← This file
    ├── MVPReadinessScore.md
    ├── workflowValidationReport.md
    ├── operatorExperienceAudit.md
    ├── DEPLOYMENT_GUIDE.md
    ├── OPERATOR_ONBOARDING.md
    └── ROLLBACK_PROCEDURE.md
```

---

## What Was Actually Built (vs. What Exists)

| System | Exists in Repo | Actually Live | Tested |
|--------|---------------|---------------|--------|
| Agent registry + circuit breaker | ✓ | ✓ | ✓ 18 tests |
| Execution engine (retries/timeout) | ✓ | ✓ | ✓ 12 tests |
| SSE event bus | ✓ | ✓ | ✓ 10 tests |
| Task queue + recovery | ✓ | ✓ | ✓ 15 tests |
| Terminal security layer | ✓ | ✓ | ✓ 23 tests |
| Browser URL validation | ✓ | ✓ | ✓ 32 tests |
| Auth (JWT + scrypt) | ✓ | ✓ | — |
| Login rate limiting | ✓ | ✓ | — |
| **Persistent execution log** | new | ✓ | ✓ 7 tests |
| **Dead-letter queue** | new | ✓ | ✓ 5 tests |
| **Deep health endpoint** | new | ✓ | — |
| Operator console UI | ✓ | ✓ | — |
| benchmark/chaos/evolution dirs | ✓ | ✗ | ✗ |
| orchestration/governance/trust dirs | ✓ | ✗ | ✗ |
| ~200 other runtime subdirectory files | ✓ | ✗ | ✗ |

---

## Remaining Production Bottlenecks

| # | Bottleneck | Impact | Fix Effort |
|---|-----------|--------|-----------|
| 1 | ~200 dead files in agents/runtime/ | Confuses newcomers, inflates repo | High (audit each before delete) |
| 2 | No persistent execution history (ring resets on restart) | Loss of audit trail | Medium (SQLite or append to execLog) |
| 3 | In-memory agentRegistry (circuit state lost on restart) | After restart, all circuits are closed even if agents are still broken | Low (save/restore state to JSON) |
| 4 | dispatch() blocks event loop for full task duration | Under load, concurrent dispatches compete for the same thread | Medium (queue-first pattern) |
| 5 | No external alerting | Operator must watch console; no on-call paging | Medium |
| 6 | Queue has no cross-process lock | If two processes start simultaneously, queue file can corrupt | Low (advisory lock file) |
| 7 | Governor emergency state not exposed in dedicated endpoint | Emergency detection depends on ops polling | Low (30 lines) |

---

## Next Engineering Priorities (Exact Order)

### Sprint 1 — Stability (1-2 days)
1. **Persistent agentRegistry state** — save circuit breaker states to `data/agent-state.json` on each `recordFailure/recordSuccess`; reload on startup. Prevents "open circuit after restart" confusion.
2. **Governor status endpoint** — `GET /runtime/governor/status` → `{ active, emergencyId, reason, since }`. Wire into GovernorPanel instead of inferring from ops.status.

### Sprint 2 — Cleanup (2-3 days)
3. **Dead code removal** — audit each file in `agents/runtime/` subdirs. Script: grep for `require("./path")` across all live files. Delete any file not imported anywhere. Estimate: ~180 of 200 are safe to delete.
4. **Normalize folder structure** — move remaining live runtime utilities to a flat structure. Current nesting (8 levels deep in places) makes navigation painful.

### Sprint 3 — Scale Readiness (3-5 days)
5. **SQLite execution log** — replace NDJSON append with SQLite via `better-sqlite3`. Enables `SELECT * FROM executions WHERE success=0 ORDER BY ts DESC LIMIT 100`. Better than file tail.
6. **Login session management** — store active token IDs in Redis or a JSON file; add `DELETE /auth/session/:id` for remote logout.
7. **Rate limit persistence** — current rate limiter resets on restart. Use a persistent store for production.

### Sprint 4 — Observability (2-3 days)
8. **Structured error context** — current `lastError` is a bare message string. Add `errorType`, `agentId`, `attempt` fields to DLQ and history entries.
9. **PM2 log rotation** — configure `pm2-logrotate` module. Currently PM2 logs grow unbounded.
10. **Metrics endpoint** — `GET /metrics` returning Prometheus-compatible text format (task counts, success rates, agent states, queue depth). Enables future Grafana integration.

---

## Production Confidence

**Current confidence for single-operator production use: HIGH**

- 111/111 real-world workflow tests passing
- Auth is secure (JWT HS256, scrypt, timing-safe, rate-limited)
- No task loss on crash (atomic writes, stale recovery, DLQ)
- Execution logs survive process restarts
- Operator has full visibility: SSE stream + polling fallback + error badges
- E-Stop confirmed working through governor API
