# PRODUCTION_BOOT_FLOW.md

**Date:** 2026-05-15  
**Entry point:** `backend/server.js`

---

## Startup Sequence (Exact Order)

```
1. dotenv.config()
   └── loads .env from project root

2. ENV validation (server.js lines 8-40)
   ├── GROQ_API_KEY → required (ai service)
   ├── TELEGRAM_TOKEN, FIREBASE_PROJECT_ID, GOOGLE_API → optional
   ├── RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET → optional
   ├── WHATSAPP_TOKEN / PHONE_NUMBER_ID → optional
   └── JWT_SECRET, COOKIE_SECRET → used by authMiddleware (must be set for auth)

3. Express app setup
   ├── cors, json body parser, cookieParser
   └── routes/index.js mounted (ALL routes active)

4. app.listen(PORT)   [PORT=5050 default]
   └── Server accepting connections

5. memTracker.start()  ← heap memory polling

6. startTelegramBot()  ← Telegram bot (no-op if TELEGRAM_TOKEN missing)

7. automation.start()  ← n8n webhook scheduler

8. autonomousLoop.start()
   └── reads data/task-queue.json
   └── recoverStale() — sets running→pending (crash recovery)
   └── pruneOldTasks() — caps queue at 50
   └── polls every 30s for new pending tasks

9. bootstrapRuntime.cjs
   └── agentRegistry.register(desktopAgent)   maxConcurrent=1
   └── agentRegistry.register(browserAgent)   maxConcurrent=3
   └── agentRegistry.register(terminalAgent)  maxConcurrent=2
   └── agentRegistry.register(automationAgent) maxConcurrent=2
   └── agentRegistry.register(devAgent)        maxConcurrent=2

10. runtimeEventBus.start()
    └── initializes 500-entry SSE ring buffer
    └── GET /runtime/stream now serves live events

11. Task queue integrity check
    └── JSON.parse(task-queue.json) — if corrupt: backup + reset to []

12. Startup diagnostics
    └── logs service status, queue depth, lead count
```

---

## Critical ENV Variables

| Variable | Required | Default | Used By |
|----------|----------|---------|---------|
| `GROQ_API_KEY` | YES (degrades without) | — | devAgent, planner AI fallback |
| `JWT_SECRET` | YES (auth broken without) | — | authMiddleware |
| `COOKIE_SECRET` | YES (auth broken without) | — | authMiddleware |
| `PORT` | no | 5050 | server.listen() |
| `LOG_FILE` | no | disabled | logger.js file sink |
| `TELEGRAM_TOKEN` | no | — | Telegram bot |
| `WHATSAPP_TOKEN` + `WA_PHONE_ID` | no | — | WhatsApp integration |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | no | — | Payments |

---

## What Starts vs. What's Always On

| Component | Starts at boot | Condition |
|-----------|---------------|-----------|
| Express HTTP server | Always | — |
| All API routes | Always | — |
| Auth middleware | Always | Must have JWT_SECRET + COOKIE_SECRET |
| autonomousLoop | Always (with catch) | Degrades gracefully if error |
| 5 production agents | Always (with catch) | bootstrapRuntime failure = no /runtime/dispatch |
| runtimeEventBus SSE | Always (with catch) | Failure = SSE stream unavailable, polling works |
| Telegram bot | Only if TELEGRAM_TOKEN set | — |
| WhatsApp webhook | Only if WA_TOKEN+PHONE_ID set | — |
| Payments | Only if RAZORPAY keys set | — |

---

## PM2 Startup

```bash
# First time
pm2 start backend/server.js --name jarvis-os

# With env file
pm2 start backend/server.js --name jarvis-os --env-file .env

# Persist across reboots
pm2 save
pm2 startup   # follow the printed command

# Verify
pm2 status
pm2 logs jarvis-os --lines 50
```

---

## Health Check After Boot

```bash
# Basic health (no auth required)
curl http://localhost:5050/health

# Deep health (requires auth cookie)
curl -b "jarvis_auth=<token>" http://localhost:5050/runtime/health/deep

# Expected: {"status":"ok","agents":5,...}
```

---

## Boot Failure Modes

| Failure | Symptom | Fix |
|---------|---------|-----|
| Port 5050 in use | `EADDRINUSE` in logs | `lsof -nP -iTCP:5050` then kill |
| JWT_SECRET missing | Auth returns 401 on all routes | Add JWT_SECRET to .env |
| bootstrapRuntime fails | `POST /runtime/dispatch` returns 503 | Check logs, usually import error in agent file |
| task-queue.json corrupt | Warn in logs, resets to [] | Normal — backup created automatically |
| GROQ_API_KEY missing | devAgent tasks fail, planner falls back to regex | Add key or accept degraded planning |
