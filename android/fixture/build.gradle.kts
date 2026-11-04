plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// A deterministic app with the screen kinds the agent must handle (lists, dialogs, Compose, text fields,
// moving content, slow focus, a web view, a crash and a hang). Debug, but for what only a store's build shows.
android {
    namespace = "dev.appdyno.fixture"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    ndkVersion = "28.2.13676358"
    defaultConfig {
        // -PoldTarget: built for an old Android, a harmless app that Play Protect warns about on a real phone
        val oldTarget = project.hasProperty("oldTarget")
        applicationId = if (oldTarget) "dev.appdyno.fixture.oldtarget" else "dev.appdyno.fixture"
        minSdk = if (oldTarget) 24 else 26
        targetSdk = if (oldTarget) 24 else 35
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt") } }
    buildTypes {
        // not debuggable, as a Baseline Profile needs, and it holds the profile Compose's libraries ship
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    buildFeatures {
        compose = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(bom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
}
