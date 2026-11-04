package dev.appdyno.fixture

import android.content.Intent

/** In a process of its own: each call takes 100 ms there, which is what the caller waits for. */
class SlowService : android.app.Service() {
    private val binder = object : android.os.Binder() {
        override fun onTransact(code: Int, data: android.os.Parcel, reply: android.os.Parcel?, flags: Int): Boolean {
            Thread.sleep(100)
            return true
        }
    }

    override fun onBind(intent: Intent?) = binder
}
