package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle

/** A crash in the app's own code, and one in its library: what `crashes` finds and names. */
class CrashActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            button("Crash", R.id.crash) { throw IllegalStateException("fixture crash") }
            button("Crash natively", R.id.crash_native) { Native.crash() }
            button("Exit", R.id.exit) { kotlin.system.exitProcess(3) }
        }
    }
}
