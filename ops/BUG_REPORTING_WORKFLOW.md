# Bug Reporting Workflow

**Owner:** Ehtesham  
**SLA:** P0 = same day | P1 = 3 days | P2 = next sprint

---

## Triage Flow

```
Tester reports bug
       │
       ▼
Is it a crash / payment failure / can't login?
       │
    YES │              NO
       ▼               ▼
    P0 — fix       Is a feature broken?
    same day           │
                    YES │       NO
                       ▼        ▼
                    P1 — fix   P2 — backlog
                    this week
```

---

## P0 Response Checklist (same-day fix)

```
[ ] Reply to tester within 30 min: "Saw this — fixing now"
[ ] Reproduce locally on device or emulator
[ ] Fix the code
[ ] Deploy: pm2 reload jarvis-os (backend) or flutter build + Play Store update (mobile)
[ ] Test fix on device
[ ] Reply to tester: "Fixed in [version] — please update and retry"
[ ] Update spreadsheet: Status → Fixed
```

---

## Common Bug Patterns

### "App crashes on launch"
```
1. Ask: phone model + Android version
2. Check Firebase Crashlytics (after Phase 2 setup)
3. Likely cause: Firebase not configured / google-services.json missing
4. Fix: check flutter build logs
```

### "Google Sign-In doesn't work"
```
1. Most common cause: release SHA-1 not in Firebase
2. Fix: Firebase Console → Project Settings → Android app → Add fingerprint
   SHA1: 32:D6:B5:24:C7:A3:81:33:1B:08:E3:37:02:81:24:22:10:66:5F:03
3. Re-download google-services.json → rebuild → upload to Play Store
```

### "AI Chat shows error"
```
1. Check: curl https://app.ooplix.com/health
2. Check: pm2 logs jarvis-os --lines 20 | grep ERROR
3. Check: GROQ_API_KEY quota at groq.com/console
4. If server down: pm2 restart jarvis-os
```

### "Payment completed but plan didn't update"
```
1. Razorpay Dashboard → Webhooks → check delivery status
2. If webhook failed: resend manually from Dashboard
3. If missing RAZORPAY_WEBHOOK_SECRET: set it and pm2 reload
4. Manual override: POST /billing/activate with tester's accountId
```

### "Billing shows trial expired immediately"
```
1. GET /billing/status for the account
2. Check trialEnd date vs current date
3. If trial didn't start: check billing.json in data/
4. Reset: DELETE /data/billing.json entry for account ID (dev only)
```

---

## Bug Tracking Template (Google Sheets)

Headers:
```
ID | Date | Tester | Reported Via | Screen | Steps | Expected | Actual | Severity | Assigned | Fixed In | Status
```

Statuses: Open → In Progress → Fixed → Verified → Closed

---

## Release Note Format (send to WhatsApp group when fixed)

```
🛠️ Update deployed

Fixed:
• [Bug description] — reported by [Tester name, if they want credit]
• [Bug description]

Version: 1.0.1 (update from Play Store)

Thanks for reporting! 🙏
```
