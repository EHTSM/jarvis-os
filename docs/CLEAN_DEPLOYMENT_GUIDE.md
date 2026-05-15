# CLEAN_DEPLOYMENT_GUIDE.md

**Date:** 2026-05-15  
**Target:** Single-VPS production deploy (512 MB RAM minimum, 1 GB recommended)

---

## Prerequisites

```bash
node --version   # 18 LTS minimum, 20 LTS recommended
npm --version    # 9+
pm2 --version    # 5.x — install: npm i -g pm2
nginx -v         # 1.18+ for reverse proxy + TLS
```

---

## Step 1: Clone and Install

```bash
git clone <repo-url> /opt/jarvis-os
cd /opt/jarvis-os
npm ci --omit=dev
npm ci --prefix frontend
```

---

## Step 2: Environment

```bash
cp .env.example .env
nano .env
```

Minimum required:
```env
GROQ_API_KEY=<your-groq-key>
JWT_SECRET=<64-char-random-string>
COOKIE_SECRET=<64-char-random-string>
PORT=5050
NODE_ENV=production
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 3: Build Frontend

```bash
cd /opt/jarvis-os
npm run build:frontend
# Output: frontend/build/
```

---

## Step 4: Create Data Directories

```bash
mkdir -p /opt/jarvis-os/data/logs
# Files are created automatically by the server on first run
```

---

## Step 5: Start with PM2

```bash
cd /opt/jarvis-os
pm2 start backend/server.js \
  --name jarvis-os \
  --env-file .env \
  --max-memory-restart 400M

# Persist across reboots
pm2 save
pm2 startup   # run the printed command as root/sudo

# Verify
pm2 status
pm2 logs jarvis-os --lines 50
```

---

## Step 6: nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Static frontend
    root /opt/jarvis-os/frontend/build;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:5050/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE — must disable buffering
    location /runtime/stream {
        proxy_pass http://127.0.0.1:5050/runtime/stream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
    }
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d yourdomain.com
```

---

## Step 7: Smoke Test

```bash
# Server health (no auth)
curl https://yourdomain.com/api/health
# Expected: {"status":"ok",...}

# Login
curl -c cookies.txt -X POST https://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<your-password>"}'
# Expected: {"success":true}

# Runtime health (with auth)
curl -b cookies.txt https://yourdomain.com/api/runtime/health/deep
# Expected: {"status":"ok","agents":5,...}

# Dispatch a task
curl -b cookies.txt -X POST https://yourdomain.com/api/runtime/dispatch \
  -H "Content-Type: application/json" \
  -d '{"input":"run: echo hello world"}'
# Expected: {"success":true,"results":[{"success":true,...}]}
```

---

## Ongoing Operations

```bash
# View logs
pm2 logs jarvis-os --lines 200

# Restart (zero-downtime reload)
pm2 reload jarvis-os

# Update deployment
git pull && npm ci --omit=dev && npm run build:frontend && pm2 reload jarvis-os

# Check execution log size
ls -lh data/logs/

# Monitor resources
pm2 monit
```

---

## PM2 Log Rotation (Recommended)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## Security Checklist

- [ ] `JWT_SECRET` is ≥32 random bytes, not committed to git
- [ ] `COOKIE_SECRET` is ≥32 random bytes, not committed to git
- [ ] `NODE_ENV=production` is set (enables secure cookies)
- [ ] nginx serves HTTPS only (HTTP redirects to HTTPS)
- [ ] Port 5050 is NOT exposed publicly (nginx only)
- [ ] `.env` file is not world-readable: `chmod 600 .env`
- [ ] Dead code directories removed (see SAFE_TO_DELETE.md)

---

## Rollback

```bash
# Revert to last working git state
git stash  # or git reset --hard <commit>
pm2 reload jarvis-os
```

See [ROLLBACK_PROCEDURE.md](ROLLBACK_PROCEDURE.md) for full rollback steps.
