package dev.appdyno.agent

import android.accessibilityservice.AccessibilityServiceInfo
import android.annotation.SuppressLint
import android.app.UiAutomation
import android.content.Context
import android.content.ContextWrapper
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.InputEvent
import android.view.accessibility.AccessibilityEvent
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method

/**
 * The device's one UI automation connection, opened from this shell-user process (no instrumentation),
 * with the accessibility event stream kept as the settle signal. Only one such connection may exist on a
 * device: a second owner is reported as AGENT_CONFLICT.
 */
@SuppressLint("PrivateApi")
class Automation private constructor(val ua: UiAutomation) {
    @Volatile
    var lastEventAt: Long = SystemClock.uptimeMillis()
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

    init {
        ua.setOnAccessibilityEventListener { e: AccessibilityEvent ->
            if (movesLayout(e)) {
                lastEventAt = SystemClock.uptimeMillis()
                events++
            }
        }
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
        else -> true
    }

    /** Drops the client's node cache (a focus or a screen swap it missed would be read stale). */
    fun clearCache() {
        if (android.os.Build.VERSION.SDK_INT >= 34) ua.clearCache() else ua.serviceInfo = ua.serviceInfo
    }

    fun inject(event: InputEvent) {
        val ok = try {
            if (injectNoWait != null) injectNoWait.invoke(ua, event, true, false) as Boolean
            else ua.injectInputEvent(event, true)
        } catch (e: InvocationTargetException) {
            throw injectFailure(e.targetException)
        } catch (e: SecurityException) {
            throw injectFailure(e)
        }
        if (!ok) throw AgentFailure("INTERNAL", "the input event was not delivered")
    }

    private fun injectFailure(t: Throwable): Throwable =
        if (t is SecurityException) AgentFailure(
            "PERMISSION_REQUIRED",
            "the device refuses injected input (${t.message})",
            "Xiaomi/HyperOS: Developer options → USB debugging (Security settings) on, then reconnect",
            t,
        ) else t

    companion object {
        fun connect(): Automation {
            val thread = HandlerThread("appdyno-a11y").apply { start() }
            val connClass = Class.forName("android.app.UiAutomationConnection")
            val conn = connClass.getDeclaredConstructor().apply { isAccessible = true }.newInstance()
            val iface = Class.forName("android.app.IUiAutomationConnection")
            val ua = construct(thread.looper, conn, iface)
            open(ua)
            val info = ua.serviceInfo ?: AccessibilityServiceInfo()
            info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK
            info.flags = info.flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            ua.serviceInfo = info
            return Automation(ua)
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

        private fun open(ua: UiAutomation) {
            val flags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
            try {
                val withFlags = try {
                    UiAutomation::class.java.getDeclaredMethod("connect", Int::class.javaPrimitiveType)
                } catch (_: NoSuchMethodException) {
                    null
                }
                if (withFlags != null) withFlags.apply { isAccessible = true }.invoke(ua, flags)
                else UiAutomation::class.java.getDeclaredMethod("connect").apply { isAccessible = true }.invoke(ua)
            } catch (e: InvocationTargetException) {
                val t = e.targetException
                if (t is IllegalStateException && t.message?.contains("already registered") == true)
                    throw AgentFailure(
                        "AGENT_CONFLICT",
                        "another UI automation client holds this device",
                        "stop the other automation server on the device, then start again",
                        t,
                    )
                throw t
            }
        }
    }
}

/** A system context whose main looper is the accessibility thread (the context constructor reads it). */
private class LooperContext(private val looper: Looper) : ContextWrapper(Platform.systemContext) {
    override fun getMainLooper(): Looper = looper
}
