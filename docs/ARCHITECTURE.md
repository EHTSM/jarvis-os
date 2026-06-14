# JARVIS OS — Architecture

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20+, Express 4 |
| Frontend | React 18, Vite (dev) / CRA build (production) |
| Desktop | Electron 28+ (electron/main.cjs + main.js) |
| Database | SQLite via better-sqlite3, WAL mode |
| AI inference | Groq API (GROQ_API_KEY) |
| Auth | JWT (jsonwebtoken), bcrypt hashes |
| Process manager | PM2 (ecosystem.config.cjs) |
| Notifications | Telegram Bot API, WhatsApp Cloud API |
| Payments | Razorpay |
| Maps | Google Maps API |

## Backend Structure

```
backend/
  server.js              — Express entrypoint, env validation, middleware stack
  routes/
    index.js             — Route barrel (all domain routes mounted here)
    auth.js              — /auth/login, /auth/logout, /auth/me
    accounts.js          — /accounts/*
    billing.js           — /billing/*
    settings.js          — /settings/*
    runtime.js           — /runtime/* (dispatch, queue, status, history, emergency)
    phase18.js           — /p18/* (actions, agents, memory, cycles)
    phase19.js           — /p19/* (tools, coord, heal, learn)
    phase20.js           — /p20/* (agents, memory, improve, ooplix)
    phase21.js           — /p21/* (oauth, obs, live, readiness)
    phase22.js           — /p22/* (secrets, security, deploy, alerts)
    phase23.js           — /p23/* (github, review, release, autopilot)
    phase24.js           — /p24/* (vscode, repo, refactor, multirepo)
    phase25.js           — /p25/* (deploy, secrets, obs, search)
    phase26.js           — /p26/* (graph, memory, reason, observer, plugins, capabilities, manifest, templates)
    ops.js               — /health, /ops, /stats, /metrics, /api/status
    crm.js, ai.js, simulation.js, whatsapp.js, telegram.js, payment.js, tasks.js, browser.js
  middleware/
    authMiddleware.js    — JWT requireAuth guard
    firebaseAuth.js      — Firebase ID token verification
    rateLimiter.js       — Per-route sliding window rate limiting
    requestLogger.js     — Structured HTTP request logs
    requestId.js         — x-request-id injection
    rawBody.js           — Raw body capture for Razorpay HMAC
    operatorAudit.js     — Operator action audit trail
    compress.js          — gzip response compression (>=1 KB JSON)
  services/
    autonomousTaskLoop.cjs     — Goal → Task → Agent → Memory cycle engine
    agentExecutionEngine.cjs   — Task dispatch to named agents
    memoryPersistenceLayer.cjs — Agent memory store (save/recall/search)
    pluginSDK.cjs              — Plugin registry, capability registry, API manifest, templates
    taskGraph.cjs              — D1 multi-agent task graph execution
    semanticMemorySearch.cjs   — D2 TF-IDF semantic memory search
    reasoningEngine.cjs        — D3 reasoning, confidence scoring, risk analysis
    backgroundRuntime.cjs      — D4 background observer / proactive recommendations
    crmService.js, paymentService.js, whatsappService.js, automationService.js
  db/
    sqlite.cjs           — SQLite connection manager (WAL, schema, indexes, getStats)
  utils/
    logger.js, errorTracker.js, memoryTracker.js, execLog.cjs, auditLog.cjs
```

## Agent Runtime

The `agents/runtime/` directory contains 310 specialized runtime modules covering:

- **Core orchestration**: runtimeOrchestrator.cjs, runtimeEventBus.cjs, runtimeStream.cjs (SSE)
- **Execution history**: executionHistory.cjs, deadLetterQueue.cjs
- **Emergency control**: control/runtimeEmergencyGovernor.cjs
- **Specialized agents**: sales, marketing, seo, support, research, dev, devops, analytics, content, runtime
- **Autonomous flows**: dailyAutonomousFlows, longHorizonContinuity, selfHealingPipeline, multiProjectRuntime
- **Engineering automation**: 100+ modules for deployment, debugging, refactoring, workspace management

All routes below `/runtime/` require JWT authentication (set in `routes/index.js` via `requireAuth` before mounting).

## Data Persistence

| Store | Path | Purpose |
|---|---|---|
| SQLite | data/jarvis.db | Tasks, scheduler queue, migration log |
| JSON files | data/autonomous-cycles.json | Cycle history (last 500) |
| JSON files | data/learning-patterns.json | Learning log (last 1000) |
| JSON files | data/cycle-queue.json | Concurrency overflow queue |
| JSON files | data/plugin-registry.json | Registered plugins |
| JSON files | data/capability-registry.json | Capability map |
| JSON files | data/api-manifest.json | API manifest cache (1h TTL) |
| JSON files | data/workflow-library.json | Workflow templates |
| Log files | logs/ | PM2 out/err, runtime-alerts.log |

All JSON writes use atomic tmp-file + rename to prevent corruption on crash.

SQLite uses WAL mode (`journal_mode = WAL`, `synchronous = NORMAL`) for concurrent readers with one writer. Indexes: `idx_tasks_status`, `idx_tasks_scheduled`, `idx_tasks_created`.

## Track D Intelligence Layer

Implemented across `backend/services/` and routed at `/p26/*`:

- **D1 — Multi-Agent Task Graph** (`taskGraph.cjs`): Create, execute, and monitor DAG-based task graphs where multiple agents collaborate on a goal. Routes: `POST /p26/graph`, `GET /p26/graph/:id`, etc.
- **D2 — Semantic Memory Search** (`semanticMemorySearch.cjs`): TF-IDF semantic search across typed memories (failure/success/decision/knowledge). Routes: `POST /p26/memory/search`, `GET /p26/memory/knowledge-graph`, etc.
- **D3 — Reasoning Engine** (`reasoningEngine.cjs`): Explains recommendations, scores confidence, analyzes risk, generates rollback plans, and performs root-cause analysis. Routes: `GET /p26/reason/:recId`, `POST /p26/reason/confidence`, etc.
- **D4 — Background Runtime Observer** (`backgroundRuntime.cjs`): Long-running observers generate proactive recommendations without blocking the main request path. Routes: `POST /p26/observer/start`, `GET /p26/observer/recommendations`, etc.
- **D5 — Plugin SDK + Capability Registry** (`pluginSDK.cjs`): Third-party plugins register capabilities and lifecycle hooks. The API manifest (TTL 1h) documents all ~300 endpoints. Routes: `POST /p26/plugins`, `GET /p26/capabilities`, `GET /p26/manifest`, `POST /p26/templates`, etc.

## Authentication

Two-layer auth:

1. **Operator JWT** — `POST /auth/login` validates `OPERATOR_PASSWORD_HASH` (bcrypt), returns a signed JWT. All `/runtime/*` routes require `Authorization: Bearer <token>` via `authMiddleware.js`.
2. **Firebase Auth** — `firebaseAuth.js` middleware verifies Firebase ID tokens for user-facing routes (accounts, billing). Requires `FIREBASE_PROJECT_ID`.

In production, `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` are hard requirements. Without them, `/auth/*` and `/runtime/*` return 503.

Dev mode: auth env missing → passthrough (logged at startup).

## Observability

- **Request logging**: every HTTP request gets a `x-request-id` header and a structured log line (method, path, status, ms).
- **Error tracking**: `errorTracker.js` aggregates unhandled errors with frequency counts.
- **Memory tracking**: `memoryTracker.js` warns when Node.js heap exceeds 350 MB (PM2 hard-restarts at 512 MB).
- **Execution audit**: `auditLog.cjs` records operator dispatch events.
- **Runtime alerts**: fire-and-forget Telegram alerts to `TELEGRAM_OPERATOR_CHAT_ID`; falls back to `data/runtime-alerts.log`.
- **PM2 logs**: `logs/pm2-out.log`, `logs/pm2-err.log` (rotate at 10 MB, keep 5 files).
- **P21 observability routes**: custom metrics, structured logs, alert rules, synthetic health probes, telemetry snapshots.
- **P25 enterprise observability**: distributed tracing spans, SLOs, service dependency map, alert notification channels.

## Ports

| Service | Port | Notes |
|---|---|---|
| Backend API | 5050 | `process.env.PORT` (default 5050) |
| Frontend dev server | 3000 | CRA dev (`npm run frontend`) |
| Electron | — | Loads localhost:3000 (dev) or frontend/build (production) |
