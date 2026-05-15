# Production Blockers
**Phase G — Real Operator Deployment**
**Generated:** 2026-05-15

---

## Severity Definitions

- **P0 — Deploy blocker:** VPS deployment will fail or be insecure without this fix. Do not deploy.
- **P1 — Functional blocker:** Operators cannot use a core feature on the first day.
- **P2 — Reliability risk:** System works but may fail under real conditions.
- **P3 — Polish/compliance:** Should be fixed before public launch or wider rollout.

---

## P0 — Deploy Blockers

### 1. JWT_SECRET and OPERATOR_PASSWORD_HASH must be set before VPS start

**What breaks:** `start-production.sh` now enforces this — it will **refuse to start** if either is missing. All `/runtime/*` and `/auth/*` routes return 503 if started without these env vars.

**Action required:**
```bash
# On the VPS, before running start-production.sh:
node scripts/generate-password-hash.cjs <choose-a-strong-password>
# Copy the two output lines into .env
```

**Validation:**
```bash
bash deploy/start-production.sh
# Should complete without the "FATAL" die() errors
curl http://localhost:5050/health
# Should return 200
```

**Status:** Tooling is in place. Operator must complete this step.

---

### 2. NODE_ENV must be "production" in .env

**What breaks:** If `NODE_ENV=development` on the VPS, the `requireAuth` middleware uses dev passthrough — **all runtime routes are unauthenticated**, regardless of whether `JWT_SECRET` is set.

**Current state:** `.env.example` defaults to `NODE_ENV=production`. This is correct.

**Risk:** An operator might accidentally copy a dev `.env` to the VPS.

**Validation:**
```bash
grep NODE_ENV /opt/jarvis-os/.env  # must be: NODE_ENV=production
```

**Status:** `start-production.sh` does not currently check `NODE_ENV`. The startup script should add this check. **(Added to P2 items below.)**

---

### 3. nginx `root` must point to `frontend/build`, not the project root

**What breaks:** If the nginx `root` directive points to `/opt/jarvis-os` instead of `/opt/jarvis-os/frontend/build`, all files in the project (including `.env`, `data/`, `logs/`) are directly downloadable.

**Example of the wrong config:**
```nginx
root /opt/jarvis-os;   # WRONG — exposes .env, logs, data
```

**Correct config:**
```nginx
root /opt/jarvis-os/frontend/build;   # CORRECT — only React build files
```

**The deploy/nginx-jarvis.conf default is correct** (`/var/www/jarvis/frontend/build`). But the placeholder must be updated to the actual app directory path.

**Validation:**
```bash
grep "root " /etc/nginx/sites-available/jarvis
# Must end in /frontend/build
curl https://yourdomain.com/.env  # Must return 404 or 301 (redirect to index.html)
```

---

## P1 — Functional Blockers

### 4. Op console completely inaccessible until auth is configured

Covered in P0 #1. Without `JWT_SECRET` + `OPERATOR_PASSWORD_HASH`, every login attempt returns 503. The console cannot be used.

### 5. SSE auth expiry at 8 hours — silent stream death

**What happens:** JWT cookie expires after 8 hours. The EventSource in `OperatorConsole.jsx` reconnects but gets 401. The browser silently stops retrying. The execution log freezes with no error shown.

**Impact:** An operator running a session from 9am to 5pm will lose the live stream at 5pm without realizing it.

**Fix required:** On SSE `error` event, call `getAuthStatus()`. If it returns 401, trigger the session-expired banner.

**Workaround:** Refresh page and re-login before the 8-hour mark.

**Estimated fix effort:** ~30 lines in `OperatorConsole.jsx`.

### 6. `/ops`, `/stats`, `/metrics` are unauthenticated

**What happens:** Anyone who discovers the server URL can see agent count, circuit breaker states, revenue data, and memory usage. No brute-force protection.

**Impact:** Competitive intelligence leak, system fingerprinting.

**Fix required:** Add `requireAuth` to these routes in `routes/index.js`:
```js
router.use("/runtime", requireAuth);
router.get("/ops",     requireAuth, require("./ops").opsHandler);
router.get("/stats",   requireAuth, require("./ops").statsHandler);
router.get("/metrics", requireAuth, require("./ops").metricsHandler);
```

**Note:** `/health` should stay public (Uptime monitoring tools use it).

### 7. Terminal execution path — `terminalAgent.cjs` audit needed

**What happens:** `terminalAgent.cjs` uses `child_process.exec()` with a shell. If user input from `/jarvis` reaches this agent through the intent router, it could be exploited.

**Current protection:** `terminalExecutionAdapter.cjs` uses `shell:false` + allowlist. The question is whether the old `terminalAgent.cjs` is reachable from any live endpoint.

**Action required:** Trace the execution path from `POST /jarvis` → `toolAgent.cjs` → confirm `terminalAgent.cjs` is either unreachable or decommissioned.

---

## P2 — Reliability Risks

### 8. `start-production.sh` doesn't validate NODE_ENV

**Fix:** Add to pre-flight checks:
```bash
[[ "${NODE_ENV:-}" != "production" ]] && die "NODE_ENV must be 'production' in .env — current value: ${NODE_ENV:-unset}"
```

### 9. Queue state lost on frontend refresh

After a refresh, the operator panel shows no pending queue items even if tasks are queued in the backend. No `/runtime/queue/list` endpoint exists.

**Fix:** Add a `GET /runtime/queue/list` endpoint returning pending items, and fetch it on `WorkflowPanel` mount.

### 10. No reconnect status indicator

The operator cannot tell if the SSE stream is live or disconnected. A 3-second reconnect window is invisible.

**Fix:** On SSE `error` event, show a "reconnecting..." badge. Clear on `open`.

### 11. PM2 alert on "errored" state not configured

If PM2 enters "errored" state after 10 crash restarts, there is no alert. The operator would only notice if they checked `pm2 status`.

**Fix:** Set up uptime monitoring (Uptime Kuma, Better Uptime, or a cron that runs `pm2 status jarvis-os | grep -q "online" || curl -s <webhook>`).

### 12. Execution log not size-capped on disk

`data/logs/execution.ndjson` grows indefinitely. After 6 months of heavy use, this could be hundreds of MB.

**Fix:** Add log rotation to `execLog.cjs` — after 50MB or 7 days, archive and start a new file.

---

## P3 — Polish / Compliance

### 13. CSP uses `'unsafe-inline'`

CRA builds use inline chunk loaders. The Content-Security-Policy in nginx includes `'unsafe-inline'` for scripts. After confirming which inline scripts are actually needed, tighten to nonce-based or hash-based CSP.

### 14. OPERATOR_PASSWORD_HASH rotation procedure not documented

No runbook for rotating the operator password (change `OPERATOR_PASSWORD_HASH` in `.env`, restart server). Should be in `OPERATOR_ONBOARDING.md`.

### 15. JWT_SECRET rotation requires all sessions to be invalidated

Rotating `JWT_SECRET` instantly invalidates all active sessions. Operators mid-session will be silently logged out on their next auth-gated request. Should be documented as a maintenance procedure.

### 16. No audit log for operator actions

There is no record of which operator performed which dispatch/queue/emergency stop actions and when. For a multi-operator environment or compliance audit, this would be required.

---

## Summary Table

| # | Severity | Title | Effort |
|---|---|---|---|
| 1 | P0 | Generate + set JWT_SECRET + OPERATOR_PASSWORD_HASH | 5 min (script exists) |
| 2 | P0 | Verify NODE_ENV=production in .env | 1 min |
| 3 | P0 | nginx root must be frontend/build | Config check |
| 4 | P1 | Auth not configured → console inaccessible | Covered by P0#1 |
| 5 | P1 | SSE expires at 8h silently | ~30 lines code |
| 6 | P1 | ops/stats/metrics unauthenticated | ~5 lines code |
| 7 | P1 | Audit terminal execution path | Code audit |
| 8 | P2 | start-production.sh missing NODE_ENV check | 3 lines |
| 9 | P2 | Queue state lost on refresh | New endpoint + mount fetch |
| 10 | P2 | No SSE reconnect indicator | ~20 lines code |
| 11 | P2 | No PM2 crash alert | Monitoring setup |
| 12 | P2 | Execution log grows indefinitely | Log rotation in execLog.cjs |
| 13 | P3 | CSP unsafe-inline | Build audit + nonce |
| 14 | P3 | Password rotation procedure undocumented | Docs |
| 15 | P3 | JWT_SECRET rotation invalidates all sessions | Docs |
| 16 | P3 | No operator audit log | Feature work |

**P0 count:** 3 (all operator actions — no code changes required)
**P1 count:** 4 (3 code fixes + 1 audit)
**P2 count:** 5
**P3 count:** 4
