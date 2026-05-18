# BACKUP_RESTORE_VALIDATION.md

**Purpose** – Document and validate backup/restore procedures to ensure operational continuity.

---

## 1. Backup Creation

### 1.1 Full System Backup
**Command** (run daily at 02:00):
```bash
tar -czf backups/jarvis-$(date +%F).tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=logs/*.log \
  --exclude=*.DS_Store \
  .
```

### 1.2 Incremental Backup
**Command** (hourly):
```bash
rsync -av --delete --exclude=node_modules --exclude=.git --exclude=logs/* \
  . incremental-backups/$(date +%H)/
```

### 1.3 Database Backup
**Command** (daily):
```bash
sqlite3 data/learning.db ".backup backups/learning-$(date +%F).db"
```

### 1.4 Config Backup
**Command** (daily):
```bash
cp .env backups/env-$(date +%F).env
cp evolution-config.json backups/config-$(date +%F).json
cp ecosystem.config.cjs backups/pm2-$(date +%F).cjs
```

---

## 2. Restore Process

### 2.1 Full System Restore
**Steps**:
1. `cd /tmp`
2. `tar -xzvf /path/to/backups/jarvis-YYYY-MM-DD.tar.gz`
3. `cp jarvis-YYYY-MM-DD/.env .`
4. `cd jarvis-YYYY-MM-DD`
5. `npm install`
6. `sqlite3 data/learning.db < backups/learning-YYYY-MM-DD.db`
7. `pm2 start ecosystem.config.cjs`

### 2.2 Partial Restore (config only)
**Steps**:
1. `cp backups/env-YYYY-MM-DD.env .env`
2. `cp backups/config-YYYY-MM-DD.json evolution-config.json`
3. `cp backups/pm2-YYYY-MM-DD.cjs ecosystem.config.cjs`
4. `pm2 restart jarvis`

### 2.3 Database Restore
**Steps**:
1. `sqlite3 data/learning.db "VACUUM;"` (clear current db)
2. `sqlite3 data/learning.db < backups/learning-YYYY-MM-DD.db`

---

## 3. .env Recovery Validation

### 3.1 Critical Variables
```
JARVIS_API_KEY=required
JWT_SECRET=required
AUTH_USER=required
AUTH_PASS=required
GROQ_API_KEY=required
PORT=3000
NODE_ENV=production
```

### 3.2 Validation Script
```bash
#!/bin/bash
# check-env.sh
grep -q '^JARVIS_API_KEY=' .env || echo "Missing JARVIS_API_KEY"
grep -q '^JWT_SECRET=' .env || echo "Missing JWT_SECRET"
grep -q '^AUTH_USER=' .env || echo "Missing AUTH_USER"
grep -q '^GROQ_API_KEY=' .env || echo "Missing GROQ_API_KEY"
```

---

## 4. Rollback Scripts

### 4.1 Emergency Rollback
**Command**:
```bash
#!/bin/bash
# emergency-rollback.sh
BACKUP_DATE=$(date -d "yesterday" +%F)
tar -xzf /path/to/backups/jarvis-${BACKUP_DATE}.tar.gz -C /tmp
cd /tmp/jarvis-${BACKUP_DATE}
cp .env /Users/ehtsm/jarvis-os/
cp evolution-config.json /Users/ehtsm/jarvis-os/
sqlite3 /Users/ehtsm/jarvis-os/data/learning.db < backups/learning-${BACKUP_DATE}.db
cd /Users/ehtsm/jarvis-os
npm install
pm2 restart jarvis
```

### 4.2 Quick Rollback (last known good)
```bash
#!/bin/bash
# quick-rollback.sh
pm2 stop jarvis
cp /path/to/backups/env-$(date +%F).env .env
cp /path/to/backups/config-$(date +%F).json evolution-config.json
pm2 start jarvis
```

---

## 5. Log Preservation

### 5.1 Log Rotation
```bash
# Rotate logs daily
mv logs/jarvis-$(date +%F).log logs/archive/jarvis-$(date +%F).log
gzip logs/archive/jarvis-$(date +%F).log
```

### 5.2 Critical Log Retention
- **System logs**: 30 days
- **Incident logs**: 90 days
- **Audit logs**: 365 days

---

## 6. Validation Timing

### 6.1 Daily Tests
- [ ] Check backup file exists (`ls backups/$(date +%F)*`)
- [ ] Verify checksum matches (`sha256sum -c checksums.sha256`)
- [ ] Run `check-env.sh` script

### 6.2 Weekly Tests
- [ ] Full system restore to staging environment
- [ ] Test database restore
- [ ] Validate auth tokens work after restore

### 6.3 Monthly Tests
- [ ] Full restore to production (maintenance window)
- [ ] Test rollback scripts
- [ ] Verify data integrity

---

## 7. Recovery Metrics

| Task | Target Time | Actual Time | Notes |
|------|-------------|-------------|-------|
| Full restore | < 5 min | | |
| Database restore | < 1 min | | |
| Config restore | < 30 sec | | |
| Log recovery | < 2 min | | |
| Emergency rollback | < 3 min | | |

---

## 8. Checklist

### 8.1 Before Backup
- [ ] All services running
- [ ] No pending transactions
- [ ] Log files closed
- [ ] Database not mid-transaction

### 8.2 After Restore
- [ ] PM2 shows process running
- [ ] Health endpoint returns 200
- [ ] Auth tests pass
- [ ] Queue is empty or matches expectation
- [ ] All agents respond correctly

---

*Update this document after each backup/restore validation.*