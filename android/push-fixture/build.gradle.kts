plugins {
    id("com.android.application")
}

// An app with Firebase Messaging for the push suite alone, apart from the fixture so its launch and size stay as
// measured. No google-services.json: its Firebase options are made up, in res/values, and reach no project.
android {
    namespace = "dev.appdyno.pushfixture"
    compileSdk = 37
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = "dev.appdyno.pushfixture"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.firebase:firebase-messaging:26.0.1")
}
