# INCIDENT_RESPONSE_PLAYBOOK.md

**Purpose** – Provide a concise, operator‑focused guide for detecting, diagnosing, and recovering from common production incidents in Jarvis.

---

## 1. Incident Detection
| Symptom | Primary Indicator | Monitoring Source |
|---------|-------------------|-------------------|
| **Runtime Freeze** | HTTP `503` on any endpoint, UI shows “offline”. | PM2 status, health check endpoint (`/health`). |
| **Queue Stall** | `GET /scheduled` returns `total > 0` but no recent `last_executed`. | Scheduler status endpoint (`/scheduler/status`). |
| **SSE Disconnect Storm** | Dashboard loses “Live” indicator, client logs `EventSource error`. | SSE heartbeat logs (`SSE heartbeat`). |
| **Auth Failures** | Login returns `401` repeatedly. | Auth logs (`auth failure`). |
| **PM2 Restart Loops** | PM2 shows `restart_time` increasing rapidly. | `pm2 show jarvis`. |
| **WhatsApp/Telegram Failure** | API response error, messages not sent. | Messaging agent logs (`whatsapp`, `telegram`). |
| **Payment Failure** | Payment API returns error codes, retries exceed limit. | `paymentAgent` logs. |
| **High Memory Usage** | Process RAM > 500 MB, `top` shows growth. | System monitor (`top`). |
| **VPS Degraded State** | CPU > 90 % for >5 min, disk > 80 %. | `htop`, `df -h`. |

---

## 2. Diagnosis Steps (run in order)
1. **Confirm Scope** – Check if the issue is local to a single agent or system‑wide.
2. **Collect Logs** – `tail -n 100 logs/jarvis-$(date +%F).log`.
3. **Check PM2** – `pm2 status jarvis` for process state and restarts.
4. **Health Endpoints** – `curl http://localhost:3000/health` and `/scheduler/status`.
5. **Queue Inspection** – `curl http://localhost:3000/scheduled` for pending tasks.
6. **SSE Check** – Look for `SSE heartbeat missed` in logs.
7. **Auth Test** – `curl http://localhost:3000/auth/ping`.
8. **Messaging Test** – Trigger a test WhatsApp message (`POST /whatsapp/send` with a sandbox number).
9. **Payment Test** – Run a dummy payment (`POST /payment/test`).
10. **System Metrics** – `top -b -n1 | grep node` and `df -h`.

---

## 3. Safe Recovery Procedures
### 3.1 Runtime Freeze
1. `pm2 stop jarvis` – confirm all ports close.
2. Inspect the log for the last error.
3. If a specific agent hung, restart only that agent (e.g., `node agents/terminalAgent.cjs`).
4. `pm2 start jarvis` – verify `/health` returns `200`.

### 3.2 Queue Stall
1. Identify stalled task: `GET /scheduled` → note `task_id`.
2. Cancel the task: `DELETE /scheduled/:id`.
3. If the queue is empty but workers idle, restart the scheduler: `node scheduler.cjs restart`.
4. Re‑enqueue any lost tasks manually if needed.

### 3.3 SSE Disconnect Storm
1. Restart the SSE server: `npm run restart-sse` (or `pm2 restart jarvis` if bundled).
2. Verify the dashboard shows “Live”.
3. If disconnect persists, increase `heartbeat_interval` in `evolution-config.json`.

### 3.4 Auth Failures
1. Verify `.env` still contains `JWT_SECRET` and `AUTH_USER`.
2. Clear session cache: `rm -rf data/session/*`.
3. Restart auth middleware: `pm2 restart jarvis`.
4. Test login again.

### 3.5 PM2 Restart Loops
1. Examine the crash log (`pm2 logs jarvis --lines 200`).
2. If a specific module throws, apply the micro‑fix from the logging discipline audit.
3. Increase `max_memory_restart` in `ecosystem.config.cjs` if memory‑related.
4. Restart with `pm2 start jarvis`.

### 3.6 WhatsApp / Telegram Failures
1. Check API credentials in `.env` (`WHATSAPP_API_KEY`, `TELEGRAM_BOT_TOKEN`).
2. Re‑authenticate if tokens expired.
3. Send a test message; if it fails, review rate‑limit headers.
4. If the provider is down, enable fallback to the other channel.

### 3.7 Payment Failures
1. Verify `PAYMENT_GATEWAY_KEY` and `MERCHANT_ID`.
2. Run a sandbox transaction.
3. If the gateway returns a permanent error, pause payment agent and alert finance.

### 3.8 High Memory Usage
1. Identify leak source: `node --inspect-brk server.js` and monitor heap.
2. If caused by the learning store, rotate `data/learning.json` (archive old file).
3. Restart the process after cleanup.

### 3.9 VPS Degraded State
1. Scale resources via your provider UI (increase RAM/CPU).
2. Restart Jarvis after resource allocation.
3. If disk full, clean old logs (`gzip` + `rm`).

---

## 4. Rollback Guidance
- **Full Rollback** – Restore the latest backup (`tar -xzvf backups/$(date -d "yesterday" +%F).tar.gz -C /`), then `pm2 start jarvis`.
- **Partial Rollback** – Revert only the changed module using git (`git checkout HEAD~1 path/to/module.cjs`).
- **Configuration Rollback** – Replace `evolution-config.json` with the version in `git` history.

---

## 5. Post‑Incident Review (run after recovery)
1. Log the incident ID, time, and root cause.
2. Update the **Logging Discipline** audit with any missing logs.
3. Add a micro‑fix task to the Todo list if applicable.
4. Run the **Backup + Restore Validation** script to ensure backups are usable.
5. Notify the on‑call team via Slack/email.

---

*Keep this playbook version‑controlled and review quarterly.*