package dev.appdyno.fixture

import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.os.SystemClock
import android.view.View

/** A line of text that runs left: smooth, or with a fault a single picture would not show. A view draws it, and a tree has none of it. */
class MarqueeActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setContentView(MarqueeView(this, intent?.data?.lastPathSegment ?: "marquee"))
    }
}

private const val TEXT = "Kargo yolda, siparişin bugün geliyor, teşekkürler"
private const val DP_PER_SECOND = 80f
private const val JUMP_DP = 40f
private const val EVERY_MS = 1_200L
private const val BACK_MS = 400L

private class MarqueeView(context: Context, private val mode: String) : View(context) {
    private val density = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        textSize = 24 * density
    }
    private val start = SystemClock.uptimeMillis()

    /** How far it has run, in dp; each fault breaks it every so often. */
    private fun run(ms: Long): Float {
        val steady = ms * DP_PER_SECOND / 1_000f
        val turns = ms / EVERY_MS
        return when (mode) {
            "marquee_jumps" -> steady + turns * JUMP_DP
            "marquee_back" -> {
                val into = ms % EVERY_MS
                val stepped = turns * (EVERY_MS - 2 * BACK_MS) * DP_PER_SECOND / 1_000f
                stepped + (if (into < EVERY_MS - BACK_MS) into else 2 * (EVERY_MS - BACK_MS) - into) * DP_PER_SECOND / 1_000f
            }
            else -> steady
        }
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawColor(Color.WHITE)
        val width = paint.measureText(TEXT) + 40 * density
        val top = height * 0.3f
        if (mode == "marquee_cut") canvas.clipRect(0f, 0f, this.width * 0.6f, height.toFloat())
        val shift = run(SystemClock.uptimeMillis() - start) * density % width
        var x = -shift
        while (x < this.width) {
            canvas.drawText(TEXT, x, top, paint)
            x += width
        }
        postInvalidateOnAnimation()
    }
}
