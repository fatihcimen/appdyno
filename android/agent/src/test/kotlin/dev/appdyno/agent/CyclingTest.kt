package dev.appdyno.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CyclingTest {
    private var now = 10_000L
    private val cycling = Cycling { now }
    private val area = 1080L * 2400
    private val banner = "Banner#banner@0,100,1080,500"

    private fun node(parent: Int, cls: String, id: String?, left: Int, top: Int, right: Int, bottom: Int) = CNode(parent, 0, cls, id, null, null, null, left, top, right, bottom, Flags.VISIBLE or Flags.CLICKABLE)

    /**
     * A screen as a capture lists it, level by level: a banner whose cards stand `shift` to the left over a button.
     * `page`: the screen itself, another one once a push has ended, and halfway there in between.
     */
    private fun screen(shift: Int = 0, cards: Int = 2, bannerBottom: Int = 500, buttonTop: Int = 900, page: Int = 0): Layout {
        val nodes = mutableListOf(
            node(-1, "Frame", null, 0, 0, 1080, 2400),
            node(0, "Banner", "banner", 0, 100, 1080, bannerBottom),
            node(0, "Button", "add", page, buttonTop, 1080 + page, buttonTop + 100),
            node(0, "Label", "count", page, 1100, 1080 + page, 1200),
        )
        for (i in 0 until cards) nodes += node(1, "Card", null, i * 600 - shift, 100, i * 600 + 600 - shift, bannerBottom)
        return Layout(nodes)
    }

    private fun same(next: Layout, prev: Layout) = cycling.same(next, prev, area)

    /** Reads 50 ms apart of a banner that runs, for `ms`: what the last of them was to the one before it. */
    private fun runs(ms: Long, from: Int = 0): Boolean {
        var last = false
        for (i in 1..ms / 50) {
            now += 50
            last = same(screen(shift = from + i.toInt() * 50), screen(shift = from + (i.toInt() - 1) * 50))
        }
        return last
    }

    @Test
    fun whatDiffersIsUnderOneViewOrAllOverTheScreen() {
        assertNull(Region.between(screen(), screen(), area))
        // within what counts as one place
        assertNull(Region.between(screen(), screen(shift = 6), area))
        assertEquals(banner, Region.between(screen(), screen(shift = 50), area))
        // a card that came, and one that went
        assertEquals(banner, Region.between(screen(), screen(shift = 50, cards = 3), area))
        assertEquals(banner, Region.between(screen(cards = 3), screen(cards = 2), area))
        assertEquals(Region.WHOLE, Region.between(screen(), screen(buttonTop = 1000), area))
        assertEquals(Region.WHOLE, Region.between(screen(), screen(shift = 50, buttonTop = 1000), area))
        // a view over half the screen is the screen
        assertEquals(Region.WHOLE, Region.between(screen(bannerBottom = 1400), screen(shift = 50, bannerBottom = 1400), area))
    }

    @Test
    fun aBannerThatKeepsRunningIsAChangeUntilItHasRunLongerThanATransition() {
        assertFalse(runs(Cycling.CYCLE_MS - 50))
        assertFalse(cycling.active)
        assertTrue(runs(100, from = 950))
        assertTrue(cycling.active)
        // and from then on, wherever its cards are
        assertTrue(same(screen(shift = 400, cards = 3), screen()))
    }

    @Test
    fun aChangeAnywhereElseIsOneThoughTheBannerIsKnown() {
        runs(Cycling.CYCLE_MS + 50)
        assertFalse(same(screen(shift = 50, buttonTop = 1000), screen()))
        assertFalse(same(screen(shift = 50, page = 400), screen()))
        assertFalse(same(screen(buttonTop = 1000), screen()))
        // the banner is still the banner after it
        assertTrue(same(screen(shift = 100), screen(shift = 50)))
    }

    @Test
    fun aSlideUnderOneViewThatEndsIsNeverKnownToCycle() {
        // a pager turns a page for 400 ms every two seconds
        for (turn in 0 until 5) {
            assertFalse(runs(400, from = turn * 400))
            now += 1_600
            assertTrue(same(screen(shift = (turn + 1) * 400), screen(shift = (turn + 1) * 400)))
        }
        assertFalse(cycling.active)
    }

    @Test
    fun aBannerNotSeenRunningForLongIsKnownNoLonger() {
        runs(Cycling.CYCLE_MS + 50)
        now += Cycling.KEPT_MS + 1
        assertFalse(cycling.active)
        assertFalse(same(screen(shift = 50), screen()))
    }

    @Test
    fun aScreenWithAKnownBannerHasOneDigestWhateverTheBannerShows() {
        assertNull(cycling.digest(screen()))
        runs(Cycling.CYCLE_MS + 50)
        val digest = cycling.digest(screen())
        assertEquals(digest, cycling.digest(screen(shift = 700, cards = 3)))
        assertFalse(digest == cycling.digest(screen(buttonTop = 1000)))
        // a screen without that view has its own
        assertNull(cycling.digest(Layout(screen().nodes.take(1))))
    }

    @Test
    fun eventsThatNeverStopNameTheViewThatMovedOrNothingAtAll() {
        cycling.eventsKeptComing(screen(buttonTop = 1000), screen(), area)
        assertFalse(cycling.active)
        cycling.eventsKeptComing(screen(shift = 300), screen(), area)
        assertTrue(cycling.active)
        assertTrue(same(screen(shift = 700), screen()))
        assertFalse(same(screen(shift = 700, buttonTop = 1000), screen()))

        // events with no layout behind them: the same layout is still, and any other is not
        val quiet = Cycling { now }
        quiet.eventsKeptComing(screen(), screen(), area)
        assertTrue(quiet.active)
        assertFalse(quiet.same(screen(shift = 50), screen(), area))
    }

    /** A settle of reads that take 10 ms, over an app whose events never stop. */
    private fun settle(before: Layout, byItself: Boolean = true, layoutAt: (Long) -> Layout): SettleOutcome<Layout> {
        val start = now
        return Settler({ now }, { now += it }, { now }).run(
            start,
            200,
            3_000,
            before,
            {
                now += 10
                layoutAt(now - start)
            },
            { x, y -> cycling.same(x, y, area, byItself) },
            { false },
            { false },
        )
    }

    @Test
    fun aSettleOverARunningBannerEndsOnceItIsKnownAndSoonFromThen() {
        val first = settle(screen()) { t -> screen(shift = (t / 10).toInt() * 10) }
        assertTrue(first.settled)
        assertTrue("first ${first.elapsedMs}", first.elapsedMs in 1_200..1_900)
        val next = settle(first.last) { t -> screen(shift = 2_000 + (t / 10).toInt() * 10) }
        assertTrue(next.settled)
        assertTrue("next ${next.elapsedMs}", next.elapsedMs in 400..600)
    }

    @Test
    fun aPushOverARunningBannerIsAnsweredOnlyOnceTheNewScreenIsStill() {
        runs(Cycling.CYCLE_MS + 50)
        // the tap's screen slides in from 300 ms to 800 ms after it, the banner running all the while
        val o = settle(screen()) { t ->
            val shift = (t / 10).toInt() * 10
            when {
                t < 300 -> screen(shift = shift)
                t < 800 -> screen(shift = shift, page = (t - 300).toInt())
                else -> screen(shift = shift, page = 1080)
            }
        }
        assertTrue(o.settled)
        assertTrue("answered ${o.elapsedMs}", o.elapsedMs >= 800 + 400)
        assertEquals(2160, o.last.nodes[2].right)
    }

    @Test
    fun aScreenThatChangesAsAWholeNeverSettles() {
        runs(Cycling.CYCLE_MS + 50)
        val o = settle(screen()) { t -> screen(shift = (t / 10).toInt() * 10, buttonTop = 900 + (t / 10).toInt() * 10) }
        assertFalse(o.settled)
    }

    @Test
    fun aRowTheActionItselfSetRunningIsWaitedOutEveryTime() {
        // a swipe throws a row, which runs for 1.6 s, longer than a banner takes to be known, and stops
        val thrown = { t: Long -> screen(shift = (minOf(t, 1_600) / 10).toInt() * 10) }
        for (swipe in 1..2) {
            val o = settle(screen(), byItself = false, layoutAt = thrown)
            assertTrue(o.settled)
            assertTrue("swipe $swipe answered ${o.elapsedMs}", o.elapsedMs >= 1_600)
            assertEquals(-1_600, o.last.nodes[4].left)
            assertFalse(cycling.active)
        }
        // and reads alone never make it known
        assertFalse(cycling.same(screen(shift = 50), screen(), area, byItself = false))
    }
}
