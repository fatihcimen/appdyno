package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle

/** A leak of a known size: each open leaves one Activity alive after it closed itself. */
class LeakActivity : Activity() {
    companion object {
        val leaked = ArrayList<Activity>()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        leaked += this
        finish()
    }
}
