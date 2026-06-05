# Play Store Submission Guide — Ooplix

**Date:** 2026-06-05  
**Package:** `com.ooplix.jarvis`  
**Category:** Business  
**Target audience:** 18+ (developers, founders, small engineering teams)

---

## Pre-Submission Requirements

Before opening Play Console, confirm these are ready:

```
[ ] flutter build appbundle --release succeeded
[ ] app-release.aab file exists and is < 150MB
[ ] App icon 512×512 PNG created (no alpha)
[ ] Feature graphic 1024×500 PNG created
[ ] Minimum 2 phone screenshots (recommended: 5)
[ ] Privacy policy live at https://app.ooplix.com/privacy
[ ] Terms of service live at https://app.ooplix.com/terms
[ ] Google Play developer account active ($25 fee paid)
```

---

## Step 1 — Google Play Console Setup

**URL:** [play.google.com/console](https://play.google.com/console)

```
1. Sign in with altamashjauhar@gmail.com
2. Click "Create app"
3. App name:        Ooplix
4. Default language: English (United States)
5. App or game:     App
6. Free or paid:    Free
7. Declarations:    ✅ Accept developer program policies
                    ✅ Accept US export laws
8. Click "Create app"
```

---

## Step 2 — Store Listing

**Left sidebar → Grow → Store presence → Main store listing**

### App name (30 chars max)
```
Ooplix — AI Engineering
```

### Short description (80 chars max)
```
AI-powered engineering platform. Chat, deploy, monitor, ship faster.
```

### Full description (4000 chars max)
```
OOPLIX — AI Engineering Platform

Ooplix is the AI-powered engineering platform for founders and developers who want to ship faster without adding headcount.

━━ CORE FEATURES ━━

⚡ AI Engineering Chat
Ask anything about your codebase. Get explanations, refactoring suggestions, bug fixes, and code generation — powered by Claude, GPT-4, or your own models.

🔍 Repo Intelligence
Index your entire repository. Search across millions of lines with semantic understanding. Find any symbol, trace cross-file references, explore dependency graphs.

🚀 Deployment Autopilot
Canary deploys, blue/green switches, rollbacks, multi-environment pipelines. Release with confidence using built-in health checks and smoke tests.

🔐 Secret Rotation
Automatic rotation schedules, entropy-scored health checks, and overdue reminders keep your credentials secure and auditable.

📊 Observability
Distributed traces, SLO monitoring, service dependency maps, and alert routing — without a dedicated DevOps team.

━━ INTEGRATIONS ━━
• Google Sign-In & GitHub OAuth
• Razorpay subscription billing
• WhatsApp & Telegram notifications
• OpenRouter, Claude, OpenAI, Ollama

━━ BUILT FOR ━━
✓ Solo founders shipping fast
✓ Small engineering teams (2–20 people)
✓ Freelancers managing multiple projects
✓ Startups building their first production system

━━ SECURITY ━━
• AES-256-GCM token encryption at rest
• JWT session management with httpOnly cookies
• HMAC-verified webhooks
• Zero dangerous permissions requested

━━ PERMISSIONS ━━
• Internet — required to connect to Ooplix backend
• Network state — to detect connectivity

No camera, microphone, location, contacts, or storage access required.

━━ PRICING ━━
• 7-day free trial — no credit card required
• Starter: ₹999/month
• Growth: ₹2,499/month

Start your free trial today.
```

### App icon
- Upload 512×512 PNG (no alpha, no rounded corners)

### Feature graphic
- Upload 1024×500 PNG

### Screenshots (upload in order)
1. Login screen — "Secure login with Google or email"
2. Dashboard — "Real-time engineering overview"
3. AI Chat — "Instant AI code assistance"
4. Billing — "Simple, transparent pricing"
5. Dark UI — "Built for engineers, day and night"

---

## Step 3 — App Category & Tags

**Left sidebar → Grow → Store presence → Main store listing → scroll to bottom**

```
App category:     Business
Tags (pick 5):    Developer Tools, Productivity, Automation, AI, Tech
```

---

## Step 4 — Content Rating (IARC)

**Left sidebar → Policy → App content → Content ratings → Start questionnaire**

Answer exactly:

```
Category: Utility / Productivity

Violence:                  No
Sexual content:            No
Profanity/crude humour:    No
Drugs/alcohol/tobacco:     No
Simulates gambling:        No
User-generated content:    Yes (AI chat responses)
Shares location:           No
Shares user info:          Yes (email address for account)
Digital purchases:         Yes (Razorpay subscription)
Ads:                       No (initially)
```

**Expected rating: Everyone (E)**

Click "Save questionnaire" → rating applied immediately.

---

## Step 5 — Permissions Audit (Play Console)

**Left sidebar → Policy → App content → Permissions**

Declared permissions in `mobile/android-config/AndroidManifest.xml`:

| Permission | Declaration | Justification for Play Store |
|-----------|------------|------------------------------|
| `INTERNET` | ✅ Required | App connects to Ooplix AI backend |
| `ACCESS_NETWORK_STATE` | ✅ Required | Detect offline state, show reconnecting message |

**Do NOT declare:**

| Permission | Status | Reason |
|-----------|--------|--------|
| `READ_CONTACTS` | ❌ Not declared | Not needed — manual phone entry |
| `CAMERA` | ❌ Not declared | No camera features |
| `ACCESS_FINE_LOCATION` | ❌ Not declared | No location features |
| `READ_EXTERNAL_STORAGE` | ❌ Not declared | No file access |
| `WRITE_EXTERNAL_STORAGE` | ❌ Not declared | No file writing |
| `POST_NOTIFICATIONS` | ⚠️ Add when FCM enabled | Phase 2 |

---

## Step 6 — Data Safety Form

**Left sidebar → Policy → App content → Data safety**

Complete every section:

### 6A. Data collection and security

```
Does your app collect or share any of the required user data types? YES

Is all of the data collected by your app encrypted in transit? YES
Do you provide a way for users to request that their data is deleted? YES
```

### 6B. Data types

| Data type | Collected | Shared | Optional | Purpose |
|-----------|-----------|--------|---------|---------|
| Name | No | — | — | — |
| Email address | Yes | No | No | Account management |
| User IDs | Yes | No | No | App functionality |
| Crash logs | Yes | No | No | Analytics / bug fixes |
| App interactions | Yes | No | No | Analytics |
| Financial info | No | — | — | — |
| Location | No | — | — | — |
| Photos/videos | No | — | — | — |
| Contacts | No | — | — | — |
| Messages | No | — | — | — |

### 6C. Data sharing with third parties

| Third party | Data shared | Purpose |
|-------------|------------|---------|
| Google (Firebase) | Email, User ID, Crash logs | Auth + Analytics |
| Razorpay | Transaction amounts | Payment processing |

*Note: Razorpay handles payment data directly — Ooplix does not store card numbers.*

Click **Save** on each section, then **Submit**.

---

## Step 7 — Privacy Policy Requirements

**The privacy policy must be live at a public HTTPS URL before submission.**

Your app already has the route `mobile/src/pages/PrivacyPolicy.jsx`. Deploy it at:
```
https://app.ooplix.com/privacy
```

**Minimum required disclosures in the policy:**

```
1. What data is collected: email, usage data, crash logs
2. How data is used: account management, service improvement
3. Third-party services: Firebase (Google), Razorpay
4. Data retention: how long you keep data
5. User rights: how users can request deletion (email: altamashjauhar@gmail.com)
6. Contact: altamashjauhar@gmail.com
7. Last updated date
```

**Set in Play Console:**
```
Left sidebar → Policy → App content → Privacy policy
→ Enter URL: https://app.ooplix.com/privacy
→ Save
```

---

## Step 8 — Target Audience

**Left sidebar → Policy → App content → Target audience and content**

```
Target age group: 18 and older
This app is not directed to children: YES
```

---

## Step 9 — App Access

**Left sidebar → Policy → App content → App access**

```
Does your app require login? YES

→ Add new instructions:
   Name:     Operator login
   Username: (leave blank — password-only login)
   Password: (provide your test operator password)
   Notes:    "Use password field only. Email field optional (creates user account)."
```

---

## Step 10 — Upload AAB and Create Release

**Left sidebar → Release → Testing → Internal testing → Create new release**

### First upload: Internal Testing

```
1. Click "Create new release"
2. Click "Upload" → select: flutter/build/app/outputs/bundle/release/app-release.aab
3. Wait for upload and processing (~2-5 minutes)
4. Release name: 1.0.0 (Internal)
5. Release notes (en-US):
   "Initial internal testing release. Testing core auth, AI chat, and billing flows."
6. Click "Save" → "Review release" → "Start rollout to Internal testing"
```

### Promote to Closed Testing (Beta) after internal pass

```
Left sidebar → Release → Testing → Closed testing (alpha)
→ Create new release → Upload same or newer AAB
→ Add testers by email: add your 10 beta users
→ Release notes: "Beta release — please test and report issues via email"
```

### Promote to Production

```
Left sidebar → Release → Production → Create new release
→ Upload AAB with incremented versionCode
→ Rollout percentage: start at 10% (phased rollout)
→ Release notes (what's new):
   "Ooplix 1.0 — AI engineering platform for developers and founders.
    7-day free trial. No credit card required."
→ Review → Start rollout to production
```

---

## Step 11 — Post-Submission

### Review timeline
- **Internal testing:** Instant — no review needed
- **Closed/Open testing:** 1–3 days (first submission), hours after that
- **Production:** 1–7 days for first submission (Google review)

### Monitor after production release

```
Play Console → Android vitals → Core vitals
→ Crash rate target: < 1%
→ ANR rate target:   < 0.47%

Play Console → Ratings → Reviews
→ Reply to every 1-3 star review within 24 hours
```

---

## Submission Checklist

```
STORE LISTING
[ ] App name set: "Ooplix — AI Engineering" (≤30 chars)
[ ] Short description set (≤80 chars)
[ ] Full description set (≤4000 chars)
[ ] App icon 512×512 uploaded
[ ] Feature graphic 1024×500 uploaded
[ ] Minimum 2 phone screenshots uploaded
[ ] Category set: Business

POLICY
[ ] Content rating questionnaire complete (Expected: Everyone)
[ ] Privacy policy URL live: https://app.ooplix.com/privacy
[ ] Privacy policy URL entered in Play Console
[ ] Data safety form complete (all sections saved and submitted)
[ ] Target audience: 18 and older
[ ] App access credentials provided

RELEASE
[ ] AAB built with flutter build appbundle --release
[ ] versionCode = 1 (first upload)
[ ] AAB uploaded to Internal Testing track
[ ] Internal testing email added (yourself)
[ ] Release notes written in English
[ ] Rollout started to Internal Testing

AFTER INTERNAL PASS
[ ] 10 beta testers added to Closed Testing
[ ] Bugs from internal test fixed
[ ] versionCode incremented
[ ] New AAB uploaded
[ ] Promote to Production (10% rollout)
```
