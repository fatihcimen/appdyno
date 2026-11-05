package dev.appdyno.agent

import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent

class Sample(val t: Long, val x: Float, val y: Float)

/** A key that is held during another, and what it sets on it. */
class Held(val code: Int, val meta: Int)

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
        // a Xiaomi just woken may refuse the finger-up, its finger-down having reached no window: nothing has reached
        // the app, and the tap can be made again
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
        Platform.userActivity()
        val down = SystemClock.uptimeMillis()
        automation.inject(touch(down, down, MotionEvent.ACTION_DOWN, x, y))
        automation.inject(touch(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y))
    }

    fun doubleTap(x: Float, y: Float) {
        tap(x, y)
        // the platform takes a second touch sooner than 40 ms after the first as a separate tap
        Thread.sleep(40)
        tap(x, y)
    }

    fun longPress(x: Float, y: Float, durationMs: Long, cancelled: () -> Boolean) {
        Platform.userActivity()
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
        Platform.userActivity()
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

    private var liveDownAt = 0L
    private var liveFingers = 0
    private val liveProps = Array(2) { i -> MotionEvent.PointerProperties().apply { id = i; toolType = MotionEvent.TOOL_TYPE_FINGER } }
    private val liveCoords = Array(2) { MotionEvent.PointerCoords().apply { pressure = 1f; size = 1f } }

    /**
     * One phase of a person's touch, in fractions of the screen as it is now: `p` 0 down, 1 moved, 2 up. A
     * second finger comes and goes by the presence of `x2`. Nothing waits for the app, so that a busy app
     * cannot hold up the next move; moves are in order, as the dispatcher keeps them.
     */
    @Synchronized
    fun liveTouch(p: Int, x: Float, y: Float, x2: Float?, y2: Float?) {
        val screen = Platform.display()
        liveCoords[0].x = x * screen.width
        liveCoords[0].y = y * screen.height
        if (x2 != null && y2 != null) {
            liveCoords[1].x = x2 * screen.width
            liveCoords[1].y = y2 * screen.height
        }
        val fingers = if (x2 != null && y2 != null) 2 else 1
        val now = SystemClock.uptimeMillis()
        fun send(action: Int, count: Int) =
            automation.injectLive(multi(liveDownAt, now, action, count, liveProps, liveCoords))
        val second = 1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT
        when (p) {
            0 -> {
                Platform.userActivity()
                liveDownAt = now
                send(MotionEvent.ACTION_DOWN, 1)
                if (fingers == 2) send(MotionEvent.ACTION_POINTER_DOWN or second, 2)
                liveFingers = fingers
            }
            1 -> if (liveFingers > 0) {
                if (fingers == 2 && liveFingers == 1) send(MotionEvent.ACTION_POINTER_DOWN or second, 2)
                if (fingers == 1 && liveFingers == 2) send(MotionEvent.ACTION_POINTER_UP or second, 2)
                liveFingers = fingers
                send(MotionEvent.ACTION_MOVE, fingers)
            }
            2 -> if (liveFingers > 0) {
                if (liveFingers == 2) send(MotionEvent.ACTION_POINTER_UP or second, 2)
                send(MotionEvent.ACTION_UP, 1)
                liveFingers = 0
            }
            else -> throw AgentFailure("INVALID_ARGUMENT", "a touch has no phase $p")
        }
    }

    /** A press, with `held` going down before it: a text field selects by the Shift key it saw, not by a flag on the arrow. */
    fun key(code: Int, held: List<Held> = emptyList()) {
        val now = SystemClock.uptimeMillis()
        var meta = 0
        for (h in held) {
            meta = meta or h.meta
            automation.inject(keyEvent(now, KeyEvent.ACTION_DOWN, h.code, meta))
        }
        automation.inject(keyEvent(now, KeyEvent.ACTION_DOWN, code, meta))
        automation.inject(keyEvent(now, KeyEvent.ACTION_UP, code, meta))
        for (h in held.reversed()) {
            meta = meta and h.meta.inv()
            automation.inject(keyEvent(now, KeyEvent.ACTION_UP, h.code, meta))
        }
    }

    /** ASCII text as the virtual keyboard's key events; null when a character has no key. */
    fun typeKeys(text: String): Boolean {
        val events = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD).getEvents(text.toCharArray())
            ?: return false
        for (e in events) automation.inject(KeyEvent.changeTimeRepeat(e, SystemClock.uptimeMillis(), 0))
        return true
    }

    private fun keyEvent(time: Long, action: Int, code: Int, meta: Int) =
        KeyEvent(time, time, action, code, 0, meta, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD)

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
            "volumeUp" to KeyEvent.KEYCODE_VOLUME_UP,
            "volumeDown" to KeyEvent.KEYCODE_VOLUME_DOWN,
            "power" to KeyEvent.KEYCODE_POWER,
            "lock" to KeyEvent.KEYCODE_SLEEP,
            "escape" to KeyEvent.KEYCODE_ESCAPE,
            "space" to KeyEvent.KEYCODE_SPACE,
            "arrowUp" to KeyEvent.KEYCODE_DPAD_UP,
            "arrowDown" to KeyEvent.KEYCODE_DPAD_DOWN,
            "arrowLeft" to KeyEvent.KEYCODE_DPAD_LEFT,
            "arrowRight" to KeyEvent.KEYCODE_DPAD_RIGHT,
            "mute" to KeyEvent.KEYCODE_VOLUME_MUTE,
            "siri" to KeyEvent.KEYCODE_ASSIST,
        )

        private val CTRL = Held(KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON)

        /** Android has no command key: its text fields take Ctrl for it. */
        private val HELD = mapOf(
            "command" to CTRL,
            "control" to CTRL,
            "option" to Held(KeyEvent.KEYCODE_ALT_LEFT, KeyEvent.META_ALT_ON or KeyEvent.META_ALT_LEFT_ON),
            "shift" to Held(KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON),
        )

        /** A key by its name, or the letter or digit it types. */
        fun codeOf(key: String): Int {
            val c = key.singleOrNull()
            return when (c) {
                in 'a'..'z' -> KeyEvent.KEYCODE_A + (c!! - 'a')
                in '0'..'9' -> KeyEvent.KEYCODE_0 + (c!! - '0')
                else -> KEYS[key] ?: throw AgentFailure("INVALID_ARGUMENT", "unknown key")
            }
        }

        fun heldOf(modifiers: List<String>): List<Held> =
            modifiers.map { HELD[it] ?: throw AgentFailure("INVALID_ARGUMENT", "unknown modifier") }
    }
}
