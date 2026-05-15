# MVP_READINESS_CHECKLIST.md

**Date:** 2026-05-15

---

## Pre-Launch Checklist

### Infrastructure

- [ ] VPS provisioned (512 MB RAM minimum, Ubuntu 22.04 recommended)
- [ ] Domain name pointing to server IP (DNS propagated)
- [ ] nginx installed and configured (`deploy/nginx-jarvis.conf`)
- [ ] TLS certificate issued (`certbot --nginx -d yourdomain.com`)
- [ ] PM2 installed globally (`npm i -g pm2`)
- [ ] PM2 startup hook configured (`pm2 startup` + save)
- [ ] Node.js 18 LTS or 20 LTS installed

### Environment

- [ ] `.env` created from `.env.example`
- [ ] `GROQ_API_KEY` set and valid (test: `curl https://api.groq.com/...`)
- [ ] `BASE_URL` set to real HTTPS domain (not localhost)
- [ ] `JWT_SECRET` generated and set (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] `OPERATOR_PASSWORD_HASH` generated (`node scripts/generate-password-hash.cjs <password>`)
- [ ] `PORT=5050` (or custom port opened in firewall)

### Optional Services (enable what you need)

- [ ] Telegram bot token configured (`TELEGRAM_TOKEN`)
- [ ] WhatsApp Business API configured (`WA_TOKEN`, `PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`)
- [ ] Razorpay keys configured (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`)
- [ ] Razorpay webhook URL registered in Razorpay dashboard: `https://yourdomain.com/webhook/razorpay`
- [ ] WhatsApp webhook URL registered in Meta developer console

### Deployment

- [ ] `bash deploy.sh` ran successfully
- [ ] `/health` endpoint returns `200 ok`
- [ ] Frontend loads in browser (no console errors)
- [ ] Runtime tab shows login form
- [ ] Login with operator password succeeds
- [ ] Runtime tab loads OperatorConsole after login

### Smoke Tests

- [ ] `node --test tests/smoke/persistence-recovery.test.cjs` — all pass
- [ ] Send a test message via Chat tab — AI responds
- [ ] Post a task via WorkflowPanel → appears in TaskQueue
- [ ] Emergency stop works, resume works
- [ ] `/health` accessible from external URL
- [ ] PM2 auto-restarts after: `pm2 stop jarvis-os && pm2 start jarvis-os`

### Data

- [ ] `data/` directory exists and is writable
- [ ] `data/task-queue.json` present (auto-created on first task)
- [ ] `data/workflow-checkpoints/` cleared if it exists (see MEMORY_RISK_REPORT.md)
- [ ] Log rotation working (`ls -lh logs/`)

### Security

- [ ] `.env` not committed to git (check: `git status .env`)
- [ ] Operator password is at least 12 characters
- [ ] nginx serves only port 80/443; port 5050 not publicly accessible
- [ ] `NODE_ENV=production` set in ecosystem.config.cjs (already done)

---

## Post-Launch Monitoring (first 48 hours)

- [ ] Set up UptimeRobot alert for `https://yourdomain.com/health`
- [ ] Check `pm2 logs jarvis-os` after 24h for errors
- [ ] Check `ls -lh data/` for unexpected growth
- [ ] Verify `pm2 save` was called (persists restart policy after server reboot)
