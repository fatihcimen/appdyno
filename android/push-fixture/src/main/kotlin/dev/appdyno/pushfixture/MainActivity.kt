package dev.appdyno.pushfixture

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/** A screen to put the app in front, as a push to an app in front is handed to its code, not drawn. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Push Fixture" })
    }
}
