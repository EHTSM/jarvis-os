# Daily Review Workflow — Beta Operations

**Owner:** Ehtesham  
**Time required:** 10–15 minutes/day  
**Tools:** pm2, server logs, Play Console, Razorpay Dashboard, WhatsApp

---

## Morning Check (5 min) — run every day

```bash
# 1. Server health
curl -s https://app.ooplix.com/health | python3 -m json.tool

# 2. PM2 status — check for restarts
pm2 status
# Expected: online, restart count = 0

# 3. Error log scan
pm2 logs jarvis-os --lines 50 --nostream | grep -i "ERROR\|FATAL\|crash" | wc -l
# Expected: 0

# 4. Memory check
pm2 show jarvis-os | grep "memory usage"
# Expected: < 300MB
```

If any check fails → go to BUG_REPORTING_WORKFLOW.md.

---

## Weekly Rhythm (15 min/week)

| Day | Check | Action |
|-----|-------|--------|
| Monday | Triage new bug reports | Move P0s to immediate, P1s to this week |
| Tuesday | Review Play Console Android Vitals | Check crash rate < 1% |
| Wednesday | WhatsApp group check-in | "Anything new broken?" |
| Thursday | Review Razorpay webhook log | All deliveries should be 200 |
| Friday | Deploy any pending fixes | Announce in WhatsApp group |
| Sunday | Individual DM to each tester who filed a report | "Fixed — please retry" |

---

## Key Metrics to Track Daily (Beta Phase)

Paste into a Google Sheet each day:

| Date | Active users | AI chats | Login errors | P0 bugs | Server uptime | Notes |
|------|-------------|---------|-------------|---------|--------------|-------|

---

## Quick Commands Reference

```bash
# Server health
curl https://app.ooplix.com/health

# Live logs
pm2 logs jarvis-os

# Restart server (after .env change)
pm2 reload jarvis-os

# Check billing status for a user
curl https://app.ooplix.com/billing/status \
  -H "Cookie: jarvis_auth=<token>"

# Force-activate a plan (if webhook missed)
curl -X POST https://app.ooplix.com/billing/activate \
  -H "Content-Type: application/json" \
  -H "Cookie: jarvis_auth=<operator-token>" \
  -d '{"accountId":"<id>","plan":"starter","razorpaySubId":"<sub_id>"}'

# Check recent auth events
curl https://app.ooplix.com/auth/me \
  -H "Cookie: jarvis_auth=<token>"

# Readiness score
curl -X POST https://app.ooplix.com/p21/readiness/check \
  -H "Cookie: jarvis_auth=<operator-token>"
```

---

## Escalation Thresholds

| Signal | Action |
|--------|--------|
| PM2 restart count > 3 in 24h | Investigate logs, fix root cause |
| Memory > 400MB | Check for memory leak, restart |
| Webhook delivery failures > 0 | Check RAZORPAY_WEBHOOK_SECRET, retest |
| > 2 P0 bugs open at same time | Pause new user invites until resolved |
| Server unreachable for > 5 min | SSH to VPS and check nginx + pm2 |
| Play Console crash rate > 1% | Stop rollout, diagnose, hotfix |

---

## End-of-Day Summary (optional, 2 min)

Before bed, note in a simple text file or Notion:

```
Date: ____
Active users: __
New bug reports: __
Fixes deployed: __
Notable feedback: ____
Tomorrow priority: ____
```

This becomes the launch story to tell future users/investors.
