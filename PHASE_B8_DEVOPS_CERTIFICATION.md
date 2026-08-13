# Phase B.8 — DevOps Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated the deployment as an SRE team would. Every figure below is measured on the live host. Reproduce → Measure → Root Cause → Recover → Regression → Reverify.

---

## Defects Found, Fixed, and Regression-Tested

### F1 — The app was in an unbounded OOM restart loop for ~2 months (**CRITICAL**)

Bringing the process under PM2 supervision immediately exposed a long-hidden defect:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**223 occurrences in `logs/pm2-err.log`, earliest 2026-06-06.**

Two independent misconfigurations combined:

| Setting | Was | Measured reality |
|---|---|---|
| `node_args --max-old-space-size` | **400 MB** | 459 MB RSS at t+2s; **390–882 MB** across 198 s |
| `max_memory_restart` | **512 MB** | below the normal operating range |

V8 aborted hard whenever the heap crossed 400 MB. PM2 restarted; the cycle repeated every ~25–30 s. And because each run survived **longer than `min_uptime` (15 s)**, PM2 counted every restart as *stable* — so `max_restarts: 5` never tripped and nothing ever escalated.

**Reproduced live:** restarts climbed 11 → 12 → 13 → 14 with uptime resetting to 3 s while RSS sat at 555–738 MB.

**Why it went unnoticed:** the process was not under PM2 at all (Phase B.5 R1). Running bare, nothing recorded the aborts or reacted to them.

**Fix** — sized from measurement, not guesswork, preserving the safety hierarchy `heap cap < ceiling`:

| Path | Setting | Now |
|---|---|---|
| PM2 | `--max-old-space-size` | 1024 MB |
| PM2 | `max_memory_restart` | 1536 MB |
| Docker | `CMD --max-old-space-size` | 1024 MB (was **also 400**) |
| Compose | `deploy.resources.limits.memory` | 1536m (was **512m**) |
| memoryTracker | `WARN/CRIT_HEAP_MB` | 900/990 (was 350/450 — inside the normal range, so pure noise) |

`Dockerfile.production` carried the identical 400 MB cap, so fixing only PM2 would have left the container path still crashing.

**Verified:** **restarts=0 and 0 new OOMs across a 198-second steady-state observation**, versus a crash every ~25–30 s before. RSS oscillates 390–882 MB — healthy GC, not a leak.
**Regression:** `tests/runtime/12-pm2-config.test.cjs` — 11 tests pinning the limit hierarchy across both deployment paths. Negative-tested: reverting to 400 MB/512M **fails** the heap-cap assertion.

### F2 — `deploy/update.sh` reported success having deployed nothing (**HIGH**)

```bash
pm2 reload jarvis-os 2>/dev/null || pm2 restart jarvis-os
```

Both commands exit **1** ("Process or Namespace jarvis-os not found") when PM2 manages nothing — but `||` makes the compound succeed, so `set -euo pipefail` never fires. The health poll then passed against whatever already held port 5050 (a hand-started bare `node`), and the script printed **"Update complete. JARVIS is running."**

**Reproduced live:** PM2 daemon up, **0 managed processes**, port 5050 held by a bare node PID, both PM2 commands failing, health returning 200.

**Fix:** explicit three-way branch — reload, else restart, else **start from `ecosystem.config.cjs`** (the same recovery `deploy/rollback.sh` already uses at lines 88/125), clearing any unmanaged process holding the port first, then `pm2 save`. A post-deploy gate now requires PM2 to actually own `jarvis-os`, so a healthy port alone can no longer be reported as a successful deploy.

**Verified:** the fallback path recovered the deployment — both `jarvis-os` and `ooplix-backup` came under PM2, `dump.pm2` refreshed (was **stale since May 10** and missing the backup job entirely), health 200, ownership gate passes.

### F3 — Two SSE endpoints were broken/buffered at the proxy (**MEDIUM**)

`nginx.conf` disabled buffering only for `/runtime/stream`, but three endpoints emit `text/event-stream`:

| Endpoint | nginx behaviour before |
|---|---|
| `POST /runtime/stream` | correct (dedicated block) |
| `POST /ai-ecosystem/orchestrator/execute/stream` | matched the broad API location → **buffered**, events withheld until completion |
| `POST /org-ai/:orgId/ask-stream` | **"org-ai" appeared 0 times in nginx.conf** → fell through to `location /` → served the **SPA shell**, never reached the backend |

Confirmed `/org-ai` is a live mounted route (`backend/routes/index.js`), returning 400 on validation — not dead code.

**Fix:** one new regex location covering both, using the same directives as `/runtime/stream`. Validated the regex against 8 URIs: it matches both targets and does **not** steal `/orgs`, `/org-network`, `/ai-ecosystem/analytics/*`, or `/runtime/stream`. Placed at line 133, before the broad block at 197 (nginx evaluates regex locations top-down).

### F4 — OCSP stapling was silently inert (**LOW**)

`ssl_stapling on; ssl_stapling_verify on;` with **zero `resolver` directives**. nginx logs `ssl_stapling ignored, host not found in OCSP responder` and stapling does nothing — clients pay an extra handshake round-trip.
**Fix:** `resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off; resolver_timeout 5s;`

### F5 — "Zero-downtime" claim was false (**documentation defect**)

`update.sh` and `ecosystem.config.cjs` both advertised zero-downtime reload. **Measured** by polling `/health` every 100 ms across a real `pm2 reload`: **56 of 200 requests failed** (~5.6 s gap).

Root cause is architectural, not a bug: `pm2 reload` only overlaps in **cluster** mode. This app is deliberately `instances: 1` / `exec_mode: fork` because taskQueue/learningSystem/contextEngine are in-process singletons (Phase B.6 proved two writers lose 60/120 writes). With one instance PM2 must stop before starting, and nginx has a single upstream with no failover — so the gap surfaces as **502**.

**Fix:** corrected the claims in both files to state the measured ~5.6 s window and its cause, and advised deploying in a low-traffic window. Cluster mode was **not** enabled — that would corrupt data.

---

## 1. Deployment Pipeline Matrix

| Stage | Observation | Classification |
|---|---|---|
| Build | `npm run build:frontend` with `REACT_APP_API_URL` from `BASE_URL`; skipped (with warning) when `BASE_URL` is localhost | CERTIFIED |
| Release | `deploy/update.sh` — backup → git pull → deps → build → reload → health gate | CERTIFIED (after F2) |
| Pre-release backup | `npm run backup` runs before any change | CERTIFIED |
| Health gate | Polls `/health` up to 40 s | CERTIFIED |
| **Deploy-success validation** | Was port-only; **now also requires PM2 ownership** | CERTIFIED (after F2) |
| Rollback (code) | `deploy/rollback.sh --code` — `.env` backup, checkout, reinstall, health poll | CERTIFIED |
| Rollback (data) | Safety-net archive first; both archive layouts handled (Phase B.5 fix) | CERTIFIED |
| **Zero-downtime** | **Not achieved — ~5.6 s 502 window, measured** | CERTIFIED WITH LIMITATIONS (F5) |
| Artifact integrity | Backup archives verified in Phase B.5; **no checksum/manifest** per release | CERTIFIED WITH LIMITATIONS |
| Staging environment | None — single production target | CONFIGURATION REQUIRED |

## 2. Process Management Matrix

| Control | Observation | Classification |
|---|---|---|
| PM2 daemon | Running (God Daemon) | CERTIFIED |
| **Managed processes** | Was **0** while the app ran bare; **now 2** (`jarvis-os`, `ooplix-backup`) | CERTIFIED (after F2) |
| **Auto-restart on crash** | **SIGKILL → auto-recovered in 7108 ms, no human action** | CERTIFIED |
| Restart policy | `autorestart: true`, `max_restarts: 5`, `min_uptime: 15s`, `restart_delay: 5000` | CERTIFIED |
| **Crash-loop guard efficacy** | Did **not** trip during 223 OOMs — each run outlived `min_uptime` | CERTIFIED WITH LIMITATIONS |
| Graceful shutdown | `kill_timeout: 8000` > 5 s drain in `_gracefulShutdown()` | CERTIFIED |
| Ready signal | `wait_ready: true` + `process.send("ready")`; `listen_timeout: 30000` | CERTIFIED |
| Single instance | `instances: 1`, `exec_mode: fork` — enforced and documented | CERTIFIED |
| **Zombie processes** | **0** | CERTIFIED |
| **Orphan processes** | Only the CRA dev server (expected in dev); no orphaned server instances | CERTIFIED |
| Reboot persistence | `dump.pm2` was **stale since 2026-05-10** and missing `ooplix-backup`; refreshed via `pm2 save` | CERTIFIED (after F2) |
| `pm2 startup` (init script) | Not verified on this host (macOS dev box) | CONFIGURATION REQUIRED |

## 3. Configuration Management Matrix

| Aspect | Observation | Classification |
|---|---|---|
| Startup env gate | `scripts/check-startup-env.cjs` → **`[PASS] All required variables set`** | CERTIFIED |
| Env loading | dotenvx, 35 vars injected | CERTIFIED |
| `.env` keys | 33 | CERTIFIED |
| `.env.example` keys | 202 (superset — documents optional integrations) | CERTIFIED |
| **Drift: undocumented** | 4 keys in `.env` absent from `.env.example`: `RAZORPAY_KEY`, `RAZORPAY_SECRET`, `TELEGRAM_CHAT_ID`, `VERIFY_TOKEN` | CERTIFIED WITH LIMITATIONS |
| Drift: unset optionals | ~170 documented-but-unset (Anthropic, Apple OAuth, etc.) — optional by design | CERTIFIED |
| Secrets in config | `.env` excluded from backups; vault is AES-256-GCM (Phase B.4/B.5) | CERTIFIED |
| Production config | `env_production` sets `NODE_ENV`/`PORT`; `.env` pins `NODE_ENV=production` | CERTIFIED |
| Staging config | None | CONFIGURATION REQUIRED |
| Feature flags | `capability-registry.json` + `version.json`, backed up | CERTIFIED |

## 4. Reverse Proxy Matrix

| Control | Observation | Classification |
|---|---|---|
| Routing | 14 location blocks; explicit API prefix allowlist | CERTIFIED |
| Upstream | `127.0.0.1:5050`, `keepalive 32` | CERTIFIED |
| **Single upstream** | No failover target — reload gap surfaces as 502 | CERTIFIED WITH LIMITATIONS |
| HTTP/1.1 + `Connection: ""` | Set on every proxy block (keepalive correctness) | CERTIFIED |
| Forwarded headers | `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` | CERTIFIED |
| `trust proxy` | `app.set("trust proxy", 1)` — correct client IP for rate limiting | CERTIFIED |
| Compression | gzip, `gzip_vary`, `gzip_min_length 1024`; verified live | CERTIFIED |
| Caching | Hashed assets `1y immutable`; media `30d`; `index.html` `no-cache` | CERTIFIED |
| Timeouts | `proxy_connect_timeout 10s`, `send/read 60s`; SSE 3600s | CERTIFIED |
| Body size | `client_max_body_size 10m` — matches Express's 10 MB limit | CERTIFIED |
| Rate limiting | `limit_req` zones with `limit_req_status 429` | CERTIFIED |
| **SSE buffering** | Was correct for 1 of 3 SSE endpoints | CERTIFIED (after F3) |
| Dotfile protection | `location ~ /\.(git|env|htaccess|...)` denied | CERTIFIED |
| WebSocket | No `Upgrade` handling — app uses SSE, not WS | CERTIFIED (N/A) |

## 5. HTTPS Matrix

| Control | Observation | Classification |
|---|---|---|
| TLS versions | **TLSv1.2 + TLSv1.3 only** | CERTIFIED |
| Ciphers | `HIGH:!aNULL:!MD5`, `ssl_prefer_server_ciphers on` | CERTIFIED |
| Session cache | `shared:SSL:10m`, 10 m timeout | CERTIFIED |
| HTTP→HTTPS | `return 301 https://$host$request_uri` | CERTIFIED |
| HSTS | `max-age=63072000; includeSubDomains; preload` (nginx + app) | CERTIFIED |
| Certificates | Let's Encrypt via certbot (`deploy/https-setup.sh`) | CERTIFIED |
| Cert rotation | `certbot.timer` detected, else manual cron fallback | CERTIFIED |
| ACME challenge | `/.well-known/acme-challenge/` location present | CERTIFIED |
| **OCSP stapling** | Enabled but **inert without a resolver** | CERTIFIED (after F4) |
| `ssl_dhparam` | Not set — relies on nginx defaults | OBSERVATION |

## 6. Observability Matrix

| Signal | Observation | Classification |
|---|---|---|
| Health endpoint | `/health` → per-service status + warnings, **0.7 ms p50** | CERTIFIED |
| Structured logs | NDJSON to `data/logs/`; `x-request-id` on every response | CERTIFIED |
| Request logging | `requestLogger` middleware (method/path/status/ms) | CERTIFIED |
| Error tracking | `errorTracker` + `observabilityEngine.structuredLog` on unhandled errors | CERTIFIED |
| Audit trail | `data/logs/audit.ndjson`, append-only, 20 MB rotation, `malformed: 0` | CERTIFIED |
| Metrics endpoints | `/runtime/metrics` (200), `/metrics` + `/ops/metrics` (403 operator-gated) | CERTIFIED |
| Crash forensics | `_writeCrashForensics()` writes a queue snapshot on `uncaughtException` | CERTIFIED |
| Ops dashboard | `deploy/monitor.sh` — PM2 status, CPU, memory, errors, CRM, webhooks | CERTIFIED |
| **Memory alerting** | Thresholds sat at 350/450 MB inside a 700–880 MB normal range → constant noise; **re-based to 900/990** | CERTIFIED (after F1) |
| **OOM escalation** | 223 fatal aborts produced **no alert** for ~2 months | CERTIFIED WITH LIMITATIONS |
| Traces | No distributed tracing (single-process; `x-request-id` is the correlation id) | OBSERVATION |
| External APM | None (no Datadog/Sentry/Prometheus scrape) | CONFIGURATION REQUIRED |

## 7. Monitoring Matrix

| Dimension | Coverage | Classification |
|---|---|---|
| CPU | PM2 `monit` + `deploy/monitor.sh` | CERTIFIED |
| RAM | PM2 `monit` + in-process `memoryTracker` (rss/heap samples, 60 s cadence, 1 h window) | CERTIFIED |
| Disk | `/ops/disk` (operator-gated); Phase B.5 burn-in has a disk monitor | CERTIFIED |
| Network | Not directly instrumented | OBSERVATION |
| **Queue** | `/enterprise/monitoring/:orgId/queue` → counts, `oldestPendingMins`, `failedLast24h`, `failureRate`, `healthy` | CERTIFIED |
| Runtime | `/runtime/audit/health` → `healthy`, `malformed`, `seq` | CERTIFIED |
| **AI** | `/enterprise/monitoring/:orgId/ai-usage` → requests, cost USD, failures, **budget** | CERTIFIED |
| Database | `check-persistence-divergence.cjs`; JSON↔SQLite drift now reconciled (Phase B.6) | CERTIFIED |
| Connectors | `/enterprise/monitoring/:orgId/connectors` → expiring/overdue/score | CERTIFIED |
| Background jobs | `/enterprise/monitoring/:orgId/background-jobs` → running + observers | CERTIFIED |
| Alerts | `/enterprise/monitoring/:orgId/alerts` with evaluate/resolve/suppress | CERTIFIED |

Application-level monitoring is genuinely strong — queue depth, failure rate, AI spend against budget, and connector expiry are all first-class. The weakness is that **nothing pages a human**: signals exist, escalation does not.

## 8. Autoscaling Readiness Matrix

| Dimension | Status | Basis |
|---|---|---|
| **Horizontal** | **BLOCKED** | `instances: 1` enforced. Phase B.6 proved two OS processes writing the same JSON store **lose 60/120 writes** (no file locking) |
| **Vertical** | **READY** | `node_args` + `max_memory_restart` tunable; host has 8 GB; F1 raised the caps successfully |
| Stateless services | **NO** | taskQueue / learningSystem / contextEngine are in-process singletons |
| Sticky sessions | N/A | Single instance; JWT auth is itself stateless |
| Shared storage | **NO** | Local filesystem only (`data/` 715 MB); no S3/NFS abstraction |
| Load balancer | nginx present, single upstream | RECOVERY REQUIRED for multi-node |
| Scaling blockers | (1) in-process singletons; (2) whole-file JSON persistence without locks; (3) local-only storage | CERTIFIED WITH LIMITATIONS |

Vertical scaling is the supported path and it works. Horizontal scaling requires the persistence change Phase B.6 identified — out of scope here and correctly forbidden by this mission.

## 9. Resource Management Matrix

| Metric | Measured | Classification |
|---|---|---|
| **RSS steady state** | **390–882 MB** (oscillating — healthy GC) | CERTIFIED |
| RSS at boot +2 s | 459 MB | CERTIFIED |
| CPU | 28–63 % during agent registration, settling after | CERTIFIED |
| **File descriptors** | **38 open** against a 1048576 soft limit | CERTIFIED |
| FD composition | 13 REG, 5 unix, 4 PIPE, 4 IPv4, 4 DIR, 3 KQUEUE — no growth | CERTIFIED |
| Handle leaks | None observed across repeated restarts | CERTIFIED |
| **Temp files** | **0 stray `.tmp`** in `data/` | CERTIFIED |
| **OOM crashes** | 226 total, **all pre-fix; 0 new in 198 s post-fix** | CERTIFIED (after F1) |
| **PM2 log rotation** | **INERT** — `max_size`/`retain` are pm2-logrotate *module* options; no module installed; `pm2-out.log` measured at **45.7 MB** vs the claimed 10 MB cap, 0 rotated files | RECOVERY REQUIRED |
| App log rotation | `data/logs/audit.ndjson` rotates at 20 MB (works) but rotated files are never cleaned (Phase B.5 R6) | CERTIFIED WITH LIMITATIONS |
| Storage growth | `data/` 715 MB · `logs/` 57 MB · `backups/` 7.3 MB | CERTIFIED WITH LIMITATIONS |

## 10. Release Safety Matrix

| Control | Observation | Classification |
|---|---|---|
| **Rollback time (measured)** | `pm2 restart` → healthy in **7253 ms** | CERTIFIED |
| **Crash recovery (measured)** | SIGKILL → auto-recovered in **7108 ms** | CERTIFIED |
| Reload gap (measured) | **~5.6 s / 56 of 200 requests failed** | CERTIFIED WITH LIMITATIONS (F5) |
| Code rollback | `rollback.sh --code` with `.env` backup + health poll | CERTIFIED |
| Data rollback | Safety-net archive + layout detection (Phase B.5) | CERTIFIED |
| Deployment validation | Health gate **plus** PM2 ownership gate | CERTIFIED (after F2) |
| Smoke tests | `deploy/validate-production.sh`, `deploy/healthcheck.sh`, `scripts/electron-smoke-test.cjs` | CERTIFIED |
| Partial deployment recovery | `update.sh` now starts from ecosystem when nothing is managed | CERTIFIED (after F2) |
| Startup crash tracking | `data/startup_crash_count.json` reset per deploy | CERTIFIED |
| Regression gate in pipeline | `update.sh` does **not** run `npm run test:runtime` before reload | CERTIFIED WITH LIMITATIONS |

## 11. Production Operations Matrix

| Job | Mechanism | State | Classification |
|---|---|---|---|
| **Backup** | `ooplix-backup` PM2 app, `cron_restart: "0 2 * * *"` | **Ran on start, produced a real archive** | CERTIFIED |
| Backup (cron) | crontab 03:00 → `safe-backup.cjs` + `export-offsite.cjs` | Present | CERTIFIED |
| **Offsite export** | `export-offsite.cjs` scheduled but `BACKUP_DEST`/`BACKUP_PASSWORD` unset | **Inert** | RECOVERY REQUIRED (Phase B.5 R2) |
| Scheduler | `automation.stop()`/start wired into lifecycle | CERTIFIED |
| Timers | `memoryTracker` 60 s, `recovery_agent` 60 s, `eos_recovery` 240 s | CERTIFIED |
| Cleanup jobs | `pruneOldTasks`, `abandonStuckTasks` — verified to preserve live data (Phase B.6) | CERTIFIED |
| AI jobs | AutoLoop + orchestrator; honest failure reporting (Phase B.4) | CERTIFIED |
| Mission jobs | 1635 missions; reconciliation on boot | CERTIFIED |
| Log cleanup | **None** for rotated files | RECOVERY REQUIRED |

## 12. Infrastructure Readiness Matrix

| Target | Assessment | Classification |
|---|---|---|
| **VPS** | Primary target. `setup-vps.sh`, `start-production.sh`, `update.sh`, `rollback.sh`, `https-setup.sh`, `monitor.sh`, `healthcheck.sh`, `validate-production.sh` | CERTIFIED |
| **Docker** | `Dockerfile.production` — multi-stage (frontend → native → runtime), non-root `USER jarvis`, `EXPOSE 5050`, `HEALTHCHECK`, tini as PID 1 | CERTIFIED (after F1 heap fix) |
| Compose | `docker-compose.prod.yml` with resource limits + volumes | CERTIFIED (after F1 limit fix) |
| **Kubernetes** | Not ready — single-writer persistence, local-only storage, in-process singletons. A `HEALTHCHECK` and non-root user exist, so a 1-replica StatefulSet with a PVC is conceivable, but no manifests exist | CONFIGURATION REQUIRED |
| Cloud portability | Env-driven config, no hardcoded cloud SDKs; blocked mainly by local-filesystem state | CERTIFIED WITH LIMITATIONS |
| **Multi-node** | **BLOCKED** — same single-writer constraint | RECOVERY REQUIRED |
| Reverse proxy portability | nginx config is host-agnostic apart from cert paths | CERTIFIED |

## 13. Root Causes

| Finding | Root cause |
|---|---|
| F1 OOM loop | `--max-old-space-size=400` below the app's real heap need; `max_memory_restart` below steady state; `min_uptime` shorter than the inter-crash interval so the guard never armed; **no supervision** meant nothing recorded it |
| F2 false deploy success | `cmd_a \|\| cmd_b` neutralises `set -e`; success validated on port health rather than PM2 ownership |
| F3 SSE broken/buffered | Buffering-off was applied per-endpoint rather than per-content-type, and `/org-ai` was never added to the nginx prefix allowlist |
| F4 OCSP inert | `ssl_stapling` requires a `resolver`; nginx warns but does not fail |
| F5 false zero-downtime claim | `pm2 reload` overlaps only in cluster mode; fork+1 instance cannot overlap, and the docs were written from intent not measurement |
| PM2 log growth | `max_size`/`retain` are pm2-logrotate module options; core PM2 ignores them silently |
| No horizontal scaling | Whole-file JSON persistence with no locking (Phase B.6) |

## 14. Remediation Matrix

| ID | Recommendation | Scope | Priority |
|---|---|---|---|
| F1 | **DONE** — heap/ceiling re-sized across PM2 + Docker + compose + thresholds; 11 regression tests | 4 files | ✅ Fixed |
| F2 | **DONE** — ecosystem fallback + PM2 ownership gate | `update.sh` | ✅ Fixed |
| F3 | **DONE** — SSE location for `/org-ai` + `/ai-ecosystem/.../stream` | `nginx.conf` | ✅ Fixed |
| F4 | **DONE** — `resolver` added for OCSP | `nginx.conf` | ✅ Fixed |
| F5 | **DONE** — downtime claims corrected to measured reality | 2 files | ✅ Fixed |
| D1 | `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 5` — makes the existing config keys real | ops | **P0** |
| D2 | Set `BACKUP_DEST` + `BACKUP_PASSWORD` to activate offsite replication (carried from B.5 R2) | `.env` | **P0** |
| D3 | Run `pm2 startup` and re-`pm2 save` on the VPS so the process list survives reboot | ops | **P1** |
| D4 | Add alert escalation for repeated restarts / OOM — a signal that reaches a human, e.g. `_runtimeAlert()` on `restart_time` growth | `server.js` / monitor | **P1** |
| D5 | Add rotated-log cleanup honouring the documented 30-day retention (B.5 R6) | `auditLog.cjs` / cron | **P1** |
| D6 | Run `npm run test:runtime` as a gate inside `update.sh` before reload | `update.sh` | P2 |
| D7 | Emit a per-release checksum manifest for artifact integrity (B.5 R5) | build script | P2 |
| D8 | Add `error_page 502` with a retry/maintenance page to soften the reload window | `nginx.conf` | P2 |
| D9 | Document the 4 undocumented `.env` keys in `.env.example` | `.env.example` | P2 |
| D10 | Lower `min_uptime` (or add an OOM-specific guard) so a slow crash loop trips `max_restarts` | `ecosystem.config.cjs` | P3 |
| D11 | Add `ssl_dhparam` for explicit DH parameters | `nginx.conf` | P3 |
| D12 | Add a staging target before considering K8s or multi-node | infra | P3 |

## Scores

### DevOps Readiness

| Dimension | Weight | Score | Weighted |
|---|---|---|---|
| Deployment pipeline | 15% | 8.5 | 1.28 |
| Process management | 15% | **9.0** | 1.35 |
| Configuration management | 10% | 8.5 | 0.85 |
| Reverse proxy | 10% | 9.0 | 0.90 |
| HTTPS | 10% | **9.5** | 0.95 |
| Observability | 10% | 7.0 | 0.70 |
| Monitoring | 10% | 8.0 | 0.80 |
| Autoscaling readiness | 5% | **4.0** | 0.20 |
| Resource management | 10% | 7.0 | 0.70 |
| Infrastructure readiness | 5% | 6.5 | 0.33 |
| **DevOps Readiness** | **100%** | — | **8.06 / 10** |

### Production Operations

| Dimension | Weight | Score | Weighted |
|---|---|---|---|
| Crash recovery (measured 7.1 s, automatic) | 20% | **9.5** | 1.90 |
| Rollback safety (measured 7.3 s, reversible) | 20% | 9.0 | 1.80 |
| Scheduled jobs (backup/cleanup/scheduler live) | 15% | 8.5 | 1.28 |
| Release safety (health + ownership gates) | 15% | 8.0 | 1.20 |
| Alerting & escalation | 15% | **4.5** | 0.68 |
| Log & storage hygiene | 15% | **5.0** | 0.75 |
| **Production Operations** | **100%** | — | **7.61 / 10** |

---

## Certification

**DevOps Readiness: 8.1 / 10 — CERTIFIED WITH LIMITATIONS**
**Production Operations: 7.6 / 10 — CERTIFIED WITH LIMITATIONS**

**What this phase actually changed.** Phase B.5 recorded "no process supervisor" as an open risk with unbounded RTO. Bringing the app under PM2 here both closed that gap — **SIGKILL now auto-recovers in 7.1 s with no human action** — and immediately surfaced a defect that had been hidden by the absence of supervision: **223 V8 heap-limit aborts since 2026-06-06**, an unbounded OOM restart loop nobody knew about, because running bare there was nothing to record or react to it. That is the strongest argument in this report for supervision itself.

**Five defects found, reproduced, fixed and verified.** The OOM loop (F1) and the deploy that reported success having deployed nothing (F2) were both real production hazards, each reproduced live before being touched. Two SSE endpoints were broken or buffered at the proxy (F3) — one of them, `/org-ai`, appeared **nowhere** in `nginx.conf` and was silently served the SPA shell. OCSP stapling was inert (F4). And the "zero-downtime" claim was false by measurement (F5): 56 of 200 requests failed across a real reload, so the documentation now states the ~5.6 s window and its cause rather than an aspiration.

**The infrastructure itself is well-built.** TLS 1.2/1.3 with HSTS preload and OCSP, a non-root multi-stage Dockerfile with `HEALTHCHECK` and tini as PID 1, eight purpose-built deploy scripts, `wait_ready` with a real readiness signal, `kill_timeout` correctly exceeding the graceful-drain window, a pre-release backup, a reversible data rollback, **0 zombies, 0 orphaned server instances, 38 open FDs, 0 stray temp files**, and genuinely good application monitoring (queue depth, failure rate, AI spend against budget, connector expiry).

**Two P0 items remain and neither needs code:** enable `pm2-logrotate` so the `max_size`/`retain` keys already in the config stop being inert (measured `pm2-out.log` at 45.7 MB against a claimed 10 MB cap), and set `BACKUP_DEST`/`BACKUP_PASSWORD` to activate the offsite export that is already scheduled. Beyond those, the honest weak spot is **escalation, not instrumentation** — the signals to catch F1 existed, but nothing pages a human, which is precisely why a 2-month crash loop went unnoticed.

**Horizontal scaling stays blocked, correctly.** `instances: 1` is not timidity: Phase B.6 measured two OS processes losing 60 of 120 writes to the same JSON store. Vertical scaling is the supported path and F1 demonstrated it works.

**Validation hygiene:** one PM2-managed server instance, `dump.pm2` refreshed (was stale since 2026-05-10 and missing the backup job), health 200, **0 new OOMs across 198 s**, restarts stable. Regression **144/144 existing + 28/28 new (B.6 + B.7 + B.8)**. nginx changes validated by brace balance, terminal-directive audit, and an 8-case regex behaviour test (Docker daemon was unavailable for `nginx -t`) — flagged as a limitation. Changes limited to `ecosystem.config.cjs`, `deploy/update.sh`, `nginx.conf`, `Dockerfile.production`, `docker-compose.prod.yml`, `backend/utils/memoryTracker.js`, and one new test file, plus prior-phase files. No merge, no push, no infrastructure redesign, no Kubernetes migration, no Docker rewrite, no CI/CD replacement.
