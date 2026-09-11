# 14 — Infrastructure

**Status of this document:** VERIFIED against `deploy/`, `nginx.conf`, `ecosystem.config.cjs`, `Dockerfile.production`, `docker-compose.prod.yml`, and the 2026-07-17 performance/DevOps audit (`docs/current/phase7-9-performance-devops.md`), which includes real measured numbers from an actual (non-production) run.

---

## Servers

**Primary/actual deployment target: a single Ubuntu 22.04/24.04 VPS.** `deploy/setup-vps.sh` installs Node.js 20 LTS, PM2, nginx, ufw, and certbot; creates a dedicated non-root `jarvis` app user; clones the repo into `/opt/jarvis-os`. Repo URL is hardcoded to `https://github.com/EHTSM/jarvis-os.git`.

`deploy/start-production.sh` performs pre-flight validation before allowing a production start: confirms `.env` exists, and that `GROQ_API_KEY`, `BASE_URL`, `JWT_SECRET`, `OPERATOR_PASSWORD_HASH` are set and not placeholder values (hard-fails if missing/weak); warns (non-fatal) on missing `TELEGRAM_TOKEN`, `RAZORPAY_WEBHOOK_SECRET`, WhatsApp tokens.

## Domains

Confirmed from `nginx.conf`: `app.ooplix.com`, `ooplix.com`, `www.ooplix.com` — three domains served from one nginx config, HTTP→HTTPS redirect with Certbot ACME-challenge passthrough, TLS 1.2/1.3 only, HSTS `max-age=63072000` (2 years), OCSP stapling on.

## Electron (Desktop Distribution)

See [03_TECHNOLOGY_STACK.md](03_TECHNOLOGY_STACK.md) and [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) — the desktop build pipeline is currently broken (B17: `node-pty` native-module rebuild hangs during packaging on all 3 platforms, in both real CI and local reproduction). No installer has ever been successfully produced by the real release pipeline. This is the top infrastructure blocker for desktop distribution specifically.

## Web

Static frontend build served **directly by nginx** from `/opt/jarvis-os/frontend/build` (matching the VPS path from `setup-vps.sh`). Hashed static assets get 1-year immutable cache headers. Backend upstream: `127.0.0.1:5050`, matching the Express server's default `PORT`.

## VPS Specifics

- **Minimum spec** (per `FOUNDER_CHECKLIST.md`): 2GB RAM.
- **Process manager**: PM2, fork mode, **explicitly single-instance** — `ecosystem.config.cjs` sets `instances: 1` with a code comment stating in-process singletons (task queue, learning system, context engine) are not cluster-safe: *"Never set instances > 1."* **This means the current architecture does not support horizontal scaling on a single VPS beyond one process.**
- **Memory ceiling**: `max_memory_restart: "512M"`, V8 heap capped at `--max-old-space-size=400` (400MB heap under a 512MB restart ceiling).
- **Restart policy**: `max_restarts: 5`, `min_uptime: "15s"`, `restart_delay: 5000` — crash-loop protection, matching a "QUARANTINE" warning threshold in `server.js`'s own startup gate at 5 consecutive crashes.
- **Startup timing**: `listen_timeout: 30000` (30s) — explicitly sized to cover the very long startup sequence (100+ agent/subsystem registrations on a cold boot). Real measured cold-boot time (spawn → first `/health` 200): **972ms–1,359ms** across 3 runs on a real (non-VPS) test machine.
- **Measured idle footprint**: ~145MB RSS idle, ~128MB under a 250-request burst (RSS did not grow under load — GC reclaimed). A 60-second idle-window fast-leak check showed RSS **declining**, not growing — no fast leak detected. This does not rule out a slow multi-hour leak; see [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R13.
- A second PM2 app, **`ooplix-backup`**, runs `scripts/safe-backup.cjs` on a daily cron (`0 2 * * *`, 2am).

## Storage

**No general-purpose database.** 408 flat JSON files under `/data` (one per subsystem) plus one narrow SQLite table (`data/jarvis.db`, task queue only, WAL mode via `better-sqlite3`). See [03_TECHNOLOGY_STACK.md](03_TECHNOLOGY_STACK.md) and [04_SYSTEM_ARCHITECTURE.md](04_SYSTEM_ARCHITECTURE.md) for the full implication of this choice.

**A real, currently-degraded issue found in the 2026-07-17 audit**: `better-sqlite3`'s native module was compiled against a different Node ABI version than the one actually running in at least one tested environment, causing repeated shadow-write failures — the app falls back to the JSON store (non-fatal, but a real degradation). Fix: `npm rebuild better-sqlite3` in the actual deployment environment.

## Backups

Per `DISASTER_RECOVERY.md` (founder-authored) and the live audit:
- **`npm run backup`** (`backup.sh`) — routine backup, safe to run frequently or via cron. Archives `data/` (excluding `data/autonomous` and `data/futureTech`, which are large and regenerable) to `backups/jarvis_TIMESTAMP.tar.gz`. Keeps the last 14 backups automatically.
- **`node scripts/safe-backup.cjs`** — more thorough pre-change snapshot, including the JSON task queue and SQLite DB consistently. **Live-verified working** in the audit: created a real tarball, pruned oldest.
- **A real bug was found in the disaster-recovery *validator*** (not the backup itself): `safe-backup.cjs` writes the DB into the archive as `jarvis.db.raw`, but `test-restore.cjs` expects `jarvis.db` — a naming mismatch that causes the restore validator to report a false failure even though the underlying `data/` restore succeeded (444 files recovered intact in the audited test). **This should be fixed before relying on `test-restore.cjs`'s pass/fail signal in an actual incident.**
- **`.env` is deliberately never backed up** — `DISASTER_RECOVERY.md` states this explicitly as a security design choice: including it in a backup archive would mean every backup copy is also a credentials-leak risk. (Note: this same principle appears to have been violated by an ad hoc `.env.bak.module8` file found untracked in the repo root during this documentation effort — see the note at the top of this documentation set's cover conversation; flagged for the founder directly.)
- **Gap explicitly documented by the founder**: off-server backup replication (copying backups to a separate location/provider) is **not yet set up** — `DISASTER_RECOVERY.md` calls this "the single biggest gap between 'we have backups' and 'we can actually recover.'" If the VPS itself is lost, current backups stored only on that VPS are lost with it.

## Monitoring

- `deploy/monitor.sh` — confirms PM2 process status, `/health` response, memory, CRM pipeline state, connector health in one pass. Documented as the founder's daily 5-minute check in `SUPPORT_RUNBOOK.md`.
- `deploy/healthcheck.sh` — intended for cron-based automated health checking.
- Structured logging via `backend/utils/logger.js` — writes to a file only when `LOG_FILE` is set (does not auto-write to `logs/` otherwise); confirmed live-appending during a real test run. In PM2/production, stdout is captured to `logs/pm2-out.log`/`pm2-err.log` per `ecosystem.config.cjs`, with rotation (10MB per file, 5 files retained).
- Runtime alerting: fire-and-forget Telegram alerts to an operator chat ID on startup/crash events, always logged locally to `data/runtime-alerts.log` regardless of whether Telegram is configured.
- No third-party APM/error-tracking service (e.g. Sentry, Datadog) is wired into the *application's own* monitoring by default — though **Sentry and Datadog are both available as connector integrations** a customer/operator could enable (Phase L in the connector registry, see [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md)) — this is optional, not a default.

## Release Pipeline

See [16_DEVOPS.md](16_DEVOPS.md) for full detail. Summary: GitHub Actions CI runs a 144-check regression suite, a real frontend build, and deploy-script syntax checks on every push/PR. A separate Release workflow triggers on version tags and packages a server tarball for manual VPS deployment (`npm run deploy:update`) — **CI does not deploy automatically**, and does not build a Docker image or an Electron installer (the Electron build is attempted but currently fails — B17).

## Docker — Built But Not the Real Path

`Dockerfile.production` and `docker-compose.prod.yml` are both well-constructed and internally consistent with the rest of the app (same port, health endpoint, memory ceiling as the PM2 config). **However**: zero references to Docker exist in either CI workflow; the files have been touched in exactly one historical commit since being added; and the actual release pipeline packages a plain tarball, not a Docker image. **Treat Docker as a complete but unexercised alternative deployment path**, not the operational reality — see [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) blocker B12 (the daemon has never successfully run in any audited environment, so even the static-review confidence has not been confirmed by a real build).

---

*Next: [15_SECURITY.md](15_SECURITY.md) for the security posture underpinning this infrastructure.*
