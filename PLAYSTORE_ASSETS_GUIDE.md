# Play Store Assets Guide — Ooplix

**Date:** 2026-06-05  
**Package:** `com.ooplix.jarvis`  
**Category:** Business  
**Target market:** India (English)

---

## Required Assets — Complete List

| Asset | Dimensions | Format | Required |
|-------|-----------|--------|---------|
| App icon | 512 × 512 px | PNG (no alpha) | ✅ Mandatory |
| Feature graphic | 1024 × 500 px | PNG or JPG | ✅ Mandatory |
| Phone screenshots | Min 2, max 8 (320–3840px on longest side, ratio 16:9 or 9:16) | PNG or JPG | ✅ Mandatory |
| 7-inch tablet screenshots | Min 1 | PNG or JPG | Optional |
| 10-inch tablet screenshots | Min 1 | PNG or JPG | Optional |
| Promo video | YouTube URL | — | Optional |

---

## 1. App Icon — 512 × 512 px

**Spec:**
- Size: exactly 512 × 512 px
- Format: PNG
- **No alpha/transparency** (Play Store adds its own shape mask)
- No rounded corners in the source file (Play applies adaptive rounding)
- Safe zone: keep all content within central 380 × 380 px
- File size: under 1MB

**Design:**
- Background: `#6366F1` (indigo-500) — matches app theme
- Foreground: Bold lightning bolt `⚡` or abstract "J" mark, white
- Style: Flat, single-layer, readable at small sizes (48×48)

**Tools:**
- Figma (free) — design at 512px, export as PNG
- Canva → Apps & Mobile → Android Icon
- Adobe Express (free tier)

**Adaptive icon (Android 8+):**
Play Store generates the shape automatically from:
- `ic_launcher_background.xml` — solid `#6366F1` fill
- `ic_launcher_foreground.png` — white bolt/logo, centred in 108×108dp with content in inner 72×72dp safe zone

After running `flutter_launcher_icons`, verify these are in:
`flutter/android/app/src/main/res/mipmap-*/`

---

## 2. Feature Graphic — 1024 × 500 px

Used as the hero banner on the Play Store listing page.

**Spec:**
- Size: exactly 1024 × 500 px
- Format: PNG or JPG
- No text in outer 50px margin (may be cropped on some devices)
- File size: under 1MB

**Design concept:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [dark bg #0F0F14]                                              │
│                                                                 │
│  ⚡ OOPLIX                    [mock phone screenshot]           │
│                                                                 │
│  AI Engineering               [blurred code / dashboard]        │
│  Platform                                                       │
│                                                                 │
│  "Build faster. Deploy smarter."                               │
└─────────────────────────────────────────────────────────────────┘
```

**Figma template approach:**
1. Canvas: 1024 × 500, background `#0F0F14`
2. Left half: app name, tagline, logo
3. Right half: phone mockup showing Dashboard or Chat screen
4. Export PNG at 1× (no scaling needed)

---

## 3. Screenshots — Phone (Required: min 2, recommended: 5)

**Spec:**
- Minimum dimension: 320px on short side
- Maximum dimension: 3840px on long side
- Aspect ratio: 16:9 (landscape) or 9:16 (portrait — recommended)
- Format: PNG or JPG
- File size: under 8MB each
- **No device frame required** (Play Console can add frames)

**Recommended 5 screenshots (portrait 1080 × 1920):**

| # | Screen | Caption |
|---|--------|---------|
| 1 | Splash / Login | "Secure login with Google or email" |
| 2 | Dashboard | "Real-time engineering overview" |
| 3 | AI Chat | "Ask JARVIS anything — instant AI responses" |
| 4 | Billing / Plan | "Transparent subscription management" |
| 5 | Dark mode UI | "Beautiful dark mode, built for engineers" |

**How to capture:**
```bash
# Option A: Android emulator (Android Studio)
# Run app → Android Studio → Logcat panel → camera icon

# Option B: Physical device (USB debugging)
adb exec-out screencap -p > screenshot_$(date +%s).png

# Option C: Flutter drive screenshots
flutter drive --driver=test_driver/integration_test.dart \
              --target=integration_test/screenshots_test.dart
```

**Add captions/overlays:**
Use Figma or Canva to add a title bar above each screenshot:
```
┌──────────────────────────────┐
│  AI Chat                     │  ← 60px bar, #6366F1 bg, white text
├──────────────────────────────┤
│                              │
│   [raw screenshot]           │
│                              │
└──────────────────────────────┘
```

---

## 4. Short Description (80 chars max)

```
AI-powered engineering platform. Chat, deploy, monitor, ship faster.
```
(68 chars — within limit)

**Alternatives:**
```
Build and ship software faster with JARVIS AI engineering assistant.
```
```
AI engineering tools: code chat, deploy autopilot, secret rotation.
```

---

## 5. Long Description (4000 chars max)

```
OOPLIX — AI Engineering Platform

Ooplix is the AI-powered engineering platform built for founders, indie developers, and small engineering teams who want to ship faster without adding headcount.

━━ WHAT OOPLIX DOES ━━

⚡ AI Engineering Chat
Ask anything about your codebase. Get instant explanations, refactoring suggestions, bug fixes, and code generation — powered by Claude, GPT-4, or your own Ollama model.

🔍 Repo Intelligence
Index your entire repository. Search millions of lines with semantic understanding. Find any symbol, trace cross-file references, explore dependency graphs — in seconds.

🚀 Deployment Autopilot
Canary deploys, blue/green switches, rollbacks, multi-environment pipelines. Release with confidence using built-in health checks and smoke tests.

🔐 Secret Rotation
Never let a credential expire unnoticed. Automatic rotation schedules, entropy-scored health checks, and overdue reminders keep your secrets secure.

📊 Enterprise Observability
Distributed traces, SLO monitoring, service dependency maps, and alert routing — production-grade observability without the complexity of a dedicated DevOps team.

🔗 Multi-Repo Coordination
Manage multiple repositories as a coherent system. Coordinate releases across services, track cross-repo dependencies, and plan deployments in build order.

━━ INTEGRATIONS ━━
• Google Sign-In
• GitHub OAuth
• Razorpay billing
• WhatsApp notifications
• Telegram alerts
• OpenRouter, Claude, OpenAI, Ollama

━━ BUILT FOR ━━
✓ Solo founders shipping fast
✓ Small engineering teams (2–20 people)
✓ Freelancers managing multiple client projects
✓ Startups building their first production backend

━━ SECURITY ━━
• All tokens AES-256-GCM encrypted at rest
• JWT-based session management
• HMAC-verified webhooks
• Zero dangerous permissions requested

━━ PERMISSIONS ━━
• Internet: required to connect to JARVIS backend
• Network state: to detect connectivity and show offline status
No camera, microphone, location, contacts, or storage access required.

━━ PRICING ━━
• Free trial: 7 days full access
• Starter: ₹999/month — solo developer
• Growth: ₹2,499/month — small team

Start your free 7-day trial — no credit card required.
```

(~1,780 chars — well within 4,000 limit. Add more feature detail if needed.)

---

## 6. Keywords / Search Terms

Play Store does not have a separate keyword field (unlike App Store). Keywords are embedded in your title and description. Use these naturally:

**Primary (include in title or first paragraph):**
- AI engineering
- code assistant
- developer tools
- deployment automation

**Secondary (include in description):**
- AI chat for developers
- code search
- secret rotation
- SLO monitoring
- repo intelligence
- canary deploy
- engineering platform
- Claude API
- GPT developer tool

**Hindi/India-specific (if targeting Indian developers):**
- AI coding assistant
- software deployment
- startup engineering

---

## 7. App Title

**Primary (max 30 chars):**
```
Ooplix — AI Engineering
```
(24 chars)

**Alternatives:**
```
Ooplix: AI Dev Platform
```
```
JARVIS Engineering
```

---

## 8. Content Rating

In Play Console → **Policy → App content → Content ratings → Start questionnaire**

**Your answers:**
- Violence: No
- Sexual content: No
- Language: No
- Drugs/alcohol/tobacco: No
- Gambling: No
- Simulates gambling: No
- Ads: No (initially)
- User-generated content: Yes (AI chat responses)
- Personal/sensitive info: Yes (email, usage data)

**Expected rating:** EVERYONE (E) — suitable for all ages  
**IARC certificate:** Auto-generated after questionnaire

---

## 9. App Category & Tags

| Field | Value |
|-------|-------|
| Category | Business |
| Tags (choose 5 from Play Console list) | Developer Tools, Productivity, Automation, AI, Business |
| Content rating | Everyone |
| Interactive elements | Users interact, shares info |

---

## Asset Production Checklist

```
[ ] App icon 512×512 PNG created (no alpha, content in 380×380 safe zone)
[ ] Adaptive icon foreground PNG created (108×108dp, content in 72×72dp safe zone)
[ ] Feature graphic 1024×500 PNG created
[ ] Screenshot 1: Login screen captured (1080×1920 PNG)
[ ] Screenshot 2: Dashboard screen captured
[ ] Screenshot 3: AI Chat screen captured
[ ] Screenshot 4: Billing/Plan screen captured
[ ] Screenshot 5: Dark mode UI captured
[ ] Short description written (≤80 chars) — ✅ above
[ ] Long description written (≤4000 chars) — ✅ above
[ ] App title confirmed (≤30 chars) — ✅ above
[ ] Privacy policy URL live: https://app.ooplix.com/privacy
[ ] Terms of service URL live: https://app.ooplix.com/terms
[ ] All assets uploaded in Play Console → Store listing
```

---

## Tools Reference

| Tool | Use | Cost |
|------|-----|------|
| [Figma](https://figma.com) | Icon, feature graphic, screenshot overlays | Free |
| [Canva](https://canva.com) | Quick mockups and overlays | Free |
| [Android Studio](https://developer.android.com/studio) | Screenshot capture from emulator | Free |
| [DaVinci Resolve](https://blackmagicdesign.com) | Promo video (optional) | Free |
| [Remove.bg](https://remove.bg) | Background removal for icon source | Free (5/day) |
| [TinyPNG](https://tinypng.com) | PNG compression before upload | Free |
