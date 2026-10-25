package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettlerTest {
    private var now = 1_000L
    private var lastEvent = 0L
    private val settler = Settler({ now }, { now += it }, { lastEvent })

    @Test
    fun unchangedScreenSettlesAfterOneQuietRead() {
        val o = settler.run(now, 200, 3_000, "A", { "A" }, { false })
        assertTrue(o.settled)
        assertEquals(1, o.reads)
        assertEquals(200, o.elapsedMs)
    }

    @Test
    fun changedScreenNeedsTwoEqualReads() {
        val reads = ArrayDeque(listOf("B", "C", "C"))
        val o = settler.run(now, 100, 3_000, "A", { reads.removeFirst() }, { false })
        assertTrue(o.settled)
        assertEquals(3, o.reads)
    }

    @Test
    fun waitsForEventsToStop() {
        val start = now
        lastEvent = start + 500 // an animation still sends events half a second after the action
        val o = settler.run(start, 200, 3_000, null, { "X" }, { false })
        assertTrue(o.settled)
        assertTrue("first read only after the quiet window", o.elapsedMs >= 700)
    }

    @Test
    fun stopsAtTheCapWhenTheLayoutKeepsMoving() {
        var n = 0
        val o = settler.run(now, 50, 1_000, null, { now += 30; "h${n++}" }, { false })
        assertFalse(o.settled)
        assertTrue(o.elapsedMs in 1_000..1_100)
    }

    @Test
    fun cancelStopsTheLoop() {
        var n = 0
        val o = settler.run(now, 50, 10_000, null, { "h${n++}" }, { n >= 2 })
        assertFalse(o.settled)
        assertEquals(2, o.reads)
    }
}
