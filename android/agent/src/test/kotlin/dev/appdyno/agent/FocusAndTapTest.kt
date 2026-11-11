package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class FocusAndTapTest {
    /** A clock that moves only by what is slept, and by `stalls` (ms) before the look of that number. */
    private class Clock(val stalls: Map<Int, Long> = emptyMap()) {
        var at = 0L
        var looks = 0

        fun look(found: Int?): (Int) -> String? = { polls ->
            looks++
            at += stalls[polls] ?: 0
            if (polls == found) "field" else null
        }
    }

    @Test
    fun aFieldThatTakesTheFocusIsFound() {
        val c = Clock()
        assertEquals("field", FocusWait.until(1_000, { false }, { c.at }, { c.at += it }, c.look(found = 3)))
        assertEquals(4, c.looks)
    }

    @Test
    fun noFieldByTheDeadlineIsNone() {
        val c = Clock()
        assertNull(FocusWait.until(1_000, { false }, { c.at }, { c.at += it }, c.look(found = null)))
        assertEquals(1_000L, c.at)
    }

    @Test
    fun aStallBetweenTwoLooksDoesNotCount() {
        // 4 s without a look, after the second: the wait goes on for what it had left (the 40 ms before it counted too)
        val c = Clock(stalls = mapOf(2 to 4_000L))
        assertNull(FocusWait.until(1_000, { false }, { c.at }, { c.at += it }, c.look(found = null)))
        assertEquals(5_040L, c.at)
    }

    @Test
    fun aWaitTheHostStoppedIsNoFieldThatRefusedTheFocus() {
        // a null here had the caller focus the field under the point, tap it again and type, after the host was told
        val c = Clock()
        val e = assertThrows(AgentFailure::class.java) {
            FocusWait.until(10_000, { c.looks >= 2 }, { c.at }, { c.at += it }, c.look(found = null))
        }
        assertEquals("CANCELLED", e.code)
        assertEquals(2, c.looks)
    }

    @Test
    fun aTapThatFailedOnItsWayIsMadeAgainUntilTheHostStops() {
        var made = 0
        val refused = { made++ < 2 }
        Input.again(3, { false }, {}) { if (refused()) throw AgentFailure("INTERNAL", "the input event was not delivered") }
        assertEquals(3, made)

        made = 0
        var stopped = false
        val e = assertThrows(AgentFailure::class.java) {
            Input.again(3, { stopped }, { stopped = true }) { if (refused()) throw AgentFailure("INTERNAL", "the input event was not delivered") }
        }
        assertEquals("INTERNAL", e.code)
        // once: the host was told CANCELLED during the pause after it
        assertEquals(1, made)
    }

    @Test
    fun aTapRefusedForAnotherReasonIsNotMadeAgain() {
        var made = 0
        assertThrows(AgentFailure::class.java) {
            Input.again(3, { false }, {}) {
                made++
                throw AgentFailure("PERMISSION_REQUIRED", "the device refuses injected input")
            }
        }
        assertEquals(1, made)
    }
}
