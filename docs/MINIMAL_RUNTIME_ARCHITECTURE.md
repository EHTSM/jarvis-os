# MINIMAL_RUNTIME_ARCHITECTURE.md

**Date:** 2026-05-15  
**Purpose:** The exact minimum set of files required to run JARVIS OS in production. Everything else is dead code.

---

## Complete Live File List

### Backend (6 files)
```
backend/server.js                      ← Express entry point + PM2 target
backend/routes/index.js                ← Route aggregator + auth gate
backend/routes/auth.js                 ← Login (rate limited), logout, /me
backend/routes/runtime.js              ← dispatch, queue, status, DLQ, logs, SSE
backend/middleware/authMiddleware.js    ← JWT sign/verify (HS256, scrypt, no deps)
backend/middleware/rateLimiter.js       ← Per-IP in-memory rate limiter
```

### Backend Utilities (2 files)
```
backend/utils/logger.js                ← Structured logger (+ optional LOG_FILE sink)
backend/utils/execLog.cjs              ← Persistent NDJSON execution log
```

### Runtime Core — agents/runtime/ (12 files)
```
agents/runtime/bootstrapRuntime.cjs    ← Registers 5 production agents on startup
agents/runtime/agentRegistry.cjs       ← Circuit breaker + concurrency slot tracking
agents/runtime/executionEngine.cjs     ← Retries, backoff, timeout, DLQ hook
agents/runtime/executionHistory.cjs    ← 500-entry ring + disk bridge
agents/runtime/runtimeEventBus.cjs     ← SSE ring buffer + subscriber mgmt
agents/runtime/runtimeOrchestrator.cjs ← dispatch(), queue(), status()
agents/runtime/runtimeStream.cjs       ← SSE endpoint (/runtime/stream)
agents/runtime/taskRouter.cjs          ← task.type → capability string
agents/runtime/priorityQueue.cjs       ← In-memory priority queue
agents/runtime/deadLetterQueue.cjs     ← Persistent DLQ (data/dead-letter.json)
agents/runtime/memoryContext.cjs       ← Context injection for tasks
agents/runtime/control/runtimeEmergencyGovernor.cjs  ← E-stop / resume
```

### Production Agents (5 files)
```
agents/desktopAgent.cjs                ← robotjs: open_app, key_combo (maxConcurrent=1)
agents/browserAgent.cjs                ← URL safety + open/search (maxConcurrent=3)
agents/terminalAgent.cjs               ← Shell exec + allowlist (maxConcurrent=2)
agents/automationAgent.cjs             ← n8n webhook dispatch (maxConcurrent=2)
agents/devAgent.cjs                    ← Groq codegen (maxConcurrent=2)
```

### Shared Agent Utilities (2 files)
```
agents/planner.cjs                     ← Task decomposition (regex + AI)
agents/primitives.cjs                  ← openURL, webSearch primitives
```

### Frontend (10 files)
```
frontend/src/contexts/AuthContext.jsx
frontend/src/components/auth/LoginPage.jsx
frontend/src/components/operator/OperatorConsole.jsx
frontend/src/components/operator/TaskQueuePanel.jsx
frontend/src/components/operator/ExecLogPanel.jsx
frontend/src/components/operator/GovernorPanel.jsx
frontend/src/components/operator/WorkflowPanel.jsx
frontend/src/components/operator/AdapterPanel.jsx
frontend/src/components/operator/TelemetryPanel.jsx
frontend/src/components/operator/AIConsolePanel.jsx
```

### Data Files (Persistent State)
```
data/task-queue.json                   ← Persistent task queue (atomic write)
data/dead-letter.json                  ← Failed tasks (DLQ, max 1000)
data/logs/execution.ndjson             ← Execution log (rotate 10MB, prune 7d)
```

---

## Dispatch Flow (3 Hops)

```
POST /runtime/dispatch
        │
        ▼
runtimeOrchestrator.dispatch(input)
        │
        ├── planner.plannerAgent(input)     → [{type, label, payload}]
        │
        ▼
executionEngine.executeTask(task)
        │
        ├── taskRouter.resolveCapability(task.type)  → "terminal"|"browser"|...
        ├── agentRegistry.findForCapability(cap)     → agent slot
        ├── agent.handler(task)                      → result
        └── [failure] → deadLetterQueue.push()
        │
        ▼
runtimeEventBus.emit("execution", entry) → SSE → OperatorConsole
```

---

## Agent Capabilities

| Agent | Capability String | Max Concurrent | Handler |
|-------|------------------|----------------|---------|
| desktopAgent | `desktop` | 1 | robotjs keyboard/app |
| browserAgent | `browser` | 3 | primitives.openURL / webSearch |
| terminalAgent | `terminal` | 2 | child_process.exec + allowlist |
| automationAgent | `automation` | 2 | n8n webhook POST |
| devAgent | `dev` | 2 | Groq API codegen |

---

## Circuit Breaker (Per Agent)

```
Thresholds: 5 consecutive failures → open, 60s cooldown, probe success → closed
States: closed (normal) → open (blocked) → half-open (1 probe) → closed
```

---

## What Was Removed (344 Files)

The 344 deleted files were generated as speculative "enterprise features" across 41 subdirectories. They were never imported into the production dispatch chain. Examples of removed modules:

- `evolution/` — genetic algorithms for adaptive optimization
- `intelligence/` — ML-based routing intelligence
- `governance/` — policy authority and QoS management
- `orchestration/` — duplicate orchestration layer
- `observability/` — 25-file metrics and health scoring stack
- `trust/` — hallucination detection and trust scoring
- `benchmark/` — performance benchmarking infrastructure

**None of these affected production behavior. Zero functionality was lost.**
