# Beta Launch Plan — Ooplix

**Date:** 2026-06-05  
**Product:** Ooplix — AI Engineering Platform  
**Owner:** Ehtesham (altamashjauhar@gmail.com)  
**Beta track:** Google Play Closed Testing → Open Testing → Production

---

## Overview

```
Phase 1: 10 users    → Closed Testing (alpha)    → Week 1-2
Phase 2: 50 users    → Open Testing (beta)        → Week 3-4
Phase 3: 100+ users  → Production (10% rollout)   → Week 5+
```

**Goal:** Validate core flows with real users before public launch. Catch onboarding friction, billing issues, and crashes before the full audience sees them.

---

## Phase 1 — 10 Users (Closed Testing)

**Duration:** 2 weeks  
**Track:** Google Play Closed Testing (Alpha)  
**Install method:** Play Console invite link (no public listing needed)

### Who to invite

Select 10 people who represent your real target user:

| # | Profile | Why |
|---|---------|-----|
| 1-3 | Developer friends / colleagues | Will test engineering features deeply |
| 4-5 | Startup founders you know | Will test AI chat + billing |
| 6-7 | Freelancers | Will test multi-project + task features |
| 8-9 | Non-technical friends | Will stress-test onboarding |
| 10 | Yourself (second device/account) | Control tester |

### How to add testers

```
Play Console → Testing → Closed testing (Alpha)
→ Testers tab → Create email list
→ Add 10 email addresses
→ Share opt-in URL with each tester
```

Each tester: opens opt-in URL → "Become a tester" → installs from Play Store.

### Phase 1 success criteria

| Metric | Target |
|--------|--------|
| Install-to-login rate | > 80% |
| Login completion | > 90% |
| AI Chat sent (first session) | > 70% |
| Crash-free sessions | > 95% |
| Day-2 retention | > 40% |
| Critical bugs filed | 0 shipped to Phase 2 |

---

## Phase 2 — 50 Users (Open Testing)

**Duration:** 2 weeks  
**Track:** Google Play Open Testing (Beta)  
**Install method:** Public beta link (anyone with link can join)

### Recruitment channels

| Channel | Target count | Message |
|---------|-------------|---------|
| Your WhatsApp contacts | 15 | Personal invite from you |
| LinkedIn post | 10 | "Looking for beta testers — developers and founders" |
| Twitter/X post | 10 | Same, with beta join link |
| Telegram dev groups (Indian) | 10 | "Free beta access to AI engineering tool" |
| IndieHackers / ProductHunt upcoming | 5 | List as "Upcoming" and collect emails |

### Open testing announcement template

```
Subject: Join Ooplix Beta — AI Engineering Platform

Hey [Name],

I'm building Ooplix, an AI engineering platform for developers and founders.
Think: AI code chat, deployment automation, secret rotation, and observability — in one app.

I need 50 beta testers to try it before public launch.

What you get:
✓ Free 30-day extended trial (vs 7-day standard)
✓ Direct line to me — your feedback shapes the product
✓ Founding user pricing when we launch (30% off)

Join here: [Play Store beta link]

Any questions? Reply to this email.

— Ehtesham
```

### Phase 2 success criteria

| Metric | Target |
|--------|--------|
| Active users (used app > 1 day) | > 35 of 50 |
| AI Chat messages sent total | > 500 |
| Billing upgrade attempted | > 5 |
| Billing upgrade completed | > 2 (real payment) |
| Store rating (if rating prompt added) | ≥ 4.0 |
| Crash-free sessions | > 98% |
| Day-7 retention | > 30% |
| P0 bugs in production | 0 |

---

## Phase 3 — 100+ Users (Production Rollout)

**Duration:** Ongoing  
**Track:** Production — phased rollout starting at 10%  
**Promotion:** ProductHunt launch, social media, SEO

### Rollout schedule

```
Week 1: 10% rollout → monitor crash rate + ANR rate
         Crash rate < 1%? → proceed
         ANR rate < 0.47%? → proceed

Week 2: 20% rollout → monitor reviews + billing
         Average rating > 3.5? → proceed

Week 3: 50% rollout

Week 4: 100% rollout
```

### Phase 3 success criteria

| Metric | 30-day target |
|--------|--------------|
| Total installs | > 500 |
| Day-7 retention | > 25% |
| Day-30 retention | > 15% |
| Paid conversions | > 10 |
| Monthly revenue | > ₹15,000 |
| Store rating | ≥ 4.2 |
| Crash-free sessions | > 99% |

---

## Bug Report Collection

### Channel 1 — In-app feedback email

Add to `flutter/lib/screens/dashboard_screen.dart`:
```dart
// Feedback button → opens email client
final Uri emailUri = Uri(
  scheme: 'mailto',
  path: 'altamashjauhar@gmail.com',
  query: 'subject=Ooplix Beta Feedback&body=Device: ${Platform.operatingSystem}\nVersion: ${packageInfo.version}\n\nFeedback:\n',
);
launchUrl(emailUri);
```

### Channel 2 — WhatsApp group

Create a WhatsApp group: "Ooplix Beta Testers"
- Add all Phase 1 and Phase 2 testers
- Pin the bug report template (below)

### Channel 3 — GitHub Issues (Phase 3)

Create public repo for issue tracking once launched:
```
https://github.com/ooplix/ooplix-app/issues
```

### Bug report template

Send this to testers at start of each phase:

```
OOPLIX BUG REPORT TEMPLATE
────────────────────────────
Type: Bug / Feature Request / Onboarding Issue / Payment Issue

Screen: (where did it happen?)
Steps to reproduce:
1.
2.
3.

Expected: (what should have happened)
Actual: (what actually happened)

Device: (phone model)
Android version:
App version: (Settings → About)

Screenshot: (attach if possible)
────────────────────────────
Send to: altamashjauhar@gmail.com
Or WhatsApp: [your number]
```

---

## Feedback Categories

### Bug reports
Track in a simple spreadsheet:

| # | Date | Tester | Screen | Severity | Status |
|---|------|--------|--------|---------|--------|
| B001 | | | | P0/P1/P2 | Open/Fixed/Won't fix |

**Severity definitions:**
- P0 = App crash, data loss, payment failure → fix before next release
- P1 = Feature broken, bad UX → fix within 1 week
- P2 = Minor visual, nice-to-have → backlog

### Feature requests
Log separately — do not implement during beta. Validate which are most requested:

| Feature | Requested by | Count | Priority |
|---------|-------------|-------|---------|
| | | | |

### Onboarding friction points

Watch for these specific patterns in Phase 1:

| Friction point | Detection method | Fix |
|----------------|-----------------|-----|
| User gets stuck at Google Sign-In | Direct report / crash | Check SHA-1 fingerprint |
| App shows blank screen | Firebase Analytics event missing / Crashlytics | Check API_URL env var |
| Payment link doesn't open | Direct report | Check Razorpay BASE_URL |
| "Too many requests" after login | Direct report | Increase rate limit for testing |
| Trial expired message on Day 1 | Direct report | Check billing trial start date logic |

### Payment issues

Specific questions to ask testers who attempt upgrade:

```
1. Did the Razorpay payment screen open? (Yes/No)
2. Did payment complete successfully? (Yes/No/Abandoned)
3. Did the app update to show your new plan? (Yes/No/Unknown)
4. Did you receive a confirmation email? (Yes/No)
5. Any error messages? (screenshot)
```

**For each payment failure, check:**
```bash
# Backend logs
pm2 logs jarvis-os | grep -E "Webhook|Payment|Billing"

# Verify webhook reached server
# Razorpay Dashboard → Webhooks → click event → "Test webhook"
```

---

## Communication Schedule

### Phase 1 (Week 1)

| Day | Action |
|-----|--------|
| Day 0 | Send invite + install link + bug template to 10 testers |
| Day 1 | WhatsApp check-in: "Did the app install OK?" |
| Day 3 | WhatsApp: "Any issues with login or AI chat?" |
| Day 7 | Email summary: "Here's what we fixed based on your feedback" |
| Day 10 | Send Phase 2 invite to active Phase 1 testers |
| Day 14 | Phase 1 complete — compile findings |

### Phase 2 (Week 3-4)

| Day | Action |
|-----|--------|
| Day 0 | Post beta link publicly + WhatsApp invite |
| Day 3 | Monitor installs, check crash rate in Play Console |
| Day 7 | Email update to all testers with changelog |
| Day 10 | Send upgrade prompt to engaged users |
| Day 14 | Phase 2 complete — compile findings |

### Phase 3 (Production)

| Week | Action |
|------|--------|
| 1 | Monitor crash/ANR in Play Console Android Vitals daily |
| 2 | Reply to all Play Store reviews within 24h |
| 3 | Send "thank you" email to beta users with founding-user discount |
| 4 | ProductHunt launch post |

---

## ProductHunt Launch Template (Phase 3)

**Tagline (60 chars):**
```
AI engineering platform for solo devs and small teams
```

**First comment (maker's note):**
```
Hey PH! 👋

I'm Ehtesham — I built Ooplix after spending too much time on devops, 
secret rotation, and context-switching instead of writing code.

Ooplix gives you:
⚡ AI chat that understands your codebase
🚀 Canary/blue-green deployments with health checks  
🔐 Secret rotation with entropy scoring
📊 SLO monitoring + distributed traces

Started as a solo founder side project, now 100+ beta users.

7-day free trial, no credit card.

Happy to answer any questions below!
```

---

## Go / No-Go Criteria for Production

All of the following must be true before Phase 3:

```
[ ] Crash-free session rate > 98% across Phase 2
[ ] At least 2 real paying customers (proves payment flow works)
[ ] No P0 bugs open
[ ] Day-7 retention > 30% in Phase 2
[ ] Store listing complete (all assets, description, data safety)
[ ] Privacy policy live at https://app.ooplix.com/privacy
[ ] Firebase Production setup complete (FIREBASE_PRODUCTION_CHECKLIST.md done)
[ ] Backend live at https://app.ooplix.com with SSL
[ ] Razorpay webhook secret set (RAZORPAY_PRODUCTION_GUIDE.md done)
[ ] PM2 running backend (auto-restart on crash)
```
