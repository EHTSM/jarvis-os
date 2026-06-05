# Go-Live Checklist — Ooplix

**Date:** 2026-06-05  
**Owner:** Ehtesham (altamashjauhar@gmail.com)  
**Target:** https://app.ooplix.com

Mark each item ✅ when complete. Do not proceed past a P0 section with any item unmarked.

---

## SECTION A — P0 BLOCKERS (Backend + Server)

Nothing goes live until every item in this section is checked.

### A1. Domain + DNS

```
[ ] VPS provisioned (min 2 vCPU / 2GB RAM / Ubuntu 22.04)
[ ] Domain app.ooplix.com → VPS IP (A record set)
[ ] DNS propagated: dig +short app.ooplix.com = <VPS IP>
[ ] Port 80 and 443 open in VPS firewall
    sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 22/tcp
```

### A2. Application deployed

```
[ ] Repository cloned/pulled on VPS
[ ] npm install --production completed
[ ] cd frontend && npm run build completed
[ ] logs/ directory created
[ ] data/ directory exists and writable
```

### A3. Environment variables — production values

Open `.env` on the VPS and confirm every value:

```
[ ] NODE_ENV=production
[ ] PORT=5050
[ ] BASE_URL=https://app.ooplix.com          ← NOT localhost
[ ] APP_URL=https://app.ooplix.com           ← NOT localhost
[ ] ALLOWED_ORIGINS=https://app.ooplix.com   ← NOT localhost
[ ] JWT_SECRET=<64-char hex>                 (already set)
[ ] OPERATOR_PASSWORD_HASH=<scrypt hash>     (already set)
[ ] GROQ_API_KEY=<key>                       (already set)
[ ] RAZORPAY_KEY_ID=rzp_live_*              (already set)
[ ] RAZORPAY_KEY_SECRET=<secret>             (already set)
[ ] RAZORPAY_WEBHOOK_SECRET=<secret>         ← GET FROM RAZORPAY DASHBOARD
[ ] FIREBASE_SERVICE_ACCOUNT=<json>          ← GET FROM FIREBASE CONSOLE
[ ] DISABLE_X_POWERED_BY=1
```

### A4. PM2

```
[ ] pm2 start ecosystem.config.cjs --env production
[ ] pm2 status → jarvis-os shows "online"
[ ] pm2 startup (generated + run as root)
[ ] pm2 save
[ ] pm2 logs jarvis-os → no ERROR lines in first 30 seconds
[ ] curl http://localhost:5050/health → HTTP 200
```

### A5. Nginx + SSL

```
[ ] nginx installed: nginx -v
[ ] /etc/nginx/sites-available/ooplix created (from nginx.conf in repo)
[ ] /etc/nginx/sites-enabled/ooplix symlinked
[ ] /etc/nginx/sites-enabled/default removed
[ ] /etc/nginx/proxy_params created (from nginx.proxy_params in repo)
[ ] sudo nginx -t → "syntax is ok"
[ ] sudo systemctl reload nginx
[ ] certbot --nginx -d app.ooplix.com obtained certificate
[ ] curl -I https://app.ooplix.com/health → HTTP 200 (no cert warning)
[ ] curl -I http://app.ooplix.com → HTTP 301 to HTTPS
```

### A6. Razorpay webhook registration

```
[ ] Razorpay Dashboard → Settings → Webhooks → Add New Webhook
[ ] URL: https://app.ooplix.com/webhook/razorpay
[ ] Events enabled: payment.captured, payment.failed,
                    subscription.activated, subscription.cancelled,
                    subscription.completed, refund.processed
[ ] RAZORPAY_WEBHOOK_SECRET copied from Dashboard into .env
[ ] pm2 reload jarvis-os (to pick up new env var)
[ ] Test webhook: Razorpay Dashboard → Webhooks → click event → Test webhook
    Expected: HTTP 200 response in Razorpay Dashboard
```

---

## SECTION B — P0 BLOCKERS (Firebase)

### B1. Firebase project

```
[ ] Firebase project "ooplix-jarvis" created at console.firebase.google.com
[ ] Google Analytics enabled on project
```

### B2. Authentication

```
[ ] Email/Password sign-in enabled
[ ] Google sign-in enabled (support email: altamashjauhar@gmail.com)
```

### B3. Firestore

```
[ ] Firestore database created (asia-south1, production mode)
[ ] Security rules published:
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /users/{userId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
          match /messages/{msgId} { allow read, write: if request.auth != null && request.auth.uid == userId; }
          match /tasks/{taskId}   { allow read, write: if request.auth != null && request.auth.uid == userId; }
        }
        match /{document=**} { allow read, write: if false; }
      }
    }
```

### B4. Backend Firebase auth

```
[ ] Service account JSON downloaded from Firebase → Project Settings → Service Accounts
[ ] FIREBASE_SERVICE_ACCOUNT=<single-line JSON> set in .env on VPS
[ ] pm2 reload jarvis-os
[ ] curl https://app.ooplix.com/health | grep firebase
    Expected: "firebase": true  (in service status)
```

---

## SECTION C — P1 BLOCKERS (OAuth)

Can launch without these, but Google/GitHub login will not work.

### C1. Google OAuth

```
[ ] Google Cloud Console → APIs & Services → Credentials
[ ] OAuth 2.0 Client ID created (Web application)
[ ] Redirect URI added: https://app.ooplix.com/oauth/google/callback
[ ] GOOGLE_CLIENT_ID set in .env
[ ] GOOGLE_CLIENT_SECRET set in .env
[ ] pm2 reload jarvis-os
[ ] Test: GET https://app.ooplix.com/oauth/status → google.configured: true
[ ] Test: GET https://app.ooplix.com/oauth/google/url → returns URL with accounts.google.com
```

### C2. GitHub OAuth

```
[ ] github.com/settings/developers → OAuth Apps → New OAuth App
[ ] Homepage URL: https://app.ooplix.com
[ ] Callback URL: https://app.ooplix.com/oauth/github/callback
[ ] GITHUB_CLIENT_ID set in .env
[ ] GITHUB_CLIENT_SECRET set in .env
[ ] pm2 reload jarvis-os
[ ] Test: GET https://app.ooplix.com/oauth/status → github.configured: true
```

---

## SECTION D — LAUNCH DAY STEPS

Run these in order on launch day.

### D1. Final pre-launch checks (morning)

```bash
# Health
curl -s https://app.ooplix.com/health | python3 -m json.tool

# Readiness score
curl -s -X POST https://app.ooplix.com/p21/readiness/check \
  -H "Cookie: jarvis_auth=<your-token>" | python3 -m json.tool
# Target: score >= 80

# Security score
curl -s -X POST https://app.ooplix.com/p22/security/check \
  -H "Cookie: jarvis_auth=<your-token>" | python3 -m json.tool
# Target: score >= 90

# PM2 status
pm2 status
# Expected: online, restarts = 0

# Check logs for errors
pm2 logs jarvis-os --lines 50 | grep -i "error\|fatal\|crash"
# Expected: no output
```

### D2. Smoke test production endpoints

```bash
export BASE=https://app.ooplix.com

# Auth
curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong"}' | grep "error"
# Expected: {"error":"Invalid password"}

# AI chat
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<operator-password>"}' \
  -c /tmp/cookies.txt | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))")

curl -s -X POST $BASE/jarvis \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"input":"Hello, are you working?"}' | python3 -m json.tool
# Expected: {"reply":"..."}

# Billing status
curl -s $BASE/billing/status -b /tmp/cookies.txt | python3 -m json.tool
# Expected: plan, daysLeft, allowed: true

# Webhook test (Razorpay)
# Go to Razorpay Dashboard → Webhooks → Test → should get 200 response
```

### D3. Mobile app (if Play Store upload done)

```
[ ] Installed from Play Store (Internal Testing track)
[ ] Login with email works
[ ] Login with Google works (requires SHA-1 in Firebase)
[ ] AI Chat sends and receives response
[ ] Billing status shows trial
[ ] Logout returns to login screen
```

### D4. Announce

```
[ ] Update status page / landing page to "Live"
[ ] Send invite messages to first 10 beta testers (see BETA_LAUNCH_PLAN.md)
[ ] Post on LinkedIn/Twitter with beta join link
[ ] Set up error monitoring watch for first 24 hours
```

---

## SECTION E — POST-LAUNCH VERIFICATION

Run these checks in the first 24 hours after launch.

### E1. Immediately after launch (hour 0-1)

```bash
# Watch PM2 for crashes
watch -n 5 'pm2 status | grep jarvis'
# Expected: stays "online", restart count doesn't grow

# Watch error logs
tail -f logs/pm2-err.log
# Expected: no ERROR or FATAL lines

# Monitor memory
pm2 show jarvis-os | grep memory
# Expected: < 300MB
```

### E2. First user test (hour 1-2)

```
[ ] Send invite to 1 trusted tester
[ ] They install app + login + send AI chat → confirm working
[ ] Confirm webhook: if tester attempts payment → check Razorpay Dashboard for webhook delivery
[ ] Telegram bot: pm2 logs | grep "Telegram" — confirm alerts routing
```

### E3. 24-hour check

```
[ ] pm2 status: 0 restarts since launch
[ ] pm2 logs: no ERRORs in last 24h
[ ] Razorpay Dashboard: all webhooks show 200 responses
[ ] Firebase Console → Authentication → Users: new signups visible
[ ] No spike in /health response time (< 200ms expected)
[ ] Server memory stable (not growing over time)
[ ] Google Play Console (if uploaded): crash-free sessions > 98%
```

### E4. Week-1 check

```
[ ] All 10 beta testers have installed and logged in
[ ] At least 1 payment link created and tested
[ ] OAuth (Google) tested by at least 1 user
[ ] No P0 bugs reported
[ ] Play Store rating (if visible): no 1-star reviews unaddressed
[ ] Razorpay: payment flow end-to-end tested (real payment)
```

---

## Emergency Contacts & Procedures

### If server is down

```bash
# SSH to VPS
ssh root@<vps-ip>

# Check if process is running
pm2 status
# If not: pm2 start ecosystem.config.cjs --env production

# Check nginx
sudo systemctl status nginx
# If not: sudo systemctl start nginx

# Check port in use
lsof -i :5050
```

### If payment webhooks fail

```
1. Check Razorpay Dashboard → Webhooks → Recent deliveries
2. If 400 errors: RAZORPAY_WEBHOOK_SECRET may be wrong — re-copy and pm2 reload
3. If 503/timeout: check if server is up (pm2 status)
4. If 400 "Invalid signature": raw body middleware may not be running — pm2 restart
```

### If Firebase auth breaks

```
1. Check FIREBASE_SERVICE_ACCOUNT is set: pm2 env 0 | grep FIREBASE
2. Check Firebase Console → Authentication → Usage (quota not exceeded)
3. Check: curl http://localhost:5050/health | grep firebase
4. If false: pm2 reload jarvis-os and retry
```

### Rollback procedure

```bash
# Find last known good commit
git log --oneline -10

# Rollback
git checkout <commit-hash>
pm2 restart jarvis-os

# Verify
curl http://localhost:5050/health
```

---

## Success Definition

**Launch is successful when:**

```
✅ https://app.ooplix.com/health returns 200 for 24 hours straight
✅ 10 beta users installed and used the app
✅ At least 1 real payment completed (Razorpay webhook → billing activated)
✅ PM2 restart count = 0 in first 24 hours
✅ No P0 bugs reported from testers
✅ Crash-free session rate > 98% (Play Console, if mobile uploaded)
```
