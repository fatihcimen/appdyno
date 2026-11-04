package dev.appdyno.agent

import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class Reply(val result: JSONObject, val binary: ByteArray? = null)

/** A request in flight; `cancelled` is polled by every loop that can run long. */
class Job(val id: Int) {
    @Volatile
    var cancelled = false
}

/** The protocol's methods on this device. Everything here runs on the one action thread. */
class Handlers(private val automation: Automation, private val token: String) {
    private val capture = TreeCapture(automation)
    private val input = Input(automation)
    private val clipboard = Clipboard()
    private val animations = Animations()
    private val text = TextInput(automation, input, clipboard)
    private val transitions = Transitions(automation)
    private val settler = Settler({ SystemClock.uptimeMillis() }, { automation.awaitEvent(it) }, { automation.lastEventAt })
    private val startedAt = SystemClock.uptimeMillis()

    /** No host connected: the UI automation is let go (accessibility off) until the next request. */
    fun release() = automation.release()

    fun restoreAnimations() = animations.restore()

    fun tokenMatches(given: String): Boolean {
        if (given.length != token.length) return false
        var diff = 0
        for (i in given.indices) diff = diff or (given[i].code xor token[i].code)
        return diff == 0
    }

    fun hello(): JSONObject {
        val d = Platform.display()
        return JSONObject()
            .put("agentVersion", BuildConfig.VERSION_NAME)
            .put("protocol", JSONObject().put("major", PROTOCOL_MAJOR))
            .put("platform", "android")
            .put("osVersion", Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("screen", JSONObject().put("w", d.width).put("h", d.height).put("density", d.densityDpi).put("rotation", d.rotation))
            .put("pid", android.os.Process.myPid())
    }

    /** A person's finger on a mirror's window: one event, now, with no settle. On a connection's thread. */
    fun touch(p: JSONObject) = input.liveTouch(
        p.getInt("p"),
        p.getDouble("x").toFloat(),
        p.getDouble("y").toFloat(),
        if (p.has("x2")) p.getDouble("x2").toFloat() else null,
        if (p.has("y2")) p.getDouble("y2").toFloat() else null,
    )

    fun ping() = JSONObject().put("uptimeMs", SystemClock.uptimeMillis() - startedAt)

    fun handle(method: String, p: JSONObject, job: Job): Reply = when (method) {
        "tree.get" -> {
            val quiet = idle(job)
            val maxDepth = p.optInt("maxDepth", 128)
            val maxNodes = p.optInt("maxNodes", 5_000)
            Reply(treeJson(aScreen(job) { capture.capture(maxDepth, maxNodes, yielding = !quiet) }))
        }
        "wait" -> WaitFor.handle(p, job, { capture.capture(yielding = !idle(job)) }, ::treeJson)
        "act" -> act(p, job)
        "a11y.read" -> a11yRead(p, job)
        "text.set" -> textSet(p, job)
        "screenshot" -> screenshot(p)
        "app.foreground" -> Reply(JSONObject().apply { foreground()?.let { put("pkg", it) } })
        "clipboard.set" -> {
            clipboard.set(p.getString("text"))
            Reply(JSONObject())
        }
        "clipboard.get" -> Reply(JSONObject().apply { clipboard.get()?.let { put("text", it) } })
        "rest.wait" -> {
            awaitRest()
            Reply(JSONObject())
        }
        "animations.set" -> {
            if (p.getBoolean("off")) animations.off() else animations.restore()
            Reply(JSONObject())
        }
        "orientation.set" -> {
            automation.ua.setRotation(p.getInt("rotation"))
            Reply(JSONObject())
        }
        else -> throw unknownMethod(method)
    }

    private fun act(p: JSONObject, job: Job): Reply {
        val a = p.getJSONObject("action")
        // on a dark screen a touch reaches no window, and nothing says so: the host wakes it and asks again
        if (a.getString("kind") != "key" && !Platform.display().on) throw AgentFailure("SCREEN_OFF", "the screen is off")
        awaitRest()
        val cancelled = { job.cancelled }
        // a touch aimed at a screen that another window has replaced since it was read lands on the wrong one (A/B
        // run 8559e13f: the app restarted into its splash between the read and the tap, and the tap was lost)
        if (a.getString("kind") != "key" && p.has("before")) recent[p.getString("before")]?.let { read ->
            val then = WindowIds.app(read.windows.map { it.id to it.type })
            val now = WindowIds.app(automation.ua.windows.map { it.id to it.type })
            if (WindowIds.replaced(then, now)) {
                throw AgentFailure("STALE", "the screen changed since it was read: another window is in front", "read the screen again")
            }
        }
        val then = appWindows()
        when (a.getString("kind")) {
            "tap" -> input.tap(a.getDouble("x").toFloat(), a.getDouble("y").toFloat())
            "doubleTap" -> input.doubleTap(a.getDouble("x").toFloat(), a.getDouble("y").toFloat())
            "longPress" -> input.longPress(a.getDouble("x").toFloat(), a.getDouble("y").toFloat(), a.getLong("durationMs"), cancelled)
            "swipe" -> {
                val from = a.getJSONObject("from")
                val to = a.getJSONObject("to")
                input.path(
                    Paths.line(
                        from.getDouble("x").toFloat(), from.getDouble("y").toFloat(),
                        to.getDouble("x").toFloat(), to.getDouble("y").toFloat(), a.getLong("durationMs"),
                    ),
                    cancelled,
                )
            }
            "gesture" -> {
                val pointers = a.getJSONArray("pointers")
                input.gesture(
                    (0 until pointers.length()).map { i ->
                        val pts = pointers.getJSONArray(i)
                        (0 until pts.length()).map { j ->
                            val s = pts.getJSONObject(j)
                            Sample(s.getLong("t"), s.getDouble("x").toFloat(), s.getDouble("y").toFloat())
                        }
                    },
                    cancelled,
                )
            }
            "key" -> input.key(Input.KEYS[a.getString("key")] ?: throw AgentFailure("INVALID_ARGUMENT", "unknown key"))
            else -> throw AgentFailure("INVALID_ARGUMENT", "unknown action")
        }
        // the window counts from here: injection returns once the app has handled the event, however busy it was
        val at = SystemClock.uptimeMillis()
        // a tap on something that cannot react (plain text, empty space) needs only a short look
        val inert = a.getString("kind") == "tap" && p.has("before") &&
            recent[p.getString("before")]?.let { c ->
                val x = a.getDouble("x").toInt()
                val y = a.getDouble("y").toInt()
                // a key of the keyboard reacts like any control
                !c.onOtherWindow(x, y) && !HitTest.actionable(c.nodes, x, y, c::inApp)
            } == true
        return after(p, at, job, JSONObject(), then, inert)
    }

    /**
     * A tree read with what an accessibility audit needs besides: each node's traversal hints (resolved
     * after the walk from the nodes it fetched, within TRAVERSAL_MS) and, for its first `maxNodes` visible
     * text nodes, how many characters the screen does not show (one call to the app per node, within
     * TEXT_CLIP_MS).
     */
    private fun a11yRead(p: JSONObject, job: Job): Reply {
        val max = p.optInt("maxNodes", 60)
        val index = HashMap<android.view.accessibility.AccessibilityNodeInfo, Int>()
        val texts = ArrayList<Pair<Int, android.view.accessibility.AccessibilityNodeInfo>>()
        val c = capture.capture(yielding = !idle(job), onNode = { i, n ->
            index[n] = i
            if (texts.size < max && n.isVisibleToUser && !n.isEditable && !n.text.isNullOrEmpty()) texts += i to n
        })
        val traversal = JSONArray()
        val tEnd = SystemClock.uptimeMillis() + TRAVERSAL_MS
        for ((n, i) in index) {
            if (job.cancelled || SystemClock.uptimeMillis() > tEnd) break
            // a node without hints answers at once; one with hints is looked up (cached by the walk)
            val before = n.traversalBefore?.let { index[it] }
            val after = n.traversalAfter?.let { index[it] }
            if (before == null && after == null) continue
            traversal.put(JSONObject().put("n", i).apply { before?.let { put("before", it) }; after?.let { put("after", it) } })
        }
        val clips = JSONArray()
        val end = SystemClock.uptimeMillis() + TEXT_CLIP_MS
        for ((i, n) in texts) {
            if (job.cancelled || SystemClock.uptimeMillis() > end) break
            val (chars, hidden) = TextClip.of(n) ?: continue
            clips.put(JSONObject().put("n", i).put("chars", chars).put("hidden", hidden))
        }
        return Reply(JSONObject().put("tree", treeJson(c)).put("clips", clips).put("traversal", traversal))
    }

    private fun textSet(p: JSONObject, job: Job): Reply {
        awaitRest()
        val then = appWindows()
        val cancelled = { job.cancelled }
        val point = p.optJSONObject("at")?.let { at -> at.getDouble("x").toFloat() to at.getDouble("y").toFloat() }
        val tapAt = point?.let { (x, y) -> { input.tap(x, y) } }
        tapAt?.invoke()
        val o = text.set(p.getString("text"), p.optBoolean("replace"), p.optLong("focusTimeoutMs", 5_000), cancelled, tapAt, point)
        if (p.optBoolean("submit")) input.key(android.view.KeyEvent.KEYCODE_ENTER)
        val at = SystemClock.uptimeMillis()
        val out = JSONObject().put("mode", o.mode).put("focusMs", o.focusMs)
        o.verified?.let { out.put("verified", it) }
        return after(p, at, job, out, then)
    }

    /**
     * Before a read: the app quiet, as the platform tells it (no layout-moving accessibility event for
     * IDLE_QUIET_MS, at most IDLE_MAX_MS); an app already quiet is read at once. Whether it went quiet.
     */
    private fun idle(job: Job): Boolean {
        val end = SystemClock.uptimeMillis() + IDLE_MAX_MS
        while (!job.cancelled && SystemClock.uptimeMillis() < end) {
            val quiet = SystemClock.uptimeMillis() - automation.lastEventAt
            if (quiet >= IDLE_QUIET_MS) return true
            Thread.sleep(IDLE_QUIET_MS - quiet)
        }
        return SystemClock.uptimeMillis() - automation.lastEventAt >= IDLE_QUIET_MS
    }

    /** The settle and the read an action asked for, into its result. `then`: the app's windows before it. */
    private fun after(p: JSONObject, at: Long, job: Job, out: JSONObject, windowsBefore: Set<Int>, inert: Boolean = false): Reply {
        val read = p.optString("read", "none")
        val settle = p.optJSONObject("settle")
        var last: Capture? = null
        if (settle != null) {
            val quiet = settle.optLong("quietMs", 200).let { if (inert) minOf(it, INERT_QUIET_MS) else it }
            var asked = false
            val before = if (p.has("before")) recent[p.getString("before")] else null
            var then = windowsBefore
            val o = settler.run(
                at,
                quiet,
                settle.optLong("maxMs", 3_000),
                before,
                {
                    asked = false
                    readSettling().also {
                        last = it
                        // the list of windows can lag a screen just opened: what still shows the old layout is the old window
                        if (before != null && it.sameLayout(before)) then = WindowIds.app(it.windows.map { w -> w.id to w.type })
                    }
                },
                { x, y -> x.sameLayout(y) },
                { it.busy },
                { job.cancelled },
                { it.nodes.size },
                { hold(then, last, !asked).also { asked = true } },
                { c -> WindowIds.replaced(WindowIds.app(c.windows.map { w -> w.id to w.type }), appWindows()) },
            )
            val moving = last?.sliding == true || transitions.runningNow()
            out.put(
                "settle",
                JSONObject().put("settled", o.settled).put("ms", o.elapsedMs).put("reads", o.reads).put("quietMs", o.quietMs)
                    .apply { if (moving) put("moving", true) },
            )
        }
        if (read != "none") {
            val c = last?.takeUnless { it.noApp } ?: aScreen(job) { capture.capture() }
            if (read == "tree") out.put("tree", treeJson(c)) else if (read == "hash") out.put("hash", c.also { recent[it.hash] = it }.hash)
        }
        return Reply(out)
    }

    /** A read in a settle: no window at all (between two screens) is a screen with nothing on it, not a failure. */
    private fun readSettling(): Capture = try {
        capture.capture()
    } catch (_: AgentFailure) {
        Capture(emptyList(), emptyList(), false, 0, Platform.display())
    }

    /**
     * A read to answer with: never the status bar alone, as between two screens there is nothing else for up to
     * 500 ms, and "no elements" would be a false answer. Waits for a screen on a display that is on; else NOT_FOUND.
     */
    private fun aScreen(job: Job, read: () -> Capture): Capture {
        val end = SystemClock.uptimeMillis() + NO_SCREEN_MS
        while (true) {
            val c = try {
                read()
            } catch (e: AgentFailure) {
                if (e.code != "NOT_FOUND") throw e
                null
            }
            if (c != null && !c.noApp) return c
            if (job.cancelled || !Platform.display().on || SystemClock.uptimeMillis() >= end) {
                throw AgentFailure("NOT_FOUND", "no window to read (screen off or locked?)")
            }
            automation.awaitEvent(Settler.POLL_MS)
        }
    }

    private fun appWindows() = WindowIds.app(automation.ua.windows.map { it.id to it.type })

    /**
     * Nothing worth reading now (no call to the app): between two screens; a window off the display on a release
     * with no resting places; a window transition still before its new window, where the old window read again
     * says nothing, or whose last read had no resting places. One question to WMS per read.
     */
    private fun hold(then: Set<Int>, last: Capture?, ask: Boolean): Boolean {
        val windows = try {
            automation.ua.windows
        } catch (_: Throwable) {
            emptyList()
        }
        val d = Platform.display()
        val b = android.graphics.Rect()
        var screen = false
        for (w in windows) {
            w.getBoundsInScreen(b)
            if (Slide.hasScreen(w.type, b.left, b.top, b.right, b.bottom, d)) screen = true
            // no resting places on this release: a window off the display has nothing final to read
            if (Build.VERSION.SDK_INT < 34 && w.type == AccessibilityWindowInfo.TYPE_APPLICATION && Slide.outside(b.left, b.top, b.right, b.bottom, d)) return true
        }
        if (!screen) return true
        // a new window with known resting places reads at once whatever the answer; it only says whether it is `moving`
        val newWindow = WindowIds.app(windows.map { it.id to it.type }) != then && last?.restUnknown != true
        if (newWindow) {
            if (ask) transitions.ask()
            return false
        }
        return transitions.running(ask)
    }

    /**
     * An action or a picture waits for a running transition: a touch in one can reach the old window or none
     * (the first tap after a start was lost so), and WMS's answer brings the input windows up to date too.
     */
    private fun awaitRest() = transitions.awaitEnd(SLIDE_MAX_MS)

    private fun screenshot(p: JSONObject): Reply {
        awaitRest()
        val shot = automation.ua.takeScreenshot() ?: throw AgentFailure("INTERNAL", "the screen could not be captured")
        // bitmaps live in native memory until a collection: each one is freed as soon as it is encoded
        val made = mutableListOf(shot)
        try {
            var bmp = if (shot.config == Bitmap.Config.HARDWARE) shot.copy(Bitmap.Config.ARGB_8888, false).also { made += it } else shot
            val max = p.optInt("maxPx", 0)
            if (max > 0 && maxOf(bmp.width, bmp.height) > max) {
                val k = max.toFloat() / maxOf(bmp.width, bmp.height)
                bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * k).toInt().coerceAtLeast(1), (bmp.height * k).toInt().coerceAtLeast(1), true).also { made += it }
            }
            val png = p.optString("format", "jpeg") == "png"
            val bytes = ByteArrayOutputStream().use { out ->
                bmp.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, p.optInt("quality", 80), out)
                out.toByteArray()
            }
            val result = JSONObject().put("w", bmp.width).put("h", bmp.height).put("format", if (png) "png" else "jpeg").put("bytes", bytes.size)
            return Reply(result, bytes)
        } finally {
            for (b in made.distinct()) b.recycle()
        }
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

    /** The captures sent lately, by digest: a caller's `before` is compared with the layout itself. */
    private val recent = object : LinkedHashMap<String, Capture>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Capture>?) = size > 8
    }

    private fun treeJson(c: Capture): JSONObject {
        recent[c.hash] = c
        val windows = JSONArray()
        for (w in c.windows) {
            windows.put(
                JSONObject().put("type", w.type).apply { w.pkg?.let { put("pkg", it) } }.put("layer", w.layer)
                    .put("b", rect(w.bounds.left, w.bounds.top, w.bounds.right, w.bounds.bottom))
                    .put("active", w.active).put("focused", w.focused),
            )
        }
        val nodes = JSONArray()
        for ((i, n) in c.nodes.withIndex()) {
            val o = JSONObject().put("p", n.parent).put("w", n.window).put("c", n.cls)
            (n.id ?: c.tags[i])?.let { o.put("id", it) }
            n.text?.let { o.put("t", it) }
            n.desc?.let { o.put("d", it) }
            n.hint?.let { o.put("h", it) }
            nodes.put(o.put("b", rect(n.left, n.top, n.right, n.bottom)).put("f", n.flags))
        }
        return JSONObject().put("windows", windows).put("nodes", nodes).put("truncated", c.truncated)
            .put("elapsedMs", c.elapsedMs).put("hash", c.hash).apply { if (c.sliding) put("moving", true) }
    }

    private fun rect(l: Int, t: Int, r: Int, b: Int) = JSONArray().put(l).put(t).put(r).put(b)

    companion object {
        /** The quiet window after a tap on something that cannot react (an immediate touch reaction still shows). */
        const val INERT_QUIET_MS = 80L
        /** A read to answer with waits this long for a screen. */
        const val NO_SCREEN_MS = 2_000L
        /** WMS's own cap on a transition's wait. */
        const val SLIDE_MAX_MS = 5_000L
        /** A read waits for this long without a layout-moving event (an app already quiet: no wait). */
        const val IDLE_QUIET_MS = 150L
        const val IDLE_MAX_MS = 1_000L
        /** a11y.read's character lookups stop after this long (the tree read is not counted). */
        const val TEXT_CLIP_MS = 1_500L
        /** a11y.read's traversal hints are resolved for this long at most. */
        const val TRAVERSAL_MS = 300L
    }
}

/** The app windows of a screen by id (pure, unit tested). */
object WindowIds {
    fun app(windows: List<Pair<Int, Int>>): Set<Int> =
        windows.filter { it.second == android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION }.map { it.first }.toSet()

    /** Another app window came in front, or the one read is gone (an unknown id proves nothing). */
    fun replaced(then: Set<Int>, now: Set<Int>) = -1 !in then && then.isNotEmpty() && now.isNotEmpty() && then != now
}
