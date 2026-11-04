package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.view.WindowManager

/** A window the system keeps out of screenshots and mirrors, for what a mirror shows of one. */
class SecureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE)
        column {
            button("Secure", R.id.frames_light) { }
        }
    }
}
