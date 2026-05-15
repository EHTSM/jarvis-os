# STARTUP_FLOW.md

**Audit Date:** 2026-05-15  
**Measured port:** 5050

---

## Startup Sequence (Annotated)

```
node backend/server.js
│
├─ [0ms] dotenv.config() — load .env
│
├─ [0ms] ENV validation loop
│    Checks GROQ_API_KEY, TELEGRAM_TOKEN, FIREBASE_PROJECT_ID, GOOGLE_API
│    Checks RAZORPAY_KEY_ID/SECRET, WA_TOKEN/PHONE_NUMBER_ID
│    Logs WARN for missing required, INFO for missing optional
│
├─ [0ms] Synchronous require() — all blocking, no timeout protection
│    ├── express, cors, path                          (npm, fast)
│    ├── node-telegram-bot-api                        (npm, medium)  ⚠ always loaded
│    ├── backend/utils/logger.js                      (fast)
│    ├── backend/utils/errorTracker.js                (fast)
│    ├── backend/utils/memoryTracker.js               (fast)
│    ├── backend/middleware/rawBody.js                (fast)
│    ├── backend/middleware/requestLogger.js          (fast)
│    ├── backend/services/crmService.js               (reads leads.json from disk)
│    ├── backend/services/paymentService.js           (Razorpay SDK init)
│    ├── backend/services/whatsappService.js          (Meta API init)
│    ├── backend/services/automationService.js        (registers cron jobs)
│    └── backend/routes/index.js
│         ├── routes/jarvis.js → jarvisController.js
│         │    ├── agents/toolAgent.cjs
│         │    │    └── agents/primitives.cjs
│         │    ├── backend/utils/parser.js
│         │    ├── backend/services/aiService.js
│         │    └── [lazy] orchestrator.cjs, salesAgent, etc.
│         ├── routes/whatsapp.js, telegram.js, payment.js, crm.js
│         ├── routes/ai.js, simulation.js, ops.js
│         ├── routes/runtime.js
│         │    ├── agents/runtime/runtimeOrchestrator.cjs
│         │    │    ├── agents/runtime/agentRegistry.cjs
│         │    │    ├── agents/runtime/priorityQueue.cjs
│         │    │    ├── agents/runtime/executionEngine.cjs
│         │    │    │    ├── agents/runtime/taskRouter.cjs
│         │    │    │    ├── agents/runtime/executionHistory.cjs
│         │    │    │    └── agents/runtime/memoryContext.cjs
│         │    │    │         └── [lazy] agents/contextEngine.cjs  ⚠ reads disk
│         │    │    └── agents/runtime/executionHistory.cjs (shared)
│         │    └── [tryRequire] control/runtimeEmergencyGovernor.cjs
│         └── agents/runtime/runtimeStream.cjs
│              └── agents/runtime/runtimeEventBus.cjs  (SINGLETON — not started yet)
│
├─ [?ms] app.listen(5050) — HTTP server starts, port bound
│
└─ INSIDE listen callback (sequential, after port is bound):
     │
     ├─ memTracker.start()           — setInterval(30s) heap sampler
     │
     ├─ startTelegramBot()           — if TELEGRAM_TOKEN set, starts polling
     │
     ├─ automation.start()           — starts n8n cron jobs
     │
     ├─ autonomousLoop.start()       ← FIRST ASYNC ACTIVITY
     │    ├── taskQueue.recoverStale()    — rewrites disk file if any running→pending
     │    ├── re-register all cron tasks from queue file
     │    ├── setInterval(10s) — poll loop
     │    └── _tick() — immediate check for overdue tasks
     │         └─ [LAZY] loads planner.cjs, executor.cjs on first task
     │              └─ executor.cjs reads data/context-history.json (disk)
     │
     ├─ bootstrapRuntime.cjs (try/catch)
     │    ├── runtimeOrchestrator.registerAgent(desktopAgent)
     │    ├── runtimeOrchestrator.registerAgent(browserAgent)
     │    ├── runtimeOrchestrator.registerAgent(terminalAgent)
     │    ├── runtimeOrchestrator.registerAgent(automationAgent)
     │    └── runtimeOrchestrator.registerAgent(devAgent)
     │         (each agent loaded synchronously in try/catch — one failure = others continue)
     │
     ├─ runtimeEventBus.start()      ← SSE BUS ACTIVATED
     │    ├── setInterval(10s)  — telemetry tick (reads memTracker + errTracker + taskQueue)
     │    └── setInterval(30s)  — heartbeat tick
     │
     ├─ Queue integrity check        — reads and parses task-queue.json; resets if corrupt
     │
     └─ Startup diagnostics block    — reads CRM leads count, queue length, logs summary
```

---

## Startup Timing Estimates

| Phase | Estimated Time | Bottleneck? |
|-------|---------------|-------------|
| ENV validation | <5ms | No |
| npm module loads | 200-400ms | `node-telegram-bot-api` always loads |
| Service init (crm/payment/wa) | 50-100ms | Disk reads, SDK inits |
| Route mounting (all routes) | 100-200ms | `runtimeOrchestrator` chain |
| `app.listen()` | <10ms | No |
| Startup callback block | 100-300ms | `recoverStale()` disk write |
| **Total to ready** | **~500-1000ms** | |

---

## Startup Issues Identified

### Issue 1: `node-telegram-bot-api` loads unconditionally
**Impact:** ~50-100ms extra load time even when `TELEGRAM_TOKEN` is not set  
**Location:** `backend/server.js:46` — `require("node-telegram-bot-api")` at module scope  
**Fix:** Move inside `startTelegramBot()` function so it only loads when needed:
```javascript
// Current (always loads):
const TelegramBot = require("node-telegram-bot-api");
// Fixed (lazy):
function startTelegramBot() {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) { ... return; }
    const TelegramBot = require("node-telegram-bot-api"); // ← moved here
```

### Issue 2: `runtimeEventBus.cjs` loads synchronously in route mounting
**Impact:** The event bus singleton is instantiated during route mounting, before `start()` is called  
**Location:** `routes/index.js` → `runtimeStream.cjs` → `runtimeEventBus.cjs`  
**Risk:** Bus is partially initialized during startup window (ring buffer ready, tickers not yet started). Any event emitted before `server.js:283` calls `start()` is buffered but has no subscribers. This is safe but fragile.

### Issue 3: `contextEngine.cjs` lazy-loads and reads disk on first task
**Impact:** First task after startup has additional ~50ms disk I/O latency  
**Location:** `memoryContext.cjs:_engine()` → `ContextEngine` constructor reads `data/context-history.json`  
**Risk:** If `data/context-history.json` is large (currently 2.6KB, manageable), startup delay. If corrupt, throws silently.

### Issue 4: `autonomousLoop._tick()` fires immediately at startup
**Impact:** If there are overdue tasks in the queue at startup, they begin executing within the `listen()` callback, concurrently with `bootstrapRuntime.cjs` registering agents  
**Race condition:** A task requiring a registered agent (e.g., `browser`) may fire before `bootstrapRuntime.cjs` finishes registration. In PATH B, this falls through to `executor.cjs` anyway (autonomousLoop doesn't use agentRegistry), so the race is benign. But it is still logically surprising.  
**Fix:** Move `_tick()` to fire after a 2s delay, or move all startup steps before the `_tick()` call.

### Issue 5: `routes/legacy.js` silent failure
**Impact:** Legacy routes may silently fail to load  
**Location:** `server.js:76-79` — `try { app.use(require("./routes/legacy")); } catch {}`  
**Risk:** If legacy routes fail, that failure is swallowed. No error is surfaced, and routes depending on legacy handlers return 404 silently.

### Issue 6: All services load synchronously before HTTP server is ready
**Impact:** If `crmService.js`, `paymentService.js`, or `automationService.js` throw, the entire process dies before `app.listen()` is reached  
**Location:** `server.js:52-55`  
**Risk:** A bad leads.json file or Razorpay SDK init error will crash the server before it serves a single request.

---

## Startup Dependency Order (Critical Path)

The following must complete in order. Any failure here prevents the server from starting:

```
1. ENV validation                       (none, always runs)
2. express, cors, logger, errTracker    (npm, always succeed)
3. routes/index.js mounting             (loads entire runtime chain)
4. app.listen(PORT)                     ← server is UP here
5. memTracker.start()
6. autonomousLoop.start()               ← first task processing
7. bootstrapRuntime.cjs                 ← agents registered
8. runtimeEventBus.start()             ← SSE bus active
```

Steps 6-8 are inside the `listen()` callback and are sequential — a slow `bootstrapRuntime` will delay the event bus start.
