package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PastConflictTest {
    private var now = 0L
    private var attempts = 0

    private fun held() = AgentFailure("AGENT_CONFLICT", "held")

    private fun <T> run(attempt: () -> T): T = pastConflict(4_000, 200, { now }, { now += it }) {
        attempts++
        attempt()
    }

    @Test
    fun takesTheFirstAttemptThatIsNotRefused() {
        assertEquals("ok", run { if (now < 2_300) throw held() else "ok" })
        assertEquals(13, attempts)
    }

    @Test
    fun asksOnceWhenNothingHoldsTheDevice() {
        assertEquals("ok", run { "ok" })
        assertEquals(1, attempts)
        assertEquals(0, now)
    }

    @Test
    fun givesUpOnAHolderThatStaysWithItsRefusal() {
        val e = assertThrows(AgentFailure::class.java) { run { throw held() } }
        assertEquals("AGENT_CONFLICT", e.code)
        assertEquals(4_000, now)
    }

    @Test
    fun doesNotWaitOutAnyOtherFailure() {
        val e = assertThrows(AgentFailure::class.java) {
            run { throw AgentFailure("UNSUPPORTED", "no constructor") }
        }
        assertEquals("UNSUPPORTED", e.code)
        assertEquals(1, attempts)
    }
}
