# Ooplix — Admin Guide

## Overview

This guide covers admin-layer operations: account management, billing controls, feature gates, security policies, and system health for operators with admin-level access.

---

## Admin Access

Admin access is granted via the `OPERATOR_PASSWORD_HASH` environment variable. The admin panel is accessible from the Ooplix desktop app under the Admin tab.

**Default credentials**: Set during initial setup via `scripts/create-admin.sh` or by hashing a password with `node -e "const crypto = require('crypto'); console.log(crypto.createHash('sha256').update('YOUR_PASSWORD').digest('hex'));"`.

---

## Account Management

### View all accounts

```
GET /accounts
```

Returns all registered accounts with plan, trial status, and creation date.

### Suspend/Activate an account

Modify `data/billing.json` directly (while server is stopped) or use the billing API:

```
POST /billing/admin/suspend   { "accountId": "..." }
POST /billing/admin/activate  { "accountId": "..." }
```

### Reset account password

Accounts use Firebase Auth on the client. Password resets are handled via Firebase console at `console.firebase.google.com` → Authentication → Users.

---

## Billing Controls

### Plan configuration

Plans are defined in `backend/services/billingService.js`:

| Plan       | Price (₹/mo) | Seats | Credits/day |
|------------|-------------|-------|-------------|
| Trial      | 0           | 1     | 50          |
| Free       | 0           | 1     | 10          |
| Starter    | 999         | 1     | 200         |
| Growth     | 2,499       | 5     | 500         |
| Team       | 4,999       | 20    | 1,000       |
| Enterprise | 9,999       | 999   | 5,000       |

### Razorpay dashboard

- Payments: `dashboard.razorpay.com` → Payments
- Subscriptions: `dashboard.razorpay.com` → Subscriptions
- Webhooks: `dashboard.razorpay.com` → Settings → Webhooks → `https://yourdomain.com/webhook/razorpay`

### Manual plan override

```bash
# While server is running:
curl -X POST https://yourdomain.com/billing/admin/override \
  -H "Cookie: jarvis_auth=<admin_token>" \
  -d '{"accountId": "acc-xxx", "plan": "growth"}'
```

---

## Feature Gate Management

Feature gates control which features are available per plan. Configuration in `backend/services/featureGate.cjs`.

To add a new gate:
1. Add to `FEATURE_GATES` object in `featureGate.cjs`
2. Update plan entitlements in `PLAN_ENTITLEMENTS`
3. Call `checkGate(accountId, 'feature_name')` in the route handler

---

## Security Administration

### Session management

```
GET  /security/sessions      # list active sessions
DEL  /security/sessions/:id  # revoke a session
GET  /security/audit         # audit log (last 1000 entries)
GET  /security/score         # current security score
```

### Security score interpretation

- **90–100**: Excellent. All critical controls in place.
- **75–89**: Good. Minor gaps — review warn items.
- **60–74**: Acceptable. Address fails before production.
- **< 60**: At risk. Do not expose to public users.

### Rate limit tuning

Edit `nginx.conf`:

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
```

Then reload: `sudo nginx -s reload`

---

## Monitoring & Alerting

### View system health

```
GET /health          # server liveness
GET /ops/infra/executive  # full production readiness score
```

### PM2 process management

```bash
pm2 list                    # all processes
pm2 logs jarvis-os          # live logs
pm2 restart jarvis-os       # graceful restart
pm2 reload jarvis-os        # zero-downtime reload
pm2 stop jarvis-os          # stop process
pm2 delete jarvis-os        # remove from PM2
pm2 start ecosystem.config.cjs  # start from config
```

### Log files

- App logs: `logs/pm2-out.log`
- Error logs: `logs/pm2-err.log`
- Nginx access: `/var/log/nginx/access.log`
- Nginx errors: `/var/log/nginx/error.log`
- System journal: `journalctl -u nginx --since "1 hour ago"`

---

## Database Administration

All application data is stored as flat JSON files in `data/`. No database server required.

### Backup

```bash
bash backup.sh          # creates timestamped tar.gz in backups/
```

### Restore

```bash
bash deploy/rollback.sh --list               # show available backups
bash deploy/rollback.sh backups/jarvis_DATE.tar.gz   # restore
```

### Integrity check

```
GET /ops/infra/database    # audits all JSON files, reports invalid
```

### Manual inspection

```bash
cat data/billing.json | python3 -m json.tool    # pretty-print
cat data/local-accounts.json | python3 -m json.tool
```

---

## Deployment Administration

### Deploy a new version

```bash
bash deploy/update.sh          # pull + restart
bash deploy.sh                 # full deploy (build + restart)
bash deploy.sh --no-build      # skip build, just restart
```

### Rollback

```bash
bash deploy/rollback.sh               # restore latest data backup
bash deploy/rollback.sh --code HEAD~1 # revert code one commit
```

### Validate production

```bash
bash deploy/validate-production.sh
bash deploy/validate-production.sh --json   # machine-readable
```

---

## Emergency Procedures

See [Disaster Recovery Guide](DISASTER-RECOVERY.md) for full runbook.

**Quick reference:**
- Server down: `pm2 start ecosystem.config.cjs`
- Nginx down: `sudo systemctl restart nginx`
- Data corruption: `bash deploy/rollback.sh <backup_file>`
- DDoS: `sudo ufw deny from <attacking_ip>` + enable `limit_req` in nginx
