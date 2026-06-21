# Ooplix — Support Handbook

## Support Principles

1. **Respond within 24 hours** for standard inquiries; within 4 hours for P1 issues.
2. **Reproduce before escalating** — always try to reproduce the issue before involving engineering.
3. **Security issues go directly to engineering** — never troubleshoot in public channels.
4. **When in doubt, escalate** — it's better to over-communicate than to let a user go dark.

---

## Channels & Tiers

| Tier  | Channel            | SLA          | Handled by      |
|-------|--------------------|--------------|-----------------|
| P1    | Direct email/phone | 4 hours      | Founder + Eng   |
| P2    | Email              | 24 hours     | Support         |
| P3    | In-app feedback    | 48–72 hours  | Support         |
| P4    | Community/FAQ      | Best effort  | Community       |

**Support email**: support@ooplix.com  
**Security email**: security@ooplix.com (see SECURITY.md)

---

## Issue Classification

### P1 — Critical (service down or data loss)
- Server not responding
- User cannot log in to a paying account
- Data appears lost or corrupted
- Payment charged but subscription not activated
- Security breach or suspected unauthorized access

### P2 — High (core feature broken)
- AI assistant not responding
- WhatsApp/Telegram integration not sending
- Mission creation/execution failing
- Billing page errors

### P3 — Medium (feature degraded or UX issue)
- Analytics not loading
- Slow response times
- Feature working but with errors
- Onboarding flow incomplete

### P4 — Low (cosmetic or enhancement)
- UI alignment issues
- Missing translations
- Feature requests
- Documentation gaps

---

## Common Issues & Resolutions

### "Cannot log in" / auth errors

1. Ask user to clear browser cookies and retry.
2. Check `data/local-accounts.json` to confirm account exists.
3. Check `logs/pm2-err.log` for JWT errors.
4. If Firebase Auth is in use: check Firebase console → Authentication → Users.
5. If server is returning 500: `pm2 logs jarvis-os --lines 50 --err`

### "AI not responding" / AI errors

1. Check GROQ_API_KEY is set in `.env`.
2. Test key: `curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models`
3. Check credit balance at `console.groq.com`.
4. Fallback: set `LLM_PROVIDER=openai` and configure `OPENAI_API_KEY`.

### "WhatsApp not sending"

1. Verify `WHATSAPP_TOKEN` and `PHONE_NUMBER_ID` in `.env`.
2. Confirm Meta App is in Live mode (not Development mode).
3. Check webhook URL is set to `https://yourdomain.com/webhook/whatsapp`.
4. View Meta webhook delivery logs in Meta Developer Console.

### "Payment failed" / billing issues

1. Check Razorpay dashboard for payment status.
2. Verify `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
3. Confirm webhook secret matches: `RAZORPAY_WEBHOOK_SECRET`.
4. Check `data/billing.json` for account billing record.
5. Manual plan activation: `POST /billing/admin/override` (admin only).

### "Server not responding" / 502/503 from nginx

1. Check PM2: `pm2 list`
2. If process is stopped: `pm2 start ecosystem.config.cjs`
3. If process is crashing: `pm2 logs jarvis-os --lines 100 --err`
4. Check nginx: `sudo systemctl status nginx`
5. Check disk space: `df -h` (full disk causes crashes)
6. Check port: `ss -tlnp | grep 5050`

### "Subscription plan not updated"

1. Check Razorpay payment status.
2. Manually check webhook delivery in Razorpay dashboard.
3. If webhook missed: manually trigger `POST /payment/webhook/test`.
4. If still stuck: update `data/billing.json` directly and restart.

---

## Escalation Runbook

### Step 1: Gather information
- User email / account ID
- Time issue started
- Browser/OS/app version
- Error message (exact text or screenshot)
- Steps to reproduce

### Step 2: Reproduce
- Attempt to reproduce in staging/local environment.
- Check recent deployments (last 24h) for potential regressions.
- Check `logs/pm2-err.log` for errors at the time of the issue.

### Step 3: Classify severity (P1–P4)
- P1/P2: Immediately notify engineering via direct message.
- P3/P4: Log in issue tracker, include reproduction steps.

### Step 4: Communicate with user
```
Subject: [Ooplix Support] Re: Your Issue — <short_description>

Hi <Name>,

Thank you for reaching out. I've reviewed your issue and here's what I found:

<what you found>

<next steps or resolution>

Please let me know if this resolves the issue or if you have any questions.

Best,
Ooplix Support
```

### Step 5: Follow up
- P1: Follow up within 1 hour after resolution.
- P2: Follow up within 24 hours after resolution.
- P3/P4: Follow up when fix is deployed.

---

## Refund Policy

- **Trial accounts**: No charge — no refund needed.
- **Within 7 days of first charge**: Full refund, no questions asked.
- **After 7 days**: Pro-rated refund at engineering/founder discretion.
- **Security incidents causing data loss**: Full refund + extended free access.

To issue a refund: Razorpay Dashboard → Payments → find transaction → Refund.

---

## Useful Admin Commands

```bash
# Check server health
curl http://localhost:5050/health

# View last 50 error lines
pm2 logs jarvis-os --lines 50 --nostream --err

# Check disk space
df -h

# Check memory
free -m

# Restart server
pm2 restart jarvis-os

# View all accounts (requires admin auth)
curl -b "jarvis_auth=<token>" http://localhost:5050/accounts

# Run production validation
bash deploy/validate-production.sh
```

---

## Security Issues

**Never** handle security reports in email or chat. Direct reporters to `security@ooplix.com` or the GitHub Security Advisory process in `SECURITY.md`.

If a breach is suspected:
1. Immediately notify the founder.
2. Follow the Incident Response Playbook in `INCIDENT_RESPONSE_PLAYBOOK.md`.
3. Do not discuss publicly until the investigation is complete.
