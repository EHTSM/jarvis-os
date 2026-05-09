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
6. Go to **Service Accounts** → Generate new private key → save as JSON

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

Add to backend `.env` (for token verification):

```env
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}
```

(Paste the full service account JSON as a single line)

---

## Step 3 — Install dependencies

```bash
cd mobile
npm install
```

Install Firebase Admin in backend:

```bash
cd ..                      # back to project root
npm install firebase-admin
```

---

## Step 4 — Add Android platform

```bash
cd mobile
npx cap add android
```

This creates the `mobile/android/` directory with a full Android Studio project.

Copy the reference configs:

```bash
# Replace the generated AndroidManifest with the Play-Store-safe version
cp android-config/AndroidManifest.xml android/app/src/main/AndroidManifest.xml
```

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
| `BUILD FAILED: minSdk` | Ensure `minSdkVersion 23` in `build.gradle` |
| Firebase auth error | Check all `REACT_APP_FIREBASE_*` values in `.env` match your project |
| Backend 401 on mobile | Set `FIREBASE_SERVICE_ACCOUNT` in backend `.env` |
| White screen on device | Check browser console via `chrome://inspect` — likely API URL is wrong |
| `npx cap sync` fails | Run `npm run build` first, then `npx cap sync android` |

---

## Project structure (final)

```
jarvis-os/
├── backend/                    Node.js API server (port 5050)
│   ├── middleware/
│   │   └── firebaseAuth.js     Firebase token verification
│   ├── routes/jarvis.js        Updated with optionalAuth middleware
│   └── server.js
├── frontend/                   Web app (port 3000) — unchanged
├── electron/                   Desktop app — unchanged
└── mobile/                     ← NEW Android app
    ├── .env.example            Environment template
    ├── capacitor.config.ts     Capacitor configuration
    ├── package.json
    ├── android/                Generated by `npx cap add android`
    ├── android-config/
    │   ├── AndroidManifest.xml Play-Store-safe permissions
    │   └── build.gradle.app    Release signing config
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
