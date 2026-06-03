# RUNTIME_MAP.md

Generated: 2026-05-20 | Canonical. Supersedes FINAL_ARCHITECTURE.md, RUNTIME_DEPENDENCY_MAP.md, CURRENT_RUNTIME_ARCHITECTURE.md.

---

## Startup Sequence

```
npm start
  → node scripts/check-startup-env.cjs   (exits 1 if JWT_SECRET or GROQ_API_KEY missing in prod)
  → node backend/server.js
      1. dotenv.config()                  (loads .env from project root)
      2. Inline env validation            (warns on missing optional vars)
      3. Auth env check                   (JWT_SECRET + OPERATOR_PASSWORD_HASH required in prod)
      4. Express app created
      5. Middleware mounted (in order):
           rawBody → requestId → cors → json → urlencoded → requestLogger → authMiddleware
      6. Routes mounted via backend/routes/index.js
      7. frontend/build served as static (production only)
      8. app.listen(PORT=5050)
      9. memTracker.start()               (memory monitoring interval)
     10. startTelegramBot()               (optional — guarded)
     11. automation.start()               (automationService — schedulers)
     12. autonomousLoop.start()           (background task loop — guarded)
     13. bootstrapRuntime.cjs loaded      (registers all runtime agents)
     14. runtimeEventBus.start()          (starts SSE event flush interval)
     15. task-queue.json integrity check  (reset + backup if corrupt)
     16. taskQueue.recoverStale()         (recover in-progress tasks from prior session)
     17. Startup diagnostics logged
```

---

## Runtime Dependency Chain

```
backend/server.js
├── backend/utils/logger.js
├── backend/utils/errorTracker.js
├── backend/utils/memoryTracker.js
├── backend/middleware/rawBody.js
├── backend/middleware/requestId.js
├── backend/middleware/requestLogger.js
├── backend/routes/index.js
│   ├── backend/middleware/authMiddleware.js
│   ├── backend/routes/auth.js
│   ├── backend/routes/jarvis.js
│   │   └── backend/controllers/jarvisController.js
│   │       ├── agents/toolAgent.cjs
│   │       ├── agents/salesAgent.cjs         (guarded)
│   │       ├── agents/interestDetector.cjs   (guarded)
│   │       ├── agents/followUpSystem.cjs     (guarded)
│   │       └── agents/autoReplyAgent.cjs     (guarded)
│   ├── backend/routes/whatsapp.js
│   ├── backend/routes/telegram.js
│   ├── backend/routes/payment.js
│   ├── backend/routes/crm.js
│   ├── backend/routes/ai.js
│   ├── backend/routes/simulation.js
│   ├── backend/routes/ops.js
│   ├── backend/routes/runtime.js
│   │   ├── agents/runtime/runtimeOrchestrator.cjs
│   │   │   ├── agents/runtime/agentRegistry.cjs
│   │   │   ├── agents/runtime/priorityQueue.cjs
│   │   │   ├── agents/runtime/executionEngine.cjs
│   │   │   │   ├── agents/runtime/taskRouter.cjs
│   │   │   │   ├── agents/runtime/executionHistory.cjs
│   │   │   │   │   └── backend/db/sqlite.cjs       ← WAL mode, single writer
│   │   │   │   ├── agents/runtime/runtimeEventBus.cjs
│   │   │   │   ├── agents/runtime/deadLetterQueue.cjs
│   │   │   │   └── agents/executor.cjs             (legacy fallback, guarded)
│   │   │   ├── agents/runtime/executionHistory.cjs
│   │   │   ├── agents/runtime/memoryContext.cjs
│   │   │   └── agents/planner.cjs                  (lazy-loaded, guarded)
│   │   ├── agents/runtime/executionHistory.cjs
│   │   ├── agents/runtime/deadLetterQueue.cjs
│   │   ├── backend/utils/execLog.cjs
│   │   ├── backend/middleware/rateLimiter.js
│   │   └── agents/runtime/control/runtimeEmergencyGovernor.cjs (guarded)
│   ├── agents/runtime/runtimeStream.cjs             ← SSE endpoint
│   └── backend/routes/tasks.js
│       └── agents/taskQueue.cjs
├── backend/services/crmService.js
├── backend/services/paymentService.js
├── backend/services/whatsappService.js
├── backend/services/automationService.js
└── agents/runtime/bootstrapRuntime.cjs
    ├── agents/runtime/runtimeOrchestrator.cjs
    ├── agents/browserAgent.cjs                    (guarded)
    ├── agents/terminalAgent.cjs                   (guarded)
    │   └── agents/runtime/adapters/terminalExecutionAdapter.cjs
    │       ├── agents/runtime/adapters/adapterSandboxPolicyEngine.cjs
    │       ├── agents/runtime/adapters/processLifecycleAdapter.cjs
    │       └── agents/runtime/runtimeEventBus.cjs
    ├── agents/automationAgent.cjs                 (guarded)
    ├── agents/devAgent.cjs                        (guarded)
    ├── agents/runtime/adapters/filesystemExecutionAdapter.cjs (guarded)
    └── plugins/local-desktop/desktopAgent.cjs     (env-gated: ENABLE_LOCAL_DESKTOP=1)
```

---

## Active Routes

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| POST | /auth/login | auth.js | none |
| POST | /auth/logout | auth.js | none |
| GET | /auth/me | auth.js | none |
| POST | /jarvis | jarvisController.js | optional |
| POST | /whatsapp/webhook | whatsapp.js | none |
| POST | /telegram/send | telegram.js | optional |
| POST | /payment/* | payment.js | none |
| POST | /webhook/razorpay | payment.js | none |
| GET/POST | /crm | crm.js | optional |
| POST | /ai/chat | ai.js | optional |
| POST | /simulate/* | simulation.js | optional |
| GET | /health | ops.js | none |
| GET | /stats | ops.js | none |
| GET | /metrics | ops.js | none |
| POST | /runtime/dispatch | runtime.js | **required** |
| POST | /runtime/queue | runtime.js | **required** |
| GET | /runtime/status | runtime.js | **required** |
| GET | /runtime/history | runtime.js | **required** |
| POST | /runtime/emergency-stop | runtime.js | **required** |
| GET | /runtime/stream | runtimeStream.cjs | **required** |
| GET | /runtime/stream/status | runtimeStream.cjs | **required** |
| GET/POST | /tasks | tasks.js | optional |
| GET | /queue/status | tasks.js | optional |

---

## Middleware Order (per request)

```
rawBody.js          → captures raw body for webhook signature verification
requestId.js        → attaches x-request-id UUID to every request
cors                → allows configured origins
express.json()      → parses JSON body (10kb limit)
express.urlencoded  → parses form body
requestLogger.js    → logs method + path + duration
authMiddleware.js   → requireAuth() gate on /runtime/* routes
rateLimiter.js      → per-route sliding window (30 req/60s on /runtime/dispatch)
```

---

## Active Agents (registered at bootstrap)

| Agent ID | Capability | Source File | Concurrent |
|----------|-----------|-------------|-----------|
| browser | browser | agents/browserAgent.cjs | 3 |
| terminal | terminal | agents/terminalAgent.cjs | 2 |
| automation | automation | agents/automationAgent.cjs | 1 |
| dev | dev | agents/devAgent.cjs | 2 |
| filesystem | filesystem | agents/runtime/adapters/filesystemExecutionAdapter.cjs | 3 |
| desktop | desktop | plugins/local-desktop/desktopAgent.cjs | 1 (env-gated) |

---

## Active Adapters

| Adapter | File | Used By |
|---------|------|---------|
| terminalExecutionAdapter | agents/runtime/adapters/terminalExecutionAdapter.cjs | terminal agent |
| filesystemExecutionAdapter | agents/runtime/adapters/filesystemExecutionAdapter.cjs | filesystem agent |
| browserExecutionAdapter | agents/runtime/adapters/browserExecutionAdapter.cjs | browser agent |
| vscodeExecutionAdapter | agents/runtime/adapters/vscodeExecutionAdapter.cjs | dev agent (optional) |
| gitExecutionAdapter | agents/runtime/adapters/gitExecutionAdapter.cjs | dev agent (optional) |
| processLifecycleAdapter | agents/runtime/adapters/processLifecycleAdapter.cjs | terminal adapter |
| adapterSandboxPolicyEngine | agents/runtime/adapters/adapterSandboxPolicyEngine.cjs | terminal + git adapters |
| adapterHealthMonitor | agents/runtime/adapters/adapterHealthMonitor.cjs | supervisor |
| adapterCapabilityRegistry | agents/runtime/adapters/adapterCapabilityRegistry.cjs | supervisor |
| executionAdapterSupervisor | agents/runtime/adapters/executionAdapterSupervisor.cjs | optional supervisor |

---

## SSE / Event Flow

```
Task executes in executionEngine.cjs
    → runtimeEventBus.cjs.emit(eventType, payload)
        [flood guard: max 20 events/s; stdout truncated at 4KB]
    → runtimeStream.cjs subscribes to eventBus
        → buffers events
        → flushes on interval to all active SSE clients
            → GET /runtime/stream (requires auth cookie)
                → ExecLogPanel.jsx in frontend
                    [reconnect burst suppression; history capped at 500 entries]
```

Event types emitted:
- `execution:log` — `{ executionId, action, status, timestamp, output?, error? }`
- `execution:state` — `{ executionId, status, timestamp }`
- `queue:update` — `{ size, pending, running }`

---

## Graceful Shutdown Flow

```
SIGTERM / SIGINT / SIGUSR2 received
    → _gracefulShutdown() called (idempotent, once-guard)
    → "JARVIS OS shutting down" logged
    → runtimeEventBus.stop()        (clears flush interval)
    → _httpServer.close()           (stops accepting new connections)
    → 5-second drain window         (active requests complete)
    → process.exit(0)
```

PM2 sends SIGINT with `kill_timeout: 8000ms` → safe overlap with 5s drain.

---

## Queue Persistence Flow

```
POST /runtime/queue
    → runtimeOrchestrator.queue(input, options)
        → priorityQueue.cjs enqueues task
        → agents/taskQueue.cjs persists to data/task-queue.json
            [file is JSON array; integrity-checked at every startup]
        → on server restart: taskQueue.recoverStale() promotes in-progress tasks
        → on drain: taskQueue.pruneOldTasks(50) removes oldest completed
```

---

## SQLite Usage Flow

```
backend/db/sqlite.cjs (singleton)
    → Database(data/jarvis.db, { journal_mode: WAL, synchronous: NORMAL })
    → Schema: tasks table + migration_log table
    → Used by:
        agents/runtime/executionHistory.cjs  (persists execution results)
        agents/taskQueue.cjs                  (queue persistence fallback)
    → closeDB() called in process shutdown handlers
```

---

## PM2 Production Flow

```
pm2 start ecosystem.config.cjs --env production
    → single fork instance (name: jarvis-os)
    → node_args: --max-old-space-size=400
    → max_memory_restart: 512M
    → listen_timeout: 15000ms
    → kill_timeout: 8000ms (> 5s shutdown drain)
    → logs: logs/pm2-out.log + logs/pm2-err.log
    → auto-restart on crash (no max_restarts limit)
```

---

## Active File Count (Verified)

| Layer | Count |
|-------|-------|
| backend/server.js + routes (11 routes) | 13 |
| backend/middleware | 5 |
| backend/services | 4 |
| backend/utils | 5 |
| backend/controllers | 1 |
| backend/db | 1 |
| agents/runtime (core) | 11 |
| agents/runtime/adapters | 10 |
| agents/runtime/control | 1 |
| agents (live root-level) | 9 |
| plugins/local-desktop | 3 |
| frontend/src (canonical) | ~15 |
| **Total active** | **~78** |

---

## Port Map

| Port | Service |
|------|---------|
| 5050 | Backend API + operator console (production) |
| 3000 | Frontend CRA dev server (development only) |
