# Firebase Setup Guide — JARVIS-OS / Ooplix

**Date:** 2026-06-05  
**Backend Firebase middleware:** `backend/middleware/firebaseAuth.js` ✅  
**Mobile Firebase SDK:** `mobile/src/firebase.js` ✅ (Capacitor/React)  
**Flutter Firebase:** `flutter/lib/firebase_options.dart` ⚠️ (placeholder — needs `flutterfire configure`)

---

## What Is Already Implemented

| Component | Code Location | Status |
|-----------|--------------|--------|
| Firebase Admin ID-token verification | `backend/middleware/firebaseAuth.js` | ✅ Done |
| `requireAuth` / `optionalAuth` middleware | `backend/middleware/firebaseAuth.js` | ✅ Done |
| Firebase Auth (email + Google) — Capacitor | `mobile/src/firebase.js` | ✅ Done |
| Firestore chat history + tasks | `mobile/src/firebase.js` | ✅ Done |
| Firebase Auth (email + Google) — Flutter | `flutter/lib/services/auth_service.dart` | ✅ Done |
| Flutter `firebase_options.dart` scaffold | `flutter/lib/firebase_options.dart` | ⚠️ Placeholder |
| FCM push (backend send) | Not yet wired | ❌ Phase 2 |
| Firebase Analytics | Not yet wired | ❌ Phase 2 |
| Firebase Crashlytics | Not yet wired | ❌ Phase 2 |

---

## Step 1 — Create Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**
3. Name: **ooplix-jarvis**
4. Enable Google Analytics: **Yes** (required for Crashlytics + A/B testing)
5. Analytics account: create new or use existing Google Analytics property
6. Click **Create project**

---

## Step 2 — Enable Authentication

In Firebase Console → **Build → Authentication → Get started**

### Enable sign-in providers:

**Email/Password:**
1. Sign-in method tab → **Email/Password** → Enable
2. Email link (passwordless): Optional — skip for now

**Google:**
1. Sign-in method tab → **Google** → Enable
2. Project support email: `altamashjauhar@gmail.com`
3. Save

**GitHub (optional — for engineering users):**
1. Sign-in method tab → **GitHub** → Enable
2. Client ID: `<GITHUB_CLIENT_ID from .env>`
3. Client secret: `<GITHUB_CLIENT_SECRET from .env>`
4. Callback URL (copy and add to GitHub OAuth app): `https://ooplix-jarvis.firebaseapp.com/__/auth/handler`

---

## Step 3 — Firestore Database

1. Firebase Console → **Build → Firestore Database → Create database**
2. Start in **production mode**
3. Location: `asia-south1` (Mumbai — closest to India users)

### Security Rules

Go to **Firestore → Rules** → paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only read/write their own profile and subcollections
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /messages/{msgId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      match /tasks/{taskId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Block all other paths by default
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Click **Publish**.

---

## Step 4 — Add Android App

1. Firebase Console → Project Overview → **Add app** → Android icon
2. Android package name: `com.ooplix.jarvis`
3. App nickname: `Ooplix Android`
4. SHA-1 (required for Google Sign-In):

```bash
# Get your debug SHA-1
cd flutter/android
./gradlew signingReport 2>/dev/null | grep "SHA1" | head -1

# Get your release SHA-1 (after keystore generated)
keytool -list -v \
  -keystore ooplix-release.keystore \
  -alias ooplix \
  | grep "SHA1"
```

5. Register app → **Download `google-services.json`**
6. Place file at: `flutter/android/app/google-services.json`

---

## Step 5 — Add iOS App

1. Firebase Console → **Add app** → iOS icon
2. iOS bundle ID: `com.ooplix.jarvis`
3. App nickname: `Ooplix iOS`
4. Register → **Download `GoogleService-Info.plist`**
5. Place file at: `flutter/ios/Runner/GoogleService-Info.plist`
6. Open Xcode → right-click Runner → **Add Files to Runner** → select `GoogleService-Info.plist`
7. Make sure **Copy items if needed** is checked

---

## Step 6 — Run flutterfire configure

```bash
# Install CLI (once)
dart pub global activate flutterfire_cli

cd flutter

# Configure — selects project and generates firebase_options.dart
flutterfire configure \
  --project=ooplix-jarvis \
  --platforms=android,ios

# This REPLACES flutter/lib/firebase_options.dart with real values
```

Verify `lib/firebase_options.dart` no longer contains `REPLACE_WITH_*` placeholders.

---

## Step 7 — Backend Service Account

Required for: server-side Firebase ID token verification (`backend/middleware/firebaseAuth.js`)

1. Firebase Console → **Project Settings** → **Service accounts** tab
2. Click **Generate new private key** → **Generate key**
3. Download JSON file (keep secret — treat like a password)
4. Add to backend `.env`:

```bash
# Paste the entire JSON as a single line (use jq to compress):
FIREBASE_SERVICE_ACCOUNT=$(cat path/to/serviceAccountKey.json | jq -c .)
```

Or manually compress and paste:
```env
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"ooplix-jarvis","private_key_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxx@ooplix-jarvis.iam.gserviceaccount.com",...}
```

**Restart server after setting this.**

Verify:
```bash
curl -s http://localhost:5050/health | grep firebase
# Expected: "firebase": true  (in svcStatus)
```

---

## Step 8 — FCM Push Notifications

**Phase 2 item — implement after core launch. Steps documented here for reference.**

### Backend setup

```bash
npm install firebase-admin  # already installed if FIREBASE_SERVICE_ACCOUNT works
```

Create `backend/services/fcmService.cjs`:
```javascript
"use strict";
const admin = require("firebase-admin");

function send(token, title, body, data = {}) {
  return admin.messaging().send({
    token,
    notification: { title, body },
    data,
    android: { priority: "high" },
  });
}

function sendToTopic(topic, title, body, data = {}) {
  return admin.messaging().send({
    topic,
    notification: { title, body },
    data,
  });
}

module.exports = { send, sendToTopic };
```

### Flutter setup

Add to `flutter/pubspec.yaml`:
```yaml
dependencies:
  firebase_messaging: ^14.7.10
  flutter_local_notifications: ^16.3.0
```

Add to `flutter/lib/services/`:
```dart
// notification_service.dart
import 'package:firebase_messaging/firebase_messaging.dart';

class NotificationService {
  final _fcm = FirebaseMessaging.instance;

  Future<void> init() async {
    await _fcm.requestPermission(alert: true, badge: true, sound: true);
    final token = await _fcm.getToken();
    // Send token to your backend: POST /api/devices/register { token }
  }
}
```

Add to `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<service android:name=".MyFirebaseMessagingService" android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

---

## Step 9 — Firebase Analytics

**Phase 2 item.** Add after launch.

```yaml
# flutter/pubspec.yaml
dependencies:
  firebase_analytics: ^10.8.0
```

```dart
// In main.dart, after Firebase.initializeApp():
final analytics = FirebaseAnalytics.instance;
await analytics.logAppOpen();

// Log custom events:
await analytics.logEvent(
  name: 'ai_chat_sent',
  parameters: {'input_length': message.length},
);
```

Analytics data appears in Firebase Console → **Analytics** within 24 hours.

---

## Step 10 — Firebase Crashlytics

**Phase 2 item.** Add after launch.

```yaml
# flutter/pubspec.yaml
dependencies:
  firebase_crashlytics: ^3.4.9
```

```dart
// In main.dart — wrap entire app:
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // Catch Flutter framework errors
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;

  // Catch async errors outside Flutter
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };

  runApp(const ProviderScope(child: JarvisApp()));
}
```

---

## Verification Checklist

```
[ ] Firebase project "ooplix-jarvis" created
[ ] Email/Password sign-in enabled
[ ] Google sign-in enabled (support email set)
[ ] Firestore database created (asia-south1)
[ ] Firestore security rules published (user-scoped)
[ ] Android app added (package: com.ooplix.jarvis)
[ ] SHA-1 fingerprints added (debug + release)
[ ] google-services.json downloaded → flutter/android/app/
[ ] iOS app added (bundle: com.ooplix.jarvis)
[ ] GoogleService-Info.plist downloaded → flutter/ios/Runner/
[ ] flutterfire configure run → firebase_options.dart has real values
[ ] Service account JSON downloaded
[ ] FIREBASE_SERVICE_ACCOUNT set in backend .env
[ ] Server restarted — /health shows firebase: true
[ ] Flutter app boots and reaches Dashboard without Firebase errors
[ ] Email sign-up creates user in Firebase Console → Authentication → Users
[ ] Google sign-in completes (requires SHA-1 fingerprint)
```

---

## Remaining Manual Blockers

| Priority | Item | Time |
|----------|------|------|
| **P0** | Create Firebase project `ooplix-jarvis` | 5 min |
| **P0** | Enable Email/Password + Google auth | 5 min |
| **P0** | Add Android app + SHA-1 + download `google-services.json` | 10 min |
| **P0** | Run `flutterfire configure` | 5 min |
| **P0** | Download service account JSON + set `FIREBASE_SERVICE_ACCOUNT` | 10 min |
| **P1** | Create Firestore + publish security rules | 10 min |
| **P1** | Add iOS app + `GoogleService-Info.plist` | 10 min |
| **P2** | FCM push notifications (Phase 2) | 2–4 hours |
| **P2** | Analytics + Crashlytics (Phase 2) | 1 hour |
