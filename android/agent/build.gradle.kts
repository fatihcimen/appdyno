plugins {
    id("com.android.application")
}

// The agent is never installed: its APK is the class path of an app_process server run as the shell user.
android {
    namespace = "dev.appdyno.agent"
    compileSdk { version = release(37) { minorApiLevel = 2 } }
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = "dev.appdyno.agent"
        minSdk = 26
        targetSdk = 37
        versionCode = 7
        versionName = "1.1.1"
    }
    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
    lint {
        warningsAsErrors = true
        abortOnError = true
    }
    // the wire as canonical JSON, read by the host's tests and the runner's as well
    sourceSets["test"].resources.directories += "../../packages/protocol/fixtures"
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
