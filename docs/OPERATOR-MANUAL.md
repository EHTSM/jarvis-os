# JARVIS OS — Operator Manual

## Quick Start

```bash
# 1. Clone repo and install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Copy and fill environment variables
cp .env.example .env
# Edit .env — at minimum set GROQ_API_KEY, JWT_SECRET, OPERATOR_PASSWORD_HASH

# 3. Generate password hash
node scripts/generate-password-hash.cjs <your-password>
# Copy the output hash into OPERATOR_PASSWORD_HASH in .env

# 4. Start the backend
npm start                    # node backend/server.js (dev)
npm run pm2:start            # PM2 production start

# 5. Start the frontend (separate terminal, dev only)
npm run frontend             # React dev server on :3000

# 6. Or start everything together
npm run dev:full             # backend + frontend concurrently

# 7. Or launch the desktop app
npm run electron:dev         # Electron + backend + frontend (dev)
npm run electron             # Electron (production build assumed)
```

## Environment Variables

### Required for core function

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key — AI inference for all agents. Without this the `ai` service is DISABLED and agent tasks will degrade. |
| `JWT_SECRET` | 32+ byte random hex string — signs operator JWTs. **Required in production.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OPERATOR_PASSWORD_HASH` | bcrypt hash of the operator console password. **Required in production.** Generate: `node scripts/generate-password-hash.cjs <password>` |

### Optional services (disabled gracefully if absent)

| Variable | Service | Description |
|---|---|---|
| `TELEGRAM_TOKEN` | telegram | Bot token for Telegram send/status routes |
| `TELEGRAM_OPERATOR_CHAT_ID` | alerts | Chat ID for runtime alert delivery |
| `FIREBASE_PROJECT_ID` | firebase | Firebase project for user auth |
| `GOOGLE_API` | maps | Google Maps API key |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | payments | Razorpay credentials (also accepts `RAZORPAY_KEY` / `RAZORPAY_SECRET`) |
| `WA_TOKEN` / `WA_PHONE_ID` | whatsapp | WhatsApp Cloud API (also accepts `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID`) |
| `ALLOWED_ORIGINS` | cors | Comma-separated extra origins added to the CORS allowlist |

### Tuning variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5050` | Backend HTTP port |
| `NODE_ENV` | `development` | Set to `production` to enable HSTS, strict CSP nonce, auth hard-requirements |
| `MAX_CONCURRENT_CYCLES` | `5` | Max simultaneous autonomous task cycles; overflow queued to `data/cycle-queue.json` |
| `DISABLE_X_POWERED_BY` | — | Set to `1` to strip the `X-Powered-By` header |

## Starting the System

### Development

```bash
npm run dev:full             # backend (:5050) + frontend (:3000) concurrently
```

### Production (PM2)

```bash
npm run pm2:start            # pm2 start ecosystem.config.cjs --env production
npm run pm2:restart          # zero-downtime reload
npm run pm2:logs             # tail logs
npm run pm2:stop             # graceful stop
```

PM2 config (`ecosystem.config.cjs`) runs a single fork-mode instance on port 5050. **Never set `instances > 1`** — in-process singletons (task queue, learning system, context engine) are not cluster-safe.

### Electron (desktop)

```bash
npm run dist:mac             # build macOS DMG
npm run dist:win             # build Windows NSIS installer
npm run dist:linux           # build Linux AppImage
npm run dist:all             # build all platforms
```

## Emergency Stop / Resume

### Keyboard shortcut (Electron only)

`Cmd+Shift+.` (macOS) — toggles emergency stop mode. When active, all autonomous agent dispatches are blocked and a banner is shown in the UI.

### API

```bash
# Stop all autonomous operations immediately
curl -X POST http://localhost:5050/runtime/emergency-stop \
  -H "Authorization: Bearer <token>"

# Resume normal operation
curl -X POST http://localhost:5050/runtime/emergency-resume \
  -H "Authorization: Bearer <token>"

# Check current emergency state
curl http://localhost:5050/runtime/status \
  -H "Authorization: Bearer <token>"
```

Emergency state is managed by `agents/runtime/control/runtimeEmergencyGovernor.cjs` and reflected in `/runtime/status`.

## Monitoring

### Health check

```bash
curl http://localhost:5050/health
# Returns: { status: "ok", uptime, memory, services: { ai, telegram, firebase, payments, ... } }
```

### Runtime status

```bash
curl http://localhost:5050/runtime/status -H "Authorization: Bearer <token>"
# Returns: orchestrator queue depth, SSE connections, emergency state, concurrency status
```

### Concurrency status (autonomous cycles)

```bash
curl http://localhost:5050/p18/cycles/stats -H "Authorization: Bearer <token>"
# Returns: total cycles, running, completed, failed, partial, avgSuccessRate
```

### PM2 monitoring

```bash
npm run pm2:logs             # live log stream
pm2 monit                    # TUI dashboard (CPU, memory, restart count)
```

### Log files

| File | Contents |
|---|---|
| `logs/pm2-out.log` | Structured HTTP request logs, info messages |
| `logs/pm2-err.log` | Errors, warnings, unhandled rejections |
| `data/runtime-alerts.log` | Fallback alert log (when Telegram not configured) |

## Common Issues

**Port already in use (EADDRINUSE 5050)**
- Another process or a manual `node backend/server.js` is holding the port while PM2 is also running.
- Fix: `pm2 stop jarvis-os && kill $(lsof -t -i:5050)` then `npm run pm2:start`

**Auth routes return 503**
- `JWT_SECRET` or `OPERATOR_PASSWORD_HASH` is not set in `.env` (production mode).
- Fix: generate and set both values, then restart.

**AI service disabled**
- `GROQ_API_KEY` is missing. Startup log will say `[Startup] REQUIRED env missing — ai DISABLED`.
- Fix: add key to `.env` and restart.

**Cycle queue building up**
- More than `MAX_CONCURRENT_CYCLES` (default 5) cycles are being submitted.
- Status: `GET /p18/cycles/stats` shows running count.
- Fix: raise `MAX_CONCURRENT_CYCLES` in `.env` or wait for cycles to complete.
- Queue is at: `data/cycle-queue.json` — can be inspected or manually cleared.

**SQLite locked errors**
- WAL mode allows concurrent readers; locked errors indicate multiple writers.
- Only one PM2 instance should be running. Check: `pm2 list`.

**Frontend not loading in Electron**
- Dev mode: ensure `npm run frontend` is running on :3000 first.
- Production: ensure `npm run build:frontend` has completed and `frontend/build/` exists.

## Backup

```bash
npm run backup
# Runs scripts/backup.sh — copies data/ and logs/ to a timestamped backup directory
```

Manual backup of critical files:

```bash
cp data/jarvis.db          backup/jarvis-$(date +%Y%m%d).db
cp data/autonomous-cycles.json backup/
cp data/learning-patterns.json backup/
cp .env                    backup/.env.bak   # keep this secure
```

Recommended: run `npm run backup` daily via cron:

```
0 3 * * * cd /opt/app && npm run backup >> logs/backup.log 2>&1
```
