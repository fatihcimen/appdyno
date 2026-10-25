package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettlerTest {
    private var now = 1_000L
    private var lastEvent = 0L

    private class R(val hash: String, val busy: Boolean = false)

    private fun r(hash: String, busy: Boolean = false) = R(hash, busy)

    /** Reads take 10 ms; `layoutAt(t)` gives the layout at time t after the action. */
    private fun go(quiet: Long, max: Long, before: String?, start: Long = now, layoutAt: (Long) -> R, cancelled: () -> Boolean = { false }) =
        Settler({ now }, { now += it }, { lastEvent }).run(
            start, quiet, max, before?.let { R(it) },
            { now += 10; layoutAt(now - start) },
            { a, b -> a.hash == b.hash }, { it.busy }, cancelled,
        )

    @Test
    fun unchangedScreenSettlesAfterTheQuietWindow() {
        val o = go(250, 3_000, "A", layoutAt = { r("A") })
        assertTrue(o.settled)
        assertTrue(o.elapsedMs in 250..350)
    }

    @Test
    fun aChangeSettlesOnceTheNewLayoutStaysStill() {
        // the new screen moves in for 600 ms, then stays
        val o = go(250, 3_000, "A", layoutAt = { t -> if (t < 600) r("moving$t") else r("B") })
        assertTrue(o.settled)
        assertEquals("B", o.last.hash)
        assertTrue("settled ${o.elapsedMs}", o.elapsedMs in 850..950)
    }

    @Test
    fun eventsHoldTheSettleUntilTheyStop() {
        val start = now
        lastEvent = start + 500 // an animation still sends events half a second after the action
        val o = go(200, 3_000, null, start, { r("X") })
        assertTrue(o.settled)
        assertTrue("settled ${o.elapsedMs}", o.elapsedMs >= 400)
    }

    @Test
    fun endlessEventsHoldItAtMostTwoQuietWindows() {
        val start = now
        val s = Settler({ now }, { now += it }, { now - 5 }) // an event just now, every time
        val o = s.run(start, 250, 3_000, R("L"), { now += 10; R("L") }, { a, b -> a.hash == b.hash }, { it.busy }, { false })
        assertTrue(o.settled)
        assertTrue("settled ${o.elapsedMs}", o.elapsedMs in 500..600)
    }

    @Test
    fun aSpinnerKeepsTheScreenUnsettled() {
        val o = go(100, 3_000, "A", layoutAt = { t -> if (t < 700) r("S", true) else r("C") })
        assertTrue(o.settled)
        assertEquals("C", o.last.hash)
        assertTrue(o.elapsedMs >= 800)
    }

    @Test
    fun anEndlessSpinnerStopsAtTheCap() {
        val o = go(100, 1_000, null, layoutAt = { r("S", true) })
        assertFalse(o.settled)
        assertTrue(o.elapsedMs in 1_000..1_100)
    }

    @Test
    fun aLayoutThatKeepsMovingStopsAtTheCap() {
        val o = go(50, 1_000, null, layoutAt = { t -> r("h$t") })
        assertFalse(o.settled)
        assertTrue(o.elapsedMs in 1_000..1_100)
    }

    @Test
    fun slowReadsStretchTheQuietWindow() {
        val s = Settler({ now }, { now += it }, { lastEvent })
        // warm up: fast reads (10 ms)
        repeat(5) { s.run(now, 100, 3_000, R("A"), { now += 10; R("A") }, { a, b -> a.hash == b.hash }, { it.busy }, { false }) }
        assertEquals(1.0, s.slowdown(), 0.01)
        // the device gets slow: reads take 60 ms, the window grows to 3×
        val o = s.run(now, 100, 3_000, R("A"), { now += 60; R("A") }, { a, b -> a.hash == b.hash }, { it.busy }, { false })
        assertTrue(o.settled)
        assertTrue("settled ${o.elapsedMs}", o.elapsedMs >= 280)
        assertEquals(3.0, s.slowdown(), 0.01)
        assertTrue("reported window ${o.quietMs}", o.quietMs > 100)
    }

    @Test
    fun cancelStopsTheLoop() {
        var n = 0
        val o = go(50, 10_000, null, layoutAt = { t -> r("h$t") }, cancelled = { ++n >= 2 })
        assertFalse(o.settled)
        assertEquals(2, o.reads)
    }
}
