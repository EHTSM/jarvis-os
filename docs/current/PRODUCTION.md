# JARVIS MVP — Production Readiness Checklist

Run this checklist before going live with real customers.

---

## Environment

- [ ] `BASE_URL` set to your HTTPS domain (not localhost)
- [ ] `GROQ_API_KEY` valid and tested
- [ ] `NODE_ENV=production` set
- [ ] `.env` is NOT committed to git (check `.gitignore`)
- [ ] All optional services confirmed enabled or disabled intentionally:
  - [ ] WhatsApp: `WHATSAPP_TOKEN` + `PHONE_NUMBER_ID`
  - [ ] Payments: `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`
  - [ ] Telegram: `TELEGRAM_TOKEN`

---

## Smoke test

```bash
node tests/smoke/mvp-smoke.cjs --base=https://your-domain.com
```

Expected: **Pass: 15  Fail: 0  Skip: 0**

---

## Security

- [ ] No `rm`, `sudo`, `kill` commands possible via `/jarvis` chat
- [ ] WhatsApp webhook verify token is a random secret (not "jarvis_verify")
- [ ] Razorpay webhook secret is set and non-empty
- [ ] Rate limiting active on `/jarvis` (60 req/min per IP)
- [ ] `data/` directory is in `.gitignore` (contains leads, queue, notes)

---

## Data persistence

- [ ] `data/` directory exists and is writable
- [ ] `data/task-queue.json` present and valid JSON: `node -e "require('./agents/taskQueue.cjs').getAll()"`
- [ ] `data/leads.json` present (or absent — will be created on first lead)
- [ ] Backup strategy in place for `data/` (cron + rsync or cloud backup)

---

## Process management

- [ ] Server running under PM2: `pm2 status`
- [ ] PM2 startup enabled: `pm2 startup` + `pm2 save`
- [ ] Server restarts automatically after crashes: `pm2 show jarvis | grep restart`

---

## Connectivity verification

```bash
# Health
curl https://your-domain.com/health

# AI
curl -X POST https://your-domain.com/jarvis \
  -H "Content-Type: application/json" \
  -d '{"input":"hello"}'

# WhatsApp status
curl https://your-domain.com/ops | python3 -m json.tool | grep whatsapp

# Task queue
curl https://your-domain.com/tasks | python3 -m json.tool
```

---

## Monitoring

- [ ] Check `/ops` returns `"status": "ok"` (not "degraded")
- [ ] Check `/ops` `warnings` array is empty
- [ ] Memory usage normal: `pm2 monit`
- [ ] No repeated failures in task queue: `GET /tasks?status=failed`

---

## WhatsApp flow test

1. Send "hello" to your WhatsApp business number
2. Confirm JARVIS replies within 5 seconds
3. Send "buy" — confirm payment link is generated and sent back
4. Check lead was saved: `GET /crm`

---

## Payment flow test (Razorpay test mode)

1. Use `rzp_test_` keys for testing
2. Create a link: `POST /payment/link { "amount": 1, "name": "Test" }`
3. Open the link, complete test payment
4. Confirm webhook fires: check server logs for `payment.captured`

---

## Telegram flow test

1. Start your bot in Telegram: `/start`
2. Follow the registration flow
3. Confirm lead appears in CRM: `GET /crm`

---

## Known limitations at MVP v1

- Telegram automation (outbound send) requires `chatId` — obtain from bot's `/start` flow
- File create/read commands are sandboxed (no absolute paths outside project)
- Desktop automation (robotjs) requires macOS with screen access permission
- WhatsApp business-initiated messages require approved Meta message templates

---

## Go-live command

```bash
# Final restart with production env
pm2 restart jarvis --env production
pm2 logs jarvis --lines 50

# Confirm startup diagnostics show all services enabled
```

---

## Rollback

```bash
git log --oneline -5
git checkout <previous-commit>
pm2 restart jarvis
```
