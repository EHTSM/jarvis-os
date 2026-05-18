# DAILY_OPERATIONS_CHECKLIST.md

**Purpose** – Provide a concise, repeatable checklist for operators to verify that Jarvis is healthy before, during, and after a workday.

---

## 1. Startup Checks (run after `npm start` or `pm2 start`)
- [ ] **Process Health** – `pm2 status` shows `jarvis` in `online` state.
- [ ] **Port Availability** – `lsof -i :3000` confirms the HTTP server is listening.
- [ ] **Environment** – Verify `.env` variables are loaded (`printenv | grep JARVIS`).
- [ ] **Database/SQLite** – `sqlite3 data/learning.db "SELECT count(*) FROM learning;"` returns a non‑zero count.
- [ ] **Log Rotation** – `ls -l logs/` shows a new file for today (e.g., `jarvis-2026-05-16.log`).

## 2. Runtime Health Checks (hourly)
- [ ] **CPU/Memory** – `top -b -n1 | grep node` shows < 30 % CPU and < 500 MB RAM.
- [ ] **Disk Usage** – `df -h /` reports < 80 % usage on the partition.
- [ ] **SSE Endpoint** – `curl -I http://localhost:3000/sse` returns `200 OK`.
- [ ] **Auth Ping** – `curl -s http://localhost:3000/auth/ping` returns `{ "status": "ok" }`.
- [ ] **Queue Length** – `curl -s http://localhost:3000/scheduled` shows `total` ≤ 10 pending tasks.

## 3. Queue Verification (daily)
- [ ] **Pending Tasks** – No stalled tasks older than 30 min (`GET /scheduled`).
- [ ] **Failed Tasks** – `GET /scheduler/status` shows `failed = 0`.
- [ ] **Retry Backoff** – Confirm that any retried task respects exponential backoff (inspect logs).

## 4. SSE Verification (continuous)
- [ ] **Client Connection** – Open the dashboard, verify the green “Live” indicator.
- [ ] **Heartbeat** – Logs contain `SSE heartbeat` at least every 15 s.

## 5. Auth Verification (daily)
- [ ] **Token Expiry** – Generate a token, then `curl http://localhost:3000/auth/verify?token=…` succeeds.
- [ ] **Logout** – `POST /auth/logout` invalidates the token (check DB).

## 6. PM2 Verification (daily)
- [ ] **Process Count** – `pm2 ls` shows exactly one `jarvis` process.
- [ ] **Restarts** – No automatic restarts in the last 24 h (`pm2 show jarvis` → `restart_time`).

## 7. Log Inspection (daily)
- [ ] **Error Free** – `grep -i "error" logs/jarvis-$(date +%F).log` yields no unexpected stack traces.
- [ ] **Rotation** – Previous day’s log archived and gzipped.

## 8. Disk Usage Check (daily)
- [ ] **Free Space** – `df -h /` shows at least 2 GB free on the data volume.

## 9. Backup Verification (daily)
- [ ] **Backup Exists** – `ls backups/$(date +%F)*.tar.gz` present.
- [ ] **Checksum** – `sha256sum` of the backup matches stored hash.

## 10. Emergency Stop Verification (weekly)
- [ ] **Stop Command** – Run `pm2 stop jarvis` and confirm all endpoints return `503 Service Unavailable`.
- [ ] **Resume** – `pm2 start jarvis` restores full functionality.

---

*Keep this file version‑controlled. Operators should tick each item as they verify it.*