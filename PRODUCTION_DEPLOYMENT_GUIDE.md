# Production Deployment Guide

Exactly how to deploy Ooplix. Two deployment targets exist in this repo — pick the one you're actually shipping:

- **Server (VPS)** — the operator console + backend, served over HTTPS at your domain. Most founders start here.
- **Desktop (Electron)** — a packaged `.dmg`/`.exe`/`.AppImage` that bundles the same backend and spawns it as a child process locally.

Both share the same `backend/` and `frontend/` code. This guide covers both paths end to end.

---

## Path A — Server (VPS) Deployment

### 1. Provision the server

- Ubuntu 22.04 or 24.04, minimum 2GB RAM
- A domain with its DNS A record pointed at the VPS's public IP
- SSH access as root or a sudo user

### 2. Run the one-time setup script

```bash
sudo bash deploy/setup-vps.sh
```

This single script does all of the following, in order:
1. Updates system packages
2. Installs `build-essential`, `git`, `nginx`, `ufw`, `certbot`
3. Installs Node.js 20 LTS via NodeSource
4. Installs PM2 globally
5. Creates a dedicated `jarvis` system user
6. Clones (or pulls, if already present) the repo into `/opt/jarvis-os`
7. Runs `npm install --omit=dev --ignore-scripts` (server doesn't need Electron/dev tooling)
8. Creates `logs/`, `data/`, `backups/` directories
9. Copies `.env.example` → `.env` if no `.env` exists yet (**you still must edit it**)
10. Configures UFW: allows 22 (SSH), 80 (HTTP), 443 (HTTPS) — port 5050 stays closed to the internet, nginx proxies it internally
11. Installs the nginx site config at `/etc/nginx/sites-available/jarvis` (with a placeholder domain)
12. Registers PM2 to start on system boot

### 3. Point nginx at your real domain

```bash
sudo nano /etc/nginx/sites-available/jarvis
```
Replace every `yourdomain.com` with your real domain (the config has both `server_name yourdomain.com www.yourdomain.com;` blocks — HTTP redirect and HTTPS).

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Get an HTTPS certificate

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```
Certbot edits the nginx config in place to add the SSL block and sets up auto-renewal via a systemd timer — no cron entry needed.

### 5. Fill in `.env`

```bash
sudo -u jarvis nano /opt/jarvis-os/.env
```
See [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md) for the required fields and [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md) for exact per-connector values.

### 6. Start the server

```bash
cd /opt/jarvis-os
sudo -u jarvis bash deploy/start-production.sh
```

This script:
- Refuses to start if `.env` is missing, or if `GROQ_API_KEY`, `JWT_SECRET`, `OPERATOR_PASSWORD_HASH`, or `BASE_URL` are unset/placeholder
- Warns (but doesn't block) on missing optional connectors
- Builds the frontend if `frontend/build/` doesn't exist yet (`REACT_APP_API_URL` respected from `.env` — leave blank for single-server nginx-proxied setup)
- Clears any stale crash-quarantine marker from a previous failed boot
- Starts the backend with `pm2 start ecosystem.config.cjs --env production`
- Runs `pm2 save` so the process list survives a reboot
- Polls `/health` for up to 40 seconds and reports the result

If it fails, the script prints the last 30 lines of PM2's error log automatically — read that first.

### 7. Verify

```bash
curl https://yourdomain.com/health
```
Expect `{"status":"ok", ...}`. Then open `https://yourdomain.com` in a browser and log in with the operator password you hashed in step 5.

### 8. Validate the full production checklist

```bash
bash deploy/validate-production.sh
```
Run this before telling any real customer the URL — it's the automated version of [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md).

---

## Path B — Electron Desktop Deployment

The desktop app bundles the backend and spawns it as a child process (`electron/main.cjs` → `_startBackend()`), pointing at `localhost:5050` by default.

### 1. Build the frontend
```bash
npm run build:frontend
```

### 2. Package for your target platform(s)
```bash
npm run dist:mac      # unsigned .dmg (arm64 + x64)
npm run dist:win      # unsigned .exe (nsis installer)
npm run dist:linux    # .AppImage
npm run dist:all      # all three
```
These use `electron-builder` with the config in `package.json`'s `build` field — `asar: true`, native modules (`node-pty`, `better-sqlite3`) unpacked via `asarUnpack`.

### 3. Code signing (optional, recommended for public distribution)

Unsigned builds work and install, but macOS Gatekeeper and Windows SmartScreen will warn users. To sign:

- **macOS**: set `CSC_LINK` (base64-encoded `.p12` certificate) and `CSC_KEY_PASSWORD` as environment variables, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization. `electron-builder` picks these up automatically — no code change needed.
- **Windows**: set `WIN_CSC_LINK` (base64-encoded `.pfx`) and `WIN_CSC_KEY_PASSWORD`.

The GitHub Actions release workflow (`.github/workflows/release.yml`) already wires these through as repo secrets — set the secrets in GitHub, don't set them locally unless testing.

### 4. Verify before shipping
```bash
node scripts/electron-smoke-test.cjs
```
Checks: main/preload parse correctly, build config covers all 3 platforms, icons and entitlements present, CSP/contextIsolation/nodeIntegration security settings correct, auto-updater wired, backend spawner present. Should report `22/22 passed`.

### 5. Auto-updates
`electron-updater` is wired in `electron/main.cjs` — checks 5s after startup, then every 4 hours. It publishes/checks against GitHub Releases (`package.json` → `build.publish`). Cutting a new tagged release (see [RELEASE_PLAYBOOK.md](RELEASE_PLAYBOOK.md)) is what makes the update available to installed clients automatically.

---

## Production Topology Notes

- **Single-server (default)**: nginx serves the built frontend as static files and reverse-proxies API routes to the Node backend on `localhost:5050`. Leave `REACT_APP_API_URL=` blank — the frontend uses relative paths.
- **Split API domain**: if you run the API on a separate subdomain (e.g. `api.yourdomain.com`), set `REACT_APP_API_URL=https://api.yourdomain.com` before building the frontend, and update `ALLOWED_ORIGINS` to include both domains.
- **Single instance only**: `ecosystem.config.cjs` explicitly sets `instances: 1` — the in-process task queue, learning system, and context engine are not cluster-safe. Do not scale horizontally by raising this number.
- **Never run the backend manually while PM2 manages it** — `node backend/server.js` run by hand will silently hold port 5050 and block PM2 restarts with no error shown. Always use `pm2 restart jarvis-os`.

## Zero-downtime updates

```bash
bash deploy/update.sh
```
Backs up data, `git pull`s, reinstalls deps, rebuilds the frontend (if `BASE_URL` isn't localhost), clears the crash marker, and does `pm2 reload` (not `restart` — reload is zero-downtime in fork mode). Polls `/health` for up to 40s afterward.

## Rollback
See [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) for full rollback procedures (`deploy/rollback.sh`).
