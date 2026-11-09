package dev.appdyno.agent

import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONObject

class Reply(val result: JSONObject, val binary: ByteArray? = null)

/** The protocol's methods on this device. Everything here runs on the one action thread. */
class Handlers(private val automation: Automation, private val token: String) {
    private val capture = TreeCapture(automation)
    private val input = Input(automation)
    private val clipboard = Clipboard()
    private val animations = Animations()
    private val text = TextInput(automation, input, clipboard)
    private val settling = Settling(automation, capture)
    private val a11y = AccessibilityRead(capture, settling)
    private val screenshots = Screenshots(automation, settling)
    private val startedAt = SystemClock.uptimeMillis()

    /** No host connected: the UI automation is let go (accessibility off) until the next request. */
    fun release() = automation.release()

    fun restoreAnimations() = animations.restore()

    fun tokenMatches(given: String) = sameToken(given, token)

    fun hello() = Results.hello(
        BuildConfig.VERSION_NAME,
        Build.VERSION.RELEASE,
        Build.VERSION.SDK_INT,
        "${Build.MANUFACTURER} ${Build.MODEL}",
        Platform.display(),
        android.os.Process.myPid(),
    )

    /** A person's finger on a mirror's window: one event, now, with no settle. On a connection's thread. */
    fun touch(r: TouchRequest) = input.liveTouch(r.phase, r.x, r.y, r.x2, r.y2)

    fun ping(): JSONObject {
        val now = java.time.Instant.now()
        return JSONObject()
            .put("uptimeMs", SystemClock.uptimeMillis() - startedAt)
            .put("atMs", now.epochSecond * 1000.0 + now.nano / 1e6)
    }

    fun handle(method: String, p: JSONObject, job: Job): Reply = when (method) {
        "tree.get" -> {
            val quiet = settling.idle(job)
            val r = TreeRequest.from(p)
            Reply(settling.treeJson(settling.aScreen(job) { capture.capture(r.maxDepth, r.maxNodes, yielding = !quiet) }).apply { if (!Platform.display().on) put("dark", true) })
        }

        "wait" -> WaitFor.handle(WaitRequest.from(p), job, { capture.capture(yielding = !settling.idle(job)) }, settling::treeJson)

        "act" -> act(Action.from(p.getJSONObject("action")), AfterRequest.from(p), job)

        "a11y.read" -> a11y.read(OneValue.maxNodes(p), job)

        "text.set" -> textSet(TextRequest.from(p), job)

        "screenshot" -> screenshots.take(ShotRequest.from(p))

        "app.foreground" -> Reply(JSONObject().apply { foreground()?.let { put("pkg", it) } })

        "app.labels" -> Reply(JSONObject().put("apps", Platform.launcherLabels()))

        "clipboard.set" -> {
            clipboard.set(OneValue.text(p))
            Reply(JSONObject())
        }

        "clipboard.get" -> Reply(JSONObject().apply { clipboard.get()?.let { put("text", it) } })

        "rest.wait" -> {
            settling.awaitRest()
            Reply(JSONObject())
        }

        "animations.set" -> {
            if (OneValue.off(p)) animations.off() else animations.restore()
            Reply(JSONObject())
        }

        "locales" -> Reply(JSONObject().put("tags", OneValue.tags(p)?.let(Locales::set) ?: Locales.get()))

        "orientation.set" -> {
            automation.ua.setRotation(OneValue.rotation(p))
            Reply(JSONObject())
        }

        else -> throw unknownMethod(method)
    }

    private fun act(a: Action, r: AfterRequest, job: Job): Reply {
        val touch = a !is Action.Key
        // on a dark screen a touch reaches no window, and nothing says so: the host wakes it and asks again
        if (touch && !Platform.display().on) throw AgentFailure("SCREEN_OFF", "the screen is off")
        settling.awaitRest()
        val cancelled = { job.cancelled }
        // a touch aimed at a screen that another window has replaced since it was read lands on the wrong one (A/B
        // run 8559e13f: the app restarted into its splash between the read and the tap, and the tap was lost)
        if (touch) {
            settling.sent(r.before)?.let { read ->
                val then = WindowIds.app(read.windows.map { it.id to it.type })
                val now = WindowIds.app(automation.ua.windows.map { it.id to it.type })
                if (WindowIds.replaced(then, now)) {
                    throw AgentFailure("STALE", "the screen changed since it was read: another window is in front", "read the screen again")
                }
            }
        }
        val then = settling.appWindows()
        when (a) {
            is Action.Tap -> input.tap(a.x, a.y)
            is Action.DoubleTap -> input.doubleTap(a.x, a.y)
            is Action.LongPress -> input.longPress(a.x, a.y, a.durationMs, cancelled)
            is Action.Swipe -> input.path(Paths.line(a.from.first, a.from.second, a.to.first, a.to.second, a.durationMs), cancelled)
            is Action.Gesture -> input.gesture(a.pointers, cancelled)
            is Action.Key -> input.key(Input.codeOf(a.key), Input.heldOf(a.modifiers))
        }
        // the window counts from here: injection returns once the app has handled the event, however busy it was
        val at = SystemClock.uptimeMillis()
        // a tap on something that cannot react (plain text, empty space) needs only a short look
        val inert = a is Action.Tap &&
            settling.sent(r.before)?.let { c ->
                val x = a.x.toInt()
                val y = a.y.toInt()
                // a key of the keyboard reacts like any control
                !c.onOtherWindow(x, y) && !HitTest.actionable(c.nodes, x, y, c::inApp)
            } == true
        return settling.after(r, at, job, JSONObject(), then, inert)
    }

    private fun textSet(r: TextRequest, job: Job): Reply {
        settling.awaitRest()
        val then = settling.appWindows()
        val cancelled = { job.cancelled }
        val tapAt = r.at?.let { (x, y) -> { input.tap(x, y) } }
        tapAt?.invoke()
        val o = text.set(r.text, r.replace, r.focusTimeoutMs, cancelled, tapAt, r.at)
        if (r.submit) input.key(android.view.KeyEvent.KEYCODE_ENTER)
        val at = SystemClock.uptimeMillis()
        return settling.after(r.after, at, job, Results.text(o), then)
    }

    private fun foreground(): String? {
        val windows = try {
            automation.ua.windows
        } catch (_: Throwable) {
            emptyList()
        }
        val app = windows.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .let { list -> list.firstOrNull { it.isActive } ?: list.maxByOrNull { it.layer } }
        return app?.root?.packageName?.toString() ?: automation.ua.rootInActiveWindow?.packageName?.toString()
    }
}
