# JARVIS OS Runtime Separation & Stabilization Report

## 1. Repo scope and separation

- This workspace is a single `jarvis-os` repository.
- The repo contains:
  - `backend/` — Node.js/Express runtime and business logic
  - `frontend/` — React SPA UI
  - `electron/` — Electron shell and renderer bootstrap
  - `deploy/` — nginx and deployment helper configs
- No source matching `alwaliy_ecosystem` was found inside this workspace.
  - The current repo is self-contained for `jarvis-os`.
  - If `alwaliy_ecosystem` is a separate project, it is not present here.

## 2. Core runtime responsibilities

### Backend

- Main entrypoint: `backend/server.js`
- Production process managed by PM2 via `ecosystem.config.cjs`
- Listens on port `5050` by default
- Responsibilities:
  - API gateway routes: `/jarvis`, `/health`, `/runtime/*`, `/auth/*`, `/crm/*`, `/payment/*`, etc.
  - Static frontend serving if `frontend/build` exists
  - Startup health gate, crash counters, graceful shutdown, telemetry, queue integrity
  - Telegram bot, autonomous loop, runtime agent registry, event bus, metrics persistence

### Frontend

- React app located in `frontend/`
- Dev server port: `3000`
- Build output: `frontend/build`
- Client-side routing determines context:
  - `desktop=1` query param → Electron shell
  - Hostname starts with `app.` → SaaS mode
  - Otherwise → public marketing flow
- Shared API client supports:
  - same-origin deployment (`REACT_APP_API_URL` empty)
  - split deployment using `REACT_APP_API_URL=https://api.ooplix.com`

### Electron shell

- Main process: `electron/main.cjs`
- Loads React app from:
  - Dev: `http://localhost:3000?desktop=1`
  - Prod: `frontend/build/index.html` with `desktop=1`
- Uses IPC to proxy desktop UI commands to backend on `http://localhost:5050`
- Includes runtime stability features:
  - build validation before window creation
  - renderer crash recovery and reload backoff
  - health polling of backend
  - sleep/resume recovery
  - low-memory notifications

## 3. SaaS vs public routing

### Client-side routing rules

From `frontend/src/App.jsx`:

- `desktop` shell is detected by query param:
  - `?desktop=1`
- SaaS web app is detected by hostname prefix:
  - `window.location.hostname.startsWith("app.")`
- Initial screen behavior:
  - Electron shell → `app` (skip landing/onboarding)
  - `app.ooplix.com` → SaaS onboarding if no profile, else `app`
  - `ooplix.com` / public site → landing first, then onboarding, then `app`

### Deployment routing

From `deploy/nginx-multisite.conf`:

- `ooplix.com` and `www.ooplix.com`
  - public landing page
  - serve the SPA build
  - do not proxy backend API calls from landing
- `app.ooplix.com`
  - SaaS web app
  - serve same SPA build
  - proxy authenticated runtime/API routes to backend
- `api.ooplix.com`
  - backend API only
  - no static frontend files

## 4. Production topology

### Runtime topology

- Single VPS model:
  - `nginx` handles TLS and vhost routing
  - Node backend runs on `localhost:5050`
  - One frontend build is shared by public and SaaS domains
- Backend only in production via PM2:
  - `ecosystem.config.cjs` declares one app: `jarvis-os`
  - `instances: 1` and `exec_mode: fork`
  - `wait_ready: true` with `process.send("ready")` in `backend/server.js`
  - `max_memory_restart: 512M`
  - silent `watch: false` for production

### Static build handling

- `backend/server.js` will serve `frontend/build` when it exists
- Electron production load uses the same build output
- Frontend can run as:
  - combined deployment: same origin frontend + backend
  - split deployment: set `REACT_APP_API_URL=https://api.ooplix.com`

## 5. Exact startup commands

### Install dependencies

- Root repo:
  - `npm install`
- Frontend:
  - `cd frontend && npm install`
- Electron folder is a nested package but the active shell uses root scripts.

### Development

- Start backend only:
  - `npm start`
- Start frontend only:
  - `npm run frontend`
- Start Electron shell only:
  - `npm run desktop`
- Start backend + frontend together:
  - `npm run dev`
- Start backend + frontend + Electron together:
  - `npm run dev:full`

### Production build

- Build frontend:
  - `npm run build:frontend`
- Start production backend via PM2:
  - `npm run pm2:start`
- Manage production backend:
  - `npm run pm2:restart`
  - `npm run pm2:logs`
  - `npm run pm2:stop`

### Electron packaging

- `npm run dist:mac`
- `npm run dist:win`
- `npm run dist:linux`
- `npm run dist:all`

## 6. Electron boot summary

- `electron/main.cjs` is the shell entrypoint.
- In dev, it loads the React dev server at `http://localhost:3000?desktop=1`.
- In prod, it loads `frontend/build/index.html` and injects `desktop=1` via the Electron query API.
- It validates build existence before window creation and alerts if missing.
- Backend communication is proxied through IPC handlers to `http://localhost:5050`.
- A renderer crash loop guard prevents infinite reloads after repeated failures.
- Health polling adapts to window focus and hidden state.

## 7. Production stability observations

- Responsibilities are already cleanly separated:
  - `backend/server.js` is the single production entrypoint
  - `frontend/` is the UI bundle and SPA
  - `electron/` is the desktop shell
- The `deploy/nginx-multisite.conf` file defines the SaaS/public/api domain split explicitly.
- The repo supports both:
  - public landing flow on `ooplix.com`
  - SaaS app on `app.ooplix.com`
  - Electron desktop shell with direct backend access

## 8. Gap / next step

- Current repo does not contain a separate `alwaliy_ecosystem` project.
- For a clean separation, keep `jarvis-os` exclusively focused on backend + frontend + Electron.
- If an external `alwaliy_ecosystem` repository exists, document it separately and avoid mixing its deployment/runtime concerns into `jarvis-os`.
