import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

// Load key.properties if it exists (release signing)
val keyPropertiesFile = rootProject.file("key.properties")
val keyProperties = Properties()
if (keyPropertiesFile.exists()) {
    keyProperties.load(FileInputStream(keyPropertiesFile))
}

android {
    namespace = "com.ooplix.jarvis"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.ooplix.jarvis"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (keyPropertiesFile.exists()) {
                keyAlias      = keyProperties["keyAlias"]      as String
                keyPassword   = keyProperties["keyPassword"]   as String
                storeFile     = file(keyProperties["storeFile"] as String)
                storePassword = keyProperties["storePassword"] as String
            } else {
                // Fallback to env vars for CI
                keyAlias      = System.getenv("KEY_ALIAS")        ?: ""
                keyPassword   = System.getenv("KEY_PASSWORD")     ?: ""
                storeFile     = file(System.getenv("KEYSTORE_PATH") ?: "../../ooplix-release.keystore")
                storePassword = System.getenv("KEYSTORE_PASSWORD") ?: ""
            }
        }
    }

    buildTypes {
        release {
            signingConfig   = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix   = "-debug"
        }
    }

    bundle {
        language   { enableSplit = true }
        density    { enableSplit = true }
        abi        { enableSplit = true }
    }
}

flutter {
    source = "../.."
}
