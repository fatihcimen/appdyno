package dev.appdyno.fixture

import android.app.Activity
import android.os.Bundle
import android.view.View

/** A surface drawn from its own thread, every `ms` of the link: frames the View toolkit never sees, as a game's are. */
class SurfaceActivity : Activity() {
    @Volatile private var on = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val periodMs = intent.data?.getQueryParameter("ms")?.toLongOrNull() ?: 40
        val surface = android.view.SurfaceView(this)
        surface.holder.addCallback(object : android.view.SurfaceHolder.Callback {
            override fun surfaceCreated(holder: android.view.SurfaceHolder) {
                on = true
                Thread {
                    var n = 0
                    var next = android.os.SystemClock.uptimeMillis()
                    while (on) {
                        holder.lockCanvas()?.let { canvas ->
                            canvas.drawColor(if (n++ % 2 == 0) android.graphics.Color.DKGRAY else android.graphics.Color.GRAY)
                            holder.unlockCanvasAndPost(canvas)
                        }
                        next += periodMs
                        android.os.SystemClock.sleep(maxOf(0, next - android.os.SystemClock.uptimeMillis()))
                    }
                }.start()
            }

            override fun surfaceChanged(holder: android.view.SurfaceHolder, f: Int, w: Int, h: Int) = Unit

            override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                on = false
            }
        })
        setContentView(surface)
    }
}
