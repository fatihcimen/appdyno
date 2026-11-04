package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

class LateActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val handler = Handler(Looper.getMainLooper())
        column {
            val result = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; id = R.id.late_result }
            for (delay in listOf(0, 50, 100, 150, 200, 250, 300, 350, 450, 700, 1000)) {
                button("$delay ms", View.generateViewId()) {
                    handler.postDelayed({ result.addView(TextView(context).apply { text = "Tepki $delay" }) }, delay.toLong())
                }.tag = "late_$delay"
            }
            button("Clear", R.id.late_clear) { result.removeAllViews() }
            // not clickable: only a touch listener reacts (as a gesture area does), 30 ms after the touch
            TextView(context).apply {
                text = "Touch area"
                id = R.id.late_touch
                setPadding(0, 48, 0, 48)
                setOnTouchListener { v, e ->
                    if (e.action == android.view.MotionEvent.ACTION_UP)
                        handler.postDelayed({ result.addView(TextView(context).apply { text = "Touch reaction" }) }, 30)
                    true
                }
                addView(this)
            }
            addView(result)
        }
    }
}
