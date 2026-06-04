# Mobile Roadmap — JARVIS Engineering

**Flutter foundation created:** 2026-06-05

---

## Current State

### Flutter App Structure (`flutter/`)

```
flutter/
├── pubspec.yaml                    # Dependencies: Firebase, Riverpod, go_router, http
├── lib/
│   ├── main.dart                   # App entry, Firebase init, Riverpod ProviderScope
│   ├── router.dart                 # go_router navigation + auth-guard redirect
│   ├── theme.dart                  # Material 3 light + dark themes
│   ├── firebase_options.dart       # Platform FirebaseOptions (replace with flutterfire configure)
│   ├── screens/
│   │   ├── splash_screen.dart      # Animated splash → auto-route based on auth state
│   │   ├── login_screen.dart       # Email+password + Google Sign-In + forgot password
│   │   ├── signup_screen.dart      # Email+password + Google Sign-In
│   │   └── dashboard_screen.dart   # User card, billing status, health, quick action grid
│   ├── services/
│   │   ├── auth_service.dart       # Firebase Auth: email, Google, signOut, token, reset
│   │   └── api_service.dart        # HTTP client: JWT auth header, all JARVIS endpoints
│   └── widgets/
│       ├── auth_text_field.dart    # Password visibility toggle text field
│       ├── google_sign_in_button.dart # Branded Google button
│       └── error_banner.dart       # Styled error display
```

### What Works (code complete)

| Feature | Status |
|---------|--------|
| Splash screen with animation | Done |
| Email + password login | Done |
| Email + password signup | Done |
| Google Sign-In | Done |
| Forgot password email | Done |
| Auth guard / redirect | Done |
| Dashboard with billing + health | Done |
| Firebase Auth integration | Done (needs credentials) |
| JARVIS API layer | Done (needs server URL) |
| Light + dark theme | Done |

---

## Manual Setup Steps (Before First Build)

### Step 1 — Install Flutter SDK

```bash
# macOS (Apple Silicon)
brew install --cask flutter
flutter doctor   # verify setup
```

### Step 2 — Create Firebase Project

1. [console.firebase.google.com](https://console.firebase.google.com) → Add project → **ooplix-jarvis**
2. Enable **Authentication → Sign-in method:**
   - Email/Password ✓
   - Google ✓
3. Add apps:
   - **Android:** package `com.ooplix.jarvis`
   - **iOS:** bundle ID `com.ooplix.jarvis`
   - Download `google-services.json` → `flutter/android/app/`
   - Download `GoogleService-Info.plist` → `flutter/ios/Runner/`

### Step 3 — Run flutterfire configure

```bash
cd flutter
dart pub global activate flutterfire_cli
flutterfire configure --project=ooplix-jarvis
# Overwrites lib/firebase_options.dart with real values
```

### Step 4 — Set Production API URL

In `flutter/lib/services/api_service.dart`:
```dart
const String _baseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://app.ooplix.com',   // ← already set
);
```

Override at build time:
```bash
flutter build apk --dart-define=API_URL=https://app.ooplix.com
```

### Step 5 — First Build

```bash
cd flutter
flutter pub get
flutter run                  # debug on connected device
flutter build apk --release  # production APK
flutter build appbundle      # Play Store AAB
```

---

## Phase Roadmap

### Phase 1 — Foundation (Done)
- [x] Splash, Login, Signup, Dashboard
- [x] Firebase Auth (email + Google)
- [x] API layer with JWT
- [x] Navigation shell (go_router + auth guard)
- [x] Light/dark theme

### Phase 2 — Core Features
- [ ] AI Chat screen (`/chat`) — streaming responses
- [ ] Tasks screen (`/tasks`) — list, create, update
- [ ] Notifications — FCM push notifications
- [ ] Biometric auth (fingerprint/Face ID)
- [ ] Offline mode / local caching

### Phase 3 — Engineering Tools
- [ ] Repo search screen — Large Context Code Search API
- [ ] Deployment status screen — DeploymentAutopilot API
- [ ] Secret health screen — SecretRotationAutomation API
- [ ] Metrics screen — EnterpriseObservability API

### Phase 4 — Billing + Growth
- [ ] Billing screen — plan display, upgrade flow (Razorpay)
- [ ] In-app purchase (Google Play Billing API)
- [ ] Subscription status + grace period display

### Phase 5 — Polish + Store
- [ ] App icon + splash assets
- [ ] Onboarding carousel
- [ ] Play Store listing (screenshots, description)
- [ ] App Store Connect submission
- [ ] Firebase Crashlytics
- [ ] Analytics events

---

## Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| State management | Riverpod | Type-safe, testable, no boilerplate |
| Navigation | go_router | Deep linking, URL-based, auth redirect |
| Auth | Firebase Auth | Already in existing mobile app |
| HTTP | `http` + `dio` | `http` for simple calls, `dio` for interceptors |
| Build | Flutter 3.16+ | Dart 3 null safety, Material 3 |

---

## Remaining Manual Blockers

| Priority | Item | Effort |
|----------|------|--------|
| CRITICAL | Install Flutter SDK | 15 min |
| CRITICAL | Create Firebase project + `flutterfire configure` | 20 min |
| CRITICAL | Download `google-services.json` to `flutter/android/app/` | 5 min |
| High | Set production `APP_URL` build flag | 1 min |
| Medium | Add app icons to `assets/icons/` | 30 min |
| Low | Play Store / App Store setup | 2–4 hours |
