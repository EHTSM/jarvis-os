# ROLLBACK_PROCEDURE.md

**Date:** 2026-05-15

---

## When to Rollback

Roll back if after a deployment:
- `/health` returns non-200 or stays down after 60 seconds
- The frontend is blank or shows a JS error
- Tasks stopped executing and `pm2 logs` shows repeated crashes
- A critical regression was introduced (AI stopped responding, payments broken)

---

## Automated Rollback (Recommended)

The deploy script in `deploy/rollback.sh` handles the common case:

```bash
bash deploy/rollback.sh
```

This will:
1. Read the previous git commit hash from `backups/.last-deployed-sha`
2. Check out that commit
3. Run `bash deploy.sh --no-build` to restart with the previous code
4. Run the smoke tests to verify recovery

---

## Manual Rollback Procedure

### Step 1: Find the last good commit

```bash
git log --oneline -10
```

Identify the commit hash before the breaking change.

### Step 2: Check out the previous version

```bash
git checkout <commit-hash>
```

### Step 3: Restart the backend (no frontend rebuild needed unless frontend changed)

```bash
bash deploy.sh --no-build
# or if the frontend also needs reverting:
bash deploy.sh
```

### Step 4: Verify recovery

```bash
# Basic health check
curl http://localhost:5050/health

# Full smoke test
node tests/smoke/production-smoke.cjs
```

### Step 5: Return to latest branch when fix is ready

```bash
git checkout main
# apply fix, commit, then redeploy
bash deploy.sh
```

---

## Data Rollback

Code rollbacks do not touch `data/`. If a deployment corrupted data files:

```bash
# List available backups
ls -lh backups/

# Restore a specific backup
tar -xzf backups/data-20260515.tar.gz -C /tmp/restore
# Review the extracted data, then:
cp /tmp/restore/data/leads.json data/leads.json
cp /tmp/restore/data/task-queue.json data/task-queue.json
```

Restart after data restore:
```bash
bash deploy.sh --no-build
```

---

## PM2 Emergency Recovery

If PM2 itself is stuck:

```bash
# Hard stop and remove
pm2 stop jarvis-os 2>/dev/null || true
pm2 delete jarvis-os 2>/dev/null || true

# Restart fresh
pm2 start ecosystem.config.cjs --env production
pm2 save
```

If the process keeps crashing (restart loop):

```bash
pm2 logs jarvis-os --err --lines 50   # read the error
# Fix the root cause, then:
pm2 start ecosystem.config.cjs --env production
```

---

## Rollback Decision Tree

```
Deployment broke something
        │
        ├─ Is the server unreachable (no /health response)?
        │    └─ YES → pm2 status; if stopped: pm2 start ecosystem.config.cjs
        │
        ├─ Server running but /health failing?
        │    └─ pm2 logs jarvis-os --err → find crash reason
        │       Fix forward (fastest) or rollback commit
        │
        ├─ Frontend broken (blank page, JS error)?
        │    └─ git checkout <prev-commit> && bash deploy.sh
        │
        └─ Feature regression (AI/payments/WhatsApp not working)?
             └─ Test locally: node backend/server.js
                Fix forward if fast; rollback if complex
```
