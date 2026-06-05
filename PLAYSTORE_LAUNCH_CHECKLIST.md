# Play Store Launch Checklist — JARVIS / Ooplix

**Audit date:** 2026-06-05  
**App ID (current):** `com.jarvisai.app` (Capacitor) / `com.ooplix.jarvis` (Flutter)  
**Target SDK:** 34 (Android 14)  
**Min SDK:** 23 (Android 6.0 — covers 99%+ of active devices)

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done — confirmed in code |
| ⚠️ | Partial — needs action |
| ❌ | Blocked — must complete before upload |

---

## 1. Package Name & Identity

| Item | Status | Detail |
|------|--------|--------|
| Package name chosen | ⚠️ | Decide: `com.ooplix.jarvis` (Flutter) OR `com.jarvisai.app` (Capacitor). **Pick one. Cannot change after first upload.** |
| Package name consistent across all files | ❌ | Update to match in: `flutter/pubspec.yaml`, `flutter/lib/firebase_options.dart`, `AndroidManifest.xml`, `build.gradle` |
| App name set | ✅ | `JARVIS AI` in `capacitor.config.ts`, `JARVIS` in Flutter theme |
| App name final | ⚠️ | Confirm: `Ooplix` or `JARVIS AI`? Store listing name locks in at first publish |

**Action:**
```
Recommended package name: com.ooplix.jarvis
Recommended app name:     Ooplix
```

---

## 2. AndroidManifest.xml

**Current file:** `mobile/android-config/AndroidManifest.xml` ✅

| Item | Status | Detail |
|------|--------|--------|
| `android.permission.INTERNET` | ✅ | Present |
| `android.permission.ACCESS_NETWORK_STATE` | ✅ | Present |
| No dangerous permissions | ✅ | READ_CONTACTS, CAMERA, LOCATION, STORAGE — all absent |
| `android:exported="true"` on launcher activity | ✅ | Required for Android 12+ |
| `android:usesCleartextTraffic="false"` | ✅ | Production HTTPS enforced |
| `android:allowBackup` | ✅ | Set to `true` — acceptable |
| Deep link intent filter | ❌ | Add OAuth redirect intent filter for `com.ooplix.jarvis://auth` |
| FCM receiver | ❌ | Add `FirebaseMessagingService` declaration when FCM enabled |

**Add to AndroidManifest before launch:**
```xml
<!-- OAuth deep link — for Google/GitHub callback on mobile -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="com.ooplix.jarvis" android:host="auth" />
</intent-filter>

<!-- FCM — add when firebase_messaging added to pubspec -->
<service
    android:name=".MyFirebaseMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

---

## 3. Permissions Audit

| Permission | Declared | Required | Play Store Risk |
|-----------|---------|---------|----------------|
| INTERNET | ✅ | Yes | None |
| ACCESS_NETWORK_STATE | ✅ | Yes | None |
| RECEIVE_BOOT_COMPLETED | ❌ | No | Do not add |
| CAMERA | ❌ | No | Do not add |
| READ_CONTACTS | ❌ | No | Do not add |
| ACCESS_FINE_LOCATION | ❌ | No | Do not add |
| READ_EXTERNAL_STORAGE | ❌ | No | Do not add |
| POST_NOTIFICATIONS | ⚠️ | Yes (FCM) | Low — add when enabling push |

**For FCM push notifications, add:**
```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

---

## 4. Firebase Configuration

| Item | Status | Detail |
|------|--------|--------|
| `google-services.json` in `android/app/` | ❌ | Must download from Firebase Console |
| `GoogleService-Info.plist` in `ios/Runner/` | ❌ | Must download from Firebase Console |
| `firebase_options.dart` populated | ❌ | Run `flutterfire configure` — current file has placeholder values |
| Firebase Auth enabled (Email/Password) | ⚠️ | Enable in Firebase Console → Authentication |
| Firebase Auth enabled (Google) | ⚠️ | Enable in Firebase Console → Authentication → Google |
| Firebase project ID matches app ID | ❌ | Create project `ooplix-jarvis` in Firebase Console |
| `FIREBASE_SERVICE_ACCOUNT` set in backend `.env` | ❌ | Required for server-side token verification |

**Commands:**
```bash
cd flutter
dart pub global activate flutterfire_cli
flutterfire configure --project=ooplix-jarvis
# Generates lib/firebase_options.dart with real values
```

---

## 5. App Icons

| Item | Status | Spec |
|------|--------|------|
| Launcher icon 512×512 PNG | ❌ | No alpha channel, no rounded corners (Play applies adaptive rounding) |
| Adaptive icon foreground | ❌ | `ic_launcher_foreground.png` — subject area in centre 66px safe zone |
| Adaptive icon background | ❌ | Solid colour or pattern layer |
| Notification icon | ❌ | White silhouette, transparent background, 24×24dp minimum |
| Flutter app icon configured | ❌ | Add `flutter_launcher_icons` to pubspec |

**Add to `flutter/pubspec.yaml` dev_dependencies:**
```yaml
dev_dependencies:
  flutter_launcher_icons: ^0.13.1

flutter_launcher_icons:
  android: true
  ios: true
  image_path: "assets/icons/app_icon_1024.png"
  adaptive_icon_background: "#6366F1"
  adaptive_icon_foreground: "assets/icons/app_icon_foreground.png"
  min_sdk_android: 23
```

**Then run:**
```bash
cd flutter
flutter pub get
dart run flutter_launcher_icons
```

---

## 6. Splash Screen

| Item | Status | Detail |
|------|--------|--------|
| Capacitor splash config | ✅ | `launchShowDuration: 2000`, `backgroundColor: #0a0a0f` |
| Flutter splash (code) | ✅ | `SplashScreen` widget with fade + 2s delay |
| Android native splash resource | ❌ | `android/app/src/main/res/drawable/splash.png` missing |
| Flutter native splash | ❌ | Add `flutter_native_splash` package |

**Add to `flutter/pubspec.yaml`:**
```yaml
dev_dependencies:
  flutter_native_splash: ^2.3.13

flutter_native_splash:
  color: "#0F0F14"
  image: assets/images/splash_logo.png
  android_12:
    color: "#0F0F14"
    image: assets/images/splash_logo.png
```

**Then run:**
```bash
dart run flutter_native_splash:create
```

---

## 7. Versioning

| Item | Status | Value |
|------|--------|-------|
| Version name | ✅ | `1.0.0` (pubspec.yaml) |
| Version code | ✅ | `1` (pubspec.yaml: `1.0.0+1`) |
| Play Store upload version | ❌ | Each upload must increment `versionCode` |

**pubspec.yaml version format:**
```yaml
version: 1.0.0+1
#         ^^^^^  version name (shown to users)
#               ^ version code (must increment on each upload)
```

**Version bump before each upload:**
```bash
# Increment version code in pubspec.yaml: 1.0.0+1 → 1.0.0+2
flutter build appbundle
```

---

## 8. Signing

| Item | Status | Detail |
|------|--------|--------|
| Keystore file exists | ❌ | Must generate once and keep safe forever |
| Keystore backed up | ❌ | Store in password manager + offline backup |
| Signing config in `build.gradle` | ✅ | Present in `mobile/android-config/build.gradle.app` |
| Env vars for CI signing | ✅ | `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` pattern set |

**Generate keystore (run once):**
```bash
keytool -genkey -v \
  -keystore ooplix-release.keystore \
  -alias ooplix \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=Ooplix, OU=Engineering, O=Ooplix, L=India, S=India, C=IN"
```

**CRITICAL:** If you lose the keystore, you cannot update the app. Store it in:
- Google Drive (encrypted)
- Password manager attachment
- Offline USB backup

**For Flutter `build.gradle` (`flutter/android/app/build.gradle`):**
```groovy
signingConfigs {
    release {
        storeFile     file(System.getenv("KEYSTORE_PATH") ?: "../../ooplix-release.keystore")
        storePassword System.getenv("KEYSTORE_PASSWORD") ?: ""
        keyAlias      System.getenv("KEY_ALIAS")         ?: "ooplix"
        keyPassword   System.getenv("KEY_PASSWORD")      ?: ""
    }
}
```

---

## 9. Build Configuration

| Item | Status | Detail |
|------|--------|--------|
| `minSdkVersion 23` | ✅ | Set in Capacitor `build.gradle.app` |
| Flutter `minSdkVersion` | ❌ | Must set in `flutter/android/app/build.gradle` after `flutter create` |
| `targetSdkVersion 34` | ✅ | Set in Capacitor `build.gradle.app` |
| ProGuard/R8 enabled | ✅ | `minifyEnabled true` + `shrinkResources true` |
| AAB format | ✅ | `bundle { language/density/abi split = true }` |
| `compileSdkVersion 34` | ✅ | Set |

**Flutter build command:**
```bash
cd flutter

# Set signing env vars
export KEYSTORE_PATH=/path/to/ooplix-release.keystore
export KEYSTORE_PASSWORD=your_store_password
export KEY_ALIAS=ooplix
export KEY_PASSWORD=your_key_password

# Build App Bundle (Play Store format)
flutter build appbundle --release \
  --dart-define=API_URL=https://app.ooplix.com

# Output: build/app/outputs/bundle/release/app-release.aab
```

---

## 10. Play Console Requirements

| Item | Status | Detail |
|------|--------|--------|
| Google Play developer account | ⚠️ | $25 one-time fee at play.google.com/console |
| App created in Play Console | ❌ | Create before first upload |
| Content rating completed | ❌ | Complete questionnaire (IARC rating) |
| Privacy policy URL live | ⚠️ | `/privacy` route exists in mobile app — deploy to `https://app.ooplix.com/privacy` |
| Terms of service URL | ⚠️ | `/terms` route exists in mobile app |
| Data safety form | ❌ | Must complete in Play Console (see section 11) |
| Target audience age | ❌ | Set to 18+ (business app) |
| App category | ❌ | Set to: **Business** |
| Store listing language | ❌ | English (United States) minimum |

---

## 11. Data Safety Form (Play Console)

Fill this in Play Console → **Policy → App content → Data safety**:

| Data type | Collected | Purpose | Required |
|-----------|-----------|---------|---------|
| Email address | Yes | Account management | Disclose |
| User IDs | Yes | App functionality | Disclose |
| Crash logs | Yes (Crashlytics) | Analytics | Disclose |
| App interactions | Yes (Analytics) | Analytics | Disclose |
| Financial info | No | — | Not required |
| Location | No | — | Not required |
| Contacts | No | — | Not required |

**Key answers:**
- Data encrypted in transit: **Yes** (HTTPS + TLS 1.2+)
- User can request deletion: **Yes** (via email to altamashjauhar@gmail.com)
- Data shared with third parties: **Yes** — Firebase/Google, Razorpay

---

## 12. Release Checklist (Final Steps Before Upload)

```
[ ] Package name finalised (com.ooplix.jarvis)
[ ] Keystore generated and backed up
[ ] google-services.json in android/app/
[ ] flutterfire configure run — firebase_options.dart populated
[ ] App icon 512×512 PNG created
[ ] flutter_launcher_icons run
[ ] flutter_native_splash created
[ ] Version code incremented (starts at 1)
[ ] flutter build appbundle --release runs without errors
[ ] AAB file size < 150MB (Play Store limit)
[ ] app-release.aab tested on physical Android device
[ ] Privacy policy URL live and accessible
[ ] Play Console account active ($25 paid)
[ ] Store listing complete (title, description, screenshots, icon)
[ ] Content rating questionnaire complete
[ ] Data safety form complete
[ ] Upload AAB to Internal Testing track first
[ ] Promote to Production after internal test passes
```

---

## Remaining Blockers Summary

| Priority | Blocker | Time |
|----------|---------|------|
| **P0** | Finalise package name (`com.ooplix.jarvis`) | 5 min |
| **P0** | Generate keystore + back up | 10 min |
| **P0** | Create Firebase project + run `flutterfire configure` | 20 min |
| **P0** | Create app icon 512×512 PNG | 30–60 min |
| **P0** | `flutter build appbundle` must succeed | 30 min (after above) |
| **P1** | Google Play Console account ($25) | 5 min |
| **P1** | Complete Data safety form | 15 min |
| **P1** | Add `POST_NOTIFICATIONS` permission (for FCM) | 2 min |
| **P2** | Native splash resource | 10 min |
| **P2** | Privacy policy live at public URL | 15 min |
