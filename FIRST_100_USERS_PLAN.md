# First 100 Users Plan — Ooplix

**Date:** 2026-06-05  
**Owner:** Ehtesham (altamashjauhar@gmail.com)  
**Goal:** 100 active users within 30 days of public launch  
**Definition of "active":** Used AI chat or a core feature at least once in the past 7 days

---

## User Target

**Primary:** Indian solo developers, indie hackers, and startup founders (2–10 person teams)  
**Secondary:** Freelancers managing multiple client projects  
**Not targeting:** Enterprise (later), non-technical users (later)

---

## Acquisition Plan

### Week 1 — Seeded Beta (10 users)

**Goal:** Get 10 hand-picked users who will give honest feedback.

| Channel | Target | Action |
|---------|--------|--------|
| Personal WhatsApp contacts | 5 | Direct message individually |
| Developer friends | 3 | Personal call or WhatsApp |
| Twitter/X followers | 2 | DM — "building something, want early access?" |

**Message template (WhatsApp/DM):**
```
Hey [Name],

I launched Ooplix — an AI engineering platform for devs and founders.
Think: AI code chat, deployment autopilot, secret rotation. All in one.

I need 10 honest testers before opening it up.
Install link: [Play Store Internal Testing link]

7-day free trial, no CC. Takes 2 min to set up.
Feedback means a lot — even "this confused me" helps.
```

**Actions:**
```
[ ] Create WhatsApp group "Ooplix Beta" for these 10
[ ] Add all 10 to Play Console → Internal Testing
[ ] Send personal message to each (not a broadcast)
[ ] Set up weekly check-in: every Sunday at 7pm ask "anything broken?"
```

---

### Week 2–3 — Expanded Beta (10 → 50 users)

**Goal:** 50 total users. Move from hand-picked to channel-driven.

| Channel | Target | Action |
|---------|--------|--------|
| LinkedIn post | 15 | Post with beta link — personal story angle |
| Twitter/X thread | 10 | "I built an AI engineering platform. Here's what it does." |
| IndieHackers | 10 | Post in "Share What You're Working On" thread |
| Dev WhatsApp/Telegram groups | 10 | Join 3 India-focused dev groups, share respectfully |
| ProductHunt "Ship" (coming soon) | 5 | List as upcoming, collect email notifications |

**LinkedIn post template:**
```
I've been building alone for months and finally hit a wall — spending 40% of my time on devops, secret rotation, and deployment instead of coding.

So I built Ooplix.

AI engineering platform for solo founders and small teams:
⚡ AI code chat (Claude/GPT/Ollama)
🚀 Canary + blue-green deployments
🔐 Secret rotation with health scoring
📊 SLO monitoring + distributed traces

7-day free trial. Android app + web.

Who wants early access? Drop a comment or DM me.
[Play Store Beta Link]
```

**Twitter/X thread template:**
```
🧵 I spent 6 months building an AI engineering platform that does what I wish existed.

Here's what Ooplix does: [thread with 5-6 tweets, one feature per tweet]

Beta is live on Android. 7-day free trial.
[link]

RT if you know a dev who'd want this.
```

---

### Week 4 — ProductHunt Launch (50 → 100 users)

**Goal:** ProductHunt launch day → 100 users.

**PH launch checklist:**
```
[ ] Gallery: 5 screenshots + feature graphic uploaded to PH
[ ] Tagline: "AI engineering platform for solo devs and small teams"
[ ] Description: 200-word product overview
[ ] First comment written (maker's note — see BETA_LAUNCH_PLAN.md for template)
[ ] Hunting: ask 3 friends to hunt it (higher profile = more visibility)
[ ] Launch day: post at 12:01 AM PST (when PH resets daily rankings)
[ ] Upvote: message all beta testers "Ooplix is on PH today — upvote if you use it"
```

**PH launch day schedule:**
```
12:01 AM PST: Product goes live
 6:00 AM PST: Post in IndieHackers "I launched on PH" thread
 8:00 AM PST: LinkedIn post "We're on ProductHunt today"
10:00 AM PST: WhatsApp to all beta testers: "Vote here: [link]"
 2:00 PM PST: Twitter update with current ranking
 6:00 PM PST: Final push message to supporters
```

---

## Onboarding Flow

### Ideal first session (target: < 3 minutes to first value)

```
Install app
   ↓
Splash screen (2 seconds)
   ↓
Login with Google (or email)
   ↓
Dashboard — see plan status (7-day trial)
   ↓
AI Chat — type first message
   ↓ ← TARGET: reach here in < 3 minutes
First AI response received
   ↓
Value delivered
```

### Onboarding friction points to watch

| Step | Friction risk | Monitor via |
|------|-------------|------------|
| Google Sign-In fails | SHA-1 not registered in Firebase | Crashlytics / user reports |
| Blank screen after login | API_URL wrong or server down | Server logs / health check |
| AI chat returns error | GROQ_API_KEY exhausted or server timeout | Server logs |
| "Too many requests" on first use | Rate limiter too aggressive | Server logs |
| Payment link broken | BASE_URL still localhost | Razorpay Dashboard webhook |

### First-session message (send after signup)

Send via email or WhatsApp within 1 hour of signup:

```
Subject: Welcome to Ooplix — here's how to get started

Hey [Name],

You just joined Ooplix. Your 7-day trial starts now.

Quick start:
1. Open the app → AI Chat tab
2. Ask: "Explain what an API rate limiter does"
3. Try: "Generate a Node.js health check endpoint"

You have full access to everything during the trial.

Questions? Reply to this email — I read every one.

— Ehtesham
```

---

## Support Plan

### Response time targets

| Channel | SLA | When |
|---------|-----|------|
| WhatsApp (beta testers) | < 2 hours | During waking hours (9am–11pm IST) |
| Email | < 24 hours | Any time |
| Play Store review reply | < 24 hours | Check every morning |
| P0 bug (crash/payment) | < 1 hour | Any time |

### Support channels

**Phase 1–2 (0–50 users):** WhatsApp group + direct email  
**Phase 3 (50–100 users):** Add email ticketing (Gmail labels), keep WhatsApp for P0

### Common support scenarios

**"The app crashes on launch"**
```
1. Ask: Android version? Phone model?
2. Check Crashlytics (Firebase Console → Crashlytics)
3. Fix in hotfix release → notify tester when fixed
```

**"I can't login with Google"**
```
1. Most likely: SHA-1 fingerprint not registered in Firebase for release build
2. Fix: Add release SHA-1 in Firebase → re-download google-services.json → rebuild
```

**"Payment didn't go through but money was deducted"**
```
URGENT — respond within 30 minutes
1. Check Razorpay Dashboard → Payments → find transaction
2. Check backend logs: pm2 logs | grep "Webhook"
3. If webhook missed: manually activate plan via POST /billing/activate
4. Refund if needed via Razorpay Dashboard
5. Follow up with user confirming resolution
```

**"My trial expired but I can't upgrade"**
```
1. Check billing status: GET /billing/status
2. If plan shows expired but user hasn't been notified: send email
3. If Razorpay upgrade button missing: check billing route
4. Offer 3-day extension via POST /billing/activate (manual, as goodwill)
```

---

## Feedback Loop

### Weekly feedback cadence

| Day | Action |
|-----|--------|
| Monday | Review all bug reports from past week, triage |
| Wednesday | WhatsApp check-in with active testers: "Anything broken or confusing?" |
| Friday | Compile feature requests — count votes by recurrence |
| Sunday | Deploy any bug fixes — announce in WhatsApp group |

### Feedback collection questions (send after 7 days of use)

```
Hey [Name], quick feedback — takes 2 minutes:

1. What did you actually use Ooplix for this week?
2. What's the ONE thing that's confusing or broken?
3. What's missing that would make you pay for it?
4. Rate your first week: 1 (bad) → 5 (great)

Reply to this message — I read everything.
```

### Feature request tracking

Maintain a simple spreadsheet:

| Feature | Requested by | Count | Will build? |
|---------|-------------|-------|------------|
| iOS app | Tester 3, 7 | 2 | Phase 2 |
| Dark mode for web | Tester 1 | 1 | Backlog |
| Export chat history | Tester 2, 5, 8 | 3 | Consider |

**Rule:** Only build features requested by 3+ users. Never build a feature requested once.

---

## Retention Plan

### Trial-to-paid conversion (target: 15%)

**Day 1:** Welcome email with quick start guide  
**Day 3:** "Here's what other users are doing with Ooplix" — feature tip  
**Day 5:** "Your trial ends in 2 days — here's what you get with a plan"  
**Day 7 (trial end):** "Your trial has ended — upgrade to keep access" + pricing  
**Day 10:** "You had a great trial week — here's a 20% discount code for first month"

### Engagement hooks (trigger-based)

| Trigger | Message |
|---------|---------|
| User sent < 3 AI messages in 7 days | "Try asking Ooplix to review your code or explain a function" |
| User hasn't logged in for 3 days | "Your repo is waiting — run a quick code search" |
| User attempted upgrade but didn't complete | "Need help with the upgrade? Reply and I'll sort it out" |

### Day-30 retention target: 25%

Of 100 users acquired, 25 should still be active at day 30. Track via:
- Firebase Analytics: user retention cohort
- Play Console: Active Device Installs over time
- Backend: login frequency per account (check `data/local-accounts.json` timestamps)

---

## Success Metrics Dashboard

Track weekly in a simple spreadsheet:

| Week | New users | Active users | AI chats sent | Upgrades | Revenue (₹) | Crashes |
|------|-----------|-------------|--------------|---------|------------|--------|
| W1   | 10 | — | — | — | ₹0 | — |
| W2   | 25 | — | — | — | — | — |
| W3   | 50 | — | — | — | — | — |
| W4   | 100 | — | — | ≥2 | ≥₹1,998 | 0 |

### Definition of success at 100 users

```
✅ 100 total installs within 30 days of public launch
✅ Day-7 retention ≥ 25% (25 of 100 still active at day 7)
✅ At least 5 paid subscribers (₹999 or ₹2,499/month)
✅ ≥ ₹10,000 MRR (Monthly Recurring Revenue)
✅ Crash-free session rate ≥ 98%
✅ Average Play Store rating ≥ 4.0
✅ 0 unresolved P0 bugs
✅ < 24-hour average response time to all support messages
```

---

## 30-Day Launch Calendar

| Day | Milestone | Action |
|-----|-----------|--------|
| 0 | 🚀 Backend live | P0 checklist complete, server running |
| 1 | Internal testing | 10 trusted testers invited |
| 3 | First feedback | WhatsApp check-in |
| 7 | Internal test complete | Fix P0 bugs from testers |
| 8 | Expanded beta | LinkedIn + Twitter posts go live |
| 10 | 25 users | Check retention, send Day-3 engagement message |
| 14 | Play Store upload | AAB submitted to Closed Testing |
| 15 | 50 users | Mid-point review — what's working? |
| 18 | Play Store approved | Promote to Production (10% rollout) |
| 21 | ProductHunt launch | Execute PH launch day schedule |
| 23 | 75 users | First paid conversions expected |
| 28 | 100 users | 🎉 Goal achieved |
| 30 | Retrospective | What worked, what didn't, what's next |
