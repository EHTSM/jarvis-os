# Deployment Guide

Deploy Ooplix to a production VPS (Ubuntu 22.04 / 24.04).

## Overview

| Component | Role |
|---|---|
| PM2 | Process management, auto-restart, daily backup cron |
| Nginx | Reverse proxy, SSL termination, rate limiting, static files |
| Certbot | Let's Encrypt SSL certificate, auto-renewal |
| UFW | Firewall — only ports 22, 80, 443 open |

## First-Time VPS Setup

On a fresh Ubuntu 22.04 VPS, as root:

```bash
git clone https://github.com/EHTSM/jarvis-os.git /opt/jarvis-os
cd /opt/jarvis-os

# Installs: Node 20, PM2, nginx, certbot, UFW, creates jarvis user
bash deploy.sh --setup
```

## Configure Environment

```bash
nano /opt/jarvis-os/.env
```

Required fields:

```env
NODE_ENV=production
PORT=5050
BASE_URL=https://app.yourdomain.com
ALLOWED_ORIGINS=https://app.yourdomain.com,https://yourdomain.com

JWT_SECRET=<32+ random bytes>
OPERATOR_PASSWORD_HASH=<hash from generate-password-hash.cjs>

GROQ_API_KEY=gsk_...
```

Generate credentials:

```bash
node /opt/jarvis-os/scripts/generate-password-hash.cjs yourpassword
```

## Configure SSL

Point your domain's DNS A record to the VPS IP, then:

```bash
sudo bash /opt/jarvis-os/deploy/https-setup.sh app.yourdomain.com
```

This:
1. Verifies DNS resolves to this server
2. Patches nginx config with your domain
3. Runs `certbot --nginx` to obtain the certificate
4. Enables auto-renewal via `certbot.timer`
5. Updates `BASE_URL` in `.env`

## Deploy

```bash
cd /opt/jarvis-os
bash deploy.sh
```

This builds the frontend and starts/reloads PM2.

## Validate

```bash
bash deploy/validate-production.sh
```

30 automated checks across env, PM2, nginx, SSL, routes, backups, monitoring, and security.

## Updates (zero-downtime)

```bash
cd /opt/jarvis-os
bash deploy/update.sh
```

Pulls latest code, reinstalls deps, rebuilds frontend, PM2 graceful reload.

## Rollback

```bash
# List available backups
bash deploy/rollback.sh --list

# Restore latest data backup
bash deploy/rollback.sh

# Rollback code to a previous commit
bash deploy/rollback.sh --code HEAD~1
```

## Monitoring

```bash
bash deploy/monitor.sh          # full snapshot
bash deploy/monitor.sh --live   # auto-refresh every 10s
bash deploy/monitor.sh --errors # error log only
pm2 logs jarvis-os              # live PM2 logs
```

## Cron (healthcheck auto-restart)

Add to crontab (`crontab -e` as the `jarvis` user):

```
*/5 * * * * /opt/jarvis-os/deploy/healthcheck.sh >> /opt/jarvis-os/logs/healthcheck.log 2>&1
```

## Directory Layout on VPS

```
/opt/jarvis-os/
  backend/            Express server
  frontend/build/     React production build (nginx serves this)
  data/               JSON persistence (back up this directory)
  logs/               PM2 out/err logs
  backups/            Automated daily backups
  .env                Production environment (chmod 600)
  deploy/             Deployment scripts
  ecosystem.config.cjs  PM2 configuration
  nginx.conf          Nginx site config
```

## Environment Variables Reference

See [CONFIGURATION.md](CONFIGURATION.md) for the full list with descriptions.
