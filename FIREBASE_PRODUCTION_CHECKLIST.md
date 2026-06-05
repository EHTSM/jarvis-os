# Firebase Production Checklist — Ooplix / JARVIS

**Audit date:** 2026-06-05  
**Flutter SDK:** firebase_core ^2.24.2 | firebase_auth ^4.16.0 | google_sign_in ^6.2.1  
**Backend:** `backend/middleware/firebaseAuth.js` (Admin SDK, lazy-init, env-driven)  
**Mobile (Capacitor):** `mobile/src/firebase.js` (Auth + Firestore, env-driven)  
**Flutter:** `flutter/lib/services/auth_service.dart` (Auth + Google Sign-In)

---

## Integration Audit — What Is Already Done

| Component | File | Status |
|-----------|------|--------|
| Firebase Admin init (backend) | `backend/middleware/firebaseAuth.js` | ✅ Code complete |
| ID-token `requireAuth` middleware | `backend/middleware/firebaseAuth.js` | ✅ Code complete |
| ID-token `optionalAuth` middleware | `backend/middleware/firebaseAuth.js` | ✅ Code complete |
| Email/password sign-up + sign-in | `mobile/src/firebase.js` | ✅ Code complete |
| Google Sign-In (Capacitor) | `mobile/src/firebase.js` | ✅ Code complete |
| Firestore chat history | `mobile/src/firebase.js` | ✅ Code complete |
| Firestore task storage | `mobile/src/firebase.js` | ✅ Code complete |
| Flutter email auth | `flutter/lib/services/auth_service.dart` | ✅ Code complete |
| Flutter Google Sign-In | `flutter/lib/services/auth_service.dart` | ✅ Code complete |
| Flutter token refresh | `flutter/lib/services/auth_service.dart` | ✅ Code complete |
| Flutter auth state stream | `flutter/lib/services/auth_service.dart` | ✅ Code complete |
| Flutter `firebase_options.dart` | `flutter/lib/firebase_options.dart` | ⚠️ Placeholders — run `flutterfire configure` |
| FCM push (Flutter) | Not wired | ❌ Phase 2 |
| Firebase Analytics (Flutter) | Not wired | ❌ Phase 2 |
| Firebase Crashlytics (Flutter) | Not wired | ❌ Phase 2 |

---

## Step 1 — Create Firebase Project

**Console:** [console.firebase.google.com](https://console.firebase.google.com)

```
1. Click "Add project"
2. Project name: ooplix-jarvis
3. Project ID: ooplix-jarvis  (auto-generated — accept or customise)
4. Enable Google Analytics: YES
   → Analytics account: "Ooplix Analytics" (create new)
5. Click "Create project"
6. Wait ~30 seconds for provisioning
```

---

## Step 2 — Enable Authentication Providers

**Console:** Firebase project → Build → Authentication → Get started

### 2A. Email/Password
```
Sign-in method tab
→ Email/Password → click "Enable"
→ Email link (passwordless): SKIP for now
→ Save
```

### 2B. Google Sign-In
```
Sign-in method tab
→ Google → click "Enable"
→ Project support email: altamashjauhar@gmail.com
→ Save
```

### 2C. GitHub (optional — for engineering users)
```
Sign-in method tab
→ GitHub → Enable
→ Client ID:     paste GITHUB_CLIENT_ID from .env
→ Client secret: paste GITHUB_CLIENT_SECRET from .env
→ Copy the "Authorization callback URL" shown
→ Go to github.com/settings/developers → your OAuth App
→ Paste that URL into "Authorization callback URL"
→ Save in Firebase
```

---

## Step 3 — Create Firestore Database

**Console:** Build → Firestore Database → Create database

```
1. Start in: production mode
2. Location: asia-south1  (Mumbai — lowest latency for India)
3. Click "Create"
```

### Firestore Security Rules

**Console:** Firestore → Rules tab → paste exactly:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;

      match /messages/{msgId} {
        allow read, write: if request.auth != null
                           && request.auth.uid == userId;
      }

      match /tasks/{taskId} {
        allow read, write: if request.auth != null
                           && request.auth.uid == userId;
      }
    }

    // Block everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Click **Publish**.

---

## Step 4 — Add Android App

**Console:** Project Overview → Add app → Android icon

```
Android package name: com.ooplix.jarvis
App nickname:         Ooplix Android
Debug SHA-1:          (get from command below)
```

**Get SHA-1 fingerprints:**
```bash
# Debug SHA-1 (for development + Google Sign-In testing)
cd flutter/android
./gradlew signingReport 2>/dev/null | grep -A3 "Variant: debug" | grep SHA1

# Release SHA-1 (after keystore generated — see ANDROID_RELEASE_GUIDE.md)
keytool -list -v \
  -keystore ooplix-release.keystore \
  -alias ooplix \
  -storepass <your-store-password> \
  | grep SHA1
```

**Add BOTH fingerprints** in Firebase Console → Project Settings → Your apps → Android app → Add fingerprint.

```
5. Click "Register app"
6. Download google-services.json
7. Place at: flutter/android/app/google-services.json
8. Click "Next" → "Next" → "Continue to console"
```

---

## Step 5 — Add iOS App

**Console:** Project Overview → Add app → iOS icon

```
iOS bundle ID:  com.ooplix.jarvis
App nickname:   Ooplix iOS
App Store ID:   (leave blank for now)
```

```
1. Click "Register app"
2. Download GoogleService-Info.plist
3. Place at: flutter/ios/Runner/GoogleService-Info.plist
4. Open Xcode:
   - Right-click Runner in project navigator
   - "Add Files to Runner"
   - Select GoogleService-Info.plist
   - Ensure "Copy items if needed" is checked
   - Click Add
5. Click "Next" → "Next" → "Continue to console"
```

---

## Step 6 — Run flutterfire configure

**This replaces all REPLACE_WITH_* placeholders in flutter/lib/firebase_options.dart.**

```bash
# Install CLI (once per machine)
dart pub global activate flutterfire_cli

# Add to PATH if needed
export PATH="$PATH:$HOME/.pub-cache/bin"

# Run configuration
cd /Users/ehtsm/jarvis-os/flutter
flutterfire configure \
  --project=ooplix-jarvis \
  --platforms=android,ios

# When prompted, select:
# - android: YES
# - ios: YES
# - web: NO (unless needed)
```

**Verify** — `flutter/lib/firebase_options.dart` should no longer contain `REPLACE_WITH_*`:
```bash
grep "REPLACE_WITH" flutter/lib/firebase_options.dart
# Expected output: (empty — no matches)
```

---

## Step 7 — Firebase Service Account (Backend)

Required for `backend/middleware/firebaseAuth.js` to verify mobile ID tokens.

**Console:** Project Settings → Service accounts tab

```
1. Click "Generate new private key"
2. Click "Generate key"
3. Download JSON file → store securely (treat as password)
```

**Set in backend `.env`:**
```bash
# Compress to single line and set:
FIREBASE_SERVICE_ACCOUNT=$(cat ~/Downloads/ooplix-jarvis-firebase-adminsdk-xxxxx.json | tr -d '\n')

# Or paste manually — ensure it's one line:
# FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"ooplix-jarvis",...}
```

**Verify backend picks it up:**
```bash
pm2 restart jarvis-os   # or: node backend/server.js
curl http://localhost:5050/health | python3 -m json.tool | grep firebase
# Expected: "firebase": true
```

---

## Step 8 — Google Sign-In SHA-1 Registration

Google Sign-In on Android **will fail silently** without the SHA-1 fingerprint registered in Firebase.

```
Firebase Console → Project Settings → Your apps → Android app
→ Add fingerprint
→ Paste debug SHA-1 (from Step 4)
→ Save

After keystore generated:
→ Add fingerprint again
→ Paste RELEASE SHA-1
→ Save
→ Re-download google-services.json (it now embeds both fingerprints)
→ Replace flutter/android/app/google-services.json
```

---

## Step 9 — FCM Push Notifications (Phase 2)

**Do after core launch. Steps for reference.**

### Add to flutter/pubspec.yaml:
```yaml
dependencies:
  firebase_messaging: ^14.7.10
  flutter_local_notifications: ^16.3.0
```

### Add to flutter/lib/main.dart (after Firebase.initializeApp):
```dart
// Request permission (iOS + Android 13+)
final messaging = FirebaseMessaging.instance;
await messaging.requestPermission(alert: true, badge: true, sound: true);

// Get FCM token and send to backend
final token = await messaging.getToken();
if (token != null) {
  await apiService.post('/api/devices/register', body: {'fcmToken': token});
}

// Handle background messages
FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
```

### Add to AndroidManifest.xml:
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<service android:name=".MyFirebaseMessagingService" android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

---

## Step 10 — Firebase Analytics (Phase 2)

```yaml
# flutter/pubspec.yaml
dependencies:
  firebase_analytics: ^10.8.0
```

```dart
// In main.dart — after Firebase.initializeApp():
await FirebaseAnalytics.instance.logAppOpen();

// Key events to log:
await FirebaseAnalytics.instance.logEvent(name: 'ai_chat_sent');
await FirebaseAnalytics.instance.logEvent(name: 'upgrade_tapped', parameters: {'plan': 'starter'});
await FirebaseAnalytics.instance.logEvent(name: 'payment_completed', parameters: {'amount': 999});
```

---

## Step 11 — Firebase Crashlytics (Phase 2)

```yaml
# flutter/pubspec.yaml
dependencies:
  firebase_crashlytics: ^3.4.9
```

```dart
// Replace main() body with:
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
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
FIREBASE PROJECT
[ ] Project "ooplix-jarvis" created in Firebase Console
[ ] Google Analytics enabled on project

AUTHENTICATION
[ ] Email/Password sign-in enabled
[ ] Google sign-in enabled (support email: altamashjauhar@gmail.com)

FIRESTORE
[ ] Database created (asia-south1, production mode)
[ ] Security rules published (user-scoped read/write)

ANDROID APP
[ ] Android app registered (com.ooplix.jarvis)
[ ] Debug SHA-1 fingerprint added
[ ] Release SHA-1 fingerprint added (after keystore generated)
[ ] google-services.json at flutter/android/app/google-services.json

IOS APP
[ ] iOS app registered (com.ooplix.jarvis)
[ ] GoogleService-Info.plist at flutter/ios/Runner/GoogleService-Info.plist
[ ] Plist added to Xcode project (not just copied)

FLUTTER CONFIG
[ ] flutterfire configure run successfully
[ ] flutter/lib/firebase_options.dart has NO REPLACE_WITH_* placeholders
[ ] flutter pub get succeeds

BACKEND
[ ] Service account JSON downloaded
[ ] FIREBASE_SERVICE_ACCOUNT set in backend .env (single-line JSON)
[ ] Server restarted
[ ] GET /health returns "firebase": true (or svcStatus.firebase: true)

FUNCTIONAL TEST
[ ] Email sign-up creates user in Firebase Console → Authentication → Users
[ ] Email login returns JWT cookie
[ ] Google Sign-In completes on physical Android device (requires SHA-1 + google-services.json)
[ ] Backend /auth/me returns user after Firebase mobile login
```

---

## Remaining Blockers

| # | Blocker | Console / Command | Time |
|---|---------|------------------|------|
| 1 | Create Firebase project | console.firebase.google.com | 5 min |
| 2 | Enable Email + Google auth | Firebase → Authentication | 3 min |
| 3 | Create Firestore + publish rules | Firebase → Firestore | 5 min |
| 4 | Add Android app + SHA-1 + download google-services.json | Firebase → Project Settings | 10 min |
| 5 | Add iOS app + download GoogleService-Info.plist | Firebase → Project Settings | 5 min |
| 6 | `flutterfire configure` | Terminal | 5 min |
| 7 | Download service account + set FIREBASE_SERVICE_ACCOUNT | Firebase → Service Accounts | 10 min |
| 8 | Add release SHA-1 (after keystore) | Firebase → Project Settings | 5 min |

**Total estimated time: ~48 minutes of manual console work.**
