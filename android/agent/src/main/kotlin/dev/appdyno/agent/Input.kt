package dev.appdyno.agent

import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent

class Sample(val t: Long, val x: Float, val y: Float)

/** Pure gesture timing (unit tested): one finger's path resampled every `stepMs`. */
object Paths {
    const val STEP_MS = 10L

    fun line(fromX: Float, fromY: Float, toX: Float, toY: Float, durationMs: Long): List<Sample> =
        resample(listOf(Sample(0, fromX, fromY), Sample(durationMs, toX, toY)))

    /** Points every STEP_MS between the given samples (linear), the last sample always included. */
    fun resample(points: List<Sample>): List<Sample> {
        if (points.size == 1) return points
        val end = points.last().t
        val out = ArrayList<Sample>()
        var t = 0L
        var seg = 0
        while (t < end) {
            while (seg < points.size - 2 && points[seg + 1].t <= t) seg++
            val a = points[seg]
            val b = points[seg + 1]
            val k = if (b.t == a.t) 1f else (t - a.t).toFloat() / (b.t - a.t)
            out += Sample(t, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
            t += STEP_MS
        }
        out += points.last()
        return out
    }
}

/** Touch and key input injected as the shell user, timed on the device's uptime clock. */
class Input(private val automation: Automation) {
    fun tap(x: Float, y: Float) {
        // a Xiaomi at times refuses the finger-up, its finger-down having reached no window (cause not known): nothing
        // has reached the app, and the tap can be made again
        repeat(TAP_TRIES - 1) {
            try {
                touchOnce(x, y)
                return
            } catch (e: AgentFailure) {
                if (e.code != "INTERNAL") throw e
                Thread.sleep(TAP_RETRY_MS)
            }
        }
        touchOnce(x, y)
    }

    private fun touchOnce(x: Float, y: Float) {
        val down = SystemClock.uptimeMillis()
        automation.inject(touch(down, down, MotionEvent.ACTION_DOWN, x, y))
        automation.inject(touch(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y))
    }

    fun longPress(x: Float, y: Float, durationMs: Long, cancelled: () -> Boolean) {
        val down = SystemClock.uptimeMillis()
        automation.inject(touch(down, down, MotionEvent.ACTION_DOWN, x, y))
        sleepUntil(down + durationMs, cancelled)
        automation.inject(touch(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y))
    }

    /** One finger along `samples` (times from the gesture start). */
    fun path(samples: List<Sample>, cancelled: () -> Boolean) = gesture(listOf(samples), cancelled)

    /**
     * Fingers down together at their first sample and up together at the last (a pinch, a rotation, a
     * multi-finger tap); every finger's path is resampled onto one shared timeline.
     */
    fun gesture(paths: List<List<Sample>>, cancelled: () -> Boolean) {
        val fingers = paths.map { Paths.resample(it) }
        val end = fingers.maxOf { it.last().t }
        val n = fingers.size
        val props = Array(n) { i -> MotionEvent.PointerProperties().apply { id = i; toolType = MotionEvent.TOOL_TYPE_FINGER } }
        val coords = Array(n) { MotionEvent.PointerCoords().apply { pressure = 1f; size = 1f } }
        fun at(t: Long) {
            for (i in 0 until n) {
                val s = fingers[i].lastOrNull { it.t <= t } ?: fingers[i].first()
                coords[i].x = s.x
                coords[i].y = s.y
            }
        }
        val down = SystemClock.uptimeMillis()
        at(0)
        automation.inject(multi(down, down, MotionEvent.ACTION_DOWN, 1, props, coords))
        for (i in 1 until n) {
            val action = MotionEvent.ACTION_POINTER_DOWN or (i shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
            automation.inject(multi(down, down, action, i + 1, props, coords))
        }
        var t = Paths.STEP_MS
        while (t <= end) {
            if (cancelled()) break
            sleepUntil(down + t, cancelled)
            at(t)
            automation.inject(multi(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, n, props, coords))
            t += Paths.STEP_MS
        }
        at(end)
        for (i in n - 1 downTo 1) {
            val action = MotionEvent.ACTION_POINTER_UP or (i shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
            automation.inject(multi(down, SystemClock.uptimeMillis(), action, i + 1, props, coords))
        }
        automation.inject(multi(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, 1, props, coords))
    }

    fun key(code: Int) {
        val now = SystemClock.uptimeMillis()
        automation.inject(keyEvent(now, KeyEvent.ACTION_DOWN, code))
        automation.inject(keyEvent(now, KeyEvent.ACTION_UP, code))
    }

    /** ASCII text as the virtual keyboard's key events; null when a character has no key. */
    fun typeKeys(text: String): Boolean {
        val events = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(text.toCharArray())
            ?: return false
        for (e in events) automation.inject(KeyEvent.changeTimeRepeat(e, SystemClock.uptimeMillis(), 0))
        return true
    }

    private fun keyEvent(time: Long, action: Int, code: Int) =
        KeyEvent(time, time, action, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD)

    private fun touch(down: Long, time: Long, action: Int, x: Float, y: Float): MotionEvent =
        MotionEvent.obtain(down, time, action, x, y, 0).apply { source = InputDevice.SOURCE_TOUCHSCREEN }

    private fun multi(
        down: Long,
        time: Long,
        action: Int,
        count: Int,
        props: Array<MotionEvent.PointerProperties>,
        coords: Array<MotionEvent.PointerCoords>,
    ): MotionEvent = MotionEvent.obtain(
        down, time, action, count, props.copyOf(count).requireNoNulls(), coords.copyOf(count).requireNoNulls(),
        0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0,
    )

    private fun sleepUntil(t: Long, cancelled: () -> Boolean) {
        while (!cancelled()) {
            val left = t - SystemClock.uptimeMillis()
            if (left <= 0) return
            Thread.sleep(minOf(left, 20))
        }
    }

    companion object {
        private const val TAP_TRIES = 3
        private const val TAP_RETRY_MS = 100L

        val KEYS = mapOf(
            "back" to KeyEvent.KEYCODE_BACK,
            "home" to KeyEvent.KEYCODE_HOME,
            "enter" to KeyEvent.KEYCODE_ENTER,
            "delete" to KeyEvent.KEYCODE_DEL,
            "tab" to KeyEvent.KEYCODE_TAB,
            "appSwitch" to KeyEvent.KEYCODE_APP_SWITCH,
        )
    }
}
