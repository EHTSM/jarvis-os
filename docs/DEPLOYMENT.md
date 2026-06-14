# JARVIS OS — Deployment

## Deploy Directory

Scripts in `deploy/`:

| File | Purpose |
|---|---|
| `setup-vps.sh` | Provision a fresh VPS: install Node.js, PM2, nginx, clone repo |
| `start-production.sh` | Start backend with PM2 in production mode |
| `update.sh` | Pull latest code, reinstall deps, rebuild frontend, restart PM2 |
| `rollback.sh` | Restore previous release from backup |
| `healthcheck.sh` | Curl `/health` and exit non-zero if unhealthy |
| `https-setup.sh` | Provision Let's Encrypt SSL via Certbot |
| `monitor.sh` | Tail PM2 logs and alert on errors |
| `nginx-jarvis.conf` | Single-site nginx config (reverse proxy :5050, serve frontend) |
| `nginx-multisite.conf` | Multi-site nginx config (api.ooplix.com + app.ooplix.com) |

## PM2 Configuration

File: `ecosystem.config.cjs`

```
app name:       jarvis-os
entrypoint:     backend/server.js
mode:           fork (single instance — NOT cluster)
port:           5050
max_memory:     512 MB (PM2 hard restart)
max_restarts:   5 (then PM2 stops retrying)
min_uptime:     15s (crash loop detection)
restart_delay:  5000 ms
kill_timeout:   8000 ms (graceful shutdown window)
logs:           logs/pm2-out.log, logs/pm2-err.log
log_rotation:   10 MB max, 5 files retained
```

**IMPORTANT**: Never set `instances > 1`. The task queue, learning system, and context engine are in-process singletons that are not cluster-safe.

## VPS Deployment

### Initial setup

```bash
# On the VPS as root or sudo user
git clone <repo-url> /opt/app
cd /opt/app
npm install
cd frontend && npm install && npm run build && cd ..

# Configure environment
cp .env.example .env
nano .env   # set JWT_SECRET, OPERATOR_PASSWORD_HASH, GROQ_API_KEY, etc.

# Start with PM2
npm run pm2:start

# Set PM2 to start on boot
pm2 startup    # run the command it prints as root
pm2 save
```

### HTTPS / nginx setup

```bash
bash deploy/https-setup.sh        # installs certbot, gets cert, configures nginx
sudo cp deploy/nginx-jarvis.conf /etc/nginx/sites-available/jarvis
sudo ln -s /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Domain split (api + app)

Use `nginx-multisite.conf` for separate domains:
- `api.ooplix.com` → proxy to :5050
- `app.ooplix.com` → serve `frontend/build/` as static files

### Updates

```bash
bash deploy/update.sh
# Pulls latest git, reinstalls deps, rebuilds frontend, runs `pm2 restart jarvis-os`
```

### Rollback

```bash
bash deploy/rollback.sh
# Restores from the backup directory created before the last update
```

### Health check (CI / cron)

```bash
bash deploy/healthcheck.sh
# Exits 0 if /health returns { status: "ok" }, exits 1 otherwise
```

## Electron Distribution

```bash
npm run dist:mac       # outputs to dist/ — macOS .dmg
npm run dist:win       # Windows NSIS .exe installer
npm run dist:linux     # Linux .AppImage
npm run dist:all       # all three platforms
```

Electron entry: `electron/main.cjs` (full-featured) or `electron/main.js` (lighter shell).

In packaged builds the frontend is loaded from `frontend/build/index.html` via `file://` protocol. The backend must be started separately or bundled — by default the Electron app connects to `http://localhost:5050`.

## Environment Variable Checklist (Production)

```bash
npm run env:check    # validates all required and optional env vars
```

Required for production:
- [ ] `GROQ_API_KEY`
- [ ] `JWT_SECRET` (32+ hex bytes)
- [ ] `OPERATOR_PASSWORD_HASH` (bcrypt)
- [ ] `NODE_ENV=production`

Strongly recommended:
- [ ] `TELEGRAM_OPERATOR_CHAT_ID` (for runtime alerts)
- [ ] `ALLOWED_ORIGINS` (CORS allowlist for production domains)
- [ ] SSL certificate via `https-setup.sh`
- [ ] `pm2 startup && pm2 save` (persist across reboots)

## Security Checklist (Production)

```bash
# Run automated security hardening check
curl -X POST http://localhost:5050/p22/security/check -H "Authorization: Bearer <token>"
```

Manual checklist:
- [ ] `NODE_ENV=production` enables strict CSP nonce, HSTS, auth hard-requirements
- [ ] Firewall: only ports 22, 80, 443 exposed (5050 NOT publicly accessible — nginx proxies it)
- [ ] `JWT_SECRET` is unique, >= 32 bytes, not committed to git
- [ ] `OPERATOR_PASSWORD_HASH` is bcrypt (cost >= 12), not the plaintext password
- [ ] Nginx config does not expose `/data/` or `/logs/` directories
- [ ] `npm run security:no-raw-exec` passes (no unsafe shell execution patterns)
