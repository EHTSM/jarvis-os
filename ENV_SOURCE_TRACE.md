# ENV SOURCE TRACE
**Ooplix AI Operating System — Phase 49G**
**Date:** 2026-06-08
**Question:** Why does the running process report localhost values for BASE_URL and ALLOWED_ORIGINS despite `/var/www/jarvis/.env` containing production URLs?

---

## ANSWER

**There are two independent failure modes working simultaneously.**

1. **`BASE_URL`** — `.env` IS loaded correctly. But `paymentService.js` (git HEAD, the version on the VPS) has a hardcoded `|| "http://localhost:5050"` fallback inside the payment link function that masks the env value. `callback_url` comes from `config/index.js` which has the same fallback. Even with `BASE_URL=https://app.ooplix.com` in `.env`, these fallbacks will NOT fire — **the real cause is that `/var/www/jarvis/.env` still contains `BASE_URL=http://localhost:5050`** (the local dev value was never updated to a production URL before the VPS was provisioned).

2. **`ALLOWED_ORIGINS`** — `.env` IS loaded correctly. But `/var/www/jarvis/.env` still contains `ALLOWED_ORIGINS=http://localhost:3000`. The CORS middleware has no fallback — it simply blocks all unlisted origins.

**The `.env` file is the root cause for both. It was never updated from localhost values.**

---

## FULL SOURCE TRACE

### How env vars reach the process

```
pm2 start ecosystem.config.cjs --env production
  ↓
  ecosystem.config.cjs injects: { NODE_ENV: "production", PORT: 5050 }
  (no BASE_URL, no ALLOWED_ORIGINS in ecosystem config)
  ↓
  node backend/server.js starts
  ↓
  server.js line 2:
    require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
    __dirname = /var/www/jarvis/backend
    resolved  = /var/www/jarvis/.env          ← single source of truth
  ↓
  dotenv parses /var/www/jarvis/.env and sets process.env.*
  (dotenv does NOT override vars already in process.env — PM2-injected
   NODE_ENV and PORT are preserved; BASE_URL and ALLOWED_ORIGINS are set
   from .env since PM2 did not inject them)
```

**dotenv path resolution is correct. The file it loads is `/var/www/jarvis/.env`.**

---

### SOURCE 1 — BASE_URL

#### Primary source
**File:** `backend/server.js`
**Line:** 2
```javascript
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
```
Loads `/var/www/jarvis/.env`. `process.env.BASE_URL` is set to whatever that file contains.

#### Consumed by — payment callback URL
**File:** `backend/services/paymentService.js` ← **git HEAD version on VPS**
**Line:** 50
```javascript
callback_url: `${process.env.BASE_URL || "http://localhost:5050"}/webhook/razorpay`,
```
If `process.env.BASE_URL` is empty or unset, the fallback fires and `callback_url` becomes `http://localhost:5050/webhook/razorpay`.

#### Consumed by — config module
**File:** `backend/config/index.js`
**Line:** 14
```javascript
baseUrl: () => process.env.BASE_URL || "http://localhost:5050",
```
Same fallback. Every service that calls `config.baseUrl()` gets `localhost:5050` if `BASE_URL` is unset.

#### Startup warning (does NOT fix the value)
**File:** `backend/server.js`
**Lines:** 712–714
```javascript
if (!process.env.BASE_URL) {
    logger.warn(`[Startup] WARNING: BASE_URL not set — Razorpay webhook callback will use localhost.`);
    logger.warn(`[Startup]          Set BASE_URL=https://yourdomain.com in .env for payments to work.`);
}
```
This warning only fires if `BASE_URL` is completely absent. If `BASE_URL=http://localhost:5050` is explicitly set in `.env`, the condition is false and no warning is emitted — the process starts silently with the wrong value.

#### Root cause
**File:** `/var/www/jarvis/.env`
**Line:** 39 (mirrors local `.env`)
```
BASE_URL=http://localhost:5050
```
This was the local development default. It was never updated before VPS deployment. The process reads it, sets `process.env.BASE_URL=http://localhost:5050`, and proceeds without error. The startup warning is suppressed because the value IS set — just wrong.

---

### SOURCE 2 — ALLOWED_ORIGINS

#### Primary source
**File:** `backend/server.js`
**Line:** 2 (same dotenv call — same `/var/www/jarvis/.env`)

#### Consumed by — CORS middleware
**File:** `backend/server.js`
**Lines:** 121–128
```javascript
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
}));
```
`_allowedOrigins` is computed **once at startup** from `process.env.ALLOWED_ORIGINS`. It is a module-level constant — it cannot change without a process restart.

There is **no fallback** for `ALLOWED_ORIGINS`. If the value is `"http://localhost:3000"`, then `_allowedOrigins = ["http://localhost:3000"]` and every other origin, including `https://app.ooplix.com`, is rejected with HTTP 500.

#### Root cause
**File:** `/var/www/jarvis/.env`
**Line:** 49 (mirrors local `.env`)
```
ALLOWED_ORIGINS=http://localhost:3000
```
Same root cause as `BASE_URL` — the local dev value was never updated before VPS deployment. No warning is emitted at startup; the process runs without any signal that production traffic will be blocked.

---

### SOURCE 3 — Why /var/www/jarvis/.env has localhost values

#### Path 1: copied from .env.example by setup-vps.sh

**File:** `deploy/setup-vps.sh`
**Lines:** 77–80
```bash
if [ ! -f "$APP_DIR/.env" ]; then
    warn ".env not found — copying template. EDIT IT BEFORE STARTING."
    sudo -u "$APP_USER" cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    warn ">>> Edit $APP_DIR/.env now and re-run: bash $APP_DIR/deploy/start-production.sh"
fi
```
If `.env` did not exist, `setup-vps.sh` copies `.env.example`. The example file has placeholder values:

**File:** `.env.example`
**Line:** 19: `BASE_URL=https://your-domain.com`
**Line:** 14: `ALLOWED_ORIGINS=https://yourdomain.com`

These are safe placeholders — not localhost. `start-production.sh` validates and rejects placeholder values:

**File:** `deploy/start-production.sh`
**Line:** 45: `[[ "${BASE_URL:-}" == *"localhost"* ]] && die "BASE_URL is still set to localhost"`
**Line:** 46: `[[ "${BASE_URL:-}" == *"YOUR_DOMAIN"* ]] && die "BASE_URL is still a placeholder"`

#### Path 2: .env was manually edited or synced from local dev

The local `.env` file contains `BASE_URL=http://localhost:5050` (line 39) and `ALLOWED_ORIGINS=http://localhost:3000` (line 49). If this file was copied or `rsync`'d to the VPS without modification, the localhost values would be present on the VPS. `start-production.sh`'s guard on line 45 would have caught this — unless the process was started directly with `pm2 start backend/server.js --name jarvis-os` rather than via `deploy/start-production.sh`.

**The current situation (`pm2 start backend/server.js --name jarvis-os` directly) bypasses all guards in `deploy/start-production.sh`.**

---

### SOURCE 4 — Committed vs uncommitted code (secondary issue)

The VPS ran `git pull` and loaded git HEAD. Several files with improvements have been edited locally but **never committed**. The VPS has the old versions:

| File | git HEAD version (VPS) | Disk version (local, not on VPS) |
|------|----------------------|-----------------------------------|
| `backend/services/paymentService.js` | Line 50: `process.env.BASE_URL \|\| "http://localhost:5050"` — no guard | Lines 44–46: localhost guard that blocks link creation if BASE_URL is local |
| `backend/routes/ai.js` | Only has `POST /ai/chat` | Also has `GET /ai/status` |
| `backend/services/aiService.js` | Single-provider Groq→OpenAI→Ollama | Multi-provider failover Groq→OpenRouter→OpenAI→Ollama with per-provider timeouts |
| `backend/routes/phase24.js` | git HEAD version | Modified locally |
| `backend/services/agentExecutionEngine.cjs` | git HEAD version | Modified locally |
| `backend/services/autonomousTaskLoop.cjs` | git HEAD version | Modified locally |
| `backend/services/repoIntelligenceEngine.cjs` | git HEAD version | Modified locally |

This means even after fixing `.env`, the VPS process will use the fallback `|| "http://localhost:5050"` in `paymentService.js` **only if `BASE_URL` is empty**. If `BASE_URL=https://app.ooplix.com` is set correctly in `.env`, `paymentService.js` line 50 will produce the correct `callback_url` regardless of the guard being absent.

---

## WHAT MUST CHANGE

### Fix 1 — Update `/var/www/jarvis/.env` (the actual root cause)

```bash
# On VPS — edit these two lines:
BASE_URL=https://app.ooplix.com        # line 39 — currently: http://localhost:5050
ALLOWED_ORIGINS=https://app.ooplix.com # line 49 — currently: http://localhost:3000
```

### Fix 2 — Commit and push the improved backend files

The following local changes fix real bugs (payment guard, AI failover, `/ai/status` route) but are not committed. They will not reach the VPS until committed and pushed:

```bash
git add backend/services/paymentService.js \
        backend/routes/ai.js \
        backend/services/aiService.js
git commit -m "fix: payment localhost guard, AI multi-provider router, /ai/status route"
git push origin main
# Then on VPS:
git pull origin main && pm2 restart jarvis-os
```

### Fix 3 — Use start-production.sh instead of direct pm2 start

```bash
# WRONG (bypasses all validation guards):
pm2 start backend/server.js --name jarvis-os

# RIGHT (validates .env, catches localhost values, starts with correct env):
bash deploy/start-production.sh
```

`start-production.sh` sources `.env` into the shell before running `pm2 start ecosystem.config.cjs --env production`, which means PM2 also inherits the env vars directly — a belt-and-suspenders approach alongside dotenv.

---

## EXECUTION ORDER

```
1. Edit /var/www/jarvis/.env:
     BASE_URL=https://app.ooplix.com
     ALLOWED_ORIGINS=https://app.ooplix.com

2. On local machine — commit the improved backend files:
     git add backend/services/paymentService.js backend/routes/ai.js backend/services/aiService.js
     git commit -m "fix: payment localhost guard, AI failover router, /ai/status"
     git push origin main

3. On VPS:
     git pull origin main
     pm2 restart jarvis-os

4. Verify:
     curl -H "Origin: https://app.ooplix.com" -X OPTIONS https://app.ooplix.com/health
     → HTTP 204  (ALLOWED_ORIGINS fix confirmed)

     # Create payment link → fetch from Razorpay API → check callback_url
     → callback_url: https://app.ooplix.com/webhook/razorpay  (BASE_URL fix confirmed)

     curl -H "Cookie: jarvis_auth=..." https://app.ooplix.com/ai/status
     → HTTP 200  (committed ai.js confirmed)
```

---

## SUMMARY TABLE

| Variable | Source file | Line | Value loaded | Root cause |
|----------|------------|------|-------------|------------|
| `BASE_URL` | `/var/www/jarvis/.env` | 39 | `http://localhost:5050` | .env not updated before deploy |
| `ALLOWED_ORIGINS` | `/var/www/jarvis/.env` | 49 | `http://localhost:3000` | .env not updated before deploy |
| `BASE_URL` fallback (payment) | `backend/services/paymentService.js` (git HEAD) | 50 | `"http://localhost:5050"` | code not committed |
| `BASE_URL` fallback (config) | `backend/config/index.js` | 14 | `"http://localhost:5050"` | in git HEAD, always present |
| `ALLOWED_ORIGINS` fallback | `backend/server.js` | 121 | `""` (empty — no fallback) | no default means all origins blocked |
| dotenv load path | `backend/server.js` | 2 | `/var/www/jarvis/.env` | correct |
| PM2 env injection | `ecosystem.config.cjs` | 39–43 | `NODE_ENV`, `PORT` only | correct — does not inject BASE_URL |

*Phase 49G — ENV Source Trace*
*2026-06-08 | Ooplix AI Operating System*
