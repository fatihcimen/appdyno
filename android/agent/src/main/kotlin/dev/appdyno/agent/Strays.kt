package dev.appdyno.agent

import java.io.File

/**
 * The agents of ours on this device that no host is connected to, ended by an agent that starts: each host's state
 * folder started one of its own, and an idle one stays for its idle time. Where the shell cannot read the table of
 * sockets, none is ended.
 */
object Strays {
    private const val MAIN = "dev.appdyno.agent.Main"

    /** `procs`: each process's arguments, by pid; `unix`: `/proc/net/unix`. Pure, unit tested. */
    fun of(self: Int, procs: Map<Int, List<String>>, unix: String): List<Int> {
        val lines = unix.lines().map { it.trim().split(Regex("\\s+")) }
        return procs.filter { (pid, args) -> pid != self && MAIN in args }.mapNotNull { (pid, args) ->
            val socket = args.getOrNull(args.indexOf("--socket") + 1)
            // its own lines: the one that listens (01), and one for each host connected (03)
            val states = lines.filter { it.size >= 8 && it[7] == "@$socket" }.map { it[5] }
            pid.takeIf { "01" in states && "03" !in states }
        }
    }

    fun end() {
        val procs = File("/proc").listFiles { f -> f.name.all(Char::isDigit) }.orEmpty().associate { dir ->
            dir.name.toInt() to runCatching { File(dir, "cmdline").readText().split('\u0000') }.getOrDefault(emptyList())
        }
        val unix = runCatching { File("/proc/net/unix").readText() }.getOrDefault("")
        for (pid in of(android.os.Process.myPid(), procs, unix)) {
            System.err.println("ending agent $pid, which no host is connected to")
            android.os.Process.killProcess(pid)
        }
    }
}
