# CORE_RUNTIME.md — JARVIS OS Runtime Architecture

**Audit Date:** 2026-05-15  
**Phase:** PRODUCTIZATION FREEZE — Audit & Stabilization  
**Status:** FROZEN — Do not add new subsystems

---

## What the Runtime Actually Is

JARVIS OS has a small, working core that handles all production traffic. Everything else is unused infrastructure that was written speculatively but never wired in. This document describes only what is real and running.

---

## Active Module Inventory

### Tier 1 — Entry Points (always loaded, blocking startup)

| Module | Path | Role |
|--------|------|------|
| `server.js` | `backend/server.js` | HTTP server, process lifecycle, startup orchestration |
| `routes/index.js` | `backend/routes/index.js` | Route barrel, mounts all HTTP handlers |
| `autonomousLoop.cjs` | `agents/autonomousLoop.cjs` | Background task queue poller, 10s interval |
| `taskQueue.cjs` | `agents/taskQueue.cjs` | Persistent JSON-file task queue |
| `runtimeEventBus.cjs` | `agents/runtime/runtimeEventBus.cjs` | SSE event bus, telemetry + heartbeat tickers |
| `runtimeStream.cjs` | `agents/runtime/runtimeStream.cjs` | SSE HTTP transport (`GET /runtime/stream`) |

### Tier 2 — HTTP Path (loaded when routes are mounted)

| Module | Path | Role |
|--------|------|------|
| `jarvisController.js` | `backend/controllers/jarvisController.js` | Main `/jarvis` gateway — parse + tool + AI |
| `toolAgent.cjs` | `agents/toolAgent.cjs` | OS action executor (URL, search, app, key) |
| `primitives.cjs` | `agents/primitives.cjs` | Low-level OS primitives (child_process, open) |
| `orchestrator.cjs` | `orchestrator.cjs` *(root)* | Legacy intelligence gateway (`gateway()`) |
| `runtimeOrchestrator.cjs` | `agents/runtime/runtimeOrchestrator.cjs` | Runtime dispatch/queue API |
| `executionEngine.cjs` | `agents/runtime/executionEngine.cjs` | Agent-routed task executor with retries |
| `agentRegistry.cjs` | `agents/runtime/agentRegistry.cjs` | Agent registry with circuit breakers |
| `taskRouter.cjs` | `agents/runtime/taskRouter.cjs` | type string → capability string mapping |
| `executionHistory.cjs` | `agents/runtime/executionHistory.cjs` | In-memory ring buffer (500 entries) |
| `memoryContext.cjs` | `agents/runtime/memoryContext.cjs` | Context injection wrapper |
| `priorityQueue.cjs` | `agents/runtime/priorityQueue.cjs` | In-memory priority queue (0=HIGH, 1=NORMAL, 2=LOW) |
| `bootstrapRuntime.cjs` | `agents/runtime/bootstrapRuntime.cjs` | Registers 5 agents at startup |

### Tier 3 — Lazy-loaded Execution

| Module | Path | Loaded by | Trigger |
|--------|------|-----------|---------|
| `planner.cjs` | `agents/planner.cjs` | autonomousLoop + runtimeOrchestrator | First task execution |
| `executor.cjs` | `agents/executor.cjs` | autonomousLoop + executionEngine | First unregistered task |
| `contextEngine.cjs` | `agents/contextEngine.cjs` | memoryContext | First task context lookup |

### Tier 4 — Registered Agents (loaded by bootstrapRuntime)

| Agent | Capability | maxConcurrent |
|-------|-----------|---------------|
| `desktopAgent.cjs` | `desktop` | 1 |
| `browserAgent.cjs` | `browser` | 3 |
| `terminalAgent.cjs` | `terminal` | 2 |
| `automationAgent.cjs` | `automation` | 2 |
| `devAgent.cjs` | `dev` | 2 |

### Tier 5 — Optional / Conditionally Active

| Module | Path | Loaded by | Condition |
|--------|------|-----------|-----------|
| `control/runtimeEmergencyGovernor.cjs` | `agents/runtime/control/` | `runtime.js` | `_tryRequire` — 503 if missing |
| `adapters/executionAdapterSupervisor.cjs` | `agents/runtime/adapters/` | `toolAgent.cjs` | Lazy via `_supervisor()` fn |

---

## The Three Execution Paths

Every task in JARVIS follows one of three paths. They are independent and parallel — there is no unified entry point.

```
PATH A — /jarvis (HTTP gateway, interactive)
  POST /jarvis
    → jarvisController.js
    → parser.parseCommand(input)
    → toolAgent.execute(parsed)        ← OS actions (URL, app, key, search)
       └─ primitives.cjs               ← actual child_process / open calls
    → orchestrator.cjs.gateway()      ← if tool result is empty
    → aiService.callAI()              ← final Groq fallback

PATH B — Autonomous Loop (background, scheduled)
  setInterval(10s)
    → taskQueue.getDuePending()
    → planner.cjs.plannerAgent(input)  ← decompose to sub-tasks
    → executor.cjs.executorAgent(task) ← 2099-line monolith executor
    → taskQueue.update(status)

PATH C — /runtime/dispatch (HTTP API, operator console)
  POST /runtime/dispatch
    → runtimeOrchestrator.dispatch()
    → planner.cjs.plannerAgent(input)
    → executionEngine.executeTask()
    → agentRegistry.findForCapability()
    → registeredAgent.handler()       ← or executor.cjs fallback
    → executionHistory.record()
```

**Critical observation:** PATH B and PATH C both use `planner.cjs` but different executors (`executor.cjs` vs `executionEngine.cjs → agentRegistry`). A task queued via PATH B bypasses the circuit breakers and agent registry entirely.

---

## Service Dependency Map

```
server.js
├── express, cors, node-telegram-bot-api
├── backend/utils/{logger, errorTracker, memoryTracker}
├── backend/middleware/{rawBody, requestLogger, rateLimiter, firebaseAuth}
├── backend/routes/index.js
│   ├── routes/{jarvis, whatsapp, telegram, payment, crm, ai, simulation, ops}
│   ├── routes/runtime.js
│   │   ├── agents/runtime/runtimeOrchestrator.cjs
│   │   │   ├── agents/runtime/agentRegistry.cjs
│   │   │   ├── agents/runtime/priorityQueue.cjs
│   │   │   ├── agents/runtime/executionEngine.cjs
│   │   │   │   ├── agents/runtime/taskRouter.cjs    (no deps)
│   │   │   │   ├── agents/runtime/executionHistory.cjs
│   │   │   │   └── [LAZY] agents/executor.cjs
│   │   │   ├── agents/runtime/executionHistory.cjs
│   │   │   ├── agents/runtime/memoryContext.cjs
│   │   │   │   └── [LAZY] agents/contextEngine.cjs
│   │   │   └── [LAZY] agents/planner.cjs
│   │   └── [OPTIONAL] agents/runtime/control/runtimeEmergencyGovernor.cjs
│   └── agents/runtime/runtimeStream.cjs
│       └── agents/runtime/runtimeEventBus.cjs
├── backend/services/{crm, payment, whatsapp, automation}Service.js
├── [ON LISTEN] agents/autonomousLoop.cjs
│   ├── agents/taskQueue.cjs
│   ├── [LAZY] agents/planner.cjs
│   └── [LAZY] agents/executor.cjs
├── [ON LISTEN] agents/runtime/bootstrapRuntime.cjs
│   ├── agents/runtime/runtimeOrchestrator.cjs (already loaded)
│   └── agents/{desktop, browser, terminal, automation, dev}Agent.cjs
└── [ON LISTEN] agents/runtime/runtimeEventBus.cjs.start()
```

---

## Data Files (Runtime State)

| File | Size | Growth | Bounded? |
|------|------|--------|----------|
| `data/task-queue.json` | 18KB | Per task | Yes — pruned to 50 by taskQueue |
| `data/memory-store.json` | 131KB | Per execution | **NO** — contextEngine writes, no eviction |
| `data/memory-index.json` | 141KB | Per execution | **NO** — grows with memory-store |
| `data/learning.json` | 53KB | Continuous | **NO** |
| `data/workflow-trust.json` | 36KB | Continuous | **NO** |
| `data/learning-patterns.json` | 29KB | Continuous | **NO** |
| `data/workflow-checkpoints/` | 3.5MB (908 dirs) | Per workflow | **NO** — no pruning found |
| `data/audit.log` | 48KB | Per request | **NO** — log rotation not found |

**Risk:** Four data files and the checkpoints directory grow without bound. At current rates, `memory-store.json` will exceed 1MB within weeks of active use.

---

## Configuration

| Variable | Service | Required | Default |
|----------|---------|----------|---------|
| `GROQ_API_KEY` | AI (Groq LLM) | **YES** | — |
| `PORT` | HTTP server | No | 5050 |
| `TELEGRAM_TOKEN` | Telegram bot | No | disabled |
| `FIREBASE_PROJECT_ID` | Firebase auth | No | disabled |
| `GOOGLE_API` | Google Maps | No | disabled |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payments | No | disabled |
| `WA_TOKEN` / `PHONE_NUMBER_ID` | WhatsApp | No | disabled |
| `BASE_URL` | Razorpay webhook | No | localhost (warning) |

---

## Production Readiness Summary

| Concern | Status |
|---------|--------|
| Task execution (PATH B) | ✔ Working |
| HTTP dispatch API (PATH C) | ✔ Working |
| Realtime SSE stream | ✔ Working |
| Operator UI | ✔ Working |
| Circuit breakers | ✔ Wired (PATH C only) |
| Graceful shutdown | ✔ Wired |
| Task queue persistence | ✔ Wired |
| Data file pruning | ⚠ Partial (task-queue only) |
| PATH A / PATH B / PATH C unified | ✗ Three separate paths |
| 323 unused modules | ✗ Dead weight |
| executor.cjs 2099-line monolith | ✗ Unmaintainable |
