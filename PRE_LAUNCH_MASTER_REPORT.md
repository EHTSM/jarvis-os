# Pre-Launch Master Report — Ooplix / JARVIS-OS

**Generated:** 2026-06-05  
**Audited by:** ProductionReadinessEngine + SecurityHardeningLayer + live env scan  
**Version:** 3.0.0

---

## Executive Summary

| System | Score | Status |
|--------|-------|--------|
| Production readiness | **81 / 100** | NEARLY_READY |
| Security hardening | **97 / 100** | A |
| OAuth readiness | **Code complete** | Credentials missing |
| Razorpay readiness | **Code complete** | Webhook secret missing |
| Flutter readiness | **Code complete** | Firebase config missing |
| Firebase readiness | **Code complete** | Console setup missing |
| Play Store readiness | **Code complete** | Assets + account needed |

**Overall launch verdict:**  
`HOLD` — 7 environment-variable blockers. All code is done. No new development required.  
Estimated time to resolve all blockers: **~2 hours of manual setup**.

---

## 1. Production Readiness — 81/100 NEARLY_READY

### Category breakdown

| Category | Score | Findings |
|----------|-------|---------|
| Deployment | 67/100 | PM2 not running locally (runtime-only warn), stability warn (uptime 0s in audit) |
| Config | 55/100 | OAuth creds missing, Firebase missing — all env-var only |
| Security | 100/100 | All security checks pass |
| Dependencies | 100/100 | All packages present, Node version OK |

### What is confirmed passing ✅

- `JWT_SECRET` — set, 64 chars, strong entropy
- `OPERATOR_PASSWORD_HASH` — set, scrypt-hashed
- `GROQ_API_KEY` — set (primary AI provider)
- `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` — set (live keys `rzp_live_*`)
- `TELEGRAM_TOKEN` — set
- `WA_TOKEN` — set
- `NODE_ENV=production`
- `PORT=5050`
- `DISABLE_X_POWERED_BY=1`
- `ALLOWED_ORIGINS` — set (localhost, update to prod domain)
- Frontend build: `frontend/build/index.html` exists
- `data/` directory writable
- All HTTP security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, CSP, HSTS
- Rate limiting: `rateLimiter(10, 5min)` on `/auth/login`, global on `/jarvis`
- Auth guard: `requireAuth` on all protected routes (86 handlers)
- HMAC webhook verification wired for Razorpay
- PM2 ecosystem config: `ecosystem.config.cjs` — fully configured with restart policy, memory limits, log rotation

### What is blocking ❌

| # | Variable | Current value | Required value |
|---|---------|--------------|----------------|
| 1 | `BASE_URL` | `http://localhost:5050` | `https://app.ooplix.com` |
| 2 | `APP_URL` | `http://localhost:5050` | `https://app.ooplix.com` |
| 3 | `ALLOWED_ORIGINS` | `http://localhost:3000` | `https://app.ooplix.com,https://ooplix.com` |
| 4 | `RAZORPAY_WEBHOOK_SECRET` | _(empty)_ | From Razorpay Dashboard → Webhooks |
| 5 | `GOOGLE_CLIENT_ID` | _(empty)_ | From Google Cloud Console |
| 6 | `GITHUB_CLIENT_ID` | _(empty)_ | From GitHub OAuth App |
| 7 | `FIREBASE_SERVICE_ACCOUNT` | _(empty)_ | From Firebase Console → Service Accounts |

---

## 2. OAuth Readiness

### Code status ✅ Complete

| Component | File | Status |
|-----------|------|--------|
| Auth URL generation + state nonce | `backend/services/oauthIntegrationLayer.cjs` | ✅ |
| Callback handler | `backend/routes/phase21.js` | ✅ |
| Token exchange | `oauthIntegrationLayer.cjs` | ✅ |
| AES-256-GCM token storage | `oauthIntegrationLayer.cjs` | ✅ |
| Auto-refresh (5min before expiry) | `oauthIntegrationLayer.cjs` | ✅ |
| Remote revocation | `oauthIntegrationLayer.cjs` | ✅ |
| Session logout (cookie clear) | `backend/routes/auth.js` | ✅ |
| CSRF nonce (5-min TTL) | `oauthIntegrationLayer.cjs` | ✅ |

### Credential status

| Provider | Configured | Blocker |
|----------|-----------|--------|
| Google | ❌ | Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| GitHub | ❌ | Set `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` |
| Slack | ❌ | Optional — not a launch blocker |
| Notion | ❌ | Optional — not a launch blocker |

**Callback URLs to register with providers:**
```
Google:  https://app.ooplix.com/oauth/google/callback
GitHub:  https://app.ooplix.com/oauth/github/callback
```

---

## 3. Razorpay Readiness

### Code status ✅ Complete

| Component | File | Status |
|-----------|------|--------|
| Payment link creation | `backend/services/paymentService.js` | ✅ |
| Raw body capture (HMAC) | `backend/middleware/rawBody.js` | ✅ |
| HMAC webhook verification | `paymentService.verifyWebhookSignature()` | ✅ |
| Webhook handler | `backend/controllers/webhookController.js` | ✅ |
| Subscription activation | `webhookController.js` | ✅ |
| Subscription cancellation | `webhookController.js` | ✅ |
| Payment failed handler | `webhookController.js` | ✅ |
| Refund processed handler | `webhookController.js` | ✅ |
| Billing lifecycle (trial/activate/cancel) | `backend/services/billingService.js` | ✅ |
| Billing upgrade endpoint | `backend/routes/billing.js` | ✅ |

### Credential status

| Variable | Status | Action |
|---------|--------|--------|
| `RAZORPAY_KEY_ID` | ✅ Set (live key) | — |
| `RAZORPAY_KEY_SECRET` | ✅ Set | — |
| `RAZORPAY_WEBHOOK_SECRET` | ❌ Missing | Get from Razorpay Dashboard → Webhooks |
| `BASE_URL` | ❌ localhost | Set to `https://app.ooplix.com` |

**Without `RAZORPAY_WEBHOOK_SECRET`, all payment webhooks are rejected in production — payments are never confirmed.**

---

## 4. Flutter Readiness

### Code status ✅ Complete

| Component | File | Status |
|-----------|------|--------|
| App entry + Firebase init | `flutter/lib/main.dart` | ✅ |
| Auth-guard router | `flutter/lib/router.dart` | ✅ |
| Splash screen | `flutter/lib/screens/splash_screen.dart` | ✅ |
| Login (email + Google) | `flutter/lib/screens/login_screen.dart` | ✅ |
| Signup (email + Google) | `flutter/lib/screens/signup_screen.dart` | ✅ |
| Dashboard | `flutter/lib/screens/dashboard_screen.dart` | ✅ |
| Firebase Auth service | `flutter/lib/services/auth_service.dart` | ✅ |
| API service (JWT) | `flutter/lib/services/api_service.dart` | ✅ |
| Material 3 theme (dark + light) | `flutter/lib/theme.dart` | ✅ |

### Configuration status

| Item | Status | Action |
|------|--------|--------|
| `firebase_options.dart` | ❌ 17 placeholder lines | Run `flutterfire configure --project=ooplix-jarvis` |
| `flutter/android/` | ❌ Not initialised | `flutter create .` or `flutter pub get` |
| `google-services.json` | ❌ Not present | Download from Firebase Console |
| `GoogleService-Info.plist` | ❌ Not present | Download from Firebase Console |
| Keystore | ❌ Not generated | `keytool -genkey ...` (see ANDROID_RELEASE_GUIDE.md) |

**Flutter can build and run on device only after `flutterfire configure` is run and `google-services.json` is placed.**

---

## 5. Firebase Readiness

### Code status ✅ Complete

| Component | File | Status |
|-----------|------|--------|
| Admin SDK init (lazy) | `backend/middleware/firebaseAuth.js` | ✅ |
| ID-token `requireAuth` | `backend/middleware/firebaseAuth.js` | ✅ |
| ID-token `optionalAuth` | `backend/middleware/firebaseAuth.js` | ✅ |
| Mobile Auth (email + Google) | `mobile/src/firebase.js` | ✅ |
| Firestore chat + tasks | `mobile/src/firebase.js` | ✅ |
| Flutter Auth (email + Google) | `flutter/lib/services/auth_service.dart` | ✅ |

### Console setup status

| Item | Status | Action |
|------|--------|--------|
| Firebase project created | ❓ Unknown | Create `ooplix-jarvis` at console.firebase.google.com |
| Email/Password auth enabled | ❓ Unknown | Firebase → Authentication → Enable |
| Google sign-in enabled | ❓ Unknown | Firebase → Authentication → Google → Enable |
| Firestore database created | ❓ Unknown | Firebase → Firestore → Create database (asia-south1) |
| Firestore security rules | ❓ Unknown | Publish user-scoped rules (see FIREBASE_PRODUCTION_CHECKLIST.md) |
| Android app registered | ❓ Unknown | Firebase → Add app → Android → `com.ooplix.jarvis` |
| `google-services.json` | ❌ Missing locally | Download after Android app registered |
| iOS app registered | ❓ Unknown | Firebase → Add app → iOS |
| `GoogleService-Info.plist` | ❌ Missing locally | Download after iOS app registered |
| `FIREBASE_SERVICE_ACCOUNT` | ❌ Empty in `.env` | Firebase → Service accounts → Generate key |

---

## 6. Play Store Readiness

### Code / config status

| Item | Status |
|------|--------|
| Package name decided | ⚠️ Must choose: `com.ooplix.jarvis` |
| `AndroidManifest.xml` | ✅ Written (`mobile/android-config/AndroidManifest.xml`) |
| `build.gradle` signing config | ✅ Written (`mobile/android-config/build.gradle.app`) |
| Permissions (INTERNET, NETWORK_STATE) | ✅ Compliant |
| No dangerous permissions | ✅ Confirmed |
| Flutter pubspec.yaml | ✅ Version `1.0.0+1` |
| PM2 ecosystem config | ✅ `ecosystem.config.cjs` |
| nginx.conf | ✅ Written with limit_req zones |

### Missing assets + accounts

| Item | Status | Action |
|------|--------|--------|
| App icon 512×512 PNG | ❌ | Create in Figma/Canva |
| Feature graphic 1024×500 | ❌ | Create in Figma/Canva |
| 5 phone screenshots | ❌ | Capture from emulator |
| Privacy policy live | ❌ | Deploy `mobile/src/pages/PrivacyPolicy.jsx` at `https://app.ooplix.com/privacy` |
| Google Play account | ❓ | pay.google.com/console ($25 one-time) |
| Keystore generated | ❌ | `keytool -genkey ...` (see ANDROID_RELEASE_GUIDE.md) |
| `flutter build appbundle` | ❌ | Requires `google-services.json` + keystore |

---

## Blocker Register — Complete List

### P0 — Must resolve before any production traffic

| # | Blocker | Where to fix | Est. time |
|---|---------|-------------|-----------|
| P0-1 | `BASE_URL=https://app.ooplix.com` | `.env` on VPS | 1 min |
| P0-2 | `APP_URL=https://app.ooplix.com` | `.env` on VPS | 1 min |
| P0-3 | `ALLOWED_ORIGINS=https://app.ooplix.com` | `.env` on VPS | 1 min |
| P0-4 | `RAZORPAY_WEBHOOK_SECRET=<from dashboard>` | Razorpay Dashboard → Webhooks | 5 min |
| P0-5 | `FIREBASE_SERVICE_ACCOUNT=<json>` | Firebase Console → Service Accounts | 10 min |
| P0-6 | `pm2 start ecosystem.config.cjs --env production` on VPS | VPS terminal | 5 min |
| P0-7 | nginx installed + configured + SSL cert | VPS — see DEPLOYMENT_RUNBOOK.md | 30 min |

### P1 — Must resolve before Play Store upload

| # | Blocker | Where to fix | Est. time |
|---|---------|-------------|-----------|
| P1-1 | Firebase project created + auth providers enabled | console.firebase.google.com | 20 min |
| P1-2 | `google-services.json` downloaded to `flutter/android/app/` | Firebase Console | 5 min |
| P1-3 | `flutterfire configure` run (replaces placeholder `firebase_options.dart`) | Terminal | 5 min |
| P1-4 | Keystore generated + backed up | Terminal | 10 min |
| P1-5 | `flutter build appbundle --release` succeeds | Terminal | 20 min |
| P1-6 | App icon 512×512 PNG created | Figma | 30–60 min |
| P1-7 | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set | Google Cloud Console | 10 min |
| P1-8 | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` set | github.com/settings/developers | 5 min |

### P2 — Before public launch (can do post-beta)

| # | Item | Est. time |
|---|------|-----------|
| P2-1 | Feature graphic 1024×500 | 30 min |
| P2-2 | 5 phone screenshots | 30 min |
| P2-3 | Privacy policy live at `https://app.ooplix.com/privacy` | 15 min |
| P2-4 | Google Play Console account ($25) | 5 min |
| P2-5 | Data safety form in Play Console | 15 min |
| P2-6 | Razorpay subscription plan IDs set (`RAZORPAY_PLAN_ID_STARTER` etc.) | 15 min |

---

## Total Estimated Time to Launch

| Phase | Action | Time |
|-------|--------|------|
| VPS deploy (P0) | Set 3 URLs + webhook secret + Firebase SA + PM2 + nginx | ~60 min |
| Firebase setup (P1) | Console setup + flutterfire configure + google-services.json | ~45 min |
| Android build (P1) | Keystore + flutter build appbundle | ~40 min |
| OAuth setup (P1) | Google + GitHub OAuth apps | ~20 min |
| Store assets (P2) | Icon + graphic + screenshots | ~90 min |
| **Total** | | **~4.5 hours** |

---

## Launch Recommendation

**Recommended sequence:**

```
Day 1 (morning):   P0 — VPS deploy, PM2, nginx, SSL, env vars
Day 1 (afternoon): P1 — Firebase, flutterfire, keystore, OAuth
Day 2:             P1 — flutter build appbundle, Play Console upload (Internal Testing)
Day 2-7:           Internal test with yourself + 3-5 trusted testers
Day 8+:            P2 — assets, screenshots, public beta (10 testers)
Day 22+:           Production rollout (Play Store public)
```

**Current status: HOLD — 7 env-var blockers. All code is production-ready.**
