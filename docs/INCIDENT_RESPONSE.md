# INCIDENT_RESPONSE.md

**Date:** 2026-05-15  
**Format:** Symptom → Diagnosis → Fix → Verify

---

## IR-1: Server Crash / PM2 Restart Loop

**Symptom:** PM2 shows `status: errored` or rapid restart cycling. App unreachable.

**Diagnosis:**
```bash
pm2 status
pm2 logs jarvis-os --lines 100 --err
```

**Common causes and fixes:**

| Error | Fix |
|-------|-----|
| `EADDRINUSE: port 5050` | `lsof -nP -iTCP:5050 \| awk 'NR>1{print $2}' \| xargs kill -9` |
| `JWT_SECRET not set` | Add `JWT_SECRET=<hex>` to `.env`, `pm2 restart jarvis-os` |
| `Cannot find module` | `npm ci --omit=dev && pm2 restart jarvis-os` |
| `SyntaxError` in a file | `node --check backend/server.js` to identify, fix, restart |
| Crash loop after deploy | `git log --oneline -5` → `git revert HEAD` → `pm2 restart jarvis-os` |

**Emergency: stop restart loop:**
```bash
pm2 stop jarvis-os       # stop without restart
# diagnose
pm2 start jarvis-os      # restart when fixed
```

**Verify:** `pm2 status` shows `online` + `curl http://localhost:5050/health` returns 200.

---

## IR-2: Rollback to Previous Version

**When:** Bad deploy, broken route, regression in tests.

**Steps:**
```bash
# 1. Stop the server
pm2 stop jarvis-os

# 2. Find the last good commit
git log --oneline -10

# 3. Roll back code
git checkout <last-good-commit>
# OR: if you have a tagged release:
git checkout v1.2.3

# 4. Reinstall deps (package.json may have changed)
npm ci --omit=dev

# 5. Rebuild frontend if routes changed
npm run build:frontend

# 6. Restart
pm2 start jarvis-os
```

**Verify:** `curl -b cookies.txt https://yourdomain.com/health` + smoke test dispatch.

**Git tag on deploy (recommended workflow):**
```bash
git tag v$(date +%Y%m%d-%H%M) && git push origin --tags
```
Tags give you a clean rollback target without hunting commit hashes.

---

## IR-3: Corrupted task-queue.json

**Symptom:** Server log shows `task-queue.json was corrupt — reset to []`. Tasks missing.

**Auto-handled:** Server automatically backs up corrupt file and resets on startup.
Look for the backup:
```bash
ls data/task-queue.json.bak.*
```

**Manual recovery (if backup is valid):**
```bash
pm2 stop jarvis-os
cp data/task-queue.json.bak.<timestamp> data/task-queue.json
# Verify it's valid JSON:
node -e "JSON.parse(require('fs').readFileSync('data/task-queue.json','utf8')); console.log('OK')"
pm2 start jarvis-os
```

**Prevention:** The queue uses atomic write (`tmp` → `rename`) so corruption only
happens on kernel panic or disk failure mid-write. Rare. Keep backups.

---

## IR-4: Emergency Safe Mode (E-Stop)

**When:** Runaway task, infinite loop, agent flooding external service.

**Trigger e-stop via API:**
```bash
curl -b "jarvis_auth=<TOKEN>" -X POST https://yourdomain.com/runtime/emergency/stop \
  -H "Content-Type: application/json" \
  -d '{"reason":"runaway task detected"}'
```

**Trigger via OperatorConsole:** GovernorPanel → Emergency Stop button.

**What stops:** New task dispatch is blocked. In-flight tasks complete.  
**What keeps running:** HTTP server, auth, SSE stream (operator can still observe).

**Resume:**
```bash
curl -b "jarvis_auth=<TOKEN>" -X POST https://yourdomain.com/runtime/emergency/resume
```

**Nuclear option — kill everything:**
```bash
pm2 stop jarvis-os
# Manually clear the queue if task was queue-based:
echo "[]" > data/task-queue.json
pm2 start jarvis-os
```

---

## IR-5: Log File Explosion

**Symptom:** Disk full. `df -h` shows `/` at 100%.

**Find the culprit:**
```bash
du -sh /opt/jarvis-os/data/* /opt/jarvis-os/logs/* 2>/dev/null | sort -hr | head -10
du -sh /root/.pm2/logs/* 2>/dev/null | sort -hr | head -5
```

**Fix execution log (auto-rotates at 10 MB, but if rotation failed):**
```bash
mv data/logs/execution.ndjson data/logs/execution.$(date +%s).old
# Server creates a new file on next append automatically
```

**Fix PM2 logs:**
```bash
pm2 flush jarvis-os        # truncate current PM2 logs
pm2 install pm2-logrotate  # install rotation (if not done)
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5
```

**Fix data/ JSON files grown large:**
```bash
# memory-store.json and learning.json have no automatic cap
# Back up first, then truncate if >5MB:
cp data/memory-store.json data/memory-store.json.bak
echo "{}" > data/memory-store.json
```

**Prevent recurrence:**
```bash
# Add to crontab (crontab -e):
0 */6 * * * find /opt/jarvis-os/data/logs -name "*.ndjson" -size +10M \
  -exec mv {} {}.$(date +\%s).old \;
```

---

## IR-6: Memory Exhaustion / OOM Kill

**Symptom:** PM2 shows `max memory restart` in logs. Process restarts frequently.

**Check current heap:**
```bash
pm2 monit    # live heap usage in terminal UI
```

**Diagnose growth source:**
```bash
pm2 logs jarvis-os | grep -i "heap\|memory\|MB"
# memTracker logs heap stats every 30s at WARN level above 350MB threshold
```

**Common causes:**

| Cause | Fix |
|-------|-----|
| Large `data/memory-store.json` loaded at startup | Truncate to `{}`, restart |
| SSE subscriber leaked (client never disconnected) | `GET /runtime/stream/status` → check `subscriberCount` |
| Many DLQ entries loaded on startup | `curl .../runtime/dead-letter` → manual cleanup |
| PM2 log accumulation (not the process heap) | `pm2 flush` + `pm2-logrotate` |

**Immediate relief:**
```bash
pm2 restart jarvis-os   # clears in-memory state, starts fresh at ~66 MB RSS
```

**Tuning:** Edit `ecosystem.config.cjs`:
```js
max_memory_restart: "400M",   // lower ceiling for earlier restart
node_args: "--max-old-space-size=350",
```

---

## IR-7: Auth Failure (Users Locked Out)

**Symptom:** Login returns 503 or all routes return 401 unexpectedly.

**Diagnosis:**
```bash
# Check JWT_SECRET is set
grep JWT_SECRET /opt/jarvis-os/.env

# Check auth route is working
curl -X POST https://yourdomain.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"test"}' -v
```

**503 "Auth not configured":** `JWT_SECRET` or `OPERATOR_PASSWORD_HASH` missing from `.env`.
```bash
# Generate JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Add to .env, then:
pm2 restart jarvis-os
```

**401 on valid password:** Clock skew — JWT `iat`/`exp` relies on system time.
```bash
date      # check system clock
timedatectl set-ntp true   # sync with NTP
```

**Locked out completely (no valid cookie, no password known):**
```bash
# Generate a new password hash
node -e "
const c = require('crypto');
const salt = c.randomBytes(16).toString('hex');
const hash = c.scryptSync('NEW_PASSWORD_HERE', salt, 64).toString('hex');
console.log(salt + ':' + hash);
"
# Put the output in OPERATOR_PASSWORD_HASH= in .env
pm2 restart jarvis-os
```

---

## IR-8: Webhook Failure (WhatsApp / Razorpay)

**Symptom:** No incoming WhatsApp messages processed. Payment webhooks silently dropped.

**Check webhook endpoint is reachable:**
```bash
# WhatsApp sends GET to verify — must return challenge
curl "https://yourdomain.com/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_WA_VERIFY_TOKEN&hub.challenge=test123"
# Expected: "test123"
```

**Check nginx is forwarding webhooks (no rate limit on webhook locations):**
```bash
grep -A5 "webhook" /etc/nginx/sites-available/jarvis
# Should have its own location block without limit_req
```

**Check env vars:**
```bash
grep -E "WA_TOKEN|WA_PHONE_ID|RAZORPAY_WEBHOOK" /opt/jarvis-os/.env
```

**Webhook receiving but not processing:**
```bash
pm2 logs jarvis-os | grep -i "webhook\|whatsapp\|razorpay" | tail -20
```

**Meta webhook verification failing:**
```bash
# WA_VERIFY_TOKEN must match exactly what's in Meta App Dashboard
# Re-check: Meta Developer Console → App → WhatsApp → Webhooks → Edit
```

---

## IR-9: SSE Stream Not Delivering Events

**Symptom:** OperatorConsole stuck on `POLL #N`, SSE never reconnects.

**Quick check:**
```bash
# Test SSE directly (requires auth cookie)
curl -b "jarvis_auth=<TOKEN>" -N https://yourdomain.com/runtime/stream
# Should immediately print: data: {"type":"connected",...}
```

**nginx buffering SSE:**
```bash
# Verify /runtime/stream location has proxy_buffering off
grep -A10 "stream" /etc/nginx/sites-available/jarvis | grep buffering
# Must show: proxy_buffering    off;
nginx -t && systemctl reload nginx
```

**Auth failure on SSE:**
```bash
# SSE requires the jarvis_auth cookie to be present
# Check cookie is being sent: open browser devtools → Network → EventStream
```

**EventBus at capacity (20 subs):**
```bash
curl -b "jarvis_auth=<TOKEN>" https://yourdomain.com/runtime/stream/status
# Shows subscriberCount — if 20, old connections are stuck
pm2 restart jarvis-os   # clears all SSE subscribers, clients reconnect automatically
```

---

## Runbook Summary

| Incident | Time to Resolve | First Action |
|----------|----------------|--------------|
| Crash / restart loop | 2 min | `pm2 logs jarvis-os --err --lines 50` |
| Bad deploy rollback | 5 min | `git checkout <prev-tag>` + `pm2 restart` |
| Corrupted queue | 1 min | Auto-handled; check backup if tasks matter |
| E-stop / runaway task | 30 sec | GovernorPanel or `curl .../emergency/stop` |
| Log explosion / disk full | 5 min | `pm2 flush` + `mv execution.ndjson *.old` |
| Memory exhaustion | 2 min | `pm2 restart jarvis-os` (clears heap) |
| Auth lockout | 5 min | Regenerate password hash in `.env` |
| Webhook failure | 10 min | Check nginx routing + env vars + Meta dashboard |
| SSE not streaming | 3 min | Check nginx `proxy_buffering off` config |
