package dev.appdyno.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TransitionsTest {
    private val cap = 5_000L

    /** WMS as asked: each question takes `takes` on the clock, or holds until `open` opens if it is closed. */
    private class Wms {
        @Volatile var now = 0L

        @Volatile var takes = 0L

        @Volatile var open = CountDownLatch(0)

        fun sync() {
            open.await(30, TimeUnit.SECONDS)
            now += takes
        }
    }

    private fun msOf(f: () -> Unit): Long {
        val start = System.nanoTime()
        f()
        return (System.nanoTime() - start) / 1_000_000
    }

    @Test
    fun aTransitionStillRunningIsWaitedFor() {
        val wms = Wms().apply { takes = 300 }
        val t = Transitions(wms::sync, {}, cap) { wms.now }
        t.awaitEnd(cap)
        wms.open = CountDownLatch(1)
        assertTrue(msOf { t.awaitEnd(400) } >= 350)
        assertTrue(t.running(true))
        wms.open.countDown()
    }

    @Test
    fun anAnimationWmsGaveUpOnHoldsNoTouchAndIsNoTransition() {
        // an app behind the one in front kept a window of its own animating: WMS answered at its cap, every time
        val wms = Wms().apply { takes = cap }
        val t = Transitions(wms::sync, {}, cap) { wms.now }
        t.awaitEnd(cap)
        wms.open = CountDownLatch(1)
        assertTrue(msOf { t.awaitEnd(cap) } < 1_000)
        assertFalse(t.running(true))
        assertFalse(t.runningNow())
        wms.open.countDown()
    }

    @Test
    fun anAnswerBeforeTheCapMakesTheNextWaitAgain() {
        val wms = Wms().apply { takes = cap }
        val t = Transitions(wms::sync, {}, cap) { wms.now }
        t.awaitEnd(cap)
        // it ended: the question asked now comes back early, and the one after it is waited for again
        wms.takes = 200
        t.awaitEnd(cap)
        while (t.open) Thread.sleep(5)
        wms.open = CountDownLatch(1)
        assertTrue(msOf { t.awaitEnd(400) } >= 350)
        wms.open.countDown()
    }
}
