# JARVIS OS — API Reference

All routes run on `http://localhost:5050` (default port). Auth-required routes need `Authorization: Bearer <token>` obtained from `POST /auth/login`.

---

## Auth

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | /auth/login | Operator login → JWT token | no |
| POST | /auth/logout | Invalidate session | yes |
| GET | /auth/me | Current operator identity | yes |

---

## Runtime (`/runtime/*`)

All `/runtime/*` routes require authentication.

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | /runtime/dispatch | Synchronous task dispatch to agent orchestrator. Body: `{ input, timeoutMs?, retries? }`. Supports idempotency via `x-request-id` header (30s dedup window). | yes |
| POST | /runtime/queue | Async background queue. Body: `{ input, priority? }` (0=HIGH, 1=NORMAL, 2=LOW). Returns `queueId`. | yes |
| GET | /runtime/status | Live diagnostics: orchestrator state, SSE connection count, emergency stop state. | yes |
| GET | /runtime/history | Execution history log. | yes |
| GET | /runtime/dlq | Dead-letter queue entries (failed tasks). | yes |
| POST | /runtime/emergency-stop | Block all autonomous dispatches immediately. | yes |
| POST | /runtime/emergency-resume | Resume normal operation after emergency stop. | yes |
| GET | /runtime/stream | SSE event stream for real-time agent output. | yes |
| GET | /runtime/stream/status | SSE connection count and health. | yes |

---

## Track D Intelligence (`/p26/*`)

All `/p26/*` routes require authentication.

### D1 — Multi-Agent Task Graph

| Method | Path | Description |
|---|---|---|
| POST | /p26/graph | Create (and optionally execute) a task graph. Body: `{ goal, execute?, skipAgents?, steps? }` |
| POST | /p26/graph/:id/execute | Execute an existing graph by ID |
| GET | /p26/graph/stats | Execution statistics across all graphs |
| GET | /p26/graph/:id | Get graph state |
| GET | /p26/graph | List all graphs |
| DELETE | /p26/graph/:id | Cancel a running graph |

### D2 — Semantic Memory Search

| Method | Path | Description |
|---|---|---|
| POST | /p26/memory/typed | Save a typed memory (failure/success/decision/knowledge) |
| POST | /p26/memory/search | TF-IDF semantic search. Body: `{ query, type?, limit? }` |
| GET | /p26/memory/failures | List failure memories |
| GET | /p26/memory/successes | List success memories |
| GET | /p26/memory/decisions | List decision memories |
| POST | /p26/memory/cross-project | Cross-project semantic search |
| GET | /p26/memory/knowledge-graph | Knowledge graph (nodes + edges) |
| POST | /p26/memory/evolve | Evolve low-confidence memories |

### D3 — Reasoning Engine

| Method | Path | Description |
|---|---|---|
| GET | /p26/reason/:recId | Explain a recommendation (natural language reasoning) |
| POST | /p26/reason/confidence | Score confidence for a data payload |
| POST | /p26/reason/risk | Analyze risk for a recommendation |
| POST | /p26/reason/rollback | Generate rollback plan |
| POST | /p26/reason/root-cause | Root-cause analysis for a failure |
| POST | /p26/reason/batch | Batch-explain all recommendations |
| GET | /p26/reason/cached/:recId | Get previously computed reasoning (cache) |

### D4 — Background Runtime Observer

| Method | Path | Description |
|---|---|---|
| POST | /p26/observer/start | Start all background observers |
| POST | /p26/observer/stop | Stop all background observers |
| GET | /p26/observer/status | Observer status (running/stopped, intervals) |
| GET | /p26/observer/recommendations | Current proactive recommendations |
| POST | /p26/observer/trigger/:name | Trigger a specific observer immediately |
| DELETE | /p26/observer/recommendations | Clear acknowledged recommendations |

### D5 — Plugin SDK

| Method | Path | Description |
|---|---|---|
| POST | /p26/plugins | Register a plugin. Body: full plugin object (see PLUGIN-SDK.md) |
| DELETE | /p26/plugins/:id | Unregister a plugin (calls onUnload) |
| GET | /p26/plugins/:id | Get a plugin record |
| GET | /p26/plugins | List plugins. Query: `?category=&tag=&limit=&offset=` |
| POST | /p26/plugins/hook | Execute a hook across all plugins. Body: `{ hook, args? }` |

### D5 — Capability Registry

| Method | Path | Description |
|---|---|---|
| GET | /p26/capabilities | List all capabilities. Query: `?category=&providedBy=` |
| GET | /p26/capabilities/map | Capability name → [providerId] map |
| GET | /p26/capabilities/find | Find providers. Query: `?name=<capabilityName>` |
| POST | /p26/capabilities | Register a capability. Body: `{ id, name, description, providedBy, providerType, category }` |

### D5 — API Manifest

| Method | Path | Description |
|---|---|---|
| GET | /p26/manifest | Full API manifest (all ~300 endpoints, cached 1h) |
| GET | /p26/manifest/search | Search endpoints. Query: `?q=<terms>` |

### D5 — Templates

| Method | Path | Description |
|---|---|---|
| POST | /p26/templates | Register a template. Body: `{ id, name, category, variables[], template }` |
| GET | /p26/templates | List templates. Query: `?category=` |
| POST | /p26/templates/:id/instantiate | Instantiate with variable values. Body: `{ VAR: "value", ... }` |

---

## Ops / Health

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | /health | Service health check (uptime, memory, service flags) | no |
| GET | /ops | Operations dashboard (queue depth, agent stats) | yes |
| GET | /stats | System statistics | yes |
| GET | /api/status | API and env configuration status | yes |

---

## Phase 18–25 Routes (abbreviated)

These 200+ endpoints follow the same pattern: all require auth, all return `{ success: bool, ...data }`.

| Prefix | Domain |
|---|---|
| /p18/* | Runtime Execution Layer (actions, agents, memory, cycles) |
| /p19/* | Autonomy Layer (tools, agent coordination, self-healing, continuous learning) |
| /p20/* | Agent Factory, Memory Intelligence, Improvement Loop, Ooplix tasks |
| /p21/* | OAuth connections, observability metrics/alerts/logs, live mode, production readiness |
| /p22/* | Secrets audit, security hardening, deployment validation, ops alerting |
| /p23/* | GitHub integration, code review, release management, engineering autopilot |
| /p24/* | VS Code AI bridge, repo intelligence, automated refactoring, multi-repo management |
| /p25/* | Canary/blue-green deployments, secret rotation schedules, enterprise observability, code search |

Full endpoint list with descriptions: `GET /p26/manifest` (requires auth).

---

## Rate Limits

Rate limits are applied per-route via `middleware/rateLimiter.js`. Common limits:

| Tier | Limit | Applies to |
|---|---|---|
| Critical (deploys, live mode) | 5–10 req/min | POST /p25/deploy/*, POST /p21/live/* |
| Standard write | 20–30 req/min | Most POST/DELETE routes |
| Standard read | 60–120 req/min | Most GET routes |
| High-frequency | 300 req/min | Metric recording, trace span events |
| Dispatch | 30 req/min | POST /runtime/dispatch |
| Queue | 60 req/min | POST /runtime/queue |
