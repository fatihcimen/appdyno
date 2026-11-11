package dev.appdyno.agent

import org.json.JSONArray
import org.json.JSONObject

/** The agent's answers as JSON (pure: the unit tests hold them against the protocol's fixtures). */
object Results {
    fun hello(version: String, os: String?, sdk: Int, model: String, d: DisplayInfo, pid: Int): JSONObject = JSONObject()
        .put("agentVersion", version)
        .put("protocol", JSONObject().put("major", PROTOCOL_MAJOR))
        .put("platform", "android")
        .put("osVersion", os)
        .put("sdk", sdk)
        .put("model", model)
        .put("screen", JSONObject().put("w", d.width).put("h", d.height).put("density", d.densityDpi).put("rotation", d.rotation))
        .put("pid", pid)

    fun streamInfo(w: Int, h: Int, hevc: Boolean, mode: String): JSONObject = JSONObject()
        .put("w", w)
        .put("h", h)
        .put("codec", if (hevc) "hevc" else "h264")
        .put("mode", mode)

    fun streamClock(now: Long): JSONObject = JSONObject().put("now", now)

    fun tree(c: Capture): JSONObject {
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

    fun settle(o: SettleOutcome<*>, moving: Boolean): JSONObject = JSONObject().put("settled", o.settled).put("ms", o.elapsedMs).put("reads", o.reads).put("quietMs", o.quietMs)
        .apply { if (moving) put("moving", true) }

    /** `notSubmitted`: Enter was asked for and not pressed, said as `submitted: false`. */
    fun text(o: TextOutcome, notSubmitted: Boolean = false): JSONObject = JSONObject().put("mode", o.mode).put("focusMs", o.focusMs).apply {
        o.verified?.let { put("verified", it) }
        if (notSubmitted) put("submitted", false)
    }

    fun shot(w: Int, h: Int, png: Boolean, bytes: Int): JSONObject = JSONObject().put("w", w).put("h", h).put("format", if (png) "png" else "jpeg").put("bytes", bytes)

    fun wait(o: WaitOutcome<*>, tree: JSONObject?): JSONObject = JSONObject().put("sig", o.sig).put("changed", o.changed).put("reads", o.reads).put("elapsedMs", o.elapsedMs)
        .apply { tree?.let { put("tree", it) } }

    fun clip(n: Int, chars: Int, hidden: Int): JSONObject = JSONObject().put("n", n).put("chars", chars).put("hidden", hidden)

    fun traversal(n: Int, before: Int?, after: Int?): JSONObject = JSONObject().put("n", n).apply {
        before?.let { put("before", it) }
        after?.let { put("after", it) }
    }

    private fun rect(l: Int, t: Int, r: Int, b: Int) = JSONArray().put(l).put(t).put(r).put(b)
}
