package dev.appdyno.agent

import java.lang.reflect.Method

/**
 * The process an app runs as, for an action's answer, as the host compares it with the one before the action: a crash
 * that the system restarted at once shows in nothing else. The host asked `adb shell pidof` after each action, which
 * cost a phone's round trip of its own.
 */
object AppProcess {
    /** The platform's own walk of `/proc` by each process's command, as `pidof` walks it. */
    private val byCommand: Method? = try {
        android.os.Process::class.java.getMethod("getPidsForCommands", Array<String>::class.java)
    } catch (_: ReflectiveOperationException) {
        null
    }

    /** The app's process, 0 when it runs none; null where this release cannot say, and the host asks as before. */
    fun of(pkg: String): Int? {
        val m = byCommand ?: return null
        return try {
            first(m.invoke(null, arrayOf(pkg)) as IntArray?)
        } catch (_: Throwable) {
            null
        }
    }

    /** The oldest, by the lowest pid, of the processes a command names, where one just ended stays a moment; 0 for none. */
    fun first(pids: IntArray?): Int = pids?.minOrNull() ?: 0
}
