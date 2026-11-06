package dev.appdyno.agent

/**
 * The device's animation scales, off on request and back as they were when the last host leaves. If this
 * process dies first (killed, crashed), a separate shell process watching it puts them back.
 */
class Animations {
    private var saved: List<String>? = null
    private var watcher: Process? = null

    @Synchronized
    fun off() {
        if (saved != null) return
        val old = KEYS.map { sh("settings", "get", "global", it).trim() }
        saved = old
        watcher = ProcessBuilder("sh", "-c", AnimationScript.watch(android.os.Process.myPid(), KEYS.zip(old))).start()
        for (k in KEYS) sh("settings", "put", "global", k, "0")
    }

    /** Back as they were; nothing when they were not turned off here. */
    @Synchronized
    fun restore() {
        val old = saved ?: return
        saved = null
        watcher?.destroy()
        watcher = null
        sh("sh", "-c", AnimationScript.restore(KEYS.zip(old)))
    }

    private fun sh(vararg cmd: String): String {
        val p = ProcessBuilder(*cmd).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        p.waitFor()
        return out
    }

    private companion object {
        val KEYS = listOf("window_animation_scale", "transition_animation_scale", "animator_duration_scale")
    }
}

/** The shell text that puts the scales back (pure, unit tested). */
object AnimationScript {
    /** A key that had no value (a device that never set it) is deleted, anything not a number is left alone. */
    fun restore(old: List<Pair<String, String>>) = old.joinToString("; ") { (k, v) ->
        when {
            v == "null" -> "settings delete global $k"
            Regex("[0-9.]+").matches(v) -> "settings put global $k $v"
            else -> "true"
        }
    }

    fun watch(pid: Int, old: List<Pair<String, String>>) =
        "while kill -0 $pid 2>/dev/null; do sleep 1; done; ${restore(old)}"
}
