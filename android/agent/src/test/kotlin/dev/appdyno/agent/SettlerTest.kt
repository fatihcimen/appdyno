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
    fun oneSlowReadOfTheOldScreenIsNoProofOfQuiet() {
        // the first read takes 1.5 s (a starved device) and still shows the screen before the tap
        val s = Settler({ now }, { now += it }, { lastEvent })
        var n = 0
        val o = s.run(now, 200, 3_000, R("A"), { n++; now += if (n == 1) 1_500 else 10; R(if (n == 1) "A" else "B") },
            { a, b -> a.hash == b.hash }, { it.busy }, { false })
        assertTrue(o.settled)
        assertEquals("B", o.last.hash)
        assertTrue("reads ${o.reads}", o.reads >= 3)
    }

    @Test
    fun lateWakeUpsStretchTheQuietWindow() {
        // every 80 ms sleep takes 240 ms (a starved CPU) while reads stay fast
        val s = Settler({ now }, { now += it * 3 }, { lastEvent })
        repeat(3) { s.run(now, 100, 3_000, R("A"), { now += 5; R("A") }, { a, b -> a.hash == b.hash }, { it.busy }, { false }) }
        assertTrue("slowdown ${s.slowdown()}", s.slowdown() > 2.5)
        val o = s.run(now, 100, 3_000, R("A"), { now += 5; R("A") }, { a, b -> a.hash == b.hash }, { it.busy }, { false })
        assertTrue("window ${o.quietMs}", o.quietMs >= 250)
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
    fun nothingIsReadOrProvenWhileHeld() {
        // between two screens for 500 ms: no read of the empty screen, and the window starts after it
        val start = now
        val o = Settler({ now }, { now += it }, { lastEvent }).run(
            start, 200, 3_000, R("A"), { now += 10; R("B") }, { a, b -> a.hash == b.hash }, { it.busy }, { false },
            hold = { now - start < 500 },
        )
        assertTrue(o.settled)
        assertEquals("B", o.last.hash)
        assertEquals(3, o.reads)
        assertTrue("settled ${o.elapsedMs}", o.elapsedMs in 700..900)
    }

    @Test
    fun aTransitionKnownOnlyAfterTheReadHoldsTheAnswer() {
        // the old screen, still, at the end of the window; the read lets the busy app run the click, whose transition
        // then shows in `hold` until 400 ms, after which the new screen is there
        val start = now
        val o = Settler({ now }, { now += it }, { lastEvent }).run(
            start, 200, 3_000, R("A"), { now += 10; R(if (now - start < 400) "A" else "B") }, { a, b -> a.hash == b.hash }, { it.busy }, { false },
            hold = { now - start in 201..399 },
        )
        assertTrue(o.settled)
        assertEquals("B", o.last.hash)
    }

    @Test
    fun aReadOvertakenByANewWindowIsReadAgain() {
        // still the old screen when read at the end of the window; a new window appeared meanwhile
        val start = now
        val o = Settler({ now }, { now += it }, { lastEvent }).run(
            start, 200, 3_000, R("A"), { now += 60; R(if (now - start < 300) "A" else "B") }, { a, b -> a.hash == b.hash }, { it.busy }, { false },
            outdated = { it.hash == "A" },
        )
        assertTrue(o.settled)
        assertEquals("B", o.last.hash)
    }

    @Test
    fun aHoldThatNeverEndsAnswersOnceAtTheCapUnsettled() {
        val o = Settler({ now }, { now += it }, { lastEvent }).run(
            now, 200, 1_000, R("A"), { now += 10; R("gap", true) }, { a, b -> a.hash == b.hash }, { it.busy }, { false },
            hold = { true },
        )
        assertFalse(o.settled)
        assertEquals(1, o.reads)
    }

    @Test
    fun aScreenWithNoWindowNeverSettles() {
        // two reads of nothing look the same: without "busy" that was a settled screen with 0 elements
        val o = go(100, 1_000, null, layoutAt = { r("empty", true) })
        assertFalse(o.settled)
    }

    @Test
    fun anUnchangedScreenTakesOneReadWhenTheCallerSawIt() {
        val o = go(200, 3_000, "A", layoutAt = { r("A") })
        assertTrue(o.settled)
        assertEquals(1, o.reads)
    }

    @Test
    fun anEventBringsTheReadForward() {
        // the reaction comes with an event at 60 ms: it is read then, not at the end of the window
        val start = now
        var seen = false
        val at = mutableListOf<Long>()
        val s = Settler({ now }, { ms ->
            if (!seen && now + ms > start + 60) {
                seen = true
                now = start + 60
                lastEvent = now
            } else now += ms
        }, { lastEvent })
        val o = s.run(start, 200, 3_000, R("A"), { at += now - start; now += 10; R(if (now - start < 60) "A" else "B") },
            { a, b -> a.hash == b.hash }, { it.busy }, { false })
        assertTrue(o.settled)
        assertEquals("B", o.last.hash)
        assertTrue("reads at $at", at.first() in 60..60 + Settler.POLL_MS)
        assertTrue("settled ${o.elapsedMs}", o.elapsedMs in 260..420)
    }

    @Test
    fun aMoveWithoutEventsIsFollowedAtThePollRate() {
        val at = mutableListOf<Long>()
        val start = now
        val o = Settler({ now }, { now += it }, { lastEvent }).run(
            start, 200, 3_000, null, { at += now - start; now += 10; R(if (now - start < 500) "m${now - start}" else "B") },
            { a, b -> a.hash == b.hash }, { it.busy }, { false },
        )
        assertTrue(o.settled)
        assertTrue("reads at $at", at.zipWithNext { a, b -> b - a }.take(4).all { it <= Settler.POLL_MS + 10 })
    }

    @Test
    fun aReadSlowerThanTheWindowIsNoProof() {
        // reads taking 300 ms against a 200 ms window: one such read may be all of the "still" time
        var n = 0
        val s = Settler({ now }, { now += it }, { lastEvent })
        val o = s.run(now, 200, 3_000, R("A"), { n++; now += if (n == 1) 300 else 5; R("A") },
            { a, b -> a.hash == b.hash }, { it.busy }, { false })
        assertTrue(o.settled)
        assertEquals(2, o.reads)
    }

    @Test
    fun aDeviceWhoseReadsOutlastTheWindowStillSettles() {
        // a Samsung SM-A525F, idle: 165 ms to read 88 nodes against the 80 ms of a tap on plain text, and every such tap
        // waited out its 3 s
        val s = Settler({ now }, { now += it }, { lastEvent })
        val tap = {
            s.run(now, 80, 3_000, R("A"), { now += 165; R("A") }, { a, b -> a.hash == b.hash }, { it.busy }, { false }, { 88 })
        }
        val first = tap()
        assertTrue(first.settled)
        assertEquals(3, first.reads)
        val next = tap()
        assertTrue(next.settled)
        assertEquals(1, next.reads)
    }

    @Test
    fun readsThatTurnSlowAreStillNoProof() {
        // the same 165 ms on a device that read in 10: it is loaded now, and the guard holds
        val s = Settler({ now }, { now += it }, { lastEvent })
        s.run(now, 80, 3_000, R("A"), { now += 10; R("A") }, { a, b -> a.hash == b.hash }, { it.busy }, { false }, { 88 })
        var n = 0
        val o = s.run(now, 80, 3_000, R("A"), { n++; now += if (n < 3) 165 else 10; R("A") },
            { a, b -> a.hash == b.hash }, { it.busy }, { false }, { 88 })
        assertTrue(o.settled)
        assertEquals(3, o.reads)
    }

    @Test
    fun cancelStopsTheLoop() {
        var n = 0
        val o = go(50, 10_000, null, layoutAt = { t -> r("h$t") }, cancelled = { ++n >= 2 })
        assertFalse(o.settled)
        assertEquals(2, o.reads)
    }
}
