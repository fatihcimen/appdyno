package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.widget.EditText

/** A field that takes focus only 700 ms after it was tapped (a slow phone). */
class SlowFocusActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            label("Slow field")
            EditText(context).apply {
                id = R.id.slow_input
                hint = "Code"
                isFocusableInTouchMode = false
                setOnClickListener {
                    postDelayed({
                        isFocusableInTouchMode = true
                        requestFocus()
                    }, 700)
                }
                addView(this)
            }
        }
    }
}
