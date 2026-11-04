package dev.appdyno.fixture

import android.app.Activity
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.compose.foundation.layout.width

/**
 * Frames of a known cost: a 2 s animation redrawn every frame, its draw taking about 1 ms ("LIGHT") or
 * 40 ms ("HEAVY", every frame misses a 60 Hz deadline).
 */
class FramesActivity : Activity() {
    private class Animated(ctx: Activity) : View(ctx) {
        var costMs = 0L
        var until = 0L
        private val paint = Paint().apply { color = 0xFF5D3EBC.toInt() }
        override fun onDraw(canvas: Canvas) {
            val now = android.os.SystemClock.uptimeMillis()
            if (costMs > 0) Thread.sleep(costMs)
            canvas.drawRect(((now / 4) % width).toFloat(), 0f, ((now / 4) % width + 100).toFloat(), 200f, paint)
            if (now < until) postInvalidateOnAnimation()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        column {
            val view = Animated(this@FramesActivity).apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 220) }
            fun run(cost: Long) {
                view.costMs = cost
                view.until = android.os.SystemClock.uptimeMillis() + 2_000
                view.postInvalidateOnAnimation()
            }
            button("Light", R.id.frames_light) { run(0) }
            button("Heavy", R.id.frames_heavy) { run(40) }
            addView(view)
        }
    }
}
