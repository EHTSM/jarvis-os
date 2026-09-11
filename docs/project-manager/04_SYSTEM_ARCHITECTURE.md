# 04 — System Architecture

**Status of this document:** VERIFIED against direct reads of `backend/server.js`, `backend/routes/index.js`, `electron/main.cjs`, and `frontend/src/api.js`. Diagram is a structural summary of confirmed code paths, not aspirational.

---

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Electron 41 Shell (Desktop)                 │
│  contextIsolation:true · nodeIntegration:false · FS/nav allowlists   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │              React 18 Frontend (74 nav screens)               │   │
│  │  Dashboard·CRM·Dev Workspace·Growth·Intelligence·Engineering  │   │
│  └─────────────────────────┬───────────────────────────────────┘    │
│                            │ window.electronAPI (IPC) → axios        │
│  (same frontend build is also served directly over HTTPS by nginx    │
│   for the web/VPS deployment — no Electron layer in that path)       │
└─────────────────────────┬────────────────────────────────────────────┘
                          │ HTTP (/jarvis, /ai/chat, /business/*, ...)
┌─────────────────────────▼────────────────────────────────────────────┐
│                 Express 5 Backend — port 5050                        │
│  Middleware: rawBody → requestId → json → security headers → CORS    │
│              → compress → requestLogger → static → routes → SPA      │
│                                                                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────────────┐ │
│  │ AI Router  │ │  Mission   │ │  Knowledge │ │  127 route files, │ │
│  │ 12 providers│ │ Orchestrator│ │  Graph +   │ │  126 requireAuth- │ │
│  │ + fallback │ │ + agentRegistry│ │  Memory (TF-IDF)│ │  gated        │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────────┬─────────┘ │
│        │              │              │                    │          │
│  ┌─────▼──────────────▼──────────────▼────────────────────▼──────┐  │
│  │   367 backend service files (287 business logic, 34 honest    │  │
│  │   simulation, 24 local exec, 19 real external integration)    │  │
│  └─────────────────────────────┬──────────────────────────────────┘ │
│  ┌─────────────────────────────▼──────────────────────────────────┐ │
│  │  Persistence: 408 flat JSON files in /data (per-subsystem) +   │ │
│  │  1 SQLite table (task queue, WAL mode, better-sqlite3)         │ │
│  │  NO general-purpose DB. NO tenant-isolation boundary.          │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
  External: Groq · OpenAI · Anthropic(code-ready) · Gemini(code-ready)
  Razorpay · Telegram · WhatsApp Cloud API · GitHub/Slack/Notion/etc.(waiting on creds)
```

## Browser / Web Layer

The React frontend is a single build artifact (`frontend/build/`) served two ways:
1. **Web/VPS deployment**: served directly by nginx as static files, with the Express backend reverse-proxied on the same or a sibling domain (`ooplix.com` family — see `nginx.conf`).
2. **Electron desktop**: the identical build is loaded via `win.loadFile()` from inside the packaged app's `asar` archive (production) or via `win.loadURL('http://localhost:3000')` against the CRA dev server (development).

The frontend never talks to the backend differently based on which shell it's in beyond URL resolution — `sendMessage()` in `frontend/src/api.js` branches on `_isElectron()`: inside Electron it calls `window.electronAPI.sendCommand()` (IPC to the main process, which proxies to `POST /jarvis` via axios); as a plain web app it calls `fetch()` directly against the same relative path.

## Electron Layer

`electron/main.cjs` (1,633 lines) is a full desktop shell: multi-window management (main/floating/splash/settings), system tray, native notifications, auto-updater (`electron-updater`, pointed at the real GitHub release feed), deep-link handling (`ooplix://` protocol), global shortcuts, PTY terminal session management (`node-pty`), git operation IPC handlers, and crash forensics.

**Backend lifecycle in Electron**: in development, the backend is started separately (`npm run dev:full` via `concurrently`) — Electron does not spawn it. In a packaged build, Electron spawns `backend/server.js` as a child process using its own bundled Node runtime (`ELECTRON_RUN_AS_NODE=1`), reading the entry point from inside `app.asar`. This exact mechanism was live-verified in the 2026-07-17 audit to reach a real backend `/health` 200 — even though a full windowed GUI launch could not be tested in that non-interactive environment.

## Backend / API Layer

`backend/server.js` startup sequence (verified in full):
1. Env loading and validation — hard-fails (logs, doesn't crash) in production if `JWT_SECRET`/`OPERATOR_PASSWORD_HASH` are missing; auth routes degrade to 503 rather than the whole process crashing.
2. Middleware, in exact order: raw-body capture (for Razorpay HMAC, must precede JSON parsing) → request-ID injection → JSON/urlencoded body parsing → hand-rolled security headers (CSP with per-request nonce in production, HSTS, X-Frame-Options, etc. — no `helmet` dependency) → CORS (hardcoded production origin allowlist unioned with `ALLOWED_ORIGINS`) → gzip compression → structured request logging → static frontend serving → the full route barrel → SPA fallback → a global JSON/error handler.
3. **127 route files** mounted via a single barrel (`backend/routes/index.js`), which explicitly documents that import order determines Express match priority for overlapping prefixes. A `_deprecate()` middleware factory tags legacy `/p18`–`/p27` "phase" route prefixes with `Deprecation`/`Link` headers pointing at their canonical replacements — these routes remain fully functional, this is an observability layer only, not a removal.
4. **126 of 127 route files require authentication**; only health checks, login/register, and webhooks are intentionally public. The barrel's own comments document at least 3 places where an in-route `requireAuth` guard resolved to a no-op due to a bad require path (`/agents`, `/computer`, `/twin`, `/workforce-os`) — compensated for by an explicit barrel-level `router.use(prefix, requireAuth)` placed ahead of the mount. This was live-verified fixed and holding under a real second-identity attack test in the 2026-07-17 audit.
5. After `app.listen()` succeeds, a long sequence of deferred subsystem starts fires (moved out of module scope specifically to avoid a prior heap-limit crash): the continuous learning engine, self-healing runtime probe, secret rotation automation, the autonomous task loop, the realtime SSE event bus, and — notably — **13 sequential "Level"/"Phase" organization registrations** (BackgroundRuntime, MissionOrchestrator, DecisionEngine, and 10 numbered "Org" layers from EngineeringOrg through PlatformOrg), each wrapped in its own try/catch so one failing does not take down the server.

## AI Runtime

`backend/services/aiService.js` implements a 12-provider router with capability-based routing (`routeByCapability()` maps task types like `reasoning`/`coding`/`fast`/`cheap` to a preferred provider order) and a fallback chain (`callAI()`/`chat()` iterate providers on failure). See [07_AI_CAPABILITIES.md](07_AI_CAPABILITIES.md).

## Mission Engine

A genuine multi-file pipeline, not a single monolith:

```
Decision → missionOrchestrator.cjs (plans stages)
         → agents/runtime/taskRouter.cjs + agentRegistry.cjs (capability routing)
         → agents/autonomousLoop.cjs (execution)
         → missionMemory.cjs + agents/runtime/missionRuntime.cjs (tracking/lifecycle)
         → taskGraph.cjs (dependency topology)
         → runtimeEventBus.cjs (event fan-out)
```

Mission lifecycle states, per the orchestrator's own header comment: `Created → Planned → Queued → Executing → Waiting → Retrying → Completed → Failed → RolledBack`. Live-verified in the audit: `POST /missions/orchestrator/create` produces a real mission with an auto-decomposed multi-stage plan; `GET /mission/runtime/status` showed 19 real active missions with real subtask breakdowns during the audit session.

## Memory

Two distinct systems, both independently verified as real (not stub) in this documentation effort:
- **`semanticMemorySearch.cjs`** — a genuine from-scratch TF-IDF search engine (pure JS, no external dependency): `_tfidfVector()`, cosine-similarity `_tfidfSearch()`.
- **`memoryPersistenceLayer.cjs`** and related services — `remember()`/`recall()` with real fs persistence.

## Knowledge Graph

`backend/services/knowledgeGraph.cjs` implements a real, typed graph over existing canonical stores rather than duplicating data: **15 node types** (mission, user, team, org, department, lead, opportunity, campaign, lesson, rca, rule, artifact, deployment, event, step) and **18 relation types** (owns, belongs_to, assigned_to, references, produced, triggered_by, governed_by, learned, linked_to, affected, converted_to, owned_by, member_of, part_of, created, derived_from — 16 confirmed by direct read; the product's own README rounds this to 18). Edges persist to `data/knowledge-graph-edges.json`; node data stays in each domain's own existing store by design ("no new storage for node data," per the file's own header).

## Connector Layer

`backend/services/integrationConnectors.cjs` (1,278 lines) is the runtime connector registry — every connector implements a common interface (`connect · health · status · reconnect · rotateCredentials · detectFailure · getMetrics`). See [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md) for the full inventory and a reconciliation of the "47 vs 54 vs 57" connector-count figures found across different parts of the codebase.

## Automation

`backend/services/automationService.js`/`.cjs`, `agents/automation/`, and the `/automation/*` routes implement rule-based and scheduled automation (cron via `node-cron`), separate from the AI mission engine — e.g. WhatsApp/Telegram follow-up sequences, CRM automation rules.

## Database / Storage

**There is no general-purpose database.** Persistence is:
- **408 flat JSON files** under `/data`, one independent store per subsystem (e.g. `billing.json`, `agent-registry.json`, `approval-queue.json`), plus 18 subdirectories for larger domains (`aeo/`, `ako/`, `autonomous/`, etc.).
- **One SQLite database** (`data/jarvis.db`, via `better-sqlite3`, WAL mode) used narrowly for the task queue (`tasks` table + `migration_log` table) — not a general application database.

`server.js` performs cold-start integrity checks and auto-repair on several critical JSON files (backs up and resets to a safe default if corrupted).

**Architectural consequence**: there is no database-level tenant isolation boundary. Authorization logic (org RBAC, workspace membership checks) is real and live-tested to correctly return 403s — but it is the *only* isolation boundary; there is no schema/row-level backstop behind it. This is the top architectural item in [19_RISK_REGISTER.md](19_RISK_REGISTER.md) (R2) and the primary blocker to the 17-company vision in [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md).

## Deployment Architecture

See [14_INFRASTRUCTURE.md](14_INFRASTRUCTURE.md) for full detail. Summary: single Ubuntu VPS, PM2 fork mode (explicitly single-instance — in-process singletons like the task queue and learning system are not cluster-safe), nginx reverse proxy with TLS via certbot. Docker exists as a complete, well-built alternative path but has never been exercised by real CI or a real build in any audited environment.

---

*Next: [05_FEATURE_CATALOG.md](05_FEATURE_CATALOG.md) for the feature-by-feature inventory.*
