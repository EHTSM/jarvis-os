# JARVIS OS — Disaster Recovery

## Backup Strategy

### What to back up

| Priority | File / Directory | Frequency | Notes |
|---|---|---|---|
| Critical | `.env` | On every change | Contains all secrets — store encrypted offsite |
| Critical | `data/jarvis.db` | Daily | SQLite database — all scheduled tasks |
| Critical | `data/autonomous-cycles.json` | Daily | Cycle history (last 500 cycles) |
| Critical | `data/learning-patterns.json` | Daily | Agent learning log (last 1000 entries) |
| Important | `data/plugin-registry.json` | Daily | Registered plugins |
| Important | `data/capability-registry.json` | Daily | Capability map |
| Important | `data/workflow-library.json` | On every change | Workflow templates |
| Useful | `logs/` | Weekly | PM2 output/error logs |

### Automated backup

```bash
npm run backup        # runs scripts/backup.sh
```

Set up a daily cron:

```
0 3 * * * cd /opt/app && npm run backup >> logs/backup.log 2>&1
```

### Manual snapshot

```bash
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p /opt/backups/$STAMP
cp data/jarvis.db          /opt/backups/$STAMP/
cp data/*.json             /opt/backups/$STAMP/
cp .env                    /opt/backups/$STAMP/.env.enc  # encrypt before storing
```

### SQLite backup (hot copy)

SQLite in WAL mode can be safely copied while running:

```bash
sqlite3 data/jarvis.db ".backup /opt/backups/jarvis-$(date +%Y%m%d).db"
```

This uses the SQLite backup API which is safe under concurrent writes.

---

## Database Corruption Recovery

Symptoms: backend fails to start with `SQLITE_CORRUPT` error, or rows return with garbled data.

### Step 1 — Verify corruption

```bash
sqlite3 data/jarvis.db "PRAGMA integrity_check;"
# OK = healthy. Anything else = corrupt.
```

### Step 2 — Attempt WAL recovery

```bash
# Force WAL checkpoint (may recover from partial write)
sqlite3 data/jarvis.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 data/jarvis.db "PRAGMA integrity_check;"
```

### Step 3 — Dump and recreate (partial data recovery)

```bash
sqlite3 data/jarvis.db .dump > /tmp/jarvis-dump.sql 2>/dev/null || true
# Edit the dump to remove corrupt rows if needed
mv data/jarvis.db data/jarvis.db.corrupt
sqlite3 data/jarvis.db < /tmp/jarvis-dump.sql
sqlite3 data/jarvis.db "PRAGMA integrity_check;"
```

### Step 4 — Restore from backup

```bash
pm2 stop jarvis-os
cp /opt/backups/<latest>/jarvis.db data/jarvis.db
pm2 start jarvis-os
```

### Step 5 — Verify tasks after restore

```bash
sqlite3 data/jarvis.db "SELECT COUNT(*), status FROM tasks GROUP BY status;"
curl http://localhost:5050/health
```

---

## Queue Recovery (Stuck Tasks)

### SQLite task queue

Tasks stuck in `running` status after a crash:

```bash
# View stuck tasks
sqlite3 data/jarvis.db "SELECT id, input, status, started_at FROM tasks WHERE status='running';"

# Reset stuck tasks to pending (they will be retried)
sqlite3 data/jarvis.db "UPDATE tasks SET status='pending', started_at=NULL WHERE status='running';"

# Or mark them failed to clear the queue
sqlite3 data/jarvis.db "UPDATE tasks SET status='failed', last_error='reset after crash' WHERE status='running';"
```

### Autonomous cycle queue

If `data/cycle-queue.json` has entries that are not being processed (e.g. after a crash with active cycles):

```bash
# Inspect the queue
cat data/cycle-queue.json

# Clear the queue entirely (cycles will not auto-start)
echo "[]" > data/cycle-queue.json

# Or reset active cycle tracking by restarting the backend
pm2 restart jarvis-os
# Note: _activeCycles is an in-memory Set — it resets on restart, allowing queued cycles to run
```

### Runtime orchestrator queue

The runtime orchestrator queue is in-memory. After a crash, pending queue items are lost. To recover:

1. Check `data/autonomous-cycles.json` for cycles that were `running` at crash time.
2. Re-submit them via `POST /p18/cycles` or `POST /runtime/dispatch`.
3. Check the dead-letter queue: `GET /runtime/dlq` for tasks that exhausted retries.

---

## Log File Recovery

### Log files are too large / disk full

```bash
# Check disk usage
df -h
du -sh logs/*

# PM2 log rotation (if pm2-logrotate is installed)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5

# Manual truncation (safe — PM2 will reopen the file)
> logs/pm2-out.log
> logs/pm2-err.log
```

### PM2 logs lost after restart

PM2 appends to the same log files on restart. If files are missing:

```bash
mkdir -p logs
pm2 restart jarvis-os
```

### Recover runtime alert log

If `data/runtime-alerts.log` is missing or corrupt, it is recreated automatically on the next alert. No recovery needed.

---

## Emergency Contacts

This section is for the operator only. Do not expose externally.

**System failure escalation path**:

1. Check `/health` endpoint first — identifies which service is degraded.
2. Check PM2 status: `pm2 list` and `pm2 logs jarvis-os --lines 50`.
3. If backend is down: `pm2 restart jarvis-os` or `pm2 start ecosystem.config.cjs --env production`.
4. If database is corrupt: follow Database Corruption Recovery above.
5. If completely unrecoverable: restore from latest backup and redeploy via `bash deploy/start-production.sh`.

**Emergency stop (without SSH access)**:
- Electron UI: `Cmd+Shift+.` toggles emergency stop — blocks all autonomous agent dispatches.
- API: `POST /runtime/emergency-stop` with a valid operator token.

**Contact**: operator account email is on file in `.env` or `data/accounts.json`. System alerts go to `TELEGRAM_OPERATOR_CHAT_ID` configured in `.env`.
