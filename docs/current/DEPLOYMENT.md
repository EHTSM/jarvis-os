# JARVIS OS — Deployment Guide

## Prerequisites

- Node.js 18+ (20+ recommended)
- A Linux VPS or any platform that supports Node.js (Railway, Render, DigitalOcean, etc.)
- A domain with HTTPS (required for WhatsApp webhooks and Razorpay callbacks)

---

## 1. Clone and install

```bash
git clone <your-repo-url> jarvis-os
cd jarvis-os
npm install
```

---

## 2. Configure environment

```bash
cp .env.example .env
nano .env        # fill in every value (see notes below)
```

### Required for core functionality

| Variable | Where to get it | Why |
|---|---|---|
| `GROQ_API_KEY` | console.groq.com → API Keys | Powers the AI brain |
| `BASE_URL` | Your domain e.g. `https://jarvis.yourdomain.com` | Razorpay callback URL |

### Required for WhatsApp automation

| Variable | Where to get it |
|---|---|
| `WHATSAPP_TOKEN` | Meta Developer Console → Your App → WhatsApp → API Setup |
| `PHONE_NUMBER_ID` | Same page as above |
| `WA_VERIFY_TOKEN` | Any random string — must match what you enter in Meta webhook config |

### Required for payments

| Variable | Where to get it |
|---|---|
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Same page |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Settings → Webhooks → your webhook → Secret |

### Required for Telegram bot

| Variable | Where to get it |
|---|---|
| `TELEGRAM_TOKEN` | Telegram → @BotFather → /newbot |

---

## 3. Build frontend

```bash
npm run build:frontend
# or:
cd frontend && npm install && npm run build && cd ..
```

The backend serves the built frontend from `frontend/build/`.

---

## 4. Start server

```bash
# Direct start
node backend/server.js

# With PM2 (recommended for production)
npm install -g pm2
pm2 start backend/server.js --name jarvis --env production
pm2 save
pm2 startup   # enable auto-restart on server reboot
```

Default port: `5050`. Set `PORT=` in `.env` to change.

---

## 5. Configure nginx (HTTPS reverse proxy)

```nginx
server {
    listen 443 ssl;
    server_name jarvis.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/jarvis.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jarvis.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name jarvis.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Get SSL certificate: `certbot --nginx -d jarvis.yourdomain.com`

---

## 6. Configure WhatsApp webhook

In Meta Developer Console:
1. Go to **WhatsApp → Configuration → Webhooks**
2. Callback URL: `https://jarvis.yourdomain.com/whatsapp/webhook`
3. Verify token: matches your `WA_VERIFY_TOKEN` in `.env`
4. Subscribe to: `messages`

---

## 7. Configure Razorpay webhook

In Razorpay Dashboard:
1. Settings → Webhooks → Add new webhook
2. URL: `https://jarvis.yourdomain.com/webhook/razorpay`
3. Secret: matches your `RAZORPAY_WEBHOOK_SECRET` in `.env`
4. Events: `payment.captured`

---

## 8. Verify deployment

```bash
# From any machine:
curl https://jarvis.yourdomain.com/health

# Expected response:
# { "success": true, "status": "ok", "services": { "ai": true, ... } }
```

---

## Troubleshooting

| Problem | Check |
|---|---|
| Server won't start | `node --check backend/server.js` — syntax error in .env? |
| WhatsApp webhook fails | Token mismatch? `WA_VERIFY_TOKEN` in .env = what Meta has |
| Payments return error | `RAZORPAY_KEY_ID` starts with `rzp_live_`? (not `rzp_test_`) |
| AI not responding | `GROQ_API_KEY` valid? Test: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"` |
| Telegram bot not starting | Token valid? Only ONE instance of bot can poll at a time |

---

## Deploy to Railway (zero-config)

1. Push to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Add env vars in Railway dashboard (copy from `.env`)
4. Railway auto-builds and deploys on every push

Railway sets `PORT` automatically — JARVIS reads it.

---

## Deploy to Render

1. Push to GitHub
2. render.com → New Web Service → Connect repo
3. Build command: `npm install && npm run build:frontend`
4. Start command: `node backend/server.js`
5. Add env vars in Render dashboard

---

## Logs

```bash
# PM2
pm2 logs jarvis

# Enable verbose pipeline logs
DEBUG_PIPELINE=true pm2 restart jarvis
```
