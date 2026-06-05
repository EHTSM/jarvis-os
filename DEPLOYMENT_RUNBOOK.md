# Deployment Runbook — Ooplix / JARVIS-OS

**Date:** 2026-06-05  
**Server:** Ubuntu 22.04 LTS VPS  
**Domain:** app.ooplix.com  
**App port:** 5050 (internal, nginx proxies)  
**PM2 config:** `ecosystem.config.cjs`

---

## Prerequisites

Your VPS needs:
- Ubuntu 22.04 LTS (or 20.04)
- Minimum: 2 vCPU, 2 GB RAM, 20 GB SSD
- SSH access as root or sudo user
- Domain `app.ooplix.com` pointing to the VPS IP (A record)

---

## Part 1 — Initial Server Setup

### 1.1 Install Node.js 20 LTS

```bash
# Connect to VPS
ssh root@<your-vps-ip>

# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # Expected: v20.x.x
npm --version    # Expected: 10.x.x
```

### 1.2 Install PM2

```bash
sudo npm install -g pm2

# Verify
pm2 --version    # Expected: 5.x.x
```

### 1.3 Install nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx

# Start and enable
sudo systemctl start nginx
sudo systemctl enable nginx

# Verify
sudo nginx -t   # Expected: syntax is ok / test is successful
```

### 1.4 Install Certbot (Let's Encrypt SSL)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 1.5 Create app user (optional but recommended)

```bash
sudo adduser jarvis --disabled-password --gecos ""
sudo mkdir -p /home/jarvis/jarvis-os
sudo chown jarvis:jarvis /home/jarvis/jarvis-os
```

---

## Part 2 — Deploy Application

### 2.1 Clone repository

```bash
# As app user or root:
cd /home/jarvis
git clone https://github.com/your-repo/jarvis-os.git
cd jarvis-os

# Or pull latest on existing deploy:
git pull origin main
```

### 2.2 Install dependencies

```bash
# Root dependencies
npm install --production

# Frontend build
cd frontend && npm install && npm run build && cd ..
```

### 2.3 Create logs directory

```bash
mkdir -p logs
```

### 2.4 Set environment variables

```bash
# Copy sample and edit
cp .env .env.production 2>/dev/null || true
nano .env

# Minimum required production values (change these):
```

**Required changes in `.env` for production:**

```env
# ── URLs (update ALL three) ──────────────────────────────────────
BASE_URL=https://app.ooplix.com
APP_URL=https://app.ooplix.com
ALLOWED_ORIGINS=https://app.ooplix.com

# ── Razorpay (add webhook secret) ───────────────────────────────
RAZORPAY_WEBHOOK_SECRET=<from Razorpay Dashboard → Webhooks>

# ── Firebase ────────────────────────────────────────────────────
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"ooplix-jarvis",...}

# ── OAuth ───────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GITHUB_CLIENT_ID=<from GitHub OAuth App>
GITHUB_CLIENT_SECRET=<from GitHub OAuth App>

# ── These should already be set ─────────────────────────────────
NODE_ENV=production
PORT=5050
JWT_SECRET=<your existing secret>
OPERATOR_PASSWORD_HASH=<your existing hash>
GROQ_API_KEY=<your existing key>
RAZORPAY_KEY_ID=<your existing live key>
RAZORPAY_KEY_SECRET=<your existing secret>
```

---

## Part 3 — PM2 Setup

### 3.1 Start application

```bash
cd /home/jarvis/jarvis-os

# Start with production environment
pm2 start ecosystem.config.cjs --env production

# Verify it's running
pm2 status
# Expected: jarvis-os | online | ...
```

### 3.2 Persist across reboots

```bash
# Generate systemd startup script (run as the user that will own PM2)
pm2 startup systemd -u jarvis --hp /home/jarvis

# PM2 will print a command like:
# sudo env PATH=... pm2 startup systemd -u jarvis --hp /home/jarvis
# Run that command exactly as printed.

# Then save current process list
pm2 save
```

### 3.3 Verify PM2 configuration

```bash
pm2 show jarvis-os

# Key fields to verify:
# status:         online
# restarts:       0
# uptime:         xx s
# memory usage:   < 200MB normally
# watching:       disabled
# exec mode:      fork
```

### 3.4 PM2 log access

```bash
# Live logs
pm2 logs jarvis-os

# Last 100 lines
pm2 logs jarvis-os --lines 100

# Error log only
tail -f logs/pm2-err.log

# Access log only
tail -f logs/pm2-out.log
```

---

## Part 4 — Nginx Configuration

### 4.1 Install site config

```bash
# Copy the nginx.conf from the repo
sudo cp /home/jarvis/jarvis-os/nginx.conf /etc/nginx/sites-available/ooplix

# Update domain name in the config if needed
sudo nano /etc/nginx/sites-available/ooplix
# Change: server_name app.ooplix.com ooplix.com;
# To your actual domain(s)

# Enable the site
sudo ln -s /etc/nginx/sites-available/ooplix /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t
# Expected: syntax is ok / test is successful

# Reload nginx
sudo systemctl reload nginx
```

### 4.2 Install proxy params

```bash
sudo cp /home/jarvis/jarvis-os/nginx.proxy_params /etc/nginx/proxy_params
```

### 4.3 Key nginx config sections (from nginx.conf)

```nginx
# Rate limiting zones — DDoS protection
limit_req_zone $binary_remote_addr zone=api_auth:10m   rate=10r/m;
limit_req_zone $binary_remote_addr zone=api_jarvis:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=api_global:10m rate=60r/m;

# Auth routes — strict (brute force protection)
location /auth/ {
    limit_req zone=api_auth burst=5 nodelay;
    proxy_pass http://jarvis_backend;
}
```

---

## Part 5 — SSL / TLS

### 5.1 Obtain Let's Encrypt certificate

**DNS must be pointed to the VPS before running this.**

```bash
# Verify DNS first
dig +short app.ooplix.com
# Must return your VPS IP

# Obtain cert (nginx plugin handles config automatically)
sudo certbot --nginx -d app.ooplix.com -d ooplix.com \
  --non-interactive \
  --agree-tos \
  --email altamashjauhar@gmail.com

# Expected: "Congratulations! Your certificate and chain have been saved"
```

### 5.2 Verify SSL

```bash
# Check cert was issued
sudo certbot certificates

# Test HTTPS (from another machine or curl)
curl -I https://app.ooplix.com/health
# Expected: HTTP/2 200

# Test HTTP redirect
curl -I http://app.ooplix.com
# Expected: HTTP/1.1 301 Moved Permanently → https://
```

### 5.3 Auto-renewal

```bash
# Certbot installs a systemd timer automatically. Verify:
sudo systemctl status certbot.timer
# Expected: active (waiting)

# Test renewal (dry run)
sudo certbot renew --dry-run
# Expected: "Congratulations, all simulated renewals succeeded"
```

---

## Part 6 — Environment Variable Management

### Never commit secrets to git

```bash
# Verify .env is in .gitignore
grep ".env" .gitignore
# Expected: .env listed

# Verify no secrets are staged
git diff --cached
git status
```

### Updating a single env var without downtime

```bash
# Edit .env
nano .env

# Zero-downtime reload (PM2 fork mode — no dropped requests)
pm2 reload jarvis-os

# Verify the change took effect
pm2 logs jarvis-os --lines 20 | grep "Startup"
```

### Rotating JWT_SECRET

```bash
# 1. Generate new secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Update .env
nano .env   # change JWT_SECRET=<new value>

# 3. Reload (all existing sessions will be invalidated — users must re-login)
pm2 reload jarvis-os

# Note: rotating JWT_SECRET invalidates ALL active sessions immediately.
# Schedule during low-traffic period if possible.
```

---

## Part 7 — Rollback Plan

### Rollback to previous git commit

```bash
# On VPS — check recent commits
git log --oneline -10

# Rollback to specific commit
git checkout <commit-hash>

# Restart app
pm2 restart jarvis-os

# Verify health
curl http://localhost:5050/health
```

### Rollback to previous git tag

```bash
# Create a tag before each deploy (recommended practice)
git tag v3.0.0-pre-deploy
git push origin v3.0.0-pre-deploy

# Rollback to tag
git checkout v3.0.0-pre-deploy
pm2 restart jarvis-os
```

### Rollback data

The app uses JSON files in `data/`. Before deploys that change data structure:

```bash
# Backup data directory
cp -r data/ data-backup-$(date +%Y%m%d-%H%M%S)/

# Restore if needed
cp -r data-backup-<timestamp>/ data/
pm2 restart jarvis-os
```

### Emergency: kill and restart from scratch

```bash
# Stop all PM2 processes
pm2 kill

# Clean start
pm2 start ecosystem.config.cjs --env production
pm2 save
```

---

## Part 8 — Health Verification

Run after every deploy:

```bash
# 1. API health
curl -s http://localhost:5050/health | python3 -m json.tool
# Expected: {"status":"ok", ...}

# 2. Via nginx (HTTPS)
curl -s https://app.ooplix.com/health | python3 -m json.tool

# 3. Auth endpoint
curl -s -X POST https://app.ooplix.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong"}' | python3 -m json.tool
# Expected: {"error":"Invalid password"} with HTTP 401

# 4. Rate limit working
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://app.ooplix.com/auth/login \
    -H "Content-Type: application/json" -d '{"password":"x"}';
done
# Expected: 401 401 ... 429 (429 on 11th request)

# 5. PM2 status
pm2 status
# Expected: online, 0 restarts (or low restarts)

# 6. Memory
pm2 show jarvis-os | grep "memory"
# Expected: < 300MB

# 7. Nginx status
sudo systemctl status nginx
# Expected: active (running)
```

---

## Part 9 — Deploy Checklist

Run this checklist on every deploy to production:

```
PRE-DEPLOY
[ ] git pull origin main completed
[ ] npm install --production completed
[ ] cd frontend && npm run build completed (if frontend changed)
[ ] .env has correct production values (no localhost URLs)
[ ] data/ directory backed up

DEPLOY
[ ] pm2 reload jarvis-os (or pm2 restart jarvis-os)
[ ] pm2 status shows: online, 0 new restarts
[ ] No error lines in: pm2 logs jarvis-os --lines 30

POST-DEPLOY VERIFY
[ ] curl http://localhost:5050/health returns HTTP 200
[ ] curl https://app.ooplix.com/health returns HTTP 200
[ ] Login test: POST /auth/login with wrong pw → HTTP 401
[ ] Rate limit test: 11th login attempt → HTTP 429
[ ] Nginx: sudo nginx -t passes

ROLLBACK TRIGGER (if any of these fail)
[ ] HTTP 500 on /health → git checkout <previous> && pm2 restart
[ ] PM2 restart count > 3 → pm2 logs → diagnose → rollback
[ ] Error rate > 5% in logs → rollback
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pm2 status` | Show all running processes |
| `pm2 logs jarvis-os` | Live logs |
| `pm2 reload jarvis-os` | Zero-downtime reload (env changes) |
| `pm2 restart jarvis-os` | Hard restart |
| `pm2 monit` | Real-time CPU/memory monitor |
| `sudo nginx -t` | Test nginx config |
| `sudo systemctl reload nginx` | Apply nginx config changes |
| `sudo certbot renew` | Renew SSL certificate |
| `curl localhost:5050/health` | Quick health check |
| `git log --oneline -5` | Last 5 commits |
| `git checkout <hash>` | Rollback to commit |
| `pm2 save` | Persist process list for reboot |
