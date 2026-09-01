plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("kotlin-kapt")
}

// App URL configuration (Jarvis Phase 2 — M5):
// - Debug builds default to the Android emulator loopback (http://10.0.2.2:3000).
// - Release builds REQUIRE an explicit URL via the Gradle property `JENNA_APP_URL`
//   (gradle.properties, -PJENNA_APP_URL=..., or ORG_GRADLE_PROJECT_JENNA_APP_URL env).
//   No production URL is ever hard-coded in source.
val debugAppUrl: String =
    (project.findProperty("JENNA_APP_URL_DEBUG") as String?) ?: "http://10.0.2.2:3000"
val releaseAppUrl: String? = project.findProperty("JENNA_APP_URL") as String?

android {
    namespace = "ai.studio.jenna"
    compileSdk = 34

    defaultConfig {
        applicationId = "ai.studio.jenna"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "APP_URL", "\"$debugAppUrl\"")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Fail fast at build time instead of shipping a broken/hard-coded URL.
            if (releaseAppUrl.isNullOrBlank()) {
                buildConfigField("String", "APP_URL", "\"\"")
            } else {
                require(releaseAppUrl.startsWith("https://")) {
                    "JENNA_APP_URL must be an https:// URL for release builds."
                }
                buildConfigField("String", "APP_URL", "\"$releaseAppUrl\"")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.webkit:webkit:1.10.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Room Database
    val roomVersion = "2.6.1"
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    kapt("androidx.room:room-compiler:$roomVersion")

    // JSON serialization
    implementation("org.json:json:20231013")
}
