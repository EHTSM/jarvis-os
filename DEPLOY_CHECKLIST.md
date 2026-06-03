# DEPLOY_CHECKLIST.md

Generated: 2026-05-20 | Pre-deployment verification gate.

---

## Pre-Deploy: Run This First

```bash
# 1. Env check (exits 1 on missing required vars)
npm run env:check

# 2. Core import check (no node_modules needed)
node -e "require('./agents/runtime/runtimeOrchestrator.cjs')" 2>&1 | head -5

# 3. Dry-run archive plan (no moves — just shows what would happen)
bash archive-plan.sh
```

---

## Checklist

### Env Validation
- [x] `GROQ_API_KEY` set in `.env`
- [x] `JWT_SECRET` set in `.env`
- [x] `OPERATOR_PASSWORD_HASH` set in `.env`
- [x] `PORT=5050` set in `.env`
- [x] `npm start` runs `check-startup-env.cjs` before server starts
- [x] `deploy/start-production.sh` validates all required vars before PM2 launch
- [x] `backend/server.js` has inline validation with `_missingRequired` tracking

### SQLite WAL
- [x] `backend/db/sqlite.cjs` sets `PRAGMA journal_mode = WAL`
- [x] `backend/db/sqlite.cjs` sets `PRAGMA synchronous = NORMAL`
- [x] `closeDB()` exported and called in server shutdown handlers
- [x] DB path: `data/jarvis.db` (created automatically if missing)

### Graceful Shutdown
- [x] `SIGTERM` → `_gracefulShutdown()` in `backend/server.js`
- [x] `SIGINT` → `_gracefulShutdown()` in `backend/server.js`
- [x] `SIGUSR2` → `_gracefulShutdown()` (nodemon-safe)
- [x] 5-second drain window before `process.exit(0)`
- [x] `runtimeEventBus.stop()` called on shutdown
- [x] `closeDB()` called on shutdown

### PM2 Readiness
- [x] `ecosystem.config.cjs`: `script: "backend/server.js"`
- [x] `instances: 1, exec_mode: "fork"` (no clustering — not cluster-safe)
- [x] `max_memory_restart: "512M"`
- [x] `kill_timeout: 8000` (> 5s drain window)
- [x] `listen_timeout: 15000`
- [x] `node_args: "--max-old-space-size=400"`
- [x] Log files: `logs/pm2-out.log`, `logs/pm2-err.log`
- [ ] `pm2 startup` run on VPS (system-specific — do once manually)
- [ ] `pm2 save` run after first start

### Active Ports
- [x] Port 5050: backend API + operator console (production)
- [x] Port 3000: frontend CRA dev server (development only — not active in prod)
- [ ] Verify no other process holds 5050: `lsof -ti:5050`

### Health Endpoints
- [x] `GET /health` — `backend/routes/ops.js` (no auth required)
- [x] `GET /stats` — CRM + revenue summary
- [x] `GET /runtime/status` — agent registry + queue status (auth required)

### Missing Imports
- [x] 72/72 local `require()` paths in core runtime resolve — 0 broken
- [x] Frontend imports — 0 broken (5 flagged were comment text / string literals)
- [x] `agents/taskQueue.cjs` imports sqlite.cjs correctly (`require("../backend/db/sqlite.cjs")`)
- [x] No references to non-existent `backend/db/db.js`

### Active Routes
- [x] Auth: `/auth/login`, `/auth/logout`, `/auth/me`
- [x] Runtime: `/runtime/dispatch`, `/runtime/queue`, `/runtime/status`, `/runtime/history`, `/runtime/emergency-stop`
- [x] SSE: `/runtime/stream`, `/runtime/stream/status`
- [x] Ops: `/health`, `/stats`, `/metrics`
- [x] CRM: `/crm`, `/crm-leads`, `/crm/lead/*`
- [x] AI: `/jarvis`, `/ai/chat`
- [x] Payments: `/webhook/razorpay`

### Log Output
- [x] `backend/utils/logger.js` used across all runtime files
- [x] `backend/middleware/requestLogger.js` logs method + path + duration per request
- [x] Startup diagnostics logged (env status, CRM leads, queue count)
- [x] Shutdown events logged

### SSE Stability
- [x] `runtimeEventBus`: flood guard at 20 events/s
- [x] `runtimeEventBus`: stdout/stderr truncated at 4KB
- [x] `useRuntimeStream.js`: SSE backoff: 1s → 2s → 4s → 8s → 30s (5 attempts)
- [x] SSE close + cleanup on `onerror`
- [x] Fallback polling resumes on SSE disconnect (10s ops, 10s history)
- [x] History deduplication via `seenEntries` Set (capped at 800, trimmed to 500)
- [x] History capped at 300 entries in-memory

### Memory Safety
- [x] `_client.js`: `_executionState` Map capped at 200 entries with smart eviction
- [x] `_client.js`: `_recentCommands` Map capped at 100 entries
- [x] `_client.js`: `_cleanupTimers` Map capped at 300 entries
- [x] `_client.js`: 60s GC interval for stale entries (5-minute TTL)
- [x] `ExecLogPanel`: history sliced to 500 before processing, 100 rows rendered
- [x] `ExecLogPanel`: localStorage capped at 100 entries, field-level 200-char caps
- [x] `useRuntimeStream`: `seenEntries` Set GC at 800 → trim to 500
- [x] PM2: `--max-old-space-size=400` node arg
- [x] PM2: `max_memory_restart: "512M"` hard ceiling

### No Broken Runtime Wiring
- [x] Single bootstrap call: `server.js` line 310
- [x] Single `app.listen()` call: `server.js` line 284
- [x] No duplicate `runtimeOrchestrator` instantiation
- [x] `safeDispatch` correctly exported from `frontend/src/api.js`
- [x] No recursive dispatch: `WorkflowPanel.safeDispatch` calls `_apiDispatch` (renamed import)
- [x] Terminal adapter uses `spawn` with `shell:false` — no injection path
- [x] Sandbox allowlist enforced before every terminal command

### Phantom Tests Cleared
- [x] Tests 09-83 moved to `tests/legacy/` (74 files)
- [x] `test:runtime` npm script references only 01-08
- [x] No phantom test paths in `test:runtime` or `test:runtime:fast`

---

## Known Gaps (Non-Blocking)

| Gap | Risk | Mitigation |
|-----|------|-----------|
| `npm install` requires network | Blocks cold deploy | Pre-install on VPS before deploy |
| No React ErrorBoundary on operator panels | Single bad render unmounts console | Acceptable for solo operator — reload recovers |
| PM2 doesn't run `check-startup-env.cjs` | Missing env = running-but-degraded | `deploy/start-production.sh` gates before PM2 starts |
| `_archive/` still tracked in git | Bloats clone size | Run `git rm --cached -r _archive/` when ready |
| Browser/desktop agents unstable | Capability gaps | Terminal + filesystem are production-stable |
| No automated CI | Manual test gate only | Run `npm run test:runtime` before every deploy |

---

## Deployment Command Sequence

```bash
# Cold VPS deploy
git pull
npm install
npm run env:check          # exits 1 if required vars missing
bash deploy/start-production.sh   # validates env, then starts PM2

# Verify running
curl http://localhost:5050/health
pm2 status

# Update running system
git pull
npm install --omit=dev
pm2 restart jarvis-os
```
