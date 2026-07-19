# Disaster Recovery

How to recover Ooplix from total data loss, a bad deploy, or a dead VPS. For routine incident diagnosis (crash loops, memory leaks, webhook failures) see [docs/current/INCIDENT_RESPONSE.md](docs/current/INCIDENT_RESPONSE.md) — this document covers the harder cases: **you've actually lost something and need to get it back.**

---

## What's backed up, and what isn't

**`npm run backup`** (`backup.sh`) — the routine backup, safe to run frequently or on a cron:
- Archives `data/` (leads, task queue, memory store, learning data) to `backups/jarvis_TIMESTAMP.tar.gz`
- Excludes `data/autonomous` and `data/futureTech` (large, regenerable state)
- Keeps the last 14 backups, deletes older ones automatically

**`node scripts/safe-backup.cjs`** — a more thorough snapshot used before major changes:
- Snapshots the JSON task queue and the SQLite database (`jarvis.db`) consistently
- Records **non-secret** config keys only (`PORT`, `NODE_ENV`, `BASE_URL`, etc.) for reference

**`.env` is never included in any backup, by design.** It contains live API keys and secrets — putting it in a backup archive would mean every backup copy is also a credentials leak risk. This means:

> **You must have your own separate, secure copy of `.env` (or the ability to regenerate every value in it) independent of the app's own backup system.** A password manager entry, an encrypted note, or a secrets manager — anything outside this repo's `backups/` directory. If you lose the VPS and don't have `.env` saved elsewhere, recovering it means re-doing every step in [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md) from scratch.

**What's genuinely irrecoverable if lost with no backup:** CRM leads, task history, learning/memory data, anything in `data/` since your last backup. Everything else (code, config structure) is in git and can be re-cloned.

---

## Scenario 1 — Bad deploy, need to roll back code

```bash
bash deploy/rollback.sh --list                 # see recent commits + available data backups
bash deploy/rollback.sh --code HEAD~1          # roll back one commit
bash deploy/rollback.sh --code <commit-hash>   # roll back to a specific commit
```

What it does: backs up your current `.env` to `backups/.env.bak.<timestamp>` (chmod 600), stops PM2, checks out the target commit, reinstalls dependencies, restarts, and polls `/health` for up to 15 seconds. **`.env` and `data/` are untouched** — this only rolls back code.

If the server doesn't come back healthy after rollback, check `pm2 logs jarvis-os`.

## Scenario 2 — Bad data state, need to restore from backup

```bash
bash deploy/rollback.sh --list                          # list available backups
bash deploy/rollback.sh                                  # restore the LATEST backup
bash deploy/rollback.sh jarvis_20260715_140000.tar.gz     # restore a SPECIFIC backup
```

What it does: backs up `.env` separately, stops PM2, **saves your current `data/` as a safety-net archive first** (`backups/pre-rollback-<timestamp>.tar.gz` — so a bad restore is itself reversible), extracts the chosen backup over `data/`, restarts, and verifies health.

If you restore the wrong backup by mistake, the safety-net archive from the step above is your way back.

## Scenario 3 — Total data loss (disk failure, corrupted `data/`, accidental `rm -rf`)

This is the scenario `scripts/test-restore.cjs` exists to validate — it's not theoretical, it's a tested procedure:

```bash
pm2 stop jarvis-os

# Restore the two authoritative files from the latest full snapshot:
LATEST=$(ls -t backups/jarvis_full_*.tar.gz | head -1)
tar -xzf "$LATEST" -C /tmp/restore
cp /tmp/restore/*/task-queue.json data/task-queue.json
cp /tmp/restore/*/jarvis.db data/jarvis.db

# Verify integrity before trusting it:
node scripts/check-persistence-divergence.cjs

pm2 start jarvis-os
curl http://localhost:5050/health
```

To rehearse this before you actually need it (recommended — do this once now, not during a real emergency):
```bash
node scripts/test-restore.cjs
```
This runs the exact sequence above against your current latest backup, including the integrity check, and reports PASS/FAIL. If it fails, your backup process itself is broken — fix that before you need it for real.

## Scenario 4 — VPS is completely gone (dead server, provider outage, need to move providers)

1. **Provision a new VPS.** Same or different provider — doesn't matter.
2. **Run setup from scratch:**
   ```bash
   sudo bash deploy/setup-vps.sh
   ```
   This clones the repo fresh from GitHub — your code is safe as long as it's pushed to `origin/main`. Anything not pushed is gone; see the note at the end of this doc about commit discipline.
3. **Restore `.env`** from your separate secure copy (see the callout above). If you don't have one, work through [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md) again — this is slow but not impossible, since every credential can be regenerated from its provider's dashboard.
4. **Restore `data/`** from your most recent backup, if you have a copy of the `backups/` directory saved somewhere off the dead server (S3, another machine, wherever you copy backups to). **If your only copy of `backups/` lived on the dead VPS, your data backups died with it** — this is why off-server backup replication matters; see the note below.
5. **Point DNS** at the new VPS's IP.
6. **Get a fresh HTTPS cert:** `sudo certbot --nginx -d yourdomain.com`
7. **Start:** `bash deploy/start-production.sh`
8. **Verify** using [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md) sections 4 and 8 before telling anyone the new URL.

> **This repo's backup scripts write to `backups/` on the same machine.** They do not, on their own, replicate off-server. If the VPS dies entirely, on-server backups die with it. Set up an off-server copy — a simple cron `rsync`/`scp` of `backups/` to a second machine, or object storage — before you need this scenario for real. This is the single biggest gap between "we have backups" and "we can actually recover from losing the server."

## Scenario 5 — Corrupted `task-queue.json` specifically

The server detects and self-heals this on startup — it backs up the corrupt file and resets to `[]` automatically. Look for:
```bash
ls data/task-queue.json.bak.*
```
If a valid backup exists and you want the tasks back rather than starting fresh:
```bash
pm2 stop jarvis-os
cp data/task-queue.json.bak.<timestamp> data/task-queue.json
node -e "JSON.parse(require('fs').readFileSync('data/task-queue.json','utf8')); console.log('valid JSON')"
pm2 start jarvis-os
```

## Scenario 6 — You're locked out (lost the operator password, no valid session)

```bash
node -e "
const c = require('crypto');
const salt = c.randomBytes(16).toString('hex');
const hash = c.scryptSync('YOUR_NEW_PASSWORD', salt, 64).toString('hex');
console.log(salt + ':' + hash);
"
```
Put the output in `OPERATOR_PASSWORD_HASH=` in `.env`, then `pm2 restart jarvis-os`. This requires SSH/filesystem access to the server — if you've lost that too, you're in Scenario 4.

---

## Recovery time expectations

| Scenario | Time to recover |
|---|---|
| Code rollback | ~1 minute |
| Data restore from local backup | ~2 minutes |
| Total data loss, backup on-server | ~5 minutes |
| Corrupted task queue | Auto-healed on restart, or ~1 minute manual |
| Locked out of operator console | ~2 minutes (with server access) |
| VPS completely gone, backups replicated off-server | 20–40 minutes (mostly DNS propagation + cert issuance) |
| VPS completely gone, **no off-server backup** | Data since last off-server copy is unrecoverable; code/config recovery only |

## Before you need this document

Do these once, now, not during an actual emergency:

- [ ] Run `node scripts/test-restore.cjs` and confirm it passes
- [ ] Save a secure copy of your `.env` somewhere outside this repo
- [ ] Set up off-server replication of the `backups/` directory (cron `rsync` to a second host, or upload to object storage)
- [ ] Confirm `git push origin main` is current — nothing production-critical exists only in an uncommitted local change
- [ ] Know your Razorpay, WhatsApp/Meta, and DNS provider login credentials are accessible even if your primary machine is unavailable
