# Feedback Collection Process — Beta

**Owner:** Ehtesham  
**Channels:** WhatsApp group, direct WhatsApp, email  
**Tracking:** Simple spreadsheet (Google Sheets)

---

## Bug Report Template

Pin this in the WhatsApp group on Day 0:

```
📋 HOW TO REPORT A BUG

Just send me:
1. What you were trying to do
2. What happened instead
3. Screenshot (if possible)
4. Your phone model + Android version

That's it. No form. Just message me directly.
WhatsApp: [your number]
Email: altamashjauhar@gmail.com
```

---

## Feedback Spreadsheet

Create a Google Sheet with these columns:

| Date | Tester | Type | Screen | Description | Severity | Status |
|------|--------|------|--------|-------------|---------|--------|
| 2026-06-05 | Ali | Bug | Login | Google sign-in hangs | P0 | Open |

**Severity:**
- P0 = Crash / payment failure / can't login → fix same day
- P1 = Feature broken → fix this week
- P2 = Minor UX issue → backlog

---

## Weekly Feedback Rhythm

| Day | Action |
|-----|--------|
| Monday | Review all reports from past 7 days. Triage P0 → fix immediately |
| Wednesday | WhatsApp group: "Anything new this week?" |
| Friday | Deploy any bug fixes. Announce in group: "Fixed: [what changed]" |
| Sunday | Individual check-in to any tester who reported a P0 |

---

## Feature Request Rule

Only build features that **3 or more testers** ask for independently.

Track in a separate sheet:

| Feature | Requested by | Count | Decision |
|---------|-------------|-------|---------|
| iOS app | Tester 3, 7 | 2 | Wait |
| Dark mode chat | Tester 1, 4, 8 | 3 | Build next sprint |

---

## Payment Issue Protocol

If any tester reports payment not confirming:

```
Step 1: Reply within 30 minutes: "On it — checking now"
Step 2: Check Razorpay Dashboard → Payments → find transaction
Step 3: Check server logs: pm2 logs | grep "Webhook\|Payment"
Step 4: If webhook missed — manually activate:
         POST /billing/activate
         {"accountId": "<user-id>", "plan": "starter", "razorpaySubId": "<id>"}
Step 5: Confirm with tester. Offer refund if needed via Razorpay Dashboard
```

---

## End of Beta Summary (Day 14)

Compile these numbers:

```
Total testers invited:      10
Installed:                  __
Logged in:                  __
Used AI Chat:               __
Day-7 retention:            __
P0 bugs filed:              __
P0 bugs fixed:              __
Feature requests (3+ votes):__
Would pay ₹999/month:       __
```

Decision: Ready for Phase 2 (50 users) if:
- 0 open P0 bugs
- Day-7 retention ≥ 40%
- At least 1 real payment attempted
