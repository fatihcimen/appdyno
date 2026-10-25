package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettlerTest {
    private var now = 1_000L
    private var lastEvent = 0L
    private val settler = Settler({ now }, { now += it }, { lastEvent })
    private class R(val hash: String, val busy: Boolean = false)
    private fun r(hash: String, busy: Boolean = false) = R(hash, busy)
    private fun Settler.go(at: Long, quiet: Long, max: Long, before: String?, read: () -> R, cancelled: () -> Boolean) =
        run(at, quiet, max, before?.let { R(it) }, read, { a, b -> a.hash == b.hash }, { it.busy }, cancelled)

    @Test
    fun aSpinnerKeepsTheScreenUnsettled() {
        // the spinner shows at once and stays still; the content comes with the fourth read
        val reads = ArrayDeque(listOf(r("S", true), r("S", true), r("S", true), r("C"), r("C")))
        val o = settler.go(now, 100, 3_000, "A", { reads.removeFirst() }, { false })
        assertTrue(o.settled)
        assertEquals(5, o.reads)
        assertEquals("C", o.last.hash)
    }

    @Test
    fun anEndlessSpinnerStopsAtTheCap() {
        val o = settler.go(now, 100, 1_000, null, { now += 10; r("S", true) }, { false })
        assertFalse(o.settled)
    }

    @Test
    fun unchangedScreenSettlesAfterOneQuietRead() {
        val o = settler.go(now, 200, 3_000, "A", { r("A") }, { false })
        assertTrue(o.settled)
        assertEquals(1, o.reads)
        assertEquals(200, o.elapsedMs)
    }

    @Test
    fun changedScreenNeedsTwoEqualReads() {
        val reads = ArrayDeque(listOf("B", "C", "C").map { r(it) })
        val o = settler.go(now, 100, 3_000, "A", { reads.removeFirst() }, { false })
        assertTrue(o.settled)
        assertEquals(3, o.reads)
    }

    @Test
    fun waitsForEventsToStop() {
        val start = now
        lastEvent = start + 500 // an animation still sends events half a second after the action
        val o = settler.go(start, 200, 3_000, null, { r("X") }, { false })
        assertTrue(o.settled)
        assertTrue("first read only after the quiet window", o.elapsedMs >= 700)
    }

    @Test
    fun stopsAtTheCapWhenTheLayoutKeepsMoving() {
        var n = 0
        val o = settler.go(now, 50, 1_000, null, { now += 30; r("h${n++}") }, { false })
        assertFalse(o.settled)
        assertTrue(o.elapsedMs in 1_000..1_100)
    }

    @Test
    fun endlessEventsStillSettleOnEqualReads() {
        // an animation sends an event every 50 ms forever; the layout itself stays put
        val clockEvents = { now - (now % 50) }
        val s = Settler({ now }, { now += it }, clockEvents)
        val o = s.go(now, 250, 3_000, null, { r("L") }, { false })
        assertTrue(o.settled)
        assertEquals(2, o.reads)
        assertTrue(o.elapsedMs in 500..1_100)
    }

    @Test
    fun cancelStopsTheLoop() {
        var n = 0
        val o = settler.go(now, 50, 10_000, null, { r("h${n++}") }, { n >= 2 })
        assertFalse(o.settled)
        assertEquals(2, o.reads)
    }
}
