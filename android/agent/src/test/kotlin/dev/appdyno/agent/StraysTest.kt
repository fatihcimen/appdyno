package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Test

class StraysTest {
    private fun agent(socket: String) = listOf("app_process", "/", "dev.appdyno.agent.Main", "--socket", socket, "--token-file", "f")
    private fun line(state: String, inode: Int, path: String = "") = "0000000000000000: 00000002 00000000 00010000 0001 $state $inode $path".trim()

    private val procs = mapOf(
        10 to agent("appdyno_self"),
        11 to agent("appdyno_idle"),
        12 to agent("appdyno_used"),
        13 to agent("appdyno_unseen"),
        14 to listOf("sh", "-c", "grep appdyno_idle /proc/net/unix"),
    )
    private val unix = listOf(
        "Num       RefCount Protocol Flags    Type St Inode Path",
        line("01", 1, "@appdyno_self"),
        line("01", 2, "@appdyno_idle"),
        line("01", 3, "@appdyno_used"),
        line("03", 4, "@appdyno_used"),
        line("03", 5),
    ).joinToString("\n")

    private val old = { _: Int -> Strays.GRACE_MS }

    @Test
    fun anAgentListeningWithNoHostIsEndedAndNoOtherProcess() {
        assertEquals(listOf(11), Strays.of(10, procs, unix, old))
    }

    @Test
    fun nothingIsEndedWhereTheTableOfSocketsCannotBeRead() {
        assertEquals(emptyList<Int>(), Strays.of(10, procs, "", old))
    }

    @Test
    fun anAgentItsHostMayStillWaitForIsLeftAndOneWhoseAgeIsUnknown() {
        assertEquals(emptyList<Int>(), Strays.of(10, procs, unix) { Strays.GRACE_MS - 1 })
        assertEquals(emptyList<Int>(), Strays.of(10, procs, unix) { null })
    }
}
