# Phase 7 & 9 — Performance + Production/DevOps (Measured)

**Date:** 2026-07-17
**Machine:** macOS/Darwin 24.6.0 (Apple Silicon), Node v24.11.1 (nvm), curl present (`/usr/bin/curl`)
**Mode:** Execution-mode measurement only. Every number below came from a command actually run on this machine. No mocked or guessed values.

---

## PHASE 7 — PERFORMANCE

### 1. Cold boot time (spawn → `/health` returns 200)

Harness: spawned `JWT_SECRET=perf-test-secret PORT=5096 node backend/server.js` in the background, polled `http://localhost:5096/health` with Node `fetch` every 50 ms, timestamped first 200, killed, repeated 3× (script: `scratchpad/coldboot.mjs`).

| Run | Time to first 200 |
|-----|-------------------|
| 1   | 1359 ms |
| 2   | 1019 ms |
| 3   | 972 ms  |

**min 972 ms · max 1359 ms · avg 1117 ms.** (Run 1 is a cold-cache outlier; runs 2–3 with warm FS cache ~1s.)

### 2. Response time — per endpoint (10 reqs each, Node `fetch` + `performance.now()`)

Server: `JWT_SECRET=perf-test-secret PORT=5096 node backend/server.js`. Authenticated routes used a self-signed HS256 cookie `jarvis_auth=<jwt>` built with the exact scheme in `backend/middleware/authMiddleware.js` (`{alg:HS256,typ:JWT}`, HMAC-SHA256 over `header.body`, base64url). Payload `{sub:"perf-user",role:"operator",exp:now+3600}`.

| Endpoint | Auth | Status | min (ms) | p50 (ms) | p95 (ms) | max (ms) |
|----------|------|--------|----------|----------|----------|----------|
| `/health` | no | 200 | 0.59 | 0.95 | 3.0 | 3.0 |
| `/api/status` | no | 200 | 0.35 | 0.42 | 1.04 | 1.04 |
| `/test` | no | 200 | 0.35 | 0.43 | 1.11 | 1.11 |
| `/orgs` | cookie | 200 | 0.57 | 0.76 | 20.1 | 20.1 |
| `/ai/status` | cookie | 200 | 744.18 | **1021.71** | 1268.93 | 1268.93 |
| `/ent/status` | cookie | 200 | 2.08 | 2.77 | 13.29 | 13.29 |
| `/civ/v9/health` | cookie | 200 | 31.17 | 34.57 | 59.11 | 59.11 |
| `/auto-market/health` | cookie | 200 | 2.25 | 5.35 | 22.47 | 22.47 |

- **Fastest:** `/api/status` (p50 0.42 ms) — a static JSON literal.
- **Slowest:** `/ai/status` (p50 ~1022 ms) — it makes a **real outbound provider round-trip** (GET the provider `/models` endpoint) to report live status, so it is dominated by network + provider latency, not app code.
- `/civ/v9/health` (p50 ~35 ms) is the heaviest pure-compute route (computes civilization health snapshot on every call).
- Without the auth cookie, `/ent/status`, `/civ/v9/health`, `/auto-market/health` return **401** (gated by router mount order); with the cookie all return 200.

### 3. CPU / RAM (`ps -o pid,%cpu,%mem,rss`)

Note: macOS `ps %CPU` is a cumulative average over process lifetime, not instantaneous. RSS in KB.

| State | %CPU | %MEM | RSS |
|-------|------|------|-----|
| Idle (baseline) | 16.2 | 1.8 | 148,768 KB (~145 MB) |
| Under load (250 reqs to `/health`, sampled mid-burst) | 36.8 | 1.6 | 131,072 KB (~128 MB) |

RSS did not grow under load (GC reclaimed). ~145 MB idle footprint; well under the PM2 `max_memory_restart: 512M` ceiling.

**Fast-leak check — idle RSS at t=0/30/60s** (tests whether the setInterval tick loops leak in a 60 s window):

| t | RSS | Δ from t=0 |
|---|-----|-----------|
| 0 s | 95,872 KB | — |
| 30 s | 75,728 KB | −20,144 KB |
| 60 s | 69,248 KB | −26,624 KB |

RSS **declined** over 60 s idle — **no fast leak.** (This does not rule out a slow multi-hour leak.)

### 4. AI latency — MEASURABLE, but app path degraded

Keys present in `.env` (verified non-empty without printing values): `GROQ_API_KEY` (56 chars), `OPENAI_API_KEY` (164 chars), `LLM_PROVIDER=groq`.

- **Raw provider reachability** (direct Node `fetch` to `https://api.groq.com/openai/v1/chat/completions`, model `llama-3.3-70b-versatile` — the exact model `backend/services/aiService.js` uses): **HTTP 200 in 349–442 ms**, valid completion returned, rate-limit headers healthy (`x-ratelimit-remaining-requests: 966`, `remaining-tokens: 11959`).
- **App path** (`POST /ai/chat` with auth cookie, minimal prompt): returned HTTP 200 in **~2540 ms** but with the fallback body `"AI backend unavailable. Check provider API keys in your .env file."`. Server logs show every provider throwing: `AI [groq] failed: Request failed with status code 429` and `AI [openai] failed: ...429`, all others "KEY not set" / local-not-running.
- **Interpretation:** The key is valid and the provider is directly reachable in ~350 ms. The app returned 429s during burst testing because `callAI()` iterates the full provider list with `_withRetry` (amplifying request count) and each app request carries a large system prompt + `max_tokens:1024`, tripping GROQ's per-minute request/token rate faster than the tiny raw probes did. **AI latency is measurable (~350–450 ms raw round-trip); the app-level `/ai/chat` path is currently rate-limit-fragile under load.**

### 5. Connector latency (raw network reachability — not app code)

Direct Node `fetch`, 5 requests each:

| Connector | Endpoint | Latencies (ms) | min/avg/max |
|-----------|----------|----------------|-------------|
| GitHub | `https://api.github.com/rate_limit` (unauth) | 180,155,53,51,53 | 51 / 98 / 180 |
| Telegram | `https://api.telegram.org/bot<token>/getMe` | 784,735,240,242,239 | 239 / 448 / 784 |

Telegram token valid — `getMe` returned bot `Alwaliy_Technologies_Jarvis_Bot`. These numbers measure **raw network reachability from this machine**, not JARVIS connector code.

### 6. Electron startup / workspace load — NOT RELIABLY MEASURABLE

- Electron binary present and runs: `node_modules/.bin/electron --version` → **v24.18.0**.
- `scripts/electron-smoke-test.cjs` is a **static-config smoke test** (parse checks via `node --check`, file-existence, `package.json` build config, and source-string security audits) — **it contains no real launch timer.** Run result: **22 passed, 0 failed, 0 warned, 100%.** Any number cited from it would not be a launch time.
- Bounded real-launch attempt (`electron electron/main.cjs`, hard-killed after signal/timeout): process exited **code 1 in ~483 ms** without reaching a rendered window. Direct error: `TypeError: Cannot read properties of undefined (reading 'isPackaged')` at `electron/main.cjs:45` — the Electron `app` global was not initialized in this non-interactive invocation.
- **Conclusion: NOT MEASURABLE — a full Electron workspace launch cannot be validated non-interactively here** (it would open a GUI window and spawn the backend). `frontend/build/index.html` exists, so the frontend artifact is present; the blocker is the headless/non-interactive launch context, not a missing build. The static smoke test (22/22) is the only real signal available.

---

## PHASE 9 — PRODUCTION / DEVOPS

### Docker — NOT BUILT (daemon down) → STATIC REVIEW

- `docker` CLI installed: **v29.4.1**. Docker Desktop app present. **Daemon NOT running** (`docker ps` → "check if the daemon is running"). Ran `open -a Docker` and waited 90 s — daemon did not come up (Docker Desktop VM boot needs more time / possibly interactive consent). Did **not** force it further.
- **Static review of `Dockerfile.production`** (multi-stage correctness):
  - Stage 1 `frontend-builder` (node:20-alpine): copies `frontend/package*.json`, `npm ci`, copies `frontend/`, runs `npm run build` → produces `/build/frontend/build`.
  - Stage 2 `runtime` (node:20-alpine): installs tini, creates non-root `jarvis` (UID 1001), `npm ci --omit=dev --ignore-scripts`, copies `backend/ agents/ orchestrator.cjs`, then `COPY --from=frontend-builder /build/frontend/build ./frontend/build`.
  - **Cross-stage COPY path matches** what stage 1 produces (`/build/frontend/build`). ✓
  - Runtime dirs `data logs backups` created and `chown`ed before `USER jarvis`. ✓
  - `HEALTHCHECK` uses `wget` (present in alpine base). ✓ tini as PID 1, `CMD ["node","--max-old-space-size=400","backend/server.js"]`. ✓
  - No obvious breakage. **Verdict: statically correct; NOT BUILT this run (daemon unavailable).**

### PM2 — WORKS

- `pm2 --version` → **6.0.14**.
- `pm2 start ecosystem.config.cjs` started both apps: **`jarvis-os` (online)** and **`ooplix-backup` (online)**.
- **Crash-loop check:** restart count `↺` held **steady at 590 across t=0 and t=12 s** (uptime climbed 0→25 s, status stayed `online`). The 590 is **cumulative history from many prior sessions — it did not increment during this run**, i.e. **not crash-looping now.** Health via the PM2-managed server: `{"status":"ok","uptime_seconds":25,...,"warnings":[]}`.
- `pm2 logs jarvis-os --nostream` showed a clean autonomous bootstrap (RCA, rule registry, learning engine) — **but two non-fatal warnings**:
  1. **`better-sqlite3` native-module ABI mismatch** — compiled against `NODE_MODULE_VERSION 145` (Node 22.x) vs current Node's `137`, causing repeated `[SQLite Shadow] Delete failed ... better_sqlite3.node`. App falls back to JSON store; non-fatal but a real degradation. Fix: `npm rebuild better-sqlite3`.
  2. App's own `pm2Observer` emits `[HIGH] PM2 process "jarvis-os" has restarted 590 times`.
- **Cleanup done:** `pm2 delete jarvis-os` + `pm2 delete ooplix-backup` → process list empty, port 5050 freed.

### CI — strongest local proxy: the exact commands CI runs

Read `.github/workflows/ci.yml` and `release.yml` in full. Cannot trigger real GitHub Actions from here; ran the exact commands each job runs:

| CI command | Result |
|------------|--------|
| `npm run test:runtime` | **PASS — 144/144** (`tests 144, pass 144, fail 0`, exit 0, ~4.5 s) |
| `npm run build:frontend` | **PASS** — exit 0; produced `frontend/build/index.html` + `static/`; build size 7.2M |
| `bash deploy/validate-production.sh` (live server) | **26 PASS / 10 WARN / 1 FAIL, score 70%, exit 1** |
| `bash -n deploy/*.sh` (deploy-scripts job) | **PASS** — all 8 scripts syntactically valid |

`validate-production.sh` details: the 10 WARNs are VPS-only (nginx/SSL/certbot/ufw not on a Mac dev box) + low disk (89%). The **1 FAIL** = "jarvis-os process online" — expected, because PM2 wasn't managing it at validation time; not a code defect. Core route auth checks all correct (`/health` 200; `/ops`, `/auth/me`, `/billing/status`, `/launch/dashboard`, `/growth/dashboard` all 401).

**Proxy conclusion:** the three blocking CI jobs (regression 144/144, frontend build, deploy-script syntax) all pass locally → CI would very likely pass.

### Rollback / backup / restore

- **`deploy/rollback.sh`** supports safe non-destructive modes: **`--list`** (lists backups + git commits) and **`--code <ref>`** (git checkout). Ran **`bash deploy/rollback.sh --list`** → listed **8 data backups** and 10 recent git commits. Not run destructively. The data-restore path and `--code` restart-and-verify path require a real target and were **not** exercised (would stop the server, wipe data/, `git checkout`).
- **`scripts/safe-backup.cjs`** — **WORKS.** Ran it: created `backups/jarvis_full_...tar.gz`, pruned oldest, exit 0. Snapshots env(non-secret)/task-queue/auth-tokens/billing/accounts/version/capability-registry + `jarvis.db.raw`.
- **`scripts/test-restore.cjs`** — **FAILED.** It wipes `data/` then restores from the latest backup and validates. It aborted with `ENOENT ... copyfile .../snapshot_.../jarvis.db -> data/jarvis.db`. **Root cause: naming mismatch** — `safe-backup.cjs` writes the DB into the archive as **`jarvis.db.raw`**, but `test-restore.cjs` expects **`jarvis.db`**. (Compounded by the fact that `data/jarvis.db` never exists normally — the shadow SQLite is broken by the ABI mismatch above.) **`data/` recovered intact (444 files restored)**, but the disaster-recovery *validator* is broken and would report a false failure. This is a real bug in the DR verification path.

### Logs — CONFIRMED writing

`backend/utils/logger.js` only writes to a file **when `LOG_FILE` is set** (it does not auto-write to `logs/`). With `LOG_FILE=logs/live-test.log`: fired 10 requests, file line count went **499 → 506** with live structured HTTP entries (`[HTTP] GET /api/status 200 0ms ... trace=...`). **Confirmed the file sink appends during a live run.** (In PM2/production, stdout is instead captured to `logs/pm2-out.log`/`pm2-err.log` per `ecosystem.config.cjs`.)

### Health checks

- `/health` covered in Phase 7 (p50 ~0.95 ms, 200).
- **`deploy/healthcheck.sh`** exists — ran it against the live local server (`PORT=5050 bash deploy/healthcheck.sh`) → **`OK — uptime=12s memory=?MB`** (memory shows `?` because the Python JSON path expects a `memory.current.heap_mb` field the `/health` payload didn't include in this build; the OK path fired correctly). It uses `curl` (present here).

---

## Summary of real defects surfaced

1. **`better-sqlite3` native ABI mismatch** (NODE_MODULE_VERSION 145 vs 137) → repeated SQLite-shadow failures; app runs on JSON fallback. Fix: `npm rebuild better-sqlite3` after Node upgrades. (Consistent with recent commits about native-module build fixes.)
2. **`scripts/test-restore.cjs` DR validator is broken** — expects `jarvis.db` but backups store `jarvis.db.raw`; disaster-recovery validation fails even though data/ restores fine.
3. **`/ai/chat` app path is rate-limit-fragile** — full-provider-loop + `_withRetry` + large system prompt trips GROQ 429 under burst, despite the provider being directly reachable in ~350 ms.
4. PM2 shows **590 historical restarts** on `jarvis-os` (flagged HIGH by the app's own observer) — worth investigating root cause of the accumulated restarts.

## Not verifiable in this environment
- Docker image build (daemon down).
- Real Electron GUI workspace launch/timing (non-interactive, no valid app context).
- Destructive rollback data-restore and `--code` git-checkout paths, nginx/SSL/ufw/certbot checks (VPS-only).
- Real GitHub Actions run (proxied by running the exact commands locally).
