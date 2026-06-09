# Beta Onboarding Process — First 10 Users

**Owner:** Ehtesham (altamashjauhar@gmail.com)  
**Target:** 10 hand-picked beta testers  
**Channel:** WhatsApp (primary) + email (backup)

---

## Who to Invite (Pick 10)

| Slot | Profile | Why |
|------|---------|-----|
| 1–3 | Developer friends / colleagues | Deep product testers |
| 4–5 | Startup founder contacts | Business use-case validation |
| 6–7 | Freelancers you know | Multi-project workflow testing |
| 8–9 | Non-technical contacts | Onboarding friction detection |
| 10 | Yourself (second account) | Baseline control |

---

## Invite Message (send personally — not broadcast)

**WhatsApp (personalised per person):**

```
Hey [Name] 👋

I've been building an AI engineering platform called Ooplix for the last few months.
Think: AI code chat, deployment automation, secret rotation — all in one.

I need 10 honest testers before I open it up. You're one of them.

What you get:
→ 30-day extended trial (normally 7 days)
→ Direct line to me — your feedback shapes the product
→ Founding user pricing when we launch (30% off forever)

Takes 2 minutes to set up. Just install + login.

Install: [Play Store Internal Testing link]
Web: https://app.ooplix.com

Let me know if anything breaks or confuses you — even "this button looks weird" helps.

— Ehtesham
```

---

## Day 0 — Launch Steps (your actions)

```
[ ] Create WhatsApp group: "Ooplix Beta"
[ ] Add all 10 testers to the group
[ ] Send personalised individual WhatsApp to each (not just group)
[ ] Add each tester's email to Play Console → Internal Testing
[ ] Send the beta join link to group
[ ] Pin the bug report template (see FEEDBACK_COLLECTION_PROCESS.md)
```

---

## Day 1 — First Check-in (your actions)

**Send to WhatsApp group at 10am:**

```
Hey everyone 👋 quick check — did the app install OK?

If yes: try opening AI Chat and sending one message.
If no: reply here with what happened and I'll fix it.
```

---

## Day 3 — Engagement Check (your actions)

**Send to WhatsApp group:**

```
Day 3 check-in! 🎯

Quick questions:
1. Did you actually use it yet? (Yes / No / Tried but couldn't)
2. What's the first thing you tried to do?
3. Anything confusing?

No judgement — honest answers help more than nice ones.
```

---

## Day 7 — Feedback Survey (your actions)

Send this to each active user individually:

```
Hey [Name], week 1 done! Quick 3-question check:

1. What did you actually use Ooplix for this week?
2. What's the ONE thing that's broken or confusing?  
3. Would you pay ₹999/month for it? (Yes / No / Maybe — why)

Reply here, takes 2 min. Thanks 🙏
```

---

## Onboarding Success Criteria

| Metric | Target | How to check |
|--------|--------|-------------|
| App installed | 8/10 (80%) | Play Console → Installs |
| Login completed | 7/10 (70%) | Firebase Console → Users |
| AI Chat used | 6/10 (60%) | Server logs: POST /jarvis |
| Day-7 still active | 4/10 (40%) | Firebase → Last seen |
