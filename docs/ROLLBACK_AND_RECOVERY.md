# Rollback and Recovery
**Phase H — Production Hardening**
**Generated:** 2026-05-15

---

## Recovery Scenarios

| Scenario | Recovery Method | RTO |
|---|---|---|
| Bad code deploy | `bash deploy/rollback.sh --code HEAD~1` | < 2 min |
| Corrupted data files | `bash deploy/rollback.sh` (latest backup) | < 3 min |
| Process crash | PM2 auto-restarts (3s delay) | < 5s |
| VPS reboot | systemd starts PM2 → PM2 starts app | < 30s |
| Disk full | Manual cleanup → `pm2 restart jarvis-os` | Manual |
| Memory OOM | PM2 restarts when heap > 512MB | < 5s |
| Nginx misconfiguration | `nginx -t` → fix → `systemctl reload nginx` | < 1 min |
| Expired JWT secret | Update `JWT_SECRET` in `.env` → `pm2 restart jarvis-os` | < 1 min |

---

## Rollback Script (`deploy/rollback.sh`)

### Data Rollback (default)

Restores the `data/` directory from a backup archive.

```bash
# List available backups
bash deploy/rollback.sh --list

# Restore latest backup
bash deploy/rollback.sh

# Restore specific backup
bash deploy/rollback.sh jarvis_20260515_120000.tar.gz
```

**What happens:**
1. `.env` is backed up to `backups/.env.bak.TIMESTAMP` (mode 600)
2. Server is stopped via PM2
3. Current `data/` is saved as `backups/pre-rollback-TIMESTAMP.tar.gz` (safety net)
4. Target backup is extracted
5. Server is restarted via PM2
6. Health check with 5 retries (3s each)

**What is NOT affected:** Code (git checkout), `.env`, `logs/`, `frontend/build/`

### Code Rollback

Restores backend code to a previous git commit.

```bash
# Rollback one commit
bash deploy/rollback.sh --code HEAD~1

# Rollback to specific commit
bash deploy/rollback.sh --code a3f9c2d

# Preview what commits are available
bash deploy/rollback.sh --list
```

**What happens:**
1. `.env` is backed up (safety)
2. Server stopped
3. `git checkout <commit> -- backend/ agents/ orchestrator.cjs package.json`
4. `npm install --omit=dev` (in case package.json changed)
5. Server restarted + health check

**What is NOT affected:** `data/`, `.env`, `frontend/build/`, `logs/`

---

## Backup Procedure

### Creating a backup

```bash
# Manual backup
npm run backup
# Creates: backups/jarvis_YYYYMMDD_HHMMSS.tar.gz
# Contains: data/ directory (CRM leads, queue, memory, feedback)

# What backup contains
tar -tzf backups/jarvis_20260515_120000.tar.gz | head -20
```

### Automated backups

Add to crontab on the VPS:

```cron
# Daily backup at 2am
0 2 * * * cd /opt/jarvis-os && npm run backup >> logs/backup.log 2>&1

# Weekly cleanup: keep last 14 backups
0 3 * * 0 ls -t /opt/jarvis-os/backups/jarvis_*.tar.gz | tail -n +15 | xargs rm -f
```

### What is backed up vs. what is NOT

| Item | Backed up | Notes |
|---|---|---|
| `data/leads.json` | ✓ | CRM — critical |
| `data/task-queue.json` | ✓ | Task state |
| `data/learning.json` | ✓ | AI memory |
| `data/feedback-loop.json` | ✓ | Feedback state |
| `data/logs/` | ✓ | Execution history |
| `.env` | ✓ (separate) | Backed up by rollback.sh before each rollback |
| `logs/pm2-*.log` | ✗ | PM2 rotates these; not critical |
| `frontend/build/` | ✗ | Reproducible from source |
| `node_modules/` | ✗ | Reproducible with `npm ci` |

---

## PM2 Recovery

### Crash recovery (automatic)

PM2 is configured with:
- `autorestart: true` — restarts on crash
- `max_restarts: 10` — stops after 10 crashes to prevent loops
- `min_uptime: 10s` — treats quick exits as crashes
- `restart_delay: 3000ms` — 3s backoff
- `max_memory_restart: 512M` — restarts before OOM

### Crash loop detection

If the server crashes 10 times within the `min_uptime` window, PM2 marks it "errored" and stops retrying. Check:

```bash
pm2 status jarvis-os
# If "errored":
pm2 logs jarvis-os --lines 50  # find root cause
pm2 restart jarvis-os          # after fixing
```

### Reboot recovery

PM2 auto-starts on reboot if `pm2 startup` + `pm2 save` were run. Verify:

```bash
systemctl status pm2-jarvis   # or pm2-root depending on user
pm2 list                      # should show jarvis-os as "online"
```

If PM2 doesn't start on boot:

```bash
pm2 startup                   # generates the systemd command
# Run the command it prints (as root)
pm2 save                      # save current process list
```

---

## Health Check Verification

After any recovery action:

```bash
# Basic health
curl http://localhost:5050/health

# Deep health (requires auth)
curl -b "jarvis_auth=<token>" http://localhost:5050/runtime/health/deep

# Check all services
curl http://localhost:5050/ops | python3 -m json.tool | grep -E "status|warnings"
```

Expected healthy response:
```json
{
  "status": "ok",
  "uptime_seconds": 12,
  "services": {
    "ai": true,
    "telegram": false,
    "whatsapp": false,
    "payments": false
  },
  "warnings": []
}
```

---

## `.env` Recovery

The `.env` file contains secrets and is never committed to git. It must be reconstructed if lost.

**Before losing `.env`:**

Backups are created automatically by `rollback.sh` to `backups/.env.bak.TIMESTAMP` with mode 600.

**Recovering from `.env.bak`:**

```bash
ls -la backups/.env.bak.*
cp backups/.env.bak.20260515_120000 .env
chmod 600 .env
pm2 restart jarvis-os
```

**Recovering from scratch (no backup):**

1. Copy `.env.example` to `.env`
2. Re-enter all API keys from their respective dashboards
3. Regenerate `JWT_SECRET` and `OPERATOR_PASSWORD_HASH`:
   ```bash
   node scripts/generate-password-hash.cjs <your-password>
   # Paste both output lines into .env
   ```
4. Restart: `pm2 restart jarvis-os`
5. Verify: `curl http://localhost:5050/health`

---

## Docker Recovery (if using docker-compose.prod.yml)

```bash
# Restart container
docker-compose -f docker-compose.prod.yml restart jarvis-backend

# Rebuild and redeploy (after code change)
docker build -f Dockerfile.production -t jarvis-os:latest .
docker-compose -f docker-compose.prod.yml up -d --force-recreate

# View logs
docker-compose -f docker-compose.prod.yml logs -f jarvis-backend

# Restore data volume from backup
docker-compose -f docker-compose.prod.yml down
docker run --rm -v jarvis-data:/data -v $(pwd)/backups:/backups alpine \
  tar -xzf /backups/jarvis_latest.tar.gz -C /data
docker-compose -f docker-compose.prod.yml up -d
```

---

## Runbook: After a Bad Deploy

1. `bash deploy/rollback.sh --list` — identify the last known good backup
2. `bash deploy/rollback.sh --code HEAD~1` — revert code
3. If data is corrupted: `bash deploy/rollback.sh jarvis_<timestamp>.tar.gz`
4. `curl http://localhost:5050/health` — verify recovery
5. `pm2 logs jarvis-os --lines 20` — confirm no crash loops
6. Investigate root cause in `logs/pm2-err.log` before re-deploying
