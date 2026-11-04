plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The agent is never installed: its APK is the class path of an app_process server run as the shell user.
android {
    namespace = "dev.appdyno.agent"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig {
        applicationId = "dev.appdyno.agent"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "0.6.0"
    }
    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
    // the wire as canonical JSON, read by the host's tests and the runner's as well
    sourceSets["test"].resources.srcDir("../../packages/protocol/fixtures")
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
