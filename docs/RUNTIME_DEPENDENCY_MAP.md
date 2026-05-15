# RUNTIME_DEPENDENCY_MAP.md

**Audit Date:** 2026-05-15

---

## Legend

```
─── synchronous require() at module load time
···  lazy require() inside a function (deferred until first use)
[?]  _tryRequire / try-catch optional load (missing = silent degrade)
[×]  module exists but is unreachable from any production entry point
```

---

## Full Dependency Graph — Production Critical Path Only

```
┌─────────────────────────────────────────────────────────────────────┐
│                        server.js (ENTRY)                            │
│  PORT=5050, process lifecycle, graceful shutdown, startup sequence  │
└───────────┬─────────────────────────────────────────────────────────┘
            │
  ┌─────────┼──────────────────────────────────────────────────────┐
  │         │ synchronous require at module load                   │
  │         ▼                                                       │
  │  backend/utils/
  │    ├── logger.js          (pino or console wrapper)
  │    ├── errorTracker.js    (in-memory error rate ring buffer)
  │    └── memoryTracker.js   (setInterval heap sampler)
  │
  │  backend/middleware/
  │    ├── rawBody.js         (Razorpay HMAC - must be before json())
  │    ├── requestLogger.js   (structured HTTP access log)
  │    └── rateLimiter.js     (per-route token bucket)
  │
  │  backend/services/
  │    ├── crmService.js      (JSON file CRUD)
  │    ├── paymentService.js  (Razorpay SDK)
  │    ├── whatsappService.js (Meta Graph API)
  │    └── automationService.js (n8n webhooks, cron jobs)
  │
  │  node_modules/
  │    ├── express, cors, path, fs
  │    └── node-telegram-bot-api
  └─────────────────────────────────────────────────────────────────┘
            │
  ┌─────────▼───────────────────────────────────────────────────────┐
  │               backend/routes/index.js                           │
  │         (barrel — mounts all routes in priority order)          │
  └───────────────────────────────────┬─────────────────────────────┘
                                      │
      ┌───────────────────────────────┼──────────────────────────┐
      │                               │                          │
      ▼                               ▼                          ▼
routes/jarvis.js            routes/runtime.js          runtimeStream.cjs
      │                               │                          │
      ▼                               │                          ▼
jarvisController.js          runtimeOrchestrator.cjs    runtimeEventBus.cjs
  │   │   │                    │  │  │  │  │              (singleton bus)
  │   │   │                    │  │  │  │  └── [?] control/runtimeEmergencyGovernor.cjs
  │   │   │                    │  │  │  └── memoryContext.cjs
  │   │   │                    │  │  │        └·· contextEngine.cjs (lazy)
  │   │   │                    │  │  │              └── data/context-history.json (disk)
  │   │   │                    │  │  └── executionHistory.cjs (in-memory ring 500)
  │   │   │                    │  └── priorityQueue.cjs (in-memory, 3 priorities)
  │   │   │                    └── executionEngine.cjs
  │   │   │                          ├── agentRegistry.cjs
  │   │   │                          │     (circuit breaker + concurrency slots)
  │   │   │                          ├── taskRouter.cjs (no deps — pure lookup table)
  │   │   │                          ├── executionHistory.cjs (shared singleton)
  │   │   │                          ├── memoryContext.cjs (shared singleton)
  │   │   │                          └·· executor.cjs (lazy fallback, 2099 lines)
  │   │   │
  │   │   └── toolAgent.cjs
  │   │         ├── primitives.cjs (open, robot.js, child_process)
  │   │         ├── backend/utils/parser.js
  │   │         └·· [?] adapters/executionAdapterSupervisor.cjs (lazy, rarely used)
  │   │
  │   └── aiService.js (Groq API)
  │
  └·· orchestrator.cjs (root, lazy, 388 lines)
        └── aiService.js (Groq)

                   ┌──────────────────────────────────────────────┐
  ON LISTEN:       │          autonomousLoop.cjs                  │
                   │  setInterval(10s) → poll taskQueue           │
                   │    ├── taskQueue.cjs (disk-backed JSON)       │
                   │    ├·· planner.cjs (lazy)                    │
                   │    └·· executor.cjs (lazy, 2099 lines)       │
                   └──────────────────────────────────────────────┘

                   ┌──────────────────────────────────────────────┐
  ON LISTEN:       │       bootstrapRuntime.cjs                   │
                   │  registers 5 agents in agentRegistry         │
                   │    ├── desktopAgent.cjs (robot.js)           │
                   │    ├── browserAgent.cjs (open/puppeteer)     │
                   │    ├── terminalAgent.cjs (child_process)     │
                   │    ├── automationAgent.cjs (n8n webhook)     │
                   │    └── devAgent.cjs (code gen)               │
                   └──────────────────────────────────────────────┘

                   ┌──────────────────────────────────────────────┐
  ON LISTEN:       │    runtimeEventBus.cjs.start()               │
                   │  setInterval(10s) → telemetry tick            │
                   │  setInterval(30s) → heartbeat tick            │
                   │  emits to SSE subscribers                    │
                   └──────────────────────────────────────────────┘
```

---

## Shared Singletons (Cross-Module State)

These modules are singletons — the same instance is shared by all callers.

| Singleton | Shared by | State held |
|-----------|-----------|------------|
| `agentRegistry.cjs` | bootstrapRuntime + executionEngine + runtimeOrchestrator | Agent Map, circuit breaker state, active slots |
| `executionHistory.cjs` | executionEngine + runtime.js routes + runtimeEventBus | In-memory ring buffer 500 entries |
| `taskQueue.cjs` | autonomousLoop + server.js startup + task:added/updated hooks | JSON file on disk |
| `runtimeEventBus.cjs` | runtimeStream + executionHistory + taskQueue + server.js | Subscriber Map, ring buffer 500 events |
| `memoryContext.cjs` → `contextEngine.cjs` | executionEngine + runtimeOrchestrator | In-memory conversation history + disk write |
| `priorityQueue.cjs` | runtimeOrchestrator | In-memory queue array |
| `errorTracker.js` | server.js + ops.js + runtimeEventBus telemetry | In-memory error ring buffer |
| `memoryTracker.js` | server.js + ops.js + runtimeEventBus telemetry | setInterval heap sampler |

---

## Inbound/Outbound Dependency Count (core modules)

| Module | Inbound (required by) | Outbound (requires) | Complexity |
|--------|----------------------|---------------------|------------|
| `agentRegistry.cjs` | 3 | 1 (logger) | LOW |
| `taskRouter.cjs` | 1 | 0 | LOWEST |
| `executionHistory.cjs` | 4 | 1 (runtimeEventBus) | LOW |
| `priorityQueue.cjs` | 1 | 0 | LOWEST |
| `executionEngine.cjs` | 1 | 5 | MEDIUM |
| `runtimeOrchestrator.cjs` | 2 | 6 | MEDIUM |
| `autonomousLoop.cjs` | 1 | 2+lazy | MEDIUM |
| `runtimeEventBus.cjs` | 4 | 3 (lazy) | MEDIUM |
| `executor.cjs` | 2 | many | **HIGH (2099 lines)** |
| `jarvisController.js` | 1 | 9 | **HIGH** |

---

## Modules Reachable vs Unreachable

```
Total .cjs modules in agents/: 831

Reachable from production entry points: ~30 modules
  (server.js → routes → controllers → agents → runtime core)

Unreachable / dead: ~801 modules
  ├── agents/runtime subdirs (323): all 36 directories unreachable
  │   EXCEPTION: control/runtimeEmergencyGovernor (1) — optional load
  │   EXCEPTION: adapters/executionAdapterSupervisor (1) — lazy in toolAgent
  │
  └── agents/*.cjs root-level unused (~20):
        evolutionEngine, agentFactory, AgentGenerator, MasterAgentManager,
        learningSystem, leadScoring, fiverrLeads, linkedinLeads, googleMapsLeads,
        realLeadsEngine, leadsInjector, followUpSequence, reelAgent, saas,
        router.cjs, agentRouter.cjs, crm.cjs, leads.cjs, marketingAgent,
        voiceSales, paymentAgent, salesBrain, instagram
```

---

## Circular Dependency Analysis

No circular dependencies exist in the production critical path. The design uses lazy loading to break potential cycles:

| Potential Cycle | Break Point | Method |
|-----------------|-------------|--------|
| `runtimeOrchestrator` → `planner` → back | `planner` lazy-loaded | `_getPlanner()` fn |
| `executionEngine` → `executor` → tasks | `executor` lazy-loaded | `_getLegacy()` fn |
| `autonomousLoop` → `planner/executor` | Both lazy-loaded | `_getPlanner()`, `_getExecutor()` |
| `memoryContext` → `contextEngine` | `contextEngine` lazy-loaded | `_engine()` fn |
| `toolAgent` → `executionAdapterSupervisor` | Supervisor lazy-loaded | `_supervisor()` fn |

**Risk: LOW** — all existing circular dep risks are properly broken with lazy loading.
