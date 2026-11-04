package dev.appdyno.fixture

import android.content.Context
import android.content.Intent

/** Does nothing: what a start for a broadcast must read. */
class FixtureReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) = Unit
}
