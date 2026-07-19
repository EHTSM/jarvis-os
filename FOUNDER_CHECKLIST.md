# Founder Checklist — Before You Launch Ooplix

Everything on this page must be true before you point real customers at a production Ooplix instance. Items are grouped in the order you'll actually do them. Nothing here is optional unless marked `[OPTIONAL]`.

This checklist assumes the single-server VPS deployment (nginx + PM2 + Node backend serving the built React frontend). If you're shipping the Electron desktop app instead, see [PRODUCTION_DEPLOYMENT_GUIDE.md](PRODUCTION_DEPLOYMENT_GUIDE.md) for the additional desktop-specific steps.

---

## 1. Domain & Server

- [ ] Domain purchased and DNS **A record** points at your VPS's public IP
- [ ] VPS provisioned — Ubuntu 22.04 or 24.04, minimum 2GB RAM (`deploy/setup-vps.sh` targets this)
- [ ] SSH access confirmed as root or a sudo user
- [ ] Ran `sudo bash deploy/setup-vps.sh` — installs Node 20, PM2, nginx, ufw, certbot
- [ ] Ran `sudo certbot --nginx -d yourdomain.com` — issues the HTTPS certificate
- [ ] `/etc/nginx/sites-available/jarvis` edited to your real domain (setup-vps.sh installs it with a placeholder)
- [ ] `nginx -t` passes and `systemctl reload nginx` succeeded

## 2. Environment File (`.env`)

Copy `.env.production.example` (minimal) or `.env.example` (full connector surface) to `.env` on the server. **Never commit `.env` to git.**

**Hard requirements — the server will not start or will silently break without these:**

- [ ] `NODE_ENV=production`
- [ ] `PORT=5050` (or your chosen port — must match nginx's `proxy_pass`)
- [ ] `BASE_URL=https://yourdomain.com` — must be your real HTTPS domain, not `localhost`. Razorpay webhooks call this URL; without it, **payments never confirm**.
- [ ] `ALLOWED_ORIGINS=https://yourdomain.com` — comma-separated, no trailing slash
- [ ] `GROQ_API_KEY` — required for `/jarvis` and `/ai/chat`. Get one free at [console.groq.com](https://console.groq.com).
- [ ] `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` — **without both, the operator console returns 503 on every request.** Generate both in one command:
  ```bash
  node scripts/generate-password-hash.cjs <your-chosen-password>
  ```
  Paste the two printed lines into `.env`.

**Strongly recommended before accepting real payments or messages:**

- [ ] `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — Razorpay Dashboard → Settings → API Keys
- [ ] `RAZORPAY_WEBHOOK_SECRET` — without this, **all payment webhooks are rejected** and payments silently never confirm. See [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md#razorpay).
- [ ] `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` / `WA_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` — if you're using WhatsApp automation
- [ ] `TELEGRAM_TOKEN` — if you're using the Telegram bot
- [ ] `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — required for email verification and password reset to work at all

**Run the built-in checker before starting:**
```bash
node scripts/check-startup-env.cjs
```
This validates required vars are set and warns on missing optional ones — same check `npm start` runs automatically.

## 3. Secrets Hygiene

- [ ] `.env` file permissions restricted: `chmod 600 .env`
- [ ] `JWT_SECRET` is a real random 32-byte value, not a placeholder (the generator script above handles this)
- [ ] `OPERATOR_PASSWORD_HASH` is not left blank or copied from `.env.example`
- [ ] All API keys are **live/production** keys, not test/sandbox keys (double-check Razorpay: `rzp_live_` not `rzp_test_`)
- [ ] `.env` is in `.gitignore` and was never committed (`git log --all -- .env` should return nothing)

## 4. First Boot

- [ ] Ran `bash deploy/start-production.sh` — this runs pre-flight checks, builds the frontend, and starts PM2
- [ ] Script reports `Server ready` within 40 seconds
- [ ] `curl https://yourdomain.com/health` returns `{"status":"ok", ...}`
- [ ] Logged into the operator console at `https://yourdomain.com` with the password you hashed in step 2
- [ ] `pm2 save` was run so the process survives a VPS reboot
- [ ] `pm2 startup systemd` was configured (done automatically by `setup-vps.sh`, step 12) — verify with `pm2 startup` showing it's already registered

## 5. Connectors You Actually Plan to Use

Only fill in what you need — every connector is optional except AI (Groq) and Auth (JWT/password hash). See [CONNECTOR_SETUP_GUIDE.md](CONNECTOR_SETUP_GUIDE.md) for exact steps per connector including every redirect URI and webhook URL.

- [ ] WhatsApp Business API configured and webhook verified in Meta Developer Console
- [ ] Telegram bot created via BotFather and token set
- [ ] Razorpay live keys set, webhook configured and firing (test with a ₹1 payment)
- [ ] Any OAuth connectors you need (Google, GitHub, Slack, Notion, Microsoft, LinkedIn) — client ID/secret set, redirect URI registered exactly as Ooplix expects
- [ ] Email (Resend) sending confirmed — send yourself a password reset to check

## 6. Monitoring & Recovery

- [ ] Cron healthcheck installed (auto-restarts on crash):
  ```bash
  crontab -e
  */5 * * * * /opt/jarvis-os/deploy/healthcheck.sh >> /opt/jarvis-os/logs/healthcheck.log 2>&1
  ```
- [ ] Ran `bash deploy/monitor.sh` once and confirmed all sections report healthy
- [ ] `TELEGRAM_OPERATOR_CHAT_ID` set — receive crash alerts on your phone. Get your chat ID from [@userinfobot](https://t.me/userinfobot).
- [ ] Confirmed a backup exists: `npm run backup`, then check `backups/jarvis_*.tar.gz` is present
- [ ] Read [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) once, end to end, before you need it

## 7. Legal / Business

- [ ] `PRODUCT_PRICE` in `.env` matches what you actually charge
- [ ] Razorpay account is fully KYC-verified (live payments fail silently otherwise)
- [ ] Privacy policy / terms live at a real URL if your OAuth apps (Google, Microsoft, etc.) require one for verification
- [ ] Support contact (email or Telegram) decided and reachable — you'll need it in [SUPPORT_RUNBOOK.md](SUPPORT_RUNBOOK.md)

## 8. Final Go/No-Go

- [ ] `bash deploy/validate-production.sh` run and passing (full pre-launch validation script)
- [ ] `bash deploy/monitor.sh` shows PM2 online, health OK, no error spam in logs
- [ ] You have personally completed one full customer journey against production: [CUSTOMER_ONBOARDING.md](CUSTOMER_ONBOARDING.md)
- [ ] You know how to roll back (`bash deploy/rollback.sh --list`) before you need to

**When every box above is checked, you are ready to launch.**
