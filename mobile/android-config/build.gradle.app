// android/app/build.gradle
// Replace the existing build.gradle in android/app/ with this after `npx cap add android`

apply plugin: 'com.android.application'

android {
    compileSdkVersion 34
    defaultConfig {
        applicationId "com.jarvisai.app"
        minSdkVersion 23            // Android 6.0+ (covers 98%+ of active devices)
        targetSdkVersion 34         // Required for Play Store 2024+
        versionCode 1
        versionName "1.0.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        release {
            // Set these via environment variables — never hardcode in VCS
            storeFile     file(System.getenv("KEYSTORE_PATH")    ?: "jarvis-release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")     ?: ""
            keyAlias      System.getenv("KEY_ALIAS")             ?: "jarvis"
            keyPassword   System.getenv("KEY_PASSWORD")          ?: ""
        }
    }

    buildTypes {
        release {
            minifyEnabled     true
            shrinkResources   true
            signingConfig     signingConfigs.release
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
        debug {
            applicationIdSuffix ".debug"
            versionNameSuffix   "-debug"
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    bundle {
        language       { enableSplit = true }
        density        { enableSplit = true }
        abi            { enableSplit = true }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation "androidx.appcompat:appcompat:1.7.0"
    implementation "androidx.coordinatorlayout:coordinatorlayout:1.2.0"

    // Capacitor core
    implementation project(':capacitor-android')
}
