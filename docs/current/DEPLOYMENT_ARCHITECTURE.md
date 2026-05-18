# DEPLOYMENT_ARCHITECTURE.md

**Date:** 2026-05-15  
**Target:** Single-VPS production (512 MB RAM minimum, 1 GB recommended)

---

## Full Topology

```
                        INTERNET
                           │
                    ┌──────▼──────┐
                    │   Certbot   │ (TLS cert renewal via cron)
                    │   + nginx   │ port 80 → 443 redirect
                    │             │ port 443 SSL termination
                    └──────┬──────┘
                           │ HTTP/1.1 (127.0.0.1)
              ┌────────────┼────────────────────────┐
              │            │                        │
        static files   /runtime/stream         all other routes
        (nginx serves  (SSE: proxy_buffering     (rate limited
         directly from  off, timeout 3600s)       30 req/s nginx
         frontend/build)                          + Express rate
                         │                        limiter per IP)
              └──────────┼────────────────────────┘
                         │
                ┌────────▼────────┐
                │   PM2 process   │
                │  jarvis-os      │
                │  (fork mode,    │
                │   1 instance)   │
                │  port 5050      │
                │  512MB ceiling  │
                └────────┬────────┘
                         │
                ┌────────▼────────────────────────────────┐
                │          EXPRESS (backend/server.js)     │
                │                                          │
                │  Routes:                                 │
                │  POST /auth/login  (rate: 10/5min)       │
                │  POST /jarvis      (rate: 60/min)        │
                │  /whatsapp/*       /telegram/*           │
                │  /payment/*        /crm/*                │
                │  /health           /ops  /stats          │
                │  POST /runtime/dispatch  (auth required) │
                │  GET  /runtime/stream    (auth required) │
                │  GET  /runtime/status    (auth required) │
                │  POST /runtime/emergency/*               │
                └────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────────┐
          │              │                  │
   ┌──────▼──────┐  ┌────▼────┐  ┌─────────▼────────┐
   │  RUNTIME    │  │ LEGACY  │  │  AUTONOMOUS LOOP  │
   │  CORE       │  │ PATH    │  │                   │
   │             │  │         │  │  autonomousLoop   │
   │  runtime    │  │ tool    │  │  reads task-queue │
   │  Orchestrat │  │ Agent   │  │  every 30s        │
   │  → engine   │  │ → exec  │  │  recoverStale()   │
   │  → registry │  │   Adapt │  │  pruneOldTasks()  │
   │  → 5 agents │  │   Superv│  └───────────────────┘
   └──────┬──────┘  └────┬────┘
          │              │
   ┌──────▼──────────────▼──────────────────────────┐
   │                   AGENTS                        │
   │                                                  │
   │  desktopAgent   (robotjs, maxCon=1)             │
   │  browserAgent   (openURL/search, maxCon=3)      │
   │  terminalAgent  (shell+allowlist, maxCon=2)     │
   │  automationAgent (n8n webhooks, maxCon=2)       │
   │  devAgent       (Groq codegen, maxCon=2)        │
   └──────────────────────────────────────────────────┘
          │
   ┌──────▼──────────────────────────────────────────┐
   │              PERSISTENT STORAGE                  │
   │                                                  │
   │  data/task-queue.json     ← atomic write         │
   │  data/dead-letter.json    ← DLQ, max 1000        │
   │  data/logs/execution.ndjson ← rotate 10MB       │
   │  data/memory-store.json   ← AI context (grows)  │
   │  data/learning.json       ← pattern learning     │
   │  logs/pm2-out.log         ← PM2 stdout           │
   │  logs/pm2-err.log         ← PM2 stderr           │
   └──────────────────────────────────────────────────┘
```

---

## Component Responsibility Table

| Component | File | Responsibility |
|-----------|------|----------------|
| nginx | `/etc/nginx/sites-available/jarvis` | TLS, static files, SSE proxy, rate limiting |
| PM2 | `ecosystem.config.cjs` | Process lifecycle, crash restart, memory ceiling |
| Express | `backend/server.js` | HTTP routing, CORS, middleware, auth gating |
| authMiddleware | `backend/middleware/authMiddleware.js` | JWT sign/verify, cookie, dev passthrough |
| rateLimiter | `backend/middleware/rateLimiter.js` | Per-IP per-window request throttle |
| runtimeOrchestrator | `agents/runtime/runtimeOrchestrator.cjs` | dispatch(), queue(), status() |
| executionEngine | `agents/runtime/executionEngine.cjs` | Retries, backoff, timeout, DLQ |
| agentRegistry | `agents/runtime/agentRegistry.cjs` | Circuit breaker, slot tracking |
| runtimeEventBus | `agents/runtime/runtimeEventBus.cjs` | SSE fan-out, 500-event ring |
| runtimeStream | `agents/runtime/runtimeStream.cjs` | GET /runtime/stream endpoint |
| taskQueue | `agents/taskQueue.cjs` | Persistent task queue (JSON) |
| autonomousLoop | `agents/autonomousLoop.cjs` | Background task processing |
| execLog | `backend/utils/execLog.cjs` | Persistent NDJSON execution log |
| deadLetterQueue | `agents/runtime/deadLetterQueue.cjs` | Failed task persistence |

---

## Data Flow: Operator Dispatch

```
1. Operator types command in WorkflowPanel
2. POST /runtime/dispatch  { input: "run: echo hello" }
3. requireAuth middleware verifies JWT cookie
4. runtimeOrchestrator.dispatch(input)
5. planner.plannerAgent(input) → [{ type:"terminal", payload:{command:"echo hello"} }]
6. executionEngine.executeTask(task)
7. taskRouter.resolveCapability("terminal") → "terminal"
8. agentRegistry.findForCapability("terminal") → terminalAgent slot
9. terminalAgent.handler({ command: "echo hello" })
10. child_process.exec("echo hello", { cwd, timeout: 10s })
11. Result → executionHistory.record()
12. Result → runtimeEventBus.emit("execution", entry)
13. SSE → OperatorConsole ExecLogPanel updates live
14. HTTP response → WorkflowPanel shows result
```

---

## Data Flow: AI Console

```
1. Operator types query in AIConsolePanel
2. POST /jarvis  { input: "what is 2+2", mode: "smart" }
3. firebaseAuth.optionalAuth (attaches uid if Firebase token present, else passes)
4. rateLimiter(60, 60_000) — 60 req/min per IP
5. jarvisController.handleJarvis()
6. parseCommand(input) → { type:"ai", payload:{text:"what is 2+2"} }
7. toolAgent.execute(parsed)
8. For "ai" type: Groq API call → response
9. HTTP response → AIConsolePanel renders reply
```

---

## No Redis Required

The system intentionally uses no Redis. All state is:

| State | Storage | Notes |
|-------|---------|-------|
| Task queue | `data/task-queue.json` (disk) | Atomic write, survives restart |
| Rate limits | In-memory Map | Resets on restart (acceptable) |
| JWT tokens | Signed cookies | Stateless — no server store needed |
| Agent circuit state | In-memory | Resets on restart (Sprint 1 fix: persist to JSON) |
| Execution history | In-memory ring + disk log | Ring resets; log survives |
| SSE events | In-memory ring | Replay 50 events on reconnect |

Redis would add value only for: persistent rate limits, token blacklisting, or multi-process state sharing. None of these are needed for single-operator single-process deployment.

---

## Disk Space Planning

| Path | Current | Growth Rate | Action Threshold |
|------|---------|------------|-----------------|
| `data/logs/execution.ndjson` | 2.1 MB | ~0.5 MB/day active use | Rotates at 10 MB ✓ |
| `data/dead-letter.json` | 20 KB | Slow (only on failures) | Cap 1000 entries ✓ |
| `data/task-queue.json` | 18 KB | Stable (pruned on restart) | Cap 50 completed ✓ |
| `data/memory-store.json` | 133 KB | Slow (AI context) | Manual prune at 5 MB |
| `data/learning.json` | 53 KB | Slow (AI patterns) | Manual prune at 5 MB |
| `logs/pm2-out.log` | Unknown | ~1 MB/day active use | pm2-logrotate at 10 MB |
| `logs/pm2-err.log` | Unknown | Low (errors only) | pm2-logrotate at 10 MB |
| `frontend/build/` | ~5 MB | Static — only on redeploy | Stable |

**Total estimated disk at 1 year:** ~2 GB (log-dominated). 10 GB VPS disk is comfortable.

---

## Port Map

| Port | Service | Public? |
|------|---------|---------|
| 80 | nginx (HTTP → HTTPS redirect) | Yes |
| 443 | nginx (HTTPS, TLS) | Yes |
| 5050 | Express (Node.js) | **No — localhost only** |

Port 5050 must not be publicly accessible. Enforce with:
```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 5050/tcp
ufw enable
```

---

## Secrets Management

All secrets are in `.env` at the project root. Never committed to git.

```bash
chmod 600 .env
chown root:root .env  # if running as non-root, adjust accordingly
```

Required secrets checklist:
```
JWT_SECRET=<64-char hex>        # generate: openssl rand -hex 32
OPERATOR_PASSWORD_HASH=<hash>   # generate: see OPERATOR_ONBOARDING.md
GROQ_API_KEY=<key>              # from console.groq.com
ALLOWED_ORIGINS=https://domain  # your frontend domain
NODE_ENV=production
```

---

## Backup Strategy

```bash
# Daily cron — backs up persistent state (no code, no node_modules)
0 2 * * * tar -czf /backups/jarvis-$(date +%Y%m%d).tar.gz \
  /opt/jarvis-os/data/ /opt/jarvis-os/.env

# Keep 30 days
0 3 * * * find /backups -name "jarvis-*.tar.gz" -mtime +30 -delete
```

Minimum backup set: `data/`, `.env`. Everything else can be rebuilt from git.
