> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# VPS HARDENING CHECKLIST
Phase L — Daily Operator Readiness  
Date: 2026-05-16

Target: Single Ubuntu 22.04 VPS, single operator, jarvis-os on PM2.

Legend: ✅ Already done / ⬜ Action required / ℹ️ Info only

---

## 1. PM2 PROCESS MANAGEMENT

### 1.1 Memory ceiling

```js
// ecosystem.config.cjs — already configured
max_memory_restart: "512M",
node_args: "--max-old-space-size=400",
```
✅ PM2 restarts before OS OOM-kill. V8 heap capped at 400 MB with 112 MB headroom.

### 1.2 Crash restart limits

```js
autorestart:  true,
max_restarts: 10,
min_uptime:   "10s",
restart_delay: 3000,
```
✅ After 10 rapid restarts, PM2 stops trying. Prevents infinite crash loop consuming
all resources. Check `pm2 logs jarvis-os --lines 100` when this triggers.

### 1.3 PM2 survive reboot

```bash
# Run once on VPS after initial deploy
pm2 startup          # generates init script
sudo <generated command>
pm2 save             # persists current process list
```
⬜ Must run on VPS. Without `pm2 save`, a VPS reboot kills Jarvis permanently.

### 1.4 PM2 log rotation

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```
⬜ PM2 stdout/stderr in `~/.pm2/logs/` grows unbounded without this.
Install once on VPS.

### 1.5 PM2 version pin

Keep PM2 at a specific version. `pm2 update` may introduce breaking changes.
```bash
npm list -g pm2   # check current version
```
ℹ️ Informational — no required action.

---

## 2. NGINX (REVERSE PROXY + HTTPS)

### 2.1 Basic configuration

```nginx
server {
    listen 443 ssl http2;
    server_name jarvis.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/jarvis.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jarvis.yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Prevent clickjacking, XSS, MIME sniff
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "no-referrer-when-downgrade";

    # Proxy to Node.js
    location / {
        proxy_pass         http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_read_timeout    120s;
    }

    # SSE endpoint — must NOT buffer, must have long timeout
    location /runtime/stream {
        proxy_pass         http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;   # 1 hour — SSE connections are long-lived
        chunked_transfer_encoding on;
    }
}

server {
    listen 80;
    server_name jarvis.yourdomain.com;
    return 301 https://$host$request_uri;
}
```
⬜ Create at `/etc/nginx/sites-available/jarvis` and symlink to `sites-enabled/`.

**Critical for SSE:** `proxy_buffering off` + `proxy_read_timeout 3600s` on `/runtime/stream`.
Without these, nginx buffers the SSE stream and the frontend never receives events.

### 2.2 HTTPS certificate (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d jarvis.yourdomain.com
# Auto-renewal is configured by certbot — verify:
sudo systemctl status certbot.timer
```
⬜ Required before going to any non-local URL.

---

## 3. FILE AND ENVIRONMENT SECURITY

### 3.1 .env permissions

```bash
chmod 600 /home/ubuntu/jarvis-os/.env
chown ubuntu:ubuntu /home/ubuntu/jarvis-os/.env
```
⬜ `.env` contains JWT_SECRET and OPERATOR_PASSWORD_HASH. World-readable would expose both.

### 3.2 data/ directory permissions

```bash
chmod 750 /home/ubuntu/jarvis-os/data/
chmod 640 /home/ubuntu/jarvis-os/data/*.json
```
⬜ `data/leads.json` contains customer phone numbers. Restrict to owner + group.

### 3.3 Disable directory listing in nginx

```nginx
# In the server block
autoindex off;  # default, but explicit
```
ℹ️ Static files are served by nginx. Directory listing is off by default.

### 3.4 No .env in git

```bash
# Verify:
grep "\.env" /home/ubuntu/jarvis-os/.gitignore
```
✅ `.env` is in `.gitignore`. Verify it was never committed:
```bash
git log --all --full-history -- .env   # should return nothing
```

---

## 4. NETWORK HARDENING

### 4.1 Firewall (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp    # http → redirected to https
sudo ufw allow 443/tcp   # https
sudo ufw enable
```
⬜ Port 5050 must NOT be in the allowed list — only nginx should reach it.
Verify: `ufw status` should NOT show 5050.

### 4.2 SSH hardening

```bash
# /etc/ssh/sshd_config
PasswordAuthentication no
PermitRootLogin no
AllowUsers ubuntu
```
⬜ Disable password auth after deploying your SSH key.

### 4.3 Rate limiting at nginx level

```nginx
# In http {} block of nginx.conf
limit_req_zone $binary_remote_addr zone=jarvis_api:10m rate=30r/m;

# In location / block
limit_req zone=jarvis_api burst=10 nodelay;
limit_req_status 429;
```
⬜ The Node.js backend has per-route rate limiting (rateLimiter middleware) but nginx
rate limiting provides a first line of defense before requests reach Node.js.

---

## 5. MONITORING AND ALERTS

### 5.1 PM2 monitoring

```bash
pm2 monit              # live dashboard
pm2 logs jarvis-os     # tail logs
pm2 info jarvis-os     # current status, restart count
```
✅ Built-in — no setup required.

### 5.2 Disk space alert

```bash
# Add to crontab: crontab -e
0 * * * * df -h / | awk 'NR==2 {if ($5+0 > 80) print "DISK " $5 " USED on " $1}' | grep -q DISK && echo "DISK ALERT" | mail -s "VPS disk >80%" you@email.com
```
⬜ Optional — disk fill is a high-severity risk per VPS_RESOURCE_RISK_REPORT.md.

### 5.3 Health check cron

```bash
# Add to crontab: crontab -e
*/5 * * * * curl -sf http://localhost:5050/health > /dev/null || pm2 restart jarvis-os
```
⬜ Optional belt-and-suspenders. PM2 `autorestart` already handles crashes, but this
catches cases where the process is alive but the HTTP server is not responding.

---

## 6. DEPLOYMENT CHECKLIST (FIRST DEPLOY)

Run these in order on a fresh VPS:

```bash
# 1. Install dependencies
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx

# 2. Clone repo
git clone https://github.com/your/jarvis-os.git /home/ubuntu/jarvis-os
cd /home/ubuntu/jarvis-os && npm install --production

# 3. Configure environment
cp .env.example .env
nano .env  # set JWT_SECRET, OPERATOR_PASSWORD_HASH, WA_TOKEN, etc.
chmod 600 .env

# 4. Start with PM2
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 startup && sudo <generated command>
pm2 save

# 5. Install PM2 log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# 6. Configure nginx + HTTPS
sudo cp /home/ubuntu/jarvis-os/infra/nginx.conf /etc/nginx/sites-available/jarvis
sudo ln -s /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com
sudo systemctl restart nginx

# 7. Set firewall
sudo ufw allow ssh && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable

# 8. Set up log rotation cron
echo "0 2 * * 0 /home/ubuntu/jarvis-os/scripts/rotate-logs.sh >> /home/ubuntu/jarvis-os/data/logs/rotation.log 2>&1" | crontab -

# 9. Verify
curl https://yourdomain.com/health
```

---

## 7. CHECKLIST SUMMARY

| Item | Status | Priority |
|------|--------|----------|
| max_memory_restart 512M | ✅ Done | — |
| max_restarts 10 | ✅ Done | — |
| PM2 startup + save | ⬜ Run on VPS | P0 |
| PM2 log rotation | ⬜ Run on VPS | P1 |
| Nginx SSE config (proxy_buffering off) | ⬜ Configure | P0 |
| HTTPS / Let's Encrypt | ⬜ Configure | P0 |
| Security headers (HSTS, X-Frame) | ⬜ In nginx config | P1 |
| .env chmod 600 | ⬜ Run on VPS | P0 |
| data/ chmod 750 | ⬜ Run on VPS | P1 |
| Firewall (ufw, port 5050 closed) | ⬜ Configure | P0 |
| SSH hardening (no password) | ⬜ Configure | P1 |
| Log rotation cron | ⬜ Run on VPS | P1 |
| Nginx rate limiting | ⬜ Optional | P2 |
| Disk alert cron | ⬜ Optional | P2 |
| Health check cron | ⬜ Optional | P2 |
