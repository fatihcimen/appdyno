package dev.appdyno.agent

import android.accessibilityservice.AccessibilityServiceInfo
import android.annotation.SuppressLint
import android.app.UiAutomation
import android.content.Context
import android.content.ContextWrapper
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.InputEvent
import android.view.MotionEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The device's one UI automation connection, opened from this shell-user process (no instrumentation),
 * with the accessibility event stream kept as the settle signal. Only one such connection may exist on a
 * device: a second owner is reported as AGENT_CONFLICT.
 */
@SuppressLint("PrivateApi") // a shell process opens its UI automation by a hidden connection
class Automation private constructor(private val looper: Looper) {
    @Volatile
    private var current: UiAutomation? = null

    /**
     * The connection, opened again on first use after release(): while it is open accessibility is on in
     * every app, which costs an app's main thread (a cold start about 13 % longer, measured), so it is held
     * only while a host is connected.
     */
    val ua: UiAutomation
        get() = current ?: synchronized(this) { current ?: open().also { current = it } }

    /** Whether the connection is open now. */
    val connected: Boolean get() = current != null

    /** How long the last open took (ms): the cost of taking the connection again. */
    @Volatile
    var lastOpenMs: Long = 0
        private set

    @Volatile
    var lastEventAt: Long = 0
        private set

    @Volatile
    var events: Long = 0
        private set

    /** UiAutomation's injection that skips the wait for animations, where the release has it. */
    private val injectNoWait: Method? = try {
        UiAutomation::class.java.getMethod(
            "injectInputEvent",
            InputEvent::class.java,
            Boolean::class.javaPrimitiveType,
            Boolean::class.javaPrimitiveType,
        )
    } catch (_: NoSuchMethodException) {
        null
    }

    private val eventLock = Object()

    private fun wakeOnEvent() = synchronized(eventLock) {
        events++
        eventLock.notifyAll()
    }

    @Volatile
    private var wakes = 0L

    /** Ends awaitEvent's waits. */
    fun wake() = synchronized(eventLock) {
        wakes++
        eventLock.notifyAll()
    }

    /** Sleeps for `ms`, or until a layout-moving event arrives or wake() is called. */
    fun awaitEvent(ms: Long) {
        val end = SystemClock.uptimeMillis() + ms
        synchronized(eventLock) {
            val seen = events + wakes
            while (events + wakes == seen) {
                val left = end - SystemClock.uptimeMillis()
                if (left <= 0) return
                eventLock.wait(left)
            }
        }
    }

    /** Closes the connection (accessibility goes off in the apps); the next use opens it again. */
    fun release() = synchronized(this) {
        val ua = current ?: return@synchronized
        current = null
        // the system puts back the rotation it found when the automation connected: a turn a host asked for stays, and
        // the host that wrote it down puts it back
        val turn = ROTATION.map { sh("settings", "get", "system", it).trim() }
        try {
            UiAutomation::class.java.getDeclaredMethod("disconnect").apply { isAccessible = true }.invoke(ua)
        } catch (e: Throwable) {
            System.err.println("UI automation did not disconnect: $e")
        }
        sh("sh", "-c", SettingsScript.restore("system", ROTATION.zip(turn)))
    }

    private fun open(): UiAutomation {
        val start = SystemClock.uptimeMillis()
        val connClass = Class.forName("android.app.UiAutomationConnection")
        val iface = Class.forName("android.app.IUiAutomationConnection")
        val ua = pastConflict(RELEASE_WAIT_MS, RELEASE_PAUSE_MS, SystemClock::uptimeMillis, Thread::sleep) {
            // one that was refused does not connect again
            val conn = connClass.getDeclaredConstructor().apply { isAccessible = true }.newInstance()
            construct(looper, conn, iface).also(::connect)
        }
        val info = ua.serviceInfo ?: AccessibilityServiceInfo()
        // only the events the settle reads: an app sends only the event types some service asked for,
        // so every other kind (hover, touch, text, focus, announcements) costs its main thread nothing
        info.eventTypes = LAYOUT_EVENTS
        info.flags = info.flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
            AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
            AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        ua.serviceInfo = info
        lastEventAt = SystemClock.uptimeMillis()
        ua.setOnAccessibilityEventListener { e: AccessibilityEvent ->
            if (movesLayout(e)) {
                lastEventAt = SystemClock.uptimeMillis()
                wakeOnEvent()
            }
        }
        // a fresh connection learns the windows over a moment, and the apps turn their accessibility on: a
        // read before then shows part of the screen (seen: 17 nodes, then 46). Until the app's window is
        // known and its events have gone quiet.
        while (SystemClock.uptimeMillis() - start < WINDOWS_WAIT_MS &&
            (
                ua.windows.none { it.type == AccessibilityWindowInfo.TYPE_APPLICATION } ||
                    SystemClock.uptimeMillis() - lastEventAt < OPEN_QUIET_MS
                )
        ) {
            Thread.sleep(20)
        }
        lastOpenMs = SystemClock.uptimeMillis() - start
        return ua
    }

    /**
     * Whether an event can mean the layout moved: focus changes and pure text changes (a countdown, a
     * typed character) cannot, as the layout digest leaves text out too.
     */
    private fun movesLayout(e: AccessibilityEvent): Boolean = when (e.eventType) {
        AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED,
        AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED,
        AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
        AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED,
        -> false

        AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ->
            e.contentChangeTypes != AccessibilityEvent.CONTENT_CHANGE_TYPE_TEXT

        // a window only moving (a slide): reads tell its place; a sliding window's content has not moved
        AccessibilityEvent.TYPE_WINDOWS_CHANGED ->
            android.os.Build.VERSION.SDK_INT < 34 ||
                e.windowChanges and (
                    AccessibilityEvent.WINDOWS_CHANGE_ADDED or
                        AccessibilityEvent.WINDOWS_CHANGE_REMOVED or AccessibilityEvent.WINDOWS_CHANGE_ACTIVE
                    ) != 0

        else -> true
    }

    /** Drops the client's node cache (a focus or a screen swap it missed would be read stale). */
    fun clearCache() {
        if (android.os.Build.VERSION.SDK_INT >= 34) ua.clearCache() else ua.serviceInfo = ua.serviceInfo
    }

    fun inject(event: InputEvent) = deliver(event) {
        if (injectNoWait != null) {
            injectNoWait.invoke(ua, it, true, false) as Boolean
        } else {
            ua.injectInputEvent(it, true)
        }
    }

    /** The input manager's own injection, which a shell user may call: no accessibility connection on its way. */
    private val direct: Pair<Any, Method>? = try {
        val c = try {
            Class.forName("android.hardware.input.InputManagerGlobal")
        } catch (_: ClassNotFoundException) {
            Class.forName("android.hardware.input.InputManager")
        }
        c.getMethod("getInstance").invoke(null)!! to
            c.getMethod("injectInputEvent", InputEvent::class.java, Int::class.javaPrimitiveType)
    } catch (_: ReflectiveOperationException) {
        null
    }

    /**
     * For a person's finger on a mirror's window. Waits for nothing: the next move must not queue behind a busy
     * app. Directly where the release allows: measured on a Xiaomi, the way by UI automation cost a tap 30 ms.
     */
    fun injectLive(event: InputEvent) = deliver(event) {
        if (direct != null) {
            direct.second.invoke(direct.first, it, INJECT_ASYNC) as Boolean
        } else if (injectNoWait != null) {
            injectNoWait.invoke(ua, it, false, false) as Boolean
        } else {
            ua.injectInputEvent(it, false)
        }
    }

    private fun deliver(event: InputEvent, send: (InputEvent) -> Boolean) {
        val ok = try {
            pastLeftFinger(event, send)
        } catch (e: InvocationTargetException) {
            throw injectFailure(e.targetException)
        } catch (e: SecurityException) {
            throw injectFailure(e)
        }
        if (!ok) throw AgentFailure("INTERNAL", "the input event was not delivered")
    }

    /**
     * Android 17 holds injected touches to one consistent stream, whoever sent them: a finger left down, by an agent
     * killed during a long press or a window closed during a drag, has every later finger-down refused ("Invalid DOWN
     * event - pointers already down") until it is cancelled, where an earlier release took the new one. A refused
     * finger-down lifts it and is sent once more.
     */
    private fun pastLeftFinger(event: InputEvent, send: (InputEvent) -> Boolean): Boolean {
        if (send(event)) return true
        if (event !is MotionEvent || event.actionMasked != MotionEvent.ACTION_DOWN) return false
        return liftLeftFinger(send) && send(event)
    }

    /**
     * Cancels a finger an injection left down, one or a pinch's two, and says whether there was one. Held on the
     * status bar it opens the shade at the next activity start on Android 17, so a new agent lifts it at once.
     */
    fun liftLeftFinger(send: (InputEvent) -> Boolean = { ua.injectInputEvent(it, true) }): Boolean = (1..2).any { send(cancel(it)) }

    @SuppressLint("InlinedApi") // FLAG_CANCELED goes to every release as it always has; below 33 a guard would change the cancel
    private fun cancel(fingers: Int): MotionEvent {
        val now = SystemClock.uptimeMillis()
        val props = Array(fingers) { i ->
            MotionEvent.PointerProperties().apply {
                id = i
                toolType = MotionEvent.TOOL_TYPE_FINGER
            }
        }
        val coords = Array(fingers) { MotionEvent.PointerCoords() }
        return MotionEvent.obtain(
            now, now, MotionEvent.ACTION_CANCEL, fingers, props, coords,
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.FLAG_CANCELED,
        )
    }

    private fun injectFailure(t: Throwable): Throwable = if (t is SecurityException) {
        AgentFailure(
            "PERMISSION_REQUIRED",
            "the device refuses injected input (${t.message})",
            "Xiaomi/HyperOS: Developer options → USB debugging (Security settings) on, then reconnect",
            t,
        )
    } else {
        t
    }

    companion object {
        /** InputManager's INJECT_INPUT_EVENT_MODE_ASYNC. */
        private const val INJECT_ASYNC = 0

        /** A turn of the screen, the user rotation before the lock, which turns the screen to it. */
        private val ROTATION = listOf("user_rotation", "accelerometer_rotation")

        /** The longest a new connection is given to learn the windows on screen and go quiet. */
        const val WINDOWS_WAIT_MS = 2_000L

        /** A new connection is ready once the apps sent no layout event for this long. */
        const val OPEN_QUIET_MS = 150L

        /** How long a holder that was killed is waited out, about twice what the system keeps it. */
        const val RELEASE_WAIT_MS = 4_000L
        const val RELEASE_PAUSE_MS = 200L

        /** The events that can mean the layout moved (movesLayout reads them). */
        const val LAYOUT_EVENTS = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
            AccessibilityEvent.TYPE_WINDOWS_CHANGED or
            AccessibilityEvent.TYPE_VIEW_SCROLLED or
            AccessibilityEvent.TYPE_VIEW_SELECTED

        /** Opens the connection once at start, so a device that refuses it fails the start. */
        fun connect(): Automation {
            val thread = HandlerThread("appdyno-a11y").apply { start() }
            // a device that refuses injected input says so at the first touch, not here
            return Automation(thread.looper).also {
                it.ua
                runCatching { it.liftLeftFinger() }
            }
        }

        /** The constructor this release has: a looper or a context, the connection, maybe a display id. */
        private fun construct(looper: Looper, conn: Any, iface: Class<*>): UiAutomation {
            val ctors = UiAutomation::class.java.declaredConstructors
                .sortedBy { c -> if (c.parameterTypes.any { it == Looper::class.java }) 0 else 1 }
            for (c in ctors) {
                val args = c.parameterTypes.map { t ->
                    when {
                        t == Looper::class.java -> looper
                        Context::class.java.isAssignableFrom(t) -> LooperContext(looper)
                        iface.isAssignableFrom(t) -> conn
                        t == Int::class.javaPrimitiveType -> 0
                        else -> null
                    }
                }
                if (args.any { it == null }) continue
                c.isAccessible = true
                return c.newInstance(*args.toTypedArray()) as UiAutomation
            }
            throw AgentFailure("UNSUPPORTED", "no known UiAutomation constructor on this release")
        }

        private fun connect(ua: UiAutomation) {
            val flags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
            try {
                val withFlags = try {
                    UiAutomation::class.java.getDeclaredMethod("connect", Int::class.javaPrimitiveType)
                } catch (_: NoSuchMethodException) {
                    null
                }
                if (withFlags != null) {
                    withFlags.apply { isAccessible = true }.invoke(ua, flags)
                } else {
                    UiAutomation::class.java.getDeclaredMethod("connect").apply { isAccessible = true }.invoke(ua)
                }
            } catch (e: InvocationTargetException) {
                val t = e.targetException
                if (t is IllegalStateException && t.message?.contains("already registered") == true) {
                    throw AgentFailure(
                        "AGENT_CONFLICT",
                        "another UI automation client holds this device",
                        "stop the other automation server on the device, then start again",
                        t,
                    )
                }
                throw t
            }
        }
    }
}

/**
 * Whether a window transition runs, from WMS itself: `syncInputTransactions(true)` (hidden, by reflection) returns
 * when nothing animates and no transition is running, 5 s at most, and never calls the app. It returns at once
 * if the transition has not started, and it cannot see animations inside the app. Where the release lacks it
 * (API 30 and below) none is ever reported. The call blocks, so it runs on a thread of its own; its return wakes
 * the settle's sleep.
 */
class Transitions(private val automation: Automation) {
    private val method: Method? = try {
        UiAutomation::class.java.getDeclaredMethod("syncInputTransactions", Boolean::class.javaPrimitiveType).apply { isAccessible = true }
    } catch (_: Throwable) {
        null
    }

    private var question: CountDownLatch? = null
    private var askedAt = 0L

    /** The last question is still unanswered: a transition runs. */
    val open: Boolean get() = (question?.count ?: 0L) > 0

    /** Asks WMS unless the last question is still out; the answer comes on its own. */
    fun ask(): CountDownLatch? {
        if (open) return question
        val m = method ?: return null
        val done = CountDownLatch(1)
        question = done
        askedAt = SystemClock.uptimeMillis()
        Thread({
            try {
                m.invoke(automation.ua, true)
            } catch (_: Throwable) {
                // no answer from WMS: as if nothing ran
            } finally {
                done.countDown()
                automation.wake()
            }
        }, "appdyno-transition").apply { isDaemon = true }.start()
        return done
    }

    /**
     * Does one run? `again`: ask anew if nothing was running at the last question. An idle WMS answers within
     * ANSWER_MS; a slow one reads as running until it answers, which delays a read and no more.
     */
    fun running(again: Boolean): Boolean {
        if (open) return true
        if (!again) return false
        return ask()?.await(ANSWER_MS, TimeUnit.MILLISECONDS) == false
    }

    /**
     * For an answer's `moving`: the question is out for longer than an idle WMS takes, up to the time left of that.
     * An answer comes right after a read that asked, so a question merely not back yet says nothing.
     */
    fun runningNow(): Boolean {
        val q = question ?: return false
        val left = askedAt + IDLE_ANSWER_MS - SystemClock.uptimeMillis()
        if (left > 0) q.await(left, TimeUnit.MILLISECONDS)
        return q.count > 0
    }

    /** Until the running one ended, at most `maxMs`. */
    fun awaitEnd(maxMs: Long) {
        ask()?.await(maxMs, TimeUnit.MILLISECONDS)
    }

    private companion object {
        const val ANSWER_MS = 30L
        const val IDLE_ANSWER_MS = 80L
    }
}

/** A system context whose main looper is the accessibility thread (the context constructor reads it). */
private class LooperContext(private val looper: Looper) : ContextWrapper(Platform.systemContext) {
    override fun getMainLooper(): Looper = looper
}
