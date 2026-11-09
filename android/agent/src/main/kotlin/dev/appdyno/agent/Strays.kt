package dev.appdyno.agent

import android.system.Os
import android.system.OsConstants
import java.io.File

/**
 * The agents of ours on this device that no host is connected to, ended by an agent that starts: each host's state
 * folder started one of its own, and an idle one stays for its idle time. Where the shell cannot read the table of
 * sockets, none is ended.
 */
object Strays {
    private const val MAIN = "dev.appdyno.agent.Main"

    /**
     * Younger than this, an agent may be one its host still waits for: a host gives a new agent 60 s to answer (the
     * launcher's START_MS), as a JVM start at load 85 took over 20 s to open its socket, and connects within a poll of it.
     */
    const val GRACE_MS = 60_000L

    /** `procs`: each process's arguments, by pid; `unix`: `/proc/net/unix`; `ageMs`: how long each has run. Pure, unit tested. */
    fun of(self: Int, procs: Map<Int, List<String>>, unix: String, ageMs: (Int) -> Long?): List<Int> {
        val lines = unix.lines().map { it.trim().split(Regex("\\s+")) }
        return procs.filter { (pid, args) -> pid != self && MAIN in args }.mapNotNull { (pid, args) ->
            val socket = args.getOrNull(args.indexOf("--socket") + 1)
            // its own lines: the one that listens (01), and one for each host connected (03)
            val states = lines.filter { it.size >= 8 && it[7] == "@$socket" }.map { it[5] }
            val old = (ageMs(pid) ?: 0) >= GRACE_MS
            pid.takeIf { old && "01" in states && "03" !in states }
        }
    }

    /** From `/proc/<pid>/stat`, whose 22nd field is the start in clock ticks since boot; null where it cannot be read. */
    private fun ageMs(pid: Int): Long? = runCatching {
        val fields = File("/proc/$pid/stat").readText().substringAfterLast(')').trim().split(' ')
        val ticks = fields[19].toLong()
        val uptimeMs = (File("/proc/uptime").readText().substringBefore(' ').toDouble() * 1000).toLong()
        uptimeMs - ticks * 1000 / Os.sysconf(OsConstants._SC_CLK_TCK)
    }.getOrNull()

    fun end() {
        val procs = File("/proc").listFiles { f -> f.name.all(Char::isDigit) }.orEmpty().associate { dir ->
            dir.name.toInt() to runCatching { File(dir, "cmdline").readText().split('\u0000') }.getOrDefault(emptyList())
        }
        val unix = runCatching { File("/proc/net/unix").readText() }.getOrDefault("")
        for (pid in of(android.os.Process.myPid(), procs, unix, ::ageMs)) {
            System.err.println("ending agent $pid, which no host is connected to")
            android.os.Process.killProcess(pid)
        }
    }
}
