plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// A deterministic app with the screen kinds the agent must handle (lists, dialogs, Compose, text fields,
// moving content, slow focus, a web view, a crash and a hang). Debug, but for what only a store's build shows.
android {
    namespace = "dev.appdyno.fixture"
    compileSdk { version = release(37) { minorApiLevel = 2 } }
    buildToolsVersion = "37.0.0"
    ndkVersion = "30.0.16248370"
    defaultConfig {
        // -PoldTarget: built for an old Android, a harmless app that Play Protect warns about on a real phone
        val oldTarget = project.hasProperty("oldTarget")
        applicationId = if (oldTarget) "dev.appdyno.fixture.oldtarget" else "dev.appdyno.fixture"
        minSdk = if (oldTarget) 24 else 26
        targetSdk = if (oldTarget) 24 else 37
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "4.1.2" } }
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
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(bom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
}
