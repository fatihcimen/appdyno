package dev.appdyno.fixture

import android.app.Application

/** A slow start of a known cost: `files/startup_ms` holds how long `onCreate` takes. */
class FixtureApp : Application() {
    override fun onCreate() {
        super.onCreate()
        costMs("startup_ms")?.let { Thread.sleep(it) }
    }
}
