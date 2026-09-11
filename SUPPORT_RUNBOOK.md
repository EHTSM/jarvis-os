# Support Runbook — Operating Ooplix in Production

How to run day-to-day support once real customers are using Ooplix. For deep incident diagnosis (crashes, memory exhaustion, webhook failures), the existing [docs/current/INCIDENT_RESPONSE.md](docs/current/INCIDENT_RESPONSE.md) has tested symptom → diagnosis → fix procedures — this runbook covers the operational rhythm around it.

---

## Daily checks (5 minutes)

```bash
bash deploy/monitor.sh
```
Confirms in one pass: PM2 process status, `/health` response, memory, CRM pipeline state, connector health. Run this first thing.

```bash
bash deploy/monitor.sh --errors
```
Last 50 lines of error logs — skim for anything new since yesterday.

If you set `TELEGRAM_OPERATOR_CHAT_ID`, crash alerts and EOD summaries land in your Telegram automatically — check that channel is quiet, not just that you remembered to run the script.

## Where to look for what

| Question | Where |
|---|---|
| Is the server up? | `curl https://yourdomain.com/health` or `pm2 status` |
| Is a specific customer's account OK? | `GET /accounts/me` (as them) or check `data/` account store directly |
| Did a payment go through? | Razorpay Dashboard → Payments, cross-check CRM lead `status: "paid"` |
| Did a WhatsApp message get processed? | `pm2 logs jarvis-os \| grep -i whatsapp` |
| What's using memory/CPU? | `pm2 monit` (live) or `bash deploy/monitor.sh` |
| Recent errors | `pm2 logs jarvis-os --lines 50 --nostream --err` |
| Recent auth events (logins, registrations) | `auditLog` — check `data/` for the audit log file, or `pm2 logs \| grep -i auth` |
| Live runtime activity (tasks, agents) | `GET /runtime/stream` (SSE, requires auth cookie) or the operator console's live view |
| Dead/failed background tasks | `GET /runtime/dead-letter` |

## Common support requests and how to handle them

### "I never got my verification email"
1. Confirm `RESEND_API_KEY` is set and valid — a misconfigured key fails silently server-side (registration doesn't error, the email just never sends)
2. Check Resend's own dashboard for delivery/bounce status
3. If genuinely stuck, verify the account manually: check `accountService`'s data store for the account and flip its verified flag, or have them re-register once you've fixed the underlying config

### "I forgot my password and the reset email never arrived"
Same root cause as above — verify Resend is working (`RESEND_API_KEY`, verified sending domain). Test by sending yourself a reset first.

### "My payment went through but I don't have access"
1. Check Razorpay Dashboard confirms `payment.captured` actually fired
2. Check `RAZORPAY_WEBHOOK_SECRET` is set correctly — if wrong, the webhook is rejected with an HMAC mismatch and **the payment is real but Ooplix never heard about it**
3. `pm2 logs jarvis-os | grep -i razorpay` — look for "signature mismatch" specifically
4. If the webhook secret was the issue: fix it, then manually mark the CRM lead as paid for this customer while you wait for the fix to take effect on future payments

### "I hit my invite/beta cap and can't register"
This is enforced deliberately (`BETA_MAX_USERS`, default 50). To let more users in: raise `BETA_MAX_USERS` in `.env` and restart, or work through your existing invite pool (revoke unused invites via `POST /cbeta/invites/:code/revoke` and issue new ones).

### "WhatsApp isn't responding to me"
1. `curl "https://yourdomain.com/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"` — should echo back `test123`. If not, the webhook itself is broken (check nginx routing, `WA_VERIFY_TOKEN` match).
2. If verification passes but messages aren't processed: check `WHATSAPP_APP_SECRET` is set correctly — a mismatch causes every incoming webhook to be silently rejected in production (HMAC check fails closed).
3. `DISABLE_WHATSAPP=true` set by mistake? Check `.env`.

### "The app feels slow / is timing out"
1. `pm2 monit` — check CPU and memory in real time
2. `GET /ops?debug=1` (operator auth) — surfaces queue health, stuck tasks, memory trend
3. If memory is climbing steadily: see IR-6 in [INCIDENT_RESPONSE.md](docs/current/INCIDENT_RESPONSE.md) — usually a quick `pm2 restart jarvis-os` gives immediate relief while you find the root cause

### "Something crashed / the whole app is down"
Go straight to [INCIDENT_RESPONSE.md — IR-1](docs/current/INCIDENT_RESPONSE.md). First action is always:
```bash
pm2 logs jarvis-os --lines 100 --err
```

## Escalation path

Since this is a solo-founder-operated product, "escalation" means: know when to stop debugging live and roll back instead of digging deeper under pressure.

**Roll back immediately, investigate after, if:**
- The last deploy is less than 24 hours old and the symptom started right after it
- Customer-facing payment or auth is broken
- You can't identify the cause within ~10 minutes of looking

```bash
bash deploy/rollback.sh --code HEAD~1
```
See [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) for the full rollback decision tree.

**Keep debugging live if:**
- It's a single customer's isolated issue (not systemic)
- The server is otherwise healthy
- You have a specific, testable hypothesis

## Customer communication templates

Keep these ready — real founders lose time drafting the same message twice under stress.

**Planned maintenance:**
> Ooplix will be briefly unavailable for maintenance at [TIME]. Expected downtime: under 2 minutes. No action needed on your end.

**Incident acknowledgment:**
> We're aware of an issue affecting [feature] and are actively working on it. Updates here: [status channel]. Your data is safe.

**Post-incident resolution:**
> The issue affecting [feature] is resolved as of [TIME]. Root cause: [one sentence]. If you're still seeing problems, reply here directly.

## Support contact channel

Decide this before launch, put it in your footer/settings page, and check it daily:
- Dedicated support email, or
- A Telegram channel/bot (you already have `TELEGRAM_TOKEN` wired for automation — reuse it), or
- A shared inbox if you bring on help later

Whatever you choose, [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md) has this as a launch-blocking item — don't skip deciding it.
