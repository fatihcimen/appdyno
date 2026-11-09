package dev.appdyno.agent

/**
 * Settings of one namespace, written down before the first change and put back as they were on request. If this
 * process dies first (killed, crashed), a separate shell process watching it puts them back.
 */
class HeldSettings(private val namespace: String, private val keys: List<String>) {
    private var saved: List<String>? = null
    private var watcher: Process? = null

    /** Writes them down, once: true when this call did. */
    @Synchronized
    fun hold(): Boolean {
        if (saved != null) return false
        val old = keys.map { sh("settings", "get", namespace, it).trim() }
        saved = old
        watcher = ProcessBuilder("sh", "-c", SettingsScript.watch(android.os.Process.myPid(), namespace, keys.zip(old))).start()
        return true
    }

    /** Back as they were; nothing when they were not written down. */
    @Synchronized
    fun restore() {
        val old = saved ?: return
        saved = null
        watcher?.destroy()
        watcher = null
        sh("sh", "-c", SettingsScript.restore(namespace, keys.zip(old)))
    }
}

fun sh(vararg cmd: String): String {
    val p = ProcessBuilder(*cmd).redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText()
    p.waitFor()
    return out
}

/** The shell text that puts settings back (pure, unit tested). */
object SettingsScript {
    /** A key that had no value (a device that never set it) is deleted, anything not a number is left alone. */
    fun restore(namespace: String, old: List<Pair<String, String>>) = old.joinToString("; ") { (k, v) ->
        when {
            v == "null" -> "settings delete $namespace $k"
            Regex("[0-9.]+").matches(v) -> "settings put $namespace $k $v"
            else -> "true"
        }
    }

    fun watch(pid: Int, namespace: String, old: List<Pair<String, String>>) = "while kill -0 $pid 2>/dev/null; do sleep 1; done; ${restore(namespace, old)}"
}
