# JARVIS AI — Android Build Guide

## Prerequisites

Install these once on your machine:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | https://nodejs.org |
| Java JDK | 17 | https://adoptium.net |
| Android Studio | Latest | https://developer.android.com/studio |
| Android SDK | API 34 | Via Android Studio → SDK Manager |

Set these environment variables in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk          # macOS
export ANDROID_HOME=$HOME/Android/Sdk                  # Linux
export ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk         # Windows
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/tools
```

---

## Step 1 — Firebase Setup

1. Go to https://console.firebase.google.com → **Create project** (name: "jarvis-ai")
2. Enable **Authentication** → Sign-in method → **Email/Password** → Enable
3. Create **Firestore Database** → Start in **production mode** → region closest to you
4. Add Firestore security rules (in Firebase Console → Firestore → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /messages/{msgId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      match /tasks/{taskId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

5. Go to **Project Settings** → **Your apps** → Add **Web app** → Copy config

---

## Step 2 — Environment Variables

```bash
cd mobile
cp .env.example .env
```

Edit `.env` with your real values:

```env
REACT_APP_API_URL=https://your-deployed-backend.com
REACT_APP_FIREBASE_API_KEY=AIzaSy...
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789
REACT_APP_FIREBASE_APP_ID=1:123456789:web:abc123
REACT_APP_VERSION=1.0.0
```

**Backend auth architecture (updated — the flow below has changed since this
guide was first written):** the app exchanges its Firebase ID token for a
JARVIS-signed session JWT once, via `POST /api/auth/firebase-session`
(`backend/routes/auth.js`), then sends that JWT as `Authorization: Bearer` on
every subsequent request (`mobile/src/api.js`) — not the raw Firebase ID
token, and not a cookie (a Capacitor WebView's cross-origin cookie handling
is unreliable). Server-side Firebase ID-token verification inside
`firebase-session` is **optional and currently unwired**: `firebase-admin`
is not a `package.json` dependency and `admin.initializeApp()` is never
called anywhere in this backend, so in `NODE_ENV=production` that route
returns `503 Firebase auth not configured` until an operator wires it (see
Step 3); outside production it logs a warning and skips verification
(accepts the claimed email as-is — dev-only). No `FIREBASE_SERVICE_ACCOUNT`
env var exists anywhere in this codebase — that was this guide's own stale
description of an approach that was never implemented this way.

---

## Step 3 — Install dependencies

```bash
cd mobile
npm install
```

**Optional — wire real server-side Firebase ID-token verification:** the
mobile-facing `/api/auth/firebase-session` route already has a real,
working code path for this (`backend/routes/auth.js`'s `_firebaseAdmin()`),
it is just unwired by default. To activate it:

```bash
cd ..                      # back to project root
npm install firebase-admin
```

Then call `admin.initializeApp()` once at backend startup with real
credentials (e.g. `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-
account JSON file, Firebase Admin SDK's own standard mechanism — not a
repo-specific env var). Until this is done, `firebase-session` trusts the
caller-claimed email in development only, and hard-fails (503) in
production rather than silently accepting an unverified identity — this is
intentional fail-closed behavior per this repo's own security rules, not a
bug to work around.

---

## Step 4 — Add Android platform

```bash
cd mobile
npx cap add android
```

This creates the `mobile/android/` directory with a full Android Studio
project. **If this is a fresh `npx cap add android` run** (not this repo's
already-configured `mobile/android/`, which has the fixes below applied
directly to the live files), reconcile the generated files against the
real, current production configuration rather than copying
`android-config/AndroidManifest.xml` wholesale — that reference file itself
predates several since-added production fixes and is missing real,
required pieces of the live build (the `capacitor.build.gradle` apply, the
`google-services.json` conditional, `namespace`, etc.). Compare field-by-
field: `android:allowBackup`/`fullBackupContent`/`dataExtractionRules`
(backup exclusion for the WebView-held session token — see
`android/app/src/main/res/xml/backup_rules.xml` and
`data_extraction_rules.xml`), `usesCleartextTraffic="false"`, and the
`signingConfigs.release`/`minifyEnabled`/`shrinkResources` block in
`android/app/build.gradle` (see Step 7 below — already wired in this
repo's live file).

---

## Step 5 — Build and sync

```bash
cd mobile
npm run cap:sync           # builds React app + syncs to Android
```

This runs:
1. `npm run build` — creates `mobile/build/` (optimised production React bundle)
2. `npx cap sync android` — copies web assets into the Android project

Run this command every time you change React code.

---

## Step 6 — Test on device / emulator

**Option A — Android Studio (recommended)**

```bash
npm run cap:open           # opens Android Studio
```

In Android Studio:
- Wait for Gradle sync to complete (first run takes 3–5 minutes)
- Select your device (emulator or USB-connected phone — enable USB debugging)
- Click the green **Run** button ▶

**Option B — Command line (device connected via USB)**

```bash
npm run cap:run            # detects connected device and deploys
```

---

## Step 7 — Generate release keystore

`android/app/build.gradle`'s `signingConfigs.release` block (env-var-sourced,
below) is already wired in this repo's live file — nothing to add there.
This step only generates the actual keystore file, which is deliberately
never committed to this repo (confirmed absent — `mobile/android-config/`
holds only the reference config, not a real key).

Run **once** — keep the keystore file safe (you need it for every future update):

```bash
keytool -genkey -v \
  -keystore jarvis-release.keystore \
  -alias jarvis \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

You will be prompted for passwords and organisation info. Store the keystore and both passwords securely — **losing the keystore means you cannot update your app on the Play Store**.

---

## Step 8 — Build signed AAB

### Via Android Studio (easiest)

1. Open Android Studio (`npm run cap:open`)
2. Menu → **Build** → **Generate Signed Bundle / APK**
3. Select **Android App Bundle (.aab)**
4. Click **Next** → locate your keystore file → enter passwords
5. Select **release** build variant
6. Click **Finish**

Output file: `android/app/release/app-release.aab`

### Via command line

```bash
cd android

# Set signing credentials as env vars (never hardcode)
export KEYSTORE_PATH=../jarvis-release.keystore
export KEYSTORE_PASSWORD=your_store_password
export KEY_ALIAS=jarvis
export KEY_PASSWORD=your_key_password

# Build AAB
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

---

## Step 9 — Play Store submission checklist

### App content rating
- Complete the content rating questionnaire in Play Console
- JARVIS AI category: **Business** / **Productivity**
- Likely rating: **Everyone**

### Required assets
| Asset | Size | Notes |
|-------|------|-------|
| App icon | 512×512 PNG | No alpha, no rounded corners (Play adds them) |
| Feature graphic | 1024×500 PNG | Used on store listing |
| Screenshots | Min 2 phone screenshots | Capture from emulator |
| Short description | Max 80 chars | "AI-powered business assistant & automation" |
| Full description | Max 4000 chars | See template below |

### Store listing — description template

```
JARVIS AI is your intelligent business assistant powered by advanced AI.

FEATURES:
• AI Chat — Ask anything, get instant business advice
• Task Generator — Break goals into actionable step-by-step plans
• Payment Links — Generate Razorpay payment links instantly
• CRM & Leads — View and manage your customer pipeline
• WhatsApp Follow-up — Send targeted follow-up messages
• Dashboard — Real-time business metrics and conversion tracking

JARVIS AI helps entrepreneurs and businesses:
✓ Automate lead follow-ups
✓ Generate AI-powered sales scripts
✓ Create and track payment links
✓ Get instant answers to business questions

PERMISSIONS USED:
• Internet — Required to connect to JARVIS AI backend
• Network State — To detect connectivity and show offline status

No camera, microphone, location, contacts, or storage access required.
```

### Data safety form (Play Console)
- **Data collected:** Email address (required, account management)
- **Data shared with third parties:** Firebase (Google), Razorpay
- **Data encrypted in transit:** Yes
- **User can request deletion:** Yes (via email)

---

## Step 10 — Upload to Play Store

1. Go to https://play.google.com/console
2. Create app → **Android** → **Free** (or paid)
3. Complete all store listing fields
4. Upload AAB: **Release** → **Production** → **Create new release** → Upload `.aab`
5. Complete content rating, pricing, and distribution
6. Submit for review (typically 1–3 days)

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `SDK location not found` | Set `ANDROID_HOME` env var, or create `android/local.properties` with `sdk.dir=/path/to/sdk` |
| `Gradle sync failed` | File → Invalidate Caches → Restart in Android Studio |
| `BUILD FAILED: minSdk` | Ensure `minSdkVersion` in `android/variables.gradle` matches your target device (live value: 22) |
| Firebase auth error | Check all `REACT_APP_FIREBASE_*` values in `.env` match your project |
| Backend 401 on mobile | Confirm `POST /api/auth/firebase-session` is reachable and returning `{success:true, token}` — see Step 2's "Backend auth architecture" note; this is not fixed by any backend `.env` var, only by the mobile app actually calling this route after Firebase sign-in (already wired in `mobile/src/context/AuthContext.jsx`) |
| `Keystore file ... not found for signing config 'release'` | Expected if `KEYSTORE_PATH`/`KEYSTORE_PASSWORD`/`KEY_ALIAS`/`KEY_PASSWORD` aren't set — see Step 7. `assembleDebug`/`bundleDebug` are unaffected and need no signing config. |
| White screen on device | Check browser console via `chrome://inspect` — likely API URL is wrong |
| `npx cap sync` fails | Run `npm run build` first, then `npx cap sync android` |

---

## Project structure (final)

```
jarvis-os/
├── backend/                    Node.js API server (port 5050)
│   ├── routes/auth.js          POST /api/auth/firebase-session (exchanges
│   │                           the Firebase ID token for a JARVIS session
│   │                           JWT — see Step 2's "Backend auth
│   │                           architecture" note; no separate
│   │                           firebaseAuth.js middleware exists)
│   ├── routes/jarvis.js
│   └── server.js
├── frontend/                   Web app (port 3000) — unchanged
├── electron/                   Desktop app — unchanged
└── mobile/                     Android app (Capacitor)
    ├── .env.example            Environment template
    ├── capacitor.config.ts     Capacitor configuration
    ├── package.json
    ├── android/                Live Capacitor Android project — signing
    │                           config, backup-exclusion rules (res/xml/),
    │                           and manifest hardening already applied
    │                           directly to these files (see Steps 4/7/8)
    ├── android-config/
    │   ├── AndroidManifest.xml Reference template only — the LIVE file at
    │   │                       android/app/src/main/AndroidManifest.xml is
    │   │                       authoritative; this template predates
    │   │                       several since-added production fixes and
    │   │                       should not be copied wholesale (see Step 4)
    │   └── build.gradle.app    Reference template only — same caveat;
    │                           android/app/build.gradle is authoritative
    ├── public/
    │   ├── index.html
    │   └── manifest.json
    └── src/
        ├── index.jsx
        ├── App.jsx             Router + auth guard
        ├── firebase.js         Auth + Firestore helpers
        ├── api.js              Mobile-safe API client (blocks OS commands)
        ├── context/
        │   ├── AuthContext.jsx Firebase auth state
        │   └── ToastContext.jsx Global toast notifications
        ├── pages/
        │   ├── Login.jsx
        │   ├── Signup.jsx
        │   ├── Home.jsx        AI Chat (Firestore-backed history)
        │   ├── Tools.jsx       Task Gen, Payments, CRM, WA Follow-up
        │   ├── Dashboard.jsx   Real-time business metrics
        │   ├── Profile.jsx     User info + logout
        │   ├── PrivacyPolicy.jsx
        │   └── Terms.jsx
        ├── components/
        │   └── BottomNav.jsx   4-tab mobile navigation
        └── styles/
            └── global.css      Full mobile design system
```
