package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar

/** Content that arrives 600 ms after the tap (and `files/delayed_ms` more), with a fade (the settle must wait for it). */
class DelayedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val progress = ProgressBar(context).apply {
                visibility = View.GONE
                addView(this)
            }
            val loaded = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                id = R.id.loaded
                visibility = View.GONE
            }
            for (i in 1..5) loaded.addView(Button(context).apply { text = "Result $i" })
            button("Load", R.id.load) {
                progress.visibility = View.VISIBLE
                Handler(Looper.getMainLooper()).postDelayed({
                    progress.visibility = View.GONE
                    loaded.alpha = 0f
                    loaded.visibility = View.VISIBLE
                    loaded.animate().alpha(1f).setDuration(400).start()
                }, 600 + (costMs("delayed_ms") ?: 0))
            }
            addView(loaded)
        }
    }
}
