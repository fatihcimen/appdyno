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
    private val text = TextInput(automation, input, clipboard)
    private val settler = Settler({ SystemClock.uptimeMillis() }, { Thread.sleep(it) }, { automation.lastEventAt })
    private val startedAt = SystemClock.uptimeMillis()

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
            .put("protocol", JSONObject().put("major", 1).put("minor", 0))
            .put("platform", "android")
            .put("osVersion", Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("screen", JSONObject().put("w", d.width).put("h", d.height).put("density", d.densityDpi).put("rotation", d.rotation))
            .put("capabilities", JSONArray(CAPABILITIES))
            .put("pid", android.os.Process.myPid())
    }

    fun ping() = JSONObject().put("uptimeMs", SystemClock.uptimeMillis() - startedAt)

    fun handle(method: String, p: JSONObject, job: Job): Reply = when (method) {
        "tree.get" -> {
            idle(job)
            Reply(treeJson(capture.capture(p.optInt("maxDepth", 128), p.optInt("maxNodes", 5_000))))
        }
        "act" -> act(p, job)
        "text.set" -> textSet(p, job)
        "screenshot" -> screenshot(p)
        "app.foreground" -> Reply(JSONObject().apply { foreground()?.let { put("pkg", it) } })
        "clipboard.set" -> {
            clipboard.set(p.getString("text"))
            Reply(JSONObject())
        }
        "clipboard.get" -> Reply(JSONObject().apply { clipboard.get()?.let { put("text", it) } })
        "orientation.set" -> {
            automation.ua.setRotation(p.getInt("rotation"))
            Reply(JSONObject())
        }
        else -> throw AgentFailure("INVALID_ARGUMENT", "unknown method $method")
    }

    private fun act(p: JSONObject, job: Job): Reply {
        val a = p.getJSONObject("action")
        val cancelled = { job.cancelled }
        val at = SystemClock.uptimeMillis()
        when (a.getString("kind")) {
            "tap" -> input.tap(a.getDouble("x").toFloat(), a.getDouble("y").toFloat())
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
        // a tap on something that cannot react (plain text, empty space) needs only a short look
        val inert = a.getString("kind") == "tap" && p.has("before") &&
            recent[p.getString("before")]?.let { c ->
                val x = a.getDouble("x").toInt()
                val y = a.getDouble("y").toInt()
                // a key of the keyboard reacts like any control
                !c.onOtherWindow(x, y) && !HitTest.actionable(c.nodes, x, y, c::inApp)
            } == true
        return after(p, at, job, JSONObject(), inert)
    }

    private fun textSet(p: JSONObject, job: Job): Reply {
        val cancelled = { job.cancelled }
        val point = p.optJSONObject("at")?.let { at -> at.getDouble("x").toFloat() to at.getDouble("y").toFloat() }
        val tapAt = point?.let { (x, y) -> { input.tap(x, y) } }
        tapAt?.invoke()
        val o = text.set(p.getString("text"), p.optBoolean("replace"), p.optLong("focusTimeoutMs", 5_000), cancelled, tapAt, point)
        if (p.optBoolean("submit")) input.key(android.view.KeyEvent.KEYCODE_ENTER)
        val at = SystemClock.uptimeMillis()
        val out = JSONObject().put("mode", o.mode).put("verified", o.verified).put("focusMs", o.focusMs)
        return after(p, at, job, out)
    }

    /**
     * Before a read: the app quiet, as the platform tells it (no layout-moving accessibility event for
     * IDLE_QUIET_MS, at most IDLE_MAX_MS); an app already quiet is read at once.
     */
    private fun idle(job: Job) {
        val end = SystemClock.uptimeMillis() + IDLE_MAX_MS
        while (!job.cancelled && SystemClock.uptimeMillis() < end) {
            val quiet = SystemClock.uptimeMillis() - automation.lastEventAt
            if (quiet >= IDLE_QUIET_MS) return
            Thread.sleep(IDLE_QUIET_MS - quiet)
        }
    }

    /** The settle and the read an action asked for, into its result. */
    private fun after(p: JSONObject, at: Long, job: Job, out: JSONObject, inert: Boolean = false): Reply {
        val read = p.optString("read", "none")
        val settle = p.optJSONObject("settle")
        var last: Capture? = null
        if (settle != null) {
            val quiet = settle.optLong("quietMs", 200).let { if (inert) minOf(it, INERT_QUIET_MS) else it }
            val o = settler.run(
                at,
                quiet,
                settle.optLong("maxMs", 3_000),
                if (p.has("before")) recent[p.getString("before")] else null,
                { capture.capture().also { last = it } },
                { x, y -> x.sameLayout(y) },
                { it.busy },
                { job.cancelled },
                { it.nodes.size },
            )
            out.put("settle", JSONObject().put("settled", o.settled).put("ms", o.elapsedMs).put("reads", o.reads).put("quietMs", o.quietMs))
        }
        when (read) {
            "tree" -> out.put("tree", treeJson(last ?: capture.capture()))
            "hash" -> out.put("hash", (last ?: capture.capture()).also { recent[it.hash] = it }.hash)
        }
        return Reply(out)
    }

    private fun screenshot(p: JSONObject): Reply {
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
        for (n in c.nodes) {
            val o = JSONObject().put("p", n.parent).put("w", n.window).put("c", n.cls)
            n.id?.let { o.put("id", it) }
            n.text?.let { o.put("t", it) }
            n.desc?.let { o.put("d", it) }
            n.hint?.let { o.put("h", it) }
            nodes.put(o.put("b", rect(n.left, n.top, n.right, n.bottom)).put("f", n.flags))
        }
        return JSONObject().put("windows", windows).put("nodes", nodes).put("truncated", c.truncated)
            .put("elapsedMs", c.elapsedMs).put("hash", c.hash)
    }

    private fun rect(l: Int, t: Int, r: Int, b: Int) = JSONArray().put(l).put(t).put(r).put(b)

    companion object {
        /** The quiet window after a tap on something that cannot react (an immediate touch reaction still shows). */
        const val INERT_QUIET_MS = 80L
        /** A read waits for this long without a layout-moving event (an app already quiet: no wait). */
        const val IDLE_QUIET_MS = 150L
        const val IDLE_MAX_MS = 1_000L

        val CAPABILITIES = listOf(
            "tree", "tap", "longPress", "swipe", "gesture", "key", "text", "screenshot", "foreground",
            "clipboard", "orientation", "settle",
        )
    }
}
