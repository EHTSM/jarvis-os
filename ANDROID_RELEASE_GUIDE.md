# Android Release Guide — Ooplix

**Date:** 2026-06-05  
**Package:** `com.ooplix.jarvis`  
**Current version:** `1.0.0+1` (pubspec.yaml)  
**Target SDK:** 34 | Min SDK: 23  
**Build tool:** Flutter 3.16+ / Gradle 8.x

---

## Part 1 — Keystore Generation (Run Once)

**This is the most important step. The keystore is permanent — losing it means you can never update the app.**

### Generate keystore

```bash
cd /Users/ehtsm/jarvis-os

keytool -genkey -v \
  -keystore ooplix-release.keystore \
  -alias ooplix \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=Ooplix, OU=Engineering, O=Ooplix, L=Hyderabad, S=Telangana, C=IN"
```

You will be prompted for:
- **Keystore password** → choose a strong password, write it down
- **Key password** → can be same as keystore password

### Verify keystore

```bash
keytool -list -v \
  -keystore ooplix-release.keystore \
  -alias ooplix \
  -storepass <your-store-password>

# Expected output includes:
# Alias name: ooplix
# Entry type: PrivateKeyEntry
# Certificate fingerprints: SHA1: XX:XX:XX...
```

Copy the **SHA1** value — you need it for Firebase (Step 8 in FIREBASE_PRODUCTION_CHECKLIST.md).

### Backup keystore (do all three)

```bash
# 1. Google Drive
cp ooplix-release.keystore ~/Google\ Drive/ooplix-keystore-backup.keystore

# 2. Password manager attachment (1Password / Bitwarden)
# Attach: ooplix-release.keystore + note the two passwords

# 3. Offline USB
cp ooplix-release.keystore /Volumes/USB_BACKUP/ooplix-release.keystore
```

**Never commit the keystore to git:**
```bash
echo "ooplix-release.keystore" >> .gitignore
echo "*.keystore" >> .gitignore
echo "key.properties" >> .gitignore
```

---

## Part 2 — Signing Configuration

### Create key.properties

Create `flutter/android/key.properties` (gitignored):

```properties
storePassword=<your-keystore-password>
keyPassword=<your-key-password>
keyAlias=ooplix
storeFile=../../../ooplix-release.keystore
```

### Update flutter/android/app/build.gradle

After `flutter create` populates `flutter/android/`, update `flutter/android/app/build.gradle`:

```groovy
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    compileSdkVersion 34

    defaultConfig {
        applicationId "com.ooplix.jarvis"
        minSdkVersion 23
        targetSdkVersion 34
        versionCode flutterVersionCode.toInteger()
        versionName flutterVersionName
    }

    signingConfigs {
        release {
            keyAlias      keystoreProperties['keyAlias']      ?: System.getenv("KEY_ALIAS")
            keyPassword   keystoreProperties['keyPassword']   ?: System.getenv("KEY_PASSWORD")
            storeFile     keystoreProperties['storeFile']     ? file(keystoreProperties['storeFile'])
                                                              : file(System.getenv("KEYSTORE_PATH") ?: "")
            storePassword keystoreProperties['storePassword'] ?: System.getenv("KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig     signingConfigs.release
            minifyEnabled     true
            shrinkResources   true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
        debug {
            applicationIdSuffix ".debug"
            versionNameSuffix   "-debug"
        }
    }

    bundle {
        language { enableSplit = true }
        density  { enableSplit = true }
        abi      { enableSplit = true }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}
```

### Add to flutter/android/.gitignore

```
key.properties
*.keystore
*.jks
```

---

## Part 3 — Versioning Strategy

Versions live in `flutter/pubspec.yaml`:

```yaml
version: 1.0.0+1
#         ^^^^^  versionName  — shown to users (semantic: MAJOR.MINOR.PATCH)
#               ^  versionCode — integer, must increment on every Play Store upload
```

### Versioning rules

| Release type | versionName change | versionCode change |
|-------------|-------------------|--------------------|
| Bug fix | 1.0.0 → 1.0.1 | +1 |
| New feature | 1.0.0 → 1.1.0 | +1 |
| Breaking change | 1.0.0 → 2.0.0 | +1 |
| Internal re-upload | no change | +1 (ALWAYS) |

### Version bump script

```bash
#!/bin/bash
# scripts/bump_version.sh
# Usage: ./scripts/bump_version.sh patch   (or minor, major)

set -e
TYPE=${1:-patch}
FILE="flutter/pubspec.yaml"

CURRENT=$(grep '^version:' $FILE | awk '{print $2}')
NAME=$(echo $CURRENT | cut -d+ -f1)
CODE=$(echo $CURRENT | cut -d+ -f2)

IFS='.' read -r MAJOR MINOR PATCH <<< "$NAME"

case $TYPE in
  major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR+1)); PATCH=0 ;;
  patch) PATCH=$((PATCH+1)) ;;
esac

NEW_CODE=$((CODE+1))
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}+${NEW_CODE}"

sed -i '' "s/^version: .*/version: ${NEW_VERSION}/" $FILE
echo "Bumped: $CURRENT → $NEW_VERSION"
```

```bash
chmod +x scripts/bump_version.sh
./scripts/bump_version.sh patch   # 1.0.0+1 → 1.0.1+2
```

---

## Part 4 — Release Build

### Prerequisites check

```bash
flutter doctor -v
# Must show no errors for Android toolchain

# Confirm flutter/android/app/google-services.json exists
ls -la flutter/android/app/google-services.json

# Confirm key.properties exists (not committed)
ls -la flutter/android/key.properties
```

### Build App Bundle (Play Store format)

```bash
cd /Users/ehtsm/jarvis-os/flutter

# Clean previous build artifacts
flutter clean

# Get dependencies
flutter pub get

# Build release App Bundle with production API URL
flutter build appbundle \
  --release \
  --dart-define=API_URL=https://app.ooplix.com \
  --no-tree-shake-icons

# Output:
# build/app/outputs/bundle/release/app-release.aab
```

### Verify the AAB

```bash
# Check file exists and is non-zero
ls -lh build/app/outputs/bundle/release/app-release.aab
# Expected: file > 5MB, < 150MB

# Verify signing (requires bundletool)
# brew install bundletool
bundletool validate --bundle=build/app/outputs/bundle/release/app-release.aab
# Expected: "The App Bundle is valid."
```

### Build APK (for direct device testing, not Play Store)

```bash
flutter build apk \
  --release \
  --dart-define=API_URL=https://app.ooplix.com

# Output: build/app/outputs/flutter-apk/app-release.apk

# Install on connected device
flutter install --release
```

---

## Part 5 — Release Build Validation Workflow

Run this full sequence before every Play Store upload:

```bash
#!/bin/bash
# scripts/validate_release.sh
set -e

echo "=== 1. Flutter doctor ==="
flutter doctor

echo "=== 2. Clean ==="
cd flutter && flutter clean

echo "=== 3. Pub get ==="
flutter pub get

echo "=== 4. Lint ==="
flutter analyze
# Fix any errors before continuing

echo "=== 5. Tests ==="
flutter test
# Fix any failures before continuing

echo "=== 6. Build AAB ==="
flutter build appbundle \
  --release \
  --dart-define=API_URL=https://app.ooplix.com

AAB=build/app/outputs/bundle/release/app-release.aab

echo "=== 7. AAB exists ==="
[ -f "$AAB" ] && echo "PASS: AAB exists" || (echo "FAIL: AAB not found" && exit 1)

echo "=== 8. AAB size check ==="
SIZE=$(du -m "$AAB" | cut -f1)
echo "Size: ${SIZE}MB"
[ "$SIZE" -lt 150 ] && echo "PASS: size OK" || echo "WARN: size > 150MB (Play Store limit)"

echo "=== 9. Install on connected device ==="
flutter install --release
echo "DONE: Install the app and run manual UAT (Section 7 of USER_ACCEPTANCE_TEST_PLAN.md)"
```

```bash
chmod +x scripts/validate_release.sh
./scripts/validate_release.sh
```

---

## Part 6 — CI/CD Environment Variables (for future automation)

When setting up a CI pipeline (GitHub Actions / Bitrise), these secrets are needed:

```
KEYSTORE_BASE64     = base64-encoded keystore file
KEYSTORE_PASSWORD   = keystore password
KEY_ALIAS           = ooplix
KEY_PASSWORD        = key password
FIREBASE_SERVICE_ACCOUNT = backend service account JSON (single line)
```

**Base64-encode the keystore for CI:**
```bash
base64 -i ooplix-release.keystore | tr -d '\n'
# Paste this value into GitHub Secrets as KEYSTORE_BASE64
```

**Decode in CI pipeline:**
```bash
echo "$KEYSTORE_BASE64" | base64 --decode > ooplix-release.keystore
```

---

## Part 7 — Version History Template

Track every Play Store upload here:

| versionCode | versionName | Date | Track | Changes |
|-------------|-------------|------|-------|---------|
| 1 | 1.0.0 | 2026-06-__ | Internal Testing | Initial release |
| 2 | 1.0.1 | TBD | Internal Testing | Bug fixes from beta |
| 3 | 1.1.0 | TBD | Production | First public release |

---

## Release Checklist (Before Every Upload)

```
[ ] Version code incremented in flutter/pubspec.yaml
[ ] flutter clean && flutter pub get done
[ ] flutter analyze — zero errors
[ ] flutter test — all pass
[ ] flutter build appbundle --release succeeds
[ ] AAB file exists at build/app/outputs/bundle/release/app-release.aab
[ ] AAB < 150MB
[ ] App installed on physical device — login + chat + billing tested
[ ] google-services.json is current (re-download if SHA-1 changed)
[ ] API_URL points to production: https://app.ooplix.com
[ ] Backend running and /health returns 200
[ ] AAB uploaded to Play Console → correct track
[ ] Release notes written (English)
```
