# Architecture Overview

## Design Principles

1. **Single-process, single-machine** — no microservices, no distributed state. One Node.js process manages everything. This is intentional: solo founders need a system they can deploy and operate without DevOps expertise.

2. **File-based persistence** — JSON files in `data/` are the primary store. SQLite is used for structured queries where JSON falls short. No external database to provision, backup, or migrate.

3. **AI is infrastructure, not a feature** — the smart router treats AI providers like a utility. Provider failures trigger automatic fallback. Credits are metered per request regardless of which provider handles it.

4. **Frontend/backend split with IPC bridge** — React frontend communicates with the Express backend via HTTP (in desktop mode: over localhost IPC, in web mode: over nginx proxy). This makes the same codebase work as a desktop app, a web app, and a VPS-hosted SaaS.

---

## System Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Electron 41                               │
│  main.cjs — window management, IPC, loadFile for SPA               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ IPC / HTTP
┌───────────────────────────────▼─────────────────────────────────────┐
│                    React 18 Frontend                                 │
│                                                                     │
│  ElectronWorkspace.jsx — bottom tab registry, lazy panel loading    │
│  CommandPalette.jsx    — global keyboard navigation                 │
│  LazyPane.jsx          — Suspense + ErrorBoundary for each tab      │
│                                                                     │
│  Panels: Mission · CRM · Dev Workspace · Growth · Analytics · Git  │
│          Business OS · Knowledge Graph · Launch Platform · Founder  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ fetch + credentials:include
┌───────────────────────────────▼─────────────────────────────────────┐
│              Express 5 Backend  (backend/server.js)                 │
│                                                                     │
│  Middleware stack (in order):                                       │
│    requestId → rawBody → compress → requestLogger → CORS            │
│    → rateLimiter → operatorAudit → authMiddleware                   │
│                                                                     │
│  Route barrel (backend/routes/index.js):                            │
│    auth · accounts · settings · billing · metrics                   │
│    → billing gate (requireActiveAccount)                            │
│    → 50+ route files covering all domains                           │
│                                                                     │
│  Services (backend/services/):                                      │
│    AI: smartRouter · creditEngine · aiBenchmarkLab                  │
│    Business: crmService · billingService · paymentService            │
│    Agents: autonomousTaskLoop · agentExecutionEngine                │
│    Growth: growthOS · referralEngine · founderJournal               │
│    Platform: launchMetrics · academyEngine · feedbackHub            │
│    Deployment: deploymentReport · pipReport · pcpReport             │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ fs
┌───────────────────────────────▼─────────────────────────────────────┐
│                    Persistence Layer                                 │
│                                                                     │
│  data/*.json  — flat JSON files, one per domain                     │
│  data/*.db    — SQLite (WAL mode) for structured queries            │
│  data/logs/   — PM2 structured HTTP logs                            │
│  backups/     — daily tar.gz snapshots (7-file retention)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## AI Architecture

```
User goal
    │
    ▼
Smart Router (smartRouter.cjs)
    │
    ├── Provider 1: Groq (fastest, default)
    ├── Provider 2: OpenAI (fallback)
    └── Provider 3: Anthropic (final fallback)
         │
         ▼ (on all providers)
Credit Engine (creditEngine.cjs)
    │
    ├── BYOK detection (if user supplies own key → 0 credits consumed)
    └── Credit deduction (consume per-request)
         │
         ▼
Autonomous Task Loop (autonomousTaskLoop.cjs)
    │
    ├── Task Queue (priority: HIGH/NORMAL/LOW)
    ├── Agent Dispatch (agentExecutionEngine.cjs)
    │     ├── planner, reviewer, verifier, strategist
    │     ├── security_analyst, performance_optimizer
    │     └── documentation_writer, test_generator
    │
    ├── Memory System (memoryPersistenceLayer.cjs)
    │     └── TF-IDF semantic search (engineeringMemory.cjs)
    │
    └── Self-Healing (healingEngine.cjs)
          ├── Root Cause Analysis → 5 RCA algorithms
          ├── Strategy Selection → 8 recovery strategies
          └── Playbook execution → 4 built-in playbooks
```

---

## Key Architectural Decisions

### Why JSON files instead of PostgreSQL?

Solo founders deploying to a single VPS do not want to manage a database. JSON files are trivially backed up, inspectable with any editor, and survive a `cp -r data/ backup/`. SQLite is added for cases where JSON falls short (structured queries, full-text search). If Ooplix needs to scale to thousands of concurrent users, migrating to PostgreSQL is straightforward — the service layer abstracts persistence.

### Why Electron instead of a pure web app?

Desktop-first enables features that require system access: PTY terminal, native file operations, VS Code extension integration, local model inference. The same React frontend runs as a web app in a browser — the `window.electronAPI` bridge is optional and gracefully degrades.

### Why CommonJS instead of ESM?

Electron's main process uses CommonJS. Backend services use `.cjs` to make the module system explicit and avoid dual-mode footguns. The React frontend uses ESM (bundled by CRA). The two halves never import from each other directly.

### Why PM2 fork mode instead of cluster?

The task queue, session store, and agent registry are in-process singletons. Cluster mode would require extracting these to Redis, adding operational complexity. Fork mode with a 512 MB ceiling and `max_restarts: 5` gives adequate reliability for the target deployment scale.

---

## Data Flow: Mission Execution

```
1. User enters goal in Mission Control panel
2. POST /mission/runtime/create  → missionService.createMission()
3. Mission queued in autonomousTaskLoop
4. planner agent → task breakdown (3–7 sub-tasks)
5. Each sub-task dispatched to specialist agent
6. Results stored in memoryPersistenceLayer
7. reviewer agent → quality gate
8. verifier agent → output validation
9. Mission status updated → SSE event pushed to frontend
10. User sees result in real time
```

---

## Extension Points

| Extension | How |
|---|---|
| New AI provider | Add to `smartRouter.cjs` provider chain |
| New automation integration | Add normalizer in `B4 External Integration` |
| New bottom panel tab | Register in `BOTTOM_TABS` in `ElectronWorkspace.jsx` |
| New API route group | Add file in `backend/routes/`, mount in `backend/routes/index.js` |
| New plugin | Use Plugin SDK — see [docs/api/PLUGIN_SDK.md](../api/PLUGIN_SDK.md) |
