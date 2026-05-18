# LOG ROTATION SETUP
Phase L — Daily Operator Readiness  
Date: 2026-05-16

---

## 1. LOG INVENTORY

| File | Writer | Built-in Rotation | Current Size |
|------|--------|-------------------|-------------|
| `data/logs/execution.ndjson` | `backend/utils/execLog.cjs` | YES — 10MB, renames to timestamped file, prunes >7d | 2.3 MB |
| `data/logs/operator-audit.ndjson` | `backend/middleware/operatorAudit.js` | NO — `fs.appendFile` with no cap | 8 KB |
| `$LOG_FILE` (env var, optional) | `backend/utils/logger.js` | NO — `createWriteStream` with no cap | Not configured |

### Growth estimates (solo operator, normal use)

| File | Lines/day | Bytes/day | Days to 100MB |
|------|-----------|-----------|---------------|
| `execution.ndjson` | ~1,000 | ~150 KB | ~2 years (but rotated at 10MB — ~67 days before first rotation) |
| `operator-audit.ndjson` | ~100 | ~15 KB | ~18 years |
| `LOG_FILE` | ~500 | ~100 KB | ~2.7 years |

`execution.ndjson` is the only file at meaningful risk. Its built-in rotation handles it.

---

## 2. BUILT-IN ROTATION (execution.ndjson)

`backend/utils/execLog.cjs` already implements:

```js
const MAX_BYTES = 10 * 1024 * 1024;  // 10 MB

function _maybeRotate() {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_BYTES) {
        const rotated = LOG_FILE.replace(".ndjson", `.${Date.now()}.ndjson`);
        fs.renameSync(LOG_FILE, rotated);
        if (_stream) { _stream.end(); _stream = null; _streamErr = false; }
        _pruneOldLogs();
    }
}

function _pruneOldLogs() {
    const cutoff = Date.now() - 7 * 24 * 3600_000;  // 7 days
    for (const f of fs.readdirSync(LOG_DIR)) {
        if (!f.startsWith("execution.") || !f.endsWith(".ndjson")) continue;
        if (fs.statSync(path.join(LOG_DIR, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(LOG_DIR, f));
    }
}

// Check every 60 seconds
setInterval(_maybeRotate, 60_000).unref();
```

At 10MB trigger with 150KB/day growth, the file rotates approximately every 67 days. The 7-day
prune means at most 2-3 rotated archives exist at any time. Maximum disk use from execution logs:
~30MB. No action required.

---

## 3. EXTERNAL ROTATION (operator-audit.ndjson + LOG_FILE)

A shell script handles the files without built-in rotation:

**File:** `scripts/rotate-logs.sh`

Behavior:
- Rotates files exceeding 1MB (threshold; at current growth rate triggers after ~18 months)
- Gzips the rotated file: `operator-audit.YYYYMMDD.ndjson.gz`
- Truncates the active file (zero-length, PM2 process keeps its write stream open)
- Retains 4 rotated archives, deletes older ones

**Rotate on live file with zero downtime:**
The script uses `truncate -s 0` rather than `mv + recreate`. The Node.js `fs.appendFile`
call in `operatorAudit.js` uses the file path each call (not a persistent stream), so it
automatically opens the truncated file on the next write. No process restart needed.

**For LOG_FILE (logger.js):** If `LOG_FILE` is set, its stream is opened once at server start.
After truncation, the stream's file descriptor still points to the old inode. The file must
be reopened. Workaround: `pm2 restart jarvis` after rotation (safe — PM2 restarts quickly,
no queue loss for disk-backed tasks). Alternative: add `SIGUSR1` handler to reopen stream
(not implemented — unnecessary for solo-operator scale).

---

## 4. SETUP ON VPS

### 4.1 Manual rotation (weekly cron)

```bash
# Add to crontab: crontab -e
0 2 * * 0 /home/ubuntu/jarvis-os/scripts/rotate-logs.sh >> /home/ubuntu/jarvis-os/data/logs/rotation.log 2>&1
```

Runs every Sunday at 02:00. Output appended to `data/logs/rotation.log`.

### 4.2 System logrotate (alternative)

If logrotate is available on the VPS (`which logrotate`):

```
# /etc/logrotate.d/jarvis-os
/home/ubuntu/jarvis-os/data/logs/operator-audit.ndjson {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    copytruncate
    su ubuntu ubuntu
}
```

`copytruncate` copies the file then truncates it in place — no signal or restart needed.
Safe for `fs.appendFile`-based writers.

**Do NOT add `execution.ndjson` to logrotate** — it has internal rotation already.
Rotating it externally would race with the internal rotation and corrupt the active log.

### 4.3 Verify rotation script

```bash
# Dry run: check what would be rotated
bash -x /home/ubuntu/jarvis-os/scripts/rotate-logs.sh
```

---

## 5. DISK USAGE PROJECTION (12 MONTHS)

| Component | Max disk use | Basis |
|-----------|-------------|-------|
| `execution.ndjson` + archives | ~30 MB | 10MB active + 2-3 × 10MB archives × 7d prune |
| `operator-audit.ndjson` | < 10 MB | ~15KB/day × 365 = 5.4MB, no rotation needed |
| `LOG_FILE` | < 40 MB | ~100KB/day × 365 = 36MB if always enabled |
| PM2 logs | < 50 MB | PM2 default; use `pm2 install pm2-logrotate` |
| **Total logs** | **< 130 MB** | Well within 1GB budget for 1-year solo use |

### PM2 log rotation (recommended)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

PM2 stdout/stderr logs are separate from the application NDJSON logs. Without this,
PM2's `~/.pm2/logs/` directory grows unbounded.

---

## 6. SUMMARY

| Action | Status | Notes |
|--------|--------|-------|
| `execution.ndjson` rotation | ALREADY HANDLED | Built-in 10MB cap + 7-day prune |
| `operator-audit.ndjson` rotation | SCRIPT PROVIDED | `scripts/rotate-logs.sh`, set up weekly cron on VPS |
| `LOG_FILE` rotation | SCRIPT PROVIDED | Handled by same script if `LOG_FILE` is set |
| PM2 log rotation | RECOMMENDED | Install `pm2-logrotate` on VPS |
| Disk projection (12mo) | < 130 MB | Well within single-VPS budget |
