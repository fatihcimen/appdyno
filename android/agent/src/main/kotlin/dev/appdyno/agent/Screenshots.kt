package dev.appdyno.agent

import android.graphics.Bitmap
import java.io.ByteArrayOutputStream

class Screenshots(private val automation: Automation, private val settling: Settling) {
    fun take(r: ShotRequest): Reply {
        settling.awaitRest()
        // the system gives none of a window marked secure, and gave none once of a home screen on a loaded emulator, which
        // the next try had: asked twice before it is said
        val shot = automation.ua.takeScreenshot()
            ?: run {
                Thread.sleep(AGAIN_MS)
                automation.ua.takeScreenshot()
            }
            ?: throw AgentFailure(
                "UNSUPPORTED",
                "the screen could not be captured: the system gave no picture, twice, as it gives none of a window marked secure",
            )
        // bitmaps live in native memory until a collection: each one is freed as soon as it is encoded
        val made = mutableListOf(shot)
        try {
            var bmp = if (shot.config == Bitmap.Config.HARDWARE) shot.copy(Bitmap.Config.ARGB_8888, false).also { made += it } else shot
            fitted(bmp.width, bmp.height, r.maxPx)?.let { (w, h) ->
                bmp = Bitmap.createScaledBitmap(bmp, w, h, true).also { made += it }
            }
            val bytes = ByteArrayOutputStream().use { out ->
                bmp.compress(if (r.png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, r.quality, out)
                out.toByteArray()
            }
            return Reply(Results.shot(bmp.width, bmp.height, r.png, bytes.size), bytes)
        } finally {
            for (b in made.distinct()) b.recycle()
        }
    }

    companion object {
        /** Before a picture the system did not give is asked for again. */
        const val AGAIN_MS = 300L

        /** The size a picture comes down to by its longest side; null when it fits. */
        fun fitted(w: Int, h: Int, maxPx: Int?): Pair<Int, Int>? {
            if (maxPx == null || maxOf(w, h) <= maxPx) return null
            val k = maxPx.toFloat() / maxOf(w, h)
            return (w * k).toInt().coerceAtLeast(1) to (h * k).toInt().coerceAtLeast(1)
        }
    }
}
