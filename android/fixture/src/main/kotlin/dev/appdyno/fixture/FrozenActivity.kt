package dev.appdyno.fixture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.compose.foundation.layout.width

/**
 * Shares of frames of a known size: `frames` frames one after another, each drawn in `draw` ms, and `stalls` of them
 * evenly apart taking 800 ms. Says "done" at its end. `cause` gives each frame about 100 ms of a known slowness: `lock`
 * waits on a monitor another thread holds, `binder` waits on a call to another process, `gc` allocates so the collector
 * runs, `busy` spins.
 */
class FrozenActivity : Activity() {
    private val monitor = Object()
    @Volatile private var holding = false
    private var kept: ByteArray? = null
    private var remote: android.os.IBinder? = null
    private val connection = object : android.content.ServiceConnection {
        override fun onServiceConnected(name: android.content.ComponentName?, service: android.os.IBinder?) {
            remote = service
        }
        override fun onServiceDisconnected(name: android.content.ComponentName?) {
            remote = null
        }
    }

    private fun spend(cause: String?) {
        val end = android.os.SystemClock.uptimeMillis() + 100
        val over = { android.os.SystemClock.uptimeMillis() >= end }
        when (cause) {
            "lock" -> synchronized(monitor) {}
            "binder" -> remote?.transact(1, android.os.Parcel.obtain(), android.os.Parcel.obtain(), 0)
            "gc" -> while (!over()) kept = ByteArray(4 shl 20)
            "busy" -> while (!over()) Unit
        }
    }

    override fun onDestroy() {
        holding = false
        if (intent.data?.getQueryParameter("cause") == "binder") unbindService(connection)
        super.onDestroy()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cause = intent.data?.getQueryParameter("cause")
        if (cause == "binder") bindService(Intent(this, SlowService::class.java), connection, Context.BIND_AUTO_CREATE)
        if (cause == "lock") {
            holding = true
            Thread {
                while (holding) {
                    synchronized(monitor) { Thread.sleep(100) }
                    Thread.sleep(2)
                }
            }.start()
        }
        val asked = { name: String, otherwise: Int -> intent.data?.getQueryParameter(name)?.toIntOrNull() ?: otherwise }
        val total = asked("frames", 2_000)
        val stalls = asked("stalls", 0)
        val drawMs = asked("draw", 0).toLong()
        column {
            val status = label("ready", R.id.frozen_status)
            val paint = Paint().apply { color = 0xFFDE3222.toInt() }
            val animated = object : View(context) {
                var toDraw = 0
                override fun onDraw(canvas: Canvas) {
                    canvas.drawRect((toDraw % width).toFloat(), 0f, (toDraw % width + 100).toFloat(), 200f, paint)
                    if (toDraw <= 0) return
                    if (drawMs > 0) Thread.sleep(drawMs)
                    spend(cause)
                    if (stalls > 0 && toDraw % (total / stalls) == total / stalls / 2) Thread.sleep(800)
                    toDraw--
                    if (toDraw == 0) status.text = "done" else postInvalidateOnAnimation()
                }
            }.apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 220) }
            button("Start", R.id.frozen_start) {
                animated.toDraw = total
                animated.postInvalidateOnAnimation()
            }
            addView(animated)
        }
    }
}
