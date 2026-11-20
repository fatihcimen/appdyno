package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class UnreleasedTest {
    /** The system's one UI automation registration, as its accessibility service keeps it; null: none. */
    private var registered: Int? = null
    private var made = 0
    private var letGoFails = 0

    private val unreleased = Unreleased<Int> { c ->
        if (letGoFails > 0) {
            letGoFails--
            false
        } else {
            if (registered == c) registered = null
            true
        }
    }

    /** A connect: registered by the system at once, and answered `late`, past the client's wait. */
    private fun connect(c: Int, late: Boolean = false): Int {
        if (registered != null) throw AgentFailure("AGENT_CONFLICT", "another UI automation client holds this device")
        registered = c
        if (late) throw RuntimeException("java.util.concurrent.TimeoutException: Timeout while connecting UiAutomation")
        return c
    }

    private fun open(late: Boolean = false) = unreleased.open(++made) { connect(it, late) }

    @Test
    fun aConnectThatTimedOutDoesNotHoldTheNextOpen() {
        // load 380: one connect timed out, and every open after it was refused for minutes, by this process's own
        assertThrows(RuntimeException::class.java) { open(late = true) }
        assertNull(registered)
        assertEquals(2, open())
        assertEquals(2, registered)
    }

    @Test
    fun anotherHoldersConnectionIsNotLetGo() {
        registered = 99
        val e = assertThrows(AgentFailure::class.java) { open() }
        assertEquals("AGENT_CONFLICT", e.code)
        assertEquals(99, registered)
        // it is another's: said as it is
        assertSame(e, unreleased.told(e))
    }

    @Test
    fun oneThatCouldNotBeLetGoIsLetGoBeforeTheNextOpen() {
        letGoFails = 1
        assertThrows(RuntimeException::class.java) { open(late = true) }
        assertEquals(1, registered)
        assertEquals(2, open())
    }

    @Test
    fun aConflictWhileOneOfItsOwnIsHeldIsThisAgentsOwn() {
        letGoFails = 2
        assertThrows(RuntimeException::class.java) { open(late = true) }
        val e = assertThrows(AgentFailure::class.java) { open() }
        assertEquals("AGENT_CONFLICT", e.code)
        val told = unreleased.told(e)
        assertEquals("AGENT_UNAVAILABLE", told.code)
        assertEquals(true, told.message!!.contains("this agent's own"))
    }

    @Test
    fun aConnectionWhoseDisconnectFailedIsKeptAndLetGoLater() {
        assertEquals(1, open())
        letGoFails = 1
        unreleased.keep(1)
        assertEquals(1, registered)
        assertEquals(2, open())
    }
}
